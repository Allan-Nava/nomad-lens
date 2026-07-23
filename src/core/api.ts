// Thin client for the Nomad HTTP API (v1). Pure module — no vscode imports —
// so it can be integration-tested against `nomad agent -dev`.
// Uses the global fetch available in Node 18+ / the VS Code extension host.

import { aggregateDeployment, DeployTaskGroup } from './deploy';

/** Ogni richiesta non-streaming aborta dopo questo timeout: un cluster
 *  irraggiungibile non deve lasciare l'albero appeso all'infinito. */
export const REQUEST_TIMEOUT_MS = 8000;

/** Max fetch `/v1/job/:id` in volo insieme durante l'enrichment del desired. */
export const JOB_FETCH_CONCURRENCY = 8;

function truncate(s: string, n = 500): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Desired autorevole di un job = somma dei Count dei suoi task group
 *  (il job summary NON contiene il conteggio configurato). Pura e testabile. */
export function desiredFromJob(job: { TaskGroups?: { Count?: number }[] | null }): number {
  return (job.TaskGroups ?? []).reduce((n, tg) => n + (tg.Count ?? 0), 0);
}

export interface NomadTaskEvent {
  Type?: string;
  Time?: number;
  DisplayMessage?: string;
  Details?: Record<string, string>;
}

/** True se un evento task indica un kill per OOM (out of memory). Pura e testabile.
 *  Match stretto: niente `includes('oom')` nudo (matcherebbe "zoom"/"room"). */
export function taskEventIsOom(ev: NomadTaskEvent): boolean {
  if (ev.Details && (ev.Details.oom_killed === 'true' || ev.Details.oom === 'true')) return true;
  const msg = (ev.DisplayMessage ?? '').toLowerCase();
  return (
    msg.includes('out of memory') ||
    msg.includes('oom killed') ||
    msg.includes('oom-killed') ||
    msg.includes('oomkilled')
  );
}

/** map con concorrenza limitata: esegue `fn` su tutti gli item ma al più
 *  `limit` in volo insieme. Preserva l'ordine dei risultati. Pura e testabile. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** True se un token ACL verrebbe inviato in chiaro: presente, su http://,
 *  verso un host non locale. Pura e testabile. */
export function tokenSentInClear(address: string, tokenPresent: boolean): boolean {
  if (!tokenPresent) return false;
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    return false;
  }
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  return address.toLowerCase().startsWith('http://') && !isLocal;
}

export interface ClusterConfig {
  name: string;
  address: string;
  namespace?: string;
  /** Env var NAME that holds the ACL token (the token itself is never stored). */
  tokenEnv?: string;
}

export interface JobSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  running: number;
  desired: number;
  failed: number;
}

export interface AllocSummary {
  id: string;
  name: string;
  jobId: string;
  taskGroup: string;
  clientStatus: string;
  nodeName: string;
  tasks: string[];
  restarts: number;
  /** almeno un task è stato ucciso per OOM (dedotto dagli eventi). */
  oom: boolean;
}

export interface NodeSummary {
  id: string;
  name: string;
  status: string;
  drain: boolean;
  allocCount?: number;
}

export interface DeploymentSummary {
  id: string;
  jobId: string;
  status: string;
  description: string;
  // progresso aggregato sui task group (NOM-2)
  desired: number;
  placed: number;
  healthy: number;
  unhealthy: number;
  canaries: number;
}

export class NomadClient {
  constructor(private cfg: ClusterConfig) {}

  get clusterName(): string {
    return this.cfg.name;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    const token = this.cfg.tokenEnv ? process.env[this.cfg.tokenEnv] : undefined;
    if (token) h['X-Nomad-Token'] = token;
    return h;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`/v1/${path}`, this.cfg.address);
    if (this.cfg.namespace) u.searchParams.set('namespace', this.cfg.namespace);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const res = await fetch(this.url(path, params), {
      headers: this.headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nomad API ${path}: HTTP ${res.status} ${truncate(await res.text())}`);
    return (await res.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nomad API ${path}: HTTP ${res.status} ${truncate(await res.text())}`);
    return (await res.json()) as T;
  }

  async jobs(): Promise<JobSummary[]> {
    type Raw = {
      ID: string;
      Name: string;
      Type: string;
      Status: string;
      JobSummary?: { Summary?: Record<string, { Running?: number; Failed?: number; Queued?: number; Starting?: number }> };
    };
    const raw = await this.getJson<Raw[]>('jobs');
    const list = raw.map((j) => {
      let running = 0;
      let failed = 0;
      let accounted = 0;
      for (const s of Object.values(j.JobSummary?.Summary ?? {})) {
        running += s.Running ?? 0;
        failed += s.Failed ?? 0;
        accounted += (s.Running ?? 0) + (s.Queued ?? 0) + (s.Starting ?? 0);
      }
      // fallback: alloc contabilizzate dal summary (finche' non abbiamo il Count reale).
      return { id: j.ID, name: j.Name, type: j.Type, status: j.Status, running, failed, desired: accounted };
    });

    // Desired autorevole = somma dei Count dei task group, dal job vero. Il summary
    // non lo contiene, quindi un job running-ma-sotto-scala senza alloc in coda
    // altrimenti risulterebbe "healthy". Solo per i job service (batch/system hanno
    // semantiche di conteggio diverse); concorrenza limitata per non sommergere
    // l'API su cluster con molti job; fallback al summary se la fetch fallisce.
    const services = list.filter((s) => s.type === 'service');
    await mapPool(services, JOB_FETCH_CONCURRENCY, async (s) => {
      try {
        const full = await this.getJson<{ TaskGroups?: { Count?: number }[] | null }>(
          `job/${encodeURIComponent(s.id)}`
        );
        const d = desiredFromJob(full);
        if (d > 0) s.desired = d;
      } catch {
        /* mantieni il fallback dal summary */
      }
    });
    return list;
  }

  async allocations(jobId: string): Promise<AllocSummary[]> {
    type Raw = {
      ID: string;
      Name: string;
      JobID: string;
      TaskGroup: string;
      ClientStatus: string;
      NodeName?: string;
      TaskStates?: Record<string, { Restarts?: number; Events?: NomadTaskEvent[] }>;
    };
    const raw = await this.getJson<Raw[]>(`job/${encodeURIComponent(jobId)}/allocations`);
    return raw.map((a) => {
      const states = Object.values(a.TaskStates ?? {});
      return {
        id: a.ID,
        name: a.Name,
        jobId: a.JobID,
        taskGroup: a.TaskGroup,
        clientStatus: a.ClientStatus,
        nodeName: a.NodeName ?? '',
        tasks: Object.keys(a.TaskStates ?? {}),
        restarts: states.reduce((n, t) => n + (t.Restarts ?? 0), 0),
        oom: states.some((t) => (t.Events ?? []).some(taskEventIsOom)),
      };
    });
  }

  /** Full allocation object (task states with events) for incident bundles. */
  async allocation(allocId: string): Promise<Record<string, unknown>> {
    return this.getJson(`allocation/${encodeURIComponent(allocId)}`);
  }

  async nodes(): Promise<NodeSummary[]> {
    type Raw = { ID: string; Name: string; Status: string; Drain: boolean };
    const raw = await this.getJson<Raw[]>('nodes');
    return raw.map((n) => ({ id: n.ID, name: n.Name, status: n.Status, drain: n.Drain }));
  }

  async deployments(): Promise<DeploymentSummary[]> {
    type Raw = {
      ID: string;
      JobID: string;
      Status: string;
      StatusDescription: string;
      TaskGroups?: Record<string, DeployTaskGroup> | null;
    };
    const raw = await this.getJson<Raw[]>('deployments');
    return raw.map((d) => {
      const agg = aggregateDeployment(d.TaskGroups);
      return { id: d.ID, jobId: d.JobID, status: d.Status, description: d.StatusDescription, ...agg };
    });
  }

  /** Parses an HCL job spec into the JSON job the plan/register APIs expect. */
  async parseHcl(hcl: string): Promise<Record<string, unknown>> {
    return this.postJson('jobs/parse', { JobHCL: hcl, Canonicalize: true });
  }

  async registerJob(job: Record<string, unknown>): Promise<void> {
    await this.postJson('jobs', { Job: job });
  }

  private async postVoid(path: string, body: unknown): Promise<void> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nomad API ${path}: HTTP ${res.status} ${truncate(await res.text())}`);
  }

  // --- comandi mutativi (NOM-3): sempre dietro conferma esplicita nel glue ------

  /** Riavvia i task di un'allocazione. */
  async restartAllocation(allocId: string): Promise<void> {
    await this.postVoid(`client/allocation/${encodeURIComponent(allocId)}/restart`, {});
  }

  /** Ferma (deregistra) un job. `purge` lo rimuove anche dallo stato. */
  async stopJob(id: string, purge = false): Promise<void> {
    const res = await fetch(this.url(`job/${encodeURIComponent(id)}`, purge ? { purge: 'true' } : {}), {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Nomad API stop job: HTTP ${res.status} ${truncate(await res.text())}`);
  }

  /** Riavvia un job fermato: rilegge lo spec, azzera Stop e ri-registra. */
  async startJob(id: string): Promise<void> {
    const job = await this.getJson<Record<string, unknown>>(`job/${encodeURIComponent(id)}`);
    (job as { Stop?: boolean }).Stop = false;
    await this.registerJob(job);
  }

  /** Plan: returns the diff between the submitted spec and the running job. */
  async plan(job: Record<string, unknown>): Promise<PlanResult> {
    const id = String((job as { ID?: string }).ID ?? '');
    return this.postJson<PlanResult>(`job/${encodeURIComponent(id)}/plan`, { Job: job, Diff: true });
  }

  /** Fetches a chunk of task logs (no follow). */
  async logsTail(allocId: string, task: string, type: 'stdout' | 'stderr', bytes = 16384): Promise<string> {
    const url = this.url(`client/fs/logs/${encodeURIComponent(allocId)}`, {
      task,
      type,
      origin: 'end',
      offset: String(bytes),
      plain: 'true',
    });
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return `(no ${type} logs: HTTP ${res.status})`;
    return await res.text();
  }

  /**
   * Streams task logs until the returned controller is aborted.
   * onData receives decoded text chunks.
   */
  followLogs(
    allocId: string,
    task: string,
    type: 'stdout' | 'stderr',
    onData: (text: string) => void,
    onEnd: (err?: Error) => void
  ): AbortController {
    const controller = new AbortController();
    const url = this.url(`client/fs/logs/${encodeURIComponent(allocId)}`, {
      task,
      type,
      origin: 'end',
      offset: '2048',
      plain: 'true',
      follow: 'true',
    });
    void (async () => {
      try {
        const res = await fetch(url, { headers: this.headers(), signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const decoder = new TextDecoder();
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          onData(decoder.decode(chunk, { stream: true }));
        }
        onEnd();
      } catch (err) {
        if (controller.signal.aborted) onEnd();
        else onEnd(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return controller;
  }
}

// --- plan diff types (subset of the Nomad API response) -----------------------
export interface FieldDiff {
  Type: string;
  Name: string;
  Old: string;
  New: string;
}

export interface ObjectDiff {
  Type: string;
  Name: string;
  Fields?: FieldDiff[] | null;
  Objects?: ObjectDiff[] | null;
}

export interface TaskDiff extends ObjectDiff {
  Annotations?: string[] | null;
}

export interface TaskGroupDiff extends ObjectDiff {
  Tasks?: TaskDiff[] | null;
  Updates?: Record<string, number> | null;
}

export interface JobDiff extends ObjectDiff {
  TaskGroups?: TaskGroupDiff[] | null;
}

export interface PlanResult {
  Diff?: JobDiff;
  Warnings?: string;
  FailedTGAllocs?: Record<string, unknown> | null;
}
