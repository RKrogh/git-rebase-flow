import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RebaseTodoWriter } from '../../git/RebaseTodoWriter';
import { PendingEdit, RebaseAction } from '../../models/RebaseState';
import { createMockGitCli, SHA } from './helpers';

function edit(action: RebaseAction, hash: string, message: string): PendingEdit {
  return { action, hash, message };
}

describe('RebaseTodoWriter', () => {

  // ── Format validation (tested via writeTodo output) ────────────────────────

  describe('formatting', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseflow-test-'));
      fs.mkdirSync(path.join(tmpDir, 'rebase-merge'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('formats pick action as "pick <hash> <message>"', () => {
      // Write the current todo so validation passes
      const currentTodo = `pick ${SHA.commit1} First commit\n`;
      fs.writeFileSync(path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), currentTodo);

      const git = createMockGitCli({ gitDir: tmpDir });
      // Override readGitFile to read from actual temp dir for the current content check
      git.readGitFile = (relativePath: string) => {
        const full = path.join(tmpDir, relativePath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').trim() : null;
      };

      const writer = new RebaseTodoWriter(git as any);
      const result = writer.writeTodo([
        edit('pick', SHA.commit1, 'First commit'),
      ]);

      assert.strictEqual(result.written, true);
      const written = fs.readFileSync(
        path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), 'utf8'
      );
      assert.strictEqual(written, `pick ${SHA.commit1} First commit\n`);
    });

    it('formats drop action as "# drop <hash> <message>"', () => {
      const currentTodo = `pick ${SHA.commit1} First\npick ${SHA.commit2} Second\n`;
      fs.writeFileSync(path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), currentTodo);

      const git = createMockGitCli({ gitDir: tmpDir });
      git.readGitFile = (relativePath: string) => {
        const full = path.join(tmpDir, relativePath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').trim() : null;
      };

      const writer = new RebaseTodoWriter(git as any);
      writer.writeTodo([
        edit('pick', SHA.commit1, 'First'),
        edit('drop', SHA.commit2, 'Second'),
      ]);

      const written = fs.readFileSync(
        path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), 'utf8'
      );
      assert.ok(written.includes(`# drop ${SHA.commit2} Second`));
    });

    it('formats reword/edit/squash/fixup with their verb', () => {
      const hashes = [SHA.commit1, SHA.commit2, SHA.commit3, SHA.base1];
      const currentTodo = hashes.map((h, i) => `pick ${h} Commit ${i}`).join('\n') + '\n';
      fs.writeFileSync(path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), currentTodo);

      const git = createMockGitCli({ gitDir: tmpDir });
      git.readGitFile = (relativePath: string) => {
        const full = path.join(tmpDir, relativePath);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').trim() : null;
      };

      const writer = new RebaseTodoWriter(git as any);
      writer.writeTodo([
        edit('reword', SHA.commit1, 'Reworded'),
        edit('edit', SHA.commit2, 'Edited'),
        edit('squash', SHA.commit3, 'Squashed'),
        edit('fixup', SHA.base1, 'Fixed up'),
      ]);

      const written = fs.readFileSync(
        path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), 'utf8'
      );
      assert.ok(written.startsWith(`reword ${SHA.commit1} Reworded`));
      assert.ok(written.includes(`edit ${SHA.commit2} Edited`));
      assert.ok(written.includes(`squash ${SHA.commit3} Squashed`));
      assert.ok(written.includes(`fixup ${SHA.base1} Fixed up`));
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('returns written:false when no current todo file exists', () => {
      const git = createMockGitCli(); // readGitFile returns null for everything
      const writer = new RebaseTodoWriter(git as any);
      const result = writer.writeTodo([
        edit('pick', SHA.commit1, 'Something'),
      ]);

      assert.strictEqual(result.written, false);
      assert.deepStrictEqual(result.staleHashes, []);
    });

    it('detects stale hashes not present in current todo', () => {
      const git = createMockGitCli({
        gitFiles: {
          'rebase-merge/git-rebase-todo': `pick ${SHA.commit1} First\npick ${SHA.commit2} Second`,
        },
      });
      const writer = new RebaseTodoWriter(git as any);
      const result = writer.writeTodo([
        edit('pick', SHA.commit1, 'First'),
        edit('pick', SHA.commit3, 'Not in current todo'),  // stale
      ]);

      assert.strictEqual(result.written, false);
      assert.deepStrictEqual(result.staleHashes, [SHA.commit3]);
    });

    it('excludes drop edits from stale hash validation', () => {
      const git = createMockGitCli({
        gitFiles: {
          'rebase-merge/git-rebase-todo': `pick ${SHA.commit1} First`,
        },
        gitDir: os.tmpdir(), // needs a writable gitDir for writeGitFile
      });

      // Need a writable path for the write to succeed
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseflow-test-'));
      fs.mkdirSync(path.join(tmpDir, 'rebase-merge'), { recursive: true });
      git.gitDir = tmpDir;
      git.readGitFile = (relativePath: string) => {
        // Return the mock data for validation, not the temp dir
        if (relativePath === 'rebase-merge/git-rebase-todo') {
          return `pick ${SHA.commit1} First`;
        }
        return null;
      };

      const writer = new RebaseTodoWriter(git as any);
      const result = writer.writeTodo([
        edit('pick', SHA.commit1, 'First'),
        edit('drop', SHA.commit3, 'Dropped — hash not in current todo but that is OK'),
      ]);

      assert.strictEqual(result.written, true);
      assert.deepStrictEqual(result.staleHashes, []);

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns written:true on successful write', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseflow-test-'));
      fs.mkdirSync(path.join(tmpDir, 'rebase-merge'), { recursive: true });

      const git = createMockGitCli({ gitDir: tmpDir });
      git.readGitFile = (relativePath: string) => {
        if (relativePath === 'rebase-merge/git-rebase-todo') {
          return `pick ${SHA.commit1} First\npick ${SHA.commit2} Second`;
        }
        return null;
      };

      const writer = new RebaseTodoWriter(git as any);
      const result = writer.writeTodo([
        edit('pick', SHA.commit2, 'Second'),
        edit('pick', SHA.commit1, 'First'),  // reordered
      ]);

      assert.strictEqual(result.written, true);
      assert.deepStrictEqual(result.staleHashes, []);

      // Verify the file was actually written with the new order
      const content = fs.readFileSync(
        path.join(tmpDir, 'rebase-merge', 'git-rebase-todo'), 'utf8'
      );
      const lines = content.trim().split('\n');
      assert.ok(lines[0].includes(SHA.commit2));
      assert.ok(lines[1].includes(SHA.commit1));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
