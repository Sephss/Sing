// Song search via the /api/search serverless proxy (YouTube Data API).
export const CATEGORIES = [
  { id: 'popular',   label: 'Popular',    emoji: '🎤', query: 'most popular songs' },
  { id: 'trending',  label: 'Trending',   emoji: '🔥', query: 'trending hits 2025' },
  { id: 'love',      label: 'Love Songs', emoji: '❤️', query: 'love songs' },
  { id: 'rock',      label: 'Rock',       emoji: '🎸', query: 'rock classics' },
  { id: 'pop',       label: 'Pop',        emoji: '🎶', query: 'pop hits' },
  { id: 'opm',       label: 'OPM',        emoji: '🇵🇭', query: 'OPM Filipino songs' },
  { id: 'rnb',       label: 'R&B',        emoji: '🎵', query: 'R&B songs' },
  { id: 'ballad',    label: 'Ballad',     emoji: '🎹', query: 'ballads' },
  { id: 'dance',     label: 'Dance',      emoji: '🕺', query: 'dance hits' },
  { id: 'classic',   label: 'Classic',    emoji: '🎼', query: 'classic oldies' },
  { id: '80s',       label: '80s',        emoji: '📼', query: '80s hits' },
  { id: '90s',       label: '90s',        emoji: '💿', query: '90s hits' },
  { id: '2000s',     label: '2000s',      emoji: '🎤', query: '2000s hits' },
  { id: '2010s',     label: '2010s',      emoji: '🎤', query: '2010s hits' },
  { id: '2020s',     label: '2020s',      emoji: '🎤', query: '2020s hits' },
  { id: 'christmas', label: 'Christmas',  emoji: '🎄', query: 'christmas songs' }
];

const SUGGESTIONS = [
  'Perfect Ed Sheeran', 'A Thousand Years Christina Perri', 'Love Story Taylor Swift',
  'The Scientist Coldplay', 'Bohemian Rhapsody Queen', 'Someone Like You Adele',
  'Shallow Lady Gaga', 'Dancing Queen ABBA', 'Don\'t Stop Believin\' Journey',
  'Torete Moonstar88', 'Pare Ko Eraserheads', 'Ikaw Yeng Constantino',
  'Uptown Funk Bruno Mars', 'Stay With Me Sam Smith', 'My Heart Will Go On Celine Dion',
  'Total Eclipse of the Heart Bonnie Tyler', 'Mr. Brightside The Killers', 'Rolling in the Deep Adele'
];

const cache = new Map();
let activeController = null;

export class SearchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Splits "Song - Artist" style titles into song/artist, stripping karaoke noise. */
export function normalizeResult(raw) {
  const clean = raw.title
    .replace(/\(?\[?\s*(official\s+)?(karaoke|instrumental|lyrics?|with backing vocals?|sing[- ]?along|minus one)[^)\]|]*[)\]]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—|:]+$/g, '')
    .trim();
  const parts = clean.split(/\s[-–—|]\s/).map((p) => p.trim()).filter(Boolean);
  let title = clean || raw.title;
  let artist = raw.channel.replace(/\s*-\s*Topic$/i, '').replace(/\s*(karaoke|VEVO)\s*$/i, '').trim();
  if (parts.length >= 2) {
    // Karaoke channels commonly use "Song - Artist"; if the first segment is the artist we can't know, so keep order.
    title = parts[0];
    artist = parts[1];
  }
  return {
    id: raw.id,
    title,
    artist,
    fullTitle: raw.title,
    channel: raw.channel,
    thumbnail: raw.thumbnail || `https://i.ytimg.com/vi/${raw.id}/hqdefault.jpg`,
    duration: raw.duration || 0
  };
}

export async function searchSongs(query, { limit = 12, signal } = {}) {
  const key = `${query.toLowerCase()}|${limit}`;
  if (cache.has(key)) return cache.get(key);

  if (activeController && !signal) activeController.abort();
  activeController = signal ? null : new AbortController();
  const controller = signal || activeController;

  let response;
  try {
    response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new SearchError('Network error', 'network');
  }

  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error page */ }

  if (!response.ok) {
    const code = response.status === 429 ? 'quota' : response.status === 500 ? 'config' : 'server';
    throw new SearchError(data?.error || 'Search failed', code);
  }

  const results = (data.results || []).map(normalizeResult);
  cache.set(key, results);
  return results;
}

export function getSuggestions(prefix, history = []) {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return history.slice(0, 6);
  const pool = [...history, ...SUGGESTIONS];
  const seen = new Set();
  return pool
    .filter((s) => s.toLowerCase().includes(needle) && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 6);
}

export function randomSuggestion() {
  return SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
}

export function debounce(fn, wait = 350) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function errorMessage(error) {
  switch (error?.code) {
    case 'config': return 'Search isn’t configured yet. Add your YOUTUBE_API_KEY in Vercel and redeploy.';
    case 'quota':  return 'Today’s search quota has been used up. Please try again later.';
    case 'network': return 'Check your connection and try again.';
    default: return 'Please try again.';
  }
}
