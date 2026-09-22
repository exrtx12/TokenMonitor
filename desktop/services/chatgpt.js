const { UsageError } = require("./base");

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

/**
 * @param {(url: string) => Promise<{ok:boolean, status:number, contentType:string, body:string, networkError?:string}>} runFetch
 */
async function apiFetch(runFetch, path, extraHeaders) {
  const res = await runFetch(`${BASE}${path}`, extraHeaders);
  if (res.networkError) {
    throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${res.networkError}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "chatgpt.com 로그인이 필요합니다.");
  }
  if (!res.contentType.includes("application/json")) {
    throw new UsageError(
      "AUTH_ERROR",
      "chatgpt.com 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요."
    );
  }
  if (!res.ok) {
    throw new UsageError("NETWORK_ERROR", `chatgpt.com 응답 오류 (HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new UsageError("SCHEMA_ERROR", "chatgpt.com 응답을 JSON으로 해석하지 못했습니다.");
  }
}

async function getAccessToken(runFetch) {
  const res = await runFetch(`${BASE}/api/auth/session`);
  if (!res.ok || !res.contentType.includes("application/json")) return null;
  try {
    const data = JSON.parse(res.body);
    return data && data.accessToken ? data.accessToken : null;
  } catch {
    return null;
  }
}

async function fetchUsage(_settings, runFetch) {
  let data;
  try {
    data = await apiFetch(runFetch, "/backend-api/wham/usage");
  } catch (err) {
    if (err.code !== "AUTH_ERROR") throw err;
    const token = await getAccessToken(runFetch);
    if (!token) throw err;
    data = await apiFetch(runFetch, "/backend-api/wham/usage", { Authorization: `Bearer ${token}` });
  }
  assertUsageShape(data);

  const { primary_window: primary, secondary_window: secondary } = data.rate_limit;
  return {
    session: { percent: primary.used_percent, resetsAt: new Date(primary.reset_at * 1000).toISOString() },
    weekly: { percent: secondary.used_percent, resetsAt: new Date(secondary.reset_at * 1000).toISOString() },
    raw: data,
  };
}

module.exports = {
  id: "chatgpt",
  name: "ChatGPT",
  defaultEnabled: true,
  hasAccountSetting: false,
  homeUrl: "https://chatgpt.com/",
  bootstrapUrl: "https://chatgpt.com/robots.txt",
  loginUrl: "https://chatgpt.com/",
  partition: "persist:chatgpt-usage-widget",
  fetchUsage,
};
