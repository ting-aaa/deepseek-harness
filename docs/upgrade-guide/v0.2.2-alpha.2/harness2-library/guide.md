---
kind: upgrade-guide
description: "Harness² domain storage version 3 admits version 2 libraries, adds workspace bindings, and rejects version 1 stores."
---

# Harness² library version 3

English | [中文](guide.zh.md)

## Change

The native Harness² service writes version 3 of the `harness2` storage domain and reads version 2 without rewriting it on open. Version 3 adds adopted revision history, workspace bindings, and optional selector fallback details. Existing version 1 text-preview stores are rejected. After a version 3 write, older applications reject the newer domain version; restoring an application alone does not downgrade its data.

Custom compositions must provide `workingDirectory`, `sessionProjections`, `systemPrompt`, and `skills` alongside the existing engine dependencies. Shipped base-backed profiles already provide these services. Explicit `runtime: null` disables candidate execution, including when loaded through YAML.

## Migration

1. Preserve the existing storage and a working copy of the previous application before upgrading. Do not delete, relabel, or edit version 1 records to bypass the version check.
2. A version 2 library can open directly. Its current lesson remains activatable; older revisions that were never stored cannot be recovered. New accepted previews retain revisions for rollback.
3. Keep a version 1 library with its original application. To evaluate the current service separately, configure a new [storage provider location](../../../../packages/storage/storage-domain/README.md); do not relabel or edit old records.
4. Update custom compositions with the required services. Confirm a preview completes, then review and remember it. Use `harness2_activate` to approve a workspace binding and `harness2_status` to inspect it. New top-level sessions receive the guidance; existing sessions keep their recorded decision on resume. `harness2_deactivate` stops future sessions from receiving it.
