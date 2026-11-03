---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-03-harness2-workspace-rollouts

[English](2026-11-03-harness2-workspace-rollouts.md) | 中文

## 概述

新增不可忽略的 sandbox/workspace-root Session 事件，将托管编码执行固定到私有可写副本。Harness² 领域版本 4 预览保存可选工作区补丁、编辑模式、报告 token 用量与结构化经验。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

保持 Session 格式 V4：旧读取器在执行写入根目录语义改变的 Session 之前，拒绝未知且不可忽略的事件类型。当前读取器通过私有投影恢复根目录。领域版本 4 可读取版本 2 和 3，打开时不写入；首次版本 4 写入后旧领域读取器拒绝该版本。

<a id="verification"></a>
## 验证

验证日志根目录解析、回放和无效路径拒绝；原生 Windows 文件系统与 PowerShell 执行；经批准补丁应用；文件编辑器证据保护；Harness² 定向测试；已记录 headless 回放；SDK 配置组合训练／采纳／激活／留出脚本冒烟。脚本模型验证集成，不代表真实模型质量提升。

<a id="dev-note"></a>
## 开发备注

无。
