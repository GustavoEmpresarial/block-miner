const { run, get } = require("../models/db");
const { getBrazilCheckinDateKey } = require("../utils/checkinDate");

function createCheckinController(config) {
  const {
    polygonRpcUrl,
    polygonChainId,
    checkinReceiver,
    checkinAmountWei
  } = config;

  async function rpcCall(method, params) {
    const response = await fetch(polygonRpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error("RPC request failed");
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.message || "RPC error");
    }

    return payload.result;
  }

  function getTodayKey() {
    return getBrazilCheckinDateKey();
  }

  function isSameAddress(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
  }

  async function ensureCheckinConfirmed(checkin) {
    if (!checkin || checkin.status === "confirmed" || !checkin.tx_hash) {
      return checkin;
    }

    const receipt = await rpcCall("eth_getTransactionReceipt", [checkin.tx_hash]);
    if (receipt && receipt.status === "0x1") {
      const now = Date.now();
      await run("UPDATE daily_checkins SET status = ?, confirmed_at = ? WHERE id = ?", ["confirmed", now, checkin.id]);
      return { ...checkin, status: "confirmed" };
    }

    return checkin;
  }

  async function getTodayCheckin(userId) {
    const today = getTodayKey();
    let checkin = await get(
      "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
      [userId, today]
    );

    if (checkin) {
      return checkin;
    }

    checkin = await get(
      "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    );

    if (!checkin) {
      return null;
    }

    const expectedDate = getBrazilCheckinDateKey(new Date(checkin.created_at));
    if (expectedDate !== checkin.checkin_date) {
      await run("UPDATE daily_checkins SET checkin_date = ? WHERE id = ?", [expectedDate, checkin.id]);
      checkin.checkin_date = expectedDate;
    }

    return expectedDate === today ? checkin : null;
  }

  async function getStatus(req, res) {
    try {
      const existing = await getTodayCheckin(req.user.id);
      const confirmed = await ensureCheckinConfirmed(existing);

      res.json({
        ok: true,
        checkedIn: Boolean(confirmed),
        status: confirmed?.status || null,
        txHash: confirmed?.tx_hash || null
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to load check-in status." });
    }
  }

  async function verify(req, res) {
    try {
      const txHash = String(req.body?.txHash || "").trim();
      const chainId = Number(req.body?.chainId || polygonChainId);
      if (!txHash) {
        res.status(400).json({ ok: false, message: "Missing transaction hash." });
        return;
      }

      if (chainId !== polygonChainId) {
        res.status(400).json({ ok: false, message: "Use Polygon mainnet for check-in." });
        return;
      }

      const today = getTodayKey();
      const existing = await getTodayCheckin(req.user.id);

      if (existing) {
        const confirmed = await ensureCheckinConfirmed(existing);
        res.json({ ok: true, alreadyCheckedIn: true, status: confirmed.status, txHash: confirmed.tx_hash });
        return;
      }

      const reusedTx = await get("SELECT id, user_id, status FROM daily_checkins WHERE tx_hash = ?", [txHash]);
      if (reusedTx) {
        if (reusedTx.user_id !== req.user.id) {
          res.status(409).json({ ok: false, message: "Transaction already used." });
          return;
        }

        if (reusedTx.status === "confirmed") {
          res.json({ ok: true, status: "confirmed", alreadyCheckedIn: true });
          return;
        }

        const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
        if (receipt && receipt.status === "0x1") {
          await run("UPDATE daily_checkins SET status = ?, confirmed_at = ? WHERE id = ?", ["confirmed", Date.now(), reusedTx.id]);
          res.json({ ok: true, status: "confirmed" });
          return;
        }

        res.json({ ok: true, status: reusedTx.status || "pending" });
        return;
      }

      const now = Date.now();
      const tx = await rpcCall("eth_getTransactionByHash", [txHash]);
      if (!tx) {
        await run(
          "INSERT INTO daily_checkins (user_id, checkin_date, created_at, tx_hash, status, amount, chain_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [req.user.id, today, now, txHash, "pending", 0.01, chainId]
        );
        res.json({ ok: true, status: "pending" });
        return;
      }

      if (!isSameAddress(tx.to, checkinReceiver)) {
        res.status(400).json({ ok: false, message: "Invalid receiver address." });
        return;
      }

      let txValue = 0n;
      try {
        txValue = BigInt(tx.value || "0x0");
      } catch {
        txValue = 0n;
      }

      if (txValue < checkinAmountWei) {
        res.status(400).json({ ok: false, message: "Transaction amount is below 0.01 POL." });
        return;
      }

      const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
      const confirmed = receipt && receipt.status === "0x1";
      const status = confirmed ? "confirmed" : "pending";

      await run(
        "INSERT INTO daily_checkins (user_id, checkin_date, created_at, confirmed_at, tx_hash, status, amount, chain_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [req.user.id, today, now, confirmed ? now : null, txHash, status, 0.01, chainId]
      );

      res.json({ ok: true, status });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Unable to verify check-in." });
    }
  }

  return {
    getStatus,
    verify
  };
}

module.exports = {
  createCheckinController
};
