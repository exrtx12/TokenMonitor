/**
 * Contract every service module must satisfy so background.js and the popup
 * can treat Claude / Gemini / ChatGPT uniformly.
 *
 * A service module exports:
 *   id: string                    unique key, e.g. "claude"
 *   name: string                  display name, e.g. "Claude"
 *   enabled: boolean              whether background.js should poll it
 *   fetchUsage(settings): Promise<UsageResult>
 *   detectAccounts(): Promise<Array<{id, name}>>   (optional, for auto org/account detection)
 *
 * UsageResult shape (all services normalize into this):
 *   {
 *     session: { percent: number, resetsAt: string|null },
 *     weekly:  { percent: number, resetsAt: string|null },
 *     raw: object   // original response, kept for debugging
 *   }
 *
 * Errors thrown by fetchUsage/detectAccounts must be UsageError instances so
 * background.js/popup.js can render the right message without knowing which
 * service produced it.
 */

export class UsageError extends Error {
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
