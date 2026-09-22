const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Only the main process touches this file, so the parsed copy can be kept in
// memory instead of re-reading and re-parsing it on every getter.
let cache = null;

function filePath() {
  return path.join(app.getPath("userData"), "store.json");
}

function readAll() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), "utf-8"));
  } catch {
    cache = { settings: {}, state: {}, windowBounds: null, alwaysOnTop: true };
  }
  return cache;
}

function writeAll(data) {
  cache = data;
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2));
}

module.exports = {
  getSettings(serviceId) {
    return readAll().settings[serviceId] || { orgId: null, orgName: null };
  },
  setSettings(serviceId, patch) {
    const data = readAll();
    data.settings = data.settings || {};
    data.settings[serviceId] = { ...(data.settings[serviceId] || {}), ...patch };
    writeAll(data);
    return data.settings[serviceId];
  },
  getState(serviceId) {
    return (
      readAll().state[serviceId] || {
        status: "loading",
        session: null,
        weekly: null,
        error: null,
        fetchedAt: null,
      }
    );
  },
  setState(serviceId, patch) {
    const data = readAll();
    data.state = data.state || {};
    data.state[serviceId] = { ...(data.state[serviceId] || {}), ...patch };
    writeAll(data);
    return data.state[serviceId];
  },
  getWindowBounds() {
    return readAll().windowBounds || null;
  },
  setWindowBounds(bounds) {
    const data = readAll();
    data.windowBounds = bounds;
    writeAll(data);
  },
  getServiceEnabled(serviceId, fallback) {
    const flags = readAll().enabledServices || {};
    return typeof flags[serviceId] === "boolean" ? flags[serviceId] : fallback;
  },
  setServiceEnabled(serviceId, value) {
    const data = readAll();
    data.enabledServices = data.enabledServices || {};
    data.enabledServices[serviceId] = value;
    writeAll(data);
  },
  getAlwaysOnTop() {
    const data = readAll();
    return data.alwaysOnTop !== false;
  },
  setAlwaysOnTop(value) {
    const data = readAll();
    data.alwaysOnTop = value;
    writeAll(data);
  },
};
