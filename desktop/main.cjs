const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
} = require("electron");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const {
  readTextFile,
  writeTextFile,
  validateText,
  assetPath,
} = require("./files.cjs");
const { fileError, publicErrorCode } = require("./errors.cjs");

const { productName, version } = require("../package.json");
app.setName(productName);
if (process.platform === "win32")
  app.setAppUserModelId("edu.unnc.p15.flightstudio");
let initializationError;
let renderer;
try {
  const profile = path.join(app.getPath("appData"), "Aero P15 Team");
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "p15",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
  renderer = path.join(__dirname, app.isPackaged ? "../renderer" : "../dist");
} catch (error) {
  initializationError = error;
}
let win;
let documentPath = null;
let pendingOpen = null;
let fileOperation = false;

function authorize(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== "p15://app/"
  )
    throw new Error("不允许的应用请求");
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      authorize(event);
      return { ok: true, value: await callback(...args) };
    } catch (error) {
      console.error(channel, error);
      return { ok: false, code: publicErrorCode(error) };
    }
  });
}
handle("p15:open", async (kind) => {
  if (!["project", "plan"].includes(kind)) throw new Error("未知文件类型");
  if (fileOperation) return null;
  fileOperation = true;
  try {
    pendingOpen = null;
    const result = await dialog.showOpenDialog(win, {
      title: kind === "project" ? `打开 ${productName} 项目` : "导入方案",
      properties: ["openFile"],
      filters: [{ name: kind === "project" ? `${productName} 项目` : "航拍方案（JSON）", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0];
    const text = await readTextFile(filename);
    const token = randomUUID();
    if (kind === "project") pendingOpen = { token, filename };
    return { text, token };
  } finally {
    fileOperation = false;
  }
});
handle("p15:accept-open", (token) => {
  if (!pendingOpen || pendingOpen.token !== token)
    throw fileError("EXPIRED");
  documentPath = pendingOpen.filename;
  pendingOpen = null;
  app.addRecentDocument(documentPath);
  if (process.platform === "darwin") win.setRepresentedFilename(documentPath);
});
handle("p15:reset-document", () => {
  documentPath = null;
  pendingOpen = null;
  if (process.platform === "darwin") win.setRepresentedFilename("");
});
handle("p15:save", async (request) => {
  if (
    !request ||
    !["project", "export"].includes(request.kind) ||
    typeof request.name !== "string" ||
    request.name.length > 200
  )
    throw new Error("无效的保存请求");
  validateText(request.text);
  if (fileOperation) return null;
  fileOperation = true;
  try {
    let filename =
      request.kind === "project" && !request.saveAs ? documentPath : null;
    if (!filename) {
      const result = await dialog.showSaveDialog(win, {
        title:
          request.kind === "project" ? `保存 ${productName} 项目` : "导出方案",
        defaultPath:
          documentPath && request.kind === "project"
            ? documentPath
            : request.name.replace(/[\\/:*?"<>|]/g, "-"),
        filters: [{ name: request.kind === "project" ? `${productName} 项目` : "场景与方案（JSON）", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      filename = result.filePath;
    }
    await writeTextFile(filename, request.text);
    if (request.kind === "project") {
      documentPath = filename;
      app.addRecentDocument(filename);
      if (process.platform === "darwin") win.setRepresentedFilename(filename);
    }
    return { name: path.basename(filename) };
  } finally {
    fileOperation = false;
  }
});
function command(name) {
  win?.webContents.send("p15:command", name);
}
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: productName,
    icon: path.join(renderer, "brand/flightform.png"),
    backgroundColor: "#1e1e1e",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  documentPath = null;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL("p15://app/");
}
app
  .whenReady()
  .then(() => {
    if (initializationError) throw initializationError;
    nativeTheme.themeSource = "dark";
    app.setAboutPanelOptions({
      applicationName: productName,
      applicationVersion: version,
      iconPath: path.join(renderer, "brand/flightform.png"),
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle("p15", async (request) => {
      try {
        const response = await net.fetch(
          pathToFileURL(assetPath(renderer, request.url)).href,
        );
        const headers = new Headers(response.headers);
        headers.set(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
        );
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        {
          label: "文件",
          submenu: [
            {
              label: "新建项目",
              accelerator: "CmdOrCtrl+N",
              click: () => command("new"),
            },
            {
              label: "打开项目…",
              accelerator: "CmdOrCtrl+O",
              click: () => command("open"),
            },
            { type: "separator" },
            {
              label: "保存",
              accelerator: "CmdOrCtrl+S",
              click: () => command("save"),
            },
            {
              label: "另存为…",
              accelerator: "CmdOrCtrl+Shift+S",
              click: () => command("saveAs"),
            },
            { type: "separator" },
            { role: process.platform === "darwin" ? "close" : "quit" },
          ],
        },
        {
          label: "编辑",
          submenu: [
            {
              label: "撤销",
              accelerator: "CmdOrCtrl+Z",
              click: () => command("undo"),
            },
            {
              label: "重做",
              accelerator: "CmdOrCtrl+Shift+Z",
              click: () => command("redo"),
            },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "视图",
          submenu: [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu", label: "窗口" },
        {
          label: "帮助",
          submenu: [{ label: "操作说明", click: () => command("help") }],
        },
      ]),
    );
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  })
  .catch((error) => {
    console.error("Application startup failed", error);
    dialog.showErrorBox(`无法打开 ${productName}`, "请关闭应用后重试。若仍无法打开，请重新安装应用；已保存的项目文件不受影响。");
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
