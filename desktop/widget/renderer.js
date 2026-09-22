const WARNING_THRESHOLD = 80;

const servicesEl = document.getElementById("services");
const emptyStateEl = document.getElementById("empty-state");
const rootEl = document.getElementById("root");
const template = document.getElementById("service-card-template");
const refreshAllBtn = document.getElementById("refreshAllBtn");
const hideBtn = document.getElementById("hideBtn");

const cardRefs = new Map(); // serviceId -> refs

const kstFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatKst(isoString) {
  if (!isoString) return "-";
  return `${kstFormatter.format(new Date(isoString))} (KST)`;
}

function formatCountdown(isoString) {
  if (!isoString) return "-";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "리셋됨";
  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}일 ${hours}시간 ${minutes}분 후`;
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초 후`;
  return `${minutes}분 ${seconds}초 후`;
}

const ERROR_LABELS = {
  AUTH_ERROR: "로그인이 필요합니다.",
  SCHEMA_ERROR: "응답 형식이 변경된 것 같습니다.",
  NETWORK_ERROR: "네트워크 오류가 발생했습니다.",
  ACCOUNT_NOT_SET: "연결된 조직을 찾지 못했습니다.",
  MULTI_ACCOUNT: "조직이 여러 개 감지되었습니다. 아래에서 선택해 주세요.",
  UNKNOWN_ERROR: "알 수 없는 오류가 발생했습니다.",
};

function buildCard(service) {
  const fragment = template.content.cloneNode(true);
  const root = fragment.querySelector(".card");
  root.dataset.serviceId = service.id;
  root.querySelector(".service-name").textContent = service.name;

  const settingsBtn = root.querySelector(".settings-btn");
  if (!service.hasAccountSetting) {
    settingsBtn.remove();
    root.querySelector(".settings-panel").remove();
  }

  const refs = {
    root,
    orgName: root.querySelector(".org-name"),
    errorBanner: root.querySelector(".error-banner"),
    errorMessage: root.querySelector(".error-message"),
    errorActions: root.querySelector(".error-actions"),
    fetchedAt: root.querySelector(".fetched-at"),
    settingsPanel: root.querySelector(".settings-panel"),
    orgIdInput: root.querySelector(".org-id-input"),
    bars: {
      session: {
        percent: root.querySelector('[data-bucket="session"] .bar-percent'),
        fill: root.querySelector('[data-bucket="session"] .bar-fill'),
        resetTime: root.querySelector('[data-bucket="session"] .reset-time'),
        countdown: root.querySelector('[data-bucket="session"] .countdown'),
        resetsAt: null,
      },
      weekly: {
        percent: root.querySelector('[data-bucket="weekly"] .bar-percent'),
        fill: root.querySelector('[data-bucket="weekly"] .bar-fill'),
        resetTime: root.querySelector('[data-bucket="weekly"] .reset-time'),
        countdown: root.querySelector('[data-bucket="weekly"] .countdown'),
        resetsAt: null,
      },
    },
  };

  // Nothing to poll for this one yet, so the card shows a notice in place of
  // bars that would only ever read "-". refs.bars is cleared too, so the
  // countdown tick skips this card instead of poking at removed nodes.
  if (service.comingSoon) {
    root.querySelector(".coming-soon").hidden = false;
    root.querySelector(".bars").remove();
    root.querySelector(".fetched-at").remove();
    refs.bars = null;
  }

  if (service.hasAccountSetting) {
    settingsBtn.addEventListener("click", () => {
      refs.orgIdInput.value = refs.lastOrgId || "";
      refs.settingsPanel.classList.add("open");
    });
    root.querySelector(".close-settings").addEventListener("click", () => {
      refs.settingsPanel.classList.remove("open");
    });
    root.querySelector(".save-org-btn").addEventListener("click", () => {
      const orgId = refs.orgIdInput.value.trim();
      if (!orgId) return;
      window.api.setOrg(service.id, orgId, null);
      refs.settingsPanel.classList.remove("open");
    });
    root.querySelector(".auto-detect-btn").addEventListener("click", () => {
      window.api.resetOrg(service.id);
      refs.settingsPanel.classList.remove("open");
    });
  }

  servicesEl.appendChild(fragment);
  cardRefs.set(service.id, refs);
}

function renderBucket(bucket, data) {
  if (!data) {
    bucket.percent.textContent = "-";
    bucket.fill.style.width = "0%";
    bucket.resetTime.textContent = "-";
    bucket.countdown.textContent = "-";
    bucket.resetsAt = null;
    return;
  }
  const percent = Math.round(data.percent);
  bucket.percent.textContent = `${percent}%`;
  bucket.fill.style.width = `${Math.min(100, percent)}%`;
  bucket.fill.classList.toggle("warning", percent >= WARNING_THRESHOLD);
  bucket.resetTime.textContent = formatKst(data.resetsAt);
  bucket.resetsAt = data.resetsAt;
  bucket.countdown.textContent = formatCountdown(data.resetsAt);
}

function renderErrorActions(refs, service, error) {
  refs.errorActions.innerHTML = "";

  if (error.code === "MULTI_ACCOUNT" && Array.isArray(error.candidates)) {
    for (const candidate of error.candidates) {
      const btn = document.createElement("button");
      btn.textContent = candidate.name;
      btn.addEventListener("click", () => window.api.setOrg(service.id, candidate.id, candidate.name));
      refs.errorActions.appendChild(btn);
    }
    return;
  }

  if (error.code === "AUTH_ERROR" || error.code === "ACCOUNT_NOT_SET") {
    const btn = document.createElement("button");
    btn.textContent = "로그인 창 열기";
    btn.addEventListener("click", () => window.api.openLogin(service.id));
    refs.errorActions.appendChild(btn);
    return;
  }

  const retryBtn = document.createElement("button");
  retryBtn.textContent = "다시 시도";
  retryBtn.addEventListener("click", () => window.api.refresh());
  refs.errorActions.appendChild(retryBtn);
}

function renderService(service, { state, settings }) {
  const refs = cardRefs.get(service.id);
  if (service.comingSoon) return;

  refs.orgName.textContent = (settings && settings.orgName) || "";
  refs.lastOrgId = settings && settings.orgId;

  if (state.status === "error" && state.error) {
    refs.errorBanner.hidden = false;
    refs.errorMessage.textContent = ERROR_LABELS[state.error.code] || state.error.message;
    renderErrorActions(refs, service, state.error);
  } else {
    refs.errorBanner.hidden = true;
  }

  renderBucket(refs.bars.session, state.session);
  renderBucket(refs.bars.weekly, state.weekly);

  refs.fetchedAt.textContent = state.fetchedAt ? `마지막 갱신: ${formatKst(state.fetchedAt)}` : "";
}

let services = [];

function renderAll(results) {
  for (const service of services) {
    if (results[service.id]) renderService(service, results[service.id]);
  }
}

// The enabled set can change at any time from the tray menu, so the card list is
// rebuilt from scratch rather than patched.
function rebuildCards(next) {
  services = next;
  servicesEl.innerHTML = "";
  cardRefs.clear();
  emptyStateEl.hidden = services.length > 0;
  for (const service of services) buildCard(service);
  window.api.getState().then(renderAll);
}

function tickCountdowns() {
  for (const refs of cardRefs.values()) {
    if (!refs.bars) continue;
    refs.bars.session.countdown.textContent = formatCountdown(refs.bars.session.resetsAt);
    refs.bars.weekly.countdown.textContent = formatCountdown(refs.bars.weekly.resetsAt);
  }
}

refreshAllBtn.addEventListener("click", async () => {
  refreshAllBtn.classList.add("spinning");
  try {
    await window.api.refresh();
  } finally {
    refreshAllBtn.classList.remove("spinning");
  }
});
hideBtn.addEventListener("click", () => window.api.hideWidget());

// The window is frameless and transparent, so any slack below the cards is an
// invisible rectangle that still swallows desktop clicks. Rather than guessing
// a height per card, report what the content actually measures — this also
// covers error banners appearing and disappearing.
let lastReportedHeight = 0;

function reportHeight() {
  const height = Math.ceil(rootEl.getBoundingClientRect().height);
  if (height > 0 && height !== lastReportedHeight) {
    lastReportedHeight = height;
    window.api.reportHeight(height);
  }
}

new ResizeObserver(reportHeight).observe(rootEl);

window.api.onUpdate(renderAll);
window.api.onServicesUpdate(rebuildCards);
window.api.getServices().then(rebuildCards);

let countdownTimer = null;

function startCountdowns() {
  if (countdownTimer === null) countdownTimer = setInterval(tickCountdowns, 1000);
}

function stopCountdowns() {
  clearInterval(countdownTimer);
  countdownTimer = null;
}

// The widget sits hidden in the tray most of the time, and a per-second redraw
// nobody can see keeps this renderer awake for no reason.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCountdowns();
    return;
  }
  tickCountdowns();
  startCountdowns();
});

if (!document.hidden) startCountdowns();
