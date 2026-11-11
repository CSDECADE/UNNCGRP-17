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
async function writeTextFile(filename, text) {
  validateText(text);
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
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
module.exports = { readTextFile, writeTextFile, validateText, assetPath };
