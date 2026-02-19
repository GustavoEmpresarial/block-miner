function showSwapFeedback(target, message, type = "info") {
  if (!target) return;
  target.textContent = message;
  target.classList.remove("is-error", "is-success");
  if (type === "error") target.classList.add("is-error");
  if (type === "success") target.classList.add("is-success");
}

function getToken() {
  return localStorage.getItem("blockminer_token");
}

const swapState = {
  balances: { POL: 0, USDC: 0 }
};

function sanitizeAmountInput(value) {
  if (typeof value !== "string") {
    return "";
  }

  let cleaned = value.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  }

  const [whole, decimal = ""] = cleaned.split(".");
  const trimmedDecimal = decimal.slice(0, 6);
  return trimmedDecimal.length > 0 ? `${whole}.${trimmedDecimal}` : whole;
}

async function loadSwapBalances() {
  const token = getToken();
  const feedback = document.getElementById("swapFeedback");
  if (!token) {
    showSwapFeedback(feedback, "Please log in to view your balances.", "error");
    return;
  }

  try {
    const response = await fetch("/api/swap/balances", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.ok) {
      const polBalance = document.getElementById("polBalance");
      const usdcBalance = document.getElementById("usdcBalance");
      swapState.balances.POL = Number(data.balances.POL || 0);
      swapState.balances.USDC = Number(data.balances.USDC || 0);
      if (polBalance) polBalance.textContent = swapState.balances.POL.toFixed(6);
      if (usdcBalance) usdcBalance.textContent = swapState.balances.USDC.toFixed(6);
      showSwapFeedback(feedback, "", "info");
    } else {
      showSwapFeedback(feedback, data.message || "Failed to load balances.", "error");
    }
  } catch (error) {
    showSwapFeedback(feedback, "Failed to load balances.", "error");
    console.error("Error loading balances:", error);
  }
}

async function updateQuote() {
  const token = getToken();
  const feedback = document.getElementById("swapFeedback");
  if (!token) {
    showSwapFeedback(feedback, "Please log in to get a quote.", "error");
    return;
  }

  const amountInput = document.getElementById("swapAmount");
  const fromSelect = document.getElementById("swapFrom");
  const toSelect = document.getElementById("swapTo");
  const rateEl = document.getElementById("swapRate");
  const outputEl = document.getElementById("swapOutput");

  const amount = Number(amountInput?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    if (outputEl) outputEl.value = "0.000000";
    if (rateEl) rateEl.textContent = "-";
    return;
  }

  try {
    const response = await fetch("/api/swap/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        fromAsset: fromSelect?.value,
        toAsset: toSelect?.value,
        amount
      })
    });
    const data = await response.json();
    if (data.ok) {
      const rate = Number(data.rate);
      const output = Number(data.output);
      if (rateEl) {
        if (fromSelect?.value === "POL") {
          rateEl.textContent = `1 POL = ${rate.toFixed(6)} USDC`;
        } else {
          rateEl.textContent = `1 USDC = ${(1 / rate).toFixed(6)} POL`;
        }
      }
      if (outputEl) outputEl.value = output.toFixed(6);
      showSwapFeedback(feedback, "", "info");
    } else {
      if (rateEl) rateEl.textContent = "-";
      if (outputEl) outputEl.value = "0.000000";
      showSwapFeedback(feedback, data.message || "Failed to get quote.", "error");
    }
  } catch (error) {
    if (outputEl) outputEl.value = "0.000000";
    if (rateEl) rateEl.textContent = "-";
    showSwapFeedback(feedback, "Failed to get quote.", "error");
    console.error("Error getting quote:", error);
  }
}

function syncToAsset() {
  const fromSelect = document.getElementById("swapFrom");
  const toSelect = document.getElementById("swapTo");
  if (!fromSelect || !toSelect) return;
  toSelect.value = fromSelect.value === "POL" ? "USDC" : "POL";
}

async function executeSwap(event) {
  event.preventDefault();
  const token = getToken();
  const feedback = document.getElementById("swapFeedback");
  if (!token) {
    showSwapFeedback(feedback, "Please log in to swap.", "error");
    return;
  }

  const amountInput = document.getElementById("swapAmount");
  const fromSelect = document.getElementById("swapFrom");
  const toSelect = document.getElementById("swapTo");
  const submitBtn = document.querySelector(".swap-button");

  const amount = Number(amountInput?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    showSwapFeedback(feedback, "Enter a valid amount.", "error");
    return;
  }

  const fromAsset = fromSelect?.value || "POL";
  const available = swapState.balances[fromAsset] || 0;
  if (amount > available) {
    showSwapFeedback(feedback, "Insufficient balance for this swap.", "error");
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    const response = await fetch("/api/swap/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        fromAsset,
        toAsset: toSelect?.value,
        amount
      })
    });
    const data = await response.json();
    if (data.ok) {
      showSwapFeedback(feedback, "Swap completed successfully.", "success");
      amountInput.value = "";
      await loadSwapBalances();
      await updateQuote();
    } else {
      showSwapFeedback(feedback, data.message || "Swap failed.", "error");
    }
  } catch (error) {
    showSwapFeedback(feedback, "Swap failed.", "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const fromSelect = document.getElementById("swapFrom");
  const amountInput = document.getElementById("swapAmount");
  const swapForm = document.getElementById("swapForm");

  loadSwapBalances();
  updateQuote();

  fromSelect?.addEventListener("change", () => {
    syncToAsset();
    updateQuote();
  });

  amountInput?.addEventListener("input", (event) => {
    const sanitized = sanitizeAmountInput(event.target.value);
    if (sanitized !== event.target.value) {
      event.target.value = sanitized;
    }
    updateQuote();
  });
  swapForm?.addEventListener("submit", executeSwap);
});
