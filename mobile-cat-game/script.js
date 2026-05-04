(() => {
  'use strict';

  const els = {
    score: document.getElementById('score'),
    combo: document.getElementById('combo'),
    time: document.getElementById('time'),
    bestChip: document.getElementById('bestChip'),
    modeChip: document.getElementById('modeChip'),
    catButton: document.getElementById('catButton'),
    tapText: document.getElementById('tapText'),
    burst: document.getElementById('burst'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    muteBtn: document.getElementById('muteBtn'),
    hapticsBtn: document.getElementById('hapticsBtn'),
    segBtns: Array.from(document.querySelectorAll('.segBtn')),
    toast: document.getElementById('toast')
  };

  const STORAGE_KEYS = {
    best: 'mobile-cat-game.bestScore',
    muted: 'mobile-cat-game.muted',
    haptics: 'mobile-cat-game.haptics',
    round: 'mobile-cat-game.roundSeconds'
  };

  const state = {
    running: false,
    paused: false,
    score: 0,
    combo: 1,
    lastTapAt: 0,
    roundSeconds: 30,
    timeLeftMs: 30000,
    bestScore: 0,
    muted: false,
    haptics: true,
    rafId: 0,
    lastTick: 0,
    audio: null
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function formatTime(ms) {
    const t = Math.max(0, ms) / 1000;
    return t.toFixed(1);
  }

  function loadPrefs() {
    try {
      const best = parseInt(localStorage.getItem(STORAGE_KEYS.best) || '0', 10);
      if (Number.isFinite(best)) state.bestScore = best;

      const muted = localStorage.getItem(STORAGE_KEYS.muted);
      if (muted !== null) state.muted = muted === '1';

      const h = localStorage.getItem(STORAGE_KEYS.haptics);
      if (h !== null) state.haptics = h === '1';

      const r = parseInt(localStorage.getItem(STORAGE_KEYS.round) || '30', 10);
      if (Number.isFinite(r) && [15,30,60].includes(r)) state.roundSeconds = r;
    } catch {
      // ignore
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEYS.best, String(state.bestScore));
      localStorage.setItem(STORAGE_KEYS.muted, state.muted ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.haptics, state.haptics ? '1' : '0');
      localStorage.setItem(STORAGE_KEYS.round, String(state.roundSeconds));
    } catch {
      // ignore
    }
  }

  function showToast(msg, ms = 900) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  function updateUI() {
    els.score.textContent = String(state.score);
    els.combo.textContent = `x${state.combo}`;
    els.time.textContent = formatTime(state.timeLeftMs);
    els.bestChip.textContent = `Best: ${state.bestScore}`;

    els.pauseBtn.disabled = !state.running;
    els.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';

    els.muteBtn.textContent = `Sound: ${state.muted ? 'Off' : 'On'}`;
    els.muteBtn.setAttribute('aria-pressed', state.muted ? 'true' : 'false');

    els.hapticsBtn.textContent = `Haptics: ${state.haptics ? 'On' : 'Off'}`;
    els.hapticsBtn.setAttribute('aria-pressed', state.haptics ? 'true' : 'false');

    for (const b of els.segBtns) {
      const sec = parseInt(b.dataset.seconds, 10);
      b.classList.toggle('isActive', sec === state.roundSeconds);
    }

    if (!state.running) {
      els.modeChip.textContent = 'Ready';
      els.tapText.textContent = 'Tap!';
    } else if (state.paused) {
      els.modeChip.textContent = 'Paused';
      els.tapText.textContent = 'Resume';
    } else {
      els.modeChip.textContent = 'Go!';
      els.tapText.textContent = 'Tap!';
    }
  }

  function ensureAudio() {
    if (state.audio) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    state.audio = {
      ctx: new Ctx(),
      master: null
    };
    const { ctx } = state.audio;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    state.audio.master = master;
  }

  function beep(type = 'tap') {
    if (state.muted) return;
    ensureAudio();
    if (!state.audio) return;

    const { ctx, master } = state.audio;
    if (ctx.state === 'suspended') {
      // resume on gesture; if fails, just skip
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const base = type === 'end' ? 180 : type === 'start' ? 520 : 420;
    const freq = type === 'combo' ? 720 : base;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'end' ? 0.06 : 0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'end' ? 0.18 : 0.10));

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + (type === 'end' ? 0.19 : 0.11));
  }

  function vibrate(pattern) {
    if (!state.haptics) return;
    if (!('vibrate' in navigator)) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  function setRunning(r) {
    state.running = r;
    state.paused = false;
    if (r) {
      state.timeLeftMs = state.roundSeconds * 1000;
      state.score = 0;
      state.combo = 1;
      state.lastTapAt = 0;
      state.lastTick = performance.now();
      cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(tick);
      beep('start');
      vibrate(15);
    } else {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    updateUI();
  }

  function endRound() {
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;

    const isBest = state.score > state.bestScore;
    if (isBest) {
      state.bestScore = state.score;
      savePrefs();
      showToast(`New best: ${state.bestScore}`);
      vibrate([20, 30, 20]);
    } else {
      showToast(`Time! Score: ${state.score}`);
      vibrate(25);
    }
    beep('end');
    updateUI();
  }

  function setPaused(p) {
    if (!state.running) return;
    state.paused = p;
    if (!p) state.lastTick = performance.now();
    updateUI();
  }

  function tick(now) {
    if (!state.running) return;
    const dt = now - state.lastTick;
    state.lastTick = now;

    if (!state.paused) {
      state.timeLeftMs -= dt;

      // If you wait too long between taps, combo falls back.
      if (state.lastTapAt && (now - state.lastTapAt) > 950) {
        state.combo = 1;
      }

      if (state.timeLeftMs <= 0) {
        state.timeLeftMs = 0;
        updateUI();
        endRound();
        return;
      }
      updateUI();
    }

    state.rafId = requestAnimationFrame(tick);
  }

  function burstAt(x, y) {
    const rect = els.catButton.getBoundingClientRect();
    const bx = x - rect.left;
    const by = y - rect.top;

    const colors = ['particle', 'particle g', 'particle p'];
    const count = 9;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = colors[i % colors.length];
      p.classList.add('particle');
      p.style.left = `${bx}px`;
      p.style.top = `${by}px`;
      const ang = (Math.PI * 2) * (i / count) + (Math.random() * 0.25);
      const dist = 44 + Math.random() * 36;
      const dx = bx + Math.cos(ang) * dist;
      const dy = by + Math.sin(ang) * dist;
      p.style.setProperty('--dx', `${dx}px`);
      p.style.setProperty('--dy', `${dy}px`);
      els.burst.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  function onTap(ev) {
    // Allow tapping anytime; if not running, start.
    if (!state.running) {
      setRunning(true);
      return;
    }
    if (state.paused) {
      setPaused(false);
      beep('start');
      vibrate(10);
      return;
    }

    const now = performance.now();
    const dt = state.lastTapAt ? (now - state.lastTapAt) : 0;

    // Combo: fast taps increase multiplier up to x8.
    if (state.lastTapAt && dt < 420) {
      state.combo = clamp(state.combo + 1, 1, 8);
      if (state.combo === 8) {
        // subtle feedback at max
        beep('combo');
        vibrate(8);
      }
    } else if (state.lastTapAt && dt > 900) {
      state.combo = 1;
    }

    state.lastTapAt = now;

    // Score: base + multiplier; small bonus for very fast taps.
    const speedBonus = dt > 0 ? (dt < 220 ? 2 : dt < 320 ? 1 : 0) : 0;
    state.score += (1 * state.combo) + speedBonus;

    // Time bonus: tiny reward to keep it exciting (capped).
    const timeBonus = 35 + state.combo * 6; // ms
    state.timeLeftMs = clamp(state.timeLeftMs + timeBonus, 0, state.roundSeconds * 1000 + 1200);

    // Visual feedback at pointer point
    const point = (ev && 'clientX' in ev) ? { x: ev.clientX, y: ev.clientY } : null;
    if (point) burstAt(point.x, point.y);
    else {
      const r = els.catButton.getBoundingClientRect();
      burstAt(r.left + r.width / 2, r.top + r.height / 2);
    }

    beep('tap');
    vibrate(10);
    updateUI();
  }

  function preventScroll(e) {
    // Avoid scroll/zoom gestures interfering during play.
    if (state.running && !state.paused) e.preventDefault();
  }

  // Wire up events
  els.catButton.addEventListener('pointerdown', (e) => {
    // capture point; prevent ghost clicks
    e.preventDefault();
    els.catButton.setPointerCapture?.(e.pointerId);
    onTap(e);
  });

  els.startBtn.addEventListener('click', () => setRunning(true));
  els.pauseBtn.addEventListener('click', () => {
    if (!state.running) return;
    setPaused(!state.paused);
  });
  els.resetBtn.addEventListener('click', () => {
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    state.score = 0;
    state.combo = 1;
    state.timeLeftMs = state.roundSeconds * 1000;
    state.lastTapAt = 0;
    showToast('Reset');
    updateUI();
  });

  els.muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    savePrefs();
    updateUI();
    showToast(state.muted ? 'Sound off' : 'Sound on');
  });

  els.hapticsBtn.addEventListener('click', () => {
    state.haptics = !state.haptics;
    savePrefs();
    updateUI();
    showToast(state.haptics ? 'Haptics on' : 'Haptics off');
    if (state.haptics) vibrate(12);
  });

  for (const b of els.segBtns) {
    b.addEventListener('click', () => {
      const sec = parseInt(b.dataset.seconds, 10);
      if (![15,30,60].includes(sec)) return;
      state.roundSeconds = sec;
      savePrefs();
      // If not running, reset displayed time; if running, keep current round.
      if (!state.running) state.timeLeftMs = state.roundSeconds * 1000;
      els.startBtn.textContent = `Start (${state.roundSeconds}s)`;
      updateUI();
      showToast(`Round: ${sec}s`);
    });
  }

  // Keyboard accessibility (desktop)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      onTap(null);
    } else if (k === 's') {
      e.preventDefault();
      setRunning(true);
    } else if (k === 'p') {
      e.preventDefault();
      if (state.running) setPaused(!state.paused);
    }
  });

  // Prevent page scroll while interacting
  window.addEventListener('touchmove', preventScroll, { passive: false });

  // Init
  loadPrefs();
  state.timeLeftMs = state.roundSeconds * 1000;
  els.startBtn.textContent = `Start (${state.roundSeconds}s)`;
  updateUI();
})();
