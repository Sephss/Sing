// Thin wrapper around the official YouTube IFrame Player API.
// Video/audio stays inside YouTube's player (no downloading, no CORS tricks).
const API_SRC = "https://www.youtube.com/iframe_api";
const POLL_MS = 100;

let apiPromise = null;
function loadIframeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Could not load the YouTube player."));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export const PlayerState = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

// Error codes 2, 5, 100, 101, 150 all mean "this video can't be played here".
const UNPLAYABLE = new Set([2, 5, 100, 101, 150]);

export function createPlayer({
  elementId,
  volume = 80,
  onState,
  onTime,
  onEnded,
  onUnplayable,
  onFailure,
}) {
  let yt = null;
  let ready = false;
  let pending = null;
  let pollTimer = null;
  let lastState = -1;

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!ready || !yt) return;
      onTime?.(yt.getCurrentTime() || 0, yt.getDuration() || 0);
    }, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function init() {
    try {
      const YT = await loadIframeApi();
      yt = new YT.Player(elementId, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          fs: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            ready = true;
            yt.setVolume(volume);
            if (pending) {
              const { id, autoplay } = pending;
              pending = null;
              load(id, autoplay);
            }
          },
          onStateChange: (event) => {
            lastState = event.data;
            onState?.(event.data);
            if (event.data === PlayerState.PLAYING) startPolling();
            else if (event.data === PlayerState.ENDED) {
              stopPolling();
              onEnded?.();
            } else if (event.data !== PlayerState.BUFFERING) stopPolling();
          },
          onError: (event) => {
            stopPolling();
            if (UNPLAYABLE.has(event.data)) onUnplayable?.(event.data);
            else onFailure?.(event.data);
          },
        },
      });
    } catch (error) {
      onFailure?.(error);
    }
  }

  function load(videoId, autoplay = true) {
    if (!ready) {
      pending = { id: videoId, autoplay };
      return;
    }
    if (autoplay) yt.loadVideoById(videoId);
    else yt.cueVideoById(videoId);
  }

  init();

  return {
    load,
    play() {
      if (ready) yt.playVideo();
    },
    pause() {
      if (ready) yt.pauseVideo();
    },
    toggle() {
      if (!ready) return;
      if (lastState === PlayerState.PLAYING) yt.pauseVideo();
      else yt.playVideo();
    },
    stop() {
      if (ready) yt.stopVideo();
    },
    seekTo(seconds) {
      if (ready) yt.seekTo(seconds, true);
    },
    seekBy(delta) {
      if (ready)
        yt.seekTo(Math.max(0, (yt.getCurrentTime() || 0) + delta), true);
    },
    setVolume(value) {
      volume = value;
      if (ready) yt.setVolume(value);
    },
    getVolume() {
      return ready ? yt.getVolume() : volume;
    },
    mute() {
      if (ready) yt.mute();
    },
    unmute() {
      if (ready) yt.unMute();
    },
    isMuted() {
      return ready ? yt.isMuted() : false;
    },
    get isPlaying() {
      return lastState === PlayerState.PLAYING;
    },
    getTime() {
      return ready ? yt.getCurrentTime() || 0 : 0;
    },
    getDuration() {
      return ready ? yt.getDuration() || 0 : 0;
    },
    destroy() {
      stopPolling();
      yt?.destroy?.();
      yt = null;
      ready = false;
    },
  };
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
