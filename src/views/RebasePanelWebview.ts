import * as vscode from 'vscode';
import { RebaseState, CommitInfo, ConflictCausation } from '../models/RebaseState';

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
      this.panel.webview.onDidReceiveMessage(msg => {
        if (msg.command === 'openFile' && msg.file) {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (root) {
            vscode.window.showTextDocument(vscode.Uri.joinPath(root, msg.file));
          }
        } else {
          vscode.commands.executeCommand(`rebaseflow.${msg.command}`);
        }
      });
    }
    this.update(state);
  }

  update(state: RebaseState): void {
    if (!this.panel) { return; }
    this.panel.webview.html = this.buildHtml(state);
  }

  close(): void { this.panel?.dispose(); this.panel = null; }
  dispose(): void { this.close(); }

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

    const rebasedSection = this.buildRebasedSection(s, causationByFile);
    const divergenceSection = this.buildDivergenceSection(s, conflictBaseHashes);
    const forkSection = this.buildForkSection(s);

    // Separator: main rail passes through, dashed line to the right
    const separator = `<div class="separator-wrap">
      <div class="rail rail-main rail-no-node separator-rail"></div>
      <div class="separator-line"></div>
    </div>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${this.css()}</style>
</head>
<body>

<div class="header">
  <div class="branch-row">
    <span class="tag tag-src">${this.esc(s.sourceBranch)}</span>
    <span class="arrow">\u2192</span>
    <span class="tag tag-tgt">${this.esc(s.targetRef)}</span>
  </div>
  <div class="progress-wrap"><div class="progress-fill" style="width:${progress}%"></div></div>
  <div class="progress-label">${s.doneCount} of ${s.totalCount} commits applied</div>
</div>

<div class="graph">
  ${rebasedSection}
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

<script>
const vscode = acquireVsCodeApi();
function send(cmd) { vscode.postMessage({ command: cmd }); }
function openFile(f) { vscode.postMessage({ command: 'openFile', file: f }); }
</script>
</body>
</html>`;
  }

  // ── Rebased section: replay (top) + done commits (below) ─────────────
  // Combined into one section so the ordering matches the orange originals:
  // current commit at top (newest being added), done commits below (newest first).
  // Rail: dotted blue for replay row, solid blue for done rows.

  private buildRebasedSection(
    s: RebaseState,
    causationByFile: Map<string, string[]>,
  ): string {
    const hasCurrent = s.currentCommit !== null;
    const hasDone = s.doneCommits.length > 0;
    if (!hasCurrent && !hasDone) { return ''; }

    const rows: string[] = [];
    let isFirstRow = true;

    // ── Current commit (replay) at the top ──
    if (s.currentCommit) {
      const c = s.currentCommit;
      const hasConflict = (c.conflictFiles?.length ?? 0) > 0;

      const badge = hasConflict
        ? '<span class="badge badge-conflict">\u26A1 conflict</span>'
        : '<span class="badge badge-current-replay">\u25B6 replaying</span>';

      let conflictHtml = '';
      if (hasConflict && c.conflictFiles?.length) {
        const hasAnyCausation = c.conflictFiles.some(f => (causationByFile.get(f) ?? []).length > 0);

        conflictHtml = `<div class="file-list">${
          c.conflictFiles.map(f => {
            const bases = causationByFile.get(f) ?? [];
            const from = bases.length
              ? ` <span class="caused-by">\u2190 ${bases.map(h => {
                  const bc = s.baseCommits.find(b => b.hash === h);
                  const msg = bc?.message ?? '';
                  const label = msg
                    ? `${this.esc(msg.substring(0, 25))} (${h.substring(0, 7)})`
                    : h.substring(0, 7);
                  return label;
                }).join(', ')}</span>`
              : '';
            return `<div class="file-item file-warn conflict-file-item" onclick="openFile('${this.escJs(f)}')">`
              + `\u26A1 ${this.esc(f)}${from}</div>`;
          }).join('')
        }</div>`;

        if (!hasAnyCausation) {
          conflictHtml += `<div class="causation-hint">No divergent target commits \u2014 conflict may be from before the fork point</div>`;
        }
      }

      const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

      rows.push(`<div class="row">
        <div class="rail rail-replay rail-cap-top">
          <div class="node ${hasConflict ? 'node-conflict' : 'node-replay'}"></div>
        </div>
        <div class="content">
          <div class="commit-top">
            <span class="hash">${this.esc(c.shortHash)}</span> ${badge}
          </div>
          <div class="msg">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta">${this.esc(meta)}</div>` : ''}
          ${conflictHtml}
        </div>
      </div>`);
      isFirstRow = false;
    }

    // ── Done commits below (newest first = closest to replay) ──
    const doneReversed = s.doneCommits.slice().reverse();
    for (const c of doneReversed) {
      const capTop = isFirstRow ? 'rail-cap-top' : '';
      isFirstRow = false;

      const hashHtml = c.newShortHash
        ? `<span class="hash hash-old">${this.esc(c.shortHash)}</span>`
          + `<span class="hash-arrow">\u2192</span>`
          + `<span class="hash hash-new">${this.esc(c.newShortHash)}</span>`
        : `<span class="hash">${this.esc(c.shortHash)}</span>`;

      const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

      rows.push(`<div class="row">
        <div class="rail rail-new ${capTop}">
          <div class="node node-new"></div>
        </div>
        <div class="content">
          <div class="commit-top">${hashHtml} <span class="badge badge-done">\u2713 applied</span></div>
          <div class="msg">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta">${this.esc(meta)}</div>` : ''}
        </div>
      </div>`);
    }

    return `<div class="section">
      <div class="section-label">Rebased (new)</div>
      ${rows.join('\n')}
    </div>`;
  }

  // ── Section 4: Divergence (main + feature side by side) ───────────────
  // 5-column grid: [main-rail 32px] [main-content 1fr] [gutter] [feat-rail 32px] [feat-content 1fr]
  // Main rail stays at 0-32px — same position as new/replay/separator sections.

  private buildDivergenceSection(
    s: RebaseState,
    conflictBaseHashes: Set<string>,
  ): string {
    // All originals: oldest first → reverse for newest-at-top
    const allOriginals: CommitInfo[] = [
      ...s.doneCommits,
      ...(s.currentCommit ? [s.currentCommit] : []),
      ...s.pendingCommits,
    ].reverse();

    const maxRows = Math.max(s.baseCommits.length, allOriginals.length, 1);
    const nothingAbove = s.doneCommits.length === 0 && !s.currentCommit;

    const gridRows: string[] = [];

    // Header row — main rail gets continuous no-node rail, feature rail empty
    gridRows.push(`<div class="gc-main-rail">
      <div class="rail rail-main rail-no-node ${nothingAbove ? 'rail-cap-top' : ''}"></div>
    </div>`);
    gridRows.push(`<div class="gc-main-content div-hdr div-hdr-left">Target (${this.esc(s.targetRef)})</div>`);
    gridRows.push('<div class="gc-gutter"></div>');
    gridRows.push('<div class="gc-feat-rail"></div>');
    gridRows.push(`<div class="gc-feat-content div-hdr">Original commits</div>`);

    for (let i = 0; i < maxRows; i++) {
      // ── Main rail + content (columns 1-2) ──
      if (i < s.baseCommits.length) {
        const c = s.baseCommits[i];
        const isCausation = conflictBaseHashes.has(c.hash);
        const causationFiles = this.getCausationFilesForBase(c.hash, s.conflictCausation);
        const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

        let causationHtml = '';
        if (isCausation && causationFiles.length) {
          causationHtml = `<div class="file-list file-list-right">${
            causationFiles.map(f => `<div class="file-item file-warn">\u26A1 ${this.esc(f)}</div>`).join('')
          }</div>`;
        }

        gridRows.push(`<div class="gc-main-rail">
          <div class="rail rail-main">
            <div class="node ${isCausation ? 'node-causation' : 'node-main'}"></div>
          </div>
        </div>`);
        gridRows.push(`<div class="gc-main-content ${isCausation ? 'row-causation' : ''}">
          <div class="commit-top commit-top-right">
            ${isCausation ? '<span class="badge badge-causation">\u26A1 conflict source</span>' : ''}
            <span class="hash hash-main">${this.esc(c.shortHash)}</span>
          </div>
          <div class="msg msg-right">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta meta-right">${this.esc(meta)}</div>` : ''}
          ${causationHtml}
        </div>`);
      } else {
        // Main rail continues (no node) — keeps the line flowing to the fork
        gridRows.push(`<div class="gc-main-rail">
          <div class="rail rail-main rail-no-node"></div>
        </div>`);
        if (i === 0 && s.baseCommits.length === 0) {
          const forkShort = s.forkPointHash ? s.forkPointHash.substring(0, 7) : 'null';
          const ontoShort = s.ontoHash ? s.ontoHash.substring(0, 7) : 'null';
          const sameHash = s.forkPointHash && s.forkPointHash === s.ontoHash;
          gridRows.push(`<div class="gc-main-content">
            <div class="empty-hint">No commits since fork</div>
            <div class="debug-info">
              onto: ${ontoShort} &middot; fork: ${forkShort}${sameHash ? ' <span class="debug-warn">(identical)</span>' : ''}
            </div>
          </div>`);
        } else {
          gridRows.push('<div class="gc-main-content"></div>');
        }
      }

      // ── Gutter (column 3) ──
      gridRows.push('<div class="gc-gutter"></div>');

      // ── Feature rail + content (columns 4-5) ──
      if (i < allOriginals.length) {
        const c = allOriginals[i];
        const isTop = i === 0;
        const isDone = c.status === 'done';
        const isCurrent = c.status === 'current';
        const faded = isDone;

        const nodeCls = isCurrent ? 'node-feature-current'
          : isDone ? 'node-feature-faded'
          : 'node-feature';

        let badge = '';
        if (isDone)         { badge = '<span class="badge badge-faded">applied</span>'; }
        else if (isCurrent) { badge = '<span class="badge badge-current-replay">\u26A1 replaying</span>'; }
        else                { badge = '<span class="badge badge-pending">pending</span>'; }

        gridRows.push(`<div class="gc-feat-rail ${faded ? 'row-faded' : ''}">
          <div class="rail rail-feature ${isTop ? 'rail-cap-top' : ''}">
            <div class="node ${nodeCls}"></div>
          </div>
        </div>`);
        gridRows.push(`<div class="gc-feat-content ${faded ? 'row-faded' : ''}">
          <div class="commit-top">
            <span class="hash hash-feature">${this.esc(c.shortHash)}</span> ${badge}
          </div>
          <div class="msg">${this.esc(c.message)}</div>
        </div>`);
      } else {
        // Feature rail continues (no node) — extends to meet the fork curve
        gridRows.push(`<div class="gc-feat-rail">
          <div class="rail rail-feature rail-no-node"></div>
        </div>`);
        gridRows.push('<div class="gc-feat-content"></div>');
      }
    }

    return `<div class="section section-divergence">
      <div class="divergence-grid">
        ${gridRows.join('\n')}
      </div>
    </div>`;
  }

  // ── Section 5: Fork + history ─────────────────────────────────────────
  // Uses the same 5-column grid so the rails align with divergence above.
  // A CSS border curve branches from the main rail rightward to the feature rail.

  private buildForkSection(s: RebaseState): string {
    return `<div class="section section-fork">
      <div class="fork-grid">
        <div class="gc-main-rail" style="grid-column:1; grid-row:1;">
          <div class="rail rail-main rail-cap-bottom">
            <div class="node node-fork"></div>
          </div>
        </div>
        <div class="gc-fork-branch" style="grid-column:2/5; grid-row:1;">
          <div class="fork-branch-curve"></div>
          <span class="fork-text">Fork \u00B7 ${this.esc(s.forkPointHash.substring(0, 7))}</span>
        </div>
        <div style="grid-column:5; grid-row:1;"></div>
      </div>
      <div class="history-row">
        <div class="rail rail-history"></div>
      </div>
    </div>`;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private getCausationFilesForBase(hash: string, causation: ConflictCausation[]): string[] {
    return causation.filter(c => c.baseCommitHashes.includes(hash)).map(c => c.file);
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private escJs(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  // ── CSS ─────────────────────────────────────────────────────────────────

  private css(): string {
    return /* css */ `
:root {
  --new:      #6aadf0;
  --main:     #c8c8c8;
  --feature:  #e8943a;
  --fork:     #f0c84a;
  --warn:     #f06060;
  --done:     #4af0a4;
  --muted:    var(--vscode-descriptionForeground, #888);
  --border:   var(--vscode-panel-border, #333);
  --bg:       var(--vscode-editor-background, #1e1e1e);
  --fg:       var(--vscode-foreground, #ccc);
  --rail-w:   32px;
}

* { box-sizing: border-box; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--fg);
  margin: 0; padding: 0 16px;
  padding-bottom: 56px;
}

/* ── Header ── */
.header { padding: 12px 0; border-bottom: 1px solid var(--border); }
.branch-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.arrow { color: var(--muted); font-size: 12px; }
.tag { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.tag-src { background: rgba(232,148,58,.12); color: var(--feature); border: 1px solid rgba(232,148,58,.3); }
.tag-tgt { background: rgba(200,200,200,.08); color: var(--main); border: 1px solid rgba(200,200,200,.2); }
.progress-wrap { background: var(--vscode-progressBar-background, #333); border-radius: 2px; height: 3px; margin-bottom: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--new); border-radius: 2px; transition: width .4s ease; }
.progress-label { font-size: 11px; color: var(--muted); text-align: right; }

/* ── Graph ── */
.graph { padding: 8px 0; }
.section { }
.section-label {
  font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
  padding: 6px 0 4px calc(var(--rail-w) + 8px);
}

/* ── Single-column rows (new section, replay section) ── */
.row {
  display: flex;
  align-items: stretch;
  min-height: 44px;
}
.content { flex: 1; min-width: 0; padding: 6px 0 6px 10px; }
.commit-top { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.msg { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.meta { font-size: 11px; color: var(--muted); }

/* Right-aligned (main column content in divergence) */
.commit-top-right { justify-content: flex-end; }
.msg-right { text-align: right; }
.meta-right { text-align: right; }
.file-list-right { text-align: right; }

/* Hashes */
.hash { font-family: var(--vscode-editor-font-family); font-size: 11px; }
.hash-new     { color: var(--new); }
.hash-old     { color: var(--muted); text-decoration: line-through; opacity: .6; }
.hash-main    { color: var(--main); }
.hash-feature { color: var(--feature); }
.hash-arrow   { color: var(--muted); font-size: 10px; }

/* Badges */
.badge { font-size: 10px; padding: 1px 5px; border-radius: 2px; white-space: nowrap; }
.badge-done           { background: rgba(74,240,164,.1);  color: var(--done); }
.badge-current-replay { background: rgba(106,173,240,.12); color: var(--new); }
.badge-conflict       { background: rgba(240,96,96,.15);  color: var(--warn); }
.badge-pending        { background: rgba(100,100,100,.12); color: var(--muted); }
.badge-causation      { background: rgba(240,96,96,.1);   color: var(--warn); font-size: 9px; }
.badge-faded          { background: rgba(100,100,100,.08); color: var(--muted); font-size: 9px; }

/* Row states */
.row-faded { opacity: .4; }
.row-causation { background: rgba(240,96,96,.05); border-radius: 3px; }

/* ── Rails (vertical metro lines + nodes) ── */
.rail {
  width: var(--rail-w);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
}
/* Line above node */
.rail::before {
  content: '';
  position: absolute; top: 0; left: 50%;
  transform: translateX(-50%);
  width: 2px; height: calc(50% - 7px);
}
/* Line below node */
.rail::after {
  content: '';
  position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%);
  width: 2px; height: calc(50% - 7px);
}
.rail-cap-top::before    { display: none; }
.rail-cap-bottom::after  { display: none; }

/* Continuous rail (no node gap) — for separator, empty grid rows */
.rail-no-node::before { height: calc(50% + 1px); }
.rail-no-node::after  { height: calc(50% + 1px); }

/* Rail colors by type */
.rail-new::before,     .rail-new::after     { background: var(--new); }
.rail-main::before,    .rail-main::after    { background: var(--main); }
.rail-feature::before, .rail-feature::after { background: var(--feature); }
.rail-replay::before,  .rail-replay::after  {
  background: none;
  border-left: 2px dashed var(--new);
  width: 0;
}

/* History rail (dashed, below fork) */
.rail-history {
  width: var(--rail-w); height: 36px;
  position: relative;
}
.rail-history::before {
  content: '';
  position: absolute; top: 0; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 100%;
  border-left: 2px dashed var(--muted);
}

/* Nodes */
.node {
  width: 12px; height: 12px;
  border-radius: 50%;
  z-index: 1; flex-shrink: 0;
}
.node-new             { border: 2px solid var(--new);     background: var(--new); }
.node-replay          { border: 2px solid var(--new);     background: var(--new);     box-shadow: 0 0 6px var(--new); }
.node-conflict        { border: 2px solid var(--warn);    background: var(--warn);    box-shadow: 0 0 6px var(--warn); }
.node-main            { border: 2px solid var(--main);    background: var(--bg); }
.node-causation       { border: 2px solid var(--warn);    background: rgba(240,96,96,.15); box-shadow: 0 0 6px rgba(240,96,96,.3); }
.node-feature         { border: 2px solid var(--feature); background: var(--feature); }
.node-feature-current { border: 2px solid var(--feature); background: var(--feature); box-shadow: 0 0 6px var(--feature); }
.node-feature-faded   { border: 2px solid var(--feature); background: var(--bg); opacity: .5; }
.node-fork            { border: 2px solid var(--fork);    background: var(--fork);    box-shadow: 0 0 8px var(--fork); width: 14px; height: 14px; }

/* ── Separator (main rail passes through, dashed line to the right) ── */
.separator-wrap {
  display: flex;
  align-items: stretch;
  min-height: 24px;
}
.separator-rail {
  min-height: 24px;
}
.separator-line {
  flex: 1;
  position: relative;
}
.separator-line::after {
  content: '';
  position: absolute;
  top: 50%; left: 0; right: 0;
  border-top: 1px dashed var(--border);
  opacity: .5;
}

/* ── Divergence grid (5 columns, main rail stays at left edge) ── */
.divergence-grid {
  display: grid;
  grid-template-columns: var(--rail-w) 1fr 12px var(--rail-w) 1fr;
  align-items: stretch;
}
/* Grid cell types */
.gc-main-rail    { display: flex; justify-content: center; }
.gc-main-content { padding: 6px 8px 6px 0; text-align: right; min-width: 0; }
.gc-gutter       { }
.gc-feat-rail    { display: flex; justify-content: center; }
.gc-feat-content { padding: 6px 0 6px 8px; min-width: 0; }

.div-hdr {
  font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
  padding-bottom: 4px;
  align-self: end;
}
.div-hdr-left { text-align: right; }

.empty-hint {
  font-size: 11px; color: var(--muted); font-style: italic;
  padding: 8px 0 2px 0;
}
.debug-info {
  font-family: var(--vscode-editor-font-family);
  font-size: 10px; color: var(--muted); opacity: .7;
}
.debug-warn { color: var(--warn); opacity: 1; }

/* ── File lists ── */
.file-list { margin-top: 3px; }
.file-item {
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  padding: 1px 4px; border-radius: 2px;
}
.file-warn { color: var(--warn); }
.conflict-file-item { cursor: pointer; transition: background .12s; }
.conflict-file-item:hover { background: rgba(240,96,96,.1); }
.caused-by { font-size: 10px; color: var(--muted); }
.causation-hint {
  font-size: 10px; color: var(--muted); font-style: italic;
  margin-top: 4px; padding: 2px 4px;
}

/* ── Fork section (same 5-col grid as divergence) ── */
.fork-grid {
  display: grid;
  grid-template-columns: var(--rail-w) 1fr 12px var(--rail-w) 1fr;
}
.gc-fork-branch {
  position: relative;
  min-height: 44px;
  display: flex;
  align-items: center;
}
/* L-shaped curve: horizontal from fork node → right, then vertical up to feature rail */
.fork-branch-curve {
  position: absolute;
  left: -16px;   /* extend into main-rail col to start at node center */
  right: 16px;   /* end at feature-rail center (col 4 is 32px, center = 16px from right) */
  top: 0;
  bottom: 50%;   /* bottom aligns with fork node center */
  border-bottom: 2px solid var(--feature);
  border-right: 2px solid var(--feature);
  border-bottom-right-radius: 16px;
  opacity: 0.6;
}
.fork-text {
  font-size: 11px; color: var(--muted);
  padding-left: 8px;
  position: relative;
  z-index: 1;
}

.history-row {
  display: flex;
}

/* ── Controls ── */
.controls {
  position: fixed; bottom: 0; left: 0; right: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  display: flex; gap: 8px; align-items: center;
}
.btn {
  font-family: var(--vscode-font-family);
  font-size: 12px; padding: 5px 14px;
  border-radius: 3px; border: 1px solid; cursor: pointer;
}
.btn-abort { border-color: rgba(240,96,96,.5); color: var(--warn); background: rgba(240,96,96,.08); }
.btn-skip  { border-color: rgba(200,200,200,.3); color: var(--main); background: rgba(200,200,200,.06); }
.btn-cont  { border-color: var(--new); color: #000; background: var(--new); font-weight: 600; }
.btn-abort:hover { background: rgba(240,96,96,.18); }
.btn-skip:hover  { background: rgba(200,200,200,.12); }
.btn-cont:hover  { filter: brightness(1.1); }
.spacer { flex: 1; }
.status-text { font-size: 11px; color: var(--muted); }
`;
  }
}
