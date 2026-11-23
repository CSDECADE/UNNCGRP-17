// .aeproj — the portable Aero project package.
//
// A ZIP container (see docs/aeproj.md) holding everything a session needs on another client:
//   mimetype            "application/vnd.aero.project+zip", stored, first entry
//   manifest.json       format version, generator, timestamps, SHA-256 of every other file
//   project.json        current scene (Project, version 1)
//   history.json        undo/redo timeline, up to HISTORY_LIMIT entries on each side
//   checkpoints.json    named snapshots, unlimited
//   reconstruction.json optional: reference/proxy models (by asset path) and capture settings
//   assets/<sha256>.<ext>  binary assets referenced by any state (background images, .glb models), deduplicated
//   resources/<sha256>.json  OBJ mesh resources (project version 2), deduplicated; formatVersion 2 only
// Inside the package, scene background images reference `assets/...` instead of embedding data URLs, and each
// `objResources` element is replaced by `{ "resource": "resources/..." }`, so a mesh shared by every history
// state and checkpoint is stored once.
import { validateProject } from "../project.ts";
import { ProjectValidationError } from "../feedback.ts";
import { HISTORY_LIMIT, type Checkpoint, type History, type HistoryEntry, type Session } from "../history.ts";
import type { Project } from "../types.ts";
import { serializeReconstruction, validateReconstruction, type MeshAsset } from "../reconstruction.ts";
import { readZip, writeZip } from "./zip.ts";

export const AEPROJ_EXTENSION = "aeproj";
export const AEPROJ_MIME = "application/vnd.aero.project+zip";
export const AEPROJ_FORMAT = "aeproj";
/** Newest format this build reads and writes. Packages without OBJ resources are still written as version 1. */
export const AEPROJ_FORMAT_VERSION = 2;
const SUPPORTED_FORMAT_VERSIONS = [1, 2];
export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_CHECKPOINTS = 10_000;
const LIMITS = { maxEntries: 20_000, maxEntryBytes: 256 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };

export type Manifest = {
  format: typeof AEPROJ_FORMAT;
  formatVersion: 1 | 2;
  generator: { name: string; version: string };
  name: string;
  createdAt: string;
  savedAt: string;
  projectVersion: number;
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
  usesResources = false;
  private byDataUrl = new Map<string, string>();
  // Unchanged resources are the same object across states, so this skips re-serializing them.
  private byResource = new WeakMap<object, string>();
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
  private async resource(r: unknown): Promise<{ resource: string }> {
    const known = r && typeof r === "object" ? this.byResource.get(r) : undefined;
    if (known) return { resource: known };
    const bytes = encoder.encode(JSON.stringify(r));
    const path = `resources/${await sha256(bytes)}.json`;
    this.files.set(path, bytes);
    this.usesResources = true;
    if (r && typeof r === "object") this.byResource.set(r, path);
    return { resource: path };
  }
  async project(p: Project): Promise<unknown> {
    let out: Record<string, unknown> = p;
    if (p.background?.image) {
      const { dataUrl, ...image } = p.background.image;
      out = { ...out, background: { ...p.background, image: { ...image, asset: await this.ref(dataUrl) } } };
    }
    const resources = (p as { objResources?: unknown }).objResources;
    if (Array.isArray(resources)) out = { ...out, objResources: await Promise.all(resources.map((r) => this.resource(r))) };
    return out;
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

/** Resolves `assets/...` and `resources/...` references, then applies full project validation. */
class AssetReader {
  private cache = new Map<string, string>();
  private resources = new Map<string, unknown>();
  private validated = new Map<string, unknown>();
  private files: Map<string, Uint8Array>;
  private listed: Record<string, unknown>;
  constructor(files: Map<string, Uint8Array>, listed: Record<string, unknown>) {
    this.files = files;
    this.listed = listed;
  }
  private resource(path: unknown): unknown {
    if (typeof path !== "string") return fail("OBJ 资源引用无效");
    if (this.resources.has(path)) return this.resources.get(path);
    const match = /^resources\/([0-9a-f]{64})\.json$/.exec(path) ?? fail("OBJ 资源引用无效");
    const bytes = this.files.get(path) ?? fail("项目包缺少引用的 OBJ 资源");
    // The manifest hash was verified on open; the file name must name the same content.
    if (record(this.listed[path], "OBJ 资源").sha256 !== match[1]) fail("OBJ 资源校验失败");
    const value = parse(bytes, path);
    this.resources.set(path, value);
    return value;
  }
  /** Validation copies resources; states that referenced the same file get the same validated object back. */
  private share(project: Project, paths: (string | undefined)[]): Project {
    const list = (project as { objResources?: unknown[] }).objResources;
    if (!list || !paths.some(Boolean)) return project;
    const shared = list.map((r, i) => {
      const path = paths[i];
      if (!path) return r;
      if (!this.validated.has(path)) this.validated.set(path, r);
      return this.validated.get(path);
    });
    return { ...project, objResources: shared } as Project;
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
    const raw: Record<string, unknown> = { ...p };
    const background = p.background === undefined ? undefined : record(p.background, "背景设置");
    if (background?.image !== undefined) {
      const { asset, ...image } = record(background.image, "背景图片");
      raw.background = { ...background, image: { ...image, dataUrl: this.dataUrl(asset) } };
    }
    const paths: (string | undefined)[] = [];
    if (Array.isArray(p.objResources)) {
      raw.objResources = p.objResources.map((x, i) => {
        if (!x || typeof x !== "object" || !Object.hasOwn(x, "resource")) return x;
        paths[i] = (x as { resource: string }).resource;
        return this.resource(paths[i]);
      });
    }
    return this.share(validateProject(raw), paths);
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
  if (session.reconstruction) {
    const ref = (a: MeshAsset) => {
      const path = `assets/${a.sha256}.glb`;
      assets.files.set(path, a.bytes);
      return { name: a.name, asset: path };
    };
    files.set("reconstruction.json", json(serializeReconstruction(session.reconstruction, ref)));
  }
  for (const [path, bytes] of [...assets.files].sort(([a], [b]) => a.localeCompare(b))) files.set(path, bytes);
  const manifest: Manifest = {
    format: AEPROJ_FORMAT,
    // Older builds can still open packages that do not need version 2 features.
    formatVersion: assets.usesResources ? 2 : 1,
    generator: options.generator,
    name: history.present.project.name,
    createdAt: options.createdAt ?? now.toISOString(),
    savedAt: now.toISOString(),
    projectVersion: history.present.project.version,
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
  if (!SUPPORTED_FORMAT_VERSIONS.includes(manifest.formatVersion as number)) fail("不支持此项目包版本，请更新应用");
  const listed = record(manifest.files, "清单文件列表");
  for (const [path, meta] of Object.entries(listed)) {
    const data = files.get(path) ?? fail("项目包缺少文件");
    if (record(meta, "清单文件").sha256 !== (await sha256(data))) fail("项目包内容校验失败");
  }
  for (const path of files.keys())
    if (path !== "mimetype" && path !== "manifest.json" && !(path in listed)) fail("项目包包含未登记的文件");

  const reader = new AssetReader(files, listed);
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
  const session: Session = { history, checkpoints };
  if (files.has("reconstruction.json")) {
    session.reconstruction = validateReconstruction(parse(files.get("reconstruction.json"), "reconstruction.json"), (ref, what) => {
      const r = record(ref, what);
      const path = typeof r.asset === "string" ? r.asset : "";
      const match = /^assets\/([0-9a-f]{64})\.glb$/.exec(path) ?? fail(`${what}引用无效`);
      // The manifest hash was verified above; the file name must name the same content.
      if (record(listed[path], what).sha256 !== match[1]) fail(`${what}校验失败`);
      return { name: text(r.name, `${what}名称`), sha256: match[1], bytes: files.get(path)! };
    });
  }
  const generator = record(manifest.generator, "生成信息");
  return {
    session,
    info: {
      name: presentProject.name,
      createdAt: String(manifest.createdAt ?? ""),
      savedAt: String(manifest.savedAt ?? ""),
      generator: { name: String(generator.name ?? ""), version: String(generator.version ?? "") },
    },
  };
}
