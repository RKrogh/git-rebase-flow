import { GitCli } from './GitCli';
import { CommitInfo, RebaseState, emptyState } from '../models/RebaseState';

// git log format: hash|shortHash|author|date|subject
const LOG_FORMAT = '--format=%H|%h|%an|%ar|%s';

export class RebaseStateReader {
  constructor(private readonly git: GitCli) {}

  read(): RebaseState {
    // rebase-merge dir is the canonical indicator of an in-progress rebase
    // Use gitFileExists to support worktrees where the git dir differs from .git
    if (!this.git.gitFileExists('rebase-merge')) {
      return { ...emptyState };
    }

    const sourceBranch = this.readBranchName();
    const targetRef    = this.readTargetRef();
    const stoppedSha   = this.git.readGitFile('rebase-merge/stopped-sha');

    const todoLines  = this.parseTodoFile('rebase-merge/git-rebase-todo');
    const doneLines  = this.parseTodoFile('rebase-merge/done');

    const doneCommits    = this.enrichCommits(doneLines, 'done');
    const pendingCommits = this.enrichCommits(todoLines, 'pending');

    // The current commit is the one we're stopped on (conflict or edit)
    let currentCommit: CommitInfo | null = null;
    if (stoppedSha) {
      const conflictFiles = this.getConflictFiles();
      currentCommit = {
        ...this.fetchCommitInfo(stoppedSha),
        status: 'current',
        conflictFiles,
      };
    }

    // Base commits: what's on target above the fork point
    const forkPointHash = this.getForkPoint(sourceBranch, targetRef);
    const baseCommits   = forkPointHash
      ? this.getBaseCommits(targetRef, forkPointHash)
      : [];

    const totalCount = doneCommits.length + (currentCommit ? 1 : 0) + pendingCommits.length;
    const doneCount  = doneCommits.length;

    return {
      isRebasing: true,
      sourceBranch,
      targetRef,
      forkPointHash: forkPointHash ?? '',
      baseCommits,
      doneCommits,
      currentCommit,
      pendingCommits,
      totalCount,
      doneCount,
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private readBranchName(): string {
    // head-name contains refs/heads/feature/foo — strip the prefix
    const raw = this.git.readGitFile('rebase-merge/head-name') ?? 'UNKNOWN';
    return raw.replace(/^refs\/heads\//, '');
  }

  private readTargetRef(): string {
    // onto contains the target commit sha; try to resolve to a friendly name
    const onto = this.git.readGitFile('rebase-merge/onto');
    if (!onto) { return 'unknown'; }
    const name = this.git.tryExec(['name-rev', '--name-only', '--no-undefined', onto]);
    return name ?? onto.substring(0, 7);
  }

  private getForkPoint(source: string, target: string): string | null {
    return this.git.tryExec(['merge-base', `refs/heads/${source}`, target]);
  }

  private getBaseCommits(targetRef: string, forkPoint: string): CommitInfo[] {
    const raw = this.git.tryExec([
      'log', LOG_FORMAT, `${forkPoint}..${targetRef}`,
    ]);
    if (!raw) { return []; }
    return raw.split('\n').filter(Boolean).map(line => ({
      ...this.parseLine(line),
      status: 'base' as const,
    }));
  }

  /**
   * Parses git-rebase-todo / done files.
   * Format per line: "pick <sha> <message>"
   * We ignore `drop`, `fixup`, `exec` lines for display purposes.
   */
  private parseTodoFile(relativePath: string): Array<{ hash: string; message: string }> {
    const content = this.git.readGitFile(relativePath);
    if (!content) { return []; }

    return content
      .split('\n')
      .filter(l => /^(pick|reword|edit|squash|fixup)\s/i.test(l))
      .map(l => {
        const parts = l.split(/\s+/);
        const hash    = parts[1] ?? '';
        const message = parts.slice(2).join(' ');
        return { hash, message };
      });
  }

  private enrichCommits(
    lines: Array<{ hash: string; message: string }>,
    status: CommitInfo['status']
  ): CommitInfo[] {
    return lines.map(({ hash, message }) => {
      const info = this.fetchCommitInfo(hash);
      return { ...info, message: message || info.message, status };
    });
  }

  private fetchCommitInfo(hash: string): CommitInfo {
    const raw = this.git.tryExec(['log', '-1', LOG_FORMAT, hash]);
    if (raw) { return { ...this.parseLine(raw), status: 'pending' }; }

    // Fallback: commit might not be in log yet (e.g. stopped-sha during conflict)
    return {
      hash,
      shortHash: hash.substring(0, 7),
      message: this.git.readGitFile('rebase-merge/message')?.split('\n')[0] ?? '(unknown)',
      author: '',
      date: '',
      status: 'pending',
    };
  }

  private parseLine(line: string): CommitInfo {
    const [hash, shortHash, author, date, ...rest] = line.split('|');
    return {
      hash:      hash ?? '',
      shortHash: shortHash ?? '',
      author:    author ?? '',
      date:      date ?? '',
      message:   rest.join('|'),   // subject may contain pipes
      status:    'pending',
    };
  }

  private getConflictFiles(): string[] {
    // git status --porcelain: lines starting with 'UU', 'AA', 'DD', etc. are conflicts
    const raw = this.git.tryExec(['status', '--porcelain']);
    if (!raw) { return []; }
    return raw
      .split('\n')
      .filter(l => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l))
      .map(l => l.slice(3).trim());
  }
}
