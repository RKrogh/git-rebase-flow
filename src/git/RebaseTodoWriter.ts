import { GitCli } from './GitCli';
import { PendingEdit, RebaseAction } from '../models/RebaseState';

export interface WriteResult {
  written: boolean;
  staleHashes: string[];
}

export class RebaseTodoWriter {
  constructor(private readonly git: GitCli) {}

  /**
   * Writes a new git-rebase-todo file from the given edits.
   * Validates that all non-drop hashes are still present in the current todo
   * (guards against stale edits if the rebase advanced while the user was editing).
   */
  writeTodo(edits: PendingEdit[]): WriteResult {
    const currentContent = this.git.readGitFile('rebase-merge/git-rebase-todo');
    if (!currentContent) {
      return { written: false, staleHashes: [] }; // rebase may have finished
    }

    // Extract hashes currently in the todo file
    const currentHashes = new Set(
      currentContent.split('\n')
        .filter(l => /^(pick|reword|edit|squash|fixup)\s/i.test(l))
        .map(l => l.split(/\s+/)[1])
    );

    // Check for stale edits — non-drop hashes that are no longer pending
    const staleHashes = edits
      .filter(e => e.action !== 'drop')
      .filter(e => !currentHashes.has(e.hash))
      .map(e => e.hash);

    if (staleHashes.length > 0) {
      return { written: false, staleHashes };
    }

    const lines = edits.map(e => this.formatLine(e));
    const content = lines.join('\n') + '\n';
    this.writeGitFile('rebase-merge/git-rebase-todo', content);
    return { written: true, staleHashes: [] };
  }

  private formatLine(edit: PendingEdit): string {
    // 'drop' is written as a comment — git ignores commented lines
    if (edit.action === 'drop') {
      return `# drop ${edit.hash} ${edit.message}`;
    }
    return `${edit.action} ${edit.hash} ${edit.message}`;
  }

  private writeGitFile(relativePath: string, content: string): void {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const full = path.join(this.git.gitDir, relativePath);
    fs.writeFileSync(full, content, 'utf8');
  }
}
