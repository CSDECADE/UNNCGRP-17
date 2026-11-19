# Joint Solver Result Format (Standard)

请之后所有 joint 求解结果都按本文件描述的 JSON 格式保存。  
参考样例：`joint_181.json`。

## 文件命名

```
joint_<instance_stem>.json
```

示例：
- `data/181.json` → `results/joint_181.json`
- 若同一实例同时跑方案 A 和 B，方案 B 可用 `joint_<stem>_B.json` 区分。

## 顶层字段（必须全部包含）

| 字段 | 类型 | 说明 |
|------|------|------|
| `method` | string | 固定为 `"joint"` |
| `selected_vps` | int[] | 被选中的视点**索引**列表 |
| `selected_vp_ids` | string[] | 被选中的视点 **ID** 列表（与 selected_vps 一一对应） |
| `selected_pairs` | [int, string][] | 选中的 (视点索引, 方向) 对，例如 `[3, "a11"]` |
| `selected_photos_readable` | [string, string][] | 可读形式 (视点ID, 方向)，例如 `["v4", "a11"]` |
| `photos_by_viewpoint` | object | 键为视点ID，值为该点拍摄的方向字符串数组 |
| `tour` | int[] | 回路的视点索引序列（含起点，闭合回到起点） |
| `tour_ids` | string[] | 回路的视点 ID 序列 |
| `energy` | float | 总飞行能耗（未归一化） |
| `weighted_quality` | float | 覆盖质量（半球权重之和，未归一化） |
| `photos` | int | 拍照总数 |
| `n_viewpoints` | int | 访问的视点数量 |
| `energy_norm` | float | 归一化能耗 `energy / energy_norm_denom` |
| `quality_norm` | float | 归一化覆盖质量 `weighted_quality / total_omega` |
| `photo_norm` | float | 归一化拍照数 `photos / n_pairs` |
| `energy_norm_denom` | float | 能耗归一化分母 |
| `runtime` | float | 联合模型求解时间（秒，不含分母计算） |
| `atsp_runtime` | float | 若用 ATSP 算分母则为其时间，否则可为 0 |
| `obj` | float | 目标函数值（越小越好） |
| `mip_gap` | float \| null | MIP 相对 gap |
| `status` | int \| string | 优先存 CPLEX 数值状态码（如 9 = time limit） |
| `obj_bound` | float \| null | 对偶界（best bound） |

## 示例结构（精简）

```json
{
  "method": "joint",
  "selected_vps": [3, 5, 9, ...],
  "selected_vp_ids": ["v4", "v6", "v10", ...],
  "selected_pairs": [[3, "a11"], [3, "a5"], ...],
  "selected_photos_readable": [["v4", "a11"], ["v4", "a5"], ...],
  "photos_by_viewpoint": {
    "v4": ["a11", "a5"],
    "v6": ["a8"]
  },
  "tour": [73, 28, 3, ..., 73],
  "tour_ids": ["v74", "v29", "v4", ..., "v74"],
  "energy": 80.39786379056703,
  "weighted_quality": 1893.0625,
  "photos": 55,
  "n_viewpoints": 31,
  "energy_norm": 0.5485270983381151,
  "quality_norm": 0.9942555147058824,
  "photo_norm": 0.2644230769230769,
  "energy_norm_denom": 146.57045027337801,
  "runtime": 36000.28999996185,
  "atsp_runtime": 70.83000016212463,
  "obj": -0.18130533944469185,
  "mip_gap": 0.1375808529503071,
  "status": 9,
  "obj_bound": -0.2062494826899375
}
```

## 给 AI 的简短指令（可直接复制）

```
请按 RESULT_FORMAT.md / joint_181.json 的标准格式保存 joint 求解结果：
- 文件名 joint_<stem>.json
- method 固定为 "joint"
- 必须包含 selected_vps, selected_vp_ids, selected_pairs, selected_photos_readable,
  photos_by_viewpoint, tour, tour_ids, energy, weighted_quality, photos,
  n_viewpoints, energy_norm, quality_norm, photo_norm, energy_norm_denom,
  runtime, atsp_runtime, obj, mip_gap, status, obj_bound
- selected_pairs / selected_photos_readable 用 list 而不是 tuple
- status 优先存数值状态码
```

## 代码约定

- `cplex_with_u.py` / `cplex_pair_exclusion.py` 的 `solve_joint()` 返回值必须符合本 schema。
- `run_batch_experiment.py` 在跑每个实例时会额外写出对应的 `joint_*.json`。
- 不要在标准结果里塞方案特有的临时字段（如 `n_pair_constraints`、`energy_norm_mode`）；需要的话放在 batch summary 里。
