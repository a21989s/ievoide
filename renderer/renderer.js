const $ = (id) => document.getElementById(id);
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); }
  catch { try { toast(tr('本地存储已满，设置未保存'), 'error'); } catch {} }
}
// 拖拽附件工厂：高亮 dragover，drop 时把文件逐个交给 onFiles
function setupDropZone(el, onFiles) {
  ["dragenter", "dragover"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && el.contains(e.relatedTarget)) return;
      el.classList.remove("dragover");
    })
  );
  el.addEventListener("drop", (e) => {
    [...(e.dataTransfer?.files || [])].forEach(onFiles);
  });
}
const chat = $("chat");

// 状态栏延时清空：仅在 ms 后该消息仍是当前显示内容时才清空，
// 避免延时到点时把期间设置的新状态消息误清空
const clearStatusLater = (ms) => {
  const el = $("status");
  const snapshot = el.textContent;
  setTimeout(() => { if (el.textContent === snapshot) el.textContent = ""; }, ms);
};

// 非阻塞提示：右下角浮层，type 为 error/success/info（默认 info），数秒后自动消失
function toast(msg, type = "info") {
  const box = $("toasts");
  if (!box) return alert(msg);
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  if (type === "error") {
    const btn = document.createElement("button");
    btn.textContent = "复制";
    btn.style.cssText = "margin-left:8px;padding:1px 6px;font-size:11px;cursor:pointer;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);border-radius:3px;color:inherit;flex-shrink:0;";
    btn.onclick = async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(msg); } catch {}
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "复制"; }, 1500);
    };
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.appendChild(btn);
  }
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, type === "error" ? 6000 : 3500);
}

// 轻量模态对话：替代阻塞式 prompt()/confirm()，复用应用配色与遮罩。
// def 非 null 时为输入框（resolve 输入值或 null），为 null 时为确认（resolve true/false）。Esc 取消，Enter 确定。
function modalDialog(text, def) {
  return new Promise((resolve) => {
    // Electron 渲染进程不支持原生 prompt()/confirm()，遮罩缺失时动态创建而非回退到原生对话框
    let ov = $("modalDialog");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "modalDialog";
      (document.body || document.documentElement).appendChild(ov);
    }
    const isPrompt = def != null;
    const box = document.createElement("div");
    box.className = "box";
    const msg = document.createElement("div");
    msg.className = "md-msg";
    msg.textContent = text;
    box.appendChild(msg);
    let input;
    if (isPrompt) {
      input = document.createElement("input");
      input.className = "md-input";
      input.value = def;
      box.appendChild(input);
    }
    const btns = document.createElement("div");
    btns.className = "md-btns";
    const cancel = document.createElement("button");
    cancel.className = "md-cancel";
    cancel.textContent = tr("取消");
    const ok = document.createElement("button");
    ok.textContent = tr("确定");
    btns.appendChild(cancel);
    btns.appendChild(ok);
    box.appendChild(btns);
    const close = (val) => {
      document.removeEventListener("keydown", onKey, true);
      ov.classList.remove("open");
      ov.innerHTML = "";
      resolve(val);
    };
    cancel.onclick = () => close(isPrompt ? null : false);
    ok.onclick = () => close(isPrompt ? input.value : true);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel.click(); }
      else if (e.key === "Enter") { e.preventDefault(); ok.click(); }
    };
    document.addEventListener("keydown", onKey, true);
    ov.innerHTML = "";
    ov.appendChild(box);
    ov.classList.add("open");
    if (isPrompt) { input.focus(); input.select(); } else ok.focus();
  });
}
const modalPrompt = (title, def = "") => modalDialog(title, def == null ? "" : def);
const modalConfirm = (msg) => modalDialog(msg, null);

// 可编辑多行文本框确认弹窗（用于提交信息预览/修改）
function modalTextarea(title, def = "") {
  return new Promise((resolve) => {
    let ov = $("modalDialog");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "modalDialog";
      (document.body || document.documentElement).appendChild(ov);
    }
    const box = document.createElement("div");
    box.className = "box";
    const msg = document.createElement("div");
    msg.className = "md-msg";
    msg.textContent = title;
    box.appendChild(msg);
    const ta = document.createElement("textarea");
    ta.className = "md-input";
    ta.style.cssText = "width:100%;min-height:80px;resize:vertical;font-size:13px;padding:6px;box-sizing:border-box;";
    ta.value = def;
    box.appendChild(ta);
    setTimeout(() => ta.focus(), 50);
    const btns = document.createElement("div");
    btns.className = "md-btns";
    const cancel = document.createElement("button");
    cancel.className = "md-cancel";
    cancel.textContent = tr("取消");
    const ok = document.createElement("button");
    ok.textContent = tr("确定提交");
    btns.appendChild(cancel);
    btns.appendChild(ok);
    box.appendChild(btns);
    const close = (val) => {
      document.removeEventListener("keydown", onKey, true);
      ov.classList.remove("open");
      ov.innerHTML = "";
      resolve(val);
    };
    cancel.onclick = () => close(null);
    ok.onclick = () => close(ta.value.trim() || null);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel.click(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); }
    };
    document.addEventListener("keydown", onKey, true);
    ov.innerHTML = "";
    ov.appendChild(box);
    ov.classList.add("open");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

// 自进化健康心跳：渲染层成功加载即上报，宿主据此确认进化后的版本健康（否则自动回滚）
try { window.api.evolveAlive(); } catch {}

// ── 文件树 ────────────────────────────────────────────────
async function renderChildren(container, dirPath, depth, expandSet) {
  const items = await window.api.listDir(dirPath);
  for (const it of items) {
    const node = document.createElement("div");
    node.className = "node " + (it.isDir ? "dir" : "file");
    node.dataset.path = it.path; // 供重建文件树时恢复展开层级与选中态
    node.style.paddingLeft = 8 + depth * 14 + "px";
    // 文件名来自任意目录，必须转义——否则含 < & 或 <img onerror> 的文件名会破坏渲染/注入标记
    node.innerHTML = `<span class="twist">${it.isDir ? "▸" : ""}</span>${it.isDir ? "📁" : "📄"} ${esc(it.name)}`;
    container.appendChild(node);
    // 右键：重命名 / 删除 / 复制相对路径 / Finder 中显示（VSCode 资源管理器基本盘）
    node.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileNodeMenu(it, e.clientX, e.clientY);
    };

    if (it.isDir) {
      let expanded = false;
      let childWrap = null;
      const expand = async () => {
        childWrap = document.createElement("div");
        node.after(childWrap);
        await renderChildren(childWrap, it.path, depth + 1, expandSet);
        expanded = true;
        node.querySelector(".twist").textContent = "▾";
      };
      node.onclick = async (e) => {
        e.stopPropagation();
        if (expanded) {
          childWrap.remove();
          childWrap = null;
          expanded = false;
          node.querySelector(".twist").textContent = "▸";
        } else {
          await expand();
        }
      };
      if (expandSet && expandSet.has(it.path)) await expand(); // 重建时恢复原来已展开的目录
    } else {
      node.onclick = (e) => {
        e.stopPropagation();
        // 高亮当前打开的文件（VSCode 资源管理器行为）
        document.querySelectorAll("#tree .node.active").forEach((n) => n.classList.remove("active"));
        node.classList.add("active");
        openFile(it.path, it.name);
      };
    }
  }
}

// 文件树节点右键菜单：重命名 / 删除（废纸篓）/ 复制相对路径 / Finder 中显示
function fileNodeMenu(it, x, y) {
  const root = (currentFolder || "").replace(/\/+$/, "");
  const rel = it.path.startsWith(root + "/") ? it.path.slice(root.length + 1) : it.path;
  showMenu(x, y, [
    {
      label: tr("重命名"),
      run: async () => {
        const name = ((await modalPrompt(tr("新名称："), it.name)) || "").trim();
        if (!name || name === it.name) return;
        if (name.includes("/")) { toast(tr("名称不能包含 /"), "error"); return; }
        const newPath = it.path.slice(0, it.path.length - it.name.length) + name;
        const r = await window.api.renameEntry(it.path, newPath);
        if (!r.ok) { toast(tr("重命名失败：") + (r.error || ""), "error"); return; }
        // 把 DOM 里的旧路径前缀改成新路径，refreshFileTree 才能按新路径恢复展开与选中态
        document.querySelectorAll("#tree .node").forEach((n) => {
          if (n.dataset.path === it.path) n.dataset.path = newPath;
          else if (n.dataset.path.startsWith(it.path + "/"))
            n.dataset.path = newPath + n.dataset.path.slice(it.path.length);
        });
        await refreshFileTree();
      },
    },
    {
      label: tr("复制相对路径"),
      run: async () => {
        try { await navigator.clipboard.writeText(rel); toast(tr("已复制：") + rel); }
        catch { toast(tr("复制失败"), "error"); }
      },
    },
    { label: tr("在 Finder / 文件管理器中显示"), run: () => window.api.revealInFolder(it.path) },
    { sep: true },
    {
      label: tr("删除（移入废纸篓）"),
      danger: true,
      run: async () => {
        if (!(await modalConfirm(trf("把 {0} 移入废纸篓？", it.name)))) return;
        const r = await window.api.trashEntry(it.path);
        if (!r.ok) { toast(tr("删除失败：") + (r.error || ""), "error"); return; }
        await refreshFileTree();
      },
    },
  ]);
}

// AI 改动文件 / 撤销改动后重建文件树：保留已展开的目录层级与选中文件
async function refreshFileTree() {
  if (!currentFolder) return;
  const tree = $("tree");
  const expandSet = new Set(
    [...tree.querySelectorAll(".node.dir")]
      .filter((n) => n.querySelector(".twist")?.textContent === "▾")
      .map((n) => n.dataset.path)
  );
  const activePath = tree.querySelector(".node.active")?.dataset.path;
  tree.innerHTML = "";
  await renderChildren(tree, currentFolder, 0, expandSet);
  if (activePath)
    tree.querySelector(`.node.file[data-path="${CSS.escape(activePath)}"]`)?.classList.add("active");
}

let currentFolder = null; // 当前打开的工作目录（用于语言无关地判断是否已选目录）
async function openFolderUI(folder) {
  currentFolder = folder;
  $("folder").textContent = folder;
  $("tree").innerHTML = "";
  await renderChildren($("tree"), folder, 0);
  await loadRepos();
  // 加载该 workdir 对应的项目记忆
  loadProjectMemoryUI();
  // 若该 workdir 尚无记忆，尝试自动注入 CLAUDE.md
  if (!getProjectMemory()) {
    try {
      const md = await window.api.readWorkdirFile("CLAUDE.md");
      if (md && !md.startsWith("(")) {
        appendToProjectMemory(md);
        toast("检测到 CLAUDE.md，已写入项目记忆", "info");
      }
    } catch {}
  }
}

// ── 最近目录工具（零 token，纯 localStorage）──────────────────
const RECENT_FOLDERS_KEY = "claudeTools.recentFolders";
const RECENT_FOLDERS_MAX = 8;
function getRecentFolders() {
  try { return JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) || "[]"); } catch { return []; }
}
function saveRecentFolder(folder) {
  const list = getRecentFolders().filter(f => f !== folder);
  list.unshift(folder);
  try {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list.slice(0, RECENT_FOLDERS_MAX)));
    localStorage.setItem("claudeTools.folder", folder);
  } catch {}
}
function removeRecentFolder(folder) {
  const list = getRecentFolders().filter(f => f !== folder);
  try { localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list)); } catch {}
}

function renderRecentFoldersMenu() {
  const menu = $("recentFoldersMenu");
  const list = getRecentFolders();
  if (!list.length) { menu.innerHTML = `<div class="rfm-item" style="color:var(--muted);cursor:default">${tr("暂无最近目录")}</div>`; return; }
  menu.innerHTML = list.map((f, i) =>
    `<div class="rfm-item" data-idx="${i}" title="${f}">📂 <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${f}</span><span class="rfm-del" data-del="${i}">✕</span></div>`
  ).join("");
  menu.querySelectorAll(".rfm-item").forEach(el => {
    el.addEventListener("click", async (e) => {
      const delBtn = e.target.closest("[data-del]");
      if (delBtn) {
        e.stopPropagation();
        const idx = +delBtn.dataset.del;
        removeRecentFolder(list[idx]);
        renderRecentFoldersMenu();
        return;
      }
      const idx = +el.dataset.idx;
      const folder = list[idx];
      menu.classList.remove("open");
      const ok = await window.api.setWorkdir(folder);
      if (ok) { saveRecentFolder(folder); await openFolderUI(folder); }
      else { removeRecentFolder(folder); toast(tr("目录已不存在：") + folder, "error"); renderRecentFoldersMenu(); }
    });
  });
}

$("pickDropBtn").onclick = (e) => {
  e.stopPropagation();
  const menu = $("recentFoldersMenu");
  const willOpen = !menu.classList.contains("open");
  menu.classList.toggle("open", willOpen);
  if (willOpen) renderRecentFoldersMenu();
};
document.addEventListener("click", () => $("recentFoldersMenu").classList.remove("open"));

$("pick").onclick = async () => {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  saveRecentFolder(folder);
  await openFolderUI(folder);
};

// 重启后恢复上次打开的文件夹
(async function restoreFolder() {
  let folder = null;
  try { folder = localStorage.getItem("claudeTools.folder"); } catch {}
  if (!folder) return;
  const ok = await window.api.setWorkdir(folder);
  if (ok) await openFolderUI(folder);
  else { removeRecentFolder(folder); try { localStorage.removeItem("claudeTools.folder"); } catch {} }
})();

// ── 新建文件 / 新建文件夹：取相对路径，建好后刷新树，.md 自动进编辑 ──
async function createEntry(isDir) {
  if (!currentFolder) { toast(tr("请先选择文件夹"), "error"); return; }
  const rel = ((await modalPrompt(tr(isDir ? "新建文件夹（相对路径）：" : "新建文件（相对路径）："))) || "")
    .trim().replace(/^\/+/, "");
  if (!rel) return;
  const root = currentFolder.replace(/\/+$/, "");
  const full = root + "/" + rel;
  if (isDir) {
    const r = await window.api.mkdir(full);
    if (!r.ok) { toast(tr("创建失败：") + (r.error || ""), "error"); return; }
  } else {
    const slash = full.lastIndexOf("/");
    const parent = full.slice(0, slash);
    const name = full.slice(slash + 1);
    if (parent && parent !== root) {
      const r = await window.api.mkdir(parent);
      if (!r.ok) { toast(tr("创建失败：") + (r.error || ""), "error"); return; }
    }
    // 防止误覆盖已存在的同名文件
    const siblings = await window.api.listDir(parent || root);
    if (siblings.some((s) => s.name === name)) { toast(tr("同名文件已存在"), "error"); return; }
    const r = await window.api.writeFile(full, "");
    if (!r.ok) { toast(tr("创建失败：") + (r.error || ""), "error"); return; }
  }
  await refreshFileTree(); // 刷新文件树（保留展开层级与选中态）
  // 新建的 .md 文件自动打开并进入内联编辑
  if (!isDir && /\.(md|markdown)$/i.test(rel)) {
    await openFile(full, rel.split("/").pop());
    if (!mdEditing) enterMdEdit();
  }
}
$("newFile").onclick = () => createEntry(false);
$("newFolder").onclick = () => createEntry(true);

// ── 项目规则：探测 workdir 根目录的 AGENTS.md / CLAUDE.md，无则一键创建，复用 md 内联编辑器维护跨会话约定 ──
const AGENTS_MD_TEMPLATE = `# AGENTS.md

> 跨会话的项目约定，供 AI 助手与协作者共同遵循。

## 项目简介
<!-- 这是什么项目、技术栈、目录结构要点 -->

## 构建与测试命令
<!-- 例如：npm install / npm test / npm run build -->

## 代码风格与规范
<!-- 命名、格式化、提交信息约定等 -->

## 注意事项
<!-- 易踩的坑、不要改动的地方、外部依赖等 -->
`;
async function openProjectRules() {
  if (!currentFolder) { toast(tr("请先选择文件夹"), "error"); return; }
  const root = currentFolder.replace(/\/+$/, "");
  const items = await window.api.listDir(root);
  const find = (n) => items.find((it) => !it.isDir && it.name.toLowerCase() === n);
  const agents = find("agents.md"), claude = find("claude.md");
  let target = agents || claude, created = false;
  if (agents && claude) {
    // 两者都在：默认打开 AGENTS.md，取消则打开 CLAUDE.md
    target = (await modalConfirm(tr("同时存在 AGENTS.md 与 CLAUDE.md，打开 AGENTS.md？（取消则打开 CLAUDE.md）"))) ? agents : claude;
  } else if (!target) {
    if (!(await modalConfirm(tr("未找到项目规则文件，创建 AGENTS.md？")))) return;
    const full = root + "/AGENTS.md";
    const r = await window.api.writeFile(full, AGENTS_MD_TEMPLATE);
    if (!r.ok) { toast(tr("创建失败：") + (r.error || ""), "error"); return; }
    await refreshFileTree(); // 保留展开层级与选中态
    target = { path: full, name: "AGENTS.md" };
    created = true;
  }
  await openFile(target.path, target.name);
  if (created && !mdEditing) enterMdEdit(); // 新建的直接进编辑态
}
$("projectRules").onclick = openProjectRules;

// ── 文件内容检索：左侧搜索框逐行匹配，点击命中直达预览 ────────
let csToken = 0;
async function runContentSearch() {
  const q = $("csInput").value.trim();
  const box = $("csResults");
  if (q.length < 2) { box.innerHTML = q ? '<div style="padding:4px 8px;color:var(--fg2);font-size:11px">至少输入 2 个字符</div>' : ""; return; }
  const token = ++csToken;
  const hits = await window.api.grepFiles(q);
  if (token !== csToken) return; // 已有更新的查询，丢弃过期结果
  box.innerHTML = "";
  if (!hits.length) {
    box.innerHTML = `<div class="cs-empty">${tr("无匹配")}</div>`;
    return;
  }
  hits.forEach((h) => {
    const el = document.createElement("div");
    el.className = "cs-hit";
    el.title = `${h.rel}:${h.line}`;
    el.innerHTML = `<span class="loc">${esc(h.rel)}:${h.line}</span><span class="txt">${esc(h.text)}</span>`;
    el.onclick = () => openFile(h.path, h.name, h.line);
    box.appendChild(el);
  });
}
let csTimer = 0;
$("csInput").addEventListener("input", () => {
  clearTimeout(csTimer);
  csTimer = setTimeout(runContentSearch, 250);
});
$("csInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(csTimer); runContentSearch(); }
  else if (e.key === "Escape") { $("csInput").value = ""; $("csResults").innerHTML = ""; }
});

// ── 预览面板：按扩展名渲染 md / mermaid / pdf / 文本 ──────────
const vbody = $("vbody");
const vframe = $("vframe");

if (window.mermaid) mermaid.initialize({ startOnLoad: false, theme: "default" });

function showViewer(title) {
  $("vtitle").textContent = title;
  const v = $("viewer");
  v.style.display = "flex";
  v.classList.add("open");
  resetMdEdit(); // 每次打开新内容先关掉上一份的 md 编辑态/按钮
}

// ── md 内联编辑：左编辑 / 右实时预览，⌘/Ctrl+S 原子写回原文件 ──
let curMdPath = null, curMdRaw = "", mdEditing = false, mdPrevTimer = 0, mdPendingLine = 0;
function resetMdEdit() {
  curMdPath = null; mdEditing = false; mdPendingLine = 0;
  clearTimeout(mdPrevTimer);
  vbody.classList.remove("editing");
  const e = $("vedit"), s = $("vsave");
  if (e) { e.style.display = "none"; e.textContent = "✎"; }
  if (s) s.style.display = "none";
}
// 把 markdown 渲染进任意容器，并把 ```mermaid 代码块转成图
function renderMdInto(el, content) {
  // rAF 节流：流式期间每帧最多重渲染一次，消除每 token 重解析的 CPU 浪费
  if (el._renderPending) {
    el._renderContent = content;
    return;
  }
  el._renderContent = content;
  el._renderPending = true;
  requestAnimationFrame(() => {
    el._renderPending = false;
    const c = el._renderContent;
    el._renderContent = undefined;
    el.innerHTML = safeMd(c);
    hlBlocks(el);
    const nodes = [];
    el.querySelectorAll("code.language-mermaid").forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      (code.closest("pre") || code).replaceWith(div);
      nodes.push(div);
    });
    renderMermaidNodes(nodes);
  });
}
function toggleMdEdit() {
  mdEditing ? exitMdEdit() : enterMdEdit();
}
function enterMdEdit() {
  mdEditing = true;
  useBody("md");
  vbody.classList.add("editing");
  const split = document.createElement("div"); split.className = "md-edit-split";
  const ta = document.createElement("textarea"); ta.className = "md-edit-area"; ta.value = curMdRaw; ta.spellcheck = false;
  const prev = document.createElement("div"); prev.className = "md-edit-prev md";
  split.append(ta, prev);
  vbody.innerHTML = ""; vbody.appendChild(split);
  renderMdInto(prev, curMdRaw);
  ta.addEventListener("input", () => {
    curMdRaw = ta.value;
    clearTimeout(mdPrevTimer);
    mdPrevTimer = setTimeout(() => renderMdInto(prev, curMdRaw), 150);
  });
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveMd(); }
  });
  ta.focus();
  if (mdPendingLine) { seekTextareaLine(ta, mdPendingLine); mdPendingLine = 0; } // 从搜索进入：光标直达该行
  $("vedit").textContent = "👁"; $("vsave").style.display = "";
}
// 把 textarea 光标定位并滚动到指定行（选中整行便于辨认）
function seekTextareaLine(ta, line) {
  const lines = ta.value.split("\n");
  const ln = Math.min(Math.max(1, line), lines.length);
  let pos = 0;
  for (let i = 0; i < ln - 1; i++) pos += lines[i].length + 1;
  ta.setSelectionRange(pos, pos + lines[ln - 1].length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollTop = Math.max(0, (ln - 1) * lh - ta.clientHeight / 2);
}
function exitMdEdit() {
  mdEditing = false;
  clearTimeout(mdPrevTimer);
  vbody.classList.remove("editing");
  useBody("md");
  renderMdInto(vbody, curMdRaw);
  $("vedit").textContent = "✎"; $("vsave").style.display = "none";
}
async function saveMd() {
  if (!curMdPath) return;
  const r = await window.api.writeFile(curMdPath, curMdRaw);
  if (r && r.ok) toast(tr("已保存"), "success");
  else toast(tr("保存失败：") + ((r && r.error) || ""), "error");
}
// 无法内联预览（Word/Excel/超大文件）时，给出「用系统默认程序打开」兜底
function showFallback(path, msg) {
  useBody("");
  vbody.innerHTML = "";
  const box = document.createElement("div");
  box.className = "v-fallback";
  const ic = document.createElement("div"); ic.className = "vf-ic"; ic.textContent = "📄";
  const tip = document.createElement("div"); tip.textContent = msg;
  const btn = document.createElement("button"); btn.className = "vf-open"; btn.textContent = tr("用系统默认程序打开");
  btn.onclick = async () => {
    const r = await window.api.openPath(path);
    if (r && !r.ok) tip.textContent = tr("打开失败：") + (r.error || "");
  };
  box.append(ic, tip, btn);
  vbody.appendChild(box);
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

// ── 搜索直达定位：按行包裹渲染结果，滚动到目标行并闪烁高亮 ──
// highlightCode 输出是扁平 <span> 序列；跨行 span 在行边界闭合、下一行重开后即可安全按行切分
function htmlToLines(html) {
  let open = null;
  return html.split("\n").map((s) => {
    if (open) s = open + s;
    const re = /<span class="[^"]*">|<\/span>/g;
    let depth = 0, last = null, m;
    while ((m = re.exec(s))) { if (m[0] === "</span>") depth--; else { depth++; last = m[0]; } }
    if (depth > 0) { s += "</span>"; open = last; } else open = null;
    return s;
  });
}
function flashLine(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("line-flash");
  setTimeout(() => el.classList.remove("line-flash"), 1600);
}

// 常见图片扩展名 → MIME，内联 <img> 预览用
const IMG_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml" };

async function openFile(path, name, line) {
  const ext = name.split(".").pop().toLowerCase();
  // 供「选中 → 加入对话」引用：尽量取相对当前文件夹的路径
  quoteRelPath = currentFolder && path.startsWith(currentFolder)
    ? path.slice(currentFolder.length).replace(/^\/+/, "") : path;

  if (ext === "pdf") {
    // 打开可编辑的 PDF 编辑器（PDF.js 渲染 + pdf-lib 保存）
    if (window.openPdfEditor) window.openPdfEditor(path, name);
    return;
  }

  // Word/Excel/PPT 等无法内联渲染：直接给出「用系统程序打开」兜底
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    showViewer(name);
    showFallback(path, tr("此文件类型暂不支持内联预览。"));
    return;
  }

  // 图片：读字节转 data URL 内联显示（标题栏附带尺寸），其余二进制类型仍走下方兜底
  if (IMG_MIME[ext]) {
    showViewer(name);
    const r = await window.api.readFileBuffer(path);
    if (!r || r.error) { showFallback(path, tr("图片读取失败：") + (r?.error || "")); return; }
    useBody("img");
    vbody.innerHTML = "";
    const img = document.createElement("img");
    img.alt = name;
    img.onload = () => { $("vtitle").textContent = `${name}  ${img.naturalWidth}×${img.naturalHeight}`; };
    img.src = `data:${IMG_MIME[ext]};base64,${r.base64}`;
    vbody.appendChild(img);
    return;
  }

  showViewer(name);
  const content = await window.api.readFile(path);

  // 超大或二进制文件无法以文本预览时，同样给出兜底
  if (content === "(文件过大，未显示)") { showFallback(path, tr("文件过大，无法内联预览。")); return; }
  if (content === "(二进制文件，无法以文本预览)") { showFallback(path, tr("此文件无法以文本预览。")); return; }

  if (ext === "md" || ext === "markdown") {
    curMdPath = path; curMdRaw = content;
    $("vedit").style.display = ""; // 仅 md 文件可切换编辑
    useBody("md");
    await renderMdInto(vbody, content);
    if (line) {
      mdPendingLine = line; // 切到编辑态时光标直达该行
      // 渲染态按原文行号比例近似滚动定位
      vbody.scrollTop = ((line - 1) / Math.max(1, content.split("\n").length - 1)) * Math.max(0, vbody.scrollHeight - vbody.clientHeight);
    }
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

  // 其它：纯文本（源码按扩展名做轻量语法高亮，其余保持纯文本）
  useBody("raw");
  const lang = hlLang(ext);
  if (line) {
    // 从搜索结果进入：逐行包裹以便滚动定位并闪烁目标行
    const rows = htmlToLines(lang ? highlightCode(content, lang) : esc(content))
      .map((s) => `<span class="cl">${s}\n</span>`).join("");
    vbody.innerHTML = lang ? `<pre class="hl"><code>${rows}</code></pre>` : rows;
    flashLine(vbody.querySelectorAll(".cl")[line - 1]);
  } else if (lang) {
    vbody.innerHTML = '<pre class="hl"><code>' + highlightCode(content, lang) + "</code></pre>";
  } else {
    vbody.textContent = content;
  }
}

// ── 代码地图：单轮只读分析当前 workdir，产出 mermaid 模块/依赖图并在查看器渲染 ──
// 入口：命令面板 / 快捷技能「🗺 生成代码地图」；可一键保存为 docs/codemap.md 衔接文档维护
let codemapBusy = false;
let codemapCache = null; // { folder, markdown }：缓存上次结果，误关查看器/重复点击不再重新付费生成
async function genCodemap(force) {
  if (!currentFolder) { toast(tr("请先选择文件夹"), "error"); return; }
  if (codemapBusy) { toast(tr("代码地图生成中…"), "info"); return; }
  showViewer(tr("代码地图"));
  useBody("md");
  if (!force && codemapCache && codemapCache.folder === currentFolder) {
    await showCodemap(codemapCache.markdown); // 直接复用缓存，省一次查询
    return;
  }
  codemapBusy = true;
  // 等待占位带「✕ 取消」：误触后可立即中止后台查询，止住 token 消耗
  vbody.innerHTML = `<div class="v-fallback"><div class="vf-ic">🗺</div><div>${esc(tr("正在分析代码结构，生成代码地图…（约 1-3 分钟）"))}</div><button class="vf-open" id="cmCancel" style="margin-top:10px">${esc(tr("✕ 取消"))}</button></div>`;
  const cmCancel = document.getElementById("cmCancel");
  if (cmCancel) cmCancel.onclick = () => { cmCancel.disabled = true; window.api.codemapStop(); };
  try {
    const r = await window.api.codemap();
    if (r && r.canceled) { // 主动取消：不写缓存、不报错
      toast(tr("已取消代码地图生成"), "info");
      if ($("vtitle").textContent === tr("代码地图"))
        vbody.innerHTML = `<div class="v-fallback"><div class="vf-ic">🚫</div><div>${esc(tr("已取消"))}</div></div>`;
      return;
    }
    if (r && r.ok) codemapCache = { folder: currentFolder, markdown: r.markdown };
    // 等待期间用户可能已打开别的文件/关掉查看器，不再覆盖；结果已缓存，再点入口即可看到
    if ($("vtitle").textContent !== tr("代码地图")) {
      if (r && r.error) toast(tr("代码地图生成失败：") + r.error, "error");
      else toast(tr("代码地图已生成，点「生成代码地图」即可查看"), "success");
      return;
    }
    if (!r || r.error) {
      vbody.innerHTML = `<div class="v-fallback"><div class="vf-ic">⚠️</div><div>${esc(tr("代码地图生成失败：") + ((r && r.error) || ""))}</div></div>`;
      return;
    }
    await showCodemap(r.markdown);
  } finally {
    codemapBusy = false;
  }
}
// 渲染代码地图 + 操作栏（重新生成 / 保存为 docs/codemap.md）
async function showCodemap(markdown) {
  vbody.innerHTML = "";
  const bar = document.createElement("div");
  bar.style.cssText = "margin:0 0 8px;text-align:right";
  const regen = document.createElement("button");
  regen.className = "vf-open";
  regen.textContent = tr("🔄 重新生成");
  regen.onclick = () => genCodemap(true);
  const save = document.createElement("button");
  save.className = "vf-open";
  save.style.marginLeft = "8px";
  save.textContent = tr("💾 保存为 docs/codemap.md");
  save.onclick = async () => {
    const root = currentFolder.replace(/\/+$/, "");
    await window.api.mkdir(root + "/docs");
    const w = await window.api.writeFile(root + "/docs/codemap.md", markdown);
    if (w && w.ok) {
      toast(tr("已保存 docs/codemap.md"), "success");
      await refreshFileTree(); // 刷新文件树立即可见（保留展开层级与选中态）
    } else toast(tr("保存失败：") + ((w && w.error) || ""), "error");
  };
  bar.append(regen, save);
  const body = document.createElement("div");
  vbody.append(bar, body);
  await renderMdInto(body, markdown);
}

$("vclose").onclick = () => {
  const v = $("viewer");
  v.style.display = "none";
  v.classList.remove("open");
  vframe.removeAttribute("src"); // 卸载 PDF，释放资源
  resetMdEdit();
};
$("vedit").onclick = toggleMdEdit;
$("vsave").onclick = saveMd;
// 停靠到中间（仿 VS Code）↔ 浮窗显示：占据真实布局而非覆盖
$("vdock").onclick = () => {
  const docked = $("viewer").classList.toggle("docked");
  safeLocalSet("viewerDocked", docked ? "1" : "0");
};
// 恢复上次的停靠状态与宽度
if (localStorage.getItem("viewerDocked") === "1") $("viewer").classList.add("docked");
{
  const w = parseInt(localStorage.getItem("viewerDockW") || "0", 10);
  if (w >= 320) document.documentElement.style.setProperty("--view-dock-w", w + "px");
}

// ── 选中 → 加入对话：查看器 / diff 弹窗里选中文本后浮出按钮，一键把「路径:行 + 引用」追加进聊天输入框 ──
let quoteRelPath = null; // 当前查看内容对应的文件相对路径（推算不出则为空）
const quoteBtn = document.createElement("button");
quoteBtn.id = "quoteBtn";
quoteBtn.setAttribute("data-i18n", "💬 加入对话");
quoteBtn.textContent = tr("💬 加入对话");
quoteBtn.style.display = "none";
document.body.appendChild(quoteBtn);
let quoteSel = null; // { text, path, line }

function hideQuoteBtn() { quoteBtn.style.display = "none"; quoteSel = null; }

// 从选区起点推算起始行：优先已有行号 span(.cl)，否则 raw 纯文本按前缀换行数推算；md/diff 渲染态无法对应源码行，省略
function quoteStartLine(container, range) {
  const node = range.startContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const cl = el && el.closest ? el.closest(".cl") : null;
  if (cl && container.contains(cl)) return [...container.querySelectorAll(".cl")].indexOf(cl) + 1;
  if (container === vbody && vbody.classList.contains("raw")) {
    const r = document.createRange();
    r.selectNodeContents(container);
    r.setEnd(range.startContainer, range.startOffset);
    return r.toString().split("\n").length;
  }
  return 0;
}

// diff 视图里从选区行向上找最近的 +++ b/xxx（或 diff --git）头推算文件路径
function quoteDiffPath(range) {
  let cur = range.startContainer;
  if (cur.nodeType !== 1) cur = cur.parentElement && cur.parentElement.matches("span") ? cur.parentElement : cur;
  while (cur) {
    if (cur.nodeType === 1) {
      const t = cur.textContent || "";
      const m = t.match(/^\+\+\+ b\/(.+)$/) || t.match(/^diff --git a\/.+ b\/(.+)$/);
      if (m) return m[1];
    }
    cur = cur.previousSibling;
  }
  return null;
}

// mouseup 后若有非空选区且落在容器内，把按钮浮到选区上方
function onQuoteMouseUp(container, getPath) {
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && sel.rangeCount ? sel.toString() : "";
    if (!text.trim()) { hideQuoteBtn(); return; }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) { hideQuoteBtn(); return; }
    quoteSel = { text: text.replace(/\n+$/, ""), path: getPath(range), line: quoteStartLine(container, range) };
    const rect = range.getBoundingClientRect();
    quoteBtn.style.display = "block";
    quoteBtn.style.left = Math.min(window.innerWidth - 120, Math.max(8, rect.left + rect.width / 2 - 50)) + "px";
    quoteBtn.style.top = Math.max(8, rect.top - 32) + "px";
  }, 0);
}
vbody.addEventListener("mouseup", () =>
  onQuoteMouseUp(vbody, (r) => quoteRelPath || (vbody.classList.contains("diff") ? quoteDiffPath(r) : null)));
$("evDiffBody").addEventListener("mouseup", () => onQuoteMouseUp($("evDiffBody"), quoteDiffPath));

quoteBtn.addEventListener("mousedown", (e) => e.preventDefault()); // 防止点击瞬间清掉选区
quoteBtn.onclick = () => {
  if (!quoteSel) { hideQuoteBtn(); return; }
  const head = quoteSel.path ? quoteSel.path + (quoteSel.line ? ":" + quoteSel.line : "") + "\n" : "";
  const inp = $("input");
  inp.value = (inp.value ? inp.value.replace(/\n*$/, "\n") : "") + head + "```\n" + quoteSel.text + "\n```\n";
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.dispatchEvent(new Event("input")); // 触发输入框自适应高度等既有逻辑
  window.getSelection()?.removeAllRanges();
  hideQuoteBtn();
};
// 点别处 / 滚动时收起
document.addEventListener("mousedown", (e) => { if (e.target !== quoteBtn) hideQuoteBtn(); });
vbody.addEventListener("scroll", hideQuoteBtn);
$("evDiffBody").addEventListener("scroll", hideQuoteBtn);

// ── Git 面板：仓库行 + 分支下拉 + 提交图 ───────────────────
function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 把 Markdown 文本渲染为「净化」后的 HTML：marked 解析后用 DOMPurify 去除 script/onerror/javascript: 等活动内容，
// 防止模型回复或文件内容里的注入代码在渲染进程执行。marked 未加载时回退为纯文本转义。
function safeMd(raw) {
  raw = raw || "";
  if (!window.marked) return esc(raw);
  const html = marked.parse(raw);
  // DOMPurify 默认即剥离脚本与事件处理器，这里再显式允许 mermaid 代码块所需的 class 属性
  return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ["class"] }) : html;
}

// ── 轻量语法高亮：零依赖，按扩展名/代码块语言着色 .js/.ts/.json/.py 等 ──
const HL_KW = {
  js: new Set("const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import export from default void delete null true false undefined NaN Infinity static get set interface type enum implements namespace as keyof readonly public private protected abstract".split(" ")),
  py: new Set("def return if elif else for while break continue class import from as pass lambda yield with try except finally raise global nonlocal in is not and or None True False async await del assert self print None".split(" ")),
  json: new Set("true false null".split(" ")),
};
// 扩展名 / ```语言标识 → 高亮语言族
const HL_LANG = { js:"js", mjs:"js", cjs:"js", jsx:"js", ts:"js", tsx:"js", typescript:"js", javascript:"js", node:"js", json:"json", jsonc:"json", py:"py", python:"py" };
function hlLang(tag) { return HL_LANG[(tag || "").toLowerCase()] || ""; }
// 把一段源码转成带 <span class="tok-*"> 的安全 HTML（按词逐段消费，token 文本均经 esc）
function highlightCode(code, lang) {
  if (!lang || !HL_KW[lang]) return esc(code);
  const kw = HL_KW[lang];
  const rules = [
    lang !== "json" && { cls: "tok-c", re: /\/\*[\s\S]*?\*\//y },
    lang === "py" ? { cls: "tok-c", re: /#[^\n]*/y } : (lang !== "json" && { cls: "tok-c", re: /\/\/[^\n]*/y }),
    lang === "py" && { cls: "tok-s", re: /"""[\s\S]*?"""|'''[\s\S]*?'''/y },
    { cls: "tok-s", re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y },
    { cls: "tok-n", re: /0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?/y },
  ].filter(Boolean);
  const word = /[A-Za-z_$][\w$]*/y;
  let out = "", i = 0;
  while (i < code.length) {
    let hit = null;
    for (const r of rules) { r.re.lastIndex = i; const m = r.re.exec(code); if (m && m.index === i && m[0]) { out += `<span class="${r.cls}">${esc(m[0])}</span>`; i += m[0].length; hit = true; break; } }
    if (hit) continue;
    word.lastIndex = i; const w = word.exec(code);
    if (w && w.index === i) { out += kw.has(w[0]) ? `<span class="tok-k">${w[0]}</span>` : esc(w[0]); i += w[0].length; continue; }
    out += esc(code[i]); i++;
  }
  return out;
}
// 对容器内已渲染的 ```代码块就地着色（跳过 mermaid，由专门逻辑处理）
function hlBlocks(root) {
  if (!root) return;
  root.querySelectorAll("pre code").forEach((code) => {
    addCopyBtn(code); // 每个代码块右上角悬浮「复制」按钮（含未着色/未知语言的）
    if (code.dataset.hl) return;
    const cls = [...code.classList].find((c) => c.startsWith("language-"));
    const lang = hlLang(cls ? cls.slice(9) : "");
    if (!lang) return; // 未知语言保持纯文本
    code.innerHTML = highlightCode(code.textContent, lang);
    code.dataset.hl = "1";
  });
}

// 给 pre 代码块加一个悬浮「复制」按钮（mermaid 块跳过，由图形渲染接管）
// 超过 40 行时默认折叠，只显示前 ~20 行，并在底部附「展开/折叠」按钮
function addCopyBtn(code) {
  const pre = code.closest("pre");
  if (!pre || pre.querySelector(".copy-btn") || code.classList.contains("language-mermaid")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.textContent = tr("复制");
  pre.appendChild(btn);

  const lines = code.textContent.split("\n").length;
  if (lines > 40 && !pre.nextElementSibling?.classList.contains("expand-btn")) {
    pre.classList.add("pre-collapsed");
    const expBtn = document.createElement("button");
    expBtn.type = "button";
    expBtn.className = "expand-btn";
    expBtn.textContent = tr("展开") + ` (${lines} 行)`;
    expBtn.addEventListener("click", () => {
      const collapsed = pre.classList.toggle("pre-collapsed");
      expBtn.textContent = collapsed ? tr("展开") + ` (${lines} 行)` : tr("折叠");
    });
    pre.after(expBtn);
  }
}

// 复制文本到剪贴板，并在按钮上短暂回显「已复制」+ 复用 toast 提示
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text || "");
    if (btn) {
      const old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = btn.dataset.copied || tr("已复制");
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = old; btn.classList.remove("copied"); }, 1200);
    }
    toast(tr("已复制"), "success");
  } catch (e) {
    toast(tr("复制失败：") + e, "error");
  }
}

// 事件委托：复制按钮在对话被归档/还原（innerHTML 重建）后仍可用，无需重绑事件
chat.addEventListener("click", (e) => {
  const codeBtn = e.target.closest(".copy-btn");
  if (codeBtn) {
    const code = codeBtn.closest("pre")?.querySelector("code");
    return copyToClipboard(code ? code.textContent : "", codeBtn);
  }
  const replyBtn = e.target.closest(".reply-copy");
  if (replyBtn) {
    const wrap = replyBtn.closest(".msg.assistant");
    return copyToClipboard(wrap ? bubbleText(wrap) : "", replyBtn);
  }
  const saveMemBtn = e.target.closest(".reply-save-mem");
  if (saveMemBtn) {
    const wrap = saveMemBtn.closest(".msg.assistant");
    const text = wrap ? bubbleText(wrap) : "";
    if (!text) return;
    appendToProjectMemory(text);
    const orig = saveMemBtn.textContent;
    saveMemBtn.textContent = "✓";
    setTimeout(() => { saveMemBtn.textContent = orig; }, 1200);
    return;
  }
});

// 汇总一条 Claude 回复里所有文字气泡的纯文本（剔除复制按钮自身的文案）
function bubbleText(wrap) {
  return [...wrap.querySelectorAll(".bubble")]
    .map((b) => {
      const c = b.cloneNode(true);
      c.querySelectorAll(".copy-btn").forEach((x) => x.remove());
      return c.textContent.trim();
    })
    .filter(Boolean)
    .join("\n\n");
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
    renderStatusbar(null);
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
  window.api.gitWatch(repoPath); // 切换仓库 → 主进程监听该仓库的文件变化
}

// ── Source Control 自动刷新：文件监听即时刷新 + 低频轮询兜底 ──────
let scRefreshing = false; // 正在刷新（避免并发/与 doGit 叠加）
async function scAutoRefresh() {
  if (scRefreshing || !activeRepo) return;
  if (document.hidden) return; // 后台不刷
  scRefreshing = true;
  try {
    await loadStatus(activeRepo);
    await loadGraph(activeRepo);
  } catch {}
  scRefreshing = false;
}
// 主进程文件监听：工作区变化时即时刷新（不依赖轮询）
window.api.on("git:changed", (repo) => { if (repo === activeRepo) scAutoRefresh(); });
// 低频轮询兜底（监听漏报 / 远端 ahead-behind 变化）
if (window._scAutoRefreshTimer) clearInterval(window._scAutoRefreshTimer);
window._scAutoRefreshTimer = setInterval(scAutoRefresh, 10000);
window.addEventListener("beforeunload", () => {
  clearInterval(window._scAutoRefreshTimer);
  clearInterval(window._loadUsageTimer);
  [
    "git:changed", "convs:changed", "mcp:status", "evolve:backlog", "budget:exceeded",
    "evolve:log", "evolve:usage", "evolve:done", "evolve:rolledback", "issues:update",
    "chat:init", "chat:chunk", "chat:tool", "chat:toolresult", "chat:done",
    "chat:stopped", "chat:error",
  ].forEach((ch) => window.api.off(ch));
}, { once: true });
// 窗口重新获得焦点 / 标签页变可见时立即刷新（切回应用马上同步）
window.addEventListener("focus", scAutoRefresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) scAutoRefresh(); });

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
  el.onclick = async (e) => {
    const act = e.target.dataset?.act;
    if (act === "stage") doGit(() => window.api.gitStage(activeRepo, f.path));
    else if (act === "unstage") doGit(() => window.api.gitUnstage(activeRepo, f.path));
    else if (act === "discard") {
      if (await modalConfirm(trf("丢弃对 {0} 的更改？此操作不可撤销。", f.path)))
        doGit(() => window.api.gitDiscard(activeRepo, f.path, !!f.untracked));
    } else openDiff(f.path, staged, f.untracked);
  };
  return el;
}

let lastStatusSig = null; // 上次状态签名：内容不变则跳过重建，避免闪烁
async function loadStatus(repoPath) {
  const stagedEl = $("scStaged");
  const changesEl = $("scChanges");
  const r = await window.api.gitStatus(repoPath);
  if (!r || r.error) {
    lastStatusSig = null;
    stagedEl.innerHTML = "";
    changesEl.innerHTML = "";
    $("scStagedN").textContent = "0";
    $("scChangesN").textContent = "0";
    renderStatusbar(null);
    return;
  }
  // 内容签名：与上次一致则不动 DOM
  const sig = repoPath + "|" + JSON.stringify(r.staged) + "|" + JSON.stringify(r.changes) + "|" + r.ahead + "|" + r.behind;
  if (sig === lastStatusSig) return;
  lastStatusSig = sig;
  stagedEl.innerHTML = "";
  changesEl.innerHTML = "";
  $("scStagedN").textContent = r.staged.length;
  $("scChangesN").textContent = r.changes.length;
  r.staged.forEach((f) => stagedEl.appendChild(fileRow(f, true)));
  r.changes.forEach((f) => changesEl.appendChild(fileRow(f, false)));
  // ahead/behind 标在 push/pull 上
  $("scPush").textContent = r.ahead ? `↑${r.ahead}` : "↑";
  $("scPull").textContent = r.behind ? `↓${r.behind}` : "↓";
  renderStatusbar(r);
}

// ── VSCode 式底部状态栏：分支 / 同步 / 改动计数，点击直达 ──────
function renderStatusbar(r) {
  if (!r) {
    $("sbBranch").textContent = "";
    $("sbSync").textContent = "";
    $("sbChanges").textContent = "";
    return;
  }
  $("sbBranch").textContent = "⎇ " + (r.branch || "—");
  $("sbSync").textContent = r.ahead || r.behind ? `↓${r.behind || 0} ↑${r.ahead || 0}` : "";
  const n = r.staged.length + r.changes.length;
  $("sbChanges").textContent = n ? `✎ ${n}` : "";
}
$("sbBranch").onclick = () => cmdkSwitchView("sc");
$("sbChanges").onclick = () => cmdkSwitchView("sc");
$("sbSync").onclick = async () => {
  if (!activeRepo) return;
  // 仿 VSCode 同步：先 pull 再 push
  if (await doGit(() => window.api.gitPull(activeRepo), tr("已拉取")))
    await doGit(() => window.api.gitPush(activeRepo), tr("已同步"));
};
$("sbCmdk").onclick = () => openCmdk();

// 执行 git 操作后刷新状态+图
async function doGit(fn, okMsg) {
  scRefreshing = true; // 占用刷新锁，避免与自动轮询并发
  $("status").textContent = tr("执行中…");
  try {
    const r = await fn();
    $("status").textContent = "";
    if (r && r.error) {
      toast(tr("Git 操作失败：") + "\n" + r.error, "error");
      return false;
    }
    if (okMsg) {
      $("status").textContent = okMsg;
      clearStatusLater(1800);
    }
    await loadStatus(activeRepo);
    await loadGraph(activeRepo);
    return true;
  } finally {
    scRefreshing = false; // 释放刷新锁，避免操作后自动轮询被永久卡住
  }
}

// 显示 diff（复用查看器浮层）；未跟踪文件显示为全新增，目录给提示
async function openDiff(file, staged, untracked) {
  if (file.endsWith("/")) {
    toast(tr("这是未跟踪的目录，请在左侧文件树展开查看其中文件。"));
    return;
  }
  const r = await window.api.gitDiff(activeRepo, file, staged);
  showViewer((staged ? tr("[已暂存] ") : untracked ? tr("[新文件] ") : "") + file);
  useBody("diff");
  quoteRelPath = file;
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
  quoteRelPath = null;
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
  quoteRelPath = file;
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
// ✨ AI 生成提交信息：取 staged diff（无则全部未提交 diff）单轮生成并回填
$("scGenMsg").onclick = async () => {
  const btn = $("scGenMsg");
  if (btn.classList.contains("busy")) return;
  if (!activeRepo) { toast(tr("请先选择仓库"), "error"); return; }
  btn.classList.add("busy");
  btn.textContent = "⟳";
  try {
    const r = await window.api.gitGenCommitMsg(activeRepo);
    if (r && r.message) {
      const confirmed = await modalTextarea(tr("确认提交信息（Ctrl+Enter 提交，Esc 取消）"), r.message);
      if (confirmed) {
        await doGit(() => window.api.gitCommit(activeRepo, confirmed), tr("已提交"));
        $("scMsg").value = "";
      }
    } else toast(tr("生成提交信息失败：") + tr(r?.error || ""), "error");
  } finally {
    btn.classList.remove("busy");
    btn.textContent = "✨";
  }
};
// 📜 生成 CHANGELOG：增量取提交日志 AI 分组，写入 CHANGELOG.md 后在 md 内联编辑器中打开供确认
let changelogBusy = false;
async function genChangelog() {
  if (changelogBusy) return;
  if (!activeRepo) { toast(tr("请先选择仓库"), "error"); return; }
  changelogBusy = true;
  const btn = $("scChangelog");
  btn.textContent = "⟳";
  toast(tr("正在生成 CHANGELOG…"), "info");
  try {
    const r = await window.api.gitGenChangelog(activeRepo);
    if (r && r.path) {
      await openFile(r.path, "CHANGELOG.md");
      if (!mdEditing) enterMdEdit(); // 直接进编辑态，确认后 ⌘S 保存
      toast(tr("已生成，请确认后保存"), "success");
    } else toast(tr("生成 CHANGELOG 失败：") + tr(r?.error || ""), "error");
  } finally {
    changelogBusy = false;
    btn.textContent = "📜";
  }
}
$("scChangelog").onclick = genChangelog;
$("scStageAll").onclick = () => doGit(() => window.api.gitStageAll(activeRepo));
$("scUnstageAll").onclick = () => doGit(() => window.api.gitUnstageAll(activeRepo));
$("scPull").onclick = () => doGit(() => window.api.gitPull(activeRepo), tr("已拉取"));
$("scPush").onclick = () => doGit(() => window.api.gitPush(activeRepo), tr("已推送"));
$("scFetch").onclick = () => doGit(() => window.api.gitFetch(activeRepo), tr("已抓取"));
$("scNewBranch").onclick = async () => {
  const name = await modalPrompt(tr("新分支名："));
  if (name && name.trim()) doGit(() => window.api.gitCreateBranch(activeRepo, name.trim()), tr("已创建分支"));
};
$("scDiscardAll").onclick = async () => {
  if (await modalConfirm(tr("丢弃所有未暂存更改，并删除未跟踪文件/目录？\n此操作不可撤销！")))
    doGit(() => window.api.gitDiscardAll(activeRepo), tr("已丢弃所有更改"));
};
$("scUndoCommit").onclick = async () => {
  if (await modalConfirm(tr("撤销上次提交？\n（改动会保留在暂存区，可重新提交）")))
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
      run: async () => (await modalConfirm(trf("检出 {0}？将进入分离 HEAD 状态。", c.short))) &&
        doGit(() => window.api.gitCheckoutCommit(activeRepo, c.full)),
    },
    {
      label: tr("撤销此提交 (revert)"),
      run: () => doGit(() => window.api.gitRevert(activeRepo, c.full), tr("已创建 revert 提交")),
    },
    { sep: true },
    {
      label: tr("软重置到此（保留改动）"),
      run: async () => (await modalConfirm(trf("reset --soft 到 {0}？\n此提交之后的提交将撤销，改动保留。", c.short))) &&
        doGit(() => window.api.gitResetSoft(activeRepo, c.full)),
    },
    {
      label: tr("硬重置到此（丢弃之后的提交）"),
      danger: true,
      run: async () => (await modalConfirm(trf("reset --hard 到 {0}？\n此提交之后的提交与改动将永久丢失，不可撤销！", c.short))) &&
        doGit(() => window.api.gitResetHard(activeRepo, c.full)),
    },
    { sep: true },
    { label: tr("复制完整 SHA"), run: () => navigator.clipboard?.writeText(c.full) },
  ]);
}

let lastGraphSig = null; // 上次提交图签名：内容不变则跳过重建，避免闪烁
async function loadGraph(repoPath) {
  const graph = $("gitgraph");
  const dd = $("branchDropdown");

  const r = await window.api.gitGraph(repoPath);
  if (!r || r.error) {
    lastGraphSig = null;
    dd.innerHTML = "";
    dd.classList.remove("open");
    graph.innerHTML = `<div style="color:#c77;font-size:12px;padding:4px 6px">${esc(r?.error || tr("读取失败"))}</div>`;
    return;
  }

  // 分支下拉（切换图里没出现的分支）
  const b = await window.api.gitBranches(repoPath);
  // 内容签名：提交图 + 当前分支 + 分支列表，一致则不动 DOM
  const sig = repoPath + "|" + r.current + "|" + JSON.stringify(r.commits) + "|" + JSON.stringify(b?.branches || []);
  if (sig === lastGraphSig) return;
  lastGraphSig = sig;
  graph.innerHTML = "";
  dd.innerHTML = "";
  dd.classList.remove("open");
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
    toast(tr("切换失败：") + "\n" + r.error, "error");
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
let convSearchQuery = "";

const getConv = (id) => conversations.find((c) => c.id === id);
function scrollIfActive(conv) {
  if (conv !== activeConv) return;
  // 仅当用户已接近底部时才自动滚到底，向上翻看历史时不强制跳转
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  if (nearBottom) chat.scrollTop = chat.scrollHeight;
}
const LAZY_PAGE = 100; // 每次加载条数

function _buildLoadEarlierBtn(conv) {
  const btn = document.createElement("button");
  btn.className = "load-earlier-btn";
  btn.onclick = () => {
    const batch = conv._hiddenHtml.splice(-LAZY_PAGE);
    const frag = document.createDocumentFragment();
    batch.forEach(html => {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      frag.appendChild(tmp.firstChild);
    });
    const prevH = conv.pane.scrollHeight;
    conv.pane.insertBefore(frag, btn.nextSibling);
    // 保持视口位置不跳
    chat.scrollTop += conv.pane.scrollHeight - prevH;
    if (!conv._hiddenHtml.length) btn.remove();
    else btn.textContent = `加载更早消息（还有 ${conv._hiddenHtml.length} 条）`;
  };
  btn.textContent = `加载更早消息（还有 ${conv._hiddenHtml.length} 条）`;
  return btn;
}

function ensurePane(conv) {
  if (conv.pane) return conv.pane;
  const p = document.createElement("div");
  p.className = "conv-pane";
  if (conv._html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = conv._html;
    const allMsgs = [...tmp.children];
    if (allMsgs.length > LAZY_PAGE) {
      conv._hiddenHtml = allMsgs.slice(0, allMsgs.length - LAZY_PAGE).map(n => n.outerHTML);
      allMsgs.slice(allMsgs.length - LAZY_PAGE).forEach(n => p.appendChild(n));
    } else {
      conv._hiddenHtml = [];
      p.innerHTML = conv._html;
    }
  } else {
    conv._hiddenHtml = [];
  }
  if (conv._hiddenHtml && conv._hiddenHtml.length) {
    p.insertBefore(_buildLoadEarlierBtn(conv), p.firstChild);
  }
  conv.pane = p;
  conv.currentBubble = null;
  conv.toolCards = {};
  return p;
}
function showActive() {
  activeConv.unread = false; // 切回即视为已读
  ensurePane(activeConv);
  chat.replaceChildren(activeConv.pane); // 仅切换显示，不打断后台对话
  chat.scrollTop = chat.scrollHeight;
  refreshSendBtn();
  renderCostReadout(); // 同步显示该会话累计用量
  renderCtxFooter();
  syncConvModelSel(); // 同步本对话的模型选择器
  syncTokenLimitInput(); // 同步 token 上限输入框
}

// 每条对话可单独选模型，不影响全局设置
// 价格单位：USD / 1M tokens（输入侧，与 Anthropic 定价一致）
const CONV_MODEL_PRICE = {
  "claude-haiku-4-5-20251001": 0.80,
  "claude-haiku-4-5": 0.80,
  "haiku": 0.80,
  "claude-sonnet-4-6": 3.00,
  "sonnet": 3.00,
  "claude-opus-4-8": 15.00,
  "opus": 15.00,
  "opusplan": 15.00,
  "claude-fable-5": 3.00,
};
// 输出侧定价（USD / 1M tokens）
const CONV_MODEL_OUT_PRICE = {
  "claude-haiku-4-5-20251001": 4.00,
  "claude-haiku-4-5": 4.00,
  "haiku": 4.00,
  "claude-sonnet-4-6": 15.00,
  "sonnet": 15.00,
  "claude-opus-4-8": 75.00,
  "opus": 75.00,
  "opusplan": 75.00,
  "claude-fable-5": 15.00,
};
const CONV_MODEL_LIST = [
  { value: "", label: "全局默认", sub: "使用设置页模型" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5", sub: "$0.80/M · 最省" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6", sub: "$3.00/M · 均衡" },
  { value: "claude-opus-4-8", label: "Opus 4.8", sub: "$15.00/M · 最强" },
];
const CONV_MODEL_SHORT = { "": "默认", "claude-haiku-4-5-20251001": "Haiku", "claude-sonnet-4-6": "Sonnet", "claude-opus-4-8": "Opus" };
function syncConvModelSel() {
  const sel = $("convModelSel");
  const btn = $("convModelBtn");
  const cur = (activeConv && activeConv._convModel) || "";
  if (sel) sel.value = cur;
  if (btn) btn.textContent = CONV_MODEL_SHORT[cur] || "默认";
  updateConvEstCost();
}
function updateConvEstCost() {
  const readout = $("costReadout");
  if (!readout) return;
  let estEl = $("convEstCost");
  // 确定本对话实际使用的模型：本对话覆盖 > 全局选择 > 无
  const convModel = (activeConv && activeConv._convModel) || "";
  const globalModel = ($("modelSelect") && $("modelSelect").value) || "";
  const effectiveModel = convModel || globalModel;
  const inPrice = CONV_MODEL_PRICE[effectiveModel] ?? 0;
  const outPrice = CONV_MODEL_OUT_PRICE[effectiveModel] ?? 0;
  const inputTxt = ($("input") && $("input").value) || "";
  const inputTokens = Math.round(inputTxt.length / 4);
  const ctxTokens = (activeConv && activeConv.ctx) || 0;
  const totalInTokens = ctxTokens + inputTokens;
  // 输出侧粗估：按历史平均 500 tokens/回复
  const estOutTokens = 500;
  const estUsd = inPrice > 0
    ? (totalInTokens / 1e6) * inPrice + (estOutTokens / 1e6) * (outPrice || inPrice * 5)
    : 0;
  if (!estEl) {
    estEl = document.createElement("span");
    estEl.id = "convEstCost";
    readout.parentElement.insertBefore(estEl, readout);
  }
  const totalK = totalInTokens >= 1000 ? `${(totalInTokens / 1000).toFixed(1)}k` : `${totalInTokens}`;
  const costStr = inPrice === 0 ? "—" : (estUsd < 0.001 ? "<$0.001" : `$${estUsd.toFixed(3)}`);
  estEl.textContent = `发送 ≈${totalK} tok · ${costStr}`;
  const modelLabel = effectiveModel || "默认";
  estEl.title =
    `上下文 ${ctxTokens.toLocaleString()} + 输入 ${inputTokens.toLocaleString()} = ${totalInTokens.toLocaleString()} tokens（输入侧）\n` +
    `输入 $${inPrice}/M · 输出 $${(outPrice || inPrice * 5)}/M\n` +
    `预估发送费用 ≈ $${estUsd.toFixed(5)}（模型：${modelLabel}）`;
}
function refreshSendBtn() {
  const hasText = $("input").value.trim().length > 0;
  const busy = !!activeConv?.busy;
  const btn = $("send");
  // 有文字 => 发送（忙碌则排队）；无文字且忙碌 => 停止
  if (hasText || !busy) {
    btn.textContent = "↑";
    btn.title = tr("发送（Ctrl/⌘+Enter）");
    btn.style.background = "";
  } else {
    btn.textContent = "⏹";
    btn.title = tr("停止");
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
    cwd: seed?.cwd || null, // 本对话"出生"时的 cwd：session 文件按目录存盘，续聊（含跨设备）须沿用
    inited: !!seed?.inited,
    _html: seed?.html || "",
    pane: null,
    currentBubble: null,
    toolCards: {},
    busy: false,
    unread: false, // 非活跃时轮次完成/出错 => true，tab 上显示未读圆点，切回即清除
    remoteRunning: !!seed?.running, // 手机端正在这个对话里跑（来自共享文件的 running 标记）
    queue: [], // 当前轮进行中时，后续追问排队，依次自动发送
    askTimers: [], // AskUserQuestion 卡片的自动倒计时 setInterval，删除/重载时统一清理
    promptHist: Array.isArray(seed?.promptHist) ? seed.promptHist.slice(-20) : [], // 最近 20 条已发送 prompt，供输入框 ↑/↓ 召回
    _histIdx: -1, // 当前召回位置（-1=未在历史导航中，运行时状态不持久化）
    _histDraft: null, // 开始召回前暂存的未发送草稿，Esc/↓ 越界时还原
    costUsd: seed?.costUsd || 0, // 本会话累计费用（SDK 按当前模型单价结算的 total_cost_usd 累加）
    tokens: seed?.tokens || 0, // 本会话累计 token（输入+输出+缓存，全价口径，兼容旧存档）
    usage: seed?.usage || { in: 0, out: 0, cw: 0, cr: 0 }, // 分项累计：输入/输出/缓存写/缓存读，用于按真实计费比例折算
    ctx: seed?.ctx || 0, // 当前上下文规模（最近一轮最后一次请求的输入侧 token），超阈值时提示压缩
    tokenLimit: seed?.tokenLimit || 0, // 本对话 token 上限（0=不限），超出后警告条提示
  };
}
// 清掉某对话所有未结束的 AskUserQuestion 倒计时，避免 timer 在 conv 卸载后仍跑到超时
function clearAskTimers(conv) {
  if (!conv || !conv.askTimers) return;
  conv.askTimers.forEach((t) => clearInterval(t));
  conv.askTimers.length = 0;
}
let _saveTimer = null;
let archived = []; // 已关闭对话的历史归档（与手机端共用同一份文件的 history 字段）
const removedIds = new Set(); // 本端删除过的对话/归档 id：保存合并与手机端同步时防"复活"
function buildConvState() {
  return {
    list: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      sessionId: c.sessionId,
      cwd: c.cwd,
      inited: c.inited,
      costUsd: c.costUsd,
      tokens: c.tokens,
      usage: c.usage,
      ctx: c.ctx,
      tokenLimit: c.tokenLimit || 0,
      promptHist: c.promptHist,
      html: c.pane ? c.pane.innerHTML : c._html || "",
      ...(c.remoteRunning ? { running: true } : {}), // 保留手机端进行中标记，避免本端落盘把它抹掉
    })),
    active: activeConv?.id || null,
    history: archived,
    removed: [...removedIds], // 主进程合并判断用，不落盘
  };
}
function persistConvs() {
  // 唯一持久层：磁盘文件（原子写、无配额限制）；debounce 合并高频写，只在落盘时序列化一次
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    window.api.saveConvs(buildConvState()).then(r => { if (r?.error) toast('对话保存失败：' + r.error, 'error'); });
  }, 400);
}
// 关闭/刷新前立即落盘，补上 debounce 窗口内可能丢失的最后改动
window.addEventListener("pagehide", () => {
  if (!_saveTimer) return; // 没有待写改动
  clearTimeout(_saveTimer);
  _saveTimer = null;
  window.api.saveConvs(buildConvState());
});

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
  if (activeConv) {
    const draftVal = $('input').value;
    activeConv._draft = draftVal;
    if (draftVal) safeLocalSet('draft_' + activeConv.id, draftVal);
    else localStorage.removeItem('draft_' + activeConv.id);
  }
  activeConv = c;
  showActive();
  const inp = $('input');
  const savedDraft = localStorage.getItem('draft_' + c.id) || c._draft || '';
  inp.value = savedDraft;
  if (savedDraft) { inp.setSelectionRange(savedDraft.length, savedDraft.length); inp.focus(); }
  inp.dispatchEvent(new Event('input'));
  renderConvList();
  persistConvs();
}

function deleteConv(id) {
  const i = conversations.findIndex((c) => c.id === id);
  if (i < 0) return;
  const conv = conversations[i];
  clearAskTimers(conv); // 停掉它残留的 AskUserQuestion 倒计时，避免删除后仍 doSubmit 到已卸载的 conv
  if (conv.busy) window.api.stop(conv.id); // 删除前停掉它的查询
  if (conv.id === reqConvId) reqConvId = null; // 解绑需求清单（pumpReqs 会重新绑定）
  archiveConv(conv); // 关闭前归档到历史，可在「🕘 历史」里重新打开续聊
  removedIds.add(conv.id); // 空对话不归档也算删除，防止从共享文件合并回来
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
    cwd: conv.cwd || null,
    html,
    archivedAt: Date.now(),
  });
  if (archived.length > 200) archived.length = 200; // 上限保护
}
function openHistory() {
  $("historyModal").classList.add("open");
  $("histSearch").value = "";
  $("histCwdFilter").classList.toggle("active", false);
  renderHistory("", false);
  $("histSearch").focus();
}
function closeHistory() { $("historyModal").classList.remove("open"); }
// 历史条目正文纯文本缓存：id -> { html, text }（html 变了才重新解析，避免每次搜索都建 DOM）
const histTextCache = new Map();
function histPlainText(h) {
  if (!h.html) return "";
  const c = histTextCache.get(h.id);
  if (c && c.html === h.html) return c.text;
  const tmp = document.createElement("div");
  tmp.innerHTML = h.html;
  const text = (tmp.textContent || "").replace(/\s+/g, " ").trim();
  histTextCache.set(h.id, { html: h.html, text });
  return text;
}
// 取关键词命中处约 80 字符的上下文摘要，命中词用 <mark> 高亮
function histSnippet(text, q) {
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 50);
  return (start > 0 ? "…" : "") +
    esc(text.slice(start, idx)) + `<mark>${esc(text.slice(idx, idx + q.length))}</mark>` + esc(text.slice(idx + q.length, end)) +
    (end < text.length ? "…" : "");
}
function histShortCwd(cwd) {
  if (!cwd) return "";
  // 取最后两段路径作短路径，跨平台兼容 / 和 \
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? parts.join("/") : parts.slice(-2).join("/");
}
function renderHistory(filter, cwdOnly) {
  const box = $("histList");
  box.innerHTML = "";
  const q = (filter || "").toLowerCase();
  let items = archived.filter((h) => !q || (h.title || "").toLowerCase().includes(q) || fmtTime(h.archivedAt).toLowerCase().includes(q) || histPlainText(h).toLowerCase().includes(q));
  if (cwdOnly && currentFolder) {
    items = items.filter((h) => h.cwd && h.cwd === currentFolder);
  }
  if (!items.length) {
    box.innerHTML = `<div class="hist-empty">${cwdOnly ? tr("当前目录无历史记录") : (q ? tr("无匹配历史") : tr("暂无历史记录"))}</div>`;
    return;
  }
  for (const h of items) {
    const row = document.createElement("div");
    row.className = "hist-row";
    const title = esc(h.title || tr("新对话"));
    // 仅正文命中（标题/时间未命中）时展示上下文摘要，帮用户确认是哪段对话
    const titleHit = q && ((h.title || "").toLowerCase().includes(q) || fmtTime(h.archivedAt).toLowerCase().includes(q));
    const snippet = q && !titleHit ? histSnippet(histPlainText(h), q) : "";
    const cwdPart = h.cwd ? `<span class="hist-cwd" title="${esc(h.cwd)}">${esc(histShortCwd(h.cwd))}</span>` : "";
    row.innerHTML =
      `<div class="hist-main"><div class="hist-title">${title}</div>` +
      `<div class="hist-meta">${fmtTime(h.archivedAt)}${cwdPart}${h.sessionId ? `<span class="hist-badge">${tr("可续聊")}</span>` : ""}</div>` +
      (snippet ? `<div class="hist-snippet">${snippet}</div>` : "") + `</div>` +
      `<button class="hist-open">${tr("打开")}</button><button class="hist-export" title="${tr("导出 .md")}">↓md</button><button class="hist-del" title="${tr("删除")}">×</button>`;
    row.querySelector(".hist-open").onclick = () => restoreFromHistory(h.id);
    row.querySelector(".hist-export").onclick = (e) => { e.stopPropagation(); exportHistoryMd(h); };
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
  histTextCache.delete(id);
  removedIds.add(id); // 防止从共享文件合并复活
  persistConvs();
  renderHistory($("histSearch").value || "", $("histCwdFilter").classList.contains("active"));
}

// HTML 对话快照 → Markdown（保留代码块、段落，去掉高亮 DOM 标签）
function htmlToMd(html, title) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const lines = [title ? `# ${title}\n` : ""];
  const msgs = tmp.querySelectorAll(".msg");
  msgs.forEach((msg) => {
    const isUser = msg.classList.contains("user");
    const role = isUser ? "**You**" : "**Claude**";
    const bubble = msg.querySelector(".bubble");
    if (!bubble) return;
    lines.push(`${role}\n`);
    // 遍历 bubble 子节点，区分代码块与普通文本
    const parts = [];
    bubble.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) parts.push(t);
      } else if (node.nodeName === "PRE") {
        const codeEl = node.querySelector("code");
        const lang = (codeEl && [...(codeEl.classList || [])].map((c) => c.replace("language-", "")).find((c) => c !== "hljs") ) || "";
        parts.push("```" + lang + "\n" + (codeEl ? codeEl.textContent : node.textContent) + "\n```");
      } else if (node.nodeName === "P") {
        const t = node.textContent.trim();
        if (t) parts.push(t);
      } else if (node.nodeName === "UL" || node.nodeName === "OL") {
        node.querySelectorAll("li").forEach((li, i) => {
          parts.push((node.nodeName === "OL" ? `${i + 1}. ` : "- ") + li.textContent.trim());
        });
      } else if (/^H[1-6]$/.test(node.nodeName)) {
        const lvl = "#".repeat(Number(node.nodeName[1]));
        parts.push(`${lvl} ${node.textContent.trim()}`);
      } else {
        const t = node.textContent.trim();
        if (t) parts.push(t);
      }
    });
    // bubble 无子元素节点时直接用 textContent
    if (!parts.length) {
      const t = bubble.textContent.trim();
      if (t) parts.push(t);
    }
    lines.push(parts.join("\n\n") + "\n");
    lines.push("---\n");
  });
  return lines.join("\n");
}
async function exportHistoryMd(h) {
  if (!h.html) { alert(tr("该对话无内容可导出")); return; }
  const md = htmlToMd(h.html, h.title || tr("对话记录"));
  const safeTitle = (h.title || "conversation").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const result = await window.api.saveTextFile({ defaultName: safeTitle + ".md", content: md });
  if (result && result.error) alert(tr("导出失败：") + result.error);
}

// 紧凑显示 token 数：1234→1.2k、1234567→1.2M
function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
// 上下文超过该规模就提示压缩/新开对话——再往后每轮重发的历史越来越贵
const CTX_WARN = 100000;
// 超过该规模后，用户下次发消息时先自动 /compact 再发（与 Claude Code 自动压缩同思路，
// 但提前到更省钱的时点：不等到逼近模型上限才压）
const CTX_AUTOCOMPACT = 130000;
// 在输入区底部显示当前会话累计 token 与费用，让成本一目了然。
// 计费等效口径：缓存读≈0.1×、缓存写≈1.25×（与 API 定价比例一致）；
// 旧的四项全价累加会把便宜的缓存读也按全价算，数字虚高一个量级。
function renderCostReadout() {
  const el = $("costReadout");
  if (!el) return;
  const c = activeConv;
  if (!c || (!c.tokens && !c.ctx)) { el.textContent = ""; el.title = ""; return; }
  const u = c.usage || { in: 0, out: 0, cw: 0, cr: 0 };
  const billed = Math.round(u.in + u.out + u.cw * 1.25 + u.cr * 0.1) || c.tokens;
  const big = c.ctx >= CTX_WARN;
  const pct = c.ctx ? Math.min(100, Math.round(c.ctx / CTX_AUTOCOMPACT * 100)) : 0;
  const barHtml = c.ctx
    ? `<span class="ctx-bar-wrap" title=""><span class="ctx-bar-fill${big ? " warn" : ""}" style="width:${pct}%"></span></span>`
    : "";
  el.innerHTML =
    barHtml +
    `<span>` +
    (big ? "⚠ " : "") +
    (c.ctx ? trf("上下文 {0} · ", fmtTokens(c.ctx)) : "") +
    `${fmtTokens(billed)} tok · $${c.costUsd.toFixed(4)}` +
    `</span>`;
  el.title =
    trf("当前上下文：约 {0} tokens（每轮都会随请求整体重发，是消耗的主因）", (c.ctx || 0).toLocaleString()) +
    "\n" +
    trf("累计分项：输入 {0} · 输出 {1} · 缓存写 {2} · 缓存读 {3}",
      u.in.toLocaleString(), u.out.toLocaleString(), u.cw.toLocaleString(), u.cr.toLocaleString()) +
    "\n" +
    trf("计费等效 ≈ {0} tokens · 估算 ${1}", billed.toLocaleString(), c.costUsd.toFixed(4)) +
    (big ? "\n" + tr("⚠ 上下文已较大：发送 /compact 压缩历史，或新开对话更省 token") : "");
  updateConvEstCost(); // ctx 更新后同步刷新下一次发送的预估
  checkTokenLimit(); // 检查是否超过本对话 token 上限
}

function checkTokenLimit() {
  const warn = $("tokenLimitWarn");
  const msg = $("tokenLimitMsg");
  if (!warn || !msg) return;
  const c = activeConv;
  if (!c || !c.tokenLimit) { warn.classList.remove("visible"); return; }
  const u = c.usage || { in: 0, out: 0, cw: 0, cr: 0 };
  const billed = Math.round(u.in + u.out + u.cw * 1.25 + u.cr * 0.1) || c.tokens;
  if (billed > c.tokenLimit) {
    msg.textContent = trf(
      "已消耗 {0} token，超出设定上限 {1}，继续发送将产生额外费用",
      billed.toLocaleString(), c.tokenLimit.toLocaleString()
    );
    warn.classList.add("visible");
  } else {
    warn.classList.remove("visible");
  }
}

function syncTokenLimitInput() {
  const inp = $("tokenLimitInput");
  if (!inp) return;
  const c = activeConv;
  inp.value = (c && c.tokenLimit) ? String(c.tokenLimit) : "";
}

// 对话底部 token 统计条 + 裁剪按钮
function renderCtxFooter() {
  const footer = $("ctxFooter");
  const tokEl = $("ctxFooterTok");
  if (!footer || !tokEl) return;
  const c = activeConv;
  if (!c || !c.ctx) { footer.classList.remove("visible"); return; }
  footer.classList.add("visible");
  const kTok = (c.ctx / 1000).toFixed(1);
  tokEl.textContent = kTok;
  tokEl.className = "ctx-tok" + (c.ctx >= CTX_WARN ? " warn" : "");
}

// 裁剪对话：保留最近 N 轮（user+assistant 各算 1 条 msg），更早的从 DOM 移除，追加 system note
function trimConvToN(n) {
  const c = activeConv;
  if (!c || !c.pane) return;
  const msgs = [...c.pane.querySelectorAll(":scope > .msg")];
  if (!msgs.length) return;
  if (msgs.length <= n) { toast(trf("当前只有 {0} 条消息，无需裁剪", msgs.length)); return; }
  const removeCount = msgs.length - n;
  for (let i = 0; i < removeCount; i++) msgs[i].remove();
  // 追加 system note
  const note = document.createElement("div");
  note.className = "msg assistant";
  note.innerHTML = `<div class="role">系统</div><div class="bubble" style="font-size:11px;color:#9a9a9a">✂ 已裁剪 ${removeCount} 条早期消息（保留最近 ${n} 条）。上下文已缩短，后续请求费用将降低。</div>`;
  c.pane.insertBefore(note, c.pane.firstChild);
  // 估算裁剪后 ctx（按比例缩减）
  c.ctx = Math.round(c.ctx * (n / msgs.length));
  persistConvs();
  renderCtxFooter();
  renderCostReadout();
  toast(trf("已裁剪，保留最近 {0} 条消息", n));
}

// 渲染顶部 tab 标签条（tab 名=首条输入）
function renderConvList() {
  const tabs = $("convTabs");
  tabs.innerHTML = "";
  const q = convSearchQuery.toLowerCase();
  const filtered = q
    ? conversations.filter((c) => {
        const title = (c.title || "").toLowerCase();
        const first = (c.messages?.[0]?.content || "");
        const firstText = (typeof first === "string" ? first : first?.[0]?.text || "").toLowerCase();
        return title.indexOf(q) !== -1 || firstText.indexOf(q) !== -1;
      })
    : conversations;
  for (const c of filtered) {
    const el = document.createElement("div");
    el.className = "conv-tab" + (c.id === activeConv?.id ? " active" : "");
    const dispTitle = !c.title || c.title === "新对话" ? tr("新对话") : c.title;
    el.title = dispTitle;
    el.innerHTML =
      (c.busy
        ? `<span class="conv-run" title="${tr("进行中") + (c.queue.length ? trf("，排队 {0}", c.queue.length) : "")}">●${c.queue.length ? c.queue.length : ""}</span>`
        : c.remoteRunning
          ? `<span class="conv-run" title="${tr("手机端进行中")}">●</span>`
          : c.unread
            ? `<span class="conv-unread" title="${tr("有新结果，点击查看")}">●</span>`
          : "") +
      `<span class="conv-title">${esc(dispTitle)}</span>` +
      (c.ctx >= CTX_WARN ? `<span class="conv-ctx-warn" title="${trf('上下文 {0}，建议 /compact 或新开对话', fmtTokens(c.ctx))}">⚠</span>` : "") +
      `<span class="conv-del" title="${tr("关闭")}">×</span>`;
    el.dataset.cid = c.id;
    el.onclick = (e) => {
      if (e.target.classList.contains("conv-del")) {
        e.stopPropagation();
        deleteConv(c.id);
      } else {
        switchConv(c.id);
      }
    };
    // 双击标题内联重命名；单击可能已触发 switchConv 重渲染，按 id 重查当前 tab 元素
    el.ondblclick = (e) => {
      if (e.target.classList.contains("conv-del")) return;
      const cur = [...$("convTabs").children].find((t) => t.dataset.cid === c.id) || el;
      startRenameConv(c, cur);
    };
    tabs.appendChild(el);
    if (c.id === activeConv?.id) el.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}

// 把 tab 的标题 span 换成输入框：Enter 确认 / Esc 取消 / 失焦保存，写回 conv.title 并持久化
function startRenameConv(conv, tabEl) {
  const span = tabEl.querySelector(".conv-title");
  if (!span || tabEl.querySelector(".conv-rename")) return;
  const input = document.createElement("input");
  input.className = "conv-rename";
  input.value = !conv.title || conv.title === "新对话" ? "" : conv.title;
  input.placeholder = tr("新对话");
  input.maxLength = 60;
  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const t = input.value.trim();
    if (save && t && t !== conv.title) {
      conv.title = t;
      persistConvs();
    }
    renderConvList(); // 恢复正常 tab 显示（取消时也要还原）
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // 别触发全局快捷键
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  };
  input.onblur = () => finish(true);
  span.replaceWith(input);
  input.focus();
  input.select();
}

$("newconv").onclick = newConversation;

// ── 导出对话为 Markdown：把 user/assistant 轮次拼成 .md 落盘，衔接文档/版本库工作流 ──
// 优先用气泡的 markdown 原文(_raw)，回退纯文本；含工具调用摘要可选（按住 Shift 导出时附带）。
function convToMarkdown(conv, includeTools) {
  const pane = conv.pane || (conv._html ? Object.assign(document.createElement("div"), { innerHTML: conv._html }) : null);
  if (!pane) return "";
  const out = [];
  for (const msg of pane.querySelectorAll(":scope > .msg")) {
    const role = msg.classList.contains("user") ? tr("你") : "Claude";
    const parts = [];
    for (const node of msg.children) {
      if (node.classList.contains("role")) continue;
      if (node.classList.contains("bubble")) {
        if (node._raw != null && node._raw !== "") { parts.push(node._raw.trim()); continue; }
        const c = node.cloneNode(true);
        c.querySelectorAll(".copy-btn, .msg-attach").forEach((x) => x.remove());
        const t = c.textContent.trim();
        if (t) parts.push(t);
        const atts = [...node.querySelectorAll(".msg-attach img, .msg-attach .file")]
          .map((a) => "📎 " + (a.title || a.textContent || "").replace(/^📎\s*/, "").trim()).filter(Boolean);
        if (atts.length) parts.push(atts.join("\n"));
      } else if (includeTools && node.classList.contains("toolcall")) {
        parts.push("> " + node.textContent.trim());
      } else if (node.classList.contains("askq")) {
        const t = node.textContent.trim();
        if (t) parts.push("> " + t.replace(/\n/g, "\n> "));
      }
    }
    const body = parts.filter(Boolean).join("\n\n");
    if (body) out.push(`## ${role}\n\n${body}`);
  }
  if (!out.length) return "";
  const title = (conv.title && conv.title !== "新对话") ? conv.title : tr("对话");
  return `# ${title}\n\n*${fmtTime(Date.now())}*\n\n${out.join("\n\n---\n\n")}\n`;
}

async function exportActiveConv(includeTools) {
  const conv = activeConv;
  if (!conv) return;
  const md = convToMarkdown(conv, includeTools);
  if (!md) { toast(tr("当前对话没有可导出的内容"), "error"); return; }
  const base = (conv.title && conv.title !== "新对话" ? conv.title : tr("对话")).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const r = await window.api.saveTextFile({ defaultName: base + ".md", content: md });
  if (!r || r.canceled) return;
  if (r.error) { toast(tr("导出失败：") + r.error, "error"); return; }
  toast(tr("已导出到 ") + r.path);
}
$("exportConv").onclick = (e) => exportActiveConv(e.shiftKey);

$("ctxTrimBtn").onclick = async () => {
  const c = activeConv;
  if (!c || !c.pane) return;
  const total = c.pane.querySelectorAll(":scope > .msg").length;
  if (!total) { toast(tr("当前对话没有消息")); return; }
  const raw = await modalPrompt(trf("当前共 {0} 条消息。\n保留最近几条？（输入数字，1 条=1 个 user 或 assistant 气泡）", total), String(Math.max(1, Math.min(10, total))));
  if (raw === null) return; // 取消
  const n = parseInt(raw, 10);
  if (!n || n < 1 || n >= total) { toast(n >= total ? tr("保留数不少于当前消息数，无需裁剪") : tr("请输入有效的正整数")); return; }
  trimConvToN(n);
};

// 启动：从磁盘恢复对话历史（旧版 localStorage 全量缓存一次性迁移后清除，磁盘是唯一持久层）
(async function initConvs() {
  let d = null;
  try { d = await window.api.loadConvs(); } catch {}
  if (!d || !Array.isArray(d.list) || !d.list.length) {
    try { d = JSON.parse(localStorage.getItem("claudeTools.convs") || "null"); } catch {}
  }
  try { localStorage.removeItem("claudeTools.convs"); } catch {}
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

// ── 双端同步：手机端写入共享历史文件后，主进程监听到变化发来通知，
//    把文件里的新对话/新归档合并进来；正在回复中的对话不动，避免打断 ──
async function syncConvsFromDisk() {
  let d = null;
  try { d = await window.api.loadConvs(); } catch {}
  if (!d || !Array.isArray(d.list)) return;
  let changed = false;
  for (const item of d.list) {
    if (!item || !item.id) continue;
    const local = getConv(item.id);
    if (local) {
      // 手机端进行中标记（server.mjs 流式落盘时置位/收尾时清除）
      if (!local.busy && local.remoteRunning !== !!item.running) {
        local.remoteRunning = !!item.running;
        changed = true;
      }
      // 已打开的对话：本端空闲且内容有变（手机端续聊了）才刷新
      const localHtml = local.pane ? local.pane.innerHTML : local._html || "";
      if (!local.busy && item.html && item.html !== localHtml) {
        local.title = item.title || local.title;
        local.sessionId = item.sessionId || local.sessionId;
        local.cwd = local.cwd || item.cwd || null; // 沿用对方记下的出生 cwd（跨设备续聊找回 session）
        local.inited = local.inited || !!item.inited;
        if (local.pane) {
          local.pane.innerHTML = item.html;
          local.currentBubble = null; // DOM 已整体替换，旧引用作废
          local.toolCards = {};
        } else {
          local._html = item.html;
        }
        if (local === activeConv) chat.scrollTop = chat.scrollHeight;
        changed = true;
      }
    } else if (!removedIds.has(item.id) && !archived.some((h) => h.id === item.id)) {
      conversations.push(makeConv(item)); // 手机端新开的对话
      changed = true;
    }
  }
  if (Array.isArray(d.history)) {
    for (const h of d.history) {
      if (!h || !h.id || removedIds.has(h.id) || getConv(h.id) || archived.some((x) => x.id === h.id)) continue;
      archived.push(h);
      changed = true;
    }
  }
  if (changed) {
    renderConvList();
    persistConvs();
  }
}
window.api.on("convs:changed", syncConvsFromDisk);

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
// 气泡/历史/需求清单里的图片统一用 file:// 引用已存盘附件，不把整张 base64 写进持久化 HTML；
// dataUrl 仅用于发送前 attachList 的临时缩略图（旧存档里的 data: 条目仍由 CSP 放行，正常显示）
const fileUrl = (p) => "file://" + encodeURI(p);
const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB
async function addAttachment(file) {
  if (file.size > MAX_ATTACH_BYTES) {
    toast(tr("文件过大"), "error");
    return;
  }
  try {
    const a = await saveFileAsAttachment(file);
    a.size = file.size || 0;
    pendingAttachments.push(a);
    renderAttachList();
  } catch (e) {
    toast(tr("附件保存失败：") + e, "error");
  }
}
function fmtAttTok(bytes) {
  const t = Math.round((bytes || 0) / 4);
  return t >= 1000 ? `≈${(t / 1000).toFixed(1)}k tok` : `≈${t} tok`;
}
function renderAttachList() {
  const el = $("attachList");
  el.innerHTML = "";
  let totalBytes = 0;
  pendingAttachments.forEach((a, i) => {
    totalBytes += a.size || 0;
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.innerHTML =
      (a.dataUrl ? `<img src="${a.dataUrl}">` : `<span>📎</span>`) +
      `<span class="an" title="${esc(a.name)}">${esc(a.name)}</span>` +
      `<span class="att-tok">${fmtAttTok(a.size)}</span>` +
      `<span class="ax" title="${tr("移除")}">×</span>`;
    chip.querySelector(".ax").onclick = () => {
      pendingAttachments.splice(i, 1);
      renderAttachList();
    };
    el.appendChild(chip);
  });
  const tot = $("attTokTotal");
  if (tot) {
    if (pendingAttachments.length > 1) {
      tot.textContent = `附件合计 ${fmtAttTok(totalBytes)}`;
      tot.style.display = "";
    } else {
      tot.style.display = "none";
    }
  }
}
// 粘贴
$("input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    files.forEach(addAttachment);
    return;
  }
  // 截图粘贴：files 为空但 items 里有 image/* (Ctrl+V 截图场景)
  const imageFiles = [...(e.clipboardData?.items || [])]
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (imageFiles.length) {
    e.preventDefault();
    imageFiles.forEach(addAttachment);
  }
});
// 拖拽
setupDropZone($("inputbar"), addAttachment);

async function send(light = false) {
  const input = $("input");
  let text = input.value.trim();
  // 内置 /review：取 staged diff 拼成代码审查 prompt
  if (/^\/review\s*$/i.test(text)) {
    if (!activeRepo) { toast(tr("未选择仓库，无法执行 /review"), "error"); return; }
    const r = await window.api.gitStagedDiff(activeRepo);
    if (r.error) { toast(tr("获取 diff 失败：") + r.error, "error"); return; }
    text = `请审查以下 git diff，列出 bug 和改进点：\n\`\`\`diff\n${r.diff}\n\`\`\``;
    input.value = text;
  }
  const atts = pendingAttachments.slice();
  if ((!text && !atts.length) || !activeConv) return;
  const conv = activeConv;
  const ububble = addMsg(conv, "user", text || tr("(附件)")); // 立刻显示这条提问
  if (atts.length) renderMsgAttachments(ububble, atts); // 在气泡里显示附件缩略图/文件名
  input.value = "";
  localStorage.removeItem('draft_' + conv.id);
  pendingAttachments = [];
  renderAttachList();
  $("slashPopup").classList.remove("open");
  $("filePopup").classList.remove("open");

  // ↑/↓ 历史召回栈：成功发出（含排队）即入栈，相邻去重，每会话最多保留 20 条
  if (text) {
    const h = conv.promptHist || (conv.promptHist = []);
    if (h[h.length - 1] !== text) {
      h.push(text);
      if (h.length > 20) h.shift();
    }
    if (conv._histOrigPh) { $("input").placeholder = conv._histOrigPh; conv._histOrigPh = null; }
    conv._histIdx = -1;
    conv._histDraft = null;
  }

  if (!conv.title || conv.title === "新对话") {
    const t = text || (atts[0] && atts[0].name) || tr("附件");
    conv.title = t.length > 30 ? t.slice(0, 30) + "…" : t;
  }

  // 真正发给模型的 prompt：正文 + @mention 文件内容 + 附件绝对路径
  try {
    const mentionNote = await resolveMentionedFiles(text);
    const promptToSend = text + mentionNote + attachNote(atts);

    if (conv.busy) {
      conv.queue.push(promptToSend); // 当前轮还在跑 => 排队
      renderConvList();
      refreshSendBtn();
      scrollIfActive(conv);
      return;
    }
    // 上下文过大且空闲 => 先自动压缩，再把本条消息经队列自动发出。
    // 压缩放在「用户继续聊」时才做：被搁置的对话不白白花一次压缩费
    if (conv.ctx >= CTX_AUTOCOMPACT && !conv._compacting) {
      conv._compacting = true;
      conv.queue.push(promptToSend);
      addMsg(conv, "assistant", trf("🧹 上下文已达 {0}，自动发送 /compact 压缩后继续…", fmtTokens(conv.ctx)));
      startTurn(conv, "/compact");
      return;
    }
    startTurn(conv, promptToSend, { light });
  } catch (err) {
    toast(tr("发送失败：") + err.message, "error");
    $("input").value = text;
  }
}

// 解析 text 中的 @rel/path 标记，读取文件内容，返回追加到 prompt 的字符串
async function resolveMentionedFiles(text) {
  const seen = new Set();
  const re = /@([\S]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ref = m[1].replace(/[.,!?;:'")\]>]+$/, ""); // 去掉句尾标点
    if (ref) seen.add(ref);
  }
  if (!seen.size) return "";
  const parts = [];
  for (const ref of seen) {
    const content = await window.api.readWorkdirFile(ref);
    parts.push(`=== @${ref} ===\n${content}\n=== end ===`);
  }
  return "\n\n[以下为 @引用文件内容，请直接使用]\n" + parts.join("\n\n");
}

function attachNote(list) {
  if (!list.length) return "";
  // 模板尽量短：附件说明会进入对话历史、之后每轮重发。工具用法模型自己知道，
  // 只需点明「这是要读的文件」即可
  return (
    "\n\n[附件，请用工具按需读取（图片/PDF 用 Read；docx 可解包 word/document.xml）]\n" +
    list.map((a) => "- " + a.path).join("\n")
  );
}

function renderMsgAttachments(bubble, atts) {
  const wrap = document.createElement("div");
  wrap.className = "msg-attach";
  atts.forEach((a) => {
    // 已存盘的图片用 file:// 路径引用，避免 base64 随 pane.innerHTML 持久化；无路径时退回 dataUrl
    const src = a.path && (a.type || "").startsWith("image/") ? fileUrl(a.path) : a.dataUrl;
    if (src) {
      const img = document.createElement("img");
      img.src = src;
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

// 在某对话里开始新一轮（立即发送或从队列取出后调用）；opts.plan 可覆盖全局计划开关
function startTurn(conv, text, opts) {
  clearAskTimers(conv); // 上一轮遗留的 AskUserQuestion 卡片即将作废，先清掉其倒计时
  conv.lastPrompt = text; // 暂存本轮 prompt，供出错后「↻ 重试」复用
  conv.toolCards = {};
  conv.todoCard = null; // 新一轮重新建卡，避免跨轮原位覆盖旧清单
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML = `<div class="role">Claude<button type="button" class="reply-copy" title="${tr("复制整条回复")}" data-copied="✓">📋</button><button type="button" class="reply-save-mem" title="${tr("保存到项目记忆")}">📌</button></div>`;
  conv.pane.appendChild(wrap);
  conv.currentBubble = wrap;
  conv.busy = true;
  if (conv === activeConv) refreshSendBtn();
  renderConvList();
  scrollIfActive(conv);
  const plan = opts && "plan" in opts ? opts.plan : planMode;
  conv._planTurn = plan; // 记录本轮是否计划模式：chat:done 时据此渲染「按计划执行」操作条
  // 续聊时带上本对话存下的 cwd，让主进程沿用同一目录找到对应 session（新对话为 null，主进程回退到当前 workdir）
  const light = !!(opts && opts.light);
  window.api.chat({ convId: conv.id, prompt: text, resume: conv.sessionId || null, plan, light, cwd: conv.cwd || null, projectMemory: getProjectMemory(), convModel: conv._convModel || null });
  persistConvs();
}

// 计划模式轮次结束 => 在回复尾部给出操作条：一键以 plan=false 续接同一 session 执行（Plan→Act），
// 免去「手动关计划开关再敲一句执行」的断裂流程
function addPlanActions(conv, wrap) {
  const bar = document.createElement("div");
  bar.className = "plan-actions";
  const run = document.createElement("button");
  run.type = "button";
  run.textContent = tr("✅ 按计划执行");
  run.onclick = () => {
    bar.remove();
    if (conv.busy) return; // 用户已抢先发了新消息 => 以新消息为准
    planMode = false; // 进入执行阶段：同步关掉计划开关，后续追问默认直接动手
    try { localStorage.setItem("claudeTools.planMode", "0"); } catch {}
    refreshPlanToggle();
    const text = tr("请按上述计划执行");
    addMsg(conv, "user", text);
    startTurn(conv, text, { plan: false });
  };
  const tweak = document.createElement("button");
  tweak.type = "button";
  tweak.textContent = tr("✋ 继续调整");
  tweak.onclick = () => { bar.remove(); $("input").focus(); }; // 留在计划模式，继续打字改方案
  bar.append(run, tweak);
  wrap.appendChild(bar);
  scrollIfActive(conv);
}

// follow-up 快捷按钮：每轮正常完成后追加，点击填入 prompt 并发送
function addFollowUpBtns(conv, wrap) {
  const BTNS = [
    { label: "🧪 " + tr("生成测试"),       prompt: tr("请为上述实现生成完整的单元测试，覆盖主流程和边界情况。") },
    { label: "💡 " + tr("解释实现"),       prompt: tr("请逐步解释上述实现的核心逻辑、关键设计决策与潜在风险。") },
    { label: "⚡ " + tr("提炼为快捷技能"), prompt: tr("请将上述实现提炼为一个可复用的快捷技能（skill），给出完整定义与调用示例。") },
  ];
  if (!wrap) return;
  const bar = document.createElement("div");
  bar.className = "followup-bar";
  BTNS.forEach(({ label, prompt }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "followup-btn";
    btn.textContent = label;
    btn.title = prompt;
    btn.onclick = () => {
      bar.remove();
      if (conv !== activeConv) return;
      const inp = $("input");
      inp.value = prompt;
      inp.focus();
      send();
    };
    bar.appendChild(btn);
  });
  wrap.appendChild(bar);
  scrollIfActive(conv);
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
  bubble.innerHTML = safeMd(bubble._raw || "");
  hlBlocks(bubble);
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
  // TodoWrite：渲染成带状态标记的任务清单卡片，而非一行截断 JSON
  if (name === "TodoWrite" && inputObj && Array.isArray(inputObj.todos)) {
    return appendTodoCard(conv, id, inputObj.todos);
  }
  // Edit/Write/MultiEdit：渲染成红删绿增的紧凑 diff 卡片（默认折叠），改动可在对话里直接审查
  if ((name === "Edit" || name === "Write" || name === "MultiEdit") && inputObj && inputObj.file_path) {
    return appendEditCard(conv, id, name, inputObj);
  }
  const el = document.createElement("div");
  el.className = "toolcall";
  // Bash/Read/Grep/Glob/WebSearch/WebFetch 等高频常规工具 → 一行式人类可读摘要，替代截断的原始 JSON
  const sum = toolSummary(name, inputObj);
  if (sum) {
    let t = String(sum.text).replace(/\s*\n\s*/g, " ⏎ "); // 多行命令压成一行
    if (t.length > 200) t = t.slice(0, 200) + "…";
    el.textContent = t;
    if (sum.title) el.title = sum.title;
  } else {
    let arg = "";
    try { arg = JSON.stringify(inputObj); } catch { arg = String(inputObj); }
    if (arg.length > 300) arg = arg.slice(0, 300) + "…";
    el.textContent = `🔧 ${name}  ${arg}`;
  }
  conv.currentBubble.appendChild(el);
  if (id) conv.toolCards[id] = el;
  scrollIfActive(conv);
}

// 把绝对路径缩成相对当前文件夹的短路径（不在文件夹内则原样返回）
function shortPath(p) {
  let s = String(p || "");
  const root = currentFolder ? currentFolder.replace(/\/+$/, "") + "/" : null;
  if (root && s.startsWith(root)) s = s.slice(root.length);
  return s;
}

// 高频常规工具调用 → 一行式人类可读摘要（{text, title?}）；不认识/缺关键字段则返回 null 走原始 JSON 展示
function toolSummary(name, input) {
  if (!input || typeof input !== "object") return null;
  switch (name) {
    case "Bash":
      return input.command ? { text: `$ ${input.command}`, title: input.description || "" } : null;
    case "Read":
      return input.file_path ? { text: `📖 ${tr("读取")} ${shortPath(input.file_path)}${input.offset ? `:${input.offset}` : ""}` } : null;
    case "Glob":
      return input.pattern ? { text: `📁 ${tr("匹配")} ${input.pattern}${input.path ? ` · ${shortPath(input.path)}` : ""}` } : null;
    case "Grep":
      return input.pattern ? { text: `🔎 ${tr("搜索")} ${input.pattern}${input.path ? ` · ${shortPath(input.path)}` : ""}` } : null;
    case "WebSearch":
      return input.query ? { text: `🌐 ${tr("搜索")} ${input.query}` } : null;
    case "WebFetch":
      return input.url ? { text: `🌐 ${tr("抓取")} ${input.url}` } : null;
  }
  return null;
}

// 把 TodoWrite 的 todos 渲染成 checklist 卡片（✅完成 / ▶进行中 / ○待办）；
// 同一轮内后续 TodoWrite 调用原位更新同一张卡片，多步任务进度一目了然
function appendTodoCard(conv, id, todos) {
  let card = conv.todoCard;
  if (!card || card.parentElement !== conv.currentBubble) {
    card = document.createElement("div");
    card.className = "todocard";
    card._skipResult = true; // 结果只是「已更新」样板话，无需再追加 toolresult 行
    conv.currentBubble.appendChild(card);
    conv.todoCard = card;
  }
  const done = todos.filter((t) => t.status === "completed").length;
  let html = `<div class="head">📋 ${trf("任务进度 {0}/{1}", done, todos.length)}</div>`;
  todos.forEach((t) => {
    const st = t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : "todo";
    const mark = st === "done" ? "✅" : st === "doing" ? "▶" : "○";
    const text = (st === "doing" && t.activeForm) || t.content || "";
    html += `<div class="item ${st}"><span class="mark">${mark}</span>${esc(text)}</div>`;
  });
  card.innerHTML = html;
  if (id) conv.toolCards[id] = card;
  scrollIfActive(conv);
}

// 把 old/new 文本拼成 -/+ 前缀的伪 diff 行（复用 git 面板 diffToHtml 上色）
function editLines(oldStr, newStr) {
  const out = [];
  if (oldStr) String(oldStr).split("\n").forEach((l) => out.push("-" + l));
  if (newStr) String(newStr).split("\n").forEach((l) => out.push("+" + l));
  return out;
}

// Edit/Write/MultiEdit 工具调用 → diff 卡片：标题行显示相对路径与 +增/−删 行数，点击展开红删绿增详情
function appendEditCard(conv, id, name, input) {
  const root = currentFolder ? currentFolder.replace(/\/+$/, "") + "/" : null;
  let rel = String(input.file_path);
  if (root && rel.startsWith(root)) rel = rel.slice(root.length);
  let lines = [];
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    input.edits.forEach((e, i) => {
      if (i) lines.push(`@@ #${i + 1} @@`); // 多处编辑之间的分隔线（@@ 走 at 紫色样式）
      lines.push(...editLines(e.old_string, e.new_string));
    });
  } else if (name === "Write") {
    lines = editLines("", input.content); // 整份新内容按全新增展示
  } else {
    lines = editLines(input.old_string, input.new_string);
  }
  const adds = lines.filter((l) => l[0] === "+").length;
  const dels = lines.filter((l) => l[0] === "-").length;
  if (lines.length > 400) lines = lines.slice(0, 400).concat(tr("…（已截断）"));
  const el = document.createElement("details");
  el.className = "editcard";
  el._skipResult = true; // 成功结果只是「已更新」样板话；出错时仍会追加 toolresult 行
  const label = name === "Write" ? tr("写入") : tr("修改");
  el.innerHTML =
    `<summary>📝 ${label} <span class="path">${esc(rel)}</span>` +
    `<span class="stat"><span class="add">+${adds}</span> <span class="del">−${dels}</span></span></summary>`;
  const pre = document.createElement("pre");
  pre.innerHTML = diffToHtml(lines.join("\n"));
  el.appendChild(pre);
  conv.currentBubble.appendChild(el);
  if (id) conv.toolCards[id] = el;
  scrollIfActive(conv);
}

// 弹一条系统通知（自动处理权限申请）；onclick 用于点击通知后切回对应对话
function sysNotify(title, body, onclick) {
  try {
    if (typeof Notification === "undefined") return;
    const show = () => {
      try {
        const n = new Notification(title, { body });
        if (onclick) n.onclick = onclick;
      } catch {}
    };
    if (Notification.permission === "granted") show();
    else if (Notification.permission !== "denied") Notification.requestPermission().then((p) => { if (p === "granted") show(); });
  } catch {}
}

// 弹一条系统通知 + 状态栏提示，告诉用户「需要做选择」，避免被后台对话刷屏滚过
function notifyDecision(text, urgent) {
  try {
    const s = $("status");
    if (s) s.textContent = (urgent ? "⚠ " : "🔔 ") + text;
  } catch {}
  sysNotify(urgent ? tr("Claude 需要你的决定") : tr("Claude 等待你选择"), text);
}

// 非活跃对话的轮次结束/出错：tab 加未读圆点 + 系统通知，免得用户切走后反复手动切回查看
function notifyBgTurnEnd(conv, ok, ms) {
  if (!conv || conv === activeConv) return;
  conv.unread = true;
  renderConvList();
  const title = !conv.title || conv.title === "新对话" ? tr("新对话") : conv.title;
  sysNotify(
    ok ? trf("✅ 「{0}」已完成 · 用时 {1}ms", title, ms) : trf("❌ 「{0}」出错了", title),
    ok ? tr("点击切回查看结果") : tr("点击切回查看错误详情"),
    () => switchConv(conv.id)
  );
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
    if (timer) {
      clearInterval(timer);
      if (conv && conv.askTimers) {
        const k = conv.askTimers.indexOf(timer);
        if (k >= 0) conv.askTimers.splice(k, 1);
      }
      timer = null;
    }
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
    if (conv && conv.askTimers) conv.askTimers.push(timer); // 登记，便于删除/重载时统一 clearInterval
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
  if (card && card._skipResult && !isError) return; // 卡片自身已展示状态（如 TodoWrite）
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

$("pasteTerminal").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const ta = $("input");
    const prefix = ta.value ? ta.value + "\n" : "";
    ta.value = prefix + "```\n" + text.trimEnd() + "\n```";
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("input"));
  } catch { /* 用户拒绝剪贴板权限时静默 */ }
};

// 计划模式：开启后发送的查询会先要求模型给出分步方案待确认，不直接改动（状态跨会话保留）
let planMode = false;
try { planMode = localStorage.getItem("claudeTools.planMode") === "1"; } catch {}
function refreshPlanToggle() { $("planToggle").classList.toggle("on", planMode); }
$("planToggle").onclick = () => {
  planMode = !planMode;
  try { localStorage.setItem("claudeTools.planMode", planMode ? "1" : "0"); } catch {}
  refreshPlanToggle();
};
refreshPlanToggle();

// token 上限输入框：输入后写入 conv.tokenLimit 并立即检测
$("tokenLimitInput").addEventListener("change", () => {
  const inp = $("tokenLimitInput");
  const val = parseInt(inp.value.replace(/[^0-9]/g, ""), 10);
  if (activeConv) {
    activeConv.tokenLimit = isNaN(val) || val <= 0 ? 0 : val;
    persistConvs();
    checkTokenLimit();
  }
});
$("tokenLimitClose").addEventListener("click", () => {
  $("tokenLimitWarn").classList.remove("visible");
});

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
  // ↑/↓ 历史召回（终端/Cursor 惯例）：输入为空或光标在首行时 ↑ 取上一条已发 prompt（循环），
  // ↓ 反向、越过最新一条还原草稿；Esc 还原召回前暂存的草稿。补全弹窗打开时已在上方 return，不会抢键
  const conv = activeConv;
  if (conv && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing) {
    const hist = conv.promptHist || [];
    const ta = e.target;
    const navigating = conv._histIdx >= 0;
    if (e.key === "ArrowUp" && hist.length &&
        (navigating || !ta.value || !ta.value.slice(0, ta.selectionStart).includes("\n"))) {
      e.preventDefault();
      if (!navigating) { conv._histDraft = ta.value; conv._histOrigPh = ta.placeholder; } // 切换前暂存未发送草稿
      conv._histIdx = navigating ? (conv._histIdx - 1 + hist.length) % hist.length : hist.length - 1;
      ta.value = hist[conv._histIdx];
      ta.placeholder = `历史 ${conv._histIdx + 1} / ${hist.length}　↑↓ 导航　Esc 退出`;
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    if (e.key === "ArrowDown" && navigating) {
      e.preventDefault();
      if (conv._histIdx >= hist.length - 1) {
        // 越过最新一条 => 还原草稿并退出导航
        ta.value = conv._histDraft || "";
        ta.placeholder = conv._histOrigPh || ta.placeholder;
        conv._histIdx = -1;
        conv._histDraft = null;
        conv._histOrigPh = null;
      } else {
        conv._histIdx++;
        ta.value = hist[conv._histIdx];
        ta.placeholder = `历史 ${conv._histIdx + 1} / ${hist.length}　↑↓ 导航　Esc 退出`;
      }
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    if (e.key === "Escape" && navigating) {
      e.preventDefault();
      e.stopPropagation(); // 别让全局 Esc 顺手关掉其他浮层
      ta.value = conv._histDraft || "";
      ta.placeholder = conv._histOrigPh || ta.placeholder;
      conv._histIdx = -1;
      conv._histDraft = null;
      conv._histOrigPh = null;
      return;
    }
  }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send(); // Ctrl/⌘+Enter 发送（忙碌时 send() 内部会自动排队）
  }
  // 普通 Enter 不拦截 => 换行
});
// 手动编辑（含修改召回出来的内容）即退出历史导航，下次 ↑ 会把当前内容重新存为草稿，
// 避免继续从旧位置切换而覆盖未保存的修改（程序赋值不触发 input 事件，召回本身不受影响）
$("input").addEventListener("input", () => {
  if (activeConv && activeConv._histOrigPh) {
    $("input").placeholder = activeConv._histOrigPh;
    activeConv._histOrigPh = null;
  }
  if (activeConv) activeConv._histIdx = -1;
});

// ── 左侧栏折叠/展开 ────────────────────────────────────────
$("toggleSidebar").onclick = () => $("sidebar").classList.toggle("collapsed");

// ── 全局快捷键（向 VSCode 看齐）──────────────────────────────
// Cmd/Ctrl+B 折叠/展开侧栏；Esc 关闭最上层浮层（预览/弹窗/菜单）
document.addEventListener("keydown", (e) => {
  // 按 ?（Shift+/）打开快捷键速查；在输入框中输入「?」时不拦截
  if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (!typing) { e.preventDefault(); toggleKbdHelp(); return; }
  }
  // Ctrl/Cmd+N：新建对话
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    newConversation();
    return;
  }
  // Ctrl/Cmd+K：唤起命令面板（集中入口，全局可用，含输入框内）
  // Ctrl/Cmd+P：同一面板（VSCode 肌肉记忆：输入即检索文件名快速打开）
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) {
    e.preventDefault();
    openCmdk();
    return;
  }
  // Ctrl/Cmd+Shift+F：直达侧栏全文搜索（VSCode 肌肉记忆）
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    cmdkSwitchView("sc");
    $("csInput").focus();
    return;
  }
  // Ctrl/Cmd+F：聊天区内搜索浮条
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openChatSearch();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
    e.preventDefault();
    $("sidebar").classList.toggle("collapsed");
    return;
  }
  if (e.key === "Escape") {
    // 按优先级关闭一个浮层（已被 input/evReq 内联处理的补全弹窗在此之前已消费）
    if ($("chatSearchBar").classList.contains("open")) { closeChatSearch(); return; }
    if ($("cmdkModal").classList.contains("open")) { closeCmdk(); return; }
    if ($("viewer").style.display === "flex") { $("vclose").click(); return; }
    // 停靠态的自进化面板是常驻侧栏（非模态），不被 Esc 关闭
    const ev = $("evolveModal");
    if (ev.classList.contains("open") && !ev.classList.contains("docked")) { ev.classList.remove("open"); return; }
    for (const id of ["kbdModal", "historyModal", "mobileModal", "mcpModal", "plibModal"]) {
      if ($(id).classList.contains("open")) { $(id).classList.remove("open"); return; }
    }
    const ctx = $("ctxMenu"), acct = $("acctMenu");
    if (ctx.classList.contains("open")) { ctx.classList.remove("open"); return; }
    if (acct.classList.contains("open")) { acct.classList.remove("open"); return; }
  }
});

// ── 聊天区消息内搜索 ─────────────────────────────────────────
let _chatSearchHits = [];
let _chatSearchCur = -1;

function _clearChatHits() {
  // 将每个 mark 元素替换回文本节点，然后 normalize 合并相邻文本节点
  const parents = new Set();
  _chatSearchHits.forEach(({ node }) => {
    const p = node.parentNode;
    if (p) { p.replaceChild(document.createTextNode(node.textContent), node); parents.add(p); }
  });
  parents.forEach(p => p.normalize());
  _chatSearchHits = [];
  _chatSearchCur = -1;
}

function _chatSearchJumpTo(idx) {
  if (!_chatSearchHits.length) return;
  if (_chatSearchCur >= 0 && _chatSearchCur < _chatSearchHits.length)
    _chatSearchHits[_chatSearchCur].node.classList.remove("current");
  _chatSearchCur = (idx + _chatSearchHits.length) % _chatSearchHits.length;
  const mark = _chatSearchHits[_chatSearchCur].node;
  mark.classList.add("current");
  mark.scrollIntoView({ block: "center", inline: "nearest" });
  $("chatSearchCount").textContent = `${_chatSearchCur + 1} / ${_chatSearchHits.length}`;
}

function _runChatSearch(q) {
  _clearChatHits();
  if (!q || !activeConv?.pane) { $("chatSearchCount").textContent = ""; return; }
  const lq = q.toLowerCase();
  const walker = document.createTreeWalker(activeConv.pane, NodeFilter.SHOW_TEXT);
  const fragments = [];
  let node;
  while ((node = walker.nextNode())) {
    const p = node.parentElement;
    if (p && (p.tagName === "SCRIPT" || p.tagName === "STYLE")) continue;
    const txt = node.textContent;
    if (txt.toLowerCase().includes(lq)) fragments.push({ node, txt });
  }
  fragments.forEach(({ node, txt }) => {
    const lt = txt.toLowerCase();
    const parent = node.parentNode;
    if (!parent) return;
    const frag = document.createDocumentFragment();
    let last = 0, idx = lt.indexOf(lq, 0);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(txt.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = "chat-search-hit";
      mark.textContent = txt.slice(idx, idx + lq.length);
      frag.appendChild(mark);
      _chatSearchHits.push({ node: mark });
      last = idx + lq.length;
      idx = lt.indexOf(lq, last);
    }
    if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    parent.replaceChild(frag, node);
  });
  $("chatSearchCount").textContent = _chatSearchHits.length ? `1 / ${_chatSearchHits.length}` : "无匹配";
  if (_chatSearchHits.length) _chatSearchJumpTo(0);
}

function openChatSearch() {
  $("chatSearchBar").classList.add("open");
  const inp = $("chatSearchInput");
  inp.select();
  inp.focus();
  if (inp.value) _runChatSearch(inp.value);
}

function closeChatSearch() {
  $("chatSearchBar").classList.remove("open");
  _clearChatHits();
  $("chatSearchCount").textContent = "";
}

{
  let _debTimer;
  $("chatSearchInput").addEventListener("input", (e) => {
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => _runChatSearch(e.target.value.trim()), 180);
  });
  $("chatSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); _chatSearchJumpTo(e.shiftKey ? _chatSearchCur - 1 : _chatSearchCur + 1); }
    if (e.key === "Escape") { e.preventDefault(); closeChatSearch(); }
  });
  $("chatSearchNext").addEventListener("click", () => _chatSearchJumpTo(_chatSearchCur + 1));
  $("chatSearchPrev").addEventListener("click", () => _chatSearchJumpTo(_chatSearchCur - 1));
  $("chatSearchClose").addEventListener("click", closeChatSearch);

  $("convSearchInput").addEventListener("input", (e) => {
    convSearchQuery = e.target.value.trim();
    renderConvList();
  });
}

// ── 快捷键速查面板 ─────────────────────────────────────────
const KBD_MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
const KBD_SHORTCUTS = [
  ["全局", [
    [["?"], "打开本速查面板"],
    [[KBD_MOD, "N"], "新建对话"],
    [[KBD_MOD, "K"], "打开命令面板（搜索动作 / 文件 / 快捷技能）"],
    [[KBD_MOD, "P"], "快速打开文件（命令面板）"],
    [[KBD_MOD, "F"], "在当前对话消息中搜索（↑/↓ 或 Enter/Shift+Enter 导航）"],
    [[KBD_MOD, "Shift", "F"], "全文搜索文件内容"],
    [[KBD_MOD, "B"], "折叠 / 展开左侧栏"],
    [["Esc"], "关闭当前弹层（查看器 / 历史 / 菜单等）"],
  ]],
  ["对话", [
    [[KBD_MOD, "Enter"], "发送消息"],
    [["Enter"], "换行"],
    [["↑", "↓"], "在斜杠 / 文件补全弹窗中选择"],
    [["Enter", "Tab"], "确认补全项"],
    [["Shift", "点击快捷技能"], "仅填入输入框（可追加上下文后再发送）"],
  ]],
  ["命令面板", [
    [["Enter"], "执行选中项"],
    [["Shift", "Enter"], "快捷技能：仅填入输入框（不发送）"],
    [["Esc"], "关闭面板"],
  ]],
  ["源代码管理", [
    [[KBD_MOD, "Enter"], "提交已暂存的更改（提交信息框内）"],
  ]],
  ["需求开发", [
    [["Enter"], "添加一条需求到清单"],
    [["Shift", "Enter"], "在需求输入框内换行"],
  ]],
  ["自进化", [
    [[KBD_MOD, "Enter"], "开始进化 / 追加方向调整"],
  ]],
];
function renderKbdHelp() {
  const html = KBD_SHORTCUTS.map(([grp, rows]) =>
    `<div class="kbd-grp">${tr(grp)}</div>` +
    rows.map(([keys, desc]) =>
      `<div class="kbd-row"><span class="kbd-desc">${tr(desc)}</span>` +
      `<span class="kbd-keys">${keys.map((k) => `<kbd>${k}</kbd>`).join("")}</span></div>`
    ).join("")
  ).join("");
  $("kbdList").innerHTML = html;
}
function toggleKbdHelp() {
  const m = $("kbdModal");
  if (m.classList.contains("open")) { m.classList.remove("open"); return; }
  renderKbdHelp();
  m.classList.add("open");
}
$("kbdHelpBtn").addEventListener("click", toggleKbdHelp);
$("kbdClose").addEventListener("click", () => $("kbdModal").classList.remove("open"));
$("kbdModal").addEventListener("click", (e) => { if (e.target.id === "kbdModal") $("kbdModal").classList.remove("open"); });

// ── 命令面板（Ctrl/Cmd+K）─────────────────────────────────
// 集中入口：模糊搜索并一键触发常用动作（切换面板/新建对话/打开 PDF/
// 检索文件/运行快捷技能等），减少在各模块间记忆与跳转的成本。
function cmdkSwitchView(view) {
  document.querySelectorAll("#activitybar .act-btn[data-view]")
    .forEach((x) => x.classList.toggle("active", x.dataset.view === view));
  $("sidebar").classList.remove("collapsed");
  $("sidebar").classList.toggle("req-mode", view === "req");
}
// 静态动作清单：与活动栏 / 顶栏既有按钮一一对应，复用其行为
// ── Saved Prompts（localStorage，零 token）─────────────────────────────
const SAVED_PROMPTS_KEY = "savedPrompts";
function getSavedPrompts() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY) || "[]");
    return raw.map(p => typeof p === "string" ? { text: p, tag: "" } : p);
  } catch { return []; }
}
function savePrompt(text, tag = "") {
  const t = text.trim();
  if (!t) return false;
  const list = getSavedPrompts().filter(p => p.text !== t);
  list.unshift({ text: t, tag: (tag || "").trim() });
  safeLocalSet(SAVED_PROMPTS_KEY, JSON.stringify(list.slice(0, 50)));
  return true;
}
function deletePrompt(text) {
  safeLocalSet(SAVED_PROMPTS_KEY, JSON.stringify(getSavedPrompts().filter(p => p.text !== text)));
}
function savePromptDialog(prefillText) {
  return new Promise((resolve) => {
    let ov = $("modalDialog");
    if (!ov) { ov = document.createElement("div"); ov.id = "modalDialog"; (document.body || document.documentElement).appendChild(ov); }
    const box = document.createElement("div");
    box.className = "box";
    const preview = document.createElement("div");
    preview.className = "md-msg";
    preview.style.cssText = "font-size:12px;opacity:.65;margin-bottom:10px;max-height:56px;overflow:hidden;white-space:pre-wrap;word-break:break-all";
    preview.textContent = prefillText.length > 120 ? prefillText.slice(0, 117) + "…" : prefillText;
    box.appendChild(preview);
    const tagInput = document.createElement("input");
    tagInput.className = "md-input";
    tagInput.placeholder = tr("标签（可留空，如：代码、文档、进化）");
    const chipsRow = document.createElement("div");
    chipsRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px";
    ["代码", "文档", "进化", "测试", "通用"].forEach(t => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "sp-chip"; c.textContent = t;
      c.onclick = () => {
        tagInput.value = tagInput.value === t ? "" : t;
        chipsRow.querySelectorAll(".sp-chip").forEach(x => x.classList.toggle("active", x.textContent === tagInput.value && tagInput.value));
      };
      chipsRow.appendChild(c);
    });
    tagInput.oninput = () => chipsRow.querySelectorAll(".sp-chip").forEach(x => x.classList.toggle("active", x.textContent === tagInput.value && tagInput.value));
    box.appendChild(tagInput); box.appendChild(chipsRow);
    const btns = document.createElement("div"); btns.className = "md-btns";
    const cancel = document.createElement("button"); cancel.className = "md-cancel"; cancel.textContent = tr("取消");
    const ok = document.createElement("button"); ok.textContent = tr("保存");
    btns.appendChild(cancel); btns.appendChild(ok); box.appendChild(btns);
    const close = (val) => { document.removeEventListener("keydown", onKey, true); ov.classList.remove("open"); ov.innerHTML = ""; resolve(val); };
    cancel.onclick = () => close(null);
    ok.onclick = () => close(tagInput.value);
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); cancel.click(); } else if (e.key === "Enter") { e.preventDefault(); ok.click(); } };
    document.addEventListener("keydown", onKey, true);
    ov.innerHTML = ""; ov.appendChild(box); ov.classList.add("open");
    tagInput.focus();
  });
}
let savedPromptsTagFilter = "";
$("savePromptBtn").onclick = async () => {
  const val = $("input").value.trim();
  if (!val) return;
  const tag = await savePromptDialog(val);
  if (tag === null) return;
  if (savePrompt(val, tag)) {
    const btn = $("savePromptBtn");
    btn.textContent = "★"; btn.style.color = "#f5c518";
    setTimeout(() => { btn.textContent = "⭐"; btn.style.color = ""; }, 1200);
  }
};

function cmdkBaseCommands() {
  const cmds = [
    { ic: "＋", label: tr("新建对话"), run: () => newConversation() },
    { ic: "⎇", label: tr("切换到源代码管理"), run: () => cmdkSwitchView("sc") },
    { ic: "✓", label: tr("切换到需求开发"), run: () => cmdkSwitchView("req") },
    { ic: "◧", label: tr("折叠 / 展开侧栏"), run: () => $("sidebar").classList.toggle("collapsed") },
    { ic: "⎇﹢", label: tr("新建分支"), run: () => $("scNewBranch").onclick() },
    { ic: "📂", label: tr("选择文件夹"), run: () => $("pick").onclick() },
    { ic: "🕘", label: tr("对话历史"), run: () => $("historyBtn").click() },
    { ic: "🧬", label: tr("自进化"), run: () => $("evolveBtn").click() },
    { ic: "📦", label: tr("全量打包"), run: () => $("packBtn").click() },
    { ic: "📱", label: tr("手机连接"), run: () => $("mobileBtn").click() },
    { ic: "🔌", label: tr("MCP 工具"), run: () => $("mcpBtn").click() },
    { ic: "👤", label: tr("切换账号"), run: () => $("acctBtn").click() },
    { ic: "🌐", label: tr("切换语言"), run: () => $("langBtn").onclick() },
    { ic: "⌨️", label: tr("快捷键速查"), run: () => toggleKbdHelp() },
    { ic: "🗺", label: tr("生成代码地图"), run: () => genCodemap() },
    { ic: "📜", label: tr("生成 CHANGELOG"), run: () => genChangelog() },
    { ic: "⬇", label: tr("导出对话为 Markdown"), hint: tr("Shift↵含工具调用"), run: (insertOnly = false) => exportActiveConv(insertOnly) },
  ];
  // 快捷技能：Enter=直接发送，Shift+Enter=仅填入输入框（可追加上下文后再手动发送）
  (QUICK_SKILLS || []).forEach((q) => cmds.push({
    ic: q.icon || "⚡", label: tr(q.label), hint: tr("快捷技能 · Shift↵插入"),
    run: (insertOnly = false) => runQuickSkill(q, insertOnly),
  }));
  // 最近目录分组
  const recentFolders = getRecentFolders();
  if (recentFolders.length) {
    cmds.push({ kind: "group", label: tr("最近目录") });
    recentFolders.forEach((f) => {
      const short = f.length > 60 ? "…" + f.slice(f.length - 57) : f;
      cmds.push({ ic: "📂", label: short, hint: tr("切换"), kind: "recent-folder",
        run: async () => {
          const ok = await window.api.setWorkdir(f);
          if (ok) { saveRecentFolder(f); await openFolderUI(f); }
          else { removeRecentFolder(f); toast(tr("目录已不存在：") + f, "error"); }
        }
      });
    });
  }
  // 已保存 Prompt 分组
  const saved = getSavedPrompts();
  if (saved.length) {
    cmds.push({ kind: "group", label: tr("已保存 Prompt") });
    const tags = [...new Set(saved.map(p => p.tag).filter(Boolean))];
    if (tags.length) cmds.push({ kind: "tag-filter", tags });
    const filtered = savedPromptsTagFilter ? saved.filter(p => p.tag === savedPromptsTagFilter) : saved;
    filtered.forEach((p) => {
      const short = p.text.length > 60 ? p.text.slice(0, 57) + "…" : p.text;
      const tagBadge = p.tag ? ` [${p.tag}]` : "";
      cmds.push({ ic: "⭐", label: short + tagBadge, hint: tr("插入"), kind: "saved", _promptText: p.text,
        run: () => { $("input").value = p.text; $("input").focus(); $("input").dispatchEvent(new Event("input")); }
      });
      cmds.push({ ic: "🗑", label: short, hint: tr("删除"), kind: "saved-del",
        run: () => { deletePrompt(p.text); }
      });
    });
  }
  return cmds;
}
let cmdkItems = [];   // 当前渲染的结果（动作 + 文件）
let cmdkSel = 0;      // 高亮项索引
let cmdkFileToken = 0; // 文件检索防竞态
function openCmdk() {
  const m = $("cmdkModal");
  if (m.classList.contains("open")) { closeCmdk(); return; }
  $("cmdkInput").value = "";
  m.classList.add("open");
  renderCmdk("");
  $("cmdkInput").focus();
}
function closeCmdk() {
  $("cmdkModal").classList.remove("open");
  $("cmdkInput").style.display = "";
  $("cmdkList").style.display = "";
  const f = $("cmdkVarForm"); f.className = ""; f.innerHTML = "";
}
function renderCmdk(q) {
  const ql = q.trim().toLowerCase();
  // 子序列模糊匹配：依次命中查询字符即算匹配
  const match = (text) => {
    const t = text.toLowerCase();
    if (!ql) return true;
    let i = 0;
    for (const ch of t) { if (ch === ql[i]) i++; if (i === ql.length) return true; }
    return false;
  };
  const actions = cmdkBaseCommands().filter((c) => c.kind === "group" || match(c.label)).map((c) => c.kind ? c : { ...c, kind: "action" });
  cmdkItems = actions;
  cmdkSel = 0;
  drawCmdk();
  // 有查询时异步并入文件名匹配结果（打开文件 / PDF 编辑器），250ms 防抖
  if (ql) {
    const token = ++cmdkFileToken;
    setTimeout(() => {
    if (token !== cmdkFileToken) return;
    window.api.searchFiles(ql).then((files) => {
      if (token !== cmdkFileToken || !$("cmdkModal").classList.contains("open")) return;
      const fileItems = (files || []).filter((f) => !f.dir).slice(0, 8).map((f) => ({
        kind: "file", ic: "📄", label: f.rel, hint: tr("打开"),
        run: () => openFile(f.path, f.name),
      }));
      cmdkItems = actions.concat(fileItems);
      drawCmdk();
    }).catch(() => {});
    }, 250);
  }
}
function drawCmdk() {
  const list = $("cmdkList");
  const selectables = cmdkItems.filter(it => it.kind !== "group");
  if (!selectables.length) { list.innerHTML = `<div class="cmdk-empty">${tr("无匹配")}</div>`; return; }
  // cmdkSel 索引对应 selectables 数组
  if (cmdkSel >= selectables.length) cmdkSel = selectables.length - 1;
  list.innerHTML = "";
  let selIdx = 0;
  cmdkItems.forEach((it) => {
    if (it.kind === "group") {
      const el = document.createElement("div");
      el.className = "cmdk-group";
      el.textContent = it.label;
      list.appendChild(el);
      return;
    }
    if (it.kind === "tag-filter") {
      const el = document.createElement("div");
      el.className = "cmdk-tag-filter";
      const allChip = document.createElement("button");
      allChip.type = "button"; allChip.className = "sp-chip" + (!savedPromptsTagFilter ? " active" : "");
      allChip.textContent = tr("全部");
      allChip.onclick = (e) => { e.stopPropagation(); savedPromptsTagFilter = ""; renderCmdk($("cmdkInput").value); };
      el.appendChild(allChip);
      it.tags.forEach(tag => {
        const c = document.createElement("button");
        c.type = "button"; c.className = "sp-chip" + (savedPromptsTagFilter === tag ? " active" : "");
        c.textContent = tag;
        c.onclick = (e) => { e.stopPropagation(); savedPromptsTagFilter = savedPromptsTagFilter === tag ? "" : tag; renderCmdk($("cmdkInput").value); };
        el.appendChild(c);
      });
      list.appendChild(el);
      return;
    }
    const myIdx = selIdx++;
    const el = document.createElement("div");
    el.className = "cmdk-item" + (myIdx === cmdkSel ? " sel" : "");
    el.innerHTML = `<span class="cmdk-ic">${esc(it.ic || "•")}</span>` +
      `<span class="cmdk-label">${esc(it.label)}</span>` +
      (it.hint ? `<span class="cmdk-hint">${esc(it.hint)}</span>` : "");
    el.onclick = () => runCmdk(myIdx);
    el.onmousemove = () => { if (cmdkSel !== myIdx) { cmdkSel = myIdx; drawCmdk(); } };
    list.appendChild(el);
  });
  list.querySelector(".cmdk-item.sel")?.scrollIntoView({ block: "nearest" });
}
function runCmdk(i, insertOnly = false) {
  const selectables = cmdkItems.filter(it => it.kind !== "group");
  const it = selectables[i];
  if (!it) return;
  // 变量占位符检测：仅对 saved prompt（插入动作）拦截
  if (it.kind === "saved" && it._promptText) {
    const vars = [...new Set([...it._promptText.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1].trim()))];
    if (vars.length) { showCmdkVarForm(it._promptText, vars); return; }
  }
  closeCmdk();
  try { it.run(insertOnly); } catch (e) { console.error(e); }
}
function showCmdkVarForm(template, vars) {
  $("cmdkInput").style.display = "none";
  $("cmdkList").style.display = "none";
  const form = $("cmdkVarForm");
  form.innerHTML = "";
  form.className = "open";
  const title = document.createElement("div");
  title.className = "cmdk-var-title";
  title.textContent = template.length > 80 ? template.slice(0, 77) + "…" : template;
  form.appendChild(title);
  const inputs = {};
  vars.forEach(v => {
    const row = document.createElement("div");
    row.className = "cmdk-var-row";
    const lbl = document.createElement("label");
    lbl.textContent = v;
    const inp = document.createElement("input");
    inp.type = "text"; inp.placeholder = v; inp.autocomplete = "off";
    row.appendChild(lbl); row.appendChild(inp);
    form.appendChild(row);
    inputs[v] = inp;
  });
  const actions = document.createElement("div");
  actions.className = "cmdk-var-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = tr("取消");
  cancelBtn.type = "button";
  cancelBtn.onclick = () => closeCmdk();
  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = tr("插入");
  confirmBtn.type = "button";
  confirmBtn.className = "primary";
  const doInsert = () => {
    let result = template;
    vars.forEach(v => { result = result.replaceAll(`{{${v}}}`, inputs[v].value); });
    closeCmdk();
    $("input").value = result;
    $("input").focus();
    $("input").dispatchEvent(new Event("input"));
  };
  confirmBtn.onclick = doInsert;
  actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
  form.appendChild(actions);
  // 首个输入框聚焦；Enter on last → 插入
  const inpEls = vars.map(v => inputs[v]);
  inpEls.forEach((el, idx) => {
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); idx < inpEls.length - 1 ? inpEls[idx + 1].focus() : doInsert(); }
      if (e.key === "Escape") { e.preventDefault(); closeCmdk(); }
    });
  });
  inpEls[0]?.focus();
}
$("cmdkInput").addEventListener("input", (e) => renderCmdk(e.target.value));
$("cmdkInput").addEventListener("keydown", (e) => {
  const selCount = cmdkItems.filter(it => it.kind !== "group").length;
  if (e.key === "ArrowDown") { e.preventDefault(); cmdkSel = Math.min(cmdkSel + 1, selCount - 1); drawCmdk(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmdkSel = Math.max(cmdkSel - 1, 0); drawCmdk(); }
  else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); runCmdk(cmdkSel, true); }
  else if (e.key === "Enter") { e.preventDefault(); runCmdk(cmdkSel); }
  else if (e.key === "Escape") { e.preventDefault(); closeCmdk(); }
});
$("cmdkModal").addEventListener("click", (e) => { if (e.target.id === "cmdkModal") closeCmdk(); });

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
  renderQuickbar();
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
// 本地费用台账（main 进程把每轮 chat/evolve 的 tokens/费用按日聚合到 data/cost-stats.json）
// → tooltip 文案：今日/本周/90天累计 + 近14天趋势 + chat/进化分账。纯本地 IPC，零 token 消耗。
async function costStatLines() {
  try {
    const days = await window.api.costStats();
    if (!days || !Object.keys(days).length) return "";
    const dayKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = Date.now();
    const today = dayKey(new Date(now));
    const weekAgo = dayKey(new Date(now - 6 * 86400000));
    const sum = { today: 0, week: 0, all: 0, chat: 0, evolve: 0, tokToday: 0 };
    for (const [d, rec] of Object.entries(days))
      for (const [src, t] of Object.entries(rec)) {
        sum.all += t.cost;
        sum[src === "evolve" ? "evolve" : "chat"] += t.cost;
        if (d >= weekAgo) sum.week += t.cost;
        if (d === today) { sum.today += t.cost; sum.tokToday += t.in + t.out + t.cw + t.cr; }
      }
    // 近 14 天费用趋势（块高按当期最大值归一，·=当天无消耗）
    const lvl = "▁▂▃▄▅▆▇█";
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const rec = days[dayKey(new Date(now - i * 86400000))];
      series.push(rec ? Object.values(rec).reduce((a, t) => a + t.cost, 0) : 0);
    }
    const max = Math.max(...series);
    const spark = series.map((v) => (v <= 0 ? "·" : lvl[Math.min(7, Math.floor((v / max) * 8))])).join("");
    return (
      "\n" + tr("── 本地统计（实际消耗，关掉对话不丢）──") + "\n" +
      trf("今日 ${0} · {1} tok ｜ 本周 ${2} ｜ 90天 ${3}",
        sum.today.toFixed(2), fmtTokens(sum.tokToday), sum.week.toFixed(2), sum.all.toFixed(2)) + "\n" +
      trf("近14天 {0} ｜ chat ${1} · 进化 ${2}", spark, sum.chat.toFixed(2), sum.evolve.toFixed(2))
    );
  } catch { return ""; }
}
let _usageGood = null; // 上一次成功拿到的限流数据；端点被限流时回显旧值并标 ⚠，别让百分比凭空消失
function renderUsage(el, d, staleWhy, local) {
  const parts = [];
  if (d.sub) parts.push(d.sub);
  if (d.fh && d.fh.utilization != null) parts.push(`⏰${fmtTimeShort(d.fh.resets_at)} ${Math.round(d.fh.utilization)}%`);
  if (d.sd && d.sd.utilization != null) parts.push(`7d ${Math.round(d.sd.utilization)}%`);
  el.textContent = (parts.join(" · ") || tr("用量")) + (staleWhy ? " ⚠" : "");
  el.title =
    (staleWhy ? staleWhy + "\n" + trf("以下为 {0} 的旧数据：", fmtTimeShort(d.at)) + "\n" : "") +
    `${tr("订阅：")}${d.sub || "-"}\n` +
    `${tr("5小时窗：")}${d.fh?.utilization ?? "-"}%  · ${tr("重置 ")}${fmtTime(d.fh?.resets_at)}\n` +
    `${tr("7天窗：")}${d.sd?.utilization ?? "-"}%  · ${tr("重置 ")}${fmtTime(d.sd?.resets_at)}\n` +
    `${tr("本会话花费：$")}${d.cost?.toFixed?.(4) ?? "-"}` +
    local;
}
async function loadUsage(force) {
  const el = $("usage");
  el.textContent = tr("用量…");
  // force=true 跳过主进程的用量缓存（手动点击 / 切账号后需立即拿最新值）；本地台账并行取
  const [u, local] = await Promise.all([
    window.api.getUsage(force ? { force: true } : undefined),
    costStatLines(),
  ]);
  // 用量端点本身被限流（429）时，rate_limits 里不是窗口数据而是个 error 对象
  const rlErr = u?.rate_limits?.error;
  if (!u || u.error || !u.rate_limits_available || !u.rate_limits || rlErr) {
    const why = u && u.error ? tr("用量不可用：") + u.error
      : rlErr ? tr("用量端点被限流，稍后自动恢复：") + (rlErr.message || "")
      : tr("当前会话无订阅用量信息（如用 API Key）");
    if (_usageGood) { renderUsage(el, _usageGood, why, local); return; }
    el.textContent = (u && u.subscription_type ? u.subscription_type.toUpperCase() : tr("用量 N/A")) + (rlErr ? " ⚠" : "");
    el.title = why + local;
    return;
  }
  _usageGood = {
    sub: (u.subscription_type || "").toUpperCase(),
    fh: u.rate_limits.five_hour,
    sd: u.rate_limits.seven_day,
    cost: u.session?.total_cost_usd,
    at: Date.now(),
  };
  renderUsage(el, _usageGood, null, local);
}
let _usageThrottle = 0;
function loadUsageThrottled() {
  const now = Date.now();
  if (now - _usageThrottle < 60000) return; // 与定时刷新同频，最多 60s 一次
  _usageThrottle = now;
  loadUsage();
}
$("usage").onclick = () => { _usageThrottle = Date.now(); loadUsage(true); };
loadUsage(); // 启动拉一次
// 每 60 秒刷新（30s 轮询曾触发用量端点 429 限流；用户要求放缓到 60s 一次）。
// 探测走控制通道不耗 token，仅子进程开销；窗口不可见时跳过。
if (window._loadUsageTimer) clearInterval(window._loadUsageTimer);
window._loadUsageTimer = setInterval(() => { if (!document.hidden) loadUsage(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadUsageThrottled(); }); // 恢复可见时立即刷一次（带节流防抖）

// ── 模型切换：顶栏下拉，写回 config 后下一轮 chat 即生效，与用量/费用联动控成本 ──
(async () => {
  const sel = $("modelSelect");
  if (!sel) return;
  try { sel.value = (await window.api.getModel()) || ""; } catch {}
  sel.onchange = async () => {
    const r = await window.api.setModel(sel.value);
    if (r && r.ok) {
      $("status").textContent = trf("已切换模型：{0}（下一轮对话生效）", sel.value || tr("默认"));
      loadUsage(true); // 顺带刷新用量/费用展示
      updateConvEstCost(); // 全局模型改变时同步更新预估
    }
  };
})();

// ── 模型切换：下拉选中即写回 config.json，下一轮对话生效（省 token：日常选 Sonnet）──
(async () => {
  const sel = $("modelSel");
  if (!sel) return;
  try { sel.value = (await window.api.getModel()) || ""; } catch {}
  sel.onchange = async () => {
    try { await window.api.setModel(sel.value); } catch {}
  };
})();

// ── 思考深度(effort)切换：顶栏下拉，写回 config 后下一轮 chat 即生效（省 token 主旋钮）──
(async () => {
  const sel = $("effortSel");
  if (!sel) return;
  try { sel.value = (await window.api.getEffort()) || ""; } catch {}
  sel.onchange = async () => {
    const r = await window.api.setEffort(sel.value);
    if (r && r.ok)
      $("status").textContent = trf("已切换思考深度：{0}（下一轮对话生效）", sel.value || tr("默认"));
  };
})();

// ── 打包：点 📦 弹三选一（完整备份 / 全量 / 给别人）→ 桌面 zip ──
async function doPack(mode, withCreds) {
  const label = { full: tr("全量(含依赖,零安装)"), backup: tr("完整备份(含历史)"), dist: tr("给别人(不含私有数据)") }[mode];
  $("status").textContent = trf("📦 {0} 打包中…", label);
  const r = await window.api.packAll(mode, { withCreds: !!withCreds });
  if (r && r.path) $("status").textContent = tr("✅ 已打包到桌面（Finder 已高亮）");
  else { $("status").textContent = ""; toast(tr("打包失败：") + "\n" + (r?.error || tr("未知")), "error"); }
  clearStatusLater(5000);
}
$("packBtn").onclick = (e) => {
  e.stopPropagation();
  const b = e.target.getBoundingClientRect();
  // 登录凭证（accounts.json/server-token.txt）默认不打包，勾选仅本次菜单有效，避免误分享泄露
  let packWithCreds = false;
  const openPackMenu = () =>
    showMenu(b.left, b.bottom, [
      { label: tr("📦 完整备份（配置+历史+git，无依赖）"), run: () => doPack("backup", packWithCreds) },
      { label: tr("💼 全量（含 node_modules，解压零安装）"), run: () => doPack("full", packWithCreds) },
      { label: tr("🎁 给别人（不含你的私有数据）"), run: () => doPack("dist") },
      { sep: true },
      {
        label: (packWithCreds ? "☑ " : "☐ ") + tr("包含登录凭证（账号/手机令牌）"),
        run: async () => {
          if (!packWithCreds) {
            if (await modalConfirm(tr("zip 将包含明文 OAuth 凭证与手机访问令牌，仅限自己迁移使用，切勿分享！\n确定包含？")))
              packWithCreds = true;
          } else packWithCreds = false;
          setTimeout(openPackMenu, 0); // 等点击冒泡到 document 关完菜单后再重开，刷新勾选态
        },
      },
    ]);
  openPackMenu();
};

// ── Claude 账号快捷切换 ───────────────────────────────────────
let _acctMenuToken = 0;
async function openAcctMenu(anchor) {
  const m = $("acctMenu");
  const token = ++_acctMenuToken;
  const { current, accounts } = await window.api.acctList();
  // 异步期间用户可能已点击空白关闭或再次触发，过期则放弃本次渲染，避免菜单被点关后自行弹回或重复绑定监听
  if (token !== _acctMenuToken) return;
  let html = `<div class="am-hd">${tr("CLAUDE 账号")}</div>`;
  if (!accounts.length) {
    html += `<div class="am-empty">${tr("暂无存档账号，先用下方按钮保存当前登录")}</div>`;
  } else {
    for (const a of accounts) {
      const cur = a.email === current;
      html += `<div class="am-acct${cur ? " cur" : ""}" data-email="${esc(a.email)}">
        <span class="am-tick">${cur ? "✓" : ""}</span>
        <span class="am-info"><div class="am-name">${esc(a.name || a.email)}</div><div class="am-email">${esc(a.email)}</div></span>
        <span class="am-del" data-del="${esc(a.email)}" title="${tr("删除")}">✕</span>
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
        // 旧对话仍持有上一个账号的 sessionId，切换后清空所有对话的 session，
        // 续聊时强制新建会话，杜绝多账号下的会话串用
        conversations.forEach((c) => { c.sessionId = null; c.inited = false; });
        persistConvs();
        if (r.warning) { $("status").textContent = "⚠️ " + r.warning; alert(r.warning); }
        else $("status").textContent = trf("✅ 已切换到 {0}", email);
        _usageThrottle = 0; loadUsage(true);
      } else {
        $("status").textContent = "";
        toast(tr("切换失败：") + (r?.error || tr("未知")), "error");
      }
      clearStatusLater(5000);
    };
  });
  m.querySelectorAll(".am-del").forEach((x) => {
    x.onclick = async (e) => {
      e.stopPropagation();
      if (!(await modalConfirm(trf("删除存档账号 {0}？", x.dataset.del)))) return;
      await window.api.acctDelete(x.dataset.del);
      openAcctMenu(anchor); // 重新渲染
    };
  });
  $("amSave").onclick = async () => {
    m.classList.remove("open");
    const r = await window.api.acctSaveCurrent();
    if (r && r.ok) $("status").textContent = trf("✅ 已保存账号 {0}", r.email);
    else toast(tr("保存失败：") + (r?.error || tr("未知")), "error");
    clearStatusLater(5000);
  };
}
$("acctBtn").onclick = (e) => {
  e.stopPropagation();
  if ($("acctMenu").classList.contains("open")) { _acctMenuToken++; $("acctMenu").classList.remove("open"); return; }
  openAcctMenu(e.currentTarget);
};
document.addEventListener("click", () => { _acctMenuToken++; $("acctMenu").classList.remove("open"); });
$("acctMenu").addEventListener("click", (e) => e.stopPropagation());

// ── 手机连接面板 ───────────────────────────────────────────
function renderMobile(info) {
  const running = info && info.running;
  const external = !!(running && info.external); // 引擎由计划任务常驻，App 内无需启停
  const mt = $("mobToggle");
  mt.textContent = running ? "⏹" : "▶";
  mt.disabled = external;
  mt.title = external
    ? tr("常驻服务由系统计划任务托管，无需在此启停")
    : (running ? tr("停止服务") : tr("启动服务"));
  $("mobState").textContent = running
    ? (external ? tr("运行中（常驻服务）") : tr("运行中"))
    : tr("未启动");
  $("mobConn").style.display = running && info.url ? "block" : "none";
  if (running && info.url) {
    $("mobUrl").textContent = info.url;
    $("mobLan").textContent = info.lanUrl ? tr("同一 Wi-Fi 可直连：") + info.lanUrl : "";
    // 本地 canvas 生成二维码：URL 含全权限令牌，绝不外发给第三方二维码服务
    const canvas = $("mobQr");
    canvas.width = canvas.height = 200;
    try { window.QRCanvas.draw(info.url, canvas); } catch (e) { console.error("QR draw:", e); }
  }
}
$("mobileBtn").onclick = async () => {
  $("mobileModal").classList.add("open");
  renderMobile(await window.api.mobileStatus());
};
$("mobClose").onclick = () => $("mobileModal").classList.remove("open");

// ── 设置面板：把 config.json 的行为项暴露为表单，保存即写回并下一轮生效 ──
async function renderCostChart7d() {
  const el = $("costChart7d");
  if (!el) return;
  try {
    const days = await window.api.costStats();
    const dayKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = Date.now();
    const series = [];
    for (let i = 6; i >= 0; i--) {
      const key = dayKey(new Date(now - i * 86400000));
      const rec = days?.[key];
      series.push({ key, cost: rec ? Object.values(rec).reduce((a, t) => a + t.cost, 0) : 0 });
    }
    const maxCost = Math.max(...series.map((s) => s.cost), 0.0001);
    const W = 220, H = 36, px = 6, py = 4;
    const pts = series.map((s, i) => ({
      x: px + i * (W - 2 * px) / 6,
      y: H - py - (s.cost / maxCost) * (H - 2 * py),
      cost: s.cost,
      key: s.key,
    }));
    const polyPts = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaD = `M${pts[0].x.toFixed(1)},${H} ` +
      pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
      ` L${pts[pts.length - 1].x.toFixed(1)},${H} Z`;
    const dots = pts.map((p) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${p.cost > 0 ? "#f0a040" : "#444"}">`+
      `<title>${p.key}: $${p.cost.toFixed(4)}</title></circle>`
    ).join("");
    el.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;overflow:visible">` +
      `<path d="${areaD}" fill="#f0a04018"/>` +
      `<polyline points="${polyPts}" fill="none" stroke="#f0a040" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
      dots + `</svg>` +
      `<div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-top:1px;padding:0 2px">` +
      series.map((s) => `<span title="${s.key}">${s.key.slice(5)}</span>`).join("") +
      `</div>`;
  } catch { if ($("costChart7d")) $("costChart7d").innerHTML = ""; }
}

$("settingsBtn").onclick = async () => {
  try {
    const c = await window.api.getConfig();
    $("setPrompt").value = c.systemPromptAppend || "";
    $("setPerm").value = c.permissionMode || "bypassPermissions";
    $("setLightModel").value = c.lightModel || "";
    $("setPlanModel").value = c.planModel || "";
    $("setBudget").value = c.dailyBudgetUsd ?? "";
    $("setMaxSpend").value = c.maxDailySpendUSD ?? "";
    $("setEvolveMaxTokens").value = c.evolveMaxTokens ?? "";
    $("setAutoRestart").checked = !!c.evolveAutoRestart;
  } catch {}
  $("setMsg").textContent = "";
  $("settingsModal").classList.add("open");
  renderCostChart7d();
};
$("setClose").onclick = () => $("settingsModal").classList.remove("open");
$("settingsModal").onclick = (e) => { if (e.target.id === "settingsModal") $("settingsModal").classList.remove("open"); };
$("setSave").onclick = async () => {
  const r = await window.api.setConfig({
    systemPromptAppend: $("setPrompt").value,
    permissionMode: $("setPerm").value,
    lightModel: $("setLightModel").value || null,
    planModel: $("setPlanModel").value || null,
    dailyBudgetUsd: parseFloat($("setBudget").value) > 0 ? parseFloat($("setBudget").value) : null,
    maxDailySpendUSD: parseFloat($("setMaxSpend").value) > 0 ? parseFloat($("setMaxSpend").value) : null,
    evolveMaxTokens: parseInt($("setEvolveMaxTokens").value) > 0 ? parseInt($("setEvolveMaxTokens").value) : null,
    evolveAutoRestart: $("setAutoRestart").checked,
  });
  if (r && r.ok) {
    $("setMsg").textContent = tr("✅ 已保存（下一轮对话生效）");
    setTimeout(() => $("settingsModal").classList.remove("open"), 600);
  } else {
    toast(tr("保存失败：") + (r?.error || tr("未知")), "error");
  }
};
$("historyBtn").onclick = openHistory;
$("histClose").onclick = closeHistory;
$("historyModal").onclick = (e) => { if (e.target.id === "historyModal") closeHistory(); };
$("histSearch").oninput = (e) => renderHistory(e.target.value, $("histCwdFilter").classList.contains("active"));
$("histCwdFilter").onclick = () => {
  $("histCwdFilter").classList.toggle("active");
  renderHistory($("histSearch").value || "", $("histCwdFilter").classList.contains("active"));
};
$("mobToggle").onclick = async () => {
  const cur = await window.api.mobileStatus();
  $("mobToggle").disabled = true;
  renderMobile(cur.running ? await window.api.mobileStop() : await window.api.mobileStart()); // disabled 状态由 renderMobile 决定
};
$("mobCopy").onclick = () => navigator.clipboard?.writeText($("mobUrl").textContent || "");
$("mobOpen").onclick = () => { const u = $("mobUrl").textContent; if (u) window.api.openExternal(u); };

// ── MCP 面板 ──────────────────────────────────────────────
async function renderMcp() {
  const { servers, raw, error } = await window.api.mcpList();
  const box = $("mcpList");
  box.innerHTML = "";
  if (!servers.length) {
    box.innerHTML = `<div class="mcp-empty">${tr("还没有配置 MCP，下方编辑 mcp.json 即可添加")}</div>`;
  }
  for (const s of servers) {
    const cls = !s.enabled ? "" : s.status === "connected" ? "ok" : s.status ? "fail" : "";
    const stat = !s.enabled ? tr("已停用") : s.status === "connected" ? tr("可用") : s.status ? tr("失败：") + esc(s.status) : tr("未加载");
    const row = document.createElement("div");
    row.className = "mcp-row";
    row.innerHTML =
      `<span class="mcp-dot ${cls}"></span>` +
      `<div class="mcp-main"><div class="mcp-name">${esc(s.name)} <span style="opacity:.5;font-size:11px">${stat}</span></div>` +
      `<div class="mcp-cmd">${esc(s.command)}</div></div>` +
      `<button class="mcp-toggle ${s.enabled ? "on" : ""}">${s.enabled ? tr("启用中") : tr("已停用")}</button>`;
    row.querySelector(".mcp-toggle").onclick = async () => {
      await window.api.mcpToggle(s.name, !s.enabled);
      renderMcp();
    };
    box.appendChild(row);
  }
  $("mcpRaw").value = error ? raw : (raw || '{\n  "mcpServers": {}\n}');
  $("mcpMsg").textContent = error ? tr("JSON 解析失败：") + error : "";
  $("mcpMsg").style.color = error ? "#d85a5a" : "var(--muted)";
}
$("mcpBtn").onclick = async () => { $("mcpModal").classList.add("open"); renderMcp(); };
$("mcpClose").onclick = () => $("mcpModal").classList.remove("open");
$("mcpModal").onclick = (e) => { if (e.target.id === "mcpModal") $("mcpModal").classList.remove("open"); };
$("mcpSave").onclick = async () => {
  const r = await window.api.mcpSave($("mcpRaw").value);
  $("mcpMsg").textContent = r.ok ? tr("已保存 · 新对话生效") : tr("保存失败：") + r.error;
  $("mcpMsg").style.color = r.ok ? "#3ad07a" : "#d85a5a";
  if (r.ok) renderMcp();
};
// 常用 server 模板：点选合并写入 mcp.json，免手写 JSON（复用 mcpSave 校验）
const MCP_TEMPLATES = [
  { name: "filesystem", desc: "本地文件读写", cfg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "{dir}"] },
    inputs: [{ key: "{dir}", label: "允许访问的目录", def: "C:\\" }] },
  { name: "github", desc: "GitHub 仓库 / issue / PR", cfg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "{token}" } },
    inputs: [{ key: "{token}", label: "GitHub Personal Access Token", def: "" }] },
  { name: "fetch", desc: "抓取网页转 Markdown（需已安装 uv）", cfg: { command: "uvx", args: ["mcp-server-fetch"] } },
  { name: "playwright", desc: "浏览器自动化与网页测试", cfg: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
  { name: "memory", desc: "知识图谱长期记忆", cfg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
  { name: "sequential-thinking", desc: "分步推理规划", cfg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] } },
  { name: "context7", desc: "最新库文档检索", cfg: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
];
// 当前 mcp.json 里已有的 server 名（以编辑框文本为准，解析失败按空算）
function mcpParsedNames() {
  try { return Object.keys(JSON.parse($("mcpRaw").value).mcpServers || {}); } catch { return []; }
}
// 把模板（占位符已替换）合并进 mcp.json 并保存；同名不覆盖
async function mcpAddFromTpl(tpl, values) {
  let json;
  try { json = JSON.parse($("mcpRaw").value || "{}"); } catch { json = {}; }
  if (!json.mcpServers) json.mcpServers = {};
  if (json.mcpServers[tpl.name]) {
    $("mcpMsg").textContent = tr("已存在同名 server，未覆盖");
    $("mcpMsg").style.color = "#d85a5a";
    return;
  }
  let cfgStr = JSON.stringify(tpl.cfg);
  for (const inp of tpl.inputs || []) cfgStr = cfgStr.replaceAll(inp.key, values[inp.key]);
  json.mcpServers[tpl.name] = JSON.parse(cfgStr);
  const r = await window.api.mcpSave(JSON.stringify(json, null, 2));
  $("mcpMsg").textContent = r.ok ? tr("已添加 · 新对话生效") : tr("保存失败：") + r.error;
  $("mcpMsg").style.color = r.ok ? "#3ad07a" : "#d85a5a";
  if (r.ok) { $("mcpTplPanel").classList.remove("open"); renderMcp(); }
}
// 模板列表；带占位符输入的模板点选后先展示填写表单
function renderMcpTpls() {
  const panel = $("mcpTplPanel");
  panel.innerHTML = "";
  const existing = mcpParsedNames();
  for (const tpl of MCP_TEMPLATES) {
    const added = existing.includes(tpl.name);
    const row = document.createElement("div");
    row.className = "mcp-tpl-row" + (added ? " added" : "");
    row.innerHTML = `<span class="mcp-tpl-name">${esc(tpl.name)}</span><span class="mcp-tpl-desc">${tr(tpl.desc)}${added ? " · " + tr("已添加") : ""}</span>`;
    if (!added) row.onclick = () => {
      if (!tpl.inputs) return mcpAddFromTpl(tpl, {});
      panel.innerHTML = "";
      const form = document.createElement("div");
      form.className = "mcp-tpl-form";
      const fields = tpl.inputs.map((inp) => {
        const lab = document.createElement("label");
        lab.textContent = `${tpl.name} · ${tr(inp.label)}`;
        const input = document.createElement("input");
        input.value = inp.def;
        input.placeholder = tr(inp.label);
        form.append(lab, input);
        return { inp, input };
      });
      const btns = document.createElement("div");
      btns.className = "btns";
      const cancel = document.createElement("button");
      cancel.textContent = tr("返回");
      cancel.onclick = renderMcpTpls;
      const ok = document.createElement("button");
      ok.className = "ok";
      ok.textContent = tr("添加");
      ok.onclick = () => {
        const values = {};
        for (const f of fields) {
          if (!f.input.value.trim()) return f.input.focus();
          values[f.inp.key] = f.input.value.trim();
        }
        mcpAddFromTpl(tpl, values);
      };
      btns.append(cancel, ok);
      form.appendChild(btns);
      panel.appendChild(form);
      fields[0].input.focus();
    };
    panel.appendChild(row);
  }
}
$("mcpAddTpl").onclick = () => {
  const panel = $("mcpTplPanel");
  if (panel.classList.toggle("open")) renderMcpTpls();
};
// 连接状态随对话初始化更新：面板开着就刷新一下圆点
window.api.on("mcp:status", () => { if ($("mcpModal").classList.contains("open")) renderMcp(); });

// ── 自进化面板 ─────────────────────────────────────────────
let evolveBusy = false;
let _autoCooldown = 0;
let _periodicTimer = null;
let _periodicGen = 0; // tick 改为 async 后，用代次使被 applyPeriodic 重启废弃的在途 tick 失效，避免双链路

// 进化日志会被流式逐块写入（每个 token 一次），多轮进化/周期自检持续累积。
// 不设上限时 <pre> 文本节点会无限增长，每次追加都要整段重排，最终拖垮渲染层
// —— 表现为输入框卡死、面板无响应。这里只保留尾部，按字符数封顶。
const EV_LOG_MAX = 60000;
function evLog(t) {
  const el = $("evLog");
  let s = el.textContent;
  s += (s ? "\n" : "") + t;
  if (s.length > EV_LOG_MAX) {
    // 截掉头部并补齐被切断的半行，保留可读的尾部
    s = "…\n" + s.slice(s.length - EV_LOG_MAX).replace(/^[^\n]*\n?/, "");
  }
  el.textContent = s;
  el.scrollTop = el.scrollHeight;
}
function setEvolveBusy(b) {
  evolveBusy = b;
  // 进化进行中：开始按钮变为“调整方向”，仍可向当前会话追加 update 消息
  const run = $("evRun");
  run.textContent = b ? "↳" : "▶";
  run.title = b ? tr("向进行中的进化追加方向调整（Ctrl+Enter）") : tr("开始");
  $("evStop").disabled = !b;
  updateEvolveIndicator();
}
// 全局可见的进化状态指示：工具栏 🧬 按钮、收起态把手、面板头部徽标都随状态联动，
// 这样即使面板收起/关闭，也能一眼看出系统此刻是否在进化、还是开了自动模式在待命。
function updateEvolveIndicator() {
  const btn = $("evolveBtn"), restore = $("evRestore"), st = $("evStatus");
  const armed = $("evContinuous")?.checked || $("evAuto")?.checked || $("evPeriodic")?.checked;
  if (btn) { btn.classList.toggle("evolving", evolveBusy); btn.classList.toggle("armed", !evolveBusy && !!armed); }
  if (restore) restore.classList.toggle("evolving", evolveBusy);
  if (st) {
    st.className = evolveBusy ? "busy" : armed ? "armed" : "";
    st.textContent = evolveBusy ? tr("● 进化中…") : armed ? tr("○ 待命中") : tr("空闲");
    st.title = tr("点击查看完整状态自检（是否在找优化点 / 是否定时 / 找到后是否修复并提交）");
  }
  if (btn) btn.title = "🧬 " + (evolveBusy ? tr("正在进化（修改源码中）") : armed ? tr("自动模式已开启，空闲时会自动进化") : tr("自进化：让 App 改自己的源码（自动回滚保护）"));
}
// 状态自检：直接回答“现在启动了吗 / 在自我进化吗 / 在找优化点吗 / 定时吗 / 找到后修复并提交吗”。
// 点状态徽标即把这份摘要打到进化日志里——把分散在各开关/记录里的状态汇成一句人话。
async function evolveStatusReport() {
  const cont = $("evContinuous")?.checked, auto = $("evAuto")?.checked, peri = $("evPeriodic")?.checked;
  const ivMin = Math.round((+$("evInterval")?.value || 0) / 60000);
  const backlog = (await window.api.getEvolveBacklog()) || [];
  const open = backlog.filter((x) => x.status === "open" || x.status === "doing").length;
  const hist = (await window.api.getEvolveHistory()) || [];
  const last = hist[0];
  const L = [];
  L.push(evolveBusy ? tr("● 正在进化：此刻在修改源码")
    : (cont || auto || peri) ? tr("○ 已启动 · 自动模式待命中（空闲到点会自动进化）")
    : tr("· 已启动 · 手动模式（不会自动进化，需手动触发）"));
  L.push(tr("· 找优化点：") + (cont ? tr("是——持续进化已开，清单空了自动巡检补充") : tr("否——需手动点 🔎 巡检")));
  L.push(tr("· 定时启动：") + (peri ? trf("是——每 {0} 分钟自检一次", ivMin) : tr("否")) + (auto ? tr("；并在出现运行时错误时自动修复") : ""));
  L.push(tr("· 找到后处理：自动改源码 → git 检查点 + 语法校验 → 失败自动回滚，成功则本地 git 提交（不推送）"));
  L.push(trf("· 优化清单待办 {0} 项 · 历史进化 {1} 次", open, hist.length));
  if (last) L.push(trf("· 最近一次：{0} — {1}", (EVOLVE_STATUS[last.status]?.label || last.status), (last.requirement || "").split("\n")[0].slice(0, 40)));
  return L.join("\n");
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
    toast(tr("附件保存失败：") + e, "error");
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
setupDropZone($("evReq"), addEvolveFile);

async function runEvolve(requirement) {
  if (evolveBusy || !requirement.trim()) return;
  $("evolveModal").classList.add("open");
  syncEvDock();
  setEvolveBusy(true);
  const attachments = evolveAttachments.slice();
  // 读取限定文件 glob，非空时注入 system 约束到需求开头
  const scopeGlob = ($("evScope")?.value || "").trim();
  const scopeNote = scopeGlob ? `【限定文件】只允许修改匹配以下 glob 的文件：${scopeGlob}\n\n` : "";
  const effectiveReq = scopeNote + requirement;
  // 每个问题都是独立的：开跑即清空上一个问题的日志与附件残留（收口到这里，
  // 覆盖手动/清单/持续进化/定期自检/自动修错所有入口）。模型侧本就是每次全新
  // 会话（query 不带 resume），这里把界面「会话」也对齐成一题一清。
  $("evLog").textContent = "";
  $("evUsageLine").textContent = "";
  $("evUsageLine").classList.remove("visible");
  evolveAttachments = [];
  renderAttachments();
  evLog("▶ " + requirement + (scopeGlob ? "\n🔒 限定文件：" + scopeGlob : "") + (attachments.length ? "\n📎 " + attachments.map((p) => p.split(/[\\/]/).pop()).join(", ") : ""));
  const _evolveMaxTokensVal = parseInt($("setEvolveMaxTokens")?.value);
  const r = await window.api.evolve({ requirement: effectiveReq, attachments, projectMemory: getProjectMemory(), ...(_evolveMaxTokensVal > 0 ? { evolveMaxTokens: _evolveMaxTokensVal } : {}) });
  // evolve:done 事件通常会兜底设状态；但无改动等分支不发该事件，这里据返回值兜底，
  // 避免忙状态卡死（也让持续进化能据返回值推进下一条）。relaunch 会重启，无需处理。
  if (!(r && r.relaunch)) setEvolveBusy(false);
  return r;
}

// 停靠 / 隐藏 自进化面板（记忆状态，停靠后仿 VS Code 占据真实布局空间）
// 恢复上次拖动保存的停靠宽度
{
  const w = parseInt(localStorage.getItem("evolveDockW") || "0", 10);
  if (w >= 280) document.documentElement.style.setProperty("--ev-dock-w", w + "px");
}
// 仅当「停靠且打开且未隐藏」时，才给 body 预留右侧空间
function syncEvDock() {
  const m = $("evolveModal");
  const reserve = m.classList.contains("docked") && m.classList.contains("open") && !m.classList.contains("collapsed");
  document.body.classList.toggle("ev-docked", reserve);
}
if (localStorage.getItem("evolveDocked") === "1") $("evolveModal").classList.add("docked");
$("evolveBtn").onclick = () => {
  const m = $("evolveModal");
  m.classList.add("open");
  m.classList.remove("collapsed");
  syncEvDock();
  loadIssues();
  loadBacklog();
  loadEvolveHistory();
};
$("evClose").onclick = () => { $("evolveModal").classList.remove("open", "collapsed"); syncEvDock(); };
$("evDock").onclick = () => {
  const docked = $("evolveModal").classList.toggle("docked");
  $("evolveModal").classList.remove("collapsed");
  safeLocalSet("evolveDocked", docked ? "1" : "0");
  syncEvDock();
};
$("evCollapse").onclick = () => {
  // 隐藏需停靠态：未停靠时先切到停靠
  $("evolveModal").classList.add("docked");
  safeLocalSet("evolveDocked", "1");
  $("evolveModal").classList.add("collapsed");
  syncEvDock();
};
$("evRestore").onclick = () => { $("evolveModal").classList.remove("collapsed"); syncEvDock(); };
// 拖动停靠面板左缘调整宽度
(() => {
  const rz = $("evResizer");
  if (!rz) return;
  rz.addEventListener("mousedown", (e) => {
    e.preventDefault();
    rz.classList.add("drag");
    const move = (ev) => {
      const w = Math.max(280, Math.min(window.innerWidth * 0.8, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty("--ev-dock-w", w + "px");
    };
    const up = () => {
      rz.classList.remove("drag");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--ev-dock-w").trim();
      safeLocalSet("evolveDockW", parseInt(cur, 10) || 440);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
})();
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
// 点状态徽标 => 打开面板并把状态自检打到日志，直接回答“现在是否在自我进化”
$("evStatus").onclick = async () => {
  const m = $("evolveModal");
  m.classList.add("open");
  m.classList.remove("collapsed");
  syncEvDock();
  evLog("──────────\n📊 " + tr("状态自检") + "\n" + (await evolveStatusReport()));
};

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

// 优化清单：系统自己巡检源码、给自己提出的待办需求；可逐条解决，也可“持续进化”自动跑通
async function loadBacklog() {
  const list = (await window.api.getEvolveBacklog()) || [];
  $("evBacklogN").textContent = list.filter((x) => x.status === "open" || x.status === "doing").length;
  const el = $("evBacklog");
  el.innerHTML = "";
  if (!list.length) {
    const e = document.createElement("div");
    e.className = "bk-empty";
    e.textContent = tr("点 🔎 巡检源码，自动找出可优化点；或勾选「持续进化」让它不停地自我改进");
    el.appendChild(e);
    return;
  }
  list.slice(0, 40).forEach((it) => {
    const d = document.createElement("div");
    const stCls = it.status === "done" ? " done" : it.status === "doing" ? " doing" : it.status === "skipped" ? " skipped" : "";
    d.className = "bk sev-" + (it.severity || "medium") + stCls;
    d.innerHTML =
      `<span class="bk-sev"></span><span class="bk-title"></span>` +
      `<span class="bk-act bk-up" title="上移">↑</span>` +
      `<span class="bk-act bk-dn" title="下移">↓</span>` +
      `<span class="bk-act bk-run" data-i18n-title="解决这一条" title="解决这一条">▶</span>` +
      `<span class="bk-act bk-del" data-i18n-title="移除" title="移除">✕</span>`;
    d.querySelector(".bk-title").textContent = it.title;
    d.title = it.requirement + (it.status && it.status !== "open" ? "\n[" + it.status + "]" : "");
    d.querySelector(".bk-up").onclick = async () => { await window.api.evolveBacklogMove(it.id, "up"); loadBacklog(); };
    d.querySelector(".bk-dn").onclick = async () => { await window.api.evolveBacklogMove(it.id, "down"); loadBacklog(); };
    d.querySelector(".bk-run").onclick = () => solveBacklogItem(it);
    d.querySelector(".bk-del").onclick = async () => { await window.api.removeEvolveBacklog(it.id); loadBacklog(); };
    el.appendChild(d);
  });
}
// 解决一条优化项：标记 doing → 进化 → 据结果标记 done/skipped
async function solveBacklogItem(it) {
  if (evolveBusy) return;
  // 防误点重复消费：已在进行或已完成的条目再点，先确认——一次进化是完整 agent 会话，
  // 重跑同一条等于白烧一遍 token（曾因重复点击把同一需求实现两遍）
  if (it.status === "doing" || it.status === "done") {
    const ok = await modalConfirm(trf("「{0}」已{1}，确定要重新进化一次吗？（会重新消耗 token）",
      it.title, it.status === "done" ? tr("完成") : tr("在进行中")));
    if (!ok) return;
  }
  await window.api.updateEvolveBacklog(it.id, { status: "doing" });
  loadBacklog();
  const r = await runEvolve(it.requirement);
  const solved = r && !r.error && !r.stopped;
  await window.api.updateEvolveBacklog(it.id, { status: solved ? "done" : "skipped" });
  loadBacklog();
  // 自动连续执行：成功后自动取下一条 open 任务
  if (solved && $("evBatchRun")?.checked) {
    const list = (await window.api.getEvolveBacklog()) || [];
    const next = pickNextBacklog(list);
    if (next) {
      evLog(tr("⏭ 自动连续执行：接着解决「") + next.title + "」");
      setTimeout(() => solveBacklogItem(next), 2000);
    } else {
      evLog(tr("✅ 自动连续执行：所有任务已完成"));
    }
  }
  return solved;
}
$("evAuditBtn").onclick = async () => {
  $("evolveModal").classList.add("open");
  syncEvDock();
  await window.api.evolveAudit();
  loadBacklog();
};
$("evClearBacklog").onclick = async () => { await window.api.clearEvolveBacklog(); loadBacklog(); };
window.api.on("evolve:backlog", () => loadBacklog());

// 持续进化：空闲时自动取一条优化项解决；清单空了就巡检补充——形成不停的自我改进循环
// 取下一条时按 severity 优先（high → medium → low），同级按入清单顺序（id 升序），
// 让巡检/联网采集到的高优先级需求先被实现。
const _SEV_RANK = { high: 0, medium: 1, low: 2 };
const pickNextBacklog = (list) =>
  (list || [])
    .filter((x) => x.status === "open")
    .sort((a, b) => (_SEV_RANK[a.severity] ?? 1) - (_SEV_RANK[b.severity] ?? 1) || (a.id || 0) - (b.id || 0))[0];
let _continuousTimer = null;
// 代次标记：每次 applyContinuous 自增，await 期间被重启的旧循环代次会失效，确保任意时刻只有一条循环在跑
let _continuousGen = 0;
// ── 配额闸门：所有「自动触发」的进化（持续进化/定期自检/自动修错）跑之前先看订阅 5 小时窗 ──
// 用量 ≥ 阈值就暂停到重置时间。进化用的是与对话相同的主力模型，无人值守地连跑会在
// 几十分钟内抽干整个配额窗（2026-06-12 实测 38 分钟 15 轮耗尽），把对话也一起卡死。
// 手动点「开始」的进化不受限——用户自己决定花不花。
const QUOTA_PAUSE_PCT = 85;
async function quotaGate() {
  try {
    const u = await window.api.getUsage();
    const fh = u && u.rate_limits_available && u.rate_limits && u.rate_limits.five_hour;
    if (!fh || fh.utilization == null || fh.utilization < QUOTA_PAUSE_PCT) return 0;
    const untilReset = fh.resets_at ? new Date(fh.resets_at).getTime() - Date.now() : 0;
    return Math.max(untilReset, 600000); // 重置时间拿不到/已过 => 至少停 10 分钟再探
  } catch { return 0; } // 探针失败（如 API Key 无订阅信息）=> 不拦
}
async function continuousTick(gen) {
  if (gen !== _continuousGen || !$("evContinuous").checked) return;
  if (evolveBusy) { _continuousTimer = setTimeout(() => continuousTick(gen), 10000); return; }
  const wait = await quotaGate();
  if (gen !== _continuousGen) return;
  if (wait > 0) {
    evLog(trf("⏸ 订阅 5 小时窗用量已达 {0}%，持续进化暂停 {1} 分钟（配额留给对话）", QUOTA_PAUSE_PCT, Math.round(wait / 60000)));
    if ($("evContinuous").checked) _continuousTimer = setTimeout(() => continuousTick(gen), wait);
    return;
  }
  let list = (await window.api.getEvolveBacklog()) || [];
  if (gen !== _continuousGen) return; // await 期间循环被重启，本代退出
  let next = pickNextBacklog(list);
  if (!next) {
    evLog(tr("🔄 持续进化：清单已空，巡检源码 + 联网采集需求补充优化点…"));
    await window.api.evolveAudit();
    if (gen !== _continuousGen) return;
    list = (await window.api.getEvolveBacklog()) || [];
    if (gen !== _continuousGen) return;
    next = pickNextBacklog(list);
    if (!next) { // 巡检也没产出 => 长间隔回退再试。一次巡检是整个 agent 会话（含联网调研），
      // 短间隔重试等于每分钟全价重跑一遍；半小时后源码/外部信息才可能有新变化
      evLog(tr("🔄 持续进化：巡检无产出，30 分钟后再试"));
      if ($("evContinuous").checked) _continuousTimer = setTimeout(() => continuousTick(gen), 1800000);
      return;
    }
  }
  await solveBacklogItem(next);
  if (gen !== _continuousGen) return;
  if ($("evContinuous").checked) _continuousTimer = setTimeout(() => continuousTick(gen), 6000);
}
function applyContinuous(initialDelay) {
  clearTimeout(_continuousTimer);
  const gen = ++_continuousGen; // 自增代次，使所有在途的旧循环失效
  try { localStorage.setItem("claudeTools.evContinuous", $("evContinuous").checked ? "1" : ""); } catch {}
  if ($("evContinuous").checked) {
    evLog(tr("🧬 持续进化已开启：自动巡检并逐条解决优化点"));
    _continuousTimer = setTimeout(() => continuousTick(gen), initialDelay || 3000);
  }
}
$("evContinuous").onchange = () => { applyContinuous(); updateEvolveIndicator(); };
$("evBatchRun").onchange = () => { try { localStorage.setItem("claudeTools.evBatchRun", $("evBatchRun").checked ? "1" : ""); } catch {} };

// ── 每日预算超支提醒：主进程 recordCost 纯本地判断，当日首次超阈值推送一次 ──
// toast+系统通知止损，用量标红；若持续进化开着则自动暂停（无人值守循环正是跑飞烧钱的高危场景）
window.api.on("budget:exceeded", ({ spent, budget }) => {
  const msg = trf("⚠️ 今日费用 ${0} 已超预算 ${1}", spent.toFixed(2), budget);
  toast(msg, "error");
  try { new Notification(tr("每日预算超支"), { body: msg }); } catch {}
  $("usage").classList.add("over-budget");
  if ($("evContinuous").checked) {
    $("evContinuous").checked = false;
    applyContinuous(); // 代次自增使在途循环失效
    evLog(msg + tr("，持续进化已自动暂停（设置面板可调整预算）"));
    updateEvolveIndicator();
  }
});

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
    // 仅成功落地的进化才有可查看的持久 diff（已回滚/无改动的不显示）
    const canDiff = h.checkpoint && (h.status === "applied" || h.status === "relaunch");
    d.innerHTML =
      `<div class="evh-top"><span class="evh-badge">${tr(st.label)}</span>` +
      `<span class="evh-req"></span>` +
      (canDiff ? `<span class="evh-diff" data-i18n-title="查看本次改动的代码 diff" title="查看本次改动的代码 diff">🔍</span>` : "") +
      `<span class="evh-time"></span></div>` +
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
    if (canDiff) {
      d.querySelector(".evh-diff").onclick = (e) => { e.stopPropagation(); showEvolveDiff(h, req); };
    }
    el.appendChild(d);
  });
}
$("evClearHist").onclick = async () => { await window.api.clearEvolveHistory(); loadEvolveHistory(); };

// 查看某次进化实际改了哪些代码：拉取 git diff 并按行高亮展示
function renderDiffLines(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split("\n").map((line) => {
    let cls = "";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "d-file";
    else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("rename ")) cls = "d-file";
    else if (line.startsWith("@@")) cls = "d-hunk";
    else if (line.startsWith("+")) cls = "d-add";
    else if (line.startsWith("-")) cls = "d-del";
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
  }).join("\n");
}
// 把整段 diff 按文件拆分，返回 [{filePath, rawDiff}]
function parseDiffByFile(text) {
  const groups = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (cur) groups.push(cur);
      // 从 "diff --git a/foo b/foo" 中提取文件路径（取 b/ 部分）
      const m = line.match(/^diff --git a\/.+ b\/(.+)$/);
      cur = { filePath: m ? m[1] : line, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}
let _diffCheckpoint = null; // 当前弹窗对应的 checkpoint（供撤销按钮使用）
async function showEvolveDiff(h, req) {
  const modal = $("evDiffModal");
  _diffCheckpoint = h.checkpoint || null;
  $("evDiffTitle").textContent = "🔍 " + tr("查看改动") + (req ? "：" + req : "");
  $("evDiffStat").textContent = "";
  $("evDiffBody").textContent = tr("加载中…");
  modal.classList.add("open");
  const r = await window.api.evolveDiff({ checkpoint: h.checkpoint, commit: h.commit });
  if (!r || r.error) { $("evDiffBody").textContent = tr("✖ 无法获取改动：") + ((r && r.error) || "?"); return; }
  if (r.empty || !r.diff) { $("evDiffBody").textContent = tr("（本次未产生代码改动）"); return; }
  if (r.stat) $("evDiffStat").textContent = r.stat.trim();
  const groups = parseDiffByFile(r.diff);
  if (groups.length <= 1) {
    // 单文件或无法解析时退化为整体渲染
    $("evDiffBody").innerHTML = renderDiffLines(r.diff);
    return;
  }
  const body = $("evDiffBody");
  body.innerHTML = "";
  body.style.whiteSpace = "normal";
  for (const g of groups) {
    const div = document.createElement("div");
    div.className = "ev-file-group";
    const hdr = document.createElement("div");
    hdr.className = "ev-file-header";
    const nm = document.createElement("span");
    nm.className = "ev-file-name";
    nm.textContent = g.filePath;
    const btn = document.createElement("button");
    btn.className = "ev-file-revert";
    btn.textContent = tr("↩ 撤销此文件");
    btn.title = tr("把此文件恢复到本次进化前的状态");
    btn.onclick = async () => {
      if (!_diffCheckpoint) { alert(tr("无检查点，无法撤销")); return; }
      btn.disabled = true;
      btn.textContent = tr("撤销中…");
      const res = await window.api.evolveRevertFile({ checkpoint: _diffCheckpoint, filePath: g.filePath });
      if (res && res.ok) {
        btn.textContent = tr("✓ 已撤销");
        div.style.opacity = "0.45";
      } else {
        btn.disabled = false;
        btn.textContent = tr("↩ 撤销此文件");
        alert(tr("撤销失败：") + (res && res.error ? res.error : "?"));
      }
    };
    hdr.appendChild(nm);
    hdr.appendChild(btn);
    const pre = document.createElement("pre");
    pre.className = "ev-file-patch";
    pre.innerHTML = renderDiffLines(g.lines.join("\n"));
    div.appendChild(hdr);
    div.appendChild(pre);
    body.appendChild(div);
  }
}
$("evDiffClose").onclick = () => $("evDiffModal").classList.remove("open");
$("evDiffModal").onclick = (e) => { if (e.target.id === "evDiffModal") $("evDiffModal").classList.remove("open"); };

// 进化事件
window.api.on("evolve:log", (t) => evLog(t));
window.api.on("evolve:usage", (u) => {
  const total = (u.input || 0) + (u.output || 0);
  const costStr = u.cost > 0 ? ` ≈ $${u.cost.toFixed(4)}` : "";
  $("evUsageLine").textContent = `已用 ${total.toLocaleString()} token${costStr}（input ${(u.input||0).toLocaleString()} + output ${(u.output||0).toLocaleString()}）`;
  $("evUsageLine").classList.add("visible");
});
window.api.on("evolve:done", (info) => {
  setEvolveBusy(false);
  if (info?.error) evLog(tr("✖ 失败：") + info.error);
  else if (info?.stopped) evLog(tr("⤺ 已停止并回滚"));
  else if (info?.noChange) evLog(tr("（无改动）"));
  else if (info?.relaunch) evLog(tr("✔ 已应用，正在重启…"));
  else if (info?.deferred) evLog(tr("✔ 已提交（下次重启/重载生效，不打断进化）"));
  else evLog(tr("✔ 已应用并重载"));
  loadEvolveHistory();
});
window.api.on("evolve:rolledback", (m) => {
  $("evolveModal").classList.add("open");
  syncEvDock();
  evLog(tr("⚠️ 上次进化导致启动异常，已自动回滚到 ") + String(m.sha || "").slice(0, 7));
});
window.api.on("issues:update", () => {
  loadIssues();
  // 全自动修复：有新错误且开启了开关、当前空闲、过了冷却、配额未触顶 => 自动进化修复最新错误
  if ($("evAuto").checked && !evolveBusy && Date.now() - _autoCooldown > 90000) {
    _autoCooldown = Date.now();
    quotaGate().then(async (wait) => {
      if (wait > 0) { evLog(tr("⏸ 配额逼近上限，跳过本次自动修错")); return; }
      const list = await window.api.getIssues();
      if (list && list[0]) runEvolve("修复这个运行时错误（务必先定位根因再改）：\n" + list[0].message);
    });
  }
});

// 定期自检
// 用「记录上次运行时刻 + 自重排的 setTimeout」代替裸 setInterval：
// 进化循环会频繁重载/重启，裸 setInterval 每次都从零重新计时（甚至一直被重置而再不触发）。
// 这里据 evLastRun 补齐剩余间隔，重启后到点（或已逾期）即续跑，让循环不被打断。
function applyPeriodic() {
  clearTimeout(_periodicTimer);
  const pgen = ++_periodicGen; // 废弃所有在途的旧 tick
  if ($("evPeriodic").checked) {
    // 间隔被清空/填非法值时 +value 会是 NaN 或过小值，setTimeout 会按 0 处理导致循环被立即反复触发。
    // 这里兜底为默认 30 分钟，并 clamp 到 60 秒下限。
    let ms = +$("evInterval").value;
    if (!Number.isFinite(ms) || ms <= 0) ms = 1800000;
    ms = Math.max(60000, ms);
    const tick = async () => {
      if (pgen !== _periodicGen) return;
      // 忙则稍后再试，别因为撞上一轮就把这一轮整个跳过
      if (evolveBusy) { _periodicTimer = setTimeout(tick, 15000); return; }
      const wait = await quotaGate();
      if (pgen !== _periodicGen || !$("evPeriodic").checked) return; // await 期间被重启/关掉
      if (wait > 0) {
        evLog(trf("⏸ 配额逼近上限，定期自检推迟 {0} 分钟", Math.round(wait / 60000)));
        _periodicTimer = setTimeout(tick, wait);
        return;
      }
      try { localStorage.setItem("claudeTools.evLastRun", String(Date.now())); } catch {}
      runEvolve("审视你自己的源码，找出一个明确的 bug、隐患或可改进点并修复（只改一处、保持稳定）。");
      _periodicTimer = setTimeout(tick, ms);
    };
    let last = 0;
    try { last = +localStorage.getItem("claudeTools.evLastRun") || 0; } catch {}
    const remaining = last ? Math.max(0, ms - (Date.now() - last)) : ms;
    // 逾期则留一点启动稳定时间（避开启动自检/回滚抢跑），否则按剩余间隔续跑
    _periodicTimer = setTimeout(tick, last ? Math.max(8000, remaining) : ms);
  }
  try {
    localStorage.setItem("claudeTools.evAuto", $("evAuto").checked ? "1" : "");
    localStorage.setItem("claudeTools.evPeriodic", $("evPeriodic").checked ? "1" : "");
    localStorage.setItem("claudeTools.evInterval", $("evInterval").value);
  } catch {}
}
$("evAuto").onchange = () => { applyPeriodic(); updateEvolveIndicator(); };
$("evPeriodic").onchange = () => { applyPeriodic(); updateEvolveIndicator(); };
$("evInterval").onchange = applyPeriodic;
// 恢复开关
try {
  if (localStorage.getItem("claudeTools.evAuto")) $("evAuto").checked = true;
  if (localStorage.getItem("claudeTools.evPeriodic")) $("evPeriodic").checked = true;
  const iv = localStorage.getItem("claudeTools.evInterval");
  if (iv) $("evInterval").value = iv;
  if (localStorage.getItem("claudeTools.evContinuous")) {
    $("evContinuous").checked = true;
    applyContinuous(15000); // 启动后稍等再续跑，避开启动自检/回滚抢跑
  }
  if (localStorage.getItem("claudeTools.evBatchRun")) $("evBatchRun").checked = true;
} catch {}
applyPeriodic();
updateEvolveIndicator();
loadIssues();
loadBacklog();
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
    $("sidebar").classList.toggle("mem-mode", tab.dataset.view === "mem");
  };
});

// ── 项目记忆：per-workdir 存储，key = claudeTools.projectMemory.<folder> ──
function memKey() {
  return "claudeTools.projectMemory." + (currentFolder || "__global__");
}
function getProjectMemory() {
  return localStorage.getItem(memKey()) || "";
}
function appendToProjectMemory(text) {
  if (!text) return;
  const ta = $("projectMemory");
  const existing = ta.value.trim();
  ta.value = existing ? existing + "\n\n" + text.trim() : text.trim();
  safeLocalSet(memKey(), ta.value);
  $("memSaveHint").textContent = "✓ 已保存";
  setTimeout(() => { $("memSaveHint").textContent = ""; }, 1500);
  // 展开记忆面板让用户看到结果
  $("sidebar").classList.remove("collapsed");
  $("sidebar").classList.remove("req-mode");
  $("sidebar").classList.add("mem-mode");
}
function loadProjectMemoryUI() {
  $("projectMemory").value = getProjectMemory();
}
{
  const ta = $("projectMemory");
  ta.value = getProjectMemory();
  let saveTimer;
  ta.oninput = () => {
    clearTimeout(saveTimer);
    $("memSaveHint").textContent = "";
    saveTimer = setTimeout(() => {
      safeLocalSet(memKey(), ta.value);
      $("memSaveHint").textContent = "✓ 已保存";
      setTimeout(() => { $("memSaveHint").textContent = ""; }, 1500);
    }, 600);
  };
}

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
  const rs = $("reqStart");
  rs.textContent = reqRunning ? "⏳" : "▶";
  rs.title = reqRunning ? tr("⏳ 处理中…") : tr("开始处理");
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
          (a.path && (a.type || "").startsWith("image/") ? `<img src="${fileUrl(a.path)}">` : a.dataUrl ? `<img src="${a.dataUrl}">` : `📎`) +
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
    const canRetry = r.status === "done" || r.status === "failed";
    el.innerHTML =
      `<span class="req-ic">${ic}</span>` +
      `<div class="req-text">${esc(r.text)}${attsHtml}${linksHtml}</div>` +
      (canRetry ? `<span class="req-retry" title="${tr("重新执行")}">↻</span>` : "") +
      `<span class="req-del" title="${tr("删除")}">×</span>`;
    const retryEl = el.querySelector(".req-retry");
    if (retryEl) retryEl.onclick = (e) => {
      e.stopPropagation();
      r.status = "pending"; // 重新排队；运行中会自动衔接，否则点「开始处理」
      renderReqs();
      persistReqs();
      if (reqRunning) pumpReqs();
    };
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
    safeLocalSet("claudeTools.reqMiniCollapsed", reqMiniCollapsed ? "1" : "0");
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
    atts: reqPendingAtts.map(({ dataUrl, ...a }) => a), // dataUrl 仅录入预览用，不进 localStorage
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
async function addReqLink() {
  const raw = ((await modalPrompt(tr("粘贴链接（Jira ticket / Confluence 文档 / 任意网址）："))) || "").trim();
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
    toast(tr("附件保存失败：") + e, "error");
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
setupDropZone(document.querySelector(".req-inputbar"), addReqAttachment);
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
// 停靠后的文档预览宽度（拖动右缘，仿 VS Code 编辑器列）
makeResizer(
  $("viewerResizer"), "x",
  () => $("viewer").getBoundingClientRect().width,
  (v) => document.documentElement.style.setProperty("--view-dock-w", v + "px"),
  320, () => innerWidth - $("sidebar").getBoundingClientRect().width - 360,
  "viewerDockW"
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

// ── 常用 skill 快捷按钮 ─────────────────────────────────────
// 点一下即把对应指令填入输入框并直接发送，省去手敲斜杠命令。
// 列表存于 localStorage，可通过「＋」新增、右键编辑/删除，按个人工作流自由组装。
const DEFAULT_QUICK_SKILLS = [
  { icon: "🚀", label: "推送代码", prompt: "/git-sync" },
  { icon: "🔍", label: "Copilot Review", prompt: "/code-review" },
  { icon: "🧪", label: "运行测试", prompt: "运行本项目的测试用例，并把结果汇报给我" },
  { icon: "🔀", label: "建 PR", prompt: "/pr" },
  { icon: "🗺", label: "生成代码地图", prompt: "action:codemap" },
];
let QUICK_SKILLS;
try {
  const saved = JSON.parse(localStorage.getItem("claudeTools.quickSkills") || "null");
  QUICK_SKILLS = Array.isArray(saved) ? saved : DEFAULT_QUICK_SKILLS.slice();
} catch {
  QUICK_SKILLS = DEFAULT_QUICK_SKILLS.slice();
}
// 老用户的列表存在 localStorage 里不含新内置项：补发一次（之后删掉不会复活）
if (!localStorage.getItem("claudeTools.quickSkills.codemapSeeded")) {
  if (!QUICK_SKILLS.some((q) => q.prompt === "action:codemap"))
    QUICK_SKILLS.push({ icon: "🗺", label: "生成代码地图", prompt: "action:codemap" });
  try { localStorage.setItem("claudeTools.quickSkills.codemapSeeded", "1"); } catch {}
  persistQuickSkills();
}
// 执行快捷技能：action: 开头的是内置动作，其余作为 prompt 发起对话
// insertOnly=true 时仅填入输入框（Shift+点击 / 命令面板 Shift+↵），让用户追加上下文后再手动发送
function runQuickSkill(q, insertOnly = false) {
  if (q.prompt === "action:codemap") { if (!insertOnly) genCodemap(); return; }
  $("input").value = q.prompt;
  $("input").focus();
  $("input").dispatchEvent(new Event("input"));
  if (!insertOnly) send(true);
}
function persistQuickSkills() {
  try { localStorage.setItem("claudeTools.quickSkills", JSON.stringify(QUICK_SKILLS)); } catch {}
}
// idx>=0 为编辑现有项；idx=-1 为新增。编辑时清空「名称」与「命令」即删除该项。
async function editQuickSkill(idx) {
  const cur = idx >= 0 ? QUICK_SKILLS[idx] : { icon: "", label: "", prompt: "" };
  const icon = await modalPrompt(tr("图标（emoji，可留空）："), cur.icon);
  if (icon === null) return;
  const label = await modalPrompt(tr("名称："), cur.label);
  if (label === null) return;
  const p = await modalPrompt(tr("要发送的 prompt / 斜杠命令："), cur.prompt);
  if (p === null) return;
  if (!label.trim() && !p.trim()) {
    if (idx >= 0) { QUICK_SKILLS.splice(idx, 1); persistQuickSkills(); renderQuickbar(); }
    return; // 新增时全空则忽略
  }
  const item = { icon: icon.trim(), label: label.trim(), prompt: p.trim() };
  if (idx >= 0) QUICK_SKILLS[idx] = item; else QUICK_SKILLS.push(item);
  persistQuickSkills();
  renderQuickbar();
}
function renderQuickbar() {
  const bar = $("quickbar");
  if (!bar) return;
  bar.innerHTML = "";
  QUICK_SKILLS.forEach((q, i) => {
    const b = document.createElement("button");
    b.className = "qbtn";
    b.type = "button";
    b.textContent = `${q.icon ? q.icon + " " : ""}${tr(q.label)}`;
    b.title = `${q.prompt}\n${tr("右键编辑 / 删除")}\nShift+点击 → 仅填入输入框`;
    b.onclick = (e) => runQuickSkill(q, e.shiftKey); // Shift+点击仅填入，普通点击直接发送
    b.oncontextmenu = (e) => { e.preventDefault(); editQuickSkill(i); };
    bar.appendChild(b);
  });
  // 「📚」打开分场景编程 Prompt 库
  const lib = document.createElement("button");
  lib.className = "qbtn";
  lib.type = "button";
  lib.textContent = "📚";
  lib.title = tr("编程 Prompt 库（分场景模板）");
  lib.onclick = openPromptLib;
  bar.appendChild(lib);
  // 末尾「＋」用于新增快捷按钮
  const add = document.createElement("button");
  add.className = "qbtn qbtn-add";
  add.type = "button";
  add.textContent = "＋";
  add.title = tr("新增快捷按钮");
  add.onclick = () => editQuickSkill(-1);
  bar.appendChild(add);
}
renderQuickbar();

// ── 编程 Prompt 库：分场景的高质量模板 ───────────────────────
// 点击：填入输入框并聚焦（标 send 的直接发送——它们针对当前项目自洽，无需补充目标）。
// ⭐：收藏为快捷按钮。模板统一要求「先定位/列证据/输出简洁」，与省 token 的用法一致。
const PROMPT_LIBRARY = [
  { cat: "🧭 理解代码", items: [
    { icon: "🧭", label: "项目上手指南", send: true,
      prompt: "我是新接手这个项目的开发者，给我一份 10 分钟上手指南：架构与技术栈、核心模块及职责、关键数据流向、建议从哪几个文件开始读。简洁列表即可" },
    { icon: "💡", label: "解释这段代码",
      prompt: "解释 @ 的实现：先一句话说用途，再列关键流程与重要边界条件（文件:行号），不要逐行复述" },
    { icon: "🔗", label: "梳理调用链",
      prompt: "梳理「」的完整调用链：从入口到落地按顺序列出涉及的 文件:行号，每步一句话" },
  ]},
  { cat: "🐛 调试排错", items: [
    { icon: "🚨", label: "排查报错",
      prompt: "排查这个报错：先定位根因（给出证据 文件:行号），再给最小修复，不要顺手大改：\n" },
    { icon: "🔬", label: "只读定位 bug",
      prompt: "这个 bug 的现象是：。请先只读地定位根因，列出证据（文件:行号）和修复思路，经我确认后再动手改" },
    { icon: "🪵", label: "加调试日志",
      prompt: "在「」相关的关键路径上加必要的调试日志（带关键变量值），帮助定位问题，改动最小化，问题解决后我会让你移除" },
  ]},
  { cat: "🔧 重构优化", items: [
    { icon: "🔧", label: "小步重构",
      prompt: "重构 @ ：保持行为完全不变，目标是更可读、去重复。小步进行，每步一句话说明改了什么、为什么安全" },
    { icon: "🧬", label: "抽取公共逻辑",
      prompt: "找出这些文件中的重复/相似逻辑并抽成公共函数或模块，列出抽取前后的对照：@" },
    { icon: "🧹", label: "找死代码", send: true,
      prompt: "扫描项目中未被引用的导出、函数与文件，输出清单（每项附判断证据），先不要删，等我确认" },
  ]},
  { cat: "🧪 测试", items: [
    { icon: "🧪", label: "补单元测试",
      prompt: "为 @ 写单元测试：覆盖正常路径、边界条件与错误分支，复用项目现有的测试框架与风格，跑通后汇报覆盖了哪些场景" },
    { icon: "🩹", label: "修失败的测试", send: true,
      prompt: "运行本项目测试，对失败的用例先判断是代码 bug 还是测试过期：是 bug 修代码，是过期改断言，逐个说明判断依据" },
  ]},
  { cat: "⚡ 性能", items: [
    { icon: "⚡", label: "性能体检", send: true,
      prompt: "只读地找出最可能的性能热点（循环内 IO、重复计算、N+1、不必要的全量遍历/重渲染），列 top5：文件:行号 + 一句话问题 + 一句话修法，先不要改" },
    { icon: "📈", label: "优化指定代码",
      prompt: "优化 @ 的性能：先说明瓶颈在哪（给出推理或测量依据），经我确认后再改，避免为微小收益牺牲可读性" },
  ]},
  { cat: "🛡 安全", items: [
    { icon: "🛡", label: "安全检查", send: true,
      prompt: "对本项目做一次安全检查：注入、路径穿越、命令拼接、敏感信息硬编码/泄漏、不安全的反序列化。输出按风险排序的清单（文件:行号 + 一句话修法），先不要改" },
  ]},
  { cat: "📝 文档注释", items: [
    { icon: "📝", label: "生成/更新 README", send: true,
      prompt: "为本项目生成或更新 README：用途、安装运行步骤、使用示例、目录结构说明。以简洁实用为准，不要营销话术" },
    { icon: "💬", label: "补关键注释",
      prompt: "给 @ 中不易读懂的部分补注释：只解释「为什么这么做」与约束/陷阱，不复述代码在做什么" },
  ]},
  { cat: "🔀 Git 协作", items: [
    { icon: "🧾", label: "总结未提交改动", send: true,
      prompt: "总结当前未提交的改动：按文件分组、每处一句话动机，最后给一条符合本仓库风格的 commit message" },
    { icon: "🆚", label: "对比主分支差异", send: true,
      prompt: "对比当前分支与主分支（main/master）的差异：按功能归组总结，标出风险点与需要重点 review 的文件" },
  ]},
];
function openPromptLib() {
  $("plibModal").classList.add("open");
  $("plibSearch").value = "";
  renderPromptLib("");
  $("plibSearch").focus();
}
function renderPromptLib(kw) {
  const el = $("plibList");
  el.innerHTML = "";
  const q = (kw || "").toLowerCase();
  let shown = 0;
  PROMPT_LIBRARY.forEach((cat) => {
    const items = cat.items.filter((p) => !q || (p.label + p.prompt + cat.cat).toLowerCase().includes(q));
    if (!items.length) return;
    const h = document.createElement("div");
    h.className = "plib-cat";
    h.textContent = tr(cat.cat);
    el.appendChild(h);
    items.forEach((p) => {
      shown++;
      const row = document.createElement("div");
      row.className = "plib-row";
      row.innerHTML =
        `<div class="plib-main"><div class="plib-label"></div><div class="plib-prompt"></div></div>` +
        (p.send ? `<span class="plib-send" data-i18n-title="点击即直接发送" title="点击即直接发送">${tr("直发")}</span>` : "") +
        `<button class="plib-star" data-i18n-title="收藏为快捷按钮" title="收藏为快捷按钮">⭐</button>`;
      row.querySelector(".plib-label").textContent = `${p.icon} ${tr(p.label)}`;
      row.querySelector(".plib-prompt").textContent = p.prompt;
      row.onclick = () => {
        $("plibModal").classList.remove("open");
        const input = $("input");
        input.value = p.prompt;
        if (p.send) { send(); return; }
        input.focus();
        // 光标定位到首个待补充处（@ 或「」或行尾），方便直接补目标
        const at = p.prompt.indexOf("@");
        const blank = p.prompt.indexOf("「」");
        const pos = blank >= 0 ? blank + 1 : at >= 0 ? at + 1 : p.prompt.length;
        input.setSelectionRange(pos, pos);
      };
      row.querySelector(".plib-star").onclick = (e) => {
        e.stopPropagation();
        if (!QUICK_SKILLS.some((s) => s.prompt === p.prompt)) {
          QUICK_SKILLS.push({ icon: p.icon, label: p.label, prompt: p.prompt });
          persistQuickSkills();
          renderQuickbar();
        }
        toast(tr("已收藏到快捷栏"));
      };
      el.appendChild(row);
    });
  });
  if (!shown) el.innerHTML = `<div class="plib-empty">${tr("无匹配")}</div>`;
}
$("plibClose").onclick = () => $("plibModal").classList.remove("open");
$("plibModal").onclick = (e) => { if (e.target.id === "plibModal") $("plibModal").classList.remove("open"); };
$("plibSearch").oninput = () => renderPromptLib($("plibSearch").value.trim());

// ── 斜杠命令 / skills / subagent 补全 ───────────────────────
let slashCommands = []; // [{ name, kind: 'command'|'skill'|'agent' }]
let slashMatches = [];
let slashSel = 0;
// 内置指令：始终出现在补全列表中，不依赖 server 推送
const BUILTIN_SLASH = [
  { name: "review", kind: "builtin", desc: "审查当前 staged diff，列出 bug 和改进点" },
];
// 兼容旧版（纯字符串数组）与对象数组，并接受名字字符串或 {name}
function normSlash(arr, kind = "command") {
  return (Array.isArray(arr) ? arr : [])
    .map((c) => (typeof c === "string" ? { name: c, kind } : { name: c && c.name, kind }))
    .filter((c) => c.name);
}
try {
  slashCommands = normSlash(JSON.parse(localStorage.getItem("claudeTools.cmds") || "[]"));
} catch {}

function allSlashCmds() {
  // 内置命令排最前，去重（避免 server 也推了同名）
  const seen = new Set(BUILTIN_SLASH.map((c) => c.name));
  return [...BUILTIN_SLASH, ...slashCommands.filter((c) => !seen.has(c.name))];
}

function updateSlash() {
  const popup = $("slashPopup");
  const v = $("input").value;
  const m = /^\/(\S*)$/.exec(v); // 仅当以 / 开头且首词未输完（无空格）
  if (!m) {
    popup.classList.remove("open");
    return;
  }
  const q = m[1].toLowerCase();
  slashMatches = allSlashCmds()
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
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
    el.innerHTML =
      `<span class="cmd">/${esc(c.name)}</span>` +
      (c.desc ? `<span class="kind">${esc(c.desc)}</span>` : c.kind !== "command" ? `<span class="kind">${esc(c.kind)}</span>` : "");
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
  const name = typeof c === "string" ? c : c && c.name;
  if (!name) return;
  $("input").value = "/" + name + " ";
  $("slashPopup").classList.remove("open");
  $("input").focus();
}

$("input").addEventListener("input", () => {
  updateSlash();
  updateMention();
  refreshSendBtn(); // 输入时切换 发送/停止 按钮态
  updateConvEstCost(); // 输入变化时更新预估费用
});

// 本对话模型选择器：仅影响当前对话后续请求，不修改全局 config
(function () {
  const sel = $("convModelSel");
  if (!sel) return;
  sel.addEventListener("change", () => {
    if (activeConv) activeConv._convModel = sel.value || null;
    updateConvEstCost();
  });
})();

// 模型档位弹窗：点击 convModelBtn 显示带价格的选项列表
(function () {
  const btn = $("convModelBtn");
  const popup = $("convModelPopup");
  const sel = $("convModelSel");
  if (!btn || !popup) return;

  function buildPopup() {
    const cur = (activeConv && activeConv._convModel) || "";
    popup.innerHTML = CONV_MODEL_LIST.map(m =>
      `<div class="cmp-item${m.value === cur ? ' active' : ''}" data-val="${m.value}">` +
        `<span>${m.label}</span><span class="cmp-price">${m.sub}</span>` +
      `</div>`
    ).join('');
    popup.querySelectorAll('.cmp-item').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.dataset.val;
        if (activeConv) activeConv._convModel = v || null;
        if (sel) sel.value = v;
        syncConvModelSel();
        closePopup();
      });
    });
  }

  function openPopup() {
    buildPopup();
    popup.style.display = 'block';
    const r = btn.getBoundingClientRect();
    const ph = popup.offsetHeight;
    popup.style.left = r.left + 'px';
    popup.style.top = (r.top - ph - 4) + 'px';
  }

  function closePopup() {
    popup.style.display = 'none';
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    popup.style.display === 'none' ? openPopup() : closePopup();
  });

  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && e.target !== btn) closePopup();
  });
})();

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
    // 目录条目用尾斜杠 + 📁 区分：选中后插入 @相对目录/，让模型把整个目录纳入上下文
    const label = f.dir ? "📁 " + f.name + "/" : f.name;
    el.innerHTML = `<span class="cmd">${esc(label)}</span><span class="rel">${esc(f.rel)}</span>`;
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
  const ref = "@" + f.rel + (f.dir ? "/ " : " ");
  input.value = input.value.slice(0, mentionStart) + ref + input.value.slice(caret);
  const pos = mentionStart + ref.length;
  input.setSelectionRange(pos, pos);
  $("filePopup").classList.remove("open");
  mentionStart = -1;
  input.focus();
}

// 给「已完成且改动了文件」的轮次加「撤销本轮改动」按钮，点按把 git 工作区还原到本轮开始前
function addRewindBtn(wrap, cpId) {
  const role = wrap.querySelector(".role");
  if (!role || role.querySelector(".rewind-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "reply-copy rewind-btn"; // 复用回复按钮样式
  btn.title = tr("把工作区文件还原到本轮开始前");
  btn.textContent = tr("↩ 撤销本轮改动");
  btn.onclick = async () => {
    if (!(await modalConfirm(tr("将丢弃本轮（及其之后）对文件的全部改动，恢复到本轮开始前。\n此操作不可撤销！"))))
      return;
    btn.disabled = true;
    btn.textContent = tr("撤销中…");
    const r = await window.api.chatRewind(cpId);
    if (r && r.ok) {
      btn.textContent = tr("✓ 已撤销");
      btn.classList.add("copied");
      toast(tr("已恢复到本轮开始前"), "success");
      refreshFileTree(); // 文件已还原 => 同步重建文件树
      if (activeRepo) { loadStatus(activeRepo); loadGraph(activeRepo); } // git 面板若开着则刷新
      // 把触发本轮的原始用户消息回填到输入框，方便修改后重发
      const userMsg = wrap.previousElementSibling;
      if (userMsg && userMsg.classList.contains("user")) {
        const origText = userMsg.querySelector(".bubble")?.textContent || "";
        if (origText) {
          const inp = $("input");
          inp.value = origText;
          inp.dispatchEvent(new Event("input"));
          inp.focus();
        }
      }
    } else {
      btn.disabled = false;
      btn.textContent = tr("↩ 撤销本轮改动");
      toast(tr("撤销失败：") + (r?.error || tr("未知")), "error");
    }
  };
  role.appendChild(btn);
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
  // 合并 命令/skill/subagent 三类来源供 / 补全（带 kind 标记区分），持久化以便下次启动即可用
  const merged = [
    ...normSlash(commands, "command"),
    ...normSlash(skills, "skill"),
    ...normSlash(agents, "agent"),
  ];
  if (merged.length) {
    slashCommands = merged;
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
// token 数量缩写显示：1234 -> 1.2k
const fmtTok = (n) => ((n = n || 0), n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
window.api.on("chat:chunk", ({ convId, text }) => appendText(getConv(convId), text));
window.api.on("chat:tool", ({ convId, id, name, input }) =>
  appendTool(getConv(convId), id, name, input)
);
window.api.on("chat:toolresult", ({ convId, id, isError, text }) =>
  appendToolResult(getConv(convId), id, isError, text)
);
window.api.on("chat:done", ({ convId, cost, ms, session, cwd, usage, ctx, checkpoint }) => {
  const conv = getConv(convId);
  const turnWrap = conv?.currentBubble; // 捕获本轮容器，finishTurn 会清空引用
  if (conv && session) conv.sessionId = session; // 记住本对话 session
  if (conv && cwd && !conv.cwd) conv.cwd = cwd; // 记住本对话出生 cwd，供下次/跨设备续聊沿用
  if (conv) {
    // 累计本会话费用与 token（usage 含输入/输出/缓存读写各项，分项记录便于按计费比例折算）
    if (typeof cost === "number") conv.costUsd += cost;
    if (usage) {
      const u = conv.usage || (conv.usage = { in: 0, out: 0, cw: 0, cr: 0 });
      u.in += usage.input_tokens || 0;
      u.out += usage.output_tokens || 0;
      u.cw += usage.cache_creation_input_tokens || 0;
      u.cr += usage.cache_read_input_tokens || 0;
      conv.tokens +=
        (usage.input_tokens || 0) + (usage.output_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    }
    if (typeof ctx === "number" && ctx > 0) conv.ctx = ctx;
    conv._compacting = false; // 自动压缩轮结束（或普通轮结束），解除标记
  }
  const _u = usage || {};
  const _inT = _u.input_tokens || 0, _outT = _u.output_tokens || 0;
  const _cwT = _u.cache_creation_input_tokens || 0, _crT = _u.cache_read_input_tokens || 0;
  const _tokStr = (_inT || _outT || _cwT || _crT)
    ? ` | in ${fmtTok(_inT)} / out ${fmtTok(_outT)}` +
      (_cwT ? ` / cw ${fmtTok(_cwT)}` : "") +
      (_crT ? ` / cr ${fmtTok(_crT)}` : "")
    : "";
  // 在最后一个内容气泡右下角注入本轮费用小标（仅 cost > 0 时显示）
  if (turnWrap && typeof cost === "number" && cost > 0) {
    const lastBubble = [...turnWrap.querySelectorAll(".bubble")].pop();
    if (lastBubble) {
      const costSpan = document.createElement("span");
      costSpan.className = "turn-cost";
      costSpan.innerHTML = `$${cost.toFixed(4)}` + (_crT > 0 ? ` <span style="color:#888;font-size:9px">⚡cached</span>` : "");
      costSpan.title = `本轮费用 $${cost.toFixed(6)}` + (_crT > 0 ? `\n缓存读 ${_crT.toLocaleString()} tokens（节省约 90%）` : "");
      lastBubble.appendChild(costSpan);
    }
  }
  finishTurn(conv,
    `${tr("用时 ")}${ms}ms · $${cost?.toFixed?.(4) ?? cost}${_crT > 0 ? " ⚡cached" : ""}${_tokStr}` +
    (conv && conv.ctx >= CTX_WARN ? trf(" · ⚠ 上下文 {0}，建议 /compact 或新开对话", fmtTokens(conv.ctx)) : ""));
  if (checkpoint && turnWrap) addRewindBtn(turnWrap, checkpoint.id); // 本轮改动了文件 => 提供回滚入口
  if (checkpoint) refreshFileTree(); // 本轮改动了文件 => 重建文件树（保留展开层级与选中态）
  // 计划模式轮 & 没有排队消息 => 渲染「按计划执行 / 继续调整」操作条
  if (conv && conv._planTurn && turnWrap && !conv.queue.length) addPlanActions(conv, turnWrap);
  // 非计划轮、无排队消息 => 追加 follow-up 快捷按钮
  if (conv && !conv._planTurn && turnWrap && !conv.queue.length) addFollowUpBtns(conv, turnWrap);
  // 本轮输入 token 超过 CTX_WARN => 在聊天区底部插入系统提示，引导用户主动 /compact
  if (conv && _inT >= CTX_WARN && !conv._compacting) {
    const notice = document.createElement("div");
    notice.className = "msg system ctx-warn-notice";
    notice.innerHTML =
      `<div class="bubble">⚠ 上下文已用 <b>${fmtTok(_inT)}</b> token，建议执行 /compact 压缩以降低后续费用` +
      ` <button type="button" class="compact-now-btn">立即 /compact</button></div>`;
    notice.querySelector(".compact-now-btn").addEventListener("click", () => {
      notice.remove();
      startTurn(conv, "/compact");
    });
    conv.pane.appendChild(notice);
    scrollIfActive(conv);
  }
  renderCostReadout(); // 刷新输入区底部的会话累计读数
  renderCtxFooter();   // 刷新对话底部 token 统计条
  loadUsageThrottled(); // 刷新右上角用量
  // 队列里还有追问 => 合并成一轮发出（续接同一 session）；否则推进需求清单。
  // 合并而非逐条跑：每轮请求都会全量重发对话上下文，N 条排队逐条跑就是 N 次全量重发，
  // 合并后只重发一次（与 Claude Code 对排队消息的处理一致）。
  if (conv && conv.queue.length) startTurn(conv, conv.queue.splice(0).join("\n\n"));
  else {
    notifyBgTurnEnd(conv, true, ms); // 后台对话真正闲下来才提醒，排队续跑时不打扰
    reqOnTurnEnd(conv, true);
    // 首轮完成后自动用轻量模型生成标题（仅一次，不覆盖用户手动重命名）
    if (conv && !conv._aiTitled && conv.promptHist && conv.promptHist.length === 1) {
      conv._aiTitled = true;
      const firstMsg = conv.promptHist[0];
      if (firstMsg.trim().length < 12 || firstMsg.trim().startsWith('/')) return;
      window.api.convAutoTitle(firstMsg).then((r) => {
        if (r && r.title && conv.title !== r.title) {
          conv.title = r.title;
          renderConvList();
          persistConvs();
        }
      }).catch(() => {});
    }
  }
});
window.api.on("chat:stopped", ({ convId }) => {
  const conv = getConv(convId);
  if (conv) { conv.queue = []; conv._compacting = false; } // 用户主动停止 => 清空排队
  finishTurn(conv, tr("⏹ 已停止"));
  reqOnTurnEnd(conv, false);
});
window.api.on("chat:error", ({ convId, message }) => {
  const conv = getConv(convId);
  if (conv) { conv.queue = []; conv._compacting = false; } // 出错 => 不再继续排队
  const turnWrap = conv?.currentBubble; // finishTurn 会清空引用，先捕获
  finishTurn(conv, null, tr("出错了：") + "\n" + message);
  // 在错误气泡下方追加「↻ 重试」按钮，点击后复用同一 session 重发上一条 prompt
  if (conv && conv.lastPrompt) {
    const container = turnWrap || conv.pane?.lastElementChild;
    const errDiv = container?.querySelector(".bubble.err:last-of-type") || container;
    if (errDiv) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "retry-btn";
      btn.textContent = tr("↻ 重试");
      btn.onclick = () => {
        if (conv.busy) return;
        btn.disabled = true;
        startTurn(conv, conv.lastPrompt);
      };
      errDiv.appendChild(btn);
    }
  }
  notifyBgTurnEnd(conv, false, 0);
  reqOnTurnEnd(conv, false);
});
