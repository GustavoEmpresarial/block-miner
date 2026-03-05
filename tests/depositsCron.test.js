const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.DB_PATH = process.env.DB_PATH || "./data/blockminer.db";

const walletModel = require("../models/walletModel");
const depositsCron = require("../cron/depositsCron");

test("checkPendingDeposits exits cleanly when no pending deposits", async () => {
  const originalGetPendingDeposits = walletModel.getPendingDeposits;
  let called = 0;

  walletModel.getPendingDeposits = async () => {
    called += 1;
    return [];
  };

  try {
    await assert.doesNotReject(async () => depositsCron.checkPendingDeposits());
    assert.equal(called, 1);
  } finally {
    walletModel.getPendingDeposits = originalGetPendingDeposits;
  }
});
