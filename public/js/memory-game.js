const canvas = document.getElementById("memoryCanvas");
const ctx = canvas.getContext("2d");
const movesEl = document.getElementById("moves");
const matchesEl = document.getElementById("matches");
const timerEl = document.getElementById("timer");
const messageEl = document.getElementById("gameMessage");
const resetBtn = document.getElementById("resetBtn");

const EMOJIS = ["\u{1F680}", "\u{1F4A1}", "\u{1F48E}", "\u{1F4BB}", "\u{1F52E}", "\u{1F527}", "\u{1F3AE}", "\u{1F4A5}"];
const GRID_COLS = 4;
const GRID_ROWS = 4;
const PADDING = 14;
const TIME_LIMIT_SECONDS = 60;

let cards = [];
let firstPick = null;
let secondPick = null;
let moves = 0;
let matches = 0;
let timeLeft = TIME_LIMIT_SECONDS;
let timerId = null;
let busy = false;

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimer() {
  if (timerId) {
    return;
  }
  timerId = setInterval(() => {
    timeLeft -= 1;
    timerEl.textContent = formatTime(Math.max(timeLeft, 0));
    if (timeLeft <= 0) {
      stopTimer();
      busy = true;
      messageEl.textContent = "Time is up! Click reset to try again.";
    }
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function buildCards() {
  const pairs = [...EMOJIS, ...EMOJIS];
  const deck = shuffle(pairs);
  cards = deck.map((symbol, index) => ({
    id: index,
    symbol,
    revealed: false,
    matched: false
  }));
}

function resetGame() {
  moves = 0;
  matches = 0;
  timeLeft = TIME_LIMIT_SECONDS;
  firstPick = null;
  secondPick = null;
  busy = false;
  stopTimer();
  buildCards();
  movesEl.textContent = "0";
  matchesEl.textContent = "0";
  timerEl.textContent = formatTime(timeLeft);
  messageEl.textContent = "You have 60 seconds. Click two cards to start.";
  drawBoard();
}

function getCardAtPosition(x, y) {
  const cardWidth = (canvas.width - PADDING * (GRID_COLS + 1)) / GRID_COLS;
  const cardHeight = (canvas.height - PADDING * (GRID_ROWS + 1)) / GRID_ROWS;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = row * GRID_COLS + col;
      const cardX = PADDING + col * (cardWidth + PADDING);
      const cardY = PADDING + row * (cardHeight + PADDING);

      if (x >= cardX && x <= cardX + cardWidth && y >= cardY && y <= cardY + cardHeight) {
        return { card: cards[index], rect: { cardX, cardY, cardWidth, cardHeight } };
      }
    }
  }

  return null;
}

function drawCard(card, rect) {
  const { cardX, cardY, cardWidth, cardHeight } = rect;
  ctx.save();
  ctx.fillStyle = card.matched ? "rgba(34, 197, 139, 0.25)" : "rgba(20, 34, 60, 0.95)";
  ctx.strokeStyle = card.matched ? "rgba(34, 197, 139, 0.7)" : "rgba(91, 132, 196, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 10);
  ctx.fill();
  ctx.stroke();

  if (card.revealed || card.matched) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "28px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(card.symbol, cardX + cardWidth / 2, cardY + cardHeight / 2 + 2);
  } else {
    ctx.fillStyle = "rgba(34, 197, 139, 0.8)";
    ctx.font = "20px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", cardX + cardWidth / 2, cardY + cardHeight / 2 + 1);
  }
  ctx.restore();
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = row * GRID_COLS + col;
      const cardWidth = (canvas.width - PADDING * (GRID_COLS + 1)) / GRID_COLS;
      const cardHeight = (canvas.height - PADDING * (GRID_ROWS + 1)) / GRID_ROWS;
      const cardX = PADDING + col * (cardWidth + PADDING);
      const cardY = PADDING + row * (cardHeight + PADDING);
      drawCard(cards[index], { cardX, cardY, cardWidth, cardHeight });
    }
  }
}

function handleMatchCheck() {
  if (!firstPick || !secondPick) {
    return;
  }

  if (firstPick.symbol === secondPick.symbol) {
    firstPick.matched = true;
    secondPick.matched = true;
    matches += 1;
    matchesEl.textContent = String(matches);
    messageEl.textContent = "Nice! You found a match.";

    if (matches === EMOJIS.length) {
      stopTimer();
      messageEl.textContent = "You matched all pairs! Redirecting to claim...";
      localStorage.setItem(
        "memory_game_last",
        JSON.stringify({ moves, time: TIME_LIMIT_SECONDS - timeLeft })
      );
      setTimeout(() => {
        window.location.href = "/games/memory/claim";
      }, 900);
    }

    firstPick = null;
    secondPick = null;
    busy = false;
    drawBoard();
    return;
  }

  messageEl.textContent = "Not a match. Try again.";
  setTimeout(() => {
    if (firstPick) firstPick.revealed = false;
    if (secondPick) secondPick.revealed = false;
    firstPick = null;
    secondPick = null;
    busy = false;
    drawBoard();
  }, 650);
}

function handleClick(event) {
  if (busy) {
    return;
  }

  if (timeLeft <= 0) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

  const result = getCardAtPosition(x, y);
  if (!result || result.card.revealed || result.card.matched) {
    return;
  }

  if (!timerId) {
    startTimer();
  }

  result.card.revealed = true;
  drawBoard();

  if (!firstPick) {
    firstPick = result.card;
    messageEl.textContent = "Pick the second card.";
    return;
  }

  secondPick = result.card;
  moves += 1;
  movesEl.textContent = String(moves);
  busy = true;
  handleMatchCheck();
}

canvas.addEventListener("click", handleClick);
resetBtn.addEventListener("click", resetGame);

resetGame();
