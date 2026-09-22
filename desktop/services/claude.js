const { UsageError } = require("./base");

function isPercent(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function isIsoStringOrNull(v) {
  return v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));
}

function assertUsageShape(data) {
  const fh = data && data.five_hour;
  const sd = data && data.seven_day;
  if (!fh || !sd || !isPercent(fh.utilization) || !isPercent(sd.utilization) ||
      !isIsoStringOrNull(fh.resets_at) || !isIsoStringOrNull(sd.resets_at)) {
    throw new UsageError(
      "SCHEMA_ERROR",
      "claude.ai 응답 형식이 예상과 다릅니다 (five_hour/seven_day.utilization/resets_at 없음)."
    );
  }
}

/**
 * @param {(url: string) => Promise<{ok:boolean, status:number, contentType:string, body:string, networkError?:string}>} runFetch
 *   Executes fetch inside a live claude.ai page context (see main.js), so
 *   the browser's own session cookies are sent automatically.
 */
async function apiFetch(runFetch, path) {
  const res = await runFetch(`https://claude.ai${path}`);

  if (res.networkError) {
    throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${res.networkError}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "claude.ai 로그인이 필요합니다.");
  }
  if (!res.contentType.includes("application/json")) {
    throw new UsageError(
      "AUTH_ERROR",
      "claude.ai 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요."
    );
  }
  if (!res.ok) {
    throw new UsageError("NETWORK_ERROR", `claude.ai 응답 오류 (HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new UsageError("SCHEMA_ERROR", "claude.ai 응답을 JSON으로 해석하지 못했습니다.");
  }
}

async function detectAccounts(runFetch) {
  const data = await apiFetch(runFetch, "/api/organizations");
  if (!Array.isArray(data)) {
    throw new UsageError("SCHEMA_ERROR", "/api/organizations 응답 형식이 예상과 다릅니다.");
  }
  return data.map((org) => ({ id: org.uuid, name: org.name || org.uuid }));
}

async function getAccount(settings, runFetch) {
  if (settings && settings.orgId) {
    return { id: settings.orgId, name: settings.orgName || null };
  }

  const accounts = await detectAccounts(runFetch);
  if (accounts.length === 0) {
    throw new UsageError("ACCOUNT_NOT_SET", "연결된 claude.ai 조직을 찾지 못했습니다.");
  }
  if (accounts.length > 1) {
    throw new UsageError(
      "MULTI_ACCOUNT",
      "조직이 여러 개입니다. 설정에서 하나를 선택해 주세요.",
      { candidates: accounts }
    );
  }
  return accounts[0];
}

async function fetchUsage(settings, runFetch) {
  const account = await getAccount(settings, runFetch);
  const data = await apiFetch(runFetch, `/api/organizations/${account.id}/usage`);
  assertUsageShape(data);

  return {
    session: { percent: data.five_hour.utilization, resetsAt: data.five_hour.resets_at },
    weekly: { percent: data.seven_day.utilization, resetsAt: data.seven_day.resets_at },
    raw: data,
    resolvedOrgId: account.id,
    resolvedOrgName: account.name,
  };
}

module.exports = {
  id: "claude",
  name: "Claude",
  defaultEnabled: true,
  hasAccountSetting: true,
  homeUrl: "https://claude.ai/",
  // Only used as a same-origin host for the fallback page fetch, so it points at
  // the cheapest document on the site rather than the full app.
  bootstrapUrl: "https://claude.ai/robots.txt",
  loginUrl: "https://claude.ai/login",
  partition: "persist:claude-usage-widget",
  fetchUsage,
  detectAccounts,
};
