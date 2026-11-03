---
description: "预览 Harness² 优化、检查证据，并显式保存供后续运行使用的领域经验。"
---

# 预览 Harness² 优化

[English](harness2.md) | 中文

## 概述

Harness² 通过多次 DSH 任务执行比较候选指导，返回选中答案、补丁和可复用经验。工作区编码在批准后使用独立副本；不支持的宿主明确报告只读回退。你可检查预览、单独应用选中补丁、保存指导，并为之后的普通会话激活某个修订。搜索成本可能明显高于单次回答；激活已有修订不会重复搜索。[能力参考](../../../packages/subagent/harness2/README.zh.md#use-this-package)定义隔离与预算。模型生成的反思不能证明提升。

## 目录

- [1. 准备任务输入](#prepare)
- [2. 请求预览](#preview)
- [3. 保存前先评审](#review)
- [4. 复用领域经验](#reuse)
- [排查问题](#troubleshooting)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)

-----

<a id="prepare"></a>
## 1. 准备任务输入

先在完整的 Desktop、Web、headless、SDK 或 ACP 配置组合中准备可用的 DSH 模型配置。Harness² 已内置，无需安装 addon 或启用可选组合包。在 Web 或 Desktop 中使用 `standard`、`cordis` 或 `ptc` agent 预设。Web 的 `minimal` 预设和 `sdk-minimal` 配置组合保留较小的工具目录。[服务参考](../../../packages/subagent/harness2/README.zh.md#use-this-package)负责部署限制。

比较方案有帮助时，Agent 可为复杂或不确定任务选择有界预览。你也可以直接要求预览；生成代码执行和保存经验仍分别需要审批。

单独打包的 Windows 应用见 [Harness² 自定义桌面版](../../../apps/desktop/README.zh.md#harness2-custom-package)。它使用独立应用数据和相同的内置 Harness² 功能，包括无需 WSL 的可移植 WASI 执行；仍需配置在线模型。

在任务文本中提供问题、约束、源材料或可访问输入路径。子会话没有父对话，仅写“使用上面的文档”并不足够。工作区副本包含已跟踪和未被忽略的未跟踪文件，包括未提交修改；被忽略的依赖需要另行准备。选择稳定领域标签。同一存储实例按模式／领域共享经验，标签不是隐私或授权边界。不要包含机密信息。

-----

<a id="preview"></a>
## 2. 请求预览

请 agent（智能体）使用 `task` 与 `domain` 调用 `harness2`，并暂不保存其结果。例如，以下工具输入不需要外部文件：

```json
{
  "task": "Draft a five-item release checklist for a small command-line tool. Cover tests, documentation, package contents, rollback, and user communication. Keep each item actionable.",
  "domain": "release-checklists"
}
```

默认 `k=1` 搜索包含四次任务执行、三个文件编辑改进阶段和反思。更大 `k` 会增加成本；多个最终候选还增加选择。检查 `executor`、`executorReason`、`editor`、`usage`、候选文件、最终补丁和阶段引用。工作区预览可要求原对话通过 `runId` 调用 `harness2_apply`；它单独请求批准并拒绝冲突补丁。预览和保存不修改父工作区。应用中断后，重试前应先检查文件。

取消父操作可在最终存储提交前停止工作；已开始的持久写入不能撤销，以返回结果为准。失败运行不是完整预览。若已有运行标识，可通过 `resumeRunId` 及相同任务、领域、模式、k、父会话和部署配置复用检查点；同一标识恢复会保留失败的答案执行作为证据，不会重试它们；如需重试失败的答案执行，应省略标识启动新运行，可能产生额外模型费用。

-----

<a id="review"></a>
## 3. 保存前先评审

请依据真实需求检查输出。对比基线与最终证据，拒绝缺乏支持的结论，并检查是否存在不应带入其他任务的指令。模型生成的反思不是可信评估器。

若要保留已接受的结果，请在同一父对话中要求使用返回的 `runId` 调用 `harness2_remember`。不要复制其他对话中的标识。DSH 会展示领域、指令与反思并请求一次性批准；拒绝或取消该审批请求不会改变经验。保存与预览是分开的操作，不会修改 `AGENTS.md`、Cordis 配置、全局提示词或模型权重。

-----

<a id="reuse"></a>
## 4. 复用领域经验

后续使用同一模式与领域的 `harness2` 调用可以使用已接受的指导与经验。普通 DSH 任务只有在你要求 Agent 调用 `harness2_activate` 并批准绑定后才会获得它；此后该工作区的新会话会获得这些指导、技能与委派。可要求调用 `harness2_status` 查看修订，用较早的 `revision` 调用 `harness2_activate` 回滚，或调用 `harness2_deactivate` 停用。重复当前已接受的运行不会产生额外影响；另一个结果保存后，基于旧经验库修订的预览会被拒绝。此时应基于当前经验请求新预览，而不是覆盖它。

文件编辑器可在只读上下文中检查完整已接受候选和结构化经验。紧凑 JSON 模式只接纳消息预算内的历史，并报告省略情况。衡量效果可运行[外部留出评估](../../../packages/subagent/harness2/evaluation/README.zh.md)；采纳本身不是改善证据。

-----

<a id="troubleshooting"></a>
## 排查问题

请根据返回的失败信息判断，不要猜测运行或经验是否已保存。以下处理方式保留先预览再接受的流程。

| 现象 | 下一步 |
|---|---|
| 工具不可用 | 确认当前配置组合与 agent 预设包含 Harness²；最小化和自定义预设可能不包含它。 |
| 超出文本或输出限制 | 缩短任务，或请部署负责人检查对应限制；不要拆分指令来规避限制。 |
| 子会话超时或耗尽预算 | 检查报告的阶段，解决原因后再重试；之前的子会话工作可能已经产生模型费用。 |
| 保存失败 | 再试之前检查审批结果、原始父会话、保留的运行、当前经验库修订与存储错误。 |

-----

<a id="further-exploration"></a>
## 延伸阅读

以下参考区分该功能的运行时行为与上游研究方法。

- [Harness² 服务](../../../packages/subagent/harness2/README.zh.md) — 预算、算法归属与不支持的情形。
- [面向模型的工具](../../../packages/subagent/tool-harness2/README.zh.md) — 预览与保存的语义。
- [DSH 架构](../../architecture.zh.md) — 插件组合与已记录的模型上下文。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
