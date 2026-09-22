import { ENABLED_SERVICES } from "../services/registry.js";
import { getSettings, getState, WARNING_THRESHOLD } from "../storage.js";

const servicesEl = document.getElementById("services");
const template = document.getElementById("service-card-template");
const refreshBtn = document.getElementById("refreshBtn");

const cardRefs = new Map(); // serviceId -> { root, elements... }

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
  if (!service.hasAccountSetting) {
    root.querySelector("details.settings").remove();
  }

  const refs = {
    root,
    orgName: root.querySelector(".org-name"),
    errorBanner: root.querySelector(".error-banner"),
    errorMessage: root.querySelector(".error-message"),
    errorActions: root.querySelector(".error-actions"),
    fetchedAt: root.querySelector(".fetched-at"),
    orgIdInput: root.querySelector(".org-id-input"),
    saveOrgBtn: root.querySelector(".save-org-btn"),
    autoDetectBtn: root.querySelector(".auto-detect-btn"),
    bars: {
      session: {
        row: root.querySelector('[data-bucket="session"]'),
        percent: root.querySelector('[data-bucket="session"] .bar-percent'),
        fill: root.querySelector('[data-bucket="session"] .bar-fill'),
        resetTime: root.querySelector('[data-bucket="session"] .reset-time'),
        countdown: root.querySelector('[data-bucket="session"] .countdown'),
        resetsAt: null,
      },
      weekly: {
        row: root.querySelector('[data-bucket="weekly"]'),
        percent: root.querySelector('[data-bucket="weekly"] .bar-percent'),
        fill: root.querySelector('[data-bucket="weekly"] .bar-fill'),
        resetTime: root.querySelector('[data-bucket="weekly"] .reset-time'),
        countdown: root.querySelector('[data-bucket="weekly"] .countdown'),
        resetsAt: null,
      },
    },
  };

  if (service.hasAccountSetting) {
    refs.saveOrgBtn.addEventListener("click", () => {
      const orgId = refs.orgIdInput.value.trim();
      if (!orgId) return;
      chrome.runtime.sendMessage({ type: "SET_ORG", serviceId: service.id, orgId, orgName: null });
    });
    refs.autoDetectBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "RESET_ORG", serviceId: service.id });
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
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({
          type: "SET_ORG",
          serviceId: service.id,
          orgId: candidate.id,
          orgName: candidate.name,
        });
      });
      refs.errorActions.appendChild(btn);
    }
    return;
  }

  if (error.code === "AUTH_ERROR" || error.code === "ACCOUNT_NOT_SET") {
    const btn = document.createElement("button");
    btn.textContent = `${service.name} 열기`;
    btn.addEventListener("click", () => chrome.tabs.create({ url: service.loginUrl }));
    refs.errorActions.appendChild(btn);
    return;
  }

  const retryBtn = document.createElement("button");
  retryBtn.textContent = "다시 시도";
  retryBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "REFRESH" }));
  refs.errorActions.appendChild(retryBtn);
}

async function renderService(service) {
  const refs = cardRefs.get(service.id);
  const [state, settings] = await Promise.all([getState(service.id), getSettings(service.id)]);

  refs.orgName.textContent = settings.orgName || state.orgName || "";
  if (refs.orgIdInput) refs.orgIdInput.value = settings.orgId || "";

  if (state.status === "error" && state.error) {
    refs.errorBanner.hidden = false;
    refs.errorMessage.textContent = ERROR_LABELS[state.error.code] || state.error.message;
    renderErrorActions(refs, service, state.error);
  } else {
    refs.errorBanner.hidden = true;
  }

  renderBucket(refs.bars.session, state.session);
  renderBucket(refs.bars.weekly, state.weekly);

  refs.fetchedAt.textContent = state.fetchedAt
    ? `마지막 갱신: ${formatKst(state.fetchedAt)}`
    : "";
}

async function renderAll() {
  await Promise.all(ENABLED_SERVICES.map(renderService));
}

function tickCountdowns() {
  for (const refs of cardRefs.values()) {
    refs.bars.session.countdown.textContent = formatCountdown(refs.bars.session.resetsAt);
    refs.bars.weekly.countdown.textContent = formatCountdown(refs.bars.weekly.resetsAt);
  }
}

refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  try {
    await chrome.runtime.sendMessage({ type: "REFRESH" });
    await renderAll();
  } finally {
    refreshBtn.classList.remove("spinning");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.state || changes.settings) renderAll();
});

for (const service of ENABLED_SERVICES) buildCard(service);
renderAll();
setInterval(tickCountdowns, 1000);
