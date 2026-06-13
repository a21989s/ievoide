// 「大脑」云服务（闭源）：进化决策 API——出题 + 收作业。
// 开源客户端的进化执行器从这里取任务（requirement + 提示词），在用户本机执行，
// 执行结果回报到这里形成数据飞轮（哪些进化成功/失败）。纯 Node，无外部依赖。
//
//   POST /api/evolve/next    取下一个进化任务（鉴权 + 每日配额）
//   POST /api/evolve/report  回报执行结果
//   GET  /api/health         存活与池子概况
//
// 部署：node cloud/brain.mjs（BRAIN_PORT 可改端口）。keys.json 管理客户端 key。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { evolveAppendFor, auditPromptFor } from "./prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BRAIN_PORT) || 8788;
const DATA = path.join(__dirname, "data");
fs.mkdirSync(DATA, { recursive: true });

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

// ── API key：keys.json = { "<key>": { name, dailyLimit } }。首次启动自动生成一个 dev key。
const keysFile = path.join(__dirname, "keys.json");
let KEYS = readJson(keysFile, null);
if (!KEYS || !Object.keys(KEYS).length) {
  const k = "ek_" + crypto.randomBytes(16).toString("hex");
  KEYS = { [k]: { name: "dev", dailyLimit: 50 } };
  writeJson(keysFile, KEYS);
  console.log("已生成 dev API key（见 cloud/keys.json）：" + k);
}
const keyOf = (req) => {
  const h = req.headers["authorization"] || "";
  const k = h.startsWith("Bearer ") ? h.slice(7).trim() : String(req.headers["x-api-key"] || "").trim();
  return KEYS[k] ? k : null;
};

// ── 每日配额：usage.json = { "YYYY-MM-DD": { "<key>": 次数 } }，只计出题次数。
const usageFile = path.join(DATA, "usage.json");
const today = () => new Date().toISOString().slice(0, 10);
function bumpQuota(key) {
  const u = readJson(usageFile, {});
  const day = (u[today()] ||= {});
  const limit = KEYS[key].dailyLimit ?? 50;
  if ((day[key] || 0) >= limit) return false;
  day[key] = (day[key] || 0) + 1;
  // 只留最近 7 天，防无限增长
  for (const d of Object.keys(u)) if (d < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) delete u[d];
  writeJson(usageFile, u);
  return true;
}

// ── 需求池与发放记录。池子是共享的：不因单个客户端完成而关单，靠客户端上报 recent/open 去重；
//    applied/failed 计数是跨客户端的成功率信号，供后续排序策略与巡检采集参考。
const poolFile = path.join(__dirname, "pool.json");
const tasksFile = path.join(DATA, "tasks.json"); // 已发放任务，供 report 对账
const reportsFile = path.join(DATA, "reports.jsonl"); // 数据飞轮：逐条追加，永不改写

const SEV_RANK = { high: 0, medium: 1, low: 2 };
function nextTask(body, key) {
  const skip = new Set([...(body.recent || []), ...(body.open || [])]
    .map((t) => String(t || "").trim().toLowerCase()).filter(Boolean));
  const pick = readJson(poolFile, [])
    .filter((e) => e.status === "open" && !skip.has((e.title || "").trim().toLowerCase()))
    .sort((a, b) => (SEV_RANK[a.severity] ?? 1) - (SEV_RANK[b.severity] ?? 1) || (a.id || 0) - (b.id || 0))[0];
  if (!pick) return { empty: true };
  const taskId = crypto.randomUUID();
  const tasks = readJson(tasksFile, []);
  tasks.unshift({ taskId, poolId: pick.id, key: KEYS[key].name, ts: new Date().toISOString() });
  writeJson(tasksFile, tasks.slice(0, 500));
  return {
    taskId,
    title: pick.title,
    requirement: pick.requirement,
    severity: pick.severity,
    evolveAppend: evolveAppendFor(body),
  };
}

function report(body, key) {
  const task = readJson(tasksFile, []).find((t) => t.taskId === body.taskId);
  if (!task) return { error: "未知 taskId" };
  const rec = {
    ts: new Date().toISOString(),
    key: KEYS[key].name,
    taskId: task.taskId,
    poolId: task.poolId,
    status: String(body.status || "unknown"), // applied/rolledback/nochange/error
    summary: String(body.summary || "").slice(0, 2000),
    changed: Array.isArray(body.changed) ? body.changed.slice(0, 50) : [],
    error: String(body.error || "").slice(0, 2000),
    costUsd: Number(body.costUsd) || 0,
  };
  fs.appendFileSync(reportsFile, JSON.stringify(rec) + "\n");
  const pool = readJson(poolFile, []);
  const e = pool.find((x) => x.id === task.poolId);
  if (e) {
    if (rec.status === "applied") e.applied = (e.applied || 0) + 1;
    else if (rec.status === "rolledback" || rec.status === "error") e.failed = (e.failed || 0) + 1;
    writeJson(poolFile, pool);
  }
  return { ok: true };
}

// ── HTTP 壳：JSON in/out，body 上限 256KB。
const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 256 * 1024) { reject(new Error("body 过大")); req.destroy(); } });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error("非法 JSON")); } });
    req.on("error", reject);
  });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const pool = readJson(poolFile, []);
      return json(res, 200, { ok: true, open: pool.filter((e) => e.status === "open").length, total: pool.length });
    }
    const key = keyOf(req);
    if (!key) return json(res, 401, { error: "无效 API key" });
    // 提示词下发（手动进化/巡检用）：纯模板渲染零成本，不计配额
    if (req.method === "POST" && url.pathname === "/api/evolve/prompt") {
      const body = await readBody(req);
      return json(res, 200, { evolveAppend: evolveAppendFor(body) });
    }
    if (req.method === "POST" && url.pathname === "/api/evolve/audit-prompt") {
      const body = await readBody(req);
      return json(res, 200, { prompt: auditPromptFor(body), evolveAppend: evolveAppendFor(body) });
    }
    if (req.method === "POST" && url.pathname === "/api/evolve/next") {
      if (!bumpQuota(key)) return json(res, 429, { error: "今日配额已用完" });
      return json(res, 200, nextTask(await readBody(req), key));
    }
    if (req.method === "POST" && url.pathname === "/api/evolve/report") {
      const r = report(await readBody(req), key);
      return json(res, r.error ? 404 : 200, r);
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 400, { error: String(err.message || err) });
  }
}).listen(PORT, () => console.log(`🧠 brain API 运行中：http://localhost:${PORT}`));
