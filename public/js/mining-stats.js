function formatHashrate(value) {
  const safeValue = Number(value || 0);
  if (!Number.isFinite(safeValue)) {
    return "0 H/s";
  }

  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s"];
  let scaled = safeValue;
  let unitIndex = 0;

  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }

  const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}

function formatToken(value, symbol) {
  const safeValue = Number(value || 0);
  if (!Number.isFinite(safeValue)) {
    return `0 ${symbol}`;
  }

  return `${safeValue.toFixed(4)} ${symbol}`;
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

async function updateEstimatedReward() {
  const estimatedEl = document.getElementById("statEstimatedReward");
  if (!estimatedEl) {
    return;
  }

  try {
    let estimateResponse = await fetch("/api/estimated-reward", {
      credentials: "include"
    });

    if (estimateResponse.status === 401) {
      await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include"
      }).catch(() => undefined);

      estimateResponse = await fetch("/api/estimated-reward", {
        credentials: "include"
      });
    }

    if (!estimateResponse.ok) {
      estimatedEl.textContent = estimateResponse.status === 401 ? "Sign in to see" : "Unavailable";
      return;
    }

    const estimatePayload = await estimateResponse.json();
    if (estimatePayload?.ok) {
      estimatedEl.textContent = formatToken(estimatePayload.estimatedReward, estimatePayload.tokenSymbol || "POL");
    } else {
      estimatedEl.textContent = "Unavailable";
    }
  } catch {
    estimatedEl.textContent = "Unavailable";
  }
}

async function loadNetworkStats() {
  const statusEl = document.getElementById("statsStatus");
  try {
    const response = await fetch("/api/network-stats");
    const payload = await response.json();
    if (!payload?.ok) {
      if (statusEl) statusEl.textContent = "Unable to load stats.";
      return;
    }

    const networkHashEl = document.getElementById("statNetworkHash");
    const gameHashEl = document.getElementById("statGameHash");
    const usersEl = document.getElementById("statUsers");
    const paidEl = document.getElementById("statPaid");
    const daysEl = document.getElementById("statDays");

    if (networkHashEl) networkHashEl.textContent = formatHashrate(payload.networkHashRate);
    if (gameHashEl) gameHashEl.textContent = formatHashrate(payload.activeGameHashRate);
    if (usersEl) usersEl.textContent = Number(payload.registeredUsers || 0).toLocaleString("en-US");
    if (paidEl) paidEl.textContent = `${Number(payload.totalPaid || 0).toLocaleString("en-US")} POL`;
    if (daysEl) daysEl.textContent = Number(payload.daysOnline || 0).toLocaleString("en-US");

    const nextBlockEl = document.getElementById("statNextBlock");
    if (nextBlockEl) {
      try {
        const stateResponse = await fetch("/api/state", { credentials: "include" });
        const statePayload = await stateResponse.json();
        nextBlockEl.textContent = formatCountdown(statePayload?.blockCountdownSeconds ?? 0);
      } catch {
        nextBlockEl.textContent = "Unavailable";
      }
    }

    await updateEstimatedReward();
    await loadMiningRewards();
    await loadPowerRanking();

    if (statusEl) statusEl.textContent = "Updated just now.";
  } catch {
    if (statusEl) statusEl.textContent = "Failed to load stats.";
  }
}

async function loadPowerRanking() {
  const container = document.getElementById("powerRankingContainer");
  if (!container) return;

  try {
    const response = await fetch("/api/network-ranking?limit=20");
    if (!response.ok) {
      container.innerHTML = '<p class="text-muted">Unable to load ranking...</p>';
      return;
    }

    const data = await response.json();
    if (!data.ok || !Array.isArray(data.ranking) || data.ranking.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No active miners in ranking yet.</p>';
      return;
    }

    const rankingHTML = data.ranking.map((entry) => `
      <div class="reward-item">
        <div class="reward-header">
          <span class="reward-block">#${entry.rank} ${entry.username}</span>
          <span class="reward-time">${formatHashrate(entry.totalHashRate)}</span>
        </div>
        <div class="reward-details">
          <div class="reward-row">
            <span class="label">Mining Room:</span>
            <span class="value">${formatHashrate(entry.baseHashRate)}</span>
          </div>
          <div class="reward-row">
            <span class="label">Active Games (24h / 7d):</span>
            <span class="value">${formatHashrate(entry.gameHashRate)}</span>
          </div>
        </div>
      </div>
    `).join("");

    container.innerHTML = rankingHTML;
  } catch {
    container.innerHTML = '<p class="text-muted">Failed to load ranking</p>';
  }
}

async function loadMiningRewards() {
  const container = document.getElementById("miningRewardsContainer");
  if (!container) return;

  try {
    const response = await fetch("/api/wallet/mining-rewards", {
      credentials: "include"
    });

    if (!response.ok) {
      container.innerHTML = '<p class="text-muted">Unable to load rewards...</p>';
      return;
    }

    const data = await response.json();
    if (!data.ok || !data.rewards || data.rewards.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No mining rewards yet. Start mining to earn!</p>';
      return;
    }

    const latestRewards = data.rewards.slice(0, 3);

    const rewardsHTML = latestRewards.map((reward) => {
      const date = new Date(reward.createdAt);
      const timeAgo = getTimeAgo(reward.timestamp);
      
      return `
        <div class="reward-item">
          <div class="reward-header">
            <span class="reward-block">Block #${reward.blockNumber}</span>
            <span class="reward-time">${timeAgo}</span>
          </div>
          <div class="reward-details">
            <div class="reward-row">
              <span class="label">Your Share:</span>
              <span class="value">${reward.sharePercentage}%</span>
            </div>
            <div class="reward-row">
              <span class="label">Work Accumulated:</span>
              <span class="value">${reward.workAccumulated} GH</span>
            </div>
            <div class="reward-row highlight">
              <span class="label"><i class="bi bi-coin"></i> Reward:</span>
              <span class="value-reward">${reward.rewardAmount} POL</span>
            </div>
            <div class="reward-row">
              <span class="label">New Balance:</span>
              <span class="value">${reward.balanceAfterReward} POL</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = rewardsHTML;
  } catch (error) {
    console.error("Error loading mining rewards:", error);
    container.innerHTML = '<p class="text-muted">Failed to load rewards</p>';
  }
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const elapsed = now - timestamp;
  
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return "Just now";
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshStatsBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadNetworkStats);
  }

  updateEstimatedReward();
  loadNetworkStats();
  loadMiningRewards();
  setInterval(() => {
    loadNetworkStats();
    loadMiningRewards();
  }, 20000);
});
