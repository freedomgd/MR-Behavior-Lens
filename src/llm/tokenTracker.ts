import * as vscode from 'vscode';
import { UsageRecord } from '../types';

const STORE_KEY = 'mrLens.usageRecords';
const MAX_RECORDS = 1000;

export class TokenTracker {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: vscode.Memento) {}

  all(): UsageRecord[] {
    return this.state.get<UsageRecord[]>(STORE_KEY, []);
  }

  async record(rec: UsageRecord): Promise<void> {
    const records = this.all();
    records.push(rec);
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
    await this.state.update(STORE_KEY, records);
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.state.update(STORE_KEY, []);
    this._onDidChange.fire();
  }

  summary(): {
    today: { input: number; output: number; requests: number };
    week: { input: number; output: number; requests: number };
    total: { input: number; output: number; requests: number };
    byMr: Map<string, { input: number; output: number; requests: number }>;
  } {
    const now = Date.now();
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    const zero = () => ({ input: 0, output: 0, requests: 0 });
    const today = zero();
    const week = zero();
    const total = zero();
    const byMr = new Map<string, { input: number; output: number; requests: number }>();
    for (const r of this.all()) {
      const add = (t: { input: number; output: number; requests: number }) => {
        t.input += r.inputTokens;
        t.output += r.outputTokens;
        t.requests += 1;
      };
      add(total);
      if (r.ts >= dayStart) add(today);
      if (r.ts >= weekStart) add(week);
      let mr = byMr.get(r.mrRef);
      if (!mr) {
        mr = zero();
        byMr.set(r.mrRef, mr);
      }
      add(mr);
    }
    return { today, week, total, byMr };
  }
}
