// 「采集」tab: building models (reference + proxy), temporary orbit route, simulated capture export.
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../core/editor";
import { fileErrorMessage } from "../core/feedback";
import { centredOffset, meshAsset, modelToApp, type ReconstructionSetup } from "../core/reconstruction";
import { applyRoute, DEFAULT_ORBIT, orbitShots, type Bounds, type OrbitOptions } from "../core/capture/orbit";
import { captureFrames } from "../core/capture/format";
import type { Vec3 } from "../core/types";
import { loadGlb, modelBounds } from "../scene/meshLoader";
import { NumberField } from "../ui/Controls";
import { Icon } from "../ui/Icon";
import { exportCapture, type CaptureProgress } from "./exportCapture";

const DEMO_ATTRIBUTION = "Drone Building Scans — Matthew Guertin, 2026. CC BY 4.0. https://github.com/Matt1Up/drone-building-scans-dataset";
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Bounds of the proxy (or the reference) in app coordinates. */
function useBuildingBounds(r: ReconstructionSetup | undefined) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const asset = r?.proxy ?? r?.reference;
  useEffect(() => {
    if (!asset || !r) return setBounds(null);
    let live = true;
    loadGlb(asset)
      .then((gltf) => {
        const { min, max } = modelBounds(gltf);
        const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
          modelToApp([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]], r.frame),
        );
        const lo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]))) as Vec3;
        const hi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]))) as Vec3;
        if (live) setBounds({ min: lo, max: hi });
      })
      .catch(() => live && setBounds(null));
    return () => {
      live = false;
    };
  }, [asset?.sha256, r?.frame.upAxis, ...(r?.frame.offset ?? [])]);
  return bounds;
}

export function CapturePanel() {
  const e = useEditor();
  const r = e.reconstruction;
  const locked = !!e.candidate;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"reference" | "proxy" | null>(null);
  const [orbit, setOrbit] = useState<OrbitOptions>(DEFAULT_ORBIT);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bounds = useBuildingBounds(r);
  const refInput = useRef<HTMLInputElement>(null), proxyInput = useRef<HTMLInputElement>(null);
  const update = (fn: (r: ReconstructionSetup) => ReconstructionSetup) => e.setReconstruction(fn);

  async function loadModel(role: "reference" | "proxy", file?: File) {
    if (!file) return;
    setError("");
    setBusy(role);
    try {
      const asset = await meshAsset(file.name, new Uint8Array(await file.arrayBuffer()));
      const gltf = await loadGlb(asset); // fail early on files three.js cannot read
      const first = !e.reconstruction?.reference && !e.reconstruction?.proxy;
      update((current) => {
        const next = { ...current, [role]: asset };
        if (first) {
          // Guess: a building is wider than it is tall, so the smallest of Y/Z extents is "up".
          const { min, max } = modelBounds(gltf);
          const upAxis = max[2] - min[2] < max[1] - min[1] ? "z" : "y";
          next.frame = { upAxis, offset: centredOffset(min, max, upAxis) };
        }
        return next;
      });
      e.setMessage(`已加载${role === "reference" ? "参考模型" : "白模"}「${file.name}」。`);
    } catch (err) {
      console.error(err);
      setError(fileErrorMessage(err, "open"));
    } finally {
      setBusy(null);
    }
  }
  async function centre() {
    const asset = r?.proxy ?? r?.reference;
    if (!asset || !r) return;
    const { min, max } = modelBounds(await loadGlb(asset));
    update((c) => ({ ...c, frame: { ...c.frame, offset: centredOffset(min, max, c.frame.upAxis) } }));
  }
  function generateRoute() {
    if (!bounds) return;
    const shots = orbitShots(bounds, orbit);
    e.commit((p) => applyRoute(p, shots), false, `生成环绕航线（${shots.length} 个拍摄点）`);
    e.setMessage(`已为第一架无人机生成 ${shots.length} 个拍摄点，可撤销。`);
  }
  async function runCapture() {
    if (!r) return;
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await exportCapture(e.committedProject, r, setProgress, controller.signal);
      if (result) e.setMessage(`照片包已生成：${result}`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") e.setMessage("已取消生成照片包。");
      else {
        console.error(err);
        setError(fileErrorMessage(err, "export"));
      }
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  const frames = captureFrames(e.committedProject).frames.length;
  const cap = r?.capture;
  const running = progress !== null;
  const modelRow = (role: "reference" | "proxy", label: string, hint: string) => {
    const asset = r?.[role];
    return (
      <div className="capture-model">
        <div>
          <strong>{label}</strong>
          <small>{asset ? `${asset.name} · ${mb(asset.bytes.byteLength)}` : hint}</small>
        </div>
        <button className="secondary-button" disabled={locked || running || busy !== null} onClick={() => (role === "reference" ? refInput : proxyInput).current?.click()}>
          {busy === role ? "加载中…" : asset ? "更换" : "加载 .glb"}
        </button>
        {asset && (
          <button className="icon-button" aria-label={`移除${label}`} disabled={running} onClick={() => update((c) => ({ ...c, [role]: undefined, showReference: role === "reference" ? false : c.showReference }))}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="capture-scroll">
      <input ref={refInput} type="file" accept=".glb" hidden onChange={(ev) => { void loadModel("reference", ev.target.files?.[0]); ev.target.value = ""; }} />
      <input ref={proxyInput} type="file" accept=".glb" hidden onChange={(ev) => { void loadModel("proxy", ev.target.files?.[0]); ev.target.value = ""; }} />
      {error && <p className="file-error" role="alert">{error}</p>}

      <section className="property-section">
        <h3>建筑模型</h3>
        {modelRow("reference", "参考模型", "代表真实建筑，只用于模拟拍摄")}
        {modelRow("proxy", "白模", "低精度模型，用于规划航线")}
        {r && (r.reference || r.proxy) && (
          <>
            <div className="background-modes" role="group" aria-label="模型朝上方向">
              {(["y", "z"] as const).map((axis) => (
                <button key={axis} aria-pressed={r.frame.upAxis === axis} disabled={running} onClick={() => update((c) => ({ ...c, frame: { ...c.frame, upAxis: axis } }))}>
                  {axis.toUpperCase()} 轴朝上
                </button>
              ))}
            </div>
            <div className="capture-fields">
              {(["X", "Y", "Z"] as const).map((axis, i) => (
                <NumberField key={axis} label={`偏移 ${axis}`} unit="m" value={r.frame.offset[i]} disabled={running}
                  onChange={(n) => update((c) => {
                    const offset = [...c.frame.offset] as Vec3;
                    offset[i] = n;
                    return { ...c, frame: { ...c.frame, offset } };
                  })} />
              ))}
              <button className="secondary-button" disabled={running} onClick={() => void centre()}>居中落地</button>
            </div>
            {r.reference && (
              <label className="check-row">
                <input type="checkbox" checked={r.showReference} onChange={(ev) => update((c) => ({ ...c, showReference: ev.target.checked }))} />
                在场景中显示参考模型（代替白模）
              </label>
            )}
            <label className="capture-label" htmlFor="capture-attribution">数据来源署名</label>
            <textarea id="capture-attribution" className="capture-attribution" rows={3} maxLength={500} value={r.attribution} disabled={running}
              placeholder="例如：Drone Building Scans — Matthew Guertin, 2026. CC BY 4.0."
              onChange={(ev) => update((c) => ({ ...c, attribution: ev.target.value }))} />
            {!r.attribution && (
              <button className="link-button" onClick={() => update((c) => ({ ...c, attribution: DEMO_ATTRIBUTION }))}>填入演示数据署名</button>
            )}
            {bounds && (
              <p className="note">
                建筑范围 {(bounds.max[0] - bounds.min[0]).toFixed(1)} × {(bounds.max[2] - bounds.min[2]).toFixed(1)} m，高 {(bounds.max[1] - bounds.min[1]).toFixed(1)} m
              </p>
            )}
          </>
        )}
      </section>

      <section className="property-section">
        <h3>临时航线 · 环绕</h3>
        <div className="capture-fields">
          <NumberField label="层数" value={orbit.rings} min={1} max={10} onChange={(n) => setOrbit({ ...orbit, rings: Math.round(n) })} />
          <NumberField label="每层" value={orbit.perRing} min={3} max={120} onChange={(n) => setOrbit({ ...orbit, perRing: Math.round(n) })} />
          <NumberField label="离墙" unit="m" value={orbit.standoff} min={2} max={200} onChange={(n) => setOrbit({ ...orbit, standoff: n })} />
          <NumberField label="最低" unit="m" value={orbit.minHeight} min={0} max={200} onChange={(n) => setOrbit({ ...orbit, minHeight: n })} />
        </div>
        <label className="check-row">
          <input type="checkbox" checked={orbit.topRing} onChange={(ev) => setOrbit({ ...orbit, topRing: ev.target.checked })} />
          增加屋顶俯视环
        </label>
        <button className="secondary-button full" disabled={!bounds || locked || running} onClick={generateRoute}>
          生成环绕航线（{(orbit.rings + (orbit.topRing ? 1 : 0)) * orbit.perRing} 个拍摄点）
        </button>
        <p className="note">替换第一架无人机的航线。正式航线算法完成后，可通过「路径导入」接入。</p>
      </section>

      {r && cap && (
        <section className="property-section">
          <h3>模拟拍摄</h3>
          <div className="capture-fields">
            <NumberField label="宽" unit="px" value={cap.width} min={64} max={8192} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, width: Math.round(n) } }))} />
            <NumberField label="高" unit="px" value={cap.height} min={64} max={8192} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, height: Math.round(n) } }))} />
            <NumberField label="GPS 水平" unit="m" value={cap.gpsNoise.horizontal} min={0} max={100} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, gpsNoise: { ...c.capture.gpsNoise, horizontal: n } } }))} />
            <NumberField label="GPS 垂直" unit="m" value={cap.gpsNoise.vertical} min={0} max={100} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, gpsNoise: { ...c.capture.gpsNoise, vertical: n } } }))} />
            <NumberField label="纬度" value={cap.origin.lat} min={-90} max={90} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, origin: { ...c.capture.origin, lat: n } } }))} />
            <NumberField label="经度" value={cap.origin.lon} min={-180} max={180} disabled={running} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, origin: { ...c.capture.origin, lon: n } } }))} />
          </div>
          <p className="note">
            {frames} 张照片 · 视场角取各无人机设置 · 照片包 = 照片 + capture.json + 真值（仅用于评估）
          </p>
          {running ? (
            <div className="capture-progress" role="status">
              <progress max={progress.total || 1} value={progress.done} />
              <span>
                {progress.stage === "prepare" ? "正在准备参考模型…" : progress.stage === "finish" ? "正在写入元数据…" : `${progress.done} / ${progress.total}`}
              </span>
              <button className="secondary-button" onClick={() => abort.current?.abort()}>取消</button>
            </div>
          ) : (
            <button className="primary-button full" disabled={!r.reference || !frames || locked} onClick={() => void runCapture()}>
              <Icon name="camera" /> 生成照片包
            </button>
          )}
          {!r.reference && <p className="note">需要先加载参考模型。</p>}
        </section>
      )}
    </div>
  );
}
