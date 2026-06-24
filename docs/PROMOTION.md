# Promotion kit — ievoide

Copy-paste materials for launching. Replace `[GIF]` / links as needed.

---

## One-line hook (reuse everywhere)

> An AI dev tool that rewrites its own source code — you ask for a feature, it builds, commits, and ships it. Git is the undo button.

---

## Hacker News — Show HN

**Title:**
`Show HN: ievoide – a desktop dev tool that rewrites its own source code`

**First comment (post yourself right after submitting):**
```
I built a Claude-powered desktop IDE and pointed it at its own repo. You type a
requirement ("add an export button", "fix the deadlock on resume"), hit run, and
it edits its own source behind a git checkpoint — syntax-checked, with automatic
rollback if the change fails. Every attempt is logged as applied / no-change /
failed with its commit hash.

It's an Electron app on top of the Claude Agent SDK: parallel chats, a full
Source Control panel, PDF/Markdown/Mermaid editing, and mobile remote access.
Everything lives in one portable folder.

The repo itself has 50+ self-evolution commits — it has genuinely written a lot
of its own features. MIT licensed. Happy to answer anything about the
checkpoint/rollback design or how the agent is sandboxed.

Repo: https://github.com/a21989s/ievoide
```
Best time: Tue–Thu, ~8–10am US Pacific.

---

## Reddit

Subreddits: r/ClaudeAI, r/SideProject, r/LocalLLaMA, r/electronjs

**Title:**
`I made a dev tool that rewrites its own source code (Claude Agent SDK + Electron)`

**Body:**
```
Open-sourced a desktop AI dev tool I've been building. The twist: you can point
it at its *own* repo and ask for features — it edits its own code behind a git
checkpoint and auto-rolls-back if the build breaks.

[GIF of a self-evolution run]

- 🧬 Self-evolution with git checkpoints + auto-rollback
- Parallel chats, full Source Control UI
- PDF / Markdown / Mermaid editing
- Drive it from your phone
- Portable single folder, MIT licensed

Repo: https://github.com/a21989s/ievoide
Feedback welcome — especially on the rollback/safety model.
```

---

## X / Twitter

```
I gave an AI dev tool access to its own source code.

You ask for a feature → it edits itself behind a git checkpoint → auto-rolls-back
if the build breaks. 50+ of its own commits so far.

Built on the @AnthropicAI Claude Agent SDK. Open source (MIT) 🧬

[30s screen recording]
github.com/a21989s/ievoide
```

---

## v1.0.0 Release notes (draft)

**Tag:** `v1.0.0`  **Title:** `ievoide v1.0.0 — first public release`

```markdown
🧬 **ievoide** — a desktop dev tool that can rewrite its own source code.

First public, MIT-licensed release.

### Highlights
- **Self-evolution** — describe a feature/bug; the agent edits its own source
  behind a git checkpoint, syntax-checks, and auto-rolls-back on failure. Every
  attempt logged as applied / no-change / failed with its commit hash.
- **Parallel conversations** — multiple chats, each its own session.
- **Full Source Control** — built-in git diff / stage / commit UI.
- **Rich viewers/editors** — PDF, Markdown, Mermaid, attachments.
- **Mobile remote access** — drive the agent from your phone.
- **Token-aware** — per-turn input/output/cache-hit stats; model & effort switchers.
- **Portable** — one folder; double-click `start.command` / `start.bat`.

### Requirements
Node.js (LTS), git, and Claude Agent SDK access.

### Getting started
\`\`\`
git clone https://github.com/a21989s/ievoide.git
cd ievoide && npm install && npm start
\`\`\`

See the [README](https://github.com/a21989s/ievoide#readme) for configuration & safety notes.
```

---

## Launch checklist

- [ ] Record a self-evolution GIF/30s clip → put at top of README
- [ ] Upload social-preview image (Settings → 1280×640)
- [ ] Publish v1.0.0 Release (optionally attach packaged builds)
- [ ] Submit to awesome-claude / awesome-electron lists (PR)
- [ ] Post: Show HN → Reddit → X (space them out, reply to every comment)
```
