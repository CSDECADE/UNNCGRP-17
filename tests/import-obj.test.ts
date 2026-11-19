import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3 } from "three";
import { emptyProject, parseProject } from "../src/core/project.ts";
import { loadObjGeometry, prepareObj } from "../src/scene/importObj.ts";

test("外部 OBJ 的几何随项目保存，并能按原比例重新显示", async () => {
  const file = new File([
    "mtllib external.mtl\r\nv 1 5 2\r\nv 5 5 6\r\nv 1 7 2\r\nf -3/1/1 -2/2/1 -1/3/1\r\n",
  ], "示例.OBJ");
  const model = await prepareObj(file);
  assert.equal(model.name, "示例");
  assert.deepEqual(model.size, [8, 4, 8]);
  const restored = parseProject(JSON.stringify({ ...emptyProject(), models: [model] })).models[0];
  assert.deepEqual(restored, model);
  assert.equal(restored.kind, "obj");
  const { geometry, size } = await loadObjGeometry(restored.obj);
  try {
    const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute("position"));
    assert.deepEqual(bounds.min.toArray(), [-4, 0, -4]);
    assert.deepEqual(bounds.max.toArray(), [4, 4, 4]);
    assert.deepEqual(size, model.size);
  } finally {
    geometry.dispose();
  }
});

test("拒绝非 OBJ 文件、无面模型和无效的内嵌模型数据", async () => {
  await assert.rejects(prepareObj(new File([""], "model.glb")), /\.obj/);
  await assert.rejects(prepareObj(new File(["v 0 0 0"], "empty.obj")), /没有可显示的面/);
  await assert.rejects(prepareObj(new File(["v 0 0 0\nf 1 2 3"], "invalid.obj")), /顶点坐标无效/);
  assert.throws(() => parseProject(JSON.stringify({ ...emptyProject(), models: [{
    id: "bad-model", kind: "obj", name: "坏模型", position: [0, 0, 0],
    rotation: 0, size: [1, 1, 1], color: "#ffffff", visible: true, locked: false, obj: "bad",
  }] })), /导入模型的数据无效/);
});
