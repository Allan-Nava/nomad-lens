// Metadati dei comandi mutativi (NOM-3) e costruzione del messaggio di conferma.
// Puro (NIENTE import 'vscode'): l'interazione (modali, input box) vive nel glue.
// Regola CLAUDE.md: i comandi mutativi richiedono SEMPRE conferma esplicita;
// quelli distruttivi una doppia conferma, mai un default.

export type NomadActionKind = 'restartAlloc' | 'stopJob' | 'startJob';

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
};

/** Messaggio di conferma per un'azione su un target (job id / alloc id). */
export function confirmMessage(kind: NomadActionKind, target: string): string {
  const m = ACTIONS[kind];
  const tail = m.destructive ? ' Azione mutativa sul cluster.' : '';
  return `${m.verb}: ${target}.${tail}`;
}
