# 演示建筑：参考模型与白模

离线工具，与主工程依赖分开（有自己的 `package.json`，不影响主工程的 `package-lock.json`）。

## 数据来源（必须署名）

> Drone Building Scans — Matthew Guertin, 2026. CC BY 4.0.
> https://github.com/Matt1Up/drone-building-scans-dataset
> https://huggingface.co/datasets/Matt1up/drone-building-scans

只使用 `flat-roof` 这栋建筑。模型和照片**不提交进 git**。

## 1. 获取参考模型

本机直接访问 Hugging Face 可以下载。GitHub 的 raw 地址不稳定时，加上 `https://ghfast.top/` 或 `https://ghproxy.cn/` 前缀。

```bash
mkdir -p ../GRP-data/drone-building-scans/flat-roof && cd ../GRP-data/drone-building-scans
curl -L -o flat-roof/flat-roof.glb https://huggingface.co/datasets/Matt1up/drone-building-scans/resolve/main/flat-roof/model/flat-roof.glb
sha256sum flat-roof/flat-roof.glb   # 6c712d16b9ede8f5083d7fc82787cf75b913865b157f48db08a61f2154c6bd73
```

模型参数：21.8 MB，约 550 万个三角形，Draco 压缩，一张 8 MB 的 JPEG 贴图；**Z 轴朝上**，单位米，包围盒约为 x ∈ [−15.6, 21.0]、y ∈ [−24.5, 27.3]、z ∈ [−2.3, 5.2]（包含建筑周围的地面）。

真实照片和位姿（以后验证真机照片接口时用）：

- COLMAP 位姿：`flat-roof/poses/colmap/{cameras,images}.txt`，可以从 Hugging Face 下载，与模型**同一坐标系**；其中已对齐 476 张，PINHOLE 4096×3072，fx ≈ 2760–2830。
- 照片：`flat-roof/images/<原始文件名>.JPG`，每张约 12 MB，共 951 张（11.4 GB），带 GPS EXIF。
- 本机目前在 `GRP-data/drone-building-scans/flat-roof/images-sample/` 放了 23 张：按相机位置均匀抽取 24 张，有 1 张下载失败，文件名列表见 `sample-images.txt`。**需要多少张才能完整重建，由负责重建的同学决定。**

## 2. 生成白模

```bash
cd tools/demo-building
npm install
node make-proxy.mjs ../../../GRP-data/drone-building-scans/flat-roof/flat-roof.glb ../../../GRP-data/drone-building-scans/flat-roof/proxy
```

输出 `proxy.glb`、`proxy.obj` 和 `proxy.json`（统计信息和包围盒）。处理流程：去掉法线、UV 和贴图 → 焊接顶点 → meshoptimizer 减面（默认 `--ratio 0.0006 --error 0.02`）→ 不压缩输出。默认参数下从 5,500,320 个三角形减到约 3,300 个，用时约 20 秒。

白模**不做任何平移、旋转或缩放**，和参考模型保持同一坐标系，所以软件里两者共用一个放置参数（`upAxis: "z"` + `offset`），天然对齐。
