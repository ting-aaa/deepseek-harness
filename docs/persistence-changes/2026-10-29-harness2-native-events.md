---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-harness2-native-events

English | [中文](2026-10-29-harness2-native-events.zh.md)

## Summary

Promotes the built-in Harness² audit records to four native Session event discriminators: harness2/start, harness2/end, harness2/execution, and harness2/remember-request. Their payloads are unchanged. The harness2 storage domain remains version 2 with its existing keys and tables.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-harness2-native-events
baseline: false
changes:
  - root: "event:harness2/end"
    previous: null
    after: "442d4fa957723ae7c823c01881d972df869e520765ee0e34169eae51966b7f2c"
    decision: same-version
  - root: "event:harness2/execution"
    previous: null
    after: "88b78649a4ec6791427750e6a68063d801951dfecda94a9ae0b3df512c7966ff"
    decision: same-version
  - root: "event:harness2/remember-request"
    previous: null
    after: "e65ad4343443164858c3b33843d2d2fd3b08caa3ebf0fc6ca932a0166c35ce32"
    decision: same-version
  - root: "event:harness2/start"
    previous: null
    after: "515c38856c278189f1d3efdba6f602987fb78cb3cb58f609196f25ff2676b131"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The current reader retains the generic ignorable plugin-record contract, so historical plugin:harness2/* records remain opaque log-only evidence and are not rewritten or replayed as native events. Older readers do not recognize the four new non-ignorable native discriminators and safely refuse such logs rather than interpreting their payloads as an existing event. New readers recognize the native events as log-only records; they do not change the model-visible surface or establish a successful lesson commit. No existing discriminator or persisted payload is reinterpreted, and Session writer version 4 and accepted finalized checkpoints remain unchanged.

<a id="verification"></a>
## Verification

On Windows, the promoted-source native-service-parity.spec.ts passed 10 tests covering native audit events, approval/adoption, and SQLite persistence; loader-composition.spec.ts passed 8 lifecycle, cancellation/unload, audit, and adoption tests. The composition/retirement and generated-alias specs passed 9 tests. The generated known-event-types table includes all four native discriminators; the existing generic ignorable-record and unknown-event refusal contracts were reviewed in the Session and persistence sources. These checks do not claim a complete Windows recorded-replay comparison.

<a id="dev-note"></a>
## Dev Note

None.
