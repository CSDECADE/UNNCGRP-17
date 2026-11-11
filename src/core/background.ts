import type { SceneBackground } from "./types.ts";
import { ProjectValidationError } from "./feedback.ts";

export const DEFAULT_SCENE_BACKGROUND: SceneBackground = {
  mode: "color",
  color: "#1e1e1e",
  grid: true,
};
export const MAX_BACKGROUND_DATA_URL_LENGTH = 1_200_000;
export const MAX_BACKGROUND_EDGE = 2048;

const fail = (message: string): never => { throw new ProjectValidationError(message); };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail("背景设置格式无效");
const dimension = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_BACKGROUND_EDGE
    ? value
    : fail("背景图片尺寸无效");

function imageDataUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_BACKGROUND_DATA_URL_LENGTH)
    return fail("背景图片大小超出支持范围");
  const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!prefix) return fail("背景图片格式不受支持");
  const payload = value.slice(prefix[0].length);
  if (!payload.length || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload))
    return fail("背景图片编码无效");
  let bytes: string;
  try { bytes = atob(payload); }
  catch { return fail("背景图片编码无效"); }
  // Canvas exports canonical base64. Reject malformed padding and non-zero pad bits.
  if (btoa(bytes) !== payload) return fail("背景图片编码无效");
  const startsWith = (magic: number[]) => magic.every((byte, index) => bytes.charCodeAt(index) === byte);
  const valid = prefix[1] === "png"
    ? startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : prefix[1] === "jpeg"
      ? startsWith([0xff, 0xd8, 0xff])
      : bytes.length >= 12 && bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP";
  if (!valid) return fail("背景图片内容与格式不符");
  return value;
}

export function validateBackground(input: unknown): SceneBackground {
  const background = record(input);
  if (background.mode !== "color" && background.mode !== "image") fail("背景显示方式无效");
  if (typeof background.color !== "string" || !/^#[0-9a-f]{6}$/i.test(background.color)) fail("背景颜色格式无效");
  if (typeof background.grid !== "boolean") fail("背景网格设置无效");
  const result: SceneBackground = {
    mode: background.mode as SceneBackground["mode"],
    color: background.color as string,
    grid: background.grid as boolean,
  };
  if (background.image !== undefined) {
    const image = record(background.image);
    if (typeof image.name !== "string" || !image.name.trim() || image.name.length > 160) fail("背景图片名称无效");
    result.image = {
      name: image.name as string,
      dataUrl: imageDataUrl(image.dataUrl),
      width: dimension(image.width),
      height: dimension(image.height),
    };
  }
  if (result.mode === "image" && !result.image) fail("背景图片缺失");
  return result;
}
