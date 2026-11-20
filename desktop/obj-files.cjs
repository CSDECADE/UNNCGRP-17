const path = require("node:path");
const { fileError } = require("./errors.cjs");
const { writeAtomicTextFile } = require("./files.cjs");
const MAX_OBJ_FILE_BYTES = 16_000_000;

function validateObjText(text) {
  if (typeof text !== "string" || !text.trim() || text.includes("\0")) throw fileError("OBJ_INVALID");
  if (Buffer.byteLength(text, "utf8") > MAX_OBJ_FILE_BYTES) throw fileError("OBJ_TOO_LARGE");
  return text;
}
async function writeObjFile(filename, text) {
  validateObjText(text);
  if (!/\.obj$/i.test(filename)) throw fileError("OBJ_EXTENSION");
  await writeAtomicTextFile(filename, text);
}
// The dialog is injected so cancellation, validation and write errors can be tested
// without opening an OS dialog. This route never updates the project document path.
async function saveObjExport(request, chooseFile, write = writeObjFile) {
  if (!request || typeof request.name !== "string" || request.name.length > 160 ||
      /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(request.name) || !/^[^.].*\.obj$/i.test(request.name))
    throw fileError("OBJ_INVALID");
  validateObjText(request.text);
  const result = await chooseFile({ title: "导出所选 OBJ", defaultPath: request.name,
    filters: [{ name: "Wavefront OBJ", extensions: ["obj"] }] });
  if (result.canceled || !result.filePath) return null;
  // Do not silently append a suffix after the dialog's overwrite confirmation.
  if (!/\.obj$/i.test(result.filePath)) throw fileError("OBJ_EXTENSION");
  await write(result.filePath, request.text);
  return { name: path.basename(result.filePath) };
}
module.exports = { MAX_OBJ_FILE_BYTES, validateObjText, writeObjFile, saveObjExport };
