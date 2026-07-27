// Pure logic (NO 'vscode' import) for auto-fixing a broken default of the Go
// extension: `go.diagnostic.vulncheck` defaults to "Prompt", but the gopls language
// server only accepts "Imports"/"Off" and rejects it with
//   Invalid settings: setting option "vulncheck": invalid option "Prompt" for enum
// Here we decide WHETHER and HOW to fix it; the I/O (reading/writing settings,
// notifications) lives in the glue in extension.ts.

export const VULNCHECK_SETTING = 'go.diagnostic.vulncheck';
export const BROKEN_VALUE = 'Prompt';
export type VulncheckFixTarget = 'Off' | 'Imports';
export type VulncheckScope = 'global' | 'workspace';

export interface VulncheckState {
  /** Is the Go extension (`golang.go`) installed? Otherwise the setting does not exist. */
  goExtensionInstalled: boolean;
  /** Has the user enabled the auto-fix (`nomadLens.autoFixGoVulncheck`)? */
  autoFixEnabled: boolean;
  /** Value the fix should write (`nomadLens.goVulncheckFixValue`). */
  fixTarget: VulncheckFixTarget;
  /** Effective value gopls would receive (config.get, includes the default). */
  effectiveValue?: string;
  /** Value set explicitly at workspace level (inspect().workspaceValue). */
  workspaceValue?: string;
}

export type VulncheckDecision =
  | { action: 'none'; reason: string }
  | { action: 'fix'; from: string; to: VulncheckFixTarget; scope: VulncheckScope };

/**
 * Decides whether to fix `go.diagnostic.vulncheck`. We only step in when the
 * effective value is exactly "Prompt" (the one gopls rejects): any other value,
 * including an "Off"/"Imports" the user already chose, is left alone.
 * If the "Prompt" comes from a workspace override we fix it in that same scope,
 * otherwise (implicit default) globally.
 */
export function decideVulncheckFix(s: VulncheckState): VulncheckDecision {
  if (!s.autoFixEnabled) return { action: 'none', reason: 'auto-fix disabled' };
  if (!s.goExtensionInstalled) return { action: 'none', reason: 'Go extension not installed' };
  if (s.effectiveValue !== BROKEN_VALUE) {
    return { action: 'none', reason: `value already valid (${s.effectiveValue ?? 'n/a'})` };
  }
  const scope: VulncheckScope = s.workspaceValue === BROKEN_VALUE ? 'workspace' : 'global';
  return { action: 'fix', from: BROKEN_VALUE, to: s.fixTarget, scope };
}
