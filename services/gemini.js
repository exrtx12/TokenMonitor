// Placeholder for a future Gemini usage service. Follows the same contract
// as claude.js (see base.js) so registry.js and background.js can pick it up
// once fetchUsage/detectAccounts are implemented.
export default {
  id: "gemini",
  name: "Gemini",
  enabled: false,
  async fetchUsage() {
    throw new Error("Gemini service not implemented yet.");
  },
  async detectAccounts() {
    return [];
  },
};
