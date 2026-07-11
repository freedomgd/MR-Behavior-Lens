import * as vscode from 'vscode';

/** Shared output channel — view via Output panel → "MR Behavior Lens". */
export const logger = vscode.window.createOutputChannel('MR Behavior Lens', { log: true });
