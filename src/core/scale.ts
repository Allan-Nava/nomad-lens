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

// --- Scaling status & events (NOM-37): GET /v1/job/:id/scale -------------------

export interface RawScaleStatus {
  TaskGroups?: Record<
    string,
    {
      Desired?: number;
      Placed?: number;
      Running?: number;
      Healthy?: number;
      Unhealthy?: number;
      Events?:
        | { Time?: number; Count?: number; PreviousCount?: number; Message?: string; Error?: boolean }[]
        | null;
    }
  > | null;
}

export interface ScaleEvent {
  timeMs: number; // Nomad reports nanoseconds
  count?: number;
  previous?: number;
  message: string;
  error: boolean;
}

export interface ScaleGroupStatus {
  group: string;
  desired: number;
  placed: number;
  running: number;
  healthy: number;
  unhealthy: number;
  events: ScaleEvent[];
}

export function parseScaleStatus(raw: RawScaleStatus): ScaleGroupStatus[] {
  return Object.entries(raw.TaskGroups ?? {})
    .map(([group, g]) => ({
      group,
      desired: g.Desired ?? 0,
      placed: g.Placed ?? 0,
      running: g.Running ?? 0,
      healthy: g.Healthy ?? 0,
      unhealthy: g.Unhealthy ?? 0,
      events: (g.Events ?? []).map((e) => ({
        timeMs: e.Time ? Math.round(e.Time / 1e6) : 0,
        count: e.Count,
        previous: e.PreviousCount,
        message: e.Message ?? '',
        error: e.Error === true,
      })),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/** Markdown report: current counts per group + recent scaling events. */
export function renderScaleStatus(jobId: string, groups: ScaleGroupStatus[]): string {
  if (!groups.length) return `# Scaling status — ${jobId}\n\nNo task groups.`;
  const lines = [`# Scaling status — ${jobId}`, ''];
  for (const g of groups) {
    lines.push(
      `## ${g.group}`,
      '',
      `desired ${g.desired} · placed ${g.placed} · running ${g.running} · healthy ${g.healthy}${
        g.unhealthy ? ` · unhealthy ${g.unhealthy}` : ''
      }`,
      ''
    );
    if (g.events.length) {
      lines.push('| When (UTC) | Change | Message |', '|---|---|---|');
      for (const e of g.events.slice(0, 20)) {
        const when = e.timeMs ? new Date(e.timeMs).toISOString().replace('T', ' ').slice(0, 19) : '—';
        const change =
          e.previous !== undefined && e.count !== undefined
            ? `${e.previous} → ${e.count}`
            : e.count !== undefined
              ? String(e.count)
              : '';
        lines.push(`| ${when} | ${change}${e.error ? ' ⚠' : ''} | ${e.message.replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
    } else {
      lines.push('_No scaling events recorded._', '');
    }
  }
  return lines.join('\n');
}
