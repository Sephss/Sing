// Microphone studio view: wires the DOM to the microphone engine.
import { mic, EFFECTS, startVisualizer } from "./microphone.js";
import { storage } from "./storage.js";
import { $, esc, setHtml, toast } from "./ui.js";
import { icon } from "./icons.js";

let stopVisualizer = null;
let testing = false;

function renderEffects() {
  const grid = $("#effectGrid");
  setHtml(
    grid,
    EFFECTS.map(
      (effect) => `
    <button class="effect ${effect.id === mic.effectId ? "active" : ""}" role="radio" aria-checked="${effect.id === mic.effectId}" data-effect="${effect.id}">
      <b>${esc(effect.label)}</b><small>${esc(effect.hint)}</small>
    </button>`,
    ).join(""),
  );
}

function formatParam(param, value) {
  const shown = param.step < 1 ? Number(value).toFixed(2) : Math.round(value);
  return `${shown}${param.unit}`;
}

function renderParams() {
  const effect = EFFECTS.find((e) => e.id === mic.effectId);
  const host = $("#effectParams");
  if (!effect.params.length) {
    setHtml(
      host,
      '<p class="hint">Clean sends your voice through with no effect. Pick another effect to tune it.</p>',
    );
    return;
  }
  setHtml(
    host,
    `${effect.params
      .map(
        (param) => `
    <label class="slider">
      <span>${esc(param.label)}</span>
      <input type="range" data-param="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}" value="${mic.params[param.key] ?? param.value}">
      <output>${formatParam(param, mic.params[param.key] ?? param.value)}</output>
    </label>`,
      )
      .join("")}
    <button class="btn btn-ghost btn-sm" id="resetEffect">Reset ${esc(effect.label)}</button>`,
  );
}

function renderStatus(status) {
  const on = status.state === "on";
  $("#micStatus").textContent = status.message;
  $("#micStatus").dataset.state = status.state;
  $("#micStatus").dataset.warn = status.warn ? "1" : "";
  $("#micOrb").classList.toggle("live", on);
  $("#navMicLive").hidden = !on;
  const toggle = $("#micToggle");
  toggle.setAttribute("aria-pressed", String(on));
  toggle.classList.toggle("is-on", on);
  toggle.disabled =
    status.state === "requesting" || status.state === "unsupported";
  toggle.innerHTML = `${icon("mic")}<span>${on ? "Turn microphone off" : "Turn microphone on"}</span>`;
  $("#micTest").disabled = testing || status.state === "unsupported";
}

async function renderDevices() {
  const select = $("#micDevice");
  let devices = [];
  try {
    devices = await mic.listDevices();
  } catch {
    /* ignore */
  }
  const saved = storage.getMicPrefs().deviceId;
  const options = ['<option value="">System default</option>'].concat(
    devices
      .filter((d) => d.deviceId && d.deviceId !== "default")
      .map(
        (d, i) =>
          `<option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>`,
      ),
  );
  select.innerHTML = options.join("");
  select.value = devices.some((d) => d.deviceId === saved) ? saved : "";
}

function bindSlider(id, outputId, onInput, suffix = "%") {
  const input = $(id);
  const output = $(outputId);
  const sync = () => {
    output.textContent = `${input.value}${suffix}`;
  };
  input.addEventListener("input", () => {
    sync();
    onInput(Number(input.value));
  });
  sync();
}

export function initMicUI({ getMusicVolume, setMusicVolume }) {
  const prefs = storage.getMicPrefs();
  $("#micInput").value = prefs.inputGain;
  $("#micOutput").value = prefs.outputGain;
  $("#musicVolume").value = getMusicVolume();
  const echo = $("#micEcho");
  echo.checked = prefs.echoCancellation === true;
  echo.addEventListener("change", () => mic.setEchoCancellation(echo.checked));

  renderEffects();
  renderParams();
  renderStatus(mic.status);
  renderDevices();
  mic.onStatus((status) => {
    renderStatus(status);
    if (status.state === "on") renderDevices();
  });

  $("#micToggle").addEventListener("click", async () => {
    if (mic.active) mic.stop();
    else await mic.start();
  });

  $("#effectGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-effect]");
    if (!button) return;
    mic.setEffect(button.dataset.effect);
    renderEffects();
    renderParams();
  });

  $("#effectParams").addEventListener("input", (event) => {
    const input = event.target.closest("[data-param]");
    if (!input) return;
    const effect = EFFECTS.find((e) => e.id === mic.effectId);
    const param = effect.params.find((p) => p.key === input.dataset.param);
    const value = Number(input.value);
    mic.setParam(param.key, value);
    input.nextElementSibling.textContent = formatParam(param, value);
  });

  $("#effectParams").addEventListener("click", (event) => {
    if (!event.target.closest("#resetEffect")) return;
    mic.resetParams();
    renderParams();
  });

  bindSlider("#micInput", "#micInputOut", (v) => mic.setInputGain(v));
  bindSlider("#micOutput", "#micOutputOut", (v) => mic.setOutputGain(v));
  bindSlider("#musicVolume", "#musicVolumeOut", (v) => setMusicVolume(v));

  $("#micDevice").addEventListener("change", (event) =>
    mic.setDevice(event.target.value),
  );

  $("#micTest").addEventListener("click", async () => {
    testing = true;
    const button = $("#micTest");
    button.disabled = true;
    button.innerHTML = `${icon("activity")}Listening… speak now`;
    const ok = await mic.test(3000);
    testing = false;
    button.innerHTML = `${icon("activity")}Test microphone (3s loopback)`;
    button.disabled = false;
    if (ok) toast("Test finished", { iconName: "mic" });
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", renderDevices);
}

/** Called when the Microphone view becomes visible/hidden so the canvas only animates when seen. */
export function setMicViewActive(active) {
  stopVisualizer?.();
  stopVisualizer = null;
  if (!active) return;
  stopVisualizer = startVisualizer($("#micCanvas"), {
    getAnalyser: () => mic.analyser,
    isIdle: () => !mic.active,
  });
}

export function syncMusicVolume(value) {
  const slider = $("#musicVolume");
  if (!slider) return;
  slider.value = value;
  $("#musicVolumeOut").textContent = `${Math.round(value)}%`;
}
