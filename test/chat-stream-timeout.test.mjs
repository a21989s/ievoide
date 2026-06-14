// 聊天流“卡死兜底”逻辑的单元测试（node --test，零额外依赖）。
//
// main.js 的 chat handler 依赖 Electron(app/ipcMain/window) 与 SDK query()，无法直接 import，
// 故此处用最小 harness「忠实镜像」main.js 中 run() 的流超时控制流：
//   watchdog 检测 lastChunkTime 停滞 → 置 timedOut + abort() + stallReject()，
//   消费循环 consume 与 stallGuard 用 Promise.race 赛跑。
// 核心要点（也是本次修复的原因）：SDK 中止后迭代器有时会悬挂、永不返回，
//   单靠 abort() 救不了 for-await；stallGuard 保证即便迭代器悬挂，run() 也必定收尾。
// 若日后改动 main.js 的 run() 对应逻辑，请同步本 harness。
import { test } from "node:test";
import assert from "node:assert/strict";

// ── harness：镜像 main.js run() 的流超时控制流 ───────────────────
// makeIterator(isAborted) 返回一个异步可迭代对象；isAborted() 让“守约”的迭代器
// 能在 abort 后自行结束，而“悬挂”的迭代器会无视它（复现真实卡死）。
async function run({ makeIterator, timeoutMs, checkMs }) {
  let timedOut = false;
  let aborted = false;
  const abort = () => { aborted = true; };
  let lastChunkTime = Date.now();
  let chunks = 0;

  let stallReject = null;
  const stallGuard = new Promise((_, rej) => { stallReject = rej; });
  const watchdog = setInterval(() => {
    if (Date.now() - lastChunkTime > timeoutMs) {
      timedOut = true;
      abort();
      stallReject?.(new Error("stream stalled"));
    }
  }, Math.min(timeoutMs, checkMs));

  const iterator = makeIterator(() => aborted);
  const consume = (async () => {
    for await (const _msg of iterator) {
      lastChunkTime = Date.now();
      chunks++;
    }
  })();
  consume.catch(() => {}); // stallGuard 先赢时 consume 仍悬挂，其迟到 rejection 不应冒泡

  let threw = false;
  try { await Promise.race([consume, stallGuard]); }
  catch { threw = true; }
  finally { clearInterval(watchdog); }
  return { timedOut, threw, chunks };
}

// 在 ms 内自动失败的看门狗：若 run() 永不返回（即修复失效），测试不会无限挂起
function withDeadline(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`run() 未在 ${ms}ms 内返回：${label}`)), ms)),
  ]);
}

// 正常流：yield 三条后自然结束
const normalIterator = () => (async function* () {
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 5)); yield { i }; }
})();

// 卡死流（最坏情形）：第一条就永不到来，且无视 abort —— 复现“SDK 中止后迭代器悬挂”
const hangingIterator = () => (async function* () {
  await new Promise(() => {}); // 永不 resolve
  yield { never: true };
})();

// 守约流：yield 一条后开始等待，一旦 abort 即自行结束（SDK 正常响应中止的情形）
const abortAwareIterator = (isAborted) => (async function* () {
  yield { first: true };
  while (!isAborted()) await new Promise((r) => setTimeout(r, 5));
})();

// ── 用例 ────────────────────────────────────────────────────────
test("正常流：run() 正常返回，不触发超时", async () => {
  const r = await withDeadline(
    run({ makeIterator: normalIterator, timeoutMs: 200, checkMs: 20 }), 2000, "正常流");
  assert.equal(r.timedOut, false);
  assert.equal(r.threw, false);
  assert.equal(r.chunks, 3);
});

test("卡死流（迭代器悬挂且无视 abort）：watchdog 兜底，run() 仍抛错收尾", async () => {
  // 这是修复的核心场景：旧实现里 for-await 会永停、run() 永不返回 → 界面卡“思考中”。
  // 修复后 stallGuard 让 Promise.race 抛错，run() 必定返回。
  const r = await withDeadline(
    run({ makeIterator: hangingIterator, timeoutMs: 50, checkMs: 20 }), 2000, "卡死流");
  assert.equal(r.timedOut, true);  // watchdog 识别到流停滞
  assert.equal(r.threw, true);     // run() 以异常收尾（外层据此发 chat:error 超时提示）
  assert.equal(r.chunks, 0);       // 一条都没收到
});

test("守约流：abort 后迭代器自行结束，run() 正常返回（无需 stallGuard 兜底）", async () => {
  const r = await withDeadline(
    run({ makeIterator: abortAwareIterator, timeoutMs: 50, checkMs: 20 }), 2000, "守约流");
  assert.equal(r.timedOut, true);  // 长时间无新 chunk → watchdog 触发 abort
  assert.equal(r.chunks, 1);       // 收到首条后停滞
});
