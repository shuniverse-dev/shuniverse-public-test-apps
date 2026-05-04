(() => {
  "use strict";

  const qs = (s) => document.querySelector(s);

  const canvas = qs("#game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const overlay = qs("#overlay");
  const btnPlay = qs("#btnPlay");
  const btnHow = qs("#btnHow");
  const howBox = qs("#howBox");
  const btnPause = qs("#btnPause");
  const btnRestart = qs("#btnRestart");

  const hudLap = qs("#hudLap");
  const hudTime = qs("#hudTime");
  const hudBest = qs("#hudBest");
  const hudSpeed = qs("#hudSpeed");
  const hudBoost = qs("#hudBoost");
  const hudHits = qs("#hudHits");
  const srAnnounce = qs("#srAnnounce");

  const STORAGE_BEST = "bunnygp_bestlap_v1";

  const W = () => canvas.width;
  const H = () => canvas.height;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mm = Math.floor(ms % 1000);
    return `${m}:${String(s).padStart(2, "0")}.${String(mm).padStart(3, "0")}`;
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
    const px = clamp(cx, rx, rx + rw);
    const py = clamp(cy, ry, ry + rh);
    const dx = cx - px;
    const dy = cy - py;
    return (dx * dx + dy * dy) <= r * r;
  }

  // Track model: a vertical circuit with gentle curves; player moves within track boundaries.
  function trackCenterX(y) {
    const t = y * 0.004;
    return W() * 0.5 + Math.sin(t) * (W() * 0.12) + Math.sin(t * 0.63 + 1.7) * (W() * 0.06);
  }
  function trackWidth(y) {
    const t = y * 0.0032;
    return W() * (0.54 + Math.sin(t + 0.6) * 0.06);
  }

  function trackEdgesAtWorldY(worldY) {
    const cx = trackCenterX(worldY);
    const tw = trackWidth(worldY);
    return { left: cx - tw * 0.5, right: cx + tw * 0.5, cx, tw };
  }

  const keys = new Set();
  let lastInputWasKeyboard = false;

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "p", "P", "r", "R", " "].includes(k)) {
      e.preventDefault();
    }
    keys.add(k);
    lastInputWasKeyboard = true;

    if (k === "p" || k === "P") togglePause();
    if (k === "r" || k === "R") restart();
    if (k === " " && state.mode === "overlay") startGame();
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
  });

  // Simple touch support: drag to steer (optional), but gameplay targets keyboard.
  let pointerActive = false;
  let pointerX = 0, pointerY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointerActive = true;
    const rect = canvas.getBoundingClientRect();
    pointerX = (e.clientX - rect.left) * (canvas.width / rect.width);
    pointerY = (e.clientY - rect.top) * (canvas.height / rect.height);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointerActive) return;
    const rect = canvas.getBoundingClientRect();
    pointerX = (e.clientX - rect.left) * (canvas.width / rect.width);
    pointerY = (e.clientY - rect.top) * (canvas.height / rect.height);
  });
  canvas.addEventListener("pointerup", () => { pointerActive = false; });
  canvas.addEventListener("pointercancel", () => { pointerActive = false; });

  const state = {
    mode: "overlay", // overlay | playing | paused
    timeMs: 0,
    lapStartMs: 0,
    currentLapMs: 0,
    bestLapMs: Number.isFinite(parseFloat(localStorage.getItem(STORAGE_BEST)))
      ? parseFloat(localStorage.getItem(STORAGE_BEST))
      : NaN,
    lap: 1,
    hits: 0,
    announcerCooldown: 0,

    // World scroll
    worldY: 0,
    speed: 0,
    baseSpeed: 320,
    maxSpeed: 820,
    boostMeter: 0, // 0..1
    boostActive: 0, // seconds remaining
    driftPenalty: 0, // small slowdown from rough handling

    // Objects in world coordinates (x in screen space, y in world space)
    carrots: [],
    rivals: [],
    scenery: [],

    // Start line tracking
    lastWorldY: 0,
    startLineY: 0
  };

  const player = {
    x: W() * 0.5,
    y: H() * 0.70,
    vx: 0,
    vy: 0,
    w: 46,
    h: 78,
    invuln: 0
  };

  function resizeForDPR() {
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round((rect.height || rect.width * 9 / 16) * dpr);

    // Maintain fixed internal aspect if layout hasn't sized yet
    const fallbackW = 960 * dpr;
    const fallbackH = 540 * dpr;

    const newW = Number.isFinite(targetW) && targetW > 50 ? targetW : fallbackW;
    const newH = Number.isFinite(targetH) && targetH > 50 ? targetH : fallbackH;

    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;

      // Adjust player relative position
      player.x = W() * 0.5;
      player.y = H() * 0.70;
    }
  }

  window.addEventListener("resize", () => {
    resizeForDPR();
  });

  function announce(text) {
    // Avoid spamming SR; also gives small in-game pause
    if (state.announcerCooldown > 0) return;
    srAnnounce.textContent = text;
    state.announcerCooldown = 1.0;
  }

  function setOverlayVisible(vis) {
    overlay.style.display = vis ? "grid" : "none";
    overlay.setAttribute("aria-hidden", vis ? "false" : "true");
    if (vis) state.mode = "overlay";
  }

  function startGame() {
    setOverlayVisible(false);
    state.mode = "playing";
    btnPause.setAttribute("aria-pressed", "false");
    btnPause.textContent = "Pause";
    // Ensure focus stays on document for keyboard play
    if (lastInputWasKeyboard) document.body.focus?.();
  }

  function togglePause() {
    if (state.mode === "overlay") return;
    if (state.mode === "paused") {
      state.mode = "playing";
      btnPause.setAttribute("aria-pressed", "false");
      btnPause.textContent = "Pause";
      announce("Resumed");
    } else if (state.mode === "playing") {
      state.mode = "paused";
      btnPause.setAttribute("aria-pressed", "true");
      btnPause.textContent = "Resume";
      announce("Paused");
    }
  }

  function resetRun() {
    state.timeMs = 0;
    state.lapStartMs = 0;
    state.currentLapMs = 0;
    state.lap = 1;
    state.hits = 0;

    state.worldY = 0;
    state.lastWorldY = 0;
    state.startLineY = 0;

    state.speed = 0;
    state.boostMeter = 0;
    state.boostActive = 0;
    state.driftPenalty = 0;

    player.x = W() * 0.5;
    player.y = H() * 0.70;
    player.vx = 0;
    player.vy = 0;
    player.invuln = 0;

    state.carrots = [];
    state.rivals = [];
    state.scenery = [];
    spawnInitial();
  }

  function restart() {
    resetRun();
    if (state.mode !== "overlay") {
      state.mode = "playing";
      announce("Restarted");
    }
  }

  function spawnInitial() {
    // Place some initial objects ahead
    for (let i = 0; i < 14; i++) spawnCarrot(state.worldY + 260 + i * 260);
    for (let i = 0; i < 9; i++) spawnRival(state.worldY + 360 + i * 420);
    for (let i = 0; i < 40; i++) spawnScenery(state.worldY + i * 190);
  }

  function spawnCarrot(worldY) {
    const edges = trackEdgesAtWorldY(worldY);
    const margin = 46;
    const x = rand(edges.left + margin, edges.right - margin);
    state.carrots.push({
      x,
      y: worldY,
      r: 14,
      taken: false,
      wobble: rand(0, Math.PI * 2)
    });
  }

  function spawnRival(worldY) {
    const edges = trackEdgesAtWorldY(worldY);
    const margin = 60;
    const x = rand(edges.left + margin, edges.right - margin);
    const speedBias = rand(0.78, 1.06);
    state.rivals.push({
      x,
      y: worldY,
      w: 46,
      h: 82,
      sway: rand(0, Math.PI * 2),
      swayAmp: rand(10, 24),
      swayFreq: rand(0.7, 1.2),
      speedBias,
      hit: false,
      hitCooldown: 0
    });
  }

  function spawnScenery(worldY) {
    const edges = trackEdgesAtWorldY(worldY);
    const side = Math.random() < 0.5 ? "L" : "R";
    const x = side === "L" ? edges.left - rand(40, 120) : edges.right + rand(40, 120);
    const kind = Math.random() < 0.5 ? "flag" : "cone";
    state.scenery.push({
      x,
      y: worldY,
      kind,
      s: rand(0.8, 1.2),
      hue: rand(0, 360)
    });
  }

  function ensureSpawns() {
    const ahead = state.worldY + H() * 1.5;

    // Carrots
    let maxCarrotY = state.carrots.reduce((m, o) => Math.max(m, o.y), state.worldY);
    while (maxCarrotY < ahead) {
      maxCarrotY += rand(190, 310);
      spawnCarrot(maxCarrotY);
    }

    // Rivals
    let maxRivalY = state.rivals.reduce((m, o) => Math.max(m, o.y), state.worldY);
    while (maxRivalY < ahead) {
      maxRivalY += rand(320, 520);
      spawnRival(maxRivalY);
    }

    // Scenery
    let maxSceneryY = state.scenery.reduce((m, o) => Math.max(m, o.y), state.worldY);
    while (maxSceneryY < ahead) {
      maxSceneryY += rand(140, 220);
      spawnScenery(maxSceneryY);
    }
  }

  function update(dt) {
    state.announcerCooldown = Math.max(0, state.announcerCooldown - dt);

    if (state.mode !== "playing") return;

    state.timeMs += dt * 1000;
    state.currentLapMs = state.timeMs - state.lapStartMs;

    // Boost logic
    const boostDrain = 0.22; // per second during active
    const boostGainPerCarrot = 0.22;

    if (state.boostActive > 0) {
      state.boostActive = Math.max(0, state.boostActive - dt);
      state.boostMeter = Math.max(0, state.boostMeter - boostDrain * dt);
    } else {
      // auto-trigger when meter is full enough
      if (state.boostMeter >= 0.98) {
        state.boostActive = 1.35;
        announce("Boost!");
      }
    }

    // Smooth handling
    const accel = 1850;
    const drag = 10.5;
    const steer = 1.0;

    let ax = 0, ay = 0;
    if (keys.has("ArrowLeft")) ax -= steer;
    if (keys.has("ArrowRight")) ax += steer;
    if (keys.has("ArrowUp")) ay -= 0.75;
    if (keys.has("ArrowDown")) ay += 0.75;

    // Pointer steering if active: pull toward pointer
    if (pointerActive) {
      const dx = pointerX - player.x;
      const dy = pointerY - player.y;
      ax += clamp(dx / (W() * 0.20), -1, 1);
      ay += clamp(dy / (H() * 0.28), -1, 1) * 0.6;
    }

    player.vx += ax * accel * dt;
    player.vy += ay * accel * dt;

    // Drag
    player.vx = lerp(player.vx, 0, clamp(drag * dt, 0, 1));
    player.vy = lerp(player.vy, 0, clamp((drag + 2) * dt, 0, 1));

    // Apply movement
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Keep player within some vertical area of screen
    player.y = clamp(player.y, H() * 0.46, H() * 0.86);

    // Determine desired speed based on racing line and events
    const playerWorldY = state.worldY + player.y;
    const edges = trackEdgesAtWorldY(playerWorldY);

    // Track boundary clamp with scrub
    const margin = 10;
    const leftBound = edges.left + player.w * 0.35 + margin;
    const rightBound = edges.right - player.w * 0.35 - margin;

    let offTrack = 0;
    if (player.x < leftBound) { offTrack = leftBound - player.x; player.x = leftBound; player.vx *= -0.25; }
    if (player.x > rightBound) { offTrack = player.x - rightBound; player.x = rightBound; player.vx *= -0.25; }

    // Drift penalty: sharp steering at high speed costs time/speed slightly
    const handlingStress = Math.min(1, Math.abs(player.vx) / 650);
    state.driftPenalty = lerp(state.driftPenalty, handlingStress, clamp(2.8 * dt, 0, 1));

    const boostFactor = state.boostActive > 0 ? 1.28 : 1.0;
    const target = clamp(
      state.baseSpeed * boostFactor
      + (state.boostActive > 0 ? 180 : 0)
      - offTrack * 2.2
      - state.driftPenalty * 120,
      120,
      state.maxSpeed * boostFactor
    );

    // Collisions cause temporary slowdown
    const inv = Math.max(0, player.invuln - dt);
    player.invuln = inv;

    state.speed = lerp(state.speed, target, clamp(2.6 * dt, 0, 1));

    // Advance world
    state.lastWorldY = state.worldY;
    state.worldY += state.speed * dt;

    // Start/finish line: at worldY = startLineY + n*lapLen
    const lapLen = 3800;
    const prevLapIndex = Math.floor(state.lastWorldY / lapLen);
    const newLapIndex = Math.floor(state.worldY / lapLen);
    if (newLapIndex > prevLapIndex) {
      // Completed a lap
      const lapTime = state.currentLapMs;
      if (!Number.isFinite(state.bestLapMs) || lapTime < state.bestLapMs) {
        state.bestLapMs = lapTime;
        localStorage.setItem(STORAGE_BEST, String(state.bestLapMs));
        announce("New best lap!");
      } else {
        announce("Lap complete");
      }
      state.lap += 1;
      state.lapStartMs = state.timeMs;
      state.currentLapMs = 0;
    }

    // Update rivals (sway + slight forward/back)
    for (const r of state.rivals) {
      r.sway += dt * r.swayFreq;
      // Rivals drift side-to-side relative to track center at their worldY
      const e = trackEdgesAtWorldY(r.y);
      const mid = e.cx;
      const baseOffset = (r.x - mid);
      const targetX = mid + baseOffset + Math.sin(r.sway) * r.swayAmp;
      r.x = lerp(r.x, targetX, clamp(1.8 * dt, 0, 1));

      // Mild relative motion (so they don't feel static)
      r.y += (state.speed * (r.speedBias - 1)) * dt * 0.75;

      r.hitCooldown = Math.max(0, r.hitCooldown - dt);
    }

    // Collisions: player car bounding box vs rival box; carrots via circle overlap
    const pRect = {
      x: player.x - player.w * 0.5,
      y: player.y - player.h * 0.5,
      w: player.w,
      h: player.h
    };

    for (const r of state.rivals) {
      const sy = r.y - state.worldY;
      if (sy < -160 || sy > H() + 180) continue;
      const rRect = { x: r.x - r.w * 0.5, y: sy - r.h * 0.5, w: r.w, h: r.h };

      const overlap = !(pRect.x + pRect.w < rRect.x ||
                        pRect.x > rRect.x + rRect.w ||
                        pRect.y + pRect.h < rRect.y ||
                        pRect.y > rRect.y + rRect.h);

      if (overlap && player.invuln <= 0 && r.hitCooldown <= 0) {
        state.hits += 1;
        player.invuln = 0.75;
        r.hitCooldown = 0.9;

        // Time penalty + speed dip
        state.timeMs += 750;
        state.lapStartMs += 0; // keep lapStart same; penalty goes into lap time
        state.speed = Math.max(160, state.speed * 0.72);
        state.boostActive = Math.max(0, state.boostActive - 0.4);
        state.boostMeter = Math.max(0, state.boostMeter - 0.18);

        announce("Ouch! Rival hit");
      }
    }

    for (const c of state.carrots) {
      if (c.taken) continue;
      const sy = c.y - state.worldY;
      if (sy < -90 || sy > H() + 90) continue;
      const hit = circleRectOverlap(c.x, sy, c.r + 4, pRect.x, pRect.y, pRect.w, pRect.h);
      if (hit) {
        c.taken = true;
        state.boostMeter = clamp(state.boostMeter + boostGainPerCarrot, 0, 1);
        announce("Carrot collected");
      }
    }

    // Cleanup old objects
    const cutY = state.worldY - 240;
    state.carrots = state.carrots.filter(o => o.y > cutY && !o.taken);
    state.rivals = state.rivals.filter(o => o.y > cutY);
    state.scenery = state.scenery.filter(o => o.y > cutY);

    ensureSpawns();
    updateHUD();
  }

  function updateHUD() {
    hudLap.textContent = String(state.lap);
    hudTime.textContent = formatTime(state.currentLapMs);
    hudBest.textContent = Number.isFinite(state.bestLapMs) ? formatTime(state.bestLapMs) : "—";
    hudSpeed.textContent = String(Math.round(state.speed));
    hudBoost.textContent = `${Math.round(state.boostMeter * 100)}%`;
    hudHits.textContent = String(state.hits);
  }

  function draw() {
    // Background
    ctx.clearRect(0, 0, W(), H());
    drawBackdrop();
    drawTrack();
    drawObjects();
    drawPlayer();
    drawVignette();
    drawPausedTag();
  }

  function drawBackdrop() {
    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H());
    g.addColorStop(0, "#0c1b3a");
    g.addColorStop(0.55, "#0a132b");
    g.addColorStop(1, "#070c18");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W(), H());

    // Distant glow
    ctx.globalAlpha = 0.9;
    const rg = ctx.createRadialGradient(W() * 0.5, H() * 0.25, 10, W() * 0.5, H() * 0.25, W() * 0.65);
    rg.addColorStop(0, "rgba(124,247,193,0.16)");
    rg.addColorStop(0.55, "rgba(63,225,255,0.08)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W(), H());
    ctx.globalAlpha = 1;
  }

  function drawTrack() {
    // Draw slices for smooth curved road
    const slice = 10;
    const yStart = -slice;
    const yEnd = H() + slice;

    // Road fill
    for (let sy = yStart; sy < yEnd; sy += slice) {
      const worldY = state.worldY + sy;
      const e = trackEdgesAtWorldY(worldY);

      // Asphalt
      const road = ctx.createLinearGradient(e.left, 0, e.right, 0);
      road.addColorStop(0, "rgba(0,0,0,0)");
      road.addColorStop(0.08, "rgba(255,255,255,0.03)");
      road.addColorStop(0.5, "rgba(255,255,255,0.02)");
      road.addColorStop(0.92, "rgba(255,255,255,0.03)");
      road.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = "#12182b";
      ctx.fillRect(e.left, sy, e.right - e.left, slice + 1);

      // Subtle sheen
      ctx.fillStyle = road;
      ctx.fillRect(e.left, sy, e.right - e.left, slice + 1);

      // Kerbs
      const kerbW = Math.max(10, e.tw * 0.04);
      const stripe = ((Math.floor(worldY / 40) % 2) === 0);

      ctx.fillStyle = stripe ? "rgba(255,93,122,0.9)" : "rgba(255,255,255,0.9)";
      ctx.fillRect(e.left - kerbW, sy, kerbW, slice + 1);
      ctx.fillRect(e.right, sy, kerbW, slice + 1);

      // Grass strips
      ctx.fillStyle = "rgba(23, 78, 55, 0.75)";
      ctx.fillRect(e.left - kerbW - 90, sy, 90, slice + 1);
      ctx.fillRect(e.right + kerbW, sy, 90, slice + 1);

      // Center dashed line
      const dashOn = (Math.floor(worldY / 34) % 2) === 0;
      if (dashOn) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        const dashW = Math.max(4, e.tw * 0.012);
        ctx.fillRect(e.cx - dashW * 0.5, sy + 2, dashW, slice - 3);
        ctx.globalAlpha = 1;
      }
    }

    // Start/finish line
    const lapLen = 3800;
    const lineYWorld = Math.floor(state.worldY / lapLen) * lapLen;
    const lineSY = lineYWorld - state.worldY;
    if (lineSY > -60 && lineSY < H() + 60) {
      const e = trackEdgesAtWorldY(lineYWorld);
      const w = e.right - e.left;
      ctx.save();
      ctx.translate(0, lineSY);
      // Checkered band
      const bandH = 18;
      const squares = 22;
      const sqW = w / squares;
      for (let i = 0; i < squares; i++) {
        const isWhite = (i % 2) === 0;
        ctx.fillStyle = isWhite ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.7)";
        ctx.fillRect(e.left + i * sqW, -bandH * 0.5, sqW + 1, bandH);
      }
      ctx.restore();
    }
  }

  function drawObjects() {
    // Scenery
    for (const s of state.scenery) {
      const sy = s.y - state.worldY;
      if (sy < -120 || sy > H() + 120) continue;
      if (s.kind === "flag") drawFlag(s.x, sy, s.s, s.hue);
      else drawCone(s.x, sy, s.s, s.hue);
    }

    // Carrots
    for (const c of state.carrots) {
      const sy = c.y - state.worldY;
      if (sy < -80 || sy > H() + 80) continue;
      c.wobble += 0.06;
      drawCarrot(c.x, sy + Math.sin(c.wobble) * 2.5, c.r);
    }

    // Rivals
    for (const r of state.rivals) {
      const sy = r.y - state.worldY;
      if (sy < -160 || sy > H() + 180) continue;
      drawRival(r.x, sy, r.w, r.h, r.hitCooldown > 0);
    }
  }

  function drawFlag(x, y, s, hue) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // pole
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(-2, -34, 4, 64);

    // flag cloth
    const t = performance.now() * 0.004;
    const wave = Math.sin(t + x * 0.01) * 4;
    ctx.fillStyle = `hsla(${hue}, 85%, 62%, 0.85)`;
    ctx.beginPath();
    ctx.moveTo(2, -28);
    ctx.quadraticCurveTo(24, -26 + wave, 42, -18);
    ctx.quadraticCurveTo(24, -8 + wave, 2, -10);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawCone(x, y, s, hue) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.9)`;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(14, 18);
    ctx.lineTo(-14, 18);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(-10, 6, 20, 4);

    ctx.restore();
  }

  function drawCarrot(x, y, r) {
    ctx.save();
    // Glow
    const glow = ctx.createRadialGradient(x, y, 2, x, y, r * 2.3);
    glow.addColorStop(0, "rgba(255,223,110,0.35)");
    glow.addColorStop(1, "rgba(255,223,110,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Leaves
    ctx.fillStyle = "rgba(124,247,193,0.95)";
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.9, r * 0.45, r * 0.8, -0.6, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.4, y - r * 0.95, r * 0.35, r * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, "rgba(255,154,61,0.98)");
    g.addColorStop(1, "rgba(255,223,110,0.98)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 1.25);
    ctx.quadraticCurveTo(x + r * 0.95, y + r * 0.1, x + r * 0.22, y - r * 1.1);
    ctx.quadraticCurveTo(x, y - r * 1.35, x - r * 0.22, y - r * 1.1);
    ctx.quadraticCurveTo(x - r * 0.95, y + r * 0.1, x, y + r * 1.25);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawRival(x, y, w, h, recentlyHit) {
    ctx.save();
    ctx.translate(x, y);

    // Shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.36, w * 0.55, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    const body = ctx.createLinearGradient(-w, -h, w, h);
    body.addColorStop(0, "rgba(255,93,122,0.98)");
    body.addColorStop(1, "rgba(255,154,180,0.95)");
    ctx.fillStyle = body;

    roundRect(ctx, -w * 0.45, -h * 0.38, w * 0.9, h * 0.78, 12);
    ctx.fill();

    // Wing + stripe
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    roundRect(ctx, -w * 0.43, -h * 0.05, w * 0.86, h * 0.12, 8);
    ctx.fill();

    // Wheels
    ctx.fillStyle = "rgba(5,6,10,0.95)";
    ctx.beginPath();
    ctx.roundRect(-w * 0.55, -h * 0.25, w * 0.2, h * 0.2, 8);
    ctx.roundRect(w * 0.35, -h * 0.25, w * 0.2, h * 0.2, 8);
    ctx.roundRect(-w * 0.55, h * 0.1, w * 0.2, h * 0.2, 8);
    ctx.roundRect(w * 0.35, h * 0.1, w * 0.2, h * 0.2, 8);
    ctx.fill();

    // Hit flash outline
    if (recentlyHit) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      roundRect(ctx, -w * 0.48, -h * 0.41, w * 0.96, h * 0.82, 14);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x;
    const y = player.y;
    const w = player.w;
    const h = player.h;

    ctx.save();
    ctx.translate(x, y);

    // Motion streak
    const streak = clamp((state.speed - 260) / 700, 0, 1);
    if (streak > 0) {
      ctx.globalAlpha = 0.22 * streak;
      ctx.fillStyle = "rgba(63,225,255,0.9)";
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-w * 0.2 + i * 10, h * 0.38, 4, 46 + i * 10);
      }
      ctx.globalAlpha = 1;
    }

    // Shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.6, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Car body (F1-ish)
    const body = ctx.createLinearGradient(-w, -h, w, h);
    body.addColorStop(0, "rgba(124,247,193,0.98)");
    body.addColorStop(1, "rgba(63,225,255,0.92)");
    ctx.fillStyle = body;
    roundRect(ctx, -w * 0.48, -h * 0.40, w * 0.96, h * 0.80, 14);
    ctx.fill();

    // Cockpit
    ctx.fillStyle = "rgba(5,8,18,0.72)";
    roundRect(ctx, -w * 0.22, -h * 0.18, w * 0.44, h * 0.28, 12);
    ctx.fill();

    // Wheels
    ctx.fillStyle = "rgba(5,6,10,0.95)";
    ctx.beginPath();
    ctx.roundRect(-w * 0.62, -h * 0.26, w * 0.22, h * 0.22, 9);
    ctx.roundRect(w * 0.40, -h * 0.26, w * 0.22, h * 0.22, 9);
    ctx.roundRect(-w * 0.62, h * 0.08, w * 0.22, h * 0.22, 9);
    ctx.roundRect(w * 0.40, h * 0.08, w * 0.22, h * 0.22, 9);
    ctx.fill();

    // Bunny head in cockpit
    drawBunny(0, -h * 0.20, 1.0);

    // Boost aura
    if (state.boostActive > 0) {
      const a = 0.35 + 0.25 * Math.sin(performance.now() * 0.015);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(255,223,110,0.95)";
      ctx.lineWidth = 3;
      roundRect(ctx, -w * 0.56, -h * 0.46, w * 1.12, h * 0.92, 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Invulnerability blink
    if (player.invuln > 0) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3;
      roundRect(ctx, -w * 0.60, -h * 0.50, w * 1.20, h * 1.00, 20);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Boost meter bar on road (subtle)
    drawBoostBar();
  }

  function drawBunny(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // Ears
    ctx.fillStyle = "rgba(234,240,255,0.98)";
    ctx.beginPath();
    ctx.ellipse(-10, -18, 6, 14, -0.2, 0, Math.PI * 2);
    ctx.ellipse(10, -18, 6, 14, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,154,180,0.8)";
    ctx.beginPath();
    ctx.ellipse(-10, -16, 3.5, 10, -0.2, 0, Math.PI * 2);
    ctx.ellipse(10, -16, 3.5, 10, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = "rgba(234,240,255,0.98)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "rgba(10,12,18,0.95)";
    ctx.beginPath();
    ctx.arc(-6, -2, 2.2, 0, Math.PI * 2);
    ctx.arc(6, -2, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = "rgba(255,93,122,0.9)";
    ctx.beginPath();
    ctx.arc(0, 4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = "rgba(10,12,18,0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 9);
    ctx.moveTo(0, 9);
    ctx.quadraticCurveTo(-4, 12, -7, 10.5);
    ctx.moveTo(0, 9);
    ctx.quadraticCurveTo(4, 12, 7, 10.5);
    ctx.stroke();

    ctx.restore();
  }

  function drawBoostBar() {
    const pad = 14;
    const w = Math.min(320, W() * 0.35);
    const h = 10;
    const x = W() - w - pad;
    const y = H() - h - pad;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    const fill = w * clamp(state.boostMeter, 0, 1);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "rgba(255,223,110,0.95)");
    g.addColorStop(1, "rgba(255,154,61,0.95)");
    ctx.fillStyle = g;
    roundRect(ctx, x, y, fill, h, 8);
    ctx.fill();

    // label
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(234,240,255,0.85)";
    ctx.font = `${Math.round(Math.max(12, W() * 0.014))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("BOOST", x + w, y - 4);
    ctx.restore();
  }

  function drawVignette() {
    const vg = ctx.createRadialGradient(W() * 0.5, H() * 0.5, Math.min(W(), H()) * 0.15, W() * 0.5, H() * 0.5, Math.max(W(), H()) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W(), H());
  }

  function drawPausedTag() {
    if (state.mode !== "paused") return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W(), H());
    ctx.fillStyle = "rgba(234,240,255,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(Math.max(22, W() * 0.035))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText("Paused", W() * 0.5, H() * 0.44);
    ctx.font = `600 ${Math.round(Math.max(12, W() * 0.016))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillStyle = "rgba(234,240,255,0.75)";
    ctx.fillText("Press P to resume", W() * 0.5, H() * 0.51);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // UI wiring
  btnPlay.addEventListener("click", () => startGame());
  btnPause.addEventListener("click", () => togglePause());
  btnRestart.addEventListener("click", () => restart());
  btnHow.addEventListener("click", () => {
    const expanded = btnHow.getAttribute("aria-expanded") === "true";
    btnHow.setAttribute("aria-expanded", expanded ? "false" : "true");
    howBox.hidden = expanded;
  });

  // Start in overlay; set initial HUD
  function init() {
    resizeForDPR();
    resetRun();
    updateHUD();
    setOverlayVisible(true);

    // Harmless script behavior: show that JS is running via title pulse once.
    const originalTitle = document.title;
    let n = 0;
    const t = setInterval(() => {
      n++;
      document.title = n % 2 ? "Bunny GP — Ready" : originalTitle;
      if (n >= 6) {
        clearInterval(t);
        document.title = originalTitle;
      }
    }, 550);
  }

  // Main loop
  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  init();
  requestAnimationFrame(frame);
})();
