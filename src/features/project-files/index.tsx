import { useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { useDocuments } from "../../core/documents";
import { isPackage } from "../../core/aeproj/package";
import { fileErrorMessage, UserInputError } from "../../core/feedback";
import type { FileMode, ProjectFileControls } from "../contracts";

const MAX_TEXT_BYTES = 5_000_000;

/** Browser build: export JSON as a download. */
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: name.replace(/[\\/:*?"<>|]/g, "-"),
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Plan files are either { version, viewpoints } or a bare array of points.
function looksLikePlan(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) || (!!value && typeof value === "object" && "viewpoints" in value);
  } catch {
    return false;
  }
}

/**
 * Project files (export and documents).
 *
 * Project save/open go through useDocuments() so that history, checkpoints and
 * background assets stay inside the .aeproj package. Plan import/export stays
 * here because the document layer explicitly leaves it to the modules.
 */
export function useProjectFiles(
  close: () => void,
  acceptPlan: (text: string) => void,
): ProjectFileControls {
  const e = useEditor();
  const docs = useDocuments();
  const fileInput = useRef<HTMLInputElement>(null);
  const mode = useRef<FileMode>("project");
  const [planError, setPlanError] = useState("");

  const fileError = planError || docs.error;
  const setFileError = (message: string) => {
    setPlanError(message);
    docs.setError(message);
  };

  function acceptPlanText(text: string) {
    try {
      acceptPlan(text);
      close();
    } catch (reason) {
      setPlanError(fileErrorMessage(reason, "import"));
    }
  }

  async function openFile(kind: FileMode) {
    setPlanError("");
    if (kind === "project") {
      // open() 内部已经 guard，并把失败原因写进 docs.error
      if (await docs.open()) close();
      return;
    }
    try {
      if (window.p15Desktop) {
        const file = await window.p15Desktop.openFile("plan");
        if (file) acceptPlanText(file.text);
      } else {
        mode.current = "plan";
        fileInput.current?.click();
      }
    } catch (reason) {
      setPlanError(fileErrorMessage(reason, "import"));
    }
  }

  async function readFile(file?: File) {
    if (!file) return;
    setPlanError("");
    try {
      if (mode.current === "plan") {
        await acceptPlanText(await file.text());
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      // .aeproj 是 ZIP；旧版项目 / 方案都是纯 JSON，按内容再分一次
      if (isPackage(bytes)) {
        if (await docs.readFile(file)) close();
        return;
      }
      const text = new TextDecoder().decode(bytes);
      if (looksLikePlan(text)) {
        acceptPlanText(text);
        return;
      }
      if (await docs.readFile(file)) close();
    } catch (reason) {
      setPlanError(fileErrorMessage(reason, "open"));
    } finally {
      mode.current = "project";
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function exportFile(data: unknown, name: string) {
    setFileError("");
    try {
      const text = JSON.stringify(data, null, 2);
      if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES)
        throw new UserInputError("文件超过 5 MB，无法保存为兼容的 JSON 文件。");
      if (window.p15Desktop) {
        if (!(await window.p15Desktop.saveFile({ kind: "export", name, text }))) return;
      } else download(text, name);
      e.setMessage("已导出 JSON。");
    } catch (reason) {
      setPlanError(fileErrorMessage(reason, "export"));
    }
  }

  async function save(saveAs = false) {
    setPlanError("");
    // 保存包含历史与检查点，由文档层完成打包；成功文案也由它给出
    await docs.save(saveAs);
  }

  async function startProject(example = false) {
    setPlanError("");
    await docs.start(example);
    close();
  }

  return { fileInput, fileError, setFileError, openFile, readFile, save, exportFile, startProject };
}
