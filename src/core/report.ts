// Pure renderers: cluster snapshot report, plan diff, incident bundle.
// No vscode imports — unit-tested with fixtures.
import {
  AllocSummary,
  DeploymentSummary,
  JobDiff,
  JobSummary,
  NodeSummary,
  ObjectDiff,
  PlanResult,
} from './api';
import { nodeNeedsAttention, nodeStateLabel } from './nodes';

const STATUS_ICON: Record<string, string> = {
  running: '🟢',
  pending: '🟡',
  dead: '⚪',
  degraded: '🟠',
  failed: '🔴',
  lost: '🔴',
  complete: '⚪',
};

function icon(status: string): string {
  return STATUS_ICON[status] ?? '❔';
}

/** Warning signals on an allocation: OOM kill and restart loop beyond a threshold.
 *  Pure and testable — the heart of the NOM-1 detector. */
export function allocWarnings(a: { restarts: number; oom: boolean }, restartThreshold = 3): string[] {
  const w: string[] = [];
  if (a.oom) w.push('OOM');
  if (a.restarts >= restartThreshold) w.push(`restart loop ×${a.restarts}`);
  return w;
}

/** Effective health of a job: running-but-incomplete counts as degraded. */
export function jobHealth(j: JobSummary): string {
  if (j.status === 'running' && j.failed > 0) return 'degraded';
  if (j.status === 'running' && j.desired > 0 && j.running < j.desired) return 'degraded';
  return j.status;
}

export function renderSnapshot(
  cluster: string,
  jobs: JobSummary[],
  nodes: NodeSummary[],
  deployments: DeploymentSummary[]
): string {
  const generatedAt = new Date().toISOString();
  const problems = jobs.filter((j) => ['degraded', 'pending', 'failed'].includes(jobHealth(j)));
  // An ineligible node hosts no new allocations: a morning-report problem exactly
  // like a drain (NOM-17), so it uses the same definition as the tree.
  const badNodes = nodes.filter(nodeNeedsAttention);
  const badDeploys = deployments.filter((d) => !['successful', 'cancelled'].includes(d.status));

  const lines: string[] = [
    `# Nomad snapshot — ${cluster}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '```',
    `total jobs  : ${jobs.length}  (problems: ${problems.length})`,
    `nodes       : ${nodes.length}  (not ready / drain / ineligible: ${badNodes.length})`,
    `deployments : ${deployments.length} active or recent (not healthy: ${badDeploys.length})`,
    '```',
    '',
    '## ⚠ Needs attention',
    '',
  ];

  if (!problems.length && !badNodes.length && !badDeploys.length) {
    lines.push('Nothing — all green. ✅', '');
  }
  if (problems.length) {
    lines.push('| Job | Status | Alloc running/desired | Failed |', '|---|---|---|---|');
    for (const j of problems) {
      lines.push(`| ${j.id} | ${icon(jobHealth(j))} ${jobHealth(j)} | ${j.running}/${j.desired} | ${j.failed} |`);
    }
    lines.push('');
  }
  if (badNodes.length) {
    lines.push('### Nodes');
    for (const n of badNodes) lines.push(`- 🔴 ${n.name}: ${nodeStateLabel(n)}`);
    lines.push('');
  }
  if (badDeploys.length) {
    lines.push('### Deployments');
    for (const d of badDeploys) lines.push(`- 🟠 ${d.jobId}: ${d.status} — ${d.description}`);
    lines.push('');
  }

  lines.push('## All jobs', '', '| Job | Type | Status | Alloc |', '|---|---|---|---|');
  for (const j of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| ${j.id} | ${j.type} | ${icon(jobHealth(j))} ${jobHealth(j)} | ${j.running}/${j.desired} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// --- tree filter (NOM-18) ----------------------------------------------------

export interface JobFilter {
  /** Free text matched case-insensitively against the job id. Empty = everything. */
  text: string;
  /** Only jobs whose effective health is a problem. */
  problemsOnly: boolean;
}

export const PROBLEM_HEALTH = ['degraded', 'pending', 'failed', 'lost'];

export const EMPTY_JOB_FILTER: JobFilter = { text: '', problemsOnly: false };

/** True when the job should stay visible in the tree. Pure and testable — the
 *  glue only holds the current filter and re-renders. */
export function jobMatchesFilter(job: JobSummary, filter: JobFilter): boolean {
  if (filter.problemsOnly && !PROBLEM_HEALTH.includes(jobHealth(job))) return false;
  const needle = filter.text.trim().toLowerCase();
  if (!needle) return true;
  return job.id.toLowerCase().includes(needle);
}

export function isFilterActive(filter: JobFilter): boolean {
  return filter.problemsOnly || filter.text.trim().length > 0;
}

/** Description of the active filter, e.g. `2/24 · "web" · problems only`.
 *  Empty string when no filter is active. */
export function filterLabel(filter: JobFilter, shown: number, total: number): string {
  if (!isFilterActive(filter)) return '';
  const bits = [`${shown}/${total}`];
  if (filter.text.trim()) bits.push(`"${filter.text.trim()}"`);
  if (filter.problemsOnly) bits.push('problems only');
  return bits.join(' · ');
}

/** File name for the snapshot on disk (NOM-7): `nomad-snapshot-<cluster>-<date>.md`.
 *  `date` is an already formatted string (e.g. "2026-07-24"). Pure and testable. */
export function snapshotFileName(cluster: string, date: string): string {
  const slug = cluster.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'cluster';
  return `nomad-snapshot-${slug}-${date}.md`;
}

// --- plan diff ---------------------------------------------------------------

function renderObjectDiff(obj: ObjectDiff, indent: string, out: string[]): void {
  if (obj.Type === 'None') return;
  const mark = obj.Type === 'Added' ? '+' : obj.Type === 'Deleted' ? '-' : '~';
  out.push(`${indent}${mark} ${obj.Name}`);
  for (const f of obj.Fields ?? []) {
    if (f.Type === 'None') continue;
    if (f.Type === 'Added') out.push(`${indent}  + ${f.Name} = ${JSON.stringify(f.New)}`);
    else if (f.Type === 'Deleted') out.push(`${indent}  - ${f.Name} = ${JSON.stringify(f.Old)}`);
    else out.push(`${indent}  ~ ${f.Name}: ${JSON.stringify(f.Old)} → ${JSON.stringify(f.New)}`);
  }
  for (const child of obj.Objects ?? []) renderObjectDiff(child, indent + '  ', out);
}

/** Renders a JobDiff (fields, objects, task groups, tasks) as text lines.
 *  Shared by the plan diff and the version history diff (NOM-14). */
export function renderJobDiffLines(diff: JobDiff): string[] {
  const out: string[] = [];
  for (const f of diff.Fields ?? []) {
    if (f.Type === 'None') continue;
    out.push(`~ ${f.Name}: ${JSON.stringify(f.Old)} → ${JSON.stringify(f.New)}`);
  }
  for (const obj of diff.Objects ?? []) renderObjectDiff(obj, '', out);
  for (const tg of diff.TaskGroups ?? []) {
    if (tg.Type === 'None') continue;
    renderObjectDiff(tg, '', out);
    for (const task of tg.Tasks ?? []) renderObjectDiff(task, '  ', out);
  }
  return out;
}

export function renderPlanDiff(plan: PlanResult): string {
  const out: string[] = [];
  const diff: JobDiff | undefined = plan.Diff;
  if (!diff || diff.Type === 'None') {
    out.push('No differences: the job spec matches the running one. ✅');
  } else {
    out.push(`Job diff (${diff.Type}):`, '');
    out.push(...renderJobDiffLines(diff));
  }
  if (plan.FailedTGAllocs && Object.keys(plan.FailedTGAllocs).length) {
    out.push('', `⚠ Placement failed for: ${Object.keys(plan.FailedTGAllocs).join(', ')}`);
  }
  if (plan.Warnings) out.push('', `⚠ Warnings: ${plan.Warnings}`);
  return out.join('\n');
}

// --- incident bundle -----------------------------------------------------------

export interface TaskEventLike {
  Type?: string;
  Time?: number;
  DisplayMessage?: string;
  Details?: Record<string, string>;
}

export interface IncidentInput {
  cluster: string;
  alloc: AllocSummary;
  /** Raw allocation object from the API (TaskStates with Events). */
  allocRaw: Record<string, unknown>;
  /** Logs per task: { task: { stdout, stderr } } */
  logs: Record<string, { stdout: string; stderr: string }>;
}

export interface IncidentBundle {
  dirName: string;
  markdown: string;
  files: { name: string; content: string }[];
}

export function buildIncidentBundle(input: IncidentInput): IncidentBundle {
  const { alloc } = input;
  const date = new Date().toISOString().slice(0, 10);
  const dirName = `${date}-${alloc.jobId}-${alloc.id.slice(0, 8)}`;

  const lines: string[] = [
    `# Incident — ${alloc.jobId} / alloc ${alloc.id.slice(0, 8)}`,
    '',
    `- **Cluster**: ${input.cluster}`,
    `- **Job**: ${alloc.jobId} (task group \`${alloc.taskGroup}\`)`,
    `- **Allocation**: \`${alloc.id}\` — client status: **${alloc.clientStatus}**, restarts: ${alloc.restarts}`,
    `- **Node**: ${alloc.nodeName}`,
    `- **Generated**: ${new Date().toISOString()}`,
    '',
    '## Task event timeline',
    '',
  ];

  const taskStates = (input.allocRaw['TaskStates'] ?? {}) as Record<
    string,
    { State?: string; Failed?: boolean; Events?: TaskEventLike[] }
  >;
  for (const [task, state] of Object.entries(taskStates)) {
    lines.push(`### ${task} — state: ${state.State ?? '?'}${state.Failed ? ' (FAILED)' : ''}`, '');
    for (const ev of state.Events ?? []) {
      const ts = ev.Time ? new Date(ev.Time / 1e6).toISOString() : '?';
      lines.push(`- \`${ts}\` **${ev.Type ?? '?'}** — ${ev.DisplayMessage ?? ''}`);
    }
    lines.push('');
  }

  lines.push('## Attached logs', '');
  const files: { name: string; content: string }[] = [];
  for (const [task, log] of Object.entries(input.logs)) {
    for (const type of ['stdout', 'stderr'] as const) {
      const name = `${task}.${type}.log`;
      files.push({ name, content: log[type] });
      lines.push(`- [\`${name}\`](./${name})`);
    }
  }
  lines.push('', '## Analysis', '', '_(to fill in: cause, impact, remediation)_', '');

  return { dirName, markdown: lines.join('\n'), files };
}
