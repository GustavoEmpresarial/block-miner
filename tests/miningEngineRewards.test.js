const test = require("node:test");
const assert = require("node:assert/strict");

const { MiningEngine } = require("../src/miningEngine");

test("MiningEngine.distributeRewards distributes proportionally", () => {
  const engine = new MiningEngine();
  const minerA = engine.createOrGetMiner({ userId: 101, username: "alpha", profile: { rigs: 1, baseHashRate: 10 } });
  const minerB = engine.createOrGetMiner({ userId: 202, username: "beta", profile: { rigs: 1, baseHashRate: 20 } });

  engine.roundWork.set(minerA.id, 100);
  engine.roundWork.set(minerB.id, 300);
  engine.activeMiners = 2;

  const loggedRewards = [];
  engine.setRewardLogger((payload) => loggedRewards.push(payload));

  engine.distributeRewards();

  assert.ok(Math.abs(minerA.balance - 0.025) < 1e-12);
  assert.ok(Math.abs(minerB.balance - 0.075) < 1e-12);
  assert.equal(engine.blockNumber, 2);
  assert.equal(engine.lastReward, 0.1);
  assert.equal(loggedRewards.length, 2);
  assert.deepEqual(
    loggedRewards.map((row) => row.userId).sort((a, b) => a - b),
    [101, 202]
  );
});

test("MiningEngine.distributeRewards handles zero-work round", () => {
  const engine = new MiningEngine();
  const miner = engine.createOrGetMiner({ userId: 303, username: "idle", profile: { rigs: 1, baseHashRate: 0 } });

  engine.roundWork.set(miner.id, 0);
  engine.activeMiners = 0;

  engine.distributeRewards();

  assert.equal(miner.balance, 0);
  assert.equal(engine.lastReward, 0);
  assert.equal(engine.blockNumber, 2);
});
