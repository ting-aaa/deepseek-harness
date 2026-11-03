---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-03-harness2-workspace-rollouts

English | [中文](2026-11-03-harness2-workspace-rollouts.zh.md)

## Summary

Add the non-ignorable sandbox/workspace-root Session event to pin a managed coding rollout to its private writable copy. Harness² previews retain optional workspace patches, editor mode, reported token usage, and structured experience in domain version 4.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-harness2-workspace-rollouts
baseline: false
changes:
  - root: "event:sandbox/workspace-root"
    previous: null
    after: "f90a8497ffba4f0936be73c609dd3fdef3197b75d199f9617542ae53558b8ece"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Keep Session format V4: older readers reject the unknown non-ignorable discriminator before executing a Session with changed writable-root semantics. Current readers replay the root through a private projection. Domain version 4 reads version 2 and 3 rows without writing on open; older domain readers reject version 4 after its first write.

<a id="verification"></a>
## Verification

Exercise logged root resolution, replay and invalid-path refusal; native Windows filesystem and PowerShell rollouts; approved patch application; file-editor evidence protection; focused Harness² tests; recorded headless replay; SDK-profile train/adopt/activate/held-out scripted smoke. The scripted model verifies integration and does not establish real-model quality improvement.

<a id="dev-note"></a>
## Dev Note

None.
