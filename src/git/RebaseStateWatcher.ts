import * as vscode from 'vscode';
import { RebaseStateReader } from './RebaseStateReader';
import { RebaseState, emptyState } from '../models/RebaseState';
import { GitCli } from './GitCli';

export class RebaseStateWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly reader: RebaseStateReader;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private currentState: RebaseState = { ...emptyState };

  private readonly _onStateChanged = new vscode.EventEmitter<RebaseState>();
  readonly onStateChanged = this._onStateChanged.event;

  constructor(repoRoot: string) {
    const git = new GitCli(repoRoot);
    this.reader = new RebaseStateReader(git);

    // Use the resolved git dir so worktrees are watched correctly
    const gitDir = git.gitDir;

    // Watch the entire rebase-merge dir — creation, deletion, and file changes
    // all matter (done file grows, stopped-sha appears, dir disappears on finish)
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(gitDir), 'rebase-merge/**'),
      false, // create
      false, // change
      false  // delete
    );

    const refresh = () => this.scheduleRefresh();
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidChange(refresh);
    this.watcher.onDidDelete(refresh);

    // Also watch for the directory itself disappearing (rebase complete)
    const dirWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(gitDir), 'rebase-merge'),
      false, false, false
    );
    dirWatcher.onDidDelete(() => {
      // Rebase finished — emit empty state and let consumers clean up
      this.currentState = { ...emptyState };
      this._onStateChanged.fire(this.currentState);
    });

    // Prime initial state
    this.refresh();
  }

  get state(): RebaseState { return this.currentState; }

  private scheduleRefresh(delay = 120): void {
    // Debounce: watcher can fire multiple times for a single git operation
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    this.debounceTimer = setTimeout(() => this.refresh(), delay);
  }

  private refresh(): void {
    try {
      this.currentState = this.reader.read();
      this._onStateChanged.fire(this.currentState);
    } catch (err) {
      console.error('[RebaseFlow] Failed to read rebase state:', err);
    }
  }

  dispose(): void {
    this.watcher.dispose();
    this._onStateChanged.dispose();
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
  }
}
