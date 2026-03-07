/** Client-side JavaScript for the RebaseFlow webview panel. */
export function webviewScript(): string {
  return /* js */ `
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
    exitEditUi();
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

  document.getElementById('editControls').style.display = 'inline-flex';
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
      updateRailCaps();
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

/** Update rail-cap-top so only the first pending row has it, and fix end node */
function updateRailCaps() {
  const rows = document.querySelectorAll('#pendingList .row-pending');
  rows.forEach((r, i) => {
    const rail = r.querySelector('.rail.rail-feature');
    if (!rail) return;
    if (i === 0) {
      rail.classList.add('rail-cap-top');
    } else {
      rail.classList.remove('rail-cap-top');
    }
  });
}

function onActionChange(sel) {
  if (!editMode) return;
  updatePendingEditsFromDom();
  const row = sel.closest('.row-pending');
  row.classList.toggle('row-dropped', sel.value === 'drop');
}

function applyEdits() {
  updatePendingEditsFromDom();
  exitEditUi();
  vscode.postMessage({ command: 'editTodo', edits: pendingEdits });
  editMode = false;
}

function exitEditUi() {
  document.getElementById('editControls').style.display = 'none';
  document.getElementById('editToggle').textContent = 'Edit';
  document.querySelectorAll('.drag-handle').forEach(h => h.classList.remove('active'));
  document.querySelectorAll('.action-select').forEach(s => s.disabled = true);
  document.querySelectorAll('.row-pending').forEach(r => {
    r.setAttribute('draggable', 'false');
    r.classList.remove('row-dropped');
  });
}

function cancelEdit() {
  editMode = false;
  exitEditUi();
  vscode.postMessage({ command: 'exitEditMode' });
}
`;
}
