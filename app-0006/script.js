(() => {
  "use strict";

  const app = document.getElementById("app");
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const overlay = document.getElementById("overlay");
  const panelTitle = document.getElementById("panelTitle");
  const subtitle = document.getElementById("subtitle");
  const hudSpeed = document.getElementById("hudSpeed");
  const hudDist = document.getElementById("hudDist");
  const hudBest = document.getElementById("hudBest");
  const runDistance = document.getElementById("runDistance");
  const bestDistance = document.getElementById("bestDistance");
  const btnPlay = document.getElementById("btnPlay");
  const btnResume = document.getElementById("btnResume");
  const btnRestart = document.getElementById("btnRestart");

  const ctlLeft = document.getElementById("ctlLeft");
  const ctlRight = document.getElementById("ctlRight");
  const ctlPause = document.getElementById("ctlPause");
  const pauseText = document.getElementById("pauseText");

  const optTilt = document.getElementById("optTilt");
  const optHighContrast = document.getElementById("optHighContrast");

  const streakFill = document.getElementById("streakFill");
  const streakValue = document.getElementById("streakValue");
  const footerHint = document.getElementById("footerHint");

  const toast = document.getElementById("toast");

  const STORAGE_KEY = "app-0006-downhill-best-v1";
  const SETTINGS_KEY = "app-0006-downhill-settings-v1";

  let dpr = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function showToast(message, ms = 1100) {
    toast.innerHTML = "";
    const bubble = document.createElement("div");
    bubble.textContent = message;
    toast.appendChild(bubble);
    toast.classList.add("show");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toast.classList.remove("show"), ms);
  }

  // Game state
  const state = {
    mode: "menu", // menu | running | paused | crashed
    time: 0,
    dtSmooth: 1 / 60,
    input: {
      left: 0,
      right: 0,
      steer: 0,     // -1..1
      steerVel: 0,
      touchSteer: 0,
      tiltSteer: 0,
      pointerActive: false
    },
    player: {
      x: 0, // -1..1 normalized lateral position
      vx: 0
    },
    run: {
      distance: 0,
      speed: 0,
      baseSpeed: 22,
      speedBoost: 0,
      alive: true,
      streak: 0,
      gateMeter: 0
    },
    camera: {
      shake: 0
    },
    spawn: {
      z: 0,
      nextGateZ: 30,
      nextObstacleZ: 22,
      seed: (Math.random() * 1e9) | 0
    },
    objects: [] // {type:'tree'|'rock'|'gateL'|'gateR'|'flag', x, z, w, r, passed}
  };

  let best = 0;

  // Deterministic-ish RNG
  function rand() {
    state.spawn.seed = (1664525 * state.spawn.seed + 1013904223) >>> 0;
    return state.spawn.seed / 4294967296;
  }

  function resetRun(keepMode = "running") {
    state.time = 0;
    state.dtSmooth = 1 / 60;
    state.player.x = 0;
    state.player.vx = 0;
    state.run.distance = 0;
    state.run.speed = 0;
    state.run.baseSpeed = 22;
    state.run.speedBoost = 0;
    state.run.alive = true;
    state.run.streak = 0;
    state.run.gateMeter = 0;
    state.camera.shake = 0;

    state.spawn.z = 0;
    state.spawn.nextGateZ = 30;
    state.spawn.nextObstacleZ = 20;
    state.spawn.seed = (Math.random() * 1e9) | 0;
    state.objects.length = 0;

    setMode(keepMode);
    updateHUD();
    updateStreakUI();
    footerHint.textContent = "Steer through gates to build a streak.";
  }

  function setMode(mode) {
    state.mode = mode;
    app.dataset.state = mode === "running" ? "running" : "paused";

    const isPausedOverlay = (mode !== "running");
    overlay.setAttribute("aria-hidden", String(!isPausedOverlay));
    pauseText.textContent = (mode === "running") ? "Pause" : "Resume";

    btnPlay.style.display = (mode === "menu" || mode === "crashed") ? "" : "none";
    btnResume.style.display = (mode === "paused") ? "" : "none";
    btnRestart.style.display = (mode === "paused") ? "" : "none";

    if (mode === "menu") {
      panelTitle.textContent = "Downhill Ski";
      subtitle.textContent = "Tap Play to start";
    } else if (mode === "paused") {
      panelTitle.textContent = "Paused";
      subtitle.textContent = "Paused";
    } else if (mode === "crashed") {
      panelTitle.textContent = "Crash!";
      subtitle.textContent = "Tap Play to try again";
    } else if (mode === "running") {
      subtitle.textContent = "Carving downhill";
    }
  }

  function loadBest() {
    const v = Number(localStorage.getItem(STORAGE_KEY) || "0");
    best = Number.isFinite(v) ? v : 0;
    hudBest.textContent = String(Math.floor(best));
    bestDistance.textContent = String(Math.floor(best));
  }

  function saveBest() {
    localStorage.setItem(STORAGE_KEY, String(Math.floor(best)));
  }

  function loadSettings() {
    const s = safeParse(localStorage.getItem(SETTINGS_KEY) || "{}", {});
    optTilt.checked = !!s.tilt;
    optHighContrast.checked = !!s.hc;
    applySettings();
  }

  function saveSettings() {
    const payload = { tilt: optTilt.checked, hc: optHighContrast.checked };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  }

  function applySettings() {
    document.body.classList.toggle("high-contrast", !!optHighContrast.checked);
  }

  optTilt.addEventListener("change", () => { saveSettings(); });
  optHighContrast.addEventListener("change", () => { applySettings(); saveSettings(); });

  // Input: touch buttons (hold)
  function bindHoldButton(el, onDown, onUp) {
    const down = (e) => { e.preventDefault(); onDown(); };
    const up = (e) => { e.preventDefault(); onUp(); };

    el.addEventListener("pointerdown", down, { passive: false });
    el.addEventListener("pointerup", up, { passive: false });
    el.addEventListener("pointercancel", up, { passive: false });
    el.addEventListener("pointerleave", up, { passive: false });
  }

  bindHoldButton(ctlLeft, () => { state.input.left = 1; }, () => { state.input.left = 0; });
  bindHoldButton(ctlRight, () => { state.input.right = 1; }, () => { state.input.right = 0; });

  ctlPause.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (state.mode === "running") {
      setMode("paused");
      showToast("Paused");
    } else if (state.mode === "paused") {
      setMode("running");
      showToast("Resume");
    } else if (state.mode === "menu" || state.mode === "crashed") {
      resetRun("running");
      showToast("Go!");
    }
  }, { passive: false });

  // Swipe steering directly on canvas: drag left/right to set target steer
  canvas.addEventListener("pointerdown", (e) => {
    if (state.mode !== "running") return;
    canvas.setPointerCapture(e.pointerId);
    state.input.pointerActive = true;
    state.input.pointerX0 = e.clientX;
    state.input.touchSteer = 0;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.input.pointerActive || state.mode !== "running") return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - state.input.pointerX0);
    const norm = dx / Math.max(1, rect.width * 0.35);
    state.input.touchSteer = clamp(norm, -1, 1);
  }, { passive: true });

  function endPointer(e) {
    if (!state.input.pointerActive) return;
    state.input.pointerActive = false;
    state.input.touchSteer = 0;
  }
  canvas.addEventListener("pointerup", endPointer, { passive: true });
  canvas.addEventListener("pointercancel", endPointer, { passive: true });

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") state.input.left = 1;
    if (e.key === "ArrowRight") state.input.right = 1;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (state.mode === "running") setMode("paused");
      else if (state.mode === "paused") setMode("running");
      else if (state.mode === "menu" || state.mode === "crashed") resetRun("running");
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") state.input.left = 0;
    if (e.key === "ArrowRight") state.input.right = 0;
  });

  // Tilt steering (optional)
  let lastTilt = 0;
  window.addEventListener("deviceorientation", (e) => {
    if (!optTilt.checked) return;
    // gamma: left/right tilt in degrees (-90..90)
    const g = (typeof e.gamma === "number") ? e.gamma : 0;
    const filtered = lerp(lastTilt, g, 0.12);
    lastTilt = filtered;
    const t = clamp(filtered / 25, -1, 1);
    state.input.tiltSteer = t;
  }, { passive: true });

  // Menu buttons
  btnPlay.addEventListener("click", () => {
    resetRun("running");
    showToast("Go!");
  });

  btnResume.addEventListener("click", () => {
    setMode("running");
    showToast("Resume");
  });

  btnRestart.addEventListener("click", () => {
    resetRun("running");
    showToast("Restart");
  });

  // Prevent page scroll during active play on touch
  document.addEventListener("touchmove", (e) => {
    if (state.mode === "running") e.preventDefault();
  }, { passive: false });

  function updateHUD() {
    hudSpeed.textContent = String(Math.round(state.run.speed));
    hudDist.textContent = String(Math.floor(state.run.distance));
    hudBest.textContent = String(Math.floor(best));
    runDistance.textContent = String(Math.floor(state.run.distance));
    bestDistance.textContent = String(Math.floor(best));
  }

  function updateStreakUI() {
    const s = clamp(state.run.streak, 0, 10);
    streakValue.textContent = String(s);
    const pct = (s / 10) * 100;
    streakFill.style.width = pct.toFixed(1) + "%";
    const track = streakFill.parentElement;
    if (track) track.setAttribute("aria-valuenow", String(s));
  }

  function addObstacle(z) {
    const kind = rand() < 0.62 ? "tree" : "rock";
    // Avoid center to keep some lanes, but still can appear
    const x = (rand() * 2 - 1) * 0.95;
    const size = (kind === "tree") ? lerp(0.08, 0.13, rand()) : lerp(0.07, 0.12, rand());
    state.objects.push({
      type: kind,
      x,
      z,
      r: size,
      w: size,
      passed: false
    });
  }

  function addGate(z) {
    // Gate is a pair of flags. Player must pass between them.
    const center = (rand() * 2 - 1) * 0.75;
    const width = lerp(0.32, 0.44, rand());
    const leftX = clamp(center - width / 2, -0.95, 0.95);
    const rightX = clamp(center + width / 2, -0.95, 0.95);
    state.objects.push({ type: "gateL", x: leftX, z, r: 0.05, w: width, passed: false, center, width });
    state.objects.push({ type: "gateR", x: rightX, z, r: 0.05, w: width, passed: false, center, width });
  }

  function cullOld() {
    // Remove objects behind the player (z < -5)
    state.objects = state.objects.filter(o => o.z > -6);
  }

  function crash(reason) {
    state.run.alive = false;
    state.camera.shake = 1.0;
    setMode("crashed");

    panelTitle.textContent = "Crash!";
    subtitle.textContent = reason;

    if (state.run.distance > best) {
      best = state.run.distance;
      saveBest();
      showToast("New best!");
    } else {
      showToast("Crash!");
    }
    updateHUD();
    updateStreakUI();
    footerHint.textContent = "Tip: carve gently—hard turns cost speed.";
  }

  function step(dt) {
    state.time += dt;
    // Smooth dt for stability
    state.dtSmooth = lerp(state.dtSmooth, dt, 0.08);

    // Steering input blend
    const btnSteer = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    const touchSteer = state.input.touchSteer || 0;
    const tiltSteer = optTilt.checked ? (state.input.tiltSteer || 0) : 0;

    // Prioritize direct touch drag, then tilt, then buttons
    let target = 0;
    const absTouch = Math.abs(touchSteer);
    const absTilt = Math.abs(tiltSteer);
    if (absTouch > 0.05) target = touchSteer;
    else if (absTilt > 0.08) target = tiltSteer;
    else target = btnSteer;

    // Dynamics: faster response at higher speed
    const speedNorm = clamp(state.run.speed / 50, 0, 1);
    const steerAccel = lerp(8, 13, speedNorm);
    const steerDamp = lerp(10, 14, speedNorm);

    state.input.steerVel += (target - state.input.steer) * steerAccel * dt;
    state.input.steerVel *= Math.exp(-steerDamp * dt);
    state.input.steer += state.input.steerVel * dt;
    state.input.steer = clamp(state.input.steer, -1, 1);

    // Speed model: base increases slowly with distance, turning reduces speed, streak boosts
    const dist = state.run.distance;
    const difficulty = clamp(dist / 800, 0, 1);
    state.run.baseSpeed = lerp(22, 46, difficulty);

    const turnPenalty = 1 - 0.22 * Math.min(1, Math.abs(state.input.steer) * 1.25);
    const streakBoost = 1 + 0.03 * clamp(state.run.streak, 0, 10);
    const targetSpeed = state.run.baseSpeed * turnPenalty * streakBoost;

    // Ease speed
    state.run.speed = lerp(state.run.speed, targetSpeed, 0.06 + 0.10 * dt * 60);

    // Update distance / forward motion: objects move towards player
    const dz = state.run.speed * dt;
    state.run.distance += dz;

    // Player lateral movement: steer changes x
    const lateralSpeed = lerp(0.85, 1.35, clamp(state.run.speed / 55, 0, 1));
    state.player.vx = lerp(state.player.vx, state.input.steer * lateralSpeed, 0.15);
    state.player.x += state.player.vx * dt;
    state.player.x = clamp(state.player.x, -1, 1);

    // Move objects towards player
    for (const o of state.objects) o.z -= dz;

    // Spawning: obstacles and gates
    while (state.spawn.nextObstacleZ < state.run.distance + 140) {
      const z = state.spawn.nextObstacleZ;
      addObstacle(z - state.run.distance + 70); // convert to relative z ahead
      // spacing shrinks with difficulty
      const spacing = lerp(14, 8.2, difficulty) * lerp(0.9, 1.15, rand());
      state.spawn.nextObstacleZ += spacing;
    }

    while (state.spawn.nextGateZ < state.run.distance + 170) {
      const z = state.spawn.nextGateZ;
      addGate(z - state.run.distance + 85);
      const spacing = lerp(42, 28, difficulty) * lerp(0.9, 1.15, rand());
      state.spawn.nextGateZ += spacing;
    }

    // Collision & gate checks around z ~ 0 (player position)
    const px = state.player.x;

    // Obstacles collision
    for (const o of state.objects) {
      if (o.type !== "tree" && o.type !== "rock") continue;
      if (o.z < 1.2 && o.z > -0.6) {
        const dx = Math.abs(o.x - px);
        if (dx < o.r + 0.10) {
          crash(o.type === "tree" ? "Hit a tree" : "Hit a rock");
          return;
        }
      }
    }

    // Gate pass: find pairs with same z-ish by matching passed flags
    // We'll treat each gateL as the gate definition; check when it crosses player.
    for (const o of state.objects) {
      if (o.type !== "gateL" || o.passed) continue;
      if (o.z < 0.7 && o.z > -0.7) {
        const center = o.center;
        const width = o.width;
        const half = width / 2;
        const ok = (px > (center - half + 0.06)) && (px < (center + half - 0.06));
        o.passed = true;
        // mark matching gateR at similar z
        for (const r of state.objects) {
          if (r.type === "gateR" && !r.passed && Math.abs(r.z - o.z) < 0.8 && Math.abs(r.center - center) < 0.001) {
            r.passed = true;
            break;
          }
        }

        if (ok) {
          state.run.streak = clamp(state.run.streak + 1, 0, 10);
          updateStreakUI();
          if (state.run.streak === 10) footerHint.textContent = "Max streak! You're flying.";
          else footerHint.textContent = "Nice gate! Streak boosts speed.";
          state.camera.shake = Math.min(0.35, state.camera.shake + 0.12);
        } else {
          state.run.streak = 0;
          updateStreakUI();
          footerHint.textContent = "Missed gate—streak reset.";
          state.camera.shake = Math.min(0.4, state.camera.shake + 0.18);
        }
      }
    }

    state.camera.shake *= Math.exp(-3.2 * dt);

    cullOld();

    // Best updates while running (for HUD only)
    if (state.run.distance > best) {
      best = state.run.distance;
      hudBest.textContent = String(Math.floor(best));
    }

    updateHUD();
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;

    // Camera shake
    const shake = state.camera.shake;
    const sx = (rand() * 2 - 1) * shake * 10 * dpr;
    const sy = (rand() * 2 - 1) * shake * 10 * dpr;

    ctx.save();
    ctx.translate(sx, sy);

    // Background sky + fog
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0c2a3d");
    sky.addColorStop(0.55, "#081a25");
    sky.addColorStop(1, "#06131d");
    ctx.fillStyle = sky;
    ctx.fillRect(-50, -50, w + 100, h + 100);

    // Slope: first-person trapezoid
    const horizonY = h * 0.28;
    const baseY = h * 1.05;
    const slopeTopW = w * 0.22;
    const slopeBotW = w * 1.4;

    const centerX = w / 2 + state.player.x * w * 0.13; // perspective drift
    const leftTopX = centerX - slopeTopW / 2;
    const rightTopX = centerX + slopeTopW / 2;
    const leftBotX = centerX - slopeBotW / 2;
    const rightBotX = centerX + slopeBotW / 2;

    // Snow gradient
    const snow = ctx.createLinearGradient(0, horizonY, 0, h);
    snow.addColorStop(0, "#d8f2ff");
    snow.addColorStop(0.45, "#bfe8ff");
    snow.addColorStop(1, "#8fd0f2");

    ctx.beginPath();
    ctx.moveTo(leftTopX, horizonY);
    ctx.lineTo(rightTopX, horizonY);
    ctx.lineTo(rightBotX, baseY);
    ctx.lineTo(leftBotX, baseY);
    ctx.closePath();
    ctx.fillStyle = snow;
    ctx.fill();

    // Snow texture lines (motion)
    const sp = clamp(state.run.speed / 55, 0, 1);
    const lineCount = 26;
    for (let i = 0; i < lineCount; i++) {
      const t = i / (lineCount - 1);
      const y = lerp(horizonY + 10 * dpr, h, t);
      const widthAtY = lerp(slopeTopW, slopeBotW, Math.pow(t, 1.05));
      const x0 = centerX - widthAtY / 2;
      const x1 = centerX + widthAtY / 2;

      const phase = (state.time * (0.8 + 1.7 * sp) + i * 0.21) % 1;
      const alpha = 0.08 * (1 - t) + 0.10 * sp;
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, (1.0 + 1.2 * sp) * dpr);

      const segs = 6;
      for (let s = 0; s < segs; s++) {
        const tt0 = (s / segs);
        const tt1 = ((s + 0.6) / segs);
        const ox = (Math.sin((phase + tt0) * Math.PI * 2 + i) * 0.012 + state.input.steer * 0.02) * widthAtY;
        ctx.beginPath();
        ctx.moveTo(lerp(x0, x1, tt0) + ox, y);
        ctx.lineTo(lerp(x0, x1, tt1) + ox, y);
        ctx.stroke();
      }
    }

    // Side trees silhouette
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, horizonY, Math.max(0, leftTopX), h - horizonY);
    ctx.fillRect(Math.min(w, rightTopX), horizonY, Math.max(0, w - rightTopX), h - horizonY);

    // Draw objects (project from x,z to screen)
    // Projection: z ahead -> y on screen
    function project(xNorm, zRel) {
      // zRel: 0 at player, positive ahead
      const z = Math.max(0.6, zRel + 0.8);
      const t = 1 / z; // smaller with distance
      const y = lerp(horizonY, h * 1.02, 1 - clamp(t * 0.55, 0, 1));
      const widthAtY = lerp(slopeTopW, slopeBotW, Math.pow((y - horizonY) / Math.max(1, (h - horizonY)), 1.05));
      const x = centerX + xNorm * (widthAtY * 0.52);
      const scale = clamp(1.55 * t, 0.04, 1.2);
      return { x, y, scale, widthAtY };
    }

    // Sort far to near for nicer layering
    const objs = state.objects.slice().sort((a, b) => b.z - a.z);

    for (const o of objs) {
      const p = project(o.x, o.z);
      if (p.y < horizonY - 30 || p.y > h + 120) continue;

      if (o.type === "tree") {
        const s = o.r * 280 * dpr * (1 / Math.max(0.7, o.z + 0.9));
        const trunkW = s * 0.22;
        const trunkH = s * 0.35;

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.14)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + s * 0.16, s * 0.55, s * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();

        // Trunk
        ctx.fillStyle = "rgba(72,52,40,0.95)";
        ctx.fillRect(p.x - trunkW / 2, p.y - trunkH * 0.2, trunkW, trunkH);

        // Foliage
        const g = ctx.createLinearGradient(0, p.y - s, 0, p.y + s);
        g.addColorStop(0, "#0ef0a2");
        g.addColorStop(0.6, "#0b8a67");
        g.addColorStop(1, "#04513d");
        ctx.fillStyle = g;

        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.05);
        ctx.lineTo(p.x - s * 0.75, p.y + s * 0.20);
        ctx.lineTo(p.x + s * 0.75, p.y + s * 0.20);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.ellipse(p.x - s * 0.15, p.y - s * 0.35, s * 0.22, s * 0.12, -0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.type === "rock") {
        const s = o.r * 300 * dpr * (1 / Math.max(0.7, o.z + 0.9));
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + s * 0.18, s * 0.65, s * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();

        const rg = ctx.createLinearGradient(p.x - s, p.y - s, p.x + s, p.y + s);
        rg.addColorStop(0, "#cdd6dc");
        rg.addColorStop(0.55, "#7e8f9b");
        rg.addColorStop(1, "#4a5e6b");
        ctx.fillStyle = rg;

        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.8, p.y + s * 0.15);
        ctx.lineTo(p.x - s * 0.25, p.y - s * 0.6);
        ctx.lineTo(p.x + s * 0.75, p.y - s * 0.12);
        ctx.lineTo(p.x + s * 0.55, p.y + s * 0.55);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.stroke();
      } else if (o.type === "gateL" || o.type === "gateR") {
        // Flags: poles + cloth
        const z = Math.max(0.7, o.z + 0.9);
        const poleH = (220 / z) * dpr;
        const poleW = Math.max(2, (7 / z) * dpr);
        const baseY = p.y;
        const topY = p.y - poleH;

        // Pole shadow
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = poleW * 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x + poleW * 0.5, topY + poleW * 2);
        ctx.lineTo(p.x + poleW * 0.5, baseY + poleW * 2);
        ctx.stroke();

        // Pole
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = poleW;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, topY);
        ctx.lineTo(p.x, baseY);
        ctx.stroke();

        const side = (o.type === "gateL") ? -1 : 1;
        const clothW = (120 / z) * dpr;
        const clothH = (70 / z) * dpr;

        const baseColor = o.passed ? "rgba(255,255,255,0.45)" : (o.type === "gateL" ? "rgba(71,209,255,0.95)" : "rgba(124,255,185,0.95)");
        ctx.fillStyle = baseColor;

        // Cloth triangle
        ctx.beginPath();
        ctx.moveTo(p.x, topY + clothH * 0.45);
        ctx.lineTo(p.x + side * clothW, topY + clothH * 0.58);
        ctx.lineTo(p.x, topY + clothH * 1.2);
        ctx.closePath();
        ctx.fill();

        // Small cap
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.beginPath();
        ctx.arc(p.x, topY, Math.max(2, (10 / z) * dpr), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Skis / tips
    const skiY = h * 0.92;
    const skiGap = w * 0.11;
    const skiLen = h * 0.22;
    const tipCurve = h * 0.03;
    const skiW = Math.max(3 * dpr, w * 0.012);
    const carve = state.input.steer;

    function drawSki(side) {
      const x = w / 2 + side * skiGap + carve * w * 0.02;
      const y0 = skiY - skiLen;
      const y1 = skiY;
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = skiW * 1.55;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(x + side * tipCurve * 0.9, y0 - tipCurve, x + side * tipCurve * 1.3, y0 + tipCurve * 0.2);
      ctx.lineTo(x, y1);
      ctx.stroke();

      const grad = ctx.createLinearGradient(x, y0, x, y1);
      grad.addColorStop(0, "rgba(71,209,255,0.95)");
      grad.addColorStop(1, "rgba(255,255,255,0.92)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = skiW;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(x + side * tipCurve * 0.9, y0 - tipCurve, x + side * tipCurve * 1.3, y0 + tipCurve * 0.2);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }

    drawSki(-1);
    drawSki(1);

    // Vignette
    const vg = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.2, w / 2, h * 0.55, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // Center marker (subtle) when paused/menu
    if (state.mode !== "running") {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(1, 2 * dpr);
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.46);
      ctx.lineTo(w / 2, h * 0.54);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.47, h * 0.50);
      ctx.lineTo(w * 0.53, h * 0.50);
      ctx.stroke();
    }

    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;

    resizeCanvas();

    if (state.mode === "running" && state.run.alive) {
      step(dt);
    }

    draw();
    requestAnimationFrame(frame);
  }

  function init() {
    loadBest();
    loadSettings();
    applySettings();

    // Initial overlay state
    setMode("menu");
    resetRun("menu");
    updateHUD();
    updateStreakUI();

    // Try to enable tilt on iOS with a gentle hint when user toggles it on.
    optTilt.addEventListener("change", async () => {
      if (!optTilt.checked) {
        state.input.tiltSteer = 0;
        return;
      }
      // iOS requires permission; request only if API exists.
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === "function") {
        try {
          const res = await D.requestPermission();
          if (res !== "granted") {
            optTilt.checked = false;
            saveSettings();
            showToast("Tilt permission denied");
          } else {
            showToast("Tilt enabled");
          }
        } catch {
          optTilt.checked = false;
          saveSettings();
          showToast("Tilt unavailable");
        }
      } else {
        showToast("Tilt enabled");
      }
    });

    // Ensure overlay result numbers sync
    const syncOverlayStats = () => {
      runDistance.textContent = String(Math.floor(state.run.distance));
      bestDistance.textContent = String(Math.floor(best));
    };
    window.setInterval(syncOverlayStats, 250);

    // Harmless short script behavior: log slug once
    console.log("Deploy slug: app-0006");

    requestAnimationFrame(frame);
  }

  init();
})();
