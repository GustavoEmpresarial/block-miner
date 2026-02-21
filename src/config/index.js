const fs = require('fs');
const path = require('path');

function loadJson(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (err) {
    return {};
  }
}

const root = path.resolve(__dirname, '..', '..');
const cfgDir = path.join(root, 'config');

const defaultCfg = loadJson(path.join(cfgDir, 'default.json'));
const prodCfg = loadJson(path.join(cfgDir, 'production.json'));

// Start with defaults
let cfg = Object.assign({}, defaultCfg);

// Apply environment-specific overrides if NODE_ENV=production
if (process.env.NODE_ENV && String(process.env.NODE_ENV).toLowerCase() === 'production') {
  cfg = Object.assign(cfg, prodCfg);
}

// Helper to pick from env if available
function envOr(pathParts, envNames, currentValue) {
  for (const n of envNames) {
    if (process.env[n] !== undefined) return parseEnvValue(process.env[n]);
  }
  return currentValue;
}

function parseEnvValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (!isNaN(Number(v))) return Number(v);
  return v;
}

// Map env overrides
cfg.faucet = cfg.faucet || {};
cfg.withdraw = cfg.withdraw || {};
cfg.schedules = cfg.schedules || {};
cfg.admin = cfg.admin || {};
cfg.wallet = cfg.wallet || {};
cfg.ui = cfg.ui || {};

cfg.faucet.rewardMinerSlug = envOr(['faucet.rewardMinerSlug'], ['FAUCET_REWARD_MINER_SLUG'], cfg.faucet.rewardMinerSlug);
cfg.faucet.cooldownMs = envOr(['faucet.cooldownMs'], ['FAUCET_COOLDOWN_MS'], cfg.faucet.cooldownMs);

cfg.withdraw.min = envOr(['withdraw.min'], ['MIN_WITHDRAWAL'], cfg.withdraw.min);
cfg.withdraw.max = envOr(['withdraw.max'], ['MAX_WITHDRAWAL'], cfg.withdraw.max);

cfg.schedules.depositsCron = envOr(['schedules.depositsCron'], ['DEPOSITS_CRON'], cfg.schedules.depositsCron);
cfg.schedules.withdrawsCron = envOr(['schedules.withdrawsCron'], ['WITHDRAWS_CRON', 'WITHDRAWALS_CRON'], cfg.schedules.withdrawsCron);
cfg.schedules.backupCron = envOr(['schedules.backupCron'], ['BACKUP_CRON'], cfg.schedules.backupCron);

cfg.admin.adminEmails = envOr(['admin.adminEmails'], ['ADMIN_EMAILS'], cfg.admin.adminEmails);
cfg.admin.nodeEnv = envOr(['admin.nodeEnv'], ['NODE_ENV'], cfg.admin.nodeEnv);

cfg.wallet.allowWithdrawToContracts = envOr(['wallet.allowWithdrawToContracts'], ['ALLOW_WITHDRAW_TO_CONTRACTS'], cfg.wallet.allowWithdrawToContracts);
cfg.wallet.enableAutoPayouts = envOr(['wallet.enableAutoPayouts'], ['ENABLE_AUTO_PAYOUTS'], cfg.wallet.enableAutoPayouts);

cfg.ui.showFaucetInShop = envOr(['ui.showFaucetInShop'], ['SHOW_FAUCET_IN_SHOP'], cfg.ui.showFaucetInShop);

// Basic validation
if (!cfg.faucet.rewardMinerSlug) cfg.faucet.rewardMinerSlug = 'faucet-1ghs';
if (!cfg.withdraw.min) cfg.withdraw.min = 10;
if (!cfg.withdraw.max) cfg.withdraw.max = 1000000;

module.exports = cfg;
