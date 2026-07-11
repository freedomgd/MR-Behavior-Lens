import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BehaviorGroup, FileDiff, GroupResult, MrInfo, UsageRecord } from '../types';
import { estimateTokens, filterNoise } from '../diff/parser';
import { LlmProvider, LlmResult, extractJson } from '../llm/provider';
import { TokenTracker } from '../llm/tokenTracker';
import { expandContext } from '../context/expander';
import { logger } from '../logger';
import {
  ANALYZE_SYSTEM,
  CLASSIFY_SYSTEM,
  PROMPT_VERSION,
  analyzeUser,
  classifyUser,
} from '../prompts';

export interface PipelineEvents {
  onStatus(message: string): void;
  onGroupResult(result: GroupResult, index: number, total: number): void;
}

export class UserCancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

const MERMAID_HEADERS = /^(sequenceDiagram|flowchart|graph|stateDiagram)/;

/**
 * Clean up Mermaid source before it reaches the webview. Models sometimes wrap
 * the diagram in markdown fences or prepend prose despite the prompt — both
 * make mermaid.render() throw. Returns '' when nothing renderable is left, so
 * the webview skips the diagram instead of crashing on garbage.
 */
function sanitizeMermaid(src: string, groupName: string): string {
  let s = src.trim();
  if (!s) return '';
  const fence = /```(?:mermaid)?\s*([\s\S]*?)```/.exec(s);
  if (fence) {
    s = fence[1].trim();
    logger.info(`Pipeline: "${groupName}" mermaid was fenced in markdown; stripped.`);
  }
  // Drop prose lines before the diagram header (e.g. "Here is the diagram:").
  const lines = s.split('\n');
  const headerIdx = lines.findIndex((l) => MERMAID_HEADERS.test(l.trim()));
  if (headerIdx > 0) {
    logger.info(`Pipeline: "${groupName}" mermaid had ${headerIdx} leading prose line(s); stripped.`);
    s = lines.slice(headerIdx).join('\n').trim();
  } else if (headerIdx === -1) {
    logger.warn(
      `Pipeline: "${groupName}" mermaid has no recognizable diagram header; dropping diagram. ` +
        `First line: "${lines[0]?.slice(0, 80)}"`
    );
    return '';
  }
  return s;
}

export class AnalysisPipeline {
  constructor(
    private readonly provider: LlmProvider,
    private readonly tracker: TokenTracker,
    private readonly cacheState: vscode.Memento
  ) {}

  private cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('mrLens').get<T>(key, fallback);
  }

  private cacheKey(mr: MrInfo, changes: FileDiff[]): string {
    const hash = crypto
      .createHash('sha256')
      .update(PROMPT_VERSION)
      .update(changes.map((c) => c.diff).join('\n'))
      .digest('hex');
    return `mrLens.cache.${mr.projectId}.${mr.iid}.${hash}`;
  }

  private async track(res: LlmResult, stage: UsageRecord['stage'], mrRef: string): Promise<void> {
    await this.tracker.record({
      ts: Date.now(),
      provider: res.provider,
      model: res.model,
      stage,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      estimated: res.estimated,
      mrRef,
    });
  }

  async run(
    mr: MrInfo,
    allChanges: FileDiff[],
    events: PipelineEvents,
    cancel: vscode.CancellationToken
  ): Promise<GroupResult[]> {
    const mrRef = `${mr.projectId}!${mr.iid}`;

    // 0. Cache — re-opening the same diff costs zero tokens.
    const cacheKey = this.cacheKey(mr, allChanges);
    const cached = this.cacheState.get<GroupResult[]>(cacheKey);
    if (cached) {
      logger.info(`Pipeline: cache hit for ${mrRef} (${cached.length} group(s), key ${cacheKey.slice(-12)})`);
      events.onStatus('Loaded from cache (0 tokens)');
      cached.forEach((r, i) =>
        events.onGroupResult({ ...r, fromCache: true }, i, cached.length)
      );
      return cached;
    }

    // 1. Local pre-processing — free.
    logger.info(
      `Pipeline: ${mrRef} — ${allChanges.length} changed file(s), provider ${this.provider.id}`
    );
    const { kept, skipped } = filterNoise(allChanges);
    if (kept.length === 0) {
      throw new Error('No reviewable changes after filtering noise files.');
    }
    if (skipped.length > 0) {
      events.onStatus(`Skipped ${skipped.length} noise file(s): ${skipped.slice(0, 5).join(', ')}`);
    }

    // 2. Budget guard on the classify input.
    const maxGroups = this.cfg('maxGroups', 5);
    const classifyPrompt = classifyUser(mr, kept, maxGroups);
    const classifyEstimate = estimateTokens(CLASSIFY_SYSTEM + classifyPrompt);
    logger.info(`Pipeline: stage A input ~${classifyEstimate} tokens (${kept.length} file(s))`);
    await this.guardBudget(classifyEstimate, 'classification');

    // 3. Stage A — cheap model groups the diff.
    events.onStatus('Stage A: grouping changes into behavior groups…');
    const classifyStarted = Date.now();
    const classifyRes = await this.provider.send(
      { system: CLASSIFY_SYSTEM, user: classifyPrompt, tier: 'classify', maxOutputTokens: 2048 },
      cancel
    );
    logger.info(
      `Pipeline: stage A done in ${Date.now() - classifyStarted}ms — ` +
        `${classifyRes.provider}/${classifyRes.model}, ` +
        `${classifyRes.inputTokens} in / ${classifyRes.outputTokens} out tokens` +
        (classifyRes.estimated ? ' (estimated)' : '')
    );
    await this.track(classifyRes, 'classify', mrRef);
    const groups = this.parseGroups(classifyRes.text, kept).slice(0, maxGroups);
    logger.info(
      `Pipeline: groups: ${groups.map((g) => `"${g.name}" (${g.files.length} file(s))`).join(', ')}`
    );
    events.onStatus(
      `Found ${groups.length} behavior group(s) — classify used ` +
        `${classifyRes.inputTokens + classifyRes.outputTokens} tokens on ${classifyRes.model}`
    );

    // 4. Stage B — per group: optional LSP context, budget check, analyze.
    const contextBytes = this.cfg('contextBytesPerGroup', 4096);
    const results: GroupResult[] = [];
    for (let i = 0; i < groups.length; i++) {
      if (cancel.isCancellationRequested) throw new UserCancelledError();
      const group = groups[i];
      if (group.name === 'no-behavior-change') continue;

      const groupFiles = kept.filter(
        (f) => group.files.includes(f.newPath) || group.files.includes(f.oldPath)
      );
      if (groupFiles.length === 0) continue;

      events.onStatus(`Stage B (${i + 1}/${groups.length}): analyzing "${group.name}"…`);
      const extra = group.needsContext ? await expandContext(group, contextBytes) : '';
      if (group.needsContext) {
        logger.info(
          `Pipeline: "${group.name}" LSP context: ${extra.length} byte(s)${extra ? '' : ' (none found)'}`
        );
      }
      const prompt = analyzeUser(mr, group, groupFiles, extra);
      const analyzeEstimate = estimateTokens(ANALYZE_SYSTEM + prompt);
      logger.info(
        `Pipeline: stage B "${group.name}" — ${groupFiles.length} file(s), input ~${analyzeEstimate} tokens`
      );
      await this.guardBudget(analyzeEstimate, `analysis of "${group.name}"`);

      const analyzeStarted = Date.now();
      const res = await this.provider.send(
        { system: ANALYZE_SYSTEM, user: prompt, tier: 'analyze', maxOutputTokens: 8192 },
        cancel
      );
      logger.info(
        `Pipeline: stage B "${group.name}" done in ${Date.now() - analyzeStarted}ms — ` +
          `${res.provider}/${res.model}, ${res.inputTokens} in / ${res.outputTokens} out tokens` +
          (res.estimated ? ' (estimated)' : '')
      );
      await this.track(res, 'analyze', mrRef);

      const result = this.parseGroupResult(res.text, group);
      logger.info(
        `Pipeline: "${group.name}" parsed — ${result.steps.length} step(s), ` +
          `${result.findings.length} finding(s), diagram: ${
            result.mermaid ? result.diagramType ?? 'yes' : 'none'
          }`
      );
      results.push(result);
      events.onGroupResult(result, results.length - 1, groups.length);
    }

    await this.cacheState.update(cacheKey, results);
    return results;
  }

  private async guardBudget(estimated: number, what: string): Promise<void> {
    const budget = this.cfg('tokenBudget', 30000);
    if (estimated <= budget) return;
    const pick = await vscode.window.showWarningMessage(
      `MR Lens: ${what} will send ~${Math.round(estimated / 1000)}k input tokens ` +
        `(budget: ${Math.round(budget / 1000)}k). Continue?`,
      { modal: true },
      'Continue'
    );
    if (pick !== 'Continue') throw new UserCancelledError();
  }

  private parseGroups(text: string, kept: FileDiff[]): BehaviorGroup[] {
    try {
      const json = extractJson(text);
      const groups = (json.groups ?? []) as any[];
      const parsed = groups
        .filter((g) => g && typeof g.name === 'string')
        .map((g) => ({
          name: g.name,
          description: String(g.description ?? ''),
          files: Array.isArray(g.files) ? g.files.map(String) : [],
          symbols: Array.isArray(g.symbols) ? g.symbols.map(String) : [],
          needsContext: !!g.needsContext,
        }));
      if (parsed.length > 0) return parsed;
      logger.warn('Pipeline: classify reply parsed but contained no valid groups.');
    } catch (e) {
      // fall through to the whole-MR fallback
      logger.warn(
        `Pipeline: classify reply was not valid JSON (${(e as Error).message}); ` +
          'treating the whole MR as one group.'
      );
    }
    return [
      {
        name: 'all-changes',
        description: 'All changes in this merge request (classification failed)',
        files: kept.map((f) => f.newPath),
        symbols: kept.flatMap((f) => f.changedSymbols).slice(0, 20),
        needsContext: false,
      },
    ];
  }

  private parseGroupResult(text: string, group: BehaviorGroup): GroupResult {
    try {
      const json = extractJson(text);
      return {
        group,
        tldr: json.tldr ? String(json.tldr) : undefined,
        summary: String(json.summary ?? ''),
        behaviorChanges: Array.isArray(json.behaviorChanges)
          ? json.behaviorChanges.map(String)
          : [],
        steps: Array.isArray(json.steps)
          ? json.steps
              .filter((s: any) => s && typeof s.text === 'string')
              .map((s: any) => ({
                kind: ['same', 'added', 'removed', 'changed'].includes(s?.kind)
                  ? s.kind
                  : 'same',
                text: String(s.text),
                before: s?.before ? String(s.before) : undefined,
                file: s?.file ? String(s.file) : undefined,
                line: typeof s?.line === 'number' ? s.line : undefined,
              }))
          : [],
        findings: Array.isArray(json.findings)
          ? json.findings.map((f: any) => ({
              severity: ['info', 'warning', 'critical'].includes(f?.severity)
                ? f.severity
                : 'info',
              text: String(f?.text ?? ''),
              file: f?.file ? String(f.file) : undefined,
              line: typeof f?.line === 'number' ? f.line : undefined,
            }))
          : [],
        diagramType: ['sequence', 'flowchart', 'state'].includes(json.diagramType)
          ? json.diagramType
          : undefined,
        mermaid: sanitizeMermaid(String(json.mermaid ?? ''), group.name),
      };
    } catch (e) {
      logger.warn(
        `Pipeline: analyze reply for "${group.name}" was not valid JSON ` +
          `(${(e as Error).message}); showing raw output.`
      );
      return {
        group,
        summary: 'Model reply could not be parsed as JSON; raw output below.',
        behaviorChanges: [],
        steps: [],
        findings: [{ severity: 'warning', text: text.slice(0, 2000) }],
        mermaid: '',
      };
    }
  }
}
