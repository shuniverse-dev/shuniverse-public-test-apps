const keys = ["A", "S", "D", "F", "J", "K", "L"];

const scoreElement = document.querySelector("#score");
const roundElement = document.querySelector("#round");
const bestElement = document.querySelector("#best");
const promptElement = document.querySelector("#prompt");
const messageElement = document.querySelector("#message");
const startButton = document.querySelector("#start");

let score = 0;
let round = 0;
let bestTime = null;
let currentKey = "";
let promptStartedAt = 0;
let acceptingInput = false;

function randomKey() {
  const index = Math.floor(Math.random() * keys.length);
  return keys[index];
}

function updateHud() {
  scoreElement.textContent = score;
  roundElement.textContent = round;
  bestElement.textContent = bestTime === null ? "--" : bestTime;
}

function setPromptState(className) {
  promptElement.classList.remove("hit", "miss");

  if (className) {
    promptElement.classList.add(className);
  }
}

function finishGame() {
  acceptingInput = false;
  currentKey = "";
  promptElement.textContent = "✓";
  setPromptState("hit");
  messageElement.textContent = `Finished. Score: ${score} out of 10.`;
  startButton.disabled = false;
  startButton.textContent = "Play again";
}

function nextRound() {
  if (round >= 10) {
    finishGame();
    return;
  }

  round += 1;
  currentKey = randomKey();
  promptElement.textContent = currentKey;
  promptStartedAt = performance.now();
  acceptingInput = true;
  setPromptState("");
  messageElement.textContent = "Waiting for your key press.";
  updateHud();
}

function startGame() {
  score = 0;
  round = 0;
  bestTime = null;
  currentKey = "";
  startButton.disabled = true;
  messageElement.textContent = "Get ready.";
  updateHud();

  window.setTimeout(nextRound, 600);
}

function handleKeydown(event) {
  if (!acceptingInput || event.repeat) {
    return;
  }

  const pressedKey = event.key.toUpperCase();
  acceptingInput = false;

  if (pressedKey === currentKey) {
    const reactionTime = Math.round(performance.now() - promptStartedAt);
    score += 1;
    bestTime = bestTime === null ? reactionTime : Math.min(bestTime, reactionTime);
    setPromptState("hit");
    messageElement.textContent = `Correct: ${reactionTime} ms.`;
  } else {
    setPromptState("miss");
    messageElement.textContent = `Wrong key. You pressed ${pressedKey || "unknown"}.`;
  }

  updateHud();
  window.setTimeout(nextRound, 650);
}

startButton.addEventListener("click", startGame);
window.addEventListener("keydown", handleKeydown);
updateHud();
