const { app, BrowserWindow, Tray, Menu, session, ipcMain, screen, nativeImage, Notification } = require("electron");
const path = require("path");
const store = require("./store");
const { SERVICES, getService } = require("./services/registry");

const POLL_INTERVAL_MS = 5 * 60 * 1000;
// A page-context renderer costs ~150MB per service, so one is only spun up when
// the cheap main-process fetch won't do, and it's torn down once the poll ends.
// The short grace period keeps it alive across the 2-3 requests of a single poll.
const PAGE_WINDOW_IDLE_MS = 15 * 1000;

let tray = null;
let widgetWindow = null;
const loginWindows = new Map(); // serviceId -> BrowserWindow
const pageWindows = new Map(); // serviceId -> { win, ready, idleTimer }
const fetchModes = new Map(); // serviceId -> "net" | "page"

// Errors that suggest the request itself never got through (missing cookies, a
// bot check, an HTML error page). Anything else means the fetch worked fine and
// falling back to a renderer would only waste memory.
const PAGE_FALLBACK_CODES = new Set(["AUTH_ERROR", "NETWORK_ERROR", "SCHEMA_ERROR", "UNKNOWN_ERROR"]);

// Issues the request straight from the main process on the service's persisted
// session, so its cookies ride along exactly as they would in a tab — but with
// no renderer process to keep alive.
async function runNetFetch(service, url, extraHeaders) {
  const ses = session.fromPartition(service.partition);
  try {
    const res = await ses.fetch(url, {
      credentials: "include",
      headers: Object.assign(
        {
          Accept: "application/json",
          // Match what the site would see from one of its own pages; the session
          // UA is also what any bot-check clearance cookie was issued against.
          "User-Agent": ses.getUserAgent(),
          Referer: service.homeUrl,
          Origin: new URL(service.homeUrl).origin,
        },
        extraHeaders || {}
      ),
    });
    const body = await res.text();
    if (process.env.WIDGET_LOG) console.log("[net]", service.id, url, res.status, res.headers.get("content-type"));
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") || "", body };
  } catch (e) {
    if (process.env.WIDGET_LOG) console.log("[net-error]", service.id, url, String(e));
    return { networkError: String(e) };
  }
}

function createPageWindow(service) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: session.fromPartition(service.partition) },
  });

  const ready = new Promise((resolve) => {
    let retried = false;
    win.on("closed", () => resolve(null));
    win.webContents.on("did-finish-load", () => resolve(win));
    win.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || win.isDestroyed()) return;
      // bootstrapUrl is a guess at something cheap on the same origin; if it
      // isn't there, fall back to the real home page.
      if (retried) return resolve(win);
      retried = true;
      win.loadURL(service.homeUrl);
    });
  });

  if (process.env.WIDGET_LOG) console.log("[page] create", service.id);
  win.loadURL(service.bootstrapUrl || service.homeUrl);
  return { win, ready, idleTimer: null };
}

function getPageWindow(service) {
  let entry = pageWindows.get(service.id);
  if (entry) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  } else {
    entry = createPageWindow(service);
    pageWindows.set(service.id, entry);
  }
  return entry.ready;
}

function destroyPageWindow(service) {
  const entry = pageWindows.get(service.id);
  if (!entry) return;
  if (process.env.WIDGET_LOG) console.log("[page] destroy", service.id);
  clearTimeout(entry.idleTimer);
  pageWindows.delete(service.id);
  if (!entry.win.isDestroyed()) entry.win.destroy();
}

function releasePageWindow(service) {
  const entry = pageWindows.get(service.id);
  if (!entry || entry.idleTimer) return;
  entry.idleTimer = setTimeout(() => destroyPageWindow(service), PAGE_WINDOW_IDLE_MS);
}

// Runs fetch() inside the service's own page context so the request carries the
// same session cookies a normal browser tab would. Only used when runNetFetch
// can't get through, since it needs a live renderer.
async function runPageFetch(service, url, extraHeaders) {
  const win = await getPageWindow(service);
  if (!win || win.isDestroyed()) return { networkError: "페이지 컨텍스트를 열지 못했습니다." };

  const script = `
    (async () => {
      try {
        const r = await fetch(${JSON.stringify(url)}, {
          credentials: "include",
          headers: Object.assign({ Accept: "application/json" }, ${JSON.stringify(extraHeaders || {})}),
        });
        const text = await r.text();
        return { ok: r.ok, status: r.status, contentType: r.headers.get("content-type") || "", body: text };
      } catch (e) {
        return { networkError: String(e) };
      }
    })();
  `;
  try {
    return await win.webContents.executeJavaScript(script);
  } catch (e) {
    return { networkError: String(e) };
  }
}

function runFetch(service, url, extraHeaders) {
  return fetchModes.get(service.id) === "page"
    ? runPageFetch(service, url, extraHeaders)
    : runNetFetch(service, url, extraHeaders);
}

function fetchUsageOnce(service) {
  const settings = store.getSettings(service.id);
  return service.fetchUsage(settings, (url, headers) => runFetch(service, url, headers));
}

// Prefers the renderer-free path and only pays for a page context if the site
// turns out to need one, remembering the answer so later polls don't retry.
async function fetchUsage(service) {
  try {
    return await fetchUsageOnce(service);
  } catch (err) {
    const code = err && err.name === "UsageError" ? err.code : "UNKNOWN_ERROR";
    if (fetchModes.get(service.id) === "page" || !PAGE_FALLBACK_CODES.has(code)) throw err;

    if (process.env.WIDGET_LOG) console.log("[fallback->page]", service.id, code, err.message);
    fetchModes.set(service.id, "page");
    try {
      return await fetchUsageOnce(service);
    } catch (pageErr) {
      // A renderer didn't help, so it was a real error. Go back to the cheap path.
      fetchModes.set(service.id, "net");
      throw pageErr;
    }
  }
}

// Which services are shown is a user setting, so this is read fresh every time
// rather than captured once at startup.
function enabledServices() {
  return SERVICES.filter((s) => store.getServiceEnabled(s.id, s.defaultEnabled === true));
}

const WIDGET_WIDTH = 300;

// Rough guess, used only for the initial window before the renderer has painted
// anything. Once it has, the renderer reports its real height (see
// "content-height") and that wins.
function widgetHeight(services) {
  return 140 + services.reduce((h, s) => h + (s.comingSoon ? 90 : 190), 0);
}

function resizeWidgetTo(height) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = widgetWindow.getBounds();
  const next = Math.max(80, Math.min(height, workArea.height));
  if (next === bounds.height) return;
  widgetWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: next });
}

function createWidgetWindow() {
  const bounds = store.getWindowBounds();
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = WIDGET_WIDTH;
  const height = widgetHeight(enabledServices());

  widgetWindow = new BrowserWindow({
    width,
    height,
    x: bounds?.x ?? workArea.x + workArea.width - width - 20,
    y: bounds?.y ?? workArea.y + workArea.height - height - 20,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    icon: path.join(__dirname, "assets", "tray-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });

  widgetWindow.setAlwaysOnTop(store.getAlwaysOnTop(), "screen-saver");
  widgetWindow.loadFile(path.join(__dirname, "widget", "index.html"));
  if (process.env.WIDGET_DEBUG) widgetWindow.webContents.openDevTools({ mode: "detach" });

  widgetWindow.on("moved", () => {
    const [x, y] = widgetWindow.getPosition();
    store.setWindowBounds({ x, y });
  });

  widgetWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      widgetWindow.hide();
    }
  });
}

function openLoginWindow(service) {
  if (loginWindows.has(service.id)) {
    loginWindows.get(service.id).focus();
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    webPreferences: { session: session.fromPartition(service.partition) },
  });
  win.loadURL(service.loginUrl);
  loginWindows.set(service.id, win);
  win.on("closed", () => {
    loginWindows.delete(service.id);
    // Cookies just changed, so drop any page context built on the old ones and
    // give the cheap path another go.
    destroyPageWindow(service);
    fetchModes.set(service.id, "net");
    pollService(service).then(broadcast);
  });
}

function notifyReset(serviceName, label) {
  new Notification({
    title: `${serviceName} ${label} 한도 리셋`,
    body: `${label} 사용량 한도가 초기화되었습니다.`,
    icon: path.join(__dirname, "assets", "tray-icon.png"),
  }).show();
}

// resets_at is a rolling window that pushes further into the future every
// time usage increases, so a changed value on its own doesn't mean a reset
// happened. It's only a real reset once the previously-promised reset time
// has actually elapsed.
function didWindowReset(prevBucket, currentBucket) {
  if (!prevBucket?.resetsAt || !currentBucket?.resetsAt) return false;
  if (prevBucket.resetsAt === currentBucket.resetsAt) return false;
  return new Date(prevBucket.resetsAt).getTime() <= Date.now();
}

async function pollService(service) {
  // Nothing to fetch yet — don't send a request that can only fail.
  if (service.comingSoon) {
    return store.setState(service.id, {
      status: "coming-soon",
      session: null,
      weekly: null,
      error: null,
      fetchedAt: null,
    });
  }

  const prevState = store.getState(service.id);
  const settings = store.getSettings(service.id);
  store.setState(service.id, { status: "loading" });

  try {
    const result = await fetchUsage(service);

    if (result.resolvedOrgId && result.resolvedOrgId !== settings.orgId) {
      store.setSettings(service.id, {
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

    return store.setState(service.id, {
      status: "ok",
      session: result.session,
      weekly: result.weekly,
      error: null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const isUsageError = err && err.name === "UsageError";
    return store.setState(service.id, {
      status: "error",
      error: {
        code: isUsageError ? err.code : "UNKNOWN_ERROR",
        message: err.message || String(err),
        candidates: isUsageError ? err.candidates : undefined,
      },
      fetchedAt: new Date().toISOString(),
    });
  } finally {
    releasePageWindow(service);
  }
}

async function pollAll() {
  await Promise.all(enabledServices().map(pollService));
  broadcast();
}

function broadcast() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const results = {};
  for (const service of enabledServices()) {
    results[service.id] = { state: store.getState(service.id), settings: store.getSettings(service.id) };
  }
  widgetWindow.webContents.send("state-update", results);
}

// Turning a service on or off changes the card list, so the widget has to be
// told to rebuild and resized to match. Login cookies and saved settings are
// left alone, so switching one back on doesn't mean logging in again.
function applyServiceChange() {
  const services = enabledServices();
  if (process.env.WIDGET_LOG) {
    console.log("[services]", services.map((s) => s.id).join(",") || "(none)");
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    // No resize here: the renderer measures the rebuilt card list and reports back.
    widgetWindow.webContents.send("services-update", describeServices(services));
  }
}

function setServiceEnabled(service, enabled) {
  store.setServiceEnabled(service.id, enabled);
  applyServiceChange();

  if (enabled) {
    pollService(service).then(broadcast);
  } else {
    // Drop anything the service was still holding so a disabled card costs nothing.
    destroyPageWindow(service);
    fetchModes.delete(service.id);
  }
}

function describeServices(services) {
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    hasAccountSetting: s.hasAccountSetting,
    comingSoon: s.comingSoon === true,
  }));
}

function buildTrayMenu() {
  const loginItemSettings = app.getLoginItemSettings();
  const serviceItems = enabledServices()
    .filter((service) => !service.comingSoon)
    .map((service) => ({
      label: `${service.name} 로그인 창 열기`,
      click: () => openLoginWindow(service),
    }));

  const toggleItems = SERVICES.map((service) => ({
    label: service.comingSoon ? `${service.name} (준비 중)` : service.name,
    type: "checkbox",
    checked: store.getServiceEnabled(service.id, service.defaultEnabled === true),
    click: (item) => setServiceEnabled(service, item.checked),
  }));

  const menu = Menu.buildFromTemplate([
    { label: "지금 새로고침", click: () => pollAll() },
    ...serviceItems,
    { type: "separator" },
    { label: "표시할 서비스", submenu: toggleItems },
    {
      label: "위젯 항상 위",
      type: "checkbox",
      checked: store.getAlwaysOnTop(),
      click: (item) => {
        store.setAlwaysOnTop(item.checked);
        widgetWindow.setAlwaysOnTop(item.checked, "screen-saver");
      },
    },
    {
      label: "위젯 표시",
      type: "checkbox",
      checked: widgetWindow ? widgetWindow.isVisible() : true,
      click: (item) => (item.checked ? widgetWindow.show() : widgetWindow.hide()),
    },
    {
      label: "윈도우 시작 시 실행",
      type: "checkbox",
      checked: loginItemSettings.openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  return menu;
}

function toggleWidget() {
  if (widgetWindow.isVisible()) {
    widgetWindow.hide();
  } else {
    widgetWindow.show();
    widgetWindow.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("AI Usage Widget (좌클릭: 표시/숨기기, 우클릭: 메뉴)");
  tray.on("click", () => toggleWidget());
  tray.on("right-click", () => tray.popUpContextMenu(buildTrayMenu()));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (widgetWindow) {
      widgetWindow.show();
      widgetWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWidgetWindow();
    createTray();
    pollAll();
    setInterval(pollAll, POLL_INTERVAL_MS);
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray instead of quitting.
  });

  ipcMain.handle("get-services", () => describeServices(enabledServices()));
  ipcMain.handle("refresh", () => pollAll());
  ipcMain.handle("open-login", (_e, serviceId) => openLoginWindow(getService(serviceId)));
  ipcMain.handle("set-org", async (_e, { serviceId, orgId, orgName }) => {
    store.setSettings(serviceId, { orgId, orgName });
    await pollService(getService(serviceId));
    broadcast();
  });
  ipcMain.handle("reset-org", async (_e, serviceId) => {
    store.setSettings(serviceId, { orgId: null, orgName: null });
    await pollService(getService(serviceId));
    broadcast();
  });
  ipcMain.handle("get-state", () => {
    const results = {};
    for (const service of enabledServices()) {
      results[service.id] = { state: store.getState(service.id), settings: store.getSettings(service.id) };
    }
    return results;
  });
  ipcMain.handle("hide-widget", () => widgetWindow.hide());
  ipcMain.on("content-height", (_e, height) => {
    if (typeof height === "number" && Number.isFinite(height)) resizeWidgetTo(height);
  });
}
