// 大脑客户端（开源侧）：进化所需的提示词/任务一律向云端「大脑」服务取（见 cloud/README.md 协议），
// 本文件不含任何核心提示词。成功获取过一次后落本地缓存，大脑临时不可达时用缓存兜底；
// 从未成功过则明确报错（开源版表现为进化功能不可用，其余功能不受影响）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheFile = path.join(__dirname, "data", "brain-cache.json");

const readCache = () => {
  try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { return {}; }
};
function writeCache(patch) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ ...readCache(), ...patch, ts: new Date().toISOString() }, null, 2));
  } catch {}
}

// dev 便利：brainKey 未配置、但本机就是闭源开发仓（带 cloud/keys.json）时，自动用第一个 key——
// 本地起 node cloud/brain.mjs 即零配置联通。开源提取版没有 cloud/，此函数恒返回 null。
function devKey() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, "cloud", "keys.json"), "utf8")))[0] || null;
  } catch { return null; }
}

async function call(cfg, pathname, body) {
  const key = (cfg && cfg.brainKey) || devKey();
  if (!key) throw new Error("未配置 brainKey（config.json）");
  const url = ((cfg && cfg.brainUrl) || "http://localhost:8788").replace(/\/+$/, "") + pathname;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ac.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  } finally { clearTimeout(t); }
}

// 进化系统提示词追加段。按客户端形态(client)分桶缓存；cached=true 表示本次走了离线兜底。
export async function brainEvolveAppend(cfg, client = "desktop") {
  try {
    const { evolveAppend } = await call(cfg, "/api/evolve/prompt", { client });
    if (!evolveAppend) throw new Error("空响应");
    writeCache({ ["append_" + client]: evolveAppend });
    return { evolveAppend, cached: false };
  } catch (err) {
    const cached = readCache()["append_" + client];
    if (cached) return { evolveAppend: cached, cached: true };
    throw new Error(`进化大脑不可达且无本地缓存（${err.message || err}）。请检查 config.json 的 brainUrl/brainKey，或先启动大脑服务`);
  }
}

// 巡检提示词：recent/open（标题数组）交服务端渲染去重约束。巡检本身要联网调研，
// 故不做离线兜底——大脑不可达时直接报错即可。
export async function brainAuditPrompt(cfg, { client = "desktop", recent = [], open = [] } = {}) {
  return call(cfg, "/api/evolve/audit-prompt", { client, recent, open });
}
