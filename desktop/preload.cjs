const { contextBridge, ipcRenderer } = require("electron");
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(`AERO_FILE_${result.code}`);
  return result.value;
}
contextBridge.exposeInMainWorld("p15Desktop", {
  platform: process.platform,
  openFile: (kind) => invoke("p15:open", kind),
  acceptOpen: (token) => invoke("p15:accept-open", token),
  saveFile: (request) => invoke("p15:save", request),
  resetDocument: () => invoke("p15:reset-document"),
  openProject: () => invoke("p15:open-project"),
  openRecent: (id) => invoke("p15:open-recent", id),
  acceptProject: (token, name) => invoke("p15:accept-project", token, name),
  savePackage: (request) => invoke("p15:save-package", request),
  recentProjects: () => invoke("p15:recent-list"),
  removeRecent: (id) => invoke("p15:recent-remove", id),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("p15:command", listener);
    return () => ipcRenderer.removeListener("p15:command", listener);
  },
});
