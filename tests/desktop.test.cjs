const { tmpdir } = require("node:os");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { publicErrorCode } = require("../desktop/errors.cjs");
const {
  readTextFile,
  writeTextFile,
  validateText,
  assetPath,
} = require("../desktop/files.cjs");
test("原生文件错误只返回固定分类，不返回文件内容或路径", async () => {
  assert.equal(publicErrorCode(Object.assign(new Error("/private/file"), { code: "EACCES" })), "PERMISSION");
  assert.equal(publicErrorCode(Object.assign(new Error("internal detail"), { code: "unexpected" })), "UNKNOWN");
  assert.throws(() => validateText('{"private": broken}'), error => error.code === "INVALID_JSON" && !error.message.includes("private"));
  const dir = await fs.mkdtemp(path.join(tmpdir(), "directory-input-"));
  try { await assert.rejects(readTextFile(dir), error => publicErrorCode(error) === "NOT_FILE"); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test("桌面桥保留正常和取消结果，将错误分类传给界面", async () => {
  let api;
  let response = { ok: true, value: null };
  vm.runInNewContext(readFileSync(path.join(__dirname, "../desktop/preload.cjs"), "utf8"), {
    process: { platform: "darwin" },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: async () => response },
    }),
  });
  assert.equal(await api.openFile("project"), null);
  response = { ok: true, value: { name: "Project.p15.json" } };
  assert.deepEqual(await api.saveFile({}), response.value);
  response = { ok: false, code: "PERMISSION" };
  await assert.rejects(api.openFile("project"), { message: "AERO_FILE_PERMISSION" });
});
test("原生文件保存可重开；无效内容不得覆盖已有文件", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "desktop-files-"));
  try {
    const file = path.join(dir, "场景.p15.json");
    await writeTextFile(file, '{"version":1}');
    assert.equal(await readTextFile(file), '{"version":1}');
    await assert.rejects(writeTextFile(file, "broken"));
    assert.equal(await readTextFile(file), '{"version":1}');
    await writeTextFile(file, '{"version":2}');
    assert.equal(await readTextFile(file), '{"version":2}');
    assert.deepEqual(await fs.readdir(dir), ["场景.p15.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("原生导入和导出按 UTF-8 字节限制大小", async () => {
  assert.throws(
    () => validateText(JSON.stringify("楼".repeat(1_700_000))),
    /5 MB/,
  );
  const dir = await fs.mkdtemp(path.join(tmpdir(), "desktop-size-"));
  try {
    const file = path.join(dir, "oversize.json");
    await fs.writeFile(file, " ".repeat(5_000_001));
    await assert.rejects(readTextFile(file), /5 MB/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("应用资源协议限定安装目录，拒绝外部来源和编码目录穿越", () => {
  const assets = path.resolve(__dirname, "../dist");
  assert.equal(
    assetPath(assets, "p15://app/"),
    path.join(assets, "index.html"),
  );
  assert.equal(
    assetPath(assets, "p15://app/models/building.glb"),
    path.join(assets, "models/building.glb"),
  );
  for (const url of [
    "https://app/index.html",
    "p15://other/index.html",
    "p15://app/..%2fsecret",
    "p15://app/%5csecret",
    "p15://app/%00",
  ])
    assert.throws(() => assetPath(assets, url));
});
