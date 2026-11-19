import { useEditor } from "../../core/editor";
import { clearTiming, reorderPoint, routeFor } from "../../core/project";
import type { Vec3 } from "../../core/types";
import { Icon } from "../../ui/Icon";
import { NumberField, TextField, ToolButton } from "../../ui/Controls";
import { shortcuts } from "../../platform";
import { Inspector as SceneInspector } from "../../Inspector";
export function Inspector() {
  const e = useEditor(),
    s = e.selection;
  const model =
    s?.type === "model"
      ? e.project.models.find((m) => m.id === s.id)
      : undefined;
  const drone =
    s?.type === "drone"
      ? e.project.drones.find((d) => d.id === s.id)
      : undefined;
  const point =
    s?.type === "viewpoint"
      ? e.project.viewpoints.find((v) => v.id === s.id)
      : undefined;
  const item = model ?? drone ?? point;
  const disabled = !!e.candidate || !!model?.locked;
  const update = (values: Record<string, unknown>) => {
    if (s) e.patch(s.type, s.id, values);
  };
  const vector = (value: Vec3, field: "position" | "target") => (
    <div className="vector-fields">
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={`${field === "target" ? "目标 " : ""}${axis}`}
          value={value[i]}
          unit="m"
          min={i === 1 && field === "position" ? 0 : -10000}
          disabled={disabled || (field === "position" && i === 1 && e.lockHeight)}
          onChange={(n) => {
            const next = [...value] as Vec3;
            next[i] = n;
            update({ [field]: next });
          }}
        />
      ))}
    </div>
  );
  if (!item)
    return <SceneInspector />;
  const owner = point
    ? e.project.drones.find((d) => d.id === point.droneId)
    : drone;
  const route = owner ? routeFor(e.project, owner.id) : [];
  return (
    <div className="inspector-scroll">
      <section className="property-section">
        <div className="section-heading">
          <h3>{model ? "模型" : drone ? "无人机" : "拍摄点"}</h3>
          <div className="inline-buttons">
            <ToolButton icon="target" label="聚焦对象 F" onClick={e.focus} />
            <ToolButton
              icon="copy"
              label="复制对象"
              disabled={disabled || !!point}
              onClick={e.duplicate}
            />
            <ToolButton
              icon="trash"
              label="删除对象"
              disabled={disabled}
              onClick={e.remove}
            />
          </div>
        </div>
        <TextField
          label="对象名称"
          value={item.name}
          disabled={disabled}
          onChange={(name) => {
            if (name !== item.name) update({ name });
          }}
        />
        {model?.locked && (
          <p className="note">对象已锁定。可在左侧列表解锁。</p>
        )}
      </section>
      {point && (
        <section className="property-section">
          <div className="edit-target-tabs" aria-label="编辑拍摄点">
            <button aria-pressed={e.transformTarget === "position"} disabled={disabled}
              onClick={() => { e.setPreview(false); e.setTransformTarget("position"); e.setTool("translate"); if (e.view === "drone") e.setView("perspective"); }}>移动位置</button>
            <button aria-pressed={e.transformTarget === "target"} disabled={disabled}
              onClick={() => { e.setPreview(false); e.setTransformTarget("target"); e.setTool("translate"); if (e.view === "drone") e.setView("perspective"); }}>调整朝向</button>
          </div>
          <p className="note">{e.transformTarget === "target" ? "拖动金色目标点，调整镜头朝向。" : "拖动拍摄点或编号定位，拖动竖轴调整高度。"}按住 Shift 精细移动，Esc 取消。</p>
        </section>
      )}
      <section className="property-section">
        <h3>位置</h3>
        {vector(item.position, "position")}
        <div className="position-views">
          {([ ["top", "俯视"], ["front", "正视"], ["side", "侧视"] ] as const).map(([view, name]) => (
            <button key={view} aria-pressed={e.view === view} onClick={() => { e.setView(view); e.focus(); }}>{name}</button>
          ))}
        </div>
        {"rotation" in item && (
          <div className="two-fields">
            <NumberField
              label="旋转"
              value={item.rotation}
              unit="°"
              disabled={disabled}
              onChange={(rotation) => update({ rotation })}
            />
            <button
              className="field-action"
              onClick={() => {
                e.setView("top");
                e.focus();
              }}
            >
              俯视定位 <Icon name="target" size={14} />
            </button>
          </div>
        )}
      </section>
      <section className="property-section transform-options">
        <label>移动吸附
          <select aria-label="移动吸附" value={e.snap} disabled={disabled} onChange={ev => e.setSnap(Number(ev.target.value))}>
            <option value="0">关闭</option><option value="0.1">0.1 m</option><option value="1">1 m</option>
          </select>
        </label>
        <label><input type="checkbox" checked={e.lockHeight} disabled={disabled} onChange={ev => e.setLockHeight(ev.target.checked)} />锁定位置高度</label>
        {e.lockHeight && <p className="note">位置的 Y 坐标保持不变，不影响镜头目标。</p>}
      </section>
      {model && (
        <>
          <section className="property-section">
            <h3>尺寸</h3>
            <div className="two-fields">
              {model.kind === "cylinder" ? (
                <NumberField
                  label="半径"
                  value={model.size[0] / 2}
                  unit="m"
                  min={0.1}
                  disabled={disabled}
                  onChange={(r) =>
                    update({ size: [r * 2, model.size[1], r * 2] })
                  }
                />
              ) : (
                <NumberField
                  label="宽度"
                  value={model.size[0]}
                  unit="m"
                  min={0.1}
                  disabled={disabled}
                  onChange={(w) =>
                    update({ size: [w, model.size[1], model.size[2]] })
                  }
                />
              )}
              <NumberField
                label="高度"
                value={model.size[1]}
                unit="m"
                min={0.1}
                disabled={disabled}
                onChange={(h) =>
                  update({ size: [model.size[0], h, model.size[2]] })
                }
              />
              {model.kind !== "cylinder" && (
                <NumberField
                  label="深度"
                  value={model.size[2]}
                  unit="m"
                  min={0.1}
                  disabled={disabled}
                  onChange={(d) =>
                    update({ size: [model.size[0], model.size[1], d] })
                  }
                />
              )}
            </div>
            {model.kind === "building" && (
              <p className="note">调整高度会拉伸整个模型。</p>
            )}
          </section>
          <section className="property-section">
            <h3>外观</h3>
            {model.kind === "building" ? (
              <div className="property-line">
                <span>材质</span>
                <span>默认材质</span>
              </div>
            ) : (
              <label className="color-editor">
                <input
                  aria-label="模型颜色"
                  type="color"
                  value={model.color}
                  disabled={disabled}
                  onChange={(ev) => update({ color: ev.target.value })}
                />
                <span>{model.color.slice(1).toUpperCase()}</span>
                <span>100%</span>
              </label>
            )}
            <div className="property-line">
              <span>资源</span>
              <span>
                {model.kind === "building" ? "教学楼" : model.kind === "obj" ? "外部 OBJ" : "基础形状"}
              </span>
            </div>
          </section>
        </>
      )}
      {drone && (
        <>
          <section className="property-section">
            <h3>相机</h3>
            <label className="select-label">
              预设
              <select
                aria-label="相机预设"
                value={String(drone.fov)}
                disabled={disabled}
                onChange={(ev) => update({ fov: Number(ev.target.value) })}
              >
                <option value="45">标准 · 45°</option>
                <option value="60">广角 · 60°</option>
                <option value="90">超广角 · 90°</option>
                {![45, 60, 90].includes(drone.fov) && (
                  <option value={drone.fov}>自定义 · {drone.fov}°</option>
                )}
              </select>
            </label>
            <NumberField
              label="垂直视场角"
              value={drone.fov}
              min={10}
              max={120}
              unit="°"
              disabled={disabled}
              onChange={(fov) => update({ fov })}
            />
            <button
              className="secondary-button full"
              onClick={() => {
                e.setPreview(true);
                e.setView("drone");
              }}
            >
              <Icon name="camera" />
              相机视角
            </button>
            <label className="color-editor">
              <input
                aria-label="无人机标识颜色"
                type="color"
                value={drone.color}
                disabled={disabled}
                onChange={(ev) => update({ color: ev.target.value })}
              />
              <span>标识颜色</span>
            </label>
          </section>
          <section className="property-section">
            <div className="section-heading">
              <h3>
                拍摄点 <span className="muted">{route.length}</span>
              </h3>
              <ToolButton
                icon="plus"
                label="添加拍摄点"
                disabled={disabled}
                onClick={() => {
                  e.setTool("point");
                  if (e.view === "drone") e.setView("perspective");
                  e.setPreview(false);
                }}
              />
            </div>
            {route.length === 0 && (
              <p className="note">添加拍摄点，指定位置与镜头目标。</p>
            )}
            {route.map((v, i) => (
              <button
                className="route-item"
                key={v.id}
                onClick={() => e.select({ type: "viewpoint", id: v.id })}
              >
                <span className="point-index" style={{ color: drone.color }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{v.name}</span>
                <small>{v.position[1]} m</small>
                <Icon name="chevron" size={12} />
              </button>
            ))}
            <p className="note">航线按拍摄顺序连接，未检查障碍物或无人机间的碰撞。</p>
          </section>
        </>
      )}
      {point && (
        <>
          <section className="property-section">
            <h3>所属无人机</h3>
            <select
              className="full-select"
              aria-label="所属无人机"
              disabled={disabled}
              value={point.droneId}
              onChange={(ev) => update({ droneId: ev.target.value })}
            >
              {e.project.drones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </section>
          <section className="property-section">
            <div className="section-heading">
              <h3>镜头目标</h3>
              <ToolButton
                icon="target"
                label="在场景中指定镜头目标"
                disabled={disabled}
                active={e.tool === "target"}
                onClick={() => {
                  e.setPreview(false);
                  e.setView("perspective");
                  e.setTool(e.tool === "target" ? "select" : "target");
                }}
              />
            </div>
            {vector(point.target, "target")}
            <p className="note">拖动金色目标点调整朝向；也可点击准星，再选取建筑表面。</p>
          </section>
          <section className="property-section">
            <h3>拍摄顺序</h3>
            <div className="order-controls">
              <span>
                {route.findIndex((v) => v.id === point.id) + 1} / {route.length}
              </span>
              <button
                disabled={disabled || route[0]?.id === point.id}
                onClick={() => e.commit((p) => reorderPoint(p, point.id, -1))}
              >
                <Icon name="up" />
                上移
              </button>
              <button
                disabled={disabled || route.at(-1)?.id === point.id}
                onClick={() => e.commit((p) => reorderPoint(p, point.id, 1))}
              >
                <Icon name="down" />
                下移
              </button>
            </div>
            {point.time !== undefined && (
              <div className="property-line">
                <span>方案时间</span>
                <span>{point.time} s</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
