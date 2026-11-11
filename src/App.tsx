import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEditor } from "./core/editor";
import {
  clearTiming,
  reorderPoint,
  routeFor,
} from "./core/project";
import type { CameraView, ModelKind, Selection, Tool } from "./core/types";
import { Scene } from "./Scene";
import { Inspector as SceneInspector } from "./Inspector";
import { HistoryPanel } from "./HistoryPanel";
import { Icon } from "./ui/Icon";
import { TextField, ToolButton } from "./ui/Controls";
import { productName } from "../package.json";
import { shortcuts } from "./platform";
import { autosaveLabels, UserInputError } from "./core/feedback";

import {
  projectFiles, useProjectFiles, analysis, playback, Playback, AnalysisPanel,
  CandidateBanner, Help, manualInspector, manualControls,
} from "./features/modules";

const Inspector = manualInspector?.Inspector ?? SceneInspector;

function MenuItem({
  icon,
  children,
  shortcut,
  onSelect,
  disabled = false,
}: {
  icon: string;
  children: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      className="menu-item"
      onSelect={onSelect}
      disabled={disabled}
    >
      <Icon name={icon} />
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </Dropdown.Item>
  );
}
export function App() {
  const e = useEditor();
  useEffect(() => {
    document.title = `${e.project.name} — ${productName}`;
  }, [e.project.name]);
  const [tab, setTab] = useState<"layers" | "assets" | "history">("layers"),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true),
    [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"project" | "algorithm" | "help" | null>(
      null,
    ),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { fileInput, fileError, setFileError, openFile, readFile, save, exportFile, startProject } =
    useProjectFiles(() => setDialog(null), text => {
      if (!analysis) throw new UserInputError("请先加载多机路径分析模块。");
      analysis.acceptPlan(text, e, !!playback);
    });
  useEffect(() => setFileError(""), [dialog]);
  useEffect(() =>
    window.p15Desktop?.onCommand((command) => {
      if (command === "save" || command === "saveAs")
        void save(command === "saveAs");
      if (command === "open") void openFile("project");
      if (command === "new") void startProject();
      if (command === "help") setDialog("help");
      if (command === "undo" || command === "redo") {
        if (
          document.activeElement?.matches(
            "input,textarea,[contenteditable=true]",
          )
        )
          document.execCommand(command);
        else command === "undo" ? e.undo() : e.redo();
      }
    }),
  );
  function toggle(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement;
      if (
        target.closest(
          "input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]",
        )
      )
        return;
      if (ev.metaKey || ev.ctrlKey) {
        if (ev.key === "s" && !window.p15Desktop) {
          ev.preventDefault();
          save();
        }
        if (ev.key === "z" && !window.p15Desktop) {
          ev.preventDefault();
          ev.shiftKey ? e.redo() : e.undo();
        }
        if (ev.key === "d") {
          ev.preventDefault();
          e.duplicate();
        }
        return;
      }
      if (ev.key === "Escape") {
        e.cancelTransform();
        e.setTool("select");
        e.setPlaying(false);
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        e.remove();
      }
      if (ev.key.toLowerCase() === "f") e.focus();
      const keys: Record<string, Tool> = {
        v: "select",
        m: "translate",
        r: "rotate",
        k: "scale",
      };
      if (keys[ev.key.toLowerCase()] && !e.candidate) {
        if ((keys[ev.key.toLowerCase()] === "rotate" && e.selection?.type === "viewpoint") ||
            (keys[ev.key.toLowerCase()] === "scale" && e.selection?.type !== "model")) return;
        if (!manualControls && keys[ev.key.toLowerCase()] !== "select") return;
        if (e.view === "drone") e.setView("perspective");
        e.setTool(keys[ev.key.toLowerCase()]);
        e.setPreview(false);
      }
      if (playback && ev.code === "Space" && e.preview) {
        ev.preventDefault();
        e.setPlaying(!e.playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const locked = !!e.candidate;
  function chooseTool(tool: Tool) {
    if (!manualControls && ["translate", "rotate", "scale"].includes(tool)) {
      e.setMessage("请先加载手动调整模块。");
      return;
    }
    if (locked) return;
    if (e.view === "drone") e.setView("perspective");
    e.setPreview(false);
    e.setPlaying(false);
    e.setTool(tool);
    if (tool === "point") {
      if (!e.project.drones.length) {
        e.setMessage("请先添加无人机。");
        e.setTool("select");
        return;
      }
    }
  }
  const views: [CameraView, string][] = [
    ["perspective", "透视"],
    ["top", "俯视"],
    ["side", "侧视"],
    ["front", "正视"],
    ["drone", "无人机相机"],
  ];
  const objectRow = (
    selection: NonNullable<Selection>,
    name: string,
    icon: string,
    options: {
      color?: string;
      visible?: boolean;
      locked?: boolean;
      indent?: boolean;
    } = {},
  ) => {
    const active = e.selection?.id === selection.id;
    return (
      <div
        key={selection.id}
        className={
          "object-row " +
          (active ? "selected " : "") +
          (options.indent ? "indented " : "") +
          (options.visible === false ? "object-hidden" : "")
        }
        draggable={selection.type === "viewpoint" && !locked}
        onDragStart={(ev) =>
          ev.dataTransfer.setData("text/p15-point", selection.id)
        }
        onDragOver={(ev) => {
          if (selection.type === "viewpoint") ev.preventDefault();
        }}
        onDrop={(ev) => {
          if (selection.type !== "viewpoint" || locked) return;
          ev.preventDefault();
          const id = ev.dataTransfer.getData("text/p15-point"),
            origin = e.project.viewpoints.find((v) => v.id === id),
            dest = e.project.viewpoints.find((v) => v.id === selection.id);
          if (!origin || !dest || origin.droneId !== dest.droneId) return;
          const route = routeFor(e.project, dest.droneId),
            delta =
              route.findIndex((v) => v.id === dest.id) -
              route.findIndex((v) => v.id === origin.id);
          e.commit((p) => reorderPoint(p, id, delta));
        }}
      >
        <button
          className="object-name"
          title={name}
          aria-label={`选择 ${name}`}
          aria-pressed={active}
          onClick={() => {
            e.select(selection);
            setRightOpen(true);
          }}
        >
          <Icon
            name={icon}
            size={14}
            style={options.color ? { color: options.color } : undefined}
          />
          <span>{name}</span>
        </button>
        {selection.type !== "viewpoint" && (
          <div className="row-actions">
            <button
              aria-label={`${options.visible === false ? "显示" : "隐藏"} ${name}`}
              disabled={locked}
              onClick={() => {
                if (selection.type === "model")
                  e.commit((p) => ({
                    ...p,
                    models: p.models.map((m) =>
                      m.id === selection.id ? { ...m, visible: !m.visible } : m,
                    ),
                  }));
                else
                  e.patch("drone", selection.id, { visible: !options.visible });
              }}
            >
              <Icon
                name={options.visible === false ? "hidden" : "eye"}
                size={13}
              />
            </button>
            {selection.type === "model" && (
              <button
                aria-label={`${options.locked ? "解锁" : "锁定"} ${name}`}
                disabled={locked}
                onClick={() =>
                  e.commit((p) => ({
                    ...p,
                    models: p.models.map((m) =>
                      m.id === selection.id ? { ...m, locked: !m.locked } : m,
                    ),
                  }))
                }
              >
                <Icon name={options.locked ? "lock" : "unlock"} size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <Tooltip.Provider delayDuration={350}>
      <main
        className="editor-shell"
        style={{
          gridTemplateColumns: `${leftOpen ? "240px" : "0px"} minmax(0,1fr) ${rightOpen ? "272px" : "0px"}`,
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".aeproj,.json"
          hidden
          onChange={(ev) => void readFile(ev.target.files?.[0])}
        />
        {leftOpen && (
          <aside className="left-panel">
            <div className="project-header">
              <div className="project-topline">
                <Dropdown.Root>
                  <Dropdown.Trigger asChild>
                    <button className="brand-button" aria-label="项目菜单">
                      <img
                        className="brand-mark"
                        src="/brand/flightform.png"
                        width="28"
                        height="28"
                        alt=""
                      />
                      <span className="brand-name">{productName}</span>
                      <Icon name="down" size={10} />
                    </button>
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <Dropdown.Content
                      className="menu-content"
                      align="start"
                      sideOffset={6}
                    >
                      <MenuItem
                        icon="home"
                        onSelect={() => setDialog("project")}
                      >
                        新建与打开
                      </MenuItem>
                      <MenuItem
                        icon="plus"
                        onSelect={() => void startProject()}
                      >
                        新建空白项目
                      </MenuItem>
                      <MenuItem
                        icon="open"
                        onSelect={() => openFile("project")}
                      >
                        打开项目…
                      </MenuItem>
                      <MenuItem
                        icon="save"
                        shortcut={shortcuts.save}
                        onSelect={save}
                      >
                        保存项目文件
                      </MenuItem>
                      <Dropdown.Separator className="menu-separator" />
                      <MenuItem
                        icon="undo"
                        onSelect={e.undo}
                        disabled={!e.canUndo || locked}
                        shortcut={shortcuts.undo}
                      >
                        撤销
                      </MenuItem>
                      <MenuItem
                        icon="redo"
                        onSelect={e.redo}
                        disabled={!e.canRedo || locked}
                        shortcut={shortcuts.redo}
                      >
                        重做
                      </MenuItem>
                      <Dropdown.Separator className="menu-separator" />
                      <MenuItem
                        icon="flask"
                        onSelect={() => analysis ? setDialog("algorithm") : e.setMessage("请先加载多机路径分析模块。")}
                      >
                        导入 / 导出方案
                      </MenuItem>
                      <MenuItem icon="help" onSelect={() => setDialog("help")}>
                        操作说明
                      </MenuItem>
                    </Dropdown.Content>
                  </Dropdown.Portal>
                </Dropdown.Root>
                <ToolButton
                  icon="panel"
                  label="收起左侧面板"
                  onClick={() => setLeftOpen(false)}
                />
              </div>
              <TextField
                label="项目名称"
                value={e.project.name}
                disabled={locked}
                onChange={(name) => {
                  if (name !== e.project.name)
                    e.commit((p) => ({ ...p, name }), false);
                }}
              />
              <div className="project-caption">
                3D 航拍规划{" "}
                <span
                  className={"save-dot " + e.autosaveStatus}
                  role="status"
                  aria-label={autosaveLabels[e.autosaveStatus]}
                  title={autosaveLabels[e.autosaveStatus] + "。项目文件需单独保存。"}
                />
              </div>
            </div>
            <div className="panel-tabs">
              <button
                className={tab === "layers" ? "tab-active" : ""}
                onClick={() => setTab("layers")}
              >
                对象
              </button>
              <button
                className={tab === "assets" ? "tab-active" : ""}
                onClick={() => setTab("assets")}
              >
                资源
              </button>
              <button
                className={tab === "history" ? "tab-active" : ""}
                onClick={() => setTab("history")}
              >
                历史
              </button>
              <ToolButton
                icon="search"
                label="搜索对象"
                onClick={() => {
                  setTab("layers");
                  setSearch(search ? "" : " ");
                }}
              />
            </div>
            {tab === "layers" ? (
              <div className="layers-scroll">
                {search !== "" && (
                  <div className="search-field">
                    <Icon name="search" size={14} />
                    <input
                      aria-label="搜索对象"
                      placeholder="搜索对象…"
                      value={search.trimStart()}
                      onChange={(ev) => setSearch(ev.target.value || " ")}
                    />
                    <button aria-label="关闭搜索" onClick={() => setSearch("")}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
                <div className="scene-list">
                  <div className="section-heading">
                    <h3>场景</h3>
                    <span className="muted">1</span>
                  </div>
                  <button
                    className="scene-row"
                    onClick={() => {
                      e.select(null);
                      e.setView("perspective");
                      e.focus();
                    }}
                  >
                    <Icon name="check" size={12} />
                    场景 01<span>3D</span>
                  </button>
                </div>
                <div className="layers-heading">
                  <span>图层</span>
                  <ToolButton
                    icon="plus"
                    label="打开资源库"
                    onClick={() => setTab("assets")}
                  />
                </div>
                <div className="group-heading">
                  <button
                    onClick={() => toggle("models")}
                    aria-expanded={!collapsed.has("models")}
                  >
                    <Icon
                      name={collapsed.has("models") ? "chevron" : "down"}
                      size={12}
                    />
                    <Icon name="cube" size={13} />
                    模型<span>{e.project.models.length}</span>
                  </button>
                </div>
                {!collapsed.has("models") &&
                  e.project.models
                    .filter((m) => m.name.includes(search.trim()))
                    .map((m) =>
                      objectRow(
                        { type: "model", id: m.id },
                        m.name,
                        m.kind === "building"
                          ? "building"
                          : m.kind === "cylinder"
                            ? "cylinder"
                            : "cube",
                        { visible: m.visible, locked: m.locked },
                      ),
                    )}
                <div className="group-heading">
                  <button
                    onClick={() => toggle("drones")}
                    aria-expanded={!collapsed.has("drones")}
                  >
                    <Icon
                      name={collapsed.has("drones") ? "chevron" : "down"}
                      size={12}
                    />
                    <Icon name="drone" size={13} />
                    无人机<span>{e.project.drones.length}</span>
                  </button>
                  <ToolButton
                    icon="plus"
                    label="添加无人机"
                    disabled={locked}
                    onClick={e.addDrone}
                  />
                </div>
                {!collapsed.has("drones") &&
                  e.project.drones
                    .filter(
                      (d) =>
                        d.name.includes(search.trim()) ||
                        routeFor(e.project, d.id).some((v) =>
                          v.name.includes(search.trim()),
                        ),
                    )
                    .map((d) => (
                      <div key={d.id}>
                        {objectRow(
                          { type: "drone", id: d.id },
                          d.name,
                          "drone",
                          { color: d.color, visible: d.visible },
                        )}
                        {routeFor(e.project, d.id)
                          .filter(
                            (v) =>
                              v.name.includes(search.trim()) ||
                              d.name.includes(search.trim()),
                          )
                          .map((v, i) =>
                            objectRow(
                              { type: "viewpoint", id: v.id },
                              `${String(i + 1).padStart(2, "0")}  ${v.name}`,
                              "point",
                              { color: d.color, indent: true },
                            ),
                          )}
                      </div>
                    ))}
                {!e.project.models.length && !e.project.drones.length && (
                  <div className="empty-layers">
                    <p>从一个模型开始</p>
                    <button
                      className="secondary-button"
                      onClick={() => setTab("assets")}
                    >
                      打开资源库
                    </button>
                  </div>
                )}
              </div>
            ) : tab === "history" ? (
              <HistoryPanel />
            ) : (
              <div className="assets-scroll">
                <div className="section-heading">
                  <h3>内置资源</h3>
                  <span className="muted">4</span>
                </div>
                <p className="note">点击添加到场景</p>
                <div className="asset-grid">
                  {(
                    [
                      ["building", "教学楼", "建筑模型"],
                      ["box", "长方体", "基础形状"],
                      ["cylinder", "圆柱塔", "基础形状"],
                      ["drone", "无人机", "四旋翼"],
                    ] as const
                  ).map(([kind, name, desc]) => (
                    <button
                      className="asset-card"
                      key={kind}
                      disabled={locked}
                      onClick={() => {
                        kind === "drone" ? e.addDrone() : e.addModel(kind);
                        setTab("layers");
                      }}
                    >
                      <div className={"asset-preview asset-" + kind}>
                        <Icon name={kind === "box" ? "cube" : kind} size={42} />
                      </div>
                      <strong>{name}</strong>
                      <small>{desc}</small>
                    </button>
                  ))}
                </div>
                <div className="asset-footnote">
                  <Icon name="check" size={13} />
                  点击模型，添加到场景
                </div>
              </div>
            )}
            <div className="panel-footer">
              <Icon name="grid" size={13} />
              <span>模拟工作区</span>
              <ToolButton
                icon="help"
                label="操作说明"
                onClick={() => setDialog("help")}
              />
            </div>
          </aside>
        )}
        <section
          className={
            "viewport " +
            (e.tool === "point" || e.tool === "target" ? "crosshair" : "")
          }
          aria-label="三维工作区"
        >
          <Scene Controls={manualControls?.EditorControls} />
          <div className="viewport-top-left">
            {!leftOpen && (
              <ToolButton
                icon="panel"
                label="展开左侧面板"
                onClick={() => setLeftOpen(true)}
              />
            )}
            <span className="scene-breadcrumb">
              场景 01 <span>/</span> {e.preview ? "任务预演" : "编辑场景"}
            </span>
          </div>
          <div className="view-controls">
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button className="view-menu">
                  {views.find((v) => v[0] === e.view)?.[1]}
                  <Icon name="down" size={12} />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content className="menu-content" align="end">
                  {views.map(([view, label]) => (
                    <MenuItem
                      key={view}
                      icon={view === "drone" ? "camera" : "cube"}
                      disabled={view === "drone" && !e.project.drones.length}
                      onSelect={() => {
                        e.setView(view);
                        if (playback && view === "drone" && e.selection?.type !== "viewpoint") e.setPreview(true);
                      }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                  <Dropdown.Separator className="menu-separator" />
                  <MenuItem icon="target" onSelect={e.focus}>
                    聚焦选中对象
                  </MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
            {!rightOpen && (
              <ToolButton
                icon="panel"
                label="展开属性面板"
                onClick={() => setRightOpen(true)}
              />
            )}
          </div>
          <CandidateBanner clearError={() => setFileError("")} />
          {(e.tool === "point" || e.tool === "target") && !e.preview && (
            <div className="mode-banner">
              <Icon name={e.tool === "point" ? "point" : "target"} />
              <span>
                {e.tool === "point"
                  ? `点击场景添加拍摄点 · ${e.chosenDrone()?.name ?? ""}`
                  : "点击建筑表面指定镜头目标"}
              </span>
              <button onClick={() => e.setTool("select")}>
                退出 <kbd>Esc</kbd>
              </button>
            </div>
          )}
          <div className="viewport-bottom-left">
            <span className="axis-symbol">Y↑</span>
            <span>单位 m</span>
            <span className="sep">·</span>
            <span>模拟场景</span>
          </div>
          <Playback />
          <div
            className="floating-toolbar"
            role="toolbar"
            aria-label="编辑工具"
          >
            <ToolButton
              icon="cursor"
              label="选择 V"
              active={e.tool === "select" && !e.preview}
              onClick={() => chooseTool("select")}
              disabled={locked}
            />
            <ToolButton
              icon="move"
              label="移动 M"
              active={e.tool === "translate" && !e.preview}
              onClick={() => chooseTool("translate")}
              disabled={locked}
            />
            <ToolButton
              icon="rotate"
              label="旋转 R"
              active={e.tool === "rotate" && !e.preview}
              onClick={() => chooseTool("rotate")}
              disabled={locked || e.selection?.type === "viewpoint"}
            />
            <ToolButton
              icon="scale"
              label="缩放 K"
              active={e.tool === "scale" && !e.preview}
              onClick={() => chooseTool("scale")}
              disabled={locked || e.selection?.type !== "model"}
            />
            <div className="toolbar-divider" />
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button
                  className="icon-button add-tool"
                  aria-label="添加模型"
                  disabled={locked}
                >
                  <Icon name="cube" />
                  <span className="tool-label">模型</span>
                  <Icon name="down" size={9} />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="menu-content"
                  side="top"
                  sideOffset={12}
                >
                  <MenuItem
                    icon="building"
                    onSelect={() => e.addModel("building")}
                  >
                    内置教学楼
                  </MenuItem>
                  <MenuItem icon="cube" onSelect={() => e.addModel("box")}>
                    长方体
                  </MenuItem>
                  <MenuItem
                    icon="cylinder"
                    onSelect={() => e.addModel("cylinder")}
                  >
                    圆柱塔
                  </MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
            <ToolButton
              icon="drone"
              label="添加无人机"
              onClick={e.addDrone}
              disabled={locked}
            >
              <span className="tool-label">无人机</span>
            </ToolButton>
            <ToolButton
              icon="point"
              label="添加拍摄点"
              active={e.tool === "point"}
              onClick={() => chooseTool("point")}
              disabled={locked || !e.project.drones.length}
            >
              <span className="tool-label">拍摄点</span>
            </ToolButton>
            <div className="toolbar-divider" />
            <ToolButton
              icon="flask"
              label="导入 / 导出方案"
              onClick={() => analysis ? setDialog("algorithm") : e.setMessage("请先加载多机路径分析模块。")}
              disabled={locked}
            />
            <ToolButton
              icon={e.preview ? "pause" : "play"}
              label="预演方案"
              active={e.preview}
              onClick={() => {
                if (playback) e.setPreview(!e.preview);
                else e.setMessage("请先加载动态可视化模块。");
                e.setPlaying(false);
                e.setTool("select");
              }}
            >
              <span className="tool-label">预演</span>
            </ToolButton>
          </div>
          {!dialog && (
            <div className={"notice-stack" + (e.candidate || e.tool === "point" || e.tool === "target" ? " below-mode" : "")}>
              {(e.autosaveStatus === "error" || e.autosaveStatus === "paused") && (
                <div role="alert" className="persistent-notice">
                  <span>{autosaveLabels[e.autosaveStatus]}。请保存项目文件，以免丢失修改。</span>
                  <button onClick={() => void save()}>保存项目</button>
                </div>
              )}
              {e.recoveryNotice && (
                <div role="alert" className="persistent-notice">
                  <span>{e.recoveryNotice}</span>
                  <button onClick={() => void openFile("project")}>打开项目</button>
                  <button aria-label="关闭恢复提示" onClick={e.dismissRecoveryNotice}><Icon name="close" size={12} /></button>
                </div>
              )}
              {fileError && (
                <div role="alert" className="persistent-notice">
                  <span>{fileError}</span>
                  <button aria-label="关闭文件提示" onClick={() => setFileError("")}><Icon name="close" size={12} /></button>
                </div>
              )}
              {e.message && <div role="status" className="toast">{e.message}</div>}
            </div>
          )}
        </section>
        {rightOpen && (
          <aside className="right-panel">
            <div className="right-topline">
              <Icon name="open" size={15} />
              <span className="local-label">本地项目</span>
              <ToolButton
                icon="play"
                label="打开预演"
                onClick={() => {
                  if (playback) e.setPreview(true);
                  else e.setMessage("请先加载动态可视化模块。");
                  e.setTool("select");
                }}
              />
              <button className="primary-button" onClick={() => void save()}>
                保存
              </button>
            </div>
            <div className="panel-tabs right-tabs">
              <button
                className={!e.preview ? "tab-active" : ""}
                onClick={() => {
                  e.setPreview(false);
                  e.setPlaying(false);
                  if (e.view === "drone") e.setView("perspective");
                }}
              >
                设计
              </button>
              <button
                className={e.preview ? "tab-active" : ""}
                onClick={() => {
                  if (playback) e.setPreview(true);
                  else e.setMessage("请先加载动态可视化模块。");
                  e.setTool("select");
                }}
              >
                预演
              </button>
              <ToolButton
                icon="panel"
                label="收起属性面板"
                onClick={() => setRightOpen(false)}
              />
            </div>
            <Inspector />
          </aside>
        )}
        <Dialog.Root
          open={!!dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content">
              <div className="dialog-heading">
                <Dialog.Title>
                  {dialog === "project"
                    ? "项目"
                    : dialog === "algorithm"
                      ? "导入 / 导出方案"
                      : "操作说明"}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button className="icon-button" aria-label="关闭弹窗">
                    <Icon name="close" />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="dialog-description">
                {dialog === "project"
                  ? "用模型搭建场景，为无人机安排拍摄任务。"
                  : dialog === "algorithm"
                    ? "导出场景，或导入航拍方案并预览。"
                    : "搭建场景、安排拍摄点，再预演航线。"}
              </Dialog.Description>
              {fileError && (
                <p className="file-error" role="alert">
                  {fileError}
                </p>
              )}
              {!fileError && e.message && (
                <p className="dialog-status" role="status">{e.message}</p>
              )}
              {dialog === "project" && (
                <div className="project-options">
                  <button onClick={() => void startProject(true)}>
                    <Icon name="building" size={24} />
                    <strong>打开示例</strong>
                    <span>校园模型 · 两架无人机 · 八个拍摄点</span>
                  </button>
                  <button onClick={() => void startProject()}>
                    <Icon name="plus" size={24} />
                    <strong>新建项目</strong>
                    <span>从空白场景开始</span>
                  </button>
                  <button onClick={() => openFile("project")}>
                    <Icon name="open" size={24} />
                    <strong>打开项目</strong>
                    <span>继续编辑 .p15.json 项目文件</span>
                  </button>
                </div>
              )}
              {dialog === "algorithm" && (
                <AnalysisPanel openFile={openFile} exportFile={exportFile} filesAvailable={!!projectFiles} />
              )}
              {dialog === "help" && <Help />}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </Tooltip.Provider>
  );
}
