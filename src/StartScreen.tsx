import { useEffect } from "react";
import { productName, version } from "../package.json";
import { useEditor } from "./core/editor";
import { useDocuments } from "./core/documents";
import { Icon } from "./ui/Icon";

function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(at).toLocaleDateString("zh-CN");
}

/** Launch screen: resume, recent projects, new / example / open. */
export function StartScreen({ onDone }: { onDone: () => void }) {
  const e = useEditor();
  const docs = useDocuments();
  const closable = e.active;
  useEffect(() => {
    void docs.refreshRecent();
  }, []);
  useEffect(() => {
    if (!closable) return;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable]);
  const finish = (ok: boolean) => ok && onDone();
  return (
    <div className="start-screen" role="dialog" aria-modal="true" aria-label={`${productName} 开始`}>
      <div className="start-panel">
        <aside className="start-side">
          <div className="start-brand">
            <img src="/brand/flightform.png" width="36" height="36" alt="" />
            <div>
              <strong>{productName}</strong>
              <small>无人机航拍规划 · v{version}</small>
            </div>
          </div>
          <nav className="start-actions">
            <button className="primary-button" disabled={docs.busy} onClick={() => void docs.start().then(onDone)}>
              <Icon name="plus" /> 新建空白项目
            </button>
            <button disabled={docs.busy} onClick={() => void docs.open().then(finish)}>
              <Icon name="open" /> 打开项目…
            </button>
            <button disabled={docs.busy} onClick={() => void docs.start(true).then(onDone)}>
              <Icon name="building" /> 打开示例
            </button>
          </nav>
          <p className="note">项目以 .aeproj 包保存，包含场景、最近 50 步操作历史、全部检查点和背景图片，可直接复制到其他电脑继续编辑。</p>
          {closable && (
            <button className="start-close" onClick={onDone}>
              返回当前项目 <kbd>Esc</kbd>
            </button>
          )}
        </aside>
        <section className="start-main">
          {docs.error && (
            <p className="file-error" role="alert">
              {docs.error}
            </p>
          )}
          {docs.resume && !closable && (
            <>
              <h2>继续上次的工作</h2>
              <button className="resume-card" onClick={() => finish(docs.resumeAutosave())}>
                <Icon name="undo" size={22} />
                <span>
                  <strong>{docs.resume.name}</strong>
                  <small>
                    {docs.resume.fileName ?? "未保存的项目"} · {ago(docs.resume.savedAt)}暂存 · {docs.resume.steps} 步历史 ·{" "}
                    {docs.resume.checkpoints} 个检查点
                  </small>
                </span>
              </button>
            </>
          )}
          <h2>最近项目</h2>
          {!docs.recent.length ? (
            <div className="recent-empty">
              <Icon name="open" size={28} />
              <p>{window.p15Desktop ? "保存或打开的项目会显示在这里。" : "在浏览器中打开或下载的项目会保留副本，显示在这里。"}</p>
            </div>
          ) : (
            <ul className="recent-list">
              {docs.recent.map((r) => (
                <li key={r.id} className={r.missing ? "missing" : ""}>
                  <button
                    className="recent-open"
                    disabled={docs.busy || r.missing}
                    title={r.folder ? `${r.folder}/${r.fileName}` : r.fileName}
                    onClick={() => void docs.openRecent(r.id).then(finish)}
                  >
                    <Icon name="layers" size={18} />
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.fileName}
                        {r.folder ? ` — ${r.folder}` : ""}
                      </small>
                    </span>
                    <em>{r.missing ? "文件已移动或删除" : ago(r.openedAt)}</em>
                  </button>
                  <button className="icon-button" aria-label={`从最近项目中移除 ${r.name}`} title="从列表中移除" onClick={() => void docs.removeRecent(r.id)}>
                    <Icon name="close" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
