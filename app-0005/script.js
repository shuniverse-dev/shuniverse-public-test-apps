(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const canvas = $("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const ui = {
    score: $("score"),
    best: $("best"),
    hp: $("hp"),
    dist: $("dist"),
    speedFill: $("speedFill"),
    staminaFill: $("staminaFill"),
    overlay: $("overlay"),
    overlayTitle: $("overlayTitle"),
    overlayBody: $("overlayBody"),
    startBtn: $("startBtn"),
    restartBtn: $("restartBtn"),
    pauseBtn: $("pauseBtn"),
    soundBtn: $("soundBtn"),
    howBtn: $("howBtn"),
    howPanel: $("howPanel"),
    toast: $("toast"),
    leftBtn: $("leftBtn"),
    rightBtn: $("rightBtn"),
    boostBtn: $("boostBtn"),
    driftBtn: $("driftBtn"),
    focusBtn: $("focusBtn"),
  };

  // Prevent page scroll during play gestures on the game area
  const gameWrap = document.querySelector(".canvas-wrap");
  gameWrap.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Audio (optional, simple beeps; can be toggled off)
  let audioOn = true;
  let audioCtx = null;

  function beep(type, freq, dur = 0.06, gain = 0.045) {
    if (!audioOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch {
      // ignore
    }
  }

  // Game constants
  const W = () => canvas.width;
  const H = () => canvas.height;

  const lanes = 3;
  const laneCenters = () => {
    const w = W();
    const pad = w * 0.18;
    const roadW = w - pad * 2;
    const step = roadW / lanes;
    const centers = [];
    for (let i = 0; i < lanes; i++) centers.push(pad + step * (i + 0.5));
    return { pad, roadW, step, centers };
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawText(c, text, x, y, size, color, align = "center") {
    c.fillStyle = color;
    c.font = `800 ${size}px ${getComputedStyle(document.body).fontFamily}`;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(text, x, y);
  }

  function showToast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => ui.toast.classList.remove("show"), 1100);
  }

  // Input state
  const input = {
    left: false,
    right: false,
    boost: false,
    driftTap: false,
    swipeDX: 0,
  };

  function bindHold(btn, onDown, onUp) {
    const down = (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      onDown();
    };
    const up = (e) => {
      e.preventDefault();
      onUp();
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  }

  bindHold(ui.leftBtn, () => (input.left = true), () => (input.left = false));
  bindHold(ui.rightBtn, () => (input.right = true), () => (input.right = false));
  bindHold(ui.boostBtn, () => (input.boost = true), () => (input.boost = false));

  ui.driftBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    input.driftTap = true;
  });

  ui.focusBtn.addEventListener("click", () => {
    gameWrap.focus({ preventScroll: true });
    showToast("Game focused");
  });

  // Swipe on game area for lane nudges
  let touchStartX = null;
  gameWrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    touchStartX = e.clientX;
  });
  gameWrap.addEventListener("pointerup", (e) => {
    if (touchStartX == null) return;
    const dx = e.clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) > 28) {
      input.swipeDX += dx;
    }
  });

  // Keyboard support
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") input.left = true;
    if (e.key === "ArrowRight") input.right = true;
    if (e.key === " " || e.key === "Spacebar") input.boost = true;
    if (e.key.toLowerCase() === "p") togglePause();
    if (e.key.toLowerCase() === "r") restart();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") input.left = false;
    if (e.key === "ArrowRight") input.right = false;
    if (e.key === " " || e.key === "Spacebar") input.boost = false;
  });

  // Game state
  const state = {
    running: false,
    paused: false,
    over: false,
    t: 0,
    score: 0,
    best: 0,
    hp: 3,
    dist: 0,
    speed: 0, // 0..1
    stamina: 1, // 0..1
    lane: 1, // 0..2
    laneX: 0,
    shake: 0,
    combo: 0,
    lastHitAt: -999,
  };

  const entities = []; // cones and carrots
  const particles = [];

  function loadBest() {
    try {
      const v = localStorage.getItem("bunnygp_best");
      state.best = v ? Number(v) || 0 : 0;
    } catch {
      state.best = 0;
    }
    ui.best.textContent = String(state.best);
  }
  function saveBest() {
    try {
      localStorage.setItem("bunnygp_best", String(state.best));
    } catch {
      // ignore
    }
  }

  function setOverlay(show, title, body) {
    if (show) {
      ui.overlay.hidden = false;
      ui.overlayTitle.textContent = title;
      ui.overlayBody.textContent = body;
    } else {
      ui.overlay.hidden = true;
    }
  }

  function resizeCanvasToDisplay() {
    // Keep internal resolution stable-ish for consistent gameplay, but adapt if needed.
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }

  window.addEventListener("resize", () => {
    resizeCanvasToDisplay();
  });

  function resetGame() {
    entities.length = 0;
    particles.length = 0;

    state.t = 0;
    state.score = 0;
    state.hp = 3;
    state.dist = 0;
    state.speed = 0.25;
    state.stamina = 1;
    state.lane = 1;
    state.combo = 0;
    state.lastHitAt = -999;
    state.over = false;
    state.paused = false;
    ui.pauseBtn.setAttribute("aria-pressed", "false");
    ui.pauseBtn.innerHTML = "<span aria-hidden=\"true\">⏸</span>";
    updateHUD();
  }

  function updateHUD() {
    ui.score.textContent = String(state.score);
    ui.hp.textContent = String(state.hp);
    ui.dist.textContent = String(Math.floor(state.dist));
    ui.speedFill.style.width = `${Math.round(clamp(state.speed, 0, 1) * 100)}%`;
    ui.staminaFill.style.width = `${Math.round(clamp(state.stamina, 0, 1) * 100)}%`;
    document.querySelector('.stat-bar')?.setAttribute("aria-valuenow", String(Math.round(state.stamina * 100)));
    document.querySelector('.meter-bar')?.setAttribute("aria-valuenow", String(Math.round(state.speed * 100)));
  }

  function start() {
    if (state.running) return;
    state.running = true;
    setOverlay(false);
    showToast("Go, bunny!");
    beep("triangle", 640, 0.07, 0.04);
  }

  function gameOver() {
    state.over = true;
    state.running = false;
    state.paused = false;
    ui.pauseBtn.setAttribute("aria-pressed", "false");
    ui.pauseBtn.innerHTML = "<span aria-hidden=\"true\">⏸</span>";
    if (state.score > state.best) {
      state.best = state.score;
      ui.best.textContent = String(state.best);
      saveBest();
      setOverlay(true, "New Best!", `Score ${state.score}. Tap Start to race again.`);
      beep("sine", 880, 0.08, 0.05);
      setTimeout(() => beep("sine", 990, 0.08, 0.05), 90);
    } else {
      setOverlay(true, "Finished!", `Score ${state.score}. Tap Start to try again.`);
      beep("sawtooth", 220, 0.12, 0.04);
    }
  }

  function restart() {
    resetGame();
    state.running = true;
    setOverlay(false);
    showToast("Restarted");
    beep("triangle", 520, 0.06, 0.04);
  }

  function togglePause() {
    if (state.over) return;
    if (!state.running && !state.paused) return; // not started
    state.paused = !state.paused;
    ui.pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    ui.pauseBtn.innerHTML = state.paused
      ? "<span aria-hidden=\"true\">▶</span>"
      : "<span aria-hidden=\"true\">⏸</span>";
    if (state.paused) {
      setOverlay(true, "Paused", "Tap resume to continue.");
      ui.startBtn.textContent = "Resume";
    } else {
      ui.startBtn.textContent = "Start";
      setOverlay(false);
    }
    beep("square", state.paused ? 360 : 520, 0.06, 0.035);
  }

  ui.startBtn.addEventListener("click", () => {
    if (state.paused) togglePause();
    else start();
  });
  ui.restartBtn.addEventListener("click", () => restart());
  ui.pauseBtn.addEventListener("click", () => {
    if (!state.running && !state.paused && !state.over) return;
    togglePause();
  });

  ui.soundBtn.addEventListener("click", async () => {
    audioOn = !audioOn;
    ui.soundBtn.setAttribute("aria-pressed", audioOn ? "true" : "false");
    ui.soundBtn.textContent = `Sound: ${audioOn ? "On" : "Off"}`;
    if (audioOn) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") await audioCtx.resume();
      } catch {}
      beep("triangle", 740, 0.05, 0.03);
      showToast("Sound on");
    } else {
      showToast("Sound off");
    }
  });

  ui.howBtn.addEventListener("click", () => {
    const expanded = ui.howBtn.getAttribute("aria-expanded") === "true";
    ui.howBtn.setAttribute("aria-expanded", expanded ? "false" : "true");
    ui.howPanel.hidden = expanded;
  });

  // Spawning
  function spawn(type, lane, y) {
    entities.push({
      type, // 'cone' | 'carrot'
      lane,
      y,
      hit: false,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  function spawnBurstParticles(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 420,
        vy: (Math.random() - 0.9) * 520,
        life: 0.45 + Math.random() * 0.25,
        t: 0,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }

  function maybeSpawn(dt) {
    const difficulty = clamp(state.dist / 900, 0, 1);
    const baseInterval = 0.85 - 0.35 * difficulty; // seconds
    state._spawnT = (state._spawnT || 0) + dt;

    if (state._spawnT > baseInterval) {
      state._spawnT = 0;

      // Ensure at least one safe lane sometimes; mix carrots.
      const roll = Math.random();
      const laneA = Math.floor(Math.random() * lanes);
      const laneB = (laneA + 1 + Math.floor(Math.random() * 2)) % lanes;

      if (roll < 0.62) {
        spawn("cone", laneA, -40);
        if (Math.random() < 0.22 + 0.18 * difficulty) spawn("cone", laneB, -110);
        if (Math.random() < 0.25) spawn("carrot", (laneA + 1) % lanes, -80);
      } else {
        // carrot moment
        spawn("carrot", laneA, -40);
        if (Math.random() < 0.55) spawn("carrot", laneB, -110);
        if (Math.random() < 0.25 + 0.2 * difficulty) spawn("cone", (laneA + 2) % lanes, -80);
      }
    }
  }

  function carBox() {
    const { centers, step } = laneCenters();
    const x = state.laneX;
    const y = H() * 0.78;
    const w = step * 0.66;
    const h = H() * 0.11;
    return { x, y, w, h, centers };
  }

  function intersects(a, b) {
    return (
      Math.abs(a.x - b.x) < (a.w + b.w) * 0.5 &&
      Math.abs(a.y - b.y) < (a.h + b.h) * 0.5
    );
  }

  // Rendering
  function drawTrack(time) {
    const w = W(), h = H();
    const { pad, roadW } = laneCenters();
    const roadX = pad;
    const roadY = 0;

    // Background
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, w, h);

    // Soft stars
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 35; i++) {
      const sx = (i * 97) % w;
      const sy = (i * 173) % h;
      const tw = 1 + ((i * 13) % 3);
      ctx.fillStyle = i % 7 === 0 ? "rgba(154,167,255,.7)" : "rgba(255,255,255,.55)";
      ctx.fillRect(sx, sy, tw, tw);
    }
    ctx.restore();

    // Road
    const grad = ctx.createLinearGradient(roadX, 0, roadX + roadW, 0);
    grad.addColorStop(0, "#1b243c");
    grad.addColorStop(0.5, "#121a2f");
    grad.addColorStop(1, "#1b243c");
    ctx.fillStyle = grad;
    ctx.fillRect(roadX, roadY, roadW, h);

    // Kerbs
    const kerbW = Math.max(10, w * 0.03);
    ctx.fillStyle = "#e84a5f";
    ctx.fillRect(roadX - kerbW, 0, kerbW, h);
    ctx.fillStyle = "#f7f7ff";
    for (let y = 0; y < h; y += 34) {
      ctx.fillRect(roadX - kerbW, y + ((Math.floor(time * 10) * 6) % 34), kerbW, 14);
      ctx.fillRect(roadX + roadW, y + ((Math.floor(time * 10) * 6) % 34), kerbW, 14);
    }
    ctx.fillStyle = "#e84a5f";
    ctx.fillRect(roadX + roadW, 0, kerbW, h);

    // Lane dashes
    const dashOffset = (time * (250 + state.speed * 320)) % 60;
    for (let i = 1; i < lanes; i++) {
      const x = roadX + (roadW / lanes) * i;
      ctx.fillStyle = "rgba(255,255,255,.22)";
      for (let y = -60; y < h + 60; y += 60) {
        ctx.fillRect(x - 2, y + dashOffset, 4, 28);
      }
    }

    // Slight vignette
    ctx.save();
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawCone(x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // base shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 18, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // cone
    const g = ctx.createLinearGradient(-18, -18, 18, 18);
    g.addColorStop(0, "#ff8a00");
    g.addColorStop(1, "#ff4d6d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(18, 20);
    ctx.lineTo(-18, 20);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillRect(-10, -6, 20, 6);
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.fillRect(-12, 6, 24, 6);

    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function drawCarrot(x, y, scale = 1, t = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t) * 0.12);
    ctx.scale(scale, scale);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 16, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const g = ctx.createLinearGradient(-14, -18, 14, 18);
    g.addColorStop(0, "#ffb703");
    g.addColorStop(1, "#fb5607");
    ctx.fillStyle = g;

    roundRect(ctx, -10, -18, 20, 40, 10);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // ridges
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.lineTo(6, -14);
    ctx.moveTo(-6, 2);
    ctx.lineTo(6, -2);
    ctx.moveTo(-6, 14);
    ctx.lineTo(6, 10);
    ctx.stroke();

    // leaves
    ctx.fillStyle = "#2ee59d";
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(-10, -30, -2, -36);
    ctx.quadraticCurveTo(2, -30, 0, -22);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(2, -22);
    ctx.quadraticCurveTo(12, -30, 6, -38);
    ctx.quadraticCurveTo(0, -30, 2, -22);
    ctx.fill();

    ctx.restore();
  }

  function drawBunnyCar() {
    const w = W(), h = H();
    const { step } = laneCenters();
    const box = carBox();
    const x = box.x;
    const y = box.y;
    const carW = step * 0.78;
    const carH = h * 0.14;

    // exhaust particles
    if (state.running && !state.paused && !state.over) {
      const pN = 1 + Math.floor(state.speed * 2);
      for (let i = 0; i < pN; i++) {
        particles.push({
          x: x,
          y: y + carH * 0.30,
          vx: (Math.random() - 0.5) * 80,
          vy: 280 + Math.random() * 220,
          life: 0.35 + Math.random() * 0.25,
          t: 0,
          r: 2 + Math.random() * 3,
          color: "rgba(154,167,255,.65)",
        });
      }
    }

    // car shadow
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y + carH * 0.42, carW * 0.34, carH * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // car body
    ctx.save();
    const wob = (input.driftTap ? 1 : 0) * 0.06 + Math.sin(state.t * 4) * 0.01;
    ctx.translate(x, y);
    ctx.rotate(wob);

    const bodyGrad = ctx.createLinearGradient(-carW / 2, -carH / 2, carW / 2, carH / 2);
    bodyGrad.addColorStop(0, "rgba(124,243,200,.95)");
    bodyGrad.addColorStop(1, "rgba(154,167,255,.95)");
    ctx.fillStyle = bodyGrad;

    roundRect(ctx, -carW / 2, -carH * 0.28, carW, carH * 0.64, 18);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // nose
    ctx.fillStyle = "rgba(255,255,255,.16)";
    roundRect(ctx, -carW * 0.12, -carH * 0.44, carW * 0.24, carH * 0.22, 12);
    ctx.fill();

    // wing
    ctx.fillStyle = "rgba(0,0,0,.22)";
    roundRect(ctx, -carW * 0.46, -carH * 0.38, carW * 0.92, carH * 0.10, 10);
    ctx.fill();

    // wheels
    const wheelY = carH * 0.05;
    const wheelX = carW * 0.42;
    ctx.fillStyle = "#0b0f1f";
    for (const s of [-1, 1]) {
      roundRect(ctx, s * wheelX - 14, wheelY - 10, 28, 34, 10);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.12)";
      roundRect(ctx, s * wheelX - 10, wheelY - 6, 20, 26, 9);
      ctx.fill();
      ctx.fillStyle = "#0b0f1f";
    }

    // cockpit
    ctx.fillStyle = "rgba(0,0,0,.25)";
    roundRect(ctx, -carW * 0.16, -carH * 0.18, carW * 0.32, carH * 0.26, 14);
    ctx.fill();

    // bunny (cute face)
    const headY = -carH * 0.16;
    ctx.save();
    ctx.translate(0, headY);

    // ears
    const earW = 14, earH = 28;
    for (const s of [-1, 1]) {
      ctx.fillStyle = "rgba(255,255,255,.95)";
      roundRect(ctx, s * 18 - earW / 2, -earH - 4, earW, earH, 10);
      ctx.fill();
      ctx.fillStyle = "rgba(255,160,200,.55)";
      roundRect(ctx, s * 18 - (earW - 6) / 2, -earH + 2, earW - 6, earH - 10, 10);
      ctx.fill();
    }

    // head
    ctx.fillStyle = "rgba(255,255,255,.97)";
    ctx.beginPath();
    ctx.ellipse(0, 6, 26, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // cheeks
    ctx.fillStyle = "rgba(255,160,200,.45)";
    ctx.beginPath();
    ctx.ellipse(-12, 12, 7, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(12, 12, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = "rgba(5,8,22,.92)";
    ctx.beginPath();
    ctx.ellipse(-9, 6, 4, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(9, 6, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // sparkle
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(-11, 3, 2, 2);
    ctx.fillRect(7, 3, 2, 2);

    // nose
    ctx.fillStyle = "rgba(255,120,160,.9)";
    ctx.beginPath();
    ctx.ellipse(0, 12, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.restore();
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      const a = clamp(1 - p.t / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (p.t >= p.life) particles.splice(i, 1);
    }
  }

  // Update loop
  let last = performance.now();

  function step(now) {
    resizeCanvasToDisplay();

    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    // Camera shake
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.8);

    // Update
    if (state.running && !state.paused && !state.over) {
      state.t += dt;

      // Lane target updates (swipe nudges lane once per swipe)
      if (input.swipeDX !== 0) {
        if (input.swipeDX < 0) state.lane -= 1;
        else state.lane += 1;
        input.swipeDX = 0;
        state.lane = clamp(state.lane, 0, lanes - 1);
      }

      if (input.left) state.lane -= 1 * dt * 3.2;
      if (input.right) state.lane += 1 * dt * 3.2;
      state.lane = clamp(state.lane, 0, lanes - 1);

      // Drift tap: quick nudge with tiny invuln feel (actually just speed wobble)
      if (input.driftTap) {
        input.driftTap = false;
        state.speed = clamp(state.speed + 0.05, 0, 1);
        state.stamina = clamp(state.stamina + 0.06, 0, 1);
        showToast("Drift!");
        beep("triangle", 780, 0.05, 0.03);
      }

      const { centers } = laneCenters();
      const laneIndex = clamp(Math.round(state.lane), 0, lanes - 1);
      const targetX = centers[laneIndex];
      if (!state.laneX) state.laneX = targetX;
      state.laneX += (targetX - state.laneX) * (1 - Math.pow(0.001, dt)); // smooth

      // Speed & stamina
      const baseSpeed = 0.38 + clamp(state.dist / 1600, 0, 1) * 0.42;
      const boosting = input.boost && state.stamina > 0.02;
      const boostBonus = boosting ? 0.26 : 0;
      const targetSpeed = clamp(baseSpeed + boostBonus, 0.25, 1);

      state.speed += (targetSpeed - state.speed) * (1 - Math.pow(0.002, dt));

      if (boosting) state.stamina = clamp(state.stamina - dt * (0.35 + state.speed * 0.22), 0, 1);
      else state.stamina = clamp(state.stamina + dt * 0.18, 0, 1);

      const scroll = (380 + state.speed * 520) * dt;
      state.dist += scroll / 8;

      // spawn entities
      maybeSpawn(dt);

      // move entities
      for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        e.y += scroll;
        e.wobble += dt * 2.6;

        if (e.y > H() + 80) entities.splice(i, 1);
      }

      // collisions
      const box = carBox();
      const collider = { x: box.x, y: box.y, w: box.w, h: box.h };

      for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        const { centers, step } = laneCenters();
        const ex = centers[e.lane] + Math.sin(e.wobble) * (e.type === "carrot" ? 2 : 0);
        const ey = e.y;

        const ew = step * (e.type === "cone" ? 0.38 : 0.34);
        const eh = step * (e.type === "cone" ? 0.46 : 0.48);

        if (!e.hit && intersects(collider, { x: ex, y: ey, w: ew, h: eh })) {
          e.hit = true;
          entities.splice(i, 1);

          if (e.type === "carrot") {
            const bonus = 10 + Math.min(40, state.combo * 2);
            state.score += bonus;
            state.combo += 1;
            state.stamina = clamp(state.stamina + 0.18, 0, 1);
            spawnBurstParticles(ex, ey, "rgba(255,209,102,.9)", 14);
            beep("sine", 880 + state.combo * 8, 0.045, 0.035);
          } else {
            state.hp -= 1;
            state.combo = 0;
            state.shake = 1;
            state.lastHitAt = state.t;
            spawnBurstParticles(ex, ey, "rgba(255,77,109,.9)", 18);
            beep("sawtooth", 180, 0.09, 0.045);
            showToast("Ouch! Cone hit");
            if (state.hp <= 0) {
              updateHUD();
              gameOver();
              break;
            }
          }
        }
      }

      // passive score
      state.score += Math.floor(scroll * 0.02);
      if (state.score > state.best) {
        state.best = state.score;
        ui.best.textContent = String(state.best);
      }

      updateHUD();
    }

    // Draw
    ctx.save();
    if (state.shake > 0) {
      const mag = state.shake * 10;
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    drawTrack(state.t);

    // Draw entities
    const { centers, step } = laneCenters();
    for (const e of entities) {
      const x = centers[e.lane];
      const y = e.y;
      const scale = clamp(step / 150, 0.85, 1.1);
      if (e.type === "cone") drawCone(x, y, scale);
      else drawCarrot(x, y, scale, state.t + e.wobble);
    }

    drawBunnyCar();
    drawParticles(dt);

    // HUD-ish warnings on canvas
    if (state.running && !state.paused && !state.over) {
      const dangerFlash = (state.t - state.lastHitAt) < 0.6;
      if (dangerFlash) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#ff4d6d";
        ctx.fillRect(0, 0, W(), H());
        ctx.restore();
      }
      // carrot combo tiny label
      if (state.combo >= 2) {
        drawText(ctx, `Combo x${state.combo}`, W() * 0.5, H() * 0.12, Math.round(H() * 0.03), "rgba(255,209,102,.95)");
      }
    }

    ctx.restore();

    requestAnimationFrame(step);
  }

  // Init UI
  loadBest();
  resetGame();
  setOverlay(true, "Bunny GP Sprint", "Tap Start to race.");

  // Pause overlay start button label handling
  ui.overlay.addEventListener("click", (e) => {
    // keep overlay clickable but avoid accidental starts when tapping body text
    const target = e.target;
    if (target === ui.overlay) {
      // tap outside card focuses game
      gameWrap.focus({ preventScroll: true });
    }
  });

  // Ensure audio starts only after user gesture
  const unlockAudio = () => {
    if (!audioOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  };
  window.addEventListener("pointerdown", unlockAudio, { once: false });
  window.addEventListener("keydown", unlockAudio, { once: false });

  // Kick off
  requestAnimationFrame(step);
})();
