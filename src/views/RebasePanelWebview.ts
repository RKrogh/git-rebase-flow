import * as vscode from 'vscode';
import { RebaseState, CommitInfo, ConflictCausation } from '../models/RebaseState';
import { GitCli } from '../git/GitCli';

export class RebasePanelWebview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private isEditing = false;
  private git: GitCli | null = null;
  private currentState: RebaseState | null = null;
  private tmpDir: string | null = null;

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
            break;
          case 'editTodo':
            this.isEditing = false;
            vscode.commands.executeCommand('rebaseflow.applyTodoEdits', { edits: msg.edits });
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
    this.currentState = state;
    this.panel.webview.html = this.buildHtml(state);
  }

  close(): void { this.panel?.dispose(); this.panel = null; }

  dispose(): void {
    this.close();
    this.cleanupTmpDir();
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
        const shortMsg = commitMsg.length > 40
          ? commitMsg.substring(0, 37) + '...' : commitMsg;

        try {
          const available = await vscode.commands.getCommands(true);
          if (available.includes('_open.mergeEditor')) {
            await vscode.commands.executeCommand('_open.mergeEditor', {
              $type: 'full',
              base:   { uri: vscode.Uri.file(tmpFiles.base),   title: 'Base (common ancestor)' },
              input1: { uri: vscode.Uri.file(tmpFiles.ours),   title: `\uD83D\uDD35 Target (${s.targetRef})`, description: 'current HEAD — ours' },
              input2: { uri: vscode.Uri.file(tmpFiles.theirs), title: `\uD83D\uDFE0 Your commit \u00B7 ${shortMsg}`, description: `${s.sourceBranch} — theirs` },
              result: fileUri,
            });
            return;
          }
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
    const pendingSection = this.buildPendingSection(s);
    const divergenceSection = this.buildDivergenceSection(s, conflictBaseHashes, s.pendingCommits.length > 0);
    const forkSection = this.buildForkSection(s);

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

<script>
const vscode = acquireVsCodeApi();
function send(cmd) { vscode.postMessage({ command: cmd }); }
function openFile(f) { vscode.postMessage({ command: 'openFile', file: f }); }

// ── Edit mode for pending commits ──
let editMode = false;
let pendingEdits = [];

function toggleEditMode() {
  editMode = !editMode;
  if (editMode) {
    vscode.postMessage({ command: 'enterEditMode' });
    initEditMode();
  } else {
    vscode.postMessage({ command: 'exitEditMode' });
  }
}

function initEditMode() {
  const rows = document.querySelectorAll('.row-pending');
  pendingEdits = Array.from(rows).map(r => ({
    hash: r.dataset.hash,
    action: r.querySelector('.action-select').value,
    message: r.querySelector('.pending-msg').textContent
  }));

  document.getElementById('editControls').style.display = 'flex';
  document.getElementById('editToggle').textContent = 'Editing...';
  document.querySelectorAll('.drag-handle').forEach(h => h.classList.add('active'));
  document.querySelectorAll('.action-select').forEach(s => s.disabled = false);
  document.querySelectorAll('.row-pending').forEach(r => r.setAttribute('draggable', 'true'));

  setupDragAndDrop();
}

function setupDragAndDrop() {
  const list = document.getElementById('pendingList');
  if (!list) return;
  let dragSrc = null;

  list.querySelectorAll('.row-pending').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (e.currentTarget !== dragSrc && dragSrc) {
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          list.insertBefore(dragSrc, e.currentTarget);
        } else {
          list.insertBefore(dragSrc, e.currentTarget.nextSibling);
        }
      }
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      updatePendingEditsFromDom();
    });
  });
}

function updatePendingEditsFromDom() {
  const rows = document.querySelectorAll('.row-pending');
  pendingEdits = Array.from(rows).map(r => ({
    hash: r.dataset.hash,
    action: r.querySelector('.action-select').value,
    message: r.querySelector('.pending-msg').textContent
  }));
}

function onActionChange(sel) {
  if (!editMode) return;
  updatePendingEditsFromDom();
  const row = sel.closest('.row-pending');
  row.classList.toggle('row-dropped', sel.value === 'drop');
}

function applyEdits() {
  updatePendingEditsFromDom();
  vscode.postMessage({ command: 'editTodo', edits: pendingEdits });
  editMode = false;
}

function cancelEdit() {
  editMode = false;
  vscode.postMessage({ command: 'exitEditMode' });
}
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

        conflictHtml = `<div class="file-list file-list-right">${
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
              + `\u26A1 ${this.esc(f)}${from}<span class="resolve-hint">open \u2192</span></div>`;
          }).join('')
        }</div>`;

        if (!hasAnyCausation) {
          conflictHtml += `<div class="causation-hint">No divergent target commits \u2014 conflict may be from before the fork point</div>`;
        }
      }

      const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

      rows.push(`<div class="rebased-row row-waxing">
        <div class="gc-main-content content-rebased">
          <div class="commit-top commit-top-right">
            <span class="hash">${this.esc(c.shortHash)}</span> ${badge}
          </div>
          <div class="msg msg-right">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta meta-right">${this.esc(meta)}</div>` : ''}
          ${conflictHtml}
        </div>
        <div class="gc-main-rail">
          <div class="rail rail-replay rail-cap-top">
            <div class="node ${hasConflict ? 'node-conflict' : 'node-replay'}"></div>
          </div>
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

      rows.push(`<div class="rebased-row row-settled-in">
        <div class="gc-main-content content-rebased">
          <div class="commit-top commit-top-right">${hashHtml} <span class="badge badge-done">\u2713 applied</span></div>
          <div class="msg msg-right">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta meta-right">${this.esc(meta)}</div>` : ''}
        </div>
        <div class="gc-main-rail">
          <div class="rail rail-new ${capTop}">
            <div class="node node-new"></div>
          </div>
        </div>
      </div>`);
    }

    return `<div class="section">
      <div class="rebased-row">
        <div class="section-label">Rebased (new)</div>
      </div>
      ${rows.join('\n')}
    </div>`;
  }

  // ── Pending section: editable commits above the separator ─────────────
  // Same 5-column grid; commits sit on the feature rail (cols 4-5).
  // Edit mode adds drag handles + action dropdowns.

  private buildPendingSection(s: RebaseState): string {
    if (s.pendingCommits.length === 0) { return ''; }

    const rows: string[] = [];
    const actions: string[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

    for (let i = 0; i < s.pendingCommits.length; i++) {
      const c = s.pendingCommits[i];
      const isTop = i === 0;
      const action = c.action ?? 'pick';

      const optionsHtml = actions.map(a =>
        `<option value="${a}"${a === action ? ' selected' : ''}>${a}</option>`
      ).join('');

      rows.push(`<div class="pending-row row-pending" data-hash="${this.esc(c.hash)}" draggable="false">
        <div class="gc-main-content"></div>
        <div class="gc-main-rail"></div>
        <div class="gc-gutter"></div>
        <div class="gc-feat-rail">
          <div class="rail rail-feature ${isTop ? 'rail-cap-top' : ''}">
            <div class="node node-feature"></div>
          </div>
        </div>
        <div class="gc-feat-content pending-content">
          <span class="drag-handle" title="Drag to reorder">\u2261</span>
          <select class="action-select" disabled onchange="onActionChange(this)">${optionsHtml}</select>
          <span class="hash hash-feature">${this.esc(c.shortHash)}</span>
          <span class="pending-msg">${this.esc(c.message)}</span>
        </div>
      </div>`);
    }

    return `<div class="section section-pending">
      <div class="pending-row">
        <div class="gc-main-content"></div>
        <div class="gc-main-rail"></div>
        <div class="gc-gutter"></div>
        <div class="gc-feat-rail"></div>
        <div class="gc-feat-content section-label-pending">Pending</div>
      </div>
      <div id="pendingList">
        ${rows.join('\n')}
      </div>
      <div class="pending-row pending-controls-row">
        <div class="gc-main-content"></div>
        <div class="gc-main-rail"></div>
        <div class="gc-gutter"></div>
        <div class="gc-feat-rail"></div>
        <div class="gc-feat-content edit-controls-wrap">
          <button class="btn btn-edit" id="editToggle" onclick="toggleEditMode()">Edit</button>
          <div class="edit-controls" id="editControls" style="display:none;">
            <button class="btn btn-apply" onclick="applyEdits()">Apply Changes</button>
            <button class="btn btn-cancel" onclick="cancelEdit()">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Section 4: Divergence (main + feature side by side) ───────────────
  // 5-column grid: [main-content 1fr] [main-rail 32px] [gutter] [feat-rail 32px] [feat-content 1fr]
  // Text flanks outward: target text left of main rail, feature text right of feature rail.

  private buildDivergenceSection(
    s: RebaseState,
    conflictBaseHashes: Set<string>,
    hasPendingAbove: boolean,
  ): string {
    // Only done + current originals (pending commits are in their own section above)
    const allOriginals: CommitInfo[] = [
      ...s.doneCommits,
      ...(s.currentCommit ? [s.currentCommit] : []),
    ].reverse();

    const maxRows = Math.max(s.baseCommits.length, allOriginals.length, 1);
    const nothingAbove = s.doneCommits.length === 0 && !s.currentCommit;

    const gridRows: string[] = [];

    // Header row — main-content first (col 1), then main-rail (col 2)
    gridRows.push(`<div class="gc-main-content div-hdr div-hdr-left">Target (${this.esc(s.targetRef)})</div>`);
    gridRows.push(`<div class="gc-main-rail">
      <div class="rail rail-main rail-no-node ${nothingAbove ? 'rail-cap-top' : ''}"></div>
    </div>`);
    gridRows.push('<div class="gc-gutter"></div>');
    // Feature rail in header only when pending section bridges above; otherwise first commit caps itself
    gridRows.push(`<div class="gc-feat-rail">${
      (allOriginals.length > 0 && hasPendingAbove) ? '<div class="rail rail-feature rail-no-node"></div>' : ''
    }</div>`);
    gridRows.push(`<div class="gc-feat-content div-hdr">${allOriginals.length > 0 ? 'Original commits' : ''}</div>`);

    for (let i = 0; i < maxRows; i++) {
      // ── Main content + rail (columns 1-2) ──
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

        gridRows.push(`<div class="gc-main-content ${isCausation ? 'row-causation' : ''}">
          <div class="commit-top commit-top-right">
            ${isCausation ? '<span class="badge badge-causation">\u26A1 conflict source</span>' : ''}
            <span class="hash hash-main">${this.esc(c.shortHash)}</span>
          </div>
          <div class="msg msg-right">${this.esc(c.message)}</div>
          ${meta ? `<div class="meta meta-right">${this.esc(meta)}</div>` : ''}
          ${causationHtml}
        </div>`);
        gridRows.push(`<div class="gc-main-rail">
          <div class="rail rail-main">
            <div class="node ${isCausation ? 'node-causation' : 'node-main'}"></div>
          </div>
        </div>`);
      } else {
        // Main content + rail continues (no node)
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
        gridRows.push(`<div class="gc-main-rail">
          <div class="rail rail-main rail-no-node"></div>
        </div>`);
      }

      // ── Gutter (column 3) ──
      gridRows.push('<div class="gc-gutter"></div>');

      // ── Feature rail + content (columns 4-5) ──
      if (i < allOriginals.length) {
        const c = allOriginals[i];
        const isTop = i === 0;
        const isDone = c.status === 'done';
        const isCurrent = c.status === 'current';

        const nodeCls = isCurrent ? 'node-feature-current'
          : isDone ? 'node-feature-faded'
          : 'node-feature';

        let badge = '';
        if (isDone)         { badge = '<span class="badge badge-faded">applied</span>'; }
        else if (isCurrent) { badge = '<span class="badge badge-current-replay">\u26A1 replaying</span>'; }
        else                { badge = '<span class="badge badge-pending">pending</span>'; }

        const rowAnim = isDone ? 'row-settled-out'
          : isCurrent ? 'row-waning'
          : '';

        const featCapTop = (isTop && !hasPendingAbove) ? 'rail-cap-top' : '';
        gridRows.push(`<div class="gc-feat-rail ${rowAnim}">
          <div class="rail rail-feature ${featCapTop}">
            <div class="node ${nodeCls}"></div>
          </div>
        </div>`);
        gridRows.push(`<div class="gc-feat-content ${rowAnim}">
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
        <div style="grid-column:1; grid-row:1;"></div>
        <div class="gc-main-rail" style="grid-column:2; grid-row:1;">
          <div class="rail rail-main rail-cap-bottom">
            <div class="node node-fork"></div>
          </div>
        </div>
        <div class="gc-fork-branch" style="grid-column:3/5; grid-row:1;">
          <div class="fork-branch-curve"></div>
          <span class="fork-text">Fork \u00B7 ${this.esc(s.forkPointHash.substring(0, 7))}</span>
        </div>
        <div style="grid-column:5; grid-row:1;"></div>
      </div>
      <div class="history-row">
        <div></div>
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
  padding: 6px 8px 4px 0;
  text-align: right;
}

/* ── Rebased rows (same 5-col grid, content in col 1, rail in col 2) ── */
.rebased-row {
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
  align-items: stretch;
  min-height: 44px;
}
.content-rebased { padding: 6px 8px; min-width: 0; }
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

/* ── Migration animations (wax/wane between orange→blue rails) ── */
@keyframes breathe-wax {
  0%, 100% { opacity: .35; }
  50%      { opacity: 1; }
}
@keyframes breathe-wane {
  0%, 100% { opacity: 1; }
  50%      { opacity: .35; }
}
@keyframes settle-in {
  from { opacity: .35; }
  to   { opacity: 1; }
}
@keyframes settle-out {
  from { opacity: 1; }
  to   { opacity: .4; }
}

.row-waxing      { animation: breathe-wax 4s ease-in-out infinite; }
.row-waning      { animation: breathe-wane 4s ease-in-out infinite; }
.row-settled-in  { animation: settle-in 1.6s ease-out; }
.row-settled-out { animation: settle-out 1.6s ease-out forwards; }

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

/* ── Separator (dashed line across, main rail passes through at col 2) ── */
.separator-grid {
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
  min-height: 24px;
  position: relative;
}
.separator-grid::after {
  content: '';
  position: absolute;
  top: 50%; left: 0; right: 0;
  border-top: 1px dashed var(--border);
  opacity: .5;
  pointer-events: none;
}
.separator-rail {
  min-height: 24px;
}

/* ── Divergence grid (5 columns, text flanks outward from central rails) ── */
.divergence-grid {
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
  align-items: stretch;
}
/* Grid cell types */
.gc-main-rail    { display: flex; justify-content: center; }
.gc-main-content { padding: 6px 8px; text-align: right; min-width: 0; }
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
.file-list { margin-top: 5px; display: flex; flex-direction: column; gap: 3px; }
.file-item {
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  padding: 1px 4px; border-radius: 2px;
}
.file-warn { color: var(--warn); }
.conflict-file-item {
  cursor: pointer;
  transition: background .12s, border-color .12s;
  padding: 4px 8px;
  border: 1px solid rgba(240,96,96,.3);
  border-radius: 4px;
  background: rgba(240,96,96,.06);
  display: inline-flex; align-items: center; gap: 4px;
}
.conflict-file-item:hover {
  background: rgba(240,96,96,.15);
  border-color: rgba(240,96,96,.6);
}
.conflict-file-item:active {
  background: rgba(240,96,96,.25);
}
.conflict-file-item .resolve-hint {
  font-size: 9px; color: var(--muted);
  margin-left: auto; opacity: .7;
}
.caused-by { font-size: 10px; color: var(--muted); }
.causation-hint {
  font-size: 10px; color: var(--muted); font-style: italic;
  margin-top: 4px; padding: 2px 4px;
}

/* ── Fork section (same 5-col grid as divergence) ── */
.fork-grid {
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
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
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
}

/* ── Pending section ── */
.pending-row {
  display: grid;
  grid-template-columns: 1fr var(--rail-w) 12px var(--rail-w) 1fr;
  align-items: stretch;
  min-height: 36px;
}
.section-label-pending {
  font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
  padding: 6px 0 4px 8px;
  align-self: end;
}
.pending-content {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0 4px 8px;
  min-width: 0;
}
.pending-msg {
  font-size: 12px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; min-width: 0;
}

/* Drag handle */
.drag-handle {
  font-size: 16px; cursor: default; color: var(--muted);
  opacity: .3; user-select: none; flex-shrink: 0;
  transition: opacity .15s;
}
.drag-handle.active {
  opacity: 1; cursor: grab; color: var(--feature);
}

/* Action dropdown */
.action-select {
  font-family: var(--vscode-font-family);
  font-size: 11px; padding: 1px 4px;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 2px;
  flex-shrink: 0; cursor: default;
  opacity: .5;
}
.action-select:not(:disabled) {
  opacity: 1; cursor: pointer;
  border-color: var(--feature);
}

/* Drag states */
.row-pending.dragging { opacity: .4; }
.row-pending[draggable="true"] { cursor: grab; }
.row-dropped .pending-msg { text-decoration: line-through; opacity: .4; }
.row-dropped .hash { opacity: .4; }

/* Edit controls */
.pending-controls-row { min-height: auto; padding-bottom: 4px; }
.edit-controls-wrap {
  display: flex; gap: 6px; align-items: center;
  padding: 4px 0 4px 8px;
}
.edit-controls { display: flex; gap: 6px; }
.btn-edit {
  border-color: var(--feature); color: var(--feature);
  background: rgba(232,148,58,.08);
  font-size: 11px; padding: 3px 10px;
}
.btn-edit:hover { background: rgba(232,148,58,.18); }
.btn-apply {
  border-color: var(--done); color: #000;
  background: var(--done); font-weight: 600;
  font-size: 11px; padding: 3px 10px;
}
.btn-apply:hover { filter: brightness(1.1); }
.btn-cancel {
  border-color: var(--border); color: var(--muted);
  background: transparent;
  font-size: 11px; padding: 3px 10px;
}
.btn-cancel:hover { background: rgba(200,200,200,.08); }

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
