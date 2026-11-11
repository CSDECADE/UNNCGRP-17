// IndexedDB storage on this machine: the autosaved session and (browser build only) recent packages.
// localStorage is too small for full histories with background images.
import { validateProject } from "./project.ts";
import { startHistory, type Session } from "./history.ts";

const DB_NAME = "aero-p15";
const DB_VERSION = 1;
const SESSION_STORE = "session";
const RECENT_STORE = "recent";
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

export async function saveAutosave(record: AutosaveRecord): Promise<void> {
  await run(SESSION_STORE, "readwrite", (s) => s.put(record, "current"));
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
    return {
      ...stored,
      session: {
        history: { past: h.past.map(fix), present: fix(h.present), future: h.future.map(fix) },
        checkpoints: stored.session.checkpoints.map(fix),
      },
    };
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
