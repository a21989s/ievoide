const $ = (id) => document.getElementById(id);
const chat = $("chat");

// 自进化健康心跳：渲染层成功加载即上报，宿主据此确认进化后的版本健康（否则自动回滚）
try { window.api.evolveAlive(); } catch {}

// ── 文件树 ────────────────────────────────────────────────
async function renderChildren(container, dirPath, depth) {
  const items = await window.api.listDir(dirPath);
  for (const it of items) {
    const node = document.createElement("div");
    node.className = "node " + (it.isDir ? "dir" : "file");
    node.style.paddingLeft = 8 + depth * 14 + "px";
    // 文件名来自任意目录，必须转义——否则含 < & 或 <img onerror> 的文件名会破坏渲染/注入标记
    node.innerHTML = `<span class="twist">${it.isDir ? "▸" : ""}</span>${it.isDir ? "📁" : "📄"} ${esc(it.name)}`;
    container.appendChild(node);

    if (it.isDir) {
      let expanded = false;
      let childWrap = null;
      node.onclick = async (e) => {
        e.stopPropagation();
        const twist = node.querySelector(".twist");
        if (expanded) {
          childWrap.remove();
          childWrap = null;
          expanded = false;
          twist.textContent = "▸";
        } else {
          childWrap = document.createElement("div");
          node.after(childWrap);
          await renderChildren(childWrap, it.path, depth + 1);
          expanded = true;
          twist.textContent = "▾";
        }
      };
    } else {
      node.onclick = (e) => {
        e.stopPropagation();
        openFile(it.path, it.name);
      };
    }
  }
}

let currentFolder = null; // 当前打开的工作目录（用于语言无关地判断是否已选目录）
async function openFolderUI(folder) {
  currentFolder = folder;
  $("folder").textContent = folder;
  $("tree").innerHTML = "";
  await renderChildren($("tree"), folder, 0);
  await loadRepos();
}

$("pick").onclick = async () => {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  try { localStorage.setItem("claudeTools.folder", folder); } catch {}
  await openFolderUI(folder);
};

// 重启后恢复上次打开的文件夹
(async function restoreFolder() {
  let folder = null;
  try { folder = localStorage.getItem("claudeTools.folder"); } catch {}
  if (!folder) return;
  const ok = await window.api.setWorkdir(folder); // 在主进程设回 cwd
  if (ok) await openFolderUI(folder);
  else { try { localStorage.removeItem("claudeTools.folder"); } catch {} } // 目录已不存在
})();

// ── 预览面板：按扩展名渲染 md / mermaid / pdf / 文本 ──────────
const vbody = $("vbody");
const vframe = $("vframe");

if (window.mermaid) mermaid.initialize({ startOnLoad: false, theme: "default" });

function showViewer(title) {
  $("vtitle").textContent = title;
  $("viewer").style.display = "flex";
}
function useBody(cls) {
  vframe.style.display = "none";
  vframe.removeAttribute("src");
  vbody.style.display = "block";
  vbody.className = cls;
}

async function renderMermaidNodes(nodes) {
  if (!window.mermaid || !nodes.length) return;
  try {
    await mermaid.run({ nodes });
  } catch (err) {
    nodes.forEach((n) => {
      n.innerHTML = `<pre style="color:#e08a8a">Mermaid 渲染失败：\n${String(err.message || err)}</pre>`;
    });
  }
}

async function openFile(path, name) {
  const ext = name.split(".").pop().toLowerCase();

  if (ext === "pdf") {
    // 打开可编辑的 PDF 编辑器（PDF.js 渲染 + pdf-lib 保存）
    if (window.openPdfEditor) window.openPdfEditor(path, name);
    return;
  }

  showViewer(name);
  const content = await window.api.readFile(path);

  if (ext === "md" || ext === "markdown") {
    useBody("md");
    vbody.innerHTML = window.marked ? marked.parse(content) : content;
    // 把 ```mermaid 代码块转成图
    const blocks = vbody.querySelectorAll("code.language-mermaid");
    const nodes = [];
    blocks.forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      const pre = code.closest("pre");
      (pre || code).replaceWith(div);
      nodes.push(div);
    });
    await renderMermaidNodes(nodes);
    return;
  }

  if (ext === "mmd" || ext === "mermaid") {
    useBody("");
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = content;
    vbody.innerHTML = "";
    vbody.appendChild(div);
    await renderMermaidNodes([div]);
    return;
  }

  // 其它：纯文本
  useBody("raw");
  vbody.textContent = content;
}

$("vclose").onclick = () => {
  $("viewer").style.display = "none";
  vframe.removeAttribute("src"); // 卸载 PDF，释放资源
};

// ── Git 面板：仓库行 + 分支下拉 + 提交图 ───────────────────
function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 解析 %D 装饰串为彩色胶囊：HEAD -> x / origin/x / tag: x / 本地分支
function refPills(refs) {
  const out = [];
  if (!refs) return out;
  for (let part of refs.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith("HEAD -> ")) out.push({ kind: "head", name: part.slice(8) });
    else if (part === "HEAD") out.push({ kind: "head", name: "HEAD" });
    else if (part.startsWith("tag: ")) out.push({ kind: "tag", name: part.slice(5) });
    else if (part.includes("/")) out.push({ kind: "remote", name: part });
    else out.push({ kind: "branch", name: part });
  }
  return out;
}

let activeRepo = null; // 当前选中仓库的绝对路径
let repoList = []; // [{name, path, current}]

// 扫描工作目录下的所有 git 仓库，渲染 REPOSITORIES 列表
async function loadRepos() {
  const listEl = $("repoList");
  const graph = $("gitgraph");
  const dd = $("branchDropdown");
  listEl.innerHTML = "";
  graph.innerHTML = "";
  dd.innerHTML = "";
  dd.classList.remove("open");

  repoList = (await window.api.gitRepos()) || [];
  if (!repoList.length) {
    activeRepo = null;
    listEl.innerHTML =
      `<div style="color:#777;font-size:12px;padding:4px 6px">` +
      (!currentFolder ? tr("未选择目录") : tr("未发现 Git 仓库")) +
      `</div>`;
    return;
  }

  for (const repo of repoList) {
    const row = document.createElement("div");
    row.className = "repo-row";
    row.dataset.path = repo.path;
    row.innerHTML =
      `<span>🗂</span><span class="repo-name">${esc(repo.name)}</span>` +
      `<span class="repo-branch">⎇ ${esc(repo.current || "—")}</span>`;
    row.onclick = () => selectRepo(repo.path);
    listEl.appendChild(row);
  }

  // 保持原选中仓库；否则选第一个
  if (!repoList.some((r) => r.path === activeRepo)) activeRepo = repoList[0].path;
  await selectRepo(activeRepo);
}

// 选中某个仓库 → 高亮 + 加载分支图 + 工作区状态
async function selectRepo(repoPath) {
  activeRepo = repoPath;
  document
    .querySelectorAll("#repoList .repo-row")
    .forEach((el) => el.classList.toggle("active", el.dataset.path === repoPath));
  await loadGraph(repoPath);
  await loadStatus(repoPath);
}

// ── Source Control：工作区状态（暂存/改动） ─────────────────
function fileRow(f, staged) {
  const cls = f.untracked ? "U" : f.code;
  const el = document.createElement("div");
  el.className = "sc-file";
  el.title = f.path;
  const acts = staged
    ? `<span data-act="unstage" title="${tr("取消暂存")}">−</span>`
    : `<span data-act="stage" title="${tr("暂存")}">＋</span><span data-act="discard" title="${tr("丢弃更改")}">↩</span>`;
  el.innerHTML =
    `<span class="sc-stat ${cls}">${cls}</span>` +
    `<span class="sc-name">${esc(f.path)}</span>` +
    `<span class="sc-fileact">${acts}</span>`;
  el.onclick = (e) => {
    const act = e.target.dataset?.act;
    if (act === "stage") doGit(() => window.api.gitStage(activeRepo, f.path));
    else if (act === "unstage") doGit(() => window.api.gitUnstage(activeRepo, f.path));
    else if (act === "discard") {
      if (confirm(trf("丢弃对 {0} 的更改？此操作不可撤销。", f.path)))
        doGit(() => window.api.gitDiscard(activeRepo, f.path, !!f.untracked));
    } else openDiff(f.path, staged, f.untracked);
  };
  return el;
}

async function loadStatus(repoPath) {
  const stagedEl = $("scStaged");
  const changesEl = $("scChanges");
  stagedEl.innerHTML = "";
  changesEl.innerHTML = "";
  const r = await window.api.gitStatus(repoPath);
  if (!r || r.error) {
    $("scStagedN").textContent = "0";
    $("scChangesN").textContent = "0";
    return;
  }
  $("scStagedN").textContent = r.staged.length;
  $("scChangesN").textContent = r.changes.length;
  r.staged.forEach((f) => stagedEl.appendChild(fileRow(f, true)));
  r.changes.forEach((f) => changesEl.appendChild(fileRow(f, false)));
  // ahead/behind 标在 push/pull 上
  $("scPush").textContent = r.ahead ? `↑${r.ahead}` : "↑";
  $("scPull").textContent = r.behind ? `↓${r.behind}` : "↓";
}

// 执行 git 操作后刷新状态+图
async function doGit(fn, okMsg) {
  $("status").textContent = tr("执行中…");
  const r = await fn();
  $("status").textContent = "";
  if (r && r.error) {
    alert(tr("Git 操作失败：") + "\n" + r.error);
    return false;
  }
  if (okMsg) {
    $("status").textContent = okMsg;
    setTimeout(() => ($("status").textContent = ""), 1800);
  }
  await loadStatus(activeRepo);
  await loadGraph(activeRepo);
  return true;
}

// 显示 diff（复用查看器浮层）；未跟踪文件显示为全新增，目录给提示
async function openDiff(file, staged, untracked) {
  if (file.endsWith("/")) {
    alert(tr("这是未跟踪的目录，请在左侧文件树展开查看其中文件。"));
    return;
  }
  const r = await window.api.gitDiff(activeRepo, file, staged);
  showViewer((staged ? tr("[已暂存] ") : untracked ? tr("[新文件] ") : "") + file);
  useBody("diff");
  vbody.innerHTML = diffToHtml((r && r.diff) || r?.error || tr("(无差异)"));
}

// diff 文本 → 着色 HTML
function diffToHtml(diff) {
  return diff
    .split("\n")
    .map((line) => {
      const c =
        line.startsWith("+") && !line.startsWith("+++") ? "add"
        : line.startsWith("-") && !line.startsWith("---") ? "del"
        : line.startsWith("@@") ? "at"
        : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---") ? "hdr"
        : "";
      return c ? `<span class="${c}">${esc(line)}</span>` : esc(line);
    })
    .join("\n");
}

// 点击提交节点：显示该提交改动的文件列表
async function openCommit(c) {
  showViewer(c.short + "  " + c.subject);
  useBody("");
  vbody.innerHTML = `<div style="color:var(--muted);font-size:12px;margin-bottom:8px">${esc(c.short)} · ${tr("加载中…")}</div>`;
  const r = await window.api.gitCommitFiles(activeRepo, c.full);
  const files = (r && r.files) || [];
  vbody.innerHTML = `<div style="color:var(--muted);font-size:12px;margin-bottom:8px">${esc(c.short)} · ${trf("{0} 个文件改动", files.length)}</div>`;
  const list = document.createElement("div");
  files.forEach((f) => {
    const cls = ["A", "M", "D", "R"].includes(f.code) ? f.code : "M";
    const el = document.createElement("div");
    el.className = "sc-file";
    el.title = f.path;
    el.innerHTML =
      `<span class="sc-stat ${cls}">${f.code}</span><span class="sc-name">${esc(f.path)}</span>`;
    el.onclick = () => openCommitDiff(c, f.path);
    list.appendChild(el);
  });
  if (!files.length) list.innerHTML = `<div style="color:#777;font-size:12px">${tr("无文件改动")}</div>`;
  vbody.appendChild(list);
}

// 该提交里某文件的 diff（带返回）
async function openCommitDiff(c, file) {
  const r = await window.api.gitCommitDiff(activeRepo, c.full, file);
  showViewer(c.short + "  " + file);
  useBody("diff");
  vbody.innerHTML = "";
  const back = document.createElement("div");
  back.textContent = tr("← 返回文件列表");
  back.style.cssText =
    "color:#6fb3ff;cursor:pointer;margin-bottom:8px;font-family:-apple-system,sans-serif";
  back.onclick = () => openCommit(c);
  vbody.appendChild(back);
  const body = document.createElement("div");
  body.innerHTML = diffToHtml((r && r.diff) || r?.error || tr("(无差异)"));
  vbody.appendChild(body);
}

// 提交 / 批量暂存 / 同步
$("scCommit").onclick = async () => {
  const msg = $("scMsg").value.trim();
  if (!msg) { $("scMsg").focus(); return; }
  if (await doGit(() => window.api.gitCommit(activeRepo, msg), tr("已提交"))) $("scMsg").value = "";
};
$("scMsg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("scCommit").click(); }
});
$("scStageAll").onclick = () => doGit(() => window.api.gitStageAll(activeRepo));
$("scUnstageAll").onclick = () => doGit(() => window.api.gitUnstageAll(activeRepo));
$("scPull").onclick = () => doGit(() => window.api.gitPull(activeRepo), tr("已拉取"));
$("scPush").onclick = () => doGit(() => window.api.gitPush(activeRepo), tr("已推送"));
$("scFetch").onclick = () => doGit(() => window.api.gitFetch(activeRepo), tr("已抓取"));
$("scNewBranch").onclick = async () => {
  const name = prompt(tr("新分支名："));
  if (name && name.trim()) doGit(() => window.api.gitCreateBranch(activeRepo, name.trim()), tr("已创建分支"));
};
$("scDiscardAll").onclick = () => {
  if (confirm(tr("丢弃所有未暂存更改，并删除未跟踪文件/目录？\n此操作不可撤销！")))
    doGit(() => window.api.gitDiscardAll(activeRepo), tr("已丢弃所有更改"));
};
$("scUndoCommit").onclick = () => {
  if (confirm(tr("撤销上次提交？\n（改动会保留在暂存区，可重新提交）")))
    doGit(() => window.api.gitUndoLastCommit(activeRepo), tr("已撤销上次提交"));
};

// ── 通用上下文菜单 ─────────────────────────────────────────
function showMenu(x, y, items) {
  const m = $("ctxMenu");
  m.innerHTML = "";
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "sep";
      m.appendChild(s);
      continue;
    }
    const el = document.createElement("div");
    el.className = "mi" + (it.danger ? " danger" : "");
    el.textContent = it.label;
    el.onclick = () => {
      m.classList.remove("open");
      it.run();
    };
    m.appendChild(el);
  }
  m.style.left = x + "px";
  m.style.top = y + "px";
  m.classList.add("open");
  const r = m.getBoundingClientRect();
  if (r.right > innerWidth) m.style.left = x - r.width + "px";
  if (r.bottom > innerHeight) m.style.top = y - r.height + "px";
}
document.addEventListener("click", () => $("ctxMenu").classList.remove("open"));

// 提交右键/⋯ 菜单：检出 / revert / 重置 / 复制
function commitMenu(c, x, y) {
  showMenu(x, y, [
    {
      label: tr("检出此提交（分离 HEAD）"),
      run: () => confirm(trf("检出 {0}？将进入分离 HEAD 状态。", c.short)) &&
        doGit(() => window.api.gitCheckoutCommit(activeRepo, c.full)),
    },
    {
      label: tr("撤销此提交 (revert)"),
      run: () => doGit(() => window.api.gitRevert(activeRepo, c.full), tr("已创建 revert 提交")),
    },
    { sep: true },
    {
      label: tr("软重置到此（保留改动）"),
      run: () => confirm(trf("reset --soft 到 {0}？\n此提交之后的提交将撤销，改动保留。", c.short)) &&
        doGit(() => window.api.gitResetSoft(activeRepo, c.full)),
    },
    {
      label: tr("硬重置到此（丢弃之后的提交）"),
      danger: true,
      run: () => confirm(trf("reset --hard 到 {0}？\n此提交之后的提交与改动将永久丢失，不可撤销！", c.short)) &&
        doGit(() => window.api.gitResetHard(activeRepo, c.full)),
    },
    { sep: true },
    { label: tr("复制完整 SHA"), run: () => navigator.clipboard?.writeText(c.full) },
  ]);
}

async function loadGraph(repoPath) {
  const graph = $("gitgraph");
  const dd = $("branchDropdown");
  graph.innerHTML = "";
  dd.innerHTML = "";
  dd.classList.remove("open");

  const r = await window.api.gitGraph(repoPath);
  if (!r || r.error) {
    graph.innerHTML = `<div style="color:#c77;font-size:12px;padding:4px 6px">${esc(r?.error || tr("读取失败"))}</div>`;
    return;
  }

  // 分支下拉（切换图里没出现的分支）
  const b = await window.api.gitBranches(repoPath);
  if (b && b.branches) {
    for (const name of b.branches) {
      const el = document.createElement("div");
      el.className = "branch" + (name === r.current ? " active" : "");
      el.textContent = name;
      el.onclick = () => {
        dd.classList.remove("open");
        checkout(name);
      };
      dd.appendChild(el);
    }
  }

  // 提交图
  for (let i = 0; i < r.commits.length; i++) {
    const c = r.commits[i];
    const isHead = /(^|,|\s)HEAD(\s|,|$|\s->)/.test(c.refs);
    const row = document.createElement("div");
    row.className = "commit" + (isHead ? " head" : "");
    const pills = refPills(c.refs)
      .map((p) => {
        const label = p.kind === "head" ? `◎ ${esc(p.name)}` : esc(p.name);
        const click = p.kind === "branch" ? `data-co="${esc(p.name)}"` : "";
        return `<span class="refpill ${p.kind}" ${click}>${label}</span>`;
      })
      .join("");
    row.innerHTML =
      `<span class="gcol"><span class="gline"></span><span class="gdot"></span></span>` +
      `<span class="cbody">${pills}<span class="subject" title="${esc(c.short + "  " + c.subject)}">${esc(c.subject)}</span></span>` +
      `<span class="commit-menu" title="${tr("提交操作")}">⋯</span>`;
    // 点击节点：查看该提交的文件改动与对比（避开分支胶囊与 ⋯ 菜单）
    row.onclick = (e) => {
      if (e.target.closest(".refpill") || e.target.closest(".commit-menu")) return;
      openCommit(c);
    };
    row.style.cursor = "pointer";
    // 右键 或 点 ⋯ 打开提交操作菜单
    row.oncontextmenu = (e) => {
      e.preventDefault();
      commitMenu(c, e.clientX, e.clientY);
    };
    row.querySelector(".commit-menu").onclick = (e) => {
      e.stopPropagation();
      const b = e.target.getBoundingClientRect();
      commitMenu(c, b.left, b.bottom);
    };
    graph.appendChild(row);
  }
  graph.querySelectorAll(".refpill.branch[data-co]").forEach((el) => {
    el.onclick = () => checkout(el.dataset.co);
  });
}

async function checkout(branch) {
  if (!activeRepo) return;
  $("status").textContent = trf("切换到 {0}…", branch);
  const r = await window.api.gitCheckout(activeRepo, branch);
  if (r && r.error) {
    $("status").textContent = "";
    alert(tr("切换失败：") + "\n" + r.error);
    return;
  }
  $("status").textContent = "";
  await loadRepos(); // 刷新分支标签（保持选中仓库）
}

$("refreshbranch").onclick = () => loadRepos();

// ── 多对话管理 ─────────────────────────────────────────────
// 每个对话独立并行：pane(消息DOM) / sessionId / busy / currentBubble / toolCards
let conversations = [];
let activeConv = null;

const getConv = (id) => conversations.find((c) => c.id === id);
function scrollIfActive(conv) {
  if (conv === activeConv) chat.scrollTop = chat.scrollHeight;
}
function ensurePane(conv) {
  if (conv.pane) return conv.pane;
  const p = document.createElement("div");
  p.className = "conv-pane";
  if (conv._html) p.innerHTML = conv._html;
  conv.pane = p;
  conv.currentBubble = null;
  conv.toolCards = {};
  return p;
}
function showActive() {
  ensurePane(activeConv);
  chat.replaceChildren(activeConv.pane); // 仅切换显示，不打断后台对话
  chat.scrollTop = chat.scrollHeight;
  refreshSendBtn();
}
function refreshSendBtn() {
  const hasText = $("input").value.trim().length > 0;
  const busy = !!activeConv?.busy;
  const btn = $("send");
  // 有文字 => 发送（忙碌则排队）；无文字且忙碌 => 停止
  if (hasText || !busy) {
    btn.textContent = tr("发送");
    btn.style.background = "";
  } else {
    btn.textContent = tr("停止");
    btn.style.background = "#a33";
  }
  const q = activeConv?.queue?.length || 0;
  $("status").textContent = busy
    ? q
      ? trf("思考中…（已排队 {0} 条）", q)
      : tr("思考中…（可继续输入，自动排队）")
    : "";
}
function makeConv(seed) {
  return {
    id: seed?.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: seed?.title || "新对话",
    sessionId: seed?.sessionId || null,
    inited: !!seed?.inited,
    _html: seed?.html || "",
    pane: null,
    currentBubble: null,
    toolCards: {},
    busy: false,
    queue: [], // 当前轮进行中时，后续追问排队，依次自动发送
  };
}
let _saveTimer = null;
let archived = []; // 已关闭对话的历史归档（与手机端共用同一份文件的 history 字段）
function buildConvState() {
  return {
    list: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      sessionId: c.sessionId,
      inited: c.inited,
      html: c.pane ? c.pane.innerHTML : c._html || "",
    })),
    active: activeConv?.id || null,
    history: archived,
  };
}
function persistConvs() {
  // localStorage 即时（快速缓存）+ 磁盘文件（耐久，防丢，debounce 写）
  try { localStorage.setItem("claudeTools.convs", JSON.stringify(buildConvState())); } catch {}
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => window.api.saveConvs(buildConvState()), 400);
}

function newConversation() {
  const c = makeConv();
  conversations.unshift(c);
  activeConv = c;
  showActive();
  renderConvList();
  $("input").focus();
  persistConvs();
}

// 切换对话：自由切换，后台对话继续跑，不停止
function switchConv(id) {
  const c = getConv(id);
  if (!c || c === activeConv) return;
  activeConv = c;
  showActive();
  renderConvList();
  persistConvs();
}

function deleteConv(id) {
  const i = conversations.findIndex((c) => c.id === id);
  if (i < 0) return;
  const conv = conversations[i];
  if (conv.busy) window.api.stop(conv.id); // 删除前停掉它的查询
  if (conv.id === reqConvId) reqConvId = null; // 解绑需求清单（pumpReqs 会重新绑定）
  archiveConv(conv); // 关闭前归档到历史，可在「🕘 历史」里重新打开续聊
  const wasActive = conv === activeConv;
  conversations.splice(i, 1);
  if (wasActive) {
    if (conversations.length) {
      activeConv = conversations[0];
      showActive();
    } else {
      newConversation();
      return;
    }
  }
  renderConvList();
  persistConvs();
}

// ── 历史归档：关闭的对话存档于此，可重新打开续聊 ───────────────
function archiveConv(conv) {
  const html = conv.pane ? conv.pane.innerHTML : conv._html || "";
  if (!html && !conv.sessionId) return; // 空对话不归档
  archived = archived.filter((h) => h.id !== conv.id); // 去重（按 id）
  archived.unshift({
    id: conv.id,
    title: conv.title || "新对话",
    sessionId: conv.sessionId || null,
    html,
    archivedAt: Date.now(),
  });
  if (archived.length > 200) archived.length = 200; // 上限保护
}
function openHistory() {
  $("historyModal").classList.add("open");
  $("histSearch").value = "";
  renderHistory("");
  $("histSearch").focus();
}
function closeHistory() { $("historyModal").classList.remove("open"); }
function renderHistory(filter) {
  const box = $("histList");
  box.innerHTML = "";
  const q = (filter || "").toLowerCase();
  const items = archived.filter((h) => !q || (h.title || "").toLowerCase().includes(q));
  if (!items.length) {
    box.innerHTML = `<div class="hist-empty">${q ? tr("无匹配历史") : tr("暂无历史记录")}</div>`;
    return;
  }
  for (const h of items) {
    const row = document.createElement("div");
    row.className = "hist-row";
    const title = (h.title || tr("新对话")).replace(/</g, "&lt;");
    row.innerHTML =
      `<div class="hist-main"><div class="hist-title">${title}</div>` +
      `<div class="hist-meta">${fmtTime(h.archivedAt)}${h.sessionId ? " · " + tr("可续聊") : ""}</div></div>` +
      `<button class="hist-open">${tr("打开")}</button><button class="hist-del" title="${tr("删除")}">×</button>`;
    row.querySelector(".hist-open").onclick = () => restoreFromHistory(h.id);
    row.querySelector(".hist-del").onclick = (e) => { e.stopPropagation(); deleteFromHistory(h.id); };
    box.appendChild(row);
  }
}
function restoreFromHistory(id) {
  if (getConv(id)) { switchConv(id); closeHistory(); return; } // 已打开则直接切过去
  const h = archived.find((x) => x.id === id);
  if (!h) return;
  const c = makeConv({ id: h.id, title: h.title, sessionId: h.sessionId, html: h.html, inited: !!h.sessionId });
  conversations.unshift(c);
  activeConv = c;
  archived = archived.filter((x) => x.id !== id); // 移出历史，回到打开状态
  showActive();
  renderConvList();
  persistConvs();
  closeHistory();
}
function deleteFromHistory(id) {
  archived = archived.filter((x) => x.id !== id);
  persistConvs();
  renderHistory($("histSearch").value || "");
}

// 渲染顶部 tab 标签条（tab 名=首条输入）
function renderConvList() {
  const tabs = $("convTabs");
  tabs.innerHTML = "";
  for (const c of conversations) {
    const el = document.createElement("div");
    el.className = "conv-tab" + (c.id === activeConv?.id ? " active" : "");
    const dispTitle = !c.title || c.title === "新对话" ? tr("新对话") : c.title;
    el.title = dispTitle;
    el.innerHTML =
      (c.busy
        ? `<span class="conv-run" title="${tr("进行中") + (c.queue.length ? trf("，排队 {0}", c.queue.length) : "")}">●${c.queue.length ? c.queue.length : ""}</span>`
        : "") +
      `<span class="conv-title">${esc(dispTitle)}</span>` +
      `<span class="conv-del" title="${tr("关闭")}">×</span>`;
    el.onclick = (e) => {
      if (e.target.classList.contains("conv-del")) {
        e.stopPropagation();
        deleteConv(c.id);
      } else {
        switchConv(c.id);
      }
    };
    tabs.appendChild(el);
    if (c.id === activeConv?.id) el.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}

$("newconv").onclick = newConversation;

// 启动：优先从磁盘恢复对话历史，回退 localStorage（迁移旧数据）
(async function initConvs() {
  let d = null;
  try { d = await window.api.loadConvs(); } catch {}
  if (!d || !Array.isArray(d.list) || !d.list.length) {
    try { d = JSON.parse(localStorage.getItem("claudeTools.convs") || "null"); } catch {}
  }
  if (d && Array.isArray(d.list) && d.list.length) {
    conversations = d.list.map(makeConv);
    activeConv = getConv(d.active) || conversations[0];
  }
  if (d && Array.isArray(d.history)) archived = d.history;
  if (!activeConv) {
    activeConv = makeConv();
    conversations = [activeConv];
  }
  showActive();
  renderConvList();
  persistConvs(); // 首次把数据落到磁盘
})();

// ── 对话渲染（全部按指定 conv 操作，支持后台对话）──────────
function addMsg(conv, role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  wrap.innerHTML = `<div class="role">${role === "user" ? tr("你") : "Claude"}</div>`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (text) bubble.textContent = text;
  wrap.appendChild(bubble);
  conv.pane.appendChild(wrap);
  scrollIfActive(conv);
  return bubble;
}

// ── 附件：粘贴 / 拖入 图片·PDF·Word·视频… ────────────────────
let pendingAttachments = []; // [{name, path, type, dataUrl?}]

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
// 把一个 File 存到附件目录并返回 {name, path, type, dataUrl?}（图片/PDF/Word/任意文件通用）
async function saveFileAsAttachment(file) {
  const b64 = await fileToBase64(file);
  const name = file.name || `pasted-${Date.now()}.${(file.type.split("/")[1] || "bin")}`;
  const r = await window.api.saveAttachment({ name, base64: b64 });
  if (!r || r.error) throw new Error(r?.error || tr("未知"));
  return {
    name: r.name,
    path: r.path,
    type: file.type,
    dataUrl: file.type.startsWith("image/") ? `data:${file.type};base64,${b64}` : null,
  };
}
async function addAttachment(file) {
  try {
    pendingAttachments.push(await saveFileAsAttachment(file));
    renderAttachList();
  } catch (e) {
    alert(tr("附件保存失败：") + e);
  }
}
function renderAttachList() {
  const el = $("attachList");
  el.innerHTML = "";
  pendingAttachments.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.innerHTML =
      (a.dataUrl ? `<img src="${a.dataUrl}">` : `<span>📎</span>`) +
      `<span class="an" title="${esc(a.name)}">${esc(a.name)}</span>` +
      `<span class="ax" title="${tr("移除")}">×</span>`;
    chip.querySelector(".ax").onclick = () => {
      pendingAttachments.splice(i, 1);
      renderAttachList();
    };
    el.appendChild(chip);
  });
}
// 粘贴
$("input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    files.forEach(addAttachment);
  }
});
// 拖拽
const bar = $("inputbar");
["dragenter", "dragover"].forEach((ev) =>
  bar.addEventListener(ev, (e) => {
    e.preventDefault();
    bar.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  bar.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && bar.contains(e.relatedTarget)) return;
    bar.classList.remove("dragover");
  })
);
bar.addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  files.forEach(addAttachment);
});

function send() {
  const input = $("input");
  const text = input.value.trim();
  const atts = pendingAttachments.slice();
  if ((!text && !atts.length) || !activeConv) return;
  const conv = activeConv;
  const ububble = addMsg(conv, "user", text || tr("(附件)")); // 立刻显示这条提问
  if (atts.length) renderMsgAttachments(ububble, atts); // 在气泡里显示附件缩略图/文件名
  input.value = "";
  pendingAttachments = [];
  renderAttachList();
  $("slashPopup").classList.remove("open");
  $("filePopup").classList.remove("open");

  if (!conv.title || conv.title === "新对话") {
    const t = text || (atts[0] && atts[0].name) || tr("附件");
    conv.title = t.length > 30 ? t.slice(0, 30) + "…" : t;
  }

  // 真正发给模型的 prompt：正文 + 附件绝对路径（让 Claude 用工具读取）
  const promptToSend = text + attachNote(atts);

  if (conv.busy) {
    conv.queue.push(promptToSend); // 当前轮还在跑 => 排队
    renderConvList();
    refreshSendBtn();
    scrollIfActive(conv);
    return;
  }
  startTurn(conv, promptToSend);
}

function attachNote(list) {
  if (!list.length) return "";
  return (
    "\n\n[用户附带了以下文件，请用 Read 工具查看图片/PDF，或用 Bash 配合系统可用的工具（如 unzip 解 .docx 的 word/document.xml、macOS 的 textutil 等）提取 Word/其他格式文本，然后据其内容回答]\n" +
    list.map((a) => "- " + a.path).join("\n")
  );
}

function renderMsgAttachments(bubble, atts) {
  const wrap = document.createElement("div");
  wrap.className = "msg-attach";
  atts.forEach((a) => {
    if (a.dataUrl) {
      const img = document.createElement("img");
      img.src = a.dataUrl;
      img.title = a.name;
      wrap.appendChild(img);
    } else {
      const el = document.createElement("span");
      el.className = "file";
      el.textContent = "📎 " + a.name;
      wrap.appendChild(el);
    }
  });
  bubble.appendChild(wrap);
}

// 在某对话里开始新一轮（立即发送或从队列取出后调用）
function startTurn(conv, text) {
  conv.toolCards = {};
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML = `<div class="role">Claude</div>`;
  conv.pane.appendChild(wrap);
  conv.currentBubble = wrap;
  conv.busy = true;
  if (conv === activeConv) refreshSendBtn();
  renderConvList();
  scrollIfActive(conv);
  window.api.chat({ convId: conv.id, prompt: text, resume: conv.sessionId || null });
  persistConvs();
}

function appendText(conv, t) {
  if (!conv || !conv.currentBubble) return;
  const cb = conv.currentBubble;
  let bubble = cb.querySelector(".bubble:last-of-type");
  const last = cb.lastElementChild;
  if (!bubble || (last && last.classList.contains("toolcall"))) {
    bubble = document.createElement("div");
    bubble.className = "bubble md";
    bubble._raw = "";
    cb.appendChild(bubble);
  }
  bubble._raw = (bubble._raw || "") + t;
  // 用 rAF 合并渲染：避免每个 token 都重解析全文(O(n²)，长回复会卡)。
  // 一帧内多次 chunk 只解析一次，视觉上仍是逐帧打字机效果。
  if (!bubble._renderPending) {
    bubble._renderPending = true;
    requestAnimationFrame(() => {
      bubble._renderPending = false;
      renderMd(bubble);
      scrollIfActive(conv);
    });
  }
}

// 把 bubble._raw 按 Markdown 渲染进 bubble（marked 已加载则用之，否则转义纯文本）
function renderMd(bubble) {
  bubble.innerHTML = window.marked ? marked.parse(bubble._raw || "") : esc(bubble._raw || "");
}

// 把已完成 assistant 容器里的 ```mermaid 代码块渲染成图
function renderMermaidInBubble(container) {
  if (!container) return;
  const blocks = container.querySelectorAll("code.language-mermaid");
  if (!blocks.length) return;
  const nodes = [];
  blocks.forEach((code) => {
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = code.textContent;
    const pre = code.closest("pre");
    (pre || code).replaceWith(div);
    nodes.push(div);
  });
  renderMermaidNodes(nodes); // 复用查看器里的渲染函数
}

function appendTool(conv, id, name, inputObj) {
  if (!conv || !conv.currentBubble) return;
  // AskUserQuestion：渲染成可点选的交互卡片（选完作为追问发回），而非普通工具行
  if (name === "AskUserQuestion" && inputObj && Array.isArray(inputObj.questions)) {
    return appendAskQuestion(conv, id, inputObj.questions);
  }
  const el = document.createElement("div");
  el.className = "toolcall";
  let arg = "";
  try { arg = JSON.stringify(inputObj); } catch { arg = String(inputObj); }
  if (arg.length > 300) arg = arg.slice(0, 300) + "…";
  el.textContent = `🔧 ${name}  ${arg}`;
  conv.currentBubble.appendChild(el);
  if (id) conv.toolCards[id] = el;
  scrollIfActive(conv);
}

// 弹一条系统通知 + 状态栏提示，告诉用户「需要做选择」，避免被后台对话刷屏滚过
function notifyDecision(text, urgent) {
  try {
    const s = $("status");
    if (s) s.textContent = (urgent ? "⚠ " : "🔔 ") + text;
  } catch {}
  try {
    if (typeof Notification === "undefined") return;
    const show = () => {
      try {
        new Notification(urgent ? tr("Claude 需要你的决定") : tr("Claude 等待你选择"), { body: text });
      } catch {}
    };
    if (Notification.permission === "granted") show();
    else if (Notification.permission !== "denied") Notification.requestPermission().then((p) => { if (p === "granted") show(); });
  } catch {}
}

// 把 AskUserQuestion 渲染成交互卡片：每题可点选项（单选/多选），点提交后把选择作为追问发回模型。
// 两档处理：① 每题都有明确「推荐」选项时，限定时间内未回复则自动按推荐选择并提交；
// ② 只要有一题没有推荐项（= 必须人工输入决定），则醒目提示并通知用户，绝不自动跳过。
function appendAskQuestion(conv, id, questions) {
  const box = document.createElement("div");
  box.className = "askq";
  // 每题的当前选择：单选存字符串，多选存 Set
  const picks = questions.map((q) => (q.multiSelect ? new Set() : null));
  // 每题的推荐项下标：标注了 (Recommended)/推荐 的选项；找不到则为 -1（=必须人工决定）
  const recIdx = questions.map((q) => (q.options || []).findIndex((o) => /recommended|推荐/i.test(o.label || "")));
  // 整张卡是否可在超时后自动按推荐选择：每题都得有明确推荐项
  const canAuto = questions.length > 0 && recIdx.every((i) => i >= 0);
  let interacted = false; // 用户一旦动手点选即取消自动倒计时
  let timer = null;
  function cancelCountdown() {
    if (timer) { clearInterval(timer); timer = null; }
    submit.textContent = tr("提交");
  }
  questions.forEach((q, qi) => {
    const qd = document.createElement("div");
    qd.className = "q";
    qd.textContent = q.question || q.header || tr("请选择");
    box.appendChild(qd);
    const group = []; // 本题的全部选项按钮，供单选互斥
    (q.options || []).forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "opt";
      btn.innerHTML =
        `${esc(o.label)}` +
        (o.description ? `<span class="desc">${esc(o.description)}</span>` : "");
      btn.onclick = () => {
        interacted = true; cancelCountdown();
        if (q.multiSelect) {
          if (picks[qi].has(o.label)) { picks[qi].delete(o.label); btn.classList.remove("sel"); }
          else { picks[qi].add(o.label); btn.classList.add("sel"); }
        } else {
          picks[qi] = o.label;
          group.forEach((b) => b.classList.remove("sel"));
          btn.classList.add("sel");
        }
      };
      group.push(btn);
      box.appendChild(btn);
    });
  });
  const submit = document.createElement("button");
  submit.className = "submit";
  submit.textContent = tr("提交");
  const doSubmit = () => {
    cancelCountdown();
    const parts = questions.map((q, qi) => {
      const v = picks[qi];
      const ans = q.multiSelect ? [...(v || [])].join("、") : (v || "");
      return `${q.question || q.header || ""}：${ans || tr("(未选)")}`;
    });
    box.classList.add("done");
    answerAskQuestion(conv, parts.join("\n"));
  };
  submit.onclick = () => { interacted = true; doSubmit(); };
  box.appendChild(submit);
  conv.currentBubble.appendChild(box);
  if (id) conv.toolCards[id] = box;
  scrollIfActive(conv);

  const firstQ = (questions[0] && (questions[0].question || questions[0].header)) || tr("请选择");
  if (canAuto) {
    // 有明确推荐项：限定时间内不回复则自动按推荐选择（仍先通知一次，避免被悄悄滚过）
    notifyDecision(firstQ, false);
    let left = 45;
    const tick = () => {
      if (interacted) { cancelCountdown(); return; }
      submit.textContent = trf("提交（{0}s 后自动按推荐）", left);
      if (left <= 0) {
        cancelCountdown();
        questions.forEach((q, qi) => {
          const o = (q.options || [])[recIdx[qi]];
          if (!o) return;
          if (q.multiSelect) picks[qi] = new Set([o.label]);
          else picks[qi] = o.label;
        });
        doSubmit();
        return;
      }
      left--;
    };
    tick();
    timer = setInterval(tick, 1000);
  } else {
    // 没有明确推荐项 = 必须人工输入决定：醒目高亮并通知，绝不自动跳过
    box.classList.add("mustdecide");
    notifyDecision(firstQ, true);
  }
}

// 把用户对 AskUserQuestion 的选择作为一条追问发回（忙碌则排队）
function answerAskQuestion(conv, text) {
  if (!conv || !text) return;
  addMsg(conv, "user", text);
  if (conv.busy) { conv.queue.push(text); renderConvList(); refreshSendBtn(); scrollIfActive(conv); }
  else startTurn(conv, text);
}

function appendToolResult(conv, id, isError, text) {
  if (!conv) return;
  const card = id && conv.toolCards[id];
  const details = document.createElement("details");
  details.className = "toolresult" + (isError ? " err" : "");
  const t = (text || "").trim() || tr("(无输出)");
  const oneLine = t.split("\n")[0].slice(0, 80);
  // oneLine 来自任意工具输出（常含 < & 等代码字符），拼进 innerHTML 前必须转义
  details.innerHTML = `<summary>${isError ? tr("✖ 出错") : tr("✔ 结果")} · ${esc(oneLine)}${t.length > 80 || t.includes("\n") ? tr(" …（点击展开）") : ""}</summary>`;
  const pre = document.createElement("pre");
  pre.textContent = t.length > 8000 ? t.slice(0, 8000) + tr("\n…（已截断）") : t;
  details.appendChild(pre);
  if (card && card.parentElement) card.after(details);
  else if (conv.currentBubble) conv.currentBubble.appendChild(details);
  scrollIfActive(conv);
}

// 有文字=发送/排队；无文字且忙碌=停止当前对话
$("send").onclick = () => {
  if ($("input").value.trim()) send();
  else if (activeConv?.busy) window.api.stop(activeConv.id);
};
$("input").addEventListener("keydown", (e) => {
  // @ 文件引用补全打开时，方向键/回车/Tab/Esc 优先操作候选
  const fpop = $("filePopup");
  if (fpop.classList.contains("open") && fileMatches.length) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      fileSel = (fileSel + 1) % fileMatches.length;
      highlightFile();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      fileSel = (fileSel - 1 + fileMatches.length) % fileMatches.length;
      highlightFile();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickFile(fileMatches[fileSel] || fileMatches[0]);
      return;
    }
    if (e.key === "Escape") {
      fpop.classList.remove("open");
      return;
    }
  }
  // slash 补全打开时，方向键/回车/Tab/Esc 优先操作候选
  const popup = $("slashPopup");
  if (popup.classList.contains("open") && slashMatches.length) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashSel = (slashSel + 1) % slashMatches.length;
      highlightSlash();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      slashSel = (slashSel - 1 + slashMatches.length) % slashMatches.length;
      highlightSlash();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickSlash(slashMatches[slashSel] || slashMatches[0]);
      return;
    }
    if (e.key === "Escape") {
      popup.classList.remove("open");
      return;
    }
  }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send(); // Ctrl/⌘+Enter 发送（忙碌时 send() 内部会自动排队）
  }
  // 普通 Enter 不拦截 => 换行
});

// ── 左侧栏折叠/展开 ────────────────────────────────────────
$("toggleSidebar").onclick = () => $("sidebar").classList.toggle("collapsed");

// ── 中英双语切换 ───────────────────────────────────────────
function refreshLangBtn() {
  // 按钮显示「将切换到的目标语言」
  $("langBtn").textContent = getLang() === "en" ? "中" : "EN";
}
$("langBtn").onclick = () => setLang(getLang() === "en" ? "zh" : "en");
// 切换语言后重渲染所有动态文案（静态文案由 i18n.js 的 applyI18n 处理）
window.addEventListener("i18n", () => {
  refreshLangBtn();
  refreshSendBtn();
  renderConvList();
  renderReqs();
  renderAttachList();
  renderReqAttachList();
  renderReqLinkList();
  loadUsageThrottled();
  if (activeRepo) { loadStatus(activeRepo); loadGraph(activeRepo); }
});
refreshLangBtn();

// ── 右上角：Claude 订阅用量 / 重置时间 ─────────────────────────
function fmtTime(t) {
  if (!t) return "—";
  try { return new Date(t).toLocaleString(getLang() === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return t; }
}
// 仅显示时:分（用于 5 小时窗到期时间，通常为当天）
function fmtTimeShort(t) {
  if (!t) return "—";
  try { return new Date(t).toLocaleTimeString(getLang() === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" }); }
  catch { return t; }
}
async function loadUsage(force) {
  const el = $("usage");
  el.textContent = tr("用量…");
  // force=true 跳过主进程的用量缓存（手动点击 / 切账号后需立即拿最新值）
  const u = await window.api.getUsage(force ? { force: true } : undefined);
  if (!u || u.error || !u.rate_limits_available || !u.rate_limits) {
    el.textContent = u && u.subscription_type ? u.subscription_type.toUpperCase() : tr("用量 N/A");
    el.title = u && u.error ? tr("用量不可用：") + u.error : tr("当前会话无订阅用量信息（如用 API Key）");
    return;
  }
  const sub = (u.subscription_type || "").toUpperCase();
  const fh = u.rate_limits.five_hour;
  const sd = u.rate_limits.seven_day;
  const parts = [];
  if (sub) parts.push(sub);
  if (fh && fh.utilization != null) parts.push(`⏰${fmtTimeShort(fh.resets_at)} ${Math.round(fh.utilization)}%`);
  if (sd && sd.utilization != null) parts.push(`7d ${Math.round(sd.utilization)}%`);
  el.textContent = parts.join(" · ") || tr("用量");
  el.title =
    `${tr("订阅：")}${sub || "-"}\n` +
    `${tr("5小时窗：")}${fh?.utilization ?? "-"}%  · ${tr("重置 ")}${fmtTime(fh?.resets_at)}\n` +
    `${tr("7天窗：")}${sd?.utilization ?? "-"}%  · ${tr("重置 ")}${fmtTime(sd?.resets_at)}\n` +
    `${tr("本会话花费：$")}${u.session?.total_cost_usd?.toFixed?.(4) ?? "-"}`;
}
let _usageThrottle = 0;
function loadUsageThrottled() {
  const now = Date.now();
  if (now - _usageThrottle < 60000) return; // 最多每分钟自动刷一次
  _usageThrottle = now;
  loadUsage();
}
$("usage").onclick = () => { _usageThrottle = Date.now(); loadUsage(true); };
loadUsage(); // 启动拉一次

// ── 打包：点 📦 弹三选一（完整备份 / 全量 / 给别人）→ 桌面 zip ──
async function doPack(mode) {
  const label = { full: tr("全量(含依赖,零安装)"), backup: tr("完整备份(含历史)"), dist: tr("给别人(不含私有数据)") }[mode];
  $("status").textContent = trf("📦 {0} 打包中…", label);
  const r = await window.api.packAll(mode);
  if (r && r.path) $("status").textContent = tr("✅ 已打包到桌面（Finder 已高亮）");
  else { $("status").textContent = ""; alert(tr("打包失败：") + "\n" + (r?.error || tr("未知"))); }
  setTimeout(() => ($("status").textContent = ""), 5000);
}
$("packBtn").onclick = (e) => {
  e.stopPropagation();
  const b = e.target.getBoundingClientRect();
  showMenu(b.left, b.bottom, [
    { label: tr("📦 完整备份（配置+历史+git，无依赖）"), run: () => doPack("backup") },
    { label: tr("💼 全量（含 node_modules，解压零安装）"), run: () => doPack("full") },
    { label: tr("🎁 给别人（不含你的私有数据）"), run: () => doPack("dist") },
  ]);
};

// ── Claude 账号快捷切换 ───────────────────────────────────────
async function openAcctMenu(anchor) {
  const m = $("acctMenu");
  const { current, accounts } = await window.api.acctList();
  let html = `<div class="am-hd">${tr("CLAUDE 账号")}</div>`;
  if (!accounts.length) {
    html += `<div class="am-empty">${tr("暂无存档账号，先用下方按钮保存当前登录")}</div>`;
  } else {
    for (const a of accounts) {
      const cur = a.email === current;
      html += `<div class="am-acct${cur ? " cur" : ""}" data-email="${a.email}">
        <span class="am-tick">${cur ? "✓" : ""}</span>
        <span class="am-info"><div class="am-name">${a.name || a.email}</div><div class="am-email">${a.email}</div></span>
        <span class="am-del" data-del="${a.email}" title="${tr("删除")}">✕</span>
      </div>`;
    }
  }
  html += `<div class="sep"></div><div class="am-act" id="amSave">＋ ${tr("保存当前登录为账号")}</div>`;
  m.innerHTML = html;
  m.classList.add("open");
  const b = anchor.getBoundingClientRect();
  m.style.left = Math.min(b.left, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = b.bottom + 4 + "px";

  m.querySelectorAll(".am-acct").forEach((row) => {
    row.onclick = async (e) => {
      if (e.target.dataset.del) return; // 删除按钮单独处理
      const email = row.dataset.email;
      if (email === current) { m.classList.remove("open"); return; }
      m.classList.remove("open");
      $("status").textContent = trf("切换到 {0}…", email);
      const r = await window.api.acctSwitch(email);
      if (r && r.ok) {
        $("status").textContent = trf("✅ 已切换到 {0}", email);
        _usageThrottle = 0; loadUsage(true);
      } else {
        $("status").textContent = "";
        alert(tr("切换失败：") + (r?.error || tr("未知")));
      }
      setTimeout(() => ($("status").textContent = ""), 5000);
    };
  });
  m.querySelectorAll(".am-del").forEach((x) => {
    x.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(trf("删除存档账号 {0}？", x.dataset.del))) return;
      await window.api.acctDelete(x.dataset.del);
      openAcctMenu(anchor); // 重新渲染
    };
  });
  $("amSave").onclick = async () => {
    m.classList.remove("open");
    const r = await window.api.acctSaveCurrent();
    if (r && r.ok) $("status").textContent = trf("✅ 已保存账号 {0}", r.email);
    else alert(tr("保存失败：") + (r?.error || tr("未知")));
    setTimeout(() => ($("status").textContent = ""), 5000);
  };
}
$("acctBtn").onclick = (e) => {
  e.stopPropagation();
  if ($("acctMenu").classList.contains("open")) { $("acctMenu").classList.remove("open"); return; }
  openAcctMenu(e.currentTarget);
};
document.addEventListener("click", () => $("acctMenu").classList.remove("open"));
$("acctMenu").addEventListener("click", (e) => e.stopPropagation());

// ── 手机连接面板 ───────────────────────────────────────────
function renderMobile(info) {
  const running = info && info.running;
  $("mobToggle").textContent = running ? tr("⏹ 停止服务") : tr("▶ 启动服务");
  $("mobState").textContent = running ? tr("运行中") : tr("未启动");
  $("mobConn").style.display = running && info.url ? "block" : "none";
  if (running && info.url) {
    $("mobUrl").textContent = info.url;
    $("mobQr").src =
      "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(info.url);
  }
}
$("mobileBtn").onclick = async () => {
  $("mobileModal").classList.add("open");
  renderMobile(await window.api.mobileStatus());
};
$("mobClose").onclick = () => $("mobileModal").classList.remove("open");
$("historyBtn").onclick = openHistory;
$("histClose").onclick = closeHistory;
$("historyModal").onclick = (e) => { if (e.target.id === "historyModal") closeHistory(); };
$("histSearch").oninput = (e) => renderHistory(e.target.value);
$("mobToggle").onclick = async () => {
  const cur = await window.api.mobileStatus();
  $("mobToggle").disabled = true;
  renderMobile(cur.running ? await window.api.mobileStop() : await window.api.mobileStart());
  $("mobToggle").disabled = false;
};
$("mobCopy").onclick = () => navigator.clipboard?.writeText($("mobUrl").textContent || "");
$("mobOpen").onclick = () => { const u = $("mobUrl").textContent; if (u) window.api.openExternal(u); };

// ── 自进化面板 ─────────────────────────────────────────────
let evolveBusy = false;
let _autoCooldown = 0;
let _periodicTimer = null;

function evLog(t) {
  const el = $("evLog");
  el.textContent += (el.textContent ? "\n" : "") + t;
  el.scrollTop = el.scrollHeight;
}
function setEvolveBusy(b) {
  evolveBusy = b;
  // 进化进行中：开始按钮变为“调整方向”，仍可向当前会话追加 update 消息
  const run = $("evRun");
  run.textContent = b ? tr("↳ 调整方向") : tr("开始");
  run.title = b ? tr("向进行中的进化追加方向调整（Ctrl+Enter）") : "";
  $("evStop").disabled = !b;
}
// 附件（图片/文档），路径数组
let evolveAttachments = [];
function renderAttachments() {
  const el = $("evAttach");
  el.innerHTML = "";
  evolveAttachments.forEach((p, i) => {
    const name = p.split(/[\\/]/).pop();
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.title = p;
    chip.innerHTML = `<span>📎 ${name}</span><span class="x">✕</span>`;
    chip.querySelector(".x").onclick = () => { evolveAttachments.splice(i, 1); renderAttachments(); };
    el.appendChild(chip);
  });
}
$("evAttachBtn").onclick = async () => {
  const files = await window.api.pickFiles();
  if (files && files.length) {
    for (const f of files) if (!evolveAttachments.includes(f)) evolveAttachments.push(f);
    renderAttachments();
  }
};
// 把粘贴/拖入的 File 存盘并加入附件（与对话框附件共用 saveFileAsAttachment）
async function addEvolveFile(file) {
  try {
    const a = await saveFileAsAttachment(file);
    if (!evolveAttachments.includes(a.path)) evolveAttachments.push(a.path);
    renderAttachments();
  } catch (e) {
    alert(tr("附件保存失败：") + e);
  }
}
// 粘贴图片/文档
$("evReq").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    files.forEach(addEvolveFile);
  }
});
// 拖入图片/文档
const evReqEl = $("evReq");
["dragenter", "dragover"].forEach((ev) =>
  evReqEl.addEventListener(ev, (e) => { e.preventDefault(); evReqEl.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  evReqEl.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && evReqEl.contains(e.relatedTarget)) return;
    evReqEl.classList.remove("dragover");
  })
);
evReqEl.addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  files.forEach(addEvolveFile);
});

async function runEvolve(requirement) {
  if (evolveBusy || !requirement.trim()) return;
  $("evolveModal").classList.add("open");
  setEvolveBusy(true);
  const attachments = evolveAttachments.slice();
  evLog("──────────\n▶ " + requirement + (attachments.length ? "\n📎 " + attachments.map((p) => p.split(/[\\/]/).pop()).join(", ") : ""));
  const r = await window.api.evolve({ requirement, attachments });
  // evolve:done 事件会兜底设状态；这里只处理立即错误
  if (r && r.error && !r.relaunch) setEvolveBusy(false);
}

// 停靠 / 隐藏 自进化面板（记忆状态，停靠后不挡对话）
if (localStorage.getItem("evolveDocked") === "1") $("evolveModal").classList.add("docked");
$("evolveBtn").onclick = () => {
  const m = $("evolveModal");
  m.classList.add("open");
  m.classList.remove("collapsed");
  loadIssues();
  loadEvolveHistory();
};
$("evClose").onclick = () => $("evolveModal").classList.remove("open", "collapsed");
$("evDock").onclick = () => {
  const docked = $("evolveModal").classList.toggle("docked");
  $("evolveModal").classList.remove("collapsed");
  localStorage.setItem("evolveDocked", docked ? "1" : "0");
};
$("evCollapse").onclick = () => {
  // 隐藏需停靠态：未停靠时先切到停靠
  $("evolveModal").classList.add("docked");
  localStorage.setItem("evolveDocked", "1");
  $("evolveModal").classList.add("collapsed");
};
$("evRestore").onclick = () => $("evolveModal").classList.remove("collapsed");
// 开始进化；进化进行中则改为向当前会话追加“调整方向”消息
function evRunOrSteer() {
  const req = $("evReq").value.trim();
  if (!req) return;
  if (evolveBusy) {
    window.api.evolveSteer(req);
    $("evReq").value = "";
  } else {
    runEvolve(req);
    $("evReq").value = "";
    evolveAttachments = [];
    renderAttachments();
  }
}
$("evRun").onclick = evRunOrSteer;
// Ctrl/Cmd+Enter 快捷触发（开始 / 调整方向）
$("evReq").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    evRunOrSteer();
  }
});
$("evStop").onclick = () => window.api.evolveStop();

// 问题清单
async function loadIssues() {
  const list = await window.api.getIssues();
  $("evIssueN").textContent = (list || []).length;
  const el = $("evIssues");
  el.innerHTML = "";
  (list || []).slice(0, 30).forEach((it) => {
    const d = document.createElement("div");
    d.className = "iss";
    const oneLine = it.message.split("\n")[0].slice(0, 120);
    d.textContent = `[${it.source}] ${oneLine}`;
    d.title = it.message;
    d.onclick = () => { $("evReq").value = "修复这个错误：\n" + it.message; };
    el.appendChild(d);
  });
}
$("evClearIssues").onclick = async () => { await window.api.clearIssues(); loadIssues(); };

// 进化记录（最近几次，供参考）
const EVOLVE_STATUS = {
  applied:    { cls: "ok",      label: "✔ 已应用" },
  relaunch:   { cls: "ok",      label: "↻ 重启应用" },
  nochange:   { cls: "neutral", label: "— 无改动" },
  rollback:   { cls: "bad",     label: "⤺ 已回滚" },
  rolledback: { cls: "bad",     label: "⤺ 已回滚" },
  error:      { cls: "bad",     label: "✖ 失败" },
};
async function loadEvolveHistory() {
  const list = (await window.api.getEvolveHistory()) || [];
  $("evHistN").textContent = list.length;
  const el = $("evHistory");
  el.innerHTML = "";
  list.slice(0, 20).forEach((h) => {
    const st = EVOLVE_STATUS[h.status] || { cls: "neutral", label: h.status || "?" };
    const d = document.createElement("div");
    d.className = "evh " + st.cls;
    const t = h.time ? new Date(h.time).toLocaleString() : "";
    const req = (h.requirement || "").split("\n")[0];
    const meta = [
      h.changed && h.changed.length ? "📝 " + h.changed.join(", ") : "",
      h.checkpoint ? "📌 " + String(h.checkpoint).slice(0, 7) : "",
      h.reason || "",
    ].filter(Boolean).join("  ·  ");
    d.innerHTML =
      `<div class="evh-top"><span class="evh-badge">${tr(st.label)}</span>` +
      `<span class="evh-req"></span><span class="evh-time"></span></div>` +
      (meta ? `<div class="evh-meta"></div>` : "");
    d.querySelector(".evh-req").textContent = req;
    d.querySelector(".evh-time").textContent = t;
    if (meta) d.querySelector(".evh-meta").textContent = meta;
    // 完整信息（需求 + Claude 摘要 + 错误）放 tooltip，点击把需求填回输入框以便复跑
    d.title = [
      "需求：" + (h.requirement || ""),
      h.summary ? "\n摘要：" + h.summary : "",
      h.error ? "\n错误：" + h.error : "",
    ].join("");
    d.onclick = () => { $("evReq").value = h.requirement || ""; };
    el.appendChild(d);
  });
}
$("evClearHist").onclick = async () => { await window.api.clearEvolveHistory(); loadEvolveHistory(); };

// 进化事件
window.api.on("evolve:log", (t) => evLog(t));
window.api.on("evolve:done", (info) => {
  setEvolveBusy(false);
  if (info?.error) evLog(tr("✖ 失败：") + info.error);
  else if (info?.noChange) evLog(tr("（无改动）"));
  else if (info?.relaunch) evLog(tr("✔ 已应用，正在重启…"));
  else evLog(tr("✔ 已应用并重载"));
  loadEvolveHistory();
});
window.api.on("evolve:rolledback", (m) => {
  $("evolveModal").classList.add("open");
  evLog(tr("⚠️ 上次进化导致启动异常，已自动回滚到 ") + String(m.sha || "").slice(0, 7));
});
window.api.on("issues:update", () => {
  loadIssues();
  // 全自动修复：有新错误且开启了开关、当前空闲、过了冷却 => 自动进化修复最新错误
  if ($("evAuto").checked && !evolveBusy && Date.now() - _autoCooldown > 90000) {
    _autoCooldown = Date.now();
    window.api.getIssues().then((list) => {
      if (list && list[0]) runEvolve("修复这个运行时错误（务必先定位根因再改）：\n" + list[0].message);
    });
  }
});

// 定期自检
function applyPeriodic() {
  clearInterval(_periodicTimer);
  if ($("evPeriodic").checked) {
    const ms = +$("evInterval").value;
    _periodicTimer = setInterval(() => {
      if (!evolveBusy) runEvolve("审视你自己的源码，找出一个明确的 bug、隐患或可改进点并修复（只改一处、保持稳定）。");
    }, ms);
  }
  try {
    localStorage.setItem("claudeTools.evAuto", $("evAuto").checked ? "1" : "");
    localStorage.setItem("claudeTools.evPeriodic", $("evPeriodic").checked ? "1" : "");
    localStorage.setItem("claudeTools.evInterval", $("evInterval").value);
  } catch {}
}
$("evAuto").onchange = applyPeriodic;
$("evPeriodic").onchange = applyPeriodic;
$("evInterval").onchange = applyPeriodic;
// 恢复开关
try {
  if (localStorage.getItem("claudeTools.evAuto")) $("evAuto").checked = true;
  if (localStorage.getItem("claudeTools.evPeriodic")) $("evPeriodic").checked = true;
  const iv = localStorage.getItem("claudeTools.evInterval");
  if (iv) $("evInterval").value = iv;
} catch {}
applyPeriodic();
loadIssues();
loadEvolveHistory();

// ── 需求驱动开发：左侧「需求」视图，逐条让右侧分析并修改代码 ──
// 视图切换（VSCode 式：源代码管理 / 需求，二者在侧栏中互相覆盖）
document.querySelectorAll("#activitybar .act-btn[data-view]").forEach((tab) => {
  tab.onclick = () => {
    // 再次点击当前视图图标 → 折叠/展开侧栏（VSCode 行为）
    if (tab.classList.contains("active")) {
      $("sidebar").classList.toggle("collapsed");
      return;
    }
    document
      .querySelectorAll("#activitybar .act-btn[data-view]")
      .forEach((x) => x.classList.toggle("active", x === tab));
    $("sidebar").classList.remove("collapsed");
    $("sidebar").classList.toggle("req-mode", tab.dataset.view === "req");
  };
});

let requirements = []; // {id, text, status: pending|running|done|failed, atts?: [{name,path,type,dataUrl?}]}
let reqPendingAtts = []; // 当前正在录入的需求所附带的文件
let reqPendingLinks = []; // 当前正在录入的需求所附带的链接（Jira / Confluence / 任意网址）
let reqRunning = false;
let reqConvId = null; // 绑定处理需求的对话（保持同一 session，让改动逐步累积）
try { requirements = JSON.parse(localStorage.getItem("claudeTools.reqs") || "[]"); } catch {}
requirements.forEach((r) => { if (r.status === "running") r.status = "pending"; }); // 重启后进行中的复位

function persistReqs() {
  try { localStorage.setItem("claudeTools.reqs", JSON.stringify(requirements)); } catch {}
}
function renderReqs() {
  const listEl = $("reqList");
  if (!listEl) return;
  $("reqCount").textContent = requirements.length;
  const pending = requirements.some((r) => r.status === "pending");
  $("reqStart").disabled = reqRunning || !pending;
  $("reqStart").textContent = reqRunning ? tr("⏳ 处理中…") : tr("▶ 开始处理");
  $("reqStop").disabled = !reqRunning;
  listEl.innerHTML = "";
  requirements.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "req-item " + r.status;
    const ic = { pending: "○", running: "◐", done: "✓", failed: "✕" }[r.status] || "○";
    const atts = r.atts || [];
    const attsHtml = atts.length
      ? `<div class="req-atts">` +
        atts.map((a) =>
          `<span class="req-att" title="${esc(a.path)}">` +
          (a.dataUrl ? `<img src="${a.dataUrl}">` : `📎`) +
          `<span>${esc(a.name)}</span></span>`
        ).join("") +
        `</div>`
      : "";
    const links = r.links || [];
    const linksHtml = links.length
      ? `<div class="req-links">` +
        links.map((u, li) => {
          const m = linkMeta(u);
          return `<span class="req-link" data-li="${li}" title="${esc(u)}">` +
            `${m.icon}<span>${esc(m.label)}</span></span>`;
        }).join("") +
        `</div>`
      : "";
    el.innerHTML =
      `<span class="req-ic">${ic}</span>` +
      `<div class="req-text">${esc(r.text)}${attsHtml}${linksHtml}</div>` +
      `<span class="req-del" title="${tr("删除")}">×</span>`;
    el.querySelectorAll(".req-link").forEach((ln) => {
      ln.onclick = (e) => {
        e.stopPropagation();
        const u = links[+ln.dataset.li];
        if (u) window.api.openExternal(u);
      };
    });
    el.querySelector(".req-del").onclick = (e) => {
      e.stopPropagation();
      if (r.status === "running") return; // 进行中的不可删
      requirements.splice(i, 1);
      renderReqs();
      persistReqs();
    };
    listEl.appendChild(el);
  });
  renderReqMini();
}
// 只保留最近 10 条：超出时优先移除最旧的「已完成/失败」项，不动待处理/进行中
function trimReqs() {
  const MAX = 10;
  let over = requirements.length - MAX;
  if (over <= 0) return;
  for (let i = 0; i < requirements.length && over > 0; ) {
    const r = requirements[i];
    if (r.status === "done" || r.status === "failed") { requirements.splice(i, 1); over--; }
    else i++;
  }
}
// 聊天区右上角浮动「开发清单」进度卡：做完一条划掉一条，只显示最近 10 条
let reqMiniCollapsed = localStorage.getItem("claudeTools.reqMiniCollapsed") === "1";
function renderReqMini() {
  const el = $("reqMini");
  if (!el) return;
  const items = requirements.slice(-10);
  if (!items.length) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.classList.toggle("collapsed", reqMiniCollapsed);
  const done = requirements.filter((r) => r.status === "done").length;
  const itemsHtml = items
    .map((r) => {
      const ic = { pending: "○", running: "◐", done: "✓", failed: "✕" }[r.status] || "○";
      return `<div class="rm-item ${r.status}"><span class="rm-ic">${ic}</span>` +
        `<span class="rm-tx">${esc(r.text || tr("(附件)"))}</span></div>`;
    })
    .join("");
  el.innerHTML =
    `<div class="rm-head"><span class="rm-title">📋 ${tr("开发清单")}</span>` +
    `<span class="rm-prog">${done}/${requirements.length}</span>` +
    `<span class="rm-tog">${reqMiniCollapsed ? "▸" : "▾"}</span></div>` +
    `<div class="rm-body">${itemsHtml}</div>`;
  el.querySelector(".rm-head").onclick = () => {
    reqMiniCollapsed = !reqMiniCollapsed;
    localStorage.setItem("claudeTools.reqMiniCollapsed", reqMiniCollapsed ? "1" : "0");
    renderReqMini();
  };
}
// 识别链接类型（用于图标与标签）：Jira ticket / Confluence 文档 / 普通网址
function linkMeta(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch {}
  const jira = url.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
  if (jira) return { icon: "🟦", label: jira[1], kind: "jira" };
  if (/\/wiki\//.test(url) || /confluence/i.test(host)) return { icon: "📘", label: host || "Confluence", kind: "confluence" };
  return { icon: "🔗", label: host || url, kind: "link" };
}
function linkNote(list) {
  if (!list || !list.length) return "";
  return (
    "\n\n[用户附带了以下链接，可用 WebFetch 工具或 curl 读取其内容（Jira ticket / Confluence 文档等）后据此处理]\n" +
    list.map((u) => "- " + u).join("\n")
  );
}
function addRequirement(text) {
  text = (text || "").trim();
  if (!text && !reqPendingAtts.length && !reqPendingLinks.length) return; // 允许只附文件/链接
  requirements.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text,
    status: "pending",
    atts: reqPendingAtts.slice(),
    links: reqPendingLinks.slice(),
  });
  reqPendingAtts = [];
  reqPendingLinks = [];
  trimReqs(); // 仅保留最近 10 条
  renderReqAttachList();
  renderReqLinkList();
  renderReqs();
  persistReqs();
  if (reqRunning) pumpReqs(); // 运行中追加 => 自动衔接处理
}
function renderReqAttachList() {
  const el = $("reqAttachList");
  if (!el) return;
  el.innerHTML = "";
  reqPendingAtts.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.innerHTML =
      (a.dataUrl ? `<img src="${a.dataUrl}">` : `<span>📎</span>`) +
      `<span class="an" title="${esc(a.name)}">${esc(a.name)}</span>` +
      `<span class="ax" title="${tr("移除")}">×</span>`;
    chip.querySelector(".ax").onclick = () => {
      reqPendingAtts.splice(i, 1);
      renderReqAttachList();
    };
    el.appendChild(chip);
  });
}
function renderReqLinkList() {
  const el = $("reqLinkList");
  if (!el) return;
  el.innerHTML = "";
  reqPendingLinks.forEach((u, i) => {
    const m = linkMeta(u);
    const chip = document.createElement("div");
    chip.className = "attach-chip link-chip";
    chip.innerHTML =
      `<span>${m.icon}</span>` +
      `<span class="an" title="${esc(u)}">${esc(m.label)}</span>` +
      `<span class="ax" title="${tr("移除")}">×</span>`;
    chip.querySelector(".ax").onclick = () => {
      reqPendingLinks.splice(i, 1);
      renderReqLinkList();
    };
    el.appendChild(chip);
  });
}
function addReqLink() {
  const raw = (prompt(tr("粘贴链接（Jira ticket / Confluence 文档 / 任意网址）：")) || "").trim();
  if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  reqPendingLinks.push(url);
  renderReqLinkList();
}
async function addReqAttachment(file) {
  try {
    reqPendingAtts.push(await saveFileAsAttachment(file));
    renderReqAttachList();
  } catch (e) {
    alert(tr("附件保存失败：") + e);
  }
}
// 取下一条待处理需求发给右侧对话（仅在对话空闲时发；完成的回调里再推进）
function pumpReqs() {
  if (!reqRunning) return;
  if (requirements.some((r) => r.status === "running")) return; // 已有进行中的，等其完成
  const next = requirements.find((r) => r.status === "pending");
  if (!next) { reqRunning = false; renderReqs(); persistReqs(); return; } // 全部完成
  let conv = (reqConvId && getConv(reqConvId)) || activeConv || conversations[0];
  if (!conv) return;
  reqConvId = conv.id;
  if (conv.busy) return; // 对话忙 => 等其本轮结束的回调再 pump
  ensurePane(conv);
  next.status = "running";
  renderReqs();
  persistReqs();
  const atts = next.atts || [];
  const links = next.links || [];
  const ub = addMsg(conv, "user", tr("📋 需求：") + (next.text || tr("(附件)"))); // 在对话里留痕
  if (atts.length) renderMsgAttachments(ub, atts); // 气泡里展示附件
  startTurn(conv, (next.text || "") + attachNote(atts) + linkNote(links));
}
function startReqs() {
  if (reqRunning) return;
  if (!requirements.some((r) => r.status === "pending")) return;
  reqRunning = true;
  reqConvId = activeConv?.id || null;
  renderReqs();
  pumpReqs();
}
function stopReqs() {
  if (!reqRunning) return;
  reqRunning = false;
  const conv = reqConvId && getConv(reqConvId);
  if (conv && conv.busy) window.api.stop(conv.id);
  requirements.forEach((r) => { if (r.status === "running") r.status = "pending"; });
  renderReqs();
  persistReqs();
}
// 某对话一轮结束时调用：推进需求队列（完成→done 并接下一条，出错/中止→failed 并暂停）
function reqOnTurnEnd(conv, ok) {
  if (!reqRunning || !conv || conv.id !== reqConvId) return;
  const cur = requirements.find((r) => r.status === "running");
  if (cur) {
    cur.status = ok ? "done" : "failed";
    trimReqs(); // 完成后仅保留最近 10 条
    persistReqs();
    renderReqs();
    if (!ok) { reqRunning = false; renderReqs(); return; } // 失败 => 暂停，保留现场待人工处理
  }
  pumpReqs();
}
$("reqAdd").onclick = () => {
  const v = $("reqInput").value;
  if (v.trim() || reqPendingAtts.length || reqPendingLinks.length) { addRequirement(v); $("reqInput").value = ""; $("reqInput").focus(); }
};
$("reqInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("reqAdd").onclick(); }
});
// 需求附件：按钮选文件 / 粘贴 / 拖入
$("reqAttach").onclick = () => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.onchange = () => { [...inp.files].forEach(addReqAttachment); };
  inp.click();
};
$("reqLink").onclick = addReqLink;
$("reqInput").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); files.forEach(addReqAttachment); }
});
const reqBar = document.querySelector(".req-inputbar");
["dragenter", "dragover"].forEach((ev) =>
  reqBar.addEventListener(ev, (e) => { e.preventDefault(); reqBar.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  reqBar.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && reqBar.contains(e.relatedTarget)) return;
    reqBar.classList.remove("dragover");
  })
);
reqBar.addEventListener("drop", (e) => {
  [...(e.dataTransfer?.files || [])].forEach(addReqAttachment);
});
$("reqStart").onclick = startReqs;
$("reqStop").onclick = stopReqs;
$("reqClear").onclick = () => {
  if (reqRunning) return;
  requirements = [];
  renderReqs();
  persistReqs();
};
renderReqAttachList();
renderReqs();

// ── 可拖动分隔条（侧栏宽度 / Source Control 高度）──────────────
function makeResizer(handle, axis, get, set, min, max, key) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("drag");
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const startVal = get();
    const move = (ev) => {
      const delta = (axis === "x" ? ev.clientX : ev.clientY) - startPos;
      set(Math.max(min, Math.min(max(), startVal + delta)));
    };
    const up = () => {
      handle.classList.remove("drag");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      try { localStorage.setItem(key, String(Math.round(get()))); } catch {}
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}
// 侧栏宽度
makeResizer(
  $("sidebarResizer"), "x",
  () => $("sidebar").getBoundingClientRect().width,
  (v) => ($("sidebar").style.width = v + "px"),
  180, () => Math.min(700, innerWidth - 320),
  "claudeTools.sidebarW"
);
// Source Control 面板高度（与文件树的上下分割）
makeResizer(
  $("scResizer"), "y",
  () => $("branchpanel").getBoundingClientRect().height,
  (v) => { const p = $("branchpanel"); p.style.flex = "none"; p.style.height = v + "px"; },
  100, () => $("sidebar").getBoundingClientRect().height - 120,
  "claudeTools.scH"
);
// 恢复上次拖动的尺寸
try {
  const w = localStorage.getItem("claudeTools.sidebarW");
  if (w) $("sidebar").style.width = w + "px";
  const h = localStorage.getItem("claudeTools.scH");
  if (h) { const p = $("branchpanel"); p.style.flex = "none"; p.style.height = h + "px"; }
} catch {}

// ── 斜杠命令 / skills 补全 ─────────────────────────────────
let slashCommands = [];
let slashMatches = [];
let slashSel = 0;
try {
  slashCommands = JSON.parse(localStorage.getItem("claudeTools.cmds") || "[]");
} catch {}

function updateSlash() {
  const popup = $("slashPopup");
  const v = $("input").value;
  const m = /^\/(\S*)$/.exec(v); // 仅当以 / 开头且首词未输完（无空格）
  if (!m || !slashCommands.length) {
    popup.classList.remove("open");
    return;
  }
  const q = m[1].toLowerCase();
  slashMatches = slashCommands
    .filter((c) => c.toLowerCase().includes(q))
    .sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q))
    .slice(0, 50);
  if (!slashMatches.length) {
    popup.classList.remove("open");
    return;
  }
  slashSel = 0;
  popup.innerHTML = "";
  slashMatches.forEach((c) => {
    const el = document.createElement("div");
    el.className = "slash-item";
    el.innerHTML = `<span class="cmd">/${esc(c)}</span>`;
    el.onmousedown = (e) => {
      e.preventDefault();
      pickSlash(c);
    };
    popup.appendChild(el);
  });
  highlightSlash();
  popup.classList.add("open");
}

function highlightSlash() {
  const popup = $("slashPopup");
  [...popup.children].forEach((el, i) => {
    const on = i === slashSel;
    el.classList.toggle("sel", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
}

function pickSlash(c) {
  if (!c) return;
  $("input").value = "/" + c + " ";
  $("slashPopup").classList.remove("open");
  $("input").focus();
}

$("input").addEventListener("input", () => {
  updateSlash();
  updateMention();
  refreshSendBtn(); // 输入时切换 发送/停止 按钮态
});

// ── @ 文件引用补全 ─────────────────────────────────────────
let fileMatches = [];
let fileSel = 0;
let mentionStart = -1; // 当前 @ 在 input.value 中的起始下标
let mentionToken = 0; // 防抖：异步搜索返回后丢弃过期结果

// 取光标前的 @词；返回 {start, query} 或 null
function currentMention() {
  const input = $("input");
  const caret = input.selectionStart;
  const before = input.value.slice(0, caret);
  const m = /(^|\s)@(\S*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

async function updateMention() {
  const popup = $("filePopup");
  const mention = currentMention();
  if (!mention) {
    popup.classList.remove("open");
    mentionStart = -1;
    return;
  }
  mentionStart = mention.start;
  const token = ++mentionToken;
  const results = await window.api.searchFiles(mention.query);
  if (token !== mentionToken) return; // 已有更新的查询，丢弃
  fileMatches = results.slice(0, 50);
  if (!fileMatches.length) {
    popup.classList.remove("open");
    return;
  }
  fileSel = 0;
  popup.innerHTML = "";
  fileMatches.forEach((f) => {
    const el = document.createElement("div");
    el.className = "slash-item";
    el.innerHTML = `<span class="cmd">${esc(f.name)}</span><span class="rel">${esc(f.rel)}</span>`;
    el.onmousedown = (e) => {
      e.preventDefault();
      pickFile(f);
    };
    popup.appendChild(el);
  });
  highlightFile();
  popup.classList.add("open");
}

function highlightFile() {
  const popup = $("filePopup");
  [...popup.children].forEach((el, i) => {
    const on = i === fileSel;
    el.classList.toggle("sel", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
}

function pickFile(f) {
  if (!f || mentionStart < 0) return;
  const input = $("input");
  const caret = input.selectionStart;
  const ref = "@" + f.rel + " ";
  input.value = input.value.slice(0, mentionStart) + ref + input.value.slice(caret);
  const pos = mentionStart + ref.length;
  input.setSelectionRange(pos, pos);
  $("filePopup").classList.remove("open");
  mentionStart = -1;
  input.focus();
}

function finishTurn(conv, metaText, errText) {
  if (!conv) return;
  conv.busy = false;
  if (errText) {
    if (conv.currentBubble) {
      const err = document.createElement("div");
      err.className = "bubble err";
      err.textContent = errText;
      conv.currentBubble.appendChild(err);
    } else {
      addMsg(conv, "assistant", errText).classList.add("err");
    }
  }
  if (metaText && conv.currentBubble) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaText;
    conv.currentBubble.appendChild(meta);
  }
  if (conv.currentBubble) {
    // flush 流式渲染：确保最后一帧未及渲染的 token 已落地，再渲染 mermaid
    conv.currentBubble.querySelectorAll(".bubble.md").forEach((b) => {
      if (b._renderPending) { b._renderPending = false; renderMd(b); }
    });
    renderMermaidInBubble(conv.currentBubble); // 渲染 mermaid 图
  }
  conv.currentBubble = null;
  if (conv === activeConv) refreshSendBtn();
  renderConvList();
  scrollIfActive(conv);
  persistConvs();
}

// ── 来自主进程的流式事件（按 convId 路由到对应对话，支持后台并行）──
window.api.on("chat:init", ({ convId, model, tools, mcp, commands, skills, agents }) => {
  // 缓存命令列表供 / 补全（含 skills），持久化以便下次启动即可用
  if (commands && commands.length) {
    slashCommands = commands;
    try {
      localStorage.setItem("claudeTools.cmds", JSON.stringify(slashCommands));
    } catch {}
  }
  const conv = getConv(convId);
  if (!conv || conv.inited) return;
  conv.inited = true;
  ensurePane(conv);
  const mcpStr = mcp.length ? mcp.map((m) => `${m.name}(${m.status})`).join(", ") : tr("无");
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML =
    `<div class="role">${tr("引擎")}</div>` +
    `<div class="bubble" style="font-size:11px;color:#9a9a9a">${tr("已加载 · model ")}<b>${esc(model)}</b>` +
    `${tr(" · 工具 ")}${tools.length} · MCP ${mcp.length} [${esc(mcpStr)}]` +
    `${tr(" · 命令 ")}${commands.length} · skills ${skills.length}${tr(" · 子agent ")}${agents.length}</div>`;
  conv.pane.appendChild(wrap);
  scrollIfActive(conv);
});
window.api.on("chat:chunk", ({ convId, text }) => appendText(getConv(convId), text));
window.api.on("chat:tool", ({ convId, id, name, input }) =>
  appendTool(getConv(convId), id, name, input)
);
window.api.on("chat:toolresult", ({ convId, id, isError, text }) =>
  appendToolResult(getConv(convId), id, isError, text)
);
window.api.on("chat:done", ({ convId, cost, ms, session }) => {
  const conv = getConv(convId);
  if (conv && session) conv.sessionId = session; // 记住本对话 session
  finishTurn(conv, `${tr("用时 ")}${ms}ms · cost(est) $${cost?.toFixed?.(4) ?? cost}`);
  loadUsageThrottled(); // 刷新右上角用量
  // 队列里还有追问 => 自动发下一条（续接同一 session）；否则推进需求清单
  if (conv && conv.queue.length) startTurn(conv, conv.queue.shift());
  else reqOnTurnEnd(conv, true);
});
window.api.on("chat:stopped", ({ convId }) => {
  const conv = getConv(convId);
  if (conv) conv.queue = []; // 用户主动停止 => 清空排队
  finishTurn(conv, tr("⏹ 已停止"));
  reqOnTurnEnd(conv, false);
});
window.api.on("chat:error", ({ convId, message }) => {
  const conv = getConv(convId);
  if (conv) conv.queue = []; // 出错 => 不再继续排队
  finishTurn(getConv(convId), null, tr("出错了：") + "\n" + message);
  reqOnTurnEnd(conv, false);
});
