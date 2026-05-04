const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d");
const scoreElement = document.querySelector("#score");
const bestElement = document.querySelector("#best");
const speedElement = document.querySelector("#speed");
const messageElement = document.querySelector("#message");
const startButton = document.querySelector("#startButton");

const groundY = 330;
const duck = {
  x: 118,
  y: groundY,
  width: 78,
  height: 58,
  velocityY: 0,
  grounded: true
};

let obstacles = [];
let clouds = [];
let running = false;
let gameOver = false;
let score = 0;
let best = 0;
let speed = 4;
let spawnTimer = 0;
let lastTime = 0;
let animationId = null;

function resetGame() {
  obstacles = [];
  clouds = [
    { x: 120, y: 70, speed: 0.25 },
    { x: 420, y: 105, speed: 0.18 },
    { x: 650, y: 58, speed: 0.22 }
  ];
  duck.y = groundY;
  duck.velocityY = 0;
  duck.grounded = true;
  running = true;
  gameOver = false;
  score = 0;
  speed = 4;
  spawnTimer = 0;
  lastTime = performance.now();
  messageElement.textContent = "Hop over the reeds.";
  startButton.textContent = "Restart";
}

function updateHud() {
  scoreElement.textContent = Math.floor(score);
  bestElement.textContent = Math.floor(best);
  speedElement.textContent = (speed / 4).toFixed(1);
}

function jump() {
  if (!running && gameOver) {
    resetGame();
    return;
  }

  if (!running) {
    resetGame();
    return;
  }

  if (duck.grounded) {
    duck.velocityY = -15.5;
    duck.grounded = false;
  }
}

function spawnObstacle() {
  const height = 34 + Math.random() * 28;
  obstacles.push({
    x: canvas.width + 30,
    y: groundY + 22 - height,
    width: 24 + Math.random() * 18,
    height
  });
}

function drawSky() {
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#8ed3f5");
  gradient.addColorStop(1, "#d8f0ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(255, 255, 255, 0.82)";
  for (const cloud of clouds) {
    context.beginPath();
    context.arc(cloud.x, cloud.y, 24, 0, Math.PI * 2);
    context.arc(cloud.x + 26, cloud.y - 10, 30, 0, Math.PI * 2);
    context.arc(cloud.x + 58, cloud.y, 22, 0, Math.PI * 2);
    context.fill();
  }
}

function drawGround() {
  context.fillStyle = "#87b467";
  context.fillRect(0, groundY + 28, canvas.width, canvas.height - groundY);

  context.fillStyle = "#5f8d46";
  for (let x = 0; x < canvas.width; x += 28) {
    context.fillRect(x, groundY + 20 + ((x / 28) % 2) * 5, 16, 10);
  }
}

function drawDuck() {
  const bodyX = duck.x;
  const bodyY = duck.y;

  context.fillStyle = "#ffd75c";
  context.beginPath();
  context.ellipse(bodyX, bodyY, 42, 28, 0, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.arc(bodyX + 36, bodyY - 26, 23, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ff9f3d";
  context.beginPath();
  context.moveTo(bodyX + 57, bodyY - 28);
  context.lineTo(bodyX + 88, bodyY - 20);
  context.lineTo(bodyX + 57, bodyY - 12);
  context.closePath();
  context.fill();

  context.fillStyle = "#20252a";
  context.beginPath();
  context.arc(bodyX + 43, bodyY - 33, 4, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#7d5b28";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(bodyX - 8, bodyY + 23);
  context.lineTo(bodyX - 12, bodyY + 38);
  context.moveTo(bodyX + 16, bodyY + 23);
  context.lineTo(bodyX + 20, bodyY + 38);
  context.stroke();

  context.fillStyle = "rgba(255, 255, 255, 0.28)";
  context.beginPath();
  context.ellipse(bodyX - 10, bodyY - 2, 18, 10, -0.4, 0, Math.PI * 2);
  context.fill();
}

function drawObstacles() {
  context.fillStyle = "#9b6b3b";
  for (const obstacle of obstacles) {
    context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

    context.fillStyle = "#6d9c4c";
    context.fillRect(obstacle.x - 6, obstacle.y - 6, obstacle.width + 12, 9);
    context.fillStyle = "#9b6b3b";
  }
}

function drawScene() {
  drawSky();
  drawGround();
  drawObstacles();
  drawDuck();
}

function getDuckBox() {
  return {
    x: duck.x - 38,
    y: duck.y - 44,
    width: duck.width,
    height: duck.height
  };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function endGame() {
  running = false;
  gameOver = true;
  best = Math.max(best, score);
  messageElement.textContent = "Splash. Press Space, Arrow Up, W, or Start to try again.";
  updateHud();
}

function update(delta) {
  duck.velocityY += 36 * delta;
  duck.y += duck.velocityY;

  if (duck.y >= groundY) {
    duck.y = groundY;
    duck.velocityY = 0;
    duck.grounded = true;
  }

  score += delta * 18;
  speed += delta * 0.16;
  spawnTimer -= delta;

  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = Math.max(0.72, 1.45 - speed * 0.09);
  }

  for (const obstacle of obstacles) {
    obstacle.x -= speed * delta * 82;
  }

  for (const cloud of clouds) {
    cloud.x -= cloud.speed * delta * 90;
    if (cloud.x < -90) {
      cloud.x = canvas.width + 90;
      cloud.y = 55 + Math.random() * 70;
    }
  }

  obstacles = obstacles.filter((obstacle) => obstacle.x > -80);

  const duckBox = getDuckBox();
  if (obstacles.some((obstacle) => overlaps(duckBox, obstacle))) {
    endGame();
  }

  updateHud();
}

function loop(now) {
  const delta = Math.min(0.04, (now - lastTime) / 1000 || 0);
  lastTime = now;

  if (running) {
    update(delta);
  }

  drawScene();
  animationId = requestAnimationFrame(loop);
}

startButton.addEventListener("click", resetGame);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === " " || key === "arrowup" || key === "w") {
    event.preventDefault();
    jump();
  }
});

drawScene();
updateHud();
animationId = requestAnimationFrame(loop);
