---
description: "Preview a text-only Harness² refinement, inspect the evidence, and explicitly save a domain lesson for later runs."
---

# Preview Harness² refinement

English | [中文](harness2.zh.md)

## Summary

Harness² compares alternative text guidance for a self-contained task before offering a composed answer and reusable lesson. You can inspect the preview without changing future runs, then explicitly remember a result for the same domain. This experimental feature uses multiple model-backed child sessions and can cost substantially more than an ordinary answer. The default configuration does not inspect your files or execute generated code; optional candidate execution requires separate configuration and approval, described in the [capability reference](../../../packages/experimental/harness2/README.md#use-this-package). It cannot independently certify that its answer is better.

## Table of Contents

- [1. Prepare a text-only task](#prepare)
- [2. Request a preview](#preview)
- [3. Review before remembering](#review)
- [4. Reuse a domain lesson](#reuse)
- [Troubleshooting](#troubleshooting)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="prepare"></a>
## 1. Prepare a text-only task

Start with a working DSH model configuration and explicitly enable the [Harness² bundle](../../../packages/experimental/harness2-bundle/README.md#use-this-package). It is not part of the default profile composition. The bundle reference owns activation; the [service reference](../../../packages/experimental/harness2/README.md#use-this-package) owns deployment limits.

Include the problem, constraints, and source material in the task text. Children receive no parent conversation or file access, so “use the document above” or a filesystem path is insufficient. Choose a domain label for a reusable task family. Matching mode and domain labels share lessons across conversations using this storage instance; they are not a privacy or authorization boundary. Do not include secrets in task text.

-----

<a id="preview"></a>
## 2. Request a preview

Ask the agent to call `harness2` with a `task` and `domain`, and to leave the result unremembered. For example, this tool input needs no external files:

```json
{
  "task": "Draft a five-item release checklist for a small command-line tool. Cover tests, documentation, package contents, rollback, and user communication. Keep each item actionable.",
  "domain": "release-checklists"
}
```

The default `k=1` run includes four answer rollouts, three improvement stages, and reflection. Use `mode: "parallel"` or `"sequential"` and a deployment-permitted `k` for wider or deeper comparisons; multiple finals add a selection step. Review the run identifier, selected answer, candidate tree, and lesson. Previewing does not authorize changes to the parent workspace or configuration.

Cancel the parent operation to stop before final storage commit; a durable write already started cannot be undone, so use the returned outcome. A failed run is not a complete preview. With its run identifier, `resumeRunId` and the same task, domain, mode, k, parent, and deployment configuration can reuse checkpoints. Same-ID resume retains failed rollouts as evidence rather than retrying them; omit the identifier to start a new run if those rollouts need retrying, which can incur additional model charges.

-----

<a id="review"></a>
## 3. Review before remembering

Check the output against your actual requirements. Compare the baseline and final evidence, reject unsupported claims, and look for instructions that should not carry into other tasks. The model-generated reflection is not a trusted evaluator.

To retain an accepted result, ask the same parent conversation to call `harness2_remember` with its returned `runId`. Do not copy an identifier from another conversation. DSH asks for one-time approval showing the domain, instructions, and reflection; rejecting or cancelling that approval request leaves the lesson unchanged. Remembering is separate from previewing and does not modify `AGENTS.md`, Cordis configuration, global prompts, or model weights.

-----

<a id="reuse"></a>
## 4. Reuse a domain lesson

A later `harness2` call with the same mode and domain can use the accepted guidance and lesson. Ordinary DSH tasks do not gain this context automatically. Repeating the currently accepted run is harmless; a preview based on an older library revision is rejected after another result has been remembered. Request a new preview against the current lesson instead of overwriting it.

-----

<a id="troubleshooting"></a>
## Troubleshooting

Use the returned failure rather than guessing whether a run or lesson was saved. These remedies preserve the preview-first workflow.

| Symptom | Next action |
|---|---|
| The tool is unavailable | Confirm the opt-in bundle is active in the current profile and request scope. |
| A text or output limit is exceeded | Shorten the task or ask the deployment owner to review the named limit; do not split instructions to evade it. |
| A child times out or exhausts its budget | Inspect the reported phase and retry only after addressing the cause; earlier child work may already have incurred model charges. |
| Remembering fails | Check the approval outcome, originating parent, retained run, current library revision, and storage error before trying again. |

-----

<a id="further-exploration"></a>
## Further Exploration

These references distinguish the feature’s runtime behavior from the upstream research method.

- [Harness² service](../../../packages/experimental/harness2/README.md) — budgets, algorithm attribution, and unsupported cases.
- [Model-facing tools](../../../packages/experimental/tool-harness2/README.md) — preview and remember semantics.
- [DSH architecture](../../architecture.md) — plugin composition and logged model context.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
