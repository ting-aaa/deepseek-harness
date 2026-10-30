---
kind: upgrade-guide
description: "Harness² domain storage version 2 rejects version 1 rather than automatically migrating old previews and lessons."
---

# Harness² library version 2

English | [中文](guide.zh.md)

## Change

The native recursive Harness² service uses version 2 of the `harness2` storage domain. Existing version 1 text-preview stores are rejected with a version mismatch; the service does not convert them. Version 2 stores candidate trees, accepted task experiences, run fingerprints, and stage checkpoints. This affects deployments that enabled the experimental version 1 service, not ordinary Session history or profiles without Harness².

## Migration

1. Preserve the existing storage and a working copy of the previous application before upgrading. Do not delete, relabel, or edit version 1 records to bypass the version check.
2. If you need the existing library, keep the previous service with its original storage until an explicit migration is available. No in-place migration is provided by this change.
3. To evaluate the new service independently, configure a separate deployment storage location through the [storage provider](../../../../packages/storage/storage-domain/README.md). Keep the old location intact; new runs do not import old lessons automatically.
4. Confirm that the new service opens its fresh `harness2` domain and completes a preview. Review and approve any desired new lesson separately. A version-mismatch error means the old store is still selected, not that conversion succeeded.
