import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { GitLabClient } from './gitlab/client';
import { TokenTracker } from './llm/tokenTracker';
import { selectProvider } from './llm/select';
import { selectModelCommand } from './llm/modelPicker';
import { AnalysisPipeline, UserCancelledError } from './pipeline/analyze';
import { ReviewPanel } from './webview/reviewPanel';
import { UsagePanel } from './webview/usagePanel';
import { SidebarViewProvider } from './sidebarView';
import { runDemoReview } from './demo';
import { logger } from './logger';

const exec = promisify(execFile);

export function activate(context: vscode.ExtensionContext): void {
  logger.info('Extension activated.');
  const tracker = new TokenTracker(context.globalState);
  const sidebarProvider = new SidebarViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('mrLens.setGitLabToken', () =>
      storeSecret(
        context,
        'mrLens.gitlabToken',
        'GitLab personal access token (read_api scope; api scope to post comments)'
      )
    ),
    vscode.commands.registerCommand('mrLens.setAnthropicApiKey', () =>
      storeSecret(context, 'mrLens.anthropicApiKey', 'Anthropic API key (sk-ant-…)')
    ),
    vscode.commands.registerCommand('mrLens.selectModel', () =>
      selectModelCommand(context.secrets)
    ),
    vscode.commands.registerCommand('mrLens.showTokenUsage', () =>
      UsagePanel.show(context.extensionUri, tracker)
    ),
    vscode.commands.registerCommand('mrLens.clearCache', async () => {
      const keys = context.workspaceState.keys().filter((k) => k.startsWith('mrLens.cache.'));
      for (const key of keys) {
        await context.workspaceState.update(key, undefined);
      }
      void vscode.window.showInformationMessage(`MR Lens: cleared ${keys.length} cached review(s).`);
    }),
    vscode.commands.registerCommand('mrLens.reviewMergeRequest', (mrUrl?: string) =>
      reviewMergeRequest(context, tracker, sidebarProvider, mrUrl).catch((e) => {
        if (e instanceof UserCancelledError) {
          logger.info('Review cancelled by user.');
          sidebarProvider.finishTask('Cancelled.');
        } else {
          logger.error(`Review failed: ${(e as Error).message}`);
          sidebarProvider.finishTask(`Error: ${(e as Error).message}`);
          void vscode.window.showErrorMessage(`MR Lens: ${(e as Error).message}`);
        }
      })
    ),
    vscode.commands.registerCommand('mrLens.demoReview', async () => {
      sidebarProvider.startTask('Demo review', 'Opening demo review…');
      await runDemoReview(context.extensionUri, (message) =>
        sidebarProvider.updateStatus(message)
      );
      sidebarProvider.finishTask('Demo review complete.');
    }),
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider),
    logger
  );
}

async function storeSecret(
  context: vscode.ExtensionContext,
  key: string,
  prompt: string
): Promise<void> {
  const value = await vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true });
  if (value === undefined) return;
  if (value === '') {
    await context.secrets.delete(key);
    void vscode.window.showInformationMessage('MR Lens: secret cleared.');
  } else {
    await context.secrets.store(key, value.trim());
    void vscode.window.showInformationMessage('MR Lens: secret saved.');
  }
}

interface ParsedMrUrl {
  gitlabUrl: string;
  projectPath: string;
  iid: number;
}

/**
 * Parse a full MR URL like https://gitlab.com/group/sub/project/-/merge_requests/123
 * (also the legacy form without `/-`). Returns undefined if it doesn't look like an MR URL.
 */
export function parseMrUrl(input: string): ParsedMrUrl | undefined {
  const m = /^(https?:\/\/[^/]+)\/(.+?)(?:\/-)?\/merge_requests\/(\d+)(?:[/?#]|$)/.exec(
    input.trim()
  );
  if (!m) return undefined;
  return { gitlabUrl: m[1], projectPath: m[2], iid: Number(m[3]) };
}

/** projectId from settings, or derived from the workspace git remote. */
async function resolveProjectId(gitlabUrl: string): Promise<string> {
  const configured = vscode.workspace
    .getConfiguration('mrLens')
    .get<string>('gitlab.projectId', '')
    .trim();
  if (configured) return configured;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    try {
      const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], {
        cwd: folder.uri.fsPath,
      });
      const remote = stdout.trim();
      const host = new URL(gitlabUrl).host;
      // git@host:group/project.git  |  https://host/group/project.git
      const m =
        new RegExp(`${host.replace(/\./g, '\\.')}[:/](.+?)(?:\\.git)?$`).exec(remote) ?? undefined;
      if (m) return m[1];
    } catch {
      // not a git repo / no remote — fall through to prompt
    }
  }
  const typed = await vscode.window.showInputBox({
    prompt: 'GitLab project ID or path (e.g. 278964 or gitlab-org/gitlab)',
    ignoreFocusOut: true,
  });
  if (!typed) throw new UserCancelledError();
  return typed.trim();
}

/** Pick an MR from the project's open list, or type an IID directly. */
async function pickMergeRequestIid(client: GitLabClient, projectId: string): Promise<number> {
  type MrPick = vscode.QuickPickItem & { iid: number };
  const items: Thenable<MrPick[]> = client.listOpenMergeRequests(projectId).then((mrs) => [
    ...mrs.map((mr) => ({
      label: `!${mr.iid} ${mr.title}`,
      description: `${mr.sourceBranch} · ${mr.author}`,
      iid: mr.iid,
    })),
    { label: '$(edit) Enter MR IID…', description: '', iid: -1 },
  ]);
  const picked = await vscode.window.showQuickPick<MrPick>(items, {
    placeHolder: `Open merge requests in ${projectId}`,
  });
  if (!picked) throw new UserCancelledError();
  if (picked.iid !== -1) return picked.iid;
  const typed = await vscode.window.showInputBox({ prompt: 'MR IID (number after !)' });
  if (!typed || !/^\d+$/.test(typed.trim())) throw new UserCancelledError();
  return Number(typed.trim());
}

async function reviewMergeRequest(
  context: vscode.ExtensionContext,
  tracker: TokenTracker,
  sidebar: SidebarViewProvider,
  mrUrl?: string
): Promise<void> {
  logger.info(`Review requested${mrUrl ? ` for URL: ${mrUrl}` : ' (no URL, using picker)'}`);
  const config = vscode.workspace.getConfiguration('mrLens');
  let gitlabUrl = config.get<string>('gitlab.url', 'https://gitlab.com');
  let projectId: string;
  let parsedIid: number | undefined;

  if (mrUrl) {
    const parsed = parseMrUrl(mrUrl);
    if (!parsed) {
      throw new Error(
        `Not a valid merge request URL: "${mrUrl}". Expected e.g. https://gitlab.com/group/project/-/merge_requests/123`
      );
    }
    gitlabUrl = parsed.gitlabUrl;
    projectId = parsed.projectPath;
    parsedIid = parsed.iid;
    logger.info(
      `Parsed MR URL → instance: ${gitlabUrl}, project: ${projectId}, iid: !${parsedIid}`
    );
  } else {
    projectId = await resolveProjectId(gitlabUrl);
    logger.info(`Resolved project: ${projectId} on ${gitlabUrl}`);
  }

  // settings token (enterprise / centrally-managed setups) wins over secret storage
  const token =
    config.get<string>('gitlab.token', '').trim() ||
    (await context.secrets.get('mrLens.gitlabToken'));
  logger.info(`GitLab token: ${token ? 'present' : 'none (public projects only)'}`);
  const client = new GitLabClient(gitlabUrl, token);

  const iid = parsedIid ?? (await pickMergeRequestIid(client, projectId));

  const provider = await selectProvider(context.secrets);
  const pipeline = new AnalysisPipeline(provider, tracker, context.workspaceState);

  sidebar.startTask(`Reviewing !${iid}`, 'Fetching merge request changes…', true);
  logger.info(`Fetching changes for !${iid} in ${projectId}…`);
  const { mr, changes } = await client.getMergeRequestChanges(projectId, iid);
  logger.info(`Fetched MR "${mr.title}" — ${changes.length} changed file(s).`);
  const panel = ReviewPanel.show(context.extensionUri, mr, client);

  const cancelSource = new vscode.CancellationTokenSource();
  sidebar.onCancelReview = () => cancelSource.cancel();

  try {
    // Status-bar spinner only — detailed progress lives in the sidebar status card.
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `MR Lens: reviewing !${iid}` },
      async (progress) => {
        try {
          await pipeline.run(
            mr,
            changes,
            {
              onStatus: (message) => {
                logger.info(`Pipeline: ${message}`);
                progress.report({ message });
                sidebar.updateStatus(message);
                panel.setStatus(message);
              },
              onGroupResult: (result, index, total) => {
                logger.info(`Pipeline: group ${index + 1}/${total} analyzed.`);
                panel.addGroupResult(result, index, total);
              },
            },
            cancelSource.token
          );
          logger.info(`Review of !${iid} complete.`);
          panel.finish();
          sidebar.finishTask(`Review of !${iid} complete.`);
        } catch (e) {
          const message =
            e instanceof UserCancelledError ? 'Cancelled' : `Error: ${(e as Error).message}`;
          logger.info(`Pipeline stopped: ${message}`);
          panel.finish(message);
          sidebar.finishTask(message === 'Cancelled' ? 'Cancelled.' : message);
          if (!(e instanceof UserCancelledError)) throw e;
        }
      }
    );
  } finally {
    sidebar.onCancelReview = undefined;
    cancelSource.dispose();
  }
}

export function deactivate(): void {}
