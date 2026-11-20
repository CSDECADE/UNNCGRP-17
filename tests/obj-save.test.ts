import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { saveObjExportFile } from "../src/features/obj-export/save.ts";
import { MAX_OBJ_FILE_BYTES } from "../src/core/obj-file.ts";
import { fileErrorMessage } from "../src/core/feedback.ts";

const require = createRequire(import.meta.url);
const native = require("../desktop/obj-files.cjs");
const json = require("../desktop/files.cjs");
const { publicErrorCode } = require("../desktop/errors.cjs");
const text = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const file = { name: "edited.obj", text, vertices: 3, triangles: 1 };

test("native OBJ saving writes plain text atomically and JSON validation remains independent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aero-obj-save-"));
  try {
    const filename = join(directory, file.name);
    const result = await native.saveObjExport(file, async (options: { filters: { extensions: string[] }[] }) => {
      assert.deepEqual(options.filters[0].extensions, ["obj"]);
      return { canceled: false, filePath: filename };
    });
    assert.deepEqual(result, { name: file.name });
    assert.equal(await readFile(filename, "utf8"), text);
    assert.deepEqual(await readdir(directory), [file.name]);
    assert.throws(() => json.validateText(text), { code: "INVALID_JSON" });
    const large = "#" + "x".repeat(5_000_000) + "\n" + text;
    await native.writeObjFile(filename, large);
    assert.equal(await readFile(filename, "utf8"), large);
    assert.throws(() => json.validateText(JSON.stringify(large)), { code: "TOO_LARGE" });
    await assert.rejects(json.writeTextFile(filename, text), { code: "INVALID_JSON" });
    assert.equal(await readFile(filename, "utf8"), large);
    await json.writeTextFile(join(directory, "project.json"), '{"version":1}');
    assert.equal(await readFile(join(directory, "project.json"), "utf8"), '{"version":1}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("native cancel and invalid extensions never call writer; invalid requests fail before dialog", async () => {
  let writes = 0, dialogs = 0;
  const writer = async () => { writes++; };
  assert.equal(await native.saveObjExport(file, async () => ({ canceled: true }), writer), null);
  await assert.rejects(native.saveObjExport(file, async () => ({ filePath: "/tmp/other.json" }), writer), { code: "OBJ_EXTENSION" });
  for (const request of [{ ...file, name: "../evil.obj" }, { ...file, text: "" }, { ...file, text: "\0" },
    { ...file, text: "x".repeat(MAX_OBJ_FILE_BYTES + 1) }]) {
    await assert.rejects(native.saveObjExport(request, async () => { dialogs++; return {}; }, writer));
  }
  assert.equal(writes, 0); assert.equal(dialogs, 0);
  assert.equal(native.MAX_OBJ_FILE_BYTES, MAX_OBJ_FILE_BYTES);
  assert.equal(native.validateObjText("x".repeat(MAX_OBJ_FILE_BYTES)).length, MAX_OBJ_FILE_BYTES);
  assert.throws(() => native.validateObjText("中".repeat(Math.ceil(MAX_OBJ_FILE_BYTES / 3))), { code: "OBJ_TOO_LARGE" });
});
test("write failure preserves existing destination, removes temporary output and reports a safe reason", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aero-obj-failure-"));
  const fs = require("node:fs/promises"), originalRename = fs.rename;
  try {
    const destination = join(directory, "keep.obj"); await writeFile(destination, "previous file");
    fs.rename = async () => { throw Object.assign(new Error("private/path"), { code: "ENOSPC" }); };
    await assert.rejects(native.writeObjFile(destination, text), { code: "ENOSPC" });
    assert.equal(await readFile(destination, "utf8"), "previous file");
    assert.deepEqual(await readdir(directory), ["keep.obj"]);
    for (const code of ["EACCES", "ENOSPC", "EROFS", "ENOENT"]) {
      await assert.rejects(native.saveObjExport(file, async () => ({ filePath: destination }), async () => {
        throw Object.assign(new Error("private/path"), { code });
      }), { code });
      const message = fileErrorMessage(new Error(`AERO_FILE_${publicErrorCode({ code })}`), "export");
      assert.ok(message.startsWith("导出失败")); assert.ok(!message.includes("private/path"));
    }
    assert.match(fileErrorMessage(new Error("AERO_FILE_OBJ_TOO_LARGE"), "export"), /16 MB/);
  } finally { fs.rename = originalRename; await rm(directory, { recursive: true, force: true }); }
});
test("save adapter handles download, native cancellation, old preload and failures without modifying export snapshot", async () => {
  const before = structuredClone(file), downloads: unknown[][] = [];
  const download = (...args: unknown[]) => { downloads.push(args); };
  assert.equal(await saveObjExportFile(file, { download }), "download-requested");
  assert.deepEqual(downloads, [[text, file.name, "text/plain;charset=utf-8"]]);
  assert.equal(await saveObjExportFile(file, { download, desktop: { saveObjFile: async () => null } }), "cancelled");
  assert.equal(await saveObjExportFile(file, { download, desktop: { saveObjFile: async request => {
    assert.deepEqual(request, { text, name: file.name }); return { name: file.name };
  } } }), "saved");
  await assert.rejects(saveObjExportFile(file, { download, desktop: {} }), /重新启动/);
  await assert.rejects(saveObjExportFile(file, { download, desktop: { saveObjFile: async () => { throw new Error("AERO_FILE_PERMISSION"); } } }), /PERMISSION/);
  assert.equal(downloads.length, 1); assert.deepEqual(file, before);
});
test("preload exposes a dedicated OBJ channel and propagates cancellation and sanitized IPC errors", async () => {
  let bridge: any, response: any = { ok: true, value: null };
  const calls: unknown[][] = [];
  runInNewContext(await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "test" }, require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { bridge = value; } },
      ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return response; } },
    }),
  });
  assert.equal(await bridge.saveObjFile({ name: file.name, text }), null);
  assert.deepEqual(calls[0], ["p15:save-obj", { name: file.name, text }]);
  response = { ok: false, code: "PERMISSION" };
  await assert.rejects(bridge.saveObjFile(file), /AERO_FILE_PERMISSION/);
});
