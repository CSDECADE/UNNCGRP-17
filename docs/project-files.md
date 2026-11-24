# 导出和文档

> 维护：倪梓峻　目录：`src/features/project-files/`　接口：`src/features/contracts.ts` 的 `ProjectFileControls`

本模块负责应用里所有「文件进、文件出」的操作：打开项目、保存项目、新建/打开示例、导入候选航线、导出 JSON，以及操作说明页。

项目文件的保存与打开**必须**经过 `useDocuments()`（`src/core/documents.tsx`），因为 `.aeproj` 项目包里带着最近 50 步历史、全部检查点和背景图片（包结构、清单校验与读取规则见 [`aeproj.md`](aeproj.md)）。模块自己不序列化项目 JSON——那样会丢掉历史和检查点，开始页的「最近项目」也不会更新。

## 使用

1. **新建 / 打开示例**：项目菜单里选「新建项目」或「打开示例」，会开启新会话，历史和检查点清空。
2. **打开项目**：选「打开项目…」，选择 `.aeproj` 项目包；旧版 `.json` 项目也能打开，保存时会自动转换。
3. **保存**：`Ctrl/Cmd + S` 或右上角「保存」按钮。桌面版弹系统对话框保存到你选择的位置，浏览器版下载文件。
4. **导入候选航线**：「多机路径分析」面板里的「导入候选航线 JSON」。支持两种格式：
   - `{ "version": 1, "viewpoints": [...] }`
   - 路径数组 `[{ "id", "x", "y", "z", "normal" }, …]`

   导入后先进入候选状态，可以比较总航程；点「应用」才替换当前航线，点「取消」不修改项目。
5. **导出 JSON**：`exportFile(data, name)` 供其他模块导出纯数据（场景 JSON 给算法组、航线 JSON 等）。桌面版走 `p15:save`，浏览器版直接下载。

## 集成

模块只导出两个东西，由 `src/features/modules.tsx` 在构建时探测：

| 文件 | 导出 | 作用 |
| --- | --- | --- |
| `index.tsx` | `useProjectFiles(close, acceptPlan)` | 返回完整的 `ProjectFileControls` |
| `Help.tsx` | `Help` | 帮助对话框内容 |

实现要点：

- **项目操作**全部转发文档层：`openFile("project")` → `docs.open()`，`save()` → `docs.save(saveAs)`，`startProject()` → `docs.start(example)`，`readFile(file)` → `docs.readFile(file)`。
- **方案操作**留在本模块：桌面版 `window.p15Desktop.openFile("plan")`，浏览器版用隐藏 `<input type=file>`；文本限制 5 MB。
- **文件识别顺序**：先按 ZIP 魔数判断 `.aeproj`（`isPackage()`），读不成包再按 JSON 内容区分「方案」和「旧版项目」，最后交给 `docs.readFile()` 走旧 JSON 转换分支。
- **错误文案**统一走 `fileErrorMessage()`，不把异常栈露到界面上。

## 验收

| 场景 | 操作 | 期望结果 |
| --- | --- | --- |
| 保存并重开 | 打开示例 → 改动一步 → 保存 → 关闭页面 → 打开项目选它 | 场景恢复，左侧「历史」页能看到保存前的时间线和检查点 |
| 桌面版最近项目 | 保存到文件夹 → 重启应用 → 开始页「最近项目」打开 | 历史、检查点完整，可直接继续编辑 |
| 旧项目兼容 | 打开旧版 `.json` 项目 | 能打开，并提示保存时会转换为 `.aeproj` |
| 方案导入（版本化） | 导入 `docs/path_sample.json` | 出现候选横幅，可比较总航程 |
| 方案导入（数组） | 导入路径数组 JSON | 按 id 排序成航线，分配给第一架无人机 |
| 取消候选 | 导入后点「取消」 | 项目完全不变 |
| 文本超限 | 选择超过 5 MB 的 JSON | 提示「文件超过 5 MB」，不打开 |
| 选错文件 | 在「导入候选航线」里选了 `.aeproj` | 按项目包打开，不报方案格式错误 |
| 帮助页 | 菜单或工具栏打开「操作说明」 | 显示上述步骤 |

## 已知限制

- **导出接口暂时没有界面入口**：`App.tsx` 的「项目」对话框只有打开示例、新建项目、打开项目三个按钮；`AnalysisPanel` 接收了 `exportFile` 参数但当前没有使用。接口已就绪，等基础框架或分析模块加按钮后才可点击。
- 桌面版的保存、最近项目链路没有在真实 Electron 窗口里验证过（见 `handoff-history-aeproj.md` §6），浏览器版已实测。
- 浏览器版的「最近项目」是 IndexedDB 副本，最多 8 条；桌面版最多 12 条且只保存路径。
- 项目包上限 256 MB，文本 JSON 上限 5 MB。
