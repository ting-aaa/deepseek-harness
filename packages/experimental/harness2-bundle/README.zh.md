---
description: "将原生 Harness² 预览与保存工具显式组合进 DSH 配置组合，不改变随附默认配置。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-harness2-bundle

[English](README.md) | 中文

## 概述

为选定 DSH 配置组合添加 Harness² 递归预览与显式领域经验采纳。随附配置组合都不默认选择此实验层。默认配置不执行生成代码，也不自动采纳经验或重写父 agent。模型实验可能增加成本。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已提供托管 subagent、工具、模型路由、领域存储与用户审批的配置组合中显式选择此组合包。[配置组合参考](../../boot/app-boot/README.zh.md#profiles)负责组合包选择与有序补丁。此包是组合包，不是新的应用启动器。

### 检查源码配置组合

在已安装依赖的本仓库中，无需模型调用即可检查显式启用的补丁：

```sh
DSH_HOME=$(mktemp -d) pnpm dsh --profile headless --patch packages/experimental/harness2-bundle/cordis.patch.yml --dump-config
```

输出包含 `optional-harness2` 与 `optional-tool-harness2`。这仅检查配置组合：不启动运行时、不执行任务、不永久选择组合包，也不验证 npm 注册表可用性。模型驱动的使用需要已配置模型；保存新经验还需要可用的审批答复方。

此层添加[原生服务](../harness2/README.zh.md)与[模型工具](../tool-harness2/README.zh.md)。其 manifest（元数据清单）标记为默认不列出；这不代表已发布安装已经包含此包。此层启用后，使用[用户指南](../../../docs/user/guide/harness2.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部原理 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 层插入 `optional-harness2` 与 `optional-tool-harness2`。第一项设置子会话提供方与部署预算；第二项暴露预览与保存工具。后续配置组合补丁可以替换某项配置或禁用它。启用工具项时必须保持服务可用。

组合包没有独立算法、模型提供方、存储后端或 UI 插件。其实现就是补丁文档；挂载的包负责运行时行为与生命周期。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

修改部署策略前先了解用户工作流。

- [用户指南](../../../docs/user/guide/harness2.zh.md) — 准备任务并评审预览。
- [引擎配置](../harness2/README.zh.md#use-this-package) — 子会话预算与保留。
- [实验包状态](../README.zh.md#status) — 支持与依赖隔离规则。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 [Harness² 服务](../harness2/README.zh.md)与[工具消费方](../tool-harness2/README.zh.md)产生影响；两者负责子会话消息、工具定义与父会话结果。

#### KV Cache 影响

组合包本身不添加请求文本。启用或移除其工具项会改变可见工具列表；挂载的包负责由此产生的缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅显式组合** — 随附默认配置不选择此层，它也不配置模型或存储。
- **显式运行时策略** — 启用组合包本身不授予候选代码执行权限；引擎配置与审批负责执行边界。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
