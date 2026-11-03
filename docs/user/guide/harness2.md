---
description: "Preview a Harness² refinement, inspect the evidence, and explicitly save a domain lesson for later runs."
---

# Preview Harness² refinement

English | [中文](harness2.zh.md)

## Summary

Harness² compares candidate guidance through repeated DSH task executions and returns a selected answer, patch, and reusable lesson. Workspace coding runs use independent copies after approval; unsupported hosts explicitly report read-only fallback. You can review the preview, apply its selected patch separately, remember its guidance, and activate a revision for later ordinary sessions. Search can cost substantially more than one answer; activating an existing revision does not repeat the search. The [capability reference](../../../packages/subagent/harness2/README.md#use-this-package) defines confinement and budgets. A model-generated reflection cannot certify improvement.

## Table of Contents

- [1. Prepare the task inputs](#prepare)
- [2. Request a preview](#preview)
- [3. Review before remembering](#review)
- [4. Reuse a domain lesson](#reuse)
- [Troubleshooting](#troubleshooting)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="prepare"></a>
## 1. Prepare the task inputs

Start with a working DSH model configuration in a full Desktop, Web, headless, SDK, or ACP profile. Harness² is built in; no addon installation or optional bundle is required. In Web or Desktop, use the `standard`, `cordis`, or `ptc` agent preset. The Web `minimal` preset and `sdk-minimal` profile keep their smaller tool catalogs. The [service reference](../../../packages/subagent/harness2/README.md#use-this-package) owns deployment limits.

The agent may choose a bounded preview for complex or uncertain tasks when comparing approaches is useful. You can also request one directly; generated execution and remembering keep their separate approvals.

For the separately packaged Windows application, see [Harness² custom Desktop](../../../apps/desktop/README.md#harness2-custom-package). It uses isolated application data and the same built-in Harness² feature, including portable WASI execution without WSL; online model configuration is still required.

Include the problem, constraints, and source material or accessible input paths. Children receive no parent conversation, so “use the document above” is insufficient. Workspace copies contain current tracked and nonignored untracked files, including uncommitted edits; ignored dependencies need separate preparation. Choose a stable domain label. Matching mode/domain labels share experiences within this storage instance and are not privacy or authorization scopes. Do not include secrets.

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

The default `k=1` search includes four task rollouts, three file-edit improvement stages, and reflection. Larger `k` increases cost; multiple finals also add selection. Review `executor`, `executorReason`, `editor`, `usage`, candidate files, final patches, and stage references. For a workspace preview, ask the same conversation to call `harness2_apply` with its `runId`; it separately requests approval and rejects conflicting patches. Previewing and remembering do not modify the parent workspace. Inspect files before retrying an interrupted application.

Cancel the parent operation to stop before final storage commit; a durable write already started cannot be undone, so use the returned outcome. A failed run is not a complete preview. With its run identifier, `resumeRunId` and the same task, domain, mode, k, parent, and deployment configuration can reuse checkpoints. Same-ID resume retains failed rollouts as evidence rather than retrying them; omit the identifier to start a new run if those rollouts need retrying, which can incur additional model charges.

-----

<a id="review"></a>
## 3. Review before remembering

Check the output against your actual requirements. Compare the baseline and final evidence, reject unsupported claims, and look for instructions that should not carry into other tasks. The model-generated reflection is not a trusted evaluator.

To retain an accepted result, ask the same parent conversation to call `harness2_remember` with its returned `runId`. Do not copy an identifier from another conversation. DSH asks for one-time approval showing the domain, instructions, and reflection; rejecting or cancelling that approval request leaves the lesson unchanged. Remembering is separate from previewing and does not modify `AGENTS.md`, Cordis configuration, global prompts, or model weights.

-----

<a id="reuse"></a>
## 4. Reuse a domain lesson

A later `harness2` call with the same mode and domain can use the accepted guidance and lesson. Ordinary DSH tasks gain it only after you ask the agent to call `harness2_activate` and approve the binding; new sessions in this workspace then receive the guidance, skills, and delegates. Ask for `harness2_status` to see revisions, `harness2_activate` with an older `revision` to roll back, or `harness2_deactivate` to stop. Repeating the currently accepted run is harmless; a preview based on an older library revision is rejected after another result has been remembered. Request a new preview against the current lesson instead of overwriting it.

File editors can inspect accepted full-tree examples and structured experience in their read-only context. Compact JSON mode admits only history that fits its message budget and reports omissions. To measure usefulness, run the [external held-out evaluation](../../../packages/subagent/harness2/evaluation/README.md); adoption alone is not evidence of improvement.

-----

<a id="troubleshooting"></a>
## Troubleshooting

Use the returned failure rather than guessing whether a run or lesson was saved. These remedies preserve the preview-first workflow.

| Symptom | Next action |
|---|---|
| The tool is unavailable | Confirm the current profile and agent preset include Harness²; minimal and custom presets may omit it. |
| A text or output limit is exceeded | Shorten the task or ask the deployment owner to review the named limit; do not split instructions to evade it. |
| A child times out or exhausts its budget | Inspect the reported phase and retry only after addressing the cause; earlier child work may already have incurred model charges. |
| Remembering fails | Check the approval outcome, originating parent, retained run, current library revision, and storage error before trying again. |

-----

<a id="further-exploration"></a>
## Further Exploration

These references distinguish the feature’s runtime behavior from the upstream research method.

- [Harness² service](../../../packages/subagent/harness2/README.md) — budgets, algorithm attribution, and unsupported cases.
- [Model-facing tools](../../../packages/subagent/tool-harness2/README.md) — preview and remember semantics.
- [DSH architecture](../../architecture.md) — plugin composition and logged model context.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
