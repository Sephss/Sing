// In-memory registry of every song the UI has seen, so DOM events can resolve an id back to a song.
import { storage } from './storage.js';

const registry = new Map();

export function remember(songs) {
  songs.forEach((song) => registry.set(song.id, song));
  return songs;
}

export function lookupSong(id) {
  return registry.get(id)
    || storage.getFavorites().find((s) => s.id === id)
    || storage.getRecent().find((s) => s.id === id)
    || storage.getQueue().items.find((s) => s.id === id)
    || null;
}

/** Strips transient fields before persisting a song. */
export function slimSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    thumbnail: song.thumbnail,
    duration: song.duration || 0,
    channel: song.channel || ''
  };
}
