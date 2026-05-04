(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const canvas = $("#game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = $("#score");
  const bestEl = $("#best");
  const speedEl = $("#speed");

  const overlay = $("#overlay");
  const overlayTitle = $("#overlayTitle");
  const overlayBody = $("#overlayBody");
  const startBtn = $("#startBtn");
  const restartBtn = $("#restartBtn");
  const pauseBtn = $("#pauseBtn");
  const muteBtn = $("#muteBtn");
  const howBtn = $("#howBtn");
  const howPanel = $("#howPanel");

  const leftBtn = $("#leftBtn");
  const rightBtn = $("#rightBtn");
  const boostBtn = $("#boostBtn");

  const reduceMotionBtn = $("#reduceMotionBtn");
  const clearBestBtn = $("#clearBestBtn");

  const STORAGE_BEST = "app-0004-bunnyf1-best";
  const STORAGE_RM = "app-0004-bunnyf1-reduce-motion";
  const STORAGE_MUTE = "app-0004-bunnyf1-mute";

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function loadNumber(key, fallback = 0) {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  }

  function loadBool(key, fallback = false) {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  }

  function setBool(key, val) {
    localStorage.setItem(key, val ? "1" : "0");
  }

  function setOverlay(visible) {
    overlay.classList.toggle("is-visible", visible);
    overlay.style.display = visible ? "flex" : "none";
  }

  function formatSpeed(mult) {
    return `${mult.toFixed(1)}×`;
  }

  // --- Responsive sizing (keeps internal resolution stable-ish) ---
  function resizeCanvas() {
    // Keep a phone-friendly aspect, but adapt to container width.
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssW = Math.max(260, Math.floor(rect.width));
    const cssH = Math.floor(cssW * 1.5); // portrait-ish track

    // Apply CSS height via attribute? We'll use canvas internal sizes to match.
    canvas.style.height = `${cssH}px`;

    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // --- Simple audio (WebAudio), optional ---
  let audioCtx = null;
  let muted = loadBool(STORAGE_MUTE, false);

  function ensureAudio() {
    if (muted) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function beep(type = "square", freq = 440, dur = 0.06, gain = 0.03) {
    const ac = ensureAudio();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }

  // --- Game state ---
  const state = {
    running: false,
    paused: false,
    crashed: false,
    reduceMotion: loadBool(STORAGE_RM, false),
    time: 0,
    score: 0,
    best: loadNumber(STORAGE_BEST, 0),
    lanes: 3,
    lane: 1,          // 0..2
    laneX: 0,         // smoothed
    targetLane: 1,
    baseSpeed: 240,   // px/s at 1.0x (scaled by canvas size)
    speedMul: 1.0,
    boost: 0,         // 0..1
    boostCooldown: 0, // seconds
    spawnTimer: 0,
    objects: [],
    particles: [],
    shake: 0,
    lastTs: 0
  };

  bestEl.textContent = String(state.best);

  function resetGame(keepOverlay = false) {
    state.running = false;
    state.paused = false;
    state.crashed = false;
    state.time = 0;
    state.score = 0;
    state.speedMul = 1.0;
    state.lane = 1;
    state.targetLane = 1;
    state.laneX = 1;
    state.boost = 0;
    state.boostCooldown = 0;
    state.spawnTimer = 0;
    state.objects.length = 0;
    state.particles.length = 0;
    state.shake = 0;
    state.lastTs = 0;

    scoreEl.textContent = "0";
    speedEl.textContent = formatSpeed(state.speedMul);
    pauseBtn.textContent = "Pause";
    pauseBtn.setAttribute("aria-pressed", "false");

    if (!keepOverlay) {
      overlayTitle.textContent = "Bunny F1 Dash";
      overlayBody.innerHTML = 'Tap <strong>Start</strong> and steer with the big arrows. Grab 🥕 for points, avoid 🛑 cones.';
      startBtn.textContent = "Start";
      setOverlay(true);
    }
    boostBtn.classList.remove("is-armed");
  }

  function startGame() {
    ensureAudio();
    state.running = true;
    state.paused = false;
    state.crashed = false;
    pauseBtn.textContent = "Pause";
    pauseBtn.setAttribute("aria-pressed", "false");
    setOverlay(false);
    state.lastTs = performance.now();
    requestAnimationFrame(loop);
    beep("triangle", 523.25, 0.05, 0.028);
    beep("triangle", 659.25, 0.05, 0.02);
  }

  function endGame() {
    state.running = false;
    state.crashed = true;
    state.paused = false;

    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(STORAGE_BEST, String(state.best));
      bestEl.textContent = String(state.best);
      overlayTitle.textContent = "New Best!";
    } else {
      overlayTitle.textContent = "Crash!";
    }
    overlayBody.innerHTML = `Score: <strong>${state.score}</strong><br/>Tap Restart to race again.`;
    startBtn.textContent = "Race again";
    setOverlay(true);

    beep("sawtooth", 180, 0.08, 0.03);
    setTimeout(() => beep("sawtooth", 120, 0.10, 0.028), 40);
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    if (!state.paused) {
      state.lastTs = performance.now();
      requestAnimationFrame(loop);
    } else {
      overlayTitle.textContent = "Paused";
      overlayBody.textContent = "Tap Resume to continue.";
      startBtn.textContent = "Resume";
      setOverlay(true);
    }
  }

  function setMuted(val) {
    muted = !!val;
    setBool(STORAGE_MUTE, muted);
    muteBtn.textContent = muted ? "Sound: Off" : "Sound: On";
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    if (muted && audioCtx) {
      audioCtx.close().catch(() => {}).finally(() => { audioCtx = null; });
    }
  }

  function setReduceMotion(val) {
    state.reduceMotion = !!val;
    setBool(STORAGE_RM, state.reduceMotion);
    reduceMotionBtn.setAttribute("aria-pressed", state.reduceMotion ? "true" : "false");
    reduceMotionBtn.textContent = state.reduceMotion ? "Motion reduced" : "Reduce motion";
    state.shake = 0;
  }

  // --- Input ---
  function moveLeft() {
    state.targetLane = clamp(state.targetLane - 1, 0, state.lanes - 1);
    beep("square", 420, 0.03, 0.018);
  }
  function moveRight() {
    state.targetLane = clamp(state.targetLane + 1, 0, state.lanes - 1);
    beep("square", 520, 0.03, 0.018);
  }

  function tryBoost() {
    if (!state.running || state.paused) return;
    if (state.boostCooldown > 0) return;
    state.boost = 1;
    state.boostCooldown = 4.2;
    boostBtn.classList.add("is-armed");
    beep("triangle", 880, 0.05, 0.03);
  }

  function onPadPress(btn, handler) {
    const down = (e) => {
      e.preventDefault();
      handler();
      btn.classList.add("down");
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove("down");
    };

    btn.addEventListener("pointerdown", down, { passive: false });
    btn.addEventListener("pointerup", up, { passive: false });
    btn.addEventListener("pointercancel", up, { passive: false });
    btn.addEventListener("pointerleave", up, { passive: false });
  }

  onPadPress(leftBtn, () => { if (state.running && !state.paused) moveLeft(); });
  onPadPress(rightBtn, () => { if (state.running && !state.paused) moveRight(); });
  onPadPress(boostBtn, () => { tryBoost(); });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft") { e.preventDefault(); if (state.running && !state.paused) moveLeft(); }
    if (k === "arrowright") { e.preventDefault(); if (state.running && !state.paused) moveRight(); }
    if (k === " " || k === "spacebar") { e.preventDefault(); if (state.running && !state.paused) tryBoost(); }
    if (k === "p") { e.preventDefault(); togglePause(); }
    if (k === "r") { e.preventDefault(); resetGame(true); startGame(); }
  }, { passive: false });

  // Swipe on canvas
  let swipe = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    swipe = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.1) {
      swipe.moved = true;
    }
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    const dt = performance.now() - swipe.t0;

    if (state.running && !state.paused) {
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.1 && dt < 450) {
        if (dx < 0) moveLeft();
        else moveRight();
      } else if (!swipe.moved) {
        // tap on track = boost attempt
        tryBoost();
      }
    }
    swipe = null;
  }, { passive: true });

  // Prevent scroll bouncing while interacting
  ["touchmove", "wheel"].forEach((evt) => {
    canvas.addEventListener(evt, (e) => {
      if (state.running) e.preventDefault();
    }, { passive: false });
  });

  // UI actions
  startBtn.addEventListener("click", () => {
    if (state.running && state.paused) {
      setOverlay(false);
      state.paused = false;
      pauseBtn.textContent = "Pause";
      pauseBtn.setAttribute("aria-pressed", "false");
      state.lastTs = performance.now();
      requestAnimationFrame(loop);
      return;
    }
    resetGame(true);
    startGame();
  });

  restartBtn.addEventListener("click", () => {
    resetGame(true);
    startGame();
  });

  pauseBtn.addEventListener("click", () => {
    if (!state.running) {
      setOverlay(true);
      return;
    }
    togglePause();
  });

  muteBtn.addEventListener("click", () => {
    setMuted(!muted);
    if (!muted) ensureAudio();
  });

  howBtn.addEventListener("click", () => {
    const expanded = howBtn.getAttribute("aria-expanded") === "true";
    howBtn.setAttribute("aria-expanded", expanded ? "false" : "true");
    howPanel.hidden = expanded;
    if (!expanded) {
      overlayBody.textContent = "Quick rules:";
    } else {
      overlayBody.innerHTML = 'Tap <strong>Start</strong> and steer with the big arrows. Grab 🥕 for points, avoid 🛑 cones.';
    }
  });

  reduceMotionBtn.addEventListener("click", () => setReduceMotion(!state.reduceMotion));
  clearBestBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_BEST);
    state.best = 0;
    bestEl.textContent = "0";
    beep("sine", 330, 0.06, 0.02);
  });

  // Initialize toggles
  setReduceMotion(state.reduceMotion);
  setMuted(muted);

  // --- World / gameplay ---
  function laneCenterX(laneIndex, w) {
    // Track has margins; 3 lanes
    const margin = w * 0.12;
    const trackW = w - margin * 2;
    const laneW = trackW / state.lanes;
    return margin + laneW * (laneIndex + 0.5);
  }

  function spawnObject(kind) {
    const w = canvas.width, h = canvas.height;
    const lane = Math.floor(Math.random() * state.lanes);
    const x = laneCenterX(lane, w);
    const y = -h * 0.1;

    const baseSize = Math.max(18, Math.floor(w * 0.045));
    let obj = {
      kind,
      lane,
      x,
      y,
      r: baseSize,
      score: 0,
      hit: false
    };

    if (kind === "cone") {
      obj.r = Math.max(18, Math.floor(w * 0.05));
    } else if (kind === "carrot") {
      obj.r = Math.max(16, Math.floor(w * 0.045));
      obj.score = 10;
    } else if (kind === "gold") {
      obj.r = Math.max(16, Math.floor(w * 0.048));
      obj.score = 25;
    }

    state.objects.push(obj);
  }

  function addParticles(x, y, n, palette) {
    if (state.reduceMotion) return;
    const w = canvas.width;
    const mag = Math.max(140, w * 0.45);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.35 + Math.random() * 0.65) * mag;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.45 + Math.random() * 0.35,
        t: 0,
        r: 2 + Math.random() * 3.5,
        c: palette[(Math.random() * palette.length) | 0]
      });
    }
  }

  function collideCircle(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    const rr = ar + br;
    return (dx * dx + dy * dy) <= rr * rr;
  }

  function scoreAdd(points) {
    state.score += points;
    scoreEl.textContent = String(state.score);
  }

  function crash() {
    if (state.crashed) return;
    state.shake = state.reduceMotion ? 0 : 1;
    addParticles(player.x, player.y, 18, ["#FF4D6D", "#FFB703", "#7C5CFF", "#EAF0FF"]);
    beep("sawtooth", 110, 0.14, 0.035);
    endGame();
  }

  // Player object derived each frame from lane smoothing
  const player = {
    x: 0,
    y: 0,
    r: 22
  };

  // --- Drawing ---
  function drawRoundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawTrack(dt) {
    const w = canvas.width, h = canvas.height;

    // subtle camera shake
    let sx = 0, sy = 0;
    if (!state.reduceMotion && state.shake > 0) {
      const s = state.shake * (w * 0.006);
      sx = (Math.random() * 2 - 1) * s;
      sy = (Math.random() * 2 - 1) * s;
    }
    ctx.setTransform(1, 0, 0, 1, sx, sy);

    // background
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#061025");
    g.addColorStop(1, "#050815");
    ctx.fillStyle = g;
    ctx.fillRect(-sx, -sy, w, h);

    // track body
    const margin = w * 0.10;
    const trackX = margin;
    const trackW = w - margin * 2;
    const trackY = h * 0.04;
    const trackH = h * 0.92;

    // track shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    drawRoundedRect(trackX + w * 0.01, trackY + h * 0.008, trackW, trackH, w * 0.06);
    ctx.fill();
    ctx.globalAlpha = 1;

    const tg = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
    tg.addColorStop(0, "#0A0F22");
    tg.addColorStop(0.5, "#0B1025");
    tg.addColorStop(1, "#0A0F22");
    ctx.fillStyle = tg;
    drawRoundedRect(trackX, trackY, trackW, trackH, w * 0.06);
    ctx.fill();

    // side stripes
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    drawRoundedRect(trackX + w * 0.008, trackY + w * 0.008, w * 0.028, trackH - w * 0.016, w * 0.03);
    ctx.fill();
    drawRoundedRect(trackX + trackW - w * 0.036, trackY + w * 0.008, w * 0.028, trackH - w * 0.016, w * 0.03);
    ctx.fill();
    ctx.globalAlpha = 1;

    // lane dividers (dashed, scrolling)
    const laneW = trackW / state.lanes;
    const dashW = Math.max(6, w * 0.012);
    const dashH = Math.max(18, h * 0.05);
    const gap = dashH * 0.6;

    const scroll = (state.time * (state.baseSpeed * state.speedMul) * 0.55) % (dashH + gap);

    for (let i = 1; i < state.lanes; i++) {
      const x = trackX + laneW * i;
      ctx.strokeStyle = "rgba(234,240,255,.22)";
      ctx.lineWidth = Math.max(2, w * 0.004);
      ctx.lineCap = "round";

      let y = trackY - scroll;
      while (y < trackY + trackH) {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + dashH);
        ctx.stroke();
        y += dashH + gap;
      }
    }
    ctx.globalAlpha = 1;

    // finish banner (top subtle)
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#EAF0FF";
    ctx.fillRect(trackX, trackY + trackH * 0.02, trackW, Math.max(2, h * 0.003));
    ctx.globalAlpha = 1;

    // boost glow along track edges
    if (state.boost > 0) {
      const a = 0.10 + 0.25 * state.boost;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#FFB703";
      drawRoundedRect(trackX + w * 0.014, trackY + w * 0.014, w * 0.02, trackH - w * 0.028, w * 0.02);
      ctx.fill();
      drawRoundedRect(trackX + trackW - w * 0.034, trackY + w * 0.014, w * 0.02, trackH - w * 0.028, w * 0.02);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // reset transform for UI draw later
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // vignette
    if (!state.reduceMotion) {
      ctx.globalAlpha = 0.35;
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.2, w * 0.5, h * 0.5, h * 0.8);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // subtle shake decay
    state.shake = Math.max(0, state.shake - dt * 2.2);
  }

  function drawCone(x, y, r) {
    // simple cute cone
    ctx.save();
    ctx.translate(x, y);

    // base
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.72, r * 0.72, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // cone body
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, "#FF7A90");
    grad.addColorStop(1, "#FF4D6D");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.lineTo(r * 0.85, r * 0.95);
    ctx.lineTo(-r * 0.85, r * 0.95);
    ctx.closePath();
    ctx.fill();

    // stripes
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.25);
    ctx.lineTo(r * 0.52, r * 0.48);
    ctx.lineTo(-r * 0.52, r * 0.48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.beginPath();
    ctx.moveTo(0, r * 0.22);
    ctx.lineTo(r * 0.70, r * 0.95);
    ctx.lineTo(-r * 0.70, r * 0.95);
    ctx.closePath();
    ctx.fill();

    // tiny "stop" dot
    ctx.fillStyle = "#1B2553";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, r * 0.07, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCarrot(x, y, r, gold = false) {
    ctx.save();
    ctx.translate(x, y);

    // shadow
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,.33)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // greens
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = gold ? "#5BE7C4" : "#69F0AE";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.quadraticCurveTo(-r * 0.25, -r * 1.25, -r * 0.48, -r * 0.95);
    ctx.quadraticCurveTo(-r * 0.18, -r * 1.02, 0, -r * 0.84);
    ctx.quadraticCurveTo(r * 0.18, -r * 1.02, r * 0.48, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.25, -r * 1.25, 0, -r * 1.05);
    ctx.closePath();
    ctx.fill();

    // body
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    if (gold) {
      grad.addColorStop(0, "#FFE08A");
      grad.addColorStop(1, "#FFB703");
    } else {
      grad.addColorStop(0, "#FFB36B");
      grad.addColorStop(1, "#FF7A00");
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.quadraticCurveTo(r * 0.62, -r * 0.15, r * 0.22, r * 0.95);
    ctx.quadraticCurveTo(0, r * 1.08, -r * 0.22, r * 0.95);
    ctx.quadraticCurveTo(-r * 0.62, -r * 0.15, 0, -r * 0.75);
    ctx.closePath();
    ctx.fill();

    // shine
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#EAF0FF";
    ctx.beginPath();
    ctx.ellipse(-r * 0.14, -r * 0.05, r * 0.16, r * 0.34, 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBunnyF1(x, y, r) {
    // r is roughly collision radius
    ctx.save();
    ctx.translate(x, y);

    // shadow
    ctx.globalAlpha = 0.33;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, r * 1.25, r * 0.95, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // car body
    const bodyW = r * 2.2;
    const bodyH = r * 1.5;
    const bodyY = r * 0.15;

    const cg = ctx.createLinearGradient(-bodyW, -bodyH, bodyW, bodyH);
    cg.addColorStop(0, "#7C5CFF");
    cg.addColorStop(1, "#5BE7C4");

    ctx.fillStyle = cg;
    drawRoundedRect(-bodyW * 0.5, bodyY - bodyH * 0.5, bodyW, bodyH, r * 0.55);
    ctx.fill();

    // cockpit
    ctx.fillStyle = "rgba(7,10,18,.55)";
    drawRoundedRect(-r * 0.55, -r * 0.05, r * 1.1, r * 0.8, r * 0.35);
    ctx.fill();

    // wheels
    const wheelY = r * 0.85;
    const wheelX = r * 0.92;
    ctx.fillStyle = "#050815";
    ctx.beginPath(); ctx.arc(-wheelX, wheelY, r * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(wheelX, wheelY, r * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(234,240,255,.18)";
    ctx.beginPath(); ctx.arc(-wheelX, wheelY, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(wheelX, wheelY, r * 0.22, 0, Math.PI * 2); ctx.fill();

    // front wing
    ctx.fillStyle = "rgba(234,240,255,.18)";
    drawRoundedRect(-r * 0.95, r * 0.95, r * 1.9, r * 0.22, r * 0.12);
    ctx.fill();

    // bunny head (cute)
    const headY = -r * 0.35;
    ctx.fillStyle = "#EAF0FF";
    ctx.beginPath();
    ctx.ellipse(0, headY, r * 0.62, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // ears
    ctx.fillStyle = "#EAF0FF";
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, headY - r * 0.75, r * 0.22, r * 0.55, -0.2, 0, Math.PI * 2);
    ctx.ellipse(r * 0.25, headY - r * 0.75, r * 0.22, r * 0.55, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,77,109,.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, headY - r * 0.75, r * 0.12, r * 0.36, -0.2, 0, Math.PI * 2);
    ctx.ellipse(r * 0.25, headY - r * 0.75, r * 0.12, r * 0.36, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = "#0B1022";
    ctx.beginPath();
    ctx.arc(-r * 0.22, headY - r * 0.05, r * 0.08, 0, Math.PI * 2);
    ctx.arc(r * 0.22, headY - r * 0.05, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // nose
    ctx.fillStyle = "#FF4D6D";
    ctx.beginPath();
    ctx.arc(0, headY + r * 0.14, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // boost flames
    if (state.boost > 0 && !state.reduceMotion) {
      const t = state.time * 18;
      const flicker = 0.7 + 0.3 * Math.sin(t);
      ctx.globalAlpha = 0.75 * state.boost;
      ctx.fillStyle = "#FFB703";
      ctx.beginPath();
      ctx.ellipse(0, r * 1.12, r * 0.22 * flicker, r * 0.46 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55 * state.boost;
      ctx.fillStyle = "#FF4D6D";
      ctx.beginPath();
      ctx.ellipse(0, r * 1.18, r * 0.14 * flicker, r * 0.34 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawParticles(dt) {
    if (state.particles.length === 0) return;
    const w = canvas.width, h = canvas.height;
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 2.6);
      p.vy *= (1 - dt * 2.6);

      const a = 1 - k;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.9 + 0.2 * (1 - k)), 0, Math.PI * 2);
      ctx.fill();

      // keep a bit within bounds (optional)
      if (p.x < -w || p.x > 2 * w || p.y < -h || p.y > 2 * h) {
        state.particles.splice(i, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTopBadges() {
    const w = canvas.width, h = canvas.height;

    // tiny in-canvas HUD: boost + cooldown
    const pad = Math.max(10, w * 0.03);
    const barW = Math.max(120, w * 0.36);
    const barH = Math.max(10, w * 0.025);
    const x = pad;
    const y = pad;

    // boost meter background
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(7,10,18,.45)";
    drawRoundedRect(x, y, barW, barH, barH / 2);
    ctx.fill();

    // fill
    const fill = state.boost > 0 ? state.boost : (state.boostCooldown > 0 ? 0 : 0);
    if (fill > 0) {
      ctx.fillStyle = "rgba(255,183,3,.85)";
      drawRoundedRect(x, y, barW * clamp(fill, 0, 1), barH, barH / 2);
      ctx.fill();
    }

    // cooldown overlay
    if (state.boostCooldown > 0 && state.boost <= 0) {
      const cd = clamp(1 - (state.boostCooldown / 4.2), 0, 1);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(124,92,255,.75)";
      drawRoundedRect(x, y, barW * cd, barH, barH / 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(234,240,255,.75)";
    ctx.font = `${Math.max(12, Math.floor(w * 0.036))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textBaseline = "top";
    const label = state.boost > 0 ? "BOOST" : (state.boostCooldown > 0 ? "charging" : "tap ⚡ to boost");
    ctx.fillText(label, x + barW + pad * 0.7, y - 2);
  }

  // --- Main loop ---
  function update(dt) {
    const w = canvas.width, h = canvas.height;

    // scale speed with canvas height so it feels similar across devices
    const sizeScale = h / 900; // baseline around 900px internal height
    const base = state.baseSpeed * sizeScale;

    // speed ramps slowly with time
    const ramp = 1 + Math.min(1.4, state.time * 0.03);
    state.speedMul = clamp(1.0 * ramp + state.boost * 0.9, 1.0, 3.2);
    speedEl.textContent = formatSpeed(state.speedMul);

    // boost logic
    if (state.boost > 0) {
      state.boost = Math.max(0, state.boost - dt * 1.35);
      if (state.boost <= 0) boostBtn.classList.remove("is-armed");
      if (!state.reduceMotion && Math.random() < 0.35) {
        addParticles(player.x, player.y + player.r * 1.1, 2, ["#FFB703", "#FF4D6D", "#EAF0FF"]);
      }
    }
    if (state.boostCooldown > 0) {
      state.boostCooldown = Math.max(0, state.boostCooldown - dt);
    }

    // lane smoothing
    const smooth = 1 - Math.pow(0.001, dt); // frame-rate independent
    state.laneX += (state.targetLane - state.laneX) * smooth;
    state.lane = Math.round(state.laneX);

    // player positioning
    player.x = laneCenterX(state.laneX, w);
    player.y = h * 0.80;
    player.r = Math.max(18, w * 0.055);

    // spawn objects
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      // choose spawn with increasing density
      const density = clamp(0.95 - state.time * 0.008, 0.35, 0.95);
      const roll = Math.random();
      let kind;
      if (roll < 0.56) kind = "cone";
      else if (roll < 0.90) kind = "carrot";
      else kind = "gold";

      // Try to avoid impossible blocks: don't place cone in all lanes at once
      // We spawn one at a time, so okay; but sometimes avoid cone right after cone.
      if (kind === "cone" && Math.random() < 0.25) kind = "carrot";

      spawnObject(kind);

      // next spawn time
      const baseGap = 0.78 * density;
      const fast = 0.42 * density;
      const mul = 1 / clamp(state.speedMul, 1, 3.2);
      state.spawnTimer = (fast + Math.random() * baseGap) * mul;
    }

    // move objects + collisions
    const v = base * state.speedMul;
    const trackBottom = h * 0.98;

    for (let i = state.objects.length - 1; i >= 0; i--) {
      const o = state.objects[i];
      o.y += v * dt;

      const br = o.r * 0.85;
      const pr = player.r * 0.62;
      if (!o.hit && collideCircle(player.x, player.y, pr, o.x, o.y, br)) {
        o.hit = true;
        if (o.kind === "cone") {
          crash();
          return;
        } else {
          scoreAdd(o.score);
          addParticles(o.x, o.y, o.kind === "gold" ? 14 : 10, o.kind === "gold" ? ["#FFB703", "#FFE08A", "#EAF0FF"] : ["#FF7A00", "#FFB36B", "#EAF0FF"]);
          beep("triangle", o.kind === "gold" ? 880 : 740, 0.04, 0.03);
          state.objects.splice(i, 1);
          continue;
        }
      }

      if (o.y - o.r > trackBottom) {
        state.objects.splice(i, 1);
        // small survival score for dodging cones
        if (o.kind === "cone") {
          scoreAdd(2);
        }
      }
    }

    // particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.t += dt;
      if (p.t >= p.life) state.particles.splice(i, 1);
    }

    // time
    state.time += dt;
  }

  function render(dt) {
    drawTrack(dt);

    // objects
    for (const o of state.objects) {
      if (o.kind === "cone") drawCone(o.x, o.y, o.r);
      else if (o.kind === "carrot") drawCarrot(o.x, o.y, o.r, false);
      else drawCarrot(o.x, o.y, o.r, true);
    }

    // player
    drawBunnyF1(player.x, player.y, player.r);

    // particles (draw after player for sparkle)
    if (!state.reduceMotion) drawParticles(dt);

    // in-canvas badges
    drawTopBadges();
  }

  function loop(ts) {
    if (!state.running || state.paused) return;

    const dt = Math.min(0.033, Math.max(0.001, (ts - state.lastTs) / 1000));
    state.lastTs = ts;

    update(dt);
    render(dt);

    requestAnimationFrame(loop);
  }

  // --- Boot ---
  function boot() {
    resizeCanvas();
    setOverlay(true);

    // a tiny harmless script task: show the current year in the footer title attr (no DOM change needed)
    document.body.dataset.boot = "ready";
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (!state.running) render(0);
  });

  // initial
  boot();
  resetGame(false);
  render(0);
})();
