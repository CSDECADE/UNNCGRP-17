# 交接文档：回溯 / 检查点、`.aeproj` 项目包、开始页

> 维护：基础框架　分支：`feat/history-checkpoints-aeproj`　适用版本：0.4.0 之后
> 文件格式本身的细节见 [`aeproj.md`](aeproj.md)；本文写的是**各模块需要知道什么、需要改什么**。

## 0. 先看这里（3 分钟版）

| 你是 | 需要做的事 | 优先级 |
| --- | --- | --- |
| 倪梓峻（导出和文档 `project-files`） | 保存 / 打开项目改为调用 `useDocuments()`，不要再自己写 `.json` 项目。见 §4.1 | **必须** |
| 陈宇昂（测试 `tests/`） | 用到旧历史结构或旧报错文案的测试需要更新，并补充新测试。见 §4.5 | **必须** |
| 袁逍（手动编排 `manual`） | 不改也能运行；可选：给 `commit` 加上历史名称 | 可选 |
| 戴宇驰（动态可视化 `playback`） | 不需要改；了解撤销 / 跳转会重置播放 | 了解即可 |
| 鲁逸尘（分析 `analysis`） | 不需要改；可选：`replace` 加上历史名称 | 可选 |

一句话总结：**项目文件从 `.json` 变成了 `.aeproj` 包，里面带着最近 50 步历史和全部检查点；编辑器多了检查点和历史跳转；启动时先显示开始页。**

---

## 1. 用户能看到的变化

| 变化 | 以前 | 现在 |
| --- | --- | --- |
| 撤销深度 | 60 步，只在内存里 | **50 步撤销 + 最多 50 步重做**，会存进项目包 |
| 历史面板 | 无 | 左侧新增「历史」页：时间线可以点击跳转，每步有名称和时间 |
| 检查点 | 无 | 历史页顶部可以创建、恢复、重命名（双击）、删除，**数量不限**；菜单里有「创建检查点」 |
| 项目文件 | `.json`（只有当前场景） | **`.aeproj`**（场景 + 历史 + 检查点 + 背景图片）。旧 `.json` 仍可打开，保存时自动转换 |
| 启动 | 直接进入示例或上次暂存的项目 | **先显示开始页**：新建 / 打开 / 示例 / 继续上次的工作 / 最近项目 |
| 本机自动暂存 | localStorage，只存当前场景 | IndexedDB，保存**整个会话**（历史 + 检查点）。旧数据会自动迁移 |
| 新建 / 打开示例 | 一次可以撤销的替换 | 开启**新的会话**，历史和检查点清空，不能撤销回上一个项目 |

---

## 2. 编辑器 API 变化（`useEditor()`）

### 2.1 不变的部分（放心继续用）

`project`、`readProject()`、`committedProject`、`commit()`、`patch()`、`beginTransform / updateTransform / finishTransform / cancelTransform`、`select`、`setTool`、`setView`、`progress / playing / preview / candidate` 相关、`undo()`、`redo()`、`canUndo`、`canRedo`、`replace()`、`newProject()`、`example()`、`setMessage()`。

它们的参数和返回值都**向后兼容**。

### 2.2 新增或扩展

```ts
// commit / replace 新增一个可选参数：这一步在历史面板中显示的名称（默认「编辑场景」/「替换场景」）
e.commit(p => ({ ...p, name }), false, "重命名项目");
e.replace(project, "导入算法方案");

// 历史时间线（从旧到新），index 指向当前状态
const { entries, index } = e.historyEntries;  // entries: { project, label, at }[]
e.jumpTo(3);                                   // 跳到第 3 条，另一侧的记录保留

// 检查点
e.checkpoints;                       // { id, name, createdAt, project }[]
e.createCheckpoint("初稿");          // 名称可省略，自动生成「检查点 N」
e.restoreCheckpoint(id);             // 恢复本身也是一步历史，可以撤销
e.renameCheckpoint(id, "新名称");
e.deleteCheckpoint(id);              // 无法撤销

// 会话（给文档层用，一般模块不需要）
e.history;          // { past, present, future }，每项都是 HistoryEntry
e.exportSession();  // { history, checkpoints }
e.loadSession(s);   // 整体替换会话（打开文件时用）
e.active;           // 从开始页进入项目之前为 false
```

### 2.3 有破坏性的变化（直接读内部结构时需要注意）

| 项 | 以前 | 现在 |
| --- | --- | --- |
| 历史中的元素 | `Project` | `HistoryEntry = { project, label, at }` |
| `commitTransformHistory(h, session)`（`core/transform.ts`） | 泛型，`h.present` 为 `Project` | `(h: History, session, label = "调整对象") => History`，`h.present.project` 为 `Project` |
| 历史上限 | `slice(-60)` | `HISTORY_LIMIT = 50`（`core/history.ts`） |
| localStorage 键 `p15.project.v1` | 自动暂存 | 只在迁移时读一次，之后删除；**不要再写这个键** |
| `persistProject()`（`core/feedback.ts`） | 编辑器在用 | 编辑器已经不用了，保留只是为了兼容 |
| 「打开项目」校验失败时的报错文案 | 「…项目文件不完整或不受支持，请重新选择…」 | 括号里加了具体原因：「…项目文件不完整或不受支持（项目包内容校验失败），请…」 |

---

## 3. 新的文档层（`useDocuments()`）

文件：`src/core/documents.tsx`。`main.tsx` 已经用 `<DocumentProvider>` 包好，任何组件都可以直接调用。

```ts
import { useDocuments } from "../../core/documents";
const docs = useDocuments();

await docs.save();          // 保存到当前文件；没有当前文件时弹出另存为。返回 true 表示保存成功
await docs.save(true);      // 另存为
await docs.open();          // 弹出选择框打开 .aeproj 或旧 .json。返回 true 表示已打开
await docs.readFile(file);  // 浏览器版：从 <input type=file> 拿到的 File
await docs.start(example?); // 新建空白项目 / 打开示例（开启新会话）
await docs.openRecent(id);
docs.recent;                // 最近项目 [{ id, name, fileName, folder?, openedAt, missing }]
docs.fileName;              // 当前文件名，未保存时为 null
docs.error; docs.setError;  // 已经格式化好的中文报错，可以直接显示
docs.busy;                  // 正在读写文件时为 true
```

- 打包和解包由文档层完成，调用方不需要接触 ZIP 或 `packSession`。
- 桌面版和浏览器版的差异（对话框还是下载、最近项目放在哪里）都在文档层里处理掉了。
- 「方案」的导入导出（`openFile("plan")`、`exportFile`）**不在**文档层，仍然由各模块负责。

---

## 4. 各成员对接清单

### 4.1 倪梓峻 · 导出和文档 `src/features/project-files/`

你的 `useProjectFiles()` 加入后会**整体替换**基础版本（`src/features/modules.tsx` 中的 `useBaseProjectFiles`）。如果继续用旧的 JSON 读写，**保存出来的文件不会包含历史和检查点**，开始页的「最近项目」也不会更新。

**需要改：**项目相关的四个操作转给文档层，方案相关的保持不变。可以参照下面的写法（基础版本就是这么写的）：

```ts
import { useDocuments } from "../../core/documents";

export function useProjectFiles(close: () => void, acceptPlan: (text: string) => void): ProjectFileControls {
  const docs = useDocuments();
  // ……你原有的 plan 相关 state……
  return {
    fileInput,                                   // 只用于方案导入
    fileError: planError || docs.error,
    setFileError: (m) => { setPlanError(m); docs.setError(m); },
    openFile: async (mode) => {
      if (mode === "plan") return openPlan();    // 你原来的方案导入
      if (await docs.open()) close();
    },
    readFile: async (file) => { /* 方案文件走你原来的逻辑；.aeproj / 项目 .json 交给 docs.readFile(file) */ },
    save: async (saveAs = false) => { await docs.save(saveAs); },
    exportFile,                                  // 不变：导出场景 / 方案 JSON
    startProject: async (example = false) => { await docs.start(example); close(); },
  };
}
```

**注意：**

- 桌面版旧的 IPC `p15:open("project")`、`p15:save({kind:"project"})`、`p15:accept-open` **仍然保留**，但只是为了兼容，**不要再用它们保存项目**。方案和导出继续使用 `p15:open("plan")`、`p15:save({kind:"export"})`。
- 新的 IPC（`p15:open-project / open-recent / accept-project / save-package / recent-list / recent-remove`）由文档层调用，你不需要直接用。
- 「导出场景 JSON 给算法组」这个功能不受影响：导出的仍然是纯 `Project` JSON。
- `docs/project-files.md` 里如果有「项目保存为 `.p15.json`」之类的描述，请改为 `.aeproj`，并链接到 [`aeproj.md`](aeproj.md)。

**验收：**保存 → 关闭应用 → 从开始页的「最近项目」打开 → 历史页能看到原来的历史和检查点。

### 4.2 袁逍 · 手动编排 `src/features/manual/`

- 拖拽变换（`beginTransform → updateTransform → finishTransform`）**不需要改**。每次拖拽仍然只产生一条历史记录，名称是「调整对象」。
- `patch()` 产生的记录名称是「修改属性」。
- **可选：**如果你在 Inspector 里直接调用 `e.commit(...)`，可以加上第三个参数，让历史面板更好读：
  ```ts
  e.commit(p => ({ ...p, models: ... }), true, "修改模型尺寸");
  ```
- 撤销、重做、跳转、恢复检查点时，编辑器会自动取消正在进行的拖拽（和以前的撤销行为一致）。

### 4.3 戴宇驰 · 动态可视化 `src/features/playback/`

- **不需要改。**
- 撤销、重做、跳转历史、恢复检查点、打开文件都会把 `playing` 设为 `false`、`progress` 设为 `0`，并清空 `candidate`，和以前撤销时的行为相同。
- 开始页显示期间（`e.active === false`，或用户从菜单打开了开始页），全局快捷键不会生效，空格键也不会触发播放。

### 4.4 鲁逸尘 · 分析 `src/features/analysis/`

- **不需要改。**`setCandidate` 和 `replace` 的行为不变。
- **可选：**应用方案时可以写成 `e.replace(project, "应用算法方案")`，历史面板里就会显示这个名称。
- 候选方案（candidate）预览期间：历史面板和检查点按钮会被禁用，保存会提示先应用或取消，这一点和以前相同。
- 恢复检查点或跳转历史会**清空候选方案**。

### 4.5 陈宇昂 · 测试 `tests/`

`scripts/test.mjs` 用 `node --experimental-strip-types --test` 运行。新增的核心文件都使用 `.ts` 后缀导入，可以直接在 Node 里测试；Node 22 自带 `CompressionStream` 和 `crypto.subtle`，不需要 polyfill。

**可能需要更新的旧测试：**

- 直接构造 `{ past: [project], present: project, future: [] }` 去调用 `commitTransformHistory` 的测试，改成：
  ```ts
  import { startHistory } from "../src/core/history.ts";
  const h = startHistory(project);
  const next = commitTransformHistory(h, session);
  assert.equal(next.present.project.models[0].position[0], 5);
  ```
- 断言历史上限为 60 的测试改为 `HISTORY_LIMIT`（50）。
- 断言「打开项目」校验失败时完整文案的测试，需要适配新增的括号原因（见 §2.3）。
- 涉及 localStorage 键 `p15.project.v1` 自动暂存的测试已经过时。

**建议新增的测试**（基础框架这边验证时都跑过，可以直接改写成正式测试）：

| 文件 | 用例 |
| --- | --- |
| `history.test.ts` | 连续提交 80 次后 `past.length === 50`；撤销到底正好 50 次；全部重做后回到最新；`jumpHistory` 前后跳转并保留另一侧；跳转后再提交会清空重做 |
| `aeproj.test.ts` | 带背景图片和 60 步历史的会话 `packSession → unpackSession` 后 `deepEqual`；多个状态共用同一张图时包里只有 1 个 `assets/*`；改动包中间的 1 个字节会被拒绝；`formatVersion: 2` 会被拒绝；清单之外多出的文件会被拒绝；超过 50 步的历史在读取时被截断 |
| `recent.test.cjs` | `desktop/recent.cjs`：重复 `touch` 同一路径不会产生重复项且排到最前；被删除的文件 `missing: true`；最多 12 条；重新创建 store 后仍能读回 |

`aeproj.test.ts` 中背景图片可以用这张 1×1 PNG：
`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`

另外，`docs/quality.md` 的回归清单里建议加上：保存 → 在另一台电脑打开 → 撤销 / 重做 / 检查点都可用。

---

## 5. 文件地图

| 文件 | 作用 |
| --- | --- |
| `src/core/history.ts` | 纯函数：`pushHistory / undoHistory / redoHistory / jumpHistory / timeline`，以及 `HISTORY_LIMIT` 和各个类型 |
| `src/core/editor.tsx` | 把上面的函数接入编辑器状态，并提供检查点、`exportSession / loadSession` |
| `src/core/aeproj/zip.ts` | 不依赖第三方库的 ZIP 读写（stored / deflate，带 CRC 校验） |
| `src/core/aeproj/package.ts` | `packSession / unpackSession`：清单、SHA-256、资源去重和全量校验 |
| `src/core/documents.tsx` | `DocumentProvider / useDocuments`：打开、保存、最近项目、自动暂存 |
| `src/core/localStore.ts` | IndexedDB：自动暂存的会话，以及浏览器版的最近项目副本 |
| `src/HistoryPanel.tsx` | 左侧「历史」页 |
| `src/StartScreen.tsx` | 开始页 |
| `desktop/main.cjs` | 新增 IPC（见 §4.1） |
| `desktop/recent.cjs` | 最近项目，存在 `应用数据目录/Aero P15 Team/recent-projects.json` |
| `desktop/files.cjs` | `readBinaryFile / writeFileAtomic / validatePackage` |

## 6. 已知限制与未验证项

- **桌面版（Electron）的打开、保存和最近项目还没有在真实窗口里跑过**（开发环境没有 Electron 程序）。主进程的 `recent.cjs` 和 `files.cjs` 已经用 Node 单独测过；浏览器版的完整流程测过。请第一个在本机运行 `npm run dev` 的同学帮忙走一遍：保存 → 重启 → 最近项目 → 打开。
- 桌面版**重启后选择「继续上次的工作」**时，应用已经不知道原来的文件路径，第一次保存会弹出另存为对话框（会有提示）。
- 浏览器版保存是**下载**一个文件，最近项目里存的是 IndexedDB 中的副本，最多 8 个。
- 检查点保存的是**场景快照**，不包含当时的撤销历史。
- 删除检查点**无法撤销**（会弹出确认框）。
- 包的大小上限是 256 MB，背景图片仍然受原来的 1.2 MB 和 2048 px 限制。

## 7. 常见问题

**问：我只想读当前场景，需要关心历史吗？**
不需要。继续用 `e.project` 或 `e.committedProject`。

**问：外部工具（比如算法组）能直接读 `.aeproj` 吗？**
可以。它就是标准 ZIP 文件，解压后的 `project.json` 就是原来的 `Project` JSON（背景图片改为 `assets/` 引用，见 `aeproj.md`）。

**问：我的模块需要往包里存额外数据怎么办？**
请先联系基础框架负责人。包格式受 `formatVersion` 和清单校验约束，清单之外的文件会被拒绝打开，新增条目需要统一修改 `package.ts` 和格式版本号。
