import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as projectCore from "../src/core/project.ts";
import * as transformCore from "../src/core/transform.ts";
import * as feedback from "../src/core/feedback.ts";
import type { Project } from "../src/core/types.ts";
import type { useEditor } from "../src/core/editor.tsx";

type Editor = ReturnType<typeof useEditor>;
const require = createRequire(import.meta.url);

// Execute the real hook with deferred renders: native canvas callbacks retain an
// old context value while the provider's refs have already handled input blur.
// Effects (autosave and timers) are deliberately outside this regression's scope.
function editorWithDeferredRender(initial: Project) {
  const slots: unknown[] = [];
  let cursor = 0;
  const hooks = {
    createContext: () => ({}),
    useContext: () => null,
    useEffect: () => {},
    useRef(value: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
    useState(value: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
  };
  const source = readFileSync(new URL("../src/core/editor.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const sandbox = {
    exports: {} as Record<string, unknown>,
    localStorage: { getItem: () => JSON.stringify(initial), setItem: () => {} },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "./project") return projectCore;
      if (name === "./transform") return transformCore;
      if (name === "./feedback") return feedback;
      return require(name);
    },
  };
  runInNewContext(compiled + "\nexports.testHook = useEditorState;", sandbox);
  return () => {
    cursor = 0;
    return (sandbox.exports.testHook as () => Editor)();
  };
}

test("输入坐标失焦后旧canvas上下文立即开始竖轴拖动，不覆盖刚提交的X", () => {
  const render = editorWithDeferredRender(projectCore.exampleProject());
  let editor = render();
  const point = editor.project.viewpoints[1];
  const selection = { type: "viewpoint" as const, id: point.id };
  editor.select(selection);
  editor = render();
  const staleCanvasContext = editor;
  // NumberField's blur commits X, but R3F has not rendered the new context yet.
  editor.patch("viewpoint", point.id, { position: [-10, 18, 30] });
  assert.equal(staleCanvasContext.project.viewpoints[1].position[0], -6);
  const origin = staleCanvasContext.readProject().viewpoints[1].position;
  assert.deepEqual(origin, [-10, 18, 30]);
  assert.equal(staleCanvasContext.beginTransform(selection), true);
  staleCanvasContext.updateTransform({ position: [origin[0], 21.09, origin[2]] });
  staleCanvasContext.finishTransform();
  editor = render();
  assert.deepEqual(editor.committedProject.viewpoints[1].position, [-10, 21.09, 30]);
  editor.undo();
  assert.deepEqual(editor.readProject().viewpoints[1].position, [-10, 18, 30]);
  editor.undo();
  assert.deepEqual(editor.readProject().viewpoints[1].position, [-6, 18, 30]);
});

test("旧上下文在目标坐标提交后立即开始目标拖动，取消仅回退拖动草稿", () => {
  const render = editorWithDeferredRender(projectCore.exampleProject());
  let editor = render();
  const point = editor.project.viewpoints[0];
  const selection = { type: "viewpoint" as const, id: point.id };
  editor.select(selection);
  editor = render();
  editor.patch("viewpoint", point.id, { target: [7, 8, 9] });
  editor.setTransformTarget("target");
  const origin = editor.readProject().viewpoints[0].target;
  assert.equal(editor.beginTransform(selection), true);
  editor.updateTransform({ target: [origin[0], 20, origin[2]] });
  assert.deepEqual(editor.readProject().viewpoints[0].target, [7, 20, 9]);
  assert.deepEqual(editor.readProject().viewpoints[0].position, point.position);
  editor.cancelTransform();
  editor.finishTransform();
  assert.deepEqual(editor.readProject().viewpoints[0].target, [7, 8, 9]);
  editor.undo();
  assert.deepEqual(editor.readProject().viewpoints[0].target, point.target);
});

test("同步项目读取依次返回草稿、候选与已提交项目，不依赖consumer重新渲染", () => {
  const render = editorWithDeferredRender(projectCore.exampleProject());
  const editor = render(), committed = editor.committedProject;
  const selection = { type: "viewpoint" as const, id: committed.viewpoints[0].id };
  editor.select(selection);
  assert.equal(editor.beginTransform(selection), true);
  editor.updateTransform({ position: [11, 22, 33] });
  assert.deepEqual(editor.readProject().viewpoints[0].position, [11, 22, 33]);
  assert.equal(editor.committedProject, committed);
  const candidate = { ...committed, name: "导入方案" };
  editor.setCandidate(candidate);
  assert.equal(editor.readProject(), candidate);
  assert.equal(editor.beginTransform(selection), false);
  editor.setCandidate(null);
  editor.finishTransform();
  assert.equal(editor.readProject(), committed);
});
