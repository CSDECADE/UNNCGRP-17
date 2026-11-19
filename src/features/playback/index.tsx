import { useEffect } from "react";
import { useEditor } from "../../core/editor";
import { timing } from "../../core/project";
import { sourceLabels } from "../../core/feedback";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/Controls";

export function Playback() {
  const e = useEditor();
  const time = timing(e.project);
  useEffect(() => {
    if (!e.playing) return;
    let current = e.progress,
      previous = performance.now(),
      handle = 0;
    const frame = (now: number) => {
      current = Math.min(
        1,
        current + (((now - previous) / 1000) * e.speed) / time.duration,
      );
      previous = now;
      e.setProgress(current);
      if (current >= 1) {
        e.setPlaying(false);
        return;
      }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [e.playing, e.speed, time.duration]);
  return (<>
          {e.preview && (
            <div className="playback-bar">
              <button
                aria-label={e.playing ? "暂停预演" : "播放预演"}
                disabled={!e.project.viewpoints.length}
                onClick={() => {
                  if (e.progress >= 1) e.setProgress(0);
                  e.setPlaying(!e.playing);
                }}
              >
                <Icon name={e.playing ? "pause" : "play"} />
              </button>
              <button
                aria-label="回到起点"
                onClick={() => {
                  e.setProgress(0);
                  e.setPlaying(false);
                }}
              >
                <Icon name="stop" size={13} />
              </button>
              <div className="playback-track">
                <div>
                  <span>
                    {time.timed
                      ? `方案时间 · ${(e.progress * time.duration).toFixed(1)} / ${time.duration.toFixed(1)} s`
                      : `示意播放 · ${Math.round(e.progress * 100)}%`}
                  </span>
                  <small>{sourceLabels[e.project.source]}</small>
                </div>
                <input
                  aria-label="预演进度"
                  type="range"
                  min="0"
                  max="1000"
                  value={Math.round(e.progress * 1000)}
                  onChange={(ev) => {
                    e.setPlaying(false);
                    e.setProgress(Number(ev.target.value) / 1000);
                  }}
                />
              </div>
              <select
                aria-label="播放速度"
                value={e.speed}
                onChange={(ev) => e.setSpeed(Number(ev.target.value))}
              >
                {[0.5, 1, 2].map((n) => (
                  <option value={n} key={n}>
                    {n}×
                  </option>
                ))}
              </select>
              <ToolButton
                icon="close"
                label="退出预演"
                onClick={() => {
                  e.setPreview(false);
                  e.setPlaying(false);
                  if (e.view === "drone") e.setView("perspective");
                }}
              />
            </div>
          )}
  </>);
}
