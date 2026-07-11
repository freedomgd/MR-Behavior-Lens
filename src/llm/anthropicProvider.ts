import * as vscode from 'vscode';
import { LlmProvider, LlmRequest, LlmResult, LlmUnavailableError, ModelTier } from './provider';
import { logger } from '../logger';

// Default to the lowest tier (cheapest) model for both stages; users opt into
// a bigger model via "MR Lens: Select LLM Model…" / mrLens.model.* settings.
const DEFAULT_MODELS: Record<ModelTier, string> = {
  classify: 'claude-haiku-4-5',
  analyze: 'claude-haiku-4-5',
};

/**
 * Provider backed by the Anthropic Messages API via raw fetch (no SDK dep, keeps
 * the extension bundle small). Token counts come straight from response.usage.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;

  constructor(private readonly apiKey: string) {}

  static async fromSecrets(secrets: vscode.SecretStorage): Promise<AnthropicProvider | null> {
    const key = await secrets.get('mrLens.anthropicApiKey');
    return key ? new AnthropicProvider(key) : null;
  }

  private modelFor(tier: ModelTier): string {
    const configured = vscode.workspace
      .getConfiguration('mrLens')
      .get<string>(tier === 'classify' ? 'model.classify' : 'model.analyze', '')
      .trim();
    return configured || DEFAULT_MODELS[tier];
  }

  async send(req: LlmRequest, cancel: vscode.CancellationToken): Promise<LlmResult> {
    const model = this.modelFor(req.tier);
    logger.info(
      `Anthropic: ${req.tier} request → ${model} ` +
        `(system ${req.system.length}B, user ${req.user.length}B, max_tokens ${req.maxOutputTokens ?? 8192})`
    );
    const started = Date.now();
    const controller = new AbortController();
    const sub = cancel.onCancellationRequested(() => controller.abort());
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens ?? 8192,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.error(`Anthropic: HTTP ${res.status} after ${Date.now() - started}ms: ${body.slice(0, 300)}`);
        if (res.status === 401) {
          throw new LlmUnavailableError(
            'Anthropic API key invalid — run "MR Lens: Set Anthropic API Key"'
          );
        }
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
      }
      const data: any = await res.json();
      if (data.stop_reason === 'refusal') {
        throw new Error('Anthropic API declined the request (stop_reason: refusal)');
      }
      const text = (data.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      logger.info(
        `Anthropic: ${model} responded in ${Date.now() - started}ms — ` +
          `${data.usage?.input_tokens ?? '?'} in / ${data.usage?.output_tokens ?? '?'} out tokens, ` +
          `stop_reason ${data.stop_reason ?? 'n/a'}`
      );
      return {
        text,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        estimated: false,
        model,
        provider: this.id,
      };
    } finally {
      sub.dispose();
    }
  }
}
