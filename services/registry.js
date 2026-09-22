import claude from "./claude.js";
import gemini from "./gemini.js";
import chatgpt from "./chatgpt.js";

// Add a new service here once it implements the contract in base.js.
export const SERVICES = [claude, gemini, chatgpt];

export const ENABLED_SERVICES = SERVICES.filter((s) => s.enabled);

export function getService(id) {
  return SERVICES.find((s) => s.id === id);
}
