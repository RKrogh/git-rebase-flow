# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RebaseFlow is a VS Code extension that provides a visual interface for git rebase operations. It shows a persistent side panel with a dual-rail graph visualization of rebase progress, conflict causation highlighting, continue/skip/abort controls, and interactive editing of pending commits. Currently v0.2-dev, pre-marketplace.

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

- **`src/extension.ts`** — Entry point. Wires up watcher, views, and commands. Passes `GitCli` to webview via `setGit()`.
- **`src/models/RebaseState.ts`** — Shared interfaces. Commit statuses: `'base' | 'done' | 'current' | 'pending'`. Includes `ConflictCausation`, `RebaseAction`, `PendingEdit`, and `TodoEditPayload` types.
- **`src/git/GitCli.ts`** — Shell wrapper for git commands. Resolves actual git dir (supports worktrees). Includes `readIndexStage()` for conflict stage extraction.
- **`src/git/RebaseStateReader.ts`** — Parses `.git/rebase-merge/*` files into `RebaseState`. Preserves action verbs (pick/squash/etc.) from todo files.
- **`src/git/RebaseStateWatcher.ts`** — FileSystemWatcher with debounce, emits state change events. Has `suppressFor(ms)` to prevent self-triggering after writes, and `forceRefresh()` for explicit re-reads.
- **`src/git/RebaseTodoWriter.ts`** — Writes modified todo list back to `git-rebase-todo`. Validates hashes against current state to reject stale edits.
- **`src/views/RebaseTreeProvider.ts`** — VS Code `TreeDataProvider` for SCM sidebar. Shows `[action]` prefix for non-pick pending commits.
- **`src/views/RebasePanelWebview.ts`** — Full webview panel with inline HTML/CSS/JS graph. Includes merge editor integration, pending commit editing, and stale-tab cleanup.
- **`src/commands/index.ts`** — Continue/skip/abort/applyTodoEdits command handlers. `applyTodoEdits` writes todo then calls `watcher.forceRefresh()` to propagate new state.

### Key Design Decisions

- All UI updates derive from `RebaseState` — no separate state stores
- Git worktree paths resolved via `git rev-parse --git-dir`, not assumed `.git`
- Conflict causation computed at read time (which target commits touched each conflicting file)
- Extension activates only in git repos (`workspaceContains:.git`)
- SCM panel visibility gated by `rebaseflow.isRebasing` context flag
- `isEditing` flag prevents HTML rebuilds during drag-and-drop editing
- Merge editor tabs auto-close when conflict state changes (prevents stale "file not found" errors)
- Target branch resolution uses `for-each-ref --points-at` → `name-rev --refs=refs/heads/*` to avoid worktree ref pollution

### Webview Layout (5-column CSS grid)

```
col 1 (1fr)          — blue/target content (left side)
col 2 (var(--rail-w)) — blue rail (target branch line)
col 3 (12px)          — center gap
col 4 (var(--rail-w)) — orange rail (feature branch line)
col 5 (1fr)          — orange/feature content (right side)
```

Sections render top-to-bottom: **rebased section** (done + current commits) → **pending section** (editable) → **separator** → **divergence section** (original commits, mirrored layout) → **fork point**.

Rail continuity: `rail-cap-top` hides `::before` pseudo-element. Only render connecting rails between sections when both adjacent sections have content on that rail.

### Merge Editor Integration

Uses `_open.mergeEditor` internal VS Code command (stable since 1.70+) with fallback chain:
1. `_open.mergeEditor` — custom labels with 🔵/🟠 indicators + branch names
2. `git.openMergeEditor` — standard merge editor
3. `showTextDocument` — plain file with inline conflict markers

API signature: `{ base: Uri, input1: { uri, title, description, detail? }, input2: { uri, title, description, detail? }, output: Uri }`

Temp files written to OS temp dir, cleaned up on panel close. Merge editor tabs tracked via duck-typed `TabInputTextMerge` (not in @types/vscode@1.85) and closed proactively when conflict state changes.

### Interactive Rebase Editing

Pending commits can be reordered (HTML5 drag-and-drop) and have their action changed (pick/reword/edit/squash/fixup/drop) via dropdown. Edit state lives in webview JS. On "Apply Changes", the modified list is sent to the extension which writes `git-rebase-todo` via `RebaseTodoWriter`. After writing, the command calls `watcher.forceRefresh()` to re-read state from disk and propagate to all views.

**Edit mode lifecycle:**
1. User clicks "Edit" → webview sends `enterEditMode` → extension sets `isEditing = true` (blocks `update()`)
2. User drags/changes actions → DOM-only changes, `updateRailCaps()` fixes rail line continuity after reorder
3. "Apply Changes" → `exitEditUi()` resets webview chrome, sends `editTodo` → extension writes file, `forceRefresh()` propagates fresh state
4. "Cancel" → `exitEditUi()` resets webview chrome, sends `exitEditMode` → extension calls `forceRebuild()` with nonce to restore original state

**VS Code webview HTML caching gotcha:** Setting `webview.html` to an identical string is a no-op — VS Code skips the reload. The `rebuildNonce` counter ensures `forceRebuild()` always produces a unique string so Cancel reliably resets the DOM after drag-and-drop reordering.

## Current Limitations

- `rebase-merge` format only (standard rebase and `-i` flags; no `rebase-apply`)
- Single-root workspaces only
- `@types/vscode` pinned at 1.85 — `TabInputTextMerge` not available, duck-typed instead
- `_open.mergeEditor` is an internal VS Code command (prefixed `_`) — could break in future VS Code versions

## Conventions

- Module system: CommonJS (required by VS Code)
- Target: ES2020
- Compiled output in `out/`, source maps enabled
- No linter configured yet
- Color scheme: blue = target/base branch, orange = your feature branch (consistent across tree, webview, and merge editor)
- Animations: `breathe-wax`/`breathe-wane` (4s) for active nodes, `settle-in`/`settle-out` (1.6s) for transitions
