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
  beginTransformSession,
  updateTransformSession,
  commitTransformHistory,
  type TransformSession,
  type TransformTarget,
} from "./transform";

const STORAGE = "p15.project.v1";
type History = {
  past: Project[];
  present: Project;
  future: Project[];
  loadError?: string;
  autosavePaused?: boolean;
};
function initial(): History {
  try {
    const saved = localStorage.getItem(STORAGE);
    return {
      past: [],
      present: saved ? parseProject(saved) : exampleProject(),
      future: [],
    };
  } catch {
    let autosavePaused = false;
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) localStorage.setItem(STORAGE + ".recovery", raw);
    } catch {
      autosavePaused = true;
    }
    return {
      past: [],
      present: exampleProject(),
      future: [],
      autosavePaused,
      loadError: autosavePaused
        ? "本机暂存不可用。请保存项目文件，以免丢失修改。"
        : "无法恢复上次的项目，已保留原始数据。请打开已保存的项目文件。",
    };
  }
}
function useEditorState() {
  const [history, setHistory] = useState(initial),
    [selection, setSelectionState] = useState<Selection>(null);
  const [tool, setToolState] = useState<Tool>("select"),
    [view, setViewState] = useState<CameraView>("perspective");
  const [progress, setProgress] = useState(0),
    [playing, setPlayingState] = useState(false),
    [speed, setSpeed] = useState(1),
    [preview, setPreviewState] = useState(false);
  const [candidate, setCandidateState] = useState<Project | null>(null),
    [message, setMessage] = useState(""),
    [recoveryNotice, setRecoveryNotice] = useState(history.loadError ?? ""),
    [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>(history.autosavePaused ? "paused" : "saving"),
    [focusTick, setFocusTick] = useState(0);
  const [transientDraft, setTransientDraft] = useState<Project | null>(null),
    [transformTarget, setTransformTargetState] = useState<TransformTarget>("position"),
    [snap, setSnapState] = useState(0),
    [lockHeight, setLockHeightState] = useState(false);
  // Event callbacks can run before React renders again; these refs cancel or finish synchronously.
  const historyRef = useRef(history), selectionRef = useRef(selection),
    toolRef = useRef(tool), viewRef = useRef(view), previewRef = useRef(preview),
    playingRef = useRef(playing), candidateRef = useRef(candidate),
    transformTargetRef = useRef(transformTarget), snapRef = useRef(snap),
    lockHeightRef = useRef(lockHeight), transformSessionRef = useRef<TransformSession | null>(null);
  const project = candidate ?? transientDraft ?? history.present;
  // Native canvas events can arrive before the separate R3F root receives context updates.
  function readProject() {
    return candidateRef.current ?? transformSessionRef.current?.draft ?? historyRef.current.present;
  }
  const [autosavePaused] = useState(!!history.autosavePaused);
  useEffect(() => {
    if (autosavePaused) return;
    setAutosaveStatus("saving");
    const persist = () => {
      try {
        setAutosaveStatus(persistProject(localStorage, STORAGE, history.present));
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
    historyRef.current = next;
    setHistory(next);
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
    const session = beginTransformSession(historyRef.current.present, next, {
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
  function commit(next: Project | ((p: Project) => Project), manual = true) {
    cancelTransform();
    if (candidateRef.current) return;
    setPlaying(false);
    setProgress(0);
    writeHistory((h) => {
      const p = typeof next === "function" ? next(h.present) : next;
      if (p === h.present) return h;
      return {
        past: [...h.past, h.present].slice(-60),
        present: manual ? { ...p, source: "用户手动编排" } : p,
        future: [],
      };
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
    });
  }
  function addModel(kind: ModelKind) {
    if (candidateRef.current) return;
    setPreview(false);
    if (view === "drone") setView("perspective");
    const m = makeModel(kind, historyRef.current.present.models.length + 1);
    commit((p) => ({ ...p, models: [...p.models, m] }));
    select({ type: "model", id: m.id });
    setTool("translate");
  }
  function addDrone() {
    if (candidateRef.current) return;
    setPreview(false);
    if (view === "drone") setView("perspective");
    const d = makeDrone(historyRef.current.present.drones.length + 1);
    commit((p) => ({ ...p, drones: [...p.drones, d] }));
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
    const current = historyRef.current.present;
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
    commit((p) => clearTiming({ ...p, viewpoints: [...p.viewpoints, v] }));
    select({ type: "viewpoint", id: v.id });
    setTool("translate");
    setMessage("拍摄点已添加，可调整高度或指定镜头目标。");
  }
  function undo() {
    cancelTransform();
    setPlaying(false);
    setCandidate(null);
    setProgress(0);
    writeHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1)!,
            future: [h.present, ...h.future],
          }
        : h,
    );
  }
  function redo() {
    cancelTransform();
    setCandidate(null);
    setPlaying(false);
    setProgress(0);
    writeHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }
  function remove() {
    const selected = selectionRef.current;
    if (!selected || candidateRef.current) return;
    const m = historyRef.current.present.models.find((m) => m.id === selected.id);
    if (m?.locked) {
      setMessage("请先解锁对象。");
      return;
    }
    commit((p) => clearTiming(removeObject(p, selected.type, selected.id)));
    select(null);
  }
  function duplicate() {
    const selected = selectionRef.current;
    if (!selected || candidateRef.current) return;
    const source = historyRef.current.present;
    if (selected.type === "model") {
      const m = source.models.find((m) => m.id === selected.id);
      if (!m || m.locked) return;
      const copy = {
        ...structuredClone(m),
        id: uid(),
        name: m.name + " 副本",
        position: [m.position[0] + 5, m.position[1], m.position[2] + 5] as Vec3,
      };
      commit((p) => ({ ...p, models: [...p.models, copy] }));
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
      }));
      select({ type: "drone", id: copy.id });
    }
  }
  function replace(p: Project) {
    setCandidate(null);
    commit(p, false);
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
    committedProject: history.present,
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
    newProject: () => replace(emptyProject()),
    example: () => replace(exampleProject()),
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
