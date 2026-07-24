// Drift fra cluster (milestone v0.4): estrazione dello spec di un job e confronto
// (NOM-5) + inventario immagini (NOM-6). Puro — NIENTE import 'vscode'.

export interface RawTask {
  Name?: string;
  Config?: Record<string, unknown>;
  Env?: Record<string, string> | null;
  Resources?: { CPU?: number; MemoryMB?: number } | null;
}
export interface RawGroup {
  Name?: string;
  Count?: number;
  Tasks?: RawTask[] | null;
}
export interface RawJob {
  ID?: string;
  Name?: string;
  TaskGroups?: RawGroup[] | null;
}

export interface TaskSpec {
  key: string; // group/task
  image: string;
  cpu: number;
  memory: number;
  env: Record<string, string>;
}
export interface JobSpec {
  id: string;
  count: number;
  tasks: TaskSpec[];
}

/** Estrae dal job JSON i campi rilevanti per il drift. */
export function summarizeJob(job: RawJob): JobSpec {
  const tasks: TaskSpec[] = [];
  let count = 0;
  for (const g of job.TaskGroups ?? []) {
    count += g.Count ?? 0;
    for (const t of g.Tasks ?? []) {
      tasks.push({
        key: `${g.Name ?? ''}/${t.Name ?? ''}`,
        image: typeof t.Config?.image === 'string' ? (t.Config.image as string) : '',
        cpu: t.Resources?.CPU ?? 0,
        memory: t.Resources?.MemoryMB ?? 0,
        env: t.Env ?? {},
      });
    }
  }
  return { id: job.ID ?? job.Name ?? '', count, tasks };
}

/** Tutte le immagini docker di un job (per l'inventario, NOM-6). */
export function jobImages(job: RawJob): string[] {
  return [...new Set(summarizeJob(job).tasks.map((t) => t.image).filter(Boolean))];
}

export interface DiffRow {
  field: string;
  a: string;
  b: string;
  same: boolean;
}

function row(field: string, a: string, b: string): DiffRow {
  return { field, a, b, same: a === b };
}

/** Confronta due spec (stesso job su due cluster): count, image, cpu, memory, env. */
export function compareJobSpecs(a: JobSpec, b: JobSpec): DiffRow[] {
  const rows: DiffRow[] = [row('count', String(a.count), String(b.count))];
  const keys = [...new Set([...a.tasks, ...b.tasks].map((t) => t.key))].sort();
  for (const k of keys) {
    const ta = a.tasks.find((t) => t.key === k);
    const tb = b.tasks.find((t) => t.key === k);
    rows.push(row(`${k} · image`, ta?.image ?? '—', tb?.image ?? '—'));
    rows.push(row(`${k} · cpu`, ta ? String(ta.cpu) : '—', tb ? String(tb.cpu) : '—'));
    rows.push(row(`${k} · memory`, ta ? String(ta.memory) : '—', tb ? String(tb.memory) : '—'));
    const envKeys = [...new Set([...Object.keys(ta?.env ?? {}), ...Object.keys(tb?.env ?? {})])].sort();
    for (const ek of envKeys) {
      const va = ta?.env[ek] ?? '—';
      const vb = tb?.env[ek] ?? '—';
      if (va !== vb) rows.push(row(`${k} · env ${ek}`, va, vb));
    }
  }
  return rows;
}

export function renderComparison(jobId: string, labelA: string, labelB: string, rows: DiffRow[]): string {
  const diffs = rows.filter((r) => !r.same).length;
  const lines = [
    `# Compare — ${jobId}`,
    '',
    `${labelA} vs ${labelB} — ${diffs} ${diffs === 1 ? 'differenza' : 'differenze'}.`,
    '',
    `| Campo | ${labelA} | ${labelB} | |`,
    '|---|---|---|:-:|',
  ];
  for (const r of rows) lines.push(`| ${r.field} | ${r.a} | ${r.b} | ${r.same ? '' : '≠'} |`);
  lines.push('');
  return lines.join('\n');
}
