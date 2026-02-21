const { ethers } = require("ethers");
const walletModel = require("../models/walletModel");
const logger = require("../utils/logger").child("WithdrawalsCron");
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

const ALLOW_WITHDRAW_TO_CONTRACTS = String(process.env.ALLOW_WITHDRAW_TO_CONTRACTS || "").trim() === "1";


let isRunning = false;

const REBROADCAST_AFTER_MS = Number(process.env.WITHDRAWAL_REBROADCAST_AFTER_MS || 60_000);

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

async function broadcastWithdrawalOnChain(withdrawal) {
  const wallet = getPayoutWalletNoProvider();
  const amountStr = Number(withdrawal.amount).toFixed(6);
  const value = ethers.parseEther(amountStr);

  const balanceHex = await rpcCallWithFallback(RPC_URLS, "eth_getBalance", [wallet.address, "latest"]);
  const balance = BigInt(balanceHex);

  const preferredNonce = Number.isFinite(Number(withdrawal.tx_nonce)) ? Number(withdrawal.tx_nonce) : null;
  const nonce = preferredNonce ?? (await allocateNonce({
    chainId: POLYGON_CHAIN_ID,
    address: wallet.address,
    getPendingNonce: async () => rpcCallWithFallback(RPC_URLS, "eth_getTransactionCount", [wallet.address, "pending"])
  }));
  const gasPriceHex = await rpcCallWithFallback(RPC_URLS, "eth_gasPrice", []);
  const gasPrice = BigInt(gasPriceHex);

  // Default gasLimit: EOA transfers are 21k, contract recipients may require more.
  let gasLimit = 21_000;
  if (ALLOW_WITHDRAW_TO_CONTRACTS) {
    try {
      const code = await rpcCallWithFallback(RPC_URLS, "eth_getCode", [withdrawal.address, "latest"]);
      const normalized = String(code || "0x").toLowerCase();
      const isContract = normalized !== "0x" && normalized !== "0x0";
      if (isContract) {
        gasLimit = 100_000;
      }
    } catch {
      // ignore
    }
  }

  // Estimate gas for contract recipients (fallbacks can require >21k).
  try {
    const estimateHex = await rpcCallWithFallback(RPC_URLS, "eth_estimateGas", [{
      from: wallet.address,
      to: withdrawal.address,
      value: ethers.toBeHex(value)
    }]);
    const estimated = Number(BigInt(estimateHex));
    if (Number.isFinite(estimated) && estimated > 0) {
      const buffered = Math.ceil(estimated * 1.2);
      gasLimit = Math.max(21_000, Math.min(500_000, buffered));
    }
  } catch {
    // keep default
  }

  const txRequest = {
    chainId: POLYGON_CHAIN_ID,
    to: withdrawal.address,
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

  try {
    await rpcCallWithFallback(BROADCAST_RPC_URLS, "eth_sendRawTransaction", [signedTx]);
    return { txHash: localTxHash, rawTx: signedTx, nonce, gasPrice: gasPrice.toString(), gasLimit: Number(txRequest.gasLimit) };
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("nonce") || msg.includes("replacement") || msg.includes("already known")) {
      resetNonce({ chainId: POLYGON_CHAIN_ID, address: wallet.address });
    }
    // Return local hash + raw tx even if RPC failed; we can rebroadcast idempotently later.
    return { txHash: localTxHash, rawTx: signedTx, nonce, gasPrice: gasPrice.toString(), gasLimit: Number(txRequest.gasLimit), sendError: error?.message || String(error) };
  }
}

async function isTxKnown(txHash) {
  if (!txHash) {
    return false;
  }
  try {
    const tx = await rpcCallWithFallback(RPC_URLS, "eth_getTransactionByHash", [txHash]);
    return Boolean(tx);
  } catch {
    return false;
  }
}

async function rebroadcastRawTx(rawTx) {
  if (!rawTx) {
    return;
  }
  try {
    await rpcCallWithFallback(BROADCAST_RPC_URLS, "eth_sendRawTransaction", [rawTx]);
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("already known") || msg.includes("known transaction")) {
      return;
    }
    throw error;
  }
}

async function confirmWithdrawalTx(withdrawal) {
  const receipt = await rpcCallWithFallback(RPC_URLS, "eth_getTransactionReceipt", [withdrawal.tx_hash]);
  if (!receipt) {
    return { confirmed: false };
  }

  if (receipt.status === "0x1") {
    return { confirmed: true, ok: true };
  }

  if (receipt.status === "0x0") {
    return { confirmed: true, ok: false };
  }

  return { confirmed: false };
}

async function processPendingWithdrawals() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  try {
    const pending = await walletModel.getPendingWithdrawalTransactions(
      Number(process.env.WITHDRAWAL_CRON_BATCH_SIZE || 50)
    );

    if (pending.length === 0) {
      return;
    }

    logger.info("Processing pending withdrawals", { count: pending.length });

    for (const withdrawal of pending) {
      try {
        if (withdrawal.tx_hash) {
          const { confirmed, ok } = await confirmWithdrawalTx(withdrawal);
          if (!confirmed) {
            // If tx isn't known by the network, rebroadcast the same raw tx (idempotent).
            const known = await isTxKnown(withdrawal.tx_hash);
            const ageMs = Date.now() - Number(withdrawal.updated_at || withdrawal.created_at || Date.now());
            if (!known && withdrawal.raw_tx && ageMs >= REBROADCAST_AFTER_MS) {
              try {
                await rebroadcastRawTx(withdrawal.raw_tx);
                logger.info("Rebroadcasted raw withdrawal tx", { id: withdrawal.id, userId: withdrawal.user_id, txHash: withdrawal.tx_hash });
              } catch (rebroadcastError) {
                logger.warn("Failed to rebroadcast raw withdrawal tx", { id: withdrawal.id, userId: withdrawal.user_id, txHash: withdrawal.tx_hash, error: rebroadcastError.message });
              }
            }
            continue;
          }

          if (ok) {
            const sameHash = await walletModel.getWithdrawalTransactionsByTxHash(withdrawal.tx_hash);
            if (sameHash.length > 1) {
              const winner = sameHash[0];

              if (withdrawal.id !== winner.id) {
                await walletModel.updateTransactionStatus(withdrawal.id, "failed", withdrawal.tx_hash);
                logger.warn("Duplicate withdrawal tx_hash detected; marking as failed", {
                  id: withdrawal.id,
                  userId: withdrawal.user_id,
                  txHash: withdrawal.tx_hash,
                  winnerId: winner.id
                });
                continue;
              }

              for (const other of sameHash.slice(1)) {
                if (other.status !== "failed") {
                  await walletModel.updateTransactionStatus(other.id, "failed", withdrawal.tx_hash);
                  logger.warn("Duplicate withdrawal tx_hash detected; marking sibling as failed", {
                    id: other.id,
                    userId: other.user_id,
                    txHash: withdrawal.tx_hash,
                    winnerId: winner.id
                  });
                }
              }
            }

            await walletModel.updateTransactionStatus(withdrawal.id, "completed", withdrawal.tx_hash);
            logger.info("Withdrawal confirmed", {
              id: withdrawal.id,
              userId: withdrawal.user_id,
              txHash: withdrawal.tx_hash
            });
          } else {
            await walletModel.updateTransactionStatus(withdrawal.id, "failed", withdrawal.tx_hash);
            logger.warn("Withdrawal failed on-chain", {
              id: withdrawal.id,
              userId: withdrawal.user_id,
              txHash: withdrawal.tx_hash
            });
          }

          continue;
        }

        // No tx_hash yet.
        // If raw_tx already exists: just rebroadcast (idempotent). Otherwise: sign once, persist, then broadcast.
        if (withdrawal.raw_tx) {
          const ageMs = Date.now() - Number(withdrawal.updated_at || withdrawal.created_at || Date.now());
          if (ageMs >= REBROADCAST_AFTER_MS) {
            try {
              await rebroadcastRawTx(withdrawal.raw_tx);
              logger.info("Rebroadcasted raw withdrawal tx (no hash yet)", { id: withdrawal.id, userId: withdrawal.user_id });
            } catch (rebroadcastError) {
              logger.warn("Failed to rebroadcast raw withdrawal tx", { id: withdrawal.id, userId: withdrawal.user_id, error: rebroadcastError.message });
            }
          }
        } else {
          // Sign once, persist, then broadcast (idempotent from here on).
          const built = await broadcastWithdrawalOnChain(withdrawal);
          if (built?.txHash) {
            await walletModel.attachWithdrawalTx(withdrawal.id, {
              txHash: built.txHash,
              rawTx: built.rawTx,
              nonce: built.nonce,
              gasPrice: built.gasPrice,
              gasLimit: built.gasLimit
            });
            logger.info("Withdrawal signed/broadcasted", { id: withdrawal.id, userId: withdrawal.user_id, txHash: built.txHash, sendError: built.sendError || null });
          }
        }
      } catch (error) {
        if (error?.message === "Hot wallet balance is insufficient") {
          logger.warn("Hot wallet balance is insufficient; pausing withdrawal processing until next cycle", {
            id: withdrawal.id,
            userId: withdrawal.user_id
          });
          break;
        }
        logger.warn("Failed processing pending withdrawal", {
          id: withdrawal.id,
          userId: withdrawal.user_id,
          error: error.message
        });
      }
    }
  } catch (error) {
    logger.error("Error in withdrawals cron", { error: error.message });
  } finally {
    isRunning = false;
  }
}

function startWithdrawalMonitoring() {
  const intervalMs = Number(process.env.WITHDRAWAL_CRON_INTERVAL_MS || 45000);
  const interval = setInterval(processPendingWithdrawals, intervalMs);

  processPendingWithdrawals();

  logger.info("Withdrawal monitoring started", { intervalMs });

  return {
    withdrawalMonitoringInterval: interval
  };
}

module.exports = {
  startWithdrawalMonitoring,
  processPendingWithdrawals
};
