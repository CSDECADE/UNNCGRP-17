import { useMemo } from "react";
import { useEditor } from "../../core/editor";
import type { Model, Vec3 } from "../../core/types";
import { modelBounds } from "../../core/model-bounds";
import { objChangeAroundCenter, objRotation, objScale } from "../../core/obj-transform";
import { NumberField } from "../../ui/Controls";

type Field = "position" | "rotationXYZ" | "rotation" | "scale" | "size";
type Row = { field: Field; label: string; vector: readonly number[]; axes: readonly string[]; min: number; max: number; unit: string };

export function TransformInspector({ model }: { model: Model }) {
  const e = useEditor();
  const obj = model.kind === "obj";
  const resource = model.kind === "obj" ? e.project.objResources?.find(r => r.id === model.resourceId) : undefined;
  const bounds = useMemo(() => modelBounds(model, e.project), [resource, model.size]);
  const disabled = model.locked || !model.visible || !!e.candidate || e.preview || e.playing || e.view === "drone" || e.isTransforming;
  function edit(field: Field, axis: number, value: number) {
    if (disabled) return false;
    let values: Record<string, unknown>;
    if (field === "rotation") values = { rotation: value };
    else {
      const original = field === "position" ? model.position : field === "size" ? model.size
        : model.kind === "obj" ? (field === "rotationXYZ" ? objRotation(model) : objScale(model)) : undefined;
      if (!original) return false;
      const vector = [...original] as Vec3;
      vector[axis] = value;
      values = field === "position" || field === "size" ? { [field]: vector }
        : model.kind === "obj" ? objChangeAroundCenter(model, bounds.center, { [field]: vector }) : {};
    }
    if (!e.beginTransform({ type: "model", id: model.id })) return false;
    e.updateTransform(values);
    return e.finishTransform();
  }
  const rows: Row[] = [
    { field: "position", label: "位置", vector: model.position, axes: ["X", "Y", "Z"], min: -10000, max: 10000, unit: "m" },
    ...(model.kind === "obj" ? [
      { field: "rotationXYZ" as const, label: "旋转", vector: objRotation(model), axes: ["X", "Y", "Z"], min: -10000, max: 10000, unit: "°" },
      { field: "scale" as const, label: "缩放", vector: objScale(model), axes: ["X", "Y", "Z"], min: 0.01, max: 10000, unit: "×" },
    ] : [
      { field: "rotation" as const, label: "旋转", vector: [model.rotation], axes: ["Y"], min: -10000, max: 10000, unit: "°" },
      { field: "size" as const, label: "尺寸", vector: model.size, axes: ["X", "Y", "Z"], min: 0.1, max: 10000, unit: "m" },
    ]),
  ];
  return <section className={`property-section model-transform-inspector${obj ? " obj-transform-inspector" : ""}`}
    aria-label={obj ? "OBJ 对象变换" : "内置模型变换"}>
    <h3>{model.name}</h3>
    <p>对象模式 · {obj ? "几何中心" : "底面中心"}枢轴</p>
    {rows.map(({ field, label, vector, axes, min, max, unit }) => <div key={field}>
      <h4>{label}</h4>
      <div className="vector-fields">
        {axes.map((axis, index) => <NumberField key={axis}
          label={`${label} ${axis}`} value={vector[index]} min={!obj && field === "position" && index === 1 ? 0 : min}
          max={max} unit={unit} precision={4}
          disabled={disabled} onChange={value => edit(field, index, value)} />)}
      </div>
    </div>)}
    <small>{obj ? "位置为世界坐标中的对象原点；旋转为 XYZ 欧拉角，缩放沿局部轴。旋转和缩放保持几何中心不变。"
      : "位置为底面中心世界坐标，Y 不低于地面。仅绕 Y 轴旋转；缩放工具修改局部 XYZ 实际尺寸（米），底面位置保持不变。"}</small>
    {model.kind === "cylinder" && <p>X/Z 为两个方向的直径，Y 为高度。</p>}
    {e.isTransforming && <p role="status">拖动中 · Esc 取消</p>}
    {model.locked && <p>请先解锁对象。</p>}
    {!model.visible && <p>请先显示对象。</p>}
    {(e.preview || e.playing || e.candidate) && <p>请先退出预演或处理候选方案。</p>}
  </section>;
}
