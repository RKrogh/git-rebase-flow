import * as vscode from 'vscode';
import { RebaseState, CommitInfo } from '../models/RebaseState';

// ── Tree item types ────────────────────────────────────────────────────────

type SectionKind = 'section-base' | 'section-yours';

class SectionItem extends vscode.TreeItem {
  readonly kind: SectionKind;
  constructor(label: string, kind: SectionKind) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.kind = kind;
    this.contextValue = 'section';
  }
}

class CommitItem extends vscode.TreeItem {
  constructor(readonly commit: CommitInfo) {
    super(commit.message, vscode.TreeItemCollapsibleState.None);
    this.description  = commit.shortHash;
    this.tooltip      = `${commit.hash}\n${commit.author} · ${commit.date}`;
    this.contextValue = `commit-${commit.status}`;
    this.iconPath     = CommitItem.iconFor(commit);
  }

  private static iconFor(c: CommitInfo): vscode.ThemeIcon {
    switch (c.status) {
      case 'base':    return new vscode.ThemeIcon('circle-outline',  new vscode.ThemeColor('charts.blue'));
      case 'done':    return new vscode.ThemeIcon('check',           new vscode.ThemeColor('charts.green'));
      case 'current': return new vscode.ThemeIcon('warning',         new vscode.ThemeColor('charts.orange'));
      case 'pending': return new vscode.ThemeIcon('circle-filled',   new vscode.ThemeColor('disabledForeground'));
    }
  }
}

class ForkPointItem extends vscode.TreeItem {
  constructor(hash: string) {
    super('fork point', vscode.TreeItemCollapsibleState.None);
    this.description  = hash.substring(0, 7);
    this.tooltip      = `Merge base: ${hash}`;
    this.contextValue = 'forkPoint';
    this.iconPath     = new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.yellow'));
  }
}

type TreeNode = SectionItem | CommitItem | ForkPointItem;

// ── Provider ──────────────────────────────────────────────────────────────

export class RebaseTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private state: RebaseState | null = null;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  update(state: RebaseState): void {
    this.state = state;
    this._onDidChangeTreeData.fire(undefined); // refresh entire tree
  }

  getTreeItem(element: TreeNode): vscode.TreeItem { return element; }

  getChildren(element?: TreeNode): TreeNode[] {
    // Flat list — no nested children in this design
    if (element) { return []; }
    if (!this.state?.isRebasing) { return []; }

    const nodes: TreeNode[] = [];
    const s = this.state;

    // ── Base branch section ──────────────────────────────────────────────
    nodes.push(new SectionItem('TARGET BASE', 'section-base'));

    for (const c of s.baseCommits) {
      nodes.push(new CommitItem(c));
    }

    nodes.push(new ForkPointItem(s.forkPointHash));

    // ── Your commits section ─────────────────────────────────────────────
    nodes.push(new SectionItem('YOUR COMMITS (rebasing)', 'section-yours'));

    for (const c of s.doneCommits) {
      nodes.push(new CommitItem(c));
    }

    if (s.currentCommit) {
      const item = new CommitItem(s.currentCommit);
      // Conflict files as a decorative suffix
      if (s.currentCommit.conflictFiles?.length) {
        item.description = `${s.currentCommit.shortHash}  ⚡ ${s.currentCommit.conflictFiles.length} conflict${s.currentCommit.conflictFiles.length > 1 ? 's' : ''}`;
      }
      nodes.push(item);
    }

    for (const c of s.pendingCommits) {
      const item = new CommitItem(c);
      if (c.action && c.action !== 'pick') {
        item.description = `[${c.action}] ${c.shortHash}`;
      }
      nodes.push(item);
    }

    return nodes;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
