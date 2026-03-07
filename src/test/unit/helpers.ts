/**
 * Test helpers — mock GitCli factory and rebase scenario builders.
 *
 * The mock implements only the GitCli methods used by RebaseStateReader
 * and RebaseTodoWriter, avoiding the real GitCli (which imports vscode).
 */

const LOG_SEP = '\x01';

// ── Mock GitCli ────────────────────────────────────────────────────────────────

export interface MockGitCliOptions {
  /** Map of relativePath → file content (for readGitFile / gitFileExists) */
  gitFiles?: Record<string, string>;
  /** Map of args.join(' ') → command output (for tryExec / exec) */
  execResults?: Record<string, string>;
  /** The resolved git dir path */
  gitDir?: string;
}

export interface MockGitCli {
  gitDir: string;
  /** Exposed for test manipulation (e.g. deleting entries to test fallback paths) */
  gitFiles: Record<string, string>;
  execResults: Record<string, string>;
  gitFileExists(relativePath: string): boolean;
  readGitFile(relativePath: string): string | null;
  tryExec(args: string[]): string | null;
  exec(args: string[]): string;
}

export function createMockGitCli(opts: MockGitCliOptions = {}): MockGitCli {
  const gitFiles = opts.gitFiles ?? {};
  const execResults = opts.execResults ?? {};

  return {
    gitDir: opts.gitDir ?? '/fake/.git',
    gitFiles,
    execResults,

    gitFileExists(relativePath: string): boolean {
      return relativePath in gitFiles;
    },

    readGitFile(relativePath: string): string | null {
      return gitFiles[relativePath] ?? null;
    },

    tryExec(args: string[]): string | null {
      const key = args.join(' ');
      return key in execResults ? execResults[key] : null;
    },

    exec(args: string[]): string {
      const key = args.join(' ');
      if (key in execResults) { return execResults[key]; }
      throw new Error(`mock exec failed: git ${key}`);
    },
  };
}

// ── Scenario builders ──────────────────────────────────────────────────────────

/** Standard shas for test fixtures */
export const SHA = {
  onto:    'aaa1111222233334444555566667777aaaa1111',
  fork:    'fff0000111122223333444455556666ffff0000',
  origHead:'bbb2222333344445555666677778888bbbb2222',
  commit1: 'c110000111122223333444455556666c1100001',
  commit2: 'c220000111122223333444455556666c2200002',
  commit3: 'c330000111122223333444455556666c3300003',
  base1:   'ba10000111122223333444455556666ba100001',
  base2:   'ba20000111122223333444455556666ba200002',
  new1:    'aaaa0001111122223333444455556666aaaa001',
  new2:    'aaaa0002111122223333444455556666aaaa002',
} as const;

/** Build a git log line using SOH separators */
export function logLine(hash: string, message: string, author = 'Test Author', date = '2 hours ago'): string {
  const short = hash.substring(0, 7);
  return [hash, short, author, date, message].join(LOG_SEP);
}

/**
 * Creates a standard set of git files for a rebase-in-progress scenario.
 * Override individual files by passing them in `overrides`.
 */
export function createRebaseScenario(overrides: Record<string, string> = {}): Record<string, string> {
  const defaults: Record<string, string> = {
    'rebase-merge': '',  // directory existence marker
    'rebase-merge/head-name': 'refs/heads/feature/test',
    'rebase-merge/onto': SHA.onto,
    'rebase-merge/orig-head': SHA.origHead,
    'rebase-merge/git-rebase-todo': `pick ${SHA.commit2} Second commit\npick ${SHA.commit3} Third commit`,
    'rebase-merge/done': `pick ${SHA.commit1} First commit`,
  };
  return { ...defaults, ...overrides };
}

/**
 * Creates exec results for a basic rebase scenario where git log/diff-tree
 * calls return reasonable data. Override specific commands in `overrides`.
 */
export function createExecResults(overrides: Record<string, string> = {}): Record<string, string> {
  const defaults: Record<string, string> = {
    // fetchCommitInfo for each commit
    [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit1}`]:
      logLine(SHA.commit1, 'First commit'),
    [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit2}`]:
      logLine(SHA.commit2, 'Second commit'),
    [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit3}`]:
      logLine(SHA.commit3, 'Third commit'),

    // Fork point detection (merge-base)
    [`merge-base refs/heads/feature/test ${SHA.onto}`]: SHA.fork,

    // Base commits (fork..onto range)
    [`log --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.fork}..${SHA.onto}`]:
      logLine(SHA.base1, 'Base commit 1'),

    // Changed files for base commits
    [`diff-tree --no-commit-id --name-only -r ${SHA.base1}`]: 'src/shared.ts',

    // New hashes for done commits (onto..HEAD)
    [`log --format=%H%x01%h ${SHA.onto}..HEAD`]:
      [SHA.new1, SHA.new1.substring(0, 7)].join(LOG_SEP),

    // Target name resolution
    [`for-each-ref --points-at ${SHA.onto} --format=%(refname:short) refs/heads/`]: 'main',
  };
  return { ...defaults, ...overrides };
}
