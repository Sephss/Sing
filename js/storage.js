// Single gateway for all localStorage access.
const PREFIX = 'sing:';

export const DEFAULT_SETTINGS = {
  autoplay: true,
  rememberQueue: true,
  volume: 80,
  showVisualizer: true,
  lyricsFontScale: 1,
  repeat: 'off', // off | all | one
  micMonitor: true,
  micEffect: 'clean',
  micIntensity: 50
};

const DEFAULT_MIC_PREFS = {
  deviceId: '',
  inputGain: 100,
  outputGain: 100,
  effectParams: {}
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode / quota — app keeps working in memory
  }
}

function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

const MAX_RECENT = 40;
const MAX_SEARCHES = 8;

export const storage = {
  getTheme() { return read('theme', null); },
  setTheme(theme) { write('theme', theme); },

  getSettings() { return { ...DEFAULT_SETTINGS, ...read('settings', {}) }; },
  saveSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    write('settings', next);
    return next;
  },
  resetSettings() { remove('settings'); remove('microphonePreferences'); remove('theme'); },

  getQueue() { return read('queue', { items: [], index: -1 }); },
  saveQueue(state) { write('queue', state); },
  clearQueue() { remove('queue'); },

  getRecent() { return read('recentlyPlayed', []); },
  addRecent(song) {
    const list = this.getRecent().filter((s) => s.id !== song.id);
    list.unshift({ ...song, playedAt: Date.now() });
    write('recentlyPlayed', list.slice(0, MAX_RECENT));
    return list;
  },
  clearRecent() { remove('recentlyPlayed'); },

  getFavorites() { return read('favorites', []); },
  toggleFavorite(song) {
    const list = this.getFavorites();
    const exists = list.some((s) => s.id === song.id);
    const next = exists ? list.filter((s) => s.id !== song.id) : [{ ...song, favoritedAt: Date.now() }, ...list];
    write('favorites', next);
    return !exists;
  },
  isFavorite(id) { return this.getFavorites().some((s) => s.id === id); },
  clearFavorites() { remove('favorites'); },

  getSearches() { return read('searchHistory', []); },
  addSearch(query) {
    const list = this.getSearches().filter((q) => q.toLowerCase() !== query.toLowerCase());
    list.unshift(query);
    write('searchHistory', list.slice(0, MAX_SEARCHES));
  },
  clearSearches() { remove('searchHistory'); },

  getMicPrefs() { return { ...DEFAULT_MIC_PREFS, ...read('microphonePreferences', {}) }; },
  saveMicPrefs(patch) {
    const next = { ...this.getMicPrefs(), ...patch };
    write('microphonePreferences', next);
    return next;
  }
};
