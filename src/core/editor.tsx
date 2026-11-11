import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearTiming,
  emptyProject,
  exampleProject,
  makeDrone,
  makeModel,
  parseProject,
  removeObject,
  uid,
} from "./project";
import type {
  CameraView,
  ModelKind,
  Project,
  Selection,
  Tool,
  Vec3,
} from "./types";
import { persistProject, type AutosaveStatus } from "./feedback";
import {
  jumpHistory,
  pushHistory,
  redoHistory,
  startHistory,
  timeline,
  undoHistory,
  type Checkpoint,
  type History,
  type Session,
} from "./history";
import {
  beginTransformSession,
  updateTransformSession,
  commitTransformHistory,
  type TransformSession,
  type TransformTarget,
} from "./transform";

const STORAGE = "p15.project.v1";
type InitialHistory = History & {
  loadError?: string;
  autosavePaused?: boolean;
};
function initial(): InitialHistory {
  try {
    const saved = localStorage.getItem(STORAGE);
    return startHistory(saved ? parseProject(saved) : exampleProject(), saved ? "恢复本机暂存" : "打开示例");
  } catch {
    let autosavePaused = false;
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) localStorage.setItem(STORAGE + ".recovery", raw);
    } catch {
      autosavePaused = true;
    }
    return {
      ...startHistory(exampleProject(), "打开示例"),
      autosavePaused,
      loadError: autosavePaused
        ? "本机暂存不可用。请保存项目文件，以免丢失修改。"
        : "无法恢复上次的项目，已保留原始数据。请打开已保存的项目文件。",
    };
  }
}
function useEditorState() {
  const [initialHistory] = useState(initial);
  const [history, setHistory] = useState<History>(initialHistory),
    [checkpoints, setCheckpointsState] = useState<Checkpoint[]>([]),
    [selection, setSelectionState] = useState<Selection>(null);
  const [tool, setToolState] = useState<Tool>("select"),
    [view, setViewState] = useState<CameraView>("perspective");
  const [progress, setProgress] = useState(0),
    [playing, setPlayingState] = useState(false),
    [speed, setSpeed] = useState(1),
    [preview, setPreviewState] = useState(false);
  const [candidate, setCandidateState] = useState<Project | null>(null),
    [message, setMessage] = useState(""),
    [recoveryNotice, setRecoveryNotice] = useState(initialHistory.loadError ?? ""),
    [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>(initialHistory.autosavePaused ? "paused" : "saving"),
    [focusTick, setFocusTick] = useState(0);
  const [transientDraft, setTransientDraft] = useState<Project | null>(null),
    [transformTarget, setTransformTargetState] = useState<TransformTarget>("position"),
    [snap, setSnapState] = useState(0),
    [lockHeight, setLockHeightState] = useState(false);
  // Event callbacks can run before React renders again; these refs cancel or finish synchronously.
  const historyRef = useRef(history), checkpointsRef = useRef(checkpoints), selectionRef = useRef(selection),
    toolRef = useRef(tool), viewRef = useRef(view), previewRef = useRef(preview),
    playingRef = useRef(playing), candidateRef = useRef(candidate),
    transformTargetRef = useRef(transformTarget), snapRef = useRef(snap),
    lockHeightRef = useRef(lockHeight), transformSessionRef = useRef<TransformSession | null>(null);
  const project = candidate ?? transientDraft ?? history.present.project;
  // Native canvas events can arrive before the separate R3F root receives context updates.
  function readProject() {
    return candidateRef.current ?? transformSessionRef.current?.draft ?? historyRef.current.present.project;
  }
  const [autosavePaused] = useState(!!initialHistory.autosavePaused);
  useEffect(() => {
    if (autosavePaused) return;
    setAutosaveStatus("saving");
    const persist = () => {
      try {
        setAutosaveStatus(persistProject(localStorage, STORAGE, history.present.project));
      } catch {
        setAutosaveStatus("error");
      }
    };
    const id = setTimeout(persist, 450);
    window.addEventListener("beforeunload", persist);
    return () => {
      clearTimeout(id);
      window.removeEventListener("beforeunload", persist);
    };
  }, [history.present]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(id);
  }, [message]);
  function writeHistory(update: (h: History) => History) {
    const next = update(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
  }
  function writeCheckpoints(update: (list: Checkpoint[]) => Checkpoint[]) {
    const next = update(checkpointsRef.current);
    checkpointsRef.current = next;
    setCheckpointsState(next);
  }
  /** Reset transient UI state whenever the committed state jumps (undo, redo, restore, open). */
  function settle() {
    cancelTransform();
    setPlaying(false);
    setCandidate(null);
    setProgress(0);
  }
  function cancelTransform() {
    transformSessionRef.current = null;
    setTransientDraft(null);
  }
  function select(next: Selection) {
    const previous = selectionRef.current;
    if (previous?.id !== next?.id || previous?.type !== next?.type) {
      cancelTransform();
      transformTargetRef.current = "position";
      setTransformTargetState("position");
    }
    selectionRef.current = next;
    setSelectionState(next);
    if (next?.type === "viewpoint" && !candidateRef.current && !previewRef.current) {
      toolRef.current = "translate";
      setToolState("translate");
    }
  }
  function setTool(next: Tool) {
    if (next !== toolRef.current) cancelTransform();
    toolRef.current = next;
    setToolState(next);
  }
  function setView(next: CameraView) {
    if (next !== viewRef.current) cancelTransform();
    viewRef.current = next;
    setViewState(next);
  }
  function setPreview(next: boolean) {
    if (next !== previewRef.current) cancelTransform();
    previewRef.current = next;
    setPreviewState(next);
  }
  function setPlaying(next: boolean) {
    if (next) cancelTransform();
    playingRef.current = next;
    setPlayingState(next);
  }
  function setCandidate(next: Project | null) {
    cancelTransform();
    candidateRef.current = next;
    setCandidateState(next);
  }
  function setTransformTarget(next: TransformTarget) {
    if (next !== transformTargetRef.current) cancelTransform();
    transformTargetRef.current = next;
    setTransformTargetState(next);
  }
  function setSnap(next: number) {
    if (![0, 0.1, 1].includes(next)) return;
    if (next !== snapRef.current) cancelTransform();
    snapRef.current = next;
    setSnapState(next);
  }
  function setLockHeight(next: boolean) {
    if (next !== lockHeightRef.current) cancelTransform();
    lockHeightRef.current = next;
    setLockHeightState(next);
  }
  function beginTransform(next: Selection): boolean {
    if (transformSessionRef.current || candidateRef.current || previewRef.current || playingRef.current) return false;
    const session = beginTransformSession(historyRef.current.present.project, next, {
      target: transformTargetRef.current, snap: snapRef.current, lockHeight: lockHeightRef.current,
    });
    if (!session) return false;
    transformSessionRef.current = session;
    setTransientDraft(session.draft);
    return true;
  }
  function updateTransform(values: Record<string, unknown>) {
    const session = transformSessionRef.current;
    if (!session) return;
    const next = updateTransformSession(session, values);
    transformSessionRef.current = next;
    setTransientDraft(next.draft);
  }
  function finishTransform() {
    const session = transformSessionRef.current;
    cancelTransform();
    if (candidateRef.current) return;
    const next = commitTransformHistory(historyRef.current, session);
    if (next === historyRef.current) return;
    setPlaying(false);
    setProgress(0);
    writeHistory(() => next);
  }
  function commit(next: Project | ((p: Project) => Project), manual = true, label?: string) {
    cancelTransform();
    if (candidateRef.current) return;
    setPlaying(false);
    setProgress(0);
    writeHistory((h) => {
      const p = typeof next === "function" ? next(h.present.project) : next;
      if (p === h.present.project) return h;
      return pushHistory(h, manual ? { ...p, source: "用户手动编排" } : p, label);
    });
  }
  function patch(
    type: NonNullable<Selection>["type"],
    id: string,
    values: Record<string, unknown>,
  ) {
    if (candidateRef.current) return;
    commit((p) => {
      if (type === "model")
        return {
          ...p,
          models: p.models.map((m) =>
            m.id === id && !m.locked ? { ...m, ...values } : m,
          ),
        };
      if (type === "drone")
        return {
          ...p,
          drones: p.drones.map((d) => (d.id === id ? { ...d, ...values } : d)),
        };
      return clearTiming({
        ...p,
        viewpoints: p.viewpoints.map((v) =>
          v.id === id ? { ...v, ...values } : v,
        ),
      });
    }, true, "修改属性");
  }
  function addModel(kind: ModelKind) {
    if (candidateRef.current) return;
    setPreview(false);
    if (view === "drone") setView("perspective");
    const m = makeModel(kind, historyRef.current.present.project.models.length + 1);
    commit((p) => ({ ...p, models: [...p.models, m] }), true, `添加${m.name}`);
    select({ type: "model", id: m.id });
    setTool("translate");
  }
  function addDrone() {
    if (candidateRef.current) return;
    setPreview(false);
    if (view === "drone") setView("perspective");
    const d = makeDrone(historyRef.current.present.project.drones.length + 1);
    commit((p) => ({ ...p, drones: [...p.drones, d] }), true, `添加${d.name}`);
    select({ type: "drone", id: d.id });
    setTool("translate");
  }
  function chosenDrone(source = project) {
    const selected = selectionRef.current;
    if (selected?.type === "drone")
      return source.drones.find((d) => d.id === selected.id);
    if (selected?.type === "viewpoint")
      return source.drones.find(
        (d) =>
          d.id ===
          source.viewpoints.find((v) => v.id === selected.id)?.droneId,
      );
    return source.drones[0];
  }
  function addPoint(position?: Vec3) {
    if (candidateRef.current) return;
    cancelTransform();
    const current = historyRef.current.present.project;
    const d = chosenDrone(current);
    if (!d) {
      setMessage("请先添加一架无人机。");
      return;
    }
    const v = {
      id: uid(),
      droneId: d.id,
      name: `拍摄点 ${current.viewpoints.filter((v) => v.droneId === d.id).length + 1}`,
      position: position ?? ([...d.position] as Vec3),
      target: [0, 8, 0] as Vec3,
    };
    commit((p) => clearTiming({ ...p, viewpoints: [...p.viewpoints, v] }), true, `添加${v.name}`);
    select({ type: "viewpoint", id: v.id });
    setTool("translate");
    setMessage("拍摄点已添加，可调整高度或指定镜头目标。");
  }
  function undo() {
    settle();
    writeHistory(undoHistory);
  }
  function redo() {
    settle();
    writeHistory(redoHistory);
  }
  /** Jump to any entry of the timeline returned by `historyEntries`. */
  function jumpTo(index: number) {
    settle();
    writeHistory((h) => jumpHistory(h, index));
  }
  function createCheckpoint(name?: string): Checkpoint {
    const list = checkpointsRef.current;
    const checkpoint: Checkpoint = {
      id: uid(),
      name: name?.trim().slice(0, 160) || `检查点 ${list.length + 1}`,
      createdAt: Date.now(),
      project: historyRef.current.present.project,
    };
    writeCheckpoints((all) => [...all, checkpoint]);
    setMessage(`已创建「${checkpoint.name}」。`);
    return checkpoint;
  }
  /** Restoring is itself an undoable edit, so no history is lost. */
  function restoreCheckpoint(id: string) {
    const checkpoint = checkpointsRef.current.find((c) => c.id === id);
    if (!checkpoint) return;
    settle();
    select(null);
    writeHistory((h) => pushHistory(h, checkpoint.project, `恢复「${checkpoint.name}」`));
    setMessage(`已恢复到「${checkpoint.name}」，可撤销。`);
  }
  function renameCheckpoint(id: string, name: string) {
    const clean = name.trim().slice(0, 160);
    if (!clean) return;
    writeCheckpoints((all) => all.map((c) => (c.id === id ? { ...c, name: clean } : c)));
  }
  function deleteCheckpoint(id: string) {
    writeCheckpoints((all) => all.filter((c) => c.id !== id));
  }
  /** Snapshot of the committed session, used for .aeproj packages and autosave. */
  function exportSession(): Session {
    return { history: historyRef.current, checkpoints: checkpointsRef.current };
  }
  /** Replace the whole session, e.g. after opening a package. */
  function loadSession(session: Session) {
    settle();
    select(null);
    setTool("select");
    setPreview(false);
    historyRef.current = session.history;
    setHistory(session.history);
    writeCheckpoints(() => session.checkpoints);
  }
  function remove() {
    const selected = selectionRef.current;
    if (!selected || candidateRef.current) return;
    const m = historyRef.current.present.project.models.find((m) => m.id === selected.id);
    if (m?.locked) {
      setMessage("请先解锁对象。");
      return;
    }
    commit((p) => clearTiming(removeObject(p, selected.type, selected.id)), true, "删除对象");
    select(null);
  }
  function duplicate() {
    const selected = selectionRef.current;
    if (!selected || candidateRef.current) return;
    const source = historyRef.current.present.project;
    if (selected.type === "model") {
      const m = source.models.find((m) => m.id === selected.id);
      if (!m || m.locked) return;
      const copy = {
        ...structuredClone(m),
        id: uid(),
        name: m.name + " 副本",
        position: [m.position[0] + 5, m.position[1], m.position[2] + 5] as Vec3,
      };
      commit((p) => ({ ...p, models: [...p.models, copy] }), true, `复制${m.name}`);
      select({ type: "model", id: copy.id });
    }
    if (selected.type === "drone") {
      const d = source.drones.find((d) => d.id === selected.id);
      if (!d) return;
      const copy = { ...structuredClone(d), id: uid(), name: d.name + " 副本" };
      commit((p) => ({
        ...p,
        drones: [...p.drones, copy],
        viewpoints: [
          ...p.viewpoints,
          ...p.viewpoints
            .filter((v) => v.droneId === d.id)
            .map((v) => ({
              ...structuredClone(v),
              id: uid(),
              droneId: copy.id,
            })),
        ],
      }), true, `复制${d.name}`);
      select({ type: "drone", id: copy.id });
    }
  }
  function replace(p: Project, label = "替换场景") {
    setCandidate(null);
    commit(p, false, label);
    select(null);
    setTool("select");
    setPreview(false);
  }
  function focus() {
    cancelTransform();
    setFocusTick((n) => n + 1);
  }
  return {
    project,
    readProject,
    committedProject: history.present.project,
    isTransforming: transientDraft !== null,
    beginTransform,
    updateTransform,
    finishTransform,
    cancelTransform,
    transformTarget,
    setTransformTarget,
    snap,
    setSnap,
    lockHeight,
    setLockHeight,
    selection,
    select,
    tool,
    setTool,
    view,
    setView,
    progress,
    setProgress,
    playing,
    setPlaying,
    speed,
    setSpeed,
    preview,
    setPreview,
    candidate,
    setCandidate,
    message,
    setMessage,
    autosaveStatus,
    recoveryNotice,
    dismissRecoveryNotice: () => setRecoveryNotice(""),
    focusTick,
    focus,
    commit,
    patch,
    addModel,
    addDrone,
    addPoint,
    chosenDrone,
    undo,
    redo,
    remove,
    duplicate,
    replace,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    historyEntries: timeline(history),
    jumpTo,
    checkpoints,
    createCheckpoint,
    restoreCheckpoint,
    renameCheckpoint,
    deleteCheckpoint,
    exportSession,
    loadSession,
    newProject: () => loadSession({ history: startHistory(emptyProject(), "新建项目"), checkpoints: [] }),
    example: () => loadSession({ history: startHistory(exampleProject(), "打开示例"), checkpoints: [] }),
  };
}
const EditorContext = createContext<ReturnType<typeof useEditorState> | null>(
  null,
);
export function EditorProvider({ children }: { children: ReactNode }) {
  return (
    <EditorContext.Provider value={useEditorState()}>
      {children}
    </EditorContext.Provider>
  );
}
export function useEditor() {
  const value = useContext(EditorContext);
  if (!value) throw new Error("EditorProvider missing");
  return value;
}
