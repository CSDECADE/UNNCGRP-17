# UNNCGRP-17
It's a school project


# Aero P15 小组基础工程

Aero 是无人机航拍场景的桌面模拟工具。基础工程包含 Electron 窗口、三维场景、内置模型、背景设置、对象列表和示例项目。

## 启动

使用 Node.js 22.13 或更高版本（推荐 24 LTS），在解压出的工程根目录运行：

```sh
npm ci
npm run dev
```

`npm run dev` 构建并启动 Electron 桌面窗口。`npm run dev:web` 启动浏览器预览。`npm run build` 生成 `dist/`。首次安装依赖需要联网，运行时的模型与图标均在 `public/`。桌面版使用系统应用数据目录下的 `Aero P15 Team` 存放暂存数据。

## 加入成员模块

把成员 ZIP 的内容解压到此目录，使 `src/features/`、`docs/` 和 `tests/` 与同名目录合并。每个包只提供自己负责的文件。重新运行 `npm run dev` 后，存在的功能入口会自动启用。

| 成员 | 维护目录 |
| --- | --- |
| 基础框架 | 应用入口、`src/core/`、`src/features/contracts.ts`、`src/features/modules.tsx`、场景与资源 |
| 倪梓峻 | `src/features/project-files/`、`docs/project-files.md` |
| 袁逍 | `src/features/manual/`、`docs/manual.md` |
| 戴宇驰 | `src/features/playback/`、`docs/playback.md` |
| 鲁逸尘 | `src/features/analysis/`、`docs/analysis.md` |
| 陈宇昂 | `tests/`、`docs/quality.md` |

基础包可独立打开示例场景。方案文件交换需要导出和文档模块，播放方案需要动态可视化模块。分析模块单独加入时可查看各无人机的拍摄点数量。

各模块通过 `useEditor()` 读取场景和提交修改。坐标为米，Y 轴向上，拍摄点以无人机 ID 归属。公共数据结构、应用入口和新增依赖由基础框架负责人协调。测试模块加入后运行 `npm test`，完整回归使用全部模块。

成员包中的实现是各自任务的起点。对应文档列出可继续开发的事项和验收方法。
