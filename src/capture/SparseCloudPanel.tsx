import { useRef, useState } from "react";
import { MAX_SPARSE_CLOUD_BYTES, parseSparseCloud, type SparseCloud } from "../core/capture/sparseCloud";

export function SparseCloudPanel({ clouds, active, hasReference, primaryImport, onSelect, onImport, onRemove }: {
  clouds: Partial<Record<SparseCloud["kind"], SparseCloud>>;
  active: SparseCloud["kind"] | "reference";
  hasReference: boolean;
  primaryImport: boolean;
  onSelect: (kind: SparseCloud["kind"] | "reference") => void;
  onImport: (cloud: SparseCloud) => void;
  onRemove: () => void;
}) {
  const cloud = active === "reference" ? undefined : clouds[active];
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(file: File) {
    setError("");
    setLoading(true);
    try {
      if (file.size > MAX_SPARSE_CLOUD_BYTES) throw new Error("点云文件超过 12 MB。");
      onImport(parseSparseCloud(await file.text()));
    } catch (err) {
      setError(err instanceof SyntaxError ? "无法读取点云 JSON。" :
        err instanceof Error ? err.message : "无法导入点云。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="capture-cloud">
      <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void load(file);
      }} />
      {((hasReference && (clouds.sparse || clouds.dense)) || (clouds.sparse && clouds.dense)) && (
        <div role="group" aria-label="重建结果对比" className="background-modes capture-comparison">
          {hasReference && <button aria-pressed={active === "reference"} onClick={() => onSelect("reference")}>参考建筑</button>}
          {clouds.sparse && <button aria-pressed={active === "sparse"} onClick={() => onSelect("sparse")}>稀疏</button>}
          {clouds.dense && <button aria-pressed={active === "dense"} onClick={() => onSelect("dense")}>稠密</button>}
        </div>
      )}
      {cloud && <>
        <p className="note" role="status">{cloud.kind === "dense" ? "稠密" : "稀疏"} · {cloud.positions.length / 3} 个显示点{cloud.sourcePointCount > cloud.positions.length / 3 ? ` / ${cloud.sourcePointCount} 个融合点` : ""} · {cloud.registeredImages}/{cloud.totalImages} 张照片已注册</p>
      </>}
      <button className={primaryImport ? "primary-button" : "capture-text-action"} disabled={loading} onClick={() => picker.current?.click()}>
        {loading ? "正在导入…" : "导入点云"}
      </button>
      {cloud && <details className="capture-settings">
        <summary>点云管理</summary>
        <button className="secondary-button" disabled={loading} onClick={onRemove}>移除点云</button>
      </details>}
      {error && <p className="note" role="alert">{error}</p>}
    </div>
  );
}
