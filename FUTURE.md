# RebaseFlow — Future Ideas & Learnings

Ideas and technical notes for future sessions. Not prioritized.

---

## Built-in Conflict Resolver (webview)

Instead of delegating to VS Code's merge editor, render a conflict resolver directly in the RebaseFlow panel.

**Approach:**
1. Parse conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) from the working file, or extract versions via `git show :2:<file>` (ours/target) and `:3:<file>` (theirs/feature)
2. Render hunks side-by-side in the webview — left column **blue** (target branch), right column **orange** (your branch)
3. Per-hunk buttons: "Accept Left" / "Accept Right" / "Accept Both"
4. Write the resolved file back and `git add` it

**Scope:** ~200-300 lines. v1 skips syntax highlighting (monospace text only). Non-trivial bit is overlapping edits and partial hunk selection.

**Color coding:** Our blue/orange scheme carries naturally into the two columns, unlike VS Code's merge editor which uses theme-controlled colors.

---

## Auto-resolve Trivial Conflicts

Detect conflicts where one side is unchanged from base (only the other side modified). These can be auto-resolved safely. Show a "Auto-resolve N trivial conflicts" button.

---

## Conflict Preview Inline

Show a compact inline diff of each conflict hunk directly in the panel (collapsed by default, expandable). Helps assess severity without opening the file.

---

## Upgrade @types/vscode

Currently pinned at 1.85. Upgrading would give us:
- `TabInputTextMerge` class (proper type instead of duck-typing in `closeStaleMergeEditors`)
- Potentially other newer API surface

Check min engine version compatibility before upgrading.

---

# Learnings & Gotchas

Technical notes from implementation sessions. Reference these to avoid re-discovering the same issues.

## `_open.mergeEditor` API (VS Code internal)

**Correct signature:**
```typescript
vscode.commands.executeCommand('_open.mergeEditor', {
  base: vscode.Uri.file(path),           // plain URI, NOT { uri, title }
  input1: { uri, title, description, detail? },  // "ours" / target branch
  input2: { uri, title, description, detail? },  // "theirs" / feature branch
  output: vscode.Uri.file(workingFile),   // field is "output", NOT "result"
});
```

**Common mistakes (hit during development):**
- `base` wrapped in `{ uri, title }` → must be a plain `Uri`
- Field named `result` → correct name is `output`
- Adding `$type: 'full'` discriminator → no discriminator needed
- Fallback command is `git.openMergeEditor`, NOT `merge-editor.open` (doesn't exist as a registered command)

**Labels:** `title` appears as the header text. `description` appears below it. `detail` may appear as tooltip on the colored indicator ball (behavior may vary by VS Code version). The colored emoji balls (🔵/🟠) in the title are the only color customization available — VS Code's merge editor uses its own theme colors for diff highlighting.

## Git Rebase Identity Crisis

In a rebase, git's "ours" and "theirs" are swapped from what you'd expect:
- **Stage 2 (ours/current)** = the **target branch** (main/master) — the branch you're rebasing *onto*
- **Stage 3 (theirs/incoming)** = **your feature branch** — the commit being replayed

This is the opposite of merge behavior. Our color coding:
- 🔵 Blue = target/ours/stage 2 = `input1`
- 🟠 Orange = feature/theirs/stage 3 = `input2`

## Worktree Branch Resolution

`git name-rev` can return worktree branch names instead of the actual target branch. Fix: use `git for-each-ref --points-at <sha> refs/heads/` first (finds branches whose tip is exactly the onto commit), then fall back to `name-rev --refs=refs/heads/*` (restricts to branch refs, excludes worktree HEADs).

## Rail Continuity in the Webview

The webview uses CSS `::before` (line above node) and `::after` (line below node) pseudo-elements on rail cells. Key rules:
- `rail-cap-top` hides `::before` → use on the topmost node of a section to prevent orphan lines
- `rail-no-node` draws a passthrough line with no dot → used in separators/headers to bridge sections
- Only render connecting rails when BOTH adjacent sections have content on that rail
- The feature rail in the divergence header row should only render when `hasPendingAbove` is true
- The first commit in the divergence section gets `rail-cap-top` when `!hasPendingAbove`

## Stale Merge Editor Tabs

After a conflict is resolved and the rebase continues, merge editor tabs become stale (temp files may be invalid). Solution: detect conflict state changes in `update()` by comparing `currentCommit.hash`, and proactively close merge editor tabs whose input URIs point to our temp directory. Duck-type `TabInputTextMerge` since it's not in @types/vscode@1.85 — check for `input.base.fsPath && input.input1.fsPath && input.input2.fsPath`.

## Watcher Self-Trigger & Force Refresh

Writing to `git-rebase-todo` triggers the FileSystemWatcher which rebuilds state and stomps the UI. Pattern: call `suppressFor(400)` before writing (prevents the file-watcher from double-firing), then `forceRefresh()` after writing (explicit re-read + event fire, bypasses suppression). This replaced an earlier timer-based approach that was unreliable.

## Interactive Editing DOM Stability

The `isEditing` flag on the extension side prevents `update()` from rebuilding the webview HTML while the user is dragging/editing pending commits. Edit state lives entirely in webview JS (`pendingEdits` array). Only sent to extension on "Apply Changes".

On Cancel, `forceRebuild()` rebuilds from `currentState` (the last state before editing). On Apply, `forceRefresh()` re-reads from disk so the new todo order is reflected.

## VS Code Webview HTML Caching

Setting `webview.html` to the same string it already contains is a **silent no-op** — VS Code detects the identical string and skips the page reload. This is a problem when Cancel needs to reset DOM changes (drag reorder) but the underlying state hasn't changed, so `buildHtml()` produces the same output. Fix: a `rebuildNonce` counter is injected as `<meta name="rebuild" content="N">` and incremented in `forceRebuild()`, ensuring each call produces a unique HTML string.

## Drag-and-Drop Rail Continuity

After HTML5 drag-and-drop reorders pending rows, the `rail-cap-top` CSS class (which hides the line-above-node pseudo-element) stays stuck on whichever row was originally first. The webview JS `updateRailCaps()` function re-evaluates the DOM order on `dragend` and moves the class to the actual first row.
