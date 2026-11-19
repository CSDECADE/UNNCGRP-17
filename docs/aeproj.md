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
| `manifest.json` | `format: "aeproj"`、`formatVersion: 1`、生成程序及版本、创建 / 保存时间，以及其余每个文件的 SHA-256 和字节数 |
| `project.json` | 当前场景（`Project` version 1） |
| `history.json` | `{ limit, present: {label, at}, past: [...], future: [...] }`，每条记录为 `{ label, at, project }` |
| `checkpoints.json` | `[{ id, name, createdAt, project }]` |
| `assets/<sha256>.<png\|jpg\|webp>` | 被任一状态引用的二进制资源（目前是背景图片），按内容去重 |

包内场景的 `background.image` 用 `asset: "assets/…"` 引用资源，不内嵌 data URL；读取时再还原。所有内容都在包内，不引用包外的文件。

## 读取校验

打开时会校验：ZIP 结构、CRC、大小上限（包 ≤ 256 MB，解压后 ≤ 1 GB）、`mimetype`、清单中的 SHA-256，并拒绝清单之外的文件。每个历史状态和检查点都会经过 `validateProject`。超过 50 步的历史在读取时截断，不会报错。`formatVersion` 不认识的包会提示用户更新应用。

## 存储与最近项目

- 桌面版：通过 `p15:open-project / p15:open-recent / p15:accept-project / p15:save-package` 读写。最近项目保存在应用数据目录的 `recent-projects.json` 中，最多 12 个；渲染进程只拿得到 id，拿不到文件路径。旧版 `.json` 项目仍然可以打开，下次保存时转换为 `.aeproj`。
- 浏览器预览：用文件选择器打开，保存时以下载方式导出。最近项目的副本存在 IndexedDB 中（最多 8 个）。
- 两者都会把完整会话（历史 + 检查点）自动暂存到 IndexedDB，开屏页面提供「继续上次的工作」。
- 导出和文档模块（`src/features/project-files/`）加入后，会替换基础的 `useProjectFiles`。该模块保存项目时应调用 `useDocuments().save / open`，否则保存出的文件不含历史和检查点。
