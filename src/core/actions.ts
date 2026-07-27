// Metadati dei comandi mutativi (NOM-3) e costruzione del messaggio di conferma.
// Puro (NIENTE import 'vscode'): l'interazione (modali, input box) vive nel glue.
// Regola CLAUDE.md: i comandi mutativi richiedono SEMPRE conferma esplicita;
// quelli distruttivi una doppia conferma, mai un default.

export type NomadActionKind =
  | 'restartAlloc'
  | 'stopJob'
  | 'startJob'
  | 'revertJob'
  | 'drainNode'
  | 'stopDrain'
  | 'nodeIneligible'
  | 'nodeEligible';

export interface ActionMeta {
  /** verbo mostrato nei messaggi e come label del bottone di conferma. */
  verb: string;
  /** azione distruttiva → doppia conferma. */
  destructive: boolean;
  /** richiede di digitare il nome del target (conferma più forte, per stop job). */
  requireType: boolean;
}

export const ACTIONS: Record<NomadActionKind, ActionMeta> = {
  restartAlloc: { verb: 'Restart allocation', destructive: true, requireType: false },
  stopJob: { verb: 'Stop job', destructive: true, requireType: true },
  startJob: { verb: 'Start job', destructive: false, requireType: false },
  // NOM-14: reverting replaces the running spec with an older one — as strong a
  // confirmation as stopping a job.
  revertJob: { verb: 'Revert job', destructive: true, requireType: true },
  // NOM-17: draining evicts every allocation on the node — the strongest
  // confirmation we have. Undoing a drain and toggling eligibility are cheap and
  // reversible, so a single confirmation is enough.
  drainNode: { verb: 'Drain node', destructive: true, requireType: true },
  stopDrain: { verb: 'Stop draining node', destructive: false, requireType: false },
  nodeIneligible: { verb: 'Make node ineligible', destructive: false, requireType: false },
  nodeEligible: { verb: 'Make node eligible', destructive: false, requireType: false },
};

/** Messaggio di conferma per un'azione su un target (job id / alloc id). */
export function confirmMessage(kind: NomadActionKind, target: string): string {
  const m = ACTIONS[kind];
  const tail = m.destructive ? ' Azione mutativa sul cluster.' : '';
  return `${m.verb}: ${target}.${tail}`;
}
