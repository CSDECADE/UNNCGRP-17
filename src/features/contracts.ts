import type { RefObject } from "react";
import type { useEditor } from "../core/editor";

export type Editor = ReturnType<typeof useEditor>;
export type FileMode = "project" | "plan";
export interface ProjectFileControls {
  fileInput: RefObject<HTMLInputElement | null>;
  fileError: string;
  setFileError: (message: string) => void;
  openFile: (mode: FileMode) => Promise<void>;
  readFile: (file?: File) => Promise<void>;
  save: (saveAs?: boolean) => Promise<void>;
  exportFile: (data: unknown, name: string) => Promise<void>;
  startProject: (example?: boolean) => Promise<void>;
}
export type AnalysisPanelProps = Pick<ProjectFileControls, "openFile" | "exportFile"> & { filesAvailable: boolean };
