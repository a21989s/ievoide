// 进化提示词的单一来源（闭源，仅部署在云端）。
// 此前 main.js / server.mjs 各持一份 EVOLVE_APPEND 且已漂移；上云后客户端不再内置，
// 由 /api/evolve/next 按客户端形态(client)与版本(version)下发对应变体。
// 在这里迭代提示词即可让所有客户端下一次进化立即生效，无需客户端发版。

const GOAL =
  "本产品定位是面向开发与日常文档维护的工具集，进化的总目标是让它更【易用、易组装搭配、简洁】，" +
  "并且【让程序员的工作越方便越好、越省钱越好】（省钱=减少不必要的 token/API 消耗、避免冗余请求与重复计算），" +
  "请让每次改动都朝这个方向推进。";

const GUARD =
  "务必：① 改完保证应用能正常启动与加载、不破坏现有功能；② 只改必要文件、与周围代码风格一致；" +
  "③ 不要运行 npm start 或重启应用（宿主会自动重载/重启并自检）。最后用简体中文一句话说明你改了什么。";

// 客户端形态 → 源码结构说明。开源版结构变了就在这里加新条目（或按 version 细分）。
const STRUCT = {
  desktop:
    "你正在改进你自己所在的 Electron 桌面应用「自进化 dev Tool」，源码就在当前工作目录。" +
    "结构：main.js=Electron 主进程(所有 IPC/git/SDK 调用)；preload.cjs=contextBridge 暴露 window.api；" +
    "renderer/index.html+renderer.js=界面与逻辑；renderer/pdfeditor.js=PDF 编辑器。",
  server:
    "你正在改进你自己所在的「自进化 dev Tool」，源码就在当前工作目录。" +
    "结构：main.js=Electron 主进程(所有 IPC/git/SDK 调用)；server.mjs=手机/远程端服务器(SSE 流式)；" +
    "preload.cjs=contextBridge 暴露 window.api；renderer/index.html+renderer.js=桌面界面；" +
    "renderer/mobile.html=手机界面；renderer/pdfeditor.js=PDF 编辑器。",
};

// 按客户端形态/版本返回进化系统提示词追加段。version 预留：结构大改时按版本分叉。
export function evolveAppendFor({ client, version } = {}) {
  const struct = STRUCT[client] || STRUCT.desktop;
  return `${struct}${GOAL}${GUARD}`;
}

// 巡检提示词（原 main.js evolveAudit 内联版）：双渠道采集规则 + severity 判定 + JSON 输出契约。
// recent/open 由客户端上报（标题数组），在服务端注入做去重约束。
export function auditPromptFor({ recent = [], open = [] } = {}) {
  const recentLines = recent.filter(Boolean).map((t) => "- " + t).join("\n");
  const openLines = open.filter(Boolean).map((t) => "- " + t).join("\n");
  return (
    "为这款 Electron 桌面应用「自进化 dev Tool」找出 3-6 个具体、可独立完成的改进点，写成给进化器执行的需求。改进点须来自以下两个渠道，请都覆盖：\n" +
    "【渠道一·源码巡检】用 Read/Grep 审视源码（main.js / preload.cjs / renderer/*），找 bug、隐患、体验或性能问题。\n" +
    "【渠道二·联网需求采集】用 WebSearch（必要时用 WebFetch 取正文）调研同类 AI 编码桌面工具（Cursor / Cline / Windsurf / Claude Code / Copilot 等）的新功能、最受欢迎功能、用户痛点与行业趋势（查询带 2026 等年份关键词）。只提炼【本 App 尚未具备或可增强】且契合本产品定位的需求；联网项的 requirement 末尾附上来源 URL。\n" +
    "本产品定位是面向开发与日常文档维护的工具集，自进化的总目标是让它更【易用、易组装搭配、简洁】，核心准则是【让程序员的工作越方便越好、越省钱越好】。优先考虑能提升以下方面的改进：" +
    "① 易用性（上手简单、交互直观、减少操作步骤、降低认知负担）；" +
    "② 易组装与搭配（功能模块化、可灵活组合、便于与其他工具/工作流衔接）；" +
    "③ 简洁（界面与代码精简、去除冗余、降低复杂度）；" +
    "④ 作为开发工具与文档维护工具的实用性与完整度；" +
    "⑤ 省钱（减少不必要的 token/API 消耗、精简提示词与上下文、避免冗余请求与重复计算）。" +
    "只用 Read/Grep/WebSearch/WebFetch 调研，**不要修改任何文件**。" +
    "severity 按【痛点强度 × 与本 App 契合度】判定：high=高频痛点且本 App 明显缺失，low=锦上添花。" +
    (recentLines ? `\n\n最近已做过的进化（不要重复提）：\n${recentLines}` : "") +
    (openLines ? `\n\n优化清单里已有的项（不要重复提）：\n${openLines}` : "") +
    '\n\n最后只输出一个 JSON 数组（不要任何额外文字/解释/代码块标记），每项形如 {"title":"简短标题","requirement":"给进化器执行的一句话需求（联网项末尾附来源 URL）","severity":"high|medium|low"}。'
  );
}
