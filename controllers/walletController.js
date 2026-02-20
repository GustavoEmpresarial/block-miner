const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");
const PayoutModel = require("../models/faucetpayModel");
const { createAuditLog } = require("../models/auditLogModel");
const FaucetPayService = require("../services/faucetpayService");
const logger = require("../utils/logger").getLogger("WalletController");
const { getAnonymizedRequestIp } = require("../utils/clientIp");

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const DEFAULT_RPC_URLS = [
  "https://polygon-rpc.com",
  "https://rpc-mainnet.matic.network",
  "https://rpc.ankr.com/polygon",
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://1rpc.io/matic",
  "https://polygon.drpc.org",
  "https://endpoints.omniatech.io/v1/polygon/mainnet/public"
];
const RPC_URLS = Array.from(new Set([POLYGON_RPC_URL, ...DEFAULT_RPC_URLS]));
const WITHDRAWAL_PRIVATE_KEY = process.env.WITHDRAWAL_PRIVATE_KEY;
const WITHDRAWAL_MNEMONIC = process.env.WITHDRAWAL_MNEMONIC;
const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";

const MIN_WITHDRAWAL = 0.1;
const MAX_WITHDRAWAL = 1_000_000;

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
    throw new Error("Minimum withdrawal amount is 0.1 POL");
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

function createProvider(rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
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

  if (WITHDRAWAL_MNEMONIC) {
    return ethers.Wallet.fromPhrase(WITHDRAWAL_MNEMONIC, provider);
  }

  if (WITHDRAWAL_PRIVATE_KEY) {
    if (WITHDRAWAL_PRIVATE_KEY.includes(" ")) {
      return ethers.Wallet.fromPhrase(WITHDRAWAL_PRIVATE_KEY, provider);
    }

    return new ethers.Wallet(WITHDRAWAL_PRIVATE_KEY, provider);
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
      const balance = await provider.getBalance(wallet.address);
      if (balance < value) {
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
  let lastError = null;

  for (const rpcUrl of RPC_URLS) {
    try {
      const provider = createProvider(rpcUrl);
      const wallet = getPayoutWallet(provider);

      const balance = await provider.getBalance(wallet.address);
      if (balance < value) {
        throw new Error("Hot wallet balance is insufficient");
      }

      const gasPrice = await provider.send("eth_gasPrice", []);
      const txResponse = await wallet.sendTransaction({
        to: address,
        value,
        gasPrice,
        gasLimit: 21_000
      });

      const receipt = await txResponse.wait(1);
      if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction failed");
      }

      return txResponse.hash;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error("All RPC endpoints failed");
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

    // Try to verify hot wallet balance, but don't block withdrawal if it fails
    try {
      await ensureHotWalletHasBalance(amount);
    } catch (balanceError) {
      console.warn("Warning: Could not verify hot wallet balance:", balanceError.message);
      // Continue with withdrawal anyway - log shows we tried to verify
    }
    
    // Create withdrawal transaction
    transaction = await walletModel.createWithdrawal(userId, amount, address);

    // Try to send on-chain transaction
    let txHash = null;
    try {
      txHash = await sendOnChainWithdrawal(address, amount);
      await walletModel.updateTransactionStatus(transaction.id, "completed", txHash);
    } catch (txError) {
      console.warn("Warning: Could not broadcast transaction to blockchain:", txError.message);
      // Keep transaction in pending status - can be retried later
      await walletModel.updateTransactionStatus(transaction.id, "pending");
      // Don't throw - withdrawal request was accepted
    }

    try {
      await createAuditLog({
        userId,
        action: "withdrawal",
        ip: getAnonymizedRequestIp(req),
        userAgent: req.get("user-agent"),
        details: { amount, address, txHash, status: txHash ? "completed" : "pending" }
      });
    } catch (logError) {
      console.error("Failed to write withdrawal audit log:", logError);
    }

    const finalStatus = txHash ? "completed" : "pending";
    res.json({
      ok: true,
      message: txHash 
        ? "Withdrawal processed successfully."
        : "Withdrawal request accepted. Processing on blockchain...",
      transaction: {
        ...transaction,
        status: finalStatus,
        tx_hash: txHash || null
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

// Withdraw POL to wallet/email via FaucetPay
async function withdrawPOL(req, res) {
  try {
    const userId = req.user.id;
    const { amount, toAddress } = req.body;

    // Validation
    if (!amount || !toAddress) {
      return res.status(400).json({
        ok: false,
        message: "Amount and wallet address are required"
      });
    }

    const parsedAmount = normalizeAmountInput(amount);
    
    if (parsedAmount < 0.1) {
      return res.status(400).json({
        ok: false,
        message: "Minimum withdrawal amount is 0.1 POL"
      });
    }

    if (parsedAmount > 100) {
      return res.status(400).json({
        ok: false,
        message: "Maximum withdrawal amount is 100 POL"
      });
    }

    // Get user balance
    const wallet = await walletModel.getUserBalance(userId);
    if (!wallet || wallet.balance < parsedAmount) {
      return res.status(400).json({
        ok: false,
        message: "Insufficient balance"
      });
    }

    // Call FaucetPay service
    logger.info(`User ${userId} attempting POL withdrawal: ${parsedAmount} to ${toAddress}`);
    
    try {
      const payoutResponse = await FaucetPayService.send(
        parsedAmount,
        toAddress,
        "POL",
        req.ip
      );

      if (!payoutResponse.ok) {
        logger.warn(`FaucetPay payout failed for user ${userId}: ${payoutResponse.error}`);
        return res.status(400).json({
          ok: false,
          message: payoutResponse.error || "Withdrawal failed"
        });
      }

      // Debit user balance
      await walletModel.deductBalance(userId, parsedAmount);

      // Record payout
      const payoutId = await PayoutModel.createPayout(
        userId,
        parsedAmount,
        toAddress,
        "POL",
        payoutResponse.payoutId
      );

      // Audit log
      await createAuditLog({
        userId,
        action: "WITHDRAW_POL",
        ip: getAnonymizedRequestIp(req),
        userAgent: req.get("user-agent"),
        details: {
          amount: parsedAmount,
          toAddress,
          payoutId: payoutResponse.payoutId
        }
      });

      logger.info(`POL withdrawal completed for user ${userId}: ${parsedAmount} POL -> ${toAddress}`);

      res.json({
        ok: true,
        message: "Withdrawal successful",
        payoutId: payoutResponse.payoutId,
        amount: parsedAmount,
        newBalance: wallet.balance - parsedAmount
      });

    } catch (faucetError) {
      logger.error(`FaucetPay service error for user ${userId}:`, {
        message: faucetError.message,
        amount: parsedAmount,
        toAddress,
        stack: faucetError.stack
      });
      return res.status(503).json({
        ok: false,
        message: "Payment service temporarily unavailable: " + faucetError.message
      });
    }

  } catch (error) {
    logger.error(`Error in withdrawPOL for user ${req.user?.id}:`, {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      ok: false,
      message: "Failed to process withdrawal"
    });
  }
}

module.exports = {
  getBalance,
  updateWalletAddress,
  withdraw,
  withdrawPOL,
  getTransactions,
  getDepositAddress,
  recordDeposit
};
