---
description: "Explicitly compose native Harness² preview and remember tools into a DSH profile without changing shipped defaults."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-harness2-bundle

English | [中文](README.zh.md)

## Summary

Add Harness² recursive previews and explicit domain-lesson adoption to a selected DSH profile. No shipped profile selects this experimental layer by default. The default configuration does not execute generated code, automatically adopt lessons, or rewrite the parent agent. Model experiments can add cost.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select this bundle explicitly in a profile that already provides managed subagents, tools, model routing, domain storage, and user approval. The [profile composition reference](../../boot/app-boot/README.md#profiles) owns bundle selection and ordered patches. This package is a bundle, not a new application launcher.

### Inspect the source composition

From this repository with dependencies installed, inspect the opt-in patch without model calls:

```sh
DSH_HOME=$(mktemp -d) pnpm dsh --profile headless --patch packages/experimental/harness2-bundle/cordis.patch.yml --dump-config
```

The output includes `optional-harness2` and `optional-tool-harness2`. This checks composition only: it does not boot the runtime, execute a task, select the bundle permanently, or verify npm registry availability. Model-backed use needs a configured model; saving a new lesson also needs a working approval answerer.

The layer adds the [native service](../harness2/README.md) and [model tools](../tool-harness2/README.md). Its manifest marks it unlisted by default; this does not imply that a released installation already contains the package. Use the [user guide](../../../docs/user/guide/harness2.md) after the layer is active.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [`cordis.patch.yml`](cordis.patch.yml) layer inserts `optional-harness2` and `optional-tool-harness2`. The first row sets the child provider and deployment budgets; the second exposes the preview and remember tools. Later profile patches can replace a row’s configuration or disable it. Keep the service available whenever the tool row is enabled.

The bundle has no independent algorithm, model provider, storage backend, or UI plugin. Its implementation is the patch document; the mounted packages own runtime behavior and lifecycle.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Follow the user workflow before changing deployment policy.

- [User guide](../../../docs/user/guide/harness2.md) — prepare a task and review a preview.
- [Engine configuration](../harness2/README.md#use-this-package) — child budgets and retention.
- [Experimental package status](../README.md#status) — support and dependency-isolation rules.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [Harness² service](../harness2/README.md) and [tool consumer](../tool-harness2/README.md), which own child messages, tool definitions, and parent results.

#### KV Cache effect

The bundle itself adds no request text. Activating or removing its tool row changes the visible tool list; the mounted packages own the resulting cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Explicit composition only** — the layer is not selected in shipped defaults and does not provision models or storage.
- **Explicit runtime policy** — activating the bundle alone does not grant candidate code execution; engine configuration and approval own execution limits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
