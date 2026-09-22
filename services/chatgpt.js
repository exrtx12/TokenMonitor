import { UsageError } from "./base.js";

const BASE = "https://chatgpt.com";

function isPercent(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function isUnixSeconds(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function assertUsageShape(data) {
  const rl = data && data.rate_limit;
  const primary = rl && rl.primary_window;
  const secondary = rl && rl.secondary_window;
  if (
    !primary || !secondary ||
    !isPercent(primary.used_percent) || !isPercent(secondary.used_percent) ||
    !isUnixSeconds(primary.reset_at) || !isUnixSeconds(secondary.reset_at)
  ) {
    throw new UsageError(
      "SCHEMA_ERROR",
      "chatgpt.com 응답 형식이 예상과 다릅니다 (rate_limit.primary_window/secondary_window 없음)."
    );
  }
}

async function getAccessToken() {
  try {
    const res = await fetch(`${BASE}/api/auth/session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.accessToken ? data.accessToken : null;
  } catch {
    return null;
  }
}

async function apiFetch(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${err.message}`);
  }

  // chatgpt.com's backend-api sometimes needs an explicit bearer token even
  // for same-origin requests; retry once with one pulled from the session.
  if (res.status === 401 || res.status === 403) {
    const token = await getAccessToken();
    if (token) {
      try {
        res = await fetch(`${BASE}${path}`, {
          credentials: "include",
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${err.message}`);
      }
    }
  }

  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "chatgpt.com 로그인이 필요합니다.");
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new UsageError(
      "AUTH_ERROR",
      "chatgpt.com 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요."
    );
  }
  if (!res.ok) {
    throw new UsageError("NETWORK_ERROR", `chatgpt.com 응답 오류 (HTTP ${res.status}).`);
  }
  return res.json();
}

async function fetchUsage() {
  const data = await apiFetch("/backend-api/wham/usage");
  assertUsageShape(data);

  const { primary_window: primary, secondary_window: secondary } = data.rate_limit;
  return {
    session: {
      percent: primary.used_percent,
      resetsAt: new Date(primary.reset_at * 1000).toISOString(),
    },
    weekly: {
      percent: secondary.used_percent,
      resetsAt: new Date(secondary.reset_at * 1000).toISOString(),
    },
    raw: data,
  };
}

export default {
  id: "chatgpt",
  name: "ChatGPT",
  enabled: true,
  hasAccountSetting: false,
  loginUrl: "https://chatgpt.com",
  fetchUsage,
};
