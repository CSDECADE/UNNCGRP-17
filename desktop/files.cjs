const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const MAX_BYTES = 5_000_000;
const { fileError } = require("./errors.cjs");

function validateText(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES)
    throw fileError("TOO_LARGE");
  try { JSON.parse(text); } catch { throw fileError("INVALID_JSON"); }
  return text;
}
async function readTextFile(filename) {
  const handle = await fs.open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw fileError("NOT_FILE");
    if (stat.size > MAX_BYTES) throw fileError("TOO_LARGE");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES) throw fileError("TOO_LARGE");
    return validateText(buffer.subarray(0, total).toString("utf8"));
  } finally {
    await handle.close();
  }
}
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
function validatePackage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PACKAGE_BYTES)
    throw fileError("TOO_LARGE");
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04)
    throw fileError("INVALID_PACKAGE");
  return bytes;
}
async function readBinaryFile(filename, limit = MAX_PACKAGE_BYTES) {
  const handle = await fs.open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw fileError("NOT_FILE");
    if (stat.size > limit) throw fileError("TOO_LARGE");
    const buffer = Buffer.alloc(stat.size);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, total);
  } finally {
    await handle.close();
  }
}
async function writeFileAtomic(filename, data) {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function writeTextFile(filename, text) {
  validateText(text);
  await writeFileAtomic(filename, text);
}
function assetPath(root, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "p15:" || parsed.hostname !== "app")
    throw new Error("Invalid asset origin");
  const relative = decodeURIComponent(parsed.pathname);
  if (relative.includes("\0") || relative.includes("\\"))
    throw new Error("Invalid asset path");
  const resolved = path.resolve(
    root,
    "." + (relative === "/" ? "/index.html" : relative),
  );
  if (!resolved.startsWith(path.resolve(root) + path.sep))
    throw new Error("Invalid asset path");
  return resolved;
}
module.exports = {
  readTextFile, writeTextFile, validateText, assetPath,
  readBinaryFile, writeFileAtomic, validatePackage, MAX_PACKAGE_BYTES,
};
