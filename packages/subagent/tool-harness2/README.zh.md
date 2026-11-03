---
description: "使用 Harness² 预览与保存工具，采用有界子会话执行、经评审的父 Agent 应用流程及需批准的同父会话经验采纳。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-harness2

[English](README.md) | 中文

## 概述

通过有界 Harness² 预览比较方案、检查结果，并单独保存用户批准的经验。当额外探索有帮助时，父 Agent 可针对复杂或不确定任务选择这种比较；用户也可直接要求使用。预览不接受候选；保存只影响后续同领域 Harness² 运行。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

基于 base 的完整 DSH 配置组合内置这些工具及其[引擎](../harness2/README.zh.md)；[组合参考](../../../docs/subsystems/harness2.zh.md#composition)定义配置组合与预设中的可用性。自定义配置组合可以在 `tools` 与 `harness2` 可用处挂载以下配置项；消费方没有配置字段或预算覆盖项。

```yaml
- id: optional-tool-harness2
  name: '@deepseek-ai/dsh-tool-harness2'
```

### 先预览，再保存

`harness2` 接受完整 `task`、稳定 `domain`，以及可选的 `mode`、`k`、`resumeRunId`。`k` 不得超过部署上限；恢复要求相同父会话和运行指纹。结果包含选中答案、候选树、全部最终候选、反思及阶段引用；不能通过工具提高预算或授权代码执行。先展示预览，再询问是否保留。

实施限制的提供方可用时，答案 rollout 经批准后在独立工作区副本中使用编码工具，否则结果明确报告只读回退。文件编辑器只能修改候选 harness，评审器可读取阶段证据。`harness2_apply` 接受原始 `runId`，单独请求批准，检查选中补丁与当前原工作区是否匹配，并返回 `{applied}`。预览与保存不会应用修改；隔离与中断限制见[引擎参考](../harness2/README.zh.md)。

`harness2_remember` 接受已批准的 `runId`，返回已提交的经验库 `revision`。预览必须仍被保留，并归属于当前父 Session；其间若领域已更新，则需要新预览。[服务参考](../harness2/README.zh.md)负责预算、取消、保留与存储语义。

预览不要求用户点名 Harness²。生成代码执行仍需逐次审批。采纳新预览前，服务通过 DSH 用户审批服务请求一次性批准，展示领域、指令与反思。缺少审批处理、拒绝、取消或策略禁止询问时，都默认拒绝且不接受经验。

### 应用到工作区

`harness2_activate` 经一次性批准后，将某个 `domain` 与 `mode` 已保存的修订（默认最新）绑定到调用方所在工作区。该工作区中新建的顶层会话会获得其指令（作为低信任指导）、经普通技能工具提供的技能，以及其委派和隔离辅助脚本；当前对话不变。传入较早的 `revision` 即可回滚。`harness2_status` 列出绑定与已保存修订；`harness2_deactivate` 解除绑定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部原理 — 点击展开</summary>

消费方把调用 Agent 和取消信号传给 `ctx.harness2`，委派执行、补丁应用、采纳与绑定。服务负责工具准入、实时守卫、隔离、审批和持久化；失败行为见引擎参考。

所有工具都使用普通日志调用与结果。纯展示器使用通用卡片。[`src/index.ts`](src/index.ts)负责注册、schema、委派和展示。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

以下页面说明任务准备与引擎级保证。

- [用户指南](../../../docs/user/guide/harness2.zh.md) — 接受经验前评审结果。
- [原生引擎](../harness2/README.zh.md) — 算法、部署限制与上游归属。
- [子系统参考](../../../docs/subsystems/harness2.zh.md) — 父会话归属与持久状态。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到的内容

生成的 [Harness² 工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-harness2)定义 `harness2`、`harness2_remember`、`harness2_activate`、`harness2_deactivate` 与 `harness2_status`，包括有界探索与批准要求。此包不添加系统提示词片段；工作区叠加层由[引擎](../harness2/README.zh.md#apply-adopted-guidance)添加。

#### Token 影响

可见的预览、应用、保存、激活、状态和停用 schema 增加固定请求上下文。任务、领域和运行标识保留在工具调用日志中。

#### KV Cache 影响

工具内容与可见性不变时，定义的前缀保持稳定。启用或禁用插件会改变可见工具列表，并可能从该位置开始使缓存复用失效。

### 父会话结果

#### 模型看到的内容

成功预览追加 JSON，包含选中答案、候选文件树、全部最终答案、指令、反思、运行与领域标识及阶段／会话引用。最终候选还包含可用的执行轨迹或失败信息；探测证据保留于子会话日志。保存返回修订号；失败采用普通工具错误处理。

#### Token 影响

预览结果保留受引擎限制的文本字段，以及 JSON 与引用元数据。`maxOutputChars` 仅限制答案，不限制完整父会话 JSON。子会话模型请求是额外成本，由引擎的模型体验部分负责说明。

#### KV Cache 影响

工具结果追加在父请求前缀之后。保存改变后续子会话任务数据，不改变先前父消息或系统提示词。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

工具暴露预览、保存与工作区激活。

- **不支持无人审批采纳** — 新经验要求配置的审批答复方准许该具体请求；没有答复方的 headless 配置组合不能保存经验。
- **不能删除经验** — 已保存修订可按工作区列出、激活与回滚，但不能删除或编辑。
- **通用展示** — 通过 Session id 引用子会话证据，不提供专用比较面板。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
