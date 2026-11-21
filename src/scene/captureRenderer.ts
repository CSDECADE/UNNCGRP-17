// Offscreen renderer for simulated photos. It uses its own WebGL context and a scene that holds
// only the reference model, so editor overlays, the proxy and selection never appear in photos.
import { Color, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import type { BuildingFrame, MeshAsset } from "../core/reconstruction";
import { cameraUpApp } from "../core/capture/format";
import type { Vec3 } from "../core/types";
import { instantiate, loadGlb } from "./meshLoader";

export type Shot = { position: Vec3; target: Vec3; fov: number };

export async function createCaptureRenderer(reference: MeshAsset, frame: BuildingFrame, width: number, height: number) {
  const gltf = await loadGlb(reference);
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const gl = renderer.getContext();
  const max = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
  if (width > max || height > max) {
    renderer.dispose();
    throw new Error(`照片尺寸超过显卡支持的 ${max} 像素`);
  }
  const scene = new Scene();
  // Overcast sky; the textures already carry the scene's lighting.
  scene.background = new Color("#c7d3de");
  scene.add(instantiate(gltf, frame, "reference"));
  const camera = new PerspectiveCamera(60, width / height, 0.1, 5000);
  return {
    async shoot(shot: Shot, quality: number): Promise<Uint8Array> {
      camera.fov = shot.fov;
      camera.position.set(...shot.position);
      camera.up.set(...cameraUpApp(shot.position, shot.target));
      camera.lookAt(...shot.target);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new Error("无法编码照片");
      return new Uint8Array(await blob.arrayBuffer());
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
