import { useEffect, useRef } from "react";
import { useEditor } from "../../core/editor";
import { timing } from "../../core/project";
import { Icon } from "../../ui/Icon";

export function Playback() {
  const e = useEditor();
  const { preview, playing, speed, setProgress, setPlaying } = e;
  const { duration, timed } = timing(e.project);
  const hasPoints = e.project.viewpoints.length > 0;
  const progress = useRef(e.progress);
  progress.current = e.progress;

  useEffect(() => {
    if (!preview || !playing || !hasPoints) return;
    if (progress.current >= 1) {
      progress.current = 0;
      setProgress(0);
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, progress.current + Math.max(0, now - last) * speed / (duration * 1000));
      last = now;
      progress.current = next;
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview, playing, hasPoints, speed, duration, setProgress]);

  if (!preview) return null;
  const seek = (next: number) => {
    setPlaying(false);
    progress.current = next;
    setProgress(next);
  };
  return (
    <section className="playback-bar" aria-label="航线播放">
      <button aria-label={playing ? "暂停航线" : "播放航线"} disabled={!hasPoints}
        onClick={() => setPlaying(!playing)}>
        <Icon name={playing ? "pause" : "play"} size={15} />
      </button>
      <button aria-label="回到起点" onClick={() => seek(0)}>↺</button>
      <div className="playback-track">
        <div>
          <span>{hasPoints ? `${(e.progress * duration).toFixed(1)} / ${duration.toFixed(1)} 秒` : "请先添加拍摄点"}</span>
          <small>{timed ? "方案时间" : "模拟时间"}</small>
        </div>
        <input type="range" aria-label="播放进度" min={0} max={1} step={0.001}
          disabled={!hasPoints} value={e.progress} onChange={(event) => seek(Number(event.currentTarget.value))} />
      </div>
      <select aria-label="播放速度" value={speed} onChange={(event) => e.setSpeed(Number(event.currentTarget.value))}>
        {[0.5, 1, 1.5, 2, 3].map((value) => <option key={value} value={value}>{value}×</option>)}
      </select>
      <button aria-label="退出预演" onClick={() => {
        seek(0);
        e.setPreview(false);
        if (e.view === "drone") e.setView("perspective");
      }}><Icon name="close" size={14} /></button>
    </section>
  );
}
