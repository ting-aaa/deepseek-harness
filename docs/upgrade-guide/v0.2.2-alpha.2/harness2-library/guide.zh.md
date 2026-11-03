---
kind: upgrade-guide
description: "Harness² 领域存储版本 4 可读取版本 2／3 经验库，并保留工作区交付物与结构化经验。"
---

# Harness² 经验库版本 4

[English](guide.md) | 中文

## 变更

原生 Harness² 服务写入 `harness2` 存储领域版本 4，可直接读取版本 2 和 3，打开时不重写数据。它保留已采纳修订、绑定、可选工作区补丁、报告用量和结构化经验。版本 1 文本预览存储会被拒绝。首次版本 4 写入后旧应用会拒绝该版本；只恢复旧应用不会降级数据。

自定义组合除现有引擎依赖外，还必须提供 `workingDirectory`、`sessionProjections`、`systemPrompt` 与 `skills`。基于 base 的内置配置已提供这些服务。显式设置 `runtime: null` 会禁用候选代码执行，包括通过 YAML 加载时。

默认启用工作区回放与文件编辑；需要实施限制的文件系统和 shell 服务，能力缺失时报告只读或 JSON 模式。可通过 `rollout: read-only` 和 `editor: json` 保留紧凑执行。默认逐子会话限制为 40 步、每请求 16384 输出 token、200000 报告总 token 和 900000 毫秒。运行指纹不同的旧检查点不能恢复。包含新不可忽略事件 `sandbox/workspace-root` 的 Session 需要支持它的读取器。

## 迁移

1. 升级前保留现有存储和可运行的旧应用副本。不要删除、改版本标签或编辑版本 1 记录来绕过版本检查。
2. 版本 2 和 3 经验库可直接打开。版本 2 当前经验仍可激活；从未保存的较早修订无法恢复。新采纳的预览会保留修订以供回滚。
3. 版本 1 经验库应继续配合原应用使用。如需独立评估当前服务，通过[存储提供方](../../../../packages/storage/storage-domain/README.zh.md)配置新位置；不要修改旧记录或版本标签。
4. 为自定义组合补齐必需服务。确认预览完成后，评审并保存。使用 `harness2_activate` 批准工作区绑定，使用 `harness2_status` 检查。新的顶层会话会获得指导，现有会话恢复时保留已记录的决定。`harness2_deactivate` 停止向后续会话提供指导。
