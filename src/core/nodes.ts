// Node drain and scheduling eligibility (NOM-17).
// Pure request bodies and labels — no vscode imports.
//
// Draining a node evicts every allocation on it: this is the most destructive
// thing the extension can do, so the glue confirms by typing the node id.

/** Deadline choices offered before a drain. `-1` means "no deadline". */
export const DRAIN_DEADLINE_PRESETS: { label: string; seconds: number }[] = [
  { label: '1 hour (Nomad default)', seconds: 3600 },
  { label: '10 minutes', seconds: 600 },
  { label: 'No deadline — wait for every allocation', seconds: -1 },
];

export interface DrainBody {
  NodeID: string;
  DrainSpec: { Deadline: number; IgnoreSystemJobs: boolean } | null;
}

/** Body for `POST /v1/node/:id/drain`.
 *  Deadline goes out in NANOSECONDS (Nomad's unit); `-1` stays `-1`, meaning
 *  "no deadline", and must not be multiplied. */
export function drainBody(nodeId: string, deadlineSeconds: number, ignoreSystemJobs = false): DrainBody {
  return {
    NodeID: nodeId,
    DrainSpec: {
      Deadline: deadlineSeconds < 0 ? -1 : Math.round(deadlineSeconds * 1e9),
      IgnoreSystemJobs: ignoreSystemJobs,
    },
  };
}

/** Body that cancels an ongoing drain: a null DrainSpec. */
export function stopDrainBody(nodeId: string): DrainBody {
  return { NodeID: nodeId, DrainSpec: null };
}

export function eligibilityBody(nodeId: string, eligible: boolean): { NodeID: string; Eligibility: string } {
  return { NodeID: nodeId, Eligibility: eligible ? 'eligible' : 'ineligible' };
}

/** Allocations still holding a draining node back (terminal ones do not count). */
export function countActiveAllocs(allocs: { ClientStatus?: string }[]): number {
  const terminal = ['complete', 'failed', 'lost'];
  return allocs.filter((a) => !terminal.includes(a.ClientStatus ?? '')).length;
}

export interface NodeStateLike {
  status: string;
  drain: boolean;
  eligibility: string;
  drainRemaining?: number;
}

/** One-line state for the tree: status, drain progress, eligibility. */
export function nodeStateLabel(n: NodeStateLike): string {
  const parts = [n.status];
  if (n.drain) {
    parts.push(
      n.drainRemaining === undefined
        ? 'draining'
        : `draining (${n.drainRemaining} alloc${n.drainRemaining === 1 ? '' : 's'} left)`
    );
  }
  // While draining a node is ineligible by definition — saying both is noise.
  if (!n.drain && n.eligibility === 'ineligible') parts.push('ineligible');
  return parts.join(' · ');
}

/** True when the node needs attention in the tree (icon + warning). */
export function nodeNeedsAttention(n: NodeStateLike): boolean {
  return n.status !== 'ready' || n.drain || n.eligibility === 'ineligible';
}
