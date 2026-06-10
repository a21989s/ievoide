#!/usr/bin/env node
// 自驱动开发回路：监控源码改动 -> dry-run 语法校验 -> 通过才重启 Electron。
// 校验失败则保留当前实例、打印错误，绝不把崩溃代码重启进去（防崩溃循环）。
//
// 用法: npm run dev   (= node dev-watch.mjs)
// 退出: Ctrl-C        日志: 终端 + /tmp/electron-tools.log
import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { createWriteStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = path.join(__dirname, "node_modules/.bin/electron");
const LOG = "/tmp/electron-tools.log";

// 监控的源文件（相对项目根）
const WATCH = [
  "main.js",
  "preload.cjs",
  "renderer/renderer.js",
  "renderer/pdfeditor.js",
  "renderer/index.html",
];
const isJS = (f) => /\.(js|cjs|mjs)$/.test(f);
const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`\x1b[36m[watch ${ts()}]\x1b[0m ${m}`);

let child = null;
let debounce = null;
let busy = false;
let smokeTimer = null;
let launchOffset = 0; // 本次 launch 时刻的日志字节数，冒烟检查只扫之后的内容

// 启动后冒烟检查：扫描本次 launch 之后的日志里的运行期错误标记
// （node --check 只能查语法，抓不到 'disposed frame'、未捕获异常这类运行期问题）
const ERROR_MARKERS = [
  "Render frame was disposed",
  "Uncaught",
  "UnhandledPromiseRejection",
  "TypeError:",
  "ReferenceError:",
  "Cannot find module",
];
function smokeCheck() {
  try {
    // 按字节偏移只读本次启动后的输出，避免把历史错误误报成本次（与启动器无关）
    const buf = readFileSync(LOG).subarray(launchOffset).toString("utf8");
    const hits = ERROR_MARKERS.flatMap((m) => {
      const n = buf.split(m).length - 1;
      return n ? [`${m} ×${n}`] : [];
    });
    if (hits.length)
      log(`\x1b[33m⚠ 冒烟检查发现运行期错误:\x1b[0m ${hits.join(", ")}  (详见 ${LOG})`);
    else log("\x1b[32m✓ 冒烟检查通过\x1b[0m（启动后 5s 内无错误标记）");
  } catch {}
}

// --- dry run: 对所有受监控 JS 做 node --check 语法校验 ----------------------
function dryRun() {
  const bad = [];
  for (const rel of WATCH.filter(isJS)) {
    const r = spawnSync(process.execPath, ["--check", path.join(__dirname, rel)], {
      encoding: "utf8",
    });
    if (r.status !== 0) bad.push({ rel, err: (r.stderr || "").trim().split("\n")[0] });
  }
  return bad;
}

// --- 重启 electron：杀旧 -> 等退出 -> 拉新 ----------------------------------
function killChild() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const c = child;
    c.once("exit", () => resolve());
    c.kill("SIGTERM");
    setTimeout(() => {
      if (c.exitCode === null) c.kill("SIGKILL");
    }, 2000);
  });
}

function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 否则 electron 会当成纯 node 跑
  try { launchOffset = statSync(LOG).size; } catch { launchOffset = 0; } // 记录起点供冒烟检查
  const out = createWriteStream(LOG, { flags: "a" });
  out.write(`\n===== launch ${new Date().toISOString()} =====\n`);
  child = spawn(ELECTRON, ["."], { cwd: __dirname, env });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.once("exit", (code, sig) => {
    if (!busy) log(`electron 退出 (code=${code} sig=${sig})，等待下次改动…`);
  });
  log(`electron 已启动 (pid ${child.pid}) -> 日志 ${LOG}`);
  clearTimeout(smokeTimer);
  smokeTimer = setTimeout(smokeCheck, 5000); // 启动 5s 后冒烟检查运行期错误
}

async function cycle(reason) {
  if (busy) return;
  busy = true;
  try {
    log(`检测到改动 (${reason})，dry-run 中…`);
    const bad = dryRun();
    if (bad.length) {
      log(`\x1b[31m✗ dry-run 失败，保留当前实例不重启:\x1b[0m`);
      for (const b of bad) console.log(`    ${b.rel}: ${b.err}`);
      return;
    }
    log("\x1b[32m✓ dry-run 通过\x1b[0m，重启 electron…");
    await killChild();
    launch();
  } finally {
    busy = false;
  }
}

function scheduleCycle(reason) {
  clearTimeout(debounce);
  debounce = setTimeout(() => cycle(reason), 300); // 防抖，合并连续保存
}

// --- 启动 -------------------------------------------------------------------
log(`监控 ${WATCH.length} 个文件，保存即 dry-run + 重启。Ctrl-C 退出。`);
launch();

const watchers = [];
for (const rel of WATCH) {
  try {
    watchers.push(watch(path.join(__dirname, rel), () => scheduleCycle(rel)));
  } catch (e) {
    log(`无法监控 ${rel}: ${e.message}`);
  }
}

function shutdown() {
  log("收到退出信号，清理…");
  for (const w of watchers) w.close();
  busy = true;
  if (child && child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
