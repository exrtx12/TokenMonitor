import { ENABLED_SERVICES, getService } from "./services/registry.js";
import {
  ALARM_NAME,
  POLL_PERIOD_MINUTES,
  WARNING_THRESHOLD,
  getSettings,
  setSettings,
  getState,
  setState,
} from "./storage.js";

const BADGE_COLOR_NORMAL = "#5b6472";
const BADGE_COLOR_WARNING = "#e0342a";

function updateBadge(state) {
  // Only the primary (first enabled) service drives the toolbar badge for now.
  if (!state || state.status !== "ok" || !state.session) {
    chrome.action.setBadgeText({ text: state && state.status === "error" ? "!" : "" });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_WARNING });
    return;
  }
  const percent = Math.round(state.session.percent);
  chrome.action.setBadgeText({ text: `${percent}%` });
  chrome.action.setBadgeBackgroundColor({
    color: percent >= WARNING_THRESHOLD ? BADGE_COLOR_WARNING : BADGE_COLOR_NORMAL,
  });
}

function notifyReset(serviceName, bucketLabel) {
  chrome.notifications.create(`${serviceName}-${bucketLabel}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `${serviceName} ${bucketLabel} 한도 리셋`,
    message: `${bucketLabel} 사용량 한도가 초기화되었습니다.`,
    priority: 1,
  });
}

// five_hour/seven_day resets_at is a rolling window that claude.ai pushes
// further into the future every time usage increases, so a changed value on
// its own doesn't mean a reset happened. It's only a real reset once the
// previously-promised reset time has actually elapsed.
function didWindowReset(prevBucket, currentBucket) {
  if (!prevBucket?.resetsAt || !currentBucket?.resetsAt) return false;
  if (prevBucket.resetsAt === currentBucket.resetsAt) return false;
  return new Date(prevBucket.resetsAt).getTime() <= Date.now();
}

async function pollService(service) {
  const prevState = await getState(service.id);
  await setState(service.id, { status: "loading" });

  try {
    const settings = await getSettings(service.id);
    const result = await service.fetchUsage(settings);

    // Persist auto-detected org id/name so we don't re-detect on every poll.
    if (result.resolvedOrgId && result.resolvedOrgId !== settings.orgId) {
      await setSettings(service.id, {
        orgId: result.resolvedOrgId,
        orgName: result.resolvedOrgName || settings.orgName || null,
      });
    }

    if (prevState.status === "ok" && didWindowReset(prevState.session, result.session)) {
      notifyReset(service.name, "세션(5시간)");
    }
    if (prevState.status === "ok" && didWindowReset(prevState.weekly, result.weekly)) {
      notifyReset(service.name, "주간(7일)");
    }

    const nextState = await setState(service.id, {
      status: "ok",
      session: result.session,
      weekly: result.weekly,
      error: null,
      fetchedAt: new Date().toISOString(),
    });

    return nextState;
  } catch (err) {
    const isUsageError = err && err.name === "UsageError";
    const nextState = await setState(service.id, {
      status: "error",
      error: {
        code: isUsageError ? err.code : "UNKNOWN_ERROR",
        message: err.message || String(err),
        candidates: isUsageError ? err.candidates : undefined,
      },
      fetchedAt: new Date().toISOString(),
    });
    return nextState;
  }
}

async function pollAll() {
  const results = await Promise.all(ENABLED_SERVICES.map(pollService));
  // Primary service (first enabled) drives the badge.
  updateBadge(results[0]);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  pollAll();
});

chrome.runtime.onStartup.addListener(() => {
  pollAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollAll();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH") {
    pollAll().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  if (message?.type === "SET_ORG") {
    const { serviceId, orgId, orgName } = message;
    setSettings(serviceId, { orgId, orgName })
      .then(() => pollService(getService(serviceId)))
      .then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  if (message?.type === "RESET_ORG") {
    const { serviceId } = message;
    setSettings(serviceId, { orgId: null, orgName: null })
      .then(() => pollService(getService(serviceId)))
      .then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  return false;
});
