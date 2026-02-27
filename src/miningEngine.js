const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger").child("MiningEngine");

class MiningEngine {
  constructor() {
    this.tokenSymbol = "POL";
    this.blockNumber = 1;
    this.rewardBase = 0.1;
    this.blockTarget = 100;
    this.blockProgress = 0;
    this.blockDurationMs = 10 * 60 * 1000;
    this.blockStartedAt = Date.now();
    this.nextBlockAt = this.blockStartedAt + this.blockDurationMs;
    this.tokenPrice = 0.35;
    this.totalMinted = 0;
    this.lastReward = 0;
    this.roundWork = new Map();
    this.miners = new Map();
    this.lastBlockAt = Date.now();
    this.activeMiners = 0;
    this.currentNetworkHashRate = 0;
    this.blockHistory = [];
    this.logRewardCallback = null; // Callback to log rewards to database
  }

  setRewardLogger(callback) {
    this.logRewardCallback = callback;
  }

  findMinerByUserId(userId) {
    if (!userId) {
      return null;
    }

    for (const miner of this.miners.values()) {
      if (miner.userId === userId) {
        return miner;
      }
    }

    return null;
  }

  createOrGetMiner({ userId, username, walletAddress, profile }) {
    const existing = this.findMinerByUserId(userId);
    if (existing) {
      if (username) {
        existing.username = username;
      }
      if (walletAddress) {
        existing.walletAddress = walletAddress;
      }
      return existing;
    }

    const id = uuidv4();
    const initialRigs = Number(profile?.rigs || 1);
    const initialBaseHashRate = Number(profile?.baseHashRate || 0);
    const initialBalance = Number(profile?.balance || 0);
    const initialLifetimeMined = Number(profile?.lifetimeMined || 0);

    const miner = {
      id,
      userId,
      walletAddress: walletAddress || null,
      username: username || `Miner-${id.slice(0, 5)}`,
      rigs: initialRigs,
      baseHashRate: initialBaseHashRate,
      active: true,
      boostMultiplier: 1,
      boostEndsAt: 0,
      balance: initialBalance,
      lifetimeMined: initialLifetimeMined,
      connected: true
    };

    this.miners.set(id, miner);
    this.roundWork.set(id, 0);

    return miner;
  }

  setConnected(minerId, connected) {
    const miner = this.miners.get(minerId);
    if (!miner) {
      return;
    }
    miner.connected = connected;
  }

  setActive(minerId, active) {
    const miner = this.miners.get(minerId);
    if (!miner) {
      return null;
    }
    miner.active = !!active;
    return miner;
  }

  setWallet(minerId, walletAddress) {
    const miner = this.miners.get(minerId);
    if (!miner) {
      return null;
    }

    miner.walletAddress = walletAddress || null;
    return miner;
  }

  applyBoost(minerId) {
    const miner = this.miners.get(minerId);
    if (!miner) {
      return { ok: false, message: "Miner não encontrado." };
    }

    const boostCost = 0.35;
    if (miner.balance < boostCost) {
      return { ok: false, message: "Saldo insuficiente para boost." };
    }

    miner.balance -= boostCost;
    miner.boostMultiplier = 1.25;
    miner.boostEndsAt = Date.now() + 30000;

    return { ok: true, message: "Boost ativado por 30s." };
  }

  upgradeRig(minerId) {
    const miner = this.miners.get(minerId);
    if (!miner) {
      return { ok: false, message: "Miner não encontrado." };
    }

    const rigCost = 2 + (miner.rigs - 1) * 0.8;
    if (miner.balance < rigCost) {
      return { ok: false, message: `Você precisa de ${rigCost.toFixed(2)} ${this.tokenSymbol}.` };
    }

    miner.balance -= rigCost;
    miner.rigs += 1;
    miner.baseHashRate += 18;

    return { ok: true, message: `Rig #${miner.rigs} comprado com sucesso.` };
  }

  getMinerHashRate(miner) {
    if (!miner.active) {
      return 0;
    }

    // Deterministic hash rate based on base GHS and any active boosts
    return miner.baseHashRate * miner.boostMultiplier;
  }

  distributeRewards() {
    // Pool Mining Model: Distribute fixed block reward proportionally to all miners
    // based on their cumulative work (GHS * time) during this block period
    // Example: 1 user 10 GHS = gets all 0.1 POL
    //          2 users 10 GHS each = each gets 0.05 POL (50% share each)
    //          1 user 5 GHS + 1 user 15 GHS = gets 0.025 + 0.075 POL
    
    const minedBlockNumber = this.blockNumber;
    const totalWork = [...this.roundWork.values()].reduce((sum, value) => sum + value, 0);
    if (totalWork <= 0) {
      logger.debug("No work accumulated in round, skipping distribution", {
        blockNumber: minedBlockNumber
      });
      this.roundWork.forEach((_, minerId) => this.roundWork.set(minerId, 0));
      this.lastReward = 0;
      this.blockHistory.unshift({
        blockNumber: minedBlockNumber,
        reward: 0,
        minerCount: this.activeMiners,
        timestamp: Date.now()
      });

      if (this.blockHistory.length > 12) {
        this.blockHistory.length = 12;
      }

      this.blockNumber += 1;
      this.blockProgress = 0;
      this.lastBlockAt = Date.now();
      this.blockStartedAt = this.lastBlockAt;
      this.nextBlockAt = this.blockStartedAt + this.blockDurationMs;
      return;
    }

    // Fixed reward per block (0.1 POL) - no randomness to ensure consistent payouts
    const blockReward = this.rewardBase;
    const minerRewards = [];

    for (const [minerId, work] of this.roundWork.entries()) {
      const miner = this.miners.get(minerId);
      if (!miner || work <= 0) {
        this.roundWork.set(minerId, 0);
        continue;
      }

      // Miner's percentage share of total network work
      const share = work / totalWork;
      // Miner's reward = block reward * their share
      const reward = blockReward * share;
      miner.balance += reward;
      miner.lifetimeMined += reward;
      this.totalMinted += reward;
      this.roundWork.set(minerId, 0);

      minerRewards.push({
        minerId: miner.id,
        username: miner.username,
        work: work.toFixed(2),
        share: (share * 100).toFixed(2),
        reward: reward.toFixed(8),
        newBalance: miner.balance.toFixed(8)
      });

      // Log reward to database for user visibility
      if (this.logRewardCallback && miner.userId) {
        this.logRewardCallback({
          userId: miner.userId,
          blockNumber: minedBlockNumber,
          workAccumulated: work,
          totalNetworkWork: totalWork,
          sharePercentage: (share * 100),
          rewardAmount: reward,
          balanceAfter: miner.balance
        });
      }
    }

    // Log distribution details
    logger.info("Block rewards distributed", {
      blockNumber: minedBlockNumber,
      blockReward,
      totalWork: totalWork.toFixed(2),
      minerCount: minerRewards.length,
      totalDistributed: minerRewards.reduce((sum, r) => sum + parseFloat(r.reward), 0).toFixed(8),
      miners: minerRewards
    });

    this.lastReward = blockReward;
    this.blockHistory.unshift({
      blockNumber: minedBlockNumber,
      reward: blockReward,
      minerCount: this.activeMiners,
      timestamp: Date.now()
    });

    if (this.blockHistory.length > 12) {
      this.blockHistory.length = 12;
    }

    this.blockNumber += 1;
    this.blockProgress = 0;
    this.lastBlockAt = Date.now();
    this.blockStartedAt = this.lastBlockAt;
    this.nextBlockAt = this.blockStartedAt + this.blockDurationMs;
  }

  tick() {
    // Each second, accumulate work from each active miner based on their GHS
    // Work = GHS per second (accumulated over block duration = 10 minutes)
    const now = Date.now();

    let totalHashRate = 0;
    let activeMiners = 0;
    const minerDetails = [];

    for (const [minerId, miner] of this.miners.entries()) {
      if (miner.boostEndsAt > 0 && now >= miner.boostEndsAt) {
        miner.boostMultiplier = 1;
        miner.boostEndsAt = 0;
      }

      const hashRate = this.getMinerHashRate(miner);
      totalHashRate += hashRate;
      if (hashRate > 0) {
        activeMiners += 1;
      }
      this.roundWork.set(minerId, (this.roundWork.get(minerId) || 0) + hashRate);
      
      // Track miner details for debug logging
      minerDetails.push({
        userId: miner.userId,
        username: miner.username,
        baseHashRate: miner.baseHashRate,
        active: miner.active,
        connected: miner.connected,
        hashRate,
        accumulatedWork: this.roundWork.get(minerId) || 0
      });
    }

    this.currentNetworkHashRate = totalHashRate;
    this.activeMiners = activeMiners;

    const priceNoise = (Math.random() - 0.5) * 0.006;
    const demandFactor = totalHashRate > 0 ? 0.00015 : -0.00015;
    this.tokenPrice = Math.max(0.05, this.tokenPrice + priceNoise + demandFactor);

    if (now >= this.nextBlockAt) {
      logger.info("Block time reached, distributing rewards", {
        blockNumber: this.blockNumber,
        activeMiners,
        totalHashRate: totalHashRate.toFixed(2),
        minerCount: this.miners.size,
        minerDetails
      });
      this.distributeRewards();
    }

    const elapsed = Math.max(0, now - this.blockStartedAt);
    this.blockProgress = Math.min(this.blockTarget, (elapsed / this.blockDurationMs) * this.blockTarget);
  }

  getLeaderboard(limit = 10) {
    return [...this.miners.values()]
      .map((miner) => ({
        id: miner.id,
        username: miner.username,
        rigs: miner.rigs,
        active: miner.active,
        lifetimeMined: miner.lifetimeMined,
        currentHashRate: this.getMinerHashRate(miner)
      }))
      .sort((a, b) => b.lifetimeMined - a.lifetimeMined)
      .slice(0, limit);
  }

  getPublicState(minerId) {
    const miner = minerId ? this.miners.get(minerId) : null;
    const remainingMs = Math.max(0, this.nextBlockAt - Date.now());
    const blockCountdownSeconds = Math.ceil(remainingMs / 1000);
    const blockEtaSeconds = blockCountdownSeconds;

    return {
      serverTime: Date.now(),
      tokenSymbol: this.tokenSymbol,
      tokenPrice: this.tokenPrice,
      blockReward: this.rewardBase,
      blockNumber: this.blockNumber,
      blockTarget: this.blockTarget,
      blockProgress: this.blockProgress,
      blockDurationSeconds: Math.round(this.blockDurationMs / 1000),
      blockCountdownSeconds,
      totalMiners: this.miners.size,
      activeMiners: this.activeMiners,
      networkHashRate: this.currentNetworkHashRate,
      totalMinted: this.totalMinted,
      lastReward: this.lastReward,
      blockEtaSeconds,
      blockHistory: this.blockHistory,
      leaderboard: this.getLeaderboard(),
      miner: miner
        ? {
            id: miner.id,
            username: miner.username,
            walletAddress: miner.walletAddress,
            rigs: miner.rigs,
            active: miner.active,
            baseHashRate: miner.baseHashRate,
            boostMultiplier: miner.boostMultiplier,
            boostEndsAt: miner.boostEndsAt,
            balance: miner.balance,
            lifetimeMined: miner.lifetimeMined,
            connected: miner.connected,
            estimatedHashRate: this.getMinerHashRate(miner)
          }
        : null
    };
  }
}

module.exports = { MiningEngine };
