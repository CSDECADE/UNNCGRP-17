import type { Project } from "./types.ts";

// Only explicitly authored messages may be shown; arbitrary exception text stays in logs.
export class UserInputError extends Error {}
export class ProjectValidationError extends Error {}
export type FileOperation = "open" | "import" | "save" | "export" | "new";
const actions: Record<FileOperation, string> = {
  open: "无法打开项目", import: "无法导入方案", save: "保存失败",
  export: "导出失败", new: "无法新建项目",
};
const reasons: Record<string, string> = {
  TOO_LARGE: "文件超过 5 MB，请选择较小的文件。",
  INVALID_JSON: "文件内容无法识别，请选择完整的 JSON 文件。",
  NOT_FILE: "请选择文件，而不是文件夹。",
  NOT_FOUND: "找不到文件或文件夹，请重新选择位置。",
  PERMISSION: "无法访问该位置，请检查权限或选择其他文件夹。",
  NO_SPACE: "存储空间不足，请释放空间或选择其他位置。",
  READ_ONLY: "所选位置无法写入，请选择其他文件夹。",
  EXPIRED: "请重新选择要打开的项目。",
};
export function fileErrorMessage(error: unknown, operation: FileOperation): string {
  if (error instanceof ProjectValidationError) {
    const importReasons: Record<string, string> = {
      "拍摄点引用了不存在的无人机": "方案中的无人机与当前场景不匹配。请打开对应项目，或根据当前场景重新生成方案。",
      "同一航线的时间信息必须完整": "方案中的拍摄时间不完整，请重新导出方案。",
      "航线时间必须严格递增": "方案中的拍摄时间与顺序不一致，请重新导出方案。",
      "不支持此方案版本": "此方案文件版本不受支持，请重新导出兼容的方案。",
    };
    const reason = operation === "import"
      ? importReasons[error.message] ?? "方案文件不完整或不受支持，请重新选择或重新导出方案。"
      : "项目文件不完整或不受支持，请重新选择或重新导出项目。";
    return `${actions[operation]}。${reason}`;
  }
  if (error instanceof UserInputError) return `${actions[operation]}：${error.message}`;
  const code = error instanceof Error ? error.message.match(/^AERO_FILE_([A-Z_]+)$/)?.[1] : undefined;
  const reason = code && reasons[code];
  return `${actions[operation]}。${reason || (operation === "save" || operation === "export"
    ? "请重试，或选择其他保存位置。"
    : operation === "new" ? "请重试；若仍无法新建，请重新打开应用。" : "请重试，或重新选择文件。")}`;
}
export function projectForSave(project: Project, candidate: Project | null): Project {
  if (candidate) throw new UserInputError("请先应用或取消预览中的方案，再保存项目。");
  return project;
}
export const sourceLabels: Record<Project["source"], string> = {
  内置示例: "示例方案", 用户手动编排: "自定义方案", 导入的算法结果: "导入方案",
};

export type AutosaveStatus = "saving" | "saved" | "error" | "paused";
export const autosaveLabels: Record<AutosaveStatus, string> = {
  saving: "正在暂存到本机", saved: "已暂存到本机", error: "本机暂存失败", paused: "本机暂存已暂停",
};
export function persistProject(storage: Pick<Storage, "setItem">, key: string, project: Project): AutosaveStatus {
  try {
    storage.setItem(key, JSON.stringify(project));
    return "saved";
  } catch {
    return "error";
  }
}
