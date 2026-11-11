import type { ComponentType, ReactNode } from "react";
import { useEditor } from "../core/editor";
import { useDocuments } from "../core/documents";
import type { AnalysisPanelProps, Editor, ProjectFileControls } from "./contracts";

// Each optional entry is discovered at build time. Missing modules have shell fallbacks.
type FilesModule = { useProjectFiles: (close: () => void, acceptPlan: (text: string) => void) => ProjectFileControls };
type AnalysisModule = {
  acceptPlan: (text: string, editor: Editor, playbackAvailable: boolean) => void;
  AnalysisPanel: ComponentType<AnalysisPanelProps>;
  CandidateBanner: ComponentType<{ clearError: () => void }>;
};
export const projectFiles = import.meta.glob<FilesModule>("./project-files/index.tsx", { eager: true })["./project-files/index.tsx"];
export const analysis = import.meta.glob<AnalysisModule>("./analysis/index.tsx", { eager: true })["./analysis/index.tsx"];
export const playback = import.meta.glob<{ Playback: ComponentType }>("./playback/index.tsx", { eager: true })["./playback/index.tsx"];
export const manualInspector = import.meta.glob<{ Inspector: ComponentType }>("./manual/Inspector.tsx", { eager: true })["./manual/Inspector.tsx"];
export const manualControls = import.meta.glob<{ EditorControls: ComponentType<{ children: ReactNode }> }>("./manual/EditorControls.tsx", { eager: true })["./manual/EditorControls.tsx"];
const help = import.meta.glob<{ Help: ComponentType }>("./project-files/Help.tsx", { eager: true })["./project-files/Help.tsx"];

// Projects are .aeproj packages handled by core/documents; plan import/export needs the files module.
function useBaseProjectFiles(close: () => void): ProjectFileControls {
  const e = useEditor();
  const docs = useDocuments();
  const unavailable = async () => { e.setMessage("请先加载导出和文档模块。"); };
  return {
    fileInput: { current: null }, fileError: docs.error, setFileError: docs.setError,
    openFile: async (mode) => {
      if (mode === "plan") return unavailable();
      if (await docs.open()) close();
    },
    readFile: async (file) => {
      if (await docs.readFile(file)) close();
    },
    save: async (saveAs = false) => { await docs.save(saveAs); },
    exportFile: unavailable,
    startProject: async (example = false) => {
      await docs.start(example);
      close();
    },
  };
}

const Empty = () => null;
export const useProjectFiles = projectFiles?.useProjectFiles ?? useBaseProjectFiles;
export const Playback = playback?.Playback ?? Empty;
export const AnalysisPanel = analysis?.AnalysisPanel ?? Empty;
export const CandidateBanner = analysis?.CandidateBanner ?? Empty;
export const Help = help?.Help ?? (() => <p>从资源库添加对象，在空白处拖动可旋转透视视角。</p>);
