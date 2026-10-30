---
description: "预览 Harness² 优化、检查证据，并显式保存供后续运行使用的领域经验。"
---

# 预览 Harness² 优化

[English](harness2.md) | 中文

## 概述

Harness² 先针对任务比较不同的候选指导，再提供组合答案与可复用经验。你可以先检查预览而不改变后续运行，再显式为同一领域保存结果。这项内置功能使用多个由模型驱动的子会话，成本可能明显高于普通回答。答案 rollout 可通过当前父任务允许的只读工具查看输入；推测阶段不能使用父 Agent 的 shell、写入、编辑或应用修改工具。生成的 Python 辅助程序和中间件使用内置可移植运行时，每次执行均需审批，见[能力参考](../../../packages/subagent/harness2/README.zh.md#use-this-package)。它不能独立证明答案更好。

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

在任务文本中提供问题、约束，以及源材料或可访问的输入路径。子会话没有父对话，因此仅写“使用上面的文档”并不足够。答案 rollout 只能使用配置中允许、且位于发起父 Agent 任务范围内的只读工具；如果所需工具或输入不可用，请直接提供材料。默认允许 `read`、`read_image`、`glob`、`grep`、`web_search` 和 `web_fetch`；部署配置可缩小范围，或通过 `readTools: []` 禁用。为可复用的任务类别选择领域标签。使用同一存储实例的对话会按相同模式与领域标签共享经验；标签不是隐私或授权边界。不要在任务文本中包含机密信息。

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

默认 `k=1` 运行包含四次答案执行、三个改进阶段和反思。可用 `mode: "parallel"` 或 `"sequential"` 及部署允许的 `k` 请求更宽或更深的比较；多个最终候选增加选择步骤。请检查运行标识、选中答案、候选树及经验。预览不授权修改父工作区或配置。审阅选中答案后，可要求父 Agent 通过普通工具和权限流程应用所需修改；保存经验是另一个操作。

取消父操作可在最终存储提交前停止工作；已开始的持久写入不能撤销，以返回结果为准。失败运行不是完整预览。若已有运行标识，可通过 `resumeRunId` 及相同任务、领域、模式、k、父会话和部署配置复用检查点；同一标识恢复会保留失败的答案执行作为证据，不会重试它们；如需重试失败的答案执行，应省略标识启动新运行，可能产生额外模型费用。

-----

<a id="review"></a>
## 3. 保存前先评审

请依据真实需求检查输出。对比基线与最终证据，拒绝缺乏支持的结论，并检查是否存在不应带入其他任务的指令。模型生成的反思不是可信评估器。

若要保留已接受的结果，请在同一父对话中要求使用返回的 `runId` 调用 `harness2_remember`。不要复制其他对话中的标识。DSH 会展示领域、指令与反思并请求一次性批准；拒绝或取消该审批请求不会改变经验。保存与预览是分开的操作，不会修改 `AGENTS.md`、Cordis 配置、全局提示词或模型权重。

-----

<a id="reuse"></a>
## 4. 复用领域经验

后续使用同一模式与领域的 `harness2` 调用可以使用已接受的指导与经验。普通 DSH 任务不会自动获得这些上下文。重复当前已接受的运行不会产生额外影响；另一个结果保存后，基于旧经验库修订的预览会被拒绝。此时应基于当前经验请求新预览，而不是覆盖它。

每个子会话只接收能够放入消息预算的完整已存经验与反思。其证据报告省略的历史内容；已存经验库保持完整。因此，经验库增长后，无需删除已接受经验来启动较小的新任务。

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
