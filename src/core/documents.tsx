// Document lifecycle: open/save .aeproj packages, recent projects, autosave of the whole session.
// Desktop builds go through window.p15Desktop; the browser build uses a file input, downloads
// and IndexedDB copies for its recent list.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { productName, version } from "../../package.json";
import { useEditor } from "./editor";
import { fileErrorMessage, projectForSave, UserInputError, type FileOperation } from "./feedback";
import { emptyProject, exampleProject, parseProject } from "./project";
import { startHistory, type Session } from "./history";
import { AEPROJ_EXTENSION, isPackage, MAX_PACKAGE_BYTES, packSession, unpackSession } from "./aeproj/package";
import {
  getWebRecent,
  listWebRecent,
  loadAutosave,
  removeWebRecent,
  saveAutosave,
  touchWebRecent,
  type AutosaveRecord,
} from "./localStore";

export type RecentEntry = { id: string; name: string; fileName: string; folder?: string; openedAt: number; missing: boolean };
export type AutosaveSummary = { name: string; savedAt: number; fileName: string | null; steps: number; checkpoints: number };

const generator = { name: productName, version };
const desktop = () => window.p15Desktop;

function useDocumentState() {
  const e = useEditor();
  const [fileName, setFileName] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [resume, setResume] = useState<AutosaveSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const createdAt = useRef<string | undefined>(undefined);
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const autosaved = useRef<AutosaveRecord | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = useRef<((file: File | undefined) => void) | null>(null);

  async function refreshRecent() {
    try {
      const d = desktop();
      if (d) setRecent(await d.recentProjects());
      else setRecent((await listWebRecent()).map(({ bytes: _, ...r }) => ({ ...r, missing: false })));
    } catch (err) {
      console.error(err);
    }
  }
  useEffect(() => {
    void refreshRecent();
    loadAutosave()
      .then((record) => {
        autosaved.current = record;
        if (!record) return;
        const h = record.session.history;
        setResume({
          name: h.present.project.name,
          savedAt: record.savedAt,
          fileName: record.fileName,
          steps: h.past.length + h.future.length,
          checkpoints: record.session.checkpoints.length,
        });
      })
      .catch((err) => {
        console.error(err);
        e.setRecoveryNotice("无法恢复上次的工作。请打开已保存的项目文件。");
      });
  }, []);

  // Autosave the whole session (history + checkpoints) once a project is active.
  const pending = useRef<AutosaveRecord | null>(null);
  function flush() {
    const record = pending.current;
    if (!record) return;
    pending.current = null;
    saveAutosave(record)
      .then(() => e.setAutosaveStatus("saved"))
      .catch((err) => {
        console.error(err);
        e.setAutosaveStatus("error");
      });
  }
  useEffect(() => {
    if (!e.active) return;
    e.setAutosaveStatus("saving");
    pending.current = {
      session: { history: e.history, checkpoints: e.checkpoints },
      savedAt: Date.now(),
      fileName: fileNameRef.current,
      createdAt: createdAt.current,
    };
    const id = setTimeout(flush, 450);
    return () => clearTimeout(id);
  }, [e.active, e.history, e.checkpoints, fileName]);
  // Start the pending write before the page goes away so the last edit is not lost.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  function begin(session: Session, name: string | null, created?: string) {
    createdAt.current = created;
    setFileName(name);
    setError("");
    e.loadSession(session);
  }
  async function guard<T>(operation: FileOperation, action: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (err) {
      console.error(err);
      setError(fileErrorMessage(err, operation));
      return null;
    } finally {
      setBusy(false);
    }
  }
  /** Validate and load file content. Returns the session's project name. */
  async function load(content: { bytes?: Uint8Array; text?: string }, name: string): Promise<{ legacy: boolean; projectName: string }> {
    if (content.bytes && isPackage(content.bytes)) {
      const { session, info } = await unpackSession(content.bytes);
      begin(session, name, info.createdAt || undefined);
      return { legacy: false, projectName: session.history.present.project.name };
    }
    const text = content.text ?? new TextDecoder().decode(content.bytes);
    const project = parseProject(text);
    begin({ history: startHistory(project, "打开旧版项目"), checkpoints: [] }, null);
    return { legacy: true, projectName: project.name };
  }
  async function openDesktop(doc: DesktopDocument | null) {
    if (!doc) return false;
    const { legacy, projectName } = await load(doc.kind === "package" ? { bytes: doc.bytes } : { text: doc.text }, doc.fileName);
    await desktop()!.acceptProject(doc.token, projectName);
    if (legacy) e.setMessage("已打开旧版项目。保存时将转换为 .aeproj 项目包。");
    void refreshRecent();
    return true;
  }
  /** Browser build: read a picked file, remembering packages in the local recent list. */
  async function readFile(file?: File) {
    if (!file) return false;
    return (
      (await guard("open", async () => {
        if (file.size > MAX_PACKAGE_BYTES) throw new UserInputError("项目包超过 256 MB。");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { legacy, projectName } = await load({ bytes }, file.name);
        if (legacy) e.setMessage("已打开旧版项目。保存时将转换为 .aeproj 项目包。");
        else {
          await touchWebRecent({ name: projectName, fileName: file.name, bytes });
          void refreshRecent();
        }
        return true;
      })) ?? false
    );
  }
  async function open() {
    const d = desktop();
    if (d) return (await guard("open", async () => openDesktop(await d.openProject()))) ?? false;
    return new Promise<boolean>((resolve) => {
      pickFile.current = (file) => {
        pickFile.current = null;
        void readFile(file).then(resolve);
      };
      fileInput.current?.click();
    });
  }
  async function openRecent(id: string) {
    const d = desktop();
    const ok = await guard("open", async () => {
      if (d) return openDesktop(await d.openRecent(id));
      const entry = (await getWebRecent(id)) ?? (() => { throw new UserInputError("找不到该项目，请重新打开文件。"); })();
      const { projectName } = await load({ bytes: entry.bytes }, entry.fileName);
      await touchWebRecent({ name: projectName, fileName: entry.fileName, bytes: entry.bytes });
      return true;
    });
    void refreshRecent();
    return ok ?? false;
  }
  async function removeRecent(id: string) {
    try {
      const d = desktop();
      if (d) await d.removeRecent(id);
      else await removeWebRecent(id);
    } finally {
      void refreshRecent();
    }
  }
  function resumeAutosave() {
    const record = autosaved.current;
    if (!record) return false;
    // The desktop main process forgets the file path on restart, so saving asks for a location again.
    begin(record.session, desktop() ? null : record.fileName, record.createdAt);
    if (record.fileName && desktop()) e.setMessage(`已恢复上次的工作。保存时请重新选择「${record.fileName}」的位置。`);
    return true;
  }
  async function start(example = false) {
    await desktop()?.resetDocument().catch(() => {});
    begin(
      { history: startHistory(example ? exampleProject() : emptyProject(), example ? "打开示例" : "新建项目"), checkpoints: [] },
      null,
    );
  }
  async function save(saveAs = false) {
    return (
      (await guard("save", async () => {
        projectForSave(e.project, e.candidate);
        const session = e.exportSession();
        const name = session.history.present.project.name;
        createdAt.current ??= new Date().toISOString();
        const bytes = await packSession(session, { generator, createdAt: createdAt.current });
        const d = desktop();
        if (d) {
          const result = await d.savePackage({ name, bytes, saveAs });
          if (!result) return false;
          setFileName(result.fileName);
          void refreshRecent();
          e.setMessage(`已保存「${result.fileName}」。`);
          return true;
        }
        const target = (!saveAs && fileNameRef.current) || `${name.replace(/[\\/:*?"<>|]/g, "-")}.${AEPROJ_EXTENSION}`;
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: target });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setFileName(target);
        await touchWebRecent({ name, fileName: target, bytes });
        void refreshRecent();
        e.setMessage(`已下载「${target}」。`);
        return true;
      })) ?? false
    );
  }
  const input = (
    <input
      ref={fileInput}
      type="file"
      accept={`.${AEPROJ_EXTENSION},.json`}
      hidden
      onChange={(ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = "";
        if (pickFile.current) pickFile.current(file);
        else void readFile(file);
      }}
    />
  );
  return {
    fileName, recent, resume, error, setError, busy,
    open, openRecent, removeRecent, readFile, resumeAutosave, start, save, refreshRecent, input,
  };
}

const DocumentContext = createContext<ReturnType<typeof useDocumentState> | null>(null);
export function DocumentProvider({ children }: { children: ReactNode }) {
  const value = useDocumentState();
  return (
    <DocumentContext.Provider value={value}>
      {value.input}
      {children}
    </DocumentContext.Provider>
  );
}
export function useDocuments() {
  const value = useContext(DocumentContext);
  if (!value) throw new Error("DocumentProvider missing");
  return value;
}
