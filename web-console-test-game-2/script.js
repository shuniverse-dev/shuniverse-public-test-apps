(() => {
  'use strict';

  // Subpath-safe: all assets are local/relative.

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const speedEl = document.getElementById('speed');

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnRestart = document.getElementById('btnRestart');
  const btnHow = document.getElementById('btnHow');
  const btnMobileJump = document.getElementById('btnMobileJump');
  const howPanel = document.getElementById('howPanel');

  // HiDPI
  function fitCanvasToCSSSize() {
    const cssW = canvas.clientWidth;
    const cssH = Math.round(cssW * (540 / 960));
    // Keep a stable aspect ratio by letting CSS set height:auto.
    // But we also want a consistent internal resolution.
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(cssW * dpr);
    const h = Math.round((cssW * (540 / 960)) * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const STORAGE_KEY = 'frog_jump_best_v1';
  const loadBest = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  const saveBest = (v) => {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* ignore */ }
  };

  let best = loadBest();
  bestEl.textContent = String(best);

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    time: 0,
    score: 0,
    speed: 1,
    difficultyTimer: 0,
    spawnTimer: 0,
    flyTimer: 0,
    shake: 0,
  };

  const world = {
    gravity: 2600, // px/s^2
    groundY: 0, // computed per frame based on canvas height
  };

  const frog = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    w: 70,
    h: 52,
    onGround: true,
    jumpsLeft: 2,
    blink: 0,
    squash: 0,
    facing: 1,
    alive: true,
  };

  /** @type {Array<{x:number,y:number,w:number,h:number,spd:number,rot:number,kind:'log',hit:boolean}>} */
  const obstacles = [];

  /** @type {Array<{x:number,y:number,r:number,spd:number,phase:number,collected:boolean}>} */
  const flies = [];

  // Input
  const input = {
    jumpQueued: false,
    pointerDown: false,
  };

  function setOverlay(visible, title, text) {
    if (visible) {
      overlay.hidden = false;
      overlayTitle.textContent = title;
      overlayText.textContent = text;
    } else {
      overlay.hidden = true;
    }
  }

  function resetGame() {
    state.running = false;
    state.paused = false;
    state.gameOver = false;
    state.time = 0;
    state.score = 0;
    state.speed = 1;
    state.difficultyTimer = 0;
    state.spawnTimer = 0;
    state.flyTimer = 1.2;
    state.shake = 0;

    obstacles.length = 0;
    flies.length = 0;

    const W = canvas.width;
    const H = canvas.height;
    world.groundY = Math.round(H * 0.82);

    frog.x = Math.round(W * 0.22);
    frog.y = world.groundY - frog.h;
    frog.vx = 0;
    frog.vy = 0;
    frog.onGround = true;
    frog.jumpsLeft = 2;
    frog.blink = 0.4;
    frog.squash = 0;
    frog.facing = 1;
    frog.alive = true;

    scoreEl.textContent = '0';
    speedEl.textContent = `${state.speed.toFixed(2)}×`;

    btnPause.textContent = 'Pause';
    btnPause.setAttribute('aria-pressed', 'false');

    setOverlay(true, 'Frog Jump', 'Press Space, ↑, or tap Jump. Avoid logs. Collect flies.');
  }

  function startGame() {
    if (state.gameOver) resetGame();
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    setOverlay(false);
  }

  function endGame(reasonText) {
    state.running = false;
    state.gameOver = true;
    frog.alive = false;

    if (state.score > best) {
      best = state.score;
      bestEl.textContent = String(best);
      saveBest(best);
    }

    setOverlay(true, 'Game Over', `${reasonText} Press R to restart or Space to try again.`);
  }

  function togglePause() {
    if (!state.running && !state.gameOver) return;
    if (state.gameOver) return;

    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Resume' : 'Pause';
    btnPause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');

    if (state.paused) {
      setOverlay(true, 'Paused', 'Press P to resume.');
    } else {
      setOverlay(false);
    }
  }

  function queueJump() {
    input.jumpQueued = true;
  }

  function doJump() {
    if (!frog.alive) return;
    if (frog.jumpsLeft <= 0) return;

    const base = 860; // px/s
    frog.vy = -base * (frog.jumpsLeft === 2 ? 1.0 : 0.92);
    frog.onGround = false;
    frog.jumpsLeft -= 1;
    frog.squash = 1.0;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function frogRect() {
    // Slightly forgiving hitbox
    return {
      x: frog.x + 10,
      y: frog.y + 6,
      w: frog.w - 20,
      h: frog.h - 10,
    };
  }

  function spawnLog() {
    const H = canvas.height;
    const W = canvas.width;

    const size = 48 + Math.random() * 30;
    const y = world.groundY - size;
    const spd = (520 + Math.random() * 220) * state.speed;

    obstacles.push({
      x: W + 20,
      y,
      w: size * 1.6,
      h: size,
      spd,
      rot: (Math.random() * 1.2 + 0.6) * (Math.random() < 0.5 ? -1 : 1),
      kind: 'log',
      hit: false,
    });

    // Next spawn
    const baseGap = 1.05;
    const jitter = 0.55;
    const gap = (baseGap + Math.random() * jitter) / clamp(state.speed, 1, 2.2);
    state.spawnTimer = gap;
  }

  function spawnFly() {
    const W = canvas.width;
    const minY = canvas.height * 0.34;
    const maxY = world.groundY - 110;
    const y = clamp(minY + Math.random() * (maxY - minY), minY, maxY);
    const r = 10;
    const spd = (460 + Math.random() * 140) * state.speed;
    flies.push({ x: W + 30, y, r, spd, phase: Math.random() * Math.PI * 2, collected: false });

    const base = 2.2;
    const jitter = 1.4;
    state.flyTimer = (base + Math.random() * jitter) / clamp(state.speed, 1, 2.2);
  }

  function addScore(points) {
    state.score += points;
    scoreEl.textContent = String(state.score);
  }

  function update(dt) {
    fitCanvasToCSSSize();
    const W = canvas.width;
    const H = canvas.height;
    world.groundY = Math.round(H * 0.82);

    if (!state.running || state.paused) return;

    state.time += dt;

    // Difficulty ramps slowly
    state.difficultyTimer += dt;
    if (state.difficultyTimer >= 1.0) {
      state.difficultyTimer = 0;
      state.speed = clamp(state.speed + 0.008, 1, 2.35);
      speedEl.textContent = `${state.speed.toFixed(2)}×`;
      addScore(1); // survive points
    }

    // Input
    if (input.jumpQueued) {
      input.jumpQueued = false;
      doJump();
    }

    // Frog physics
    frog.vy += world.gravity * dt;
    frog.y += frog.vy * dt;

    if (frog.y + frog.h >= world.groundY) {
      frog.y = world.groundY - frog.h;
      frog.vy = 0;
      if (!frog.onGround) {
        frog.onGround = true;
        frog.jumpsLeft = 2;
        frog.squash = 1.0;
      }
    } else {
      frog.onGround = false;
    }

    frog.squash = Math.max(0, frog.squash - dt * 3.6);
    frog.blink -= dt;
    if (frog.blink <= 0) frog.blink = 2.4 + Math.random() * 2.5;

    // Spawns
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) spawnLog();

    state.flyTimer -= dt;
    if (state.flyTimer <= 0) spawnFly();

    // Move obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= o.spd * dt;
      if (o.x + o.w < -40) obstacles.splice(i, 1);
    }

    // Move flies
    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i];
      f.phase += dt * 8;
      f.x -= f.spd * dt;
      if (f.x + f.r < -40) flies.splice(i, 1);
    }

    // Collisions
    const fr = frogRect();

    for (const o of obstacles) {
      if (o.hit) continue;
      if (rectsOverlap(fr, o)) {
        o.hit = true;
        state.shake = prefersReducedMotion ? 0 : 0.25;
        endGame('You bonked a log.');
        break;
      }
    }

    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i];
      if (f.collected) continue;
      const dx = (fr.x + fr.w * 0.5) - f.x;
      const dy = (fr.y + fr.h * 0.5) - (f.y + Math.sin(f.phase) * 10);
      const dist2 = dx * dx + dy * dy;
      const hitR = f.r + Math.min(fr.w, fr.h) * 0.35;
      if (dist2 <= hitR * hitR) {
        f.collected = true;
        flies.splice(i, 1);
        addScore(25);
        state.speed = clamp(state.speed + 0.04, 1, 2.35);
        speedEl.textContent = `${state.speed.toFixed(2)}×`;
      }
    }

    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);
  }

  function drawRoundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function render() {
    fitCanvasToCSSSize();
    const W = canvas.width;
    const H = canvas.height;
    world.groundY = Math.round(H * 0.82);

    // Screen shake
    let sx = 0, sy = 0;
    if (state.shake > 0 && !prefersReducedMotion) {
      const t = state.shake * 60;
      sx = (Math.random() * 2 - 1) * 6 * (t / 15);
      sy = (Math.random() * 2 - 1) * 4 * (t / 15);
    }

    ctx.save();
    ctx.translate(sx, sy);

    // Background sky
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);

    // Distant gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, 'rgba(139,211,255,0.10)');
    sky.addColorStop(0.45, 'rgba(98,210,111,0.08)');
    sky.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Parallax reeds
    const t = state.time;
    drawReeds(t, W, H);

    // Ground
    drawGround(t, W, H);

    // Flies
    for (const f of flies) drawFly(f);

    // Obstacles
    for (const o of obstacles) drawLog(o);

    // Frog
    drawFrog();

    // Subtle vignette
    const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawReeds(t, W, H) {
    const baseY = world.groundY;

    // Layer 1
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = 'rgba(98,210,111,0.22)';
    const step = Math.max(22, Math.round(W / 46));
    for (let x = 0; x <= W + step; x += step) {
      const sway = Math.sin((x * 0.02) + t * 0.7) * 6;
      ctx.beginPath();
      ctx.moveTo(x + sway, baseY);
      ctx.quadraticCurveTo(x + sway * 0.6, baseY - 70, x + sway * 1.2, baseY - 140);
      ctx.lineTo(x + sway * 1.2 + 3, baseY - 140);
      ctx.quadraticCurveTo(x + sway * 0.8 + 4, baseY - 70, x + sway + 6, baseY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Layer 2
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'rgba(255,211,79,0.16)';
    const step2 = Math.max(34, Math.round(W / 32));
    for (let x = 0; x <= W + step2; x += step2) {
      const sway = Math.sin((x * 0.015) + t * 0.45) * 10;
      ctx.beginPath();
      ctx.moveTo(x + sway, baseY + 2);
      ctx.quadraticCurveTo(x + sway * 0.7, baseY - 55, x + sway * 1.1, baseY - 120);
      ctx.lineTo(x + sway * 1.1 + 4, baseY - 120);
      ctx.quadraticCurveTo(x + sway * 0.8 + 6, baseY - 55, x + sway + 8, baseY + 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGround(t, W, H) {
    const y = world.groundY;

    // Soil
    const soil = ctx.createLinearGradient(0, y, 0, H);
    soil.addColorStop(0, 'rgba(20,36,24,1)');
    soil.addColorStop(1, 'rgba(8,16,12,1)');
    ctx.fillStyle = soil;
    ctx.fillRect(0, y, W, H - y);

    // Grass top
    ctx.fillStyle = 'rgba(98,210,111,0.35)';
    ctx.fillRect(0, y - 8, W, 10);

    // Ground texture lines moving
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 2;
    const speed = 140 * state.speed;
    const offset = ((t * speed) % 40);
    for (let x = -80; x < W + 80; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x - offset, y + 26);
      ctx.lineTo(x + 26 - offset, y + 38);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLog(o) {
    ctx.save();
    // Shadow
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    drawRoundedRect(o.x + 6, o.y + o.h - 10, o.w - 10, 16, 10);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    const grad = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
    grad.addColorStop(0, '#6b3b24');
    grad.addColorStop(0.5, '#8a4d2f');
    grad.addColorStop(1, '#5a311f');
    ctx.fillStyle = grad;
    drawRoundedRect(o.x, o.y, o.w, o.h, 14);
    ctx.fill();

    // Rings
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    const ringCount = Math.max(2, Math.round(o.w / 60));
    for (let i = 1; i <= ringCount; i++) {
      const rx = o.x + (o.w * i) / (ringCount + 1);
      ctx.beginPath();
      ctx.ellipse(rx, o.y + o.h * 0.52, o.h * 0.34, o.h * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Warning stripe at higher speed
    if (state.speed > 1.7) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = 'rgba(255,77,109,0.9)';
      const stripeW = 16;
      for (let x = o.x + 8; x < o.x + o.w; x += stripeW * 2) {
        ctx.beginPath();
        ctx.moveTo(x, o.y);
        ctx.lineTo(x + stripeW, o.y);
        ctx.lineTo(x + stripeW - 8, o.y + o.h);
        ctx.lineTo(x - 8, o.y + o.h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function drawFly(f) {
    const bob = Math.sin(f.phase) * 10;
    const x = f.x;
    const y = f.y + bob;

    // Glow
    ctx.save();
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 18);
    g.addColorStop(0, 'rgba(255,211,79,0.85)');
    g.addColorStop(1, 'rgba(255,211,79,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#151515';
    ctx.beginPath();
    ctx.ellipse(x, y, 8, 6, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Wings
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = 'rgba(139,211,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(x - 4, y - 6, 8, 5, -0.6, 0, Math.PI * 2);
    ctx.ellipse(x + 6, y - 6, 8, 5, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFrog() {
    const x = frog.x;
    const y = frog.y;

    // Animation squash/stretch
    const squ = frog.squash;
    const scaleY = 1 - 0.10 * squ;
    const scaleX = 1 + 0.10 * squ;

    ctx.save();
    ctx.translate(x + frog.w * 0.5, y + frog.h * 0.65);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-(x + frog.w * 0.5), -(y + frog.h * 0.65));

    // Shadow
    const shadowW = frog.w * (frog.onGround ? 0.85 : 0.62);
    const shadowAlpha = frog.onGround ? 0.35 : 0.22;
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.ellipse(x + frog.w * 0.5, world.groundY + 8, shadowW * 0.5, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body
    const bodyGrad = ctx.createLinearGradient(x, y, x + frog.w, y + frog.h);
    bodyGrad.addColorStop(0, '#77e684');
    bodyGrad.addColorStop(0.55, '#3fbf55');
    bodyGrad.addColorStop(1, '#2a7f3a');

    ctx.fillStyle = bodyGrad;
    drawRoundedRect(x + 6, y + 10, frog.w - 12, frog.h - 10, 18);
    ctx.fill();

    // Belly
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + frog.w * 0.54, y + frog.h * 0.62, frog.w * 0.22, frog.h * 0.18, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Legs
    ctx.fillStyle = 'rgba(18,40,18,0.25)';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + frog.h - 18, 22, 14, 8);
    ctx.roundRect(x + frog.w - 28, y + frog.h - 18, 22, 14, 8);
    ctx.fill();

    // Eye bumps
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.ellipse(x + 22, y + 14, 14, 12, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + frog.w - 22, y + 14, 14, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const blink = frog.blink < 0.12;
    if (blink) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 16);
      ctx.lineTo(x + 30, y + 16);
      ctx.moveTo(x + frog.w - 30, y + 16);
      ctx.lineTo(x + frog.w - 14, y + 16);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0c0f12';
      ctx.beginPath();
      ctx.arc(x + 22, y + 16, 6.8, 0, Math.PI * 2);
      ctx.arc(x + frog.w - 22, y + 16, 6.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x + 19, y + 14, 2.1, 0, Math.PI * 2);
      ctx.arc(x + frog.w - 25, y + 14, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouth
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x + frog.w * 0.52, y + frog.h * 0.56, 16, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  // Polyfill: roundRect is widely supported, but provide fallback.
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Array.isArray(r) ? r[0] : r;
      const rad = Math.min(rr || 0, w / 2, h / 2);
      this.beginPath();
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y, x + w, y + h, rad);
      this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad);
      this.arcTo(x, y, x + w, y, rad);
      this.closePath();
      return this;
    };
  }

  // Event wiring
  function onKeyDown(e) {
    const code = e.code;
    if (code === 'Space' || code === 'ArrowUp') {
      e.preventDefault();
      if (state.gameOver) {
        resetGame();
        startGame();
        queueJump();
        return;
      }
      if (!state.running) {
        startGame();
      }
      if (!state.paused) queueJump();
    } else if (code === 'KeyP') {
      e.preventDefault();
      togglePause();
    } else if (code === 'KeyR') {
      e.preventDefault();
      resetGame();
      startGame();
    } else if (code === 'Escape') {
      if (state.running && !state.gameOver) {
        e.preventDefault();
        togglePause();
      }
    }
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });

  // Pointer / touch: tap to jump
  function pointerJump(e) {
    // Avoid accidental text selection
    e.preventDefault();
    canvas.focus?.();

    if (state.gameOver) {
      resetGame();
      startGame();
      queueJump();
      return;
    }

    if (!state.running) startGame();
    if (!state.paused) queueJump();
  }

  canvas.addEventListener('pointerdown', pointerJump, { passive: false });
  btnMobileJump.addEventListener('pointerdown', pointerJump, { passive: false });
  btnMobileJump.addEventListener('click', (e) => e.preventDefault());

  overlay.addEventListener('pointerdown', (e) => {
    // Let buttons work; otherwise allow clicking overlay to jump/start.
    const target = /** @type {HTMLElement} */ (e.target);
    if (target && (target.closest('button') || target.closest('a') || target.tagName === 'KBD')) return;
    pointerJump(e);
  }, { passive: false });

  btnStart.addEventListener('click', () => {
    startGame();
  });
  btnPause.addEventListener('click', () => togglePause());
  btnRestart.addEventListener('click', () => {
    resetGame();
    startGame();
  });
  btnHow.addEventListener('click', () => {
    const expanded = btnHow.getAttribute('aria-expanded') === 'true';
    btnHow.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    howPanel.hidden = expanded;
  });

  // Main loop
  let last = performance.now();
  function frame(now) {
    const dtRaw = (now - last) / 1000;
    last = now;
    const dt = clamp(dtRaw, 0, 1 / 20); // avoid giant jumps

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  // Init
  resetGame();
  requestAnimationFrame(frame);
})();
