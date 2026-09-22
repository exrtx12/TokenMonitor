const claude = require("./claude");
const chatgpt = require("./chatgpt");
const gemini = require("./gemini");

// Every service the app knows about, in the order they appear in the widget and
// the tray menu. Whether each one is actually shown is a user setting now
// (store.getServiceEnabled), so `defaultEnabled` only seeds the first run.
const SERVICES = [claude, chatgpt, gemini];

function getService(id) {
  return SERVICES.find((s) => s.id === id);
}

module.exports = { SERVICES, getService };
