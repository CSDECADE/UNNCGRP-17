# 交接文档：从照片包到三维重建（COLMAP / CUDA）

> 交出：基础框架　分支：`feat/reconstruction-capture`　日期：2026-11-21
> 接手：负责 COLMAP、CUDA 环境和重建结果的同学
> 先读：[`reconstruction-capture.md`](reconstruction-capture.md)（设计与照片包格式）

## 0. 一页总结

| 已完成（可以直接用） | 交给你们 |
| --- | --- |
| 演示建筑：高精度贴图参考模型 + 对齐的白模 | 搭建 COLMAP + CUDA 环境 |
| 软件中加载模型、生成临时环绕航线 | 用照片包跑通稀疏和稠密重建 |
| **模拟拍摄 → 照片包输出（正式接口）** | 重建结果对齐到软件坐标系，并在软件中显示 |
| 真值：精确位姿、COLMAP 文本模型、参考模型 | 用真值评估精度 |
| 无界面批量生成照片包的脚本 | 真机照片导入（EXIF → capture.json） |
| 23 张真实航拍照片样本 + 数据集地址 | 决定真实照片需要下载多少张 |

**接口约定只有一条：重建只读照片包里的 `images/` 和 `capture.json`，`ground_truth/` 只能用来评估。** 这样以后换成真机照片时，重建部分不需要修改。

---

## 1. 怎样拿到一个照片包

### 方式 A：在软件里生成（有显示器的电脑）

1. `npm run dev`（桌面版）或 `npm run dev:web`（浏览器版）。
2. 开始页 → 新建空白项目 → 左侧切到 **「采集」** 页。
3. 「参考模型」→ 加载 `flat-roof.glb`；「白模」→ 加载 `proxy.glb`。第一次加载时会自动判断朝上方向（Z）并「居中落地」。点「填入演示数据署名」。
4. 「临时航线 · 环绕」→ 生成环绕航线（默认 96 个拍摄点）。
5. 「模拟拍摄」→ 设置分辨率和 GPS 噪声 → **生成照片包**。
   - 桌面版：选择一个目录，会在里面新建 `<项目名>-capture-<时间>/` 文件夹，逐张写入，可以取消。
   - 浏览器版：在内存中打包成 zip 后下载。照片很多时注意内存占用。

参考模型、白模和设置都会保存在 `.aeproj` 和本机自动暂存中，重新打开项目不需要再加载一次。

### 方式 B：服务器上无界面批量生成

见 [`tools/capture-headless/README.md`](../tools/capture-headless/README.md)：

```bash
node tools/capture-headless/capture.mjs tools/capture-headless/flat-roof.example.json
```

### 本机现成的文件（`/mnt/hdd3/GRP-data/`，不在 git 中）

| 路径 | 内容 |
| --- | --- |
| `drone-building-scans/flat-roof/flat-roof.glb` | 参考模型（21.8 MB，SHA-256 `6c712d16…6bd73`） |
| `drone-building-scans/flat-roof/proxy/proxy.{glb,obj,json}` | 白模（3,282 个三角形），由 `tools/demo-building/make-proxy.mjs` 生成 |
| `drone-building-scans/flat-roof/images-sample/` | 23 张真实航拍照片（4096×3072，带 GPS EXIF） |
| `drone-building-scans/poses/flat-roof/colmap/` | 数据集作者提供的 COLMAP 位姿（真实照片，已对齐 476 张） |
| `drone-building-scans/sample-images.txt` | 抽样照片的文件名（共 24 张，其中 1 张下载失败） |

样例照片包的效果（1024×768，前 8 张为侧面环绕，后 8 张为屋顶环）：纹理真实，画面居中，没有编辑器的辅助线。

---

## 2. 照片包内容速查

```
<name>/
  capture.json                  ← 重建输入：相机、GPS/位置先验（带噪声）
  images/0001.jpg …             ← 重建输入
  ground_truth/                 ← 只用于评估
    poses.json                  精确位姿（ENU，COLMAP 约定）
    colmap/{cameras,images,points3D}.txt   真值 COLMAP 文本模型（points3D 为空）
    reference.glb               参考模型原文件
    reference_frame.json        参考模型坐标 → 软件坐标 → ENU 的换算
```

- **世界坐标是局部 ENU**（东、北、天，单位米），原点见 `capture.json.crs.origin`。软件坐标与 ENU 的关系：`E = x, N = −z, U = y`。
- **相机**：PINHOLE 模型，无畸变，`fx = fy = (H/2) / tan(fov/2)`，`cx = W/2`，`cy = H/2`。每种视场角对应一台相机，`frames[].camera` 引用相机 id。
- **位置先验**：`frames[].position` = 真实位置 + 高斯噪声（默认水平 σ = 1.5 m，垂直 σ = 3 m，随机种子固定）。`gps` 是同一位置换算出的经纬度。
- **模拟照片的 JPEG 里没有 EXIF GPS**，位置信息只在 `capture.json` 里（真机照片两处都有）。如果你们的流程依赖 EXIF，可以写一个小工具把 `gps` 写进 EXIF；更推荐直接读 `capture.json`。
- 真值的正确性有单元测试保证：`tests/capture.test.ts` 用 three.js 相机投影交叉验证了位姿和内参。

---

## 3. 建议的 COLMAP 流程

> 以下命令和参数是**建议**，请以本机安装版本的 `colmap <command> -h` 为准，不同版本的参数名可能有差异。

```bash
P=captures/flat-roof-capture-xxxx          # 照片包目录
W=work/flat-roof && mkdir -p $W/sparse $W/dense

# 1) 特征提取。相机参数从 capture.json 读取（cameras[0].params = fx,fy,cx,cy）
colmap feature_extractor --database_path $W/db.db --image_path $P/images \
  --ImageReader.camera_model PINHOLE --ImageReader.single_camera 1 \
  --ImageReader.camera_params "fx,fy,cx,cy"

# 2) 匹配。几百张以内用穷举匹配最稳；照片按航线顺序编号，也可以试顺序匹配
colmap exhaustive_matcher --database_path $W/db.db
#   colmap sequential_matcher --database_path $W/db.db --SequentialMatching.overlap 10

# 3) 稀疏重建
colmap mapper --database_path $W/db.db --image_path $P/images --output_path $W/sparse

# 4) 用位置先验对齐到 ENU（米制，和软件坐标系一致）
python3 - "$P" > $W/ref_positions.txt <<'EOF'
import json, sys
c = json.load(open(sys.argv[1] + "/capture.json"))
for f in c["frames"]:
    print(f["file"].split("/")[-1], *f["position"])
EOF
colmap model_aligner --input_path $W/sparse/0 --output_path $W/sparse_enu \
  --ref_images_path $W/ref_positions.txt --ref_is_gps 0 --alignment_max_error 3

# 5) 稠密重建（patch_match_stereo 需要 CUDA）
colmap image_undistorter --image_path $P/images --input_path $W/sparse_enu --output_path $W/dense
colmap patch_match_stereo --workspace_path $W/dense
colmap stereo_fusion --workspace_path $W/dense --output_path $W/dense/fused.ply
colmap poisson_mesher --input_path $W/dense/fused.ply --output_path $W/dense/meshed-poisson.ply
```

**用来定位问题的上限测试**：跳过 SfM，直接用真值位姿三角化（`colmap point_triangulator`，输入模型用 `ground_truth/colmap/`）。如果这一步效果也不好，问题在照片（纹理、重叠率）；如果这一步好而 SfM 差，问题在配准。

---

## 4. 评估建议

两个模型都在 ENU 中，可以直接比较。

- **位姿**：对齐后的相机中心和 `ground_truth/poses.json` 的 `center` 比较，计算 RMSE。只对齐了一部分照片时，记录配准率。
- **几何**：
  1. 参考模型 → 软件坐标：按 `reference_frame.json`，`upAxis = z` 时 `(x, y, z) → (x, z, −y)`，再加上 `offset`。
  2. 软件坐标 → ENU：`(x, y, z) → (x, −z, y)`。
  3. 在参考模型表面采样点云（例如用 trimesh），和 `fused.ply` 互相计算最近距离。
  4. 统计**精度**（重建点到参考模型的距离）和**完整度**（参考模型点到重建点的距离），在 2 cm / 5 cm / 10 cm 等阈值下给出百分比。
- **航线对比实验**（最能体现航线规划的价值）：分别用 1 层环绕和 3 层 + 屋顶环生成照片包，比较完整度。

---

## 5. 环境说明

- 本机：2 × Tesla V100 16 GB，**还没有安装 COLMAP**。可选的安装方式：
  - 发行版自带的 COLMAP 包通常**不带 CUDA**，没法做稠密重建；
  - 官方 Docker 镜像（`colmap/colmap`，需要 NVIDIA Container Toolkit）；
  - conda-forge 上的 CUDA 版本；
  - 从源码编译（`-DCMAKE_CUDA_ARCHITECTURES=70` 对应 V100）。
- 下载 GitHub 上的文件时，本机直连不稳定，可以加镜像前缀 `https://ghfast.top/` 或 `https://ghproxy.cn/`。Hugging Face 可以直连。
- macOS 没有 CUDA：只能做稀疏重建，稠密部分需要换用 OpenMVS 等工具，或者放到 Linux/NVIDIA 机器上跑。

---

## 6. 接入软件的建议（下一阶段）

- **调用方式**：桌面版主进程用 `child_process.spawn`，参数用数组传递，**不经过 shell**。COLMAP 的路径在设置中指定。逐行解析 stderr 显示进度，支持取消（kill）。参考已有 IPC 的写法：`desktop/main.cjs` 中的 `p15:capture-*` 使用 token 和路径白名单。
- **结果显示**：用 three.js 的 `PLYLoader` 读取 `fused.ply` 或网格。因为结果已经在 ENU 中，用 `enuToApp` 换算到软件坐标（`src/core/capture/format.ts`），就能和白模、参考模型叠在一起显示。
- **结果保存**：可以作为 `.aeproj` 的新资源（`reconstruction.json` 增加字段，文件放进 `assets/`）。注意包的大小上限是 256 MB（`MAX_PACKAGE_BYTES`）。
- **界面**：在「采集」页下面加一个「重建」区域：选择照片包 → 运行 → 显示结果和精度指标。

## 7. 真机照片接口（以后）

- 数据集：**Drone Building Scans** — Matthew Guertin, 2026, CC BY 4.0
  - GitHub：https://github.com/Matt1Up/drone-building-scans-dataset
  - Hugging Face：https://huggingface.co/datasets/Matt1up/drone-building-scans
  - `flat-roof` 共 951 张，每张约 12 MB，合计约 11.4 GB，每张都有 GPS EXIF；照片地址格式为 `https://huggingface.co/datasets/Matt1up/drone-building-scans/resolve/main/flat-roof/images/<文件名>`。
  - **需要下载多少张，请根据重建效果决定。** 可以先用本机的 23 张试，再按 `poses/flat-roof/colmap/images.txt` 中的相机位置逐步加密。
- 需要写一个导入器：读 EXIF（焦距、GPS）→ 生成 `capture.json`，其中 `source: "real"`，`cameras` 可以为空数组（让 COLMAP 自己标定），`groundTruth: null`。之后的重建流程和模拟照片完全相同。
- 数据集的 COLMAP 位姿看起来和参考模型在**同一坐标系**（相机高度和模型尺寸吻合），可以用来评估真实照片的重建，但正式使用前请核实。

## 8. 已知限制

- **桌面版的照片包写入（`p15:capture-begin/write/end`）没有在真实的 Electron 窗口里测过**，开发环境没有 Electron 程序。浏览器版和无界面版本已经实测。请第一个运行 `npm run dev` 的同学帮忙走一遍。
- 模拟照片偏理想：没有镜头畸变、运动模糊、曝光变化或噪点；光照是参考模型贴图里自带的（拍摄时是傍晚光）。结果会比真机略好。
- 参考模型边缘的地面是截断的，低角度照片的边缘会露出天空背景。
- 环绕航线只是临时方案：没有避障，也没有按地面分辨率（GSD）或重叠率优化。
- 白模目前是会话中的一个独立资源，不能编辑。`feature/obj-editor` 合并后，可以改为可编辑的 OBJ 模型（见设计文档 §8）。
- 浏览器版把照片包打包成 zip 时全部放在内存里，照片很多时可能占用几百 MB。
