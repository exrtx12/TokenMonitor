const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onUpdate: (callback) => {
    ipcRenderer.on("state-update", (_event, results) => callback(results));
  },
  onServicesUpdate: (callback) => {
    ipcRenderer.on("services-update", (_event, services) => callback(services));
  },
  getServices: () => ipcRenderer.invoke("get-services"),
  getState: () => ipcRenderer.invoke("get-state"),
  refresh: () => ipcRenderer.invoke("refresh"),
  openLogin: (serviceId) => ipcRenderer.invoke("open-login", serviceId),
  setOrg: (serviceId, orgId, orgName) => ipcRenderer.invoke("set-org", { serviceId, orgId, orgName }),
  resetOrg: (serviceId) => ipcRenderer.invoke("reset-org", serviceId),
  hideWidget: () => ipcRenderer.invoke("hide-widget"),
  reportHeight: (height) => ipcRenderer.send("content-height", height),
});
