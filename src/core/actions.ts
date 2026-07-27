// Metadata of the mutating commands (NOM-3) and construction of the confirmation
// message. Pure (NO 'vscode' import): the interaction (modals, input boxes) lives
// in the glue. CLAUDE.md rule: mutating commands ALWAYS require an explicit
// confirmation; destructive ones a double confirmation, never a default button.

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
  /** Verb shown in the messages and as the confirmation button label. */
  verb: string;
  /** Destructive action → double confirmation. */
  destructive: boolean;
  /** Requires typing the target name (the strongest confirmation, e.g. stop job). */
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

/** Confirmation message for an action on a target (job id / alloc id / node name). */
export function confirmMessage(kind: NomadActionKind, target: string): string {
  const m = ACTIONS[kind];
  const tail = m.destructive ? ' This mutates the cluster.' : '';
  return `${m.verb}: ${target}.${tail}`;
}
