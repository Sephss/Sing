// Renders the queue (full page + slide-over drawer) with drag-and-drop and keyboard/touch reordering.
import { queue } from './queue.js';
import { icon } from './icons.js';
import { $, esc, emptyState, setHtml } from './ui.js';
import { formatTime } from './player.js';

function nowPlayingBlock(song) {
  if (!song) return '';
  return `
    <div class="q-label">Now playing</div>
    <div class="q-now" data-id="${esc(song.id)}">
      <img src="${esc(song.thumbnail)}" alt="">
      <div class="q-text"><b>${esc(song.title)}</b><small>${esc(song.artist)}</small></div>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    </div>`;
}

function itemRow(song, absoluteIndex, position, total) {
  return `
    <li class="q-item" draggable="true" data-index="${absoluteIndex}" data-id="${esc(song.id)}">
      <span class="q-grip" aria-hidden="true">${icon('grip')}</span>
      <span class="q-num">${String(position).padStart(2, '0')}</span>
      <button class="q-main" data-action="jump" aria-label="Play ${esc(song.title)}">
        <img src="${esc(song.thumbnail)}" alt="" loading="lazy">
        <span class="q-text"><b>${esc(song.title)}</b><small>${esc(song.artist)}${song.duration ? ` · ${formatTime(song.duration)}` : ''}</small></span>
      </button>
      <span class="q-tools">
        <button class="icon-btn sm q-move" data-action="up" aria-label="Move up" ${position === 1 ? 'disabled' : ''}><span class="flip">${icon('chevron-down')}</span></button>
        <button class="icon-btn sm q-move" data-action="down" aria-label="Move down" ${position === total ? 'disabled' : ''}>${icon('chevron-down')}</button>
        <button class="icon-btn sm" data-action="remove" aria-label="Remove from queue">${icon('x')}</button>
      </span>
    </li>`;
}

export function queueMarkup(state) {
  const { items, index, current } = state;
  if (!items.length) {
    return emptyState({
      iconName: 'list',
      title: 'Your queue is empty',
      text: 'Add songs from search or categories and they’ll play one after another.',
      actionLabel: 'Find songs',
      actionAttr: 'data-goto="search"'
    });
  }
  const upcoming = items.slice(index + 1);
  const played = items.slice(0, Math.max(index, 0));
  const upHtml = upcoming.length
    ? `<div class="q-label">Up next · ${upcoming.length}</div>
       <ol class="q-list">${upcoming.map((s, i) => itemRow(s, index + 1 + i, i + 1, upcoming.length)).join('')}</ol>`
    : '<p class="q-end">That’s the end of the queue. Add more songs to keep the party going.</p>';
  const playedHtml = played.length
    ? `<div class="q-label muted">Played earlier</div>
       <ol class="q-list played">${played.map((s, i) => itemRow(s, i, i + 1, played.length)).join('')}</ol>`
    : '';
  return `${nowPlayingBlock(current)}${upHtml}${playedHtml}`;
}

function bindList(root, onJump) {
  let dragIndex = null;

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const item = event.target.closest('.q-item');
    if (!button || !item) return;
    const i = Number(item.dataset.index);
    const action = button.dataset.action;
    if (action === 'remove') queue.remove(i);
    else if (action === 'up') queue.move(i, i - 1);
    else if (action === 'down') queue.move(i, i + 1);
    else if (action === 'jump') onJump(queue.setCurrentIndex(i));
    event.stopPropagation();
  });

  root.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.q-item');
    if (!item) return;
    dragIndex = Number(item.dataset.index);
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragIndex));
  });

  root.addEventListener('dragover', (event) => {
    const item = event.target.closest('.q-item');
    if (dragIndex === null || !item) return;
    event.preventDefault();
    root.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    item.classList.add('drop-target');
  });

  root.addEventListener('drop', (event) => {
    const item = event.target.closest('.q-item');
    if (dragIndex === null || !item) return;
    event.preventDefault();
    queue.move(dragIndex, Number(item.dataset.index));
    dragIndex = null;
  });

  root.addEventListener('dragend', () => {
    dragIndex = null;
    root.querySelectorAll('.dragging, .drop-target').forEach((n) => n.classList.remove('dragging', 'drop-target'));
  });
}

export function initQueueUI({ onJump, onGoto }) {
  const page = $('#queuePage');
  const drawer = $('#drawerBody');
  bindList(page, onJump);
  bindList(drawer, onJump);

  const render = (state) => {
    const html = queueMarkup(state);
    setHtml(page, html);
    setHtml(drawer, html);
    const badge = $('#queueBadge');
    const waiting = Math.max(0, state.items.length - Math.max(state.index, 0) - (state.current ? 1 : 0));
    badge.textContent = String(waiting);
    badge.hidden = waiting === 0;
  };

  [page, drawer].forEach((root) => root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-goto]');
    if (target) onGoto(target.dataset.goto);
  }));

  queue.subscribe(render);
  render(queue.state);
}
