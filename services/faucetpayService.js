const axios = require("axios");
const logger = require("../utils/logger").getLogger("FaucetPayService");

const FAUCETPAY_API_URL = process.env.FAUCETPAY_API_URL || "https://faucetpay.io/api/v1";
const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY;

/**
 * Service for FaucetPay API payouts (sending money to users)
 */
class FaucetPayService {
  /**
   * Get account balance
   * @param {string} currency - BTC, ETH, etc (default: BTC)
   * @returns {Promise} Balance info
   */
  static async getBalance(currency = "BTC") {
    try {
      if (!FAUCETPAY_API_KEY) {
        throw new Error("FAUCETPAY_API_KEY not configured");
      }

      const response = await axios.post(`${FAUCETPAY_API_URL}/balance`, {
        api_key: FAUCETPAY_API_KEY,
        currency
      });

      if (response.data.status !== 200) {
        throw new Error(response.data.message);
      }

      logger.info("FaucetPay balance fetched", {
        currency,
        balance: response.data.balance_bitcoin
      });

      return response.data;
    } catch (error) {
      logger.error("Failed to get FaucetPay balance", {
        error: error.message,
        currency
      });
      throw error;
    }
  }

  /**
   * Send payment (payout to user)
   * @param {number} amount - Amount in smallest unit (satoshis for BTC, wei for ETH, etc)
   * @param {string} to - Recipient address or email
   * @param {string} currency - BTC, ETH, etc (default: BTC)
   * @param {string} ipAddress - Optional IP for fraud detection
   * @returns {Promise} Payout info with payout_id
   */
  static async send(amount, to, currency = "BTC", ipAddress = null) {
    try {
      if (!FAUCETPAY_API_KEY) {
        throw new Error("FAUCETPAY_API_KEY not configured");
      }

      if (!amount || amount <= 0) {
        throw new Error("Invalid amount");
      }

      if (!to) {
        throw new Error("Recipient address/email required");
      }

      logger.info("FaucetPay send initiated", {
        amount,
        to,
        currency
      });

      const payloadData = {
        api_key: FAUCETPAY_API_KEY,
        amount: String(amount),
        to,
        currency
      };

      if (ipAddress) {
        payloadData.ip_address = ipAddress;
      }

      const response = await axios.post(`${FAUCETPAY_API_URL}/send`, payloadData);

      // Check response status
      if (response.data.status !== 200) {
        const errorMsg = this._parseErrorMessage(response.data.status);
        logger.error("FaucetPay send failed", {
          status: response.data.status,
          message: response.data.message,
          to,
          amount
        });
        throw new Error(`${errorMsg}: ${response.data.message}`);
      }

      logger.info("FaucetPay send successful", {
        payoutId: response.data.payout_id,
        to,
        amount,
        remainingBalance: response.data.balance_bitcoin,
        currency
      });

      return {
        ok: true,
        payout_id: response.data.payout_id,
        payout_user_hash: response.data.payout_user_hash,
        amount: response.data.balance,
        balance_bitcoin: response.data.balance_bitcoin,
        currency: response.data.currency,
        rate_limit_remaining: response.data.rate_limit_remaining
      };
    } catch (error) {
      logger.error("FaucetPay send error", {
        error: error.message,
        to,
        amount
      });
      throw error;
    }
  }

  /**
   * Check if address belongs to a user
   * @param {string} address - Address to check
   * @returns {Promise} User hash if found
   */
  static async checkAddress(address) {
    try {
      if (!FAUCETPAY_API_KEY) {
        throw new Error("FAUCETPAY_API_KEY not configured");
      }

      const response = await axios.post(`${FAUCETPAY_API_URL}/checkaddress`, {
        api_key: FAUCETPAY_API_KEY,
        address
      });

      if (response.data.status === 456) {
        logger.warn("Address does not belong to any FaucetPay user", { address });
        return null;
      }

      if (response.data.status !== 200) {
        throw new Error(response.data.message);
      }

      return response.data.payout_user_hash;
    } catch (error) {
      logger.warn("Failed to check FaucetPay address", {
        error: error.message,
        address
      });
      throw error;
    }
  }

  /**
   * Get supported currencies
   * @returns {Promise} List of currencies
   */
  static async getCurrencies() {
    try {
      if (!FAUCETPAY_API_KEY) {
        throw new Error("FAUCETPAY_API_KEY not configured");
      }

      const response = await axios.post(`${FAUCETPAY_API_URL}/currencies`, {
        api_key: FAUCETPAY_API_KEY
      });

      if (response.data.status !== 200) {
        throw new Error(response.data.message);
      }

      return response.data.currencies_names;
    } catch (error) {
      logger.error("Failed to get currencies", { error: error.message });
      throw error;
    }
  }

  /**
   * Parse FaucetPay error codes to human-readable messages
   */
  static _parseErrorMessage(code) {
    const errors = {
      200: "Success",
      301: "Access denied - API not whitelisted",
      402: "Insufficient funds",
      403: "Invalid API key",
      404: "Invalid API method",
      405: "Invalid payment amount",
      410: "Invalid currency",
      450: "Send limit reached, try again later",
      456: "Address does not belong to any user",
      457: "User has been blacklisted"
    };

    return errors[code] || `Error code: ${code}`;
  }
}

module.exports = FaucetPayService;
