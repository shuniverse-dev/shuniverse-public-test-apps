const canvas = document.querySelector("#race");
const context = canvas.getContext("2d");
const distanceElement = document.querySelector("#distance");
const speedElement = document.querySelector("#speed");
const bestElement = document.querySelector("#best");
const messageElement = document.querySelector("#message");
const startButton = document.querySelector("#start");

const road = {
  left: 70,
  right: 350,
  laneWidth: 70
};

const player = {
  x: 210,
  y: 500,
  width: 40,
  height: 70,
  velocityX: 0
};

let obstacles = [];
let keys = new Set();
let running = false;
let crashed = false;
let distance = 0;
let bestDistance = 0;
let speed = 2.8;
let lastTime = 0;
let spawnTimer = 0;
let lineOffset = 0;
let animationId = null;

function resetRace() {
  obstacles = [];
  keys = new Set();
  running = true;
  crashed = false;
  distance = 0;
  speed = 2.8;
  spawnTimer = 0;
  lineOffset = 0;
  player.x = 210;
  player.velocityX = 0;
  lastTime = performance.now();
  messageElement.textContent = "Dodge the traffic.";
  startButton.textContent = "Restart";
}

function updateHud() {
  distanceElement.textContent = Math.floor(distance);
  speedElement.textContent = (speed / 2.8).toFixed(1);
  bestElement.textContent = Math.floor(bestDistance);
}

function drawCar(x, y, width, height, bodyColor, windowColor) {
  context.fillStyle = bodyColor;
  context.fillRect(x - width / 2, y - height / 2, width, height);

  context.fillStyle = windowColor;
  context.fillRect(x - width / 2 + 8, y - height / 2 + 10, width - 16, 16);
  context.fillRect(x - width / 2 + 8, y + height / 2 - 26, width - 16, 14);

  context.fillStyle = "#111316";
  context.fillRect(x - width / 2 - 4, y - height / 2 + 10, 4, 16);
  context.fillRect(x + width / 2, y - height / 2 + 10, 4, 16);
  context.fillRect(x - width / 2 - 4, y + height / 2 - 26, 4, 16);
  context.fillRect(x + width / 2, y + height / 2 - 26, 4, 16);
}

function drawRoad() {
  context.fillStyle = "#1f252d";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#303843";
  context.fillRect(road.left, 0, road.right - road.left, canvas.height);

  context.fillStyle = "#dfe7f0";
  context.fillRect(road.left - 5, 0, 5, canvas.height);
  context.fillRect(road.right, 0, 5, canvas.height);

  context.fillStyle = "#ffd76b";
  for (let lane = 1; lane < 4; lane += 1) {
    const x = road.left + lane * road.laneWidth;
    for (let y = -60 + lineOffset; y < canvas.height; y += 95) {
      context.fillRect(x - 3, y, 6, 46);
    }
  }
}

function drawScene() {
  drawRoad();

  for (const obstacle of obstacles) {
    drawCar(obstacle.x, obstacle.y, obstacle.width, obstacle.height, "#ff7d7d", "#ffe0e0");
  }

  drawCar(player.x, player.y, player.width, player.height, "#7fe3a0", "#d9ffe4");
}

function spawnObstacle() {
  const lane = Math.floor(Math.random() * 4);
  const x = road.left + road.laneWidth / 2 + lane * road.laneWidth;
  obstacles.push({
    x,
    y: -55,
    width: 42,
    height: 72
  });
}

function rectanglesOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

function endRace() {
  running = false;
  crashed = true;
  bestDistance = Math.max(bestDistance, distance);
  messageElement.textContent = "Crash. Press Enter or Start to race again.";
  updateHud();
}

function updateRace(delta) {
  const steeringLeft = keys.has("arrowleft") || keys.has("a");
  const steeringRight = keys.has("arrowright") || keys.has("d");
  player.velocityX = 0;

  if (steeringLeft) {
    player.velocityX -= 250;
  }

  if (steeringRight) {
    player.velocityX += 250;
  }

  player.x += player.velocityX * delta;
  player.x = Math.max(road.left + player.width / 2 + 8, player.x);
  player.x = Math.min(road.right - player.width / 2 - 8, player.x);

  distance += speed * delta * 18;
  speed += delta * 0.09;
  lineOffset = (lineOffset + speed * delta * 48) % 95;
  spawnTimer -= delta;

  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = Math.max(0.48, 1.15 - speed * 0.08);
  }

  for (const obstacle of obstacles) {
    obstacle.y += speed * delta * 120;
  }

  obstacles = obstacles.filter((obstacle) => obstacle.y < canvas.height + 90);

  if (obstacles.some((obstacle) => rectanglesOverlap(player, obstacle))) {
    endRace();
  }

  updateHud();
}

function loop(now) {
  const delta = Math.min(0.04, (now - lastTime) / 1000);
  lastTime = now;

  if (running) {
    updateRace(delta);
  }

  drawScene();
  animationId = requestAnimationFrame(loop);
}

function startRace() {
  resetRace();

  if (animationId === null) {
    animationId = requestAnimationFrame(loop);
  }
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (["arrowleft", "arrowright", "a", "d"].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }

  if ((key === "enter" || key === " ") && (!running || crashed)) {
    event.preventDefault();
    startRace();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

startButton.addEventListener("click", startRace);
drawScene();
updateHud();
