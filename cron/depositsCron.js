const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");

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
const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";

let currentProviderIndex = 0;

async function getProvider() {
  const maxAttempts = RPC_URLS.length;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const url = RPC_URLS[currentProviderIndex];
      const provider = new ethers.JsonRpcProvider(url);
      await provider.getBlockNumber();
      return provider;
    } catch (error) {
      console.warn(`RPC ${RPC_URLS[currentProviderIndex]} failed, trying next...`);
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

    console.log(`Checking ${pendingDeposits.length} pending deposits...`);

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
          console.warn(`Deposit ${deposit.tx_hash} rejected: destination mismatch`);
          continue;
        }

        const actualAmount = Number(Number(ethers.formatEther(tx.value || 0)).toFixed(6));
        if (!actualAmount || actualAmount <= 0) {
          await walletModel.updateDepositStatus(deposit.id, "invalid");
          console.warn(`Deposit ${deposit.tx_hash} rejected: invalid amount`);
          continue;
        }

        await walletModel.creditBalance(deposit.user_id, actualAmount);
        await walletModel.updateDepositStatus(deposit.id, "completed", actualAmount);

        console.log(`✅ Deposit ${deposit.tx_hash} confirmed for user ${deposit.user_id}: ${actualAmount} POL`);
      } catch (error) {
        console.error(`Error checking deposit ${deposit.tx_hash}:`, error.message);
      }
    }

  } catch (error) {
    console.error("Error in deposit check cron:", error);
  }
}

function startDepositMonitoring() {
  // Check pending deposits every 30 seconds
  const interval = setInterval(checkPendingDeposits, 30000);
  
  // Run immediately on start
  checkPendingDeposits();
  
  console.log("✅ Deposit monitoring started (checking every 30 seconds)");
  
  return {
    depositMonitoringInterval: interval
  };
}

module.exports = {
  startDepositMonitoring,
  checkPendingDeposits
};
