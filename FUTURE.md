# RebaseFlow — Future Ideas

Ideas parked here for future sessions. Not prioritized.

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

## Custom Merge Editor Labels (via `_open.mergeEditor`)

Already partially implemented: clicking a conflict file tries `merge-editor.open`. Could be upgraded to use the internal `_open.mergeEditor` command which accepts custom titles per pane:

- Input 1 (Current/ours): `"🔵 Target (branch-name)"` — the target branch
- Input 2 (Incoming/theirs): `"🟠 Your commit — message"` — the commit being replayed
- Base: common ancestor

**Requires:** GitCli access in the webview (or a registered command), extracting 3 index stages, writing temp files. ~80 lines.

**Note:** `_open.mergeEditor` is a VS Code internal command (prefixed `_`). Stable since 1.70+ but could break. Fallback chain: `_open.mergeEditor` → `merge-editor.open` → `showTextDocument`.

---

## Auto-resolve Trivial Conflicts

Detect conflicts where one side is unchanged from base (only the other side modified). These can be auto-resolved safely. Show a "Auto-resolve N trivial conflicts" button.

---

## Conflict Preview Inline

Show a compact inline diff of each conflict hunk directly in the panel (collapsed by default, expandable). Helps assess severity without opening the file.
