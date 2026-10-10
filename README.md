# Sing — Premium Web Karaoke

Static HTML/CSS/vanilla JS app (ES modules, no build step) + one tiny Vercel serverless function that proxies YouTube search so your API key stays private.

## Architecture

```
index.html            App shell (all views, player, mini player, queue drawer, modals)
css/style.css         Design system: tokens, dark + light themes, components, responsive, reduced-motion
api/search.js         Vercel function: YouTube Data API v3 search (+ durations). Needs YOUTUBE_API_KEY
vercel.json           Security headers (mic permission), API caching
js/app.js             Bootstrap, hash router, theme, search/browse views, settings, shortcuts
js/playback.js        Player view, mini player, transport controls, lyric sync, fullscreen, sleep timer
js/player.js          YouTube IFrame Player API wrapper (official embed)
js/search.js          Search client, categories (curated queries), suggestions, debounce
js/lyrics.js          LRCLIB lyrics (synced LRC → plain → graceful "unavailable")
js/queue.js           Queue state (add/remove/reorder/shuffle/repeat) + localStorage persistence
js/queue-ui.js        Queue page + drawer, drag-and-drop and up/down buttons
js/effects.js         Web Audio voice effects (echo, reverb, hall, radio, robot, megaphone, deep, telephone, boost)
js/microphone.js      getUserMedia → gain → hi-pass → effect → compressor → output → speakers + visualizer
js/mic-ui.js          Microphone Studio view
js/storage.js         The only module that touches localStorage
js/ui.js, store.js, icons.js, visuals.js   Shared builders, song registry, inline SVG icons, hero animation
```

## API setup (YouTube Data API v3)

1. Google Cloud Console → create a project → enable **YouTube Data API v3**.
2. Credentials → **Create API key**. Restrict it to the YouTube Data API v3.
3. Each search costs ~101 quota units (default quota is 10,000/day ≈ 99 searches). Results are cached by the edge (`s-maxage=3600`) and in memory. Request a quota increase if you expect traffic.

## Run locally

```bash
npm i -g vercel
cp .env.example .env.local     # put your key in it
vercel dev                     # serves the site and /api/search at http://localhost:3000
```

(Opening index.html directly won't work: ES modules need http, and search needs the API route.)

## Deploy to Vercel

1. Push this folder to a Git repo (or run `vercel` in it).
2. Import into Vercel — framework preset **Other**, no build command, no output directory.
3. Project → Settings → Environment Variables → add `YOUTUBE_API_KEY` (Production, Preview, Development).
4. Redeploy. Microphone access requires HTTPS, which Vercel provides.

## How the major features work

- **Search/categories** — `/api/search` appends "karaoke", keeps only embeddable videos, fetches durations. Categories are curated queries.
- **Playback** — official YouTube IFrame Player API with custom controls. One persistent player element is repositioned between the full player view and a hidden dock, so music keeps playing when you browse (mini player).
- **Lyrics** — LRCLIB (free, open, CORS-enabled). Synced lyrics scroll and highlight; click a line to seek. Unsynced shows as static text; missing lyrics never affect playback.
- **Queue** — persisted; auto-advances on end; unplayable videos are skipped; repeat off/queue/song; shuffle; drag-and-drop.
- **Microphone** — Web Audio chain above; every effect has tunable parameters saved to localStorage. Deep Voice is a real-time delay-ramp pitch shifter.

## Browser limitations (by design, not bugs)

- **Video audio can't be processed.** YouTube's player is cross-origin; browsers don't allow tapping its audio and there are no CORS workarounds here. So the mic is processed separately and mixes at your speakers; the "Master (karaoke video)" slider controls the embed's volume. A true single-bus mixer with video audio isn't possible with embeds.
- **Latency** varies by device/browser (Bluetooth headphones are worst). Use wired headphones to avoid feedback.
- **Autoplay** — the first play must come from a user gesture (it always does here).
- **Some karaoke videos disallow embedding**; they're filtered out, and any that fail are skipped.
- iOS Safari ignores programmatic YouTube volume; use device volume.
- **Lyrics** coverage depends on LRCLIB; matching uses the parsed title/artist.

## Testing checklist

- [ ] Home loads Popular songs; hero search and top search both work (type ≥3 chars on Search page for live search)
- [ ] Search → loading skeletons → results; bogus query → "No songs found"; remove the API key → friendly error with Try again
- [ ] Play, pause, seek, volume, mute, prev/next, repeat, shuffle
- [ ] Add to queue / Play next; reorder by drag or arrows; remove; clear; reload keeps queue
- [ ] Song ending auto-plays next; last song shows end-of-queue toast
- [ ] Lyrics panel: synced highlight, click-to-seek, A+/A−, unavailable state
- [ ] Mini player appears when navigating away, keeps playing; click reopens player
- [ ] Fullscreen (F): video, lyrics line, controls, exit; controls fade when idle
- [ ] Mic: permission denied / no device / on / off; switch effects; adjust sliders; device picker; test loopback; visualizer reacts
- [ ] Favorites and Recently Played persist; settings clear/reset work
- [ ] Dark/light theme persists; follows OS on first visit
- [ ] Mobile (≤820px): bottom nav, queue bottom sheet, lyrics sheet, large touch targets
- [ ] Keyboard: Space, ←/→, Shift+←/→, ↑/↓, M, F, Q, L, /, ?, Esc
