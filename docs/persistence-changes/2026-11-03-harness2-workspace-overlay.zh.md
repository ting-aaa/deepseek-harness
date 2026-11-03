---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-03-harness2-workspace-overlay

[English](2026-11-03-harness2-workspace-overlay.md) | 中文

## 概述

增加会话固定的 Harness² 工作区叠加决定。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新事件 harness2/overlay 记录未激活决定，或工作区、领域、递归模式、已接受修订与候选哈希。当前读取器保留已有事件，通过宿主投影恢复决定。旧读取器会安全拒绝未知的非可忽略事件。不修改已发布的 Session 历史代。

<a id="verification"></a>
## 验证

叠加集成测试覆盖审批、采纳、绑定、回滚、停用、激活与未激活决定的持久化恢复，以及已记录候选变更后的拒绝。在 Windows 上，叠加专项测试 6 项通过。

<a id="dev-note"></a>
## 开发备注

无。
