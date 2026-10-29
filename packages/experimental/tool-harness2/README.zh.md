---
description: "依据明确用户意图使用 Harness² 预览与保存工具，采用有界子会话执行与同父会话经验采纳。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-harness2

[English](README.md) | 中文

## 概述

请求 Harness² 递归实验、检查结果，并单独保存用户批准的预览。只有用户明确要求 Harness² 或 harness 优化时才使用。预览不接受候选；保存只影响后续同领域 Harness² 运行。

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

使用[组合包](../harness2-bundle/README.zh.md)将工具与引擎组合。自定义配置组合可以在 `tools` 与 `harness2` 可用处挂载以下配置项；消费方没有配置字段或预算覆盖项。

```yaml
- id: optional-tool-harness2
  name: '@deepseek-ai/dsh-experimental-tool-harness2'
```

### 先预览，再保存

`harness2` 接受完整 `task`、稳定 `domain`，以及可选的 `mode`、`k`、`resumeRunId`。`k` 不得超过部署上限；恢复要求相同父会话和运行指纹。结果包含选中答案、候选树、全部最终候选、反思及阶段引用；不能通过工具提高预算或授权代码执行。先展示预览，再询问是否保留。

`harness2_remember` 接受已批准的 `runId`，返回已提交的经验库 `revision`。预览必须仍被保留，并归属于当前父 Session；其间若领域已更新，则需要新预览。[服务参考](../harness2/README.zh.md)负责预算、取消、保留与存储语义。

工具描述要求实验具有明确用户意图。采纳新预览前，服务通过 DSH 用户审批服务请求一次性批准，展示领域、指令与反思。缺少审批处理、拒绝、取消或策略禁止询问时，都默认拒绝且不接受经验。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部原理 — 点击展开</summary>

消费方将调用 Agent 与工具取消信号传给 `ctx.harness2.run()` 以委派预览执行。保存将取消信号与工具调用标识传给 `ctx.harness2.remember()`；服务负责审批请求。执行限制由引擎负责，不依赖 schema 过滤或提示词指导。

两个工具都使用普通的已记录工具调用与结果。纯展示转换器使用通用卡片；预览卡片显示提交的任务，保存卡片显示运行标识。[`src/index.ts`](src/index.ts)负责注册、schema、委派与展示。

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

生成的 [Harness² 工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-harness2)定义 `harness2` 与 `harness2_remember`，包括明确意图与批准要求。此包不添加系统提示词片段。

#### Token 影响

在注册可见的每次请求中加入两个固定工具 schema。任务与领域参数随工具调用保留。

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

工具仅暴露预览与保存工作流。

- **不支持无人审批采纳** — 新经验要求配置的审批答复方准许该具体请求；没有答复方的 headless 配置组合不能保存经验。
- **没有经验浏览器或管理工具** — 不提供列出、删除、回滚或跨会话采纳操作。
- **通用展示** — 通过 Session id 引用子会话证据，不提供专用比较面板。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
