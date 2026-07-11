import * as vscode from 'vscode';
import { GroupResult, MrInfo } from './types';
import { ReviewPanel } from './webview/reviewPanel';

const DEMO_MR: MrInfo = {
  projectId: 'acme/payments-service',
  iid: 42,
  title: 'Retry failed webhook deliveries with exponential backoff',
  description: 'Failed webhook deliveries are currently dropped. Enqueue them for retry instead.',
  webUrl: 'https://gitlab.example.com/acme/payments-service/-/merge_requests/42',
  projectWebUrl: 'https://gitlab.example.com/acme/payments-service',
  sourceBranch: 'feature/webhook-retries',
  targetBranch: 'main',
  headSha: 'demo0000',
  baseSha: '',
  startSha: '',
  author: 'Demo User',
};

const DEMO_GROUPS: GroupResult[] = [
  {
    group: {
      name: 'webhook-retry-backoff',
      description: 'Failed webhook deliveries are retried with exponential backoff instead of dropped.',
      files: ['src/webhooks/dispatcher.ts', 'src/webhooks/retryQueue.ts'],
      symbols: ['deliver', 'enqueueRetry'],
      needsContext: true,
    },
    tldr: 'Failed webhook deliveries are now retried with backoff instead of dropped.',
    summary:
      'Webhook delivery failures no longer drop the event. deliver() [src/webhooks/dispatcher.ts:31] now enqueues the event into a new RetryQueue with exponential backoff (2^attempt seconds, max 5 attempts) before giving up.',
    steps: [
      { kind: 'same', text: 'PaymentGateway calls deliver(event)', file: 'src/webhooks/dispatcher.ts', line: 31 },
      { kind: 'same', text: 'Dispatcher POSTs the event to the receiver', file: 'src/webhooks/dispatcher.ts', line: 39 },
      { kind: 'same', text: 'Receiver responds 503 Service Unavailable' },
      { kind: 'removed', text: 'Dispatcher returns 500 to the gateway and the event is dropped permanently', file: 'src/webhooks/dispatcher.ts', line: 52 },
      { kind: 'added', text: 'Event is enqueued into RetryQueue with attempt=1', file: 'src/webhooks/retryQueue.ts', line: 24 },
      { kind: 'added', text: 'Dispatcher acknowledges the gateway with 202 Accepted', file: 'src/webhooks/dispatcher.ts', line: 58 },
      { kind: 'added', text: 'RetryQueue waits 2^attempt seconds and re-POSTs, up to 5 attempts', file: 'src/webhooks/retryQueue.ts', line: 47 },
      { kind: 'added', text: 'After 5 failed attempts the event moves to the dead-letter table', file: 'src/webhooks/retryQueue.ts', line: 71 },
    ],
    diagramType: 'sequence',
    behaviorChanges: [
      'Before: a 5xx from the receiver dropped the event permanently. After: the event is re-enqueued with backoff [src/webhooks/retryQueue.ts:24].',
      'Before: the gateway saw a 500 on first failure. After: the dispatcher acknowledges with 202 and retries in the background [src/webhooks/dispatcher.ts:58].',
      'New terminal state: after 5 failed attempts the event is moved to a dead-letter table [src/webhooks/retryQueue.ts:71].',
    ],
    findings: [
      {
        severity: 'critical',
        text: 'Retries are not idempotent: the receiver may get the same event twice if a timeout races a slow 200. No delivery id / dedupe key is sent.',
        file: 'src/webhooks/dispatcher.ts',
        line: 44,
      },
      {
        severity: 'warning',
        text: 'Backoff is computed as 2 ** attempt with no jitter — synchronized retry storms are possible after an outage.',
        file: 'src/webhooks/retryQueue.ts',
        line: 47,
      },
      {
        severity: 'info',
        text: 'Dead-letter rows have no TTL or cleanup job yet.',
        file: 'src/webhooks/retryQueue.ts',
        line: 71,
      },
    ],
    mermaid: `sequenceDiagram
  participant GW as PaymentGateway
  participant D as WebhookDispatcher
  participant R as Receiver
  participant Q as RetryQueue
  GW->>D: deliver(event) [src/webhooks/dispatcher.ts:31]
  D->>R: POST /webhook [src/webhooks/dispatcher.ts:39]
  R-->>D: 503 Service Unavailable
  rect rgb(120,45,45)
    D-->>GW: 🔴 500 — event dropped [src/webhooks/dispatcher.ts:52]
  end
  rect rgb(35,90,50)
    D->>Q: 🟢 enqueueRetry(event, attempt=1) [src/webhooks/retryQueue.ts:24]
    D-->>GW: 🟢 202 Accepted [src/webhooks/dispatcher.ts:58]
    Q->>Q: 🟢 wait 2^attempt s [src/webhooks/retryQueue.ts:47]
    Q->>R: 🟢 POST /webhook (retry) [src/webhooks/retryQueue.ts:55]
    Q->>Q: 🟢 after 5 failures → dead-letter [src/webhooks/retryQueue.ts:71]
  end
  Note over D,Q: Failures are now retried in the background instead of dropped`,
  },
  {
    group: {
      name: 'delivery-status-api',
      description: 'GET /webhooks/:id/status now reports retry state.',
      files: ['src/api/webhookStatus.ts'],
      symbols: ['getStatus'],
      needsContext: false,
    },
    tldr: 'The status API adds "retrying" and "dead-lettered" states — strict consumers may break.',
    summary:
      'The status endpoint gains two new states. getStatus() [src/api/webhookStatus.ts:18] now returns "retrying" (with nextAttemptAt) and "dead-lettered" in addition to the existing "delivered" and "failed".',
    steps: [
      { kind: 'same', text: 'Client requests GET /webhooks/:id/status', file: 'src/api/webhookStatus.ts', line: 18 },
      { kind: 'same', text: 'API loads the delivery record', file: 'src/api/webhookStatus.ts', line: 22 },
      {
        kind: 'changed',
        text: 'while retry attempts remain, status is "retrying" with nextAttemptAt',
        before: 'first failure immediately reported status "failed"',
        file: 'src/api/webhookStatus.ts',
        line: 27,
      },
      { kind: 'added', text: 'After 5 exhausted attempts, status becomes "dead-lettered"', file: 'src/api/webhookStatus.ts', line: 38 },
    ],
    diagramType: 'flowchart',
    behaviorChanges: [
      'Before: status was "failed" immediately after the first unsuccessful attempt. After: status is "retrying" until attempts are exhausted [src/api/webhookStatus.ts:27].',
      'New field nextAttemptAt in the JSON response — additive, but consumers doing strict schema validation will reject it [src/api/webhookStatus.ts:33].',
    ],
    findings: [
      {
        severity: 'warning',
        text: 'Existing dashboards that alert on status == "failed" will go quiet during the retry window; "dead-lettered" should be added to their alert condition.',
        file: 'src/api/webhookStatus.ts',
        line: 27,
      },
    ],
    mermaid: `flowchart TD
  A["GET /webhooks/:id/status [src/api/webhookStatus.ts:18]"] --> B["findDelivery(id) [src/api/webhookStatus.ts:22]"]
  B --> C{delivery failed?}
  C -->|no| D["status: delivered"]
  C -->|yes| E["status: failed (immediately, terminal)"]
  C -->|yes| F{"attempts left? [src/api/webhookStatus.ts:27]"}
  F -->|yes| G["status: retrying + nextAttemptAt [src/api/webhookStatus.ts:33]"]
  F -->|no| H["status: dead-lettered [src/api/webhookStatus.ts:38]"]
  class E removed
  class F,G,H added
  classDef added fill:#1e4620,stroke:#2ea043,color:#d2f2d2
  classDef removed fill:#4a1e1e,stroke:#f85149,color:#ffd7d5,stroke-dasharray:4 3`,
  },
  {
    group: {
      name: 'delivery-state-machine',
      description: 'Delivery lifecycle gains Retrying and DeadLettered states; Failed is no longer terminal for 5xx.',
      files: ['src/webhooks/deliveryState.ts'],
      symbols: ['transition'],
      needsContext: false,
    },
    tldr: 'A 5xx is no longer terminal — deliveries retry and can end up dead-lettered.',
    summary:
      'The delivery state machine changes shape. A 5xx no longer moves a delivery to the terminal "Failed" state — it enters "Retrying", which loops with backoff and terminates in either "Delivered" or the new "DeadLettered" state [src/webhooks/deliveryState.ts:22].',
    steps: [
      { kind: 'same', text: 'New delivery starts in Pending', file: 'src/webhooks/deliveryState.ts', line: 12 },
      { kind: 'same', text: 'A 200 response transitions Pending → Delivered', file: 'src/webhooks/deliveryState.ts', line: 17 },
      {
        kind: 'changed',
        text: 'a 5xx transitions Pending → Retrying',
        before: 'a 5xx transitioned Pending → Failed (terminal)',
        file: 'src/webhooks/deliveryState.ts',
        line: 22,
      },
      { kind: 'added', text: 'Retrying loops on itself while attempts < 5', file: 'src/webhooks/deliveryState.ts', line: 31 },
      { kind: 'added', text: 'A successful retry transitions Retrying → Delivered', file: 'src/webhooks/deliveryState.ts', line: 36 },
      { kind: 'added', text: 'Exhausted attempts transition Retrying → DeadLettered (new terminal state)', file: 'src/webhooks/deliveryState.ts', line: 41 },
      { kind: 'removed', text: 'Failed as the terminal state for transport errors', file: 'src/webhooks/deliveryState.ts', line: 22 },
    ],
    diagramType: 'state',
    behaviorChanges: [
      'Before: transport failures were terminal. After: they are transient until 5 attempts are exhausted [src/webhooks/deliveryState.ts:22].',
      'New terminal state DeadLettered — consumers switching on state must handle it [src/webhooks/deliveryState.ts:41].',
    ],
    findings: [
      {
        severity: 'warning',
        text: 'transition() throws on unknown states — existing rows persisted with state "Failed" will throw when re-loaded by the retry sweeper.',
        file: 'src/webhooks/deliveryState.ts',
        line: 48,
      },
    ],
    mermaid: `stateDiagram-v2
  [*] --> Pending
  Pending --> Delivered: 200 OK
  Pending --> Failed: 🔴 5xx (was terminal)
  Pending --> Retrying: 🟢 5xx enqueues retry
  Retrying --> Retrying: 🟢 backoff 2^n, attempt < 5
  Retrying --> Delivered: 🟢 retry succeeds
  Retrying --> DeadLettered: 🟢 attempts exhausted
  Delivered --> [*]
  Failed --> [*]
  DeadLettered --> [*]
  class Retrying added
  class DeadLettered added
  class Failed removed
  classDef added fill:#1e4620,stroke:#2ea043,color:#d2f2d2
  classDef removed fill:#4a1e1e,stroke:#f85149,color:#ffd7d5,stroke-dasharray:4 3`,
  },
  {
    group: {
      name: 'http-timeout-tuning',
      description: 'Outbound webhook HTTP client gets tighter timeouts and delivery-attempt headers.',
      files: ['src/webhooks/httpClient.ts', 'src/webhooks/dispatcher.ts'],
      symbols: ['createClient'],
      needsContext: false,
    },
    summary:
      'Pure parameter changes on the outbound HTTP client: the per-request timeout drops from 30s to 10s, the connection pool grows, and every request now carries delivery metadata headers. No control-flow change, so no diagram — the step diff is the whole story.',
    steps: [
      {
        kind: 'changed',
        text: 'outbound POST times out after 10s',
        before: 'timeout was 30s',
        file: 'src/webhooks/httpClient.ts',
        line: 12,
      },
      {
        kind: 'changed',
        text: 'connection pool allows 64 sockets per host',
        before: 'pool was capped at 16',
        file: 'src/webhooks/httpClient.ts',
        line: 18,
      },
      { kind: 'added', text: 'Every request sends X-Delivery-Id and X-Delivery-Attempt headers', file: 'src/webhooks/dispatcher.ts', line: 41 },
    ],
    behaviorChanges: [
      'Receivers slower than 10s now count as failures and enter the retry path [src/webhooks/httpClient.ts:12].',
    ],
    findings: [
      {
        severity: 'warning',
        text: '10s timeout × 5 retry attempts means a consistently slow receiver burns ~50s of queue time per event; consider circuit-breaking instead.',
        file: 'src/webhooks/httpClient.ts',
        line: 12,
      },
    ],
    mermaid: '',
  },
  {
    group: {
      name: 'audit-logging',
      description: 'Every delivery attempt is written to a new audit log.',
      files: ['src/audit/log.ts'],
      symbols: ['writeAudit'],
      needsContext: false,
    },
    summary:
      'Each delivery attempt now writes an audit row (event id, attempt number, response code). Batched and flushed every 5 seconds, fire-and-forget from the dispatcher path.',
    steps: [
      { kind: 'same', text: 'Dispatcher delivers the event as before' },
      { kind: 'added', text: 'Every attempt appends an audit row (event id, attempt, response code)', file: 'src/audit/log.ts', line: 15 },
      { kind: 'added', text: 'Audit rows are batched and flushed every 5 seconds', file: 'src/audit/log.ts', line: 42 },
    ],
    behaviorChanges: [
      'New side effect: an audit table grows with one row per delivery attempt [src/audit/log.ts:15].',
    ],
    findings: [
      {
        severity: 'info',
        text: 'Flush failures are swallowed silently — audit data can be lost without any signal.',
        file: 'src/audit/log.ts',
        line: 49,
      },
    ],
    // Intentionally malformed mermaid: demos that a broken diagram degrades to an
    // error box while the step diff above stays fully usable.
    diagramType: 'sequence',
    mermaid: `sequenceDiagram
  participant D as Dispatcher
  D ->> : writeAudit(event [src/audit/log.ts:15`,
  },
  {
    group: {
      name: 'no-behavior-change',
      description: 'Renames, test updates and log wording — no observable behavior change.',
      files: ['src/webhooks/dispatcher.test.ts', 'src/webhooks/types.ts'],
      symbols: [],
      needsContext: false,
    },
    summary:
      'WebhookJob was renamed to DeliveryJob, tests were updated for the new retry path, and one log message was reworded. No runtime behavior changes.',
    steps: [],
    behaviorChanges: [],
    findings: [
      {
        severity: 'info',
        text: 'Rename is consistent across the codebase; no stale references found.',
        file: 'src/webhooks/types.ts',
        line: 9,
      },
    ],
    mermaid: `sequenceDiagram
  participant T as TestSuite
  participant D as WebhookDispatcher
  T->>D: existing tests updated for retry path [src/webhooks/dispatcher.test.ts:12]
  Note over T,D: Mechanical changes only — no behavior difference`,
    fromCache: true,
  },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Open the review panel with canned data — no GitLab or LLM access needed. */
export async function runDemoReview(
  extensionUri: vscode.Uri,
  onStatus?: (message: string) => void
): Promise<void> {
  const panel = ReviewPanel.show(extensionUri, DEMO_MR);
  const setStatus = (message: string) => {
    panel.setStatus(message);
    onStatus?.(message);
  };
  setStatus('Demo — fetching MR changes…');
  await sleep(600);
  setStatus(`Demo — classifying 12 changed files into behavior groups…`);
  await sleep(900);
  for (let i = 0; i < DEMO_GROUPS.length; i++) {
    setStatus(`Demo — analyzing group ${i + 1}/${DEMO_GROUPS.length}: ${DEMO_GROUPS[i].group.name}`);
    await sleep(i === 0 ? 700 : 1100);
    panel.addGroupResult(DEMO_GROUPS[i], i, DEMO_GROUPS.length);
  }
  panel.finish();
}
