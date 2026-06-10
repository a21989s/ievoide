// ── 中英双语 i18n ──────────────────────────────────────────
// 以中文原文作为 key：默认（zh）原样返回；en 模式查 EN 表，缺失则回退中文。
// 静态 HTML 用 data-i18n / data-i18n-title / data-i18n-ph 标注；
// 动态文案在 renderer.js / pdfeditor.js 里用 tr() / trf() 包裹。
(function () {
  const EN = {
    // —— 顶栏 ——
    "折叠/展开左侧栏": "Collapse / expand sidebar",
    "📁 选择文件夹": "📁 Open Folder",
    "🗑 新建会话": "🗑 New Session",
    "清空对话并开启新会话": "Clear chat and start a new session",
    "未选择目录": "No folder selected",
    "搜索文件内容…": "Search file contents…",
    "无匹配": "No matches",
    "用量…": "Usage…",
    "点击刷新用量": "Click to refresh usage",
    "快捷键速查（按 ? 打开）": "Keyboard shortcuts (press ?)",
    "⌨️ 快捷键速查": "⌨️ Keyboard Shortcuts",
    "全局": "Global",
    "对话": "Chat",
    "需求开发": "Requirements",
    "自进化": "Self-evolve",
    "打开本速查面板": "Open this shortcut panel",
    "折叠 / 展开左侧栏": "Collapse / expand sidebar",
    "关闭当前弹层（查看器 / 历史 / 菜单等）": "Close the current overlay (viewer / history / menu)",
    "发送消息": "Send message",
    "换行": "New line",
    "在斜杠 / 文件补全弹窗中选择": "Navigate slash / file completion popup",
    "确认补全项": "Confirm completion item",
    "提交已暂存的更改（提交信息框内）": "Commit staged changes (in the message box)",
    "添加一条需求到清单": "Add a requirement to the list",
    "在需求输入框内换行": "New line in the requirement input",
    "开始进化 / 追加方向调整": "Start evolution / append a direction tweak",
    "🧬 进化": "🧬 Evolve",
    "自进化：让 App 改自己的源码（自动回滚保护）": "Self-evolve: let the app edit its own source (auto-rollback protected)",
    "📦 打包": "📦 Package",
    "全量打包(含 node_modules/数据/历史)到桌面，解压即用、零安装": "Package everything (node_modules / data / history) to Desktop — unzip and run, zero install",
    "切换语言 / Switch language": "切换语言 / Switch language",
    // —— 侧栏切换 ——
    "⎇ 源代码管理": "⎇ Source Control",
    "源代码管理": "Source Control",
    "✓ 需求开发": "✓ Requirements",
    "需求开发：逐条录入需求，右侧自动分析并修改代码": "Requirements: add tasks one by one; the right side analyzes and edits code automatically",
    // —— Source Control ——
    "拉取 pull": "Pull",
    "推送 push": "Push",
    "抓取 fetch": "Fetch",
    "新建分支": "New branch",
    "撤销上次提交（保留改动）": "Undo last commit (keep changes)",
    "刷新": "Refresh",
    "提交信息（Ctrl+Enter 提交已暂存）": "Commit message (Ctrl+Enter to commit staged)",
    "✓ 提交": "✓ Commit",
    "提交已暂存的更改": "Commit staged changes",
    "暂存的更改": "Staged Changes",
    "全部取消暂存": "Unstage all",
    "更改": "Changes",
    "丢弃所有更改": "Discard all changes",
    "全部暂存": "Stage all",
    // —— 常用 skill 快捷按钮 ——
    "推送代码": "Push",
    "运行测试": "Run Tests",
    "运行本项目的测试用例，并把结果汇报给我": "Run this project's tests and report the results to me",
    "建 PR": "New PR",
    // —— 需求开发 ——
    "需求开发清单": "Requirements List",
    "逐条录入开发需求；点「开始处理」后右侧会按顺序分析并修改代码，完成一条自动继续下一条。运行中可继续添加。": "Add tasks one by one. After clicking “Start”, the right side analyzes and edits code in order, moving to the next one automatically. You can keep adding while it runs.",
    "录入一条需求，例如：给登录页加上记住密码…（可粘贴/拖入 图片·Word·PDF 作为附件；可附 Jira/Confluence 链接；Enter 添加，Shift+Enter 换行）": "Enter a task, e.g. add “remember me” to the login page… (paste / drop image·Word·PDF as attachments; attach Jira / Confluence links; Enter to add, Shift+Enter for newline)",
    "添加附件（图片 / Word / PDF / 其他文件）": "Add attachment (image / Word / PDF / other file)",
    "📎 附件": "📎 Attach",
    "添加链接（Jira ticket / Confluence 文档 / 任意网址）": "Add link (Jira ticket / Confluence doc / any URL)",
    "🔗 链接": "🔗 Link",
    "＋ 添加需求": "＋ Add Task",
    "添加到清单": "Add to list",
    "▶ 开始处理": "▶ Start",
    "⏹ 停止": "⏹ Stop",
    "清空": "Clear",
    "清空清单": "Clear list",
    // —— 对话 / 输入 ——
    "新对话": "New chat",
    "问点什么…（可粘贴/拖入 图片·PDF·Word 作为上下文；Ctrl/⌘+Enter 发送）": "Ask anything… (paste / drop image·PDF·Word as context; Ctrl/⌘+Enter to send)",
    "发送（Ctrl/⌘+Enter）": "Send (Ctrl/⌘+Enter)",
    "关闭": "Close",
    // —— 自进化面板 ——
    "🧬 自进化 · 改自身源码（git 检查点 + 语法校验 + 失败自动回滚）": "🧬 Self-evolve · edit own source (git checkpoint + syntax check + auto-rollback on failure)",
    "描述需求或要修复的问题，例如：修复 XX 报错 / 给对话加一个导出按钮…": "Describe a requirement or bug to fix, e.g. fix the XX error / add an export button to chat…",
    "开始": "Start",
    "停止": "Stop",
    "自动修复运行时错误": "Auto-fix runtime errors",
    "定期自检": "Periodic self-check",
    "每 30 分钟": "Every 30 min",
    "每 1 小时": "Every 1 hour",
    "每 3 小时": "Every 3 hours",
    "问题清单": "Issues",
    "进化日志": "Evolution Log",
    // —— PDF 编辑器 ——
    "↖ 选择": "↖ Select",
    "✏️ 画笔": "✏️ Pen",
    "🖍 高亮": "🖍 Highlight",
    "🔤 文字": "🔤 Text",
    "⬜ 遮盖改字": "⬜ Whiteout",
    "颜色": "Color",
    "⟳ 旋转页": "⟳ Rotate",
    "🗑 删页": "🗑 Delete Page",
    "📝 表单": "📝 Form",
    "💾 保存": "💾 Save",
    "表单字段": "Form Fields",
    "应用到文档": "Apply to Document",
    // —— 动态：Git / Source Control ——
    "未发现 Git 仓库": "No Git repository found",
    "取消暂存": "Unstage",
    "暂存": "Stage",
    "丢弃更改": "Discard changes",
    "执行中…": "Working…",
    "Git 操作失败：": "Git operation failed:",
    "已提交": "Committed",
    "这是未跟踪的目录，请在左侧文件树展开查看其中文件。": "This is an untracked directory; expand it in the file tree on the left to view its files.",
    "[已暂存] ": "[Staged] ",
    "[新文件] ": "[New] ",
    "(无差异)": "(no diff)",
    "加载中…": "loading…",
    "{0} 个文件改动": "{0} file(s) changed",
    "无文件改动": "No file changes",
    "← 返回文件列表": "← Back to file list",
    "读取失败": "Read failed",
    "提交操作": "Commit actions",
    "检出此提交（分离 HEAD）": "Checkout this commit (detached HEAD)",
    "检出 {0}？将进入分离 HEAD 状态。": "Checkout {0}? This enters a detached HEAD state.",
    "撤销此提交 (revert)": "Revert this commit",
    "已创建 revert 提交": "Revert commit created",
    "软重置到此（保留改动）": "Soft reset to here (keep changes)",
    "reset --soft 到 {0}？\n此提交之后的提交将撤销，改动保留。": "reset --soft to {0}?\nCommits after this will be undone, changes kept.",
    "硬重置到此（丢弃之后的提交）": "Hard reset to here (discard later commits)",
    "reset --hard 到 {0}？\n此提交之后的提交与改动将永久丢失，不可撤销！": "reset --hard to {0}?\nCommits and changes after this will be permanently lost — cannot be undone!",
    "复制完整 SHA": "Copy full SHA",
    "丢弃对 {0} 的更改？此操作不可撤销。": "Discard changes to {0}? This cannot be undone.",
    "新分支名：": "New branch name:",
    "已创建分支": "Branch created",
    "已拉取": "Pulled",
    "已推送": "Pushed",
    "已抓取": "Fetched",
    "丢弃所有未暂存更改，并删除未跟踪文件/目录？\n此操作不可撤销！": "Discard all unstaged changes and delete untracked files/folders?\nThis cannot be undone!",
    "已丢弃所有更改": "All changes discarded",
    "撤销上次提交？\n（改动会保留在暂存区，可重新提交）": "Undo the last commit?\n(Changes are kept staged and can be re-committed)",
    "已撤销上次提交": "Last commit undone",
    "切换到 {0}…": "Switching to {0}…",
    "切换失败：": "Checkout failed:",
    // —— 动态：对话 ——
    "发送": "Send",
    "思考中…（已排队 {0} 条）": "Thinking… ({0} queued)",
    "思考中…（可继续输入，自动排队）": "Thinking… (keep typing; auto-queued)",
    "你": "You",
    "进行中": "Running",
    "，排队 {0}": ", {0} queued",
    "移除": "Remove",
    "未知": "unknown",
    "附件保存失败：": "Failed to save attachment: ",
    "附件": "Attachment",
    "(附件)": "(attachment)",
    "(无输出)": "(no output)",
    "✖ 出错": "✖ Error",
    "✔ 结果": "✔ Result",
    " …（点击展开）": " …(click to expand)",
    "\n…（已截断）": "\n…(truncated)",
    // —— 动态：用量 ——
    "用量 N/A": "Usage N/A",
    "用量不可用：": "Usage unavailable: ",
    "当前会话无订阅用量信息（如用 API Key）": "No subscription usage info for this session (e.g. when using an API key)",
    "用量": "Usage",
    "订阅：": "Subscription: ",
    "5小时窗：": "5h window: ",
    "重置 ": "reset ",
    "7天窗：": "7d window: ",
    "本会话花费：$": "Session cost: $",
    // —— 动态：打包 ——
    "全量(含依赖,零安装)": "Full (with deps, zero-install)",
    "完整备份(含历史)": "Full backup (with history)",
    "给别人(不含私有数据)": "For sharing (no private data)",
    "📦 {0} 打包中…": "📦 Packaging {0}…",
    "✅ 已打包到桌面（Finder 已高亮）": "✅ Packaged to Desktop (highlighted in Finder)",
    "打包失败：": "Packaging failed:",
    "📦 完整备份（配置+历史+git，无依赖）": "📦 Full backup (config + history + git, no deps)",
    "💼 全量（含 node_modules，解压零安装）": "💼 Full (incl. node_modules, unzip & run)",
    "🎁 给别人（不含你的私有数据）": "🎁 For sharing (without your private data)",
    // —— 动态：自进化 ——
    "✖ 失败：": "✖ Failed: ",
    "（无改动）": "(no change)",
    "✔ 已应用，正在重启…": "✔ Applied, restarting…",
    "✔ 已应用并重载": "✔ Applied and reloaded",
    "⚠️ 上次进化导致启动异常，已自动回滚到 ": "⚠️ Last evolution caused a startup error; auto-rolled back to ",
    "⏳ 处理中…": "⏳ Processing…",
    "删除": "Delete",
    "粘贴链接（Jira ticket / Confluence 文档 / 任意网址）：": "Paste a link (Jira ticket / Confluence doc / any URL):",
    "📋 需求：": "📋 Task: ",
    // —— 动态：引擎初始化行 ——
    "无": "none",
    "引擎": "Engine",
    "已加载 · model ": "Loaded · model ",
    " · 工具 ": " · tools ",
    " · 命令 ": " · commands ",
    " · 子agent ": " · sub-agents ",
    "用时 ": "Took ",
    "⏹ 已停止": "⏹ Stopped",
    "出错了：": "Error:",
    // —— 动态：PDF 编辑器 ——
    "读取 PDF 失败：": "Failed to read PDF: ",
    "渲染中…": "Rendering…",
    "{0} 页": "{0} pages",
    "第 {0} 页": "Page {0}",
    "第 {0} 页将旋转 {1}°（保存生效）": "Page {0} will rotate {1}° (applied on save)",
    "第 {0} 页将删除（保存生效）": "Page {0} will be deleted (applied on save)",
    "该 PDF 无表单字段": "This PDF has no form fields",
    "读取表单失败：": "Failed to read form: ",
    "表单值已记录，保存时写入": "Form values recorded; written on save",
    "保存中…": "Saving…",
    "已取消": "Canceled",
    "保存失败：": "Save failed: ",
    "已保存到 ": "Saved to ",
    "（注意：非拉丁字符未写入，需嵌入中文字体）": " (note: non-Latin characters were not written; embedding a CJK font is required)",
    "保存出错：": "Save error: ",
    // —— 图标按钮 tooltip ——
    "选择文件夹": "Open folder",
    "开始处理": "Start",
    "启动服务": "Start service",
    "停止服务": "Stop service",
    "复制地址": "Copy address",
    "本机浏览器打开": "Open in browser",
    "添加图片/文档": "Add image / document",
    "展开自进化": "Open self-evolve",
    "选择": "Select",
    "画笔": "Pen",
    "高亮": "Highlight",
    "文字": "Text",
    "遮盖改字": "Whiteout",
    "旋转页": "Rotate page",
    "删页": "Delete page",
    "表单": "Form",
    "保存": "Save",
    "复制": "Copy",
    "已复制": "Copied",
    "复制失败：": "Copy failed: ",
    "复制回复": "Copy reply",
    "复制整条回复": "Copy entire reply",
  };

  let lang = "zh";
  try { lang = localStorage.getItem("claudeTools.lang") || "zh"; } catch {}

  function tr(zh) {
    return lang === "en" ? (EN[zh] != null ? EN[zh] : zh) : zh;
  }
  function trf(zh, ...args) {
    let s = tr(zh);
    args.forEach((a, i) => { s = s.split("{" + i + "}").join(String(a)); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = tr(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = tr(el.getAttribute("data-i18n-title"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.placeholder = tr(el.getAttribute("data-i18n-ph"));
    });
  }
  function getLang() { return lang; }
  function setLang(l) {
    lang = l === "en" ? "en" : "zh";
    try { localStorage.setItem("claudeTools.lang", lang); } catch {}
    applyI18n();
    window.dispatchEvent(new Event("i18n")); // 让 renderer.js 重渲染动态部分
  }

  window.tr = tr;
  window.trf = trf;
  window.applyI18n = applyI18n;
  window.getLang = getLang;
  window.setLang = setLang;

  applyI18n();
})();
