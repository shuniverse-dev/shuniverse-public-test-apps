(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const $ = (id) => document.getElementById(id);
  const scoreEl = $('score');
  const gemsEl = $('gems');
  const gemsTotalEl = $('gemsTotal');
  const levelEl = $('level');
  const movesEl = $('moves');
  const statusEl = $('status');
  const restartBtn = $('restartBtn');
  const nextBtn = $('nextBtn');

  const overlay = $('overlay');
  const overlayTitle = $('overlayTitle');
  const overlayText = $('overlayText');
  const overlayRestart = $('overlayRestart');
  const overlayNext = $('overlayNext');

  // Tile types
  const T = {
    EMPTY: 0,
    WALL: 1,
    DIRT: 2,
    ROCK: 3,
    GEM: 4,
    EXIT_CLOSED: 5,
    EXIT_OPEN: 6,
    PLAYER: 7
  };

  const COLORS = {
    bg1: '#0a0f16',
    bg2: '#0b1522',
    wall1: '#2a3b57',
    wall2: '#1d2a40',
    dirt1: '#6b4a2f',
    dirt2: '#7b5638',
    rock1: '#a0a6b2',
    rock2: '#717887',
    gem1: '#7af0ff',
    gem2: '#2fd0ff',
    exitClosed1: '#7f96b8',
    exitClosed2: '#4b5f7a',
    exitOpen1: '#66ffa6',
    exitOpen2: '#1adf7b',
    player1: '#ffd36b',
    player2: '#ff8b3d',
    danger: '#ff5b6b'
  };

  // Levels (fixed-size rectangular ASCII maps)
  // Legend: # wall, . dirt, space empty, O rock, * gem, X exit
  const LEVELS = [
`############################
#............O....*....O...X#
#..####..######..#######..###
#..#  #..#    #..#.....#....#
#..#  #..# OO #..#.***.#.O..#
#..####..#    #..#.....#....#
#........######..#######..###
#..*.....O....*....O........#
#..####..######..#######..###
#..#  #..#    #..#.....#....#
#..#  #..#  * #..#..O..#....#
#..####..#    #..#.....#..O.#
#............O....*....O....#
#P......................... .#
############################`,
`############################
#....*.......O.....*.....X..#
#.######..###########..######
#.#....#..#.........#..#....#
#.#.OO.#..#.***.O...#..#.O..#
#.#....#..#.........#..#....#
#.######..#####.#####..######
#..............O............ #
#.######..#####.#####..######
#.#....#..#.........#..#....#
#.#.O..#..#...O.***.#..#.OO.#
#.#....#..#.........#..#....#
#.######..###########..######
#P....*........O..........*..#
############################`,
`############################
#P....O..*....O....*....O..X#
#..####..######..#######..###
#..#..#..#....#..#.....#....#
#..#..#..#.OO.#..#.***.#.OO.#
#..#..#..#....#..#.....#....#
#..####..######..#######..###
#........O....*....O........#
#..####..######..#######..###
#..#..#..#....#..#.....#....#
#..#..#..#..* #..#..O..#....#
#..#..#..#....#..#.....#..O.#
#..####..######..#######....#
#.............*............. #
############################`
  ];

  // Game config
  const BASE_TILE = 28; // logical tile size; scaled to fit canvas
  const TICK_MS = 95;   // physics tick

  let state;

  function parseLevel(ascii) {
    const rows = ascii.replace(/\r/g, '').split('\n');
    const h = rows.length;
    const w = Math.max(...rows.map(r => r.length));

    const grid = Array.from({ length: h }, () => new Array(w).fill(T.EMPTY));
    let player = { x: 1, y: 1 };
    let exit = { x: 1, y: 1, open: false };
    let gemsTotal = 0;

    for (let y = 0; y < h; y++) {
      const r = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = r[x] ?? ' ';
        let t = T.EMPTY;
        if (ch === '#') t = T.WALL;
        else if (ch === '.') t = T.DIRT;
        else if (ch === 'O') t = T.ROCK;
        else if (ch === '*') { t = T.GEM; gemsTotal++; }
        else if (ch === 'X') { t = T.EXIT_CLOSED; exit = { x, y, open: false }; }
        else if (ch === 'P') { t = T.EMPTY; player = { x, y }; }
        else t = T.EMPTY;
        grid[y][x] = t;
      }
    }

    // Ensure outer boundaries are walls if map had short lines (pad)
    // (We won't auto-wall everything; just keep as parsed.)

    return { grid, w, h, player, exit, gemsTotal };
  }

  function cloneGrid(g) {
    return g.map(row => row.slice());
  }

  function setStatus(text, kind = 'playing') {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function startLevel(levelIndex, keepScore = true) {
    const parsed = parseLevel(LEVELS[levelIndex]);

    state = {
      levelIndex,
      grid: parsed.grid,
      w: parsed.w,
      h: parsed.h,
      player: { ...parsed.player },
      exit: { ...parsed.exit },
      gemsTotal: parsed.gemsTotal,
      gems: 0,
      moves: 0,
      score: keepScore && state ? state.score : 0,
      alive: true,
      won: false,
      lastMoveDir: { x: 0, y: 1 },
      inputQueue: [],
      // For rock-fall killing: mark which rocks moved this tick
      movedThisTick: new Set()
    };

    levelEl.textContent = String(levelIndex + 1);
    nextBtn.disabled = true;
    setStatus('Playing');
    hideOverlay();
    updateHud();
    fitCanvasToLevel();
    draw();
  }

  function updateHud() {
    scoreEl.textContent = String(state.score);
    gemsEl.textContent = String(state.gems);
    gemsTotalEl.textContent = String(state.gemsTotal);
    movesEl.textContent = String(state.moves);
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < state.w && y < state.h;
  }

  function tileAt(x, y) {
    if (!inBounds(x, y)) return T.WALL;
    return state.grid[y][x];
  }

  function setTile(x, y, t) {
    if (!inBounds(x, y)) return;
    state.grid[y][x] = t;
  }

  function isSolid(t) {
    return t === T.WALL || t === T.ROCK || t === T.GEM || t === T.EXIT_CLOSED || t === T.EXIT_OPEN;
  }

  function isWalkable(t) {
    return t === T.EMPTY || t === T.DIRT || t === T.GEM || t === T.EXIT_OPEN;
  }

  function tryMovePlayer(dx, dy) {
    if (!state.alive || state.won) return;

    const px = state.player.x;
    const py = state.player.y;
    const nx = px + dx;
    const ny = py + dy;

    if (!inBounds(nx, ny)) return;

    const target = tileAt(nx, ny);

    // Push rock horizontally only
    if (target === T.ROCK && dy === 0) {
      const pushX = nx + dx;
      const pushY = ny;
      if (tileAt(pushX, pushY) === T.EMPTY) {
        setTile(pushX, pushY, T.ROCK);
        setTile(nx, ny, T.EMPTY);
        state.player.x = nx;
        state.player.y = ny;
        state.moves += 1;
        state.score += 1; // small movement/push reward
        state.lastMoveDir = { x: dx, y: dy };
      }
      return;
    }

    if (!isWalkable(target)) return;

    // Collect gem
    if (target === T.GEM) {
      state.gems += 1;
      state.score += 25;
      if (state.gems >= state.gemsTotal) {
        openExit();
      }
    }

    // Dig dirt
    if (target === T.DIRT) {
      state.score += 2;
    }

    // Exit
    if (target === T.EXIT_OPEN) {
      win();
      return;
    }

    // Move
    setTile(nx, ny, T.EMPTY);
    state.player.x = nx;
    state.player.y = ny;
    state.moves += 1;
    state.lastMoveDir = { x: dx, y: dy };
  }

  function openExit() {
    if (state.exit.open) return;
    state.exit.open = true;
    setTile(state.exit.x, state.exit.y, T.EXIT_OPEN);
    state.score += 50;
    setStatus('Exit open');
    updateHud();
  }

  function die(reason = 'Crushed') {
    if (!state.alive || state.won) return;
    state.alive = false;
    setStatus('Game over', 'dead');
    showOverlay('Game over', reason + '. Press Restart.');
    nextBtn.disabled = true;
    draw();
  }

  function win() {
    if (state.won) return;
    state.won = true;
    setStatus('Cleared', 'won');
    nextBtn.disabled = (state.levelIndex >= LEVELS.length - 1);
    const msg = state.levelIndex >= LEVELS.length - 1
      ? 'All caves cleared. Restart to play again.'
      : 'Cave cleared. Press Next to continue.';
    showOverlay('Cave cleared', msg);
    draw();
  }

  function rockOrGemFalls(t) {
    return t === T.ROCK || t === T.GEM;
  }

  function simulateGravity() {
    state.movedThisTick.clear();

    // Iterate bottom-up so objects fall one step per tick.
    for (let y = state.h - 2; y >= 0; y--) {
      for (let x = 0; x < state.w; x++) {
        const t = tileAt(x, y);
        if (!rockOrGemFalls(t)) continue;

        // Don't move the same object twice (after slide)
        const key = (y * state.w + x);
        if (state.movedThisTick.has(key)) continue;

        const below = tileAt(x, y + 1);
        const px = state.player.x;
        const py = state.player.y;

        const canFallInto = (tt) => tt === T.EMPTY;

        // Direct fall
        if (canFallInto(below)) {
          // If falling into player's cell (player is in empty only, but check anyway)
          if (px === x && py === y + 1) {
            // Falling object would occupy player
            setTile(x, y, T.EMPTY);
            setTile(x, y + 1, t);
            die('A falling ' + (t === T.ROCK ? 'rock' : 'gem') + ' crushed you');
            return;
          }
          setTile(x, y, T.EMPTY);
          setTile(x, y + 1, t);
          state.movedThisTick.add((y + 1) * state.w + x);
          continue;
        }

        // Slide rule: if below is rock or gem, it may roll off to sides if diagonals are empty
        if (below === T.ROCK || below === T.GEM) {
          const left = tileAt(x - 1, y);
          const downLeft = tileAt(x - 1, y + 1);
          if (left === T.EMPTY && downLeft === T.EMPTY) {
            // slide left
            if (px === x - 1 && py === y) {
              // player stands where it slides into; immediate crush
              setTile(x, y, T.EMPTY);
              setTile(x - 1, y, t);
              die('A rolling ' + (t === T.ROCK ? 'rock' : 'gem') + ' crushed you');
              return;
            }
            setTile(x, y, T.EMPTY);
            setTile(x - 1, y, t);
            state.movedThisTick.add(y * state.w + (x - 1));
            continue;
          }
          const right = tileAt(x + 1, y);
          const downRight = tileAt(x + 1, y + 1);
          if (right === T.EMPTY && downRight === T.EMPTY) {
            if (px === x + 1 && py === y) {
              setTile(x, y, T.EMPTY);
              setTile(x + 1, y, t);
              die('A rolling ' + (t === T.ROCK ? 'rock' : 'gem') + ' crushed you');
              return;
            }
            setTile(x, y, T.EMPTY);
            setTile(x + 1, y, t);
            state.movedThisTick.add(y * state.w + (x + 1));
            continue;
          }
        }

        // Crush player if object is directly above and player is in place and object is "unstable"?
        // In this simplified model, only moving objects can kill.
      }
    }
  }

  function applyInput() {
    // process at most one move per tick for classic feel
    const move = state.inputQueue.shift();
    if (!move) return;
    tryMovePlayer(move.dx, move.dy);
  }

  function tick() {
    if (!state) return;
    if (state.won) {
      draw();
      return;
    }
    if (!state.alive) {
      draw();
      return;
    }

    applyInput();
    simulateGravity();
    updateHud();
    draw();
  }

  // Rendering
  function fitCanvasToLevel() {
    // Pick integer tile size based on canvas CSS width (actual backing store will be scaled)
    // We'll compute a nice backing resolution while keeping crisp-ish look.
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

    // Set canvas internal size based on available layout width
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || 960);

    // Maintain aspect around level bounds
    const maxW = cssW;
    const tile = Math.floor(Math.max(16, Math.min(36, maxW / state.w)));

    state.render = {
      tile,
      dpr,
      pad: 10,
    };

    const wPx = Math.floor((state.w * tile + state.render.pad * 2) * dpr);
    const hPx = Math.floor((state.h * tile + state.render.pad * 2) * dpr);
    canvas.width = wPx;
    canvas.height = hPx;
  }

  function drawTile(x, y, t) {
    const { tile, pad, dpr } = state.render;
    const px = (pad + x * tile) * dpr;
    const py = (pad + y * tile) * dpr;
    const s = tile * dpr;

    // base cell
    // subtle cave shading
    const bg = (x + y) % 2 === 0 ? COLORS.bg1 : COLORS.bg2;
    ctx.fillStyle = bg;
    ctx.fillRect(px, py, s, s);

    if (t === T.EMPTY) return;

    if (t === T.WALL) {
      const g = ctx.createLinearGradient(px, py, px, py + s);
      g.addColorStop(0, COLORS.wall1);
      g.addColorStop(1, COLORS.wall2);
      ctx.fillStyle = g;
      roundRect(px + 1*dpr, py + 1*dpr, s - 2*dpr, s - 2*dpr, 6*dpr);
      ctx.fill();
      // cracks
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(px + s*0.25, py + s*0.2);
      ctx.lineTo(px + s*0.55, py + s*0.35);
      ctx.lineTo(px + s*0.75, py + s*0.65);
      ctx.stroke();
      return;
    }

    if (t === T.DIRT) {
      const g = ctx.createLinearGradient(px, py, px + s, py + s);
      g.addColorStop(0, COLORS.dirt2);
      g.addColorStop(1, COLORS.dirt1);
      ctx.fillStyle = g;
      roundRect(px + 2*dpr, py + 2*dpr, s - 4*dpr, s - 4*dpr, 7*dpr);
      ctx.fill();
      // dots
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let i=0;i<3;i++){
        const dx = (0.25 + 0.25*i) * s;
        const dy = (0.25 + 0.2*i) * s;
        ctx.beginPath();
        ctx.arc(px+dx, py+dy, 1.8*dpr, 0, Math.PI*2);
        ctx.fill();
      }
      return;
    }

    if (t === T.ROCK) {
      const g = ctx.createRadialGradient(px + s*0.35, py + s*0.35, s*0.1, px + s*0.5, py + s*0.55, s*0.55);
      g.addColorStop(0, COLORS.rock1);
      g.addColorStop(1, COLORS.rock2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px + s*0.5, py + s*0.56, s*0.38, s*0.33, 0.3, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1.2*dpr;
      ctx.stroke();
      return;
    }

    if (t === T.GEM) {
      const g = ctx.createLinearGradient(px, py, px + s, py + s);
      g.addColorStop(0, COLORS.gem1);
      g.addColorStop(1, COLORS.gem2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(px + s*0.5, py + s*0.12);
      ctx.lineTo(px + s*0.86, py + s*0.42);
      ctx.lineTo(px + s*0.68, py + s*0.88);
      ctx.lineTo(px + s*0.32, py + s*0.88);
      ctx.lineTo(px + s*0.14, py + s*0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1.2*dpr;
      ctx.stroke();
      // sparkle
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 1.0*dpr;
      ctx.beginPath();
      ctx.moveTo(px + s*0.5, py + s*0.22);
      ctx.lineTo(px + s*0.5, py + s*0.44);
      ctx.moveTo(px + s*0.4, py + s*0.33);
      ctx.lineTo(px + s*0.6, py + s*0.33);
      ctx.stroke();
      return;
    }

    if (t === T.EXIT_CLOSED || t === T.EXIT_OPEN) {
      const open = t === T.EXIT_OPEN;
      const g = ctx.createLinearGradient(px, py, px, py + s);
      g.addColorStop(0, open ? COLORS.exitOpen1 : COLORS.exitClosed1);
      g.addColorStop(1, open ? COLORS.exitOpen2 : COLORS.exitClosed2);
      ctx.fillStyle = g;
      roundRect(px + 3*dpr, py + 3*dpr, s - 6*dpr, s - 6*dpr, 8*dpr);
      ctx.fill();

      // door hole
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      roundRect(px + s*0.38, py + s*0.42, s*0.24, s*0.34, 7*dpr);
      ctx.fill();

      // frame highlight
      ctx.strokeStyle = open ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1.2*dpr;
      ctx.stroke();
      return;
    }
  }

  function drawPlayer() {
    const { tile, pad, dpr } = state.render;
    const x = state.player.x;
    const y = state.player.y;
    const px = (pad + x * tile) * dpr;
    const py = (pad + y * tile) * dpr;
    const s = tile * dpr;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(px + s*0.52, py + s*0.78, s*0.24, s*0.10, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    const g = ctx.createRadialGradient(px + s*0.35, py + s*0.35, s*0.05, px + s*0.55, py + s*0.55, s*0.6);
    g.addColorStop(0, COLORS.player1);
    g.addColorStop(1, COLORS.player2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px + s*0.5, py + s*0.52, s*0.28, 0, Math.PI*2);
    ctx.fill();

    // face direction cue
    const dir = state.lastMoveDir;
    const eyeX = px + s*0.5 + dir.x * s*0.08;
    const eyeY = py + s*0.48 + dir.y * s*0.02;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.arc(eyeX - s*0.07, eyeY, s*0.03, 0, Math.PI*2);
    ctx.arc(eyeX + s*0.07, eyeY, s*0.03, 0, Math.PI*2);
    ctx.fill();

    // if dead, tint
    if (!state.alive) {
      ctx.fillStyle = 'rgba(255,91,107,.35)';
      ctx.beginPath();
      ctx.arc(px + s*0.5, py + s*0.52, s*0.30, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function draw() {
    if (!state) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background frame
    const dpr = state.render.dpr;
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        drawTile(x, y, tileAt(x, y));
      }
    }

    drawPlayer();

    // border
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 2 * dpr;
    roundRect(3*dpr, 3*dpr, canvas.width - 6*dpr, canvas.height - 6*dpr, 14*dpr);
    ctx.stroke();

    // If exit closed and gems missing, hint by pulsing outline on exit tile
    if (!state.exit.open) {
      const { tile, pad } = state.render;
      const s = tile * dpr;
      const px = (pad + state.exit.x * tile) * dpr;
      const py = (pad + state.exit.y * tile) * dpr;
      const t = performance.now() / 1000;
      const a = 0.18 + 0.10 * (0.5 + 0.5 * Math.sin(t * 3.2));
      ctx.strokeStyle = `rgba(255,204,102,${a})`;
      ctx.lineWidth = 3 * dpr;
      roundRect(px + 1.5*dpr, py + 1.5*dpr, s - 3*dpr, s - 3*dpr, 10*dpr);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Input
  const keyToDir = new Map([
    ['ArrowUp', { dx: 0, dy: -1 }],
    ['ArrowDown', { dx: 0, dy: 1 }],
    ['ArrowLeft', { dx: -1, dy: 0 }],
    ['ArrowRight', { dx: 1, dy: 0 }],
    ['w', { dx: 0, dy: -1 }],
    ['s', { dx: 0, dy: 1 }],
    ['a', { dx: -1, dy: 0 }],
    ['d', { dx: 1, dy: 0 }],
    ['W', { dx: 0, dy: -1 }],
    ['S', { dx: 0, dy: 1 }],
    ['A', { dx: -1, dy: 0 }],
    ['D', { dx: 1, dy: 0 }],
  ]);

  function enqueueMove(dx, dy) {
    // Keep queue small; last inputs should matter
    if (state.inputQueue.length > 2) state.inputQueue.shift();
    state.inputQueue.push({ dx, dy });
  }

  window.addEventListener('keydown', (e) => {
    if (!state) return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      startLevel(state.levelIndex, true);
      return;
    }

    if (e.key === 'n' || e.key === 'N') {
      if (!nextBtn.disabled) {
        e.preventDefault();
        goNext();
      }
      return;
    }

    const dir = keyToDir.get(e.key);
    if (dir) {
      e.preventDefault();
      if (overlay.hidden === false) {
        // allow movement input to dismiss overlay only if alive? keep modal.
        return;
      }
      enqueueMove(dir.dx, dir.dy);
    }
  }, { passive: false });

  document.querySelectorAll('[data-move]').forEach((button) => {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!state || !overlay.hidden) return;

      const move = button.getAttribute('data-move');
      const dirs = {
        up: { dx: 0, dy: -1 },
        down: { dx: 0, dy: 1 },
        left: { dx: -1, dy: 0 },
        right: { dx: 1, dy: 0 }
      };
      const dir = dirs[move];

      if (dir) enqueueMove(dir.dx, dir.dy);
    }, { passive: false });
  });

  // Buttons
  function goNext() {
    if (!state) return;
    if (state.levelIndex >= LEVELS.length - 1) return;
    startLevel(state.levelIndex + 1, true);
  }

  restartBtn.addEventListener('click', () => {
    if (!state) return;
    startLevel(state.levelIndex, true);
  });

  nextBtn.addEventListener('click', () => {
    goNext();
  });

  overlayRestart.addEventListener('click', () => {
    startLevel(state.levelIndex, true);
  });
  overlayNext.addEventListener('click', () => {
    goNext();
  });

  // Resize
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!state) return;
      fitCanvasToLevel();
      draw();
    }, 50);
  });

  // Game loop
  let lastTick = 0;
  function loop(ts) {
    if (!lastTick) lastTick = ts;
    const dt = ts - lastTick;
    if (dt >= TICK_MS) {
      // consume at most one tick; keep steady
      lastTick = ts;
      tick();
    } else {
      // still render occasionally for exit pulse
      if (state && state.alive && !state.won) {
        // lightweight redraw at ~30fps
        // only if enough time since last frame
      }
    }
    requestAnimationFrame(loop);
  }

  // Initialize
  startLevel(0, false);
  requestAnimationFrame(loop);
})();
