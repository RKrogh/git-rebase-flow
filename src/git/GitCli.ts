import { execSync, ExecSyncOptions } from 'child_process';
import * as vscode from 'vscode';

export class GitCli {
  private readonly repoRoot: string;
  private readonly gitPath: string;
  /** Resolved git dir (handles worktrees — may differ from .git) */
  readonly gitDir: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    // Respect user's configured git path, fall back to 'git'
    this.gitPath = vscode.workspace
      .getConfiguration('git')
      .get<string>('path') ?? 'git';

    // Resolve the real git dir — in worktrees this points to
    // .git/worktrees/<name> instead of .git
    const path = require('path') as typeof import('path');
    try {
      const raw = this.exec(['rev-parse', '--git-dir']);
      this.gitDir = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
    } catch {
      this.gitDir = path.join(repoRoot, '.git');
    }
  }

  exec(args: string[], options: Partial<ExecSyncOptions> = {}): string {
    try {
      const result = execSync(
        `"${this.gitPath}" ${args.join(' ')}`,
        {
          cwd: this.repoRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          ...options,
        }
      );
      return (result as string).trim();
    } catch (err: any) {
      // Many git commands exit non-zero for valid "empty" states
      // Return stdout if available, rethrow only if truly empty
      if (err.stdout) { return (err.stdout as string).trim(); }
      throw err;
    }
  }

  /** Returns null if the command fails (e.g. ref doesn't exist) */
  tryExec(args: string[]): string | null {
    try { return this.exec(args); }
    catch { return null; }
  }

  readFile(relativePath: string): string | null {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const full = path.join(this.repoRoot, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').trim() : null;
    } catch { return null; }
  }

  /** Read a file relative to the resolved git dir (worktree-safe) */
  readGitFile(relativePath: string): string | null {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const full = path.join(this.gitDir, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').trim() : null;
    } catch { return null; }
  }

  exists(relativePath: string): boolean {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return fs.existsSync(path.join(this.repoRoot, relativePath));
  }

  /** Check existence relative to the resolved git dir (worktree-safe) */
  gitFileExists(relativePath: string): boolean {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return fs.existsSync(path.join(this.gitDir, relativePath));
  }

  /** Read a file at a specific index stage: 1=base, 2=ours (target), 3=theirs (feature) */
  readIndexStage(file: string, stage: 1 | 2 | 3): string | null {
    return this.tryExec(['show', `:${stage}:${file}`]);
  }

  get workspaceRoot(): string { return this.repoRoot; }
}
