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

  // Withdrawal elements
  get withdrawForm() { return document.getElementById("withdrawForm"); },
  get withdrawAddress() { return document.getElementById("withdrawAddress"); },
  get withdrawAmount() { return document.getElementById("withdrawAmount"); },
  get withdrawSummaryAmount() { return document.getElementById("withdrawSummaryAmount"); },
  get withdrawSummaryTotal() { return document.getElementById("withdrawSummaryTotal"); },
  get withdrawSubmitBtn() { return document.getElementById("withdrawSubmitBtn"); },

  // Deposit elements
  get depositAddressInput() { return document.getElementById("depositAddressInput"); },
  get extensionDepositForm() { return document.getElementById("extensionDepositForm"); },
  get depositExtensionAmount() { return document.getElementById("depositExtensionAmount"); },
  get depositExtensionBtn() { return document.getElementById("depositExtensionBtn"); },
  get verifyDepositForm() { return document.getElementById("verifyDepositForm"); },
  get verifyTxHash() { return document.getElementById("verifyTxHash"); },
  get verifyDepositBtn() { return document.getElementById("verifyDepositBtn"); },
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
  depositAddress: null,
  pendingDeposits: [],
  transactions: [],
  isConnecting: false  // Prevent multiple connection attempts
};

const MIN_WITHDRAWAL_POL = 10;
const WITHDRAWAL_PROCESSING_NOTE = "Processing time: up to 10 business days.";

let balanceAutoRefreshTimer = null;

// Helper Functions
function getToken() {
  return "cookie-session";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function checkAuth() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    if (!response.ok) {
      window.location.href = "/login";
      return false;
    }
    const payload = await response.json();
    if (!payload?.ok) {
      window.location.href = "/login";
      return false;
    }
    return true;
  } catch {
    window.location.href = "/login";
    return false;
  }
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
  try {
    const response = await fetch("/api/wallet/address", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
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
  } else {
    elements.walletNotConnected.style.display = "block";
    elements.walletConnected.style.display = "none";
    elements.connectedAddress.textContent = "";
  }
}

// Deposit Functions
async function loadDepositAddress() {
  try {
    const response = await fetch("/api/wallet/deposit-address", { credentials: "include" });

    const data = await response.json();
    const address = String(data.depositAddress || data.address || "").trim();

    if (data.ok && address) {
      state.depositAddress = address;
      if (elements.depositAddressInput) {
        elements.depositAddressInput.value = address;
      }
    } else {
      state.depositAddress = null;
      if (elements.depositAddressInput) {
        elements.depositAddressInput.value = "Unavailable";
      }
      window.notify?.(data.message || "Erro ao carregar endereço de depósito", "error");
    }
  } catch (error) {
    console.error("Error loading deposit address:", error);
    state.depositAddress = null;
    if (elements.depositAddressInput) {
      elements.depositAddressInput.value = "Unavailable";
    }
    window.notify?.("Erro ao carregar endereço de depósito", "error");
  }
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

async function verifyDepositTxWithRetry(txHash, maxAttempts = 18, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch("/api/wallet/verify-deposit", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ txHash })
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (data?.ok && data?.status !== "pending") {
      return data;
    }

    if (data?.ok && data?.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (response.status === 400 && /not found|invalid/i.test(String(data?.message || ""))) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(data?.message || "Falha ao verificar depósito");
  }

  return { ok: true, status: "pending", message: "Transação enviada. Aguarde a confirmação da rede." };
}

async function registerDepositTx(txHash) {
  const response = await fetch("/api/wallet/verify-deposit", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ txHash })
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok && !data?.ok) {
    throw new Error(data?.message || "Falha ao registrar depósito");
  }

  return data;
}

async function loadPendingDeposits() {
  try {
    const response = await fetch("/api/wallet/pending-deposits", { credentials: "include" });
    const data = await response.json();
    if (data?.ok) {
      state.pendingDeposits = Array.isArray(data.deposits) ? data.deposits : [];
      renderPendingDeposits();
    }
  } catch (error) {
    console.error("Error loading pending deposits:", error);
  }
}

function renderPendingDeposits() {
  if (!elements.pendingDepositsList) {
    return;
  }

  if (!state.pendingDeposits.length) {
    elements.pendingDepositsList.innerHTML = `
      <div class="history-empty">
        <i class="bi bi-hourglass-split"></i>
        <p>No pending deposits</p>
      </div>
    `;
    return;
  }

  elements.pendingDepositsList.innerHTML = state.pendingDeposits.map((deposit) => `
    <div class="transaction-item">
      <div class="transaction-icon deposit">
        <i class="bi bi-arrow-down-circle"></i>
      </div>
      <div class="transaction-details">
        <div class="transaction-type">Deposit pending</div>
        <div class="transaction-date">${escapeHtml(formatDate(deposit.createdAt))}</div>
      </div>
      <div class="transaction-amount deposit">+${formatNumber(deposit.amount)} POL</div>
      <div class="transaction-status pending">Pending</div>
    </div>
  `).join("");
}

async function handleExtensionDeposit(event) {
  event.preventDefault();

  if (typeof window.ethereum === "undefined") {
    window.notify?.("Nenhuma extensão de carteira detectada no navegador.", "error");
    return;
  }

  if (!state.walletAddress) {
    window.notify?.("Conecte sua carteira antes de depositar.", "error");
    return;
  }

  const { amount, normalized } = parseDepositAmount(elements.depositExtensionAmount?.value || "");
  if (!amount || amount < 0.01) {
    window.notify?.("Informe um valor válido (mínimo 0.01 POL).", "error");
    return;
  }

  if (!state.depositAddress) {
    await loadDepositAddress();
  }

  if (!state.depositAddress) {
    window.notify?.("Não foi possível obter o endereço interno de depósito.", "error");
    return;
  }

  const originalText = elements.depositExtensionBtn?.innerHTML || "Depositar com Extensão";

  try {
    if (elements.depositExtensionBtn) {
      elements.depositExtensionBtn.disabled = true;
      elements.depositExtensionBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Confirmando...';
    }

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: state.walletAddress,
          to: state.depositAddress,
          value: decimalToWeiHex(normalized),
          chainId: "0x89"
        }
      ]
    });

    const registerResult = await registerDepositTx(txHash);

    window.notify?.(
      registerResult?.status === "pending"
        ? "Transação registrada. O crédito será aplicado automaticamente após confirmação, mesmo se você sair da wallet."
        : (registerResult?.message || "Transação enviada. Aguardando confirmação na rede..."),
      "info"
    );

    if (elements.depositExtensionBtn) {
      elements.depositExtensionBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Validando...';
    }

    const verification = await verifyDepositTxWithRetry(txHash, 6, 5000);

    if (verification?.ok && verification?.status !== "pending") {
      window.notify?.(verification.message || "Depósito confirmado e saldo atualizado.", "success");
      if (elements.depositExtensionAmount) {
        elements.depositExtensionAmount.value = "";
      }
      await loadBalance();
      await loadPendingDeposits();
      await loadTransactionHistory();
      return;
    }

    window.notify?.(verification?.message || "Transação registrada. O crédito será automático após confirmação.", "info");
    await loadPendingDeposits();
  } catch (error) {
    console.error("Error processing extension deposit:", error);
    if (error?.code === 4001) {
      window.notify?.("Transação cancelada na carteira.", "info");
    } else {
      window.notify?.(String(error?.message || "Falha ao processar depósito."), "error");
    }
  } finally {
    if (elements.depositExtensionBtn) {
      elements.depositExtensionBtn.disabled = false;
      elements.depositExtensionBtn.innerHTML = originalText;
    }
  }
}

// Manual deposit verification
async function handleVerifyDeposit(event) {
  event.preventDefault();

  const txHash = elements.verifyTxHash.value.trim();
  
  if (!txHash) {
    window.notify?.("Por favor, insira o hash da transação", "error");
    return;
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    window.notify?.("Hash de transação inválido", "error");
    return;
  }

  try {
    // Disable button
    elements.verifyDepositBtn.disabled = true;
    elements.verifyDepositBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando...';

    const response = await fetch("/api/wallet/verify-deposit", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ txHash })
    });

    const data = await response.json();
    
    if (data.ok) {
      const isPending = data.status === "pending";
      window.notify?.(
        data.message || (isPending ? "Depósito registrado e aguardando confirmação." : "Depósito confirmado."),
        isPending ? "info" : "success"
      );
      elements.verifyTxHash.value = "";
      
      // Refresh balance
      await loadBalance();
      await loadPendingDeposits();
      
      // Refresh transaction history
      await loadTransactionHistory();
    } else {
      window.notify?.(data.message || "Erro ao processar depósito", "error");
    }

  } catch (error) {
    console.error("Error reporting deposit:", error);
    window.notify?.("Erro de conexão. Tente novamente.", "error");
  } finally {
    // Re-enable button
    elements.verifyDepositBtn.disabled = false;
    elements.verifyDepositBtn.innerHTML = '<i class="bi bi-search"></i> Verificar e Creditar Depósito';
  }
}

// Balance Functions
async function loadBalance() {
  try {
    const response = await fetch("/api/wallet/balance", { credentials: "include" });

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
}

function updateWithdrawSummary() {
  if (!elements.withdrawAmount || !elements.withdrawSummaryAmount || !elements.withdrawSummaryTotal) {
    return;
  }

  const amount = parseFloat(elements.withdrawAmount.value) || 0;
  elements.withdrawSummaryAmount.textContent = `${formatNumber(amount)} POL`;
  elements.withdrawSummaryTotal.textContent = `${formatNumber(amount)} POL`;

  if (elements.withdrawSubmitBtn) {
    const hasAddress = Boolean(elements.withdrawAddress?.value?.trim());
    elements.withdrawSubmitBtn.disabled = !(amount > 0 && hasAddress);
  }
}

async function handleWithdraw(event) {
  event.preventDefault();

  const address = elements.withdrawAddress?.value?.trim();
  const amountRaw = elements.withdrawAmount?.value?.trim();
  const amount = parseFloat(amountRaw);

  if (!address) {
    window.notify?.("Please enter a destination address", "error");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    window.notify?.("Enter a valid amount", "error");
    return;
  }

  if (amount < MIN_WITHDRAWAL_POL) {
    window.notify?.(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_POL} POL. ${WITHDRAWAL_PROCESSING_NOTE}`, "error");
    return;
  }

  if (amount > state.balance) {
    window.notify?.("Insufficient balance", "error");
    return;
  }

  if (elements.withdrawSubmitBtn) {
    elements.withdrawSubmitBtn.disabled = true;
    elements.withdrawSubmitBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Processing...';
  }

  try {
    const response = await fetch("/api/wallet/withdraw", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount, address })
    });

    const data = await response.json();
    if (data.ok) {
      window.notify?.(data.message || "Withdrawal requested successfully", "success");
      if (elements.withdrawAmount) {
        elements.withdrawAmount.value = "";
      }
      updateWithdrawSummary();
      await loadBalance();
      await loadTransactionHistory();
    } else {
      window.notify?.(data.message || "Withdrawal failed", "error");
    }
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    window.notify?.("Failed to process withdrawal", "error");
  } finally {
    if (elements.withdrawSubmitBtn) {
      elements.withdrawSubmitBtn.disabled = false;
      elements.withdrawSubmitBtn.innerHTML = '<i class="bi bi-arrow-down-circle"></i> Withdraw to Wallet';
    }
  }
}

// Transaction History Functions
async function loadTransactionHistory() {
  try {
    const response = await fetch("/api/wallet/transactions", { credentials: "include" });

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
          <div class="transaction-date">${escapeHtml(formatDate(tx.created_at))}</div>
        </div>
        <div class="transaction-amount ${typeClass}">
          ${amountPrefix}${formatNumber(tx.amount)} POL
        </div>
        <div class="transaction-status ${escapeHtml(tx.status)}">
          ${escapeHtml(tx.status.charAt(0).toUpperCase() + tx.status.slice(1))}
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
  
  if (elements.withdrawAmount) {
    elements.withdrawAmount.addEventListener("input", updateWithdrawSummary);
  }

  if (elements.withdrawAddress) {
    elements.withdrawAddress.addEventListener("input", updateWithdrawSummary);
  }

  if (elements.withdrawForm) {
    elements.withdrawForm.addEventListener("submit", handleWithdraw);
  }

  if (elements.extensionDepositForm) {
    elements.extensionDepositForm.addEventListener("submit", handleExtensionDeposit);
  }

  if (elements.verifyDepositForm) {
    elements.verifyDepositForm.addEventListener("submit", handleVerifyDeposit);
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
  if (!(await checkAuth())) return;

  setupEventListeners();
  await loadBalance();
  await loadDepositAddress();
  await loadPendingDeposits();
  await loadTransactionHistory();
  
  updateWithdrawSummary();

  if (balanceAutoRefreshTimer) {
    clearInterval(balanceAutoRefreshTimer);
  }

  balanceAutoRefreshTimer = setInterval(() => {
    loadBalance();
    loadPendingDeposits();
  }, 15000);
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
