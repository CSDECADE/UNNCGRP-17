// .aeproj — the portable Aero project package.
//
// A ZIP container (see docs/aeproj.md) holding everything a session needs on another client:
//   mimetype            "application/vnd.aero.project+zip", stored, first entry
//   manifest.json       format version, generator, timestamps, SHA-256 of every other file
//   project.json        current scene (Project, version 1)
//   history.json        undo/redo timeline, up to HISTORY_LIMIT entries on each side
//   checkpoints.json    named snapshots, unlimited
//   assets/<sha256>.<ext>  binary assets referenced by any state (background images), deduplicated
// Inside the package, scene background images reference `assets/...` instead of embedding data URLs.
import { validateProject } from "../project.ts";
import { ProjectValidationError } from "../feedback.ts";
import { HISTORY_LIMIT, type Checkpoint, type History, type HistoryEntry, type Session } from "../history.ts";
import type { Project } from "../types.ts";
import { readZip, writeZip } from "./zip.ts";

export const AEPROJ_EXTENSION = "aeproj";
export const AEPROJ_MIME = "application/vnd.aero.project+zip";
export const AEPROJ_FORMAT = "aeproj";
export const AEPROJ_FORMAT_VERSION = 1;
export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_CHECKPOINTS = 10_000;
const LIMITS = { maxEntries: 20_000, maxEntryBytes: 256 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };

export type Manifest = {
  format: typeof AEPROJ_FORMAT;
  formatVersion: typeof AEPROJ_FORMAT_VERSION;
  generator: { name: string; version: string };
  name: string;
  createdAt: string;
  savedAt: string;
  projectVersion: 1;
  history: { limit: number; past: number; future: number };
  checkpoints: number;
  files: Record<string, { sha256: string; bytes: number }>;
};
export type PackageInfo = Pick<Manifest, "name" | "createdAt" | "savedAt" | "generator">;

const fail = (message: string): never => {
  throw new ProjectValidationError(message);
};
const encoder = new TextEncoder();
const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Collects assets while serializing, deduplicated by content hash. */
class AssetWriter {
  files = new Map<string, Uint8Array>();
  private byDataUrl = new Map<string, string>();
  async ref(dataUrl: string): Promise<string> {
    const known = this.byDataUrl.get(dataUrl);
    if (known) return known;
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s.exec(dataUrl) ?? fail("背景图片格式不受支持");
    const bytes = base64ToBytes(match[2]);
    const path = `assets/${await sha256(bytes)}.${MIME_EXT[match[1]]}`;
    this.files.set(path, bytes);
    this.byDataUrl.set(dataUrl, path);
    return path;
  }
  async project(p: Project): Promise<unknown> {
    if (!p.background?.image) return p;
    const { dataUrl, ...image } = p.background.image;
    return { ...p, background: { ...p.background, image: { ...image, asset: await this.ref(dataUrl) } } };
  }
}

function record(x: unknown, what: string): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : fail(`${what}格式无效`);
}
function text(x: unknown, what: string): string {
  return typeof x === "string" && x.trim() && x.length <= 160 ? x : fail(`${what}无效`);
}
function time(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fail("时间信息无效");
}

/** Resolves `assets/...` references back to data URLs, then applies full project validation. */
class AssetReader {
  private cache = new Map<string, string>();
  private files: Map<string, Uint8Array>;
  constructor(files: Map<string, Uint8Array>) {
    this.files = files;
  }
  private dataUrl(path: unknown): string {
    if (typeof path !== "string") return fail("资源引用无效");
    const cached = this.cache.get(path);
    if (cached) return cached;
    const match = /^assets\/[0-9a-f]{64}\.(png|jpg|webp)$/.exec(path) ?? fail("资源引用无效");
    const bytes = this.files.get(path) ?? fail("项目包缺少引用的资源");
    const url = `data:${EXT_MIME[match[1]]};base64,${bytesToBase64(bytes)}`;
    this.cache.set(path, url);
    return url;
  }
  project(input: unknown): Project {
    const p = record(input, "场景");
    const background = p.background === undefined ? undefined : record(p.background, "背景设置");
    if (background?.image !== undefined) {
      const { asset, ...image } = record(background.image, "背景图片");
      return validateProject({ ...p, background: { ...background, image: { ...image, dataUrl: this.dataUrl(asset) } } });
    }
    return validateProject(p);
  }
  entry(input: unknown): HistoryEntry {
    const e = record(input, "历史记录");
    return { label: text(e.label, "历史记录名称"), at: time(e.at), project: this.project(e.project) };
  }
}

const json = (value: unknown) => encoder.encode(JSON.stringify(value));
const parse = (bytes: Uint8Array | undefined, name: string): unknown => {
  if (!bytes) return fail(`项目包缺少 ${name}`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail(`${name} 内容无法识别`);
  }
};

export async function packSession(
  session: Session,
  options: { generator: { name: string; version: string }; createdAt?: string; now?: Date },
): Promise<Uint8Array> {
  const now = options.now ?? new Date();
  const assets = new AssetWriter();
  const { history, checkpoints } = session;
  const serializeEntry = async (e: HistoryEntry) => ({ label: e.label, at: e.at, project: await assets.project(e.project) });
  const files = new Map<string, Uint8Array>();
  files.set("project.json", json(await assets.project(history.present.project)));
  files.set(
    "history.json",
    json({
      limit: HISTORY_LIMIT,
      present: { label: history.present.label, at: history.present.at },
      past: await Promise.all(history.past.map(serializeEntry)),
      future: await Promise.all(history.future.map(serializeEntry)),
    }),
  );
  files.set(
    "checkpoints.json",
    json(
      await Promise.all(
        checkpoints.map(async (c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, project: await assets.project(c.project) })),
      ),
    ),
  );
  for (const [path, bytes] of [...assets.files].sort(([a], [b]) => a.localeCompare(b))) files.set(path, bytes);
  const manifest: Manifest = {
    format: AEPROJ_FORMAT,
    formatVersion: AEPROJ_FORMAT_VERSION,
    generator: options.generator,
    name: history.present.project.name,
    createdAt: options.createdAt ?? now.toISOString(),
    savedAt: now.toISOString(),
    projectVersion: 1,
    history: { limit: HISTORY_LIMIT, past: history.past.length, future: history.future.length },
    checkpoints: checkpoints.length,
    files: {},
  };
  for (const [path, bytes] of files) manifest.files[path] = { sha256: await sha256(bytes), bytes: bytes.byteLength };
  return writeZip(
    [
      { name: "mimetype", data: encoder.encode(AEPROJ_MIME) },
      { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) },
      ...[...files].map(([name, data]) => ({ name, data })),
    ],
    { store: (name) => name === "mimetype" || name.startsWith("assets/"), date: now },
  );
}

export function isPackage(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export async function unpackSession(bytes: Uint8Array): Promise<{ session: Session; info: PackageInfo }> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) fail("项目包超过 256 MB");
  if (!isPackage(bytes)) fail("文件不是有效的项目包");
  const files = await readZip(bytes, LIMITS);
  if (new TextDecoder().decode(files.get("mimetype") ?? new Uint8Array()) !== AEPROJ_MIME) fail("文件不是 Aero 项目包");
  const manifest = record(parse(files.get("manifest.json"), "manifest.json"), "清单");
  if (manifest.format !== AEPROJ_FORMAT) fail("文件不是 Aero 项目包");
  if (manifest.formatVersion !== AEPROJ_FORMAT_VERSION) fail("不支持此项目包版本，请更新应用");
  const listed = record(manifest.files, "清单文件列表");
  for (const [path, meta] of Object.entries(listed)) {
    const data = files.get(path) ?? fail("项目包缺少文件");
    if (record(meta, "清单文件").sha256 !== (await sha256(data))) fail("项目包内容校验失败");
  }
  for (const path of files.keys())
    if (path !== "mimetype" && path !== "manifest.json" && !(path in listed)) fail("项目包包含未登记的文件");

  const reader = new AssetReader(files);
  const presentProject = reader.project(parse(files.get("project.json"), "project.json"));
  const h = record(parse(files.get("history.json"), "history.json"), "历史记录");
  const presentMeta = record(h.present, "历史记录");
  const list = (x: unknown) => (Array.isArray(x) ? x : fail("历史记录格式无效"));
  // Older entries beyond the supported depth are dropped rather than rejected.
  const history: History = {
    past: list(h.past).slice(-HISTORY_LIMIT).map((e) => reader.entry(e)),
    present: { label: text(presentMeta.label, "历史记录名称"), at: time(presentMeta.at), project: presentProject },
    future: list(h.future).slice(0, HISTORY_LIMIT).map((e) => reader.entry(e)),
  };
  const rawCheckpoints = parse(files.get("checkpoints.json"), "checkpoints.json");
  if (!Array.isArray(rawCheckpoints) || rawCheckpoints.length > MAX_CHECKPOINTS) fail("检查点格式无效");
  const checkpoints: Checkpoint[] = (rawCheckpoints as unknown[]).map((x) => {
    const c = record(x, "检查点");
    return { id: text(c.id, "检查点标识"), name: text(c.name, "检查点名称"), createdAt: time(c.createdAt), project: reader.project(c.project) };
  });
  if (new Set(checkpoints.map((c) => c.id)).size !== checkpoints.length) fail("检查点标识重复");
  const generator = record(manifest.generator, "生成信息");
  return {
    session: { history, checkpoints },
    info: {
      name: presentProject.name,
      createdAt: String(manifest.createdAt ?? ""),
      savedAt: String(manifest.savedAt ?? ""),
      generator: { name: String(generator.name ?? ""), version: String(generator.version ?? "") },
    },
  };
}
