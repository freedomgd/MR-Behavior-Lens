import * as vscode from 'vscode';
import { ModelTier } from './provider';

/** Known Anthropic API models offered in the picker (freetext covers anything newer). */
const ANTHROPIC_MODELS: { id: string; detail: string }[] = [
  { id: 'claude-haiku-4-5', detail: 'Lowest tier — fastest and cheapest (default for both stages)' },
  { id: 'claude-sonnet-5', detail: 'Best speed/intelligence balance' },
  { id: 'claude-opus-4-8', detail: 'Most capable Opus-tier model' },
];

type ModelPick = vscode.QuickPickItem & { value?: string; custom?: boolean };

/**
 * "MR Lens: Select LLM Model…" — lists the models currently active in this
 * VSCode (Language Model API, all vendors) plus known Anthropic API models,
 * with a freetext escape hatch, and writes the choice to settings.
 */
export async function selectModelCommand(secrets: vscode.SecretStorage): Promise<void> {
  type TierPick = vscode.QuickPickItem & { tier: ModelTier };
  const tierPicked = await vscode.window.showQuickPick<TierPick>(
    [
      {
        label: 'Analyze model',
        description: 'mrLens.model.analyze',
        detail: 'Main analysis stage — behavior review per group',
        tier: 'analyze',
      },
      {
        label: 'Classify model',
        description: 'mrLens.model.classify',
        detail: 'Cheap classification stage — groups the diff first',
        tier: 'classify',
      },
    ],
    { placeHolder: 'Which stage do you want to set the model for?' }
  );
  if (!tierPicked) return;

  const settingKey = tierPicked.tier === 'classify' ? 'model.classify' : 'model.analyze';
  const config = vscode.workspace.getConfiguration('mrLens');
  const current = config.get<string>(settingKey, '').trim();

  const items: ModelPick[] = [];

  let lmModels: readonly vscode.LanguageModelChat[] = [];
  try {
    lmModels = await vscode.lm.selectChatModels();
  } catch {
    // LM API unavailable — Anthropic list still works
  }
  if (lmModels.length > 0) {
    items.push({
      label: 'VSCode Language Models (Copilot / enterprise providers)',
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const m of lmModels) {
      items.push({
        label: m.id,
        description: `${m.vendor} · ${m.family}`,
        detail: m.name,
        value: m.id,
      });
    }
  }

  const hasAnthropicKey = !!(await secrets.get('mrLens.anthropicApiKey'));
  items.push({
    label: hasAnthropicKey
      ? 'Anthropic API'
      : 'Anthropic API (no key set — run "MR Lens: Set Anthropic API Key")',
    kind: vscode.QuickPickItemKind.Separator,
  });
  for (const m of ANTHROPIC_MODELS) {
    items.push({ label: m.id, detail: m.detail, value: m.id });
  }

  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(edit) Enter model id…',
    detail: 'Freetext — any model id your provider accepts',
    custom: true,
  });
  items.push({
    label: '$(discard) Use provider default',
    detail: 'Clear the setting',
    value: '',
  });

  for (const item of items) {
    if (item.value !== undefined && item.value === current && current !== '') {
      item.description = `${item.description ? `${item.description} · ` : ''}current`;
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Model for the ${tierPicked.tier} stage${current ? ` (current: ${current})` : ''}`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;

  let value = picked.value;
  if (picked.custom) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Model id (e.g. claude-sonnet-5, gpt-4o, or an enterprise model id)',
      value: current,
      ignoreFocusOut: true,
    });
    if (typed === undefined) return;
    value = typed.trim();
  }

  await config.update(settingKey, value, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    value
      ? `MR Lens: ${tierPicked.tier} model set to "${value}".`
      : `MR Lens: ${tierPicked.tier} model reset to provider default.`
  );
}
