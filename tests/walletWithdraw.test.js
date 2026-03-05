const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.DB_PATH = process.env.DB_PATH || "./data/blockminer.db";
process.env.ALLOW_WITHDRAW_TO_CONTRACTS = "1";

const auditLogModelPath = require.resolve("../models/auditLogModel");
const originalAuditLogModel = require(auditLogModelPath);

require.cache[auditLogModelPath].exports = {
  ...originalAuditLogModel,
  createAuditLog: async () => {}
};

const walletModel = require("../models/walletModel");
const walletController = require("../controllers/walletController");

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test.after(() => {
  require.cache[auditLogModelPath].exports = originalAuditLogModel;
});

test("withdraw returns 409 when there is pending withdrawal", async () => {
  const originalHasPendingWithdrawal = walletModel.hasPendingWithdrawal;
  const originalCreateWithdrawal = walletModel.createWithdrawal;

  walletModel.hasPendingWithdrawal = async () => true;
  walletModel.createWithdrawal = async () => {
    throw new Error("should not be called");
  };

  const req = {
    user: { id: 1 },
    body: { amount: "15", address: "0x000000000000000000000000000000000000dead" },
    get: () => "",
    headers: {}
  };
  const res = createRes();

  try {
    await walletController.withdraw(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.ok, false);
  } finally {
    walletModel.hasPendingWithdrawal = originalHasPendingWithdrawal;
    walletModel.createWithdrawal = originalCreateWithdrawal;
  }
});

test("withdraw creates pending transaction when request is valid", async () => {
  const originalHasPendingWithdrawal = walletModel.hasPendingWithdrawal;
  const originalCreateWithdrawal = walletModel.createWithdrawal;

  walletModel.hasPendingWithdrawal = async () => false;
  walletModel.createWithdrawal = async (userId, amount, address) => ({
    id: 999,
    user_id: userId,
    amount,
    address,
    status: "pending"
  });

  const req = {
    user: { id: 5 },
    body: { amount: "12.5", address: "0x000000000000000000000000000000000000dEaD" },
    get: () => "test-agent",
    headers: {}
  };
  const res = createRes();

  try {
    await walletController.withdraw(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.transaction?.id, 999);
    assert.equal(res.body?.transaction?.status, "pending");
  } finally {
    walletModel.hasPendingWithdrawal = originalHasPendingWithdrawal;
    walletModel.createWithdrawal = originalCreateWithdrawal;
  }
});
