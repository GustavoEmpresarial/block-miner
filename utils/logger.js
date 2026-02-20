const fs = require("fs");
const path = require("path");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG"
};

// Color codes for console output
const COLORS = {
  ERROR: "\x1b[31m", // Red
  WARN: "\x1b[33m", // Yellow
  INFO: "\x1b[36m", // Cyan
  DEBUG: "\x1b[35m", // Magenta
  RESET: "\x1b[0m"
};

class Logger {
  constructor(module = "App") {
    this.module = module;
    this.logLevel = String(process.env.LOG_LEVEL || "INFO").trim().toUpperCase();
  }

  _levelValue(level) {
    const normalized = String(level || "INFO").trim().toUpperCase();
    switch (normalized) {
      case LOG_LEVELS.ERROR:
        return 40;
      case LOG_LEVELS.WARN:
        return 30;
      case LOG_LEVELS.INFO:
        return 20;
      case LOG_LEVELS.DEBUG:
        return 10;
      default:
        return 20;
    }
  }

  _shouldLog(level) {
    return this._levelValue(level) >= this._levelValue(this.logLevel);
  }

  /**
   * Format log message
   */
  _formatMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const dataStr = Object.keys(data).length > 0 ? ` | ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${level}] [${this.module}] ${message}${dataStr}`;
  }

  /**
   * Write to file
   */
  _writeToFile(level, message, data) {
    const filename = path.join(logsDir, `${level.toLowerCase()}.log`);
    const content = this._formatMessage(level, message, data);
    
    try {
      fs.appendFileSync(filename, content + "\n");
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  }

  /**
   * Write to console
   */
  _writeToConsole(level, message, data) {
    if (!this._shouldLog(level)) {
      return;
    }

    const color = COLORS[level] || COLORS.INFO;
    const reset = COLORS.RESET;
    const content = this._formatMessage(level, message, data);
    
    if (process.env.NODE_ENV === "production") {
      if (level === LOG_LEVELS.ERROR) console.error(content);
      else if (level === LOG_LEVELS.WARN) console.warn(content);
      else console.log(content);
      return;
    }

    console.log(`${color}${content}${reset}`);
  }

  /**
   * Generic log method
   */
  _log(level, message, data = {}) {
    if (!this._shouldLog(level)) {
      return;
    }
    this._writeToConsole(level, message, data);
    this._writeToFile(level, message, data);
  }

  /**
   * Log error
   */
  error(message, data = {}) {
    this._log(LOG_LEVELS.ERROR, message, data);
  }

  /**
   * Log warning
   */
  warn(message, data = {}) {
    this._log(LOG_LEVELS.WARN, message, data);
  }

  /**
   * Log info
   */
  info(message, data = {}) {
    this._log(LOG_LEVELS.INFO, message, data);
  }

  /**
   * Log debug (only in development)
   */
  debug(message, data = {}) {
    this._log(LOG_LEVELS.DEBUG, message, data);
  }

  /**
   * Create a child logger for a specific module
   */
  child(module) {
    return new Logger(`${this.module}:${module}`);
  }
}

// Export singleton instance
module.exports = new Logger("BlockMiner");

// Export class for creating child loggers
module.exports.Logger = Logger;

// Export utility to create logger for specific modules
module.exports.getLogger = (module) => new Logger(module);
