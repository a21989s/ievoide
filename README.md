# ievoide — Self-Evolving Dev Tool

> A desktop AI coding companion built on the **[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk)** — and the rare agent that can rewrite its own source code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/built%20with-Claude%20Agent%20SDK-d97757.svg)](https://docs.claude.com/en/api/agent-sdk)
[![Electron](https://img.shields.io/badge/Electron-42-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)

English | [简体中文](README.zh-CN.md)

---

## What is this?

**ievoide** is an Electron desktop app that wraps the Claude Agent SDK into a Claude-Code-style workspace. Everything lives in one portable folder — source, config, prompts, chat history, attachments — so you can copy it to another machine and keep going.

Its standout feature: **🧬 self-evolution** — point the agent at its *own* repo and it will implement new features, using git as a checkpoint/rollback safety net.

![ievoide main UI](docs/images/screenshot-main.png)

> A VS Code-style workspace: Source Control on the left, parallel chats on the right, with one-click actions — Push, Run Tests, New PR, Generate Codemap, Find dead code, and 🧬 evolve.

## Features

- **🧬 Self-evolution** — the app can modify its own source; git-backed checkpoints and rollback.
- **Parallel conversations** — run multiple chats at once, each with its own session.
- **Full Source Control** — built-in git diff/stage/commit UI.
- **Rich viewers/editors** — PDF, Markdown, and Mermaid diagrams, plus attachments.
- **Mobile remote access** — drive the agent from your phone (see [REMOTE-ACCESS.md](REMOTE-ACCESS.md)).
- **Token-aware** — per-turn input/output/cache-hit stats; model & thinking-effort switchers to save subscription usage.
- **Portable** — copy the folder, double-click to start; auto-runs `npm install` on first launch.

## Requirements

- [Node.js](https://nodejs.org/) (LTS)
- `git` (required for Source Control & self-evolution)
- A Claude account / API access for the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk)

## Quick Start

```bash
git clone https://github.com/a21989s/ievoide.git
cd ievoide
npm install
npm start
```

Or double-click:
- **macOS** — `start.command`
- **Windows** — `start.bat`

> Cross-platform note: the code runs on macOS / Windows / Linux, but `node_modules` contains platform-specific Electron binaries. When moving between platforms, **don't** copy `node_modules` — let the first launch reinstall.

## Configuration

| File | Purpose |
|------|---------|
| `config.json` | System-prompt append, permission mode, model, thinking effort — edit directly |
| `mcp.json` | MCP server config (see `mcp.example.json`) |
| `data/` | Runtime data: chat history, attachments, settings (gitignored) |

Edit `systemPromptAppend` in `config.json` to customize the agent's default behavior/language.

## ⚠️ Safety

This is an agentic tool with shell (Bash) access — Claude can read/write files and run commands in the directories you grant it.

- The shipped default is `permissionMode: "acceptEdits"` (auto-accepts file edits; still prompts for commands). For maximum safety set it to `"default"`; only use `"bypassPermissions"` if you fully understand the risk.
- **Self-evolution rewrites this app's own code** and relies on git for checkpoints/rollback — keep the working tree on a clean git repo before evolving.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © a21989s
