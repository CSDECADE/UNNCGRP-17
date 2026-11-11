import { clearTiming } from "./project.ts";
import type { Project, Selection, Vec3 } from "./types.ts";

export type TransformTarget = "position" | "target";
export type TransformOptions = {
  target: TransformTarget;
  snap: number;
  lockHeight: boolean;
};
export type TransformSession = {
  base: Project;
  draft: Project;
  selection: NonNullable<Selection>;
  options: TransformOptions;
};

function selectedItem(project: Project, selection: NonNullable<Selection>) {
  return selection.type === "model"
    ? project.models.find((item) => item.id === selection.id)
    : selection.type === "drone"
      ? project.drones.find((item) => item.id === selection.id)
      : project.viewpoints.find((item) => item.id === selection.id);
}

export function beginTransformSession(
  project: Project,
  selection: Selection,
  options: TransformOptions,
): TransformSession | null {
  if (!selection) return null;
  const item = selectedItem(project, selection);
  if (!item || ("locked" in item && item.locked)) return null;
  if ("visible" in item && !item.visible) return null;
  if ("droneId" in item && !project.drones.some((d) => d.id === item.droneId && d.visible)) return null;
  if (options.target === "target" && selection.type !== "viewpoint") return null;
  return { base: project, draft: project, selection: { ...selection }, options: { ...options } };
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameVector = (a: Vec3, b: Vec3) => a.every((value, i) => sameNumber(value, b[i]));
function readVector(value: unknown): Vec3 | null {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [...value] as Vec3
    : null;
}
function constrainedPosition(value: Vec3, initial: Vec3, options: TransformOptions): Vec3 {
  return value.map((n, index) => {
    if (sameNumber(n, initial[index])) return initial[index];
    if (index === 1 && options.target === "position" && options.lockHeight) return initial[1];
    const snapped = options.snap > 0 ? Math.round(n / options.snap) * options.snap : n;
    const min = index === 1 && options.target === "position" ? 0 : -10000;
    return Math.max(min, Math.min(10000, snapped));
  }) as Vec3;
}

/** Update a transient copy only. Timing is invalidated when the edit is committed. */
export function updateTransformSession(session: TransformSession, values: Record<string, unknown>): TransformSession {
  const { selection, base, options } = session;
  const initial = selectedItem(base, selection)!;
  const current = selectedItem(session.draft, selection)!;
  const next = { ...current };
  const vector = readVector(values[options.target]);
  if (options.target === "target" && "target" in next && "target" in initial) {
    if (vector) next.target = constrainedPosition(vector, initial.target, options);
  } else if (options.target === "position") {
    if (vector) next.position = constrainedPosition(vector, initial.position, options);
    if ("rotation" in next && typeof values.rotation === "number" && Number.isFinite(values.rotation))
      next.rotation = Math.max(-10000, Math.min(10000, values.rotation));
    const size = readVector(values.size);
    if ("size" in next && size)
      next.size = size.map((n) => Math.max(0.1, Math.min(10000, Math.abs(n)))) as Vec3;
  }
  const unchanged = sameVector(next.position, initial.position)
    && (!("target" in next) || !("target" in initial) || sameVector(next.target, initial.target))
    && (!("rotation" in next) || !("rotation" in initial) || sameNumber(next.rotation, initial.rotation))
    && (!("size" in next) || !("size" in initial) || sameVector(next.size, initial.size));
  if (unchanged) return { ...session, draft: base };
  const draft: Project = selection.type === "model"
    ? { ...base, models: base.models.map((m) => m.id === selection.id ? next as typeof m : m) }
    : selection.type === "drone"
      ? { ...base, drones: base.drones.map((d) => d.id === selection.id ? next as typeof d : d) }
      : { ...base, viewpoints: base.viewpoints.map((v) => v.id === selection.id ? next as typeof v : v) };
  return { ...session, draft };
}

/** A null result means nothing changed, so history and imported times stay intact. */
export function finishTransformSession(session: TransformSession): Project | null {
  if (session.draft === session.base) return null;
  return session.selection.type === "viewpoint"
    ? clearTiming(session.draft)
    : { ...session.draft, source: "用户手动编排" };
}

type TransformHistory = { past: Project[]; present: Project; future: Project[] };
/** Reject stale or cancelled completions and append exactly one history entry. */
export function commitTransformHistory<T extends TransformHistory>(history: T, session: TransformSession | null): T {
  if (!session || history.present !== session.base) return history;
  const project = finishTransformSession(session);
  if (!project) return history;
  return { ...history, past: [...history.past, history.present].slice(-60), present: project, future: [] };
}
