# 无向 Branch-and-Cut：使用已保存的 two-step 解初始化

此实验版本直接读取已有 `two_step_<数据名>.json`，将其作为联合模型的完整 COPT MIP start。运行时不会重新求 two-step，也不会固定它选择的视点、方向或路径。最终仍由联合 Branch-and-Cut 优化全部决策。

模型、目标函数、能耗归一化、整数懒 SEC、分数解最小割及其默认频率保持原版不变。七个原有依赖文件逐字节保留，哈希记录在 `CORE_BASELINE_SHA256.json`。新增入口负责读取、验证初始解及计时。

## 1. 安装与目录

使用 Python 3.10 或更新版本，在原有 COPT 环境中运行：

```bash
python -m pip install -r requirements.txt
```

大实例需要能覆盖该规模的 COPT 许可证；本包不包含许可证或二进制运行环境。

```text
joint_copt_external_two_step_experiment/
  run_experiment.py                  批量入口，逐个数据启动独立子进程
  joint_copt_from_two_step.py         新的单实例入口
  joint_copt_undirected.py            原版联合求解核心，未改动
  undirected_routing.py              原版整数 SEC / 分数最小割，未改动
  joint_mip_start.py                 原版完整 MIP start 映射，未改动
  common.py                         原版预处理和参数，未改动
  two_step_copt.py                   原核心的导入依赖；新入口不调用其求解
  check_joint_results.py             原版独立结果检查器，未改动
  data/Multi_1.json                  本次提供的原始数据
  two_step_results/two_step_Multi_1.json  本次提供的初始解
  tests/                            可复现的小实例测试和大实例建模审计
  verification/                     本次检查记录
  RESULT_FORMAT.md                  原结果格式要求
```

数据和初始解的对应规则是严格的同名匹配：

```text
data/115.json       → two_step_results/two_step_115.json
data/Multi_1.json   → two_step_results/two_step_Multi_1.json
```

需使用完整的 two-step 结果 JSON，不能只提供 Excel 汇总或单独路径。初始解可以尚未达到 two-step 最优，但必须满足联合模型全部约束，并有准确的完整 two-step `runtime`。缺少对应文件或验证失败会报错，不会改为冷启动或重新生成初始解。若结果标注 `stage1_source="provided"`，其时间遗漏此前第一阶段求解，会被拒绝，以免低估总耗时。

## 2. 跑整个 data 目录

解压后进入本包目录。在 Linux / tmux 中直接运行：

```bash
python -u run_experiment.py \
  --data-dir data \
  --two-step-dir two_step_results \
  --out-dir result \
  --threads 8 \
  --mem-limit-gb 96 \
  --exact \
  --no-time-limit
```

这条命令一次跑一个数据，逐个运行目录下全部 `.json`，实时显示 COPT 输出并同步保存日志；不是同时启动多个求解器。也会递归读取子目录，数据文件名必须唯一。默认不覆盖已有结果；重复实验请用新输出目录，或明确加 `--overwrite`。

`--exact` 将 COPT 相对和绝对 gap 阈值都设为 0；`--no-time-limit` 将联合求解 TimeLimit 设为 COPT 的无限时间常量 `1e20`。内存限制、中断或其他求解状态仍可能提前终止，因此应同时查看 `status`、`mip_gap` 和 `obj_bound`。`--mem-limit-gb` 按 1024 MB 换算，限制 COPT 内存，进程总 RSS 还包含 Python 和原始数据。

为保留原版默认参数，不加 `--exact` 时相对 gap 仍是 **0.01%**；不加 `--no-time-limit` 时联合求解上限仍为 **3600 秒**。默认线程为 8、COPT 内存预算为 40 GiB。时间上限仅作用于本次联合 COPT，不扣除已发生的 two-step 历史耗时。分数割的默认设置仍为前 20 轮、之后每 20 轮、每轮最多 32 次流/16 条割/0.25 秒软预算；整数懒约束持续检查。

## 3. 只跑 Multi_1

```bash
python -u joint_copt_from_two_step.py data/Multi_1.json \
  --two-step-solution two_step_results/two_step_Multi_1.json \
  --output result/joint_Multi_1.json \
  --threads 8 --mem-limit-gb 96 --exact --no-time-limit
```

单实例入口实时显示求解日志；批量入口另外自动保存 `.log`。两种入口使用同一求解逻辑。请使用这两个新入口；直接执行原核心脚本会保留原核心的旧启动流程。

如仍要同时跑两个 tmux 进程，可分别给 `--data-dir data1` / `data2`，共同使用 `--two-step-dir two_step_results --out-dir result`，每进程 `--threads 8 --mem-limit-gb 40`。两个数据目录的文件名须互不重复；不需要 `nohup`。同名输出有排他锁保护。强制中断遗留的 `.lock` 只能在确认该任务已停止后手动移除。

## 4. 总时间的精确定义

本次按要求使用：

```text
runtime = 已保存 two-step JSON 的 runtime + 本次 COPT 联合模型 SolvingTime
```

对于随包提供的 `Multi_1`：

```text
runtime = 7.333372336113825 + joint_solver_runtime
```

采用 two-step 顶层 `runtime`，不是简单重加 `runtime_step1 + runtime_step2`，因为前者还包括原 two-step 流程记录的阶段间开销；两个阶段的时间不会重复计入。无法从已有文件追溯重新测量历史时间，故须确保原始记录真实、完整。

| 字段 | 本版本含义 |
|---|---|
| `runtime` | 上述总精确求解时间 |
| `runtime_two_step` | 初始解文件记录的 two-step `runtime` |
| `joint_solver_runtime` | 本次 COPT `SolvingTime`，秒 |
| `runtime_joint` | 本版本为 `joint_solver_runtime` 的别名，使总时间分项可相加 |
| `runtime_step1`, `runtime_step2` | 原文件有记录时原样保留，仅作明细，不再加一次 |
| `runtime_joint_phase_wall` | 原核心的联合阶段墙钟时间，包含建模、求解、结果整理和清理 |
| `runtime_joint_call_wall` | 新入口调用原核心的墙钟时间 |
| `runtime_joint_overhead` | 联合阶段墙钟时间减去 COPT 求解时间 |
| `runtime_current_process_wall` | 当前运行从读取输入至完成最终核验的墙钟时间，不含随后文件写入 |
| `runtime_wall_with_prior_two_step` | 历史 two-step 时间加当前进程上述墙钟时间 |
| `warm_start_source` | 固定为 `two_step_result_file` |
| `warm_start_status` | 成功输出时必须为 `submitted` |
| `warm_start_obj` | 独立复算的初始解联合目标值 |
| `two_step_solution_sha256`, `input_sha256` | 初始解和数据文件哈希，用于追溯配对 |

历史原核心日志中的 `Total runtime` 是当前联合阶段墙钟时间，其中内部 two-step 为 0。**最终 `[SAVED]` 输出和最终 JSON 的 `runtime` 才是本版本规定的总时间**。建模、读取和核验开销单独记录，没有混入 `SolvingTime`。

## 5. 输出和核验

每个实例输出：

```text
result/joint_Multi_1.json        完整联合模型结果，保留 RESULT_FORMAT.md 全部必需字段
result/joint_Multi_1.check.json  对原始数据独立复算的约束与指标检查
result/joint_Multi_1.log         批量入口自动保存的实时日志
```

提交前检查不同视点三重覆盖、拍照与访问一致、depot 闭合单回路、合法飞行边、方向和 ID 对应关系，并复算质量、能耗、原 NN 分母及目标值。求解结束后再独立检查最终结果；检查失败不写入新结果文件。输入在求解中变化也会拒绝输出。

需要再次检查时：

```bash
python check_joint_results.py \
  --data data/Multi_1.json --result result/joint_Multi_1.json \
  --report result/Multi_1_recheck.json
```

可行性检查器核对约束和证书字段一致性，不会重新求解来独立证明最优。

## 6. 是否保持最优结果

**完整可行域和目标函数保持不变，所以数学上的全局最优目标值保持不变。** MIP start 只是给 COPT 一个可行上界，不改变变量界，不固定视点或路径，也不添加强迫保留该初始解的约束。整数懒 SEC 和分数割调用的仍是原代码。

实际比较请在同一数据和归一化下，使用 `--exact --no-time-limit` 并确认最终最优状态和上下界。若只跑到时间/内存上限，或使用默认 0.01% gap，warm start 改变搜索顺序后，返回的近似可行解可能不同；不能承诺逐项相同。即使都达到全局最优，多个同值最优解也可能选用不同视点、方向或回路顺序。浮点求解仍受 COPT 数值容差影响。

本次已完成的验证见 `VERIFICATION.md`。本包附带的 `Multi_1` 初始解已完整通过约束、目标值和全模型映射检查；由于本机许可证规模限制，没有在本机声称已求出该大实例的联合最优解。

复现小实例测试及大实例建模审计：

```bash
python -m unittest discover -s tests -v
python tests/audit_saved_start.py --report verification/Multi_1_start_audit_recheck.json
```

审计脚本只构建模型并检查初始值，不执行优化，不能代替正式实验求解。
