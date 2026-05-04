const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const lapEl = document.querySelector("#lap");
const carrotsEl = document.querySelector("#carrots");
const fansEl = document.querySelector("#fans");
const messageEl = document.querySelector("#message");
const hypeEl = document.querySelector("#hype");
const progressBar = document.querySelector("#progressBar");
const overlay = document.querySelector("#overlay");
const toast = document.querySelector("#toast");
const startButton = document.querySelector("#startButton");
const leftButton = document.querySelector("#leftButton");
const rightButton = document.querySelector("#rightButton");
const boostButton = document.querySelector("#boostButton");

const width = canvas.width;
const height = canvas.height;
const lanes = [92, 195, 298];
const jokes = [
  "The rabbit winked at the pit crew.",
  "Tiny helmet. Massive confidence.",
  "Carrot fuel smells suspiciously delicious.",
  "A fan threw confetti shaped like lettuce.",
  "The rival car got distracted by salad."
];

let state;
let lastTime = 0;
let toastTimer = 0;
let animationId = 0;

function resetGame() {
  state = {
    running: false,
    finished: false,
    lane: 1,
    x: lanes[1],
    y: height - 108,
    speed: 230,
    distance: 0,
    lap: 1,
    carrots: 0,
    fans: 0,
    combo: 0,
    boost: 0,
    invincible: 0,
    spawnTimer: 0,
    carrotTimer: 1,
    fanTimer: 2,
    obstacles: [],
    pickups: [],
    particles: [],
    confetti: [],
    shake: 0
  };
  updateHud();
  showMessage("Ready for ridiculous speed.");
  updateHype("Hype meter waiting for ears.");
}

function startGame() {
  resetGame();
  state.running = true;
  overlay.hidden = true;
  overlay.classList.remove("is-finish");
  lastTime = performance.now();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(loop);
  showToast("Go! Become adorably illegal.");
}

function loop(now) {
  const delta = Math.min(0.033, (now - lastTime) / 1000 || 0);
  lastTime = now;
  update(delta);
  draw();
  animationId = requestAnimationFrame(loop);
}

function update(delta) {
  if (!state.running) {
    updateParticles(delta);
    return;
  }

  state.boost = Math.max(0, state.boost - delta);
  state.invincible = Math.max(0, state.invincible - delta);
  state.shake = Math.max(0, state.shake - delta * 18);
  const activeSpeed = state.speed + (state.boost > 0 ? 140 : 0);
  state.distance += activeSpeed * delta;
  state.x += (lanes[state.lane] - state.x) * Math.min(1, delta * 14);

  const nextLap = Math.min(3, Math.floor(state.distance / 1500) + 1);
  if (nextLap !== state.lap) {
    state.lap = nextLap;
    state.speed += 32;
    showToast(`Lap ${state.lap}! Ears tucked for aero.`);
  }

  if (state.distance >= 4500) {
    winRace();
    return;
  }

  state.spawnTimer -= delta;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = Math.max(0.42, 1.02 - state.distance / 8000);
  }

  state.carrotTimer -= delta;
  if (state.carrotTimer <= 0) {
    spawnPickup("carrot");
    state.carrotTimer = 1.15 + Math.random() * 0.8;
  }

  state.fanTimer -= delta;
  if (state.fanTimer <= 0) {
    spawnPickup("fan");
    state.fanTimer = 2.2 + Math.random() * 1.6;
  }

  moveObjects(state.obstacles, delta, activeSpeed);
  moveObjects(state.pickups, delta, activeSpeed);
  updateParticles(delta);
  handleCollisions();
  updateHud();
}

function moveObjects(items, delta, activeSpeed) {
  for (const item of items) {
    item.y += (activeSpeed + item.speed) * delta;
    if (item.wiggle) {
      item.x += Math.sin(performance.now() / 140 + item.y / 30) * 0.28;
    }
  }

  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].y > height + 90) {
      items.splice(i, 1);
    }
  }
}

function spawnObstacle() {
  const lane = Math.floor(Math.random() * lanes.length);
  state.obstacles.push({
    type: Math.random() > 0.25 ? "rival" : "puddle",
    lane,
    x: lanes[lane],
    y: -60,
    width: 58,
    height: 72,
    speed: 34 + Math.random() * 42,
    wiggle: Math.random() > 0.5
  });
}

function spawnPickup(type) {
  const lane = Math.floor(Math.random() * lanes.length);
  state.pickups.push({
    type,
    lane,
    x: lanes[lane],
    y: -42,
    width: 42,
    height: 42,
    speed: 18,
    wiggle: true
  });
}

function handleCollisions() {
  const car = { x: state.x - 27, y: state.y - 33, width: 54, height: 70 };

  for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
    const item = state.pickups[i];
    if (!overlaps(car, rectFor(item))) {
      continue;
    }

    if (item.type === "carrot") {
      state.carrots += 1;
      buzz(18);
      state.fans += 4;
      state.combo += 1;
      state.boost = Math.max(state.boost, 1.1);
      burst(item.x, item.y, "#ff8a00", 9);
      showToast(randomPick(["Carrot turbo!", "Crunch-powered boost!", "The engine went nom nom."]));
      updateHype(comboMessage());
    } else {
      state.fans += 12;
      buzz([12, 24, 12]);
      state.combo += 2;
      state.invincible = Math.max(state.invincible, 0.8);
      burst(item.x, item.y, "#ff4f79", 10);
      showToast(randomPick(jokes));
      updateHype(comboMessage());
    }
    state.pickups.splice(i, 1);
  }

  for (let i = state.obstacles.length - 1; i >= 0; i -= 1) {
    const item = state.obstacles[i];
    if (!overlaps(car, rectFor(item))) {
      continue;
    }

    if (state.invincible > 0) {
      state.fans += 5;
      burst(item.x, item.y, "#fff36d", 12);
      state.obstacles.splice(i, 1);
      showToast("Fan shield bounced a rival!");
      continue;
    }

    state.fans = Math.max(0, state.fans - 10);
    buzz(70);
    state.combo = 0;
    state.speed = Math.max(205, state.speed - 34);
    state.shake = 1;
    burst(state.x, state.y, "#ffffff", 14);
    showToast(item.type === "puddle" ? "Soup puddle! Not a valid shortcut." : "Boop! Rival got your whisker.");
    showMessage("Recover! The crowd still believes in the ears.");
    updateHype("Combo reset, but the ears remain aerodynamic.");
    state.obstacles.splice(i, 1);
  }
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectFor(item) {
  return {
    x: item.x - item.width / 2,
    y: item.y - item.height / 2,
    width: item.width,
    height: item.height
  };
}

function moveLane(direction) {
  if (!state.running) {
    return;
  }
  state.lane = Math.max(0, Math.min(2, state.lane + direction));
}

function boost() {
  if (!state.running) {
    return;
  }
  if (state.carrots > 0) {
    state.carrots -= 1;
    buzz(22);
    state.boost = 1.45;
    state.fans += 3;
    state.combo += 1;
    burst(state.x, state.y + 24, "#ff8a00", 10);
    showToast("Manual carrot boost!");
  } else {
    showToast("No carrots in the fuel tank.");
  }
  updateHud();
}

function winRace() {
  state.running = false;
  state.finished = true;
  overlay.hidden = false;
  overlay.classList.add("is-finish");
  overlay.querySelector(".eyebrow").textContent = "Victory";
  overlay.querySelector("h1").textContent = "Podium bunny!";
  overlay.querySelector("p:not(.eyebrow)").textContent = `You won with ${state.fans} fans and ${state.carrots} spare carrots. The trophy is mostly chewable.`;
  startButton.textContent = "Race again";
  showMessage("Viral potential: dangerously fluffy.");
  updateHype("Shareable finish: podium pose, tiny helmet, huge attitude.");
  launchConfetti();
}

function updateHud() {
  lapEl.textContent = `${state.lap}/3`;
  carrotsEl.textContent = state.carrots;
  fansEl.textContent = state.fans;
  progressBar.style.width = `${Math.min(100, (state.distance / 4500) * 100)}%`;
}

function showMessage(message) {
  messageEl.textContent = message;
}

function updateHype(message) {
  hypeEl.textContent = message;
}

function comboMessage() {
  if (state.combo >= 8) {
    return "Mega fluff combo. The internet is trembling.";
  }
  if (state.combo >= 4) {
    return "Cute combo rising. Fans are filming vertically.";
  }
  return "Nice! The crowd did a tiny squeal.";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1400);
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 220,
      vy: (Math.random() - 0.8) * 230,
      life: 0.55 + Math.random() * 0.4,
      color
    });
  }
}

function updateParticles(delta) {
  for (const particle of state.particles) {
    particle.life -= delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy += 380 * delta;
  }

  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    if (state.particles[i].life <= 0) {
      state.particles.splice(i, 1);
    }
  }

  for (const bit of state.confetti) {
    bit.life -= delta;
    bit.x += bit.vx * delta;
    bit.y += bit.vy * delta;
    bit.rotation += bit.spin * delta;
    bit.vy += 210 * delta;
  }

  for (let i = state.confetti.length - 1; i >= 0; i -= 1) {
    if (state.confetti[i].life <= 0 || state.confetti[i].y > height + 40) {
      state.confetti.splice(i, 1);
    }
  }
}

function draw() {
  const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 7 : 0;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(shakeX, 0);
  drawTrack();
  drawPickups();
  drawObstacles();
  drawRabbitCar();
  drawParticles();
  drawConfetti();
  ctx.restore();
}

function drawTrack() {
  ctx.fillStyle = "#30323a";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#70d38b";
  ctx.fillRect(0, 0, 42, height);
  ctx.fillRect(width - 42, 0, 42, height);

  ctx.fillStyle = "#fffbde";
  for (let y = -60 + (state.distance % 95); y < height; y += 95) {
    ctx.fillRect(136, y, 8, 46);
    ctx.fillRect(246, y, 8, 46);
  }

  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let y = -80 + (state.distance % 120); y < height; y += 120) {
    ctx.fillRect(50, y, 18, 42);
    ctx.fillRect(width - 68, y + 38, 18, 42);
  }

  ctx.fillStyle = "#ff4f79";
  for (let i = 0; i < 10; i += 1) {
    ctx.fillRect(i * 39, 20 + ((state.distance / 4) % 80), 20, 10);
  }
}

function drawRabbitCar() {
  const x = state.x;
  const y = state.y;
  ctx.save();
  if (state.invincible > 0) {
    ctx.shadowColor = "#fff36d";
    ctx.shadowBlur = 24;
  }
  ctx.fillStyle = state.boost > 0 ? "#ff8a00" : "#ff4f79";
  roundRect(x - 31, y - 28, 62, 76, 16);
  ctx.fillStyle = "#20222b";
  roundRect(x - 22, y + 16, 44, 18, 8);
  ctx.fillStyle = "#ffffff";
  roundRect(x - 20, y - 58, 14, 34, 8);
  roundRect(x + 6, y - 58, 14, 34, 8);
  ctx.fillStyle = "#f7f0ea";
  ctx.beginPath();
  ctx.arc(x, y - 30, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#20222b";
  ctx.beginPath();
  ctx.arc(x - 7, y - 35, 3, 0, Math.PI * 2);
  ctx.arc(x + 9, y - 35, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff7aa2";
  ctx.beginPath();
  ctx.arc(x + 1, y - 28, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff36d";
  ctx.fillRect(x - 36, y + 3, 10, 18);
  ctx.fillRect(x + 26, y + 3, 10, 18);
  if (state.boost > 0) {
    ctx.fillStyle = "#fff36d";
    ctx.beginPath();
    ctx.moveTo(x - 18, y + 51);
    ctx.lineTo(x, y + 88 + Math.random() * 12);
    ctx.lineTo(x + 18, y + 51);
    ctx.fill();
  }
  ctx.restore();
}

function drawObstacles() {
  for (const item of state.obstacles) {
    if (item.type === "puddle") {
      ctx.fillStyle = "#8b63ff";
      ctx.beginPath();
      ctx.ellipse(item.x, item.y, 34, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#bba8ff";
      ctx.fillText("soup", item.x - 16, item.y + 4);
      continue;
    }
    ctx.fillStyle = "#43b4ff";
    roundRect(item.x - 29, item.y - 36, 58, 72, 14);
    ctx.fillStyle = "#20222b";
    roundRect(item.x - 18, item.y - 16, 36, 18, 7);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(item.x - 32, item.y + 8, 8, 18);
    ctx.fillRect(item.x + 24, item.y + 8, 8, 18);
  }
}

function drawPickups() {
  for (const item of state.pickups) {
    if (item.type === "carrot") {
      ctx.fillStyle = "#ff8a00";
      ctx.beginPath();
      ctx.moveTo(item.x - 14, item.y - 8);
      ctx.lineTo(item.x + 16, item.y);
      ctx.lineTo(item.x - 14, item.y + 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#39b65e";
      ctx.fillRect(item.x - 20, item.y - 14, 14, 8);
    } else {
      ctx.fillStyle = "#ff4f79";
      ctx.beginPath();
      ctx.arc(item.x, item.y, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 18px Arial";
      ctx.textAlign = "center";
      ctx.fillText("♥", item.x, item.y + 7);
    }
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawConfetti() {
  for (const bit of state.confetti) {
    ctx.save();
    ctx.translate(bit.x, bit.y);
    ctx.rotate(bit.rotation);
    ctx.globalAlpha = Math.max(0, Math.min(1, bit.life));
    ctx.fillStyle = bit.color;
    ctx.fillRect(-bit.size / 2, -bit.size / 2, bit.size, bit.size * 0.62);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function launchConfetti() {
  const colors = ["#ff4f79", "#ff8a00", "#fff36d", "#43b4ff", "#70d38b"];
  for (let i = 0; i < 85; i += 1) {
    state.confetti.push({
      x: width / 2 + (Math.random() - 0.5) * 120,
      y: 80 + Math.random() * 80,
      vx: (Math.random() - 0.5) * 260,
      vy: -180 - Math.random() * 260,
      life: 1.2 + Math.random() * 1.2,
      size: 7 + Math.random() * 7,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      color: randomPick(colors)
    });
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

function randomPick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buzz(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function bindHold(button, action) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    action();
  });
}

let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener("pointerdown", (event) => {
  touchStartX = event.clientX;
  touchStartY = event.clientY;
});

canvas.addEventListener("pointerup", (event) => {
  const dx = event.clientX - touchStartX;
  const dy = event.clientY - touchStartY;
  if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy)) {
    moveLane(dx > 0 ? 1 : -1);
  } else if (Math.abs(dy) < 28) {
    boost();
  }
});

startButton.addEventListener("click", startGame);
bindHold(leftButton, () => moveLane(-1));
bindHold(rightButton, () => moveLane(1));
bindHold(boostButton, boost);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    moveLane(-1);
  } else if (event.key === "ArrowRight") {
    moveLane(1);
  } else if (event.key === " " || event.key === "ArrowUp") {
    event.preventDefault();
    boost();
  } else if (event.key === "Enter" && !state.running) {
    startGame();
  }
});

document.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
resetGame();
draw();
