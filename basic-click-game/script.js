const scoreElement = document.querySelector("#score");
const timeElement = document.querySelector("#time");
const messageElement = document.querySelector("#message");
const startButton = document.querySelector("#start");
const targetButton = document.querySelector("#target");
const playArea = document.querySelector(".play-area");

let score = 0;
let timeLeft = 20;
let timerId = null;
let playing = false;

function moveTarget() {
  const area = playArea.getBoundingClientRect();
  const target = targetButton.getBoundingClientRect();
  const padding = 12;
  const maxX = area.width - target.width - padding;
  const maxY = area.height - target.height - padding;

  const x = padding + Math.random() * Math.max(0, maxX - padding);
  const y = padding + Math.random() * Math.max(0, maxY - padding);

  targetButton.style.left = `${x}px`;
  targetButton.style.top = `${y}px`;
  targetButton.style.transform = "none";
}

function setPlayingState(nextPlaying) {
  playing = nextPlaying;
  targetButton.disabled = !playing;
  startButton.disabled = playing;
}

function endGame() {
  clearInterval(timerId);
  timerId = null;
  setPlayingState(false);
  messageElement.textContent = `Game over. Final score: ${score}.`;
  startButton.textContent = "Play again";
}

function startGame() {
  score = 0;
  timeLeft = 20;
  scoreElement.textContent = score;
  timeElement.textContent = timeLeft;
  messageElement.textContent = "Go!";
  setPlayingState(true);
  moveTarget();

  timerId = setInterval(() => {
    timeLeft -= 1;
    timeElement.textContent = timeLeft;

    if (timeLeft <= 0) {
      endGame();
    }
  }, 1000);
}

startButton.addEventListener("click", startGame);

targetButton.addEventListener("click", () => {
  if (!playing) {
    return;
  }

  score += 1;
  scoreElement.textContent = score;
  messageElement.textContent = score % 5 === 0 ? "Nice streak." : "Hit!";
  moveTarget();
});

setPlayingState(false);
