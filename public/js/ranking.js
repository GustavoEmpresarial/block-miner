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

async function loadPowerRanking() {
  const container = document.getElementById("powerRankingContainer");
  if (!container) return;

  try {
    const response = await fetch("/api/network-ranking?limit=50", { credentials: "include" });
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

document.addEventListener("DOMContentLoaded", () => {
  loadPowerRanking();
  setInterval(loadPowerRanking, 20000);
});
