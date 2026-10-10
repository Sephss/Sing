// Karaoke queue state. `index` points at the currently playing item (-1 = none).
import { storage } from './storage.js';

const listeners = new Set();
let items = [];
let index = -1;
let persist = true;

function emit() {
  if (persist) storage.saveQueue({ items, index });
  listeners.forEach((fn) => fn(snapshot()));
}

function snapshot() {
  return { items: [...items], index, current: items[index] || null };
}

export const queue = {
  init({ remember = true } = {}) {
    persist = remember;
    if (remember) {
      const saved = storage.getQueue();
      items = Array.isArray(saved.items) ? saved.items : [];
      index = Number.isInteger(saved.index) && saved.index < items.length ? saved.index : -1;
    }
    emit();
  },

  setPersist(value) {
    persist = value;
    if (value) emit(); else storage.clearQueue();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  get state() { return snapshot(); },
  get length() { return items.length; },
  get current() { return items[index] || null; },
  get upNext() { return items.slice(index + 1); },

  /** Adds a song; returns false if it's already queued (and not the current one). */
  add(song) {
    if (items.some((s) => s.id === song.id)) return false;
    items.push(song);
    emit();
    return true;
  },

  /** Inserts directly after the current song. */
  playNext(song) {
    const existing = items.findIndex((s) => s.id === song.id);
    if (existing === index && existing !== -1) return false;
    if (existing !== -1) {
      const [moved] = items.splice(existing, 1);
      if (existing < index) index -= 1;
      items.splice(index + 1, 0, moved);
    } else {
      items.splice(index + 1, 0, song);
    }
    emit();
    return true;
  },

  /** Makes `song` the current item, adding it right after the current one if needed. */
  setCurrentSong(song) {
    let found = items.findIndex((s) => s.id === song.id);
    if (found === -1) {
      items.splice(index + 1, 0, song);
      found = index + 1;
    }
    index = found;
    emit();
    return items[index];
  },

  setCurrentIndex(i) {
    if (i < 0 || i >= items.length) return null;
    index = i;
    emit();
    return items[index];
  },

  remove(i) {
    if (i < 0 || i >= items.length) return;
    items.splice(i, 1);
    if (i < index) index -= 1;
    else if (i === index) index -= 1; // next() will then land on the item that slid into this slot
    emit();
  },

  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    if (from === index) index = to;
    else if (from < index && to >= index) index -= 1;
    else if (from > index && to <= index) index += 1;
    emit();
  },

  clear({ keepCurrent = false } = {}) {
    if (keepCurrent && items[index]) {
      items = [items[index]];
      index = 0;
    } else {
      items = [];
      index = -1;
    }
    emit();
  },

  /** Shuffles everything after the current song. */
  shuffleUpNext() {
    const head = items.slice(0, index + 1);
    const tail = items.slice(index + 1);
    for (let i = tail.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    items = [...head, ...tail];
    emit();
  },

  /** Returns the next song per repeat mode without mutating, or null at the end. */
  peekNext(repeat = 'off') {
    if (!items.length) return null;
    if (repeat === 'one' && items[index]) return items[index];
    if (index + 1 < items.length) return items[index + 1];
    if (repeat === 'all') return items[0];
    return null;
  },

  next(repeat = 'off') {
    const upcoming = this.peekNext(repeat);
    if (!upcoming) return null;
    if (repeat === 'one') return items[index];
    index = index + 1 < items.length ? index + 1 : 0;
    emit();
    return items[index];
  },

  previous() {
    if (index <= 0) return items[index] || null;
    index -= 1;
    emit();
    return items[index];
  }
};
