# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RebaseFlow is a VS Code extension that provides a visual interface for git rebase operations. It shows a persistent side panel with graph visualization of rebase progress, conflict causation highlighting, and continue/skip/abort controls. Currently v0.1, pre-marketplace.

- **Language:** TypeScript (strict mode)
- **Runtime:** VS Code extension (min 1.85.0, Node 20+)
- **Zero runtime dependencies** — uses only the VS Code API

## Build & Development Commands

```bash
npm run compile        # TypeScript → out/ (tsc -p ./)
npm run watch          # Live recompile during development
npm test               # Run tests (not yet implemented)
```

**Package & install locally:**
```bash
npx @vscode/vsce package --allow-missing-repository
code --install-extension rebaseflow-0.1.0.vsix
```

**Debug:** Open in VS Code, press F5 to launch Extension Development Host. Ctrl+Shift+F5 to restart.

## Architecture

Event-driven, reactive pattern with `RebaseState` as single source of truth:

```
RebaseStateWatcher (monitors .git/rebase-merge/*)
    ↓ onStateChanged (debounced 120ms)
    ├→ RebaseTreeProvider (SCM sidebar tree)
    ├→ RebasePanelWebview (HTML/CSS/JS graph panel)
    └→ VS Code context flags (controls UI visibility)
```

### Module Layout

- **`src/extension.ts`** — Entry point. Wires up watcher, views, and commands.
- **`src/models/RebaseState.ts`** — Shared interfaces. Commit statuses: `'base' | 'done' | 'current' | 'pending'`. Includes `ConflictCausation` mapping files → base commit hashes.
- **`src/git/GitCli.ts`** — Shell wrapper for git commands. Resolves actual git dir (supports worktrees).
- **`src/git/RebaseStateReader.ts`** — Parses `.git/rebase-merge/*` files into `RebaseState`.
- **`src/git/RebaseStateWatcher.ts`** — FileSystemWatcher with debounce, emits state change events.
- **`src/views/RebaseTreeProvider.ts`** — VS Code `TreeDataProvider` for SCM sidebar.
- **`src/views/RebasePanelWebview.ts`** — Full webview panel with inline HTML/CSS/JS graph.
- **`src/commands/index.ts`** — Continue/skip/abort command handlers.

### Key Design Decisions

- All UI updates derive from `RebaseState` — no separate state stores
- Git worktree paths resolved via `git rev-parse --git-dir`, not assumed `.git`
- Conflict causation computed at read time (which target commits touched each conflicting file)
- Extension activates only in git repos (`workspaceContains:.git`)
- SCM panel visibility gated by `rebaseflow.isRebasing` context flag

## Current Limitations (v0.1)

- `rebase-merge` format only (standard rebase and `-i` flags; no `rebase-apply`)
- Conflicts resolved via VS Code's native merge editor
- Single-root workspaces only

## Conventions

- Module system: CommonJS (required by VS Code)
- Target: ES2020
- Compiled output in `out/`, source maps enabled
- No linter configured yet
