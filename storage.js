// Shared chrome.storage.local layout used by background.js and popup.js.
//
// storage.settings.<serviceId> = { orgId: string|null, orgName: string|null }
// storage.state.<serviceId>    = {
//   status: 'loading' | 'ok' | 'error',
//   session: { percent, resetsAt } | null,
//   weekly:  { percent, resetsAt } | null,
//   error: { code, message, candidates? } | null,
//   fetchedAt: string|null,
//   orgName: string|null,
// }

export const ALARM_NAME = "usage-poll";
export const POLL_PERIOD_MINUTES = 5;
export const WARNING_THRESHOLD = 80;

async function getAll() {
  const data = await chrome.storage.local.get(["settings", "state"]);
  return {
    settings: data.settings || {},
    state: data.state || {},
  };
}

export async function getSettings(serviceId) {
  const { settings } = await getAll();
  return settings[serviceId] || { orgId: null, orgName: null };
}

export async function setSettings(serviceId, patch) {
  const { settings } = await getAll();
  const next = { ...(settings[serviceId] || {}), ...patch };
  settings[serviceId] = next;
  await chrome.storage.local.set({ settings });
  return next;
}

export async function getState(serviceId) {
  const { state } = await getAll();
  return (
    state[serviceId] || {
      status: "loading",
      session: null,
      weekly: null,
      error: null,
      fetchedAt: null,
      orgName: null,
    }
  );
}

export async function setState(serviceId, patch) {
  const { state } = await getAll();
  const next = { ...(state[serviceId] || {}), ...patch };
  state[serviceId] = next;
  await chrome.storage.local.set({ state });
  return next;
}

export function onStorageChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") callback(changes);
  });
}
