import { useEffect, useId, useRef, useState } from "react";
import { useEditor } from "./core/editor";
import { DEFAULT_SCENE_BACKGROUND } from "./core/background";
import type { SceneBackground } from "./core/types";
import { UserInputError } from "./core/feedback";
import { prepareBackgroundImage } from "./backgroundImage";
import { Icon } from "./ui/Icon";

export function BackgroundSettings() {
  const e = useEditor(), background = e.project.background ?? DEFAULT_SCENE_BACKGROUND;
  const fileInput = useRef<HTMLInputElement>(null), request = useRef(0), skipBlur = useRef(false);
  const colorButton = useRef<HTMLButtonElement>(null), colorOrigin = useRef<typeof e.project | null>(null);
  const colorPickerId = useId(), [colorDraft, setColorDraft] = useState<string | null>(null);
  const [hex, setHex] = useState(background.color.slice(1).toUpperCase());
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const disabled = !!e.candidate || busy;
  useEffect(() => setHex(background.color.slice(1).toUpperCase()), [background.color]);
  useEffect(() => { setColorDraft(null); colorOrigin.current = null; }, [e.project, disabled]);
  useEffect(() => () => { request.current++; }, []);
  function update(values: Partial<SceneBackground>) {
    if (disabled) return;
    setError("");
    const current = e.readProject().background ?? DEFAULT_SCENE_BACKGROUND;
    const next = { ...current, ...values };
    if (next.mode === current.mode && next.grid === current.grid && next.image === current.image
      && next.color.toLowerCase() === current.color.toLowerCase()) return;
    e.commit(p => ({ ...p, background: { ...(p.background ?? DEFAULT_SCENE_BACKGROUND), ...values } }), false);
  }
  function closeColorPicker() {
    setColorDraft(null);
    colorOrigin.current = null;
    colorButton.current?.focus();
  }
  function applyColor() {
    if (disabled || colorDraft === null) return;
    const color = colorDraft, original = colorOrigin.current;
    closeColorPicker();
    if (e.readProject() !== original) return;
    update({ color });
  }
  function commitHex() {
    if (skipBlur.current) { skipBlur.current = false; return; }
    const value = hex.trim().replace(/^#/, "");
    if (!/^[a-f\d]{6}$/i.test(value)) { setError("请输入 6 位十六进制颜色。"); return; }
    setHex(value.toUpperCase());
    if (background.color.toLowerCase() !== "#" + value.toLowerCase()) update({ color: "#" + value.toLowerCase() });
  }
  async function choose(file?: File) {
    if (!file || disabled) return;
    const id = ++request.current, original = e.readProject();
    setBusy(true); setError("");
    try {
      const image = await prepareBackgroundImage(file);
      if (id !== request.current) return;
      // A different scene, undo or scheme preview may have been opened while decoding.
      if (e.readProject() !== original) { setError("场景已更改，请重新选择背景图片。"); return; }
      const next = { ...original, background: { ...(original.background ?? DEFAULT_SCENE_BACKGROUND), mode: "image" as const, image } };
      if (new TextEncoder().encode(JSON.stringify(next, null, 2)).byteLength > 5_000_000)
        throw new UserInputError("添加这张图片后项目将超过 5 MB，请选择更小的图片。");
      e.commit(next, false);
    } catch (error) {
      if (id === request.current) setError(error instanceof UserInputError ? error.message : "无法添加背景图片，请重试。");
    } finally {
      if (id === request.current) setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return <section className="property-section background-settings" aria-label="场景背景">
    <h3>背景</h3>
    <div className="background-modes" role="group" aria-label="背景类型">
      <button aria-pressed={background.mode === "color"} disabled={disabled} onClick={() => update({ mode: "color" })}>纯色</button>
      <button aria-pressed={background.mode === "image"} disabled={disabled} onClick={() => background.image ? update({ mode: "image" }) : fileInput.current?.click()}>图片</button>
    </div>
    <div className="background-color-row">
      <button ref={colorButton} className="background-color-swatch" aria-label="选择背景颜色" aria-expanded={colorDraft !== null}
        aria-controls={colorDraft !== null ? colorPickerId : undefined} disabled={disabled} onClick={() => {
          if (colorDraft !== null) { closeColorPicker(); return; }
          setError("");
          colorOrigin.current = e.readProject();
          setColorDraft((colorOrigin.current.background ?? DEFAULT_SCENE_BACKGROUND).color);
        }}><span style={{ backgroundColor: background.color }} /></button>
      <label className="background-hex"><span>#</span><input aria-label="背景颜色 HEX" value={hex} maxLength={7} disabled={disabled}
        spellCheck={false} onChange={event => { setHex(event.target.value); setError(""); }} onBlur={commitHex}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { skipBlur.current = true; setHex(background.color.slice(1).toUpperCase()); setError(""); event.currentTarget.blur(); }
        }} /></label>
    </div>
    {colorDraft !== null && <div id={colorPickerId} className="background-color-picker" role="group" aria-label="选择背景颜色"
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeColorPicker(); }
      }}>
      <label className="background-color-choice"><span>颜色</span>
        <input type="color" aria-label="待应用的背景颜色" value={colorDraft} disabled={disabled} autoFocus onInput={event => setColorDraft(event.currentTarget.value)} />
        <output>{colorDraft.toUpperCase()}</output>
      </label>
      <div className="background-color-buttons">
        <button onClick={closeColorPicker}>取消</button>
        <button className="background-color-apply" disabled={disabled} onClick={applyColor}>应用</button>
      </div>
    </div>}
    {background.mode === "image" && background.image && <>
      <div className="background-thumbnail" style={{ backgroundColor: background.color }}><img src={background.image.dataUrl} alt="背景图片预览" /></div>
      <div className="background-filename" title={background.image.name}>{background.image.name}</div>
      <div className="background-actions">
        <button disabled={disabled} onClick={() => fileInput.current?.click()}>更换图片</button>
        <button disabled={disabled} onClick={() => update({ mode: "color", image: undefined })}>移除图片</button>
      </div>
    </>}
    {background.mode === "color" && <button className="background-upload" disabled={disabled} onClick={() => fileInput.current?.click()}><Icon name="upload" size={14} />选择背景图片</button>}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="选择背景图片文件" hidden onChange={event => void choose(event.target.files?.[0])} />
    {busy && <p className="note" role="status">正在处理图片…</p>}
    {error && <p className="background-error" role="alert">{error}</p>}
    <label className="background-grid"><input type="checkbox" checked={background.grid} disabled={disabled} onChange={event => update({ grid: event.target.checked })} />显示网格</label>
  </section>;
}
