# RebaseFlow

<img width="1309" height="1282" alt="image" src="https://github.com/user-attachments/assets/69a36269-affb-41de-a024-fa54b8255f09" />

A VS Code extension that makes `git rebase` not suck.

Persistent side panel showing the full rebase graph — where you've been, where you are, and what's left — with controls to continue, skip, or abort without leaving the editor.

## Features

- **Visual git graph** — colored rail lines showing target base, fork point, your rebased commits, and original branch side-by-side
- **Conflict causation** — highlights which target commits caused each conflict
- **Auto-activates** on rebase start, auto-closes on finish
- **Continue / Skip / Abort** controls with abort confirmation
- **Reactive** — updates instantly as you resolve files

## Install

Not yet on the marketplace. Build from source:

**Prerequisites:** Node.js 20+, VS Code 1.85+

```bash
git clone <repo-url> && cd rebaseflow
npm install && npm run compile
```

**Package & install (PowerShell):**

```powershell
npx @vscode/vsce package --allow-missing-repository
code --install-extension rebaseflow-0.1.0.vsix
```

**Or run from source:** open the folder in VS Code, press `F5` to launch the Extension Development Host.

> `Ctrl+Shift+F5` restarts the host after code changes. `npm run watch` gives live recompilation.

## Usage

Start a rebase as normal (`git rebase main`, `git rebase -i HEAD~5`, etc.) — the panel opens automatically.

### Graph layout

| Section | Description |
|---|---|
| **Rebased (new)** | Your commits replayed onto the target, with new hashes |
| **Divergence** | Side-by-side: target branch commits (left) vs your originals (right) |
| **Fork point** | Where your branch diverged, with a curve connecting both rails |

### Resolving conflicts

1. Panel highlights the current commit and lists conflicting files (click to open)
2. Resolve files manually or via VS Code's merge editor
3. Stage resolved files, then click **Continue**

### Controls

| Action | Panel button | Command palette |
|---|---|---|
| Continue | **Continue** | `RebaseFlow: Continue Rebase` |
| Skip | **Skip commit** | `RebaseFlow: Skip Commit` |
| Abort | **Abort** | `RebaseFlow: Abort Rebase` |

Re-open a closed panel: `Ctrl+Shift+P` → `RebaseFlow: Open Panel`

## Configuration

| Setting | Effect |
|---|---|
| `git.path` | Custom path to git executable |

## Limitations (v0.1)

- `rebase-merge` format only (standard `git rebase` and `-i`). `rebase-apply` not yet supported.
- Conflict resolution uses VS Code's native editor. Custom ours/theirs diff planned for v0.2.
- Single-root workspaces only (multi-root uses first folder).

## Project structure

```
src/
  extension.ts              # entry point
  models/RebaseState.ts     # shared types
  git/
    GitCli.ts               # git shell wrapper
    RebaseStateReader.ts    # .git/rebase-merge/* → RebaseState
    RebaseStateWatcher.ts   # FileSystemWatcher + debounce
  views/
    RebaseTreeProvider.ts   # SCM sidebar tree
    RebasePanelWebview.ts   # editor webview panel
  commands/index.ts         # continue / skip / abort
```

## Roadmap

- **v0.2** — Custom two-pane conflict diff (ours vs theirs)
- **v0.3** — Per-hunk accept ours/theirs buttons
- **v0.4** — Interactive rebase todo list editor
- **v1.0** — Marketplace publish

## Contributing

PRs welcome. Run `npm run watch` during development.

## License

MIT
