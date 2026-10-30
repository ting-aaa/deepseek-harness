---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-harness2-native-events

[English](2026-10-29-harness2-native-events.md) | 中文

## 概述

将内置 Harness² 审计记录提升为四种原生 Session 事件判别值：harness2/start、harness2/end、harness2/execution 和 harness2/remember-request。负载保持不变。harness2 存储域仍为版本 2，沿用原有键和表。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

当前读取方保留通用可忽略插件记录契约，因此历史 plugin:harness2/* 记录仍作为不透明的纯日志证据保留，不改写为原生事件，也不按原生事件回放。旧读取方不识别这四种不可忽略的原生判别值，会安全拒绝此类日志，而不会将其负载解释为已有事件。新读取方将原生事件识别为纯日志记录；这些记录不改变模型可见表面，也不证明经验已成功提交。既有判别值和持久化负载均不被重新解释，Session 写入版本 4 和已接受的定稿检查点保持不变。

<a id="verification"></a>
## 验证

Windows 上，提升后的源码通过 native-service-parity.spec.ts 的 10 个测试，覆盖原生审计事件、审批与采纳、SQLite 持久化；loader-composition.spec.ts 的 8 个生命周期、取消与卸载、审计和采纳测试通过。组合与退役、生成别名的规格测试共 9 个通过。生成的 known-event-types 表包含四种原生判别值，并已审查 Session 与持久化源码中既有的通用可忽略记录及未知事件拒绝契约。这些检查不宣称完整 Windows 录制回放比较已经通过。

<a id="dev-note"></a>
## 开发备注

无。
