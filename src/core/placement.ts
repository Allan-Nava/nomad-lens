// Placement diagnostics (NOM-15): why a job does not schedule.
// Pure parsing/rendering of GET /v1/job/:id/evaluations — no vscode imports.
//
// When the scheduler cannot place a task group it records an AllocMetric under
// the evaluation's FailedTGAllocs. Those counters are the raw answer to "why is
// my job stuck in pending"; this module turns them into sentences.
import { RawAllocMetric, RawEvaluation } from './api';

export interface PlacementFailure {
  taskGroup: string;
  /** How many placement attempts collapsed into this metric. */
  coalescedFailures: number;
  nodesEvaluated: number;
  nodesFiltered: number;
  nodesExhausted: number;
  /** Human-readable reasons, most specific first. */
  reasons: string[];
}

export interface PlacementReport {
  evalId: string;
  /** Evaluation time in milliseconds (the API reports nanoseconds); 0 if unknown. */
  timeMs: number;
  status: string;
  failures: PlacementFailure[];
}

function entries(m?: Record<string, number> | null): [string, number][] {
  return Object.entries(m ?? {}).filter(([, n]) => n > 0);
}

/** Turns one task group's AllocMetric into readable reasons. */
export function explainMetric(taskGroup: string, m: RawAllocMetric): PlacementFailure {
  const reasons: string[] = [];

  for (const [constraint, n] of entries(m.ConstraintFiltered)) {
    reasons.push(`${n} node${n === 1 ? '' : 's'} filtered by constraint \`${constraint}\``);
  }
  for (const [cls, n] of entries(m.ClassFiltered)) {
    reasons.push(`${n} node${n === 1 ? '' : 's'} filtered by class \`${cls}\``);
  }
  for (const [dim, n] of entries(m.DimensionExhausted)) {
    reasons.push(`not enough \`${dim}\` on ${n} node${n === 1 ? '' : 's'}`);
  }
  for (const [cls, n] of entries(m.ClassExhausted)) {
    reasons.push(`class \`${cls}\` exhausted on ${n} node${n === 1 ? '' : 's'}`);
  }
  for (const q of m.QuotaExhausted ?? []) {
    reasons.push(`quota exhausted: \`${q}\``);
  }
  const dcs = Object.entries(m.NodesAvailable ?? {}).filter(([, n]) => n === 0);
  for (const [dc] of dcs) {
    reasons.push(`no nodes available in datacenter \`${dc}\``);
  }
  if (!reasons.length) {
    // Nothing itemized: fall back to the coarse counters so the report is never
    // an empty "it failed, no idea why".
    if ((m.NodesEvaluated ?? 0) === 0) reasons.push('no nodes were evaluated (empty cluster or wrong datacenter?)');
    else if ((m.NodesExhausted ?? 0) > 0) reasons.push(`${m.NodesExhausted} node(s) out of resources`);
    else reasons.push('the scheduler reported no specific reason');
  }

  return {
    taskGroup,
    coalescedFailures: m.CoalescedFailures ?? 0,
    nodesEvaluated: m.NodesEvaluated ?? 0,
    nodesFiltered: m.NodesFiltered ?? 0,
    nodesExhausted: m.NodesExhausted ?? 0,
    reasons,
  };
}

/** Most recent evaluation carrying placement failures, explained.
 *  Returns null when every evaluation placed fine — the job is stuck for
 *  some other reason (or is not stuck at all). */
export function latestPlacementFailures(evals: RawEvaluation[]): PlacementReport | null {
  const withFailures = evals.filter((e) => Object.keys(e.FailedTGAllocs ?? {}).length > 0);
  if (!withFailures.length) return null;
  const latest = withFailures.reduce((a, b) => ((b.ModifyTime ?? 0) > (a.ModifyTime ?? 0) ? b : a));
  const failures = Object.entries(latest.FailedTGAllocs ?? {}).map(([tg, m]) => explainMetric(tg, m));
  return {
    evalId: latest.ID ?? '',
    timeMs: latest.ModifyTime ? Math.round(latest.ModifyTime / 1e6) : 0,
    status: latest.Status ?? '',
    failures: failures.sort((a, b) => a.taskGroup.localeCompare(b.taskGroup)),
  };
}

/** Short tree/tooltip label: `⚠ web: not enough \`memory\` on 3 nodes`. */
export function placementSummary(report: PlacementReport): string {
  return report.failures.map((f) => `${f.taskGroup}: ${f.reasons[0]}`).join(' · ');
}

export function renderPlacementReport(jobId: string, report: PlacementReport | null): string {
  if (!report) {
    return [
      `# Placement — ${jobId}`,
      '',
      'No placement failures in the recent evaluations: the scheduler managed to place every task group.',
      '',
      'If the job is still not running, look at the allocations (the tasks may be failing to start) rather than at scheduling.',
    ].join('\n');
  }

  const when = report.timeMs ? new Date(report.timeMs).toISOString() : 'unknown';
  const lines = [
    `# Placement failures — ${jobId}`,
    '',
    `Evaluation \`${report.evalId}\` (${report.status}) — ${when}`,
    '',
  ];
  for (const f of report.failures) {
    lines.push(
      `## Task group \`${f.taskGroup}\``,
      '',
      `${f.nodesEvaluated} node(s) evaluated · ${f.nodesFiltered} filtered · ${f.nodesExhausted} out of resources${
        f.coalescedFailures ? ` · ${f.coalescedFailures} coalesced failures` : ''
      }`,
      '',
    );
    for (const r of f.reasons) lines.push(`- ${r}`);
    lines.push('');
  }
  lines.push(
    '---',
    '',
    'Typical fixes: relax or correct a `constraint`, add capacity for the exhausted dimension, check the `datacenters` of the job, or free a drained node.',
  );
  return lines.join('\n');
}
