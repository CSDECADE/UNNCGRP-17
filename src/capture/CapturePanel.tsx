import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor } from "../core/editor";
import { fileErrorMessage } from "../core/feedback";
import { centredOffset, cloudForPhotos, meshAsset, modelToApp, type ReconstructionSetup } from "../core/reconstruction";
import type { PhotoSet } from "../core/capture/photoSet";
import { applyRoute, DEFAULT_ORBIT, orbitShots, type Bounds, type OrbitOptions } from "../core/capture/orbit";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { applyNuavCaptureRoute, buildNuavOverlapRoute } from "../core/capture/nuav";
import { captureFrames } from "../core/capture/format";
import { parseSparseCloud, type SparseCloud } from "../core/capture/sparseCloud";
import type { Vec3 } from "../core/types";
import { loadGlb, modelBounds } from "../scene/meshLoader";
import { NumberField } from "../ui/Controls";
import { Icon } from "../ui/Icon";
import { exportCapture, type CaptureProgress } from "./exportCapture";

const headings = {
  model: "建筑模型",
  route: "规划航线",
  photos: "模拟拍摄",
  result: "重建结果",
};
type CaptureStep = keyof typeof headings;

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
  }, [asset?.sha256, r?.frame.upAxis, r?.frame.offset]);
  return bounds;
}

export function CapturePanel({ hidden, hasCloud, sparsePanel, onCloud }: {
  hidden: boolean;
  hasCloud: boolean;
  sparsePanel: (primaryImport: boolean) => ReactNode;
  onCloud: (cloud: SparseCloud, photos?: PhotoSet) => void;
}) {
  const e = useEditor();
  const r = e.reconstruction;
  const locked = !!e.candidate;
  const [error, setError] = useState("");
  const [selectedStep, setSelectedStep] = useState<CaptureStep | null>(null);
  const pendingFocus = useRef<CaptureStep | null>(null);

  function goTo(step: CaptureStep) {
    pendingFocus.current = step;
    setError("");
    setSelectedStep(step);
  }
  const [busy, setBusy] = useState<"reference" | "proxy" | null>(null);
  const [orbit, setOrbit] = useState<OrbitOptions>(DEFAULT_ORBIT);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bounds = useBuildingBounds(r);
  const refInput = useRef<HTMLInputElement>(null), proxyInput = useRef<HTMLInputElement>(null);
  const routeInput = useRef<HTMLInputElement>(null);
  const update = (fn: (r: ReconstructionSetup) => ReconstructionSetup) => e.setReconstruction(fn);

  const desktop = window.p15Desktop;
  const [capabilities, setCapabilities] = useState({ plan: false, sparse: false });
  const [job, setJob] = useState<"plan" | "capture" | "sparse" | null>(null);
  const [start, setStart] = useState<Vec3 | null>(null);
  const [coverage, setCoverage] = useState(100);
  const [demoLimits, setDemoLimits] = useState(false);
  const [overlap, setOverlap] = useState(true);
  const [ready, setReady] = useState<{ token?: string; signature: string; count: number; photos: PhotoSet } | null>(null);
  const [registered, setRegistered] = useState<{ token: string; images: number; total: number } | null>(null);
  const currentSetup = (setup: ReconstructionSetup | undefined) =>
    setup && [setup.reference?.sha256, setup.proxy?.sha256, setup.frame, setup.capture, setup.attribution];
  const signature = () => {
    const session = e.exportSession();
    const { viewpoints, drones } = session.history.present.project;
    return JSON.stringify([viewpoints, drones, currentSetup(session.reconstruction)]);
  };
  const currentCapture = ready?.signature === signature() ? ready : null;
  const position: Vec3 = start ?? e.project.drones[0]?.position ??
    (bounds ? [Math.floor(bounds.min[0] - 8), Math.ceil(bounds.max[1] + 8), Math.ceil(bounds.max[2] + 8)] : [0, 15, 0]);

  useEffect(() => {
    void window.p15Desktop?.captureCapabilities?.().then(setCapabilities).catch(console.error);
  }, []);

  async function computeRoute() {
    if (!desktop || !r?.proxy || job) return;
    setError("");
    setJob("plan");
    const snapshot = signature();
    const original = e.committedProject;
    try {
      const mesh = await loadGlb(r.proxy);
      const obj = new OBJExporter().parse(mesh.scene);
      const [x, y, z] = position.map((value, i) => value - r.frame.offset[i]);
      const result = await desktop.capturePlan({ obj, start: [x, -z, y], coverage: coverage / 100, demoLimits });
      if (result.error || !result.text) throw new Error(result.error ?? "规划器没有返回航线。");
      if (signature() !== snapshot || e.readProject() !== original) throw new Error("场景已更改，请重新计算航线。");
      const data = JSON.parse(result.text);
      const shots = data.drones?.[0]?.shots?.length;
      const next = overlap && shots > 1
        ? buildNuavOverlapRoute(original, data, r.frame, { fromShot: 1, toShot: shots, maxSpacingM: 5, maxHeadingDeg: 12 }).project
        : applyNuavCaptureRoute(original, data, r.frame);
      e.commit(next, false, "计算采集航线");
      e.setMessage(`航线已生成 · ${next.viewpoints.length} 个拍摄点`);
      goTo("photos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法计算航线。");
    } finally {
      setJob(null);
    }
  }

  async function reconstruct() {
    if (!currentCapture || job) return;
    const { token, signature: snapshot, photos } = currentCapture;
    // Same photos, priors and intrinsics as a stored result: reuse it instead of running COLMAP again.
    const stored = cloudForPhotos(r, "sparse", photos);
    if (stored) {
      onCloud(stored.cloud, stored.photos);
      setRegistered({ token: photos.digest, images: stored.cloud.registeredImages, total: stored.cloud.totalImages });
      e.setMessage("照片与已保存的点云相同，已直接使用该结果。");
      return;
    }
    if (!desktop || !token) return;
    setError("");
    setJob("sparse");
    try {
      const result = await desktop.captureReconstruct(token);
      if (result.error || !result.text) throw new Error(result.error ?? "重建没有返回点云。");
      if (signature() !== snapshot) throw new Error("场景已更改，请重新生成照片。");
      const cloud = parseSparseCloud(result.text);
      onCloud(cloud, photos);
      setRegistered({ token: photos.digest, images: cloud.registeredImages, total: cloud.totalImages });
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法完成稀疏重建。");
    } finally {
      setJob(null);
    }
  }

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
      if (role === "reference") goTo("route");
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
    goTo("photos");
  }
  async function importNuavRoute(file?: File) {
    if (!file || !r) return;
    setError("");
    const original = e.committedProject;
    try {
      if (file.size > 5_000_000) throw new Error("规划结果超过 5 MB。");
      const data: unknown = JSON.parse(await file.text());
      e.commit((current) => {
        if (current !== original) throw new Error("项目已改变，请重新选择规划文件。");
        return applyNuavCaptureRoute(current, data, r.frame);
      }, false, "导入单机规划的拍摄点");
      goTo("photos");
    } catch (err) {
      setError(err instanceof SyntaxError ? "无法读取规划 JSON。" : err instanceof Error ? err.message : "无法导入规划结果。");
    }
  }
  async function runCapture() {
    if (!r || job) return;
    setError("");
    setJob("capture");
    const snapshot = signature();
    let token: string | undefined;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await exportCapture(e.committedProject, r, setProgress, controller.signal, capabilities.sparse ? (value) => { token = value; } : undefined);
      if (result) {
        setReady({ token, signature: snapshot, count: frames, photos: result.photos });
        if (token || cloudForPhotos(r, "sparse", result.photos)) goTo("result");
        e.setMessage(`照片包已生成：${result.name}`);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") e.setMessage("已取消生成照片包。");
      else {
        console.error(err);
        setError(fileErrorMessage(err, "export"));
      }
    } finally {
      abort.current = null;
      setProgress(null);
      setJob(null);
    }
  }

  const frames = captureFrames(e.committedProject).frames.length;
  const cap = r?.capture;
  const running = job !== null;
  const blocked = locked || running || busy !== null;
  const step = selectedStep ?? (hasCloud ? "result" : r?.reference ? frames ? "photos" : "route" : "model");
  const previousStep: CaptureStep = !r?.reference || step === "route" ? "model" :
    step === "photos" || !frames ? "route" : "photos";
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canPlan = capabilities.plan && !!r?.proxy && r.frame.upAxis === "z" && e.project.drones.length <= 1;
  const rebuilt = !!registered && registered.token === currentCapture?.photos.digest;
  const reusable = !!cloudForPhotos(r, "sparse", currentCapture?.photos);
  const readyToRebuild = !!currentCapture && (reusable || (capabilities.sparse && !!currentCapture.token));

  useEffect(() => {
    if (hidden || pendingFocus.current !== step) return;
    pendingFocus.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [hidden, step]);

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
          <button className="icon-button" aria-label={`移除${label}`} disabled={blocked} onClick={() => update((c) => ({ ...c, [role]: undefined, showReference: role === "reference" ? false : c.showReference }))}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div ref={scrollRef} className="capture-scroll" hidden={hidden}>
      <input ref={refInput} type="file" accept=".glb" hidden onChange={(ev) => { void loadModel("reference", ev.target.files?.[0]); ev.target.value = ""; }} />
      <input ref={proxyInput} type="file" accept=".glb" hidden onChange={(ev) => { void loadModel("proxy", ev.target.files?.[0]); ev.target.value = ""; }} />
      <div className="capture-body">
        {step !== "model" && <button className="capture-back" type="button" disabled={blocked}
          onClick={() => goTo(previousStep)}>
          <Icon name="chevron" size={12} />
          {headings[previousStep]}
        </button>}
        <h3 ref={headingRef} tabIndex={-1}>{headings[step]}</h3>
        {error && <p className="file-error" role="alert">{error}</p>}

        <section hidden={step !== "model"}>
          <p className="capture-caption">{r?.reference ? r.reference.name : "选择带贴图的 .glb 文件，开始规划航拍。"}</p>
          <button className="primary-button" disabled={blocked}
            onClick={() => r?.reference ? goTo("route") : refInput.current?.click()}>
            {r?.reference ? "继续规划" : busy === "reference" ? "正在导入…" : "导入建筑模型"}
          </button>
          {(r?.reference || r?.proxy) && <details className="capture-settings">
            <summary>模型设置</summary>
            {r.reference && modelRow("reference", "建筑模型", "")}
            {modelRow("proxy", "白模", "用于自动规划航线")}
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
                {r.reference && r.proxy && (
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
          </details>}
          <button className="capture-text-action" disabled={blocked}
            onClick={() => goTo("result")}>查看已有点云</button>
        </section>

        <section hidden={step !== "route"}>
          <p className="capture-caption">{frames ? `已就绪 · ${frames} 个拍摄点` : bounds ?
            "自动生成绕建筑飞行的路线和拍摄点。" : "导入建筑后即可生成航线。"}</p>
          <button className="primary-button" disabled={blocked}
            onClick={() => {
              if (frames) goTo("photos");
              else if (canPlan) void computeRoute();
              else if (bounds) generateRoute();
              else goTo("model");
            }}>
            {job === "plan" ? "正在生成航线…" : frames ? "继续拍摄" : bounds ? "生成航线" : "选择建筑模型"}
          </button>
          {bounds && <details className="capture-settings">
            <summary>航线设置</summary>
            {capabilities.plan && <>
              {modelRow("proxy", "规划白模", "用于计算单机航线")}
              <div className="capture-fields">
                {(["X", "Y", "Z"] as const).map((axis, i) => (
                  <NumberField key={axis} label={`起点 ${axis}`} unit="m" value={position[i]} disabled={blocked}
                    onChange={(n) => { const next = [...position] as Vec3; next[i] = n; setStart(next); }} />
                ))}
                <NumberField label="覆盖率" unit="%" value={coverage} min={1} max={100} disabled={blocked} onChange={setCoverage} />
              </div>
              <label className="check-row"><input type="checkbox" checked={overlap} disabled={blocked} onChange={(ev) => setOverlap(ev.target.checked)} />沿航线补拍重叠视角</label>
              <label className="check-row"><input type="checkbox" checked={demoLimits} disabled={blocked} onChange={(ev) => setDemoLimits(ev.target.checked)} />放宽转弯和爬升限制（仅仿真）</label>
              {r?.proxy && r.frame.upAxis !== "z" && <p className="note">自动规划需将白模设置为 Z 轴朝上。</p>}
              {e.project.drones.length > 1 && <p className="note">自动规划支持一架无人机。</p>}
              {canPlan && frames > 0 && <button className="secondary-button full" disabled={blocked}
                onClick={() => void computeRoute()}>重新计算航线</button>}
            </>}
            <h4>环绕航线</h4>
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
            <p className="note">环绕航线会替换第一架无人机的拍摄点。</p>
            <input ref={routeInput} type="file" accept=".json,application/json" hidden onChange={(ev) => {
              void importNuavRoute(ev.target.files?.[0]);
              ev.target.value = "";
            }} />
            <button className="secondary-button full" disabled={!r?.reference || r.frame.upAxis !== "z" || locked || running || busy !== null || e.project.drones.length > 1}
              onClick={() => routeInput.current?.click()}>
              导入 C 规划拍摄点
            </button>
            <p className="note">导入结果须与参考模型使用相同的 Z 轴朝上坐标系。</p>
          </details>}
        </section>

        <section hidden={step !== "photos"}>
          <p className="capture-caption">{currentCapture ? `${currentCapture.count} 张照片已保存。` :
            frames && r?.reference ? `将从 ${frames} 个拍摄点生成照片，可先在画布检查航线。` :
            !r?.reference ? "先导入用于拍摄的参考模型。" : "先为建筑添加拍摄点。"}</p>
          {progress ? (
            <div className="capture-progress" role="status">
              <progress max={progress.total || 1} value={progress.done} />
              <span>
                {progress.stage === "prepare" ? "正在准备参考模型…" : progress.stage === "finish" ? "正在写入元数据…" : `${progress.done} / ${progress.total}`}
              </span>
              <button className="secondary-button" onClick={() => abort.current?.abort()}>取消</button>
            </div>
          ) : (
            <button className="primary-button" disabled={blocked}
              onClick={() => {
                if (!r?.reference) goTo("model");
                else if (!frames) goTo("route");
                else if (currentCapture) goTo("result");
                else void runCapture();
              }}>
              {job === "capture" ? "正在准备拍摄…" : !r?.reference ? "准备模型" : !frames ? "规划航线" :
                currentCapture ? "继续重建" : "生成照片"}
            </button>
          )}
          {cap && <details className="capture-settings">
            <summary>照片设置</summary>
            <div className="capture-fields">
              <NumberField label="宽" unit="px" value={cap.width} min={64} max={8192} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, width: Math.round(n) } }))} />
              <NumberField label="高" unit="px" value={cap.height} min={64} max={8192} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, height: Math.round(n) } }))} />
              <NumberField label="GPS 水平" unit="m" value={cap.gpsNoise.horizontal} min={0} max={100} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, gpsNoise: { ...c.capture.gpsNoise, horizontal: n } } }))} />
              <NumberField label="GPS 垂直" unit="m" value={cap.gpsNoise.vertical} min={0} max={100} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, gpsNoise: { ...c.capture.gpsNoise, vertical: n } } }))} />
              <NumberField label="纬度" value={cap.origin.lat} min={-90} max={90} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, origin: { ...c.capture.origin, lat: n } } }))} />
              <NumberField label="经度" value={cap.origin.lon} min={-180} max={180} disabled={blocked} onChange={(n) => update((c) => ({ ...c, capture: { ...c.capture, origin: { ...c.capture.origin, lon: n } } }))} />
            </div>
            {currentCapture && <button className="secondary-button full" disabled={blocked}
              onClick={() => void runCapture()}>重新生成照片</button>}
          </details>}
        </section>

        <section hidden={step !== "result"}>
          {!hasCloud && <p className="capture-caption">{readyToRebuild ? `${currentCapture?.count} 张照片已就绪。` :
            "导入已有点云，在画布中查看结果。"}</p>}
          {readyToRebuild && !hasCloud &&
            <button className="primary-button" disabled={blocked} onClick={() => void reconstruct()}>
              {job === "sparse" ? "正在重建…" : "生成点云"}
            </button>
          }
          {sparsePanel(!readyToRebuild && !hasCloud)}
          {reusable && <p className="note">当前稀疏点云由这组照片生成，已随项目保存，无需重新计算。</p>}
          {readyToRebuild && hasCloud && !reusable && <button className="capture-text-action" disabled={blocked}
            onClick={() => void reconstruct()}>{job === "sparse" ? "正在重建…" : rebuilt ? "重新生成点云" : "生成点云"}</button>}
        </section>
      </div>
    </div>
  );
}
