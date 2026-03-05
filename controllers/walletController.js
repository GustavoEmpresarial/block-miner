const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");
const { createAuditLog } = require("../models/auditLogModel");
const logger = require("../utils/logger").getLogger("WalletController");
const { getAnonymizedRequestIp } = require("../utils/clientIp");
const { allocateNonce, resetNonce } = require("../utils/nonceManager");
const { DEFAULT_RPC_URLS, parseRpcUrls, buildRpcUrls, fetchWithTimeout, rpcCallWithFallback } = require("../utils/rpcClient");
const config = require("../src/config");
const { all } = require("../src/db/sqlite");
const ccpaymentService = require("../services/ccpaymentService");

const POLYGON_CHAIN_ID = Number(process.env.POLYGON_CHAIN_ID || 137);
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://poly.api.pocket.network";
const POLYGON_RPC_TIMEOUT_MS = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);
const POLYGON_BROADCAST_RPC_URL = String(process.env.POLYGON_BROADCAST_RPC_URL || "").trim();
const POLYGON_BROADCAST_RPC_URLS_RAW = String(process.env.POLYGON_BROADCAST_RPC_URLS || "").trim();
const RPC_URLS = buildRpcUrls({
  primaryUrl: POLYGON_RPC_URL,
  defaultUrls: DEFAULT_RPC_URLS
});
const BROADCAST_RPC_URLS = buildRpcUrls({
  primaryUrl: POLYGON_BROADCAST_RPC_URL,
  additionalUrls: parseRpcUrls(POLYGON_BROADCAST_RPC_URLS_RAW),
  defaultUrls: RPC_URLS
});
const WITHDRAWAL_PRIVATE_KEY = process.env.WITHDRAWAL_PRIVATE_KEY;
const WITHDRAWAL_MNEMONIC = process.env.WITHDRAWAL_MNEMONIC;
const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";
const DEPOSIT_CONTRACT_ADDRESS = String(process.env.DEPOSIT_CONTRACT_ADDRESS || CHECKIN_RECEIVER).trim();
const MIN_DEPOSIT_POL = Number(process.env.DEPOSIT_MIN_POL || 0.1);

const MIN_WITHDRAWAL = Number(config.withdraw?.min || 10);
const MAX_WITHDRAWAL = Number(config.withdraw?.max || 1_000_000);
const WITHDRAWAL_PROCESSING_TIME = "up to 10 business days";
const CCPAYMENT_CHAIN = String(process.env.CCPAYMENT_CHAIN || "POLYGON").trim().toUpperCase();
const CCPAYMENT_ALLOWED_COIN_SYMBOLS = new Set(
  String(process.env.CCPAYMENT_ALLOWED_COIN_SYMBOLS || "POL,MATIC")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
);
const CCPAYMENT_WEBHOOK_ALLOWED_SOURCE_IPS = new Set(
  String(process.env.CCPAYMENT_WEBHOOK_ALLOWED_SOURCE_IPS || "54.150.123.157,35.72.150.75,18.176.186.244")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const CCPAYMENT_WEBHOOK_ENFORCE_SOURCE_IPS =
  String(process.env.CCPAYMENT_WEBHOOK_ENFORCE_SOURCE_IPS || "false").trim().toLowerCase() === "true";

const ALLOW_WITHDRAW_TO_CONTRACTS = Boolean(config.wallet?.allowWithdrawToContracts === true || String(process.env.ALLOW_WITHDRAW_TO_CONTRACTS || "").trim() === "1");

function toCcpaymentUserId(localUserId) {
  return `bm_${String(localUserId || "").trim()}`;
}

function toLocalUserId(ccpaymentUserId) {
  const value = String(ccpaymentUserId || "").trim();
  if (!value.startsWith("bm_")) {
    return null;
  }

  const rawId = value.slice(3);
  if (!/^\d+$/.test(rawId)) {
    return null;
  }

  return Number(rawId);
}


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

function normalizeTxHash(txHash) {
  return String(txHash || "").trim().toLowerCase();
}

async function verifyPolygonTransaction(txHash) {
  try {
    // Try multiple RPC endpoints for reliability
    for (const rpcUrl of RPC_URLS) {
      try {
        const response = await fetchWithTimeout(
          rpcUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getTransactionReceipt",
              params: [txHash]
            })
          },
          POLYGON_RPC_TIMEOUT_MS
        );

        if (!response.ok) continue;

        const receiptData = await response.json();
        if (receiptData.error) continue;

        const receipt = receiptData.result || null;

        // Get transaction details
        const txResponse = await fetchWithTimeout(
          rpcUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "eth_getTransactionByHash",
              params: [txHash]
            })
          },
          POLYGON_RPC_TIMEOUT_MS
        );

        if (!txResponse.ok) continue;

        const txData = await txResponse.json();
        if (txData.error || !txData.result) continue;

        const transaction = txData.result;

        // Convert hex values to numbers
        const valueInWei = BigInt(transaction.value || "0x0");
        const valueInPol = Number(ethers.formatUnits(valueInWei, 18));

        if (!receipt) {
          return {
            isValid: true,
            pending: true,
            success: false,
            from: transaction.from,
            to: transaction.to,
            value: valueInPol,
            blockNumber: null,
            gasUsed: null,
            txHash: transaction.hash
          };
        }

        return {
          isValid: true,
          pending: false,
          success: receipt.status === "0x1",
          from: transaction.from,
          to: transaction.to,
          value: valueInPol,
          blockNumber: parseInt(receipt.blockNumber, 16),
          gasUsed: parseInt(receipt.gasUsed, 16),
          txHash: transaction.hash
        };

      } catch (error) {
        logger.debug(`RPC ${rpcUrl} failed`, { error: error.message });
        continue;
      }
    }

    return {
      isValid: false,
      error: "Transaction not found on Polygon network"
    };

  } catch (error) {
    logger.error("Failed to verify Polygon transaction", {
      txHash,
      error: error.message
    });

    return {
      isValid: false,
      error: "Unable to verify transaction"
    };
  }
}



async function getPendingDeposits(req, res) {
  try {
    const userId = req.user.id;

    const pendingDeposits = await all(
      `SELECT id, amount, tx_hash, from_address, status, created_at 
       FROM deposits 
       WHERE user_id = ? AND status = 'pending' 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      ok: true,
      deposits: pendingDeposits.map(deposit => ({
        id: deposit.id,
        amount: Number(deposit.amount),
        txHash: deposit.tx_hash,
        fromAddress: deposit.from_address,
        status: deposit.status,
        createdAt: Number(deposit.created_at)
      }))
    });

  } catch (error) {
    logger.error("Failed to get pending deposits", {
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({
      ok: false,
      message: "Unable to load pending deposits"
    });
  }
}

function validateWithdrawalInput(amountRaw, address) {
  const amount = normalizeAmountInput(amountRaw);

  if (amount < MIN_WITHDRAWAL) {
    throw new Error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL} POL`);
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

function normalizeIp(ip) {
  const value = String(ip || "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }

  return value;
}

function getRequestIpCandidates(req) {
  const candidates = new Set();

  const directIp = normalizeIp(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress);
  if (directIp) {
    candidates.add(directIp);
  }

  const forwardedHeader = String(req.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedHeader) {
    for (const part of forwardedHeader.split(",")) {
      const normalized = normalizeIp(part);
      if (normalized) {
        candidates.add(normalized);
      }
    }
  }

  return Array.from(candidates);
}

function isAllowedWebhookSourceIp(req) {
  if (!CCPAYMENT_WEBHOOK_ENFORCE_SOURCE_IPS) {
    return true;
  }

  if (CCPAYMENT_WEBHOOK_ALLOWED_SOURCE_IPS.size === 0) {
    return true;
  }

  const candidates = getRequestIpCandidates(req);
  return candidates.some((ip) => CCPAYMENT_WEBHOOK_ALLOWED_SOURCE_IPS.has(ip));
}

function sendWebhookSuccess(res) {
  return res.status(200).json({ msg: "Success" });
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
  request.timeout = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);
  const provider = new ethers.JsonRpcProvider(request);
  // Avoid Polygon gas station rate limits by overriding fee data lookup.
  provider.getFeeData = async () => {
    const gasPrice = await provider.send("eth_gasPrice", []);
    return new ethers.FeeData(gasPrice, null, null);
  };
  return provider;
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
    logger.error("Error getting balance", { error: error?.message || String(error), stack: error?.stack });
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
    logger.error("Error updating wallet address", { error: error?.message || String(error), stack: error?.stack });
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
      logger.error("Failed to write withdrawal audit log", { error: logError?.message || String(logError), stack: logError?.stack });
    }

    res.json({
      ok: true,
      message: `Withdrawal request submitted. Waiting for admin approval. Processing time: ${WITHDRAWAL_PROCESSING_TIME}.`,
      transaction: {
        ...transaction,
        status: "pending",
        tx_hash: null
      }
    });
  } catch (error) {
    logger.error("Error processing withdrawal", { error: error?.message || String(error), stack: error?.stack });

    if (transaction?.id) {
      try {
        await walletModel.updateTransactionStatus(transaction.id, "failed");
      } catch (statusError) {
        logger.error("Failed to mark withdrawal as failed", { error: statusError?.message || String(statusError), stack: statusError?.stack });
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

    if (error.message.startsWith("Minimum withdrawal amount is")) {
      return res.status(400).json({
        ok: false,
        message: `${error.message}. Processing time: ${WITHDRAWAL_PROCESSING_TIME}.`
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
    logger.error("Error getting transactions", { error: error?.message || String(error), stack: error?.stack });
    res.status(500).json({
      ok: false,
      message: "Failed to retrieve transactions"
    });
  }
}

async function getDepositAddress(req, res) {
  try {
    const depositAddress = DEPOSIT_CONTRACT_ADDRESS;

    res.json({
      ok: true,
      depositAddress,
      address: depositAddress,
      network: "Polygon",
      chainId: POLYGON_CHAIN_ID,
      symbol: "POL",
      minDepositPol: MIN_DEPOSIT_POL,
      instructions: `Send POL from your connected wallet to this smart-contract deposit address. Minimum deposit is ${MIN_DEPOSIT_POL} POL. Credit is processed automatically after blockchain confirmation, even if you close the wallet page.`,
      isSmartContract: true
    });
  } catch (error) {
    logger.error("Failed to get deposit address", {
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({
      ok: false,
      message: "Unable to get deposit address. Please try again."
    });
  }
}

async function handleCcpaymentDepositWebhook(req, res) {
  // DEPOSIT FUNCTIONALITY DISABLED
  return res.status(503).json({
    ok: false,
    message: "Deposit functionality is temporarily disabled"
  });
}

async function verifyAndCreditDeposit(req, res) {
  try {
    const userId = req.user.id;
    const { txHash, fromAddress, amount } = req.body;
    const normalizedTxHash = normalizeTxHash(txHash);

    if (!normalizedTxHash || normalizedTxHash.length < 20) {
      return res.status(400).json({
        ok: false,
        message: "Invalid transaction hash"
      });
    }

    const existingDeposit = await walletModel.getDepositByTxHash(normalizedTxHash);

    if (existingDeposit) {
      if (Number(existingDeposit.user_id) !== Number(userId)) {
        return res.status(409).json({
          ok: false,
          message: "This transaction hash is already linked to another account"
        });
      }

      if (existingDeposit.status === "completed") {
        return res.json({
          ok: true,
          message: "This transaction has already been credited to your account",
          amount: existingDeposit.amount,
          alreadyProcessed: true
        });
      }
      if (existingDeposit.status === "pending") {
        return res.json({
          ok: true,
          message: "This transaction is being processed. Please wait a few minutes.",
          status: "pending",
          txHash: normalizedTxHash
        });
      }
    }

    // Verify transaction on Polygon network
    const transactionData = await verifyPolygonTransaction(txHash);

    if (!transactionData.isValid) {
      return res.status(400).json({
        ok: false,
        message: transactionData.error || "Transaction not found or invalid"
      });
    }

    // Validate transaction details
    if (transactionData.to?.toLowerCase() !== DEPOSIT_CONTRACT_ADDRESS.toLowerCase()) {
      return res.status(400).json({
        ok: false,
        message: "Transaction was not sent to the correct deposit address"
      });
    }

    const estimatedAmount = Number(transactionData.value || amount || 0);
    const initialAmount = Number.isFinite(estimatedAmount) && estimatedAmount >= 0
      ? Number(estimatedAmount.toFixed(6))
      : 0;

    if (!existingDeposit) {
      try {
        await walletModel.createDeposit(
          userId,
          initialAmount,
          normalizedTxHash,
          transactionData.from || fromAddress || "pending",
          transactionData.to || DEPOSIT_CONTRACT_ADDRESS
        );
      } catch (createError) {
        const message = String(createError?.message || "").toLowerCase();
        if (!message.includes("unique") && !message.includes("constraint")) {
          throw createError;
        }
      }
    }

    if (transactionData.pending) {
      return res.status(202).json({
        ok: true,
        status: "pending",
        message: "Transaction detected. Waiting for blockchain confirmation.",
        txHash: normalizedTxHash
      });
    }

    if (!transactionData.success) {
      return res.status(400).json({
        ok: false,
        message: "Transaction failed on the blockchain"
      });
    }

    const actualAmount = Number(Number(transactionData.value || 0).toFixed(6));
    if (actualAmount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid transaction amount"
      });
    }

    if (actualAmount < MIN_DEPOSIT_POL) {
      const depositToInvalidate = existingDeposit || await walletModel.getDepositByTxHash(normalizedTxHash);
      if (depositToInvalidate?.id) {
        await walletModel.updateDepositStatus(depositToInvalidate.id, "invalid", actualAmount);
      }

      return res.status(400).json({
        ok: false,
        message: `Minimum deposit is ${MIN_DEPOSIT_POL} POL`
      });
    }

    const finalization = await walletModel.finalizeDepositByTxHash(normalizedTxHash, actualAmount);
    if (!finalization.ok) {
      return res.status(409).json({
        ok: false,
        message: "Unable to complete this deposit right now"
      });
    }

    // Log the deposit
    await createAuditLog({
      userId,
      action: "deposit_credited",
      ip: getAnonymizedRequestIp(req),
      userAgent: req.get("user-agent"),
      details: {
        depositId: finalization.depositId,
        amount: actualAmount,
        txHash: normalizedTxHash,
        fromAddress: transactionData.from,
        blockNumber: transactionData.blockNumber
      }
    });

    logger.info("POL deposit verified and credited", {
      userId,
      depositId: finalization.depositId,
      amount: actualAmount,
      txHash: normalizedTxHash,
      blockNumber: transactionData.blockNumber
    });

    res.json({
      ok: true,
      message: finalization.alreadyProcessed
        ? "This transaction has already been credited to your account"
        : "Deposit verified and credited successfully!",
      amount: actualAmount,
      txHash: normalizedTxHash,
      depositId: finalization.depositId,
      alreadyProcessed: Boolean(finalization.alreadyProcessed)
    });

  } catch (error) {
    logger.error("Failed to verify and credit deposit", {
      userId: req.user?.id,
      txHash: req.body?.txHash,
      error: error.message
    });
    res.status(500).json({
      ok: false,
      message: "Unable to process deposit. Please try again or contact support."
    });
  }
}

async function recordDeposit(req, res) {
  // DEPOSIT FUNCTIONALITY DISABLED
  return res.status(503).json({
    ok: false,
    message: "Deposit functionality is temporarily disabled for maintenance. Please check back later."
  });
}

async function getMiningRewards(req, res) {
  try {
    const userId = req.user.id;
    const { get, all } = require("../src/db/sqlite");

    // Get last 3 mining rewards for this user
    const rewards = await all(
      `
        SELECT
          id,
          block_number,
          work_accumulated,
          total_network_work,
          share_percentage,
          reward_amount,
          balance_after_reward,
          created_at
        FROM mining_rewards_log
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 3
      `,
      [userId]
    );

    // Format rewards for display
    const formattedRewards = rewards.map((reward) => ({
      id: reward.id,
      blockNumber: reward.block_number,
      workAccumulated: Number(reward.work_accumulated).toFixed(2),
      totalNetworkWork: Number(reward.total_network_work).toFixed(2),
      sharePercentage: Number(reward.share_percentage).toFixed(2),
      rewardAmount: Number(reward.reward_amount).toFixed(8),
      balanceAfterReward: Number(reward.balance_after_reward).toFixed(8),
      createdAt: new Date(reward.created_at).toISOString(),
      timestamp: reward.created_at
    }));

    res.json({
      ok: true,
      rewards: formattedRewards,
      total: formattedRewards.length
    });
  } catch (error) {
    logger.error("Error getting mining rewards", { error: error.message });
    res.status(500).json({
      ok: false,
      message: "Failed to retrieve mining rewards"
    });
  }
}

module.exports = {
  getBalance,
  getMiningRewards,
  updateWalletAddress,
  withdraw,
  getTransactions,
  getDepositAddress,
  handleCcpaymentDepositWebhook,
  verifyAndCreditDeposit,
  getPendingDeposits,
  sendOnChainWithdrawal,
  __test: {
    normalizeAmountInput,
    validateWithdrawalInput
  }
};
