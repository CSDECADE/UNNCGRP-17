// Minimal ZIP (PKWARE APPNOTE 6.3) reader/writer: stored + deflate, UTF-8 names, no ZIP64.
// Uses only Web APIs available in browsers, Electron and Node 22 (CompressionStream).
import { ProjectValidationError } from "../feedback.ts";

export type ZipEntry = { name: string; data: Uint8Array };
export type ZipLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pump(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream,
  limit = Infinity,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const writing = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => {});
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ProjectValidationError("压缩内容超出声明大小");
    }
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Write entries in order. `store` lists names kept uncompressed (e.g. `mimetype`, already-compressed images). */
export async function writeZip(entries: ZipEntry[], options: { store?: (name: string) => boolean; date?: Date } = {}): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(options.date ?? new Date());
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const stored = options.store?.(entry.name) ?? false;
    let body = stored ? entry.data : await pump(entry.data, new CompressionStream("deflate-raw"));
    let method = stored ? 0 : 8;
    if (!stored && body.byteLength >= entry.data.byteLength) {
      body = entry.data;
      method = 0;
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.byteLength, true);
    local.setUint32(22, entry.data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.byteLength, true);
    dir.setUint32(24, entry.data.byteLength, true);
    dir.setUint16(28, name.byteLength, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const centralSize = central.reduce((n, part) => n + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, part) => n + part.byteLength, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

const bad = (reason = "项目包结构损坏"): never => {
  throw new ProjectValidationError(reason);
};

/** Read and verify every entry (CRC and sizes). Rejects duplicates, ZIP64, encryption and oversize content. */
export async function readZip(bytes: Uint8Array, limits: ZipLimits): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad("文件不是有效的项目包");
  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count > limits.maxEntries) bad("项目包内文件过多");
  if (count === 0xffff || dirOffset === 0xffffffff || dirOffset + dirSize > eocd) bad();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) bad();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (flags & 0x1) bad("不支持加密的项目包");
    if (method !== 0 && method !== 8) bad("项目包使用了不支持的压缩方式");
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    } catch {
      return bad("项目包内文件名无效");
    }
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (files.has(name)) bad("项目包内文件重复");
    if (size > limits.maxEntryBytes || (total += size) > limits.maxTotalBytes) bad("项目包内容超出支持范围");
    if (localOffset + 30 > dirOffset || view.getUint32(localOffset, true) !== 0x04034b50) bad();
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressed > dirOffset) bad();
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else {
      try {
        data = await pump(raw, new DecompressionStream("deflate-raw"), size);
      } catch {
        return bad();
      }
    }
    if (data.byteLength !== size || crc32(data) !== crc) bad("项目包内容校验失败");
    files.set(name, data);
  }
  return files;
}
