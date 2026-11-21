// Parse .glb bytes held in the session (no network), with the bundled Draco decoder.
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Box3, Group, Matrix4, MeshBasicMaterial, MeshStandardMaterial, type Material, type Mesh, type Object3D } from "three";
import type { BuildingFrame, MeshAsset } from "../core/reconstruction";

let loader: GLTFLoader | null = null;
function gltfLoader() {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}

const cache = new Map<string, Promise<GLTF>>();
/** Parsed once per content hash; callers must clone before adding to a scene. */
export function loadGlb(asset: MeshAsset): Promise<GLTF> {
  let pending = cache.get(asset.sha256);
  if (!pending) {
    const { bytes } = asset;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    pending = gltfLoader().parseAsync(buffer, "");
    pending.catch(() => cache.delete(asset.sha256));
    cache.set(asset.sha256, pending);
  }
  return pending;
}

/** Rotation that maps the model's up axis onto the app's +Y. */
export function frameMatrix(frame: BuildingFrame): Matrix4 {
  const m = frame.upAxis === "z" ? new Matrix4().makeRotationX(-Math.PI / 2) : new Matrix4();
  return m.premultiply(new Matrix4().makeTranslation(...frame.offset));
}
/** Model-space bounds, used to centre the building (see centredOffset). */
export function modelBounds(gltf: GLTF): { min: [number, number, number]; max: [number, number, number] } {
  const box = new Box3().setFromObject(gltf.scene);
  return { min: box.min.toArray(), max: box.max.toArray() };
}

/**
 * Clone for display or capture. Photogrammetry textures already contain the lighting, so the
 * reference is drawn unlit; the proxy gets a uniform light-grey lit material.
 */
export function instantiate(gltf: GLTF, frame: BuildingFrame, style: "reference" | "proxy"): Group {
  const root = new Group();
  root.matrixAutoUpdate = false;
  root.matrix.copy(frameMatrix(frame));
  const model = gltf.scene.clone(true);
  const converted = new Map<Material, Material>();
  model.traverse((o: Object3D) => {
    if (!("isMesh" in o)) return;
    const mesh = o as Mesh;
    const convert = (m: Material) => {
      let next = converted.get(m);
      if (!next) {
        const map = (m as MeshStandardMaterial).map ?? null;
        next = style === "reference"
          ? new MeshBasicMaterial({ map, color: map ? 0xffffff : (m as MeshStandardMaterial).color })
          : new MeshStandardMaterial({ color: 0xdfe2e8, roughness: 0.9, metalness: 0 });
        converted.set(m, next);
      }
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    mesh.castShadow = style === "proxy";
    mesh.receiveShadow = style === "proxy";
  });
  root.add(model);
  return root;
}
