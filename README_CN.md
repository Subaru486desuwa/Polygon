<h1 align="center">Polygon</h1>

<p align="center">
<strong><a href="https://github.com/mindfoldhq/trellis">Trellis</a> 的轻量化 fork —— 为 AI 编程持久化 spec、任务与多 LLM 活动日志，去掉一切繁文缛节。</strong>
</p>

<p align="center">
<a href="./README.md">English</a> •
<a href="https://docs.trytrellis.app/">上游文档</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@subaru486/polygon"><img src="https://img.shields.io/npm/v/@subaru486/polygon.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://github.com/Subaru486desuwa/Polygon/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfoldhq/trellis"><img src="https://img.shields.io/badge/fork%20of-mindfoldhq%2Ftrellis-6b7280.svg?style=flat-square" alt="fork of trellis" /></a>
</p>

---

AI 编程代理每个会话都从零开始 —— 不记得你的项目、约定、上个会话的决定。Trellis 用持久化到仓库的 spec / 任务 / journal 解决了这个问题；Polygon 保留这个内核，删掉所有挡在你和工作之间的东西：

- **Inline 优先。** 主代理直接改代码。没有强制 sub-agent 派发、没有 override 短语白名单、没有反合理化对照表。工作流规则是建议性的，由代理（和你）判断这一轮真正需要什么。
- **轻量上下文注入。** SessionStart 注入从 27 KB 砍到约 2 KB；每轮面包屑按任务状态只有 2–4 行。长期日常使用几乎不占上下文。
- **多 LLM 活动日志。** 每个任务带一份 `activity.jsonl`，记录哪个平台/模型在何时做了什么 —— Claude Code 和 Codex 可以在任务中途互相交接，来源可溯。

## 安装

```bash
npm install -g @subaru486/polygon
```

安装后 `polygon` 命令。

## 快速开始

```bash
cd your-project
polygon init -y        # 默认部署精简版 claude+codex 配置
```

之后直接在 AI 编程代理里用自然语言描述需求即可。注入的面包屑会让代理自行判断这一轮的真实规模：

- 多轮实现类工作 → 自动建任务、和你 brainstorm 出 PRD、再实现
- 提问和小修小补 → 直接做，没有任务仪式

工作流三阶段：

| 阶段 | 做什么 | 持久化到 |
|---|---|---|
| Plan | brainstorm + 调研 → PRD | `.polygon/tasks/<task>/prd.md` |
| Execute | 主会话内实现；lint / 类型检查 / 测试 | 你的代码 + `activity.jsonl` |
| Finish | 沉淀经验 → commit → 归档 | `.polygon/spec/`、journal、任务归档 |

## 多 LLM 活动日志

```bash
python3 .polygon/scripts/task.py activity-log
# 2026-06-10T04:40:40Z  [claude/-]               start: task started
# 2026-06-10T04:40:51Z  [claude/claude-fable-5]  implement: archive smoke via updated workflow
# 2026-06-10T04:41:02Z  [claude/-]               finish: task archived
```

`task.py start` / `task.py archive` 自动打戳；`task.py activity-append` 记录手动条目（决策、交接）。`task.json` 把参与者汇总进 `meta.agents[]`，journal 会话记录 `**Agent**:` 行 —— 任务中途在 Claude Code 和 Codex 之间切换，不丢"谁做了什么"。

## 与上游 Trellis 的差异

| | 上游 Trellis | Polygon |
|---|---|---|
| 派发模型 | implement/check 强制 sub-agent | 默认 inline，sub-agent 可选 |
| 工作流规则 | 强制执行（override 短语、jsonl 门禁） | 建议性 |
| SessionStart 注入 | ~27 KB | ~2 KB |
| 每轮面包屑 | 完整状态块 | 2–4 行 |
| 部署的 workflow.md | 按平台多变体 | 一份约 290 行无平台标签通用版 |
| 活动日志 | — | 每任务 `activity.jsonl`，多 LLM |
| 默认平台 | 交互式选择 | claude + codex（`-y`） |

多平台资产（Cursor、Gemini CLI、Copilot 等）在 npm 包内保留 —— 其他平台 flag 仍可用，拿到的是通用精简内容。

## 致谢与许可

Polygon fork 自 Trellis 团队的 [mindfoldhq/trellis](https://github.com/mindfoldhq/trellis) —— 任务/spec/journal 架构、多平台支持与更新机制都是上游的工作。核心概念仍可参考[上游文档](https://docs.trytrellis.app/)；行为有差异处，以本 README 为准。

许可证与上游一致：[AGPL-3.0](./LICENSE)。
