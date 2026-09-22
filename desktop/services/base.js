// Same contract as the browser extension's services/base.js — kept in sync
// by hand since this app runs in Node/Electron, not a service worker.
class UsageError extends Error {
  /**
   * @param {string} code one of AUTH_ERROR | SCHEMA_ERROR | NETWORK_ERROR | ACCOUNT_NOT_SET | MULTI_ACCOUNT
   * @param {string} message
   * @param {object} [extra] extra data, e.g. { candidates } for MULTI_ACCOUNT
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "UsageError";
    this.code = code;
    Object.assign(this, extra);
  }
}

module.exports = { UsageError };
