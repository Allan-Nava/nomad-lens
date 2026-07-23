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

/** Segnali di allarme su un'allocation: kill da OOM e restart loop oltre soglia.
 *  Puro e testabile — cuore del detector NOM-1. */
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
  const now = new Date().toISOString();
  const problems = jobs.filter((j) => ['degraded', 'pending', 'failed'].includes(jobHealth(j)));
  const badNodes = nodes.filter((n) => n.status !== 'ready' || n.drain);
  const badDeploys = deployments.filter((d) => !['successful', 'cancelled'].includes(d.status));

  const lines: string[] = [
    `# Nomad snapshot — ${cluster}`,
    '',
    `Generato: ${now}`,
    '',
    '```',
    `jobs totali : ${jobs.length}  (problemi: ${problems.length})`,
    `nodi        : ${nodes.length}  (non-ready/drain: ${badNodes.length})`,
    `deployments : ${deployments.length} attivi/recenti (non healthy: ${badDeploys.length})`,
    '```',
    '',
    '## ⚠ Da guardare',
    '',
  ];

  if (!problems.length && !badNodes.length && !badDeploys.length) {
    lines.push('Niente — tutto verde. ✅', '');
  }
  if (problems.length) {
    lines.push('| Job | Stato | Alloc running/desired | Failed |', '|---|---|---|---|');
    for (const j of problems) {
      lines.push(`| ${j.id} | ${icon(jobHealth(j))} ${jobHealth(j)} | ${j.running}/${j.desired} | ${j.failed} |`);
    }
    lines.push('');
  }
  if (badNodes.length) {
    lines.push('### Nodi');
    for (const n of badNodes) lines.push(`- 🔴 ${n.name}: status=${n.status}${n.drain ? ' (drain)' : ''}`);
    lines.push('');
  }
  if (badDeploys.length) {
    lines.push('### Deployments');
    for (const d of badDeploys) lines.push(`- 🟠 ${d.jobId}: ${d.status} — ${d.description}`);
    lines.push('');
  }

  lines.push('## Tutti i job', '', '| Job | Tipo | Stato | Alloc |', '|---|---|---|---|');
  for (const j of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| ${j.id} | ${j.type} | ${icon(jobHealth(j))} ${jobHealth(j)} | ${j.running}/${j.desired} |`);
  }
  lines.push('');
  return lines.join('\n');
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

export function renderPlanDiff(plan: PlanResult): string {
  const out: string[] = [];
  const diff: JobDiff | undefined = plan.Diff;
  if (!diff || diff.Type === 'None') {
    out.push('Nessuna differenza: il job spec coincide con quello running. ✅');
  } else {
    out.push(`Job diff (${diff.Type}):`, '');
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
  }
  if (plan.FailedTGAllocs && Object.keys(plan.FailedTGAllocs).length) {
    out.push('', `⚠ Placement fallito per: ${Object.keys(plan.FailedTGAllocs).join(', ')}`);
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
    `- **Allocation**: \`${alloc.id}\` — stato client: **${alloc.clientStatus}**, restarts: ${alloc.restarts}`,
    `- **Nodo**: ${alloc.nodeName}`,
    `- **Generato**: ${new Date().toISOString()}`,
    '',
    '## Timeline eventi task',
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

  lines.push('## Log allegati', '');
  const files: { name: string; content: string }[] = [];
  for (const [task, log] of Object.entries(input.logs)) {
    for (const type of ['stdout', 'stderr'] as const) {
      const name = `${task}.${type}.log`;
      files.push({ name, content: log[type] });
      lines.push(`- [\`${name}\`](./${name})`);
    }
  }
  lines.push('', '## Analisi', '', '_(da compilare: causa, impatto, remediation)_', '');

  return { dirName, markdown: lines.join('\n'), files };
}
