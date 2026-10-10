// Web Audio voice effect builders. Each builder returns { input, output, update(params), dispose() }.
// Params use native units except `amount`, which is always 0–100 (percent).

function wetDryMixer(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  return {
    input, output, wet,
    /** crossfade: dry fades out as wet fades in. additive: dry stays, wet is layered on top. */
    setMix(amount, { additive = false, wetScale = 1 } = {}) {
      const a = amount / 100;
      const t = ctx.currentTime;
      dry.gain.setTargetAtTime(additive ? 1 : 1 - a, t, 0.02);
      wet.gain.setTargetAtTime(a * wetScale, t, 0.02);
    }
  };
}

function distortionCurve(drive) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + drive) * x) / (1 + drive * Math.abs(x));
  }
  return curve;
}

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function filter(ctx, type, frequency, q = 0.707, gain = 0) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.gain.value = gain;
  return node;
}

function passthrough(ctx) {
  const node = ctx.createGain();
  return { input: node, output: node, update() {}, dispose() {} };
}

function buildEcho(ctx, p) {
  const mix = wetDryMixer(ctx);
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  const tone = filter(ctx, 'lowpass', 3600);
  mix.input.connect(delay);
  delay.connect(tone);
  tone.connect(feedback).connect(delay);
  tone.connect(mix.wet);
  const update = (v) => {
    delay.delayTime.setTargetAtTime(v.delay, ctx.currentTime, 0.05);
    feedback.gain.setTargetAtTime(v.feedback / 100, ctx.currentTime, 0.02);
    mix.setMix(v.amount, { additive: true, wetScale: 0.9 });
  };
  update(p);
  return { input: mix.input, output: mix.output, update, dispose() {} };
}

function buildReverb(ctx, p, { maxSize, decay, damping }) {
  const mix = wetDryMixer(ctx);
  const convolver = ctx.createConvolver();
  const damp = filter(ctx, 'lowpass', damping);
  mix.input.connect(convolver);
  convolver.connect(damp).connect(mix.wet);
  let currentSize = 0;
  let rebuildTimer = null;
  const update = (v) => {
    mix.setMix(v.amount, { additive: true, wetScale: 1.1 });
    if (Math.abs(v.size - currentSize) > 0.05) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        currentSize = Math.min(v.size, maxSize);
        convolver.buffer = makeImpulse(ctx, currentSize, decay);
      }, currentSize ? 120 : 0);
    }
  };
  update(p);
  return { input: mix.input, output: mix.output, update, dispose() { clearTimeout(rebuildTimer); } };
}

function buildRadio(ctx, p) {
  const mix = wetDryMixer(ctx);
  const band = filter(ctx, 'bandpass', 1800, 0.9);
  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(6);
  const makeup = ctx.createGain();
  makeup.gain.value = 1.8;
  mix.input.connect(band);
  band.connect(shaper).connect(makeup).connect(mix.wet);
  const update = (v) => {
    band.frequency.setTargetAtTime(v.tone, ctx.currentTime, 0.03);
    mix.setMix(v.amount);
  };
  update(p);
  return { input: mix.input, output: mix.output, update, dispose() {} };
}

function buildTelephone(ctx, p) {
  const mix = wetDryMixer(ctx);
  const high = filter(ctx, 'highpass', 400, 0.8);
  const low = filter(ctx, 'lowpass', 3400, 0.8);
  const peak = filter(ctx, 'peaking', 1500, 1.2, 6);
  mix.input.connect(high);
  high.connect(low).connect(peak).connect(mix.wet);
  const update = (v) => mix.setMix(v.amount);
  update(p);
  return { input: mix.input, output: mix.output, update, dispose() {} };
}

function buildMegaphone(ctx, p) {
  const mix = wetDryMixer(ctx);
  const high = filter(ctx, 'highpass', 500, 0.7);
  const band = filter(ctx, 'bandpass', 1400, 0.6);
  const shaper = ctx.createWaveShaper();
  const level = ctx.createGain();
  mix.input.connect(high);
  high.connect(band).connect(shaper).connect(level).connect(mix.wet);
  const update = (v) => {
    shaper.curve = distortionCurve(v.drive);
    level.gain.setTargetAtTime(1.6 / (1 + v.drive / 60), ctx.currentTime, 0.02);
    mix.setMix(v.amount);
  };
  update(p);
  return { input: mix.input, output: mix.output, update, dispose() {} };
}

function buildRobot(ctx, p) {
  const mix = wetDryMixer(ctx);
  const ring = ctx.createGain();
  ring.gain.value = 0; // carrier drives gain around 0 → ring modulation
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.connect(ring.gain);
  carrier.start();
  const comb = ctx.createDelay(0.05);
  comb.delayTime.value = 0.012;
  const combFeedback = ctx.createGain();
  combFeedback.gain.value = 0.45;
  const sum = ctx.createGain();
  mix.input.connect(ring);
  ring.connect(sum);
  ring.connect(comb);
  comb.connect(combFeedback).connect(comb);
  comb.connect(sum);
  sum.connect(mix.wet);
  const update = (v) => {
    carrier.frequency.setTargetAtTime(v.pitch, ctx.currentTime, 0.03);
    mix.setMix(v.amount);
  };
  update(p);
  return {
    input: mix.input, output: mix.output, update,
    dispose() { try { carrier.stop(); } catch { /* already stopped */ } }
  };
}

/** Two crossfaded delay taps whose delay time ramps upward = real-time pitch shift down. */
function buildDeepVoice(ctx, p) {
  const mix = wetDryMixer(ctx);
  const windowSeconds = 0.1;
  const length = Math.floor(ctx.sampleRate * windowSeconds);

  const rampBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const windowBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const ramp = rampBuffer.getChannelData(0);
  const win = windowBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    ramp[i] = i / length;
    win[i] = Math.sin((Math.PI * i) / length) ** 2;
  }

  const sources = [];
  const rampScales = [];
  const tapOutput = ctx.createGain();

  [0, windowSeconds / 2].forEach((offset) => {
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.005;
    const fade = ctx.createGain();
    fade.gain.value = 0;

    const rampSource = ctx.createBufferSource();
    rampSource.buffer = rampBuffer;
    rampSource.loop = true;
    const rampScale = ctx.createGain();
    rampSource.connect(rampScale).connect(delay.delayTime);

    const fadeSource = ctx.createBufferSource();
    fadeSource.buffer = windowBuffer;
    fadeSource.loop = true;
    fadeSource.connect(fade.gain);

    mix.input.connect(delay);
    delay.connect(fade).connect(tapOutput);

    rampSource.start(0, offset);
    fadeSource.start(0, offset);
    sources.push(rampSource, fadeSource);
    rampScales.push(rampScale);
  });

  const body = filter(ctx, 'lowshelf', 220, 0.7, 5);
  tapOutput.connect(body).connect(mix.wet);

  const update = (v) => {
    const ratio = 2 ** (-v.semitones / 12);
    const slope = 1 - ratio; // seconds of added delay per second
    rampScales.forEach((node) => node.gain.setTargetAtTime(slope * windowSeconds, ctx.currentTime, 0.05));
    mix.setMix(v.amount);
  };
  update(p);
  return {
    input: mix.input, output: mix.output, update,
    dispose() { sources.forEach((s) => { try { s.stop(); } catch { /* ignore */ } }); }
  };
}

function buildBoost(ctx, p) {
  const low = filter(ctx, 'lowshelf', 120, 0.7);
  const presence = filter(ctx, 'peaking', 3500, 1, 0);
  const air = filter(ctx, 'highshelf', 9000, 0.7);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const makeup = ctx.createGain();
  low.connect(presence).connect(air).connect(comp).connect(makeup);
  const update = (v) => {
    const a = v.amount / 100;
    const t = ctx.currentTime;
    low.gain.setTargetAtTime(-4 * a, t, 0.03);
    presence.gain.setTargetAtTime(7 * a, t, 0.03);
    air.gain.setTargetAtTime(4 * a, t, 0.03);
    makeup.gain.setTargetAtTime(1 + 0.8 * a, t, 0.03);
  };
  update(p);
  return { input: low, output: makeup, update, dispose() {} };
}

const amount = (value = 50) => ({ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, value, unit: '%' });

export const EFFECTS = [
  { id: 'clean', label: 'Clean', hint: 'Your voice, unprocessed', params: [], build: (ctx) => passthrough(ctx) },
  {
    id: 'echo', label: 'Echo', hint: 'Repeating delay',
    params: [amount(40), { key: 'delay', label: 'Delay', min: 0.08, max: 0.9, step: 0.01, value: 0.32, unit: 's' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 85, step: 1, value: 35, unit: '%' }],
    build: buildEcho
  },
  {
    id: 'reverb', label: 'Reverb', hint: 'Studio room',
    params: [amount(40), { key: 'size', label: 'Room size', min: 0.4, max: 3, step: 0.1, value: 1.6, unit: 's' }],
    build: (ctx, p) => buildReverb(ctx, p, { maxSize: 3, decay: 2.6, damping: 6500 })
  },
  {
    id: 'hall', label: 'Hall', hint: 'Large concert hall',
    params: [amount(45), { key: 'size', label: 'Hall length', min: 2, max: 6, step: 0.1, value: 4, unit: 's' }],
    build: (ctx, p) => buildReverb(ctx, p, { maxSize: 6, decay: 3.2, damping: 4200 })
  },
  {
    id: 'radio', label: 'Radio', hint: 'Band-limited broadcast',
    params: [amount(100), { key: 'tone', label: 'Tone', min: 800, max: 3200, step: 50, value: 1800, unit: 'Hz' }],
    build: buildRadio
  },
  {
    id: 'robot', label: 'Robot', hint: 'Ring-modulated voice',
    params: [amount(100), { key: 'pitch', label: 'Robot pitch', min: 30, max: 240, step: 1, value: 70, unit: 'Hz' }],
    build: buildRobot
  },
  {
    id: 'megaphone', label: 'Megaphone', hint: 'Distorted bullhorn',
    params: [amount(100), { key: 'drive', label: 'Drive', min: 5, max: 120, step: 1, value: 45, unit: '' }],
    build: buildMegaphone
  },
  {
    id: 'deep', label: 'Deep Voice', hint: 'Pitch shifted down',
    params: [amount(100), { key: 'semitones', label: 'Depth', min: 1, max: 12, step: 1, value: 5, unit: ' st' }],
    build: buildDeepVoice
  },
  {
    id: 'telephone', label: 'Telephone', hint: 'Narrow-band call',
    params: [amount(100)],
    build: buildTelephone
  },
  {
    id: 'boost', label: 'Vocal Boost', hint: 'EQ + compression',
    params: [amount(70)],
    build: buildBoost
  }
];

export function getEffect(id) {
  return EFFECTS.find((e) => e.id === id) || EFFECTS[0];
}

// Layered effects start at the user's default intensity; character effects (radio, robot…) start fully wet.
const INTENSITY_EFFECTS = new Set(['echo', 'reverb', 'hall', 'boost']);

export function defaultParams(effect, intensity) {
  const values = {};
  effect.params.forEach((param) => {
    const useIntensity = param.key === 'amount' && INTENSITY_EFFECTS.has(effect.id) && intensity !== undefined;
    values[param.key] = useIntensity ? intensity : param.value;
  });
  return values;
}
