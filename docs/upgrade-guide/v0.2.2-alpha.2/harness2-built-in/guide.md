---
kind: upgrade-guide
description: "Harness² package names and audit events change as refinement becomes built in to full DSH profiles."
---

# Harness² becomes a built-in capability

English | [中文](guide.zh.md)

## Change

Full base-backed Desktop, Web, headless, SDK, and ACP profiles include Harness². The Web `standard`, `cordis`, and `ptc` presets advertise its tools; the Web `minimal` preset and `sdk-minimal` profile keep their smaller tool catalogs. The parent may choose a bounded preview for complex or uncertain work; remembering still requires separate approval.

The engine is now `@deepseek-ai/dsh-harness2`; the tool consumer is `@deepseek-ai/dsh-tool-harness2`. The old `@deepseek-ai/dsh-experimental-harness2-bundle` is retired and removed from stored bundle lists. Existing `optional-harness2` and `optional-tool-harness2` row identifiers remain available for saved configuration.

Generated execution defaults to the built-in WASI backend on Windows, macOS, and Linux, with per-execution approval. `runtime: null` still disables it, and an explicit legacy Linux runtime configuration remains supported.

New audit events use `harness2/start`, `harness2/end`, `harness2/execution`, and `harness2/remember-request` instead of the corresponding `plugin:harness2/*` records. Historical ignorable records remain in existing Session logs. The `harness2` storage domain, version 2, tables, keys, and accepted lessons remain in place.

## Migration

1. Upgrade DSH and reopen Desktop or restart the CLI profile. No addon installer or replacement bundle is needed for full profiles.
2. In custom Cordis entries, package manifests, and TypeScript imports, replace `@deepseek-ai/dsh-experimental-harness2` with `@deepseek-ai/dsh-harness2` and `@deepseek-ai/dsh-experimental-tool-harness2` with `@deepseek-ai/dsh-tool-harness2`. Retain existing budget settings and row identifiers. Custom presets must mount the tool consumer where `tools` and `harness2` are available. Change an explicit `runtime: null` to `runtime: {backend: wasi}` only if portable execution is desired.
3. If an external Session reader filters Harness² audit records, accept the new `harness2/*` events while retaining support for historical `plugin:harness2/*` records. Do not rewrite Session logs or move the domain library.
4. In a full profile, request a preview and confirm that `harness2` and `harness2_remember` are available. Existing accepted guidance remains associated with the same mode and domain. See the [user guide](../../../user/guide/harness2.md) for the preview and approval workflow.
