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

console.log("[FaucetPay] Module with lazy element getters loaded");

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
    console.error("Error checking FaucetPay link:", error);
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
  console.log("[FaucetPay] 🚀 linkFaucetPayManual CALLED!", event);
  
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  
  console.log("[FaucetPay] Event prevented, checking isProcessing:", faucetpayState.isProcessing);
  
  // Prevent multiple submissions
  if (faucetpayState.isProcessing) {
    console.log("[FaucetPay] Already processing, returning false");
    return false;
  }
  
  faucetpayState.isProcessing = true;
  console.log("[FaucetPay] isProcessing set to true, proceeding...");

  const emailInput = document.getElementById("faucetpayEmail");
  console.log("[FaucetPay] emailInput element:", emailInput);
  
  const email = emailInput?.value?.trim();
  console.log("[FaucetPay] Email value:", email);
  
  const token = getToken();
  console.log("[FaucetPay] Token:", token ? "EXISTS" : "NOT FOUND");

  if (!email) {
    console.log("[FaucetPay] ❌ No email entered");
    window.notify?.("Please enter your FaucetPay email", "error");
    faucetpayState.isProcessing = false;
    return false;
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log("[FaucetPay] ❌ Invalid email format");
    window.notify?.("Please enter a valid email address", "error");
    faucetpayState.isProcessing = false;
    return false;
  }
  
  console.log("[FaucetPay] ✅ Email valid, making API call...");

  try {
    console.log("[FaucetPay] Sending POST to /api/faucetpay/link");
    console.log("[FaucetPay] Request body:", { faucetPayEmail: email });
    console.log("[FaucetPay] Authorization header:", token ? "Bearer " + token.substring(0, 20) + "..." : "MISSING");
    
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

    console.log("[FaucetPay] Response received, status:", response.status);
    console.log("[FaucetPay] Response headers:", response.headers);
    
    const data = await response.json();
    console.log("[FaucetPay] Response data:", data);
    
    if (data.ok) {
      console.log("[FaucetPay] ✅ Account linked successfully!");
      window.notify?.("FaucetPay account linked successfully!", "success");
      await checkFaucetPayLink();
      const form = document.getElementById("faucetpayManualForm");
      if (form) {
        form.reset();
        console.log("[FaucetPay] Form reset");
      }
    } else {
      console.log("[FaucetPay] ❌ Link failed:", data.message);
      window.notify?.(data.message || "Failed to link account", "error");
    }
  } catch (error) {
    console.error("[FaucetPay] ❌ Error linking FaucetPay:", error);
    console.error("[FaucetPay] Error type:", error.constructor.name);
    console.error("[FaucetPay] Error message:", error.message);
    console.error("[FaucetPay] Error stack:", error.stack);
    
    if (error.name === 'TypeError') {
      console.error("[FaucetPay] 🔴 Network error - server might be down or CORS issue");
      window.notify?.("Network error - please check if server is running", "error");
    } else {
      window.notify?.("Failed to link account", "error");
    }
  } finally {
    faucetpayState.isProcessing = false;
    console.log("[FaucetPay] isProcessing reset to false");
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
    console.error("Error withdrawing from FaucetPay:", error);
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
    console.error("Error unlinking FaucetPay:", error);
    window.notify?.("Failed to unlink account", "error");
  }
}

// Setup event listeners
let listenersAttached = false;

function setupFaucetPayListeners() {
  console.log("[FaucetPay] setupFaucetPayListeners called, listenersAttached:", listenersAttached);
  
  // Prevent attaching listeners multiple times
  if (listenersAttached) {
    console.log("[FaucetPay] Listeners already attached, skipping");
    return;
  }
  
  const manualForm = document.getElementById("faucetpayManualForm");
  const withdrawForm = document.getElementById("faucetpayWithdrawForm");
  const unlinkBtn = document.getElementById("unlinkFaucetPayBtn");
  const amountInput = document.getElementById("faucetpayAmount");
  
  console.log("[FaucetPay] Element check:");
  console.log("  - manualForm:", manualForm ? "FOUND" : "NOT FOUND", manualForm);
  console.log("  - withdrawForm:", withdrawForm ? "FOUND" : "NOT FOUND");
  console.log("  - unlinkBtn:", unlinkBtn ? "FOUND" : "NOT FOUND");
  console.log("  - amountInput:", amountInput ? "FOUND" : "NOT FOUND");
  
  if (unlinkBtn) {
    unlinkBtn.addEventListener("click", unlinkFaucetPay);
    console.log("[FaucetPay] ✅ unlinkBtn listener attached");
  }
  
  if (manualForm) {
    // Attach listener directly to ensure proper event handling
    manualForm.addEventListener("submit", linkFaucetPayManual);
    console.log("[FaucetPay] ✅ manualForm listener attached");
  } else {
    console.error("[FaucetPay] ❌ manualForm NOT FOUND - cannot attach listener!");
  }
  
  if (withdrawForm) {
    withdrawForm.addEventListener("submit", withdrawFaucetPay);
    console.log("[FaucetPay] ✅ withdrawForm listener attached");
  }
  
  if (amountInput) {
    amountInput.addEventListener("input", updateFaucetPaySummary);
    console.log("[FaucetPay] ✅ amountInput listener attached");
  }
  
  listenersAttached = true;
  console.log("[FaucetPay] All listeners setup complete!");
}

// Initialize FaucetPay section
async function initFaucetPay() {
  console.log("[FaucetPay] 🚀 initFaucetPay called");
  setupFaucetPayListeners();
  await checkFaucetPayLink();
  updateFaucetPayUI();
  console.log("[FaucetPay] ✅ Initialization complete");
}

// Export for wallet.js
window.initFaucetPay = initFaucetPay;
window.updateFaucetPayState = (newBalance) => {
  faucetpayState.balance = newBalance;
};
