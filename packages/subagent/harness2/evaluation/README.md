---
description: "Compare ordinary and adopted DSH guidance on externally graded held-out artifacts."
kind: "package-reference"
---

# Harness² evaluation

English | [中文](README.zh.md)

This runner tests the complete search, remember, apply, activate, and ordinary-task path through the shipped `dsh --profile sdk` application. Two fixed ledger tasks build one domain library. Its final revision is frozen before four disjoint held-out fixtures run with and without the overlay, in separate Git workspaces with identical inputs, provider, model, and request limits. The evaluator grades exact output JSON and unchanged inputs after adoption; no oracle output or grade is sent to an Agent. It never executes generated code.

Build the repository first. From its root:

```sh
pnpm exec tsx packages/subagent/harness2/evaluation/run.ts --dry-run
pnpm exec tsx packages/subagent/harness2/evaluation/run.ts --scripted-smoke
```

The scripted smoke uses real tools, independent copies, SQLite persistence, approvals, SDK processes, and workspace bindings; only model responses and token reports are synthetic. `qualityMeasured: false` prevents interpreting these passes as model improvement. A real-provider run requires `DEEPSEEK_API_KEY` and omits `--scripted-smoke`; `HARNESS2_EVAL_PROVIDER` and `HARNESS2_EVAL_MODEL` select an already configured route. The runner uses an isolated DSH home. It approves only workspace rollout, remember, apply, and activate operations; generic permission escalation is rejected.

Each run retains fixtures, Session logs, library, and `report.json` under `~/.dsh/harness2-evaluations/run-*`; failed runs retain `failure.json`. Reports separate search and held-out costs, include reported input/output tokens and elapsed time, and verify the frozen overlay from recorded Session events. Missing usage is unreported cost, not zero actual cost. Search token limits are checked after responses; they are not a currency ceiling. The six-task suite verifies artifact processing and transport, not broad coding quality or statistical significance. Use multiple real runs and representative domain fixtures before accepting a quality or cost claim.
