import { UserInputError } from "../../core/errors.ts";
import type { ObjExport } from "./obj.ts";

type Desktop = { saveObjFile?: (request: { name: string; text: string }) => Promise<{ name: string } | null> };
export async function saveObjExportFile(file: ObjExport, environment: {
  desktop?: Desktop; download: (text: string, name: string, type: string) => void;
}): Promise<"saved" | "cancelled" | "download-requested"> {
  if (environment.desktop) {
    if (!environment.desktop.saveObjFile) throw new UserInputError("请重新启动桌面应用以启用 OBJ 保存功能。");
    return await environment.desktop.saveObjFile({ name: file.name, text: file.text }) ? "saved" : "cancelled";
  }
  environment.download(file.text, file.name, "text/plain;charset=utf-8");
  return "download-requested";
}
