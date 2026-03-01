import * as vscode from 'vscode';
import { RebaseState } from '../models/RebaseState';

export class RebasePanelWebview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;

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

      this.panel.onDidDispose(() => { this.panel = null; });

      // Messages from webview → extension host
      this.panel.webview.onDidReceiveMessage(msg => {
        vscode.commands.executeCommand(`rebaseflow.${msg.command}`);
      });
    }

    this.update(state);
  }

  update(state: RebaseState): void {
    if (!this.panel) { return; }
    this.panel.webview.html = this.buildHtml(state);
  }

  close(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  dispose(): void { this.close(); }

  // ── HTML generation ──────────────────────────────────────────────────────

  private buildHtml(s: RebaseState): string {
    const progress = s.totalCount > 0
      ? Math.round((s.doneCount / s.totalCount) * 100)
      : 0;

    const baseRows   = s.baseCommits.map(c => this.commitRow(c)).join('');
    const doneRows   = s.doneCommits.map(c => this.commitRow(c)).join('');
    const currentRow = s.currentCommit ? this.commitRow(s.currentCommit) : '';
    const pendingRows = s.pendingCommits.map(c => this.commitRow(c, true)).join('');

    const conflictSection = s.currentCommit?.conflictFiles?.length
      ? `<div class="conflict-panel">
          <div class="conflict-header">⚡ Conflicts in this commit</div>
          ${s.currentCommit.conflictFiles.map(f => `<div class="conflict-file">⚡ ${f}</div>`).join('')}
         </div>`
      : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --accent:  #4af0a4;
    --warn:    #f06060;
    --caution: #f0c84a;
    --info:    #6a9ef0;
    --muted:   var(--vscode-descriptionForeground);
    --border:  var(--vscode-panel-border, #333);
  }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 0; margin: 0; color: var(--vscode-foreground); }

  /* ── Header ── */
  .header { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .branch-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
  .tag { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .tag-src { background: rgba(106,158,240,.15); color: var(--info); border: 1px solid rgba(106,158,240,.3); }
  .tag-tgt { background: rgba(74,240,164,.1); color: var(--accent); border: 1px solid rgba(74,240,164,.25); }
  .progress-wrap { background: var(--vscode-progressBar-background, #333); border-radius: 2px; height: 3px; margin-bottom: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width .4s ease; }
  .progress-label { font-size: 11px; color: var(--muted); text-align: right; }

  /* ── Tree ── */
  .tree { padding: 8px 0; }
  .section-label { font-size: 10px; letter-spacing: .1em; color: var(--muted); padding: 6px 16px 3px; text-transform: uppercase; }
  .commit-row { display: flex; align-items: flex-start; padding: 4px 16px; gap: 10px; }
  .commit-row.active { background: rgba(240,200,74,.06); border-left: 2px solid var(--caution); padding-left: 14px; }
  .commit-row.done { opacity: .85; }
  .commit-row.pending { opacity: .45; }
  .node-col { display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0; padding-top: 4px; }
  .node { width: 10px; height: 10px; border-radius: 50%; border: 2px solid; flex-shrink: 0; }
  .n-base    { border-color: var(--info); }
  .n-fork    { border-color: var(--caution); background: rgba(240,200,74,.15); }
  .n-done    { border-color: var(--accent); background: var(--accent); }
  .n-current { border-color: var(--warn); background: rgba(240,96,96,.2); }
  .n-pending { border-color: var(--muted); }
  .commit-info { flex: 1; min-width: 0; }
  .commit-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .commit-hash { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--info); }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 2px; }
  .badge-done    { background: rgba(74,240,164,.1); color: var(--accent); }
  .badge-current { background: rgba(240,200,74,.1); color: var(--caution); }
  .badge-pending { background: rgba(100,100,100,.15); color: var(--muted); }
  .commit-msg { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .commit-meta { font-size: 11px; color: var(--muted); }
  .conflict-files { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 3px; }
  .file-chip { font-size: 10px; padding: 1px 6px; border-radius: 2px; }
  .fc-conflict { background: rgba(240,96,96,.1); color: var(--warn); }
  .fc-clean    { background: rgba(100,100,100,.1); color: var(--muted); }
  .fork-row { display: flex; align-items: center; padding: 4px 16px; gap: 10px; color: var(--muted); font-size: 11px; }

  /* ── Conflict panel ── */
  .conflict-panel { margin: 8px 16px; border: 1px solid rgba(240,96,96,.3); border-radius: 4px; overflow: hidden; }
  .conflict-header { padding: 6px 12px; background: rgba(240,96,96,.08); font-size: 11px; color: var(--warn); font-weight: 600; }
  .conflict-file { padding: 5px 12px; font-size: 11px; border-top: 1px solid rgba(240,96,96,.1); color: var(--warn); font-family: var(--vscode-editor-font-family); }

  /* ── Controls ── */
  .controls { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 16px; border-top: 1px solid var(--border); background: var(--vscode-editor-background); display: flex; gap: 8px; align-items: center; }
  button { font-family: var(--vscode-font-family); font-size: 12px; padding: 5px 14px; border-radius: 3px; border: 1px solid; cursor: pointer; }
  .btn-abort   { border-color: rgba(240,96,96,.5); color: var(--warn); background: rgba(240,96,96,.08); }
  .btn-skip    { border-color: rgba(106,158,240,.5); color: var(--info); background: rgba(106,158,240,.08); }
  .btn-cont    { border-color: var(--accent); color: #000; background: var(--accent); font-weight: 600; }
  .btn-abort:hover { background: rgba(240,96,96,.18); }
  .btn-skip:hover  { background: rgba(106,158,240,.18); }
  .btn-cont:hover  { filter: brightness(1.1); }
  .spacer { flex: 1; }
  .status-text { font-size: 11px; color: var(--muted); }
  body { padding-bottom: 54px; }
</style>
</head>
<body>

<div class="header">
  <div class="branch-row">
    <span class="tag tag-src">${this.esc(s.sourceBranch)}</span>
    <span>→</span>
    <span class="tag tag-tgt">${this.esc(s.targetRef)}</span>
  </div>
  <div class="progress-wrap">
    <div class="progress-fill" style="width:${progress}%"></div>
  </div>
  <div class="progress-label">${s.doneCount} of ${s.totalCount} commits applied</div>
</div>

<div class="tree">
  <div class="section-label">Target base</div>
  ${baseRows}
  <div class="fork-row">
    <div class="node-col"><div class="node n-fork"></div></div>
    <span>fork point · ${this.esc(s.forkPointHash.substring(0, 7))}</span>
  </div>

  <div class="section-label" style="margin-top:8px">Your commits (rebasing)</div>
  ${doneRows}
  ${currentRow}
  ${pendingRows}
</div>

${conflictSection}

<div class="controls">
  <button class="btn-abort" onclick="send('abort')">✕ Abort</button>
  <button class="btn-skip"  onclick="send('skip')">Skip commit</button>
  <div class="spacer"></div>
  <span class="status-text">commit ${s.doneCount + (s.currentCommit ? 1 : 0)}/${s.totalCount}</span>
  <button class="btn-cont" onclick="send('continue')">Continue ↵</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function send(command) { vscode.postMessage({ command }); }
</script>
</body>
</html>`;
  }

  private commitRow(c: import('../models/RebaseState').CommitInfo, faded = false): string {
    const statusClass = faded ? 'pending' : c.status === 'done' ? 'done' : c.status === 'current' ? 'active' : '';
    const nodeClass   = `n-${c.status}`;
    const badge       = c.status === 'done'    ? '<span class="badge badge-done">✓ applied</span>'
                      : c.status === 'current' ? '<span class="badge badge-current">▶ current</span>'
                      : c.status === 'pending' ? '<span class="badge badge-pending">pending</span>'
                      : '';

    const fileChips = c.conflictFiles?.length
      ? `<div class="conflict-files">${c.conflictFiles.map(f => `<span class="file-chip fc-conflict">${this.esc(f)}</span>`).join('')}</div>`
      : '';

    const meta = [c.author, c.date].filter(Boolean).join(' · ');

    return `<div class="commit-row ${statusClass}">
      <div class="node-col"><div class="node ${nodeClass}"></div></div>
      <div class="commit-info">
        <div class="commit-top">
          <span class="commit-hash">${this.esc(c.shortHash || c.hash.substring(0,7))}</span>
          ${badge}
        </div>
        <div class="commit-msg">${this.esc(c.message)}</div>
        ${meta ? `<div class="commit-meta">${this.esc(meta)}</div>` : ''}
        ${fileChips}
      </div>
    </div>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
