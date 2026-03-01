export type CommitStatus = 'base' | 'done' | 'current' | 'pending';

export interface CommitInfo {
  hash: string;           // original full sha (from the feature branch)
  shortHash: string;      // original 7-char
  newHash?: string;       // new sha after rebase (for done commits — the cherry-picked copy)
  newShortHash?: string;  // new 7-char
  message: string;
  author: string;
  date: string;
  status: CommitStatus;
  conflictFiles?: string[];  // populated when status === 'current'
  changedFiles?: string[];   // files touched by this commit
}

export interface ConflictCausation {
  file: string;                  // the conflicting file path
  baseCommitHashes: string[];    // which base commits also touched this file
}

export interface RebaseState {
  isRebasing: boolean;
  sourceBranch: string;   // e.g. "feature/orders"
  targetRef: string;      // e.g. "main" (friendly display name)
  ontoHash: string;       // raw sha of the commit we're rebasing onto
  origHead: string;       // feature branch tip before rebase started
  forkPointHash: string;  // merge-base commit
  baseCommits: CommitInfo[];    // target branch commits above fork point
  doneCommits: CommitInfo[];    // your commits applied so far (with new hashes)
  currentCommit: CommitInfo | null;  // null = no conflict / not paused
  pendingCommits: CommitInfo[];      // not yet applied
  conflictCausation: ConflictCausation[];  // which base commits caused each conflict file
  totalCount: number;
  doneCount: number;
}

export const emptyState: RebaseState = {
  isRebasing: false,
  sourceBranch: '',
  targetRef: '',
  ontoHash: '',
  origHead: '',
  forkPointHash: '',
  baseCommits: [],
  doneCommits: [],
  currentCommit: null,
  pendingCommits: [],
  conflictCausation: [],
  totalCount: 0,
  doneCount: 0,
};
