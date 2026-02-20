-- Esquema de banco de dados do BlockMiner

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
  ref_code TEXT UNIQUE,
  referred_by INTEGER,
  pol_balance REAL NOT NULL DEFAULT 0,
  btc_balance REAL NOT NULL DEFAULT 0,
  eth_balance REAL NOT NULL DEFAULT 0,
  usdt_balance REAL NOT NULL DEFAULT 0,
  usdc_balance REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

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
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (referrer_id) REFERENCES users(id),
  FOREIGN KEY (referred_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred_id
  ON referrals(referred_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id
  ON referrals(referrer_id);

CREATE TABLE IF NOT EXISTS referral_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (referrer_id) REFERENCES users(id),
  FOREIGN KEY (referred_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer
  ON referral_earnings(referrer_id);

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
);

CREATE INDEX IF NOT EXISTS idx_users_temp_power_username ON users_temp_power(username);

CREATE TABLE IF NOT EXISTS users_wallets (
  user_id INTEGER PRIMARY KEY,
  wallet_address TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallets_wallet_address
  ON users_wallets(wallet_address);

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
);

-- Jogos e check-in diario
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkins_user_date
  ON daily_checkins(user_id, checkin_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkins_tx_hash
  ON daily_checkins(tx_hash);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_status
  ON daily_checkins(status);

-- Recompensas dos jogos (expira em 24h ou 7 dias se houve check-in no mesmo dia)
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
);

CREATE INDEX IF NOT EXISTS idx_users_powers_games_user_id ON users_powers_games(user_id);
CREATE INDEX IF NOT EXISTS idx_users_powers_games_expires_at ON users_powers_games(expires_at);

-- Historico de pagamentos
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_pol REAL NOT NULL,
  source TEXT NOT NULL,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at);

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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_miners_user_slot
  ON user_miners(user_id, slot_index);

CREATE INDEX IF NOT EXISTS idx_user_miners_user_id ON user_miners(user_id);

CREATE TABLE IF NOT EXISTS rack_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  rack_index INTEGER NOT NULL,
  custom_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rack_configs_user_rack
  ON rack_configs(user_id, rack_index);

-- Tabela de anúncios pagos (PTP)
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
);

-- Tabela de exibições de PTP (para rastrear CPM)
CREATE TABLE IF NOT EXISTS ptp_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_id INTEGER NOT NULL,
    viewer_hash TEXT NOT NULL,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ad_id) REFERENCES ptp_ads(id)
);

-- Tabela de pagamentos de CPM para divulgadores
CREATE TABLE IF NOT EXISTS ptp_earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ad_id INTEGER NOT NULL,
    amount_usd REAL NOT NULL,
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(ad_id) REFERENCES ptp_ads(id)
);

CREATE INDEX IF NOT EXISTS idx_ptp_ads_user_id ON ptp_ads(user_id);
CREATE INDEX IF NOT EXISTS idx_ptp_ads_hash ON ptp_ads(hash);
CREATE INDEX IF NOT EXISTS idx_ptp_views_ad_id ON ptp_views(ad_id);
CREATE INDEX IF NOT EXISTS idx_ptp_earnings_user_id ON ptp_earnings(user_id);

-- FaucetPay Integration
CREATE TABLE IF NOT EXISTS faucetpay_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  faucetpay_user_id TEXT NOT NULL,
  faucetpay_email TEXT NOT NULL,
  access_token TEXT,
  linked_at TEXT NOT NULL,
  unlinked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_faucetpay_accounts_user_id
  ON faucetpay_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_faucetpay_accounts_email
  ON faucetpay_accounts(faucetpay_email);

-- FaucetPay Withdrawals
CREATE TABLE IF NOT EXISTS faucetpay_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'POL',
  faucetpay_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_id TEXT,
  api_response TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_faucetpay_withdrawals_user_id
  ON faucetpay_withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_faucetpay_withdrawals_status
  ON faucetpay_withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_faucetpay_withdrawals_created_at
  ON faucetpay_withdrawals(created_at);

