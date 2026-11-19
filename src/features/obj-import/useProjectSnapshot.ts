import { useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { fileErrorMessage, projectForSave, UserInputError } from "../../core/feedback";
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from "../../core/project";
import type { FileMode, ProjectFileControls } from "../contracts";

/** Minimal project JSON fallback when the optional project-files module is absent. */
export function useProjectSnapshot(close: () => void, acceptPlan: (text: string) => void): ProjectFileControls {
  const e = useEditor(), editor = useRef(e);
  editor.current = e;
  const fileInput = useRef<HTMLInputElement>(null), mode = useRef<FileMode>("project"), busy = useRef(false);
  const [fileError, setFileError] = useState("");
  const report = (error: unknown, operation: "open" | "import" | "save" | "new") =>
    setFileError(fileErrorMessage(error, operation));
  async function apply(text: string, token?: string) {
    if (mode.current === "plan") { acceptPlan(text); return; }
    const project = parseProject(text);
    if (token) await window.p15Desktop?.acceptOpen(token);
    else await window.p15Desktop?.resetDocument();
    editor.current.replace(project);
    close();
    editor.current.setMessage("项目已恢复（包含 OBJ 资源）。");
  }
  async function openFile(nextMode: FileMode) {
    if (busy.current) return;
    setFileError("");
    mode.current = nextMode;
    if (!window.p15Desktop) { fileInput.current?.click(); return; }
    busy.current = true;
    try {
      const result = await window.p15Desktop.openFile(nextMode);
      if (result) await apply(result.text, result.token);
    } catch (error) { report(error, nextMode === "plan" ? "import" : "open"); }
    finally { busy.current = false; }
  }
  async function readFile(file?: File) {
    if (!file || busy.current) return;
    busy.current = true;
    setFileError("");
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new UserInputError("文件超过 5 MB，请选择较小的文件。");
      await apply(await file.text());
    } catch (error) { report(error, mode.current === "plan" ? "import" : "open"); }
    finally {
      busy.current = false;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function save(saveAs = false) {
    if (busy.current) return;
    setFileError("");
    busy.current = true;
    try {
      const current = editor.current;
      if (current.isTransforming) throw new UserInputError("请先完成或取消当前操作，再保存项目。");
      const project = projectForSave(current.committedProject, current.candidate);
      const text = serializeProject(project), name = `${project.name}.p15.json`;
      if (window.p15Desktop) {
        const result = await window.p15Desktop.saveFile({ kind: "project", name, text, saveAs });
        if (!result) return;
        current.setMessage("项目文件已保存。");
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name.replace(/[\\/:*?"<>|]/g, "-");
        document.body.appendChild(anchor);
        try { anchor.click(); }
        finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        current.setMessage("已请求下载项目文件，请确认浏览器已完成保存。");
      }
    } catch (error) { report(error, "save"); }
    finally { busy.current = false; }
  }
  return {
    fileInput, fileError, setFileError, openFile, readFile, save,
    exportFile: async () => { editor.current.setMessage("此基础文件功能仅支持完整项目 JSON 的保存与恢复。"); },
    startProject: async (example = false) => {
      if (busy.current) return;
      busy.current = true;
      setFileError("");
      try {
        await window.p15Desktop?.resetDocument();
        example ? editor.current.example() : editor.current.newProject();
        close();
      } catch (error) { report(error, "new"); }
      finally { busy.current = false; }
    },
  };
}
