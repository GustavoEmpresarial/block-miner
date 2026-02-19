function getToken() {
  return localStorage.getItem("blockminer_token");
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

const faucetState = {
  remainingMs: 0,
  timerId: null
};

function updateCooldownText() {
  const cooldownEl = document.getElementById("faucetCooldownText");
  const statusEl = document.getElementById("faucetStatusText");
  const claimBtn = document.getElementById("faucetClaimBtn");

  if (!cooldownEl || !statusEl || !claimBtn) return;

  if (faucetState.remainingMs <= 0) {
    cooldownEl.textContent = "";
    statusEl.textContent = "Faucet ready. Claim your miner.";
    claimBtn.disabled = false;
    return;
  }

  claimBtn.disabled = true;
  statusEl.textContent = "Cooldown active.";
  cooldownEl.textContent = `Next claim in ${formatDuration(faucetState.remainingMs)}.`;
}

function startCountdown() {
  if (faucetState.timerId) {
    clearInterval(faucetState.timerId);
  }

  faucetState.timerId = setInterval(() => {
    faucetState.remainingMs = Math.max(0, faucetState.remainingMs - 1000);
    updateCooldownText();

    if (faucetState.remainingMs <= 0) {
      clearInterval(faucetState.timerId);
      faucetState.timerId = null;
    }
  }, 1000);
}

async function loadFaucetStatus() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/faucet/status", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (!data.ok) {
      window.notify?.(data.message || "Unable to load faucet status.", "error");
      return;
    }

    const rewardImage = document.getElementById("faucetRewardImage");
    const rewardName = document.getElementById("faucetRewardName");
    const rewardMeta = document.getElementById("faucetRewardMeta");
    if (data.reward) {
      if (rewardImage) {
        rewardImage.src = data.reward.imageUrl || "";
        rewardImage.alt = data.reward.name || "Faucet reward";
      }
      if (rewardName) {
        rewardName.textContent = data.reward.name || "Faucet reward";
      }
      if (rewardMeta) {
        const hashRate = Number(data.reward.hashRate || 0);
        const slotSize = Number(data.reward.slotSize || 1);
        const slotText = slotSize > 1 ? ` · ${slotSize} slots` : "";
        rewardMeta.textContent = `${hashRate} GH/s${slotText}`;
      }
    }

    faucetState.remainingMs = Number(data.remainingMs || 0);
    updateCooldownText();
    if (faucetState.remainingMs > 0) {
      startCountdown();
    }
  } catch (error) {
    console.error("Error loading faucet status:", error);
    window.notify?.("Unable to load faucet status.", "error");
  }
}

async function claimFaucet() {
  const token = getToken();
  if (!token) return;

  const claimBtn = document.getElementById("faucetClaimBtn");
  if (claimBtn) claimBtn.disabled = true;

  try {
    const response = await fetch("/api/faucet/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (response.ok && data.ok) {
      window.notify?.(data.message || "Faucet claimed.", "success");
      if (data.reward) {
        const rewardImage = document.getElementById("faucetRewardImage");
        const rewardName = document.getElementById("faucetRewardName");
        const rewardMeta = document.getElementById("faucetRewardMeta");
        if (rewardImage) {
          rewardImage.src = data.reward.imageUrl || "";
          rewardImage.alt = data.reward.name || "Faucet reward";
        }
        if (rewardName) {
          rewardName.textContent = data.reward.name || "Faucet reward";
        }
        if (rewardMeta) {
          const hashRate = Number(data.reward.hashRate || 0);
          const slotSize = Number(data.reward.slotSize || 1);
          const slotText = slotSize > 1 ? ` · ${slotSize} slots` : "";
          rewardMeta.textContent = `${hashRate} GH/s${slotText}`;
        }
      }
      faucetState.remainingMs = 60 * 60 * 1000;
      updateCooldownText();
      startCountdown();
      return;
    }

    if (response.status === 429 && Number.isFinite(Number(data.remainingMs))) {
      faucetState.remainingMs = Number(data.remainingMs);
      updateCooldownText();
      startCountdown();
      window.notify?.("Cooldown active. Please wait.", "error");
      return;
    }

    window.notify?.(data.message || "Unable to claim faucet.", "error");
  } catch (error) {
    console.error("Error claiming faucet:", error);
    window.notify?.("Unable to claim faucet.", "error");
  } finally {
    if (claimBtn && faucetState.remainingMs <= 0) claimBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const claimBtn = document.getElementById("faucetClaimBtn");
  if (claimBtn) {
    claimBtn.addEventListener("click", claimFaucet);
  }
  loadFaucetStatus();
});
