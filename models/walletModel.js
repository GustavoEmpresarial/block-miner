const { db, run, get } = require("../src/db/sqlite");

// Get user balance and wallet info
async function getUserBalance(userId) {
  const query = `
    SELECT balance, lifetime_mined, total_withdrawn, wallet_address
    FROM users_temp_power
    WHERE user_id = ?
  `;
  
  const profile = await get(query, [userId]);
  
  if (!profile) {
    return {
      balance: 0,
      lifetimeMined: 0,
      totalWithdrawn: 0,
      walletAddress: null
    };
  }
  
  return {
    balance: profile.balance || 0,
    lifetimeMined: profile.lifetime_mined || 0,
    totalWithdrawn: profile.total_withdrawn || 0,
    walletAddress: profile.wallet_address || null
  };
}

// Save or update wallet address
async function saveWalletAddress(userId, walletAddress) {
  const now = Date.now();
  
  // Check if wallet record exists
  const existing = await get(
    "SELECT user_id FROM users_wallets WHERE user_id = ?",
    [userId]
  );
  
  if (existing) {
    await run(
      "UPDATE users_wallets SET wallet_address = ?, updated_at = ? WHERE user_id = ?",
      [walletAddress, now, userId]
    );
  } else {
    await run(
      "INSERT INTO users_wallets (user_id, wallet_address, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [userId, walletAddress, now, now]
    );
  }
  
  // Also update in users_temp_power for quick access
  await run(
    "UPDATE users_temp_power SET wallet_address = ? WHERE user_id = ?",
    [walletAddress, userId]
  );
  
  return true;
}

// Create withdrawal transaction
async function createWithdrawal(userId, amount, address) {
  const now = Date.now();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount");
  }

  if (!address || typeof address !== "string") {
    throw new Error("Invalid wallet address");
  }

  // Get current balance
  const balance = await getUserBalance(userId);

  if (balance.balance < amount) {
    throw new Error("Insufficient balance");
  }

  // Create transaction record
  const query = `
    INSERT INTO transactions (user_id, type, amount, address, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const result = await run(query, [userId, "withdrawal", amount, address, "pending", now]);

  return {
    id: result.lastID,
    type: "withdrawal",
    amount,
    address,
    status: "pending",
    created_at: now
  };
}

// Get transaction history
async function getTransactions(userId, limit = 50) {
  const query = `
    SELECT id, type, amount, address, tx_hash, status, created_at, completed_at
    FROM transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  
  const transactions = await new Promise((resolve, reject) => {
    db.all(query, [userId, limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  
  return transactions;
}

// Update transaction status
async function updateTransactionStatus(transactionId, status, txHash = null) {
  const now = Date.now();
  const completedAt = status === "completed" ? now : null;
  
  await run(
    "UPDATE transactions SET status = ?, tx_hash = ?, completed_at = ? WHERE id = ?",
    [status, txHash, completedAt, transactionId]
  );
  
  // If completed, update total_withdrawn and deduct balance
  if (status === "completed") {
    const tx = await get("SELECT user_id, amount FROM transactions WHERE id = ?", [transactionId]);
    if (tx) {
      await run(
        "UPDATE users_temp_power SET balance = balance - ? WHERE user_id = ?",
        [tx.amount, tx.user_id]
      );
      await run(
        "UPDATE users_temp_power SET total_withdrawn = total_withdrawn + ? WHERE user_id = ?",
        [tx.amount, tx.user_id]
      );
    }
  }
  
  return true;
}

// Admin: Get pending withdrawals
async function getPendingWithdrawals() {
  const query = `
    SELECT 
      t.id, t.user_id, t.amount, t.address, t.created_at,
      u.username
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    WHERE t.type = 'withdrawal' AND t.status = 'pending'
    ORDER BY t.created_at ASC
  `;
  
  const withdrawals = await new Promise((resolve, reject) => {
    db.all(query, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  
  return withdrawals;
}

// Deduct balance from user wallet
async function deductBalance(userId, amount) {
  const query = `
    UPDATE users_temp_power
    SET balance = balance - ?,
        total_withdrawn = total_withdrawn + ?
    WHERE user_id = ?
  `;
  
  return new Promise((resolve, reject) => {
    db.run(query, [amount, amount, userId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

// Create a deposit transaction
async function createDeposit(userId, amount, txHash, fromAddress, toAddress) {
  const now = Date.now();
  
  const depositQuery = `
    INSERT INTO deposits (user_id, amount, tx_hash, from_address, to_address, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `;

  const transactionQuery = `
    INSERT INTO transactions (user_id, type, amount, status, tx_hash, from_address, address, created_at, updated_at)
    VALUES (?, 'deposit', ?, 'pending', ?, ?, ?, ?, ?)
  `;

  const depositId = await new Promise((resolve, reject) => {
    db.run(depositQuery, [userId, amount, txHash, fromAddress, toAddress, now, now], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });

  await new Promise((resolve, reject) => {
    db.run(transactionQuery, [userId, amount, txHash, fromAddress, toAddress, now, now], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });

  return depositId;
}

// Update deposit status
async function updateDepositStatus(depositId, status, actualAmount = null) {
  const now = Date.now();
  const confirmedAt = status === "completed" ? now : null;

  const deposit = await get("SELECT tx_hash FROM deposits WHERE id = ?", [depositId]);
  const txHash = deposit?.tx_hash;

  const updateDepositQuery = `
    UPDATE deposits
    SET status = ?, updated_at = ?, confirmed_at = ?, amount = COALESCE(?, amount)
    WHERE id = ?
  `;

  await new Promise((resolve, reject) => {
    db.run(updateDepositQuery, [status, now, confirmedAt, actualAmount, depositId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });

  if (txHash) {
    const updateTransactionQuery = `
      UPDATE transactions
      SET status = ?, updated_at = ?, amount = COALESCE(?, amount)
      WHERE tx_hash = ? AND type = 'deposit'
    `;

    await new Promise((resolve, reject) => {
      db.run(updateTransactionQuery, [status, now, actualAmount, txHash], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  }
}

// Credit balance (for confirmed deposits)
async function creditBalance(userId, amount) {
  const query = `
    UPDATE users_temp_power
    SET balance = balance + ?,
        lifetime_mined = lifetime_mined + ?
    WHERE user_id = ?
  `;
  
  return new Promise((resolve, reject) => {
    db.run(query, [amount, amount, userId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

// Get transaction by hash (to prevent duplicates)
async function getTransactionByHash(txHash) {
  const query = `
    SELECT * FROM deposits
    WHERE tx_hash = ?
    LIMIT 1
  `;
  
  return await get(query, [txHash]);
}

// Get pending deposits for a user
async function getPendingDeposits(userId) {
  const isAll = !userId || userId === "__all__";
  const query = isAll
    ? `
      SELECT * FROM deposits
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `
    : `
      SELECT * FROM deposits
      WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `;
  const params = isAll ? [] : [userId];

  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

module.exports = {
  getUserBalance,
  saveWalletAddress,
  createWithdrawal,
  getTransactions,
  updateTransactionStatus,
  getPendingWithdrawals,
  deductBalance,
  createDeposit,
  updateDepositStatus,
  creditBalance,
  getTransactionByHash,
  getPendingDeposits
};
