import { useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { UserInputError, fileErrorMessage } from "../../core/feedback";
import { downloadText } from "../../core/download";
import { exportSelectedObj } from "./obj";
import { saveObjExportFile } from "./save";

export function useObjExport(setError: (message: string) => void) {
  const e = useEditor(), editor = useRef(e), pending = useRef(false);
  editor.current = e;
  const [busy, setBusy] = useState(false);
  const available = !busy && !e.isTransforming && !e.candidate && e.selection?.type === "model" &&
    e.committedProject.models.some(m => m.id === e.selection?.id && m.kind === "obj");
  async function exportFile() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const current = editor.current;
      if (current.isTransforming || current.candidate)
        throw new UserInputError("请先完成或取消当前操作或方案预览，再导出 OBJ。");
      const file = exportSelectedObj(current.committedProject, current.selection);
      const result = await saveObjExportFile(file, { desktop: window.p15Desktop, download: downloadText });
      editor.current.setMessage(result === "saved" ? "OBJ 文件已保存。" : result === "cancelled" ? "已取消 OBJ 导出。" :
        "已请求下载 OBJ 文件，请确认浏览器已完成保存。");
    } catch (error) { setError(fileErrorMessage(error, "export")); }
    finally { pending.current = false; setBusy(false); }
  }
  return { available, busy, exportFile };
}
