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
harness2_remember ---------> explicit domain-library update
```

The service uses the existing [subagent](subagent.md), [tool execution](tools.md), and [storage](storage.md) APIs. Child model selection and logging remain DSH-owned. The [algorithm description](../../packages/subagent/harness2/README.md#understand-the-implementation) owns the individual phases and upstream attribution.

-----

<a id="run-and-lesson-ownership"></a>
## Run and lesson ownership

A run belongs to its initiating parent Session and a caller-selected domain. The preview retains its source library revision, execution evidence, composed guidance, and reflection. A stored preview does not itself change the domain library.

Only the originating parent can remember the preview. A new adoption requires a one-time grant from the user-approval service during an open parent turn; missing or refused approval does not update the library. Repeating the currently accepted run is idempotent; a different run based on a stale library revision cannot overwrite a newer lesson. Accepted guidance and reflection are available to later Harness² runs in that domain, not injected into ordinary conversations or global configuration.

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
## Trust and model history

Proposals, probe reports, and saved lessons remain lower-trust model outputs, not replacements for host policy. Answer rollouts install validated native candidate resources; they and their candidate delegates receive configured read-only task tools captured from the initiating parent. The default task-tool allowlist is `read`, `read_image`, `glob`, `grep`, `web_search`, and `web_fetch`; only a subset is accepted, and `readTools: []` disables it. Proposal, composition, selection, and reflection stages receive no parent task tools. Admission is rechecked at each child step; dispatch also checks captured definition identity and the live parent’s guards. Speculative stages receive no parent shell, write, edit, or change-application tools. Scripts and middleware use the built-in portable WASI runtime and require per-execution approval addressed to the initiating parent; `runtime: null` disables them. The [package reference](../../packages/subagent/harness2/README.md#use-this-package) owns the complete capabilities and limits.

Fresh child contexts do not inherit the parent conversation. The caller must supply task material or input references accessible through the admitted read-only tools. After reviewing a selected preview, the parent applies any desired changes separately through its ordinary tool loop and permissions. Stored evidence and model assessments are not independent verification of correctness or task completion.

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
