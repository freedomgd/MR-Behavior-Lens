import * as vscode from 'vscode';
import { LlmProvider, LlmUnavailableError } from './provider';
import { VsCodeLmProvider } from './vscodeLmProvider';
import { AnthropicProvider } from './anthropicProvider';

/** Resolve the active provider per mrLens.provider (auto = vscode.lm → anthropic). */
export async function selectProvider(secrets: vscode.SecretStorage): Promise<LlmProvider> {
  const mode = vscode.workspace.getConfiguration('mrLens').get<string>('provider', 'auto');

  if (mode === 'vscode-lm' || mode === 'auto') {
    if (await VsCodeLmProvider.isAvailable()) {
      return new VsCodeLmProvider();
    }
    if (mode === 'vscode-lm') {
      throw new LlmUnavailableError(
        'No VSCode language models available (GitHub Copilot not signed in?). ' +
          'Switch mrLens.provider to "anthropic" or "auto".'
      );
    }
  }

  const anthropic = await AnthropicProvider.fromSecrets(secrets);
  if (anthropic) {
    return anthropic;
  }
  throw new LlmUnavailableError(
    'No LLM available. Sign in to GitHub Copilot, or set an Anthropic key via ' +
      '"MR Lens: Set Anthropic API Key".'
  );
}
