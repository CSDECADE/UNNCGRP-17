# 无界面生成照片包

在没有显示器的服务器上批量生成 aero-capture 照片包。脚本用无界面 Chrome 打开开发服务器上的应用，直接调用和界面上「生成照片包」**完全相同的** `exportCapture()`，结果以 zip 下载到 `out` 目录。

```bash
# 1. 把参考模型放到开发服务器能访问的位置（public/_local/ 已在 .gitignore 中）
mkdir -p public/_local && cp ../GRP-data/drone-building-scans/flat-roof/flat-roof.glb public/_local/
# 2. 启动开发服务器（另开一个终端）
npm run dev:web
# 3. 生成
node tools/capture-headless/capture.mjs tools/capture-headless/flat-roof.example.json
```

- 配置项见 `capture.mjs` 开头的注释。`flat-roof.example.json` 是演示建筑的默认配置：3 层环绕 + 屋顶环，共 96 张，2048×1536。
- `frame.offset` 和 `bounds` 的值和界面中「居中落地」的结果一致。
- 依赖：本机安装的 `google-chrome`（可用配置项 `chrome` 指定路径），Node ≥ 22（使用内置的 `WebSocket` 和 `fetch`）。不需要安装额外的 npm 包。

## 渲染速度（实测，本机）

| 模式 | 实际渲染器 | 速度 |
| --- | --- | --- |
| `gpu: false`（默认） | SwiftShader（CPU） | 1024×768 约 3.5 秒/张 |
| `gpu: true` | Mesa llvmpipe（仍然是 CPU，没有用上 V100） | 稍快一些 |

在本机无界面运行时，Chrome 没有用上 NVIDIA 显卡。要用 GPU，需要配置 NVIDIA 的 EGL/Vulkan（或者用 Xvfb 加 NVIDIA 驱动）。在有显示器的电脑上直接用软件界面生成，会使用真实的 GPU。
