---
description: "Use Harness² preview and remember tools with bounded child execution, reviewed parent application, and approved same-parent lesson adoption."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-harness2

English | [中文](README.zh.md)

## Summary

Compare approaches with a bounded Harness² preview, inspect its result, and separately remember a user-approved lesson. The parent agent may choose this comparison for complex or uncertain tasks when extra exploration is useful; the user can also request it directly. Previewing does not accept a candidate; remembering affects only later Harness² runs in the same domain.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Full base-backed DSH profiles include the tools with their [engine](../harness2/README.md); the [composition reference](../../../docs/subsystems/harness2.md#composition) defines profile and preset availability. A custom composition can mount the following row where `tools` and `harness2` are available; the consumer has no configuration fields or budget overrides.

```yaml
- id: optional-tool-harness2
  name: '@deepseek-ai/dsh-tool-harness2'
```

### Preview, then remember

`harness2` accepts a complete `task`, stable `domain`, and optional `mode`, `k`, and `resumeRunId`. `k` cannot exceed deployment limits; resume requires the same parent and run fingerprint. Results include the selected answer, candidate tree, all finals, reflection, and stage references. The tool cannot raise budgets or authorize code execution. Show the preview before asking whether to retain it.

Answer rollouts and their candidate delegates may inspect inputs with the configured read-only tools captured from the initiating parent; proposal and review stages receive no parent task tools. Speculative stages cannot use parent shell, write, edit, or change-application tools. After reviewing the selected result, the parent can apply changes through its ordinary tool and permission flow. Previewing and remembering do not apply changes.

`harness2_remember` accepts the approved `runId` and returns the committed library `revision`. The preview must be retained and owned by the current parent Session; an intervening domain update requires a fresh preview. The [service reference](../harness2/README.md) owns budgets, cancellation, retention, and storage semantics.

A preview does not require the user to name Harness². Generated execution still requires per-execution approval. Before adopting a new preview, the service requests one-time approval through DSH’s user-approval service, showing its domain, instructions, and reflection. Missing approval handling, rejection, cancellation, and a policy that disallows asking all fail closed without accepting a lesson.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The consumer delegates preview execution to `ctx.harness2.run()` with the calling Agent and tool cancellation signal. The engine captures the parent-authorized read-only task tools, rechecks admission at each child step, and checks definition identity and parent guards at dispatch. Generated candidate execution requests approval from the initiating parent. Remembering delegates to `ctx.harness2.remember()` with cancellation and the tool-call identifier; the service owns the approval request. The engine, not schema filtering or prompt guidance, owns execution restrictions.

Both tools use ordinary logged tool calls and results. Pure presenters use generic cards; the preview card shows the submitted task and the remember card shows the run identifier. [`src/index.ts`](src/index.ts) owns registration, schemas, delegation, and presentation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages for task preparation and engine-level guarantees.

- [User guide](../../../docs/user/guide/harness2.md) — review a result before accepting a lesson.
- [Native engine](../harness2/README.md) — algorithm, deployment limits, and upstream attribution.
- [Subsystem reference](../../../docs/subsystems/harness2.md) — parent ownership and durable state.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

The generated [Harness² tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-harness2) define `harness2` and `harness2_remember`, including bounded exploration and approval instructions. This package adds no system-prompt section.

#### Token effect

Two fixed tool schemas enter each request where the registration is visible. Task and domain arguments are retained with the tool call.

#### KV Cache effect

Definitions remain prefix-stable while tool content and visibility are unchanged. Enabling or disabling the plugin changes the visible tool list and can invalidate reuse from that position.

### Parent results

#### What the model sees

A successful preview appends JSON containing the selected answer, candidate file tree, all final answers, instructions, reflection, run and domain identifiers, and stage/session references. Finals also include available execution trajectories or failure details; probe evidence remains in child logs. Remembering returns a revision; failures use ordinary tool error handling.

#### Token effect

Preview results retain the engine-bounded text fields plus JSON and reference metadata. `maxOutputChars` bounds the answer alone, not the complete parent JSON. Child model requests are additional cost owned by the engine’s Model Experience.

#### KV Cache effect

Tool results append after the parent request prefix. Remembering changes later child task data, not an earlier parent message or system prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The tools expose only the preview-and-remember workflow.

- **No unattended adoption** — a new lesson requires the configured approval answerer to grant the exact request; a headless composition without an answerer cannot remember it.
- **No lesson browser or management tools** — there is no list, delete, rollback, or cross-session adoption operation.
- **Generic presentation** — child evidence is referenced by Session id rather than a dedicated comparison panel.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
