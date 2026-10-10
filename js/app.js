// App bootstrap: routing, theme, search & browse views, settings, shortcuts.
import { storage, DEFAULT_SETTINGS } from "./storage.js";
import { queue } from "./queue.js";
import { playback } from "./playback.js";
import { initQueueUI } from "./queue-ui.js";
import { mic } from "./microphone.js";
import { EFFECTS } from "./effects.js";
import { initMicUI, setMicViewActive, syncMusicVolume } from "./mic-ui.js";
import { startHeroVisual } from "./visuals.js";
import { hydrateIcons, setIcon } from "./icons.js";
import {
  CATEGORIES,
  searchSongs,
  getSuggestions,
  randomSuggestion,
  debounce,
  errorMessage,
} from "./search.js";
import { remember, lookupSong, slimSong } from "./store.js";
import {
  $,
  $$,
  esc,
  relativeTime,
  songCard,
  songRow,
  skeletons,
  emptyState,
  loadingState,
  setHtml,
  toast,
} from "./ui.js";

const VIEWS = [
  "home",
  "search",
  "categories",
  "queue",
  "recent",
  "favorites",
  "mic",
  "settings",
];
const HOME_CATEGORIES = [
  "popular",
  "trending",
  "love",
  "rock",
  "pop",
  "opm",
  "rnb",
  "ballad",
  "dance",
  "classic",
  "christmas",
  "2000s",
  "2010s",
  "2020s",
];

const SHORTCUTS = [
  ["Space", "Play / pause"],
  ["←  →", "Seek 5s back / forward"],
  ["Shift + ←  →", "Previous / next song"],
  ["↑  ↓", "Volume up / down"],
  ["M", "Mute"],
  ["F", "Fullscreen karaoke mode"],
  ["Q", "Open queue"],
  ["L", "Toggle lyrics"],
  ["[  ]", "Lyrics delay −/+ 0.1s"],
  ["{  }", "Lyrics delay −/+ 1s"],
  ["/", "Focus search"],
  ["?", "Show shortcuts"],
  ["Esc", "Close panel"],
];

let currentView = "home";
let stopHero = null;

/* ================= theme ================= */

function applyTheme(theme, { save = true } = {}) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#0a0a0f" : "#f6f4f1";
  setIcon($("#themeIcon"), theme === "dark" ? "sun" : "moon");
  $$("#themeSegment [data-theme-opt]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.themeOpt === theme)),
  );
  if (save) storage.setTheme(theme);
}

function initTheme() {
  const saved = storage.getTheme();
  const preferred =
    saved ||
    (window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark");
  applyTheme(preferred, { save: false });
  $("#themeBtn").addEventListener("click", () => {
    document.documentElement.classList.add("theme-fade");
    applyTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    );
    setTimeout(
      () => document.documentElement.classList.remove("theme-fade"),
      400,
    );
  });
  $("#themeSegment").addEventListener("click", (event) => {
    const option = event.target.closest("[data-theme-opt]");
    if (option) applyTheme(option.dataset.themeOpt);
  });
}

/* ================= song list rendering ================= */

function isPlayingId(id) {
  return playback.current?.id === id;
}

function renderSongs(container, songs, { variant = "card", metaFor } = {}) {
  remember(songs);
  const favorites = new Set(storage.getFavorites().map((s) => s.id));
  const render = variant === "row" ? songRow : songCard;
  setHtml(
    container,
    songs
      .map((song) =>
        render(song, {
          isFavorite: favorites.has(song.id),
          isPlaying: isPlayingId(song.id),
          meta: metaFor ? metaFor(song) : "",
        }),
      )
      .join(""),
  );
}

function errorState(error) {
  return emptyState({
    iconName: "alert",
    title: "We couldn’t load songs right now.",
    text: `${errorMessage(error)}`,
    actionLabel: "Try again",
    actionAttr: "data-retry",
  });
}

/** Loads a query into a container with loading / empty / error states. Latest call wins. */
async function loadSongs(
  container,
  query,
  { variant = "card", limit = 12, loadingLabel } = {},
) {
  const token = Symbol("load");
  container._token = token;
  setHtml(
    container,
    variant === "row" ? skeletons(6, "row") : skeletons(8, "card"),
  );
  container.setAttribute("aria-busy", "true");
  try {
    const songs = await searchSongs(query, { limit });
    if (container._token !== token) return [];
    container.removeAttribute("aria-busy");
    if (!songs.length) {
      setHtml(
        container,
        emptyState({
          iconName: "search",
          title: "No songs found.",
          text: "Try searching for another song or artist.",
        }),
      );
      return [];
    }
    renderSongs(container, songs, { variant });
    return songs;
  } catch (error) {
    if (error.name === "AbortError" || container._token !== token) return [];
    container.removeAttribute("aria-busy");
    setHtml(container, errorState(error));
    container
      .querySelector("[data-retry]")
      ?.addEventListener("click", () =>
        loadSongs(container, query, { variant, limit, loadingLabel }),
      );
    return [];
  }
}

/* ================= song actions (delegated) ================= */

function toggleFavorite(song) {
  const added = storage.toggleFavorite(slimSong(song));
  refreshFavoriteButtons();
  toast(added ? "Added to favorites" : "Removed from favorites", {
    iconName: "heart",
  });
  if (currentView === "favorites") renderFavorites();
}

function refreshFavoriteButtons() {
  const favorites = new Set(storage.getFavorites().map((s) => s.id));
  $$("[data-id] .fav").forEach((button) => {
    const on = favorites.has(button.closest("[data-id]").dataset.id);
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  playback.setFavorite(
    Boolean(playback.current && favorites.has(playback.current.id)),
  );
}

function refreshPlayingMarkers() {
  const id = playback.current?.id;
  $$(".card[data-id], .row[data-id]").forEach((node) =>
    node.classList.toggle("is-playing", node.dataset.id === id),
  );
}

function playNow(song) {
  playback.play(song);
  playback.openPlayer();
}

function addToQueue(song) {
  const added = queue.add(slimSong(song));
  if (!added) {
    toast("Already in your queue", { iconName: "list" });
    return;
  }
  toast(`Added “${song.title}” to queue`, { iconName: "list-plus" });
  if (!playback.current) playback.startIfIdle();
}

function playNext(song) {
  if (!playback.current) {
    playNow(song);
    return;
  }
  queue.playNext(slimSong(song));
  toast("Playing next", { iconName: "skip-next" });
}

function handleSongAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const holder = button.closest("[data-id]");
  if (!holder) return;
  const song = lookupSong(holder.dataset.id);
  if (!song) return;
  const handlers = {
    play: playNow,
    queue: addToQueue,
    next: playNext,
    favorite: toggleFavorite,
  };
  const handler = handlers[button.dataset.action];
  if (handler) handler(song);
}

/* ================= views ================= */

function renderRecent() {
  const list = storage.getRecent();
  const host = $("#recentList");
  if (!list.length) {
    setHtml(
      host,
      emptyState({
        iconName: "clock",
        title: "Nothing played yet",
        text: "Songs you sing will show up here.",
        actionLabel: "Find a song",
        actionAttr: 'data-goto="search"',
      }),
    );
    return;
  }
  renderSongs(host, list, {
    variant: "row",
    metaFor: (s) => relativeTime(s.playedAt),
  });
}

function renderFavorites() {
  const list = storage.getFavorites();
  const host = $("#favoritesGrid");
  $("#favoritesQueueAll").disabled = !list.length;
  if (!list.length) {
    setHtml(
      host,
      emptyState({
        iconName: "heart",
        title: "No favorites yet",
        text: "Tap the heart on any song to keep it here.",
        actionLabel: "Discover songs",
        actionAttr: 'data-goto="categories"',
      }),
    );
    return;
  }
  renderSongs(host, list);
}

function renderSearchHistory() {
  const history = storage.getSearches();
  const host = $("#searchHistory");
  setHtml(
    host,
    history.length
      ? `<span class="muted-label">Recent searches</span>${history.map((q) => `<button class="chip sm" data-search="${esc(q)}">${esc(q)}</button>`).join("")}<button class="link-btn" data-clear-searches>Clear</button>`
      : "",
  );
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  storage.addSearch(trimmed);
  $("#searchHeading").innerHTML = `Results for “${esc(trimmed)}”`;
  $$("#topSearchInput, #heroSearchInput").forEach((input) => {
    input.value = trimmed;
  });
  renderSearchHistory();
  const host = $("#searchResults");
  host.className = "results";
  setHtml(host, loadingState("Searching for songs…") + skeletons(6, "row"));
  const token = Symbol("search");
  host._token = token;
  try {
    const songs = await searchSongs(trimmed, { limit: 18 });
    if (host._token !== token) return;
    host.className = "results list";
    if (!songs.length) {
      setHtml(
        host,
        emptyState({
          iconName: "search",
          title: "No songs found.",
          text: "Try searching for another song or artist.",
        }),
      );
      return;
    }
    renderSongs(host, songs, { variant: "row" });
  } catch (error) {
    if (error.name === "AbortError" || host._token !== token) return;
    host.className = "results";
    setHtml(host, errorState(error));
    host
      .querySelector("[data-retry]")
      ?.addEventListener("click", () => runSearch(trimmed));
  }
}

function renderChips(host, ids, { active } = {}) {
  setHtml(
    host,
    ids
      .map((id) => {
        const category = CATEGORIES.find((c) => c.id === id);
        return `<button class="chip ${id === active ? "active" : ""}" role="tab" aria-selected="${id === active}" data-category="${id}"><span aria-hidden="true">${category.emoji}</span>${esc(category.label)}</button>`;
      })
      .join(""),
  );
}

function showCategory(id) {
  const category = CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
  renderChips(
    $("#categoryChips"),
    CATEGORIES.map((c) => c.id),
    { active: category.id },
  );
  $("#categoryHeading").textContent = category.label;
  loadSongs($("#categoryResults"), category.query, { limit: 16 });
  $("#categoryChips .active")?.scrollIntoView({
    block: "nearest",
    inline: "center",
  });
}

function onViewShown(name, params) {
  setMicViewActive(name === "mic");
  if (name === "home") {
    if (!$("#homeGrid").children.length)
      loadSongs($("#homeGrid"), CATEGORIES[0].query, { limit: 12 });
    renderHeroRecent();
  }
  if (name === "search") {
    renderSearchHistory();
    if (params.q) runSearch(params.q);
    else if (!$("#searchResults").children.length) {
      setHtml(
        $("#searchResults"),
        emptyState({
          iconName: "search",
          title: "Search for any song",
          text: "Try “Perfect Ed Sheeran” or an OPM favorite.",
        }),
      );
    }
  }
  if (name === "categories") showCategory(params.c || "popular");
  if (name === "recent") renderRecent();
  if (name === "favorites") renderFavorites();
  if (name === "settings") syncSettingsUI();
}

function renderHeroRecent() {
  const searches = storage.getSearches().slice(0, 4);
  const host = $("#heroRecent");
  setHtml(
    host,
    searches.length
      ? searches
          .map(
            (q) =>
              `<button class="chip sm ghost" data-search="${esc(q)}">${esc(q)}</button>`,
          )
          .join("")
      : ["Perfect Ed Sheeran", "Torete Moonstar88", "Bohemian Rhapsody"]
          .map(
            (q) =>
              `<button class="chip sm ghost" data-search="${esc(q)}">${esc(q)}</button>`,
          )
          .join(""),
  );
}

/* ================= router ================= */

function parseHash() {
  const [name, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return {
    name: VIEWS.includes(name) ? name : "home",
    params: Object.fromEntries(new URLSearchParams(query)),
  };
}

export function navigate(name, params = {}) {
  const query = new URLSearchParams(params).toString();
  const hash = `#${name}${query ? `?${query}` : ""}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const { name, params } = parseHash();
  const previous = currentView;
  currentView = name;
  $$(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  $$(".nav-btn[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#navMoreMenu").hidden = true;
  $("#navMore").setAttribute("aria-expanded", "false");
  $("#navMore").classList.toggle(
    "active",
    name === "recent" || name === "favorites",
  );
  if (playback.isOpen) playback.closePlayer();
  const view = $(`#view-${name}`);
  if (!playback.current) document.title = `Sing — ${view.dataset.title}`;
  if (previous !== name) {
    view.classList.remove("enter");
    void view.offsetWidth; // restart the page-transition animation
    view.classList.add("enter");
    window.scrollTo({ top: 0 });
  }
  onViewShown(name, params);
}

/* ================= search inputs ================= */

function initSearch() {
  const list = document.createElement("datalist");
  list.id = "suggestList";
  document.body.appendChild(list);
  const inputs = $$("#topSearchInput, #heroSearchInput");

  const refreshSuggestions = (value) => {
    list.innerHTML = getSuggestions(value, storage.getSearches())
      .map((s) => `<option value="${esc(s)}"></option>`)
      .join("");
  };
  const liveSearch = debounce((value) => {
    if (value.trim().length >= 3 && currentView === "search")
      navigate("search", { q: value.trim() });
  }, 600);

  inputs.forEach((input) => {
    input.setAttribute("list", "suggestList");
    input.addEventListener("input", () => {
      refreshSuggestions(input.value);
      liveSearch(input.value);
    });
    input.addEventListener("focus", () => refreshSuggestions(input.value));
  });

  const submit = (input) => (event) => {
    event.preventDefault();
    liveSearch.cancel();
    if (input.value.trim()) navigate("search", { q: input.value.trim() });
    input.blur();
  };
  $("#heroSearchForm").addEventListener(
    "submit",
    submit($("#heroSearchInput")),
  );
  $("#topSearchForm").addEventListener("submit", submit($("#topSearchInput")));
}

async function playRandom() {
  toast("Finding a song for you…", { iconName: "shuffle" });
  try {
    const songs = await searchSongs(randomSuggestion(), { limit: 5 });
    if (!songs.length) throw new Error("empty");
    remember(songs);
    playNow(songs[0]);
  } catch (error) {
    toast(errorMessage(error), { type: "error" });
  }
}

/* ================= settings ================= */

function syncSettingsUI() {
  const s = storage.getSettings();
  $("#setAutoplay").checked = s.autoplay;
  $("#setRememberQueue").checked = s.rememberQueue;
  $("#setVisualizer").checked = s.showVisualizer;
  $("#setMonitor").checked = s.micMonitor;
  $("#setVolume").value = s.volume;
  $("#setVolumeOut").textContent = `${s.volume}%`;
  $("#setIntensity").value = s.micIntensity;
  $("#setIntensityOut").textContent = `${s.micIntensity}%`;
  $("#setEffect").value = s.micEffect;
  document.body.classList.toggle("no-glow", !s.showVisualizer);
}

function initSettings() {
  $("#setEffect").innerHTML = EFFECTS.map(
    (e) => `<option value="${e.id}">${esc(e.label)}</option>`,
  ).join("");
  const bindCheck = (id, key, after) =>
    $(id).addEventListener("change", (event) => {
      storage.saveSettings({ [key]: event.target.checked });
      after?.(event.target.checked);
      syncSettingsUI();
    });
  bindCheck("#setAutoplay", "autoplay");
  bindCheck("#setVisualizer", "showVisualizer");
  bindCheck("#setMonitor", "micMonitor", (on) => mic.setMonitoring(on));
  bindCheck("#setRememberQueue", "rememberQueue", (on) => {
    queue.setPersist(on);
    toast(on ? "Queue will be remembered" : "Queue won’t be saved", {
      iconName: "list",
    });
  });

  $("#setVolume").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    $("#setVolumeOut").textContent = `${value}%`;
    storage.saveSettings({ volume: value });
    playback.setVolume(value);
  });
  $("#setIntensity").addEventListener("input", (event) => {
    $("#setIntensityOut").textContent = `${event.target.value}%`;
    storage.saveSettings({ micIntensity: Number(event.target.value) });
  });
  $("#setEffect").addEventListener("change", (event) => {
    storage.saveSettings({ micEffect: event.target.value });
    if (!mic.active) mic.setEffect(event.target.value);
  });

  const confirmThen = (message, action, done) => () => {
    if (!window.confirm(message)) return;
    action();
    toast(done, { iconName: "trash" });
  };
  $("#clearRecent").addEventListener(
    "click",
    confirmThen(
      "Clear your recently played songs?",
      () => storage.clearRecent(),
      "Recently played cleared",
    ),
  );
  $("#recentClear").addEventListener(
    "click",
    confirmThen(
      "Clear your recently played songs?",
      () => {
        storage.clearRecent();
        renderRecent();
      },
      "Recently played cleared",
    ),
  );
  $("#clearFavorites").addEventListener(
    "click",
    confirmThen(
      "Remove all favorites?",
      () => {
        storage.clearFavorites();
        refreshFavoriteButtons();
      },
      "Favorites cleared",
    ),
  );
  $("#clearQueueSetting").addEventListener(
    "click",
    confirmThen(
      "Clear the whole queue?",
      () => queue.clear({ keepCurrent: true }),
      "Queue cleared",
    ),
  );
  $("#resetSettings").addEventListener("click", () => {
    if (!window.confirm("Reset all settings to their defaults?")) return;
    storage.resetSettings();
    applyTheme(
      window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark",
      { save: false },
    );
    playback.refreshSettings();
    playback.setVolume(DEFAULT_SETTINGS.volume);
    syncSettingsUI();
    toast("Settings reset", { iconName: "settings" });
  });
}

/* ================= shortcuts ================= */

function renderShortcuts() {
  const html = SHORTCUTS.map(
    ([keys, label]) =>
      `<div><dt>${keys
        .split(/\s{2,}|\s\+\s/)
        .map((k) => `<kbd>${esc(k)}</kbd>`)
        .join("")}</dt><dd>${esc(label)}</dd></div>`,
  ).join("");
  $("#shortcutList").innerHTML = html;
  $("#shortcutListModal").innerHTML = html;
}

function toggleShortcutsModal(force) {
  const modal = $("#shortcutsModal");
  const open = force ?? modal.hidden;
  modal.hidden = !open;
  if (open) $("#shortcutsClose").focus();
}

function isTyping(target) {
  return target.closest(
    'input:not([type="range"]), textarea, select, [contenteditable="true"]',
  );
}

function onKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") {
    if (!$("#shortcutsModal").hidden) toggleShortcutsModal(false);
    else if (playback.queueOpen) playback.toggleQueue(false);
    else if (playback.isOpen && !document.fullscreenElement)
      playback.closePlayer();
    return;
  }
  if (isTyping(event.target)) return;

  const onControl = event.target.closest(
    'button, a, [role="radio"], select, input[type="range"]',
  );
  switch (event.key) {
    case " ":
      if (onControl && event.target.tagName !== "INPUT") return;
      if (playback.togglePlay()) event.preventDefault();
      break;
    case "ArrowLeft":
      if (event.shiftKey) playback.previous();
      else playback.seekBy(-5);
      event.preventDefault();
      break;
    case "ArrowRight":
      if (event.shiftKey) playback.next();
      else playback.seekBy(5);
      event.preventDefault();
      break;
    case "ArrowUp":
      playback.volumeBy(5);
      event.preventDefault();
      break;
    case "ArrowDown":
      playback.volumeBy(-5);
      event.preventDefault();
      break;
    case "m":
    case "M":
      playback.toggleMute();
      break;
    case "f":
    case "F":
      playback.toggleFullscreen();
      break;
    case "q":
    case "Q":
      playback.toggleQueue();
      break;
    case "l":
    case "L":
      playback.toggleLyrics();
      break;
    case "[":
      playback.nudgeLyricsDelay(-0.1, false);
      break;
    case "]":
      playback.nudgeLyricsDelay(0.1, false);
      break;
    case "{":
      playback.nudgeLyricsDelay(-1, false);
      break;
    case "}":
      playback.nudgeLyricsDelay(1, false);
      break;
    case "/":
      event.preventDefault();
      $("#topSearchInput").focus();
      break;
    case "?":
      toggleShortcutsModal();
      break;
    default:
  }
}

/* ================= boot ================= */

function bindGlobalClicks() {
  document.addEventListener("click", (event) => {
    handleSongAction(event);

    const search = event.target.closest("[data-search]");
    if (search) {
      navigate("search", { q: search.dataset.search });
      return;
    }
    if (event.target.closest("[data-clear-searches]")) {
      storage.clearSearches();
      renderSearchHistory();
      return;
    }

    const category = event.target.closest("[data-category]");
    if (category) {
      if (currentView === "categories") showCategory(category.dataset.category);
      else navigate("categories", { c: category.dataset.category });
      return;
    }

    const goto = event.target.closest("[data-goto]");
    if (goto) {
      navigate(goto.dataset.goto);
      playback.toggleQueue(false);
      return;
    }

    const navButton = event.target.closest(".nav-btn[data-view]");
    if (navButton) navigate(navButton.dataset.view);
  });

  $("#navMore").addEventListener("click", () => {
    const menu = $("#navMoreMenu");
    menu.hidden = !menu.hidden;
    $("#navMore").setAttribute("aria-expanded", String(!menu.hidden));
  });

  $("#randomBtn").addEventListener("click", playRandom);
  $("#helpBtn").addEventListener("click", () => toggleShortcutsModal(true));
  $("#shortcutsClose").addEventListener("click", () =>
    toggleShortcutsModal(false),
  );
  $("#shortcutsModal").addEventListener("click", (event) => {
    if (event.target.id === "shortcutsModal") toggleShortcutsModal(false);
  });
  $("#miniMic").addEventListener("click", () => navigate("mic"));

  $("#queueShuffle").addEventListener("click", () => {
    queue.shuffleUpNext();
    toast("Up next shuffled", { iconName: "shuffle" });
  });
  $("#queueClear").addEventListener("click", () => {
    queue.clear({ keepCurrent: true });
    toast("Queue cleared", { iconName: "trash" });
  });
  $("#favoritesQueueAll").addEventListener("click", () => {
    const favorites = storage.getFavorites();
    const added = favorites.filter((song) => queue.add(slimSong(song))).length;
    toast(
      added
        ? `Queued ${added} favorite${added > 1 ? "s" : ""}`
        : "Everything is already queued",
      { iconName: "list-plus" },
    );
    if (added) playback.startIfIdle();
  });
}

function init() {
  hydrateIcons();
  initTheme();

  const settings = storage.getSettings();
  queue.init({ remember: settings.rememberQueue });
  mic.init();

  playback.init({
    onSongChange: () => {
      refreshPlayingMarkers();
      refreshFavoriteButtons();
      renderRecentIfVisible();
    },
    onPlayState: () => {},
    onFavoriteToggle: toggleFavorite,
    onVolume: (value) => syncMusicVolume(value),
  });

  initQueueUI({
    onJump: (song) => playback.playQueued(song),
    onGoto: (name) => navigate(name),
  });

  initMicUI({
    getMusicVolume: () => storage.getSettings().volume,
    setMusicVolume: (value) => playback.setVolume(value, true),
  });

  initSettings();
  initSearch();
  renderShortcuts();
  bindGlobalClicks();
  renderChips($("#homeChips"), HOME_CATEGORIES);
  syncSettingsUI();

  stopHero = startHeroVisual($("#heroCanvas"));
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("hashchange", route);
  queue.subscribe(() => refreshPlayingMarkers());
  route();
}

function renderRecentIfVisible() {
  if (currentView === "recent") renderRecent();
}

window.addEventListener("pagehide", () => {
  stopHero?.();
  mic.stop(false);
}); // always release the mic

init();
