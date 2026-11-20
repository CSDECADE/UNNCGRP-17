import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { Group } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { OrbitControls } from "three-stdlib";
import { useEditor } from "../../core/editor";
import type { Model, Vec3 } from "../../core/types";
import { objQuaternion, objScale } from "../../core/obj-transform";
import { modelControlPose, modelControlValues } from "../../core/model-transform";
import { useSceneInput } from "../../scene/sceneInput";

type Mode = "translate" | "rotate" | "scale";

export function ObjectGizmo({ model, object, center, mode }: {
  model: Model; object: RefObject<Group | null>; center: Vec3; mode: Mode;
}) {
  const e = useEditor(), editor = useRef(e), localCenter = useRef(center);
  editor.current = e;
  localCenter.current = center;
  const { camera, gl, controls: defaultControls } = useThree();
  const orbit = defaultControls as OrbitControls | undefined;
  const input = useSceneInput();
  const control = useMemo(() => new TransformControls(camera), [camera]);
  const helper = useMemo(() => {
    const helper = control.getHelper();
    helper.name = "object-transform-gizmo";
    helper.userData = { editorOverlay: true, pickPriority: 10 };
    return helper;
  }, [control]);
  const pivot = useRef<Group>(null), active = useRef(false), stop = useRef<() => void>(() => {});

  function sync(current: Model) {
    const pose = modelControlPose(current, localCenter.current);
    if (object.current) {
      object.current.position.set(...current.position);
      object.current.quaternion.copy(objQuaternion(pose.rotation));
      object.current.scale.set(...(current.kind === "obj" ? objScale(current) : [1, 1, 1] as Vec3));
      object.current.updateMatrixWorld(true);
    }
    if (pivot.current) {
      pivot.current.position.set(...pose.position);
      pivot.current.quaternion.copy(objQuaternion(pose.rotation));
      pivot.current.scale.set(...pose.scale);
      pivot.current.updateMatrixWorld(true);
    }
  }

  // React props and the controls' mutable runtime objects follow the same draft.
  useLayoutEffect(() => { sync(model); }, [model, center]);
  useLayoutEffect(() => {
    if (active.current && !e.isTransforming) stop.current();
  }, [e.isTransforming]);

  useEffect(() => {
    const target = pivot.current;
    if (!target) return;
    let orbitWasEnabled = true;
    const currentModel = () => editor.current.readProject().models.find(m => m.id === model.id);
    const finish = (commit: boolean) => {
      if (!active.current) return;
      active.current = false;
      if (commit) editor.current.finishTransform();
      else editor.current.cancelTransform();
      control.dragging = false;
      control.axis = null;
      const current = currentModel();
      if (current) sync(current);
      input.blockClicks?.(false);
      if (orbit) orbit.enabled = orbitWasEnabled && editor.current.view !== "drone";
    };
    stop.current = () => finish(false);
    const start = () => {
      if (!editor.current.beginTransform({ type: "model", id: model.id })) {
        control.dragging = false;
        control.axis = null;
        return;
      }
      active.current = true;
      input.blockClicks?.(true);
      if (orbit) { orbitWasEnabled = orbit.enabled; orbit.enabled = false; }
    };
    const change = () => {
      if (!active.current) return;
      const current = currentModel();
      if (!current) return;
      const values = modelControlValues(current, mode, localCenter.current,
        target.position.toArray(), target.quaternion, target.scale.toArray());
      editor.current.updateTransform(values);
      const draft = currentModel();
      if (draft) sync(draft);
    };
    const commit = () => finish(true);
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !active.current) return;
      cancel();
      editor.current.setTool("select");
      event.preventDefault();
      event.stopPropagation();
    };
    const hidden = () => { if (document.hidden) cancel(); };
    const settleInput = () => {
      // A native pointerdown precedes focusout. Commit pending inspector text before
      // TransformControls caches its gesture start, rather than losing it to a drag.
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused.closest(".model-transform-inspector")) {
        focused.blur();
        const current = currentModel();
        if (current) sync(current);
        helper.updateMatrixWorld(true);
      }
    };
    control.attach(target);
    control.setMode(mode);
    control.setSpace(mode === "translate" ? "world" : "local");
    const yawOnly = model.kind !== "obj" && mode === "rotate";
    control.showX = !yawOnly;
    control.showZ = !yawOnly;
    control.showE = !yawOnly;
    control.showXYZE = !yawOnly;
    control.setSize(0.9);
    control.connect(gl.domElement);
    gl.domElement.addEventListener("pointerdown", settleInput, true);
    control.addEventListener("mouseDown", start);
    control.addEventListener("objectChange", change);
    control.addEventListener("mouseUp", commit);
    gl.domElement.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      control.removeEventListener("mouseDown", start);
      control.removeEventListener("objectChange", change);
      control.removeEventListener("mouseUp", commit);
      gl.domElement.removeEventListener("pointerdown", settleInput, true);
      gl.domElement.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", hidden);
      control.detach();
      control.dispose();
    };
  }, [control, helper, gl.domElement, mode, model.id, model.kind, orbit, input.blockClicks]);

  return <>
    <group ref={pivot} name="object-transform-pivot" />
    <primitive object={helper} dispose={null}
      onPointerDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
      onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()} />
  </>;
}
