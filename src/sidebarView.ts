import * as vscode from 'vscode';
import { logger } from './logger';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mrLens.sidebarView';

  private view?: vscode.WebviewView;

  private status: { busy: boolean; title: string; detail: string; cancellable: boolean } = {
    busy: false,
    title: '',
    detail: 'Ready.',
    cancellable: false,
  };

  /** Set while a cancellable review is running; invoked by the sidebar Cancel button. */
  public onCancelReview?: () => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage((message) => {
      logger.info(`Sidebar: received "${message.type}"${message.mrUrl ? ` (mrUrl: ${message.mrUrl})` : ''}`);
      switch (message.type) {
        case 'ready':
          this.postStatus();
          break;
        case 'cancelReview':
          this.onCancelReview?.();
          break;
        case 'runReview':
          void vscode.commands.executeCommand('mrLens.reviewMergeRequest', message.mrUrl || undefined);
          break;
        case 'demoReview':
          void vscode.commands.executeCommand('mrLens.demoReview');
          break;
        case 'showTokenUsage':
          void vscode.commands.executeCommand('mrLens.showTokenUsage');
          break;
        case 'setGitLabToken':
          void vscode.commands.executeCommand('mrLens.setGitLabToken');
          break;
        case 'setAnthropicApiKey':
          void vscode.commands.executeCommand('mrLens.setAnthropicApiKey');
          break;
        case 'selectModel':
          void vscode.commands.executeCommand('mrLens.selectModel');
          break;
        case 'clearCache':
          void vscode.commands.executeCommand('mrLens.clearCache');
          break;
        case 'openSettings':
          void vscode.commands.executeCommand('workbench.action.openSettings', 'mrLens');
          break;
        default:
          break;
      }
    });
  }

  /** Mark the status card busy with a bold title (e.g. "Reviewing !4"). */
  public startTask(title: string, detail: string, cancellable = false): void {
    this.status = { busy: true, title, detail, cancellable };
    this.postStatus();
  }

  /** Update the detail line of the running task (pipeline stage messages). */
  public updateStatus(detail: string): void {
    this.status = { ...this.status, detail };
    this.postStatus();
  }

  /** Return the card to idle with a final message ("Review complete.", "Cancelled.", …). */
  public finishTask(detail: string): void {
    this.status = { busy: false, title: '', detail, cancellable: false };
    this.postStatus();
  }

  private postStatus(): void {
    void this.view?.webview.postMessage({ type: 'status', ...this.status });
  }

  private getHtmlForWebview(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <style>
      :root {
        --card-bg: var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.08));
        --border: var(--vscode-widget-border, var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.25)));
      }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
        background: transparent;
        padding: 12px;
        margin: 0;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .header .logo {
        width: 22px;
        height: 22px;
        border-radius: 5px;
        display: grid;
        place-items: center;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        flex: none;
      }
      .header .logo svg { width: 14px; height: 14px; }
      .title {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
      }
      .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin: 6px 0 12px;
        line-height: 1.4;
      }

      /* Tabs */
      .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        margin-bottom: 12px;
        border-radius: 6px;
        background: var(--card-bg);
        border: 1px solid var(--border);
      }
      .tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 5px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .tab:hover { color: var(--vscode-foreground); }
      .tab.active {
        background: var(--vscode-editor-background, var(--vscode-sideBar-background));
        color: var(--vscode-foreground);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      }
      .tab svg { width: 13px; height: 13px; flex: none; }
      .tab:focus-visible,
      .action:focus-visible,
      .primary:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .panel { display: none; }
      .panel.active { display: block; }

      .section-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--vscode-descriptionForeground);
        margin: 14px 0 6px;
      }
      .section-label:first-child { margin-top: 0; }

      .primary {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 6px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }
      .primary:hover { background: var(--vscode-button-hoverBackground); }
      .primary svg { width: 14px; height: 14px; }

      .card {
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        background: var(--card-bg);
      }
      .action {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: none;
        border-bottom: 1px solid var(--border);
        background: transparent;
        color: var(--vscode-foreground);
        font-family: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .action:last-child { border-bottom: none; }
      .action:hover { background: var(--vscode-list-hoverBackground); }
      .action svg {
        width: 14px;
        height: 14px;
        flex: none;
        color: var(--vscode-descriptionForeground);
      }
      .action .label { flex: 1; }
      .action .hint {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .action .chevron { width: 12px; height: 12px; }

      .status {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        margin-top: 12px;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--card-bg);
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--vscode-descriptionForeground);
      }
      .status .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        margin-top: 4px;
        flex: none;
        background: var(--vscode-charts-green, #89d185);
      }
      .status.busy .dot {
        background: var(--vscode-charts-yellow, #cca700);
        animation: pulse 1.2s ease-in-out infinite;
      }
      @keyframes pulse {
        50% { opacity: 0.35; }
      }
      .status .body {
        flex: 1;
        min-width: 0;
      }
      .status-title {
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-bottom: 2px;
      }
      .status-title[hidden] { display: none; }
      #status-text { overflow-wrap: anywhere; }
      .status-cancel {
        flex: none;
        align-self: flex-start;
        padding: 2px 8px;
        border: 1px solid var(--vscode-button-border, var(--border));
        border-radius: 4px;
        background: var(--vscode-button-secondaryBackground, transparent);
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        font-family: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .status-cancel:hover {
        background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
      }
      .status-cancel[hidden] { display: none; }
      .status-cancel:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .mr-url-input {
        width: 100%;
        padding: 6px 8px;
        margin-bottom: 8px;
        border: 1px solid var(--vscode-input-border, var(--border));
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: inherit;
        font-size: 12px;
      }
      .mr-url-input::placeholder { color: var(--vscode-input-placeholderForeground); }
      .mr-url-input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }
      .input-hint {
        font-size: 10.5px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
        margin: 0 2px 10px;
      }

      .settings-note {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
        margin: 8px 2px 0;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="logo">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
        </svg>
      </div>
      <div class="title">MR Behavior Lens</div>
    </div>
    <div class="subtitle">Review GitLab merge requests as before/after behavior sequences.</div>

    <div class="tabs" role="tablist">
      <button class="tab active" id="tab-review" role="tab" aria-selected="true" aria-controls="panel-review">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
          <circle cx="8" cy="8" r="1.8" />
        </svg>
        Review
      </button>
      <button class="tab" id="tab-settings" role="tab" aria-selected="false" aria-controls="panel-settings">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="2" />
          <path d="M13.2 8c0-.4.6-1.1.5-1.5-.2-.4-1.1-.4-1.3-.8-.2-.3.1-1.2-.2-1.5-.3-.3-1.1 0-1.5-.2-.3-.2-.4-1.1-.8-1.3-.4-.1-1 .5-1.4.5s-1.1-.6-1.5-.5c-.4.2-.4 1.1-.8 1.3-.3.2-1.2-.1-1.5.2-.3.3 0 1.1-.2 1.5-.2.3-1.1.4-1.3.8-.1.4.5 1 .5 1.4s-.6 1.1-.5 1.5c.2.4 1.1.4 1.3.8.2.3-.1 1.2.2 1.5.3.3 1.1 0 1.5.2.3.2.4 1.1.8 1.3.4.1 1-.5 1.4-.5s1.1.6 1.5.5c.4-.2.4-1.1.8-1.3.3-.2 1.2.1 1.5-.2.3-.3 0-1.1.2-1.5.2-.3 1.1-.4 1.3-.8.1-.4-.5-1-.5-1.4z" />
        </svg>
        Settings
      </button>
    </div>

    <div class="panel active" id="panel-review" role="tabpanel" aria-labelledby="tab-review">
      <div class="section-label">Merge Request</div>
      <input
        type="text"
        id="mr-url"
        class="mr-url-input"
        placeholder="https://gitlab.com/group/project/-/merge_requests/123"
        spellcheck="false"
      />
      <p class="input-hint">Paste a full MR URL, or leave empty to pick from the project's open MRs.</p>
      <button class="primary" data-action="runReview">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5l8 5.5-8 5.5v-11z" /></svg>
        Review Merge Request
      </button>

      <div class="section-label">Tools</div>
      <div class="card">
        <button class="action" data-action="demoReview">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="12" height="9" rx="1.5" />
            <path d="M6 6.5l2 1.5-2 1.5v-3zM5.5 14h5" />
          </svg>
          <span class="label">Demo Review</span>
          <span class="hint">sample data</span>
        </button>
        <button class="action" data-action="showTokenUsage">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 13.5v-4M6.5 13.5v-7M10.5 13.5v-9M14.5 13.5v-5.5" />
          </svg>
          <span class="label">Token Usage</span>
        </button>
      </div>

      <div id="status" class="status">
        <span class="dot"></span>
        <div class="body">
          <div id="status-title" class="status-title" hidden></div>
          <span id="status-text">Ready.</span>
        </div>
        <button id="status-cancel" class="status-cancel" hidden>Cancel</button>
      </div>
    </div>

    <div class="panel" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
      <div class="section-label">Credentials</div>
      <div class="card">
        <button class="action" data-action="setGitLabToken">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 14.5l-6-4.5 1.7-5.5L5.5 8h5l1.8-3.5L14 10l-6 4.5z" />
          </svg>
          <span class="label">Set GitLab Token</span>
        </button>
        <button class="action" data-action="setAnthropicApiKey">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5.5" cy="10.5" r="3" />
            <path d="M7.8 8.2L13.5 2.5M11 5l2 2M9.5 6.5l1.5 1.5" />
          </svg>
          <span class="label">Set Anthropic API Key</span>
        </button>
      </div>

      <div class="section-label">Model</div>
      <div class="card">
        <button class="action" data-action="selectModel">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
            <path d="M6.5 4.5v-2M9.5 4.5v-2M6.5 13.5v-2M9.5 13.5v-2M4.5 6.5h-2M4.5 9.5h-2M13.5 6.5h-2M13.5 9.5h-2" />
          </svg>
          <span class="label">Select LLM Model</span>
        </button>
      </div>

      <div class="section-label">Maintenance</div>
      <div class="card">
        <button class="action" data-action="clearCache">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4" />
          </svg>
          <span class="label">Clear Review Cache</span>
        </button>
        <button class="action" data-action="openSettings">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.5 2.5h4v4M13.5 2.5L8 8M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7" />
          </svg>
          <span class="label">All Settings</span>
          <span class="hint">GitLab URL, budgets…</span>
        </button>
      </div>

      <p class="settings-note">Tokens set here are stored in VS Code secret storage. GitLab URL, project ID, and token budgets live in the full settings page.</p>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const statusEl = document.getElementById('status');
      const statusTitle = document.getElementById('status-title');
      const statusText = document.getElementById('status-text');
      const cancelButton = document.getElementById('status-cancel');

      const tabs = [
        { tab: document.getElementById('tab-review'), panel: document.getElementById('panel-review') },
        { tab: document.getElementById('tab-settings'), panel: document.getElementById('panel-settings') },
      ];
      const state = vscode.getState() || {};
      function activate(index) {
        tabs.forEach((entry, i) => {
          entry.tab.classList.toggle('active', i === index);
          entry.tab.setAttribute('aria-selected', String(i === index));
          entry.panel.classList.toggle('active', i === index);
        });
        vscode.setState({ ...vscode.getState(), tab: index });
      }
      tabs.forEach((entry, i) => entry.tab.addEventListener('click', () => activate(i)));
      if (typeof state.tab === 'number') activate(state.tab);

      const mrUrlInput = document.getElementById('mr-url');
      if (typeof state.mrUrl === 'string') mrUrlInput.value = state.mrUrl;
      mrUrlInput.addEventListener('input', () => {
        vscode.setState({ ...vscode.getState(), mrUrl: mrUrlInput.value });
      });
      mrUrlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') runReview();
      });

      function showBusy(text) {
        statusEl.classList.add('busy');
        statusTitle.hidden = true;
        statusText.textContent = text;
      }

      function runReview() {
        vscode.postMessage({ type: 'runReview', mrUrl: mrUrlInput.value.trim() });
        showBusy('Starting review — resolving merge request…');
      }

      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-action');
          if (!action) return;
          if (action === 'runReview') {
            runReview();
            return;
          }
          vscode.postMessage({ type: action });
          if (action === 'demoReview') {
            showBusy('Opening demo review…');
          }
        });
      });

      cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelReview' });
        statusText.textContent = 'Cancelling…';
        cancelButton.hidden = true;
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'status') {
          statusEl.classList.toggle('busy', !!message.busy);
          statusTitle.hidden = !message.title;
          statusTitle.textContent = message.title || '';
          statusText.textContent = message.detail || '';
          cancelButton.hidden = !(message.busy && message.cancellable);
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
