import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Group, Raycaster, Vector2, type Plane, type Vector3 } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { flushSync } from "react-dom";
import { useEditor } from "../../core/editor";
import type { Selection, Vec3 } from "../../core/types";
import { dragPosition, editingPlane, planeHit, yawDegrees } from "../../scene/dragMath";

type Pick = NonNullable<Selection>;
type Field = "position" | "target";
type Editor = ReturnType<typeof useEditor>;
function selectedItem(e: Editor) {
  const s = e.selection;
  const project = e.readProject();
  return s?.type === "model" ? project.models.find(x => x.id === s.id)
    : s?.type === "drone" ? project.drones.find(x => x.id === s.id)
    : project.viewpoints.find(x => x.id === s?.id);
}
type Gesture = { pointer: number; field: Field; kind: "gizmo" | "body"; origin: Vec3; start: Vector3; plane: Plane; size?: Vec3; rotation?: number; started?: boolean; x: number; y: number; lastX: number; lastY: number; virtualX: number; virtualY: number };
import { InputContext, type SceneInput } from "../../scene/sceneInput";

export function EditorControls({ children }: { children: ReactNode }) {
  const e = useEditor();
  const { camera, gl, scene, get } = useThree();
  const latest = useRef(e);
  latest.current = e;
  const handle = useRef<TransformControls | null>(null);
  const proxy = useRef<Group | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressUntil = useRef(0);
  const input = useRef<SceneInput>({ begin: () => {}, suppressClick: () => performance.now() < suppressUntil.current });
  const cancelNative = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const controls = new TransformControls(camera, canvas);
    // Own the event lifecycle in capture phase so a handle drag cannot also select the ground.
    controls.disconnect();
    const helper = controls.getHelper();
    helper.userData.editorOverlay = true;
    const object = new Group();
    scene.add(object, helper);
    handle.current = controls;
    proxy.current = object;
    const raycaster = new Raycaster();
    const pointer = (event: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((event.clientX - r.left) / r.width) * 2 - 1, y: -((event.clientY - r.top) / r.height) * 2 + 1, button: event.button } as PointerEvent;
    };
    const ray = (event: PointerEvent) => {
      const p = pointer(event);
      raycaster.setFromCamera(new Vector2(p.x, p.y), camera);
      return raycaster.ray;
    };
    const navigation = (enabled: boolean) => {
      const orbit = get().controls as unknown as { enabled: boolean } | null;
      if (orbit) orbit.enabled = enabled && latest.current.view !== "drone";
    };
    const release = (commit: boolean) => {
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      controls.dragging = false;
      controls.axis = null;
      if (commit) latest.current.finishTransform();
      else latest.current.cancelTransform();
      suppressUntil.current = performance.now() + 250;
      if (canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer);
      canvas.style.cursor = "";
      navigation(true);
    };
    cancelNative.current = () => release(false);
    const claim = (event: PointerEvent, current: Gesture) => {
      gesture.current = current;
      navigation(false);
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };
    input.current.begin = (event, selection, field = "position") => {
      const current = latest.current;
      if (event.button !== 0 || event.altKey || gesture.current || current.preview || current.candidate || current.view === "drone" || !["select", "translate"].includes(current.tool)) return;
      const project = current.readProject();
      const item = selection.type === "model" ? project.models.find(x => x.id === selection.id)
        : selection.type === "drone" ? project.drones.find(x => x.id === selection.id)
        : project.viewpoints.find(x => x.id === selection.id);
      if (!item || ("locked" in item && item.locked)) return;
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      current.select(selection);
      current.setTransformTarget(field);
      const origin = field === "target" && "target" in item ? item.target : item.position;
      const plane = editingPlane(current.view, origin);
      const start = planeHit(ray(event.nativeEvent), plane);
      if (!start) {
        current.setMessage("当前角度不便拖动，请切换俯视或使用坐标轴。");
        return;
      }
      if (!current.beginTransform(selection)) return;
      claim(event.nativeEvent, { pointer: event.pointerId, field, kind: "body", origin: [...origin], start, plane, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, virtualX: event.clientX, virtualY: event.clientY });
    };
    const down = (event: PointerEvent) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches("input,textarea,[contenteditable=true]")) {
        flushSync(() => focused.blur());
        // The input may have moved the selected object before this pointer event is picked.
        const item = selectedItem(latest.current);
        if (item) {
          object.position.set(...(latest.current.transformTarget === "target" && "target" in item ? item.target : item.position));
          object.rotation.set(0, "rotation" in item ? item.rotation * Math.PI / 180 : 0, 0);
          object.scale.set(1, 1, 1);
          scene.updateMatrixWorld(true);
        }
      }
      const current = latest.current;
      if (event.button !== 0 || event.altKey || gesture.current || !controls.enabled || !controls.object) return;
      controls.pointerHover(pointer(event));
      if (!controls.axis || !current.selection) return;
      const item = selectedItem(current);
      if (!item || !current.beginTransform(current.selection)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const field = current.selection.type === "viewpoint" ? current.transformTarget : "position";
      const origin = field === "target" && "target" in item ? item.target : item.position;
      const plane = editingPlane(current.view, origin);
      const body = controls.mode === "translate" && controls.axis === "XYZ";
      const start = body ? planeHit(ray(event), plane) : object.position.clone();
      if (!start) { current.cancelTransform(); return; }
      claim(event, { pointer: event.pointerId, field, kind: body ? "body" : "gizmo", origin: [...origin], plane, start, size: "size" in item ? [...item.size] : undefined, rotation: "rotation" in item ? item.rotation : 0, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, virtualX: event.clientX, virtualY: event.clientY });
      if (!body) {
        controls.pointerDown(pointer(event));
        if (!controls.dragging) release(false);
      }
    };
    const move = (event: PointerEvent, consume = true) => {
      const current = gesture.current;
      if (!current) {
        if (event.target === canvas && controls.enabled && controls.object) {
          controls.pointerHover(pointer(event));
          canvas.style.cursor = controls.axis ? "grab" : "";
        }
        return;
      }
      if (event.pointerId !== current.pointer) return;
      if (consume) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 2) return;
      current.started = true;
      const factor = event.shiftKey ? 0.1 : 1;
      current.virtualX += (event.clientX - current.lastX) * factor;
      current.virtualY += (event.clientY - current.lastY) * factor;
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      const virtual = { clientX: current.virtualX, clientY: current.virtualY, button: -1 } as PointerEvent;
      if (current.kind === "body") {
        const end = planeHit(ray(virtual), current.plane);
        if (end) latest.current.updateTransform({ [current.field]: dragPosition(current.origin, current.start, end, false) });
      } else {
        controls.pointerMove(pointer(virtual));
      }
    };
    const change = () => {
      const current = gesture.current;
      if (!current || current.kind !== "gizmo") return;
      const values: Record<string, unknown> = { [current.field]: object.position.toArray() };
      if (controls.mode === "rotate") values.rotation = yawDegrees(object.quaternion, current.rotation);
      if (controls.mode === "scale" && current.size)
        values.size = current.size.map((n, i) => Math.max(0.1, Math.abs(n * object.scale.getComponent(i))));
      latest.current.updateTransform(values);
    };
    const up = (event: PointerEvent) => {
      if (!gesture.current || gesture.current.pointer !== event.pointerId || event.button !== 0) return;
      // OrbitControls may have observed body pointerdown before R3F claimed it.
      // Let pointerup reach its document listener so it can clear pointer state.
      move(event, false);
      controls.pointerUp(pointer(event));
      release(true);
    };
    const cancel = () => release(false);
    const key = (event: KeyboardEvent) => {
      if (!gesture.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        release(false);
      }
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressUntil.current) event.stopImmediatePropagation();
    };
    const lost = () => { if (gesture.current) release(false); };
    controls.addEventListener("objectChange", change);
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("click", click, true);
    canvas.addEventListener("lostpointercapture", lost);
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      release(false);
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("click", click, true);
      canvas.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      controls.removeEventListener("objectChange", change);
      controls.detach();
      controls.dispose();
      scene.remove(object, helper);
      handle.current = null;
      proxy.current = null;
      input.current.begin = () => {};
      navigation(true);
    };
  }, [camera, gl, scene, get]);

  useEffect(() => {
    if (!e.isTransforming && gesture.current) cancelNative.current();
  }, [e.isTransforming, e.selection?.id, e.tool, e.view, e.preview]);

  useFrame(() => {
    const c = handle.current, p = proxy.current, current = latest.current;
    if (!c || !p) return;
    const item = selectedItem(current), s = current.selection;
    const editable = item && s && !("locked" in item && item.locked) && !("visible" in item && !item.visible)
      && (!("droneId" in item) || current.readProject().drones.some(d => d.id === item.droneId && d.visible));
    const supported = current.tool === "translate" || (current.tool === "rotate" && s?.type !== "viewpoint") || (current.tool === "scale" && s?.type === "model");
    c.enabled = !!editable && supported && !current.preview && !current.candidate && current.view !== "drone";
    if (!c.enabled || !item || !s) { c.detach(); return; }
    const field = s.type === "viewpoint" ? current.transformTarget : "position";
    if (!gesture.current || gesture.current.kind === "body" || current.tool === "translate") {
      p.position.set(...(field === "target" && "target" in item ? item.target : item.position));
      p.rotation.set(0, "rotation" in item ? item.rotation * Math.PI / 180 : 0, 0);
      p.scale.set(1, 1, 1);
    }
    c.setMode(current.tool as "translate" | "rotate" | "scale");
    c.setSpace("world");
    c.setSize(0.9);
    // Snapping is applied to changed axes by the editor transaction, never to locked axes.
    c.translationSnap = null;
    c.rotationSnap = null;
    c.showX = current.tool !== "rotate" && current.view !== "side";
    c.showZ = current.tool !== "rotate" && current.view !== "front";
    c.showY = current.tool === "rotate" || (current.view !== "top" && !(current.lockHeight && field === "position" && current.tool === "translate"));
    if (c.object !== p) c.attach(p);
    p.updateMatrixWorld();
  });
  return <InputContext.Provider value={input.current}>{children}</InputContext.Provider>;
}
