export type CommitStatus = 'base' | 'done' | 'current' | 'pending';

export interface CommitInfo {
  hash: string;           // full sha
  shortHash: string;      // 7-char
  message: string;
  author: string;
  date: string;
  status: CommitStatus;
  conflictFiles?: string[];  // populated when status === 'current'
}

export interface RebaseState {
  isRebasing: boolean;
  sourceBranch: string;   // e.g. "feature/orders"
  targetRef: string;      // e.g. "main"
  forkPointHash: string;  // merge-base commit
  baseCommits: CommitInfo[];    // target branch commits above fork point
  doneCommits: CommitInfo[];    // your commits applied so far
  currentCommit: CommitInfo | null;  // null = no conflict / not paused
  pendingCommits: CommitInfo[];      // not yet applied
  totalCount: number;
  doneCount: number;
}

export const emptyState: RebaseState = {
  isRebasing: false,
  sourceBranch: '',
  targetRef: '',
  forkPointHash: '',
  baseCommits: [],
  doneCommits: [],
  currentCommit: null,
  pendingCommits: [],
  totalCount: 0,
  doneCount: 0,
};
