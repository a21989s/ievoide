// 手机/远程客户端服务器：纯 Node（Mac/Windows 通用），SSE 流式，无需额外依赖。
// 在本机跑引擎，手机浏览器连上来遥控；给一个代码文件夹路径即按该目录工作。
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brainEvolveAppend } from "./brain-client.mjs";

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

// 复用 config.json（系统提示词/权限/模型）。
// 每次对话热读取：桌面端切换模型/思考深度会写回 config.json，手机端下一轮立即生效，
// 不用重启服务器（文件很小，读取开销可忽略）。
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); }
  catch { return {}; }
}
// 省 token 旋钮，详见 main.js DEFAULT_CONFIG 注释；与桌面端共用同一份 config.json。
// 行为护栏：以下错误在历史会话日志里反复发生，每次都白烧一整轮缓存上下文。
// chat（默认提示词）与 evolve（大脑下发的提示词）两条路径都追加，统一避错省 token。
const GUARDRAILS = [
  "改/写文件前必须先 Read；若文件可能被外部改过，先重读再 Edit。",
  "commit 前先 git status 确认确有改动，不要盲目 git add && git commit。",
  "引用 commit/文件前先确认其存在，不要凭记忆拼 hash 或路径。",
  "Windows 下避免 node -e 多行 heredoc（会 reset cwd），改用临时脚本文件或单行。",
  "调用 gh 前先确认已登录，未登录则停下来告知用户而非反复重试。",
  "Bash 每次调用 cwd 都会重置，不要反复 cd 同一目录；用绝对路径或在单条命令内 cd。",
  "禁止把 API key/密钥明文写进命令（会进 transcript 被缓存重读且泄露），用环境变量引用。",
  "相互独立的工具调用（多个 Read/Grep/Bash）放在同一轮里并行发出，别一轮一个——每多一轮都会把全上下文重读一遍。",
  "同一文件不要反复整体 Read；先用 Grep 定位行号，再带 offset/limit 针对性读；已读过的内容靠上下文，不要重复读。",
].join("\n");

function tokenOpts(cfg) {
  const o = {};
  if (cfg.fallbackModel) o.fallbackModel = cfg.fallbackModel;
  if (["low", "medium", "high", "xhigh", "max"].includes(cfg.effort)) o.effort = cfg.effort;
  else if (Number.isFinite(cfg.maxThinkingTokens)) o.maxThinkingTokens = cfg.maxThinkingTokens; // 旧配置兼容
  if (Array.isArray(cfg.allowedTools) && cfg.allowedTools.length) o.allowedTools = cfg.allowedTools;
  if (Array.isArray(cfg.disallowedTools) && cfg.disallowedTools.length) o.disallowedTools = cfg.disallowedTools;
  return o;
}

// 未选目录时的中性工作目录（保证 SDK 有合法 cwd，但无项目文件上下文）
function scratchDir() {
  const d = path.join(__dirname, "data", "scratch");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

async function readMcp() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "mcp.json"), "utf8"));
    const s = j.mcpServers || j;
    return s && Object.keys(s).length ? s : null;
  } catch { return null; }
}

// 访问令牌。共享文件放在与安装目录无关的位置（~/.claude-tools/server-token.txt，可用
// CT_TOKEN_FILE 覆盖），桌面 App 与常驻引擎即使从不同目录启动也能读到同一个令牌——
// 否则 App 端读不到引擎的令牌，二维码 URL 会缺 token。
// 取值顺序：CT_TOKEN 环境变量 > 共享文件 > 旧版本地 data/server-token.txt > 新生成。
const sharedTokenFile = process.env.CT_TOKEN_FILE || path.join(os.homedir(), ".claude-tools", "server-token.txt");
const legacyTokenFile = path.join(__dirname, "data", "server-token.txt");
let TOKEN = (process.env.CT_TOKEN || "").trim();
if (!TOKEN) { try { TOKEN = fs.readFileSync(sharedTokenFile, "utf8").trim(); } catch {} }
if (!TOKEN) { try { TOKEN = fs.readFileSync(legacyTokenFile, "utf8").trim(); } catch {} }
if (!TOKEN) TOKEN = crypto.randomBytes(6).toString("hex");
// 始终回写共享文件：无论令牌来自环境变量、旧文件还是新生成，都让 App 端能从同一处读到。
try { fs.mkdirSync(path.dirname(sharedTokenFile), { recursive: true }); fs.writeFileSync(sharedTokenFile, TOKEN); } catch {}
const authed = (req, url) => (url.searchParams.get("token") || req.headers["x-token"]) === TOKEN;

// 对话历史共享存储：与桌面端共用同一个 data/claude-tools-conversations.json。
// 手机端对话由服务器在流式过程中即时落盘（开聊就写、回复中节流刷新、结束收尾），
// 桌面端靠文件监听实时看到手机端新开的对话及进度——不依赖手机页面存活推送（锁屏/断网也不丢）。
const convFile = path.join(__dirname, "data", "claude-tools-conversations.json");
const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// 自进化：同一时刻只允许一个进化会话（与桌面端互不串台，各自进程内串行即可）。
// 进化提示词不再内置：由大脑服务下发（brain-client，含离线缓存兜底），与桌面端同源。
let evolving = false;
// 合并客户端快照(incoming)与磁盘当前(disk)，避免 stale 客户端整份覆盖。
// 规则：磁盘上 running 的对话以磁盘为准（服务器正在流式落盘，客户端没有这部分进度）；
// 其余 id 取客户端版本；磁盘独有的对话保留下来（别端新开的不丢）。history 取并集。
function mergeConvs(disk, incoming) {
  const out = { ...incoming };
  const inList = Array.isArray(incoming.list) ? incoming.list : [];
  const dkList = Array.isArray(disk.list) ? disk.list : [];
  const dkById = new Map(dkList.map((c) => [c && c.id, c]).filter(([id]) => id));
  const list = inList.map((c) => {
    const d = c && dkById.get(c.id);
    if (!d) return c;
    if (d.running) return d; // 流式中的以磁盘为准
    // 防丢：客户端送来空 html 但磁盘已有内容时，保留磁盘的 html/sessionId/cwd——
    // 避免某端短暂空白(如刚加载/切换)的快照把整条对话内容覆盖成空白。
    if (d.html && !(c && c.html)) return { ...c, html: d.html, sessionId: c.sessionId || d.sessionId, cwd: c.cwd || d.cwd };
    return c;
  });
  const inIds = new Set(list.map((c) => c && c.id));
  for (const d of dkList) if (d && d.id && !inIds.has(d.id)) list.push(d); // 磁盘独有的保留
  out.list = list;
  // history 取并集（客户端未携带时也不丢磁盘归档）
  const inHist = Array.isArray(incoming.history) ? incoming.history : [];
  const dkHist = Array.isArray(disk.history) ? disk.history : [];
  const histIds = new Set(inHist.map((h) => h && h.id));
  out.history = [...inHist, ...dkHist.filter((h) => h && h.id && !histIds.has(h.id))];
  return out;
}
// 读取单条对话记录（用于续聊时取回它"出生"时的 cwd——session 文件按目录存盘，
// 跨设备续聊必须沿用同一个 cwd 才能让 CLI 找到对应会话）。找不到返回 null。
async function readConv(convId) {
  if (!convId) return null;
  try {
    const d = JSON.parse(await fsp.readFile(convFile, "utf8"));
    return (Array.isArray(d.list) ? d.list : []).find((x) => x && x.id === convId) || null;
  } catch { return null; }
}
// ── 对话级跨进程锁：手机(server.mjs)与桌面(main.js)同跑同一对话会让两个进程并发
//    resume 同一个 session 文件，触发 CLI "No conversation found" 竞态。用一个共享锁文件
//    串行化：一端在该对话内运行时，另一端先让路（提示稍候），从源头消除竞态。
//    锁带 TTL，持有进程崩溃后到期自动失效，不会把对话永久锁死。──
const LOCK_DIR = path.join(__dirname, "data", "locks");
const LOCK_TTL = 600000; // 10 分钟：单轮极少超过；超时即视为持有者已死，可被接管
const lockFile = (convId) => path.join(LOCK_DIR, String(convId).replace(/[^\w.-]/g, "_") + ".lock");
async function acquireConvLock(convId, owner) {
  if (!convId) return true;
  try {
    await fsp.mkdir(LOCK_DIR, { recursive: true });
    const f = lockFile(convId);
    try {
      const cur = JSON.parse(await fsp.readFile(f, "utf8"));
      if (cur && cur.owner !== owner && Date.now() - (cur.ts || 0) < LOCK_TTL) return false;
    } catch {}
    await fsp.writeFile(f, JSON.stringify({ owner, ts: Date.now() }));
    return true;
  } catch { return true; } // 锁子系统自身故障时不拦截正常使用
}
async function releaseConvLock(convId, owner) {
  if (!convId) return;
  try {
    const cur = JSON.parse(await fsp.readFile(lockFile(convId), "utf8"));
    if (cur && cur.owner === owner) await fsp.unlink(lockFile(convId));
  } catch {}
}
async function updateConv(convId, mut) {
  if (!convId) return;
  try {
    let d = {};
    try { d = JSON.parse(await fsp.readFile(convFile, "utf8")); } catch {}
    if (!Array.isArray(d.list)) d.list = [];
    let c = d.list.find((x) => x && x.id === convId);
    if (!c) { c = { id: convId, title: "新对话", sessionId: null, html: "" }; d.list.unshift(c); }
    mut(c);
    await fsp.mkdir(path.dirname(convFile), { recursive: true });
    await fsp.writeFile(convFile, JSON.stringify(d));
  } catch {}
}
// 启动时清掉上次异常退出可能遗留的 running 标记（否则桌面端会一直显示"手机端进行中"）
(async () => {
  try {
    const d = JSON.parse(await fsp.readFile(convFile, "utf8"));
    let dirty = false;
    for (const c of d.list || []) if (c && c.running) { delete c.running; dirty = true; }
    if (dirty) await fsp.writeFile(convFile, JSON.stringify(d));
  } catch {}
})();

// Claude 账号切换：与桌面端共用存档(accounts.json)。路径由 App 注入，独立运行时回退到默认 userData。
const HOME = os.homedir();
const CRED_PATH = path.join(HOME, ".claude", ".credentials.json");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
// App 把 userData 设为 tools/data（便携化），账号存档即 data/accounts.json；
// 由 App 注入 CT_ACCOUNTS_PATH，独立运行时回退到同目录 data/accounts.json。
const ACCTS_PATH = process.env.CT_ACCOUNTS_PATH || path.join(__dirname, "data", "accounts.json");
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
// 凭证的 access token 是否已过期（无 expiresAt 视为未知，按未过期处理）
const credExpired = (credentials) => {
  const exp = credentials?.claudeAiOauth?.expiresAt;
  return typeof exp === "number" && exp <= Date.now();
};
// 把磁盘上的当前登录凭证回存进同邮箱的存档（与 main.js 同款逻辑）。
// refresh token 每次刷新都会轮换，存档停留在旧快照的话，切换写回后必 401 且无法自动续期。
function syncAcctFromDisk() {
  const credentials = readJsonFile(CRED_PATH);
  const oauthAccount = readJsonFile(CLAUDE_JSON)?.oauthAccount;
  const email = oauthAccount?.emailAddress;
  if (!credentials || !email) return;
  const list = readJsonFile(ACCTS_PATH) || [];
  const i = list.findIndex((a) => a.email === email);
  if (i < 0) return;
  list[i] = { ...list[i], credentials, oauthAccount, savedAt: Date.now() };
  try { fs.writeFileSync(ACCTS_PATH, JSON.stringify(list, null, 2)); } catch {}
}
// 空输入流探测：只走控制通道不消耗 token；凭证过期时子进程启动会触发 CLI 刷新，
// 以此验证存档的 refresh token 是否仍有效（成功后凭证文件已被刷新）。
async function verifyAuth() {
  const abort = new AbortController();
  try {
    const q = query({
      prompt: (async function* () {
        await new Promise((r) => abort.signal.addEventListener("abort", r));
      })(),
      options: { cwd: scratchDir(), permissionMode: "bypassPermissions", abortController: abort },
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

const json = (res, obj, code = 200) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  // 手机端页面
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/mobile.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "renderer", "mobile.html")).pipe(res);
    return;
  }

  // 所有 /api 需令牌
  if (url.pathname.startsWith("/api/") && !authed(req, url)) {
    return json(res, { error: "unauthorized" }, 401);
  }

  if (req.method === "GET" && url.pathname === "/api/convs") {
    try { return json(res, JSON.parse(await fsp.readFile(convFile, "utf8"))); }
    catch { return json(res, { list: [], active: null }); }
  }
  if (req.method === "POST" && url.pathname === "/api/convs") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p; try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      try {
        // 客户端发来的是它内存里的整份快照，可能已过期。不能盲覆盖——否则会把
        // 桌面端/服务器流式过程中刚写进磁盘的新消息整份冲掉（"消息完全不对"的根因）。
        // 读盘后按 id 合并：磁盘上 running 的对话（服务器正在流式落盘）以磁盘为准，
        // 其余取客户端版本；list/history 取并集，避免丢掉别端新开的对话。
        let cur = {};
        try { cur = JSON.parse(await fsp.readFile(convFile, "utf8")); } catch {}
        const merged = mergeConvs(cur, p);
        await fsp.mkdir(path.dirname(convFile), { recursive: true });
        await fsp.writeFile(convFile, JSON.stringify(merged));
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: String(e) }, 500); }
    });
    return;
  }

  // 浏览目录（手机端选代码文件夹用）
  if (req.method === "GET" && url.pathname === "/api/list") {
    const dir = url.searchParams.get("path") || os.homedir();
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const items = entries
        .filter((d) => !d.name.startsWith(".") && d.name !== "node_modules")
        .map((d) => ({ name: d.name, path: path.join(dir, d.name), isDir: d.isDirectory() }))
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      return json(res, { dir, parent: path.dirname(dir), items });
    } catch (e) {
      return json(res, { error: String(e), dir, parent: path.dirname(dir), items: [] });
    }
  }

  // 校验目录是否存在
  if (req.method === "GET" && url.pathname === "/api/checkdir") {
    const p = url.searchParams.get("path") || "";
    try { const st = await fsp.stat(p); return json(res, { ok: st.isDirectory() }); }
    catch { return json(res, { ok: false }); }
  }

  // Git 状态（按选定文件夹当仓库）
  if (req.method === "GET" && url.pathname === "/api/git/status") {
    const cwd = url.searchParams.get("path") || "";
    try {
      const { stdout } = await git(["status", "--porcelain=v1", "-b"], cwd);
      const staged = [], changes = [];
      let branch = "", ahead = 0, behind = 0;
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("## ")) {
          const info = line.slice(3);
          branch = info.split("...")[0].split(" ")[0];
          const a = /ahead (\d+)/.exec(info), b = /behind (\d+)/.exec(info);
          if (a) ahead = +a[1]; if (b) behind = +b[1];
          continue;
        }
        const x = line[0], y = line[1];
        let p = line.slice(3); if (p.includes(" -> ")) p = p.split(" -> ")[1];
        const untracked = x === "?" && y === "?";
        if (!untracked && x !== " ") staged.push({ code: x, path: p });
        if (untracked) changes.push({ code: "?", path: p, untracked: true });
        else if (y !== " ") changes.push({ code: y, path: p });
      }
      return json(res, { branch, ahead, behind, staged, changes });
    } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
  }

  // Git diff（单文件）
  if (req.method === "GET" && url.pathname === "/api/git/diff") {
    const cwd = url.searchParams.get("path") || "";
    const file = url.searchParams.get("file") || "";
    const staged = url.searchParams.get("staged") === "1";
    try {
      const { stdout } = await git(staged ? ["diff", "--cached", "--", file] : ["diff", "--", file], cwd);
      return json(res, { diff: stdout || "(无差异，可能是未跟踪文件)" });
    } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
  }

  // Git 提交历史
  if (req.method === "GET" && url.pathname === "/api/git/log") {
    const cwd = url.searchParams.get("path") || "";
    try {
      const SEP = "\x1f", REC = "\x1e";
      const { stdout } = await git(
        ["log", "--all", "-n", "60", "--date-order", `--pretty=format:%H${SEP}%h${SEP}%D${SEP}%s${REC}`],
        cwd
      );
      const commits = stdout.split(REC).map((s) => s.trim()).filter(Boolean).map((l) => {
        const [full, short, refs, subject] = l.split(SEP);
        return { full, short, refs: refs || "", subject: subject || "" };
      });
      return json(res, { commits });
    } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
  }
  // 某提交改动的文件
  if (req.method === "GET" && url.pathname === "/api/git/commitfiles") {
    const cwd = url.searchParams.get("path") || "", sha = url.searchParams.get("sha") || "";
    try {
      const { stdout } = await git(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha], cwd);
      const files = stdout.split("\n").filter(Boolean).map((l) => { const p = l.split("\t"); return { code: p[0][0], path: p[p.length - 1] }; });
      return json(res, { files });
    } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
  }
  // 某提交里某文件的 diff
  if (req.method === "GET" && url.pathname === "/api/git/commitdiff") {
    const cwd = url.searchParams.get("path") || "", sha = url.searchParams.get("sha") || "", file = url.searchParams.get("file") || "";
    try {
      const { stdout } = await git(["show", "--format=", "--no-renames", sha, "--", file], cwd);
      return json(res, { diff: stdout || "(无差异)" });
    } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
  }
  // Claude 账号列表（存档账号 + 当前登录邮箱）
  if (req.method === "GET" && url.pathname === "/api/accounts") {
    const current = readJsonFile(CLAUDE_JSON)?.oauthAccount?.emailAddress || null;
    const accounts = (readJsonFile(ACCTS_PATH) || []).map((a) => ({ email: a.email, name: a.name, savedAt: a.savedAt }));
    return json(res, { current, accounts });
  }
  // 切换到某个存档账号（写回凭证 + 合并身份，使后续对话生效）
  if (req.method === "POST" && url.pathname === "/api/account/switch") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p; try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      const acct = (readJsonFile(ACCTS_PATH) || []).find((a) => a.email === p.email);
      if (!acct) return json(res, { error: "账号不存在" });
      try {
        // 切换前把当前账号的最新凭证回存，下次切回来才不是旧快照
        syncAcctFromDisk();
        await fsp.mkdir(path.dirname(CRED_PATH), { recursive: true });
        await fsp.writeFile(CRED_PATH, JSON.stringify(acct.credentials, null, 2));
        const cj = readJsonFile(CLAUDE_JSON) || {};
        cj.oauthAccount = acct.oauthAccount;
        await fsp.writeFile(CLAUDE_JSON, JSON.stringify(cj, null, 2));
        // 存档已过期：当场探测，CLI 刷新成功就把新凭证回存进档；失败提前告知
        if (credExpired(acct.credentials)) {
          if (await verifyAuth()) syncAcctFromDisk();
          else
            return json(res, {
              ok: true,
              email: acct.email,
              warning: `该账号的存档凭证已失效且自动刷新失败，对话可能报 401：请在电脑终端用 claude /login 重新登录 ${acct.email}`,
            });
        }
        return json(res, { ok: true, email: acct.email });
      } catch (e) { return json(res, { error: String(e?.message || e) }); }
    });
    return;
  }

  // 上传附件（手机选的文件存到本机，返回绝对路径供对话引用）
  if (req.method === "POST" && url.pathname === "/api/upload") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p; try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      try {
        const dir = path.join(__dirname, "data", "attachments");
        await fsp.mkdir(dir, { recursive: true });
        const safe = (p.name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
        const file = path.join(dir, Date.now() + "-" + safe);
        await fsp.writeFile(file, Buffer.from(p.base64, "base64"));
        return json(res, { path: file, name: safe });
      } catch (e) { return json(res, { error: String(e) }); }
    });
    return;
  }

  // Git 操作（暂存/提交/拉推等）
  if (req.method === "POST" && url.pathname === "/api/git") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p; try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      const { action, path: cwd, file, message } = p;
      const run = async (args) => { await git(args, cwd); return json(res, { ok: true }); };
      try {
        if (action === "stage") return run(["add", "--", file]);
        if (action === "unstage") return run(["restore", "--staged", "--", file]);
        if (action === "stageAll") return run(["add", "-A"]);
        if (action === "unstageAll") return run(["reset", "-q", "HEAD", "--"]);
        if (action === "discard") return run(["checkout", "--", file]);
        if (action === "commit") {
          if (!message) return json(res, { error: "提交信息为空" });
          return run(["commit", "-m", message]);
        }
        if (action === "pull") return run(["pull", "--no-rebase"]);
        if (action === "push") return run(["push"]);
        return json(res, { error: "未知操作" });
      } catch (e) { return json(res, { error: String(e?.stderr || e?.message || e).trim() }); }
    });
    return;
  }

  // 对话：SSE 流式
  if (req.method === "POST" && url.pathname === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p;
      try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      const { prompt, cwd, resume, convId, title, html: baseHtml } = p;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      // 对话级锁：桌面端正在同一对话内运行时让路，避免并发 resume 同一 session 的竞态。
      if (!(await acquireConvLock(convId, "mobile"))) {
        send("error", { message: "该对话正在桌面端回复中，请稍候再发（避免两端同时续接同一会话）。" });
        return res.end();
      }
      let abort = new AbortController(); // 可重建：续接失败重试时若旧控制器已被（误）中止，换新的
      // 客户端断开连接才中止（监听响应连接，不是请求体——请求体读完就会触发 req close）。
      // 经 Cloudflare Tunnel 等代理时，close 可能在会话仍需继续时被提前触发，故重试逻辑不死守它。
      res.on("close", () => abort.abort());

      // ── 对话进度即时落盘（见 updateConv 注释）。baseHtml 是手机端发送时
      //    已含用户消息的快照，服务器只负责往后追加助手回复部分。──
      let asstText = "", extraHtml = "", convSession = resume || null;
      let lastFlush = 0, flushTimer = null;
      const convHtml = () =>
        (baseHtml || "") +
        `<div class="msg assistant"><div class="role">Claude</div><div class="bubble">${escHtml(asstText || "…")}</div>${extraHtml}</div>`;
      const flush = (final = false) => {
        if (!convId) return;
        if (!final && Date.now() - lastFlush < 1200) {
          if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 1200 - (Date.now() - lastFlush));
          return;
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        lastFlush = Date.now();
        return updateConv(convId, (c) => {
          if (title) c.title = title;
          c.html = convHtml();
          c.running = !final; // 桌面端据此显示"手机端进行中"
          if (convSession) c.sessionId = convSession;
          // 记下这条对话实际用的 cwd，供下次（含跨设备）续聊沿用
          if (effCwd && !c.cwd) c.cwd = effCwd;
        });
      };
      // 错误同时发给客户端 + 记入落盘 html（手机已断开时桌面端也能看到出错原因）
      const sendErr = (m) => {
        send("error", { message: m });
        extraHtml += `<div class="meta" style="color:#e57373">出错了：${escHtml(String(m).slice(0, 400))}</div>`;
      };
      // 续聊时优先用对话"出生"时存下的 cwd：session 文件按项目目录存盘，
      // 沿用同一个 cwd 才能让 CLI 找到对应会话（跨设备续聊不再丢上下文）。
      // 新对话/记录里没存 cwd 时，回退到本次请求带来的 cwd。
      let effCwd = cwd;
      if (resume) {
        const stored = await readConv(convId);
        if (stored && stored.cwd) effCwd = stored.cwd;
      }
      try {
        const mcpServers = await readMcp();
        const cfg = loadCfg(); // 热读取，桌面端旋钮改动立即生效
        // 公共参数；每次调用新建子进程，子进程启动时 Claude Code CLI 会重新读取/刷新
        // ~/.claude/.credentials.json 里的订阅 OAuth token。
        const baseOpts = {
          // 未选目录时用中性 scratch 目录当 cwd（与桌面端一致）：
          // 避免以 homedir 为项目目录——会把家目录的 CLAUDE.md/git 状态等无关上下文喂给模型，白耗 token
          cwd: effCwd || scratchDir(),
          permissionMode: cfg.permissionMode || "bypassPermissions",
          includePartialMessages: true,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: cfg.systemPromptAppend || ("始终用简体中文回答，除非用户明确要求其他语言。\n" + GUARDRAILS),
          },
          ...(cfg.model ? { model: cfg.model } : {}),
          ...tokenOpts(cfg),
          ...(mcpServers ? { mcpServers } : {}),
          abortController: abort,
        };

        // 跑一次完整的流式会话；任一异常向上抛给重试逻辑处理。
        const runOnce = async (opts) => {
          asstText = ""; extraHtml = ""; // 重试会产出全新回复，清掉上一次的累积
          flush(); // 开聊即落盘：桌面端立刻看到这个（新）对话和用户消息
          const r = query({ prompt, options: opts });
          for await (const msg of r) {
            if (msg.type === "stream_event") {
              const e = msg.event;
              if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
                send("chunk", { text: e.delta.text });
                asstText += e.delta.text; flush();
              }
            } else if (msg.type === "assistant") {
              for (const b of msg.message.content)
                if (b.type === "tool_use") {
                  send("tool", { name: b.name });
                  extraHtml += `<div class="tool">🔧 ${escHtml(b.name)}</div>`; flush();
                }
            } else if (msg.type === "result") {
              const u = msg.usage || {};
              convSession = msg.session_id || convSession;
              extraHtml += `<div class="meta">用时 ${msg.duration_ms}ms</div>`;
              send("done", {
                session: msg.session_id,
                cost: msg.total_cost_usd,
                ms: msg.duration_ms,
                usage: {
                  input: u.input_tokens ?? 0,
                  output: u.output_tokens ?? 0,
                  cacheRead: u.cache_read_input_tokens ?? 0,
                  cacheWrite: u.cache_creation_input_tokens ?? 0,
                },
              });
            }
          }
        };

        // 认证失效（Pro 订阅 OAuth token 过期/失效）的特征。
        const isAuthErr = (m) =>
          /\b401\b|invalid authentication|failed to authenticate|unauthorized|oauth token has expired|please run \/login/i.test(m);

        try {
          await runOnce({ ...baseOpts, ...(resume ? { resume } : {}) });
        } catch (err) {
          const m = String(err?.stack || err);
          if (resume && /No conversation found|session id/i.test(m) && !res.writableEnded) {
            // 续接失败：换了目录 / session 过期 / 手机与桌面并发 resume 同一会话时 CLI 查找竞态。
            // 起新会话重试一次。判定用"响应是否真的已结束(writableEnded)"而非 abort——
            // 经代理(Cloudflare Tunnel)时 abort 可能被提前误触发，但只要还能往回写就值得重试。
            if (abort.signal.aborted) abort = new AbortController(); // 旧控制器已中止，重试要用新的
            try { await runOnce({ ...baseOpts, abortController: abort }); }
            catch (e2) { sendErr(String(e2?.stack || e2)); }
          } else if (isAuthErr(m) && !abort.signal.aborted) {
            // 401：订阅 token 过期。重试时新起子进程会触发 CLI 自动刷新凭证，
            // 稍等片刻再试，给后台刷新留出时间，最多重试 3 次。
            send("info", { message: "登录凭证已过期，正在刷新并重试…" });
            let recovered = false;
            for (let i = 0; i < 3 && !recovered && !abort.signal.aborted; i++) {
              await new Promise((r) => setTimeout(r, 1500));
              try {
                await runOnce({ ...baseOpts, ...(resume ? { resume } : {}) });
                recovered = true;
              } catch (e3) {
                const m3 = String(e3?.stack || e3);
                if (!isAuthErr(m3)) { sendErr(m3); recovered = true; }
              }
            }
            if (!recovered && !abort.signal.aborted)
              sendErr("认证刷新失败：请在终端运行 `claude` 重新 /login 后再试。");
          } else {
            sendErr(m);
          }
        }
      } catch (err) {
        sendErr(String(err?.stack || err));
      }
      // 收尾落盘：写入最终 html + sessionId，并清掉 running 标记（中断/出错也会走到这里）
      try { await flush(true); } catch {}
      try { await releaseConvLock(convId, "mobile"); } catch {}
      res.end();
    });
    return;
  }

  // ── 自进化：让 App 改自身源码（git 检查点 + 语法校验 + 失败自动回滚）──
  // 与桌面端 main.js 的 evolve 同源：cwd 固定为本服务源码目录 __dirname。
  if (req.method === "POST" && url.pathname === "/api/evolve") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p;
      try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      const requirement = (p.requirement || "").trim();
      const attachments = Array.isArray(p.attachments) ? p.attachments : [];
      const resume = typeof p.resume === "string" && p.resume ? p.resume : null; // 续接同一进化会话，支持连续追问
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache", connection: "keep-alive",
      });
      const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      const log = (t) => send("log", { text: t });
      if (!requirement) { send("done", { error: "需求为空" }); return res.end(); }
      if (evolving) { send("done", { error: "已有进化在进行中" }); return res.end(); }
      evolving = true; // 先占锁再取提示词：取词的 await 期间不让第二个进化穿透检查
      // 进化系统提示词由大脑服务下发，取不到（无缓存）则不开工
      let evolveAppend;
      try {
        const r = await brainEvolveAppend(loadCfg(), "server");
        evolveAppend = r.evolveAppend;
        if (r.cached) log("⚠️ 大脑服务不可达，使用本地缓存的提示词");
      } catch (err) {
        evolving = false;
        send("done", { error: String(err?.message || err) }); return res.end();
      }
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      const gt = (args) => git(args, __dirname).then((r) => (r.stdout || "").toString());
      let checkpoint = null;
      try {
        // 1) 检查点
        if (!fs.existsSync(path.join(__dirname, ".git"))) {
          await gt(["init"]);
          try { await gt(["config", "user.name"]); } catch { await gt(["config", "user.name", "ideevolve"]); }
          try { await gt(["config", "user.email"]); } catch { await gt(["config", "user.email", "ideevolve@local"]); }
          await gt(["add", "-A"]); try { await gt(["commit", "-m", "evolve: init repo", "--allow-empty"]); } catch {}
          log("📦 未检测到 git 仓库，已自动初始化");
        }
        try { await gt(["add", "-A"]); await gt(["commit", "-m", "evolve: checkpoint"]); } catch {}
        checkpoint = (await gt(["rev-parse", "HEAD"])).trim();
        log(`📌 检查点 ${checkpoint.slice(0, 7)}`);

        // 2) Claude 改源码
        log("🧠 分析并修改源码…");
        const files = attachments.filter((f) => typeof f === "string" && fs.existsSync(f));
        let attachNote = "";
        if (files.length) {
          attachNote = `\n\n参考附件（用 Read 工具查看，图片可直接识别）：\n${files.map((f) => "- " + f).join("\n")}`;
          log("📎 附件：" + files.map((f) => path.basename(f)).join(", "));
        }
        const cfg = loadCfg();
        // 公共的 evolve 会话参数；测试门禁的 fix 轮复用，靠 session 续接同一上下文。
        const evolveOpts = {
          cwd: __dirname,
          permissionMode: "bypassPermissions",
          maxTurns: 50, // 对抗评估 + 实现 + 自测/修复循环需要更多轮次
          systemPrompt: { type: "preset", preset: "claude_code", append: evolveAppend + "\n" + GUARDRAILS },
          ...((cfg.evolveModel || cfg.model) ? { model: cfg.evolveModel || cfg.model } : {}),
          ...tokenOpts(cfg),
          abortController: abort,
        };
        let summary = "", session = resume;
        // 跑一轮 query 并把流式输出转发给前端；session 续接让 fix 轮看得到前文。
        const runQuery = async (prompt) => {
          const response = query({ prompt, options: { ...evolveOpts, ...(session ? { resume: session } : {}) } });
          for await (const msg of response) {
            if (msg.type === "assistant")
              for (const b of msg.message.content) {
                if (b.type === "text") { summary += b.text; send("chunk", { text: b.text }); }
                else if (b.type === "tool_use") send("tool", { name: b.name });
              }
            else if (msg.type === "result") session = msg.session_id || session;
          }
        };

        // 2) 对抗式生成方案 → 评估通过 → 实现（分阶段，不跳步）
        await runQuery(
          `需求/问题：\n${requirement}${attachNote}\n\n` +
          `按以下阶段执行，不要跳步：\n` +
          `1) 方案：先用 Read/Grep 摸清现状，提出实现方案，明确改动点、边界条件、风险。\n` +
          `2) 对抗评估：扮演挑剔的审稿人逐条质疑该方案——哪里会出错、漏了什么、有无更简单可靠的做法；发现问题就改方案，直到自己也挑不出毛病。\n` +
          `3) 评估全部通过后再动手改源码（用 Edit/Write）。\n` +
          `4) 自测：改完立即用 Bash 跑验证，不通过就修，直到通过再结束。`
        );

        // 用户中途停止：丢弃半成品改动，回滚到检查点
        if (abort.signal.aborted) {
          try { await gt(["reset", "--hard", checkpoint]); await gt(["clean", "-fd"]); } catch {}
          evolving = false;
          send("done", { stopped: true, summary, session }); return res.end();
        }

        // 3) 改了哪些文件
        let changed = (await gt(["status", "--porcelain"]))
          .split("\n").map((s) => s.slice(3).trim()).filter(Boolean);
        if (!changed.length) {
          evolving = false;
          send("done", { noChange: true, summary, session }); return res.end();
        }
        log("📝 改动：" + changed.join(", "));

        // 4) 测试门禁：逐个语法校验改动文件 + 跑项目自带 dryrun；
        //    不过就把报错回灌给 agent 修（resume 续接），循环直到通过或超次数。
        const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
        const runTests = async () => {
          const cur = (await gt(["status", "--porcelain"]))
            .split("\n").map((s) => s.slice(3).trim()).filter(Boolean);
          for (const f of cur) { // dryrun 未覆盖 server.mjs 等，逐个补校验
            if (/\.(c|m)?js$/.test(f) && fs.existsSync(path.join(__dirname, f))) {
              try { await execFileAsync("node", ["--check", path.join(__dirname, f)]); }
              catch (e) { return `语法错误 ${f}:\n` + String(e?.stderr || e); }
            }
          }
          try { await execFileAsync(npmBin, ["run", "dryrun"], { cwd: __dirname, maxBuffer: 8 * 1024 * 1024 }); return null; }
          catch (e) {
            if (e?.code === "ENOENT") { log("⚠️ 未找到 npm，跳过 dryrun（已逐文件语法校验）"); return null; }
            return String(e?.stderr || e?.stdout || e?.message || e);
          }
        };
        let testErr = await runTests();
        for (let round = 1; testErr && round <= 3 && !abort.signal.aborted; round++) {
          log(`❌ 测试未通过，第 ${round}/3 轮修复…`);
          await runQuery(`测试未通过，报错如下，请修复后再自测，直到通过：\n${testErr.slice(0, 2000)}`);
          testErr = await runTests();
        }
        if (testErr) {
          log("❌ 多轮修复后测试仍未通过，回滚");
          try { await gt(["reset", "--hard", checkpoint]); await gt(["clean", "-fd"]); } catch {}
          evolving = false;
          send("done", { error: "测试未通过已回滚", detail: testErr.slice(0, 400), session });
          return res.end();
        }
        log("✅ 测试通过");

        // 5) 提交并应用（重算改动清单，纳入修复轮的改动）
        changed = (await gt(["status", "--porcelain"]))
          .split("\n").map((s) => s.slice(3).trim()).filter(Boolean);
        await gt(["add", "-A"]);
        await gt(["commit", "-m", `evolve: ${requirement.slice(0, 60)}`]);
        const commit = (await gt(["rev-parse", "HEAD"])).trim();
        log("✅ 已提交 " + commit.slice(0, 7));
        evolving = false;
        send("done", { ok: true, summary, changed, commit, session });
      } catch (err) {
        evolving = false;
        if (checkpoint && abort.signal.aborted) { try { await gt(["reset", "--hard", checkpoint]); await gt(["clean", "-fd"]); } catch {} }
        send("done", { error: String(err?.message || err).slice(0, 400) });
      }
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  const ip =
    Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ||
    "localhost";
  const publicUrl = (process.env.CT_PUBLIC_URL || "https://dev.feioz.com").replace(/\/+$/, "");
  console.log("\n=== Claude Tools 手机/远程端已启动 ===");
  console.log(`  本机访问 : http://localhost:${PORT}/?token=${TOKEN}`);
  console.log(`  公网访问 : ${publicUrl}/?token=${TOKEN}   (任意网络，经 Cloudflare Tunnel，见 REMOTE-ACCESS.md)`);
  console.log(`  局域网   : http://${ip}:${PORT}/?token=${TOKEN}   (手机与本机同一 Wi-Fi)`);
  console.log(`  访问令牌 : ${TOKEN}`);
  console.log("  ⚠️ 该服务以全权限运行 Claude，请勿暴露到公网且妥善保管令牌。\n");
});
