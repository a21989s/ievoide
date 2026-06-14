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

### req-surgical-minimal-diff — 精确最小 diff 模式（agent 不超范围改动）
- status: new
- category: 交互质量 / 可信度
- 痛点：Windsurf/Cascade 被用户吐槽「sometimes makes more changes than requested, particularly on larger tasks」，偏好外科手术式修改的开发者高度不满。
- acceptance：提供可配置的「minimal-diff 模式」，agent 改动严格限制在明确要求范围内；每轮结束后展示 diff 摘要，用户确认前不自动提交。
- sources:
  - https://blink.new/blog/windsurf-review-2026
  - https://www.morphllm.com/comparisons/cursor-alternatives

### req-session-context-persistence — 会话上下文跨重启持久化
- status: new
- category: UX / 生产力
- 痛点：开发者在持续重构任务中反复遭遇「context reset」——重启或切会话后须从头解释背景，严重打断心流。Windsurf Cascade 的卖点之一就是「can look back through recent changes and continue from that context without you re-explaining」。
- acceptance：会话重启/resume 后自动附加编辑历史摘要，无需用户手动重述任务背景。
- sources:
  - https://blink.new/blog/windsurf-review-2026
  - https://lushbinary.com/blog/ai-coding-agents-comparison-cursor-windsurf-claude-copilot-kiro-2026/

### req-spec-driven-development — 结构化规格驱动开发（Spec-first）
- status: new
- category: 功能（差异化）
- 痛点：2026 年只有 Kiro 提供「first-class spec-driven development with event-driven hooks」，其他工具全靠自由对话，大型任务缺乏结构化规格跟踪。对文档维护型工作流尤其有价值。
- acceptance：支持将任务描述保存为结构化 Spec 文件（标题/目标/验收标准/状态字段）；agent 执行时参照 spec，完成后自动更新状态字段；可与现有 REQUIREMENTS.md 格式对齐。
- sources:
  - https://lushbinary.com/blog/ai-coding-agents-comparison-cursor-windsurf-claude-copilot-kiro-2026/

### req-predictive-budget-alert — 任务执行前 token 预算预警
- status: new
- category: 可观测性 / 成本控制
- 痛点：Cursor/Copilot 用户普遍反映「bill shock」——agent 重度任务跑完才发现超支，而工具没有事前预警。用户需要「budget alerts before agent-heavy work surprises you」。
- acceptance：长任务（多轮工具调用）启动前，给出 token 用量估算及成本区间提示；超过用户设定阈值时需确认才继续。
- sources:
  - https://lushbinary.com/blog/ai-coding-agents-comparison-cursor-windsurf-claude-copilot-kiro-2026/
  - https://www.faros.ai/blog/best-ai-coding-agents-2026

### req-multi-session-agent-view — 多会话并发管理视图
- status: new
- category: 功能 / 生产力
- 痛点：Claude Code 六月更新新增「agent view」可管理多个并发 session，Cursor 支持最多 8 个并行 agent——孤立的单会话 UI 在并发场景下效率极低。
- acceptance：UI 支持同时展示多个进行中会话的状态摘要；可在不中断任意会话的情况下切换焦点；后台任务状态可见（running / waiting / done）。
- sources:
  - https://help.apiyi.com/en/claude-code-changelog-2026-april-updates-en.html
  - https://lushbinary.com/blog/ai-coding-agents-comparison-cursor-windsurf-claude-copilot-kiro-2026/

### req-repo-wide-context-indexing — 仓库级代码库索引与理解
- status: new
- category: 功能 / 代码质量
- 痛点：「context engineering」成为 2026 年 AI 编码工具最重要的差异化点——工具必须能「index repositories, track dependencies, and maintain multi-step reasoning」跨多文件。仅基于当前打开文件的工具质量明显落后。
- acceptance：支持对本地项目文件夹建立向量/符号索引；提问时自动检索相关文件片段注入上下文，而非依赖用户手动 attach 文件。
- sources:
  - https://www.faros.ai/blog/best-ai-coding-agents-2026

### req-privacy-local-model-option — 隐私模式 / 本地模型支持
- status: new
- category: 安全 / 企业需求
- 痛点：Cursor 被批评「code is sent to third-party APIs, no local model support, no guaranteed data isolation」，对有敏感代码库的团队构成门槛。
- acceptance：提供「不上传代码」的隐私模式（仅发送用户消息，不发送文件内容）；或支持配置本地/私有部署的 API endpoint（如 Ollama / 自托管 Anthropic proxy）。
- sources:
  - https://www.morphllm.com/comparisons/cursor-alternatives
  - https://www.faros.ai/blog/best-ai-coding-agents-2026

---

## 已处理归档
（status 为 done / rejected 的条目移动到此处，保留 id 防止重复采集）
