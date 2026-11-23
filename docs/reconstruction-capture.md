# 三维重建：模拟拍摄与照片包接口（设计）

> 维护：基础框架　分支：`feat/reconstruction-capture`　状态：第一阶段已实现（到照片包输出为止）
> 本阶段只做到**输出照片包**。COLMAP 调用、CUDA 环境和重建结果显示由后续同学负责，见 [`reconstruction-handover.md`](reconstruction-handover.md)。

## 1. 目标

产品流程：导入**低精度白模** → 生成航线 → 无人机按航线拍摄**真实建筑** → 用照片**重建高精度模型**。

在没有真机飞行时，用 demo 代替「拍摄真实建筑」这一步：软件按航线从一个**高精度贴图模型**（代表真实建筑）渲染照片，输出和真机**格式完全相同**的照片包。重建模块只读照片包，不关心照片的来源。

```
白模（可见） ──► 航线 ──► 照片来源 ──► 照片包 ──► 重建（后续同学）
                            ├─ 模拟：渲染高精度参考模型（本阶段）
                            └─ 真机：导入航拍照片文件夹（以后）
```

**本阶段范围**：单栋建筑；参考模型和白模的加载与保存；临时的环绕航线；模拟拍摄；照片包导出；真值导出（用于评估）。
**不在范围内**：正式航线算法、真机照片导入、COLMAP、重建结果显示。

## 2. 演示数据

| 项 | 内容 |
| --- | --- |
| 数据集 | **Drone Building Scans** — Matthew Guertin, 2026, **CC BY 4.0**<br>GitHub：https://github.com/Matt1Up/drone-building-scans-dataset<br>Hugging Face：https://huggingface.co/datasets/Matt1up/drone-building-scans |
| 选用建筑 | `flat-roof`（单层商业建筑），用 951 张 DJI Mini 5 Pro 照片（4096×3072，带 GPS EXIF）在 RealityScan 中重建，按 AprilTag 标定为**米制** |
| 参考模型（真实建筑） | `flat-roof/model/flat-roof.glb`：21.8 MB，约 550 万个三角形，Draco 压缩，一张 8 MB 的 JPEG 贴图；**Z 轴朝上**，单位米；占地约 37 × 52 m，高约 7.5 m |
| 白模 | 由参考模型离线减面得到（`tools/demo-building/`），去掉贴图，与参考模型**同一坐标系** |
| 真实照片样本 | 目前只下载了 24 张（按相机位置均匀抽取），用来以后验证真机照片接口。**需要多少张才能完整重建，由后续同学决定**。全部 951 张约 11.4 GB，COLMAP 位姿见 `flat-roof/poses/colmap/` |

模型和照片**都不提交进 git**，本机放在 `/mnt/hdd3/GRP-data/drone-building-scans/`，获取方法见 `tools/demo-building/README.md`。报告和软件中使用时必须注明署名。

## 3. 数据模型

### 3.1 会话中的重建设置（不进入撤销历史）

重建设置挂在会话上（和检查点同级），**不放进 `Project`**，原因有三：

- 参考模型几十 MB，不应该进入每一步撤销快照；
- 远端的 `feature/obj-editor` 分支正在修改 `Project` 结构（v2 + `objResources`），放在会话层可以避免冲突；
- 白模以后可以转为 obj-editor 的可编辑 OBJ 模型（见 §8）。

```ts
type MeshAsset = { name: string; sha256: string; bytes: Uint8Array };   // 目前只支持 glb
type BuildingFrame = {
  upAxis: "y" | "z";       // 模型文件的「上」方向；flat-roof 为 "z"
  offset: Vec3;            // 轴向转换后的平移（米），让建筑落在原点、地面 y = 0
};
type ReconstructionSetup = {
  reference?: MeshAsset;   // 高精度贴图模型，只用于模拟拍摄和评估；默认在场景中隐藏
  proxy?: MeshAsset;       // 白模，在场景中显示，用于规划航线
  frame: BuildingFrame;    // 参考模型和白模共用（两者同源）
  attribution: string;     // 数据来源署名
  capture: CaptureSettings;
};
type CaptureSettings = {
  width: number; height: number;        // 默认 2048 × 1536（数据集相机的一半）
  jpegQuality: number;                  // 默认 0.92
  origin: { lat: number; lon: number; alt: number };  // 局部坐标原点的经纬度
  gpsNoise: { horizontal: number; vertical: number; seed: number };  // 米，默认 1.5 / 3
};
type Session = { history; checkpoints; reconstruction?: ReconstructionSetup };
```

- **`.aeproj`**：新增 `reconstruction.json`，模型文件写入 `assets/<sha256>.glb`，并登记在清单中。不认识这个文件的旧版本会忽略它（清单校验只检查已登记的文件是否一致），因此 `formatVersion` 保持为 1。
- **自动暂存**：模型字节按 sha256 单独存进 IndexedDB 的 `assets` 表，只写一次。会话记录中只保存 sha256，避免每次编辑都重写几十 MB。

### 3.2 渲染

- 加载 Draco 时使用**随应用打包的解码器**（`public/draco/`，来自 three.js），不依赖网络。桌面版的 CSP 需要允许 `'wasm-unsafe-eval'`。
- 参考模型的贴图来自照片，已经包含光照，所以渲染时改用**不受光照影响的材质**（`MeshBasicMaterial`），避免重复打光。
- 白模用浅灰色的标准材质，显示在编辑场景中，不参与模拟拍摄。

## 4. 坐标约定

| 坐标系 | 轴向 | 用途 |
| --- | --- | --- |
| 软件坐标（app） | X 右，**Y 上**，Z 朝向观察者；单位米 | 场景、拍摄点 |
| **ENU（照片包世界坐标）** | **E = x，N = −z，U = y**；单位米，原点为软件原点 | `capture.json`、真值、COLMAP |
| WGS84 | 纬度、经度、海拔 | GPS，由 ENU 和 `origin` 在局部切平面上近似换算 |
| 相机（COLMAP） | x 右，y 下，z 朝前 | `images.txt` |

模型文件到软件坐标的换算：先做轴向转换（`upAxis = "z"` 时 `(x, y, z) → (x, z, −y)`），再加上 `offset`。

## 5. 模拟拍摄

1. 按拍摄点顺序（按无人机分组，与航线顺序一致）逐张渲染。
2. 使用**独立的离屏 WebGL 渲染器**和独立场景，场景里只有参考模型和天空背景，不受编辑器的辅助线、标签、白模影响。
3. 相机：位置和朝向取拍摄点的 `position → target`；`up` 方向沿用编辑器的 `cameraUp` 规则（视线接近竖直时改用 +Z 作为参考上方向）；垂直视场角取该无人机的 `fov`；宽高比 = `width / height`。真值位姿与 three.js 相机的投影结果一致，有单元测试保证（`tests/capture.test.ts`）。
4. 内参：`fy = (H/2) / tan(fov/2)`，`fx = fy`，`cx = W/2`，`cy = H/2`（PINHOLE 模型，无畸变）。
5. 输出 JPEG。逐张写盘，可以随时取消，进度显示在面板上。

## 6. 照片包格式（接口，真机和模拟共用）

```
<capture-name>/
  capture.json
  images/0001.jpg …
  ground_truth/              ← 仅模拟时有，重建时不能作为输入
    poses.json               精确的内参和外参（ENU）
    colmap/cameras.txt       COLMAP 文本模型（真值位姿），points3D.txt 为空
    colmap/images.txt
    colmap/points3D.txt
    reference.glb            参考模型原文件
    reference_frame.json     参考模型坐标 → ENU 的换算
```

桌面版写入用户选择的空文件夹；浏览器版打包成 zip 下载，内部结构相同。

`capture.json`（`format: "aero-capture"`, `version: 1`）：

```jsonc
{
  "format": "aero-capture",
  "version": 1,
  "source": "simulated",                      // "simulated" | "real"
  "createdAt": "2026-11-21T08:00:00.000Z",
  "generator": { "name": "Aero", "version": "0.4.0" },
  "project": "校园航拍 · 方案 01",
  "crs": { "type": "local-enu", "units": "m", "origin": { "lat": 29.8, "lon": 121.56, "alt": 0 } },
  "cameras": [                                // 每种视场角一台相机；真机可以为空数组，由 COLMAP 自行标定
    { "id": 1, "model": "PINHOLE", "width": 2048, "height": 1536, "params": [fx, fy, cx, cy] }
  ],
  "frames": [
    {
      "file": "images/0001.jpg",
      "camera": 1,
      "droneId": "…", "viewpointId": "…", "index": 0,
      "position": [e, n, u],                   // 带噪声的位置先验，对应真机的 GPS 记录
      "gps": { "lat": …, "lon": …, "alt": … }, // 和 position 一致（含噪声）
      "positionSigma": [1.5, 1.5, 3]
    }
  ],
  "groundTruth": "ground_truth/poses.json",   // 真机为 null
  "attribution": "Drone Building Scans — Matthew Guertin, 2026. CC BY 4.0."
}
```

**规则：重建流程只能使用真机也能拿到的信息**，即 `images/`、`frames[].position/gps/positionSigma` 和可选的 `cameras`。`ground_truth/` 只用于评估精度，否则 demo 的结果会好得不真实。

## 7. 临时航线（环绕）

正式航线算法完成之前，用环绕航线代替：以白模的包围盒为基准，生成若干层圆环，每层均匀分布若干拍摄点，镜头对准建筑中心，再加一层俯视环。参数包括层数、每层点数、离墙距离、最低高度。生成的航线替换第一架无人机的航线（没有无人机时新建一架），作为**一步可撤销的操作**。正式算法完成后可以直接通过已有的「路径导入」接入。

## 8. 与其他模块的关系

- **obj-editor**（`feature/obj-editor`，未合并）：负责 OBJ 的导入和编辑。白模以后可以改为 obj-editor 的 `ObjModel` 显示和编辑，届时 `ReconstructionSetup.proxy` 改为引用这个模型的 id。本阶段不依赖它。
- **路径导入 / 多机路径分析**：生成的拍摄点就是普通的 `Viewpoint`，这两个模块照常可用。
- **项目包**：见 §3.1。

## 9. 实现分步（小步提交）

1. 设计文档（本文）
2. `tools/demo-building/`：由参考模型生成对齐的白模（独立的 package.json，不影响主工程依赖）
3. 会话中的重建设置、`.aeproj` 和自动暂存支持模型资源
4. Draco 解码器打包，场景中显示白模和参考模型
5. 环绕航线生成器
6. 纯函数：内参、位姿换算、ENU ↔ GPS、`capture.json` 生成、COLMAP 文本输出（附单元测试）
7. 离屏渲染和照片包导出（桌面版写文件夹 / 浏览器版下载 zip）
8. 「重建采集」面板
9. 交接文档
