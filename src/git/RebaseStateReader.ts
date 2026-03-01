import { GitCli } from './GitCli';
import { CommitInfo, ConflictCausation, RebaseState, emptyState } from '../models/RebaseState';

// git log format: hash<SOH>shortHash<SOH>author<SOH>date<SOH>subject
// Uses ASCII SOH (%x01) as separator — pipe `|` gets interpreted as shell pipe on Windows cmd.exe
const LOG_SEP = '\x01';
const LOG_FORMAT = '--format=%H%x01%h%x01%an%x01%ar%x01%s';

export class RebaseStateReader {
  constructor(private readonly git: GitCli) {}

  read(): RebaseState {
    if (!this.git.gitFileExists('rebase-merge')) {
      return { ...emptyState };
    }

    const sourceBranch = this.readBranchName();
    const ontoHash     = this.readOntoHash();
    const targetRef    = this.resolveTargetName(ontoHash);
    const stoppedSha   = this.git.readGitFile('rebase-merge/stopped-sha');

    const todoLines = this.parseTodoFile('rebase-merge/git-rebase-todo');
    let   doneLines = this.parseTodoFile('rebase-merge/done');

    // Fix: during a conflict, the stopped commit is already in 'done'.
    // Remove it from done — we'll show it as currentCommit instead.
    if (stoppedSha && doneLines.length > 0) {
      const lastDone = doneLines[doneLines.length - 1];
      if (lastDone.hash === stoppedSha || stoppedSha.startsWith(lastDone.hash)) {
        doneLines = doneLines.slice(0, -1);
      }
    }

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

    // The original feature branch tip before rebase started
    const origHead = this.git.readGitFile('rebase-merge/orig-head') ?? '';

    // Base commits: what's on target above the fork point
    // Use raw onto sha for range queries, not the friendly name
    const forkPointHash = this.getForkPoint(sourceBranch, ontoHash, origHead);
    const baseCommits   = forkPointHash
      ? this.getBaseCommits(ontoHash, forkPointHash)
      : [];

    console.log('[RebaseFlow] Fork detection:', {
      source: sourceBranch,
      onto: ontoHash?.substring(0, 7),
      origHead: origHead?.substring(0, 7),
      forkPoint: forkPointHash?.substring(0, 7),
      forkEqualsOnto: forkPointHash === ontoHash,
      baseCommitCount: baseCommits.length,
    });

    // Map new hashes onto done commits (rebase creates new cherry-picked copies)
    this.assignNewHashes(doneCommits, ontoHash);

    const conflictCausation = currentCommit?.conflictFiles
      ? this.computeConflictCausation(currentCommit.conflictFiles, baseCommits)
      : [];

    const totalCount = doneCommits.length + (currentCommit ? 1 : 0) + pendingCommits.length;
    const doneCount  = doneCommits.length;

    return {
      isRebasing: true,
      sourceBranch,
      targetRef,
      ontoHash,
      origHead,
      forkPointHash: forkPointHash ?? '',
      baseCommits,
      doneCommits,
      currentCommit,
      pendingCommits,
      conflictCausation,
      totalCount,
      doneCount,
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private readBranchName(): string {
    const raw = this.git.readGitFile('rebase-merge/head-name') ?? 'UNKNOWN';
    return raw.replace(/^refs\/heads\//, '');
  }

  /** Read the raw onto sha — the commit we're rebasing onto. */
  private readOntoHash(): string {
    return this.git.readGitFile('rebase-merge/onto') ?? '';
  }

  /** Resolve a sha to a friendly branch name for display only. */
  private resolveTargetName(sha: string): string {
    if (!sha) { return 'unknown'; }
    const name = this.git.tryExec(['name-rev', '--name-only', '--no-undefined', sha]);
    // name-rev can return things like "master~0" — strip the ~0
    if (name) { return name.replace(/~0$/, ''); }
    return sha.substring(0, 7);
  }

  private getForkPoint(source: string, ontoSha: string, origHead: string): string | null {
    // Strategy 1: merge-base with the branch ref
    const mb1 = this.git.tryExec(['merge-base', `refs/heads/${source}`, ontoSha]);
    if (mb1 && mb1 !== ontoSha) { return mb1; }

    // Strategy 2: use orig-head (feature tip saved at rebase start)
    // This helps when refs/heads/<source> was modified by a prior rebase
    if (origHead) {
      const mb2 = this.git.tryExec(['merge-base', origHead, ontoSha]);
      if (mb2 && mb2 !== ontoSha) { return mb2; }
    }

    // Strategy 3: --fork-point uses reflog for more accurate detection
    const mb3 = this.git.tryExec(['merge-base', '--fork-point', ontoSha, `refs/heads/${source}`]);
    if (mb3 && mb3 !== ontoSha) { return mb3; }

    console.log('[RebaseFlow] Fork point detection: all strategies returned onto hash or null.',
      { mb1: mb1?.substring(0, 7), mb2: origHead ? 'tried' : 'no orig-head', mb3: mb3?.substring(0, 7) });

    // Return whatever we got — forkPoint == onto means no divergent commits
    return mb1 ?? null;
  }

  private getBaseCommits(ontoSha: string, forkPoint: string): CommitInfo[] {
    // Use raw shas for the range query — no ambiguity
    const range = `${forkPoint}..${ontoSha}`;
    const raw = this.git.tryExec(['log', LOG_FORMAT, range]);

    console.log('[RebaseFlow] getBaseCommits:', {
      range: `${forkPoint.substring(0, 7)}..${ontoSha.substring(0, 7)}`,
      rawLength: raw?.length ?? 'null',
      rawPreview: raw ? raw.substring(0, 80) : 'null',
    });

    if (!raw) { return []; }
    return raw.split('\n').filter(Boolean).map(line => {
      const commit: CommitInfo = {
        ...this.parseLine(line),
        status: 'base' as const,
      };
      commit.changedFiles = this.getChangedFiles(commit.hash);
      return commit;
    });
  }

  /**
   * After rebase applies commits, HEAD contains the new cherry-picked copies.
   * `git log onto..HEAD` gives us the new commits in reverse order.
   * We match them 1:1 with done commits to assign newHash/newShortHash.
   */
  private assignNewHashes(doneCommits: CommitInfo[], ontoSha: string): void {
    if (doneCommits.length === 0 || !ontoSha) { return; }

    const raw = this.git.tryExec(['log', '--format=%H%x01%h', `${ontoSha}..HEAD`]);
    if (!raw) { return; }

    // git log returns newest-first; done commits are oldest-first — reverse to align
    const newCommits = raw.split('\n').filter(Boolean).reverse();

    for (let i = 0; i < Math.min(doneCommits.length, newCommits.length); i++) {
      const parts = newCommits[i].split(LOG_SEP);
      doneCommits[i].newHash = parts[0];
      doneCommits[i].newShortHash = parts[1];
    }
  }

  private getChangedFiles(hash: string): string[] {
    const raw = this.git.tryExec(['diff-tree', '--no-commit-id', '--name-only', '-r', hash]);
    if (!raw) { return []; }
    return raw.split('\n').filter(Boolean);
  }

  private computeConflictCausation(
    conflictFiles: string[],
    baseCommits: CommitInfo[],
  ): ConflictCausation[] {
    if (!conflictFiles.length || !baseCommits.length) { return []; }

    return conflictFiles.map(file => {
      const baseCommitHashes = baseCommits
        .filter(bc => bc.changedFiles?.includes(file))
        .map(bc => bc.hash);
      return { file, baseCommitHashes };
    });
  }

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
    const [hash, shortHash, author, date, ...rest] = line.split(LOG_SEP);
    return {
      hash:      hash ?? '',
      shortHash: shortHash ?? '',
      author:    author ?? '',
      date:      date ?? '',
      message:   rest.join(LOG_SEP),
      status:    'pending',
    };
  }

  private getConflictFiles(): string[] {
    const raw = this.git.tryExec(['status', '--porcelain']);
    if (!raw) { return []; }
    return raw
      .split('\n')
      .filter(l => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l))
      .map(l => l.slice(3).trim());
  }
}
