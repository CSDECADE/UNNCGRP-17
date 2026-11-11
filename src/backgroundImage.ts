import { MAX_BACKGROUND_DATA_URL_LENGTH, MAX_BACKGROUND_EDGE } from "./core/background";
import type { SceneBackground } from "./core/types";
import { UserInputError } from "./core/feedback";

const MAX_FILE_BYTES = 20_000_000;
function asDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new UserInputError("无法读取这张图片，请重新选择。"));
    reader.readAsDataURL(blob);
  });
}
export async function prepareBackgroundImage(file: File): Promise<NonNullable<SceneBackground["image"]>> {
  if (file.size > MAX_FILE_BYTES) throw new UserInputError("图片超过 20 MB，请选择较小的图片。");
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((n, i) => head[i] === n);
  const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  const webp = String.fromCharCode(...head.slice(0,4)) === "RIFF" && String.fromCharCode(...head.slice(8,12)) === "WEBP";
  if (!png && !jpeg && !webp) throw new UserInputError("请选择 PNG、JPEG 或 WebP 图片。");
  const url = URL.createObjectURL(file), image = new Image(), canvas = document.createElement("canvas");
  try {
    image.src = url;
    try { await image.decode(); }
    catch { throw new UserInputError("这张图片无法打开，请选择其他图片。"); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000)
      throw new UserInputError("图片尺寸过大，请先缩小图片。");
    let edge = MAX_BACKGROUND_EDGE;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ratio = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new UserInputError("暂时无法处理图片，请重试。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = attempt % 2 === 0 ? 0.86 : 0.68;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (!blob) throw new UserInputError("暂时无法处理图片，请重试。");
      const dataUrl = await asDataUrl(blob);
      if (dataUrl.length <= MAX_BACKGROUND_DATA_URL_LENGTH)
        return { name: file.name.slice(0, 160) || "背景图片", dataUrl, width: canvas.width, height: canvas.height };
      if (attempt % 2 === 1) edge = Math.round(edge * 0.7);
    }
    throw new UserInputError("图片内容过大，请选择较小的图片。");
  } finally {
    URL.revokeObjectURL(url);
    image.removeAttribute("src");
    canvas.width = canvas.height = 1;
  }
}
