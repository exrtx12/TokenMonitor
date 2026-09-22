import { UsageError } from "./base.js";

const BASE = "https://claude.ai";

function isPercent(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function isIsoStringOrNull(v) {
  return v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));
}

/**
 * Validates the raw /usage payload has the two fields we depend on, in the
 * shape we expect. Anything else (claude.ai changed its response format) is
 * surfaced as SCHEMA_ERROR instead of silently showing wrong numbers.
 */
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

  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "claude.ai 로그인이 필요합니다.");
  }
  // claude.ai redirects unauthenticated requests to the login page (text/html).
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new UsageError(
      "AUTH_ERROR",
      "claude.ai 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요."
    );
  }
  if (!res.ok) {
    throw new UsageError("NETWORK_ERROR", `claude.ai 응답 오류 (HTTP ${res.status}).`);
  }
  return res.json();
}

/**
 * Auto-detects the organization(s) tied to the current claude.ai session.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function detectAccounts() {
  const data = await apiFetch("/api/organizations");
  if (!Array.isArray(data)) {
    throw new UsageError("SCHEMA_ERROR", "/api/organizations 응답 형식이 예상과 다릅니다.");
  }
  return data.map((org) => ({
    id: org.uuid,
    name: org.name || org.uuid,
  }));
}

async function getAccount(settings) {
  if (settings && settings.orgId) {
    return { id: settings.orgId, name: settings.orgName || null };
  }

  const accounts = await detectAccounts();
  if (accounts.length === 0) {
    throw new UsageError("ACCOUNT_NOT_SET", "연결된 claude.ai 조직을 찾지 못했습니다.");
  }
  if (accounts.length > 1) {
    throw new UsageError(
      "MULTI_ACCOUNT",
      "조직이 여러 개입니다. 팝업 설정에서 하나를 선택해 주세요.",
      { candidates: accounts }
    );
  }
  return accounts[0];
}

async function fetchUsage(settings) {
  const account = await getAccount(settings);
  const data = await apiFetch(`/api/organizations/${account.id}/usage`);
  assertUsageShape(data);

  return {
    session: {
      percent: data.five_hour.utilization,
      resetsAt: data.five_hour.resets_at,
    },
    weekly: {
      percent: data.seven_day.utilization,
      resetsAt: data.seven_day.resets_at,
    },
    raw: data,
    resolvedOrgId: account.id,
    resolvedOrgName: account.name,
  };
}

export default {
  id: "claude",
  name: "Claude",
  enabled: true,
  hasAccountSetting: true,
  loginUrl: "https://claude.ai",
  fetchUsage,
  detectAccounts,
};
