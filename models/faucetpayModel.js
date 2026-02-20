const { db, run, get } = require("./db");

class PayoutModel {
  /**
   * Create payout record (when user withdraws POL)
   */
  static async createPayout(userId, amount, toAddress, currency = "POL", payoutId = null) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO faucetpay_payouts
        (user_id, amount, to_address, currency, payout_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(
        query,
        [userId, amount, toAddress, currency, payoutId, "completed", new Date().toISOString()],
        function (err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              user_id: userId,
              amount,
              to_address: toAddress,
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

  /**
   * Get payout history for user
   */
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

  /**
   * Get total withdrawn by user
   */
  static async getTotalWithdrawn(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT COALESCE(SUM(amount), 0) as total
        FROM faucetpay_payouts
        WHERE user_id = ? AND status = 'completed'
      `;
      db.get(query, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row?.total || 0);
      });
    });
  }
}

module.exports = PayoutModel;
