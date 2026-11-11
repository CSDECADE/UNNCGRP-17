import { useState } from "react";
import { useEditor } from "./core/editor";
import { HISTORY_LIMIT } from "./core/history";
import { Icon } from "./ui/Icon";
import { ToolButton } from "./ui/Controls";

const time = (at: number) =>
  new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Undo timeline and named checkpoints of the current session. */
export function HistoryPanel() {
  const e = useEditor();
  const locked = !!e.candidate;
  const [draftName, setDraftName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { entries, index } = e.historyEntries;
  function finishRename() {
    if (editing) e.renameCheckpoint(editing.id, editing.name);
    setEditing(null);
  }
  return (
    <div className="history-scroll">
      <div className="section-heading">
        <h3>检查点</h3>
        <span className="muted">{e.checkpoints.length}</span>
      </div>
      <form
        className="checkpoint-create"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (locked) return;
          e.createCheckpoint(draftName);
          setDraftName("");
        }}
      >
        <input
          aria-label="检查点名称"
          placeholder={`检查点 ${e.checkpoints.length + 1}`}
          value={draftName}
          maxLength={160}
          disabled={locked}
          onChange={(ev) => setDraftName(ev.target.value)}
        />
        <button className="secondary-button" type="submit" disabled={locked}>
          创建
        </button>
      </form>
      {!e.checkpoints.length && <p className="note">检查点保存当前场景，可随时恢复，并随项目包迁移。</p>}
      <ul className="checkpoint-list">
        {[...e.checkpoints].reverse().map((c) => (
          <li key={c.id} className="checkpoint-row">
            <Icon name="frame" size={13} />
            {editing?.id === c.id ? (
              <input
                autoFocus
                aria-label="重命名检查点"
                value={editing.name}
                maxLength={160}
                onChange={(ev) => setEditing({ id: c.id, name: ev.target.value })}
                onBlur={finishRename}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") finishRename();
                  if (ev.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button
                className="checkpoint-name"
                title={`${c.name} · ${time(c.createdAt)}（双击重命名）`}
                onDoubleClick={() => setEditing({ id: c.id, name: c.name })}
                onClick={() => !locked && e.restoreCheckpoint(c.id)}
                disabled={locked}
              >
                <span>{c.name}</span>
                <small>{time(c.createdAt)}</small>
              </button>
            )}
            <div className="row-actions">
              <ToolButton icon="undo" label={`恢复 ${c.name}`} disabled={locked} onClick={() => e.restoreCheckpoint(c.id)} />
              <ToolButton icon="trash" label={`删除 ${c.name}`} onClick={() => {
                if (confirm(`删除检查点「${c.name}」？此操作无法撤销。`)) e.deleteCheckpoint(c.id);
              }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="section-heading">
        <h3>操作历史</h3>
        <span className="muted">
          {index}/{HISTORY_LIMIT}
        </span>
      </div>
      <ol className="history-list">
        {entries
          .map((entry, i) => (
            <li key={i}>
              <button
                className={"history-row" + (i === index ? " current" : i > index ? " undone" : "")}
                aria-current={i === index ? "step" : undefined}
                disabled={locked}
                onClick={() => e.jumpTo(i)}
                title={time(entry.at)}
              >
                <span>{entry.label}</span>
                <small>{time(entry.at).split(" ").at(-1)}</small>
              </button>
            </li>
          ))
          .reverse()}
      </ol>
    </div>
  );
}
