// Displays the reconstruction proxy (white model) and, on request, the textured reference model.
import { useEffect, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Group } from "three";
import { useEditor } from "../core/editor";
import type { BuildingFrame, MeshAsset } from "../core/reconstruction";
import { instantiate, loadGlb } from "./meshLoader";
import { useSceneInput } from "./sceneInput";

function useInstance(asset: MeshAsset | undefined, frame: BuildingFrame, style: "reference" | "proxy") {
  const [group, setGroup] = useState<Group | null>(null);
  const { upAxis, offset } = frame;
  useEffect(() => {
    if (!asset) return setGroup(null);
    let live = true;
    loadGlb(asset)
      .then((gltf) => live && setGroup(instantiate(gltf, { upAxis, offset }, style)))
      .catch((error) => console.error("Model loading failed", error));
    return () => {
      live = false;
    };
  }, [asset?.sha256, upAxis, offset[0], offset[1], offset[2], style]);
  return group;
}

export function BuildingModels() {
  const e = useEditor(), input = useSceneInput();
  const r = e.reconstruction;
  const frame = r?.frame ?? { upAxis: "y", offset: [0, 0, 0] };
  const proxy = useInstance(r?.proxy, frame, "proxy");
  const reference = useInstance(r?.showReference ? r.reference : undefined, frame, "reference");
  // Same picking rules as built-in models: add points above the surface or aim the camera at it.
  const click = (ev: ThreeEvent<MouseEvent>) => {
    if (ev.delta > 2 || input.suppressClick()) return;
    if (e.tool === "point") {
      ev.stopPropagation();
      e.addPoint([ev.point.x, Math.max(12, ev.point.y + 5), ev.point.z]);
    } else if (e.tool === "target" && e.selection?.type === "viewpoint") {
      ev.stopPropagation();
      e.patch("viewpoint", e.selection.id, { target: ev.point.toArray() });
      e.setTool("select");
    }
  };
  return (
    <>
      {reference && <primitive object={reference} onClick={click} />}
      {proxy && !reference && <primitive object={proxy} onClick={click} />}
    </>
  );
}
