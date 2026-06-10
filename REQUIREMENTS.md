# Requirements Backlog — 网络采集需求池

本文件由**自动需求采集器**维护（见 `COLLECTOR.md`）：定时跑公开网络调研（竞品功能、用户痛点、行业趋势），
消化成结构化需求条目，去重后追加到这里。Autopilot 自驱动回路（见 `AUTOPILOT.md`）从这里挑高优先级项实现。

## 字段约定

- **id**：去重 key，`req-<kebab-slug>`，同 slug 视为同一需求，只更新不重复追加。
- **status**：`new`（待评估）/ `accepted`（已采纳进实现队列）/ `done`（已实现）/ `rejected`（不做，附原因）。
- **priority**：`P0` 阻断 / `P1` 高 / `P2` 中 / `P3` 低。
- **acceptance**：可验证的验收标准（Autopilot 完成后据此自检）。
- **sources**：采集来源 URL。

---

## P1 — 高优先级

### req-integrated-terminal — 集成终端（应用内跑测试/构建）
- status: new
- category: 功能 / UX
- 痛点：类 Claude Code 工具最大痛点之一是「要切到外部终端才能验证 AI 输出是否真能跑」。应用内置终端可在会话旁直接 run test/build，消除上下文切换。
- acceptance：能在 App 内打开一个终端面板，执行任意 shell 命令并实时看到 stdout/stderr；与当前对话同屏；命令历史可回溯。
- sources:
  - https://www.mindstudio.ai/blog/claude-code-desktop-app-features
  - https://paddo.dev/blog/claude-code-21-pain-points-addressed/

### req-context-usage-indicator — 上下文用量可视化指示器
- status: new
- category: UX / 可观测性
- 痛点：会话变长后「context rot / context compounding」导致输出质量下降；可见的上下文占用指示器能让用户在劣化前主动干预（压缩/开新会话）。
- acceptance：每个对话顶部显示当前上下文占用（token 数 / 占窗口百分比），接近上限时变色提醒。
- sources:
  - https://www.mindstudio.ai/blog/claude-code-desktop-app-features

### req-token-cost-transparency — Token 用量与成本透明
- status: new
- category: 可观测性
- 痛点：成本是「最响亮的单一抱怨」——用户被账单吓到、却无法理解某次会话为何烧了那么多 token。
- acceptance：每个对话/每轮显示 input/output token 与估算成本；可查看「本次会话 token 去向」明细（按工具调用/消息拆分）。
- sources:
  - https://newsletter.pragmaticengineer.com/p/are-ai-agents-actually-slowing-us
  - https://www.faros.ai/blog/best-ai-coding-agents-2026

---

## P2 — 中优先级

### req-syntax-highlighting — 代码块语法高亮
- status: new
- category: UX
- 痛点：多款工具被吐槽「缺语法高亮」。本 App 已有 MD 渲染，需确认代码块按语言高亮。
- acceptance：聊天与文件预览中的代码块按语言高亮；常见语言（js/ts/py/json/bash 等）覆盖。
- sources:
  - https://www.morphllm.com/ai-coding-agent

### req-drag-drop-panes — 拖拽分栏布局
- status: new
- category: UX
- 痛点：Claude Code 桌面版重设计引入 drag-and-drop panes 广受好评。本 App 最近已实现文档预览 dock 到中间面板（commit 7acb0d6），可继续扩展为通用拖拽分栏。
- acceptance：面板（对话/预览/终端/文件树）可拖拽重排与并排，布局可持久化。
- sources:
  - https://devtoolpicks.com/blog/claude-code-desktop-redesign-parallel-sessions-2026

### req-runtime-failure-visibility — 运行期失败的清晰反馈
- status: new
- category: 健壮性 / UX
- 痛点：多款 agent「mid-run 失败时可见性有限、runtime 不透明」。
- acceptance：工具调用/命令失败时在 UI 明确展示错误（非静默吞掉）；可展开查看完整 stderr/堆栈。
- sources:
  - https://www.morphllm.com/ai-coding-agent

### req-agent-ask-when-uncertain — 缺信息时主动暂停提问
- status: new
- category: 交互质量
- 痛点：LLM 很少在缺信息时停下提问，而是强行假设/选错工具，导致 agent thrashing。
- acceptance：提供一种机制（提示词/配置）鼓励 agent 在关键信息缺失时暂停并提问，而非盲目继续。
- sources:
  - https://www.thegnar.com/blog/why-your-ai-coding-agent-keeps-making-bad-decisions-and-how-to-fix-it
  - https://www.morphllm.com/ai-coding-agent

---

## P3 — 低优先级 / 观察中

### req-ai-code-review — AI 生成代码的审查视图
- status: new
- category: 功能（趋势）
- 痛点：41% 代码已由 AI 生成，需审查的代码量激增，但现有工具大多不为「审查 AI 写的代码」设计。
- acceptance：提供 diff 审查视图，对 AI 本轮改动做结构化展示，便于人工 review 后再提交。
- sources:
  - https://www.nxcode.io/resources/news/best-ai-code-editor-2026-cursor-windsurf-copilot-zed-compared

---

## 已处理归档
（status 为 done / rejected 的条目移动到此处，保留 id 防止重复采集）
