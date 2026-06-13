import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import net from "node:net";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brainEvolveAppend, brainAuditPrompt } from "./brain-client.mjs";

const execFileAsync = promisify(execFile);

/**
 * 读取 App 目录下可选的 mcp.json（App 级 MCP 配置，不影响全局 ~/.claude）。
 * 格式同 Claude Code 的 .mcp.json：{ "mcpServers": { name: {command,args,env} } }
 */
function mcpFilePath() {
  return path.join(__dirname, "mcp.json");
}
// 解析 mcp.json：返回 { servers, raw, error }（servers 含所有项，含被停用的）。供面板列出/编辑。
async function loadMcpFile() {
  let raw = "";
  try {
    raw = await fs.readFile(mcpFilePath(), "utf8");
  } catch {
    return { servers: {}, raw: "", error: null }; // 文件不存在 => 空（正常情况，静默）
  }
  try {
    const json = JSON.parse(raw);
    const servers = json.mcpServers || json || {};
    return { servers: servers && typeof servers === "object" ? servers : {}, raw, error: null };
  } catch (e) {
    return { servers: {}, raw, error: e.message };
  }
}
// 传给 SDK 的实际配置：过滤掉标记了 disabled:true 的 server（面板里「停用」的）。
async function readMcpConfig() {
  const { servers, error } = await loadMcpFile();
  if (error) {
    // 文件存在但 JSON 解析失败：明确报错，避免用户以为「配了却不生效」
    const msg = `mcp.json 解析失败，本次未加载任何 MCP：${error}`;
    console.error(msg);
    pushIssue("main", msg);
    return null;
  }
  const enabled = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg && cfg.disabled) continue;
    enabled[name] = cfg;
  }
  return Object.keys(enabled).length ? enabled : null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = __dirname; // App 自身的源码目录（自进化时当 cwd）

// 便携模式：所有运行时数据（对话历史/附件/设置/localStorage/scratch/标记）都放进 tools/data，
// 这样整个 tools 文件夹 copy 到另一台机器即可直接用，无需迁移配置。必须在 app ready 前调用。
app.setPath("userData", path.join(TOOLS_DIR, "data"));

// 配置（含系统提示词等）放在 tools/config.json，可直接编辑；缺失则写入默认
const DEFAULT_CONFIG = {
  // 输出 token 单价最贵（约为输入的 5 倍），简洁要求直接省真金白银
  systemPromptAppend:
    "始终用简体中文回答，除非用户明确要求使用其他语言。代码、命令、标识符等保持原样。" +
    "回答务必简洁：先给结论和必要的代码/命令，不复述问题、不做未被要求的展开，长解释仅在被要求时给出。",
  permissionMode: "bypassPermissions",
  // 省 token 旋钮（均可在 tools/config.json 编辑）：
  //  model: 留空走订阅默认（多为 Opus）。日常用 "claude-sonnet-4-6" 可显著降低用量。
  //  fallbackModel: 主模型过载时自动降级到的更省模型。
  //  effort: 思考/输出深度 "low"|"medium"|"high"|"xhigh"|"max"，不设=high。
  //          日常问答用 "medium" 或 "low" 可明显省 token；难题再调高。
  //  maxThinkingTokens: 已废弃（SDK deprecated），仅旧配置兼容；请改用 effort。
  //  allowedTools / disallowedTools: 工具白/黑名单，裁掉用不到的工具可减少每轮请求体。
  model: null,
  // 主模型过载时自动降级到的更省模型。null=不降级。
  fallbackModel: null,
  // 思考/输出深度 "low"|"medium"|"high"|"xhigh"|"max"。null=用 SDK 默认。
  effort: null,
  // 思考预算上限（token）。null=用模型默认；设小（如 4096）可显著降低输出 token 消耗，
  // 对话/进化/巡检/手机端统一生效
  maxThinkingTokens: null,
  // 工具白/黑名单，裁掉用不到的工具可减少每轮请求体。null=不限制。
  allowedTools: null,
  disallowedTools: null,
  // 进化/巡检专用模型。null=跟随 model。持续进化是个无人值守的循环、token 大户，
  // 配个便宜模型（如 claude-sonnet-4-6）可大幅降低消耗，对话仍用主力模型
  evolveModel: null,
  // 计划模式专用模型。null=跟随 model（默认不改变现有行为）。plan 轮被 SDK 强制只读，
  // 用户可自主降档（如 haiku）省钱；「✅ 按计划执行」的执行轮仍用主力模型，绝不自动降级
  planModel: null,
  // 每日费用预算（美元）。null=关闭。当日 chat+evolve 累计费用首次超过阈值时
  // 推送一次 budget:exceeded：toast+系统通知、用量标红、自动暂停持续进化（纯本地判断零额外 token）
  dailyBudgetUsd: null,
  // 每日硬性消费上限（美元）。null/0=不限。每次 send() 前检查当日累计费用，
  // 超限则直接拦截（不发 API 请求）并在对话框弹警告。
  maxDailySpendUSD: null,
  // 单次进化最大输出 token 上限。null=不限。防止复杂多文件重构一次烧光日预算。
  evolveMaxTokens: null,
  // 进化改完后是否立即重启/重载来生效。默认 false：不打断进化循环——主进程改动
  // 下次重启时由 bootGuard 自检/回滚，渲染层改动下次重载生效。设 true 恢复"改完即重启/重载"。
  evolveAutoRestart: false,
  // 进化大脑服务（open-core 拆分）：进化/巡检提示词由云端下发，本地不内置。
  // brainKey 留空时若本机带 cloud/（闭源开发仓）会自动用其 dev key；提示词获取成功后有本地缓存兜底。
  brainUrl: "http://localhost:8788",
  brainKey: null,
};
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
// 把可选的省 token 配置拼进 SDK options（仅在配置了有效值时才下发）
function tokenOpts(c) {
  const o = {};
  if (c.fallbackModel) o.fallbackModel = c.fallbackModel;
  if (EFFORT_LEVELS.includes(c.effort)) o.effort = c.effort;
  else if (Number.isFinite(c.maxThinkingTokens)) o.maxThinkingTokens = c.maxThinkingTokens; // 旧配置兼容
  if (Array.isArray(c.allowedTools) && c.allowedTools.length) o.allowedTools = c.allowedTools;
  if (Array.isArray(c.disallowedTools) && c.disallowedTools.length) o.disallowedTools = c.disallowedTools;
  return o;
}
let configLoadError = null;
function loadConfig() {
  const file = path.join(TOOLS_DIR, "config.json");
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fsSync.readFileSync(file, "utf8")) };
  } catch (err) {
    crashLog("loadConfig", err.message);
    configLoadError = err.message;
    try {
      fsSync.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2));
    } catch {}
    return { ...DEFAULT_CONFIG };
  }
}
const appConfig = loadConfig();

let win;
/** 当前打开的工作目录（folder），传给 SDK 当 cwd */
let workdir = null;
/** 最近一次 chat:init 报告的 MCP 连接状态（[{name,status}]），供 MCP 面板显示可用/失败 */
let lastMcpStatus = [];

// ── 自进化：运行时问题收集 ────────────────────────────────────
const issues = []; // {time, source, message}
function pushIssue(source, message) {
  if (!message) return;
  issues.unshift({ time: Date.now(), source, message: String(message).slice(0, 4000) });
  if (issues.length > 100) issues.pop();
  if (win && !win.isDestroyed()) win.webContents.send("issues:update", issues.length);
}
// ── 崩溃/退出落盘日志：随机退出难复现，把退出原因同步写到 data/crash.log，挂掉后可回看 ──
const crashLogPath = () => path.join(TOOLS_DIR, "data", "crash.log");
function crashLog(source, message) {
  try {
    const line = `[${new Date().toISOString()}] ${source}: ${String(message ?? "").slice(0, 8000)}\n`;
    fsSync.mkdirSync(path.dirname(crashLogPath()), { recursive: true });
    fsSync.appendFileSync(crashLogPath(), line); // 同步写，确保进程退出前已落盘
  } catch {}
}
ipcMain.handle("getCrashLog", () => { try { return fsSync.readFileSync(crashLogPath(), "utf8"); } catch { return ""; } });

process.on("uncaughtException", (e) => { crashLog("uncaughtException", e?.stack || String(e)); pushIssue("main", e?.stack || String(e)); });
process.on("unhandledRejection", (e) => { crashLog("unhandledRejection", e?.stack || String(e)); pushIssue("main", e?.stack || String(e)); });
// Node 进程级退出信号（被系统/父进程杀掉时也尽量留痕）
process.on("exit", (code) => crashLog("process.exit", `code=${code}`));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  try { process.on(sig, () => { crashLog("signal", sig); process.exit(0); }); } catch {}
}

// ── 自进化：启动回滚守卫（上次进化重启若未确认健康 => 回滚）──────────
const markerPath = () => path.join(app.getPath("userData"), "evolve-marker.json");

// ── 自进化历史：每次进化的需求/摘要/改动/结果，持久化以供参考 ──────
const evolveHistoryPath = () => path.join(app.getPath("userData"), "evolve-history.json");
function readEvolveHistory() {
  try { return JSON.parse(fsSync.readFileSync(evolveHistoryPath(), "utf8")); } catch { return []; }
}
function writeEvolveHistory(list) {
  try { fsSync.writeFileSync(evolveHistoryPath(), JSON.stringify(list.slice(0, 50), null, 2)); } catch {}
}
function recordEvolve(entry) {
  const list = readEvolveHistory();
  list.unshift({ time: new Date().toISOString(), ...entry });
  writeEvolveHistory(list);
}
// 更新最近一条记录（启动回滚 / 自检超时 / 健康确认时回填状态）
function markLastEvolve(patch) {
  const list = readEvolveHistory();
  if (list[0]) { Object.assign(list[0], patch); writeEvolveHistory(list); }
}

// ── 自进化优化清单：系统自己巡检源码、给自己提出的待办需求 ─────────
const evolveBacklogPath = () => path.join(app.getPath("userData"), "evolve-backlog.json");
function readBacklog() {
  try { return JSON.parse(fsSync.readFileSync(evolveBacklogPath(), "utf8")); } catch { return []; }
}
function writeBacklog(list) {
  try { fsSync.writeFileSync(evolveBacklogPath(), JSON.stringify(list.slice(0, 100), null, 2)); } catch {}
}
// 追加巡检结果（按标题去重，已存在/已完成的不重复加），返回新增条数
function addBacklog(items) {
  const list = readBacklog();
  const have = new Set(list.map((x) => (x.title || "").trim().toLowerCase()));
  let seq = list.reduce((m, x) => Math.max(m, x.id || 0), 0);
  let added = 0;
  for (const it of items || []) {
    const requirement = String((it && (it.requirement || it.title)) || "").trim();
    let title = String((it && it.title) || requirement).trim().slice(0, 80);
    if (!requirement || have.has(title.toLowerCase())) continue;
    have.add(title.toLowerCase());
    const sev = String((it && it.severity) || "medium").toLowerCase();
    list.push({ id: ++seq, title, requirement, severity: ["high", "medium", "low"].includes(sev) ? sev : "medium", status: "open" });
    added++;
  }
  writeBacklog(list);
  return added;
}
function updateBacklog(id, patch) {
  const list = readBacklog();
  const e = list.find((x) => x.id === id);
  if (e) { Object.assign(e, patch); writeBacklog(list); }
}

let evolveRolledBack = null;
function bootGuard() {
  try {
    const m = JSON.parse(fsSync.readFileSync(markerPath(), "utf8"));
    if (m.status === "booting") {
      // 上次进化重启后没等到健康心跳（很可能崩了）=> 回滚到检查点
      execFileSync("git", ["reset", "--hard", m.sha], { cwd: TOOLS_DIR });
      execFileSync("git", ["clean", "-fd"], { cwd: TOOLS_DIR });
      fsSync.unlinkSync(markerPath());
      markLastEvolve({ status: "rolledback", reason: "重启后启动异常" });
      evolveRolledBack = m;
    } else if (m.status === "pending") {
      // 进化重启后的首次启动：标记 booting，等渲染层心跳确认
      fsSync.writeFileSync(markerPath(), JSON.stringify({ ...m, status: "booting" }));
    }
  } catch {
    /* 无标记 => 正常启动 */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    title: "自进化 dev Tool",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      plugins: true, // 启用 Chromium 内置 PDF 阅读器（iframe 加载本地 PDF）
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // 拦截外链导航：marked 渲染出的 <a> 或 window.open 若指向 http(s)，会把本窗口导航走、
  // 丢失整个应用界面。统一用系统浏览器打开，本窗口只允许停留在自身 file:// 页面。
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // 渲染进程崩溃/被杀（最常见的"窗口突然消失→应用退出"原因）
  win.webContents.on("render-process-gone", (_e, details) => {
    crashLog("render-process-gone", `reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on("unresponsive", () => crashLog("renderer", "unresponsive"));
  win.on("closed", () => crashLog("window", "closed"));

  // 把渲染进程的 console / 报错转发到主进程日志，便于排错。
  // Electron 37+ 改用 details 对象（level 为字符串）；旧的位置参数已废弃，且数值刻度
  // 变了（0-3=verbose/info/warning/error），按旧映射会把 error 标成 LOG。
  win.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    const tag = { error: "ERR", warning: "WARN", debug: "DBG", info: "LOG" }[level] || "LOG";
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${lineNumber})`);
    if (level === "error") pushIssue("renderer", `${message} (${sourceId}:${lineNumber})`);
  });
  // 进化重启后，渲染层加载完会发心跳；告知它本次启动状态
  win.webContents.on("did-finish-load", () => {
    if (evolveRolledBack) {
      win.webContents.send("evolve:rolledback", evolveRolledBack);
      evolveRolledBack = null;
    }
    if (configLoadError) {
      win.webContents.send("toast", "配置文件已损坏并重置为默认值，原因：" + configLoadError);
      configLoadError = null;
    }
  });
}

app.whenReady().then(() => {
  // 一次性迁移：把旧版存在系统 userData 的对话历史搬进 tools/data（便携化）
  try {
    const oldConv = path.join(app.getPath("appData"), "tools", "claude-tools-conversations.json");
    const newConv = path.join(TOOLS_DIR, "data", "claude-tools-conversations.json");
    if (!fsSync.existsSync(newConv) && fsSync.existsSync(oldConv)) {
      fsSync.mkdirSync(path.dirname(newConv), { recursive: true });
      fsSync.copyFileSync(oldConv, newConv);
    }
  } catch {}
  bootGuard();
  ensureBrain(); // 自启进化大脑（仅闭源开发机；失败不阻塞 UI，进化时再报）
  createWindow();
  watchConvFile();
});
// 子进程（claude CLI / mobile server 等）异常退出也记一笔
app.on("child-process-gone", (_e, details) => {
  crashLog("child-process-gone", `type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name || ""}`);
});
app.on("will-quit", () => crashLog("app", "will-quit"));
app.on("quit", (_e, code) => crashLog("app", `quit code=${code}`));
app.on("window-all-closed", () => {
  crashLog("app", "window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── 选择文件夹 ─────────────────────────────────────────────
ipcMain.handle("pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  workdir = r.filePaths[0];
  fileCache = { dir: null, list: null, time: 0 }; // 切换目录失效文件缓存
  saveConfig({ workdir });
  return workdir;
});

// ── 选择文件（自进化对话框的图片/文档附件）──
ipcMain.handle("pickFiles", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "图片/文档", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "txt", "md", "csv", "json", "log", "docx", "xlsx"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (r.canceled) return [];
  return r.filePaths || [];
});

// ── 用系统默认浏览器打开外部链接（需求里的 Jira/Confluence 链接）──
ipcMain.handle("openExternal", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url);
});

// ── 用系统默认程序打开本地文件（Word/Excel 等无法内联预览时的兜底）──
ipcMain.handle("openPath", async (_e, p) => {
  if (typeof p !== "string" || !p) return { ok: false, error: "无效路径" };
  const err = await shell.openPath(p);
  return { ok: !err, error: err || "" };
});

// ── 手机/远程端：在 App 内启动 server.mjs（同一 Wi-Fi 用手机浏览器遥控）──
let mobileProc = null;
const MOBILE_PORT = Number(process.env.PORT) || 8787;
// 公网访问地址（Cloudflare Tunnel，见 REMOTE-ACCESS.md），二维码默认用它
const PUBLIC_URL = (process.env.CT_PUBLIC_URL || "https://dev.feioz.com").replace(/\/+$/, "");
// 引擎可能由计划任务 ClaudeEngine 常驻运行（不归 mobileProc 管），以端口是否监听为准
function portListening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(800, () => done(false));
  });
}
function lanIP() {
  // 只认常见局域网网段（手机同一 Wi-Fi 才连得上），并过滤 VPN/虚拟网卡
  const isPrivate = (a) =>
    a.startsWith("192.168.") ||
    a.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  const isVirtual = (name) =>
    /(vpn|tun|tap|utun|wg|zt|docker|veth|vbox|vmnet|vmware|bridge|llw|awdl)/i.test(name);
  const cands = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const i of addrs || []) {
      if (i && i.family === "IPv4" && !i.internal && isPrivate(i.address) && !isVirtual(name)) {
        cands.push(i.address);
      }
    }
  }
  // 192.168.* 最常见，优先返回；都找不到时返回空，由界面提示手动确认 IP
  cands.sort((a, b) => (a.startsWith("192.168.") ? 0 : 1) - (b.startsWith("192.168.") ? 0 : 1));
  return cands[0] || "";
}
function mobileToken() {
  // 与 server.mjs 同源：优先与安装目录无关的共享文件（CT_TOKEN_FILE 或
  // ~/.claude-tools/server-token.txt），回退旧版本地 data/server-token.txt。
  // 这样常驻引擎即便从别的目录启动，App 端也能读到它写回共享文件的同一个令牌。
  const shared = process.env.CT_TOKEN_FILE || path.join(os.homedir(), ".claude-tools", "server-token.txt");
  for (const f of [shared, path.join(TOOLS_DIR, "data", "server-token.txt")]) {
    try { const t = fsSync.readFileSync(f, "utf8").trim(); if (t) return t; } catch {}
  }
  return "";
}
async function mobileInfo() {
  const ip = lanIP();
  const token = mobileToken();
  const listening = await portListening(MOBILE_PORT);
  const running = !!mobileProc || listening;
  const external = listening && !mobileProc; // 由计划任务等外部方式常驻运行
  const url = running ? `${PUBLIC_URL}/?token=${token}` : "";
  const lanUrl = running ? `http://${ip}:${MOBILE_PORT}/?token=${token}` : "";
  return { running, external, ip, port: MOBILE_PORT, token, url, lanUrl };
}
ipcMain.handle("mobileStatus", async () => mobileInfo());
ipcMain.handle("mobileStart", async () => {
  if (mobileProc || (await portListening(MOBILE_PORT))) return mobileInfo();
  try {
    const serverPath = path.join(TOOLS_DIR, "server.mjs");
    mobileProc = execFile(
      process.execPath,
      [serverPath],
      { cwd: TOOLS_DIR, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(MOBILE_PORT), CT_ACCOUNTS_PATH: ACCTS_PATH() } }
    );
    mobileProc.on("exit", () => { mobileProc = null; });
    mobileProc.on("error", () => { mobileProc = null; });
    // 等令牌文件写出（server 首次启动会生成），最多约 1.5s
    for (let i = 0; i < 15 && !mobileToken(); i++) await new Promise((r) => setTimeout(r, 100));
    return mobileInfo();
  } catch (e) {
    mobileProc = null;
    return { running: false, error: String(e?.message || e) };
  }
});
ipcMain.handle("mobileStop", async () => {
  try { mobileProc?.kill(); } catch {}
  mobileProc = null;
  return mobileInfo();
});
app.on("before-quit", () => { try { mobileProc?.kill(); } catch {} });

// ── 进化大脑（open-core 闭源核心）：仅当本机带 cloud/brain.mjs（闭源开发机）时自启 ──
// 进化/巡检的提示词都向它取，没有它且无缓存时进化会被硬拦（见 brain-client.mjs）。
// 开源提取版没有 cloud/ 目录，此函数静默跳过——靠 config.json 的 brainUrl 指向远端大脑。
let brainProc = null;
const BRAIN_PORT = Number(process.env.BRAIN_PORT) ||
  Number((appConfig.brainUrl || "").match(/:(\d+)/)?.[1]) || 8788;
async function ensureBrain() {
  const brainPath = path.join(TOOLS_DIR, "cloud", "brain.mjs");
  if (!fsSync.existsSync(brainPath)) return; // 开源版：无闭源核心，跳过
  if (brainProc || (await portListening(BRAIN_PORT))) return; // 已在跑（本进程或外部常驻）
  try {
    brainProc = execFile(
      process.execPath,
      [brainPath],
      { cwd: TOOLS_DIR, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", BRAIN_PORT: String(BRAIN_PORT) } }
    );
    brainProc.on("exit", () => { brainProc = null; });
    brainProc.on("error", () => { brainProc = null; });
    for (let i = 0; i < 20 && !(await portListening(BRAIN_PORT)); i++) await new Promise((r) => setTimeout(r, 100));
  } catch { brainProc = null; }
}
app.on("before-quit", () => { try { brainProc?.kill(); } catch {} });

// ── 按路径设置工作目录（重启后恢复上次文件夹用，不弹框）──────────
ipcMain.handle("setWorkdir", async (_e, p) => {
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) return null;
    workdir = p;
    return p;
  } catch {
    return null; // 路径不存在（如已删除）=> 不恢复
  }
});

// ── 努力程度切换：读/写 config.json 的 effort 字段（省 token 的主旋钮，下一轮对话即生效）──
ipcMain.handle("getEffort", () => appConfig.effort || "");
ipcMain.handle("setEffort", async (_e, effort) => {
  appConfig.effort = EFFORT_LEVELS.includes(effort) ? effort : null;
  try {
    const file = path.join(TOOLS_DIR, "config.json");
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
    saved.effort = appConfig.effort;
    await fs.writeFile(file, JSON.stringify(saved, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ── 对话历史持久化到磁盘（比 localStorage 更耐久、无大小限制）────
const convFile = () =>
  path.join(app.getPath("userData"), "claude-tools-conversations.json");
ipcMain.handle("loadConvs", async () => {
  try {
    return JSON.parse(await fs.readFile(convFile(), "utf8"));
  } catch {
    return null;
  }
});
// 合并写：手机端会直接改这份文件（经 server.mjs），桌面端保存时把文件里
// 本端没有的对话/归档保留下来，避免整份覆盖把手机端新开的会话抹掉。
// data.removed 是本端已删除的 id（渲染层会话期记忆），防止删掉的又被合并复活。
function mergeConvState(mine, theirs) {
  if (!theirs || !Array.isArray(theirs.list)) return mine;
  const removed = new Set(Array.isArray(mine.removed) ? mine.removed : []);
  const mineList = Array.isArray(mine.list) ? mine.list : [];
  const mineHist = Array.isArray(mine.history) ? mine.history : [];
  const mineIds = new Set(mineList.map((c) => c && c.id));
  const histIds = new Set(mineHist.map((h) => h && h.id));
  const keep = (theirs.list || []).filter(
    (c) => c && c.id && !mineIds.has(c.id) && !histIds.has(c.id) && !removed.has(c.id)
  );
  if (keep.length) mine.list = [...mineList, ...keep];
  const extraHist = (Array.isArray(theirs.history) ? theirs.history : []).filter(
    (h) => h && h.id && !histIds.has(h.id) && !mineIds.has(h.id) && !removed.has(h.id)
  );
  if (extraHist.length) mine.history = [...mineHist, ...extraHist];
  return mine;
}
ipcMain.handle("saveConvs", async (_e, data) => {
  try {
    try {
      data = mergeConvState(data, JSON.parse(await fs.readFile(convFile(), "utf8")));
    } catch {}
    delete data.removed; // 仅用于合并判断，不落盘
    // 原子写：先写临时文件再 rename 覆盖，避免写到一半被中断导致正式文件截断损坏
    const target = convFile();
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data));
      try {
        await fs.rename(tmp, target);
      } catch (renameErr) {
        // Windows 下 rename 到已存在文件可能抛 EPERM，fallback 到 copyFile+unlink
        await fs.copyFile(tmp, target);
        await fs.unlink(tmp).catch(() => {});
      }
    } finally {
      fs.unlink(tmp).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    console.error("[saveConvs] failed:", err);
    return { error: String(err) };
  }
});

// 监听共享历史文件：手机端写入后通知渲染层合并刷新（监听目录，文件被替换也不失效）
function watchConvFile() {
  const f = convFile();
  try { fsSync.mkdirSync(path.dirname(f), { recursive: true }); } catch {}
  let deb = null;
  try {
    fsSync.watch(path.dirname(f), (_evt, name) => {
      if (name && name !== path.basename(f)) return;
      if (deb) clearTimeout(deb);
      deb = setTimeout(() => {
        deb = null;
        // 不区分写入来源：自家写入回读无变化即止（syncConvsFromDisk 幂等）。
        // 之前按时间窗跳过"自家写入"，会把恰好同窗到达的手机端更新一并吞掉，
        // 且之后无补偿通知——手机新开的对话桌面端要重启才看得到。
        if (win && !win.isDestroyed()) win.webContents.send("convs:changed");
      }, 500);
    });
  } catch (e) {
    crashLog("convWatch", String(e));
  }
}

// ── 列目录（懒加载，点击文件夹才展开下一层）──────────────────
// 黑名单制：只排除真正无用的点条目与常见构建产物目录，
// .github/.env.example/.gitignore 等开发常用点文件正常显示与检索。
const IGNORE = new Set([
  "node_modules", ".git", ".hg", ".svn", ".DS_Store", ".cache",
  "dist", "build", "coverage", "out", "target",
  ".next", ".nuxt", ".turbo", ".parcel-cache", "__pycache__", ".venv", "venv",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".nuxt", ".turbo", ".parcel-cache", "coverage", "out", "target", ".venv", "venv",
]);
ipcMain.handle("listDir", async (_e, dirPath) => {
  const target = dirPath || workdir;
  if (!target) return [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries
      .filter((d) => !IGNORE.has(d.name))
      .map((d) => ({
        name: d.name,
        path: path.join(target, d.name),
        isDir: d.isDirectory(),
      }))
      .sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
      );
  } catch {
    return []; // 无权限/目录已删除等 => 返回空，避免渲染层 await 抛未捕获异常
  }
});

// ── 模糊搜索工作目录下的文件（供对话框 @ 引用用）──────────────
// 整棵文件树做短期内存缓存：切换 workdir 或超过 TTL 时失效，
// 避免大仓库每次按键都重新遍历磁盘。
let fileCache = { dir: null, list: null, time: 0 };
const FILE_CACHE_TTL = 5000; // ms
const FILE_CACHE_MAX = 5000; // 缓存条目上限，避免超大仓库吃内存
// 与文件树同生命周期的内容缓存：grepFiles 逐键检索时，同一 TTL 窗口内
// 复用已读过的文本内容（path -> 行数组，跳过的文件存 null），免去逐键全量读盘。
// 累计字节预算：超出后新文件只检索不缓存，避免大量大文本文件吃掉数 GB 内存。
const CONTENT_CACHE_BUDGET = 64 * 1024 * 1024; // 64MB
let contentCache = new Map();
let contentCacheBytes = 0;

async function listWorkdirFiles() {
  const now = Date.now();
  if (fileCache.dir === workdir && fileCache.list && now - fileCache.time < FILE_CACHE_TTL) {
    return fileCache.list;
  }
  fileCache.dirs = null;
  contentCache = new Map(); // 文件树重建时一并失效内容缓存
  contentCacheBytes = 0;
  const all = [];
  const dirs = []; // 目录条目，供 @ 补全把整个目录纳入上下文
  const visited = new Set(); // 已访问目录的真实路径，防符号链接自指/环路重复遍历
  const MAX_DEPTH = 20;
  async function walk(dir, depth = 0) {
    if (all.length >= FILE_CACHE_MAX) return;
    if (depth > MAX_DEPTH) return;
    let real;
    try {
      real = await fs.realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (all.length >= FILE_CACHE_MAX) return;
      if (IGNORE.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        const rel = path.relative(workdir, full).replace(/\\/g, "/");
        dirs.push({ name: d.name, path: full, rel, relLower: rel.toLowerCase() });
        await walk(full, depth + 1);
      } else {
        const rel = path.relative(workdir, full).replace(/\\/g, "/");
        all.push({ name: d.name, path: full, rel, relLower: rel.toLowerCase() });
      }
    }
  }
  await walk(workdir);
  fileCache = { dir: workdir, list: all, dirs, time: now };
  return all;
}

ipcMain.handle("searchFiles", async (_e, query) => {
  if (!workdir) return [];
  const q = String(query || "").toLowerCase();
  const all = await listWorkdirFiles();
  const dirs = fileCache.dirs || [];
  const MAX = 50; // 最多返回 50 条，避免大仓库卡顿
  // 全量过滤后统一打分排序再截断：命中位置越靠前越优、相对路径越短越优，
  // 避免遍历序靠后的更优匹配（如文件名开头命中）被提前 break 永远挤掉。
  const rank = (items) =>
    items
      .filter((it) => !q || it.relLower.includes(q))
      .sort((a, b) => {
        if (q) {
          const pa = a.relLower.indexOf(q);
          const pb = b.relLower.indexOf(q);
          if (pa !== pb) return pa - pb;
        }
        return a.relLower.length - b.relLower.length;
      })
      .slice(0, MAX);
  // 目录优先排在前面，选中后插入 @相对目录/ 让模型把整个目录纳入上下文
  return [
    ...rank(dirs).map(({ name, path, rel }) => ({ name, path, rel, dir: true })),
    ...rank(all).map(({ name, path, rel }) => ({ name, path, rel })),
  ].slice(0, MAX);
});

// ── 全文检索：遍历工作目录文本文件，逐行匹配关键词 ───────────
// 复用 listWorkdirFiles 的文件树，跳过二进制/超大文件并限制结果数，
// 返回「文件 + 行号 + 命中行文本」供左侧搜索框点击直达预览。
ipcMain.handle("grepFiles", async (_e, query) => {
  if (!workdir) return [];
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  const ql = q.toLowerCase();
  const MAX_RESULTS = 200; // 命中行总数上限，避免大仓库刷屏卡顿
  const MAX_PER_FILE = 20; // 单文件命中上限，防止单文件霸占结果
  const MAX_FILE_SIZE = 1_000_000; // 超过 1MB 的文件跳过
  contentCache = new Map();
  contentCacheBytes = 0;
  const all = await listWorkdirFiles();
  const out = [];
  for (const f of all) {
    if (out.length >= MAX_RESULTS) break;
    if (BINARY_EXTS.has(path.extname(f.path).toLowerCase())) continue;
    let lines;
    if (contentCache.has(f.path)) {
      lines = contentCache.get(f.path); // 命中缓存：null 表示此前判定为跳过
      if (lines === null) continue;
    } else {
      let stat;
      try { stat = await fs.stat(f.path); } catch { contentCache.set(f.path, null); continue; }
      if (stat.size > MAX_FILE_SIZE) { contentCache.set(f.path, null); continue; }
      let buf;
      try { buf = await fs.readFile(f.path); } catch { contentCache.set(f.path, null); continue; }
      if (looksBinary(buf)) { contentCache.set(f.path, null); continue; }
      lines = buf.toString("utf8").split("\n");
      // 超出累计预算后只检索不缓存，本次仍正常匹配（null 跳过标记不占预算）
      if (contentCacheBytes + buf.length <= CONTENT_CACHE_BUDGET) {
        contentCache.set(f.path, lines);
        contentCacheBytes += buf.length;
      }
    }
    let hits = 0;
    for (let i = 0; i < lines.length && hits < MAX_PER_FILE && out.length < MAX_RESULTS; i++) {
      if (lines[i].toLowerCase().includes(ql)) {
        out.push({ name: f.name, path: f.path, rel: f.rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
        hits++;
      }
    }
  }
  // 排序：文件名含关键词的行优先（relLower 里最后一段路径命中位置越靠前越优），
  // 同优先级内路径越短越优，与 searchFiles 保持一致。
  out.sort((a, b) => {
    const nameA = a.rel.toLowerCase();
    const nameB = b.rel.toLowerCase();
    const ia = nameA.lastIndexOf("/") + 1;
    const ib = nameB.lastIndexOf("/") + 1;
    const fa = nameA.slice(ia).indexOf(ql);
    const fb = nameB.slice(ib).indexOf(ql);
    // 文件名段命中：-1 表示未命中，排在命中之后
    const hitA = fa >= 0 ? fa : Infinity;
    const hitB = fb >= 0 ? fb : Infinity;
    if (hitA !== hitB) return hitA - hitB;
    return nameA.length - nameB.length;
  });
  return out;
});

// ── 保存粘贴/拖入的附件，返回绝对路径（供对话引用，让 Claude 读取）──
ipcMain.handle("saveAttachment", async (_e, { name, base64 }) => {
  try {
    if (base64.length > 80_000_000) return { error: '附件超过约 60 MB 上限，请精简后再上传' };
    const dir = path.join(app.getPath("userData"), "attachments");
    await fs.mkdir(dir, { recursive: true });
    const safe = (name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
    const file = path.join(dir, Date.now() + "-" + safe);
    await fs.writeFile(file, Buffer.from(base64, "base64"));
    return { path: file, name: safe };
  } catch (err) {
    return { error: String(err) };
  }
});

// 常见二进制文件扩展名（按扩展名快速判定，无法以文本预览）
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".tif", ".heic", ".avif",
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".bz2", ".xz",
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".class", ".o", ".a",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".sqlite", ".db",
]);

// 按字节检测二进制：存在 NUL 字节，或不可打印字节占比过高
function looksBinary(buf) {
  const len = Math.min(buf.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 7 || (c > 13 && c < 32)) suspicious++;
  }
  return len > 0 && suspicious / len > 0.3;
}

// ── 读取单个文件内容（点击文件预览）─────────────────────────
ipcMain.handle("readFile", async (_e, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 2_000_000) return "(文件过大，未显示)";
    if (BINARY_EXTS.has(path.extname(filePath).toLowerCase())) {
      return "(二进制文件，无法以文本预览)";
    }
    const buf = await fs.readFile(filePath);
    if (looksBinary(buf)) return "(二进制文件，无法以文本预览)";
    return buf.toString("utf8");
  } catch (err) {
    return `(读取失败: ${String(err)})`;
  }
});

// ── 按工作目录相对路径读取文件（@mention 注入用）────────────────
ipcMain.handle("readWorkdirFile", async (_e, relPath) => {
  if (!workdir) return "(未设置工作目录)";
  const absPath = path.join(workdir, relPath.replace(/\/$/, ""));
  if (path.relative(workdir, absPath).startsWith("..")) return "(路径越界，拒绝读取)";
  try {
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) return `(${relPath} 是目录，请引用具体文件)`;
    if (stat.size > 100_000) return `(文件过大 ${Math.round(stat.size / 1024)}KB，已跳过)`;
    const buf = await fs.readFile(absPath);
    if (looksBinary(buf)) return "(二进制文件)";
    return buf.toString("utf8");
  } catch (err) {
    return `(读取失败: ${String(err)})`;
  }
});

// ── 文本写回（md 编辑器用）：写临时文件后原子重命名，避免中途崩溃损坏原文件 ──
ipcMain.handle("writeFile", async (_e, filePath, content) => {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
});

// ── 新建文件夹：递归创建，限制在当前工作目录内防 ../ 越界 ──────
ipcMain.handle("mkdir", async (_e, dirPath) => {
  try {
    if (workdir) {
      const root = path.resolve(workdir);
      const abs = path.resolve(dirPath);
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        return { ok: false, error: "路径越界" };
      }
    }
    await fs.mkdir(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ── 文件树右键操作：重命名 / 移入废纸篓 / Finder 中显示 ─────────
// 写操作均限制在当前工作目录内防 ../ 越界
function insideWorkdir(p) {
  if (!workdir) return false;
  const root = path.resolve(workdir);
  const abs = path.resolve(p);
  return abs === root || abs.startsWith(root + path.sep);
}
ipcMain.handle("renameEntry", async (_e, oldPath, newPath) => {
  try {
    if (!insideWorkdir(oldPath) || !insideWorkdir(newPath)) {
      return { ok: false, error: "路径越界" };
    }
    if (fsSync.existsSync(newPath)) return { ok: false, error: "同名文件已存在" };
    await fs.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
ipcMain.handle("trashEntry", async (_e, p) => {
  try {
    // 禁止删工作目录本身
    if (!insideWorkdir(p) || path.resolve(p) === path.resolve(workdir)) {
      return { ok: false, error: "路径越界" };
    }
    await shell.trashItem(path.resolve(p)); // 移入废纸篓而非硬删，可随时找回
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
ipcMain.handle("revealInFolder", (_e, p) => {
  if (typeof p === "string" && p) shell.showItemInFolder(path.resolve(p));
});

// ── 二进制读取（PDF 编辑器用），返回 base64 ────────────────────
ipcMain.handle("readFileBuffer", async (_e, filePath) => {
  try {
    const MAX_BYTES = 100 * 1024 * 1024; // 100MB
    const st = await fs.stat(filePath);
    if (st.size > MAX_BYTES) return { error: "文件过大，无法打开" };
    const buf = await fs.readFile(filePath);
    return { base64: buf.toString("base64") };
  } catch (err) {
    return { error: String(err) };
  }
});

// ── 另存 PDF：弹保存框，写回字节 ───────────────────────────────
ipcMain.handle("savePdf", async (_e, { defaultPath, base64 }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || "edited.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    await fs.writeFile(r.filePath, Buffer.from(base64, "base64"));
    return { path: r.filePath };
  } catch (err) {
    return { error: String(err) };
  }
});

// ── 另存文本（导出对话 Markdown 用）：弹保存框后原子写回 ──────────
ipcMain.handle("saveTextFile", async (_e, { defaultName, content }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || "export.md",
    filters: [{ name: "Markdown", extensions: ["md"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  const tmp = `${r.filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, r.filePath);
    return { path: r.filePath };
  } catch (err) {
    return { error: String(err) };
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
});

// ── 代码地图：对当前 workdir 做一次只读分析，产出模块/依赖关系的 mermaid 图 ──
// 省钱设计：限只读工具 + maxTurns 上限 + 复用 evolveModel（便宜模型够用），单轮查询不留会话
let codemapping = false;
let codemapAbort = null; // 进行中查询的 AbortController，供 codemapStop 主动取消止损
ipcMain.handle("codemap", async () => {
  if (codemapping) return { error: "已有代码地图生成中" };
  if (!workdir) return { error: "请先选择文件夹" };
  codemapping = true;
  const abort = new AbortController();
  codemapAbort = abort;
  const timer = setTimeout(() => abort.abort(), 300000); // 5 分钟兜底超时
  try {
    const prompt =
      "用 Glob/Read/Grep 快速浏览本项目的结构（优先看 README、配置/入口文件、目录划分，扫描即可、不要逐文件精读），" +
      "梳理出模块划分与模块间的依赖/调用关系，产出一份代码地图。\n" +
      "最后只输出一个 Markdown 文档（不要任何额外解释），格式：\n" +
      "# 代码地图\n" +
      "不超过 3 句话的架构概述\n" +
      "```mermaid\n" +
      "graph LR 的模块/依赖关系图（节点 ≤20 个、标签简短，可按目录/职责用 subgraph 分组；" +
      "节点 id 只用字母数字，标签含特殊字符时用双引号包裹，确保 mermaid 语法正确）\n" +
      "```\n" +
      "随后用列表给每个核心模块一行职责说明。";
    const response = query({
      prompt,
      options: {
        cwd: workdir,
        permissionMode: "bypassPermissions",
        allowedTools: ["Read", "Glob", "Grep"], // 只读分析，杜绝副作用
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task", "WebSearch", "WebFetch"], // 双保险：禁写/禁执行/禁联网，控住成本
        maxTurns: 15, // 限制工具循环轮数，控制 token 消耗
        abortController: abort,
        systemPrompt: { type: "preset", preset: "claude_code" },
        ...((appConfig.lightModel || appConfig.model) ? { model: appConfig.lightModel || appConfig.model } : {}),
        ...tokenOpts(appConfig),
      },
    });
    let text = "", final = "";
    for await (const msg of response) {
      if (msg.type === "assistant") {
        for (const b of msg.message.content) if (b.type === "text") text += b.text;
      } else if (msg.type === "result") {
        recordCost("chat", msg.usage, msg.total_cost_usd); // 代码地图属用户侧消耗，记入 chat
        if (msg.subtype === "success") final = msg.result || "";
      }
    }
    if (abort.signal.aborted) return abort.userCanceled ? { canceled: true } : { error: "已超时或中止" };
    const markdown = /```mermaid/.test(final) ? final : text;
    if (!/```mermaid/.test(markdown)) return { error: "未生成出 mermaid 图，请重试" };
    // 只截取最终文档（模型偶尔会在文档前带过程性文字）
    const start = markdown.indexOf("# 代码地图");
    return { ok: true, markdown: start >= 0 ? markdown.slice(start) : markdown };
  } catch (err) {
    if (abort.signal.aborted) return abort.userCanceled ? { canceled: true } : { error: "已超时或中止" };
    return { error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
    codemapping = false;
    codemapAbort = null;
  }
});

// 用户主动取消代码地图：立即中止 SDK 查询并复位状态，止住误触后的 token 消耗
ipcMain.handle("codemapStop", () => {
  if (codemapAbort) {
    codemapAbort.userCanceled = true; // 区分主动取消与兜底超时
    codemapAbort.abort();
  }
  return { ok: true };
});

// ── 自动命名对话：首轮完成后用轻量模型生成 ≤8 字标题，成本极低 ──
ipcMain.handle("convAutoTitle", async (_e, text) => {
  if (!text || typeof text !== "string") return { error: "无效输入" };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000); // 15s 兜底
  try {
    const prompt = `用8字以内概括以下对话主题，只输出标题文字不加标点：${text.slice(0, 300)}`;
    const response = query({
      prompt,
      options: {
        cwd: workdir || process.cwd(),
        permissionMode: "bypassPermissions",
        allowedTools: [],
        maxTurns: 1,
        abortController: abort,
        systemPrompt: { type: "text", text: "你是对话标题生成助手，只输出简短标题，不解释、不加标点。" },
        ...((appConfig.lightModel || appConfig.model) ? { model: appConfig.lightModel || appConfig.model } : {}),
      },
    });
    let title = "";
    for await (const msg of response) {
      if (msg.type === "assistant") {
        for (const b of msg.message.content) if (b.type === "text") title += b.text;
      }
    }
    title = title.trim().replace(/["""''【】「」《》\n]/g, "").slice(0, 20);
    return { title: title || null };
  } catch {
    return { error: "生成失败" };
  } finally {
    clearTimeout(timer);
  }
});

// ── 对话：支持多个并发查询，按 convId 隔离；事件都带上 convId ───
const runs = new Map(); // convId -> AbortController

// 未选目录时的中性工作目录（保证 SDK 有合法 cwd，但无项目文件上下文）
async function scratchDir() {
  const d = path.join(app.getPath("userData"), "scratch");
  try {
    await fs.mkdir(d, { recursive: true });
  } catch {}
  return d;
}

// 计划模式前缀：作为说明文案告知模型先只读分析、给出分步方案待用户确认；
// 实际只读约束由 SDK 的 permissionMode:"plan" 在框架层强制（见下方 chat IPC）
const PLAN_PREAMBLE =
  "【计划模式】在本次回复中，请先不要修改任何文件、也不要执行有副作用的命令（仅允许只读地阅读/检索代码）。" +
  "请先分析下面的需求，然后给出一个清晰的分步实施方案（涉及哪些文件、关键改动点、潜在风险），等我确认后再执行。\n\n--- 用户需求 ---\n";

// ── 对话级跨进程锁：与 server.mjs 共用同一把（同一锁目录）。手机端与桌面端同跑一条对话时
//    会并发 resume 同一个 session 文件，触发 CLI "No conversation found" 竞态；用共享锁文件
//    串行化，一端在跑时另一端让路。锁带 TTL，持有进程崩溃后到期自动失效。──
const LOCK_DIR = path.join(TOOLS_DIR, "data", "locks");
const LOCK_TTL = 600000;
const lockFile = (convId) => path.join(LOCK_DIR, String(convId).replace(/[^\w.-]/g, "_") + ".lock");
async function acquireConvLock(convId, owner) {
  if (!convId) return true;
  try {
    await fs.mkdir(LOCK_DIR, { recursive: true });
    const f = lockFile(convId);
    try {
      const cur = JSON.parse(await fs.readFile(f, "utf8"));
      if (cur && cur.owner !== owner && Date.now() - (cur.ts || 0) < LOCK_TTL) return false;
    } catch {}
    await fs.writeFile(f, JSON.stringify({ owner, ts: Date.now() }));
    return true;
  } catch { return true; }
}
async function releaseConvLock(convId, owner) {
  if (!convId) return;
  try {
    const cur = JSON.parse(await fs.readFile(lockFile(convId), "utf8"));
    if (cur && cur.owner === owner) await fs.unlink(lockFile(convId));
  } catch {}
}

ipcMain.on("chat", async (e, { prompt, resume, convId, plan, light, cwd: reqCwd, projectMemory, convModel }) => {
  // 硬性每日消费上限：发 API 前检查，超限直接拦截，不发请求
  const maxSpend = appConfig.maxDailySpendUSD;
  if (maxSpend > 0) {
    const s = loadCostStats();
    const today = localDay();
    const todaySpent = s.days[today]
      ? Object.values(s.days[today]).reduce((a, v) => a + (v.cost || 0), 0)
      : 0;
    if (todaySpent >= maxSpend) {
      e.sender.send("chat:error", {
        convId,
        message: `今日消费已达 $${maxSpend} 上限，请在设置中调整「每日消费硬上限」。`,
      });
      return;
    }
  }
  if (plan) prompt = PLAN_PREAMBLE + prompt;
  let abort = new AbortController(); // 可重建：续接失败重试时若旧控制器已中止，换新的（见下方 catch）
  let stopped = false; // 用户是否已主动停止（避免重复发 chat:stopped）
  let timedOut = false; // 流超时标志（区别于用户主动停止）
  // 所有发给渲染层的事件都带上 convId，渲染层据此路由到对应对话。
  // 若渲染帧已销毁(窗口关闭/重载/重启)则中止本次查询，避免 disposed 错误刷屏。
  const send = (ch, payload) => {
    if (e.sender.isDestroyed()) {
      abort.abort();
      return;
    }
    e.sender.send(ch, { convId, ...payload });
  };
  // 停止：中止查询 + 立即通知渲染层解除忙碌态。
  // 不能只依赖 abort 后迭代器抛错——某些情况下 SDK 中止后迭代器会悬挂、
  // 永不返回，导致界面卡在“思考中”，看起来像“停止按钮没反应”。
  const entry = {
    // silent=true：仅中止查询、不发 chat:stopped（被新一轮覆盖旧查询时用——
    // 此时渲染层已开始新一轮，若再发 stopped 会把新一轮的忙碌态/当前气泡清掉，
    // 导致新一轮的流式文本全部被丢弃）。
    stop: (silent) => {
      stopped = true;
      try { abort.abort(); } catch {}
      if (!silent) send("chat:stopped", {});
    },
  };
  // 若同一 convId 已有在途查询，先中止旧的再覆盖——否则异常重试/并发场景下旧
  // AbortController 会随 entry 被覆盖而丢失，stop() 再也无法中止那次悬挂的查询。
  const prev = runs.get(convId);
  if (prev) { try { prev.stop(true); } catch {} }
  runs.set(convId, entry);
  // 对话级锁：手机端正在同一对话内运行时让路，避免并发 resume 同一 session 的竞态。
  if (!(await acquireConvLock(convId, "desktop"))) {
    runs.delete(convId);
    send("chat:error", { message: "该对话正在手机端回复中，请稍候再发（避免两端同时续接同一会话）。" });
    return;
  }
  // 没选目录也能聊：用一个中性 scratch 目录当 cwd（无项目上下文）；选了目录则用目录（带文件上下文）。
  // reqCwd 是续聊时渲染层带回的本对话"出生"cwd——session 文件按目录存盘，沿用它才能让
  // CLI 找到对应会话（含跨设备：手机端落盘的 cwd 也会通过对话记录回流到这里）。
  const cwd = reqCwd || workdir || (await scratchDir());
  const mcpServers = await readMcpConfig(); // App 级 mcp.json（可选）

  // 进入本轮前对 git 工作区打检查点，完成后若有改动可一键回滚（仅当 cwd 在 git 仓库且已有提交）
  let cpId = null, cp = null;
  try {
    const root = await gitRoot(cwd);
    if (root && (cp = await snapshotWorktree(root))) {
      cpId = `cp-${process.pid}-${checkpointSeq++}`;
      checkpoints.set(cpId, cp);
      while (checkpoints.size > 50) checkpoints.delete(checkpoints.keys().next().value);
    }
  } catch {}

  // 跑一轮查询；resumeId 为要续接的 session（null=新会话）
  // lastCtx：本轮最后一次 API 请求的输入侧 token（输入+缓存读写）≈ 当前会话上下文规模。
  // result.usage 是整轮累加值（含工具循环的多次请求），用它估上下文会虚高，故单独取最后一次。
  let lastCtx = 0;
  let chatToolCalls = 0; // 本轮工具调用次数，供活动日志分析效率
  let chatModel = "";    // 本轮实际模型
  const run = async (resumeId) => {
    const CHAT_STREAM_TIMEOUT_MS = (appConfig.chatStreamTimeoutSec ?? 120) * 1000;
    let lastChunkTime = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastChunkTime > CHAT_STREAM_TIMEOUT_MS) {
        timedOut = true;
        try { abort.abort(); } catch {}
      }
    }, CHAT_STREAM_TIMEOUT_MS);
    const response = query({
      prompt,
      options: {
        cwd,
        // 计划模式走 SDK 框架级只读约束（plan）兜底，模型不守约也无法改文件/执行命令；
        // 普通模式沿用配置的权限（默认全权限含 Bash）
        permissionMode: plan ? "plan" : appConfig.permissionMode || "bypassPermissions",
        includePartialMessages: true, // 逐字流式
        // 系统提示词的追加内容来自 tools/config.json，可直接编辑
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: (projectMemory ? "# 项目记忆\n" + projectMemory + "\n\n" : "") + (appConfig.systemPromptAppend || ""),
        },
        // 优先级：对话级 convModel > plan/light 专用模型 > 全局 model
        ...((convModel || (plan && appConfig.planModel) || (light && appConfig.lightModel) || appConfig.model) ? { model: convModel || (plan && appConfig.planModel) || (light && appConfig.lightModel) || appConfig.model } : {}),
        ...tokenOpts(appConfig),
        ...(mcpServers ? { mcpServers } : {}),
        abortController: abort,
        ...(resumeId ? { resume: resumeId } : {}),
      },
    });
    try { for await (const msg of response) {
      lastChunkTime = Date.now();
      if (stopped) break; // 已停止：不再转发后续事件（含 chat:done），避免界面被重新锁回忙碌
      if (msg.type === "system" && msg.subtype === "init") {
        lastMcpStatus = msg.mcp_servers || []; // 缓存连接状态供 MCP 面板显示
        if (win && !win.isDestroyed()) win.webContents.send("mcp:status", lastMcpStatus);
        chatModel = msg.model || "";
        send("chat:init", {
          model: msg.model,
          tools: msg.tools || [],
          mcp: msg.mcp_servers || [],
          commands: msg.slash_commands || [],
          skills: msg.skills || [],
          agents: msg.agents || [],
        });
      } else if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta")
          send("chat:chunk", { text: ev.delta.text });
      } else if (msg.type === "assistant") {
        const u = msg.message.usage;
        if (u)
          lastCtx =
            (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            chatToolCalls++;
            send("chat:tool", { id: block.id, name: block.name, input: block.input });
          }
        }
      } else if (msg.type === "user") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result")
              send("chat:toolresult", {
                id: block.tool_use_id,
                isError: !!block.is_error,
                text: normalizeResult(block.content),
              });
          }
        }
      } else if (msg.type === "result") {
        // 本轮是否真的改动了文件：按完整工作树比对快照，是才把检查点给前端（用于显示撤销按钮）
        let checkpoint = null;
        if (cp) {
          try {
            const now = await worktreeTree(cp.root);
            if (now !== cp.tree) {
              checkpoint = { id: cpId };
              fileCache = { dir: null, list: null, time: 0 }; // 本轮改动了文件：失效缓存，@ 补全/全文搜索立即可见新文件
            } else { checkpoints.delete(cpId); cp = null; } // 无改动：丢弃检查点
          } catch {}
        }
        recordCost("chat", msg.usage, msg.total_cost_usd); // 本地费用台账（按日聚合，关掉对话不丢）
        appendActivity({
          source: "chat",
          model: chatModel,
          usage: msg.usage || null,
          cost_usd: msg.total_cost_usd || 0,
          duration_ms: msg.duration_ms || 0,
          ctx_tokens: lastCtx,
          tool_calls: chatToolCalls,
          prompt_chars: typeof prompt === "string" ? prompt.length : 0,
          cwd_base: path.basename(cwd || ""),
          status: "done",
        });
        send("chat:done", {
          cost: msg.total_cost_usd,
          ms: msg.duration_ms,
          session: msg.session_id,
          cwd, // 本轮实际用的 cwd，供渲染层记进对话记录（下次/跨设备续聊沿用）
          usage: msg.usage || null, // {input_tokens, output_tokens, cache_*}，供渲染层累计本会话用量
          ctx: lastCtx, // 当前上下文规模（最后一次请求的输入侧 token），供渲染层提示压缩/新开对话
          checkpoint,
        });
      }
    } } finally { clearInterval(watchdog); }
  };

  try {
    await run(resume);
  } catch (err) {
    const msg = String(err?.stack || err);
    // 续接的 session 找不到（换了目录 / session 过期 / 手机与桌面并发 resume 同一会话时
    // CLI 查找竞态）=> 起新会话重试一次。只要用户没【主动停止】(stopped) 就兜底——
    // 不依赖 abort 状态：并发/同步抖动会误触发 abort，但那并不代表用户想中断。
    if (resume && !stopped && /No conversation found|session id/i.test(msg)) {
      // 旧控制器若已中止，重试会立刻 AbortError，故换一个新的（entry.stop/send 都引用变量，自动跟上）
      if (abort.signal.aborted) abort = new AbortController();
      try {
        await run(null);
      } catch (err2) {
        if (stopped || abort.signal.aborted) { if (!stopped) send("chat:stopped", {}); }
        else send("chat:error", { message: String(err2?.stack || err2) });
      }
    } else if (timedOut) {
      send("chat:error", { message: `流超时：${(appConfig.chatStreamTimeoutSec ?? 120)}s 内未收到数据，网络可能已中断` });
    } else if (stopped || abort.signal.aborted) {
      if (!stopped) send("chat:stopped", {}); // stop() 已发过则不重复
    } else {
      send("chat:error", { message: msg });
    }
  } finally {
    if (runs.get(convId) === entry) runs.delete(convId);
    try { await releaseConvLock(convId, "desktop"); } catch {}
  }
});

// ── 撤销某轮的文件改动：把 git 工作区还原到该轮开始前的检查点 ──────
ipcMain.handle("chatRewind", async (_e, id) => {
  const cp = checkpoints.get(id);
  if (!cp) return { error: "检查点已失效（可能已重启或被清理）" };
  try {
    await restoreCheckpoint(cp);
    fileCache = { dir: null, list: null, time: 0 }; // 文件已还原：失效缓存，@ 补全/全文搜索立即同步
    return { ok: true };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err) };
  }
});

// ── 停止：只中止指定对话的查询，并立即解除该对话的忙碌态 ──────────
ipcMain.on("stop", (_e, { convId } = {}) => {
  const entry = runs.get(convId);
  if (entry) {
    runs.delete(convId);
    entry.stop();
  }
});

// ── 订阅用量 / 重置时间（实验性 API，容错；用空输入流只走控制通道，不消耗 token）──
// 每次探测都要起一个 claude 子进程查用量端点。为省开销（进程 + 用量端点往返）：
// ① 命中 30s 内的缓存直接复用；② 同时发起的多次调用合并到同一个在途请求。
let usageCache = { ts: 0, value: null };
let usageInflight = null;
const USAGE_TTL = 30000;
const probeUsage = async () => {
  const abort = new AbortController();
  let timer = null;
  const finish = (v) => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { abort.abort(); } catch {}
    return v;
  };
  try {
    // 固定用 scratch 当 cwd：探测只走控制通道不耗 token，
    // 但会在 cwd 对应项目下留一个空 session 文件，用 workdir 会污染项目的会话列表
    const cwd = await scratchDir();
    const q = query({
      prompt: (async function* () {
        await new Promise((r) => abort.signal.addEventListener("abort", r));
      })(),
      options: { cwd, permissionMode: "bypassPermissions", abortController: abort },
    });
    const usage = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), 15000); }),
    ]);
    return finish(usage);
  } catch (err) {
    return finish({ error: String(err?.message || err) });
  }
};
ipcMain.handle("getUsage", async (_e, { force } = {}) => {
  const fresh = !force && usageCache.value && Date.now() - usageCache.ts < USAGE_TTL;
  if (fresh) return usageCache.value;
  if (usageInflight) return usageInflight; // 合并并发探测
  usageInflight = probeUsage();
  try {
    const usage = await usageInflight;
    // 失败结果不写缓存，下次仍可立即重试；端点被限流时 rate_limits 里是个 error 对象，同样视为失败
    if (usage && !usage.error && !usage.rate_limits?.error) usageCache = { ts: Date.now(), value: usage };
    return usage;
  } finally {
    usageInflight = null;
  }
});

// ── 本地费用台账：每轮 chat/evolve 的 token 与费用按日聚合落盘 ──────
// 纯本地记账零额外 token：data/cost-stats.json 按【日 × 来源】聚合分项 tokens 与费用，
// 保留 90 天，供右上角用量 tooltip 显示今日/本周/累计与趋势，量化省钱效果（关掉对话也不丢）。
const costStatsPath = () => path.join(app.getPath("userData"), "cost-stats.json");
// 进程内唯一可信数据源：首次调用 loadCostStats() 从磁盘初始化，之后所有读写只操作此对象
let costStatsCache = null; // { days: { "YYYY-MM-DD": { chat|evolve: { in,out,cw,cr,cost,turns } } } }
let costSaveTimer = null;
let budgetAlertedDay = null; // 当日只提醒一次；跨天或调整阈值后可再次触发
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function loadCostStats() {
  if (!costStatsCache) {
    try { costStatsCache = JSON.parse(fsSync.readFileSync(costStatsPath(), "utf8")); } catch {}
    if (!costStatsCache || typeof costStatsCache.days !== "object" || !costStatsCache.days) costStatsCache = { days: {} };
  }
  return costStatsCache;
}
function recordCost(source, usage, costUsd) {
  if (!usage && !(costUsd > 0)) return; // 本轮无可记内容
  // 确保已初始化（首次读盘），之后直接操作内存对象，避免并发调用时读到旧磁盘数据
  if (!costStatsCache) loadCostStats();
  const s = costStatsCache;
  const day = localDay();
  if (!s.days[day]) {
    s.days[day] = {};
    // 跨天时才清理一次：删掉 90 天前的旧数据，文件常年保持轻量
    const cutoff = localDay(new Date(Date.now() - 90 * 86400000));
    for (const k of Object.keys(s.days)) if (k < cutoff) delete s.days[k];
  }
  const t = s.days[day][source] || (s.days[day][source] = { in: 0, out: 0, cw: 0, cr: 0, cost: 0, turns: 0 });
  t.in += usage?.input_tokens || 0;
  t.out += usage?.output_tokens || 0;
  t.cw += usage?.cache_creation_input_tokens || 0;
  t.cr += usage?.cache_read_input_tokens || 0;
  t.cost += costUsd || 0;
  t.turns += 1;
  // 每日预算闸：当日累计费用首次超过阈值时推送一次（跨天自动复位），纯本地判断零额外 token
  const budget = appConfig.dailyBudgetUsd;
  if (budget > 0 && budgetAlertedDay !== day) {
    const spent = Object.values(s.days[day]).reduce((a, v) => a + (v.cost || 0), 0);
    if (spent >= budget) {
      budgetAlertedDay = day;
      if (win && !win.isDestroyed()) win.webContents.send("budget:exceeded", { spent, budget, day });
    }
  }
  // 防抖落盘：连续多轮只写一次，写的是同一个内存对象，无覆盖风险
  clearTimeout(costSaveTimer);
  costSaveTimer = setTimeout(() => { fs.writeFile(costStatsPath(), JSON.stringify(costStatsCache)).catch(() => {}); }, 1500);
}
function flushCostStats() {
  if (!costStatsCache || !costSaveTimer) return;
  clearTimeout(costSaveTimer);
  costSaveTimer = null;
  try { fsSync.writeFileSync(costStatsPath(), JSON.stringify(costStatsCache)); } catch {}
}
app.on("before-quit", flushCostStats);
ipcMain.handle("costStats", () => loadCostStats().days);

// ── 活动日志：按轮次记录详细执行信息，用于分析 token 效率与工具使用模式 ──────
// 格式：JSONL（每行一条 JSON），保留最近 90 天，最多 10000 条；零额外 token 消耗。
// 字段：ts/source/model/usage/cost_usd/duration_ms/ctx_tokens/tool_calls/prompt_chars/cwd_base/status
const activityLogPath = () => path.join(app.getPath("userData"), "activity.log");
const ACTIVITY_MAX_LINES = 10000;
const ACTIVITY_KEEP_DAYS = 90;
let activityWritePending = false;
let activityQueue = []; // 未落盘的条目缓冲

function appendActivity(entry) {
  entry.ts = new Date().toISOString();
  activityQueue.push(JSON.stringify(entry));
  if (activityWritePending) return;
  activityWritePending = true;
  setImmediate(async () => {
    activityWritePending = false;
    const lines = activityQueue.splice(0);
    if (!lines.length) return;
    try {
      const p = activityLogPath();
      let existing = "";
      try { existing = await fs.readFile(p, "utf8"); } catch {}
      const cutoff = new Date(Date.now() - ACTIVITY_KEEP_DAYS * 86400000).toISOString();
      const kept = existing
        .split("\n")
        .filter((l) => { if (!l.trim()) return false; try { return JSON.parse(l).ts >= cutoff; } catch { return false; } });
      const merged = [...kept, ...lines];
      const trimmed = merged.slice(-ACTIVITY_MAX_LINES);
      await fs.writeFile(p, trimmed.join("\n") + "\n");
    } catch {}
  });
}

ipcMain.handle("getActivityLog", async (_e, { days = 7 } = {}) => {
  try {
    const raw = await fs.readFile(activityLogPath(), "utf8");
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.ts >= cutoff);
  } catch { return []; }
});
ipcMain.handle("clearActivityLog", async () => {
  try { await fs.writeFile(activityLogPath(), ""); return { ok: true }; } catch (e) { return { error: String(e) }; }
});

// ── 模型切换 ─────────────────────────────────────────────────
// 读/写当前模型（空=用账号默认）。setModel 写回 tools/config.json 并更新内存中的
// appConfig.model，下一轮 chat 即生效，无需重启；与顶栏用量/费用展示联动控成本。
ipcMain.handle("getModel", () => appConfig.model || "");
ipcMain.handle("setModel", (_e, model) => {
  appConfig.model = model || null;
  try {
    const file = path.join(TOOLS_DIR, "config.json");
    let cur = {};
    try { cur = JSON.parse(fsSync.readFileSync(file, "utf8")); } catch {}
    fsSync.writeFileSync(file, JSON.stringify({ ...cur, model: appConfig.model }, null, 2));
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  return { ok: true, model: appConfig.model };
});

// 读/写行为设置（系统提示词追加 / 权限模式 / 进化后自动重启）。与 setModel 同机制：
// 写回 tools/config.json 并更新内存中的 appConfig，下一轮 chat 即生效，无需重启。
ipcMain.handle("getConfig", () => ({
  systemPromptAppend: appConfig.systemPromptAppend || "",
  permissionMode: appConfig.permissionMode || "bypassPermissions",
  evolveAutoRestart: !!appConfig.evolveAutoRestart,
  maxThinkingTokens: appConfig.maxThinkingTokens || null,
  evolveModel: appConfig.evolveModel || null,
  planModel: appConfig.planModel || null,
  lightModel: appConfig.lightModel || null,
  dailyBudgetUsd: appConfig.dailyBudgetUsd || null,
  maxDailySpendUSD: appConfig.maxDailySpendUSD || null,
  evolveMaxTokens: appConfig.evolveMaxTokens || null,
}));
ipcMain.handle("setConfig", (_e, patch) => {
  patch = patch || {};
  if (typeof patch.systemPromptAppend === "string") appConfig.systemPromptAppend = patch.systemPromptAppend;
  if (typeof patch.permissionMode === "string") appConfig.permissionMode = patch.permissionMode;
  if (typeof patch.evolveAutoRestart === "boolean") appConfig.evolveAutoRestart = patch.evolveAutoRestart;
  if (patch.maxThinkingTokens === null || typeof patch.maxThinkingTokens === "number")
    appConfig.maxThinkingTokens = patch.maxThinkingTokens > 0 ? Math.floor(patch.maxThinkingTokens) : null;
  if (patch.evolveModel === null || typeof patch.evolveModel === "string")
    appConfig.evolveModel = patch.evolveModel || null;
  if (patch.planModel === null || typeof patch.planModel === "string")
    appConfig.planModel = patch.planModel || null;
  if (patch.lightModel === null || typeof patch.lightModel === "string")
    appConfig.lightModel = patch.lightModel || null;
  if (patch.dailyBudgetUsd === null || typeof patch.dailyBudgetUsd === "number") {
    appConfig.dailyBudgetUsd = patch.dailyBudgetUsd > 0 ? patch.dailyBudgetUsd : null;
    budgetAlertedDay = null; // 阈值变更后允许按新阈值重新触发
  }
  if (patch.maxDailySpendUSD === null || typeof patch.maxDailySpendUSD === "number")
    appConfig.maxDailySpendUSD = patch.maxDailySpendUSD > 0 ? patch.maxDailySpendUSD : null;
  if (patch.evolveMaxTokens === null || typeof patch.evolveMaxTokens === "number")
    appConfig.evolveMaxTokens = patch.evolveMaxTokens > 0 ? Math.floor(patch.evolveMaxTokens) : null;
  try {
    const file = path.join(TOOLS_DIR, "config.json");
    let cur = {};
    try { cur = JSON.parse(fsSync.readFileSync(file, "utf8")); } catch {}
    fsSync.writeFileSync(file, JSON.stringify({
      ...cur,
      systemPromptAppend: appConfig.systemPromptAppend,
      permissionMode: appConfig.permissionMode,
      evolveAutoRestart: appConfig.evolveAutoRestart,
      maxThinkingTokens: appConfig.maxThinkingTokens,
      evolveModel: appConfig.evolveModel,
      planModel: appConfig.planModel,
      lightModel: appConfig.lightModel,
      dailyBudgetUsd: appConfig.dailyBudgetUsd,
      maxDailySpendUSD: appConfig.maxDailySpendUSD,
      evolveMaxTokens: appConfig.evolveMaxTokens,
    }, null, 2));
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  return { ok: true };
});

// ── Claude 账号快捷切换 ───────────────────────────────────────
// 一个账号 = 凭证文件(~/.claude/.credentials.json) + 身份(~/.claude.json 的 oauthAccount)。
// 切换即把存档的凭证写回，并把 oauthAccount 合并进 .claude.json，使 SDK 与用量显示同步生效。
const HOME = os.homedir();
const CRED_PATH = path.join(HOME, ".claude", ".credentials.json");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const ACCTS_PATH = () => path.join(app.getPath("userData"), "accounts.json");

function readJson(file) {
  try { return JSON.parse(fsSync.readFileSync(file, "utf8")); } catch { return null; }
}

// 凭证读写跨平台：macOS 上 Claude Code 把凭证存在系统钥匙串
// (service="Claude Code-credentials")，而非 ~/.claude/.credentials.json；
// 其他平台仍用文件。读/写都按平台分流，保证保存与切换在 Mac 上生效。
const KEYCHAIN_SERVICE = "Claude Code-credentials";
function readCredentials() {
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        { encoding: "utf8" }
      );
      return JSON.parse(out);
    } catch { return null; }
  }
  return readJson(CRED_PATH);
}
function writeCredentials(obj) {
  const data = JSON.stringify(obj);
  if (process.platform === "darwin") {
    // -U 更新已存在项；-a 账户名用当前用户即可
    execFileSync("security", [
      "add-generic-password", "-U",
      "-s", KEYCHAIN_SERVICE,
      "-a", os.userInfo().username,
      "-w", data,
    ]);
    return;
  }
  fsSync.mkdirSync(path.dirname(CRED_PATH), { recursive: true });
  fsSync.writeFileSync(CRED_PATH, JSON.stringify(obj, null, 2));
}
function loadAccts() {
  return readJson(ACCTS_PATH()) || [];
}
function saveAccts(list) {
  fsSync.writeFileSync(ACCTS_PATH(), JSON.stringify(list, null, 2));
}
function currentEmail() {
  return readJson(CLAUDE_JSON)?.oauthAccount?.emailAddress || null;
}
// 凭证的 access token 是否已过期（无 expiresAt 视为未知，按未过期处理）
function credExpired(credentials) {
  const exp = credentials?.claudeAiOauth?.expiresAt;
  return typeof exp === "number" && exp <= Date.now();
}
// 把磁盘上的当前登录凭证回存进同邮箱的存档（没存过档的账号不自动入档）。
// refresh token 每次刷新都会轮换，存档若停留在旧快照，切换写回后必 401
// 且 CLI 无法自动续期，只能重新 /login——这正是"提示登录过期"的根因。
function syncAcctFromDisk() {
  const credentials = readJson(CRED_PATH);
  const oauthAccount = readJson(CLAUDE_JSON)?.oauthAccount;
  const email = oauthAccount?.emailAddress;
  if (!credentials || !email) return;
  const list = loadAccts();
  const i = list.findIndex((a) => a.email === email);
  if (i < 0) return;
  list[i] = { ...list[i], credentials, oauthAccount, savedAt: Date.now() };
  saveAccts(list);
}
// 空输入流探测：只走控制通道不消耗 token。凭证过期时子进程启动会触发 CLI
// 刷新，以此验证存档的 refresh token 是否仍有效（成功后凭证文件已被刷新）。
async function verifyAuth() {
  const abort = new AbortController();
  try {
    // 固定用 scratch 当 cwd：探测只走控制通道不耗 token，
    // 但会在 cwd 对应项目下留一个空 session 文件，用 workdir 会污染项目的会话列表
    const cwd = await scratchDir();
    const q = query({
      prompt: (async function* () {
        await new Promise((r) => abort.signal.addEventListener("abort", r));
      })(),
      options: { cwd, permissionMode: "bypassPermissions", abortController: abort },
    });
    await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    try { abort.abort(); } catch {}
  }
}

// 列表：返回各存档账号（不含 token）+ 当前登录邮箱
ipcMain.handle("acctList", async () => {
  const cur = currentEmail();
  const list = loadAccts().map((a) => ({ email: a.email, name: a.name, savedAt: a.savedAt }));
  return { current: cur, accounts: list };
});

// 把当前登录的账号存为一个档（按邮箱去重覆盖）
ipcMain.handle("acctSaveCurrent", async () => {
  const credentials = readCredentials();
  const oauthAccount = readJson(CLAUDE_JSON)?.oauthAccount;
  if (!credentials || !oauthAccount?.emailAddress) {
    return { error: "未找到当前登录凭证，请先用 Claude Code 登录" };
  }
  // 过期快照存进去就是个哑弹（写回时全靠可能已轮换作废的 refresh token），拒绝
  if (credExpired(credentials)) {
    return { error: "当前凭证已过期，请先随便发起一次对话触发刷新后再存档" };
  }
  const email = oauthAccount.emailAddress;
  const list = loadAccts().filter((a) => a.email !== email);
  list.push({
    email,
    name: oauthAccount.displayName || email,
    credentials,
    oauthAccount,
    savedAt: Date.now(),
  });
  saveAccts(list);
  return { ok: true, email };
});

// 切换到某个存档账号
ipcMain.handle("acctSwitch", async (_e, email) => {
  const acct = loadAccts().find((a) => a.email === email);
  if (!acct) return { error: "账号不存在" };
  try {
    // 切换前把当前账号的最新凭证回存，下次切回来才不是旧快照（refresh token 会轮换）
    syncAcctFromDisk();
    writeCredentials(acct.credentials);
    const cj = readJson(CLAUDE_JSON) || {};
    cj.oauthAccount = acct.oauthAccount;
    // 原子写：先写临时文件再 rename 覆盖，避免写到一半被中断/崩溃把真实 ~/.claude.json 截断损坏导致登录失效
    const tmp = `${CLAUDE_JSON}.${process.pid}.tmp`;
    fsSync.writeFileSync(tmp, JSON.stringify(cj, null, 2));
    fsSync.renameSync(tmp, CLAUDE_JSON);
    // 切换账号后立即作废用量缓存与进行中的探测，避免界面在 USAGE_TTL 内仍显示上一个账号的旧用量
    usageCache = { ts: 0, value: null };
    usageInflight = null;
    // 存档已过期：当场探测，CLI 刷新成功就把新凭证回存进档；失败提前告知，
    // 免得用户开聊才撞上 401
    if (credExpired(acct.credentials)) {
      if (await verifyAuth()) syncAcctFromDisk();
      else
        return {
          ok: true,
          email,
          warning: `该账号的存档凭证已失效且自动刷新失败，对话可能报 401：请在终端用 claude /login 重新登录 ${email}`,
        };
    }
    return { ok: true, email };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
});

ipcMain.handle("acctDelete", async (_e, email) => {
  saveAccts(loadAccts().filter((a) => a.email !== email));
  return { ok: true };
});

// ── 打包：三种模式 → 桌面 zip ─────────────────────────────────
// full=全量(含 node_modules/data/.git，零安装) | backup=完整备份(config+data+.git，无 node_modules)
// | dist=给别人(无 data、无 node_modules，含 .git/config)
// opts.withCreds=true 时才打包登录凭证（默认排除，避免分享 zip 泄露）
ipcMain.handle("packAll", async (_e, mode = "full", opts = {}) => {
  try {
    const prefix =
      { full: "claude-tools-portable", backup: "claude-tools-full", dist: "claude-tools-dist" }[mode] ||
      "claude-tools-portable";
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const out = path.join(app.getPath("desktop"), `${prefix}-${stamp}.zip`);
    // 凭证文件：accounts.json 存明文 OAuth、server-token.txt 是手机端访问令牌
    const credFiles = ["data/accounts.json", "data/server-token.txt"];
    // 共同排除：日志、之前生成的任何包（避免自包含）；凭证默认排除
    const excl = ["*.log", "claude-tools-*.zip"];
    if (!opts.withCreds) excl.push(...credFiles);
    if (mode !== "full") excl.push("node_modules/*");
    if (mode === "dist") excl.push("data/*");

    if (process.platform === "win32") {
      // Windows 自带 bsdtar；--exclude 用目录/通配
      const tarExcl = ["--exclude=*.log", "--exclude=claude-tools-*.zip"];
      if (!opts.withCreds) tarExcl.push(...credFiles.map((f) => `--exclude=${f}`));
      if (mode !== "full") tarExcl.push("--exclude=node_modules");
      if (mode === "dist") tarExcl.push("--exclude=data");
      await execFileAsync("tar", ["-a", "-c", "-f", out, ...tarExcl, "."], {
        cwd: TOOLS_DIR,
        maxBuffer: 128 * 1024 * 1024,
      });
    } else {
      // -y：保留符号链接（否则 zip 会把 node_modules/.bin 的链接 follow 成普通文件，解压后 electron 跑不起来）
      await execFileAsync("zip", ["-r", "-y", "-q", out, ".", "-x", ...excl], {
        cwd: TOOLS_DIR,
        maxBuffer: 128 * 1024 * 1024,
      });
    }
    shell.showItemInFolder(out);
    return { path: out, mode };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// ── 本地进化角色增强：四角色对抗思维，无人干预自主决策 ──────────
// 此段永远附加在 brain 服务下发的 evolveAppend 之后，brain 升级时不丢失。
const LOCAL_EVOLVE_PERSONA = `

## 你的工作模式：四角色合一，对抗进化，无人干预自主闭环

你不是一次性执行需求的助手，而是一个持续把这个工具变得更强的自主产品团队——
资深产品经理 + 资深架构师 + 全能程序员 + 测试师集于一身。你的终极目标：
让本工具的产品开发能力在一轮轮进化中自我增强，逼近"无人干预即可独立交付高质量产品"。

你同时扮演以下四个角色，每次进化任务按顺序内化执行，无需等待用户确认：

### 1. 资深产品经理（PM）
- 先问自己：这个需求的本质是什么？解决了用户什么真实痛点？
- 对齐产品目标：是否让工具更易用、更省钱、更简洁？若需求偏离方向，自行调整再实现。
- 拒绝无意义功能：若改动对用户没有可感知价值，直接略过，在总结里说明原因。

### 2. 资深架构师（Architect）
- 改动前评估：影响哪些模块？有无更简单的方案？是否引入不必要的复杂度？
- 优先选最小改动、最低耦合的方案；三个类似调用不抽象，不为假设的未来需求设计。
- 检查数据流、IPC 边界、状态一致性；预判边界条件和异常路径。

### 3. 全能程序员（Developer）
- 按照代码库已有风格实现；只改必要文件；不添加注释除非逻辑非显而易见。
- 保证启动不报错、不破坏现有功能；不运行 npm start / 不重启应用。
- 改完后 Review 自己的改动：逻辑闭环、边界条件、与周边代码一致性。

### 4. 测试师（Tester）
- 改完主动核查：用 Read/Grep 确认修改已落到位、没有遗漏、没有语法错误。
- 对关键路径跑一遍心算：正常流 → 异常流 → 边界值，列出潜在风险并在总结里注明。
- 若发现自己引入了 bug，立即修复再收尾，不留半成品。

### 对抗进化原则（角色间互相挑战）
- 四个角色不是流水线盖章，而是互相对抗：PM 质疑"这真有价值吗"，Architect 反驳"代价是否过高"，Developer 暴露实现陷阱，Tester 假设"它一定有 bug"并去证伪。
- 任一角色给出的方案，下一角色先尝试推翻它；推翻不掉才放行。靠这种内部对抗筛掉自欺的改动。
- 每轮进化都要让工具比上一轮更强：更易用 / 更省 token / 更简洁 / 更稳健。择其一显著推进，拒绝原地打转的"为改而改"。
- 同时反思进化机制本身：若发现自身的角色设定、护栏、提示词有缺陷，可在本次改动里一并优化它（即用对抗进化改进对抗进化）。

### 无人干预原则
- 遇到不确定性：自行选最保守的合理方案，在总结里说明你的判断依据。
- 不向用户提问，不输出"请问您是否……"；决策权完全在你这里。
- 结尾用简体中文**一句话**总结改了什么（角色自述：PM 判断 → Architect 方案 → 开发落点 → 测试结论）。`;

// ── 自进化引擎：改自己的源码并安全应用 ────────────────────────
let evolving = false;
let evolveAbort = null;
let evolveSteer = null; // 进化进行中时挂载：向当前会话追加“调整方向”的消息
let evolveHealthPending = null; // 仅渲染层重载时的待确认检查点
let healthTimer = null;

const gitT = (args) =>
  execFileSync("git", args, { cwd: TOOLS_DIR, maxBuffer: 8 * 1024 * 1024 }).toString();
// 自进化依赖 git 做检查点/回滚。若源码是裸 copy（无 .git），自动初始化一个本地仓库。
function ensureRepo() {
  if (fsSync.existsSync(path.join(TOOLS_DIR, ".git"))) return false;
  gitT(["init"]);
  // 保证有提交身份（即使全局未配置也能 commit）
  try { gitT(["config", "user.name"]); } catch { gitT(["config", "user.name", "ideevolve"]); }
  try { gitT(["config", "user.email"]); } catch { gitT(["config", "user.email", "ideevolve@local"]); }
  // 排除产物/依赖，避免初始提交体积过大
  const gi = path.join(TOOLS_DIR, ".gitignore");
  if (!fsSync.existsSync(gi))
    fsSync.writeFileSync(gi, "node_modules/\n*.log\nclaude-tools-*.zip\ndata/\n");
  gitT(["add", "-A"]);
  gitT(["commit", "-m", "evolve: init repo", "--allow-empty"]);
  return true;
}
function rollback(sha) {
  try {
    gitT(["reset", "--hard", sha]);
    gitT(["clean", "-fd"]);
  } catch {}
}
ipcMain.handle("getIssues", () => issues);
ipcMain.handle("clearIssues", () => {
  issues.length = 0;
  return { ok: true };
});

// ── MCP 面板：列出/编辑/启停 App 级 mcp.json ──────────────────
// 列出已配置 servers（含停用项）+ 原始文本 + 解析错误 + 最近一次连接状态
ipcMain.handle("mcpList", async () => {
  const { servers, raw, error } = await loadMcpFile();
  const statusMap = Object.fromEntries((lastMcpStatus || []).map((m) => [m.name, m.status]));
  const list = Object.entries(servers).map(([name, cfg]) => ({
    name,
    enabled: !(cfg && cfg.disabled),
    status: statusMap[name] || null, // connected/failed/… 或 null（本次会话未加载）
    command: (cfg && (cfg.command || cfg.url || cfg.type)) || "",
  }));
  return { servers: list, raw, error };
});
// 直接保存 mcp.json 原始文本（先校验 JSON，避免写入坏配置）
ipcMain.handle("mcpSave", async (_e, content) => {
  try {
    JSON.parse(content);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    await fs.writeFile(mcpFilePath(), content, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// 启用/停用某个 server（写入 disabled 标记，保留配置便于随时恢复）
ipcMain.handle("mcpToggle", async (_e, { name, enabled }) => {
  const { servers, error } = await loadMcpFile();
  if (error) return { ok: false, error };
  if (!servers[name]) return { ok: false, error: "server 不存在" };
  if (enabled) delete servers[name].disabled;
  else servers[name].disabled = true;
  try {
    await fs.writeFile(mcpFilePath(), JSON.stringify({ mcpServers: servers }, null, 2), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle("getEvolveHistory", () => readEvolveHistory());
ipcMain.handle("clearEvolveHistory", () => { writeEvolveHistory([]); return { ok: true }; });
// 查看某次进化实际改了哪些代码：返回 git diff（检查点 → 本次提交）
ipcMain.handle("evolveDiff", (_e, payload) => {
  const checkpoint = payload && payload.checkpoint;
  if (!checkpoint) return { error: "该记录无检查点，无法查看改动" };
  try {
    let commit = payload && payload.commit;
    if (!commit) {
      // 兼容未记录 commit 的旧条目：检查点之后第一个提交即本次进化的提交
      commit = gitT(["log", "--format=%H", "--reverse", "--ancestry-path", `${checkpoint}..HEAD`])
        .split("\n").filter(Boolean)[0] || "HEAD";
    }
    const stat = gitT(["diff", "--stat", checkpoint, commit]);
    const diff = gitT(["diff", checkpoint, commit]);
    if (!diff.trim()) return { ok: true, diff: "", stat: "", empty: true };
    return { ok: true, diff, stat, commit };
  } catch (err) {
    return { error: String(err?.stderr || err).trim() };
  }
});
ipcMain.handle("evolveRevertFile", (_e, { checkpoint, filePath } = {}) => {
  if (!checkpoint || !filePath) return { error: "参数不完整" };
  try {
    gitT(["checkout", checkpoint, "--", filePath]);
    return { ok: true };
  } catch (err) {
    return { error: String(err?.stderr || err).trim() };
  }
});
ipcMain.handle("getEvolveBacklog", () => readBacklog());
ipcMain.handle("clearEvolveBacklog", () => { writeBacklog([]); return { ok: true }; });
ipcMain.handle("removeEvolveBacklog", (_e, id) => { writeBacklog(readBacklog().filter((x) => x.id !== id)); return { ok: true }; });
ipcMain.handle("updateEvolveBacklog", (_e, { id, patch }) => { updateBacklog(id, patch || {}); return { ok: true }; });
ipcMain.handle("evolveBacklogMove", (_e, { id, direction }) => {
  const list = readBacklog();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return { ok: false };
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= list.length) return { ok: true };
  [list[idx], list[swap]] = [list[swap], list[idx]];
  writeBacklog(list);
  return { ok: true };
});

// 巡检：让 Claude 只读地审视源码，给自己提出一批具体的优化需求，写入优化清单
let auditing = false;
let evolveAuditAbort = null;
ipcMain.handle("evolveAudit", async () => {
  if (auditing) return { error: "巡检进行中" };
  auditing = true;
  const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
  const abort = new AbortController();
  evolveAuditAbort = abort;
  // 超时设 10 分钟：联网调研的巡检常超 4 分钟，中途 abort 会把整轮已消耗的 token 全部作废
  const timer = setTimeout(() => abort.abort(), 600000);
  try {
    send("evolve:log", "🔎 巡检源码 + 联网采集需求，寻找优化点…");
    // 巡检提示词由大脑服务按 recent/open 渲染下发（open-core：核心采集规则不内置在客户端）
    const recent = readEvolveHistory().slice(0, 12).map((h) => (h.requirement || "").split("\n")[0]);
    const open = readBacklog().filter((x) => x.status !== "done").map((x) => x.title);
    let brainResp;
    try {
      brainResp = await brainAuditPrompt(appConfig, { client: "desktop", recent, open });
    } catch (err) {
      const m = String(err.message || err);
      send("evolve:log", "❌ " + m);
      return { error: m };
    }
    const response = query({
      prompt: brainResp.prompt,
      options: { cwd: TOOLS_DIR, permissionMode: "bypassPermissions", maxTurns: 30, abortController: abort, systemPrompt: { type: "preset", preset: "claude_code", append: (brainResp.evolveAppend || "") + LOCAL_EVOLVE_PERSONA }, ...((appConfig.evolveModel || appConfig.model) ? { model: appConfig.evolveModel || appConfig.model } : {}), ...tokenOpts(appConfig) },
    });
    let text = "";
    for await (const msg of response) {
      if (msg.type === "assistant")
        for (const b of msg.message.content) {
          if (b.type === "text") text += b.text;
          else if (b.type === "tool_use") send("evolve:log", `🔧 ${b.name}`);
        }
      else if (msg.type === "result") {
        recordCost("evolve", msg.usage, msg.total_cost_usd); // 巡检消耗记入 evolve
        const au = msg.usage || {};
        send("evolve:usage", { input: au.input_tokens || 0, output: au.output_tokens || 0, cost: msg.total_cost_usd || 0 });
      }
    }
    const m = text.match(/\[[\s\S]*\]/);
    let items = [];
    try { items = JSON.parse(m ? m[0] : text); } catch {}
    if (!Array.isArray(items) || !items.length) {
      send("evolve:log", "⚠️ 巡检未解析出优化点");
      return { error: "未解析出优化点" };
    }
    const added = addBacklog(items);
    send("evolve:backlog", readBacklog());
    send("evolve:log", `📋 巡检完成，新增 ${added} 个优化点`);
    return { ok: true, added };
  } catch (err) {
    if (abort.signal.aborted) { send("evolve:log", "⏹️ 巡检已中止/超时"); return { error: "巡检已中止或超时" }; }
    return { error: String(err?.stack || err) };
  } finally {
    clearTimeout(timer);
    evolveAuditAbort = null;
    auditing = false;
  }
});

ipcMain.on("evolveStop", () => { evolveAbort?.abort(); evolveAuditAbort?.abort(); });
// 进化进行中追加一条“调整方向”消息（流式输入，下一轮会纳入上下文）
ipcMain.on("evolveSteer", (_e, text) => {
  if (evolveSteer && typeof text === "string" && text.trim()) evolveSteer.push(text.trim());
});
ipcMain.on("evolveAlive", () => {
  // 渲染层加载成功的心跳
  try {
    const m = JSON.parse(fsSync.readFileSync(markerPath(), "utf8"));
    if (m.status === "booting") {
      fsSync.unlinkSync(markerPath()); // 重启场景：确认健康，清标记
      markLastEvolve({ status: "applied" }); // 重启自检通过，回填为已应用
    }
  } catch {}
  if (evolveHealthPending) {
    // 重载场景：确认健康
    clearTimeout(healthTimer);
    evolveHealthPending = null;
    if (win && !win.isDestroyed()) win.webContents.send("evolve:log", "✅ 自检通过");
  }
});

ipcMain.handle("evolve", async (_e, { requirement, attachments, projectMemory, evolveMaxTokens: payloadMaxTokens }) => {
  if (evolving) return { error: "已有进化在进行中" };
  if (!requirement || !requirement.trim()) return { error: "需求为空" };
  // 硬性每日消费上限：与 chat handler 保持一致，超限直接拦截
  const maxSpend = appConfig.maxDailySpendUSD;
  if (maxSpend > 0) {
    const s = loadCostStats();
    const today = localDay();
    const todaySpent = s.days[today]
      ? Object.values(s.days[today]).reduce((a, v) => a + (v.cost || 0), 0)
      : 0;
    if (todaySpent >= maxSpend) {
      if (win && !win.isDestroyed())
        win.webContents.send("evolve:error", `今日消费已达 $${maxSpend} 上限，请在设置中调整「每日消费硬上限」。`);
      return { error: `今日消费已达 $${maxSpend} 上限` };
    }
  }
  evolving = true; // 先占锁再取提示词：取词的 await 期间不让第二个进化穿透检查
  // 进化系统提示词由大脑服务下发（成功过一次后离线有缓存兜底），取不到则不开工
  let evolveAppend;
  try {
    const r = await brainEvolveAppend(appConfig, "desktop");
    evolveAppend = r.evolveAppend;
    if (r.cached && win && !win.isDestroyed()) win.webContents.send("evolve:log", "⚠️ 大脑服务不可达，使用本地缓存的提示词");
  } catch (err) {
    evolving = false;
    return { error: String(err.message || err) };
  }
  const abort = new AbortController();
  evolveAbort = abort;
  const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
  const log = (t) => send("evolve:log", t);
  let checkpoint = null;
  try {
    // 1) 检查点
    if (ensureRepo()) log("📦 未检测到 git 仓库，已自动初始化");
    try {
      gitT(["add", "-A"]);
      // 不加 --allow-empty：无未提交改动时此 commit 会失败并被忽略，
      // checkpoint 回退为当前 HEAD，既能用于 diff/回滚，又不会在历史里堆积空的 checkpoint 提交。
      gitT(["commit", "-m", "evolve: checkpoint"]);
    } catch {}
    checkpoint = gitT(["rev-parse", "HEAD"]).trim();
    log(`📌 检查点 ${checkpoint.slice(0, 7)}`);

    // 2) Claude 改源码
    log("🧠 分析并修改源码…");
    const files = (attachments || []).filter((f) => typeof f === "string" && fsSync.existsSync(f));
    let attachNote = "";
    if (files.length) {
      attachNote = `\n\n参考附件（用 Read 工具查看，图片可直接识别）：\n${files.map((f) => "- " + f).join("\n")}`;
      log("📎 附件：" + files.map((f) => path.basename(f)).join(", "));
    }
    // 流式输入：首条是需求；进化期间用户可经 evolveSteer 追加“调整方向”消息，
    // 它们会在下一轮被纳入上下文。一轮结束且无待处理消息时收尾、结束输入流。
    const userMsg = (text) => ({
      type: "user", message: { role: "user", content: text }, parent_tool_use_id: null,
    });
    const steer = { queue: [], wake: null, done: false };
    evolveSteer = {
      push: (text) => {
        steer.queue.push(text);
        log("↳ 调整方向：" + text.split("\n")[0].slice(0, 120));
        // 只有 generator 正在 await（wake 非 null）时才唤醒；
        // 若 wake 为 null 说明 generator 正在运行，queue 里的消息下一轮自然会被消费。
        if (steer.wake !== null) { const w = steer.wake; steer.wake = null; w(); }
      },
    };
    const inputStream = (async function* () {
      yield userMsg(`需求/问题：\n${requirement}${attachNote}\n\n请直接修改源码实现它（用 Read/Grep 定位，Edit/Write 修改）。`);
      while (true) {
        if (steer.queue.length) { yield userMsg(steer.queue.shift()); continue; }
        if (steer.done || abort.signal.aborted) return;
        await new Promise((res) => { steer.wake = res; });
      }
    })();
    const response = query({
      prompt: inputStream,
      options: {
        cwd: TOOLS_DIR,
        permissionMode: "bypassPermissions",
        // 兜底封顶工具循环轮数：防跑飞的长循环把全量上下文反复读入（cache_read 是 evolve 账单大头）。
        // steer 多轮追加需求会消耗轮数，故设得比 audit 宽松。
        maxTurns: 60,
        systemPrompt: { type: "preset", preset: "claude_code", append: (projectMemory ? "# 项目记忆\n" + projectMemory + "\n\n" : "") + (evolveAppend || "") + LOCAL_EVOLVE_PERSONA },
        ...((appConfig.evolveModel || appConfig.model) ? { model: appConfig.evolveModel || appConfig.model } : {}),
        ...tokenOpts(appConfig),
        ...(() => { const mt = payloadMaxTokens > 0 ? Math.floor(payloadMaxTokens) : (appConfig.evolveMaxTokens || null); return mt ? { maxTokens: mt } : {}; })(),
        abortController: abort,
      },
    });
    let summary = "";
    let prevCost = 0, prevUsage = {}; // result 的费用/用量是会话累计值，steer 多轮会出多个 result，记增量防重复计数
    let evolveToolCalls = 0, evolveModel = appConfig.evolveModel || appConfig.model || "";
    for await (const msg of response) {
      if (msg.type === "assistant")
        for (const b of msg.message.content) {
          if (b.type === "text") { summary += b.text; log(b.text); }
          else if (b.type === "tool_use") { evolveToolCalls++; log(`🔧 ${b.name}`); }
        }
      else if (msg.type === "result") {
        const u = msg.usage || {};
        const du = {};
        for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"])
          du[k] = Math.max(0, (u[k] || 0) - (prevUsage[k] || 0));
        const dCost = Math.max(0, (msg.total_cost_usd || 0) - prevCost);
        recordCost("evolve", du, dCost);
        appendActivity({
          source: "evolve",
          model: evolveModel,
          usage: du,
          cost_usd: dCost,
          duration_ms: msg.duration_ms || 0,
          ctx_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
          tool_calls: evolveToolCalls,
          prompt_chars: typeof requirement === "string" ? requirement.length : 0,
          cwd_base: path.basename(TOOLS_DIR),
          status: "done",
        });
        evolveToolCalls = 0; // 重置，避免 steer 多轮累加
        prevCost = Math.max(prevCost, msg.total_cost_usd || 0);
        prevUsage = u;
        send("evolve:usage", { input: u.input_tokens || 0, output: u.output_tokens || 0, cost: msg.total_cost_usd || 0 });
        // 本轮结束：没有待追加的调整消息则收尾结束输入流；否则继续下一轮
        if (!steer.queue.length) { steer.done = true; if (steer.wake) { steer.wake(); steer.wake = null; } }
      }
    }

    // 用户中途停止：丢弃未提交的半成品改动，回滚到检查点，避免被下一轮 checkpoint 吞进历史
    if (abort.signal.aborted) {
      rollback(checkpoint);
      evolving = false;
      recordEvolve({ requirement, checkpoint, summary, changed: [], status: "rolledback", reason: "已停止" });
      send("evolve:done", { stopped: true, summary });
      return { ok: true, stopped: true };
    }

    // 3) 改了哪些文件
    const changed = gitT(["status", "--porcelain"])
      .split("\n").map((s) => s.slice(3).trim()).filter(Boolean);
    if (!changed.length) {
      evolving = false;
      recordEvolve({ requirement, checkpoint, summary, changed: [], status: "nochange" });
      return { ok: true, noChange: true, summary };
    }
    log("📝 改动：" + changed.join(", "));

    // 4) 语法校验
    for (const f of changed) {
      if (/\.(c|m)?js$/.test(f) && fsSync.existsSync(path.join(TOOLS_DIR, f))) {
        try {
          execFileSync("node", ["--check", path.join(TOOLS_DIR, f)]);
        } catch (err) {
          log("❌ 语法校验失败，回滚");
          rollback(checkpoint);
          evolving = false;
          recordEvolve({ requirement, checkpoint, summary, changed, status: "rollback", reason: "语法错误", error: String(err?.stderr || err).trim() });
          send("evolve:done", { error: "语法错误已回滚", detail: String(err?.stderr || err) });
          return { error: "语法错误已回滚" };
        }
      }
    }

    // 5) 提交并应用
    gitT(["add", "-A"]);
    gitT(["commit", "-m", `evolve: ${requirement.slice(0, 60)}`]);
    const commit = gitT(["rev-parse", "HEAD"]).trim(); // 本次进化的提交，供“查看改动”精确取 diff
    const needRelaunch = changed.some((f) => f === "main.js" || f === "preload.cjs");
    evolving = false;

    // 默认不打断进化循环：改动已提交即视为应用成功，不强制重启/重载。
    // 主进程改动写 pending 标记，交由下次（自然/手动）重启时的 bootGuard 自检并在异常时回滚；
    // 渲染层改动下次重载即生效。可在 config.json 设 evolveAutoRestart:true 恢复"改完即重启/重载"。
    if (!appConfig.evolveAutoRestart) {
      if (needRelaunch)
        fsSync.writeFileSync(markerPath(), JSON.stringify({ status: "pending", sha: checkpoint }));
      recordEvolve({ requirement, checkpoint, commit, summary, changed, status: "applied" });
      log(needRelaunch
        ? "✅ 已提交主进程改动，下次重启生效（不打断进化）"
        : "✅ 已提交渲染层改动，下次重载生效（不打断进化）");
      send("evolve:done", { ok: true, changed, summary, deferred: true });
      return { ok: true, changed };
    }

    if (needRelaunch) {
      fsSync.writeFileSync(markerPath(), JSON.stringify({ status: "pending", sha: checkpoint }));
      recordEvolve({ requirement, checkpoint, commit, summary, changed, status: "relaunch" });
      log("🔄 改动涉及主进程，重启自检中…（崩溃将自动回滚）");
      send("evolve:done", { ok: true, relaunch: true, changed, summary });
      setTimeout(() => { app.relaunch(); app.exit(0); }, 900);
    } else {
      recordEvolve({ requirement, checkpoint, commit, summary, changed, status: "applied" });
      log("🔄 重载界面并自检（8s 内无心跳将回滚）…");
      clearTimeout(healthTimer);
      evolveHealthPending = checkpoint;
      healthTimer = setTimeout(() => {
        if (evolveHealthPending) {
          rollback(evolveHealthPending);
          evolveHealthPending = null;
          markLastEvolve({ status: "rolledback", reason: "自检超时" });
          send("evolve:log", "❌ 自检超时，已回滚");
          if (win && !win.isDestroyed()) win.webContents.reload();
        }
      }, 8000);
      send("evolve:done", { ok: true, changed, summary });
      win.webContents.reload();
    }
    return { ok: true, changed };
  } catch (err) {
    evolving = false;
    // 中止（用户停止）：回滚半成品并报为已停止，不当作失败
    if (abort.signal.aborted) {
      if (checkpoint) rollback(checkpoint);
      recordEvolve({ requirement, checkpoint, status: "rolledback", reason: "已停止" });
      send("evolve:done", { stopped: true });
      return { ok: true, stopped: true };
    }
    const m = String(err?.stack || err);
    recordEvolve({ requirement, status: "error", error: m });
    send("evolve:done", { error: m });
    return { error: m };
  } finally {
    evolveSteer = null; // 进化结束（成功/回滚/中止/出错）后停止接受方向调整
  }
});

// ── Git：所有接口按指定仓库路径(repo)工作 ─────────────────────
async function git(args, cwd) {
  return execFileAsync("git", args, {
    cwd: cwd || workdir,
    maxBuffer: 8 * 1024 * 1024,
  });
}
async function isGitRepo(dir) {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}
async function currentBranch(dir) {
  try {
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
    return stdout.trim();
  } catch {
    return "";
  }
}

// ── 对话检查点（对齐 Claude Code /rewind）──────────────────────
// 每轮 chat 前对 git 工作区打快照：用临时索引把「完整工作区(含未跟踪、依 .gitignore)」封进一个
// 游离 commit，不动用户的索引/工作树；轮次完成且文件有改动时，前端提供「撤销本轮改动」按钮回滚。
const checkpoints = new Map(); // id -> { root, head, tree, snap }
let checkpointSeq = 0;

async function gitRoot(dir) {
  try {
    return (await git(["rev-parse", "--show-toplevel"], dir)).stdout.trim();
  } catch {
    return null;
  }
}
// 把当前工作区整体写成一个 tree（空临时索引 + add -A，纯内容、与 HEAD 无关，自动跳过 .gitignore）
async function worktreeTree(root) {
  const idx = path.join(os.tmpdir(), `ct-cp-${process.pid}-${checkpointSeq++}.idx`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args) => execFileAsync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024, env });
  try {
    await run(["add", "-A"]);
    return (await run(["write-tree"])).stdout.trim();
  } finally {
    try { await fs.unlink(idx); } catch {}
  }
}
// 打快照：返回 { root, head, tree, snap }；空仓库(无提交)返回 null（不做检查点，避免边界问题）
async function snapshotWorktree(root) {
  let head;
  try {
    head = (await git(["rev-parse", "HEAD"], root)).stdout.trim();
  } catch {
    return null;
  }
  const tree = await worktreeTree(root);
  const snap = (await git(["commit-tree", tree, "-p", head, "-m", "claude-tools checkpoint"], root)).stdout.trim();
  return { root, head, tree, snap };
}
// 回滚：把工作树/索引硬重置到快照、清掉新增的未跟踪文件，再把分支指针挪回原 HEAD（仅恢复文件内容）
async function restoreCheckpoint(cp) {
  await git(["reset", "--hard", cp.snap], cp.root);
  await git(["clean", "-fd"], cp.root);
  await git(["reset", "--soft", cp.head], cp.root);
}

// 扫描工作目录：自身 + 直接子目录中的 git 仓库（VSCode 多仓库式）
ipcMain.handle("gitRepos", async () => {
  if (!workdir) return [];
  const repos = [];
  if (await isGitRepo(workdir))
    repos.push({ name: path.basename(workdir), path: workdir });
  try {
    const entries = await fs.readdir(workdir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || IGNORE.has(e.name)) continue;
      const child = path.join(workdir, e.name);
      if (await isGitRepo(child)) repos.push({ name: e.name, path: child });
    }
  } catch {}
  for (const r of repos) r.current = await currentBranch(r.path);
  return repos;
});

// ── 仓库文件监听：工作区变化时主动通知渲染层刷新（替代频繁轮询）──
let repoWatcher = null;
let repoWatchPath = null;
let watchDebounce = null;
function stopRepoWatch() {
  if (repoWatcher) { try { repoWatcher.close(); } catch {} }
  repoWatcher = null;
  repoWatchPath = null;
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
}
ipcMain.handle("gitWatch", (_e, repo) => {
  if (repo && repo === repoWatchPath) return true; // 已在监听同一仓库
  stopRepoWatch();
  if (!repo) return false;
  try {
    repoWatcher = fsSync.watch(repo, { recursive: true }, (_evt, file) => {
      const f = (file || "").replace(/\\/g, "/");
      // 忽略噪音：node_modules、.git 内部对象/日志（保留 index/HEAD/refs 等关键变化）
      if (/(^|\/)node_modules(\/|$)/.test(f)) return;
      if (/(^|\/)\.git\/(objects|lfs|logs|hooks)(\/|$)/.test(f)) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      // 立即失效该文件的内容缓存，避免全文搜索返回旧内容
      if (f) {
        const absPath = path.join(repo, f);
        if (contentCache.has(absPath)) {
          const cached = contentCache.get(absPath);
          if (cached && Array.isArray(cached)) contentCacheBytes -= cached.join("\n").length;
          contentCache.delete(absPath);
        }
      }
      watchDebounce = setTimeout(() => {
        watchDebounce = null;
        if (win && !win.isDestroyed()) win.webContents.send("git:changed", repo);
      }, 400);
    });
    repoWatchPath = repo;
    return true;
  } catch (e) {
    crashLog("gitWatch", String(e));
    return false;
  }
});
app.on("before-quit", stopRepoWatch);

ipcMain.handle("gitBranches", async (_e, repo) => {
  try {
    const cur = await currentBranch(repo);
    const { stdout: list } = await git(
      ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"],
      repo
    );
    return {
      current: cur,
      branches: list.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// 提交图：仓库名 + 当前分支 + 最近提交（含 refs/parents）
ipcMain.handle("gitGraph", async (_e, repo) => {
  if (!repo) return { error: "未指定仓库" };
  try {
    const { stdout: top } = await git(["rev-parse", "--show-toplevel"], repo);
    const cur = await currentBranch(repo);
    const SEP = "\x1f"; // 字段分隔
    const REC = "\x1e"; // 记录分隔
    const { stdout } = await git(
      // --all：包含所有分支与远程跟踪分支，fetch 后的新提交也会出现（对齐 VSCode）
      ["log", "--all", "-n", "120", "--date-order", `--pretty=format:%H${SEP}%h${SEP}%P${SEP}%D${SEP}%s${REC}`],
      repo
    );
    const commits = stdout
      .split(REC)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [full, short, parents, refs, subject] = line.split(SEP);
        return {
          full,
          short,
          parents: parents ? parents.split(" ").filter(Boolean) : [],
          refs: refs || "",
          subject: subject || "",
        };
      });
    return { repo: path.basename(top.trim()), current: cur, commits };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

ipcMain.handle("gitCheckout", async (_e, repo, branch) => {
  try {
    await git(["checkout", branch], repo);
    return { ok: true };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// 统一包装：成功 {ok, stdout}，失败 {error}
async function gitOp(repo, args) {
  try {
    const { stdout } = await git(args, repo);
    return { ok: true, stdout };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
}

// ── 工作区状态：暂存区 / 改动 / ahead-behind ──────────────────
ipcMain.handle("gitStatus", async (_e, repo) => {
  if (!repo) return { error: "未指定仓库" };
  try {
    const { stdout } = await git(["status", "--porcelain=v1", "-b"], repo);
    const staged = [];
    const changes = [];
    let branch = "";
    let ahead = 0;
    let behind = 0;
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      if (line.startsWith("## ")) {
        const info = line.slice(3);
        branch = info.split("...")[0].split(" ")[0];
        const a = /ahead (\d+)/.exec(info);
        const b = /behind (\d+)/.exec(info);
        if (a) ahead = +a[1];
        if (b) behind = +b[1];
        continue;
      }
      const x = line[0];
      const y = line[1];
      let p = line.slice(3);
      if (p.includes(" -> ")) p = p.split(" -> ")[1]; // 重命名取新名
      const untracked = x === "?" && y === "?";
      if (!untracked && x !== " ") staged.push({ code: x, path: p });
      if (untracked) changes.push({ code: "?", path: p, untracked: true });
      else if (y !== " ") changes.push({ code: y, path: p });
    }
    return { branch, ahead, behind, staged, changes };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

ipcMain.handle("gitStage", (_e, repo, file) => gitOp(repo, ["add", "--", file]));
ipcMain.handle("gitUnstage", (_e, repo, file) =>
  gitOp(repo, ["restore", "--staged", "--", file])
);
ipcMain.handle("gitStageAll", (_e, repo) => gitOp(repo, ["add", "-A"]));
ipcMain.handle("gitUnstageAll", (_e, repo) => gitOp(repo, ["reset", "-q", "HEAD", "--"]));
ipcMain.handle("gitDiscard", (_e, repo, file, untracked) =>
  untracked
    ? gitOp(repo, ["clean", "-f", "--", file]) // 未跟踪：删除
    : gitOp(repo, ["checkout", "--", file]) // 已跟踪：还原
);
ipcMain.handle("gitDiff", async (_e, repo, file, staged) => {
  // 未跟踪文件用 --no-index 对比 /dev/null（会非零退出，取 stdout）
  try {
    const args = staged
      ? ["diff", "--cached", "--", file]
      : ["diff", "--", file];
    const { stdout } = await git(args, repo);
    if (stdout) return { diff: stdout };
    // 没有 diff（可能是未跟踪），尝试展示整文件为新增
    const nullDev = process.platform === "win32" ? "NUL" : "/dev/null";
    const r = await execFileAsync(
      "git",
      ["diff", "--no-index", "--", nullDev, file],
      { cwd: repo, maxBuffer: 8 * 1024 * 1024 }
    ).catch((e) => ({ stdout: e.stdout || "" }));
    return { diff: r.stdout || "(无差异)" };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});
ipcMain.handle("gitCommit", (_e, repo, message) =>
  gitOp(repo, ["commit", "-m", message])
);
// 返回全部 staged diff（无则 fallback 到全部未提交 diff），供 /review 指令使用
ipcMain.handle("gitStagedDiff", async (_e, repo) => {
  if (!repo) return { error: "未指定仓库" };
  try {
    let { stdout: diff } = await git(["diff", "--cached"], repo);
    if (!diff.trim())
      ({ stdout: diff } = await git(["diff", "HEAD"], repo).catch(() => git(["diff"], repo)));
    return { diff: diff.trim() || "(暂无改动)" };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// ── AI 生成提交信息：取 staged diff（无则取全部未提交 diff），SDK 单轮生成一句中文提交信息 ──
ipcMain.handle("gitGenCommitMsg", async (_e, repo) => {
  if (!repo) return { error: "未指定仓库" };
  try {
    let { stdout: diff } = await git(["diff", "--cached"], repo);
    if (!diff.trim())
      ({ stdout: diff } = await git(["diff", "HEAD"], repo).catch(() => git(["diff"], repo)));
    if (!diff.trim()) {
      // 仅有未跟踪文件时，用文件名列表当上下文
      const { stdout: untracked } = await git(["ls-files", "--others", "--exclude-standard"], repo);
      if (untracked.trim()) diff = "新增未跟踪文件：\n" + untracked;
    }
    if (!diff.trim()) return { error: "没有可生成提交信息的改动" };
    if (diff.length > 12000) diff = diff.slice(0, 12000) + "\n…(diff 已截断)";
    const abort = new AbortController();
    const timer = setTimeout(() => { try { abort.abort(); } catch {} }, 60000);
    try {
      const response = query({
        prompt: `根据以下 git diff 生成一句简洁的中文提交信息（不超过 50 字，动词开头，概括改动意图）。只输出提交信息本身，不要引号、前缀或解释，不要使用任何工具。\n\n${diff}`,
        options: {
          cwd: repo,
          maxTurns: 1,
          permissionMode: "bypassPermissions",
          allowedTools: [],
          abortController: abort,
          ...((appConfig.evolveModel || appConfig.model) ? { model: appConfig.evolveModel || appConfig.model } : {}),
        },
      });
      let text = "";
      for await (const msg of response) {
        if (msg.type === "assistant") {
          for (const b of msg.message.content) if (b.type === "text") text += b.text;
        } else if (msg.type === "result") recordCost("chat", msg.usage, msg.total_cost_usd); // 提交信息生成属用户侧消耗
      }
      const message = text.trim().split("\n").filter(Boolean)[0]?.replace(/^["'“「]|["'”」]$/g, "").trim();
      if (!message) return { error: "生成结果为空" };
      return { message };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// ── 📜 生成 CHANGELOG：本地取上次生成点之后的 git log（零 token），SDK 单轮按 新增/修复/优化 分组，前置写入 CHANGELOG.md ──
ipcMain.handle("gitGenChangelog", async (_e, repo) => {
  if (!repo) return { error: "未指定仓库" };
  const clPath = path.join(repo, "CHANGELOG.md");
  try {
    // 读取已有 CHANGELOG，找最新条目的生成点标记，只取其后的提交（增量、省 token）
    let existing = "";
    try { existing = await fs.readFile(clPath, "utf8"); } catch {}
    const lastSha = existing.match(/<!--\s*changelog-head:\s*([0-9a-f]{7,40})\s*-->/)?.[1];
    let logOut = "";
    if (lastSha) {
      // 标记的提交可能已被 rebase 掉，失败则退回最近 50 条
      ({ stdout: logOut } = await git(["log", "--oneline", `${lastSha}..HEAD`], repo).catch(() => ({ stdout: "" })));
      if (!logOut.trim() && !(await git(["cat-file", "-e", lastSha], repo).then(() => true, () => false)))
        ({ stdout: logOut } = await git(["log", "--oneline", "-50"], repo));
    } else {
      ({ stdout: logOut } = await git(["log", "--oneline", "-50"], repo));
    }
    if (!logOut.trim()) return { error: "没有新的提交可生成 CHANGELOG" };
    let log = logOut.trim().split("\n");
    if (log.length > 200) log = log.slice(0, 200);
    const { stdout: head } = await git(["rev-parse", "--short", "HEAD"], repo);
    const abort = new AbortController();
    const timer = setTimeout(() => { try { abort.abort(); } catch {} }, 90000);
    try {
      const response = query({
        prompt: `把以下 git 提交日志整理成中文 CHANGELOG 条目，按「### 新增」「### 修复」「### 优化」分组（无内容的组省略），每条提交归并为一行「- 描述」，合并同类项、去掉 sha 与无意义提交（如 checkpoint/merge）。只输出 markdown 条目本身，不要版本标题、引号或解释，不要使用任何工具。\n\n${log.join("\n")}`,
        options: {
          cwd: repo,
          maxTurns: 1,
          permissionMode: "bypassPermissions",
          allowedTools: [],
          abortController: abort,
          ...((appConfig.evolveModel || appConfig.model) ? { model: appConfig.evolveModel || appConfig.model } : {}),
        },
      });
      let text = "";
      for await (const msg of response) {
        if (msg.type === "assistant") {
          for (const b of msg.message.content) if (b.type === "text") text += b.text;
        } else if (msg.type === "result") recordCost("chat", msg.usage, msg.total_cost_usd); // changelog 生成属用户侧消耗
      }
      text = text.trim();
      if (!text) return { error: "生成结果为空" };
      // 新条目带生成点标记，下次只增量取其后的提交
      const date = new Date().toISOString().slice(0, 10);
      const entry = `## ${date}\n<!-- changelog-head: ${head.trim()} -->\n\n${text}\n`;
      let content;
      if (/^#\s/.test(existing)) {
        // 已有标题行：插在标题之后、首个旧条目之前
        const nl = existing.indexOf("\n");
        content = existing.slice(0, nl + 1) + "\n" + entry + "\n" + existing.slice(nl + 1).replace(/^\n+/, "");
      } else {
        content = "# Changelog\n\n" + entry + (existing.trim() ? "\n" + existing : "");
      }
      await fs.writeFile(clPath, content, "utf8");
      return { path: clPath };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});

// 某提交改动的文件列表（--root 兼容初始提交）
ipcMain.handle("gitCommitFiles", async (_e, repo, sha) => {
  try {
    const { stdout } = await git(
      ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha],
      repo
    );
    const files = stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const parts = l.split("\t");
        return { code: parts[0][0], path: parts[parts.length - 1] };
      });
    return { files };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});
// 某提交里某文件的 diff（相对其父提交）
ipcMain.handle("gitCommitDiff", async (_e, repo, sha, file) => {
  try {
    const { stdout } = await git(
      ["show", "--format=", "--no-renames", sha, "--", file],
      repo
    );
    return { diff: stdout || "(无差异)" };
  } catch (err) {
    return { error: String(err?.stderr || err?.message || err).trim() };
  }
});
// 当前分支上游（无则返回 null）
async function upstreamOf(repo) {
  try {
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "@{u}"], repo);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
// 远程 origin 是否有同名分支
async function remoteHasBranch(repo, br) {
  try {
    const { stdout } = await git(["ls-remote", "--heads", "origin", br], repo);
    return !!stdout.trim();
  } catch {
    return false;
  }
}
ipcMain.handle("gitPull", async (_e, repo) => {
  if (await upstreamOf(repo)) return gitOp(repo, ["pull", "--no-rebase"]);
  // 无上游：若 origin 有同名分支，从它拉取
  const br = await currentBranch(repo);
  if (br && (await remoteHasBranch(repo, br)))
    return gitOp(repo, ["pull", "--no-rebase", "origin", br]);
  return { error: `当前分支「${br}」没有上游分支，origin 上也没有同名分支，无法拉取。` };
});
ipcMain.handle("gitPush", async (_e, repo) => {
  if (await upstreamOf(repo)) return gitOp(repo, ["push"]);
  // 无上游：push 并用 -u 建立上游到 origin/<分支>
  const br = await currentBranch(repo);
  if (!br || br === "HEAD") return { error: "处于分离 HEAD，无法推送。" };
  return gitOp(repo, ["push", "-u", "origin", br]);
});
ipcMain.handle("gitFetch", (_e, repo) => gitOp(repo, ["fetch", "--all", "--prune"]));
ipcMain.handle("gitCreateBranch", (_e, repo, name) =>
  gitOp(repo, ["checkout", "-b", name])
);

// 丢弃所有更改：还原已跟踪改动 + 删除未跟踪文件/目录
ipcMain.handle("gitDiscardAll", async (_e, repo) => {
  const r1 = await gitOp(repo, ["checkout", "--", "."]);
  const r2 = await gitOp(repo, ["clean", "-fd"]);
  if (r1.error || r2.error)
    return { error: [r1.error, r2.error].filter(Boolean).join("\n") };
  return { ok: true };
});
// 撤销上次提交（保留改动到工作区/暂存区）
ipcMain.handle("gitUndoLastCommit", (_e, repo) =>
  gitOp(repo, ["reset", "--soft", "HEAD~1"])
);
// 提交级操作
ipcMain.handle("gitRevert", (_e, repo, sha) =>
  gitOp(repo, ["revert", "--no-edit", sha])
);
ipcMain.handle("gitResetHard", (_e, repo, sha) =>
  gitOp(repo, ["reset", "--hard", sha])
);
ipcMain.handle("gitResetSoft", (_e, repo, sha) =>
  gitOp(repo, ["reset", "--soft", sha])
);
ipcMain.handle("gitCheckoutCommit", (_e, repo, sha) =>
  gitOp(repo, ["checkout", sha])
);

/** tool_result.content 可能是字符串或 [{type:'text',text}] 数组，统一成文本 */
function normalizeResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => (typeof b === "string" ? b : b?.text ?? JSON.stringify(b)))
      .join("\n");
  if (content == null) return "";
  return JSON.stringify(content);
}
