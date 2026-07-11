export interface MrInfo {
  projectId: string;
  iid: number;
  title: string;
  description: string;
  webUrl: string;
  projectWebUrl: string;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  /** base/start SHAs from diff_refs — required to position inline comments */
  baseSha: string;
  startSha: string;
  author: string;
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  diff: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  /** function/method-like names touched by the diff, best-effort */
  changedSymbols: string[];
  addedLines: number;
  removedLines: number;
}

export interface BehaviorGroup {
  name: string;
  description: string;
  files: string[];
  symbols: string[];
  needsContext: boolean;
}

export interface ReviewFinding {
  severity: 'info' | 'warning' | 'critical';
  text: string;
  file?: string;
  line?: number;
}

export type StepKind = 'same' | 'added' | 'removed' | 'changed';

/** One step of the runtime flow, marked with how this MR affects it. */
export interface BehaviorStep {
  kind: StepKind;
  /** the step (for kind=changed: the NEW behavior) */
  text: string;
  /** the OLD behavior, only when kind=changed */
  before?: string;
  file?: string;
  line?: number;
}

export type DiagramType = 'sequence' | 'flowchart' | 'state';

export interface GroupResult {
  group: BehaviorGroup;
  /** one-sentence takeaway, shown in the TL;DR section at the top of the review */
  tldr?: string;
  summary: string;
  behaviorChanges: string[];
  /** primary view: the flow through the changed code as a step diff */
  steps: BehaviorStep[];
  findings: ReviewFinding[];
  diagramType?: DiagramType;
  mermaid: string;
  fromCache?: boolean;
}

export interface UsageRecord {
  ts: number;
  provider: string;
  model: string;
  stage: 'classify' | 'analyze';
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  mrRef: string;
}
