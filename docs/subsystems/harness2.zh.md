---
description: "原生 Harness² 优化：子会话隔离、运行证据与显式保存的领域经验。"
---

# Harness² 优化

[English](harness2.md) | 中文

## 概述

本文参考定义内置 Harness² 优化如何使用 DSH 子会话与持久领域存储。一次运行比较同一任务的候选 harness 并返回预览；保存结果是单独的操作。[包参考](../../packages/subagent/harness2/README.zh.md)负责配置与运行限制，[用户指南](../user/guide/harness2.zh.md)说明预览与评审。

## 目录

- [组合](#composition)
- [运行与经验的归属](#run-and-lesson-ownership)
- [请求与结果](#requests-and-results)
- [信任与模型历史](#trust-and-model-history)
- [Cordis API](#cordis-surface)
- [开发备注](#dev-note)

-----

<a id="composition"></a>
## 组合

共享 `dsh-base` 配置组合为完整的 base 配置组合挂载 `ctx.harness2` 及其面向模型的工具，包括 headless、SDK 与 ACP。Web 和 Desktop 将服务保留在宿主层，在 `standard`、`cordis` 与 `ptc` agent 预设中挂载工具。Web 的 `minimal` 预设和独立 `sdk-minimal` 配置组合保留有意缩小的工具目录。无需单独安装 addon。

服务拥有有界优化算法、子会话生命周期、审计事件与领域经验库。工具消费方负责参数校验和面向父会话的结果。两者都不修改 `agent-loop`，也不调用上游 Python 运行器。工具可用不会自动触发优化或接受经验。

```text
harness2 tool -> ctx.harness2 -> managed DSH child sessions
                           -> storageDomain: runs and domain lessons
harness2_remember ---------> explicit domain-library update
```

服务使用现有 [subagent](subagent.zh.md)、[工具执行](tools.zh.md)和[存储](storage.zh.md) API。子会话的模型选择与日志仍由 DSH 负责。[算法说明](../../packages/subagent/harness2/README.zh.md#understand-the-implementation)负责各阶段与上游归属说明。

-----

<a id="run-and-lesson-ownership"></a>
## 运行与经验的归属

一次运行归属于发起它的父 Session 以及调用方选择的领域。预览保留其来源经验库修订、执行证据、组合指导与反思。存储预览本身不会改变领域经验库。

只有原始父会话可以保存该预览。新的采纳要求在父会话轮次进行期间获得用户审批服务的一次性准许；审批缺失或被拒绝不会更新经验库。重复当前已接受的运行是幂等操作；基于陈旧经验库修订的另一运行不能覆盖较新的经验。已接受的指导和反思可供后续同领域 Harness² 运行使用，不会注入普通对话或全局配置。

领域存储负责持久运行记录与经验记录；子 Session 日志负责模型可见的请求和响应。原生 `harness2/*` Session 事件描述计算与采纳意图，不代表存储提交成功。持久化失败不能视为经验已获接受的证据。取消不能回滚已开始的最终持久写入；提交成功即返回成功。持久阶段检查点仅允许相同父会话与运行指纹继续中断的运行。

-----

<a id="requests-and-results"></a>
## 请求与结果

服务接受确切的活跃父会话，并返回带稳定子会话引用的预览。以下定义复制自[声明模块](../../packages/subagent/harness2/src/types.ts)；已接受经验仍以存储经验库为准。

```ts type-equiv
/** Identifies one preview, independently of its child Sessions. */
type Harness2RunId = Branded<'Harness2RunId'>
```

```ts type-equiv
/** A bounded preview using task text, remembered domain guidance, and parent-authorized read-only task tools. */
interface Harness2Request {
  readonly parent: Agent
  readonly task: string
  readonly domain: string
  readonly signal: AbortSignal
  readonly mode?: 'parallel' | 'sequential'
  readonly k?: number
  readonly resumeRunId?: Harness2RunId
}
```

```ts type-equiv
/** One child execution, including retries, selection and reflection. */
interface Harness2Stage {
  readonly phase: 'baseline' | 'invariant' | 'domain' | 'invariant-probe' | 'domain-probe' | 'compose' | 'final' | 'reflect' | 'select'
  readonly sessionId: SessionId
  readonly label?: string | undefined
}
```

```ts type-equiv
/** Completed preview, not a certification that the answer is correct. */
interface Harness2Result {
  readonly runId: Harness2RunId
  readonly domain: string
  readonly answer: string
  readonly instructions: string
  readonly reflection: string
  readonly candidate: CandidateTree
  readonly mode: 'parallel' | 'sequential'
  readonly k: number
  readonly selected: string
  readonly finals: readonly {
    label: string
    answer: string
    candidate: CandidateTree
    error?: string | undefined
    trajectory?: string | undefined
  }[]
  readonly stages: readonly Harness2Stage[]
}
```

-----

<a id="trust-and-model-history"></a>
## 信任与模型历史

提案、探测报告和已保存经验仍是低信任模型产物，不替换宿主策略。答案 rollout 安装经校验的原生候选资源；它们与其候选委派会获得配置中允许、从发起父 Agent 捕获的只读任务工具。默认允许 `read`、`read_image`、`glob`、`grep`、`web_search` 和 `web_fetch`；只接受其子集，`readTools: []` 可禁用。提案、合成、选择与反思阶段不获得父任务工具。每个子步骤重新检查准入；派发时还检查捕获的定义身份和实时父 Agent 的守卫。推测阶段不会获得父 Agent 的 shell、写入、编辑或应用修改工具。脚本和中间件使用内置可移植 WASI 运行时，并逐次向发起父 Agent 请求执行审批；`runtime: null` 会禁用它们。完整能力与限制见[包参考](../../packages/subagent/harness2/README.zh.md#use-this-package)。

新建子会话上下文不继承父对话。调用方必须提供任务材料，或可通过已准入只读工具访问的输入引用。审阅选中的预览后，父 Agent 通过普通工具循环和权限另行应用所需修改。已存证据与模型评估并非对正确性或任务完成情况的独立验证。

-----

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxharness2--harness2engine"></a>

### `ctx.harness2` — `Harness2Engine`

Native recursive candidate service; the tool consumer owns schema and presentation.

```ts cordis-catalog
/**
 * Run a bounded recursive preview with durable per-stage checkpoints. Failed rollouts remain
 * evidence when another baseline and final are usable. Cancellation or infrastructure failure
 * drains children while retaining completed stage evidence. The final durable write is not
 * cancellable; aborting after that write begins cannot roll it back. Earlier child logs remain.
 * @param request - exact live parent, task, domain-library key, and cancellation signal.
 * @returns the completed answer, proposed instructions, reflection, and child evidence ids.
 */
run(request: Harness2Request): Promise<Harness2Result>

/**
 * Adopt one completed preview for future runs in its domain. This never changes the
 * parent's prompt, tools, permissions, or workspace. The configured approval answerer must
 * grant this exact request; unavailable, rejected, cancelled, and never-policy asks fail closed.
 * @param parent - exact live originating parent; another Session cannot adopt this preview.
 * @param id - preview id returned by run; repeated adoption is idempotent.
 * @param options - cancellation and optional originating tool call; the parent must have an open turn for approval audit.
 * @returns the committed domain-library revision; rejects if a different preview was adopted since this run began.
 */
remember(parent: Agent, id: Harness2RunId, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<number>
```

Types: [Agent](core.zh.md) · [ToolCallId](core.zh.md)

Source: [`packages/subagent/harness2/src/index.ts`](../../packages/subagent/harness2/src/index.ts)
<!-- END GENERATED cordis-surface -->

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
