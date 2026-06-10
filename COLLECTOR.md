# Requirement Collector — 自动需求采集器

跑**公开网络调研**，把竞品功能、用户痛点、行业趋势消化成结构化需求，去重后入池。
这是「采集 → 消化」环节；「实现」环节由自进化引擎的持续进化循环消费 backlog 完成。

## 已接入自进化引擎（运行时常驻，无需外部定时器）

采集逻辑已内建到 `main.js` 的 **`evolveAudit`（巡检）** 步骤：每次巡检在「读源码找问题」之外，
同时用 **WebSearch / WebFetch** 联网采集需求，统一注入运行时 backlog（`evolve-backlog.json`）。
开启界面上的 **「持续进化」** 后：清单空了自动巡检（含联网采集）补充 → 按 severity 优先（high→medium→low）
自动取一条改源码 → 检查点 + dry-run 校验 → 失败回滚、成功本地 commit（不 push）。本文件是采集的**范围与规则规格**，巡检提示词据此调研。

> 本 `REQUIREMENTS.md` 为人读视角的需求池种子；引擎运行时的操作性 backlog 是 `evolve-backlog.json`（在 userData 目录）。

## 采集范围（本 App 定位：类 Claude Code 的 AI 编码桌面工具）

每轮覆盖以下几类查询（用 WebSearch 扇出，命中后用 WebFetch 取正文细节）：

1. **竞品功能**：Cursor / Cline / Windsurf / Claude Code / Copilot / Zed 的新功能、最受欢迎功能。
2. **用户痛点**：AI 编码 agent 的 UX 抱怨、缺失功能、可靠性/成本问题。
3. **行业趋势**：AI 编码工具的方向性变化（如 AI 代码审查、agent teams、context 管理）。
4. **本 App 已有能力对照**：多对话并行、Source Control、PDF/MD/Mermaid 查看编辑、附件、自进化——
   只采集**本 App 尚未具备或可增强**的需求，已有的不重复入池。

## 每轮流程

1. **搜**：对上述每类各跑 1–2 条 WebSearch（带年份关键词，如 2026）。
2. **取**：对高价值结果用 WebFetch 拉正文，提炼具体需求点。
3. **消化**：把原始信息转成 `REQUIREMENTS.md` 的结构化条目（id / status / category / priority / acceptance / sources）。
4. **去重**：按 `id`（kebab slug）比对现有条目——
   - 已存在 → 仅补充 sources / 更新描述，**不新增**；
   - 已是 `done` / `rejected` → 跳过；
   - 全新 → 追加到对应优先级分区，status=`new`。
5. **定优先级**：痛点强度 × 与本 App 契合度 → P0/P1/P2/P3。优先「高频痛点 + 本 App 缺失」。
6. **记一行日志**：在本文件「采集日志」追加 `日期 | 新增 N 条 | 更新 M 条 | 跳过 K 条`。

## 护栏

- 只写 `REQUIREMENTS.md` 和本文件的日志，**不改 App 源码**（实现交给 Autopilot）。
- 不臆造需求：每条必须有真实来源 URL；无把握的不入池。
- 控制噪音：每轮新增上限建议 ≤ 5 条，宁缺毋滥。
- 来源仅限公开网页（WebSearch / WebFetch）；不抓登录页/私有数据。

## 接入 Autopilot

Autopilot 每轮迭代时，可在「找痛点」步骤优先查看 `REQUIREMENTS.md` 中 `priority` 最高、`status=new/accepted`
的条目作为实现目标；完成后把该条 `status` 改为 `done` 并移到「已处理归档」。

## 采集日志

- 2026-06-10 | 初始化种子：新增 8 条（P1×3 / P2×4 / P3×1）| 来源：竞品对比与痛点调研 2026
