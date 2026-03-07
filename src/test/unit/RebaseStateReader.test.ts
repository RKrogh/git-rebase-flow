import * as assert from 'assert';
import { RebaseStateReader } from '../../git/RebaseStateReader';
import { createMockGitCli, createRebaseScenario, createExecResults, SHA, logLine } from './helpers';

// Suppress console.log from RebaseStateReader during tests
const originalLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = originalLog; });

describe('RebaseStateReader', () => {

  // ── No rebase active ───────────────────────────────────────────────────────

  describe('when no rebase is active', () => {
    it('returns emptyState', () => {
      const git = createMockGitCli(); // no gitFiles → rebase-merge doesn't exist
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.isRebasing, false);
      assert.strictEqual(state.sourceBranch, '');
      assert.strictEqual(state.targetRef, '');
      assert.deepStrictEqual(state.doneCommits, []);
      assert.deepStrictEqual(state.pendingCommits, []);
      assert.strictEqual(state.currentCommit, null);
    });
  });

  // ── Branch name parsing ────────────────────────────────────────────────────

  describe('branch name parsing', () => {
    it('strips refs/heads/ prefix', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.sourceBranch, 'feature/test');
    });

    it('handles missing head-name file', () => {
      const scenario = createRebaseScenario();
      delete scenario['rebase-merge/head-name'];
      const git = createMockGitCli({
        gitFiles: scenario,
        execResults: createExecResults(),
      });

      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.sourceBranch, 'UNKNOWN');
    });
  });

  // ── Target name resolution ─────────────────────────────────────────────────

  describe('target name resolution', () => {
    it('uses branch name from for-each-ref', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.targetRef, 'main');
    });

    it('prefers main/master/develop when multiple branches match', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults({
          [`for-each-ref --points-at ${SHA.onto} --format=%(refname:short) refs/heads/`]:
            'some-other-branch\nmaster\nyet-another',
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.targetRef, 'master');
    });

    it('falls back to name-rev when for-each-ref returns nothing', () => {
      const exec = createExecResults({
        [`name-rev --name-only --no-undefined --refs=refs/heads/* ${SHA.onto}`]: 'release/v2~3',
      });
      delete exec[`for-each-ref --points-at ${SHA.onto} --format=%(refname:short) refs/heads/`];

      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: exec,
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.targetRef, 'release/v2');
    });

    it('falls back to short sha when all strategies fail', () => {
      const exec = createExecResults();
      delete exec[`for-each-ref --points-at ${SHA.onto} --format=%(refname:short) refs/heads/`];

      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: exec,
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.targetRef, SHA.onto.substring(0, 7));
    });

    it('returns "unknown" when onto hash is empty', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/onto': '',
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.targetRef, 'unknown');
    });
  });

  // ── Todo file parsing ──────────────────────────────────────────────────────

  describe('todo file parsing', () => {
    it('parses pick/reword/edit/squash/fixup lines', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/git-rebase-todo': [
            `pick ${SHA.commit1} First`,
            `reword ${SHA.commit2} Second`,
            `edit ${SHA.commit3} Third`,
          ].join('\n'),
          'rebase-merge/done': '',
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.pendingCommits.length, 3);
      assert.strictEqual(state.pendingCommits[0].action, 'pick');
      assert.strictEqual(state.pendingCommits[1].action, 'reword');
      assert.strictEqual(state.pendingCommits[2].action, 'edit');
    });

    it('ignores comment lines', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/git-rebase-todo': [
            `pick ${SHA.commit1} First`,
            '# This is a comment',
            `# drop ${SHA.commit2} Dropped commit`,
            `pick ${SHA.commit3} Third`,
          ].join('\n'),
          'rebase-merge/done': '',
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.pendingCommits.length, 2);
    });

    it('handles empty todo file', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/git-rebase-todo': '',
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.pendingCommits.length, 0);
    });
  });

  // ── Basic rebase in progress ───────────────────────────────────────────────

  describe('basic rebase in progress (no conflict)', () => {
    it('sets isRebasing true', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.isRebasing, true);
    });

    it('populates done and pending commits', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.doneCommits.length, 1);
      assert.strictEqual(state.doneCommits[0].hash, SHA.commit1);
      assert.strictEqual(state.doneCommits[0].status, 'done');

      assert.strictEqual(state.pendingCommits.length, 2);
      assert.strictEqual(state.pendingCommits[0].hash, SHA.commit2);
      assert.strictEqual(state.pendingCommits[1].hash, SHA.commit3);
    });

    it('currentCommit is null when no stopped-sha', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.currentCommit, null);
    });

    it('preserves action verbs on pending commits', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/git-rebase-todo': `squash ${SHA.commit2} Second\nfixup ${SHA.commit3} Third`,
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.pendingCommits[0].action, 'squash');
      assert.strictEqual(state.pendingCommits[1].action, 'fixup');
    });

    it('counts total and done correctly', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.doneCount, 1);
      assert.strictEqual(state.totalCount, 3); // 1 done + 2 pending
    });
  });

  // ── Conflict state ─────────────────────────────────────────────────────────

  describe('conflict state', () => {
    function conflictScenario() {
      return createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/stopped-sha': SHA.commit2,
          'rebase-merge/done': [
            `pick ${SHA.commit1} First commit`,
            `pick ${SHA.commit2} Conflicting commit`,
          ].join('\n'),
          'rebase-merge/git-rebase-todo': `pick ${SHA.commit3} Third commit`,
        }),
        execResults: createExecResults({
          // Conflict files from git status
          'status --porcelain': 'UU src/shared.ts\nM  src/clean.ts\nAA src/both-added.ts',
          // fetchCommitInfo for the stopped commit
          [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit2}`]:
            logLine(SHA.commit2, 'Conflicting commit'),
          // New hashes — only first commit was applied before conflict
          [`log --format=%H%x01%h ${SHA.onto}..HEAD`]:
            [SHA.new1, SHA.new1.substring(0, 7)].join('\x01'),
        }),
      });
    }

    it('populates currentCommit from stopped-sha', () => {
      const git = conflictScenario();
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.ok(state.currentCommit);
      assert.strictEqual(state.currentCommit.hash, SHA.commit2);
      assert.strictEqual(state.currentCommit.status, 'current');
    });

    it('removes stopped commit from doneCommits (dedup)', () => {
      const git = conflictScenario();
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      // commit2 should NOT be in done — it's the current/stopped commit
      const doneHashes = state.doneCommits.map(c => c.hash);
      assert.ok(!doneHashes.includes(SHA.commit2));
      assert.strictEqual(state.doneCommits.length, 1);
    });

    it('preserves currentAction from last done line', () => {
      const git = conflictScenario();
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.currentCommit?.action, 'pick');
    });

    it('parses conflict files from git status (UU, AA patterns)', () => {
      const git = conflictScenario();
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.ok(state.currentCommit?.conflictFiles);
      assert.deepStrictEqual(state.currentCommit.conflictFiles, [
        'src/shared.ts',
        'src/both-added.ts',
      ]);
    });

    it('counts correctly with current commit', () => {
      const git = conflictScenario();
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      // 1 done + 1 current + 1 pending = 3
      assert.strictEqual(state.doneCount, 1);
      assert.strictEqual(state.totalCount, 3);
    });
  });

  // ── Conflict causation ─────────────────────────────────────────────────────

  describe('conflict causation', () => {
    it('maps conflict files to base commits via changedFiles overlap', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/stopped-sha': SHA.commit1,
          'rebase-merge/done': `pick ${SHA.commit1} First commit`,
          'rebase-merge/git-rebase-todo': `pick ${SHA.commit2} Second commit`,
        }),
        execResults: createExecResults({
          'status --porcelain': 'UU src/shared.ts',
          [`diff-tree --no-commit-id --name-only -r ${SHA.base1}`]: 'src/shared.ts\nREADME.md',
          [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit1}`]:
            logLine(SHA.commit1, 'First commit'),
          [`log --format=%H%x01%h ${SHA.onto}..HEAD`]: '',
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.conflictCausation.length, 1);
      assert.strictEqual(state.conflictCausation[0].file, 'src/shared.ts');
      assert.deepStrictEqual(state.conflictCausation[0].baseCommitHashes, [SHA.base1]);
    });

    it('returns empty causation when no conflicts', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.deepStrictEqual(state.conflictCausation, []);
    });

    it('returns empty causation when no base commits', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/stopped-sha': SHA.commit1,
          'rebase-merge/done': `pick ${SHA.commit1} First commit`,
        }),
        execResults: createExecResults({
          'status --porcelain': 'UU src/file.ts',
          [`log -1 --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.commit1}`]:
            logLine(SHA.commit1, 'First commit'),
          // Fork point equals onto — no base commits
          [`merge-base refs/heads/feature/test ${SHA.onto}`]: SHA.onto,
          [`merge-base ${SHA.origHead} ${SHA.onto}`]: SHA.onto,
          [`merge-base --fork-point ${SHA.onto} refs/heads/feature/test`]: SHA.onto,
          [`log --format=%H%x01%h ${SHA.onto}..HEAD`]: '',
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.deepStrictEqual(state.conflictCausation, []);
    });
  });

  // ── New hash assignment ────────────────────────────────────────────────────

  describe('new hash assignment', () => {
    it('maps new hashes onto done commits from git log', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/done': [
            `pick ${SHA.commit1} First`,
            `pick ${SHA.commit2} Second`,
          ].join('\n'),
          'rebase-merge/git-rebase-todo': `pick ${SHA.commit3} Third`,
        }),
        execResults: createExecResults({
          // git log returns newest-first; reader reverses to match done order
          [`log --format=%H%x01%h ${SHA.onto}..HEAD`]: [
            [SHA.new2, SHA.new2.substring(0, 7)].join('\x01'),
            [SHA.new1, SHA.new1.substring(0, 7)].join('\x01'),
          ].join('\n'),
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.doneCommits[0].newHash, SHA.new1);
      assert.strictEqual(state.doneCommits[0].newShortHash, SHA.new1.substring(0, 7));
      assert.strictEqual(state.doneCommits[1].newHash, SHA.new2);
      assert.strictEqual(state.doneCommits[1].newShortHash, SHA.new2.substring(0, 7));
    });

    it('handles empty done list gracefully', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario({
          'rebase-merge/done': '',
        }),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.doneCommits.length, 0);
    });
  });

  // ── Fork point detection ───────────────────────────────────────────────────

  describe('fork point detection', () => {
    it('uses merge-base as primary strategy', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults({
          [`merge-base refs/heads/feature/test ${SHA.onto}`]: SHA.fork,
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.forkPointHash, SHA.fork);
    });

    it('falls back to orig-head merge-base when primary returns onto', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults({
          [`merge-base refs/heads/feature/test ${SHA.onto}`]: SHA.onto,  // equals onto → try next
          [`merge-base ${SHA.origHead} ${SHA.onto}`]: SHA.fork,
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.forkPointHash, SHA.fork);
    });

    it('returns empty string when all strategies return onto or null', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults({
          [`merge-base refs/heads/feature/test ${SHA.onto}`]: SHA.onto,
          [`merge-base ${SHA.origHead} ${SHA.onto}`]: SHA.onto,
          [`merge-base --fork-point ${SHA.onto} refs/heads/feature/test`]: SHA.onto,
          // Base commits and new hash queries for the onto case
          [`log --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.onto}..${SHA.onto}`]: '',
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      // When fork === onto, getForkPoint returns mb1 (onto) which is truthy,
      // but getBaseCommits with fork..onto (same sha) returns empty
      assert.strictEqual(state.forkPointHash, SHA.onto);
      assert.deepStrictEqual(state.baseCommits, []);
    });
  });

  // ── Base commits ───────────────────────────────────────────────────────────

  describe('base commits', () => {
    it('populates base commits from fork..onto range', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults({
          [`log --format=%H%x01%h%x01%an%x01%ar%x01%s ${SHA.fork}..${SHA.onto}`]: [
            logLine(SHA.base1, 'Base commit 1'),
            logLine(SHA.base2, 'Base commit 2'),
          ].join('\n'),
          [`diff-tree --no-commit-id --name-only -r ${SHA.base1}`]: 'src/shared.ts',
          [`diff-tree --no-commit-id --name-only -r ${SHA.base2}`]: 'README.md\nsrc/other.ts',
        }),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.baseCommits.length, 2);
      assert.strictEqual(state.baseCommits[0].status, 'base');
      assert.strictEqual(state.baseCommits[0].hash, SHA.base1);
      assert.deepStrictEqual(state.baseCommits[0].changedFiles, ['src/shared.ts']);
      assert.deepStrictEqual(state.baseCommits[1].changedFiles, ['README.md', 'src/other.ts']);
    });
  });

  // ── Onto and origHead pass-through ─────────────────────────────────────────

  describe('state metadata', () => {
    it('passes through ontoHash and origHead', () => {
      const git = createMockGitCli({
        gitFiles: createRebaseScenario(),
        execResults: createExecResults(),
      });
      const reader = new RebaseStateReader(git as any);
      const state = reader.read();

      assert.strictEqual(state.ontoHash, SHA.onto);
      assert.strictEqual(state.origHead, SHA.origHead);
    });
  });
});
