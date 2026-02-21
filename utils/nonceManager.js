const nonceState = new Map();

function keyFor(chainId, address) {
  return `${Number(chainId)}:${String(address || "").toLowerCase()}`;
}

function resetNonce({ chainId, address }) {
  nonceState.delete(keyFor(chainId, address));
}

/**
 * Allocates a unique nonce for an address within this Node.js process.
 *
 * This prevents duplicate nonces when broadcasting multiple txs in a tight loop
 * (some RPCs lag and keep returning the same pending nonce).
 */
async function allocateNonce({ chainId, address, getPendingNonce }) {
  if (!address) {
    throw new Error("Missing address");
  }

  const key = keyFor(chainId, address);

  const pendingNonceOnChain = BigInt(await getPendingNonce());
  const current = nonceState.get(key);

  let nextNonce = pendingNonceOnChain;
  if (current && typeof current.nextNonce === "bigint") {
    nextNonce = current.nextNonce > pendingNonceOnChain ? current.nextNonce : pendingNonceOnChain;
  }

  nonceState.set(key, { nextNonce: nextNonce + 1n });

  // Nonce should be safely within JS number range for practical usage.
  return Number(nextNonce);
}

module.exports = {
  allocateNonce,
  resetNonce
};
