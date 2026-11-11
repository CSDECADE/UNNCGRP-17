import type { Project } from "./types.ts";

/** Undo depth kept in memory and in .aeproj packages. */
export const HISTORY_LIMIT = 50;
export const DEFAULT_HISTORY_LABEL = "编辑场景";

export type HistoryEntry = {
  project: Project;
  /** Short description of the edit that produced this state. */
  label: string;
  /** Unix epoch milliseconds. */
  at: number;
};
export type History = {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
};
export type Checkpoint = {
  id: string;
  name: string;
  createdAt: number;
  project: Project;
};
/** Everything an editing session needs to continue on another client. */
export type Session = {
  history: History;
  checkpoints: Checkpoint[];
};

export function entry(project: Project, label = DEFAULT_HISTORY_LABEL, at = Date.now()): HistoryEntry {
  return { project, label, at };
}
export function startHistory(project: Project, label = "打开项目", at = Date.now()): History {
  return { past: [], present: entry(project, label, at), future: [] };
}

/** Append a new state; the oldest entries are dropped beyond HISTORY_LIMIT and redo is cleared. */
export function pushHistory(h: History, project: Project, label = DEFAULT_HISTORY_LABEL, at = Date.now()): History {
  if (project === h.present.project) return h;
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present: entry(project, label, at),
    future: [],
  };
}
export function undoHistory(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) };
}
export function redoHistory(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: h.future[0], future: h.future.slice(1) };
}

/** The whole timeline, oldest first; `index` points at the present entry. */
export function timeline(h: History): { entries: HistoryEntry[]; index: number } {
  return { entries: [...h.past, h.present, ...h.future], index: h.past.length };
}
/** Move to any entry of the timeline without discarding the other side. */
export function jumpHistory(h: History, index: number): History {
  const { entries } = timeline(h);
  if (!Number.isInteger(index) || index < 0 || index >= entries.length || index === h.past.length) return h;
  // Same trimming as repeated undo/redo: each side keeps at most HISTORY_LIMIT entries.
  return {
    past: entries.slice(0, index).slice(-HISTORY_LIMIT),
    present: entries[index],
    future: entries.slice(index + 1).slice(0, HISTORY_LIMIT),
  };
}
