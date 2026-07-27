// Live resource usage (NOM-16): what a task actually uses vs what it asks for.
// Pure parsing/rendering of GET /v1/client/allocation/:id/stats — no vscode imports.
//
// Nomad reports usage per task under `Tasks[name].ResourceUsage`; the request
// side lives in the job spec (`Resources.CPU` in MHz, `Resources.MemoryMB`).
// Comparing them is how you find the task that is about to be OOM-killed and
// the one holding a reservation it never touches.
import { RawAllocStats, RawTaskResourceUsage } from './api';

/** Memory above this share of the request is worth flagging. */
export const MEM_HIGH = 0.9;
/** Memory below this share of the request means the reservation is oversized. */
export const MEM_LOW = 0.2;

export interface TaskUsage {
  alloc: string;
  task: string;
  /** Measured CPU in MHz (Nomad reports ticks, same unit as the request). */
  cpuMhz: number;
  /** Measured resident memory in MiB. */
  memMib: number;
  /** Requested CPU in MHz, 0 when the spec does not say. */
  cpuRequestMhz: number;
  /** Requested memory in MiB, 0 when the spec does not say. */
  memRequestMib: number;
}

export type UsageFlag = 'over' | 'under' | 'ok';

/** Requested resources per task, keyed by task name, from a raw job spec. */
export function taskRequests(job: {
  TaskGroups?: { Tasks?: { Name?: string; Resources?: { CPU?: number; MemoryMB?: number } | null }[] | null }[] | null;
}): Record<string, { cpuMhz: number; memMib: number }> {
  const out: Record<string, { cpuMhz: number; memMib: number }> = {};
  for (const tg of job.TaskGroups ?? []) {
    for (const t of tg.Tasks ?? []) {
      if (!t.Name) continue;
      out[t.Name] = { cpuMhz: t.Resources?.CPU ?? 0, memMib: t.Resources?.MemoryMB ?? 0 };
    }
  }
  return out;
}

function usageOf(u: RawTaskResourceUsage | undefined): { cpuMhz: number; memMib: number } {
  const ticks = u?.ResourceUsage?.CpuStats?.TotalTicks ?? 0;
  const rss = u?.ResourceUsage?.MemoryStats?.RSS ?? 0;
  return { cpuMhz: Math.round(ticks), memMib: Math.round(rss / (1024 * 1024)) };
}

/** Per-task usage from one allocation's stats, joined with the requests. */
export function parseAllocStats(
  allocId: string,
  stats: RawAllocStats,
  requests: Record<string, { cpuMhz: number; memMib: number }>
): TaskUsage[] {
  return Object.entries(stats.Tasks ?? {})
    .map(([task, u]) => {
      const used = usageOf(u);
      const req = requests[task] ?? { cpuMhz: 0, memMib: 0 };
      return {
        alloc: allocId,
        task,
        cpuMhz: used.cpuMhz,
        memMib: used.memMib,
        cpuRequestMhz: req.cpuMhz,
        memRequestMib: req.memMib,
      };
    })
    .sort((a, b) => a.task.localeCompare(b.task) || a.alloc.localeCompare(b.alloc));
}

/** Memory verdict for a task. Unknown request → never flagged. */
export function usageFlag(u: TaskUsage): UsageFlag {
  if (!u.memRequestMib) return 'ok';
  const share = u.memMib / u.memRequestMib;
  if (share >= MEM_HIGH) return 'over';
  // A task that has not started yet reports 0: that is not an oversized
  // reservation, so leave it alone.
  if (u.memMib > 0 && share <= MEM_LOW) return 'under';
  return 'ok';
}

function pct(used: number, req: number): string {
  return req > 0 ? `${Math.round((used / req) * 100)}%` : '—';
}

export function renderResourceUsage(jobId: string, cluster: string, rows: TaskUsage[]): string {
  if (!rows.length) {
    return [
      `# Resource usage — ${jobId} (${cluster})`,
      '',
      'No running allocation reported statistics. The tasks may not be running, or their client node is unreachable.',
    ].join('\n');
  }

  const lines = [
    `# Resource usage — ${jobId} (${cluster})`,
    '',
    `${new Date().toISOString()}`,
    '',
    '| Task | Alloc | CPU used/req | Mem used/req | |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const flag = usageFlag(r);
    const mark = flag === 'over' ? '⚠ near the limit' : flag === 'under' ? '💤 oversized' : '';
    lines.push(
      `| ${r.task} | ${r.alloc.slice(0, 8)} | ${r.cpuMhz}/${r.cpuRequestMhz || '—'} MHz (${pct(r.cpuMhz, r.cpuRequestMhz)}) ` +
        `| ${r.memMib}/${r.memRequestMib || '—'} MiB (${pct(r.memMib, r.memRequestMib)}) | ${mark} |`
    );
  }

  const over = rows.filter((r) => usageFlag(r) === 'over');
  const under = rows.filter((r) => usageFlag(r) === 'under');
  lines.push('');
  if (over.length) {
    lines.push(
      `## ⚠ Near the memory limit (≥${Math.round(MEM_HIGH * 100)}% of the request)`,
      '',
      ...over.map((r) => `- \`${r.task}\` (${r.alloc.slice(0, 8)}): ${r.memMib}/${r.memRequestMib} MiB — raise \`memory\` or it gets OOM-killed`),
      ''
    );
  }
  if (under.length) {
    lines.push(
      `## 💤 Oversized reservation (≤${Math.round(MEM_LOW * 100)}% of the request)`,
      '',
      ...under.map((r) => `- \`${r.task}\` (${r.alloc.slice(0, 8)}): ${r.memMib}/${r.memRequestMib} MiB — the cluster is holding capacity nobody uses`),
      ''
    );
  }
  if (!over.length && !under.length) lines.push('Every task sits within a sensible band of its request. ✅', '');
  return lines.join('\n');
}
