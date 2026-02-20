const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "blockminer.db");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row || null);
    });
  });
}

async function initializeDatabase() {
  try {
    await run("ALTER TABLE miner_profiles RENAME TO users_temp_power");
  } catch {
    // Table already renamed or does not exist.
  }

  try {
    await run("ALTER TABLE game_rewards RENAME TO users_powers_games");
  } catch {
    // Table already renamed or does not exist.
  }

  try {
    await run("ALTER TABLE machines RENAME TO user_miners");
  } catch {
    // Table already renamed or does not exist.
  }

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER,
      ip TEXT,
      user_agent TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      pol_balance REAL NOT NULL DEFAULT 0,
      btc_balance REAL NOT NULL DEFAULT 0,
      eth_balance REAL NOT NULL DEFAULT 0,
      usdt_balance REAL NOT NULL DEFAULT 0,
      usdc_balance REAL NOT NULL DEFAULT 0
    )
  `);

  try {
    await run("ALTER TABLE users ADD COLUMN pol_balance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN btc_balance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN eth_balance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN usdt_balance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN usdc_balance REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN username TEXT");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN last_login_at INTEGER");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN ip TEXT");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN user_agent TEXT");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN ref_code TEXT");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE users ADD COLUMN referred_by INTEGER");
  } catch {
    // Column already exists in most cases.
  }

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      replaced_by TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      details_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS auth_lockouts (
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL,
      PRIMARY KEY (kind, value)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_auth_lockouts_locked_until ON auth_lockouts(locked_until)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_auth_lockouts_last_at ON auth_lockouts(last_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred_id
      ON referrals(referred_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id
      ON referrals(referrer_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS referral_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer
      ON referral_earnings(referrer_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users_temp_power (
      user_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      wallet_address TEXT,
      rigs INTEGER NOT NULL DEFAULT 1,
      base_hash_rate REAL NOT NULL DEFAULT 55,
      balance REAL NOT NULL DEFAULT 0,
      lifetime_mined REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_users_temp_power_username ON users_temp_power(username)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users_wallets (
      user_id INTEGER PRIMARY KEY,
      wallet_address TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallets_wallet_address
      ON users_wallets(wallet_address)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS miners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      base_hash_rate REAL NOT NULL DEFAULT 55,
      price REAL NOT NULL DEFAULT 0.5,
      slot_size INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  const faucetMinerSlug = "faucet-1ghs";
  const faucetMinerName = "Faucet Miner";
  const faucetMinerImage = "/assets/machines/reward1.png";
  const faucetMinerRow = await get("SELECT id FROM miners WHERE slug = ?", [faucetMinerSlug]);
  if (!faucetMinerRow) {
    const faucetNow = Date.now();
    await run(
      "INSERT INTO miners (name, slug, base_hash_rate, price, slot_size, image_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [faucetMinerName, faucetMinerSlug, 1, 0, 1, faucetMinerImage, 1, faucetNow]
    );
  }

  await run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS daily_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      checkin_date TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      tx_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount REAL NOT NULL DEFAULT 0.01,
      chain_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS faucet_claims (
      user_id INTEGER PRIMARY KEY,
      claimed_at INTEGER NOT NULL,
      total_claims INTEGER NOT NULL DEFAULT 0,
      day_key TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkins_user_date
      ON daily_checkins(user_id, checkin_date)
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkins_tx_hash
      ON daily_checkins(tx_hash)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_daily_checkins_status
      ON daily_checkins(status)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users_powers_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      hash_rate REAL NOT NULL,
      played_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      checkin_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (game_id) REFERENCES games(id),
      FOREIGN KEY (checkin_id) REFERENCES daily_checkins(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_users_powers_games_user_id ON users_powers_games(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_users_powers_games_expires_at ON users_powers_games(expires_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_pol REAL NOT NULL,
      source TEXT NOT NULL,
      tx_hash TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_miners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      miner_id INTEGER,
      slot_index INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      hash_rate REAL NOT NULL DEFAULT 55,
      is_active INTEGER NOT NULL DEFAULT 1,
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (miner_id) REFERENCES miners(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_miners_user_slot
      ON user_miners(user_id, slot_index)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_user_miners_user_id ON user_miners(user_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      miner_id INTEGER,
      miner_name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      hash_rate REAL NOT NULL DEFAULT 55,
      slot_size INTEGER NOT NULL DEFAULT 1,
      acquired_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (miner_id) REFERENCES miners(id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON user_inventory(user_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS rack_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rack_index INTEGER NOT NULL,
      custom_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rack_configs_user_rack
      ON rack_configs(user_id, rack_index)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ptp_ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      hash TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      views INTEGER DEFAULT 0,
      paid_usd REAL DEFAULT 0.10,
      target_views INTEGER DEFAULT 0,
      asset TEXT DEFAULT 'POOL',
      cost_usd REAL DEFAULT 0.10,
      cost_asset REAL DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  try {
    await run("ALTER TABLE ptp_ads ADD COLUMN target_views INTEGER DEFAULT 0");
  } catch {
    // Column already exists.
  }

  try {
    await run("ALTER TABLE ptp_ads ADD COLUMN asset TEXT DEFAULT 'POOL'");
  } catch {
    // Column already exists.
  }

  try {
    await run("ALTER TABLE ptp_ads ADD COLUMN cost_usd REAL DEFAULT 0.10");
  } catch {
    // Column already exists.
  }

  try {
    await run("ALTER TABLE ptp_ads ADD COLUMN cost_asset REAL DEFAULT 0");
  } catch {
    // Column already exists.
  }

  await run(`
    CREATE TABLE IF NOT EXISTS ptp_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL,
      viewer_hash TEXT NOT NULL,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ad_id) REFERENCES ptp_ads(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ptp_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ad_id INTEGER NOT NULL,
      amount_usd REAL NOT NULL,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(ad_id) REFERENCES ptp_ads(id)
    )
  `);

  await run("CREATE INDEX IF NOT EXISTS idx_ptp_ads_user_id ON ptp_ads(user_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_ptp_ads_hash ON ptp_ads(hash)");
  await run("CREATE INDEX IF NOT EXISTS idx_ptp_views_ad_id ON ptp_views(ad_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_ptp_earnings_user_id ON ptp_earnings(user_id)");

  try {
    await run("ALTER TABLE user_miners ADD COLUMN miner_id INTEGER");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE user_miners ADD COLUMN slot_size INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE miners ADD COLUMN slot_size INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE user_inventory ADD COLUMN miner_id INTEGER");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE user_inventory ADD COLUMN slot_size INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE faucet_claims ADD COLUMN day_key TEXT");
  } catch {
    // Column already exists in most cases.
  }

  await run(`
    CREATE TABLE IF NOT EXISTS faucet_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      miner_id INTEGER NOT NULL,
      cooldown_ms INTEGER NOT NULL DEFAULT 3600000,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (miner_id) REFERENCES miners(id)
    )
  `);

  const faucetRewardRow = await get("SELECT id FROM faucet_rewards WHERE is_active = 1 LIMIT 1");
  if (!faucetRewardRow) {
    const faucetMiner = await get("SELECT id FROM miners WHERE slug = ?", [faucetMinerSlug]);
    if (faucetMiner?.id) {
      const now = Date.now();
      await run(
        "INSERT INTO faucet_rewards (miner_id, cooldown_ms, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        [faucetMiner.id, 3600000, now, now]
      );
    }
  }

  // Update existing Elite Miners to have slot_size = 2
  try {
    await run("UPDATE user_miners SET slot_size = 2 WHERE hash_rate >= 100 AND (slot_size IS NULL OR slot_size = 1)");
  } catch (error) {
    console.error("Failed to update Elite Miners slot_size:", error);
  }

  try {
    await run(
      "UPDATE user_miners SET miner_id = (SELECT id FROM miners WHERE base_hash_rate = user_miners.hash_rate ORDER BY id ASC LIMIT 1) WHERE miner_id IS NULL"
    );
  } catch (error) {
    console.error("Failed to backfill user_miners miner_id:", error);
  }

  try {
    await run("UPDATE miners SET slot_size = 2 WHERE base_hash_rate >= 100 AND (slot_size IS NULL OR slot_size = 1)");
  } catch (error) {
    console.error("Failed to update miners slot_size:", error);
  }

  try {
    await run("UPDATE user_inventory SET slot_size = 2 WHERE hash_rate >= 100 AND (slot_size IS NULL OR slot_size = 1)");
  } catch (error) {
    console.error("Failed to update inventory slot_size:", error);
  }

  // Transactions table for withdrawals and deposits
  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      address TEXT,
      tx_hash TEXT,
      from_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  try {
    await run("ALTER TABLE transactions ADD COLUMN from_address TEXT");
  } catch {
    // Column already exists in most cases.
  }

  try {
    await run("ALTER TABLE transactions ADD COLUMN updated_at INTEGER");
  } catch {
    // Column already exists in most cases.
  }

  await run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)
  `);

  // Deposits table
  await run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      confirmed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_tx_hash ON deposits(tx_hash)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)
  `);

  // Add total_withdrawn column to users_temp_power if it doesn't exist
  try {
    await run("ALTER TABLE users_temp_power ADD COLUMN total_withdrawn REAL NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }
}

module.exports = {
  db,
  run,
  get,
  initializeDatabase
};
