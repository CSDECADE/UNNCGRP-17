import { Texture } from "three";

/** Fill the viewport without stretching: crop equally on opposing edges. */
export function fitBackground(texture: Texture | unknown, width: number, height: number) {
  if (!(texture instanceof Texture) || width <= 0 || height <= 0) return;
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height) return;
  const imageAspect = image.width / image.height, viewportAspect = width / height;
  const x = Math.min(1, viewportAspect / imageAspect), y = Math.min(1, imageAspect / viewportAspect);
  texture.repeat.set(x, y);
  texture.offset.set((1 - x) / 2, (1 - y) / 2);
  texture.updateMatrix();
}
