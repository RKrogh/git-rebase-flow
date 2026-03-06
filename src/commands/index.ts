import * as vscode from 'vscode';
import { GitCli } from '../git/GitCli';
import { RebaseTodoWriter } from '../git/RebaseTodoWriter';
import { TodoEditPayload } from '../models/RebaseState';
import { RebaseStateWatcher } from '../git/RebaseStateWatcher';

function getRepoRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

async function runGitRebase(args: string[], successMsg: string): Promise<void> {
  const root = getRepoRoot();
  if (!root) {
    vscode.window.showErrorMessage('RebaseFlow: No workspace folder found.');
    return;
  }

  const git = new GitCli(root);
  try {
    // Set GIT_EDITOR=true so git doesn't try to open an editor for commit messages
    git.exec(['rebase', ...args], { env: { ...process.env, GIT_EDITOR: 'true' } });
    vscode.window.showInformationMessage(`RebaseFlow: ${successMsg}`);
  } catch (err: any) {
    // Non-zero exit during --continue means new conflicts arose — not an error we surface as a popup
    const msg: string = err?.stderr ?? err?.message ?? String(err);
    if (!msg.includes('conflict')) {
      vscode.window.showErrorMessage(`RebaseFlow: ${msg.split('\n')[0]}`);
    }
    // State watcher will pick up the new state automatically
  }
}

export function registerCommands(context: vscode.ExtensionContext, watcher?: RebaseStateWatcher): void {
  context.subscriptions.push(

    vscode.commands.registerCommand('rebaseflow.continue', () =>
      runGitRebase(['--continue'], 'Continued rebase.')
    ),

    vscode.commands.registerCommand('rebaseflow.skip', () =>
      runGitRebase(['--skip'], 'Skipped commit.')
    ),

    vscode.commands.registerCommand('rebaseflow.abort', async () => {
      const pick = await vscode.window.showWarningMessage(
        'Abort the rebase? All progress will be lost.',
        { modal: true },
        'Abort'
      );
      if (pick === 'Abort') {
        await runGitRebase(['--abort'], 'Rebase aborted.');
      }
    }),

    vscode.commands.registerCommand('rebaseflow.applyTodoEdits', (payload: TodoEditPayload) => {
      const root = getRepoRoot();
      if (!root) {
        vscode.window.showErrorMessage('RebaseFlow: No workspace folder found.');
        return;
      }

      const git = new GitCli(root);
      const writer = new RebaseTodoWriter(git);

      watcher?.suppressFor(400);

      const result = writer.writeTodo(payload.edits);
      if (!result.written) {
        if (result.staleHashes.length > 0) {
          vscode.window.showWarningMessage(
            'RebaseFlow: Rebase state changed while editing. Your edits could not be applied. Refreshing.'
          );
        } else {
          vscode.window.showWarningMessage('RebaseFlow: No active rebase found.');
        }
        return;
      }

      vscode.window.showInformationMessage(
        `RebaseFlow: Updated ${payload.edits.length} pending commits.`
      );
    }),

  );
}
