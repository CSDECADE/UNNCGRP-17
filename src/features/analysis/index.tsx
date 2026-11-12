import { useMemo, useRef, useState } from "react";
import { useEditor } from "../../core/editor";
import { fileErrorMessage, UserInputError } from "../../core/feedback";
import { importPlan } from "../../core/project";
import type { AnalysisPanelProps, Editor } from "../contracts";
import { analyzeRoutes } from "./route-analysis";
import "./analysis.css";

export function acceptPlan(text: string, e: Editor, playbackAvailable: boolean) {
  const candidate = importPlan(text, e.committedProject);
  if (!candidate.viewpoints.length) throw new UserInputError("方案中没有拍摄点。");
  e.setPlaying(false);
  e.setProgress(0);
  e.setPreview(playbackAvailable);
  e.setTool("select");
  e.setCandidate(candidate);
}

export function AnalysisPanel({ filesAvailable, openFile }: AnalysisPanelProps) {
  const e = useEditor();
  const source = e.candidate ?? e.committedProject;
  const result = useMemo(() => analyzeRoutes(source), [source]);
  const current = useMemo(() => analyzeRoutes(e.committedProject), [e.committedProject]);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState(5);

  async function openPlan() {
    setError("");
    try {
      if (filesAvailable) await openFile("plan");
      else if (window.p15Desktop) {
        const file = await window.p15Desktop.openFile("plan");
        if (file) acceptPlan(file.text, e, false);
      } else input.current?.click();
    } catch (reason) { setError(fileErrorMessage(reason, "import")); }
  }

  return <section className="route-analysis" aria-label="多机路径分析">
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={async (event) => {
      const element = event.currentTarget;
      const file = element.files?.[0];
      if (!file) return;
      setError("");
      try {
        if (file.size > 5_000_000) throw new UserInputError("文件超过 5 MB，请选择较小的文件。");
        acceptPlan(await file.text(), e, false);
      } catch (reason) { setError(fileErrorMessage(reason, "import")); }
      finally { element.value = ""; }
    }} />
    <div className="analysis-actions">
      <button className="primary-button" onClick={() => void openPlan()}>导入候选航线 JSON</button>
      {e.candidate && <><button onClick={() => { if (e.candidate) e.replace(e.candidate); }}>应用候选方案</button>
        <button onClick={() => { e.setCandidate(null); e.setPreview(false); setError(""); }}>取消候选方案</button></>}
    </div>
    {error && <p className="file-error" role="alert">{error}</p>}
    <p>{e.candidate ? `候选方案 · 原总长 ${current.totalDistance.toFixed(1)} m` : "当前方案"} · 总长 {result.totalDistance.toFixed(1)} m</p>
    <div className="analysis-table"><table>
      <thead><tr><th>无人机</th><th>拍摄点</th><th>航线长度 (m)</th><th>时长 (s)</th></tr></thead>
      <tbody>{result.routes.map((route) => <tr key={route.id}><th scope="row">{route.name}</th><td>{route.count}</td>
        <td>{route.distance.toFixed(1)}</td><td>{route.count ? route.duration.toFixed(1) : "—"}</td></tr>)}</tbody>
    </table></div>
    {!result.routes.length && <p>请先在场景中添加无人机。</p>}
    <label className="analysis-threshold">模拟间距提示阈值 (m)
      <input type="number" min={0} max={1000} step={0.5} value={threshold}
        onChange={(event) => setThreshold(Math.min(1000, Math.max(0, Number(event.currentTarget.value) || 0)))} />
    </label>
    {result.pairs.length ? <div className="analysis-table"><table>
      <thead><tr><th>无人机组合</th><th>最近间距 (m)</th><th>时刻 (s)</th><th>模拟提示</th></tr></thead>
      <tbody>{result.pairs.map((pair) => <tr key={pair.id}><th scope="row">{pair.a} / {pair.b}</th>
        <td>{pair.distance.toFixed(2)}</td><td>{pair.time.toFixed(1)}</td><td>{pair.distance < threshold ? "低于阈值" : "未低于阈值"}</td></tr>)}</tbody>
    </table></div> : <p>至少两架无人机各有一个拍摄点，才能比较间距。</p>}
    <p className="analysis-note">{result.timed ? "使用方案时间" : "使用模拟时间（相邻拍摄点间隔 6 秒）"}。按直线插值计算，只用于场景分析。</p>
  </section>;
}

export function CandidateBanner({ clearError }: { clearError: () => void }) {
  const e = useEditor();
  if (!e.candidate) return null;
  return <div className="candidate-banner" role="status">
    <span>候选航线 · 尚未替换当前项目</span>
    <button onClick={() => { if (e.candidate) e.replace(e.candidate); clearError(); }}>应用</button>
    <button onClick={() => { e.setCandidate(null); e.setPreview(false); clearError(); }}>取消</button>
  </div>;
}
