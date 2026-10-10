// Playback controller: owns the YouTube player, the player view, mini player, lyrics sync and transport controls.
import { createPlayer, PlayerState, formatTime } from "./player.js";
import { queue } from "./queue.js";
import { storage } from "./storage.js";
import { fetchLyrics, activeLineIndex } from "./lyrics.js";
import { setIcon } from "./icons.js";
import { $, $$, esc, emptyState, loadingState, setHtml, toast } from "./ui.js";
import { slimSong } from "./store.js";

let player = null;
let deps = {};
let current = null;
let playing = false;
let muted = false;
let seeking = false;
let playerOpen = false;
let lyrics = null;
let lyricsIndex = -1;
let lyricsDelay = 0; // seconds the lyrics are shifted later (+) or earlier (−) than the studio timing
let lyricsAbort = null;
let sleepTimer = null;
let idleTimer = null;
let failureStreak = 0;
let layoutRaf = 0;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const settings = () => storage.getSettings();

/* ---------- helpers ---------- */

function setFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  input.style.setProperty(
    "--fill",
    `${((input.value - min) / (max - min)) * 100}%`,
  );
}

function setPlayingUi(isPlaying) {
  playing = isPlaying;
  setIcon($("#ctlPlayIcon"), isPlaying ? "pause" : "play");
  setIcon($("#miniPlayIcon"), isPlaying ? "pause" : "play");
  $("#ctlPlay").setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  $("#miniPlay").setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  $("#app").classList.toggle("is-playing", isPlaying);
  deps.onPlayState?.(isPlaying);
}

function renderNowPlaying(song) {
  $("#playerTitle").textContent = song ? song.title : "Nothing playing";
  $("#playerArtist").textContent = song
    ? song.artist
    : "Search for a song to begin";
  $("#miniTitle").textContent = song ? song.title : "—";
  $("#miniArtist").textContent = song ? song.artist : "—";
  $("#miniThumb").style.backgroundImage = song
    ? `url("${song.thumbnail}")`
    : "";
  $("#miniPlayer").hidden = !song;
  $("#app").classList.toggle("has-mini", Boolean(song));
  if (song && "mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      artwork: [{ src: song.thumbnail, sizes: "480x360", type: "image/jpeg" }],
    });
  }
  updateMiniVisibility();
  layoutStage();
}

function updateMiniVisibility() {
  $("#miniPlayer").hidden = !current || playerOpen;
  $("#app").classList.toggle("has-mini", Boolean(current) && !playerOpen);
}

/* ---------- stage (the single persistent video element) ---------- */

export function layoutStage() {
  const stage = $("#stage");
  if (!current) {
    stage.hidden = true;
    return;
  }
  stage.hidden = false;
  if (playerOpen) {
    const rect = $("#stageSlot").getBoundingClientRect();
    stage.classList.remove("docked");
    Object.assign(stage.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  } else {
    stage.classList.add("docked");
    ["top", "left", "width", "height"].forEach((prop) => {
      stage.style[prop] = "";
    });
  }
}

function trackLayout(duration = 600) {
  cancelAnimationFrame(layoutRaf);
  const end = performance.now() + duration;
  const tick = () => {
    layoutStage();
    if (performance.now() < end) layoutRaf = requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- lyrics ---------- */

function formatDelay(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}s`;
}

function renderLyricsDelay() {
  $("#lyricsDelayOut").textContent = formatDelay(lyricsDelay);
  $("#lyricsDelayReset").disabled = lyricsDelay === 0;
}

function renderLyricsState(html) {
  setHtml($("#lyricsScroll"), html);
  $("#fsLyrics").innerHTML = "";
}

async function loadLyrics(song) {
  lyricsAbort?.abort();
  lyrics = null;
  lyricsIndex = -1;
  lyricsAbort = new AbortController();
  renderLyricsState(loadingState("Finding lyrics…"));

  let result = null;
  try {
    result = await fetchLyrics(song, { signal: lyricsAbort.signal });
  } catch (error) {
    if (error.name === "AbortError") return;
  }
  if (!current || current.id !== song.id) return;

  lyrics = result;
  if (!result || !result.lines.some((l) => l.text)) {
    lyrics = null;
    renderLyricsState(
      emptyState({
        iconName: "text",
        title: "Lyrics unavailable for this song.",
        text: "The karaoke video still plays as normal.",
      }),
    );
    return;
  }

  const note = result.synced
    ? '<p class="lyrics-note">Timed to the studio recording. If it runs early or late, adjust Delay above.</p>'
    : '<p class="lyrics-note">These lyrics aren’t time-synced.</p>';
  const lines = result.lines
    .map((line, i) =>
      line.text
        ? `<p class="lyric ${result.synced ? "sync" : ""}" data-i="${i}">${esc(line.text)}</p>`
        : '<p class="lyric gap" aria-hidden="true">♪</p>',
    )
    .join("");
  setHtml($("#lyricsScroll"), `${note}<div class="lyric-lines">${lines}</div>`);
  syncLyrics(player?.getTime() || 0, true);
}

function syncLyrics(time, force = false) {
  if (!lyrics?.synced) return;
  const index = activeLineIndex(lyrics.lines, time - lyricsDelay);
  if (index === lyricsIndex && !force) return;
  lyricsIndex = index;

  const container = $("#lyricsScroll");
  container
    .querySelectorAll(".lyric.active")
    .forEach((n) => n.classList.remove("active"));
  container
    .querySelectorAll(".lyric.near")
    .forEach((n) => n.classList.remove("near"));
  const active = container.querySelector(`[data-i="${index}"]`);
  if (active) {
    active.classList.add("active");
    container.querySelector(`[data-i="${index + 1}"]`)?.classList.add("near");
    if (playerOpen) {
      const top =
        active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2;
      container.scrollTo({
        top,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
  }

  const text = lyrics.lines[index]?.text || "♪";
  const next = lyrics.lines.slice(index + 1).find((l) => l.text)?.text || "";
  $("#fsLyrics").innerHTML =
    `<p class="fs-line" key="${index}">${esc(text)}</p><p class="fs-next">${esc(next)}</p>`;
}

/* ---------- song loading ---------- */

function loadSong(song, autoplay) {
  current = song;
  lyricsDelay = storage.getLyricsDelay(song.id);
  renderLyricsDelay();
  failureStreak = autoplay ? failureStreak : 0;
  player.load(song.id, autoplay);
  renderNowPlaying(song);
  $("#seekBar").value = 0;
  setFill($("#seekBar"));
  $("#timeCurrent").textContent = "0:00";
  $("#timeTotal").textContent = song.duration
    ? formatTime(song.duration)
    : "0:00";
  if (autoplay) storage.addRecent(slimSong(song));
  document.title = `${song.title} — ${song.artist} · Sing`;
  loadLyrics(song);
  deps.onSongChange?.(song);
}

function advance({ fromError = false } = {}) {
  const repeat = settings().repeat;
  const next = queue.next(repeat);
  if (next) {
    loadSong(next, true);
    return true;
  }
  if (!fromError) toast("Reached the end of your queue", { iconName: "list" });
  player.stop();
  setPlayingUi(false);
  return false;
}

export const playback = {
  init(options) {
    deps = options;
    const prefs = settings();
    player = createPlayer({
      elementId: "ytPlayer",
      volume: prefs.volume,
      onState: (state) => {
        if (state === PlayerState.PLAYING) {
          failureStreak = 0;
          setPlayingUi(true);
        } else if (
          state === PlayerState.PAUSED ||
          state === PlayerState.ENDED ||
          state === PlayerState.CUED
        )
          setPlayingUi(false);
      },
      onTime: (time, duration) => {
        const total = duration || current?.duration || 0;
        if (!seeking && total) {
          const fraction = Math.min(1, time / total);
          $("#seekBar").value = Math.round(fraction * 1000);
          setFill($("#seekBar"));
          $("#timeCurrent").textContent = formatTime(time);
          $("#miniProgress").style.width = `${fraction * 100}%`;
        }
        if (total) $("#timeTotal").textContent = formatTime(total);
        syncLyrics(time);
      },
      onEnded: () => {
        if (settings().repeat === "one") {
          player.seekTo(0);
          player.play();
          return;
        }
        if (!settings().autoplay) {
          setPlayingUi(false);
          return;
        }
        advance();
      },
      onUnplayable: () => {
        toast(
          `“${current?.title || "This song"}” can’t be played here. Skipping…`,
          { type: "error" },
        );
        failureStreak += 1;
        if (failureStreak < 4) advance({ fromError: true });
      },
      onFailure: () =>
        toast("The video player had a problem. Try another song.", {
          type: "error",
        }),
    });

    this.bindControls();
    this.refreshSettings();
    this.bindStage();
    this.bindMediaSession();

    const saved = queue.current;
    if (saved) loadSong(saved, false);
    else renderNowPlaying(null);
    setIcon($("#ctlMuteIcon"), "volume");
    $("#ctlVolume").value = prefs.volume;
    setFill($("#ctlVolume"));
  },

  get current() {
    return current;
  },
  get isOpen() {
    return playerOpen;
  },
  get isPlaying() {
    return playing;
  },

  /** Starts a song and makes it current in the queue. */
  play(song) {
    queue.setCurrentSong(song);
    loadSong(song, true);
  },

  playQueued(song) {
    if (song) loadSong(song, true);
  },

  /** First song added to an empty/idle queue starts playing automatically. */
  startIfIdle() {
    if (current || !queue.length) return false;
    const first = queue.setCurrentIndex(0);
    if (first) loadSong(first, true);
    return Boolean(first);
  },

  togglePlay() {
    if (!current) return false;
    player.toggle();
    return true;
  },
  next() {
    if (!queue.peekNext(settings().repeat) && queue.length) {
      toast("No more songs in the queue", { iconName: "list" });
      return;
    }
    advance();
  },
  previous() {
    if (player.getTime() > 3 || !queue.state.index) {
      player.seekTo(0);
      return;
    }
    const song = queue.previous();
    if (song) loadSong(song, true);
  },
  seekBy(delta) {
    player?.seekBy(delta);
  },
  volumeBy(delta) {
    const value = Math.min(100, Math.max(0, player.getVolume() + delta));
    this.setVolume(value, true);
  },
  setVolume(value, persist = false) {
    player.setVolume(value);
    if (value > 0 && muted) {
      muted = false;
      player.unmute();
    }
    $("#ctlVolume").value = value;
    setFill($("#ctlVolume"));
    setIcon($("#ctlMuteIcon"), value === 0 || muted ? "volume-x" : "volume");
    if (persist) storage.saveSettings({ volume: value });
    deps.onVolume?.(value);
  },
  toggleMute() {
    muted = !muted;
    if (muted) player.mute();
    else player.unmute();
    setIcon($("#ctlMuteIcon"), muted ? "volume-x" : "volume");
    $("#ctlMute").setAttribute("aria-label", muted ? "Unmute" : "Mute");
  },

  /* ----- player view ----- */
  openPlayer() {
    if (!current) {
      toast("Pick a song first", { iconName: "music" });
      return false;
    }
    playerOpen = true;
    const view = $("#playerView");
    view.hidden = false;
    requestAnimationFrame(() => view.classList.add("open"));
    document.body.classList.add("player-open");
    updateMiniVisibility();
    trackLayout();
    $("#playerClose").focus({ preventScroll: true });
    return true;
  },
  closePlayer() {
    if (!playerOpen) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    playerOpen = false;
    const view = $("#playerView");
    view.classList.remove("open");
    document.body.classList.remove("player-open");
    updateMiniVisibility();
    trackLayout();
    setTimeout(
      () => {
        if (!playerOpen) view.hidden = true;
      },
      reducedMotion() ? 0 : 320,
    );
  },
  toggleLyrics() {
    if (!playerOpen && !this.openPlayer()) return;
    $("#playerView").classList.toggle("lyrics-open");
    trackLayout(450);
  },
  async toggleFullscreen() {
    if (!playerOpen && !this.openPlayer()) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#app").requestFullscreen(); // #app (not the player view) so the persistent video stage stays visible
    } catch {
      toast("Fullscreen isn’t available in this browser", { type: "error" });
    }
  },

  /* ----- queue drawer ----- */
  toggleQueue(force) {
    const drawer = $("#queueDrawer");
    const open = force ?? !drawer.classList.contains("open");
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    $("#queueScrim").hidden = !open;
    if (open) $("#drawerClose").focus({ preventScroll: true });
  },
  get queueOpen() {
    return $("#queueDrawer").classList.contains("open");
  },

  setFavorite(isFavorite) {
    const button = $("#playerFav");
    button.classList.toggle("on", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
  },

  setSleepTimer(minutes) {
    clearTimeout(sleepTimer);
    $("#ctlSleep").classList.toggle("active", minutes > 0);
    if (!minutes) {
      toast("Sleep timer off", { iconName: "moon" });
      return;
    }
    sleepTimer = setTimeout(() => {
      player.pause();
      $("#ctlSleep").classList.remove("active");
      toast("Sleep timer: playback paused", { iconName: "moon" });
    }, minutes * 60000);
    toast(`Playback will pause in ${minutes} min`, { iconName: "moon" });
  },

  refreshSettings() {
    const { repeat, lyricsFontScale } = settings();
    const label = {
      off: "Repeat: off",
      all: "Repeat: queue",
      one: "Repeat: song",
    }[repeat];
    const button = $("#ctlRepeat");
    setIcon(
      button.querySelector("i"),
      repeat === "one" ? "repeat-1" : "repeat",
    );
    button.classList.toggle("active", repeat !== "off");
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    document.documentElement.style.setProperty(
      "--lyrics-scale",
      String(lyricsFontScale),
    );
  },

  /* ----- wiring ----- */
  bindControls() {
    $("#ctlPlay").addEventListener("click", () => this.togglePlay());
    $("#miniPlay").addEventListener("click", () => this.togglePlay());
    $("#ctlNext").addEventListener("click", () => this.next());
    $("#miniNext").addEventListener("click", () => this.next());
    $("#ctlPrev").addEventListener("click", () => this.previous());
    $("#miniPrev").addEventListener("click", () => this.previous());
    $("#miniOpen").addEventListener("click", () => this.openPlayer());
    $("#playerClose").addEventListener("click", () => this.closePlayer());
    $("#playerQueueBtn").addEventListener("click", () =>
      this.toggleQueue(true),
    );
    $("#playerLyricsBtn").addEventListener("click", () => this.toggleLyrics());
    $("#lyricsClose").addEventListener("click", () => this.toggleLyrics());
    $("#playerFullscreen").addEventListener("click", () =>
      this.toggleFullscreen(),
    );
    $("#playerFav").addEventListener(
      "click",
      () => current && deps.onFavoriteToggle?.(current),
    );
    $("#ctlMute").addEventListener("click", () => this.toggleMute());
    $("#drawerClose").addEventListener("click", () => this.toggleQueue(false));
    $("#queueScrim").addEventListener("click", () => this.toggleQueue(false));
    $("#drawerShuffle").addEventListener("click", () => {
      queue.shuffleUpNext();
      toast("Queue shuffled", { iconName: "shuffle" });
    });
    $("#drawerClear").addEventListener("click", () => {
      queue.clear({ keepCurrent: true });
      toast("Queue cleared", { iconName: "trash" });
    });

    $("#ctlShuffle").addEventListener("click", () => {
      queue.shuffleUpNext();
      toast("Up next shuffled", { iconName: "shuffle" });
    });
    $("#ctlRepeat").addEventListener("click", () => {
      const order = ["off", "all", "one"];
      const next = order[(order.indexOf(settings().repeat) + 1) % order.length];
      storage.saveSettings({ repeat: next });
      this.refreshSettings();
      toast(
        {
          off: "Repeat off",
          all: "Repeating queue",
          one: "Repeating this song",
        }[next],
        { iconName: "repeat" },
      );
    });

    const volume = $("#ctlVolume");
    volume.addEventListener("input", () =>
      this.setVolume(Number(volume.value)),
    );
    volume.addEventListener("change", () =>
      storage.saveSettings({ volume: Number(volume.value) }),
    );

    const seek = $("#seekBar");
    const total = () => player.getDuration() || current?.duration || 0;
    seek.addEventListener("input", () => {
      seeking = true;
      setFill(seek);
      $("#timeCurrent").textContent = formatTime((seek.value / 1000) * total());
    });
    seek.addEventListener("change", () => {
      player.seekTo((seek.value / 1000) * total());
      seeking = false;
    });

    $$("[data-delay]").forEach((button) =>
      button.addEventListener("click", () =>
        this.nudgeLyricsDelay(Number(button.dataset.delay)),
      ),
    );
    $("#lyricsTapSync").addEventListener("click", () => this.tapSyncLyrics());
    $("#lyricsDelayReset").addEventListener("click", () =>
      this.setLyricsDelay(0),
    );
    $("#lyricsLarger").addEventListener("click", () => this.scaleLyrics(0.1));
    $("#lyricsSmaller").addEventListener("click", () => this.scaleLyrics(-0.1));
    $("#lyricsScroll").addEventListener("click", (event) => {
      const line = event.target.closest(".lyric.sync");
      if (line && lyrics)
        player.seekTo(lyrics.lines[Number(line.dataset.i)].time);
    });

    const menu = $("#sleepMenu");
    $("#ctlSleep").addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
      menu.hidden = !menu.hidden;
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-sleep]");
      if (!option) return;
      this.setSleepTimer(Number(option.dataset.sleep));
      menu.hidden = true;
    });
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest("#ctlSleep, #sleepMenu"))
        menu.hidden = true;
    });

    const view = $("#playerView");
    view.addEventListener("pointermove", () => {
      view.classList.remove("idle");
      clearTimeout(idleTimer);
      if (document.fullscreenElement)
        idleTimer = setTimeout(() => view.classList.add("idle"), 2800);
    });
  },

  setLyricsDelay(seconds, { silent = true } = {}) {
    if (!current) return;
    lyricsDelay = Math.min(60, Math.max(-15, Math.round(seconds * 10) / 10));
    storage.setLyricsDelay(current.id, lyricsDelay);
    renderLyricsDelay();
    syncLyrics(player.getTime(), true);
    if (!silent)
      toast(`Lyrics delay ${formatDelay(lyricsDelay)}`, { iconName: "text" });
  },

  nudgeLyricsDelay(delta, silent = true) {
    this.setLyricsDelay(lyricsDelay + delta, { silent });
  },

  /** Press the moment the highlighted line is actually sung: aligns that line to "now". */
  tapSyncLyrics() {
    if (!lyrics?.synced) {
      toast("Tap-sync needs time-synced lyrics", { type: "error" });
      return;
    }
    const index =
      lyricsIndex >= 0 ? lyricsIndex : lyrics.lines.findIndex((l) => l.text);
    const line = lyrics.lines[index];
    if (!line) return;
    const REACTION = 0.25; // typical human delay between hearing a line start and pressing
    this.setLyricsDelay(player.getTime() - REACTION - line.time, {
      silent: false,
    });
  },

  scaleLyrics(delta) {
    const next = Math.min(
      1.7,
      Math.max(0.8, +(settings().lyricsFontScale + delta).toFixed(2)),
    );
    storage.saveSettings({ lyricsFontScale: next });
    this.refreshSettings();
  },

  bindStage() {
    const relayout = () => layoutStage();
    window.addEventListener("resize", relayout);
    new ResizeObserver(relayout).observe($("#stageSlot"));
    document.addEventListener("fullscreenchange", () => {
      const active = Boolean(document.fullscreenElement);
      $("#playerView").classList.toggle("is-fullscreen", active);
      if (!active) $("#playerView").classList.remove("idle");
      setIcon($("#playerFullscreen i"), active ? "minimize" : "maximize");
      trackLayout(500);
    });
  },

  bindMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const handlers = {
      play: () => player.play(),
      pause: () => player.pause(),
      nexttrack: () => this.next(),
      previoustrack: () => this.previous(),
    };
    Object.entries(handlers).forEach(([action, fn]) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    });
  },
};
