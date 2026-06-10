import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";

const execFileAsync = promisify(execFile);

/**
 * 读取 App 目录下可选的 mcp.json（App 级 MCP 配置，不影响全局 ~/.claude）。
 * 格式同 Claude Code 的 .mcp.json：{ "mcpServers": { name: {command,args,env} } }
 */
async function readMcpConfig() {
  try {
    const raw = await fs.readFile(path.join(__dirname, "mcp.json"), "utf8");
    const json = JSON.parse(raw);
    const servers = json.mcpServers || json;
    return servers && Object.keys(servers).length ? servers : null;
  } catch {
    return null; // 文件不存在或解析失败 => 不加 MCP
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = __dirname; // App 自身的源码目录（自进化时当 cwd）

// 便携模式：所有运行时数据（对话历史/附件/设置/localStorage/scratch/标记）都放进 tools/data，
// 这样整个 tools 文件夹 copy 到另一台机器即可直接用，无需迁移配置。必须在 app ready 前调用。
app.setPath("userData", path.join(TOOLS_DIR, "data"));

// 配置（含系统提示词等）放在 tools/config.json，可直接编辑；缺失则写入默认
const DEFAULT_CONFIG = {
  systemPromptAppend:
    "始终用简体中文回答，除非用户明确要求使用其他语言。代码、命令、标识符等保持原样。",
  permissionMode: "bypassPermissions",
  model: null,
};
function loadConfig() {
  const file = path.join(TOOLS_DIR, "config.json");
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fsSync.readFileSync(file, "utf8")) };
  } catch {
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
    title: "Claude Tools",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      plugins: true, // 启用 Chromium 内置 PDF 阅读器（iframe 加载本地 PDF）
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

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
  createWindow();
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

// ── 手机/远程端：在 App 内启动 server.mjs（同一 Wi-Fi 用手机浏览器遥控）──
let mobileProc = null;
const MOBILE_PORT = Number(process.env.PORT) || 8787;
function lanIP() {
  return (
    Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address || "localhost"
  );
}
function mobileToken() {
  // 与 server.mjs 同一令牌来源：data/server-token.txt（缺失则由 server 生成后再读）
  try {
    return fsSync.readFileSync(path.join(TOOLS_DIR, "data", "server-token.txt"), "utf8").trim();
  } catch {
    return "";
  }
}
function mobileInfo() {
  const ip = lanIP();
  const token = mobileToken();
  const running = !!mobileProc;
  const url = running ? `http://${ip}:${MOBILE_PORT}/?token=${token}` : "";
  return { running, ip, port: MOBILE_PORT, token, url };
}
ipcMain.handle("mobileStatus", async () => mobileInfo());
ipcMain.handle("mobileStart", async () => {
  if (mobileProc) return mobileInfo();
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
ipcMain.handle("saveConvs", async (_e, data) => {
  try {
    await fs.writeFile(convFile(), JSON.stringify(data));
    return { ok: true };
  } catch (err) {
    return { error: String(err) };
  }
});

// ── 列目录（懒加载，点击文件夹才展开下一层）──────────────────
const IGNORE = new Set(["node_modules", ".git", ".DS_Store"]);
ipcMain.handle("listDir", async (_e, dirPath) => {
  const target = dirPath || workdir;
  if (!target) return [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries
      .filter((d) => !d.name.startsWith(".") && !IGNORE.has(d.name))
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
ipcMain.handle("searchFiles", async (_e, query) => {
  if (!workdir) return [];
  const q = String(query || "").toLowerCase();
  const out = [];
  const MAX = 50; // 最多返回 50 条，避免大仓库卡顿
  async function walk(dir) {
    if (out.length >= MAX) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (out.length >= MAX) return;
      if (d.name.startsWith(".") || IGNORE.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full);
      } else {
        const rel = path.relative(workdir, full).replace(/\\/g, "/");
        if (!q || rel.toLowerCase().includes(q)) {
          out.push({ name: d.name, path: full, rel });
        }
      }
    }
  }
  await walk(workdir);
  // 匹配位置越靠前越优先
  out.sort((a, b) => a.rel.toLowerCase().indexOf(q) - b.rel.toLowerCase().indexOf(q));
  return out;
});

// ── 保存粘贴/拖入的附件，返回绝对路径（供对话引用，让 Claude 读取）──
ipcMain.handle("saveAttachment", async (_e, { name, base64 }) => {
  try {
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

// ── 读取单个文件内容（点击文件预览）─────────────────────────
ipcMain.handle("readFile", async (_e, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 500_000) return "(文件过大，未显示)";
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    return `(读取失败: ${String(err)})`;
  }
});

// ── 二进制读取（PDF 编辑器用），返回 base64 ────────────────────
ipcMain.handle("readFileBuffer", async (_e, filePath) => {
  try {
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

ipcMain.on("chat", async (e, { prompt, resume, convId }) => {
  const abort = new AbortController();
  let stopped = false; // 用户是否已主动停止（避免重复发 chat:stopped）
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
    stop: () => {
      stopped = true;
      try { abort.abort(); } catch {}
      send("chat:stopped", {});
    },
  };
  runs.set(convId, entry);
  // 没选目录也能聊：用一个中性 scratch 目录当 cwd（无项目上下文）；选了目录则用目录（带文件上下文）
  const cwd = workdir || (await scratchDir());
  const mcpServers = await readMcpConfig(); // App 级 mcp.json（可选）

  // 跑一轮查询；resumeId 为要续接的 session（null=新会话）
  const run = async (resumeId) => {
    const response = query({
      prompt,
      options: {
        cwd,
        permissionMode: appConfig.permissionMode || "bypassPermissions", // 全权限（含 Bash）
        includePartialMessages: true, // 逐字流式
        // 系统提示词的追加内容来自 tools/config.json，可直接编辑
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: appConfig.systemPromptAppend || "",
        },
        ...(appConfig.model ? { model: appConfig.model } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        abortController: abort,
        ...(resumeId ? { resume: resumeId } : {}),
      },
    });
    for await (const msg of response) {
      if (stopped) break; // 已停止：不再转发后续事件（含 chat:done），避免界面被重新锁回忙碌
      if (msg.type === "system" && msg.subtype === "init") {
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
        for (const block of msg.message.content) {
          if (block.type === "tool_use")
            send("chat:tool", { id: block.id, name: block.name, input: block.input });
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
        send("chat:done", {
          cost: msg.total_cost_usd,
          ms: msg.duration_ms,
          session: msg.session_id,
        });
      }
    }
  };

  try {
    await run(resume);
  } catch (err) {
    const msg = String(err?.stack || err);
    // 续接的 session 不存在（如换了目录、session 过期）=> 自动起新会话重试一次
    if (resume && !abort.signal.aborted && /No conversation found|session id/i.test(msg)) {
      try {
        await run(null);
      } catch (err2) {
        if (abort.signal.aborted) { if (!stopped) send("chat:stopped", {}); }
        else send("chat:error", { message: String(err2?.stack || err2) });
      }
    } else if (abort.signal.aborted) {
      if (!stopped) send("chat:stopped", {}); // stop() 已发过则不重复
    } else {
      send("chat:error", { message: msg });
    }
  } finally {
    if (runs.get(convId) === entry) runs.delete(convId);
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
  const finish = (v) => {
    try { abort.abort(); } catch {}
    return v;
  };
  try {
    const cwd = workdir || (await scratchDir());
    const q = query({
      prompt: (async function* () {
        await new Promise((r) => abort.signal.addEventListener("abort", r));
      })(),
      options: { cwd, permissionMode: "bypassPermissions", abortController: abort },
    });
    const usage = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
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
    // 失败结果不写缓存，下次仍可立即重试
    if (usage && !usage.error) usageCache = { ts: Date.now(), value: usage };
    return usage;
  } finally {
    usageInflight = null;
  }
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
    writeCredentials(acct.credentials);
    const cj = readJson(CLAUDE_JSON) || {};
    cj.oauthAccount = acct.oauthAccount;
    fsSync.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2));
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
ipcMain.handle("packAll", async (_e, mode = "full") => {
  try {
    const prefix =
      { full: "claude-tools-portable", backup: "claude-tools-full", dist: "claude-tools-dist" }[mode] ||
      "claude-tools-portable";
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const out = path.join(app.getPath("desktop"), `${prefix}-${stamp}.zip`);
    // 共同排除：日志、之前生成的任何包（避免自包含）
    const excl = ["*.log", "claude-tools-*.zip"];
    if (mode !== "full") excl.push("node_modules/*");
    if (mode === "dist") excl.push("data/*");

    if (process.platform === "win32") {
      // Windows 自带 bsdtar；--exclude 用目录/通配
      const tarExcl = ["--exclude=*.log", "--exclude=claude-tools-*.zip"];
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
const EVOLVE_APPEND =
  "你正在改进你自己所在的 Electron 桌面应用「Claude Tools」，源码就在当前工作目录。结构：main.js=Electron 主进程(所有 IPC/git/SDK 调用)；preload.cjs=contextBridge 暴露 window.api；renderer/index.html+renderer.js=界面与逻辑；renderer/pdfeditor.js=PDF 编辑器。务必：① 改完保证应用能正常启动与加载、不破坏现有功能；② 只改必要文件、与周围代码风格一致；③ 不要运行 npm start 或重启应用（宿主会自动重载/重启并自检）。最后用简体中文一句话说明你改了什么。";

ipcMain.handle("getIssues", () => issues);
ipcMain.handle("clearIssues", () => {
  issues.length = 0;
  return { ok: true };
});
ipcMain.handle("getEvolveHistory", () => readEvolveHistory());
ipcMain.handle("clearEvolveHistory", () => { writeEvolveHistory([]); return { ok: true }; });
ipcMain.on("evolveStop", () => evolveAbort?.abort());
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

ipcMain.handle("evolve", async (_e, { requirement, attachments }) => {
  if (evolving) return { error: "已有进化在进行中" };
  if (!requirement || !requirement.trim()) return { error: "需求为空" };
  evolving = true;
  const abort = new AbortController();
  evolveAbort = abort;
  const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
  const log = (t) => send("evolve:log", t);
  try {
    // 1) 检查点
    if (ensureRepo()) log("📦 未检测到 git 仓库，已自动初始化");
    try {
      gitT(["add", "-A"]);
      gitT(["commit", "-m", "evolve: checkpoint", "--allow-empty"]);
    } catch {}
    const checkpoint = gitT(["rev-parse", "HEAD"]).trim();
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
        if (steer.wake) { steer.wake(); steer.wake = null; }
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
        systemPrompt: { type: "preset", preset: "claude_code", append: EVOLVE_APPEND },
        abortController: abort,
      },
    });
    let summary = "";
    for await (const msg of response) {
      if (msg.type === "assistant")
        for (const b of msg.message.content) {
          if (b.type === "text") { summary += b.text; log(b.text); }
          else if (b.type === "tool_use") log(`🔧 ${b.name}`);
        }
      else if (msg.type === "result") {
        // 本轮结束：没有待追加的调整消息则收尾结束输入流；否则继续下一轮
        if (!steer.queue.length) { steer.done = true; if (steer.wake) { steer.wake(); steer.wake = null; } }
      }
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
    const needRelaunch = changed.some((f) => f === "main.js" || f === "preload.cjs");
    evolving = false;
    if (needRelaunch) {
      fsSync.writeFileSync(markerPath(), JSON.stringify({ status: "pending", sha: checkpoint }));
      recordEvolve({ requirement, checkpoint, summary, changed, status: "relaunch" });
      log("🔄 改动涉及主进程，重启自检中…（崩溃将自动回滚）");
      send("evolve:done", { ok: true, relaunch: true, changed, summary });
      setTimeout(() => { app.relaunch(); app.exit(0); }, 900);
    } else {
      recordEvolve({ requirement, checkpoint, summary, changed, status: "applied" });
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

// 扫描工作目录：自身 + 直接子目录中的 git 仓库（VSCode 多仓库式）
ipcMain.handle("gitRepos", async () => {
  if (!workdir) return [];
  const repos = [];
  if (await isGitRepo(workdir))
    repos.push({ name: path.basename(workdir), path: workdir });
  try {
    const entries = await fs.readdir(workdir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || IGNORE.has(e.name)) continue;
      const child = path.join(workdir, e.name);
      if (await isGitRepo(child)) repos.push({ name: e.name, path: child });
    }
  } catch {}
  for (const r of repos) r.current = await currentBranch(r.path);
  return repos;
});

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
