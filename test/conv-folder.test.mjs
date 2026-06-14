// 对话-目录一致性逻辑的单元测试（node --test，零额外依赖）。
//
// renderer.js 是依赖 window/document/localStorage 的浏览器整体模块，无法直接 import，
// 故此处用一个最小 harness「忠实镜像」renderer.js 中相关函数的实现，并对 harness 施测。
// 镜像源：renderer.js 的 convInCurrentFolder / reconcileActiveConvToFolder / newConversation /
// renderConvList 过滤 / deleteConv 选活动 / prev-conv|next-conv 导航。
// 若日后改动 renderer.js 对应逻辑，请同步本 harness。
import { test } from "node:test";
import assert from "node:assert/strict";

// ── harness：模拟 renderer.js 的相关全局状态与函数 ───────────────
function makeHarness(initial = {}) {
  const H = {
    currentFolder: initial.currentFolder ?? null,
    conversations: initial.conversations ?? [],
    activeConv: initial.activeConv ?? null,
    calls: { showActive: 0, renderConvList: 0, newConversation: 0 },
    _seq: 0,
  };

  // 镜像 makeConv 的关键字段
  H.makeConv = (seed = {}) => ({
    id: seed.id || "c" + ++H._seq,
    title: seed.title || "新对话",
    cwd: seed.cwd ?? null,
  });

  H.showActive = () => { H.calls.showActive++; };
  H.renderConvList = () => { H.calls.renderConvList++; };

  // 镜像 newConversation：新对话 cwd = currentFolder，unshift 到队首并设为活动
  H.newConversation = () => {
    H.calls.newConversation++;
    const c = H.makeConv();
    c.cwd = H.currentFolder || null;
    H.conversations.unshift(c);
    H.activeConv = c;
    H.showActive();
    H.renderConvList();
    return c;
  };

  // 镜像 convInCurrentFolder
  H.convInCurrentFolder = (c) =>
    !c.cwd || !H.currentFolder || c.cwd === H.currentFolder;

  // 镜像 reconcileActiveConvToFolder（对话区跟随目录：切到该目录的对话，没有则新建空白）
  H.reconcileActiveConvToFolder = () => {
    if (!H.currentFolder || !H.conversations.length) return;
    if (H.activeConv && H.convInCurrentFolder(H.activeConv)) { H.renderConvList(); return; }
    const belong = H.conversations.find((c) => c.cwd === H.currentFolder)
      || H.conversations.find((c) => !c.cwd);
    if (belong) { H.activeConv = belong; H.showActive(); H.renderConvList(); }
    else H.newConversation();
  };

  // 镜像 renderConvList 中非搜索态的可见 tab 过滤（活动对话始终可见）
  H.visibleConvs = () =>
    H.conversations.filter((c) => H.convInCurrentFolder(c) || c === H.activeConv);

  // 镜像 deleteConv 中 wasActive 分支的活动对话重选（优先属于当前目录）
  H.pickActiveAfterDelete = () =>
    H.conversations.find(H.convInCurrentFolder) || H.conversations[0];

  // 镜像 prev-conv：在可见对话间向前（与 tab 可见集一致，含活动对话）
  H.prevConv = () => {
    const vis = H.conversations.filter((c) => H.convInCurrentFolder(c) || c === H.activeConv);
    const idx = vis.findIndex((c) => c.id === H.activeConv?.id);
    return idx > 0 ? vis[idx - 1] : null;
  };
  // 镜像 next-conv：在可见对话间向后
  H.nextConv = () => {
    const vis = H.conversations.filter((c) => H.convInCurrentFolder(c) || c === H.activeConv);
    const idx = vis.findIndex((c) => c.id === H.activeConv?.id);
    return idx >= 0 && idx < vis.length - 1 ? vis[idx + 1] : null;
  };

  return H;
}

const conv = (id, cwd) => ({ id, title: id, cwd: cwd ?? null });

// ── convInCurrentFolder ────────────────────────────────────────
test("convInCurrentFolder: cwd 为空 → 任何目录都属于", () => {
  const H = makeHarness({ currentFolder: "/a" });
  assert.equal(H.convInCurrentFolder(conv("x", null)), true);
});

test("convInCurrentFolder: 未选目录 → 任何对话都属于", () => {
  const H = makeHarness({ currentFolder: null });
  assert.equal(H.convInCurrentFolder(conv("x", "/a")), true);
});

test("convInCurrentFolder: cwd 与当前目录一致 → 属于", () => {
  const H = makeHarness({ currentFolder: "/a" });
  assert.equal(H.convInCurrentFolder(conv("x", "/a")), true);
});

test("convInCurrentFolder: cwd 与当前目录不同 → 不属于", () => {
  const H = makeHarness({ currentFolder: "/a" });
  assert.equal(H.convInCurrentFolder(conv("x", "/b")), false);
});

// ── 可见 tab 过滤（renderConvList 非搜索态）────────────────────
test("visibleConvs: 仅显示当前目录 + cwd 为空的对话", () => {
  const H = makeHarness({
    currentFolder: "/a",
    conversations: [conv("a1", "/a"), conv("b1", "/b"), conv("n", null), conv("a2", "/a")],
  });
  assert.deepEqual(H.visibleConvs().map((c) => c.id), ["a1", "n", "a2"]);
});

test("visibleConvs: 未选目录时显示全部", () => {
  const H = makeHarness({
    currentFolder: null,
    conversations: [conv("a1", "/a"), conv("b1", "/b")],
  });
  assert.equal(H.visibleConvs().length, 2);
});

// ── newConversation ────────────────────────────────────────────
test("newConversation: 新对话 cwd 记为当前目录并设为活动、置顶", () => {
  const H = makeHarness({ currentFolder: "/a", conversations: [conv("old", "/a")] });
  const c = H.newConversation();
  assert.equal(c.cwd, "/a");
  assert.equal(H.activeConv, c);
  assert.equal(H.conversations[0], c);
});

test("newConversation: 未选目录时 cwd 为 null", () => {
  const H = makeHarness({ currentFolder: null, conversations: [] });
  const c = H.newConversation();
  assert.equal(c.cwd, null);
});

// ── reconcileActiveConvToFolder ────────────────────────────────
test("reconcile: 活动对话已属于当前目录 → 不切换，只重绘", () => {
  const a1 = conv("a1", "/a");
  const H = makeHarness({ currentFolder: "/a", conversations: [a1, conv("b1", "/b")], activeConv: a1 });
  H.reconcileActiveConvToFolder();
  assert.equal(H.activeConv, a1);
  assert.equal(H.calls.showActive, 0);
  assert.equal(H.calls.renderConvList, 1);
  assert.equal(H.calls.newConversation, 0);
});

test("reconcile: 活动对话属于别的目录 → 切到属于当前目录的对话", () => {
  const b1 = conv("b1", "/b");
  const a1 = conv("a1", "/a");
  const H = makeHarness({ currentFolder: "/a", conversations: [b1, a1], activeConv: b1 });
  H.reconcileActiveConvToFolder();
  assert.equal(H.activeConv, a1);
  assert.equal(H.calls.showActive, 1);
  assert.equal(H.calls.newConversation, 0);
});

test("reconcile: 当前目录无任何对话 → 新建空白对话，对话区跟随目录切换", () => {
  const b1 = conv("b1", "/b");
  const H = makeHarness({ currentFolder: "/a", conversations: [b1], activeConv: b1 });
  H.reconcileActiveConvToFolder();
  assert.equal(H.calls.newConversation, 1);   // 目标目录无对话 → 开空白新对话
  assert.equal(H.activeConv.cwd, "/a");        // 活动对话切到属于当前目录的新对话
  assert.equal(H.conversations.length, 2);
});

test("reconcile: 目标目录有自己的对话时，优先于无归属(null)对话", () => {
  const a1 = conv("a1", "/a");
  const n = conv("n", null);
  const b1 = conv("b1", "/b");
  const H = makeHarness({ currentFolder: "/a", conversations: [b1, n, a1], activeConv: b1 });
  H.reconcileActiveConvToFolder();
  assert.equal(H.activeConv, a1);              // 精确归属 /a 的优先于 null
  assert.equal(H.calls.newConversation, 0);
});

test("visibleConvs: 活动对话即使不属于当前目录也始终可见", () => {
  const b1 = conv("b1", "/b");
  const H = makeHarness({
    currentFolder: "/a",
    conversations: [conv("a1", "/a"), b1],
    activeConv: b1,
  });
  assert.deepEqual(H.visibleConvs().map((c) => c.id), ["a1", "b1"]);
});

test("reconcile: cwd 为空的对话可被选为活动（不限目录）", () => {
  const n = conv("n", null);
  const b1 = conv("b1", "/b");
  const H = makeHarness({ currentFolder: "/a", conversations: [b1, n], activeConv: b1 });
  H.reconcileActiveConvToFolder();
  assert.equal(H.activeConv, n);
  assert.equal(H.calls.newConversation, 0);
});

test("reconcile: 竞速保护——未选目录时空跑", () => {
  const H = makeHarness({ currentFolder: null, conversations: [conv("a1", "/a")], activeConv: null });
  H.reconcileActiveConvToFolder();
  assert.equal(H.calls.renderConvList, 0);
  assert.equal(H.calls.newConversation, 0);
});

test("reconcile: 竞速保护——对话列表为空时空跑", () => {
  const H = makeHarness({ currentFolder: "/a", conversations: [], activeConv: null });
  H.reconcileActiveConvToFolder();
  assert.equal(H.calls.renderConvList, 0);
  assert.equal(H.calls.newConversation, 0);
});

test("reconcile: 无活动对话但有属于当前目录的对话 → 选中它", () => {
  const a1 = conv("a1", "/a");
  const H = makeHarness({ currentFolder: "/a", conversations: [a1], activeConv: null });
  H.reconcileActiveConvToFolder();
  assert.equal(H.activeConv, a1);
});

// ── deleteConv 删除后选活动对话 ─────────────────────────────────
test("pickActiveAfterDelete: 优先选属于当前目录的对话", () => {
  const H = makeHarness({
    currentFolder: "/a",
    conversations: [conv("b1", "/b"), conv("a1", "/a")],
  });
  assert.equal(H.pickActiveAfterDelete().id, "a1");
});

test("pickActiveAfterDelete: 无属于当前目录的对话则回退到第一个", () => {
  const H = makeHarness({
    currentFolder: "/a",
    conversations: [conv("b1", "/b"), conv("c1", "/c")],
  });
  assert.equal(H.pickActiveAfterDelete().id, "b1");
});

// ── prev/next 导航（仅在可见对话间）──────────────────────────────
test("prev/next: 跳过被隐藏的别目录对话", () => {
  const a1 = conv("a1", "/a");
  const a2 = conv("a2", "/a");
  // 队列顺序：a1, b1(/b 隐藏), a2 —— 可见序列为 [a1, a2]
  const H = makeHarness({
    currentFolder: "/a",
    conversations: [a1, conv("b1", "/b"), a2],
    activeConv: a1,
  });
  assert.equal(H.nextConv(), a2);     // a1 的下一个可见是 a2，而非 b1
  H.activeConv = a2;
  assert.equal(H.prevConv(), a1);     // a2 的上一个可见是 a1
});

test("prev/next: 处于可见列表边界时返回 null", () => {
  const a1 = conv("a1", "/a");
  const a2 = conv("a2", "/a");
  const H = makeHarness({ currentFolder: "/a", conversations: [a1, a2], activeConv: a1 });
  assert.equal(H.prevConv(), null);   // 已是第一个
  H.activeConv = a2;
  assert.equal(H.nextConv(), null);   // 已是最后一个
});

test("prev/next: 活动对话属别目录但始终在可见集中，可正常导航回当前目录对话", () => {
  const a1 = conv("a1", "/a");
  const b1 = conv("b1", "/b");
  // 可见集 = [a1(/a), b1(活动)]；b1 的上一个是 a1
  const H = makeHarness({ currentFolder: "/a", conversations: [a1, b1], activeConv: b1 });
  assert.equal(H.prevConv(), a1);
  assert.equal(H.nextConv(), null); // b1 已是可见集末尾
});
