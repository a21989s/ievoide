# Contributing to ievoide

Thanks for your interest! Contributions of all kinds are welcome.

## Getting started

```bash
git clone https://github.com/a21989s/ievoide.git
cd ievoide
npm install
npm start        # launch the app
npm run dev      # launch with file-watch auto-restart
```

## Before opening a PR

- Run the syntax/dry-run check: `npm run dryrun`
- Run tests: `npm test`
- Keep changes minimal and consistent with the surrounding code style.
- Don't commit runtime data — `data/`, `node_modules/`, and `cloud/keys.json` are gitignored; keep it that way.

## Reporting bugs / requesting features

Open an issue using the provided templates. Please include your OS, Node version, and steps to reproduce.

## Commit messages

Short, imperative present tense (e.g. `fix: resolve deadlock on resume`). Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`) are appreciated but not required.
