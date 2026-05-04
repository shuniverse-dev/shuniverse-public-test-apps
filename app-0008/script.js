(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const canvas = $("#game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const ui = {
    score: $("#score"),
    best: $("#best"),
    coins: $("#coins"),
    overlay: $("#overlay"),
    btnPlay: $("#btnPlay"),
    btnHow: $("#btnHow"),
    howPanel: $("#howPanel"),
    btnPause: $("#btnPause"),
    btnRestart: $("#btnRestart"),
    hintText: $("#hint .hintText"),
    toast: $("#toast"),
    btnLeft: $("#btnLeft"),
    btnRight: $("#btnRight"),
    btnJump: $("#btnJump"),
  };

  const STORAGE_KEY = "app-0008-bomb-jump-best";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadBest() {
    const v = Number(localStorage.getItem(STORAGE_KEY) || "0");
    return Number.isFinite(v) ? v : 0;
  }
  function saveBest(v) {
    localStorage.setItem(STORAGE_KEY, String(v));
  }

  // Prevent scrolling while interacting with the playfield and controls on mobile.
  const preventScroll = (e) => {
    // Allow within overlay card
    if (ui.overlay && !ui.overlay.hidden && ui.overlay.getAttribute("aria-hidden") === "false") return;
    e.preventDefault();
  };
  ["touchmove", "wheel"].forEach((ev) => {
    canvas.addEventListener(ev, preventScroll, { passive: false });
    ui.btnLeft.addEventListener(ev, preventScroll, { passive: false });
    ui.btnRight.addEventListener(ev, preventScroll, { passive: false });
    ui.btnJump.addEventListener(ev, preventScroll, { passive: false });
  });

  // Resize with device pixel ratio for crispness
  function resizeCanvasToCSS() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    }
    return { w, h, dpr };
  }

  // Game state
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    t: 0,
    lastTs: 0,
    score: 0,
    coins: 0,
    best: loadBest(),
    msgT: 0,
    cameraX: 0,

    // difficulty scaling
    baseSpeed: 165, // px/s relative to world movement
    speed: 165,
    gravity: 1200,
    jumpVel: 520,
    maxFall: 980,

    input: {
      left: false,
      right: false,
      jumpPressed: false,
      jumpHeld: false,
      jumpBuffer: 0,
      coyote: 0,
    },
  };

  ui.best.textContent = String(state.best);

  const world = {
    platforms: [],
    hazards: [],
    coins: [],
    // world x increases to right; player stays around left third
    nextSpawnX: 0,
    lastSafeY: 0,
  };

  const player = {
    x: 120,
    y: 0,
    w: 34,
    h: 38,
    vx: 0,
    vy: 0,
    onGround: false,
    face: 1,
    invuln: 0,
  };

  function resetRun() {
    const { w, h } = resizeCanvasToCSS();
    state.running = false;
    state.paused = false;
    state.gameOver = false;
    state.t = 0;
    state.lastTs = 0;
    state.score = 0;
    state.coins = 0;
    state.cameraX = 0;
    state.speed = state.baseSpeed;

    state.input.left = false;
    state.input.right = false;
    state.input.jumpPressed = false;
    state.input.jumpHeld = false;
    state.input.jumpBuffer = 0;
    state.input.coyote = 0;

    player.x = 120;
    player.y = h - 130;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.face = 1;
    player.invuln = 0;

    world.platforms = [];
    world.hazards = [];
    world.coins = [];
    world.nextSpawnX = 0;
    world.lastSafeY = player.y;

    // Starter ground
    const groundY = h - 78;
    spawnPlatform(0, groundY, w + 220, 44, "ground");
    // A few starter platforms
    spawnPlatform(w * 0.72, groundY - 84, 140, 18, "brick");
    spawnCoin(w * 0.72 + 70, groundY - 118);
    spawnPlatform(w * 1.02, groundY - 136, 130, 18, "brick");
    spawnCoin(w * 1.02 + 60, groundY - 170);
    spawnPlatform(w * 1.30, groundY - 60, 150, 18, "brick");

    world.nextSpawnX = w * 1.55;

    syncHUD();
    setHint("Tap Play to start");
    ui.btnPause.textContent = "Pause";
    ui.btnPause.setAttribute("aria-pressed", "false");
  }

  function setOverlay(show) {
    ui.overlay.style.display = show ? "grid" : "none";
    ui.overlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function toast(text, ms = 1200) {
    ui.toast.innerHTML = `<div>${escapeHtml(text)}</div>`;
    ui.toast.classList.add("show");
    clearTimeout(state.msgT);
    state.msgT = window.setTimeout(() => ui.toast.classList.remove("show"), ms);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }

  function setHint(text) {
    ui.hintText.textContent = text;
  }

  function syncHUD() {
    ui.score.textContent = String(Math.floor(state.score));
    ui.coins.textContent = String(state.coins);
    ui.best.textContent = String(state.best);
  }

  function spawnPlatform(x, y, w, h, kind = "brick") {
    world.platforms.push({ x, y, w, h, kind });
  }

  function spawnSpike(x, y, w, h) {
    world.hazards.push({ x, y, w, h, kind: "spike" });
  }

  function spawnCoin(x, y) {
    world.coins.push({ x, y, r: 10, taken: false, bob: Math.random() * Math.PI * 2 });
  }

  function ensureSpawns(viewW, viewH) {
    // Generate ahead relative to camera
    const maxAhead = state.cameraX + viewW * 2.2;

    // Keep a baseline ground with occasional gaps
    const groundY = viewH - 78;

    while (world.nextSpawnX < maxAhead) {
      const x = world.nextSpawnX;

      // Speed scale with score (gentle)
      state.speed = state.baseSpeed + Math.min(220, state.score * 0.18);

      // Gap chance increases over time but stays reasonable
      const gapChance = clamp(0.08 + state.score / 2500, 0.08, 0.32);
      const makeGap = Math.random() < gapChance;

      const segW = randRange(220, 340);
      if (!makeGap) {
        spawnPlatform(x, groundY, segW, 44, "ground");
        // occasional spikes on ground segments
        const spikeChance = clamp(0.10 + state.score / 4000, 0.10, 0.28);
        if (Math.random() < spikeChance) {
          const sw = randRange(34, 60);
          const sx = x + randRange(70, segW - 70);
          spawnSpike(sx, groundY - 18, sw, 18);
        }
      }

      // Floating platform(s)
      const platChance = clamp(0.55 + state.score / 3500, 0.55, 0.82);
      if (Math.random() < platChance) {
        const pw = randRange(110, 170);
        const py = groundY - randRange(70, 170);
        const px = x + randRange(40, segW - 40 - pw);
        spawnPlatform(px, py, pw, 18, "brick");

        // coin above
        if (Math.random() < 0.72) spawnCoin(px + pw / 2, py - 28);

        // occasional spike on platform
        if (Math.random() < clamp(0.06 + state.score / 5500, 0.06, 0.20)) {
          const sw = randRange(28, Math.min(52, pw - 18));
          spawnSpike(px + (pw - sw) / 2, py - 18, sw, 18);
        }
      }

      // Add another mid platform sometimes to make routes
      if (Math.random() < clamp(0.25 + state.score / 6000, 0.25, 0.40)) {
        const pw = randRange(90, 150);
        const py = groundY - randRange(110, 220);
        const px = x + randRange(80, segW - 40 - pw);
        spawnPlatform(px, py, pw, 18, "brick");
        if (Math.random() < 0.78) spawnCoin(px + pw / 2, py - 28);
      }

      world.nextSpawnX += segW + (makeGap ? randRange(60, 140) : 0);
    }

    // Cleanup old objects
    const minX = state.cameraX - viewW * 0.4;
    world.platforms = world.platforms.filter(p => p.x + p.w > minX);
    world.hazards = world.hazards.filter(h => h.x + h.w > minX);
    world.coins = world.coins.filter(c => (c.x + 30 > minX) && !c.taken);
  }

  function randRange(a, b) {
    return a + Math.random() * (b - a);
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx;
    const dy = cy - ny;
    return (dx * dx + dy * dy) <= r * r;
  }

  function startGame() {
    if (state.gameOver) resetRun();
    setOverlay(false);
    state.running = true;
    state.paused = false;
    state.lastTs = performance.now();
    ui.btnPause.textContent = "Pause";
    ui.btnPause.setAttribute("aria-pressed", "false");
    setHint("Go! Jump and collect coins");
    toast("Run!");
    requestAnimationFrame(loop);
  }

  function pauseToggle() {
    if (!state.running && !state.gameOver) return;
    state.paused = !state.paused;
    ui.btnPause.textContent = state.paused ? "Resume" : "Pause";
    ui.btnPause.setAttribute("aria-pressed", state.paused ? "true" : "false");
    setHint(state.paused ? "Paused" : "Running");
    if (!state.paused) {
      state.lastTs = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function gameOver(reason = "Ouch!") {
    state.running = false;
    state.gameOver = true;
    setHint("Tap Restart to try again");
    toast(reason, 1400);
    if (state.score > state.best) {
      state.best = Math.floor(state.score);
      saveBest(state.best);
      syncHUD();
      toast("New best!", 1400);
    }
    // Keep overlay hidden so user can immediately hit Restart / controls
  }

  function applyInput(dt) {
    const accel = 1600;
    const maxVx = 265;
    const friction = 2200;

    let target = 0;
    if (state.input.left) target -= 1;
    if (state.input.right) target += 1;
    if (target !== 0) player.face = target;

    if (target !== 0) {
      player.vx += target * accel * dt;
    } else {
      // friction to 0
      const sign = Math.sign(player.vx);
      const mag = Math.abs(player.vx);
      const dec = friction * dt;
      player.vx = sign * Math.max(0, mag - dec);
    }
    player.vx = clamp(player.vx, -maxVx, maxVx);

    // Jump buffering + coyote time
    if (state.input.jumpPressed) {
      state.input.jumpBuffer = 0.14;
      state.input.jumpPressed = false;
    } else {
      state.input.jumpBuffer = Math.max(0, state.input.jumpBuffer - dt);
    }
    state.input.coyote = Math.max(0, state.input.coyote - dt);

    const canJump = (player.onGround || state.input.coyote > 0);
    if (state.input.jumpBuffer > 0 && canJump) {
      player.vy = -state.jumpVel;
      player.onGround = false;
      state.input.jumpBuffer = 0;
      state.input.coyote = 0;
      toast("Jump!", 600);
    }

    // variable jump height
    if (!state.input.jumpHeld && player.vy < -160) {
      player.vy *= 0.65;
    }
  }

  function physics(dt, viewW, viewH) {
    // World autoscroll; player progresses in score by time
    const scroll = state.speed * dt;
    state.cameraX += scroll;
    state.score += scroll * 0.04; // tune scoring
    syncHUD();

    // Gravity
    player.vy += state.gravity * dt;
    player.vy = Math.min(player.vy, state.maxFall);

    // Integrate
    let nx = player.x + player.vx * dt;
    let ny = player.y + player.vy * dt;

    // Collide with platforms (simple AABB; prioritize vertical)
    player.onGround = false;

    // Horizontal boundaries (keep player on screen with some margin)
    const minX = 18;
    const maxX = viewW - player.w - 18;
    nx = clamp(nx, minX, maxX);

    // Compute player world x position relative to camera: player is screen-space; platforms are world-space.
    // Convert player to world-space for collision by adding cameraX - fixedScreenAnchor (anchor is 0).
    const pWorldX = state.cameraX + nx;
    const pWorldY = ny;

    // Vertical collisions
    const prevWorldY = player.y;
    const prevBottom = prevWorldY + player.h;
    const nextBottom = pWorldY + player.h;

    // Coyote time if just left ground
    const wasOnGround = player.onGround;

    // Check against platforms for landing
    for (const plat of world.platforms) {
      const rx = plat.x;
      const ry = plat.y;
      const rw = plat.w;
      const rh = plat.h;

      // Only collide if horizontally overlapping (in world coords)
      if (pWorldX + player.w <= rx || pWorldX >= rx + rw) continue;

      // Falling: crossing top surface
      const top = ry;
      const prevB = (state.cameraX + player.x >= 0) ? (player.y + player.h) : prevBottom;
      // Use screen-space prevB; y is same in world and screen because camera only moves x
      if (player.vy >= 0 && prevB <= top && nextBottom >= top) {
        // Land
        ny = top - player.h;
        player.vy = 0;
        player.onGround = true;
      }
    }

    if (!player.onGround && (player.vy > 0) && (Math.abs(player.vy) < 10)) {
      // no-op; placeholder
    }

    // Update after vertical resolution
    player.x = nx;
    player.y = ny;

    if (player.onGround) {
      state.input.coyote = 0.12;
    } else if (player.vy > 0 && state.input.coyote <= 0.0001) {
      // If we just stepped off, give coyote; detect by checking near platform underfoot
      // We'll keep it simple: if vy>0 and was on ground in last frame is unknown; use small grace based on vy
      // (coyote is primarily set when on ground; leaving will keep it counting down)
    }

    // Coins
    const pWX = state.cameraX + player.x;
    const pWY = player.y;
    for (const c of world.coins) {
      if (c.taken) continue;
      if (circleRectOverlap(c.x, c.y, c.r, pWX, pWY, player.w, player.h)) {
        c.taken = true;
        state.coins += 1;
        state.score += 12;
        toast("+1 coin", 700);
        syncHUD();
      }
    }

    // Hazards
    for (const hz of world.hazards) {
      if (rectsOverlap(pWX, pWY, player.w, player.h, hz.x, hz.y, hz.w, hz.h)) {
        gameOver("Boom! Spikes.");
        break;
      }
    }

    // Fall out of world
    if (player.y > viewH + 120) {
      gameOver("Fell!");
    }
  }

  function draw(viewW, viewH) {
    // background
    ctx.clearRect(0, 0, viewW, viewH);

    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, "#24335f");
    g.addColorStop(1, "#0a1024");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    // Parallax hills
    drawHills(viewW, viewH);

    // Draw objects with camera transform (x only)
    const cam = state.cameraX;

    // Platforms
    for (const p of world.platforms) {
      const sx = p.x - cam;
      if (sx > viewW + 200 || sx + p.w < -200) continue;
      if (p.kind === "ground") {
        drawGround(sx, p.y, p.w, p.h);
      } else {
        drawBrick(sx, p.y, p.w, p.h);
      }
    }

    // Coins
    for (const c of world.coins) {
      if (c.taken) continue;
      const sx = c.x - cam;
      if (sx > viewW + 80 || sx < -80) continue;
      c.bob += 0.06;
      const by = c.y + Math.sin(c.bob) * 4;
      drawCoin(sx, by, c.r);
    }

    // Hazards
    for (const h of world.hazards) {
      const sx = h.x - cam;
      if (sx > viewW + 120 || sx + h.w < -120) continue;
      drawSpikes(sx, h.y, h.w, h.h);
    }

    // Player (screen space)
    drawPlayer(player.x, player.y, player.w, player.h);

    // HUD line on canvas (minimal)
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(10, 10, 160, 34);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(`💣 x1   Coins ${state.coins}`, 18, 32);
    ctx.restore();

    if (!state.running && !state.gameOver) {
      // attract text behind overlay (in case overlay hidden by user agent)
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.fillText("Tap Play", viewW / 2, viewH / 2);
      ctx.restore();
    }

    if (state.paused) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#eef2ff";
      ctx.font = "900 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.fillText("Paused", viewW / 2, viewH / 2);
      ctx.restore();
    }

    if (state.gameOver) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.40)";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#eef2ff";
      ctx.font = "950 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.fillText("Game Over", viewW / 2, viewH / 2 - 10);
      ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(238,242,255,.88)";
      ctx.fillText("Tap Restart", viewW / 2, viewH / 2 + 18);
      ctx.restore();
    }
  }

  function drawHills(w, h) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    const cam = state.cameraX;

    const layers = [
      { amp: 22, base: h - 80, color: "rgba(124,92,255,.22)", speed: 0.22 },
      { amp: 34, base: h - 58, color: "rgba(46,229,157,.18)", speed: 0.35 },
      { amp: 16, base: h - 98, color: "rgba(255,255,255,.08)", speed: 0.14 },
    ];

    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const offset = (cam * L.speed) % 240;
      for (let x = 0; x <= w + 24; x += 24) {
        const y = L.base + Math.sin((x + offset) / 90) * L.amp + Math.sin((x + offset) / 37) * (L.amp * 0.35);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawGround(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(x, y + 3, w, h);
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(255,206,58,.55)");
    grad.addColorStop(1, "rgba(255,77,109,.35)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // grass line
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(x, y, w, 4);

    // texture blocks
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = "rgba(255,255,255,.60)";
    for (let i = 0; i < w; i += 34) {
      ctx.fillRect(x + i + 6, y + 10, 10, 8);
    }
    ctx.restore();
  }

  function drawBrick(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(x, y + 3, w, h);

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(255,255,255,.18)");
    grad.addColorStop(1, "rgba(255,255,255,.08)");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);
    ctx.stroke();

    // brick lines
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h / 2);
    ctx.lineTo(x + w - 8, y + h / 2);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < w; i += 38) {
      ctx.moveTo(x + i + 12, y + 4);
      ctx.lineTo(x + i + 12, y + h - 4);
    }
    ctx.stroke();

    ctx.restore();
  }

  function drawCoin(x, y, r) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r * 1.2);
    grad.addColorStop(0, "rgba(255,255,255,.95)");
    grad.addColorStop(0.35, "rgba(255,206,58,.95)");
    grad.addColorStop(1, "rgba(255,140,0,.85)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, r * 0.45, 0.2, 1.9);
    ctx.stroke();

    ctx.restore();
  }

  function drawSpikes(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(x, y + 2, w, h);

    const spikes = Math.max(2, Math.floor(w / 14));
    const sw = w / spikes;

    for (let i = 0; i < spikes; i++) {
      const x0 = x + i * sw;
      const x1 = x0 + sw;
      const xm = (x0 + x1) / 2;

      ctx.beginPath();
      ctx.moveTo(x0, y + h);
      ctx.lineTo(xm, y);
      ctx.lineTo(x1, y + h);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, "rgba(255,77,109,.95)");
      grad.addColorStop(1, "rgba(255,77,109,.55)");
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(x, y, w, h) {
    // Body as rounded capsule with emoji face
    ctx.save();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,.30)";
    roundRect(ctx, x + 2, y + 6, w, h, 14);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(255,255,255,.16)");
    grad.addColorStop(1, "rgba(255,255,255,.08)");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
    ctx.stroke();

    // Draw emoji centered
    ctx.font = "28px system-ui, Apple Color Emoji, Segoe UI Emoji";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💣", x + w / 2, y + h / 2 + 1);

    // Tiny motion trail when moving fast
    const speed = Math.abs(player.vx);
    if (speed > 170) {
      ctx.globalAlpha = 0.25;
      ctx.fillText("💥", x + w / 2 - player.face * 18, y + h / 2 + 3);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

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

  function loop(ts) {
    if (!state.running || state.paused) return;

    const { w, h } = resizeCanvasToCSS();
    const dt = clamp((ts - state.lastTs) / 1000, 0, 0.033);
    state.lastTs = ts;

    ensureSpawns(w, h);

    applyInput(dt);
    physics(dt, w, h);
    draw(w, h);

    if (state.running) requestAnimationFrame(loop);
  }

  // Input bindings
  function bindHold(btn, onDown, onUp) {
    const down = (e) => { e.preventDefault(); onDown(); };
    const up = (e) => { e.preventDefault(); onUp(); };

    btn.addEventListener("pointerdown", (e) => {
      btn.setPointerCapture?.(e.pointerId);
      down(e);
    });
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", (e) => {
      // If pointer leaves while pressed, still release to avoid stuck input
      if (e.buttons) up(e);
    });
  }

  bindHold(ui.btnLeft,
    () => { state.input.left = true; },
    () => { state.input.left = false; }
  );
  bindHold(ui.btnRight,
    () => { state.input.right = true; },
    () => { state.input.right = false; }
  );
  bindHold(ui.btnJump,
    () => { state.input.jumpHeld = true; state.input.jumpPressed = true; },
    () => { state.input.jumpHeld = false; }
  );

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "a" || k === "arrowleft") state.input.left = true;
    if (k === "d" || k === "arrowright") state.input.right = true;
    if (k === " " || k === "arrowup" || k === "w") {
      state.input.jumpHeld = true;
      state.input.jumpPressed = true;
      e.preventDefault();
    }
    if (k === "p") pauseToggle();
    if (k === "r") {
      resetRun();
      startGame();
    }
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "a" || k === "arrowleft") state.input.left = false;
    if (k === "d" || k === "arrowright") state.input.right = false;
    if (k === " " || k === "arrowup" || k === "w") state.input.jumpHeld = false;
  });

  // Buttons
  ui.btnPlay.addEventListener("click", () => startGame());
  ui.btnRestart.addEventListener("click", () => {
    resetRun();
    startGame();
  });
  ui.btnPause.addEventListener("click", () => pauseToggle());

  ui.btnHow.addEventListener("click", () => {
    const expanded = ui.btnHow.getAttribute("aria-expanded") === "true";
    ui.btnHow.setAttribute("aria-expanded", expanded ? "false" : "true");
    ui.howPanel.hidden = expanded;
  });

  // Tap canvas to jump (nice on mobile); double-tap not required
  canvas.addEventListener("pointerdown", (e) => {
    // If overlay is up, ignore; let Play button do it.
    if (ui.overlay.getAttribute("aria-hidden") === "false") return;
    e.preventDefault();
    // Quick jump action
    state.input.jumpHeld = true;
    state.input.jumpPressed = true;
    window.setTimeout(() => { state.input.jumpHeld = false; }, 90);
  });

  // Start state
  resetRun();
  setOverlay(true);
  resizeCanvasToCSS();
  draw(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);

  // Small harmless script behavior: keep best synced if storage changes (multiple tabs)
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      state.best = loadBest();
      syncHUD();
    }
  });
})();
