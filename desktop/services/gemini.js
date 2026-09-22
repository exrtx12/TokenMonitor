const { UsageError } = require("./base");

// Placeholder slot. Claude and ChatGPT both expose an endpoint that hands back a
// usage percentage their own UI renders; no equivalent has been identified for
// Gemini, and guessing a URL would produce numbers we can't trust. So the
// service is registered (off by default) and renders a "준비 중" card instead,
// which keeps the wiring in place for the day an endpoint is confirmed.
//
// To finish this: capture the real request URL and a response JSON sample, drop
// them in samples/, then implement fetchUsage below and remove `comingSoon`.
async function fetchUsage() {
  throw new UsageError("NOT_IMPLEMENTED", "Gemini 사용량 조회는 아직 구현되지 않았습니다.");
}

module.exports = {
  id: "gemini",
  name: "Gemini",
  defaultEnabled: false,
  comingSoon: true,
  hasAccountSetting: false,
  homeUrl: "https://gemini.google.com/",
  bootstrapUrl: "https://gemini.google.com/robots.txt",
  loginUrl: "https://gemini.google.com/",
  partition: "persist:gemini-usage-widget",
  fetchUsage,
};
