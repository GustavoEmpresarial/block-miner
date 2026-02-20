const { db, run, get } = require("./db");

class FaucetPayModel {
  // Store FaucetPay account link for user
  static async linkFaucetPayAccount(userId, faucetPayUserId, faucetPayEmail) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR REPLACE INTO faucetpay_accounts 
        (user_id, faucetpay_user_id, faucetpay_email, linked_at) 
        VALUES (?, ?, ?, ?)
      `;
      
      db.run(
        query,
        [userId, faucetPayUserId, faucetPayEmail, new Date().toISOString()],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID });
          }
        }
      );
    });
  }

  // Get user's FaucetPay account
  static async getFaucetPayAccount(userId) {
    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM faucetpay_accounts WHERE user_id = ?`;
      db.get(query, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  // Unlink FaucetPay account
  static async unlinkFaucetPayAccount(userId) {
    return new Promise((resolve, reject) => {
      const query = `DELETE FROM faucetpay_accounts WHERE user_id = ?`;
      db.run(query, [userId], function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  }

  // Create payout record (when paying user via FaucetPay)
  static async createPayout(userId, amount, currency, payoutId, toAddress) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO faucetpay_payouts 
        (user_id, amount, currency, payout_id, to_address, status, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(
        query,
        [userId, amount, currency, payoutId, toAddress, "completed", new Date().toISOString()],
        function (err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              user_id: userId,
              amount,
              currency,
              payout_id: payoutId,
              status: "completed",
              created_at: new Date().toISOString()
            });
          }
        }
      );
    });
  }

  // Get payout history
  static async getPayoutHistory(userId, limit = 50) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM faucetpay_payouts 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      db.all(query, [userId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = FaucetPayModel;
