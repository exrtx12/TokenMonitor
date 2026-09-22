const { UsageError } = require("./base");

const ORIGIN = "https://gemini.google.com";
const RPC_ID = "jSf9Qc"; // the call behind 설정 → 사용량 한도

// Gemini's usage numbers come from a Google "batchexecute" RPC rather than a
// plain REST endpoint, which means two extra steps compared to Claude/ChatGPT:
// an XSRF token has to be scraped out of the page HTML first, and the answer is
// a length-prefixed envelope wrapping a JSON string. See samples/ for a real
// response and tools/probe-gemini.js for how it was found.

// Windows are identified by a kind field, not by position — observed responses
// put weekly first sometimes and the 5-hour window first other times.
const KIND_SESSION = 1; // 5시간
const KIND_WEEKLY = 2; // 7일

async function getXsrfToken(runFetch) {
  const res = await runFetch(`${ORIGIN}/app`);
  if (res.networkError) {
    throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${res.networkError}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "Gemini 로그인이 필요합니다.");
  }
  const match = /"SNlM0e":"([^"]+)"/.exec(res.body || "");
  if (!match) {
    // Signed-out Gemini serves a page without the token, so this is the usual
    // shape of "not logged in" rather than a broken page.
    throw new UsageError("AUTH_ERROR", "Gemini 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
  }
  return match[1];
}

// The body is a )]}' guard followed by alternating length / payload lines.
function parseBatchExecute(text, rpcId) {
  for (const line of String(text).split("\n")) {
    if (!line.startsWith("[[")) continue;
    let rows;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    for (const row of rows) {
      if (Array.isArray(row) && row[0] === "wrb.fr" && row[1] === rpcId && typeof row[2] === "string") {
        try {
          return JSON.parse(row[2]);
        } catch {
          throw new UsageError("SCHEMA_ERROR", "Gemini 응답 내부 JSON을 해석하지 못했습니다.");
        }
      }
    }
  }
  return null;
}

async function callUsageRpc(runFetch, token) {
  const url =
    `${ORIGIN}/_/BardChatUi/data/batchexecute` +
    `?rpcids=${RPC_ID}&source-path=%2Fusage&hl=ko&rt=c`;
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[[RPC_ID, "[]", null, "generic"]]]),
    at: token,
  }).toString();

  const res = await runFetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });

  if (res.networkError) {
    throw new UsageError("NETWORK_ERROR", `네트워크 오류: ${res.networkError}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UsageError("AUTH_ERROR", "Gemini 로그인이 필요합니다.");
  }
  if (!res.ok) {
    throw new UsageError("NETWORK_ERROR", `Gemini 응답 오류 (HTTP ${res.status}).`);
  }

  const payload = parseBatchExecute(res.body, RPC_ID);
  if (!payload) {
    throw new UsageError("SCHEMA_ERROR", "Gemini 응답에서 사용량 데이터를 찾지 못했습니다.");
  }
  return payload;
}

// Entry shape: [remaining, usedFraction, kind, [[resetSeconds, resetNanos]]]
// usedFraction is what the UI shows as a percentage, so it's used as-is rather
// than recomputed from `remaining` — same rule as the other services.
function toBucket(entry) {
  if (!Array.isArray(entry)) return null;
  const usedFraction = entry[1];
  const stamp = entry[3] && entry[3][0];
  if (typeof usedFraction !== "number" || !Number.isFinite(usedFraction)) return null;
  if (!Array.isArray(stamp) || typeof stamp[0] !== "number") return null;

  const millis = stamp[0] * 1000 + Math.round((stamp[1] || 0) / 1e6);
  return { percent: usedFraction * 100, resetsAt: new Date(millis).toISOString() };
}

async function fetchUsage(_settings, runFetch) {
  const token = await getXsrfToken(runFetch);
  const payload = await callUsageRpc(runFetch, token);

  const entries = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  let session = null;
  let weekly = null;
  for (const entry of entries) {
    if (entry && entry[2] === KIND_SESSION) session = toBucket(entry);
    if (entry && entry[2] === KIND_WEEKLY) weekly = toBucket(entry);
  }

  if (!session || !weekly) {
    throw new UsageError(
      "SCHEMA_ERROR",
      "Gemini 응답 형식이 예상과 다릅니다 (5시간/주간 한도를 찾지 못했습니다)."
    );
  }

  return { session, weekly, raw: payload };
}

module.exports = {
  id: "gemini",
  name: "Gemini",
  defaultEnabled: true,
  hasAccountSetting: false,
  homeUrl: `${ORIGIN}/`,
  bootstrapUrl: `${ORIGIN}/robots.txt`,
  loginUrl: `${ORIGIN}/`,
  partition: "persist:gemini-usage-widget",
  fetchUsage,
};
