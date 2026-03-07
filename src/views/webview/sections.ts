/**
 * Pure HTML section builders for the RebaseFlow webview panel.
 * No vscode dependency — these are standalone functions that take
 * RebaseState (or derived data) and return HTML strings.
 */

import { RebaseState, CommitInfo, ConflictCausation } from '../../models/RebaseState';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function getCausationFilesForBase(hash: string, causation: ConflictCausation[]): string[] {
  return causation.filter(c => c.baseCommitHashes.includes(hash)).map(c => c.file);
}

// ── Rebased section ──────────────────────────────────────────────────────────
// Combined replay (current commit) + done commits. Rail: dotted blue for
// replay, solid blue for done. Newest at top.

export function buildRebasedSection(
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
                  ? `${esc(msg.substring(0, 25))} (${h.substring(0, 7)})`
                  : h.substring(0, 7);
                return label;
              }).join(', ')}</span>`
            : '';
          return `<div class="file-item file-warn conflict-file-item" onclick="openFile('${escJs(f)}')">`
            + `\u26A1 ${esc(f)}${from}<span class="resolve-hint">open \u2192</span></div>`;
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
          <span class="hash">${esc(c.shortHash)}</span> ${badge}
        </div>
        <div class="msg msg-right">${esc(c.message)}</div>
        ${meta ? `<div class="meta meta-right">${esc(meta)}</div>` : ''}
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
      ? `<span class="hash hash-old">${esc(c.shortHash)}</span>`
        + `<span class="hash-arrow">\u2192</span>`
        + `<span class="hash hash-new">${esc(c.newShortHash)}</span>`
      : `<span class="hash">${esc(c.shortHash)}</span>`;

    const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

    rows.push(`<div class="rebased-row row-settled-in">
      <div class="gc-main-content content-rebased">
        <div class="commit-top commit-top-right">${hashHtml} <span class="badge badge-done">\u2713 applied</span></div>
        <div class="msg msg-right">${esc(c.message)}</div>
        ${meta ? `<div class="meta meta-right">${esc(meta)}</div>` : ''}
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

// ── Pending section ──────────────────────────────────────────────────────────
// Editable commits on the feature rail. Edit mode adds drag handles + action
// dropdowns.

export function buildPendingSection(s: RebaseState): string {
  if (s.pendingCommits.length === 0) { return ''; }

  const rows: string[] = [];
  const actions: string[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

  for (let i = 0; i < s.pendingCommits.length; i++) {
    const c = s.pendingCommits[i];
    const isFirst = i === 0;
    const isLast = i === s.pendingCommits.length - 1;
    const action = c.action ?? 'pick';

    const optionsHtml = actions.map(a =>
      `<option value="${a}"${a === action ? ' selected' : ''}>${a}</option>`
    ).join('');

    // Last pending commit gets the edit button inline
    const editBtn = isLast
      ? `<span class="pending-edit-inline">
          <button class="btn btn-edit" id="editToggle" onclick="toggleEditMode()">Edit</button>
          <span class="edit-controls" id="editControls" style="display:none;">
            <button class="btn btn-apply" onclick="applyEdits()">Apply Changes</button>
            <button class="btn btn-cancel" onclick="cancelEdit()">Cancel</button>
          </span>
        </span>`
      : '';

    // Orange rail: cap top on first (nothing above), line continues down to separator/divergence
    const featCap = isFirst ? 'rail-cap-top' : '';

    rows.push(`<div class="pending-row row-pending" data-hash="${esc(c.hash)}" draggable="false">
      <div class="gc-main-content"></div>
      <div class="gc-main-rail"><div class="rail rail-main rail-no-node"></div></div>
      <div class="gc-gutter"></div>
      <div class="gc-feat-rail">
        <div class="rail rail-feature ${featCap}">
          <div class="node node-feature"></div>
        </div>
      </div>
      <div class="gc-feat-content pending-content">
        <span class="drag-handle" title="Drag to reorder">\u2261</span>
        <select class="action-select" disabled onchange="onActionChange(this)">${optionsHtml}</select>
        <span class="hash hash-feature">${esc(c.shortHash)}</span>
        <span class="pending-msg">${esc(c.message)}</span>
        ${editBtn}
      </div>
    </div>`);
  }

  return `<div class="section section-pending">
    <div id="pendingList">
      ${rows.join('\n')}
    </div>
  </div>`;
}

// ── Divergence section ───────────────────────────────────────────────────────
// Main + feature side by side. 5-column grid: text flanks outward from
// central rails.

export function buildDivergenceSection(
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
  gridRows.push(`<div class="gc-main-content div-hdr div-hdr-left">Target (${esc(s.targetRef)})</div>`);
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
      const causationFiles = getCausationFilesForBase(c.hash, s.conflictCausation);
      const meta = [c.author, c.date].filter(Boolean).join(' \u00B7 ');

      let causationHtml = '';
      if (isCausation && causationFiles.length) {
        causationHtml = `<div class="file-list file-list-right">${
          causationFiles.map(f => `<div class="file-item file-warn">\u26A1 ${esc(f)}</div>`).join('')
        }</div>`;
      }

      gridRows.push(`<div class="gc-main-content ${isCausation ? 'row-causation' : ''}">
        <div class="commit-top commit-top-right">
          ${isCausation ? '<span class="badge badge-causation">\u26A1 conflict source</span>' : ''}
          <span class="hash hash-main">${esc(c.shortHash)}</span>
        </div>
        <div class="msg msg-right">${esc(c.message)}</div>
        ${meta ? `<div class="meta meta-right">${esc(meta)}</div>` : ''}
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
          <span class="hash hash-feature">${esc(c.shortHash)}</span> ${badge}
        </div>
        <div class="msg">${esc(c.message)}</div>
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

// ── Fork section ─────────────────────────────────────────────────────────────
// Same 5-column grid so rails align with divergence above. CSS border curve
// branches from main rail rightward to feature rail.

export function buildForkSection(s: RebaseState): string {
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
        <span class="fork-text">Fork \u00B7 ${esc(s.forkPointHash.substring(0, 7))}</span>
      </div>
      <div style="grid-column:5; grid-row:1;"></div>
    </div>
    <div class="history-row">
      <div></div>
      <div class="rail rail-history"></div>
    </div>
  </div>`;
}
