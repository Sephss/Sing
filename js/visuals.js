// Hero background: layered glowing waveforms + drifting particles. Pauses when hidden / reduced motion.
export function startHeroVisual(canvas) {
  const g = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let t = 0;
  let width = 0;
  let height = 0;
  let particles = [];

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round(Math.min(46, width / 24));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.6 + 0.4,
      speed: Math.random() * 0.25 + 0.05,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function colors() {
    const style = getComputedStyle(canvas);
    return {
      a: style.getPropertyValue('--accent').trim() || '#ff2d78',
      b: style.getPropertyValue('--accent-2').trim() || '#7c5cff'
    };
  }

  function wave(color, amplitude, frequency, speed, yBase, alpha) {
    g.beginPath();
    for (let x = 0; x <= width; x += 6) {
      const envelope = Math.sin((x / width) * Math.PI);
      const y = yBase
        + Math.sin(x * frequency + t * speed) * amplitude * envelope
        + Math.sin(x * frequency * 2.1 - t * speed * 0.7) * amplitude * 0.35 * envelope;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = color;
    g.globalAlpha = alpha;
    g.lineWidth = 2;
    g.shadowColor = color;
    g.shadowBlur = 16;
    g.stroke();
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!width || !height) { resize(); return; }
    t += 0.016;
    const { a, b } = colors();
    g.clearRect(0, 0, width, height);

    wave(b, height * 0.09, 0.011, 1.1, height * 0.86, 0.45);
    wave(a, height * 0.09, 0.008, 1.6, height * 0.9, 0.7);
    wave(a, height * 0.05, 0.016, 2.2, height * 0.93, 0.3);

    g.fillStyle = a;
    particles.forEach((p) => {
      p.y -= p.speed;
      if (p.y < -4) { p.y = height + 4; p.x = Math.random() * width; }
      g.globalAlpha = 0.25 + 0.35 * Math.sin(t * 1.4 + p.phase) ** 2;
      g.beginPath();
      g.arc(p.x + Math.sin(t + p.phase) * 8, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
  }

  function drawStatic() {
    resize();
    const { a, b } = colors();
    g.clearRect(0, 0, width, height);
    wave(b, height * 0.07, 0.011, 0, height * 0.86, 0.45);
    wave(a, height * 0.09, 0.008, 0, height * 0.9, 0.7);
  }

  const observer = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting && !reduced) frame();
  });
  const onResize = () => { resize(); if (reduced) drawStatic(); };

  window.addEventListener('resize', onResize);
  observer.observe(canvas);
  if (reduced) drawStatic();

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('resize', onResize);
  };
}
