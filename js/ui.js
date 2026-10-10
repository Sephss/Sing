// Shared UI builders: song cards/rows, skeletons, empty states, toasts, formatting.
import { icon, hydrateIcons } from './icons.js';
import { formatTime } from './player.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function relativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

export function songData(song) {
  return `data-id="${esc(song.id)}"`;
}

const durationLabel = (song) => (song.duration ? formatTime(song.duration) : '');

/** Vertical grid card. */
export function songCard(song, { isFavorite, isPlaying }) {
  return `
    <article class="card ${isPlaying ? 'is-playing' : ''}" ${songData(song)}>
      <button class="card-media" data-action="play" aria-label="Play ${esc(song.title)}">
        <img src="${esc(song.thumbnail)}" alt="" loading="lazy" decoding="async">
        ${durationLabel(song) ? `<span class="duration">${durationLabel(song)}</span>` : ''}
        <span class="card-play">${icon('play')}<span class="eq sm"><i></i><i></i><i></i><i></i></span></span>
      </button>
      <div class="card-body">
        <h3 class="card-title" title="${esc(song.title)}">${esc(song.title)}</h3>
        <p class="card-artist">${esc(song.artist)}</p>
      </div>
      <div class="card-actions">
        <button class="icon-btn sm" data-action="next" aria-label="Play next" data-tip="Play next">${icon('skip-next')}</button>
        <button class="icon-btn sm" data-action="queue" aria-label="Add to queue" data-tip="Add to queue">${icon('list-plus')}</button>
        <button class="icon-btn sm fav ${isFavorite ? 'on' : ''}" data-action="favorite" aria-pressed="${isFavorite}" aria-label="Favorite" data-tip="Favorite">${icon('heart')}</button>
      </div>
    </article>`;
}

/** Horizontal list row (search results, recent). */
export function songRow(song, { isFavorite, isPlaying, meta = '' }) {
  return `
    <article class="row ${isPlaying ? 'is-playing' : ''}" ${songData(song)}>
      <button class="row-media" data-action="play" aria-label="Play ${esc(song.title)}">
        <img src="${esc(song.thumbnail)}" alt="" loading="lazy" decoding="async">
        <span class="card-play">${icon('play')}<span class="eq sm"><i></i><i></i><i></i><i></i></span></span>
      </button>
      <div class="row-text">
        <h3 title="${esc(song.title)}">${esc(song.title)}</h3>
        <p>${esc(song.artist)}${meta ? ` <span class="dot">•</span> ${esc(meta)}` : ''}</p>
      </div>
      <span class="row-duration">${durationLabel(song)}</span>
      <div class="row-actions">
        <button class="icon-btn sm" data-action="next" aria-label="Play next" data-tip="Play next">${icon('skip-next')}</button>
        <button class="icon-btn sm" data-action="queue" aria-label="Add to queue" data-tip="Add to queue">${icon('list-plus')}</button>
        <button class="icon-btn sm fav ${isFavorite ? 'on' : ''}" data-action="favorite" aria-pressed="${isFavorite}" aria-label="Favorite" data-tip="Favorite">${icon('heart')}</button>
      </div>
    </article>`;
}

export function skeletons(count = 8, variant = 'card') {
  const item = variant === 'row'
    ? '<div class="row skeleton-row"><i class="sk sk-thumb"></i><div class="row-text"><i class="sk sk-line"></i><i class="sk sk-line short"></i></div></div>'
    : '<div class="card skeleton-card"><i class="sk sk-media"></i><div class="card-body"><i class="sk sk-line"></i><i class="sk sk-line short"></i></div></div>';
  return Array.from({ length: count }, () => item).join('');
}

export function emptyState({ iconName = 'music', title, text, actionLabel, actionAttr }) {
  return `
    <div class="empty">
      <span class="empty-icon">${icon(iconName)}</span>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${actionLabel ? `<button class="btn btn-primary" ${actionAttr}>${esc(actionLabel)}</button>` : ''}
    </div>`;
}

export function loadingState(label = 'Searching for songs…') {
  return `<div class="loading-label" role="status"><span class="spinner"></span>${esc(label)}</div>`;
}

export function toast(message, { type = 'info', iconName } = {}) {
  const host = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `${icon(iconName || (type === 'error' ? 'alert' : 'check'))}<span>${esc(message)}</span>`;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 2600);
  while (host.children.length > 3) host.firstElementChild.remove();
}

export function setHtml(element, html) {
  element.innerHTML = html;
  hydrateIcons(element);
}

export function songFromElement(element, lookup) {
  const holder = element.closest('[data-id]');
  return holder ? lookup(holder.dataset.id) : null;
}
