// IndexedDB storage on this machine: the autosaved session and (browser build only) recent packages.
// localStorage is too small for full histories with background images.
import { validateProject } from "./project.ts";
import { startHistory, type Session } from "./history.ts";
import { serializeReconstruction, validateReconstruction, type MeshAsset } from "./reconstruction.ts";
import { cloudAsset, type SparseCloud } from "./capture/sparseCloud.ts";

const DB_NAME = "aero-p15";
const DB_VERSION = 2;
const SESSION_STORE = "session";
const RECENT_STORE = "recent";
/** Large binary assets (models) keyed by sha256, written once and referenced from the session. */
const ASSET_STORE = "assets";
const LEGACY_KEY = "p15.project.v1";
export const MAX_WEB_RECENT = 8;

export type AutosaveRecord = { session: Session; savedAt: number; fileName: string | null; createdAt?: string };
export type WebRecent = { id: string; name: string; fileName: string; openedAt: number; bytes: Uint8Array };

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains(SESSION_STORE)) d.createObjectStore(SESSION_STORE);
      if (!d.objectStoreNames.contains(RECENT_STORE)) d.createObjectStore(RECENT_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(ASSET_STORE)) d.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
  });
}

const storedAssets = new Set<string>();
async function storeAsset(a: { sha256: string; bytes: Uint8Array }) {
  if (storedAssets.has(a.sha256)) return;
  await run(ASSET_STORE, "readwrite", (s) => s.put(a.bytes, a.sha256));
  storedAssets.add(a.sha256);
}
export async function saveAutosave(record: AutosaveRecord): Promise<void> {
  const r = record.session.reconstruction;
  let stored: unknown = record;
  const keep = new Set<string | undefined>([r?.reference?.sha256, r?.proxy?.sha256]);
  if (r) {
    for (const a of [r.reference, r.proxy]) if (a) await storeAsset(a);
    // Point data is stored like model files, so each autosave only writes the small JSON part.
    const clouds = new Map<SparseCloud, string>();
    for (const c of Object.values(r.clouds ?? {})) {
      if (!c) continue;
      const a = await cloudAsset(c.cloud);
      await storeAsset(a);
      clouds.set(c.cloud, a.sha256);
      keep.add(a.sha256);
    }
    const ref = (a: MeshAsset) => ({ name: a.name, sha256: a.sha256 });
    const cloudRef = (c: SparseCloud) => ({ sha256: clouds.get(c) });
    stored = { ...record, session: { ...record.session, reconstruction: serializeReconstruction(r, ref, cloudRef) } };
  }
  await run(SESSION_STORE, "readwrite", (s) => s.put(stored, "current"));
  // Drop model and cloud files the autosaved session no longer references.
  const keys = await run<IDBValidKey[]>(ASSET_STORE, "readonly", (s) => s.getAllKeys());
  for (const key of keys)
    if (!keep.has(String(key))) {
      await run(ASSET_STORE, "readwrite", (s) => s.delete(key));
      storedAssets.delete(String(key));
    }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Legacy key cleanup is best effort.
  }
}
/** The last autosaved session, or a session migrated from the pre-.aeproj localStorage format. */
export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const stored = await run<AutosaveRecord | undefined>(SESSION_STORE, "readonly", (s) => s.get("current"));
  if (stored?.session?.history?.present?.project) {
    // Re-validate: storage is shared with other builds and may be stale.
    const h = stored.session.history;
    const fix = <T extends { project: unknown }>(e: T) => ({ ...e, project: validateProject(e.project) });
    const session: Session = {
      history: { past: h.past.map(fix), present: fix(h.present), future: h.future.map(fix) },
      checkpoints: stored.session.checkpoints.map(fix),
    };
    if (stored.session.reconstruction) {
      const assets = new Map<string, Uint8Array>();
      const raw = stored.session.reconstruction as unknown as Record<string, { sha256?: string } | undefined>;
      const cloudShas = Object.values((raw.clouds ?? {}) as Record<string, { data?: { sha256?: string } }>).map((c) => c?.data?.sha256);
      for (const sha of [raw.reference?.sha256, raw.proxy?.sha256, ...cloudShas]) {
        if (typeof sha !== "string") continue;
        const bytes = await run<Uint8Array | undefined>(ASSET_STORE, "readonly", (s) => s.get(sha));
        if (bytes) {
          assets.set(sha, bytes);
          storedAssets.add(sha);
        }
      }
      session.reconstruction = validateReconstruction(raw, (ref) => {
        const r = ref as { name?: unknown; sha256?: unknown };
        const bytes = typeof r?.sha256 === "string" ? assets.get(r.sha256) : undefined;
        // A missing asset (storage cleared) drops the model rather than the whole session.
        return bytes ? { name: String(r.name ?? "model.glb"), sha256: r.sha256 as string, bytes } : undefined;
      }, (ref) => {
        const sha = (ref as { sha256?: unknown } | undefined)?.sha256;
        return typeof sha === "string" ? assets.get(sha) : undefined;
      });
    }
    return { ...stored, session };
  }
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!legacy) return null;
  const project = validateProject(JSON.parse(legacy));
  return { session: { history: startHistory(project, "恢复本机暂存"), checkpoints: [] }, savedAt: Date.now(), fileName: null };
}

export async function listWebRecent(): Promise<WebRecent[]> {
  const all = await run<WebRecent[]>(RECENT_STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.openedAt - a.openedAt);
}
export async function getWebRecent(id: string): Promise<WebRecent | undefined> {
  return run<WebRecent | undefined>(RECENT_STORE, "readonly", (s) => s.get(id));
}
export async function removeWebRecent(id: string): Promise<void> {
  await run(RECENT_STORE, "readwrite", (s) => s.delete(id));
}
/** Remember a package copy so the browser build can reopen it; keyed by file name. */
export async function touchWebRecent(entry: Omit<WebRecent, "id" | "openedAt">): Promise<void> {
  const all = await listWebRecent();
  const previous = all.find((r) => r.fileName === entry.fileName);
  const next: WebRecent = { ...entry, id: previous?.id ?? crypto.randomUUID(), openedAt: Date.now() };
  await run(RECENT_STORE, "readwrite", (s) => s.put(next));
  for (const stale of all.filter((r) => r.id !== next.id).slice(MAX_WEB_RECENT - 1)) await removeWebRecent(stale.id);
}
