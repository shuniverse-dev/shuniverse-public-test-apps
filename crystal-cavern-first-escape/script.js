const boardElement = document.querySelector("#board");
const crystalHud = document.querySelector("#crystalHud");
const exitHud = document.querySelector("#exitHud");
const stateHud = document.querySelector("#stateHud");
const messageElement = document.querySelector("#message");
const ruleHint = document.querySelector("#ruleHint");
const overlay = document.querySelector("#overlay");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayText = document.querySelector("#overlayText");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");

const WIDTH = 20;
const HEIGHT = 14;
const REQUIRED_CRYSTALS = 8;
const GRAVITY_MS = 190;
const ENEMY_MS = 480;

const LEVEL = [
  "####################",
  "#P....C....R.......#",
  "#..###..R..###..C..#",
  "#..C....R....C.....#",
  "#......###.........#",
  "#..R..C....R..###..#",
  "#......###.........#",
  "#..###.....C....e..#",
  "#.......R..........#",
  "#..C....###..C.....#",
  "#.....R.....H..C...#",
  "#..###......###....#",
  "#....C....R.....C..#",
  "####################"
];

validateLevel(LEVEL);

const dirs = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1]
};

let game;

function createGame() {
  const grid = LEVEL.map((row) => row.split(""));
  const falling = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
  let player = { x: 1, y: 1 };
  let enemy = null;
  let exit = { x: 0, y: 0 };

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (grid[y][x] === "P") {
        player = { x, y };
        grid[y][x] = " ";
      } else if (grid[y][x] === "H") {
        enemy = { x, y, dir: 1, alive: true };
        grid[y][x] = " ";
      } else if (grid[y][x] === "e") {
        exit = { x, y };
      }
    }
  }

  return {
    grid,
    falling,
    player,
    enemy,
    exit,
    state: "start",
    crystals: 0,
    exitOpen: false,
    message: "Press Enter or Space to start.",
    gravityTimer: 0,
    enemyTimer: 0
  };
}

function startGame() {
  game = createGame();
  game.state = "playing";
  overlay.hidden = true;
  game.message = "Collect 8 crystals. Rocks fall one tile at a time.";
  ruleHint.textContent = "Tip: objects fall one tile per tick. Never wait under a falling outline.";
  render();
}

function restartGame() {
  startGame();
}

function setOverlay(kind, title, text, buttonText) {
  game.state = kind;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = buttonText;
  overlay.hidden = false;
  render();
}

function cell(x, y) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
    return "#";
  }
  return game.grid[y][x];
}

function setCell(x, y, value) {
  game.grid[y][x] = value;
}

function isEnemyAt(x, y) {
  return game.enemy && game.enemy.alive && game.enemy.x === x && game.enemy.y === y;
}

function isPlayerAt(x, y) {
  return game.player.x === x && game.player.y === y;
}

function isEmptyForFalling(x, y) {
  return cell(x, y) === " " && !isEnemyAt(x, y) && !isPlayerAt(x, y);
}

function isSolidForEnemy(x, y) {
  const value = cell(x, y);
  return value !== " " || isEnemyAt(x, y);
}

function isSolidForFalling(x, y) {
  const value = cell(x, y);
  return value !== " " || isEnemyAt(x, y) || isPlayerAt(x, y);
}

function movePlayer(dx, dy) {
  if (game.state !== "playing") {
    return;
  }

  const nx = game.player.x + dx;
  const ny = game.player.y + dy;
  const target = cell(nx, ny);

  if (isEnemyAt(nx, ny)) {
    die("The cave bug caught you!");
    return;
  }

  if (target === "#" || target === "e") {
    game.message = target === "e" ? "The exit is locked. Collect more crystals." : "Solid stone blocks the way.";
    render();
    return;
  }

  if (target === "R") {
    if (dy !== 0) {
      game.message = "Rocks only push sideways.";
      render();
      return;
    }
    pushRock(nx, ny, dx);
    return;
  }

  if (target === ".") {
    setCell(nx, ny, " ");
    game.player = { x: nx, y: ny };
    game.message = "Dirt dug cleanly.";
    afterPlayerMove();
    return;
  }

  if (target === "C") {
    setCell(nx, ny, " ");
    game.player = { x: nx, y: ny };
    collectCrystal();
    afterPlayerMove();
    return;
  }

  if (target === "E") {
    game.player = { x: nx, y: ny };
    win();
    return;
  }

  if (target === " ") {
    game.player = { x: nx, y: ny };
    game.message = "Step carefully.";
    afterPlayerMove();
  }
}

function pushRock(x, y, dx) {
  const bx = x + dx;
  const by = y;
  if (cell(bx, by) !== " " || isEnemyAt(bx, by) || isPlayerAt(bx, by) || game.falling[y][x]) {
    game.message = "That rock will not budge.";
    render();
    return;
  }

  setCell(bx, by, "R");
  game.falling[by][bx] = false;
  setCell(x, y, " ");
  game.falling[y][x] = false;
  game.player = { x, y };
  game.message = "Rock pushed. Nice leverage.";
  afterPlayerMove();
}

function collectCrystal() {
  game.crystals += 1;
  if (!game.exitOpen && game.crystals >= REQUIRED_CRYSTALS) {
    game.exitOpen = true;
    setCell(game.exit.x, game.exit.y, "E");
    game.message = "The exit is open! Find the glowing tunnel.";
    ruleHint.textContent = "Exit open: reach the glowing tunnel to finish the cave.";
  } else {
    game.message = `Crystal collected: ${game.crystals} / ${REQUIRED_CRYSTALS}.`;
  }
}

function afterPlayerMove() {
  render();
}

function updateGravity() {
  if (game.state !== "playing") {
    return;
  }

  const oldFalling = game.falling.map((row) => row.slice());
  const newFalling = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));

  for (let y = HEIGHT - 2; y >= 1; y -= 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      const value = cell(x, y);
      if (value !== "R" && value !== "C") {
        continue;
      }

      const belowY = y + 1;
      if (isEmptyForFalling(x, belowY)) {
        setCell(x, belowY, value);
        setCell(x, y, " ");
        newFalling[belowY][x] = true;
      } else if (oldFalling[y][x] && isPlayerAt(x, belowY)) {
        die(value === "R" ? "You got crushed!" : "A falling crystal got you!");
        return;
      } else if (oldFalling[y][x] && isEnemyAt(x, belowY)) {
        game.enemy.alive = false;
        setCell(x, belowY, value);
        setCell(x, y, " ");
        newFalling[belowY][x] = false;
        game.message = "A falling object crushed the cave bug.";
        ruleHint.textContent = "Nice! Falling rocks and crystals can solve enemy problems.";
      } else if (!isSolidForFalling(x, belowY)) {
        newFalling[y][x] = false;
      }
    }
  }

  game.falling = newFalling;
}

function updateEnemy() {
  if (game.state !== "playing" || !game.enemy || !game.enemy.alive) {
    return;
  }

  const enemy = game.enemy;
  let nx = enemy.x + enemy.dir;
  if (isSolidForEnemy(nx, enemy.y)) {
    enemy.dir *= -1;
    nx = enemy.x + enemy.dir;
  }

  if (!isSolidForEnemy(nx, enemy.y)) {
    enemy.x = nx;
  }

  if (isPlayerAt(enemy.x, enemy.y)) {
    die("The cave bug caught you!");
  }
}

function tick() {
  if (game.state !== "playing") {
    return;
  }

  game.gravityTimer += 1;
  game.enemyTimer += 1;

  if (game.gravityTimer >= 1) {
    game.gravityTimer = 0;
    updateGravity();
  }

  if (game.enemyTimer * GRAVITY_MS >= ENEMY_MS) {
    game.enemyTimer = 0;
    updateEnemy();
  }

  render();
}

function die(message) {
  if (game.state !== "playing") {
    return;
  }
  game.message = message;
  ruleHint.textContent = "Freeze. Press R to restore the exact original cave.";
  setOverlay("dead", message, "Press R or the restart button to try the same cave again.", "Restart");
}

function win() {
  game.message = "You escaped the Crystal Cavern!";
  ruleHint.textContent = "Proof-of-concept complete. This cave can now grow into more levels.";
  setOverlay(
    "victory",
    "You escaped the Crystal Cavern!",
    `Crystals collected: ${Math.min(game.crystals, REQUIRED_CRYSTALS)} / ${REQUIRED_CRYSTALS}. The first cave is complete.`,
    "Play again"
  );
}

function render() {
  boardElement.textContent = "";
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const tile = document.createElement("div");
      tile.className = `tile ${classFor(x, y)}`;
      boardElement.appendChild(tile);
    }
  }

  crystalHud.textContent = `${Math.min(game.crystals, REQUIRED_CRYSTALS)} / ${REQUIRED_CRYSTALS}`;
  exitHud.textContent = game.exitOpen ? "Open!" : "Locked";
  stateHud.textContent = labelForState();
  messageElement.textContent = game.message;
  document.body.classList.toggle("is-open", game.exitOpen);
  document.body.classList.toggle("is-danger", game.state === "dead");
  document.body.classList.toggle("is-victory", game.state === "victory");
}

function classFor(x, y) {
  if (isPlayerAt(x, y)) {
    return "player";
  }
  if (isEnemyAt(x, y)) {
    return "enemy";
  }

  const value = cell(x, y);
  const falling = game.falling[y][x] ? " falling" : "";
  if (value === "#") return "wall";
  if (value === ".") return "dirt";
  if (value === "R") return `rock${falling}`;
  if (value === "C") return `crystal${falling}`;
  if (value === "e") return "exit-locked";
  if (value === "E") return "exit-open";
  return "empty";
}

function labelForState() {
  if (game.state === "start") return "Ready";
  if (game.state === "playing") return "Playing";
  if (game.state === "dead") return "Try again";
  if (game.state === "victory") return "Escaped";
  return "Ready";
}

function validateLevel(level) {
  if (level.length !== HEIGHT || level.some((row) => row.length !== WIDTH)) {
    throw new Error("Level dimensions do not match the configured board size.");
  }

  const joined = level.join("");
  const counts = {
    player: countChar(joined, "P"),
    exit: countChar(joined, "e"),
    enemy: countChar(joined, "H"),
    crystals: countChar(joined, "C")
  };

  if (counts.player !== 1 || counts.exit !== 1 || counts.enemy !== 1 || counts.crystals < REQUIRED_CRYSTALS) {
    throw new Error("Level must contain one player, one locked exit, one enemy, and enough crystals.");
  }

  for (let x = 0; x < WIDTH; x += 1) {
    if (level[0][x] !== "#" || level[HEIGHT - 1][x] !== "#") {
      throw new Error("Level must have a solid wall boundary.");
    }
  }

  for (let y = 0; y < HEIGHT; y += 1) {
    if (level[y][0] !== "#" || level[y][WIDTH - 1] !== "#") {
      throw new Error("Level must have a solid wall boundary.");
    }
  }
}

function countChar(text, character) {
  return text.split(character).length - 1;
}

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    event.preventDefault();
    restartGame();
    return;
  }

  if (game.state === "start" && (event.code === "Enter" || event.code === "Space")) {
    event.preventDefault();
    startGame();
    return;
  }

  if ((game.state === "dead" || game.state === "victory") && (event.code === "Enter" || event.code === "Space")) {
    event.preventDefault();
    restartGame();
    return;
  }

  const direction = dirs[event.code];
  if (direction) {
    event.preventDefault();
    movePlayer(direction[0], direction[1]);
  }
});

startButton.addEventListener("click", () => {
  if (game.state === "start") {
    startGame();
  } else {
    restartGame();
  }
});

restartButton.addEventListener("click", restartGame);

game = createGame();
render();
window.setInterval(tick, GRAVITY_MS);

window.__crystalCavernDebug = {
  getState: () => ({
    state: game.state,
    crystals: game.crystals,
    exitOpen: game.exitOpen,
    player: { ...game.player },
    enemy: game.enemy ? { ...game.enemy } : null
  }),
  restart: restartGame,
  start: startGame
};
