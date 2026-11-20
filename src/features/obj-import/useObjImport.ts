import { useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { MAX_OBJ_FILE_BYTES } from "../../core/obj-file";
import { UserInputError } from "../../core/errors";

export function useObjImport(setError: (message: string) => void, onImported: () => void) {
  const e = useEditor(), editor = useRef(e);
  editor.current = e;
  const input = useRef<HTMLInputElement>(null), pending = useRef(false);
  const [busy, setBusy] = useState(false);
  async function read(file?: File) {
    if (!file || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!file.name.toLowerCase().endsWith(".obj")) throw new UserInputError("请选择 .obj 文件。");
      if (file.size > MAX_OBJ_FILE_BYTES) throw new UserInputError("OBJ 文本超过 16 MB，请选择较小的文件。");
      const text = await file.text();
      editor.current.importObj(text, file.name);
      onImported();
      editor.current.setMessage("OBJ 已导入。请保存项目文件以保留完整模型。");
    } catch (error) {
      setError(error instanceof UserInputError ? `OBJ 导入失败：${error.message}` : "OBJ 导入失败，请检查文件内容或选择其他文件。");
    } finally {
      pending.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return { input, busy, read };
}
