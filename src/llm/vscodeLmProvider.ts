import * as vscode from 'vscode';
import { LlmProvider, LlmRequest, LlmResult, LlmUnavailableError, ModelTier } from './provider';
import { logger } from '../logger';

/**
 * Provider backed by the VSCode Language Model API — models supplied by the
 * user's Copilot subscription or any enterprise LM provider extension (no
 * separate API key, but consumes their quota).
 */
export class VsCodeLmProvider implements LlmProvider {
  readonly id = 'vscode-lm' as const;

  static async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  private async pickModel(tier: ModelTier): Promise<vscode.LanguageModelChat> {
    const configured = vscode.workspace
      .getConfiguration('mrLens')
      .get<string>(tier === 'classify' ? 'model.classify' : 'model.analyze', '')
      .trim();

    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      throw new LlmUnavailableError(
        'No VSCode language models available (is GitHub Copilot or an enterprise LM provider signed in?)'
      );
    }
    if (configured) {
      const match = models.find(
        (m) =>
          m.id === configured ||
          m.family === configured ||
          m.name.toLowerCase().includes(configured.toLowerCase())
      );
      if (match) return match;
    }
    // Default to the lowest tier for every stage — cheapest models first;
    // users opt into a bigger model via mrLens.model.* settings.
    const rank = (m: vscode.LanguageModelChat): number => {
      const f = `${m.family} ${m.id}`.toLowerCase();
      if (/mini|haiku|flash|nano|lite/.test(f)) return 0;
      if (/sonnet|gpt-4o/.test(f)) return 1;
      return 2;
    };
    return [...models].sort((a, b) => rank(a) - rank(b))[0];
  }

  async send(req: LlmRequest, cancel: vscode.CancellationToken): Promise<LlmResult> {
    const model = await this.pickModel(req.tier);
    logger.info(
      `VSCode LM: ${req.tier} request → ${model.vendor}/${model.id} (${model.name})`
    );
    const started = Date.now();
    // The LM API only accepts User/Assistant messages; fold the system prompt in.
    const prompt = [
      vscode.LanguageModelChatMessage.User(`${req.system}\n\n---\n\n${req.user}`),
    ];
    const inputTokens = await model.countTokens(prompt[0]);
    const response = await model.sendRequest(prompt, {}, cancel);
    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }
    const outputTokens = await model.countTokens(text);
    logger.info(
      `VSCode LM: ${model.id} responded in ${Date.now() - started}ms — ` +
        `~${inputTokens} in / ~${outputTokens} out tokens (estimated)`
    );
    return {
      text,
      inputTokens,
      outputTokens,
      estimated: true,
      model: model.id,
      provider: this.id,
    };
  }
}
