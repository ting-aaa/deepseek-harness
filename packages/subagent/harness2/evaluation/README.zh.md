---
description: "在外部评分的留出任务上比较普通 DSH 与已采纳指导。"
kind: "package-reference"
---

# Harness² 评估

[English](README.md) | 中文

此运行器通过内置的 `dsh --profile sdk` 应用验证搜索、保存、应用、激活和普通任务的完整路径。两个固定账目任务建立一个领域经验库；在四个独立留出样本上比较启用与未启用叠加指导之前，固定最终修订。两组使用独立 Git 工作区以及相同的输入、提供方、模型与请求上限。评估器在采纳后检查精确输出 JSON 和输入未被修改；不向 Agent 提供标准答案或评分，也不执行生成代码。

先构建仓库，再从根目录执行：

```sh
pnpm exec tsx packages/subagent/harness2/evaluation/run.ts --dry-run
pnpm exec tsx packages/subagent/harness2/evaluation/run.ts --scripted-smoke
```

脚本冒烟使用真实工具、独立副本、SQLite 持久化、审批、SDK 进程和工作区绑定；只有模型响应与 token 报告是合成的。`qualityMeasured: false` 表示通过结果不能解释为模型能力提升。真实提供方运行需要 `DEEPSEEK_API_KEY`，并省略 `--scripted-smoke`；`HARNESS2_EVAL_PROVIDER` 和 `HARNESS2_EVAL_MODEL` 可选择已配置路由。运行器使用独立 DSH 主目录，只批准工作区回放、保存、应用和激活操作，拒绝通用权限提升。

每次运行在 `~/.dsh/harness2-evaluations/run-*` 下保留样本、Session 日志、经验库及 `report.json`；失败时保留 `failure.json`。报告分开统计搜索与留出任务成本，包含报告的输入／输出 token 和耗时，并通过已记录 Session 事件验证固定叠加指导。缺少用量报告表示成本未报告，不是实际成本为零。搜索 token 上限在响应后检查，不是金额上限。六个任务用于验证交付物处理和传输，不代表广泛编码质量或统计显著性。接受质量或成本结论之前，应使用代表性领域样本多次进行真实运行。
