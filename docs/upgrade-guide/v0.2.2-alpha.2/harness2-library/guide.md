---
kind: upgrade-guide
description: "Harness² domain storage version 4 admits version 2/3 libraries and retains workspace artifacts and structured experience."
---

# Harness² library version 4

English | [中文](guide.zh.md)

## Change

The native Harness² service writes version 4 of the `harness2` storage domain and reads versions 2 and 3 without rewriting them on open. It retains adopted revisions, bindings, optional workspace patches, reported usage, and structured experience. Version 1 text-preview stores are rejected. Older applications reject version 4 after its first write; restoring an application alone does not downgrade its data.

Custom compositions must provide `workingDirectory`, `sessionProjections`, `systemPrompt`, and `skills` alongside the existing engine dependencies. Shipped base-backed profiles already provide these services. Explicit `runtime: null` disables candidate execution, including when loaded through YAML.

Workspace rollout and filesystem editing are the defaults. They require enforcing filesystem and shell services; unavailable capabilities report read-only or JSON modes. Use `rollout: read-only` and `editor: json` to retain compact execution. Default per-child limits are 40 steps, 16384 output tokens per request, 200000 reported total tokens, and 900000 ms. Older checkpoints with different run fingerprints cannot resume. Sessions with the new non-ignorable `sandbox/workspace-root` event require a reader that understands it.

## Migration

1. Preserve the existing storage and a working copy of the previous application before upgrading. Do not delete, relabel, or edit version 1 records to bypass the version check.
2. Version 2 and 3 libraries open directly. A version 2 current lesson remains activatable; older revisions that were never stored cannot be recovered. New accepted previews retain revisions for rollback.
3. Keep a version 1 library with its original application. To evaluate the current service separately, configure a new [storage provider location](../../../../packages/storage/storage-domain/README.md); do not relabel or edit old records.
4. Update custom compositions with the required services. Confirm a preview completes, then review and remember it. Use `harness2_activate` to approve a workspace binding and `harness2_status` to inspect it. New top-level sessions receive the guidance; existing sessions keep their recorded decision on resume. `harness2_deactivate` stops future sessions from receiving it.
