# BlockMiner — Configuration & Deployment

This repo uses environment variables for secrets and a versioned `config/` folder for defaults.

Quick start

1. Copy `.env.example` to `.env` and fill with secrets (DO NOT commit `.env`).

2. Install deps and run:

```bash
npm install
npm start
```

Configuration locations

- `.env` — secrets and sensitive flags (e.g. `WITHDRAWAL_PRIVATE_KEY`, `WITHDRAWAL_MNEMONIC`, `DB_PATH`, `ADMIN_EMAILS`).
- `config/default.json` — versioned defaults (faucet cooldown, schedules, UI toggles).
- `config/production.json` — overrides for production.
- `src/config/index.js` — loader that merges JSON configs with `process.env` (env wins). It also performs strict validation.

Important env vars (examples)

- `DB_PATH` — path to SQLite DB (required).
- `NODE_ENV` — `development` or `production`.
- `ADMIN_EMAILS` — comma-separated admin emails (required in production).
- `WITHDRAWAL_PRIVATE_KEY` or `WITHDRAWAL_MNEMONIC` — required in production.
- `FAUCET_REWARD_MINER_SLUG` — overrides the faucet miner slug in `config`.
- `DEPOSITS_CRON`, `WITHDRAWS_CRON`, `BACKUP_CRON` — cron expressions (node-cron) used by scheduler.

Cron expressions

The application supports cron expressions via `node-cron`. You can set them in `config/default.json` or via env vars. Examples:

```json
"schedules": { "depositsCron": "*/10 * * * * *" }
```

Security recommendations

- Never commit secrets to `config/*.json`.
- Keep `.env` out of git. Use a secure secret store in production.
- CI will block changes that inject likely-secret strings into `config/*.json` (see `.github/workflows/config-guard.yml`).

Local Git hooks

You can enable a local pre-commit hook that blocks accidental commits containing secrets in `config/*.json`:

```bash
# run once per repo clone
npm run install-hooks
```

This sets `core.hooksPath` to the repository's `.githooks` folder which includes a `pre-commit` script that scans `config/*.json` for suspicious patterns.
