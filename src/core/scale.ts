// Scaling a task group (NOM-34): pure request body, validation and the
// confirmation decision. NO 'vscode' import — the count picker and the modal
// confirmation live in the glue.

export interface ScaleRequest {
  Count: number;
  Target: { Group: string };
  Message?: string;
}

/** Body for `POST /v1/job/:id/scale`. */
export function scaleBody(group: string, count: number, reason?: string): ScaleRequest {
  const body: ScaleRequest = { Count: count, Target: { Group: group } };
  if (reason) body.Message = reason;
  return body;
}

/** A count must be a non-negative integer. */
export function isValidCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** Per-group current count, read from the job spec. */
export function groupCounts(job: {
  TaskGroups?: { Name?: string; Count?: number }[] | null;
}): { group: string; count: number }[] {
  return (job.TaskGroups ?? []).map((g) => ({ group: g.Name ?? '', count: g.Count ?? 0 }));
}

export interface ScaleDecision {
  message: string;
  /** Scaling down removes running allocations → treat as destructive (double confirm). */
  destructive: boolean;
}

/** Confirmation message + destructiveness for a scale from `current` to `target`. */
export function scaleConfirm(group: string, current: number, target: number): ScaleDecision {
  const delta = target - current;
  const arrow = delta >= 0 ? `+${delta}` : `${delta}`;
  const destructive = target < current;
  const tail = destructive ? ` This removes ${current - target} allocation(s).` : '';
  return { message: `Scale "${group}": ${current} → ${target} (${arrow}).${tail}`, destructive };
}
