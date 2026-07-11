import * as vscode from 'vscode';
import { BehaviorGroup } from '../types';

/**
 * Best-effort LSP context: for each symbol in the group, find callers/callees
 * via the workspace's call-hierarchy provider. Only useful when the MR's repo
 * is the currently open workspace; returns '' otherwise or on any failure.
 */
export async function expandContext(group: BehaviorGroup, maxBytes: number): Promise<string> {
  if (!vscode.workspace.workspaceFolders?.length) return '';
  const lines: string[] = [];
  let size = 0;
  const push = (line: string): boolean => {
    if (size + line.length > maxBytes) return false;
    lines.push(line);
    size += line.length + 1;
    return true;
  };

  for (const symbol of group.symbols.slice(0, 8)) {
    try {
      const symbols = (await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        symbol
      )) as vscode.SymbolInformation[] | undefined;
      const match = symbols?.find(
        (s) =>
          s.name === symbol &&
          (s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Method)
      );
      if (!match) continue;

      const items = (await vscode.commands.executeCommand(
        'vscode.prepareCallHierarchy',
        match.location.uri,
        match.location.range.start
      )) as vscode.CallHierarchyItem[] | undefined;
      if (!items?.length) continue;
      const item = items[0];

      const incoming = (await vscode.commands.executeCommand(
        'vscode.provideIncomingCalls',
        item
      )) as vscode.CallHierarchyIncomingCall[] | undefined;
      const outgoing = (await vscode.commands.executeCommand(
        'vscode.provideOutgoingCalls',
        item
      )) as vscode.CallHierarchyOutgoingCall[] | undefined;

      if (!push(`- ${symbol}:`)) return lines.join('\n');
      for (const call of (incoming ?? []).slice(0, 5)) {
        const rel = vscode.workspace.asRelativePath(call.from.uri);
        if (!push(`  called by ${call.from.name} [${rel}:${call.from.range.start.line + 1}]`)) {
          return lines.join('\n');
        }
      }
      for (const call of (outgoing ?? []).slice(0, 5)) {
        const rel = vscode.workspace.asRelativePath(call.to.uri);
        if (!push(`  calls ${call.to.name} [${rel}:${call.to.range.start.line + 1}]`)) {
          return lines.join('\n');
        }
      }
    } catch {
      // No provider for this language, or symbol not found — skip silently.
    }
  }
  return lines.join('\n');
}
