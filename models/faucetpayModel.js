const { db, run, get } = require("./db");

class FaucetPayModel {
  // Store FaucetPay account link for user
  static async linkFaucetPayAccount(userId, faucetPayUserId, faucetPayEmail) {
    console.log("[FaucetPay Model] 🚀 linkFaucetPayAccount called");
    console.log("[FaucetPay Model] userId:", userId);
    console.log("[FaucetPay Model] faucetPayUserId:", faucetPayUserId);
    console.log("[FaucetPay Model] faucetPayEmail:", faucetPayEmail);
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR REPLACE INTO faucetpay_accounts 
        (user_id, faucetpay_user_id, faucetpay_email, linked_at) 
        VALUES (?, ?, ?, ?)
      `;
      
      console.log("[FaucetPay Model] Executing query:", query);
      console.log("[FaucetPay Model] Params:", [userId, faucetPayUserId, faucetPayEmail, new Date().toISOString()]);
      
      db.run(
        query,
        [userId, faucetPayUserId, faucetPayEmail, new Date().toISOString()],
        function (err) {
          if (err) {
            console.error("[FaucetPay Model] ❌ Database error:", err);
            reject(err);
          } else {
            console.log("[FaucetPay Model] ✅ Insert successful, lastID:", this.lastID);
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

  // Create FaucetPay withdrawal record
  static async createFaucetPayWithdrawal(userId, amount, faucetPayUserId) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO faucetpay_withdrawals 
        (user_id, amount, faucetpay_user_id, status, created_at) 
        VALUES (?, ?, ?, ?, ?)
      `;
      db.run(
        query,
        [userId, amount, faucetPayUserId, "pending", new Date().toISOString()],
        function (err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              user_id: userId,
              amount,
              faucetpay_user_id: faucetPayUserId,
              status: "pending",
              created_at: new Date().toISOString()
            });
          }
        }
      );
    });
  }

  // Update withdrawal status
  static async updateFaucetPayWithdrawalStatus(withdrawalId, status, apiResponse = null) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE faucetpay_withdrawals 
        SET status = ?, api_response = ?, updated_at = ?
        WHERE id = ?
      `;
      db.run(
        query,
        [status, apiResponse ? JSON.stringify(apiResponse) : null, new Date().toISOString(), withdrawalId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  // Get withdrawal history
  static async getFaucetPayWithdrawals(userId, limit = 20) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM faucetpay_withdrawals 
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
