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

function getToken() {
  return localStorage.getItem("blockminer_token");
}

function formatToken(value, symbol) {
  const safeValue = Number(value || 0);
  if (!Number.isFinite(safeValue)) {
    return `0 ${symbol}`;
  }

  return `${safeValue.toFixed(4)} ${symbol}`;
}

async function updateEstimatedReward() {
  const estimatedEl = document.getElementById("statEstimatedReward");
  if (!estimatedEl) {
    return;
  }

  const token = getToken();
  if (!token) {
    estimatedEl.textContent = "Sign in to see";
    return;
  }

  try {
    const estimateResponse = await fetch("/api/estimated-reward", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
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

    await updateEstimatedReward();

    if (statusEl) statusEl.textContent = "Updated just now.";
  } catch {
    if (statusEl) statusEl.textContent = "Failed to load stats.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshStatsBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadNetworkStats);
  }

  updateEstimatedReward();
  loadNetworkStats();
  setInterval(loadNetworkStats, 20000);
});
