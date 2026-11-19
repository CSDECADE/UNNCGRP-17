import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import * as dragMath from "../src/scene/dragMath.ts";
import * as projectCore from "../src/core/project.ts";
import * as backgroundCore from "../src/core/background.ts";
import * as backgroundTexture from "../src/scene/backgroundTexture.ts";
import { beginTransformSession, finishTransformSession, updateTransformSession, type TransformSession } from "../src/core/transform.ts";
import type { CameraView, Selection } from "../src/core/types.ts";

const require = createRequire(import.meta.url);

function componentModule(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}, expose = "") {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const sandbox = { exports: {} as Record<string, (...args: any[]) => any>,
    require: (name: string) => name in mocks ? mocks[name] : name === "three" ? THREE : require(name), ...globals };
  runInNewContext(compiled + expose, sandbox);
  return sandbox.exports;
}

type Pointer = {
  type: string; target: Surface; pointerId: number; pointerType: string; button: number;
  clientX: number; clientY: number; pageX: number; pageY: number;
  altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean;
  stopped: boolean; immediate: boolean; prevented: boolean;
  preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void;
};
type Listener = { callback: (event: Pointer) => void; capture: boolean };

// Small DOM propagation fixture: actual controller handlers run in capture and
// bubble order. Rendering, browser layout and React's raycast dispatch are not
// simulated; body hits are supplied at the R3F event dispatch boundary.
class Surface {
  parent: Surface | null;
  ownerDocument!: Surface;
  activeElement = null;
  style: Record<string, string> = {};
  clientWidth = 800;
  clientHeight = 600;
  listeners = new Map<string, Listener[]>();
  captured = new Set<number>();
  constructor(parent: Surface | null = null) { this.parent = parent; }
  addEventListener(type: string, callback: Listener["callback"], options?: boolean | { capture?: boolean }) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const entries = this.listeners.get(type) ?? [];
    if (!entries.some(entry => entry.callback === callback && entry.capture === capture)) entries.push({ callback, capture });
    this.listeners.set(type, entries);
  }
  removeEventListener(type: string, callback: Listener["callback"], options?: boolean | { capture?: boolean }) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry.callback !== callback || entry.capture !== capture));
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) {
    if (this.captured.delete(id)) this.dispatch("lostpointercapture", 0, 0, id);
  }
  dispatch(type: string, x: number, y: number, id = 1) {
    const event: Pointer = { type, target: this, pointerId: id, pointerType: "mouse", button: 0,
      clientX: x, clientY: y, pageX: x, pageY: y,
      altKey: false, shiftKey: false, ctrlKey: false, metaKey: false,
      stopped: false, immediate: false, prevented: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = this.immediate = true; },
    };
    const path: Surface[] = [];
    for (let node: Surface | null = this; node; node = node.parent) path.push(node);
    const invoke = (node: Surface, capture: boolean) => {
      for (const listener of [...node.listeners.get(type) ?? []]) {
        if (listener.capture === capture) listener.callback(event);
        if (event.immediate) break;
      }
    };
    for (const node of [...path].reverse()) { invoke(node, true); if (event.stopped) return event; }
    for (const node of path) { invoke(node, false); if (event.stopped) return event; }
    return event;
  }
}

function mountedControls() {
  const window = new Surface(), document = new Surface(window), connected = new Surface(document), canvas = new Surface(connected);
  connected.ownerDocument = canvas.ownerDocument = document;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
  camera.position.set(40, 35, 55);
  const orbit = new OrbitControls(camera, connected as unknown as HTMLElement);
  orbit.enableDamping = false;
  orbit.target.set(0, 10, 0);
  orbit.update();
  camera.updateMatrixWorld(true);
  let committed = projectCore.exampleProject(), session: TransformSession | null = null, commits = 0;
  committed.viewpoints[0].position = [0, 10, 0];
  const selection = { type: "viewpoint" as const, id: committed.viewpoints[0].id };
  const editor = {
    selection: null as Selection, tool: "select", view: "perspective", preview: false, candidate: null,
    transformTarget: "position" as "position" | "target", lockHeight: false,
    get isTransforming() { return session !== null; },
    readProject: () => session?.draft ?? committed,
    select(value: Selection) { this.selection = value; this.tool = "translate"; },
    setTransformTarget(value: "position" | "target") { this.transformTarget = value; },
    beginTransform(value: Selection) {
      session = beginTransformSession(committed, value, { target: this.transformTarget, snap: 0, lockHeight: false });
      return !!session;
    },
    updateTransform(values: Record<string, unknown>) { if (session) session = updateTransformSession(session, values); },
    finishTransform() {
      const result = session && finishTransformSession(session);
      if (result) { committed = result; commits++; }
      session = null;
    },
    cancelTransform() { session = null; },
    setMessage() {},
  };
  let transform!: TransformControls;
  class ObservedTransformControls extends TransformControls {
    constructor(...args: ConstructorParameters<typeof TransformControls>) { super(...args); transform = this; }
  }
  const frames: (() => void)[] = [], cleanups: (() => void)[] = [];
  const exports = componentModule("../src/features/manual/EditorControls.tsx", {
    react: { ...React, useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
      useLayoutEffect: (effect: () => () => void) => cleanups.push(effect()) },
    "react-dom": { flushSync: (fn: () => void) => fn() },
    "@react-three/fiber": { useThree: () => ({ camera, scene, gl: { domElement: canvas }, get: () => ({ controls: orbit }) }),
      useFrame: (fn: () => void) => frames.push(fn) },
    "../../core/editor": { useEditor: () => editor },
    "../../scene/dragMath": dragMath,
    "../../scene/sceneInput": { InputContext: React.createContext(null) },
    "three/examples/jsm/controls/TransformControls.js": { TransformControls: ObservedTransformControls },
  }, { window, document, HTMLElement: class {}, performance });
  const input = exports.EditorControls({ children: null }).props.value;
  const frame = () => { frames.forEach(fn => fn()); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); };
  const project = (position: THREE.Vector3) => {
    const p = position.clone().project(camera);
    return { x: (p.x + 1) * 400, y: (1 - p.y) * 300 };
  };
  // Match the ordering in which Orbit may see a body pointerdown before R3F.
  let bodyHit = false;
  connected.addEventListener("pointerdown", event => {
    if (bodyHit) input.begin({ ...event, nativeEvent: event, stopPropagation: () => event.stopPropagation() }, selection);
  });
  return { window, document, canvas, camera, scene, orbit, editor, selection, frame, project,
    get transform() { return transform; }, get commits() { return commits; },
    hitBody(value: boolean) { bodyHit = value; },
    cleanup() { cleanups.reverse().forEach(fn => fn()); orbit.dispose(); },
  };
}

for (const kind of ["body", "gizmo"] as const) {
  test(`${kind}拖动释放后清理Orbit指针，随后空白左拖可继续转动视角`, { skip: !existsSync(new URL("../src/features/manual/EditorControls.tsx", import.meta.url)) }, () => {
    const h = mountedControls();
    try {
      let start: { x: number; y: number };
      if (kind === "body") {
        h.hitBody(true);
        h.frame();
        start = h.project(new THREE.Vector3(0, 10, 0));
      } else {
        h.editor.select(h.selection);
        h.frame();
        // Use the real gizmo's projected X picker, exercising native hit testing.
        const gizmo = h.transform.getHelper().children.find(child => "picker" in child) as THREE.Object3D & { picker: { translate: THREE.Object3D } };
        const picker = gizmo.picker.translate.children.find(child => child.name === "X")!;
        start = h.project(picker.localToWorld(new THREE.Vector3(-0.5, 0, 0)));
      }
      const beforeCamera = h.camera.position.clone();
      h.canvas.dispatch("pointerdown", start.x, start.y);
      assert.equal(h.editor.isTransforming, true);
      assert.equal(h.orbit.enabled, false);
      if (kind === "body") assert.equal(h.document.listeners.get("pointerup")?.length, 1);
      else { assert.equal(h.transform.dragging, true); assert.equal(h.transform.axis, "X"); }
      h.canvas.dispatch("pointermove", start.x + 35, start.y - 10);
      h.frame();
      assert.ok(h.camera.position.equals(beforeCamera), "object dragging must not move the camera");
      h.canvas.dispatch("pointerup", start.x + 35, start.y - 10);
      assert.equal(h.editor.isTransforming, false);
      assert.equal(h.commits, 1);
      assert.equal(h.orbit.enabled, true);
      assert.equal(h.canvas.captured.size, 0);
      assert.equal(h.document.listeners.get("pointerup")?.length ?? 0, 0, "Orbit must receive the release and remove its document listener");
      assert.equal(h.document.listeners.get("pointermove")?.length ?? 0, 0);
      assert.equal(h.canvas.dispatch("click", start.x + 35, start.y - 10).immediate, true, "the post-drag click stays suppressed");
      h.hitBody(false);
      h.frame();
      h.canvas.dispatch("pointerdown", 20, 20, 2);
      h.canvas.dispatch("pointermove", 90, 45, 2);
      assert.ok(h.camera.position.distanceTo(beforeCamera) > 1, "blank left-drag must orbit after editing");
      h.canvas.dispatch("pointerup", 90, 45, 2);
      assert.equal(h.document.listeners.get("pointerup")?.length ?? 0, 0);
      assert.equal(h.commits, 1, "camera navigation must not create a second transform");
    } finally { h.cleanup(); }
  });
}

test("实际CameraRig在透视左拖旋转，正交左拖平移", () => {
  for (const view of ["perspective", "top", "front", "side"] as CameraView[]) {
    const document = new Surface(), canvas = new Surface(document);
    canvas.ownerDocument = document;
    const camera = view === "perspective" ? new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
      : new THREE.OrthographicCamera(-40, 40, 30, -30, 0.1, 1000);
    camera.position.set(40, 35, 55);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const exports = componentModule("../src/Scene.tsx", {
      react: { ...React, useRef: () => ({ current: null }), useEffect: () => {} },
      "@react-three/fiber": { useThree: () => ({ camera, size: { width: 800, height: 600 } }), useFrame: () => {} },
      "@react-three/drei": { OrbitControls: "OrbitControls" },
      "./core/editor": { useEditor: () => ({ view, isTransforming: false }) },
      "./core/project": projectCore, "./scene/sceneInput": {}, "./scene/dragMath": dragMath,
      "./core/background": backgroundCore, "./scene/SceneBackground": {}, "./scene/backgroundTexture": backgroundTexture,
      "./scene/importObj": {},
    }, {}, "\nexports.testCameraRig = CameraRig;");
    const { mouseButtons, enabled, enableRotate, enableDamping } = exports.testCameraRig().props;
    const orbit = new OrbitControls(camera, canvas as unknown as HTMLElement);
    Object.assign(orbit, { mouseButtons, enabled, enableRotate, enableDamping });
    const position = camera.position.clone(), target = orbit.target.clone(), rotation = camera.quaternion.clone();
    try {
      canvas.dispatch("pointerdown", 200, 200);
      canvas.dispatch("pointermove", 260, 230);
      canvas.dispatch("pointerup", 260, 230);
      assert.ok(camera.position.distanceTo(position) > 0.1, `${view} must respond to left-drag`);
      if (view === "perspective") {
        assert.ok(orbit.target.equals(target));
        assert.ok(camera.quaternion.angleTo(rotation) > 0.01);
      } else {
        assert.ok(orbit.target.distanceTo(target) > 0.1);
        assert.ok(camera.quaternion.angleTo(rotation) < 1e-6, "orthographic navigation preserves viewing direction");
      }
    } finally { orbit.dispose(); }
  }
});
