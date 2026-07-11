import * as vscode from 'vscode';

export type ModelTier = 'classify' | 'analyze';

export interface LlmRequest {
  system: string;
  user: string;
  tier: ModelTier;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** true when token counts are approximations rather than provider-reported */
  estimated: boolean;
  model: string;
  provider: string;
}

export interface LlmProvider {
  readonly id: 'vscode-lm' | 'anthropic';
  send(req: LlmRequest, cancel: vscode.CancellationToken): Promise<LlmResult>;
}

export class LlmUnavailableError extends Error {}

/** Strip markdown fences and extract the first JSON object from a model reply. */
export function extractJson(text: string): any {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model reply contained no JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
