import { FileDiff } from '../types';

/** Files that add tokens but never explain behavior. */
const NOISE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)go\.sum$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|eot|pdf)$/i,
  /\.(snap|lock)$/,
  /(^|\/)(dist|build|out|vendor|node_modules)\//,
  /\.generated\.[a-z]+$/,
  /\.(pb|pb2)\.(go|py|ts|js)$/,
];

export function isNoiseFile(path: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(path));
}

export function filterNoise(changes: FileDiff[]): { kept: FileDiff[]; skipped: string[] } {
  const kept: FileDiff[] = [];
  const skipped: string[] = [];
  for (const c of changes) {
    if (isNoiseFile(c.newPath) || isNoiseFile(c.oldPath)) {
      skipped.push(c.newPath);
    } else if (c.diff.trim().length === 0) {
      skipped.push(c.newPath); // rename-only / mode-only change
    } else {
      kept.push(c);
    }
  }
  return { kept, skipped };
}

export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/**
 * Best-effort extraction of function/method names touched by a unified diff.
 * Sources: hunk headers ("@@ ... @@ <context>") and added/removed lines that
 * look like declarations. Works across TS/JS/Python/Go/Java/Ruby/PHP-ish code.
 */
export function extractChangedSymbols(diff: string): string[] {
  const symbols = new Set<string>();
  const declRes: RegExp[] = [
    /\bfunction\s+([A-Za-z_$][\w$]*)/, // JS/TS/PHP
    /\bdef\s+([A-Za-z_][\w]*)/, // Python/Ruby
    /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, // Go (incl. methods)
    /\bfn\s+([A-Za-z_][\w]*)/, // Rust
    /(?:public|private|protected|static|async)[\w\s<>,[\]]*\s([A-Za-z_$][\w$]*)\s*\(/, // Java/C#/TS methods
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/, // arrow fns
    /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*{\s*$/, // bare method in class body
  ];
  for (const raw of diff.split('\n')) {
    let line = raw;
    if (line.startsWith('@@')) {
      // "@@ -1,4 +1,5 @@ export function foo(" — GitLab includes enclosing context
      const ctx = line.replace(/^@@[^@]*@@\s*/, '');
      line = ' ' + ctx;
    } else if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) {
      continue;
    }
    const body = line.slice(1);
    for (const re of declRes) {
      const m = re.exec(body);
      if (m && m[1] && m[1].length > 1) {
        symbols.add(m[1]);
        break;
      }
    }
  }
  return [...symbols].slice(0, 20);
}

/**
 * Trim a diff for prompting: drop hunks that only touch blank lines/comments is
 * too risky, so we only cap total size, keeping whole hunks from the top.
 */
export function capDiff(diff: string, maxChars: number): { text: string; truncated: boolean } {
  if (diff.length <= maxChars) return { text: diff, truncated: false };
  const lines = diff.split('\n');
  const out: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > maxChars) break;
    out.push(line);
    size += line.length + 1;
  }
  out.push('... [diff truncated]');
  return { text: out.join('\n'), truncated: true };
}

/** Rough token estimate — good enough for the budget guard. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
