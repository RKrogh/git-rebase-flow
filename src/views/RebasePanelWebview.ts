import * as vscode from 'vscode';
import { RebaseState } from '../models/RebaseState';
import { GitCli } from '../git/GitCli';
import { webviewCss } from './webview/styles';
import { webviewScript } from './webview/script';
import { esc, buildRebasedSection, buildPendingSection, buildDivergenceSection, buildForkSection } from './webview/sections';

export class RebasePanelWebview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private isEditing = false;
  private git: GitCli | null = null;
  private currentState: RebaseState | null = null;
  private tmpDir: string | null = null;
  private rebuildNonce = 0;

  setGit(git: GitCli): void { this.git = git; }

  show(context: vscode.ExtensionContext, state: RebaseState): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'rebaseflow.panel',
        'RebaseFlow',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );
      this.panel.onDidDispose(() => { this.panel = null; this.isEditing = false; });
      this.panel.webview.onDidReceiveMessage(msg => {
        switch (msg.command) {
          case 'openFile':
            if (msg.file) { this.openConflictFile(msg.file); }
            break;
          case 'enterEditMode':
            this.isEditing = true;
            break;
          case 'exitEditMode':
            this.isEditing = false;
            if (this.currentState) { this.forceRebuild(this.currentState); }
            break;
          case 'editTodo':
            this.isEditing = false;
            vscode.commands.executeCommand('rebaseflow.applyTodoEdits', { edits: msg.edits });
            // The command calls watcher.forceRefresh() after writing,
            // which fires onStateChanged → update() with fresh state.
            break;
          default:
            vscode.commands.executeCommand(`rebaseflow.${msg.command}`);
        }
      });
    }
    this.update(state);
  }

  update(state: RebaseState): void {
    if (!this.panel || this.isEditing) { return; }

    // Close stale merge editors when the conflict commit changes
    // (conflict resolved, moved to next commit, or rebase step advanced)
    const prevHash = this.currentState?.currentCommit?.hash;
    const nextHash = state.currentCommit?.hash;
    if (prevHash && prevHash !== nextHash) {
      this.closeStaleMergeEditors();
    }

    this.currentState = state;
    this.panel.webview.html = this.buildHtml(state);
  }

  /** Force a full HTML rebuild, bypassing the isEditing guard.
   *  Bumps rebuildNonce so VS Code sees a different HTML string
   *  (it skips the reload when the string is identical). */
  private forceRebuild(state: RebaseState): void {
    if (!this.panel) { return; }
    this.rebuildNonce++;
    this.panel.webview.html = this.buildHtml(state);
  }

  close(): void {
    this.closeStaleMergeEditors();
    this.panel?.dispose();
    this.panel = null;
    this.cleanupTmpDir();
  }

  dispose(): void {
    this.close();
  }

  // ── Merge editor with labeled panes ─────────────────────────────────────

  private async openConflictFile(file: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { return; }

    const fileUri = vscode.Uri.joinPath(root, file);
    const s = this.currentState;

    // Attempt 1: _open.mergeEditor with custom labels (internal API)
    if (this.git && s) {
      const base   = this.git.readIndexStage(file, 1);
      const ours   = this.git.readIndexStage(file, 2);
      const theirs = this.git.readIndexStage(file, 3);

      if (base !== null && ours !== null && theirs !== null) {
        const tmpFiles = this.writeTmpFiles(file, base, ours, theirs);
        const commitMsg = s.currentCommit?.message ?? '';
        const shortMsg = commitMsg.length > 60
          ? commitMsg.substring(0, 57) + '...' : commitMsg;

        try {
          await vscode.commands.executeCommand('_open.mergeEditor', {
            base: vscode.Uri.file(tmpFiles.base),
            input1: {
              uri: vscode.Uri.file(tmpFiles.ours),
              title: `\uD83D\uDD35 Target (${s.targetRef})`,
              description: 'current HEAD',
              detail: 'ours \u2014 the branch you are rebasing onto',
            },
            input2: {
              uri: vscode.Uri.file(tmpFiles.theirs),
              title: `\uD83D\uDFE0 ${s.sourceBranch}`,
              description: shortMsg,
              detail: 'theirs \u2014 the commit being replayed',
            },
            output: fileUri,
          });
          return;
        } catch (err) {
          console.warn('RebaseFlow: _open.mergeEditor failed:', err);
        }
      }
    }

    // Attempt 2: git extension's merge editor (reliable, no custom labels)
    try {
      await vscode.commands.executeCommand('git.openMergeEditor', fileUri);
      return;
    } catch {
      // git extension might not expose this command
    }

    // Attempt 3: open the file — VS Code shows inline merge decorations for conflicted files
    await vscode.window.showTextDocument(fileUri);
  }

  private writeTmpFiles(file: string, base: string, ours: string, theirs: string): { base: string; ours: string; theirs: string } {
    const fs   = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os   = require('os') as typeof import('os');

    if (!this.tmpDir || !fs.existsSync(this.tmpDir)) {
      this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseflow-'));
    }

    const safeName = file.replace(/[/\\]/g, '_');
    const basePath   = path.join(this.tmpDir, `base_${safeName}`);
    const oursPath   = path.join(this.tmpDir, `target_${safeName}`);
    const theirsPath = path.join(this.tmpDir, `yours_${safeName}`);

    fs.writeFileSync(basePath, base, 'utf8');
    fs.writeFileSync(oursPath, ours, 'utf8');
    fs.writeFileSync(theirsPath, theirs, 'utf8');

    return { base: basePath, ours: oursPath, theirs: theirsPath };
  }

  private cleanupTmpDir(): void {
    if (!this.tmpDir) { return; }
    try {
      const fs = require('fs') as typeof import('fs');
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
    this.tmpDir = null;
  }

  /** Close any merge editor tabs we opened so they don't linger with stale temp files. */
  private closeStaleMergeEditors(): void {
    if (!this.tmpDir) { return; }
    const dir = this.tmpDir;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        // Duck-type: merge editor tabs have base/input1/input2 URIs
        // (TabInputTextMerge not in @types/vscode@1.85)
        const input = tab.input as any;
        if (input?.base?.fsPath && input?.input1?.fsPath && input?.input2?.fsPath) {
          const isMine = [input.base, input.input1, input.input2].some(
            (uri: any) => typeof uri.fsPath === 'string' && uri.fsPath.startsWith(dir),
          );
          if (isMine) {
            vscode.window.tabGroups.close(tab).then(undefined, () => {});
          }
        }
      }
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────

  private buildHtml(s: RebaseState): string {
    const progress = s.totalCount > 0
      ? Math.round((s.doneCount / s.totalCount) * 100) : 0;

    // Conflict analysis
    const conflictBaseHashes = new Set<string>();
    const causationByFile = new Map<string, string[]>();
    for (const c of s.conflictCausation) {
      for (const h of c.baseCommitHashes) { conflictBaseHashes.add(h); }
      causationByFile.set(c.file, c.baseCommitHashes);
    }

    const rebasedSection = buildRebasedSection(s, causationByFile);
    const pendingSection = buildPendingSection(s);
    const divergenceSection = buildDivergenceSection(s, conflictBaseHashes, s.pendingCommits.length > 0);
    const forkSection = buildForkSection(s);

    // Separator: dashed line across, main rail passes through at column 2
    // Feature rail only bridges when both pending (above) and originals (below) exist
    const hasOriginals = s.doneCommits.length > 0 || s.currentCommit !== null;
    const hasPending = s.pendingCommits.length > 0;
    const needsFeatBridge = hasOriginals && hasPending;
    const separator = `<div class="separator-grid">
      <div></div>
      <div><div class="rail rail-main rail-no-node separator-rail"></div></div>
      <div></div>
      <div>${needsFeatBridge ? '<div class="rail rail-feature rail-no-node separator-rail"></div>' : ''}</div>
      <div></div>
    </div>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="rebuild" content="${this.rebuildNonce}">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${webviewCss()}</style>
</head>
<body>

<div class="header">
  <div class="branch-row">
    <span class="tag tag-src">${esc(s.sourceBranch)}</span>
    <span class="arrow">\u2192</span>
    <span class="tag tag-tgt">${esc(s.targetRef)}</span>
  </div>
  <div class="progress-wrap"><div class="progress-fill" style="width:${progress}%"></div></div>
  <div class="progress-label">${s.doneCount} of ${s.totalCount} commits applied</div>
</div>

<div class="graph">
  ${rebasedSection}
  ${pendingSection}
  ${separator}
  ${divergenceSection}
  ${forkSection}
</div>

<div class="controls">
  <button class="btn btn-abort" onclick="send('abort')">\u2715 Abort</button>
  <button class="btn btn-skip"  onclick="send('skip')">Skip commit</button>
  <div class="spacer"></div>
  <span class="status-text">commit ${s.doneCount + (s.currentCommit ? 1 : 0)}/${s.totalCount}</span>
  <button class="btn btn-cont" onclick="send('continue')">Continue \u21B5</button>
</div>

<script>${webviewScript()}</script>
</body>
</html>`;
  }
}
