import { useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { parseProject } from "../../core/project";
import { fileErrorMessage, projectForSave, UserInputError, type FileOperation } from "../../core/feedback";
import type { ProjectFileControls } from "../contracts";

async function download(
  data: unknown,
  name: string,
  kind: "project" | "export" = "export",
  saveAs = false,
) {
  if (window.p15Desktop) {
    return window.p15Desktop.saveFile({
      kind,
      name,
      text: JSON.stringify(data, null, 2),
      saveAs,
    });
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { name };
}
export function useProjectFiles(close: () => void, acceptPlan: (text: string) => void): ProjectFileControls {
  const e = useEditor();
  const fileInput = useRef<HTMLInputElement>(null),
    fileMode = useRef<"project" | "plan">("project");

  const [fileError, setFileError] = useState("");
  function fileFailure(err: unknown, operation: FileOperation) {
    console.error(operation, err);
    const message = fileErrorMessage(err, operation);
    setFileError(message);
    e.setMessage("");
  }
  async function applyFile(
    text: string,
    mode: "project" | "plan",
    token?: string,
  ) {
    if (mode === "project") {
      const project = parseProject(text);
      if (token) await window.p15Desktop?.acceptOpen(token);
      e.replace(project);
      e.setMessage("项目已打开。");
    } else {
      acceptPlan(text);
    }
    close();
  }
  async function openFile(mode: "project" | "plan") {
    e.cancelTransform();
    setFileError("");
    if (window.p15Desktop) {
      try {
        const file = await window.p15Desktop.openFile(mode);
        if (file) await applyFile(file.text, mode, file.token);
      } catch (err) {
        fileFailure(err, mode === "project" ? "open" : "import");
      }
      return;
    }
    fileMode.current = mode;
    fileInput.current?.click();
  }
  async function readFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new UserInputError("文件超过 5 MB，请选择较小的文件。");
      const text = await file.text();
      await applyFile(text, fileMode.current);
    } catch (err) {
      fileFailure(err, fileMode.current === "project" ? "open" : "import");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function save(saveAs = false) {
    setFileError("");
    try {
      if (e.isTransforming) throw new UserInputError("请先松开鼠标完成移动，或按 Esc 取消，再保存项目。");
      const result = await download(
        projectForSave(e.committedProject, e.candidate),
        `${e.project.name.replace(/[\\/:*?"<>|]/g, "-")}.p15.json`,
        "project",
        saveAs,
      );
      if (result)
        e.setMessage(
          window.p15Desktop ? `已保存：${result.name}` : "项目文件已下载。",
        );
    } catch (err) {
      fileFailure(err, "save");
    }
  }
  async function exportFile(data: unknown, name: string) {
    setFileError("");
    try {
      if (e.isTransforming) throw new UserInputError("请先完成或取消当前移动，再导出。");
      const result = await download(data, name);
      if (result) e.setMessage(`已导出：${result.name}`);
    } catch (err) {
      fileFailure(err, "export");
    }
  }
  async function startProject(example = false) {
    e.cancelTransform();
    setFileError("");
    try {
      await window.p15Desktop?.resetDocument();
      example ? e.example() : e.newProject();
      close();
    } catch (err) {
      fileFailure(err, "new");
    }
  }
  return { fileInput, fileError, setFileError, openFile, readFile, save, exportFile, startProject };
}
