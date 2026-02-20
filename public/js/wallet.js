// DOM Elements - use getters to access after DOM is ready
const elements = {
  get balanceAmount() { return document.getElementById("balanceAmount"); },
  get lifetimeMined() { return document.getElementById("lifetimeMined"); },
  get totalWithdrawn() { return document.getElementById("totalWithdrawn"); },
  
  get walletNotConnected() { return document.getElementById("walletNotConnected"); },
  get walletConnected() { return document.getElementById("walletConnected"); },
  get connectedAddress() { return document.getElementById("connectedAddress"); },
  
  get connectWalletBtn() { return document.getElementById("connectWalletBtn"); },
  get disconnectWalletBtn() { return document.getElementById("disconnectWalletBtn"); },
  get copyAddressBtn() { return document.getElementById("copyAddressBtn"); },
  
  // Deposit elements
  get depositAddress() { return document.getElementById("depositAddress"); },
  get copyDepositAddressBtn() { return document.getElementById("copyDepositAddressBtn"); },
  get quickDepositSection() { return document.getElementById("quickDepositSection"); },
  get quickDepositForm() { return document.getElementById("quickDepositForm"); },
  get depositAmount() { return document.getElementById("depositAmount"); },
  get depositSummaryAmount() { return document.getElementById("depositSummaryAmount"); },
  get depositSummaryFee() { return document.getElementById("depositSummaryFee"); },
  get depositSummaryTotal() { return document.getElementById("depositSummaryTotal"); },
  get quickDepositBtn() { return document.getElementById("quickDepositBtn"); },
  get pendingDepositsSection() { return document.getElementById("pendingDepositsSection"); },
  get pendingDepositsList() { return document.getElementById("pendingDepositsList"); },
  
  get transactionList() { return document.getElementById("transactionList"); },
  get refreshBalanceBtn() { return document.getElementById("refreshBalanceBtn"); },
  get refreshHistoryBtn() { return document.getElementById("refreshHistoryBtn"); }
};

console.log("[Wallet] Module with lazy element getters loaded");

// State
const state = {
  walletAddress: null,
  walletProvider: null,
  boundProvider: null,
  balance: 0,
  lifetimeMined: 0,
  totalWithdrawn: 0,
  transactions: [],
  isConnecting: false  // Prevent multiple connection attempts
};

// Helper Functions
function getToken() {
  return localStorage.getItem("blockminer_token");
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return false;
  }
  return true;
}

function formatNumber(num, decimals = 6) {
  return parseFloat(num).toFixed(decimals);
}



function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString();
}

// Wallet / Web3 Functions (for deposits only)
async function connectWallet() {
  // Prevent multiple connection attempts
  if (state.isConnecting) {
    return;
  }
  
  state.isConnecting = true;
  
  if (typeof window.ethereum === "undefined") {
    window.notify?.("Wallet not detected. Install Trust Wallet or MetaMask extension.", "error");
    state.isConnecting = false;
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];
    
    if (address) {
      state.walletAddress = address;
      state.walletProvider = window.ethereum;
      await saveWalletAddress(address);
      updateWalletUI();
      window.notify?.("Wallet connected!", "success");
    }
  } catch (error) {
    console.error("[Wallet] Error connecting wallet:", error);
    if (!error.code || error.code === 4001) {
      window.notify?.("Connection cancelled.", "info");
    } else {
      window.notify?.("Error connecting wallet.", "error");
    }
  } finally {
    state.isConnecting = false;
  }
}

async function disconnectWallet() {
  state.walletAddress = null;
  state.walletProvider = null;
  await saveWalletAddress(null);
  updateWalletUI();
  window.notify?.("Wallet disconnected.", "info");
}

async function saveWalletAddress(address) {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/wallet/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ walletAddress: address })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Failed to save wallet address:", data.message);
    }
  } catch (error) {
    console.error("Error saving wallet address:", error);
  }
}

function updateWalletUI() {
  if (state.walletAddress) {
    elements.walletNotConnected.style.display = "none";
    elements.walletConnected.style.display = "block";
    elements.connectedAddress.textContent = state.walletAddress;
    
    // Show quick deposit section when wallet is connected
    if (elements.quickDepositSection) {
      elements.quickDepositSection.style.display = "block";
    }
  } else {
    elements.walletNotConnected.style.display = "block";
    elements.walletConnected.style.display = "none";
    elements.connectedAddress.textContent = "";
    
    // Hide quick deposit section when wallet is not connected
    if (elements.quickDepositSection) {
      elements.quickDepositSection.style.display = "none";
    }
  }
}

// Deposit Functions
async function loadDepositAddress() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/wallet/deposit-address", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (data.ok && data.depositAddress) {
      elements.depositAddress.textContent = data.depositAddress;
    }
  } catch (error) {
    console.error("Error loading deposit address:", error);
    elements.depositAddress.textContent = "Error loading address";
  }
}

function updateDepositSummary() {
  if (!elements.depositAmount) return;

  const { amount } = parseDepositAmount(elements.depositAmount.value);
  const estimatedFee = 0.001; // Estimated gas fee
  const total = amount + estimatedFee;

  elements.depositSummaryAmount.textContent = `${formatNumber(amount)} POL`;
  elements.depositSummaryTotal.textContent = `~${formatNumber(total)} POL`;
}

function normalizeDecimalString(value) {
  let normalized = String(value || "").trim().replace(/,/g, ".");
  normalized = normalized.replace(/[^0-9.]/g, "");

  const dotIndex = normalized.indexOf(".");
  if (dotIndex !== -1) {
    const before = normalized.slice(0, dotIndex + 1);
    const after = normalized.slice(dotIndex + 1).replace(/\./g, "");
    normalized = before + after;
  }

  return normalized;
}

function parseDepositAmount(rawValue) {
  const normalizedRaw = normalizeDecimalString(rawValue);
  const [whole, fraction = ""] = normalizedRaw.split(".");
  const normalized = fraction ? `${whole}.${fraction.slice(0, 6)}` : whole;
  const amount = Number(normalized);

  return {
    amount: Number.isFinite(amount) ? amount : 0,
    normalized: normalized || "0"
  };
}

function decimalToWeiHex(amountStr) {
  const normalized = normalizeDecimalString(amountStr);
  const [whole, fraction = ""] = normalized.split(".");
  const wholeWei = BigInt(whole || "0") * 10n ** 18n;
  const fractionWei = BigInt((fraction + "000000000000000000").slice(0, 18) || "0");
  const wei = wholeWei + fractionWei;
  return `0x${wei.toString(16)}`;
}

async function handleQuickDeposit(event) {
  event.preventDefault();

  if (typeof window.ethereum === "undefined") {
    window.notify?.("Wallet not detected. Install Trust Wallet or MetaMask extension.", "error");
    return;
  }

  const { amount, normalized } = parseDepositAmount(elements.depositAmount.value);
  
  if (!amount || amount < 0.01) {
    window.notify?.("Minimum 0.01 POL", "error");
    return;
  }

  const token = getToken();
  if (!token) return;

  try {
    // Get deposit address from server
    const response = await fetch("/api/wallet/deposit-address", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();
    if (!data.ok || !data.depositAddress) {
      window.notify?.("Error getting deposit address", "error");
      return;
    }

    const depositAddress = data.depositAddress;
    
    // Disable button
    elements.quickDepositBtn.disabled = true;
    elements.quickDepositBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Sending...';

    // Convert amount to wei (18 decimals for POL)
    const amountWei = decimalToWeiHex(normalized);

    // Request transaction via wallet
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: state.walletAddress,
        to: depositAddress,
        value: amountWei,
        chainId: "0x89" // Polygon mainnet
      }]
    });

    window.notify?.("Transaction sent! Processing...", "info");

    // Notify server about the deposit
    await fetch("/api/wallet/deposit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        txHash,
        amount: normalized,
        fromAddress: state.walletAddress
      })
    });

    elements.depositAmount.value = "";
    updateDepositSummary();
    
    window.notify?.("Deposit sent! Balance will update after confirmation.", "success");
    
    // Refresh balance after a delay
    setTimeout(() => loadBalance(), 5000);
    
  } catch (error) {
    console.error("Error processing deposit:", error);
    if (error.code === 4001) {
      window.notify?.("Transaction cancelled", "info");
    } else {
      window.notify?.("Error processing deposit", "error");
    }
  } finally {
    elements.quickDepositBtn.disabled = false;
    elements.quickDepositBtn.innerHTML = '<i class="bi bi-arrow-up-circle"></i> Deposit';
  }
}

function copyDepositAddress() {
  const address = elements.depositAddress.textContent;
  
  if (!address || address === "Loading..." || address === "Error loading address") {
    window.notify?.("No address to copy", "error");
    return;
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(address).then(() => {
      window.notify?.("Deposit address copied!", "success");
    }).catch(() => {
      window.notify?.("Failed to copy address", "error");
    });
    return;
  }

  // Fallback for older browsers
  const textarea = document.createElement("textarea");
  textarea.value = address;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    const success = document.execCommand("copy");
    window.notify?.(success ? "Deposit address copied!" : "Failed to copy address", success ? "success" : "error");
  } catch {
    window.notify?.("Failed to copy address", "error");
  } finally {
    document.body.removeChild(textarea);
  }
}

// Balance Functions
async function loadBalance() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/wallet/balance", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      state.balance = data.balance || 0;
      state.lifetimeMined = data.lifetimeMined || 0;
      state.totalWithdrawn = data.totalWithdrawn || 0;
      state.walletAddress = data.walletAddress || null;
      
      updateBalanceUI();
      updateWalletUI();
    }
  } catch (error) {
    console.error("Error loading balance:", error);
    window.notify?.("Failed to load balance.", "error");
  }
}

function updateBalanceUI() {
  elements.balanceAmount.textContent = formatNumber(state.balance);
  elements.lifetimeMined.textContent = `${formatNumber(state.lifetimeMined)} POL`;
  elements.totalWithdrawn.textContent = `${formatNumber(state.totalWithdrawn)} POL`;
  
  // Update FaucetPay balance if available
  if (window.updateFaucetPayState) {
    window.updateFaucetPayState(state.balance);
  }
}

// Transaction History Functions
async function loadTransactionHistory() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch("/api/wallet/transactions", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      state.transactions = data.transactions || [];
      renderTransactionHistory();
    }
  } catch (error) {
    console.error("Error loading transaction history:", error);
    window.notify?.("Failed to load transaction history.", "error");
  }
}

function renderTransactionHistory() {
  if (!state.transactions || state.transactions.length === 0) {
    elements.transactionList.innerHTML = `
      <div class="history-empty">
        <i class="bi bi-inbox"></i>
        <p>No transactions yet</p>
      </div>
    `;
    return;
  }

  elements.transactionList.innerHTML = state.transactions.map(tx => {
    const isWithdrawal = tx.type === "withdrawal";
    const icon = isWithdrawal ? "arrow-up-circle" : "arrow-down-circle";
    const typeClass = isWithdrawal ? "withdrawal" : "deposit";
    const amountPrefix = isWithdrawal ? "-" : "+";
    
    return `
      <div class="transaction-item">
        <div class="transaction-icon ${typeClass}">
          <i class="bi bi-${icon}"></i>
        </div>
        <div class="transaction-details">
          <div class="transaction-type">${tx.type === "withdrawal" ? "Withdrawal" : "Deposit"}</div>
          <div class="transaction-date">${formatDate(tx.created_at)}</div>
        </div>
        <div class="transaction-amount ${typeClass}">
          ${amountPrefix}${formatNumber(tx.amount)} POL
        </div>
        <div class="transaction-status ${tx.status}">
          ${tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
        </div>
      </div>
    `;
  }).join("");
}

// Copy Address
function copyAddress() {
  if (!state.walletAddress) return;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(state.walletAddress).then(() => {
      window.notify?.("Address copied to clipboard!", "success");
    }).catch(() => {
      window.notify?.("Failed to copy address.", "error");
    });
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = state.walletAddress;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const success = document.execCommand("copy");
    window.notify?.(success ? "Address copied to clipboard!" : "Failed to copy address.", success ? "success" : "error");
  } catch {
    window.notify?.("Failed to copy address.", "error");
  } finally {
    document.body.removeChild(textarea);
  }
}

// Event Listeners
let walletListenersAttached = false;

function setupEventListeners() {
  // Prevent attaching listeners multiple times
  if (walletListenersAttached) {
    return;
  }
  
  const connectWalletBtn = document.getElementById("connectWalletBtn");
  const disconnectWalletBtn = document.getElementById("disconnectWalletBtn");
  const depositAmount = document.getElementById("depositAmount");
  
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener("click", (e) => {
      e.preventDefault();
      connectWallet();
    });
  }
  
  if (disconnectWalletBtn) {
    disconnectWalletBtn.addEventListener("click", disconnectWallet);
  }
  
  if (elements.copyAddressBtn) {
    elements.copyAddressBtn.addEventListener("click", copyAddress);
  }
  
  if (elements.refreshBalanceBtn) {
    elements.refreshBalanceBtn.addEventListener("click", loadBalance);
  }
  
  if (elements.refreshHistoryBtn) {
    elements.refreshHistoryBtn.addEventListener("click", loadTransactionHistory);
  }
  
  // Deposit event listeners
  if (elements.copyDepositAddressBtn) {
    elements.copyDepositAddressBtn.addEventListener("click", copyDepositAddress);
  }
  
  if (elements.quickDepositForm) {
    elements.quickDepositForm.addEventListener("submit", handleQuickDeposit);
  }
  
  if (depositAmount) {
    depositAmount.addEventListener("input", updateDepositSummary);
  }

  walletListenersAttached = true;

  // Listen for wallet account changes
  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnectWallet();
      } else {
        state.walletAddress = accounts[0];
        state.walletProvider = window.ethereum;
        saveWalletAddress(accounts[0]);
        updateWalletUI();
      }
    });
  }
}

// Initialize
async function init() {
  if (!checkAuth()) return;

  setupEventListeners();
  await loadBalance();
  await loadDepositAddress();
  await loadTransactionHistory();
  
  // Initialize FaucetPay after wallet loads
  requestAnimationFrame(() => {
    setTimeout(async () => {
      if (window.initFaucetPay) {
        try {
          await window.initFaucetPay();
        } catch (error) {
          console.error("[Wallet] Error initializing FaucetPay:", error);
        }
      }
    }, 200);
  });
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Export for other modules
window.walletState = state;
window.loadBalance = loadBalance;
