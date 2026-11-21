import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { clearElement, coincidentElements, elementKey, resolveElement, selectionMode, singleElementKey, withSelectionElements, type MeshElementSelection, type MeshSelectionMode } from "../../core/mesh-edit";
import { NumberField } from "../../ui/Controls";
import type { Vec3 } from "../../core/types";

function GroupTranslation() {
  const e = useEditor(), [delta, setDelta] = useState<Vec3>([0, 0, 0]), pending = useRef(delta);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A history change clears a pending delta once; an already-zero panel must
    // not schedule a fresh array update after every Undo/Redo commit.
    if (pending.current.some(n => n !== 0)) {
      pending.current = [0, 0, 0]; setDelta(pending.current);
    }
  }, [e.committedProject]);
  function apply() {
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && form.current?.contains(focused)) focused.blur();
    if (!e.beginMeshTransform()) return;
    if (!e.updateTransform({ elementDelta: [...pending.current] })) { e.cancelTransform(); return; }
    if (e.finishTransform()) { pending.current = [0, 0, 0]; setDelta([0, 0, 0]); }
  }
  return <div ref={form} className="group-translation">
    <h4>局部平移增量 Δ</h4>
    <div className="vector-fields">{["X", "Y", "Z"].map((axis, index) => <NumberField key={axis}
      label={`平移增量 ${axis}`} value={delta[index]} min={-20000} max={20000} unit="m" precision={4}
      disabled={e.isTransforming} onChange={value => {
        const next = [...pending.current] as Vec3; next[index] = value; pending.current = next; setDelta(next);
      }} />)}</div>
    <button disabled={e.isTransforming} onClick={apply}>应用平移</button>
    <small>增量沿模型局部 XYZ。填完后应用，作为一次可撤销操作提交；成功后归零。</small>
  </div>;
}

export function VertexInspector() {
  const e = useEditor(), selection = e.meshSelection;
  const target = selection && resolveElement(e.project, selection);
  if (!selection || !target) return null;
  const kind = selectionMode(selection), labels = { vertex: "顶点", edge: "边", face: "面" };
  const coincident = coincidentElements(e.project, selection);
  const label = kind === "edge" ? "边中点局部" : kind === "face" ? "面重心局部" : "顶点局部";
  const committed = resolveElement(e.committedProject, selection);
  const keys = new Set(target.elements.map(singleElementKey)), primary = target.elements[0];
  const available = coincident.filter(element => !keys.has(singleElementKey(element)));
  const cycle = primary ? coincident.filter(element => singleElementKey(element) === singleElementKey(primary) || !keys.has(singleElementKey(element))) : [];
  const describe = (element: MeshElementSelection) => "edgeIds" in element ? element.edgeIds!.join(" — ") : "triangle" in element ? `三角面 ${element.triangle! + 1}` : element.vertexId;
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
    <p>已选 <output aria-label="已选元素数量">{target.elements.length}</output> 个{labels[kind]} · {target.indices.length} 个逻辑顶点</p>
    <p>{target.elements.length > 1 ? "Shift + 点击添加/移除，普通点击替换，空白处清空。" : target.pivot ? "edgeIds" in selection ? `已选逻辑边 ${selection.edgeIds!.join(" — ")}` : "triangle" in selection
      ? `已选三角面 ${selection.triangle! + 1}` : `已选逻辑顶点 ${selection.vertexId}`
      : kind === "vertex" ? "点击蓝色顶点进行选择（10 像素范围）。" : kind === "edge" ? "点击蓝色边进行选择（8 像素范围）。" : "点击当前子网格的可见三角面。"}</p>
    {target.pivot && target.elements.length === 1 && <div className="vector-fields">{["X", "Y", "Z"].map((axis, index) => <NumberField key={`${kind}:${axis}`}
      label={`${label} ${axis}`} value={target.pivot![index]} min={-10000} max={10000} unit="m" precision={4}
      disabled={e.isTransforming} onChange={value => {
        const position = [...target.pivot!] as Vec3; position[index] = value;
        if (!e.beginMeshTransform()) return false;
        if (!e.updateTransform({ elementPosition: position })) { e.cancelTransform(); return false; }
        return e.finishTransform();
      }} />)}</div>}
    {target.pivot && target.elements.length > 1 && <>
      <p>选择中心（局部） [{target.pivot.map(n => n.toFixed(4)).join(", ")}] m</p>
      <GroupTranslation key={elementKey(selection)} />
    </>}
    {target.elements.length > 1 && <div className="mesh-selection-list" aria-label="已选网格元素">
      {target.elements.map(element => <button key={singleElementKey(element)} disabled={e.isTransforming}
        aria-label={`移除 ${describe(element)}`} onClick={() => e.pickMeshElement(element, true)}>{describe(element)} ×</button>)}
    </div>}
    {coincident.length > 1 && <button disabled={e.isTransforming || cycle.length < 2} onClick={() => {
      const index = cycle.findIndex(v => singleElementKey(v) === singleElementKey(primary));
      e.selectMeshElement(withSelectionElements(selection, [cycle[(index + 1) % cycle.length], ...target.elements.slice(1)]));
    }}>切换重合{labels[kind]}（{coincident.length}）</button>}
    {available.length > 0 && <button disabled={e.isTransforming} onClick={() => e.pickMeshElement(available[0], true)}>追加重合{labels[kind]}</button>}
    <small>仅选择当前子网格的可见元素。重合顶点保持独立；共享顶点的所有引用会同步更新。</small>
    {target.elements.length <= 1 && kind !== "vertex" && <p>数值是{kind === "edge" ? "边中点" : "三角形重心"}的局部目标坐标；与原参考位置之差，会作为同一平移量应用到所有所选顶点。边和面均以三角网格为准。</p>}
    <p>Shift + 点击添加/移除，普通点击替换，空白处清空。按 M 沿世界 XYZ 移动；Esc 取消拖动，Tab 返回对象模式。</p>
    {e.isTransforming && <p role="status">{labels[kind]}移动中 · Esc 取消{target.pivot && committed?.pivot &&
      ` · 局部位移 Δ [${target.pivot.map((n, i) => (n - committed.pivot![i]).toFixed(4)).join(", ")}] m`}</p>}
    <button onClick={e.exitEditMode}>返回对象模式</button>
  </section>;
}
