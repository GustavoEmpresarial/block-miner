// FaucetPay Integration (Email-only)
// Use getters to ensure elements are accessed after DOM is ready
const faucetpayElements = {
  get manualForm() { return document.getElementById("faucetpayManualForm"); },
  get withdrawForm() { return document.getElementById("faucetpayWithdrawForm"); },
  get amountInput() { return document.getElementById("faucetpayAmount"); },
  get emailInput() { return document.getElementById("faucetpayEmail"); },
  
  get notLinkedSection() { return document.getElementById("faucetpayNotLinked"); },
  get linkedSection() { return document.getElementById("faucetpayLinked"); },
  get linkedEmail() { return document.getElementById("faucetpayLinkedEmail"); },
  
  get unlinkBtn() { return document.getElementById("unlinkFaucetPayBtn"); },
  get summaryAmount() { return document.getElementById("faucetpaySummaryAmount"); },
  get summaryTotal() { return document.getElementById("faucetpaySummaryTotal"); },
  get withdrawBtn() { return document.getElementById("faucetpayWithdrawBtn"); }
};

const FAUCETPAY_DEBUG = localStorage.getItem("blockminer_debug") === "1";
function debugLog(...args) {
  if (FAUCETPAY_DEBUG) console.log(...args);
}
function debugError(...args) {
  if (FAUCETPAY_DEBUG) console.error(...args);
}

debugLog("[FaucetPay] Module with lazy element getters loaded");

let faucetpayState = {
  isLinked: false,
  account: null,
  balance: 0,
  isProcessing: false  // Prevent multiple submissions
};

function getToken() {
  return localStorage.getItem("blockminer_token");
}

function formatNumber(num, decimals = 6) {
  return parseFloat(num).toFixed(decimals);
}

// Check if FaucetPay is linked
async function checkFaucetPayLink() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/faucetpay/account", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();
    if (data.ok && data.account) {
      faucetpayState.isLinked = true;
      faucetpayState.account = data.account;
      updateFaucetPayUI();
    }
  } catch (error) {
    debugError("Error checking FaucetPay link:", error);
  }
}

// Update UI based on link status
function updateFaucetPayUI() {
  if (faucetpayState.isLinked && faucetpayState.account) {
    faucetpayElements.notLinkedSection.style.display = "none";
    faucetpayElements.linkedSection.style.display = "block";
    faucetpayElements.linkedEmail.textContent = faucetpayState.account.faucetpay_email;
  } else {
    faucetpayElements.notLinkedSection.style.display = "block";
    faucetpayElements.linkedSection.style.display = "none";
  }
}

// Link FaucetPay account with email only
async function linkFaucetPayManual(event) {
  debugLog("[FaucetPay] 🚀 linkFaucetPayManual CALLED!", event);
  
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  
  debugLog("[FaucetPay] Event prevented, checking isProcessing:", faucetpayState.isProcessing);
  
  // Prevent multiple submissions
  if (faucetpayState.isProcessing) {
    debugLog("[FaucetPay] Already processing, returning false");
    return false;
  }
  
  faucetpayState.isProcessing = true;
  debugLog("[FaucetPay] isProcessing set to true, proceeding...");

  const emailInput = document.getElementById("faucetpayEmail");
  debugLog("[FaucetPay] emailInput element:", emailInput);
  
  const email = emailInput?.value?.trim();
  debugLog("[FaucetPay] Email value:", email);
  
  const token = getToken();
  debugLog("[FaucetPay] Token:", token ? "EXISTS" : "NOT FOUND");

  if (!email) {
    debugLog("[FaucetPay] ❌ No email entered");
    window.notify?.("Please enter your FaucetPay email", "error");
    faucetpayState.isProcessing = false;
    return false;
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    debugLog("[FaucetPay] ❌ Invalid email format");
    window.notify?.("Please enter a valid email address", "error");
    faucetpayState.isProcessing = false;
    return false;
  }
  
  debugLog("[FaucetPay] ✅ Email valid, making API call...");

  try {
    debugLog("[FaucetPay] Sending POST to /api/faucetpay/link");
    debugLog("[FaucetPay] Request body:", { faucetPayEmail: email });
    debugLog("[FaucetPay] Authorization header:", token ? "Bearer " + token.substring(0, 20) + "..." : "MISSING");
    
    const response = await fetch("/api/faucetpay/link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        faucetPayEmail: email
      })
    });

    debugLog("[FaucetPay] Response received, status:", response.status);
    debugLog("[FaucetPay] Response headers:", response.headers);
    
    const data = await response.json();
    debugLog("[FaucetPay] Response data:", data);
    
    if (data.ok) {
      debugLog("[FaucetPay] ✅ Account linked successfully!");
      window.notify?.("FaucetPay account linked successfully!", "success");
      await checkFaucetPayLink();
      const form = document.getElementById("faucetpayManualForm");
      if (form) {
        form.reset();
        debugLog("[FaucetPay] Form reset");
      }
    } else {
      debugLog("[FaucetPay] ❌ Link failed:", data.message);
      window.notify?.(data.message || "Failed to link account", "error");
    }
  } catch (error) {
    debugError("[FaucetPay] ❌ Error linking FaucetPay:", error);
    debugError("[FaucetPay] Error type:", error?.constructor?.name);
    debugError("[FaucetPay] Error message:", error?.message);
    debugError("[FaucetPay] Error stack:", error?.stack);
    
    if (error?.name === "TypeError") {
      debugError("[FaucetPay] 🔴 Network error - server might be down or CORS issue");
      window.notify?.("Network error - please check if server is running", "error");
    } else {
      window.notify?.("Failed to link account", "error");
    }
  } finally {
    faucetpayState.isProcessing = false;
    debugLog("[FaucetPay] isProcessing reset to false");
  }
  
  return false;
}

// Update FaucetPay withdrawal summary
function updateFaucetPaySummary() {
  const amount = parseFloat(faucetpayElements.amountInput.value) || 0;
  
  faucetpayElements.summaryAmount.textContent = formatNumber(amount);
  faucetpayElements.summaryTotal.textContent = formatNumber(amount); // No fee
  
  // Enable/disable button
  if (faucetpayState.isLinked && amount > 0) {
    faucetpayElements.withdrawBtn.disabled = false;
  } else {
    faucetpayElements.withdrawBtn.disabled = true;
  }
}

// Withdraw via FaucetPay
async function withdrawFaucetPay(event) {
  event.preventDefault();

  const amount = parseFloat(faucetpayElements.amountInput.value);
  const token = getToken();

  if (!amount || amount <= 0) {
    window.notify?.("Enter a valid amount", "error");
    return;
  }

  if (amount > faucetpayState.balance) {
    window.notify?.("Insufficient balance", "error");
    return;
  }

  faucetpayElements.withdrawBtn.disabled = true;
  faucetpayElements.withdrawBtn.innerHTML =
    '<i class="bi bi-hourglass-split"></i> Processing...';

  try {
    const response = await fetch("/api/faucetpay/withdraw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ amount })
    });

    const data = await response.json();

    if (data.ok) {
      window.notify?.(data.message || "Withdrawal successful!", "success");
      faucetpayElements.amountInput.value = "";
      updateFaucetPaySummary();
      
      // Refresh balance
      if (window.loadBalance) {
        await window.loadBalance();
      }
    } else {
      window.notify?.(data.message || "Withdrawal failed", "error");
    }
  } catch (error) {
    debugError("Error withdrawing from FaucetPay:", error);
    window.notify?.("Failed to process withdrawal", "error");
  } finally {
    faucetpayElements.withdrawBtn.disabled = false;
    faucetpayElements.withdrawBtn.innerHTML =
      '<i class="bi bi-arrow-down-circle"></i> Withdraw via FaucetPay';
  }
}

// Unlink FaucetPay account
async function unlinkFaucetPay() {
  if (!confirm("Are you sure you want to unlink your FaucetPay account?")) {
    return;
  }

  const token = getToken();

  try {
    const response = await fetch("/api/faucetpay/unlink", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      faucetpayState.isLinked = false;
      faucetpayState.account = null;
      updateFaucetPayUI();
      window.notify?.("FaucetPay account unlinked", "success");
    } else {
      window.notify?.(data.message || "Failed to unlink", "error");
    }
  } catch (error) {
    debugError("Error unlinking FaucetPay:", error);
    window.notify?.("Failed to unlink account", "error");
  }
}

// Setup event listeners
let listenersAttached = false;

function setupFaucetPayListeners() {
  debugLog("[FaucetPay] setupFaucetPayListeners called, listenersAttached:", listenersAttached);
  
  // Prevent attaching listeners multiple times
  if (listenersAttached) {
    debugLog("[FaucetPay] Listeners already attached, skipping");
    return;
  }
  
  const manualForm = document.getElementById("faucetpayManualForm");
  const withdrawForm = document.getElementById("faucetpayWithdrawForm");
  const unlinkBtn = document.getElementById("unlinkFaucetPayBtn");
  const amountInput = document.getElementById("faucetpayAmount");
  
  debugLog("[FaucetPay] Element check:");
  debugLog("  - manualForm:", manualForm ? "FOUND" : "NOT FOUND", manualForm);
  debugLog("  - withdrawForm:", withdrawForm ? "FOUND" : "NOT FOUND");
  debugLog("  - unlinkBtn:", unlinkBtn ? "FOUND" : "NOT FOUND");
  debugLog("  - amountInput:", amountInput ? "FOUND" : "NOT FOUND");
  
  if (unlinkBtn) {
    unlinkBtn.addEventListener("click", unlinkFaucetPay);
    debugLog("[FaucetPay] ✅ unlinkBtn listener attached");
  }
  
  if (manualForm) {
    // Attach listener directly to ensure proper event handling
    manualForm.addEventListener("submit", linkFaucetPayManual);
    debugLog("[FaucetPay] ✅ manualForm listener attached");
  } else {
    debugError("[FaucetPay] ❌ manualForm NOT FOUND - cannot attach listener!");
  }
  
  if (withdrawForm) {
    withdrawForm.addEventListener("submit", withdrawFaucetPay);
    debugLog("[FaucetPay] ✅ withdrawForm listener attached");
  }
  
  if (amountInput) {
    amountInput.addEventListener("input", updateFaucetPaySummary);
    debugLog("[FaucetPay] ✅ amountInput listener attached");
  }
  
  listenersAttached = true;
  debugLog("[FaucetPay] All listeners setup complete!");
}

// Initialize FaucetPay section
async function initFaucetPay() {
  debugLog("[FaucetPay] 🚀 initFaucetPay called");
  setupFaucetPayListeners();
  await checkFaucetPayLink();
  updateFaucetPayUI();
  debugLog("[FaucetPay] ✅ Initialization complete");
}

// Export for wallet.js
window.initFaucetPay = initFaucetPay;
window.updateFaucetPayState = (newBalance) => {
  faucetpayState.balance = newBalance;
};
