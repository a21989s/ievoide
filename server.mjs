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

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

// 复用 config.json（系统提示词/权限/模型）
const cfg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); }
  catch { return {}; }
})();
const sysAppend = cfg.systemPromptAppend || "始终用简体中文回答，除非用户明确要求其他语言。";
const permissionMode = cfg.permissionMode || "bypassPermissions";

async function readMcp() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "mcp.json"), "utf8"));
    const s = j.mcpServers || j;
    return s && Object.keys(s).length ? s : null;
  } catch { return null; }
}

// 访问令牌：优先环境变量 CT_TOKEN，其次 data/server-token.txt，否则随机生成并保存
const tokenFile = path.join(__dirname, "data", "server-token.txt");
let TOKEN = (process.env.CT_TOKEN || "").trim();
if (!TOKEN) { try { TOKEN = fs.readFileSync(tokenFile, "utf8").trim(); } catch {} }
if (!TOKEN) {
  TOKEN = crypto.randomBytes(6).toString("hex");
  try { fs.mkdirSync(path.dirname(tokenFile), { recursive: true }); fs.writeFileSync(tokenFile, TOKEN); } catch {}
}
const authed = (req, url) => (url.searchParams.get("token") || req.headers["x-token"]) === TOKEN;

// Claude 账号切换：与桌面端共用存档(accounts.json)。路径由 App 注入，独立运行时回退到默认 userData。
const HOME = os.homedir();
const CRED_PATH = path.join(HOME, ".claude", ".credentials.json");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
// App 把 userData 设为 tools/data（便携化），账号存档即 data/accounts.json；
// 由 App 注入 CT_ACCOUNTS_PATH，独立运行时回退到同目录 data/accounts.json。
const ACCTS_PATH = process.env.CT_ACCOUNTS_PATH || path.join(__dirname, "data", "accounts.json");
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

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

  // 对话历史共享存储：与桌面端共用同一个 data/claude-tools-conversations.json
  const convFile = path.join(__dirname, "data", "claude-tools-conversations.json");
  if (req.method === "GET" && url.pathname === "/api/convs") {
    try { return json(res, JSON.parse(await fsp.readFile(convFile, "utf8"))); }
    catch { return json(res, { list: [], active: null }); }
  }
  if (req.method === "POST" && url.pathname === "/api/convs") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let p; try { p = JSON.parse(body); } catch { return json(res, { error: "bad json" }, 400); }
      try {
        // 客户端未携带 history 时，保留磁盘上已有的归档历史，避免被覆盖丢失
        if (p && p.history === undefined) {
          try { const cur = JSON.parse(await fsp.readFile(convFile, "utf8")); if (Array.isArray(cur.history)) p.history = cur.history; } catch {}
        }
        await fsp.mkdir(path.dirname(convFile), { recursive: true });
        await fsp.writeFile(convFile, JSON.stringify(p));
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
        await fsp.mkdir(path.dirname(CRED_PATH), { recursive: true });
        await fsp.writeFile(CRED_PATH, JSON.stringify(acct.credentials, null, 2));
        const cj = readJsonFile(CLAUDE_JSON) || {};
        cj.oauthAccount = acct.oauthAccount;
        await fsp.writeFile(CLAUDE_JSON, JSON.stringify(cj, null, 2));
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
      const { prompt, cwd, resume } = p;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      const abort = new AbortController();
      // 客户端断开连接才中止（监听响应连接，不是请求体——请求体读完就会触发 req close）
      res.on("close", () => abort.abort());
      try {
        const mcpServers = await readMcp();
        const r = query({
          prompt,
          options: {
            cwd: cwd || os.homedir(),
            permissionMode,
            includePartialMessages: true,
            systemPrompt: { type: "preset", preset: "claude_code", append: sysAppend },
            ...(cfg.model ? { model: cfg.model } : {}),
            ...(mcpServers ? { mcpServers } : {}),
            abortController: abort,
            ...(resume ? { resume } : {}),
          },
        });
        for await (const msg of r) {
          if (msg.type === "stream_event") {
            const e = msg.event;
            if (e?.type === "content_block_delta" && e.delta?.type === "text_delta")
              send("chunk", { text: e.delta.text });
          } else if (msg.type === "assistant") {
            for (const b of msg.message.content)
              if (b.type === "tool_use") send("tool", { name: b.name });
          } else if (msg.type === "result") {
            send("done", { session: msg.session_id, cost: msg.total_cost_usd, ms: msg.duration_ms });
          }
        }
      } catch (err) {
        const m = String(err?.stack || err);
        if (abort.signal.aborted && resume && /No conversation found|session id/i.test(m)) {
          // 续接失败：起新会话重试一次
          try {
            const r2 = query({ prompt, options: { cwd: cwd || os.homedir(), permissionMode, includePartialMessages: true, systemPrompt: { type: "preset", preset: "claude_code", append: sysAppend }, abortController: abort } });
            for await (const msg of r2) {
              if (msg.type === "stream_event") { const e = msg.event; if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") send("chunk", { text: e.delta.text }); }
              else if (msg.type === "result") send("done", { session: msg.session_id });
            }
          } catch (e2) { send("error", { message: String(e2?.message || e2) }); }
        } else {
          send("error", { message: m });
        }
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
  console.log("\n=== Claude Tools 手机/远程端已启动 ===");
  console.log(`  本机访问 : http://localhost:${PORT}/?token=${TOKEN}`);
  console.log(`  手机访问 : http://${ip}:${PORT}/?token=${TOKEN}   (手机与本机同一 Wi-Fi)`);
  console.log(`  访问令牌 : ${TOKEN}`);
  console.log("  远程(非同网)：用 Tailscale / ngrok 暴露此端口。");
  console.log("  ⚠️ 该服务以全权限运行 Claude，请勿暴露到公网且妥善保管令牌。\n");
});
