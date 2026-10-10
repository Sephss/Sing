// Microphone engine: getUserMedia → gain → hi-pass → effect → compressor → output → speakers.
import { EFFECTS, getEffect, defaultParams } from "./effects.js";
import { storage } from "./storage.js";

const listeners = new Set();
let ctx = null;
let stream = null;
let nodes = null;
let activeEffect = null;
let effectId = "clean";
let params = {};
let monitoring = true;
let status = {
  state: "idle",
  message: "Allow microphone access to use Karaoke Microphone.",
  warn: false,
};
let bluetoothInput = false;
let skippedBluetooth = ""; // label of a Bluetooth mic we deliberately avoided
// Bluetooth headsets drop to low-quality "hands-free" (phone call) audio the moment their mic is used.
const BLUETOOTH_LABEL = /bluetooth|airpods|buds|hands-?free|\bhfp\b|\bBT\b/i;

async function openStream(deviceId, echoCancellation) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Voice-call processing (echo cancellation) ducks and band-limits everything, so it's off by default.
      echoCancellation: echoCancellation === true,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

async function listInputs() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput");
}

/** First real (non-Bluetooth) microphone, e.g. the laptop's built-in mic. Needs labels, i.e. prior permission. */
async function builtInInputId() {
  const inputs = await listInputs();
  const real = inputs.filter(
    (d) =>
      d.label && d.deviceId !== "default" && d.deviceId !== "communications",
  );
  return real.find((d) => !BLUETOOTH_LABEL.test(d.label))?.deviceId || "";
}

/** If the system default input is a Bluetooth headset, return another mic's id so the headset stays in music mode. */
async function avoidBluetoothDefault() {
  const inputs = await listInputs();
  const fallback = inputs.find((d) => d.deviceId === "default") || inputs[0];
  if (!fallback || !BLUETOOTH_LABEL.test(fallback.label || "")) return "";
  return builtInInputId();
}

function readyStatus() {
  if (skippedBluetooth) {
    return [
      "on",
      `Microphone on. Your Bluetooth headset’s mic (${skippedBluetooth}) was skipped so music keeps full quality.`,
      false,
    ];
  }
  if (bluetoothInput) {
    return [
      "on",
      "Bluetooth mic detected. Bluetooth headphones switch to phone-call quality while their mic is in use. Choose your computer’s built-in mic under Input device and keep Bluetooth for listening only.",
      true,
    ];
  }
  return [
    "on",
    monitoring
      ? "Microphone on — you should hear yourself. Headphones recommended."
      : "Microphone on — monitoring is off.",
    false,
  ];
}

function setStatus(state, message, warn = false) {
  status = { state, message, warn };
  listeners.forEach((fn) => fn(status));
}

function describeError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access was blocked. Allow it in your browser’s site settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was detected. Plug one in and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your microphone is unavailable — another app may be using it.";
    case "OverconstrainedError":
      return "The selected microphone isn’t available. Choose another input device.";
    case "SecurityError":
      return "Microphone access needs a secure (HTTPS) connection.";
    default:
      return "Something went wrong starting the microphone.";
  }
}

function paramsFor(effect) {
  const prefs = storage.getMicPrefs().effectParams[effect.id] || {};
  const intensity = storage.getSettings().micIntensity;
  return { ...defaultParams(effect, intensity), ...prefs };
}

function connectEffect(effect) {
  if (!nodes) return;
  const built = effect.build(ctx, params);
  nodes.pre.disconnect();
  nodes.pre.connect(built.input);
  built.output.connect(nodes.compressor);
  const previous = activeEffect;
  activeEffect = built;
  if (previous) {
    setTimeout(() => {
      try {
        previous.output.disconnect();
      } catch {
        /* already disconnected */
      }
      previous.dispose();
    }, 80);
  }
}

function buildGraph() {
  const prefs = storage.getMicPrefs();
  ctx = new (window.AudioContext || window.webkitAudioContext)({
    latencyHint: "interactive",
  });
  const source = ctx.createMediaStreamSource(stream);
  const inputGain = ctx.createGain();
  inputGain.gain.value = prefs.inputGain / 100;
  const pre = ctx.createBiquadFilter(); // rumble filter
  pre.type = "highpass";
  pre.frequency.value = 80;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 24;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;
  const outputGain = ctx.createGain();
  outputGain.gain.value = prefs.outputGain / 100;
  const monitorGain = ctx.createGain();
  monitorGain.gain.value = monitoring ? 1 : 0;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;

  source.connect(inputGain).connect(pre);
  compressor.connect(outputGain).connect(monitorGain).connect(ctx.destination);
  compressor.connect(analyser); // visualizer taps before monitor so it works with monitoring off

  nodes = {
    source,
    inputGain,
    pre,
    compressor,
    outputGain,
    monitorGain,
    analyser,
  };
  connectEffect(getEffect(effectId));
}

export const mic = {
  get supported() {
    return Boolean(
      navigator.mediaDevices?.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext),
    );
  },
  get active() {
    return Boolean(stream);
  },
  get status() {
    return status;
  },
  get analyser() {
    return nodes?.analyser || null;
  },
  get effectId() {
    return effectId;
  },
  get params() {
    return params;
  },
  get monitoring() {
    return monitoring;
  },

  onStatus(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  init() {
    const settings = storage.getSettings();
    monitoring = settings.micMonitor;
    effectId = getEffect(settings.micEffect).id;
    params = paramsFor(getEffect(effectId));
    if (!this.supported)
      setStatus(
        "unsupported",
        "This browser doesn’t support the microphone features needed here. Try a recent Chrome, Edge, Firefox or Safari.",
      );
  },

  async start() {
    if (!this.supported) {
      setStatus(
        "unsupported",
        "This browser doesn’t support the microphone features needed here. Try a recent Chrome, Edge, Firefox or Safari.",
      );
      return false;
    }
    if (stream) return true;
    setStatus("requesting", "Waiting for microphone permission…");
    try {
      const { deviceId: saved, echoCancellation } = storage.getMicPrefs();
      skippedBluetooth = "";
      let deviceId = saved;
      if (!saved) {
        try {
          deviceId = await avoidBluetoothDefault();
        } catch {
          deviceId = "";
        }
      }
      stream = await openStream(deviceId, echoCancellation);

      // First run: labels were hidden until permission was granted, so re-check now and switch away from Bluetooth.
      let label = stream.getAudioTracks()[0]?.label || "";
      if (!saved && BLUETOOTH_LABEL.test(label)) {
        const alternative = await builtInInputId().catch(() => "");
        if (alternative) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await openStream(alternative, echoCancellation);
          skippedBluetooth = label;
          label = stream.getAudioTracks()[0]?.label || "";
        }
      }
      buildGraph();
      if (ctx.state === "suspended") await ctx.resume();
      stream.getAudioTracks()[0]?.addEventListener("ended", () => this.stop());
      bluetoothInput = BLUETOOTH_LABEL.test(
        stream.getAudioTracks()[0]?.label || "",
      );
      setStatus(...readyStatus());
      return true;
    } catch (error) {
      this.stop(false);
      setStatus("error", describeError(error));
      return false;
    }
  },

  stop(announce = true) {
    bluetoothInput = false;
    skippedBluetooth = "";
    try {
      nodes?.source.disconnect();
    } catch {
      /* already disconnected */
    }
    stream?.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    stream = null;
    activeEffect?.dispose();
    activeEffect = null;
    nodes = null;
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    if (announce)
      setStatus("idle", "Microphone off. Turn it on to sing with effects.");
  },

  async listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  },

  async setDevice(deviceId) {
    storage.saveMicPrefs({ deviceId });
    if (!stream) return;
    this.stop(false);
    await this.start();
  },

  async setEchoCancellation(on) {
    storage.saveMicPrefs({ echoCancellation: on });
    if (!stream) return;
    this.stop(false);
    await this.start();
  },

  setEffect(id) {
    const effect = getEffect(id);
    effectId = effect.id;
    params = paramsFor(effect);
    connectEffect(effect);
    return params;
  },

  setParam(key, value) {
    params = { ...params, [key]: value };
    activeEffect?.update(params);
    const all = storage.getMicPrefs().effectParams;
    storage.saveMicPrefs({ effectParams: { ...all, [effectId]: params } });
  },

  resetParams() {
    const effect = getEffect(effectId);
    const all = { ...storage.getMicPrefs().effectParams };
    delete all[effectId];
    storage.saveMicPrefs({ effectParams: all });
    params = paramsFor(effect);
    activeEffect?.update(params);
    return params;
  },

  setInputGain(percent) {
    storage.saveMicPrefs({ inputGain: percent });
    nodes?.inputGain.gain.setTargetAtTime(percent / 100, ctx.currentTime, 0.02);
  },

  setOutputGain(percent) {
    storage.saveMicPrefs({ outputGain: percent });
    nodes?.outputGain.gain.setTargetAtTime(
      percent / 100,
      ctx.currentTime,
      0.02,
    );
  },

  setMonitoring(on) {
    monitoring = on;
    storage.saveSettings({ micMonitor: on });
    nodes?.monitorGain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02);
    if (stream) setStatus(...readyStatus());
  },

  /** 3-second loopback so people can hear their effect; restores previous state afterwards. */
  async test(durationMs = 3000) {
    const wasActive = this.active;
    const wasMonitoring = monitoring;
    if (!(await this.start())) return false;
    nodes?.monitorGain.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (!wasActive) this.stop();
    else
      nodes?.monitorGain.gain.setTargetAtTime(
        wasMonitoring ? 1 : 0,
        ctx.currentTime,
        0.02,
      );
    return true;
  },
};

export { EFFECTS };

/** Draws mirrored frequency bars + a waveform. Returns a stop() function. */
export function startVisualizer(canvas, { getAnalyser, isIdle }) {
  const g = canvas.getContext("2d");
  let raf = 0;
  let frame = 0;
  let freq = null;
  let wave = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return false;
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    return true;
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!resize()) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--accent").trim() || "#ff2d78";
    const accent2 = style.getPropertyValue("--accent-2").trim() || "#7c5cff";
    g.clearRect(0, 0, w, h);
    frame += 1;

    const analyser = getAnalyser();
    const bars = 48;
    const gap = 4;
    const barWidth = (w - gap * (bars - 1)) / bars;
    const gradient = g.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(1, accent2);

    if (analyser) {
      freq =
        freq?.length === analyser.frequencyBinCount
          ? freq
          : new Uint8Array(analyser.frequencyBinCount);
      wave =
        wave?.length === analyser.fftSize
          ? wave
          : new Uint8Array(analyser.fftSize);
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
    }

    g.fillStyle = gradient;
    for (let i = 0; i < bars; i += 1) {
      let level;
      if (analyser && !isIdle()) {
        const bin = Math.floor(Math.pow(i / bars, 1.6) * (freq.length * 0.7));
        level = freq[bin] / 255;
      } else {
        level = reduced ? 0.06 : 0.07 + 0.05 * Math.sin(frame / 28 + i * 0.5);
      }
      const barHeight = Math.max(3, level * h * 0.9);
      const x = i * (barWidth + gap);
      g.globalAlpha = 0.35 + level * 0.65;
      g.beginPath();
      g.roundRect(x, (h - barHeight) / 2, barWidth, barHeight, barWidth / 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (analyser && !isIdle() && wave) {
      g.lineWidth = 2;
      g.strokeStyle = accent;
      g.shadowColor = accent;
      g.shadowBlur = 12;
      g.beginPath();
      const step = w / wave.length;
      for (let i = 0; i < wave.length; i += 1) {
        const y = (wave[i] / 255) * h;
        if (i === 0) g.moveTo(0, y);
        else g.lineTo(i * step, y);
      }
      g.stroke();
      g.shadowBlur = 0;
    }
  }

  draw();
  return () => cancelAnimationFrame(raf);
}
