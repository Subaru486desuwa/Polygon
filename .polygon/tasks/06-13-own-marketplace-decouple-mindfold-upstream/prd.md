# 自建 marketplace，与上游 mindfold-ai 解耦

## 背景 / 问题

`polygon init` 拉取 spec 模板时硬编码指向上游原项目的 marketplace 仓：

- `packages/cli/src/utils/template-fetcher.ts:19` `TEMPLATE_INDEX_URL = .../mindfold-ai/marketplace/main/index.json`
- `packages/cli/src/utils/template-fetcher.ts:21` `TEMPLATE_REPO = "gh:mindfold-ai/marketplace"`
- `.gitmodules` 的 `marketplace` / `docs-site` submodule 也指向 `mindfold-ai/*`

fork 只做了表层 rebrand，模板源仍拴在上游。本任务把 marketplace 整体迁成自有内容。

## 决策（已与用户确认）

1. **形态**：独立仓 mirror 上游架构 —— 新建 `Subaru486desuwa/marketplace`，保留 submodule + 远端 raw 拉取。
2. **内容**：上游 9 个模板（3 spec / 3 skill / 3 workflow）**全部移植 + 去 Trellis 品牌**。
3. （已知约束）用户环境 raw.githubusercontent 受代理影响，指向自有 GitHub 仓仍走同一代理路；离线问题不在本任务范围内（用户接受）。

## 上游内容快照（/tmp/mp-upstream，经代理 7890 克隆成功）

- 160 文件；品牌串 ~900+ 处（134 Trellis / 774 trellis / 404 .trellis / 6 TRELLIS）
- index.json 9 条：electron/nextjs/cf-workers (spec)；trellis-meta/trellis-spec-bootstarp/frontend-fullchain-optimization (skill)；native/tdd/channel-driven-subagent-dispatch (workflow)
- `skills/mem-recall` 是目录但**未登记进 index.json**（孤儿）；随内容一并 rebrand 移植，保持不登记

## Rebrand 映射（沿用 commit 8c5ddb5d 同一套）

- `.trellis` → `.polygon`
- `TRELLIS` → `POLYGON`
- `Trellis` → `Polygon`
- `trellis` → `polygon`
- `bootstarp` → `bootstrap`（顺手修上游拼写，对齐仓内 `polygon-spec-bootstrap`）
- 目录重命名：`skills/trellis-meta` → `skills/polygon-meta`，`skills/trellis-spec-bootstarp` → `skills/polygon-spec-bootstrap`
- `mindfold-ai` org 引用：先统计，逐个判断（factual 链接不盲改）

## 执行步骤

**A. 本地准备（安全可逆）**
1. 复制 /tmp/mp-upstream（去 .git）→ marketplace/
2. 脚本化 sed rebrand 全量文件 + 两个 skill 目录重命名
3. 重写/校验 marketplace/index.json（ids/names/paths/descriptions/tags）
4. 校验 `grep -ri trellis marketplace/` 归零；人工过一遍 index.json
5. 改 CLI 常量 template-fetcher.ts:5/19/21 → Subaru486desuwa/marketplace
6. 改 .gitmodules marketplace URL → Subaru486desuwa/marketplace.git
7. build（tsc）+ 类型检查通过

**B. 对外动作（需用户确认后执行）**
8. `gh repo create Subaru486desuwa/marketplace`，推送 rebrand 后内容
9. 父仓 submodule gitlink 指向新仓新 SHA（git rm --cached + submodule add/update）
10. 端到端验证：`polygon init` 能从新仓拉到 index.json

## 范围边界

- 不动 `docs-site` submodule（用户只点了 marketplace；docs 另案）
- 不动离线/代理架构（用户接受走远端）
- 不改模板**实质内容**，只去品牌（外科手术式）

## 验收

- `grep -ri 'trellis\|mindfold-ai' marketplace/` 归零（或仅剩人工确认保留项）
- CLI 常量与 .gitmodules 指向 Subaru486desuwa/marketplace
- tsc build 干净
- 远端仓可被 init 拉取（B 段完成后）

## 完成记录（Phase A+B 全部完成）

- 远端仓：`github.com/Subaru486desuwa/marketplace`（public）已建并 push，main @ `7320976`，160 文件
- rebrand：0 trellis 残留（仅留示例 bundle ID `ai.mindfold.open-typeless`）；`trellis-meta`→`polygon-meta`，`trellis-spec-bootstarp`→`polygon-spec-bootstrap`
- CLI：`template-fetcher.ts` 常量 + `.gitmodules` marketplace URL → 自有仓；父仓 submodule 指针更新到新 SHA
- 验证：raw index.json HTTP 200；`fetchTemplateIndex()` 运行时返回 9 条 polygon 模板；tsc + build 干净
- 已知遗留（范围外）：CLI `INDEX_FETCH_MS=5s` + Node 内置 fetch 不读 HTTP(S)_PROXY → GFW 慢代理下 init 仍可能 fallback blank。属另案。
- 未并入本提交：会话最初那 6 个未决 io/workflow_phase「照抄」改动（待用户决定 keep/revert）。
