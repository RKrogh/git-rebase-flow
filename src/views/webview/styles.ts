/** Webview CSS for the RebaseFlow panel. */
export function webviewCss(): string {
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
.section-pending { margin: 0; }
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

/* Edit controls (inline with last pending commit) */
.pending-edit-inline {
  display: inline-flex; gap: 6px; align-items: center;
  margin-left: auto; flex-shrink: 0;
}
.edit-controls { display: inline-flex; gap: 6px; }
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
