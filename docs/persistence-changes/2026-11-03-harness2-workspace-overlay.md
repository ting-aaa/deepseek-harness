---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-03-harness2-workspace-overlay

English | [中文](2026-11-03-harness2-workspace-overlay.zh.md)

## Summary

Adds Session-pinned Harness² workspace overlay decisions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-harness2-workspace-overlay
baseline: false
changes:
  - root: "event:harness2/overlay"
    previous: null
    after: "d8b80b0836c7c267c05d6bb9d2e5a84ee736d6cfc18bef9c514a64934cdf78df"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new harness2/overlay discriminator records either an inactive decision or a workspace, domain, recursion mode, accepted revision, and candidate hash. Current readers retain all existing events and recover the decision through a host projection. Older readers safely refuse this unknown non-ignorable event. No released Session generations are changed.

<a id="verification"></a>
## Verification

Overlay integration tests exercise approval, adoption, binding, rollback, deactivation, persistence resume of active and inactive decisions, and rejection of a changed recorded candidate. Focused overlay suite: 6 tests passed on Windows.

<a id="dev-note"></a>
## Dev Note

None.
