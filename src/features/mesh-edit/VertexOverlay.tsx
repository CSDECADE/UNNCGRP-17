import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Group, type Mesh, type Object3D } from "three";
import { useEditor } from "../../core/editor";
import { objMatrix } from "../../core/obj-transform";
import { elementKey, meshEdges, meshVertexIndices, pickLogicalEdge, pickLogicalFace, pickLogicalVertex, resolveElement, selectionMode, vertexVisible } from "../../core/mesh-edit";
import { useSceneInput } from "../../scene/sceneInput";
import { ObjectGizmo } from "../obj-transform/ObjectGizmo";

export function VertexOverlay() {
  const e = useEditor(), editor = useRef(e); editor.current = e;
  const { camera, gl, scene } = useThree(), input = useSceneInput();
  const unusedObject = useRef<Group>(null);
  const selected = e.meshSelection, target = selected && resolveElement(e.project, selected);
  const kind = selected ? selectionMode(selected) : "vertex";
  const geometry = useMemo(() => {
    const geometry = new BufferGeometry();
    if (target && selected) {
      const indices = kind === "edge" ? meshEdges(target.resource, selected.meshId).flatMap(edge => edge.indices)
        : meshVertexIndices(target.resource, selected.meshId);
      geometry.setAttribute("position", new Float32BufferAttribute(indices.flatMap(i => target.resource.vertices[i].position), 3));
    }
    return geometry;
  }, [target?.resource, selected?.meshId, kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const highlight = useMemo(() => {
    const geometry = new BufferGeometry();
    if (target?.pivot) geometry.setAttribute("position", new Float32BufferAttribute(
      (kind === "vertex" ? target.indices : target.elementIndices.flat()).flatMap(i => target.resource.vertices[i].position), 3));
    return geometry;
  }, [target?.resource, selected && elementKey(selected)]);
  useEffect(() => () => highlight.dispose(), [highlight]);
  useEffect(() => {
    const canvas = gl.domElement;
    let down: { x: number; y: number; toggle: boolean } | null = null;
    const previousTabIndex = canvas.tabIndex; canvas.tabIndex = 0;
    const start = (event: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      down = event.button === 0 ? { x: event.clientX, y: event.clientY, toggle: event.shiftKey } : null;
    };
    const shiftStart = (event: PointerEvent) => {
      if (event.button !== 0 || !event.shiftKey) return;
      // Shift+left is reserved for selection in Edit Mode; prevent OrbitControls'
      // modifier-pan and the gizmo from starting on this same pointer gesture.
      start(event); event.stopImmediatePropagation();
    };
    const end = (event: PointerEvent) => {
      const origin = down; down = null;
      const current = editor.current, selection = current.meshSelection;
      if (!origin || Math.hypot(origin.x - event.clientX, origin.y - event.clientY) > 3 ||
        input.suppressClick() || current.isTransforming || !selection || current.preview || current.playing || current.candidate) return;
      const resolved = resolveElement(current.readProject(), selection);
      if (!resolved) return;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const occluders: Object3D[] = [];
      scene.traverse(object => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || !mesh.visible || !mesh.material) return;
        // Editor helpers, labels, controls and transparent ground are not surfaces.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials.some(material => (material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial && material.visible && material.opacity > 0)) return;
        for (let parent: Object3D | null = object; parent; parent = parent.parent)
          if (!parent.visible || (parent.userData.editorOverlay && !parent.name.startsWith("drone-"))) return;
        occluders.push(object);
      });
      const rect = canvas.getBoundingClientRect();
      const options = { resource: resolved.resource, meshId: selection.meshId,
        matrix: objMatrix(resolved.model), camera, pointer: { x: event.clientX - rect.x, y: event.clientY - rect.y },
        width: rect.width, height: rect.height, visible: (point: import("three").Vector3) => vertexVisible(point, camera, occluders) };
      const base = { modelId: selection.modelId, meshId: selection.meshId };
      if (selectionMode(selection) === "edge") current.pickMeshElement({ ...base, kind: "edge", edgeIds: pickLogicalEdge(options) }, origin.toggle);
      else if (selectionMode(selection) === "face") current.pickMeshElement({ ...base, kind: "face",
        triangle: pickLogicalFace({ ...options, objects: occluders, modelId: selection.modelId }) }, origin.toggle);
      else current.pickMeshElement({ ...base, vertexId: pickLogicalVertex(options) }, origin.toggle);
    };
    canvas.addEventListener("pointerdown", shiftStart, true);
    canvas.addEventListener("pointerdown", start); canvas.addEventListener("pointerup", end);
    const cancel = () => { down = null; };
    canvas.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
    return () => { canvas.removeEventListener("pointerdown", start); canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointerdown", shiftStart, true);
      canvas.tabIndex = previousTabIndex;
      canvas.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel); };
  }, [camera, gl.domElement, scene, input.suppressClick]);
  if (!target || !selected) return null;
  return <><group matrix={objMatrix(target.model)} matrixAutoUpdate={false} userData={{ editorOverlay: true }}>
    {kind === "vertex" && <points geometry={geometry} name="edit-vertices" raycast={() => null} renderOrder={20}>
      <pointsMaterial color="#73c4ff" size={7} sizeAttenuation={false} depthWrite={false} />
    </points>}
    {kind === "edge" && <lineSegments geometry={geometry} name="edit-edges" raycast={() => null} renderOrder={20}>
      <lineBasicMaterial color="#73c4ff" depthWrite={false} />
    </lineSegments>}
    {target.pivot && kind === "vertex" && <points geometry={highlight} name="selected-edit-vertex" raycast={() => null} renderOrder={21}>
      <pointsMaterial color="#ffb34f" size={12} sizeAttenuation={false} depthWrite={false} />
    </points>}
    {target.pivot && kind === "edge" && <>
      <lineSegments geometry={highlight} name="selected-edit-edge" raycast={() => null} renderOrder={21}>
        <lineBasicMaterial color="#ffb34f" depthWrite={false} />
      </lineSegments>
      <points geometry={highlight} raycast={() => null} renderOrder={21}>
        <pointsMaterial color="#ffb34f" size={10} sizeAttenuation={false} depthWrite={false} />
      </points>
    </>}
    {target.pivot && kind === "face" && <mesh geometry={highlight} name="selected-edit-face" raycast={() => null} renderOrder={21}>
      <meshBasicMaterial color="#ffb34f" side={DoubleSide} transparent opacity={.55} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>}
  </group>
    {target.pivot && e.tool === "translate" && !e.preview && !e.playing && !e.candidate && e.view !== "drone" &&
      <ObjectGizmo key={elementKey(selected)} model={target.model}
        object={unusedObject} center={[0, 0, 0]} mode="translate" element={selected} />}
  </>;
}
