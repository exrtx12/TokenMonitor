// One-off investigation tool — NOT part of the shipped app (electron-builder's
// `files` list doesn't include tools/).
//
// Gemini shows a usage meter under 설정 → 사용량 한도, which means some request
// hands the page those numbers. This opens Gemini in the same session partition
// the widget uses, records every response body via the Chrome DevTools Protocol,
// and dumps them so the real endpoint can be identified by hand rather than
// guessed at.
//
// Run from desktop/:  npx electron tools/probe-gemini.js
// (clear ELECTRON_RUN_AS_NODE first, or Electron starts as plain Node)

const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const path = require("path");

const PARTITION = "persist:gemini-usage-widget"; // same one services/gemini.js will use
const OUT_DIR = path.join(__dirname, "out");

// Bodies we'd never learn anything from.
const SKIP_MIME = /^(image|font|video|audio)\/|^text\/css|javascript|^application\/wasm/;
const MAX_BODY = 4 * 1024 * 1024;

const pending = new Map(); // requestId -> { url, method, postData, status, mime }
let seq = 0;
const index = [];

function rpcidOf(url) {
  const m = /rpcids=([^&]+)/.exec(url);
  return m ? m[1] : null;
}

function record(entry, body) {
  let file = null;
  if (body != null) {
    file = String(++seq).padStart(4, "0") + ".txt";
    fs.writeFileSync(path.join(OUT_DIR, file), body);
  }
  index.push({ ...entry, file, bytes: body ? body.length : 0 });

  const tag = entry.rpcid ? `rpc=${entry.rpcid}` : entry.url.slice(0, 80);
  console.log(`[${file || "----"}] ${entry.status} ${tag}${body ? "" : "  (본문 없음)"}`);
}

app.whenReady().then(() => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: { session: session.fromPartition(PARTITION) },
  });

  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  // The first run lost most bodies: Chromium evicts them from its buffer fast,
  // so ask for a much bigger one and read on loadingFinished instead of a timer.
  dbg.sendCommand("Network.enable", {
    maxTotalBufferSize: 256 * 1024 * 1024,
    maxResourceBufferSize: 64 * 1024 * 1024,
  });

  dbg.on("message", async (_event, method, params) => {
    if (method === "Network.requestWillBeSent") {
      pending.set(params.requestId, {
        t: new Date().toISOString(),
        url: params.request.url,
        rpcid: rpcidOf(params.request.url),
        method: params.request.method,
        // batchexecute puts the actual call (rpcid + args) in the POST body, so
        // this is what a replay would have to reproduce.
        postData: params.request.postData || null,
      });
      return;
    }

    if (method === "Network.responseReceived") {
      const e = pending.get(params.requestId);
      if (e) {
        e.status = params.response.status;
        e.mime = params.response.mimeType || "";
      }
      return;
    }

    if (method !== "Network.loadingFinished") return;
    const entry = pending.get(params.requestId);
    pending.delete(params.requestId);
    if (!entry || SKIP_MIME.test(entry.mime || "")) return;

    try {
      const res = await dbg.sendCommand("Network.getResponseBody", {
        requestId: params.requestId,
      });
      const body = res.base64Encoded
        ? Buffer.from(res.body, "base64").toString("utf-8")
        : res.body;
      record(entry, body && body.length <= MAX_BODY ? body : null);
    } catch {
      record(entry, null);
    }
  });

  win.loadURL("https://gemini.google.com/app");

  console.log("\n=== Gemini 사용량 엔드포인트 탐색 (2차) ===");
  console.log("이미 로그인돼 있을 겁니다.");
  console.log("1) 왼쪽 하단 설정 → '사용량 한도'를 여세요.");
  console.log("2) 사용량 숫자가 보이면 F5로 새로고침 후 다시 한 번 여세요.");
  console.log("3) 창을 닫으면 기록이 저장됩니다.\n");

  win.on("closed", () => {
    setTimeout(() => {
      fs.writeFileSync(
        path.join(OUT_DIR, "index.json"),
        JSON.stringify(index, null, 2)
      );
      const withBody = index.filter((e) => e.file).length;
      console.log(`\n저장 완료: ${index.length}건 (본문 ${withBody}건) → ${OUT_DIR}`);
      app.quit();
    }, 1500);
  });
});

app.on("window-all-closed", () => {});
