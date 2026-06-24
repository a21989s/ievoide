# 自进化 dev Tool

基于 Claude Agent SDK 的桌面 App（仿 Claude Code 插件）：多对话并行、完整 Source Control、PDF/MD/Mermaid 查看与编辑、附件、自进化等。

## 便携使用（copy 即用）

整个 `tools` 文件夹自带一切——源码、配置、提示词、对话历史、附件都在文件夹内。**把整个文件夹复制到另一台同系统机器即可直接用**：

- macOS：双击 **`start.command`**
- Windows：双击 **`start.bat`**
- 或命令行：`npm start`

（缺 `node_modules` 会自动 `npm install`，需已装 Node.js）

### 跨平台说明
- 代码跨平台（macOS / Windows / Linux 都能跑），但 `node_modules` 含**平台相关**的 Electron 二进制：换平台时**不要**复制 `node_modules`，让首次启动自动 `npm install` 重装即可。
- 需要本机装好 **Node.js** 和 **git**（Source Control / 自进化依赖 git）。Windows 全量打包用系统自带 `tar`。

> 注意：`node_modules` 含平台相关的 Electron 二进制。同系统(如都是 macOS)整盘复制可直接用；跨系统或只复制源码时，首次启动会自动安装依赖。

### 打包分发给别人

双击 **`package-dist.command`** → 在桌面生成一个 zip（含源码+配置+提示词+`.git`，不含 `node_modules` 和你的私有 `data/`）。对方解压后双击 `start.command` 即用，**且仍能自进化**（zip 里带了 git）。

## 数据与配置都在文件夹内

| 位置 | 内容 |
|------|------|
| `config.json` | **系统提示词追加内容、权限模式、模型**等，可直接编辑 |
| `mcp.json` | MCP 服务器配置（见 `mcp.example.json`）|
| `data/` | 对话历史、附件、设置、localStorage 等运行时数据（已 gitignore）|

改 `config.json` 里的 `systemPromptAppend` 即可定制 Claude 的默认行为/语言。

## 省 token（订阅用量）

桌面端顶栏两个下拉即时生效（写回 `config.json`，桌面/手机端共用）：

- **模型**：日常选 `Sonnet(省)`，难题再切 `Opus(强)`；`Haiku(最省)` 适合简单问答。
- **思考深度(effort)**：`低/中` 大幅省 token，`高`(默认)/`超高` 留给复杂任务。

`config.json` 还有进阶旋钮：`fallbackModel`（过载自动降级）、`allowedTools`/`disallowedTools`（裁掉不用的工具）。

每轮回答下方会显示 `↑输入 ↓输出 · 缓存命中 %`：**缓存命中率越高越省**（同一对话连续追问命中率高；新开会话/切换模型会重置缓存）。其他省 token 习惯：

- 同一话题在同一对话里追问（续接 session，输入大多走 0.1 倍价的缓存）。
- 附件走文件路径让 Claude 按需读取（App 已默认如此），不要把大段文件内容直接粘进输入框。

## 注意

- 全权限模式（含 Bash），Claude 能直接读写所选目录、跑命令。
- 🧬 自进化会改本 App 自己的源码，依赖 git 做检查点与回滚——请保持本目录是干净的 git 仓库。
