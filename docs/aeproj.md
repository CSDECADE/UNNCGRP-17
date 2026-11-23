# 项目包 `.aeproj` 与历史 / 检查点

维护：基础框架。各模块的对接事项见 [handoff-history-aeproj.md](handoff-history-aeproj.md)。实现：`src/core/history.ts`、`src/core/aeproj/`、`src/core/documents.tsx`、`src/core/localStore.ts`、`desktop/recent.cjs`。

## 历史与检查点

- 每次 `commit` 产生一条带名称和时间的历史记录（`HistoryEntry`）。撤销和重做各最多保留 **50** 步（`HISTORY_LIMIT`）。超出部分丢弃最旧的记录；新的修改会清空重做。
- 左侧「历史」面板可以跳到时间线上的任意一步（`jumpTo`），跳转后另一侧的记录仍然保留。
- 检查点（`Checkpoint`）是带名称的场景快照，**数量不限**，不受撤销上限影响。恢复检查点本身也算一次修改，可以撤销。
- 模块可以调用 `useEditor()` 上的 `createCheckpoint / restoreCheckpoint / renameCheckpoint / deleteCheckpoint / historyEntries / jumpTo`。`commit(next, manual, label)` 的第三个参数是这一步在历史中显示的名称，可选。

## 包结构

`.aeproj` 是标准 ZIP 文件，可以用任意解压工具查看。只使用 stored/deflate 两种存储方式，文件名为 UTF-8，不使用 ZIP64。

| 路径 | 内容 |
| --- | --- |
| `mimetype` | `application/vnd.aero.project+zip`，第一个条目，不压缩 |
| `manifest.json` | `format: "aeproj"`、`formatVersion`（1 或 2，见下文）、`projectVersion`、生成程序及版本、创建 / 保存时间，以及其余每个文件的 SHA-256 和字节数 |
| `project.json` | 当前场景（`Project` version 1，含 OBJ 时为 version 2） |
| `history.json` | `{ limit, present: {label, at}, past: [...], future: [...] }`，每条记录为 `{ label, at, project }` |
| `checkpoints.json` | `[{ id, name, createdAt, project }]` |
| `reconstruction.json` | 可选：重建设置，参考模型 / 白模以 `asset: "assets/<sha256>.glb"` 引用 |
| `assets/<sha256>.<png\|jpg\|webp\|glb>` | 被任一状态引用的二进制资源（背景图片、重建模型），按内容去重 |
| `resources/<sha256>.json` | OBJ 网格资源（`objResources` 的单个元素），按内容去重；仅 `formatVersion: 2` |

包内场景的 `background.image` 用 `asset: "assets/…"` 引用资源，不内嵌 data URL；`objResources` 的每个元素写成 `{ "resource": "resources/…" }`。读取时再还原。所有内容都在包内，不引用包外的文件。

### OBJ 资源去重

每个历史状态和检查点都保存一份完整场景。OBJ 网格如果内嵌在场景里，会被重复保存（50 步撤销 + 50 步重做 + 检查点，最多一百多份）。因此网格单独写入 `resources/`，文件名是其 JSON 内容的 SHA-256：没有改动的网格在整个包里只存一份，修改过顶点的状态各自多一个文件。实测 KayKit building_H（1,558 个顶点）、50 步历史和 10 个检查点：包从 1.78 MB 降到 0.03 MB，打包从约 1 s 降到 20 ms。

读取时同一个 `resources/` 文件只解析一次，经过 `validateProject` 后，引用同一文件的所有状态拿到的是**同一个对象**，和编辑时的结构共享一致。

### 格式版本

| `formatVersion` | 含义 |
| --- | --- |
| 1 | 不含 `resources/`。没有 OBJ 资源的项目仍按版本 1 写出，旧版应用可以打开 |
| 2 | 含 `resources/` 引用。旧版应用打开时提示更新应用 |

读取端接受 1 和 2；更高的版本提示用户更新应用。

## 读取校验

打开时会校验：ZIP 结构、CRC、大小上限（包 ≤ 256 MB，解压后 ≤ 1 GB）、`mimetype`、清单中的 SHA-256，并拒绝清单之外的文件。`resources/` 和 `assets/*.glb` 的文件名还必须等于清单中登记的哈希。每个历史状态和检查点都会经过 `validateProject`。超过 50 步的历史在读取时截断，不会报错。`formatVersion` 高于 2 的包会提示用户更新应用。

## 存储与最近项目

- 桌面版：通过 `p15:open-project / p15:open-recent / p15:accept-project / p15:save-package` 读写。最近项目保存在应用数据目录的 `recent-projects.json` 中，最多 12 个；渲染进程只拿得到 id，拿不到文件路径。旧版 `.json` 项目仍然可以打开，下次保存时转换为 `.aeproj`。
- 浏览器预览：用文件选择器打开，保存时以下载方式导出。最近项目的副本存在 IndexedDB 中（最多 8 个）。
- 两者都会把完整会话（历史 + 检查点）自动暂存到 IndexedDB，开屏页面提供「继续上次的工作」。
- 导出和文档模块（`src/features/project-files/`）加入后，会替换基础的 `useProjectFiles`。该模块保存项目时应调用 `useDocuments().save / open`，否则保存出的文件不含历史和检查点。
