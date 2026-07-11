import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { TokenTracker } from '../llm/tokenTracker';

export class UsagePanel {
  private static current: UsagePanel | undefined;

  static show(extensionUri: vscode.Uri, tracker: TokenTracker): void {
    if (UsagePanel.current) {
      UsagePanel.current.panel.reveal();
      UsagePanel.current.refresh();
      return;
    }
    UsagePanel.current = new UsagePanel(extensionUri, tracker);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly subs: vscode.Disposable[] = [];

  private constructor(
    extensionUri: vscode.Uri,
    private readonly tracker: TokenTracker
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'mrLensUsage',
      'MR Lens: Token Usage',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    this.subs.push(this.tracker.onDidChange(() => this.refresh()));
    this.panel.onDidDispose(() => {
      this.subs.forEach((s) => s.dispose());
      UsagePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'clear') {
        const pick = await vscode.window.showWarningMessage(
          'Clear all MR Lens token usage history?',
          { modal: true },
          'Clear'
        );
        if (pick === 'Clear') await this.tracker.clear();
      } else if (msg?.type === 'ready') {
        this.refresh();
      }
    });

    const media = (file: string) =>
      this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('usage.css')}">
<title>Token Usage</title>
</head>
<body>
<h1>MR Lens — Token Usage</h1>
<div id="tiles" class="tiles"></div>
<section>
  <h2>Last 14 days</h2>
  <div class="legend" id="legend"></div>
  <div id="chart" class="chart"></div>
</section>
<section>
  <h2>By merge request</h2>
  <table id="byMr"><thead><tr><th>MR</th><th>Requests</th><th>Input</th><th>Output</th></tr></thead><tbody></tbody></table>
</section>
<section>
  <h2>Recent requests</h2>
  <table id="recent"><thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Stage</th><th>Input</th><th>Output</th></tr></thead><tbody></tbody></table>
  <button id="clear">Clear history</button>
</section>
<div id="tooltip" class="tooltip" hidden></div>
<script nonce="${nonce}" src="${media('usage.js')}"></script>
</body>
</html>`;
  }

  private refresh(): void {
    this.panel.webview.postMessage({ type: 'data', records: this.tracker.all() });
  }
}
