# RebaseFlow

A VS Code extension that makes `git rebase` not suck.

Replaces the native conflict UX with a persistent side panel showing the full rebase tree — where you've been, where you are, and what's left — while giving you clean controls to continue, skip, or abort without leaving the editor.

---

## Features (v0.1)

- **Git tree visualization** — see base branch commits, your commits stacked on top, the fork point, and progress through the rebase at a glance
- **Auto-activates** when a rebase starts, auto-closes when it finishes
- **Editor panel** with current commit info, conflict file list, and progress indicator
- **Continue / Skip / Abort** controls with confirmation on abort
- **Reactive** — updates instantly as you resolve files, no manual refresh

---

## Installation (development)

The extension isn't published to the marketplace yet. Run it from source:

**Prerequisites**
- Node.js 18+
- VS Code 1.85+

```bash
git clone <your-repo-url>
cd rebaseflow
npm install
npm run compile
```

Then in VS Code:

1. Open the `rebaseflow` folder (`File → Open Folder`)
2. Press `F5` — this opens an **Extension Development Host** window with the extension loaded
3. In that window, open any git repository and start a rebase

> For subsequent runs after changing code, press `Ctrl+Shift+F5` to restart the host, or run `npm run watch` to get live recompilation.

---

## Usage

### Starting a rebase

Start a rebase as you normally would in the terminal:

```bash
git rebase main
# or
git rebase -i HEAD~5
```

The RebaseFlow panel opens automatically in the editor area and the **RebaseFlow** section appears in the Source Control sidebar.

### Reading the tree

The sidebar tree shows two sections:

| Section | What you see |
|---|---|
| **Target base** | Commits on the target branch above the fork point |
| **Your commits** | Your commits being replayed, in order |

Node states:

- Base commit (on target branch)
- Fork point (where your branch diverged)
- Applied cleanly
- **Current** — rebase is paused here (conflict or edit stop)
- Pending — not yet applied

### Resolving conflicts

When the rebase pauses on a conflict:

1. The editor panel highlights the current commit and lists conflicting files
2. Resolve each conflicting file manually or via VS Code's built-in merge editor
3. Stage the resolved files via the Source Control view or `git add <file>` in the terminal
4. Click **Continue** in the panel

### Controls

| Action | Panel button | Command palette |
|---|---|---|
| Continue rebase | **Continue** | `RebaseFlow: Continue Rebase` |
| Skip this commit | **Skip commit** | `RebaseFlow: Skip Commit` |
| Abort entirely | **Abort** | `RebaseFlow: Abort Rebase` |

Abort shows a confirmation dialog — it resets your branch to its pre-rebase state.

### Re-opening the panel

If you accidentally close the editor panel mid-rebase:

```
Ctrl+Shift+P → RebaseFlow: Open Panel
```

---

## Configuration

RebaseFlow respects VS Code's existing git settings:

| Setting | Effect |
|---|---|
| `git.path` | Path to the git executable — useful if git isn't on `PATH` or you use a custom build |

---

## Limitations (v0.1)

- **`rebase-merge` format only** — covers standard `git rebase` and `git rebase -i`. The `rebase-apply` format (used by some `--onto` invocations and `git am`) is not yet supported.
- **Conflict resolution is native** — files open in VS Code's standard editor. The custom two-pane ours/theirs diff view is planned for v0.2.
- **Single-root workspaces** — multi-root workspaces use the first folder.

---

## Project structure

```
src/
  extension.ts                  # activate() — entry point
  models/
    RebaseState.ts              # shared types
  git/
    GitCli.ts                   # thin git shell wrapper
    RebaseStateReader.ts        # reads .git/rebase-merge/* → RebaseState
    RebaseStateWatcher.ts       # FileSystemWatcher + debounce → events
  views/
    RebaseTreeProvider.ts       # SCM sidebar tree
    RebasePanelWebview.ts       # editor-area webview panel
  commands/
    index.ts                    # continue / skip / abort
```

---

## Roadmap

- **v0.2** — Custom two-pane conflict diff (ours vs theirs) in the webview
- **v0.3** — Per-hunk accept ours / accept theirs buttons
- **v0.4** — Interactive rebase (`-i`) todo list editor in the panel
- **v1.0** — Marketplace publish

---

## Contributing

PRs welcome. Run `npm run watch` during development for live compilation.

A good first contribution: add test fixtures for `RebaseStateReader` using real `.git/rebase-merge` directory snapshots to cover edge cases (empty done file, stopped-sha with no conflict, squash commits, etc.).

---

## License

MIT
