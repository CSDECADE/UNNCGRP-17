import { useEditor } from "../../core/editor";
import { clearElement, coincidentElements, elementKey, resolveElement, selectionMode, type MeshSelectionMode } from "../../core/mesh-edit";
import { NumberField } from "../../ui/Controls";
import type { Vec3 } from "../../core/types";

export function VertexInspector() {
  const e = useEditor(), selection = e.meshSelection;
  const target = selection && resolveElement(e.project, selection);
  if (!selection || !target) return null;
  const kind = selectionMode(selection), labels = { vertex: "顶点", edge: "边", face: "面" };
  const coincident = coincidentElements(e.project, selection);
  const label = kind === "edge" ? "边中点局部" : kind === "face" ? "面重心局部" : "顶点局部";
  const committed = resolveElement(e.committedProject, selection);
  return <section className="property-section vertex-inspector" aria-label="OBJ 网格编辑">
    <h3>编辑模式 · {labels[kind]}</h3>
    <div className="mesh-selection-modes" role="group" aria-label="元素选择模式">
      {(["vertex", "edge", "face"] as MeshSelectionMode[]).map(mode => <button key={mode} aria-label={`${labels[mode]}选择`}
        aria-pressed={kind === mode} onClick={() => e.setMeshSelectionMode(mode)}>{labels[mode]}</button>)}
    </div>
    <label>子网格 <select aria-label="编辑子网格" value={selection.meshId} disabled={e.isTransforming}
      onChange={event => e.selectMeshElement(clearElement(selection, kind, event.target.value))}>
      {target.resource.meshes.map(mesh => <option key={mesh.id} value={mesh.id}>{mesh.name}</option>)}
    </select></label>
    <p>{target.pivot ? "edgeIds" in selection ? `已选逻辑边 ${selection.edgeIds!.join(" — ")}` : "triangle" in selection
      ? `已选三角面 ${selection.triangle! + 1}` : `已选逻辑顶点 ${selection.vertexId}`
      : kind === "vertex" ? "点击蓝色顶点进行选择（10 像素范围）。" : kind === "edge" ? "点击蓝色边进行选择（8 像素范围）。" : "点击当前子网格的可见三角面。"}</p>
    {target.pivot && <div className="vector-fields">{["X", "Y", "Z"].map((axis, index) => <NumberField key={`${kind}:${axis}`}
      label={`${label} ${axis}`} value={target.pivot![index]} min={-10000} max={10000} unit="m" precision={4}
      disabled={e.isTransforming} onChange={value => {
        const position = [...target.pivot!] as Vec3; position[index] = value;
        if (!e.beginMeshTransform()) return false;
        if (!e.updateTransform({ elementPosition: position })) { e.cancelTransform(); return false; }
        return e.finishTransform();
      }} />)}</div>}
    {coincident.length > 1 && <button disabled={e.isTransforming} onClick={() => {
      const index = coincident.findIndex(v => elementKey(v) === elementKey(selection));
      e.selectMeshElement(coincident[(index + 1) % coincident.length]);
    }}>切换重合{labels[kind]}（{coincident.length}）</button>}
    <small>仅选择当前子网格的可见元素。重合顶点保持独立；共享顶点的所有引用会同步更新。</small>
    {kind !== "vertex" && <p>数值是{kind === "edge" ? "边中点" : "三角形重心"}的局部目标坐标；与原参考位置之差，会作为同一平移量应用到所有所选顶点。边和面均以三角网格为准。</p>}
    <p>按 M 移动；手柄沿世界 XYZ，数值为模型局部坐标。Esc 取消拖动，Tab 返回对象模式。</p>
    {e.isTransforming && <p role="status">{labels[kind]}移动中 · Esc 取消{target.pivot && committed?.pivot &&
      ` · 局部位移 Δ [${target.pivot.map((n, i) => (n - committed.pivot![i]).toFixed(4)).join(", ")}] m`}</p>}
    <button onClick={e.exitEditMode}>返回对象模式</button>
  </section>;
}
