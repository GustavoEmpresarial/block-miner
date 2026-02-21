const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");
const { createAuditLog } = require("../models/auditLogModel");
const logger = require("../utils/logger").getLogger("WalletController");
const { getAnonymizedRequestIp } = require("../utils/clientIp");
const { allocateNonce, resetNonce } = require("../utils/nonceManager");

const POLYGON_CHAIN_ID = Number(process.env.POLYGON_CHAIN_ID || 137);
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://poly.api.pocket.network";
const POLYGON_RPC_TIMEOUT_MS = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);
const POLYGON_BROADCAST_RPC_URL = String(process.env.POLYGON_BROADCAST_RPC_URL || "").trim();
const POLYGON_BROADCAST_RPC_URLS_RAW = String(process.env.POLYGON_BROADCAST_RPC_URLS || "").trim();
const DEFAULT_RPC_URLS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
  "https://poly.api.pocket.network",
  "https://1rpc.io/matic",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://rpc.ankr.com/polygon",
  "https://rpc-mainnet.matic.network"
];
const RPC_URLS = Array.from(new Set([POLYGON_RPC_URL, ...DEFAULT_RPC_URLS]));
const BROADCAST_RPC_URLS = (() => {
  const urls = [];
  if (POLYGON_BROADCAST_RPC_URLS_RAW) {
    urls.push(
      ...POLYGON_BROADCAST_RPC_URLS_RAW
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    );
  }
  if (POLYGON_BROADCAST_RPC_URL) {
    urls.unshift(POLYGON_BROADCAST_RPC_URL);
  }
  return Array.from(new Set(urls.length > 0 ? urls : RPC_URLS));
})();
const WITHDRAWAL_PRIVATE_KEY = process.env.WITHDRAWAL_PRIVATE_KEY;
const WITHDRAWAL_MNEMONIC = process.env.WITHDRAWAL_MNEMONIC;
const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";

const MIN_WITHDRAWAL = 10;
const MAX_WITHDRAWAL = 1_000_000;

const ALLOW_WITHDRAW_TO_CONTRACTS = String(process.env.ALLOW_WITHDRAW_TO_CONTRACTS || "").trim() === "1";


function normalizeAmountInput(amountRaw) {
  if (amountRaw === null || amountRaw === undefined) {
    throw new Error("Invalid amount");
  }

  const amountStr = String(amountRaw).trim();
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(amountStr)) {
    throw new Error("Invalid amount format");
  }

  const amount = Number(amountStr);
  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }

  return amount;
}

function validateWithdrawalInput(amountRaw, address) {
  const amount = normalizeAmountInput(amountRaw);

  if (amount < MIN_WITHDRAWAL) {
    throw new Error("Minimum withdrawal amount is 10 POL");
  }

  if (amount > MAX_WITHDRAWAL) {
    throw new Error("Withdrawal amount exceeds limit");
  }

  if (!address || !ethers.isAddress(address)) {
    throw new Error("Invalid wallet address");
  }

  return amount;
}

function isSameAddress(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

async function isContractAddress(address) {
  try {
    const code = await rpcCallWithFallback(RPC_URLS, "eth_getCode", [address, "latest"]);
    const normalized = String(code || "0x").toLowerCase();
    return normalized !== "0x" && normalized !== "0x0";
  } catch {
    // If we can't check, don't block (avoid false negatives due to RPC outages).
    return false;
  }
}

function createProvider(rpcUrl) {
  const request = new ethers.FetchRequest(rpcUrl);
  request.timeout = POLYGON_RPC_TIMEOUT_MS;
  const provider = new ethers.JsonRpcProvider(request);
  // Avoid Polygon gas station rate limits by overriding fee data lookup.
  provider.getFeeData = async () => {
    const gasPrice = await provider.send("eth_gasPrice", []);
    return new ethers.FeeData(gasPrice, null, null);
  };
  return provider;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcCallWithFallback(rpcUrls, method, params) {
  let lastError = null;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetchWithTimeout(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        },
        POLYGON_RPC_TIMEOUT_MS
      );

      if (!response.ok) {
        throw new Error(`RPC request failed (HTTP ${response.status})`);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new Error(payload.error.message || "RPC error");
      }

      return payload.result;
    } catch (error) {
      lastError = new Error(`${rpcUrl}: ${error.message || String(error)}`);
      continue;
    }
  }

  throw lastError || new Error("RPC request failed");
}

async function fetchTransactionWithReceipt(txHash) {
  let lastError = null;

  for (const rpcUrl of RPC_URLS) {
    try {
      const provider = createProvider(rpcUrl);
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(txHash),
        provider.getTransactionReceipt(txHash)
      ]);

      if (tx || receipt) {
        return { provider, tx, receipt };
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { provider: null, tx: null, receipt: null };
}

async function getConfirmations(provider, receipt) {
  if (!receipt?.blockNumber || !provider) {
    return 0;
  }

  const latestBlock = await provider.getBlockNumber();
  return Math.max(0, latestBlock - receipt.blockNumber + 1);
}

function getPayoutWallet(provider) {

  const mnemonic = String(WITHDRAWAL_MNEMONIC || "").trim();
  if (mnemonic) {
    return ethers.Wallet.fromPhrase(mnemonic, provider);
  }

  const rawPrivateKey = String(WITHDRAWAL_PRIVATE_KEY || "").trim();
  if (rawPrivateKey) {
    const compact = rawPrivateKey.replace(/\s+/g, "");
    const isHexPrivateKey = /^0x?[0-9a-fA-F]{64}$/.test(compact);
    if (isHexPrivateKey) {
      const normalized = compact.startsWith("0x") ? compact : `0x${compact}`;
      return new ethers.Wallet(normalized, provider);
    }

    // Support operators who put the mnemonic in WITHDRAWAL_PRIVATE_KEY by mistake.
    return ethers.Wallet.fromPhrase(rawPrivateKey, provider);
  }

  throw new Error("Missing withdrawal wallet configuration");
}

function getPayoutWalletNoProvider() {
  const mnemonic = String(WITHDRAWAL_MNEMONIC || "").trim();
  if (mnemonic) {
    return ethers.Wallet.fromPhrase(mnemonic);
  }

  const rawPrivateKey = String(WITHDRAWAL_PRIVATE_KEY || "").trim();
  if (rawPrivateKey) {
    const compact = rawPrivateKey.replace(/\s+/g, "");
    const isHexPrivateKey = /^0x?[0-9a-fA-F]{64}$/.test(compact);
    if (isHexPrivateKey) {
      const normalized = compact.startsWith("0x") ? compact : `0x${compact}`;
      return new ethers.Wallet(normalized);
    }

    return ethers.Wallet.fromPhrase(rawPrivateKey);
  }

  throw new Error("Missing withdrawal wallet configuration");
}

async function ensureHotWalletHasBalance(amount) {
  const amountStr = Number(amount).toFixed(6);
  const value = ethers.parseEther(amountStr);
  let lastError = null;

  for (const rpcUrl of RPC_URLS) {
    try {
      const provider = createProvider(rpcUrl);
      const wallet = getPayoutWallet(provider);
      const [balance, gasPrice] = await Promise.all([
        provider.getBalance(wallet.address),
        provider.send("eth_gasPrice", [])
      ]);

      const gasPriceBig = BigInt(gasPrice);
      const required = value + gasPriceBig * 21_000n;
      if (balance < required) {
        throw new Error("Hot wallet balance is insufficient");
      }
      return;
    } catch (error) {
      if (error.message === "Hot wallet balance is insufficient") {
        throw error;
      }
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error("Unable to verify hot wallet balance");
}

async function sendOnChainWithdrawal(address, amount) {
  const amountStr = Number(amount).toFixed(6);
  const value = ethers.parseEther(amountStr);

  const wallet = getPayoutWalletNoProvider();

  const nonce = await allocateNonce({
    chainId: POLYGON_CHAIN_ID,
    address: wallet.address,
    getPendingNonce: async () => rpcCallWithFallback(RPC_URLS, "eth_getTransactionCount", [wallet.address, "pending"])
  });
  const gasPriceHex = await rpcCallWithFallback(RPC_URLS, "eth_gasPrice", []);
  const gasPrice = BigInt(gasPriceHex);

  // Check balance with read RPCs (include gas).
  const balanceHex = await rpcCallWithFallback(RPC_URLS, "eth_getBalance", [wallet.address, "latest"]);
  const balance = BigInt(balanceHex);

  // Default gasLimit: EOA transfers are 21k, contract recipients may require more.
  let gasLimit = 21_000;
  try {
    if (ALLOW_WITHDRAW_TO_CONTRACTS) {
      const contract = await isContractAddress(address);
      if (contract) {
        gasLimit = 100_000;
      }
    }
  } catch {
    // ignore
  }

  // Estimate gas when possible (native transfers to contracts can require > 21k).
  try {
    const estimateHex = await rpcCallWithFallback(RPC_URLS, "eth_estimateGas", [{
      from: wallet.address,
      to: address,
      value: ethers.toBeHex(value)
    }]);
    const estimated = Number(BigInt(estimateHex));
    if (Number.isFinite(estimated) && estimated > 0) {
      const buffered = Math.ceil(estimated * 1.2);
      gasLimit = Math.max(21_000, Math.min(500_000, buffered));
    }
  } catch {
    // keep default gasLimit
  }

  const txRequest = {
    chainId: POLYGON_CHAIN_ID,
    to: address,
    value,
    nonce,
    gasPrice,
    gasLimit
  };

  const required = value + gasPrice * BigInt(gasLimit);
  if (balance < required) {
    throw new Error("Hot wallet balance is insufficient");
  }

  const signedTx = await wallet.signTransaction(txRequest);
  const localTxHash = ethers.keccak256(signedTx);

  let sendError = null;
  try {
    const remoteTxHash = await rpcCallWithFallback(BROADCAST_RPC_URLS, "eth_sendRawTransaction", [signedTx]);
    if (remoteTxHash && String(remoteTxHash).toLowerCase() !== String(localTxHash).toLowerCase()) {
      logger.warn("RPC returned a different tx_hash than local hash", { localTxHash, remoteTxHash });
    }
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("nonce") || msg.includes("replacement") || msg.includes("already known") || msg.includes("known transaction")) {
      resetNonce({ chainId: POLYGON_CHAIN_ID, address: wallet.address });
    }
    // Do NOT throw here: the tx may have been accepted but the RPC failed/timeout.
    // Returning the local tx hash + raw tx allows the cron to rebroadcast the exact same transaction idempotently.
    sendError = error;
  }

  // Quick receipt check (optional)
  const receiptTimeoutMs = Number(process.env.WITHDRAWAL_RECEIPT_TIMEOUT_MS || 15000);
  const pollIntervalMs = 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < receiptTimeoutMs) {
    try {
      const receipt = await rpcCallWithFallback(RPC_URLS, "eth_getTransactionReceipt", [localTxHash]);
      if (!receipt) {
        // not mined yet
      } else if (receipt.status === "0x1") {
        return { txHash: localTxHash, rawTx: signedTx, nonce, gasPrice: gasPrice.toString(), gasLimit: Number(txRequest.gasLimit), confirmed: true, sendError: sendError?.message || null };
      } else if (receipt.status === "0x0") {
        const failedError = new Error("Transaction failed");
        failedError.txHash = localTxHash;
        failedError.rawTx = signedTx;
        failedError.nonce = nonce;
        failedError.gasPrice = gasPrice.toString();
        failedError.gasLimit = Number(txRequest.gasLimit);
        throw failedError;
      }
    } catch (error) {
      if (error.message === "Transaction failed") {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { txHash: localTxHash, rawTx: signedTx, nonce, gasPrice: gasPrice.toString(), gasLimit: Number(txRequest.gasLimit), confirmed: false, sendError: sendError?.message || null };
}

// Get user balance and wallet info
async function getBalance(req, res) {
  try {
    const userId = req.user.id;
    const balance = await walletModel.getUserBalance(userId);
    
    res.json({
      ok: true,
      balance: balance.balance,
      lifetimeMined: balance.lifetimeMined,
      totalWithdrawn: balance.totalWithdrawn,
      walletAddress: balance.walletAddress
    });
  } catch (error) {
    console.error("Error getting balance:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to retrieve balance"
    });
  }
}

// Save or update wallet address
async function updateWalletAddress(req, res) {
  try {
    const userId = req.user.id;
    const { walletAddress } = req.body;
    
    // Validate wallet address format (basic check for Ethereum-like addresses)
    if (walletAddress && !ethers.isAddress(walletAddress)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid wallet address format"
      });
    }
    
    await walletModel.saveWalletAddress(userId, walletAddress);
    
    res.json({
      ok: true,
      message: walletAddress ? "Wallet address saved successfully" : "Wallet address removed"
    });
  } catch (error) {
    console.error("Error updating wallet address:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to update wallet address"
    });
  }
}

// Process withdrawal
async function withdraw(req, res) {
  let transaction = null;
  try {
    const userId = req.user.id;
    const { amount: amountRaw, address } = req.body;
    const amount = validateWithdrawalInput(amountRaw, address);

    if (!ALLOW_WITHDRAW_TO_CONTRACTS) {
      const isContract = await isContractAddress(address);
      if (isContract) {
        return res.status(400).json({
          ok: false,
          message: "Destination address looks like a contract. Withdrawals are only allowed to normal wallets (EOA)."
        });
      }
    }

    // Check if user has a pending withdrawal. Block new requests until the previous one completes.
    const hasPending = await walletModel.hasPendingWithdrawal(userId);
    if (hasPending) {
      return res.status(409).json({
        ok: false,
        message: "You have a pending withdrawal. Please wait for it to complete or fail before requesting another."
      });
    }

    // Create withdrawal transaction (atomically reserves funds).
    // NOTE: Manual approval is now required by admin before on-chain processing
    transaction = await walletModel.createWithdrawal(userId, amount, address);

    try {
      await createAuditLog({
        userId,
        action: "withdrawal_requested",
        ip: getAnonymizedRequestIp(req),
        userAgent: req.get("user-agent"),
        details: { amount, address, status: "pending_approval" }
      });
    } catch (logError) {
      console.error("Failed to write withdrawal audit log:", logError);
    }

    res.json({
      ok: true,
      message: "Withdrawal request submitted. Waiting for admin approval.",
      transaction: {
        ...transaction,
        status: "pending",
        tx_hash: null
      }
    });
  } catch (error) {
    console.error("Error processing withdrawal:", error);

    if (transaction?.id) {
      try {
        await walletModel.updateTransactionStatus(transaction.id, "failed");
      } catch (statusError) {
        console.error("Failed to mark withdrawal as failed:", statusError);
      }
    }
    
    if (error.message === "Insufficient balance") {
      return res.status(400).json({
        ok: false,
        message: "Insufficient balance for withdrawal"
      });
    }

    if (error?.code === "PENDING_WITHDRAWAL" || error.message === "Pending withdrawal") {
      return res.status(409).json({
        ok: false,
        message: "You have a pending withdrawal. Please wait for it to complete or fail before requesting another."
      });
    }

    if (error.message === "Invalid amount" || error.message === "Invalid amount format") {
      return res.status(400).json({
        ok: false,
        message: "Invalid withdrawal amount"
      });
    }

    if (error.message === "Minimum withdrawal amount is 0.1 POL") {
      return res.status(400).json({
        ok: false,
        message: error.message
      });
    }

    if (error.message === "Withdrawal amount exceeds limit") {
      return res.status(400).json({
        ok: false,
        message: "Withdrawal amount exceeds limit"
      });
    }

    if (error.message === "Invalid wallet address") {
      return res.status(400).json({
        ok: false,
        message: "Invalid wallet address"
      });
    }

    if (error.message === "Hot wallet balance is insufficient") {
      return res.status(400).json({
        ok: false,
        message: "Withdrawal wallet has insufficient funds"
      });
    }

    if (error.message === "All RPC endpoints failed") {
      return res.status(503).json({
        ok: false,
        message: "Blockchain RPC unavailable. Try again in a moment."
      });
    }

    if (error.message === "Transaction failed") {
      return res.status(502).json({
        ok: false,
        message: "Blockchain transaction failed (reverted). Your balance was restored."
      });
    }

    if (error.message === "Unable to verify hot wallet balance") {
      return res.status(503).json({
        ok: false,
        message: "Unable to verify withdrawal wallet balance. Try again."
      });
    }
    
    res.status(500).json({
      ok: false,
      message: error.message === "Missing withdrawal wallet configuration"
        ? "Withdrawal wallet is not configured"
        : "Failed to process withdrawal"
    });
  }
}

// Get transaction history
async function getTransactions(req, res) {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    
    const transactions = await walletModel.getTransactions(userId, limit);
    
    res.json({
      ok: true,
      transactions
    });
  } catch (error) {
    console.error("Error getting transactions:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to retrieve transactions"
    });
  }
}

async function getDepositAddress(req, res) {
  try {
    const depositAddress = CHECKIN_RECEIVER;

    if (!depositAddress) {
      return res.status(500).json({
        ok: false,
        message: "Deposit address not configured"
      });
    }

    res.json({
      ok: true,
      depositAddress
    });

  } catch (error) {
    console.error("Error getting deposit address:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to get deposit address"
    });
  }
}

async function recordDeposit(req, res) {
  try {
    const userId = req.user.id;
    const { txHash, amount, fromAddress } = req.body;

    // Validate input
    if (!txHash || !amount || !fromAddress) {
      return res.status(400).json({
        ok: false,
        message: "Missing required fields"
      });
    }

    const parsedAmount = normalizeAmountInput(amount);
    
    if (parsedAmount < 0.01) {
      return res.status(400).json({
        ok: false,
        message: "Minimum deposit is 0.01 POL"
      });
    }

    const existingTx = await walletModel.getTransactionByHash(txHash);
    if (existingTx) {
      return res.status(400).json({
        ok: false,
        message: "Deposit already recorded"
      });
    }

    const depositAddress = CHECKIN_RECEIVER;
    if (!depositAddress) {
      return res.status(500).json({
        ok: false,
        message: "Deposit address not configured"
      });
    }

    const depositId = await walletModel.createDeposit(userId, parsedAmount, txHash, fromAddress, depositAddress);

    monitorDeposit(userId, txHash, depositAddress, depositId);

    res.json({
      ok: true,
      message: "Deposit recorded. Balance will update after confirmation.",
      depositId
    });

  } catch (error) {
    console.error("Error recording deposit:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Failed to record deposit"
    });
  }
}

async function monitorDeposit(userId, txHash, depositAddress, depositId) {
  try {
    let confirmed = false;
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    
    while (!confirmed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      
      try {
        const { provider, tx, receipt } = await fetchTransactionWithReceipt(txHash);
        if (!receipt || receipt.status !== 1 || !tx) {
          attempts++;
          continue;
        }

        const confirmations = await getConfirmations(provider, receipt);
        if (confirmations < 1) {
          attempts++;
          continue;
        }

        if (!isSameAddress(tx.to, depositAddress)) {
          await walletModel.updateDepositStatus(depositId, "invalid");
          console.warn(`Deposit ${txHash} rejected: destination mismatch`);
          confirmed = true;
          continue;
        }

        const actualAmount = Number(Number(ethers.formatEther(tx.value || 0)).toFixed(6));
        if (!actualAmount || actualAmount <= 0) {
          await walletModel.updateDepositStatus(depositId, "invalid");
          console.warn(`Deposit ${txHash} rejected: invalid amount`);
          confirmed = true;
          continue;
        }

        await walletModel.creditBalance(userId, actualAmount);
        await walletModel.updateDepositStatus(depositId, "completed", actualAmount);

        logger.info("Deposit confirmed and credited", { txHash, userId, amountPol: actualAmount });
        confirmed = true;
      } catch (error) {
        logger.error("Error checking transaction", { txHash, error: error.message });
      }
      
      attempts++;
    }
    
    if (!confirmed) {
      logger.warn("Deposit monitoring timed out; will be checked by cron", { txHash, userId });
    }
    
  } catch (error) {
    logger.error("Error monitoring deposit", { error: error.message });
  }
}

module.exports = {
  getBalance,
  updateWalletAddress,
  withdraw,
  getTransactions,
  getDepositAddress,
  recordDeposit,
  sendOnChainWithdrawal
};
