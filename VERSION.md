# 版本 4：多机路径分析

基于 GitHub 公开仓库 [CSDECADE/UNNCGRP-17](https://github.com/CSDECADE/UNNCGRP-17/tree/f341d3a) 的 `f341d3a` 快照。本目录只启用「多机路径分析」模块，另外三项仍为公开基线状态。

打开内置示例 → 点击「多机路径分析」，查看路线统计和两机最近间距。详细说明见 [多机路径分析](docs/analysis.md)。

使用 Node.js 22.13 或更高版本，在当前目录执行：

```sh
npm ci
npm run dev:web -- --port 5174 --strictPort
```

浏览器打开 http://127.0.0.1:5174。使用独立端口可将各版本的浏览器草稿分开。要启动桌面版，安装依赖后运行 `npm run dev`；桌面版沿用基线的本地草稿目录。

实现参考：本地 SkyPath 提供航线指标参考；多机统计和同步间距按 Aero 的数据结构另行实现。 这是一份基于公开基线的独立整合，不是原成员提交或原开发历史的还原。
