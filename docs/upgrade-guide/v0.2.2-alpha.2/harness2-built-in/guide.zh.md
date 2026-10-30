---
kind: upgrade-guide
description: "Harness² 优化内置到完整 DSH 配置组合时，包名称与审计事件随之调整。"
---

# Harness² 成为内置能力

[English](guide.md) | 中文

## 变更

基于 base 的完整 Desktop、Web、headless、SDK 与 ACP 配置组合内置 Harness²。Web 的 `standard`、`cordis` 与 `ptc` 预设向模型提供这些工具；Web 的 `minimal` 预设和 `sdk-minimal` 配置组合保留较小的工具目录。父 Agent 可为复杂或不确定任务选择有界预览；保存仍需单独批准。

引擎现名为 `@deepseek-ai/dsh-harness2`，工具消费方现名为 `@deepseek-ai/dsh-tool-harness2`。旧 `@deepseek-ai/dsh-experimental-harness2-bundle` 已退役，并从已保存的组合包列表中移除。原有 `optional-harness2` 和 `optional-tool-harness2` 配置项标识保持可用，以保留已保存配置。

生成代码执行在 Windows、macOS 和 Linux 上默认使用内置 WASI 后端，每次执行均需审批。`runtime: null` 仍会禁用执行，且继续支持显式的旧 Linux 运行时配置。

新审计事件使用 `harness2/start`、`harness2/end`、`harness2/execution` 和 `harness2/remember-request`，替代对应的 `plugin:harness2/*` 记录。历史 ignorable 记录仍保留在已有 Session 日志中。`harness2` 存储领域及其版本 2、表、键与已接受经验保持原位。

## 迁移

1. 升级 DSH，重新打开 Desktop 或重启 CLI 配置组合。完整配置组合无需 addon 安装助手或替代组合包。
2. 在自定义 Cordis 配置项、包清单与 TypeScript 导入中，将 `@deepseek-ai/dsh-experimental-harness2` 替换为 `@deepseek-ai/dsh-harness2`，将 `@deepseek-ai/dsh-experimental-tool-harness2` 替换为 `@deepseek-ai/dsh-tool-harness2`。保留原有预算设置与配置项标识。自定义预设必须在 `tools` 与 `harness2` 可用处挂载工具消费方。只有需要可移植执行时，才将显式 `runtime: null` 改为 `runtime: {backend: wasi}`。
3. 若外部 Session 读取器筛选 Harness² 审计记录，应接受新的 `harness2/*` 事件，并继续支持历史 `plugin:harness2/*` 记录。不要改写 Session 日志或移动领域经验库。
4. 在完整配置组合中请求预览，确认 `harness2` 与 `harness2_remember` 可用。已有接受经验仍关联相同的模式与领域。预览和审批流程见[用户指南](../../../user/guide/harness2.zh.md)。
