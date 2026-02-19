const claimBtn = document.getElementById("claimBtn");
const statusEl = document.getElementById("claimStatus");
const rewardMoves = document.getElementById("rewardMoves");
const rewardTime = document.getElementById("rewardTime");
const rewardValue = document.getElementById("rewardValue");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "success");
  if (type) {
    statusEl.classList.add(type);
  }
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function loadLastStats() {
  try {
    const raw = localStorage.getItem("memory_game_last");
    if (!raw) {
      return;
    }
    const data = JSON.parse(raw);
    if (Number.isFinite(data?.moves)) {
      rewardMoves.textContent = String(data.moves);
    }
    if (Number.isFinite(data?.time)) {
      rewardTime.textContent = formatTime(data.time);
    }
  } catch {
    // ignore parsing errors
  }
}

function getToken() {
  return localStorage.getItem("blockminer_token");
}

async function claimReward() {
  const token = getToken();
  if (!token) {
    setStatus("Please login to claim rewards.", "error");
    return;
  }

  claimBtn.disabled = true;
  setStatus("Submitting reward...", "");

  try {
    const response = await fetch("/api/games/memory/claim", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rewardGh: 5 })
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || "Unable to claim reward.");
    }

    rewardValue.textContent = `${payload.rewardGh} GH/s`;
    setStatus(
      payload.boosted
        ? "Reward claimed! Boosted for 7 days."
        : "Reward claimed! Duration: 24 hours.",
      "success"
    );
  } catch (error) {
    setStatus(error.message || "Unable to claim reward.", "error");
    claimBtn.disabled = false;
  }
}

claimBtn.addEventListener("click", claimReward);
loadLastStats();
