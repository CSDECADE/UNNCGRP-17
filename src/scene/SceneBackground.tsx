import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, Color, SRGBColorSpace, TextureLoader } from "three";
import { useEditor } from "../core/editor";
import { DEFAULT_SCENE_BACKGROUND, MAX_BACKGROUND_EDGE } from "../core/background";

export function SceneBackground() {
  const e = useEditor(), { scene } = useThree();
  const background = e.project.background ?? DEFAULT_SCENE_BACKGROUND;
  const dataUrl = background.mode === "image" ? background.image?.dataUrl : undefined;
  useEffect(() => {
    let active = true;
    let composite: HTMLCanvasElement | undefined;
    let displayTexture: CanvasTexture | undefined;
    const color = new Color(background.color);
    scene.background = color;
    if (!dataUrl) return () => { if (scene.background === color) scene.background = null; };
    const texture = new TextureLoader().load(dataUrl, loaded => {
      if (!active) { loaded.dispose(); return; }
      const source = loaded.image as HTMLImageElement;
      if (!source.naturalWidth || !source.naturalHeight || Math.max(source.naturalWidth, source.naturalHeight) > MAX_BACKGROUND_EDGE) {
        loaded.dispose();
        e.setMessage("背景图片尺寸不受支持，请重新选择图片。");
        return;
      }
      composite = document.createElement("canvas");
      composite.width = source.naturalWidth;
      composite.height = source.naturalHeight;
      const context = composite.getContext("2d");
      if (!context) { loaded.dispose(); e.setMessage("背景图片无法显示，请重新选择图片。"); return; }
      context.fillStyle = background.color;
      context.fillRect(0, 0, composite.width, composite.height);
      context.drawImage(source, 0, 0);
      displayTexture = new CanvasTexture(composite);
      displayTexture.colorSpace = SRGBColorSpace;
      scene.background = displayTexture;
      loaded.dispose();
    }, undefined, () => {
      if (active) e.setMessage("背景图片无法显示，请重新选择图片。");
    });
    return () => {
      active = false;
      if (scene.background === displayTexture || scene.background === color) scene.background = null;
      texture.dispose();
      displayTexture?.dispose();
      if (composite) composite.width = composite.height = 1;
    };
  }, [scene, dataUrl, background.color]);
  return null;
}
