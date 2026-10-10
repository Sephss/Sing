// Lyrics via LRCLIB (https://lrclib.net) — a free, open, CORS-enabled lyrics API.
// Synced lyrics (LRC) are used when available; otherwise plain lyrics; otherwise a graceful empty state.
const API = 'https://lrclib.net/api';
const cache = new Map();

export function parseLrc(lrc) {
  const lines = [];
  const stamp = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const row of lrc.split('\n')) {
    const times = [...row.matchAll(stamp)];
    if (!times.length) continue;
    const text = row.replace(stamp, '').trim();
    for (const t of times) {
      const ms = t[3] ? Number(t[3].padEnd(3, '0')) : 0;
      lines.push({ time: Number(t[1]) * 60 + Number(t[2]) + ms / 1000, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

async function request(path, signal) {
  const response = await fetch(`${API}${path}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lyrics request failed (${response.status})`);
  return response.json();
}

function pickBest(candidates, durationSeconds) {
  if (!candidates?.length) return null;
  const withSync = candidates.filter((c) => c.syncedLyrics);
  const pool = withSync.length ? withSync : candidates.filter((c) => c.plainLyrics);
  if (!pool.length) return null;
  if (!durationSeconds) return pool[0];
  return [...pool].sort((a, b) => Math.abs(a.duration - durationSeconds) - Math.abs(b.duration - durationSeconds))[0];
}

/**
 * @returns {Promise<{synced: boolean, lines: {time:number|null,text:string}[]} | null>}
 */
export async function fetchLyrics(song, { signal } = {}) {
  if (cache.has(song.id)) return cache.get(song.id);

  const title = song.title;
  const artist = song.artist;
  let result = null;

  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (song.duration) params.set('duration', String(song.duration));
    let match = await request(`/get?${params}`, signal);

    if (!match) {
      const search = new URLSearchParams({ q: `${title} ${artist}` });
      match = pickBest(await request(`/search?${search}`, signal), song.duration);
    }
    if (!match) {
      const looser = new URLSearchParams({ track_name: title });
      match = pickBest(await request(`/search?${looser}`, signal), song.duration);
    }

    if (match?.syncedLyrics) {
      const lines = parseLrc(match.syncedLyrics);
      if (lines.length) result = { synced: true, lines };
    }
    if (!result && match?.plainLyrics) {
      const lines = match.plainLyrics.split('\n').map((text) => ({ time: null, text: text.trim() }));
      result = { synced: false, lines };
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    result = null; // lyrics are optional — never break the player
  }

  cache.set(song.id, result);
  return result;
}

/** Index of the line active at `time`, or -1 before the first line. */
export function activeLineIndex(lines, time) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) { found = mid; low = mid + 1; } else { high = mid - 1; }
  }
  return found;
}
