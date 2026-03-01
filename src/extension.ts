import * as vscode from 'vscode';
import { RebaseStateWatcher } from './git/RebaseStateWatcher';
import { RebaseTreeProvider }  from './views/RebaseTreeProvider';
import { RebasePanelWebview }  from './views/RebasePanelWebview';
import { registerCommands }    from './commands';
import { RebaseState }         from './models/RebaseState';

// Context key used by `when` clauses in package.json
const CTX_IS_REBASING = 'rebaseflow.isRebasing';

export function activate(context: vscode.ExtensionContext): void {
  const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!repoRoot) { return; }

  // ── Core components ────────────────────────────────────────────────────
  const watcher  = new RebaseStateWatcher(repoRoot);
  const tree     = new RebaseTreeProvider();
  const webview  = new RebasePanelWebview();

  // ── Register sidebar tree view ─────────────────────────────────────────
  const treeView = vscode.window.createTreeView('rebaseflow.tree', {
    treeDataProvider: tree,
    showCollapseAll: false,
  });

  // ── Register commands ──────────────────────────────────────────────────
  registerCommands(context);

  // ── React to state changes ────────────────────────────────────────────
  watcher.onStateChanged((state: RebaseState) => {
    // Update VS Code context so `when` clauses in package.json activate/deactivate
    vscode.commands.executeCommand('setContext', CTX_IS_REBASING, state.isRebasing);

    tree.update(state);

    if (state.isRebasing) {
      webview.show(context, state);
    } else {
      webview.close();
    }
  });

  // ── Open panel command (manual trigger) ───────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('rebaseflow.openPanel', () => {
      const state = watcher.state;
      if (state.isRebasing) {
        webview.show(context, state);
      } else {
        vscode.window.showInformationMessage('RebaseFlow: No rebase in progress.');
      }
    })
  );

  // ── Prime the context on startup ──────────────────────────────────────
  const initialState = watcher.state;
  vscode.commands.executeCommand('setContext', CTX_IS_REBASING, initialState.isRebasing);
  if (initialState.isRebasing) {
    tree.update(initialState);
    webview.show(context, initialState);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  context.subscriptions.push(watcher, treeView, webview);
}

export function deactivate(): void {}
