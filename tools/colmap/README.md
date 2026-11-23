# CPU 稀疏重建

使用 Python 虚拟环境安装 `pycolmap==4.2.1`，从仓库根目录运行：

```sh
python tools/colmap/reconstruct-sparse.py /path/to/photos.zip /path/to/new-output
```

输入是 Aero 导出的单组 PINHOLE 相机照片包。脚本读取 JPEG、相机内参和
`capture.json` 的位置先验。先用照片估计相机位姿和三维点，再用位置先验将结果
对齐到场景坐标。`ground_truth/` 不参与计算。

在 Aero 的「采集 → 导入点云」选择输出目录的 `aero-sparse-cloud.json`。
点云用于当前应用会话预览。输出还包含 ENU 坐标下的 `sparse-enu.ply`、
COLMAP 原生模型 `sparse-enu/` 和原始稀疏模型 `sparse/`。

## CUDA 稠密重建与对比

从已对齐的 ENU 稀疏模型生成 COLMAP 工作区。在 Python 里用
`pycolmap.undistort_images(workspace, aligned_sparse, images)`，
其中 `aligned_sparse` 是上一步生成的 `sparse-enu/`。

在配有 NVIDIA GPU 和 CUDA 版 COLMAP CLI 的机器上运行：

```sh
sh tools/colmap/run-dense-cuda.sh /path/to/workspace
python tools/colmap/export-dense-preview.py /path/to/workspace/fused.ply /path/to/workspace /path/to/aero-dense-cloud.json
```

融合点云沿用工作区的米制 ENU 坐标。预览导出将坐标转换为 Aero 的 Y 轴朝上坐标，
默认最多抽样 150,000 个点。完整结果保存在 `fused.ply`。
在「采集 → 导入点云」分别载入稀疏和稠密 JSON，可保留当前镜头并切换查看。

## 在本地桌面版连着操作

运行桌面开发版前，给它设置以下绝对路径。照片包和计算中间文件可放在 NAS。

- `AERO_NUAV_EXE`：本机编译的 DronePathPlannerN。
- `AERO_COLMAP_PYTHON`：已安装 PyCOLMAP 的 Python。
- `AERO_CAPTURE_JOBS`：保存计算任务的目录。

执行 `npm run dev` 后，打开「采集」，加载同坐标的参考模型和白模 GLB。
配置单架无人机起点并计算路线，确认拍摄点后生成照片包，再点击「开始稀疏重建」。
桌面版把当前照片目录传给 COLMAP，完成后直接显示点云。参考建筑和点云可以用同一镜头对比。
