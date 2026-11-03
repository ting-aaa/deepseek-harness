---
description: "Native Harness² refinement: child-session isolation, run evidence, and explicitly remembered domain lessons."
---

# Harness² refinement

English | [中文](harness2.zh.md)

## Summary

This reference defines how built-in Harness² refinement uses DSH child sessions and durable domain storage. A run compares candidate harnesses for one task and returns a preview; remembering a result is a separate operation. The [package reference](../../packages/subagent/harness2/README.md) owns configuration and operating limits, and the [user guide](../user/guide/harness2.md) explains preview and review.

## Table of Contents

- [Composition](#composition)
- [Run and lesson ownership](#run-and-lesson-ownership)
- [Requests and results](#requests-and-results)
- [Trust and model history](#trust-and-model-history)
- [Cordis API](#cordis-surface)
- [Dev Note](#dev-note)

-----

<a id="composition"></a>
## Composition

The shared `dsh-base` composition mounts `ctx.harness2` and its model-facing tools for full base-backed profiles, including headless, SDK, and ACP. Web and Desktop keep the service on the host and mount the tools in the `standard`, `cordis`, and `ptc` agent presets. The Web `minimal` preset and the standalone `sdk-minimal` profile keep their intentionally smaller tool catalogs. No separate addon installation is required.

The service owns the bounded refinement algorithm, child lifetime, audit events, and domain lesson library. The tool consumer owns argument validation and the parent-facing result. Neither changes `agent-loop` or invokes the upstream Python runner. Tool availability does not trigger a refinement or accept a lesson automatically.

```text
harness2 tool -> ctx.harness2 -> managed DSH child sessions
                           -> storageDomain: runs and domain lessons
harness2_remember ---------> explicit domain-library update and revision
harness2_activate ---------> approved workspace binding
agent/created (top-level) -> overlay: prompt section, skills, resources
```

The service uses the existing [subagent](subagent.md), [tool execution](tools.md), and [storage](storage.md) APIs. Child model selection and logging remain DSH-owned. The [algorithm description](../../packages/subagent/harness2/README.md#understand-the-implementation) owns the individual phases and upstream attribution.

-----

<a id="run-and-lesson-ownership"></a>
## Run and lesson ownership

A run belongs to its initiating parent Session and a caller-selected domain. The preview retains its source library revision, execution evidence, composed guidance, and reflection. A stored preview does not itself change the domain library.

Only the originating parent can remember the preview. A new adoption requires a one-time grant from the user-approval service during an open parent turn; missing or refused approval does not update the library. Repeating the currently accepted run is idempotent; a different run based on a stale library revision cannot overwrite a newer lesson. Accepted guidance and reflection are available to later Harness² runs in that domain. They reach ordinary conversations only after a separately approved workspace binding, and only Agents created later in that workspace; global configuration is unchanged. The [package reference](../../packages/subagent/harness2/README.md#apply-adopted-guidance) owns the overlay mapping.

Domain storage owns durable run and lesson records; child Session logs own model-visible requests and responses. Native `harness2/*` Session events describe computation and adoption intent, not successful storage commits. Persistence failure is not evidence that a lesson was accepted. Cancellation cannot roll back a final durable write already in progress; a successful commit returns success. Durable stage checkpoints can resume an interrupted run only with the same parent and run fingerprint.

-----

<a id="requests-and-results"></a>
## Requests and results

The service accepts an exact live parent and returns a preview with stable child references. These definitions are copied from the [declaring module](../../packages/subagent/harness2/src/types.ts); the storage library remains authoritative for accepted lessons.

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
  /** Actual solver mode; a missing sandbox or refused workspace grant is reported in executorReason. */
  readonly executor?: 'workspace' | 'read-only' | undefined
  readonly executorReason?: string | undefined
  readonly editor?: 'filesystem' | 'json' | undefined
  readonly workspace?: string | undefined
  /** Sum of provider usage reports across newly executed and reused stage checkpoints. */
  readonly usage?: { inputTokens: number; outputTokens: number } | undefined
  /** Evidence-supported improvement experience, present for the filesystem editor. */
  readonly lesson?: { cue: string; lesson: string; evidence: string; edits: string } | undefined
  /** Present when selection failed and the first delivered final stands in. */
  readonly selectionFallback?: string | undefined
  readonly finals: readonly {
    label: string
    answer: string
    candidate: CandidateTree
    error?: string | undefined
    trajectory?: string | undefined
    changes?: string | undefined
  }[]
  readonly stages: readonly Harness2Stage[]
}
```

-----

<a id="trust-and-model-history"></a>
## Trust and model history

The workspace binding selects an adopted revision for newly created top-level Agents. Its Session decision is retained on resume.

```ts type-equiv
/** One workspace's explicitly approved candidate revision. */
interface Harness2Binding {
  /** Absolute workspace root: the nearest enclosing Git root, otherwise the session directory. */
  readonly workspace: string
  readonly domain: string
  readonly mode: 'parallel' | 'sequential'
  readonly revision: number
  readonly boundAt: number
}
```

Proposals, probe reports, and saved lessons remain lower-trust model outputs. The [package reference](../../packages/subagent/harness2/README.md#use-this-package) defines workspace coding tools, file-edit restrictions, fallback modes, isolated generated execution, and budgets. Tool admission rechecks captured definitions and live parent guards. A child’s logged `sandbox/workspace-root` fixes its private writable copy independently of its immutable Session origin.

Fresh child contexts do not inherit the parent conversation. File editors receive real DSH prompt and tool references plus bounded execution evidence. Applying a selected patch, remembering a lesson, and binding a revision are separate approved operations. Stored model assessments are not independent verification; the [evaluation runner](../../packages/subagent/harness2/evaluation/README.md) measures held-out artifacts externally.

-----

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

/**
 * Bind one adopted revision to the caller's workspace so later top-level Agents in that
 * workspace receive it as lower-trust guidance, native skills, and candidate resources.
 * The current conversation is unchanged. Requires a one-time approval grant.
 * @param parent - exact live Agent whose working directory selects the workspace.
 * @param request - domain, optional mode (default configured mode), and optional revision (default latest).
 * @param options - cancellation and optional originating tool call for approval audit.
 * @returns the committed binding.
 */
activate(parent: Agent, request: { domain: string; mode?: 'parallel' | 'sequential'; revision?: number }, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<Harness2Binding>

/**
 * Remove the caller workspace's binding; already running Agents keep their installed guidance.
 * @param parent - exact live Agent whose working directory selects the workspace.
 * @returns whether a binding was removed.
 */
deactivate(parent: Agent): Promise<boolean>

/**
 * Describe the caller workspace's binding and the adopted revisions available for rollback.
 * @param parent - exact live Agent whose working directory selects the workspace.
 * @param domain - optional domain filter for listed revisions.
 * @returns the workspace, its binding when present, and revision summaries in ascending order.
 */
status(parent: Agent, domain?: string): { workspace: string; binding?: Harness2Binding; revisions: { domain: string; mode: 'parallel' | 'sequential'; revision: number; runId: string; adoptedAt: number }[] }

/**
 * Apply a selected patch to its originating workspace after user approval.
 * @param parent - Exact live originating parent in the original workspace.
 * @param id - Completed workspace preview.
 * @param options - Cancellation and originating tool call for approval audit.
 * @returns Whether files changed. If application is interrupted, inspect the workspace before retrying.
 */
applyChanges(parent: Agent, id: Harness2RunId, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<boolean>
```

Types: [Agent](core.md) · [ToolCallId](core.md)

Source: [`packages/subagent/harness2/src/index.ts`](../../packages/subagent/harness2/src/index.ts)
<!-- END GENERATED cordis-surface -->

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
