const urls = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
  "https://poly.api.pocket.network",
  "https://1rpc.io/matic",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://rpc-mainnet.matic.network"
];

async function rpc(url, method, params, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal
    });

    const ms = Date.now() - start;
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { ok: false, ms, error: `HTTP ${response.status}` };
    }

    if (payload && payload.error) {
      return { ok: false, ms, error: payload.error.message || "RPC error" };
    }

    return { ok: true, ms, result: payload.result };
  } catch (error) {
    const ms = Date.now() - start;
    return { ok: false, ms, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const timeoutMs = Number(process.env.RPC_BENCH_TIMEOUT_MS || 3500);
  console.log(`Timeout: ${timeoutMs}ms`);

  for (const url of urls) {
    const chainId = await rpc(url, "eth_chainId", [], timeoutMs);
    const blockNumber = await rpc(url, "eth_blockNumber", [], timeoutMs);

    console.log("-");
    console.log(url);
    console.log("  chainId:", chainId);
    console.log("  blockNumber:", blockNumber);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
