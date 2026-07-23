// Logica pura (NIENTE import 'vscode') per l'auto-fix di un default rotto della
// Go extension: `go.diagnostic.vulncheck` ha default "Prompt", ma il language
// server gopls accetta solo "Imports"/"Off" e lo rifiuta con
//   Invalid settings: setting option "vulncheck": invalid option "Prompt" for enum
// Qui decidiamo SE e COME correggere; l'I/O (leggere/scrivere settings, notifiche)
// vive nel glue in extension.ts.

export const VULNCHECK_SETTING = 'go.diagnostic.vulncheck';
export const BROKEN_VALUE = 'Prompt';
export type VulncheckFixTarget = 'Off' | 'Imports';
export type VulncheckScope = 'global' | 'workspace';

export interface VulncheckState {
  /** la Go extension (`golang.go`) e' installata? Altrimenti la setting non esiste. */
  goExtensionInstalled: boolean;
  /** l'utente ha abilitato l'auto-fix (`nomadLens.autoFixGoVulncheck`)? */
  autoFixEnabled: boolean;
  /** valore desiderato per il fix (`nomadLens.goVulncheckFixValue`). */
  fixTarget: VulncheckFixTarget;
  /** valore effettivo che gopls riceverebbe (config.get, include il default). */
  effectiveValue?: string;
  /** valore impostato esplicitamente a livello workspace (inspect().workspaceValue). */
  workspaceValue?: string;
}

export type VulncheckDecision =
  | { action: 'none'; reason: string }
  | { action: 'fix'; from: string; to: VulncheckFixTarget; scope: VulncheckScope };

/**
 * Decide se correggere `go.diagnostic.vulncheck`. Si interviene SOLO quando il
 * valore effettivo e' esattamente "Prompt" (quello che gopls rifiuta): qualsiasi
 * altro valore, incluso un "Off"/"Imports" gia' scelto, viene lasciato stare.
 * Se il "Prompt" arriva da un override di workspace lo si corregge nello stesso
 * scope, altrimenti (default implicito) a livello globale.
 */
export function decideVulncheckFix(s: VulncheckState): VulncheckDecision {
  if (!s.autoFixEnabled) return { action: 'none', reason: 'auto-fix disabilitato' };
  if (!s.goExtensionInstalled) return { action: 'none', reason: 'Go extension non installata' };
  if (s.effectiveValue !== BROKEN_VALUE) {
    return { action: 'none', reason: `valore gia' valido (${s.effectiveValue ?? 'n/d'})` };
  }
  const scope: VulncheckScope = s.workspaceValue === BROKEN_VALUE ? 'workspace' : 'global';
  return { action: 'fix', from: BROKEN_VALUE, to: s.fixTarget, scope };
}
