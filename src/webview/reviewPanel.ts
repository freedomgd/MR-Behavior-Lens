import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { GitLabClient, GitLabError } from '../gitlab/client';
import { GroupResult, MrInfo } from '../types';
import { logger } from '../logger';

export class ReviewPanel {
  private static current: ReviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static show(extensionUri: vscode.Uri, mr: MrInfo, client?: GitLabClient): ReviewPanel {
    ReviewPanel.current?.dispose();
    ReviewPanel.current = new ReviewPanel(extensionUri, mr, client);
    return ReviewPanel.current;
  }

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly mr: MrInfo,
    private readonly client?: GitLabClient
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'mrLensReview',
      `MR Lens: !${mr.iid} ${mr.title}`.slice(0, 60),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (ReviewPanel.current === this) ReviewPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.panel.webview.html = this.html();
  }

  setStatus(message: string): void {
    if (!this.disposed) this.panel.webview.postMessage({ type: 'status', message });
  }

  addGroupResult(result: GroupResult, index: number, total: number): void {
    if (!this.disposed) {
      this.panel.webview.postMessage({ type: 'group', result, index, total });
    }
  }

  finish(error?: string): void {
    if (!this.disposed) this.panel.webview.postMessage({ type: 'done', error });
  }

  dispose(): void {
    if (!this.disposed) this.panel.dispose();
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg?.type === 'postComment') {
      await this.postComment(msg);
      return;
    }
    if (msg?.type !== 'openLocation' || typeof msg.file !== 'string') return;
    const line = typeof msg.line === 'number' && msg.line > 0 ? msg.line : 1;

    // Prefer the file in the workspace; fall back to GitLab blob URL.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, msg.file);
      try {
        await vscode.workspace.fs.stat(uri);
        const doc = await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.One,
        });
        const pos = new vscode.Position(line - 1, 0);
        doc.selection = new vscode.Selection(pos, pos);
        doc.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        return;
      } catch {
        // not in this folder
      }
    }
    if (this.mr.projectWebUrl) {
      const url = `${this.mr.projectWebUrl}/-/blob/${this.mr.headSha}/${msg.file}#L${line}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  /**
   * Post a comment to the MR: inline (diff discussion) when a file:line anchor
   * is given, otherwise a general note. Single-line comments go through an
   * input box so the user can edit; multiline review posts (behavior change +
   * diagram) are previewed in a modal dialog instead — nothing is published to
   * GitLab without confirmation.
   */
  private async postComment(msg: {
    id?: string;
    text?: string;
    file?: string;
    line?: number;
    multiline?: boolean;
    label?: string;
  }): Promise<void> {
    const reply = (ok: boolean) => {
      if (!this.disposed && msg.id) {
        this.panel.webview.postMessage({ type: 'commentResult', id: msg.id, ok });
      }
    };
    if (!this.client) {
      void vscode.window.showWarningMessage('MR Lens: commenting is not available in demo mode.');
      reply(false);
      return;
    }
    const inline = typeof msg.file === 'string' && typeof msg.line === 'number' && msg.line > 0;
    let body: string | undefined;
    if (msg.multiline) {
      const text = (msg.text ?? '').trim();
      if (!text) {
        reply(false);
        return;
      }
      const preview = text.length > 800 ? `${text.slice(0, 800)}\n…` : text;
      const pick = await vscode.window.showInformationMessage(
        `Post MR Lens review${msg.label ? ` of "${msg.label}"` : ''} as a comment on !${this.mr.iid}?`,
        { modal: true, detail: preview },
        'Post to MR'
      );
      if (pick !== 'Post to MR') {
        reply(false);
        return;
      }
      body = text;
    } else {
      body = await vscode.window.showInputBox({
        prompt: inline
          ? `Inline comment on ${msg.file}:${msg.line} in !${this.mr.iid}`
          : `Comment on merge request !${this.mr.iid}`,
        value: msg.text ?? '',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : 'Comment cannot be empty'),
      });
    }
    if (body === undefined || !body.trim()) {
      reply(false);
      return;
    }
    try {
      if (inline && this.mr.baseSha && this.mr.startSha && this.mr.headSha) {
        try {
          await this.client.postMergeRequestInlineComment(
            this.mr.projectId,
            this.mr.iid,
            body.trim(),
            {
              baseSha: this.mr.baseSha,
              startSha: this.mr.startSha,
              headSha: this.mr.headSha,
              filePath: msg.file!,
              line: msg.line!,
            }
          );
          void vscode.window.showInformationMessage(
            `MR Lens: inline comment posted on ${msg.file}:${msg.line}.`
          );
          reply(true);
          return;
        } catch (e) {
          // GitLab rejects positions not on a visible diff line — fall back to a note.
          if (!(e instanceof GitLabError && e.status === 400)) throw e;
          logger.info(`Inline position rejected for ${msg.file}:${msg.line}, posting as note.`);
        }
      }
      const prefix = inline ? `\`${msg.file}:${msg.line}\` — ` : '';
      await this.client.postMergeRequestNote(this.mr.projectId, this.mr.iid, prefix + body.trim());
      void vscode.window.showInformationMessage(`MR Lens: comment posted on !${this.mr.iid}.`);
      reply(true);
    } catch (e) {
      logger.error(`Posting comment failed: ${(e as Error).message}`);
      void vscode.window.showErrorMessage(`MR Lens: ${(e as Error).message}`);
      reply(false);
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = crypto.randomBytes(16).toString('hex');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${media('review.css')}">
<title>MR Lens Review</title>
</head>
<body>
<header>
  <h1>!${this.mr.iid} ${esc(this.mr.title)}</h1>
  <div class="meta">${esc(this.mr.sourceBranch)} → ${esc(this.mr.targetBranch)} · ${esc(this.mr.author)}
    <button id="mr-comment" class="comment-btn" title="Post a comment on this merge request">💬 Comment on MR</button>
  </div>
  <div id="status" class="status">Starting…</div>
</header>
<section id="tldr" class="tldr" hidden>
  <h2>TL;DR</h2>
  <ul id="tldr-list"></ul>
</section>
<nav id="tabs"></nav>
<main id="content"></main>
<script nonce="${nonce}" src="${media('mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${media('review.js')}"></script>
</body>
</html>`;
  }
}
