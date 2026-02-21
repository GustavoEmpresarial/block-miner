const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");
const logger = require("../utils/logger").child("DepositsCron");
const cron = require('node-cron');
const config = require('../src/config');

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://poly.api.pocket.network";
const POLYGON_RPC_TIMEOUT_MS = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);
const DEFAULT_RPC_URLS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
  "https://poly.api.pocket.network",
  "https://1rpc.io/matic",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://rpc-mainnet.matic.network"
];
const RPC_URLS = Array.from(new Set([POLYGON_RPC_URL, ...DEFAULT_RPC_URLS]));
const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";

let currentProviderIndex = 0;

function createProvider(url) {
  const request = new ethers.FetchRequest(url);
  request.timeout = POLYGON_RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(request);
}

async function getProvider() {
  const maxAttempts = RPC_URLS.length;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const url = RPC_URLS[currentProviderIndex];
      const provider = createProvider(url);
      await provider.getBlockNumber();
      return provider;
    } catch (error) {
      logger.warn("RPC failed, trying next", { url: RPC_URLS[currentProviderIndex], error: error.message });
      currentProviderIndex = (currentProviderIndex + 1) % RPC_URLS.length;
    }
  }
  
  throw new Error("All RPC endpoints failed");
}

function isSameAddress(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

async function getConfirmations(provider, receipt) {
  if (!receipt?.blockNumber || !provider) {
    return 0;
  }

  const latestBlock = await provider.getBlockNumber();
  return Math.max(0, latestBlock - receipt.blockNumber + 1);
}

async function checkPendingDeposits() {
  try {
    const pendingDeposits = await walletModel.getPendingDeposits("__all__");

    if (pendingDeposits.length === 0) {
      return;
    }

    logger.info("Checking pending deposits", { count: pendingDeposits.length });

    for (const deposit of pendingDeposits) {
      try {
        const provider = await getProvider();
        const [tx, receipt] = await Promise.all([
          provider.getTransaction(deposit.tx_hash),
          provider.getTransactionReceipt(deposit.tx_hash)
        ]);

        if (!receipt || receipt.status !== 1 || !tx) {
          continue;
        }

        const confirmations = await getConfirmations(provider, receipt);
        if (confirmations < 1) {
          continue;
        }

        if (!isSameAddress(tx.to, CHECKIN_RECEIVER)) {
          await walletModel.updateDepositStatus(deposit.id, "invalid");
          logger.warn("Deposit rejected: destination mismatch", { txHash: deposit.tx_hash, userId: deposit.user_id });
          continue;
        }

        const actualAmount = Number(Number(ethers.formatEther(tx.value || 0)).toFixed(6));
        if (!actualAmount || actualAmount <= 0) {
          await walletModel.updateDepositStatus(deposit.id, "invalid");
          logger.warn("Deposit rejected: invalid amount", { txHash: deposit.tx_hash, userId: deposit.user_id });
          continue;
        }

        await walletModel.creditBalance(deposit.user_id, actualAmount);
        await walletModel.updateDepositStatus(deposit.id, "completed", actualAmount);

        logger.info("Deposit confirmed", { txHash: deposit.tx_hash, userId: deposit.user_id, amountPol: actualAmount });
      } catch (error) {
        logger.error("Error checking deposit", { txHash: deposit.tx_hash, error: error.message });
      }
    }

  } catch (error) {
    logger.error("Error in deposit check cron", { error: error.message });
  }
}

function startDepositMonitoring() {
  // If a cron expression is provided in config, use it (supports seconds field)
  const cronExpr = config?.schedules?.depositsCron;
  if (cronExpr) {
    try {
      const task = cron.schedule(cronExpr, () => {
        checkPendingDeposits().catch(err => logger.error('Deposit check failed', { error: err.message }));
      }, { scheduled: true });

      // Run once on startup
      checkPendingDeposits();

      logger.info('Deposit monitoring started (cron)', { cron: cronExpr });
      return { depositCronTask: task };
    } catch (error) {
      logger.error('Invalid deposit cron expression, falling back to interval', { cronExpr, error: error.message });
    }
  }

  // Fallback: Check pending deposits every 30 seconds
  const interval = setInterval(checkPendingDeposits, 30000);
  checkPendingDeposits();
  logger.info('Deposit monitoring started', { intervalMs: 30000 });
  return { depositMonitoringInterval: interval };
}

module.exports = {
  startDepositMonitoring,
  checkPendingDeposits
};
