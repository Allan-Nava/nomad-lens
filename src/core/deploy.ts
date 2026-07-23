// Logica pura per il deployment watch (NOM-2): aggregazione dei task group di un
// deployment e derivazione di stato/progresso. NIENTE import 'vscode' — il poller
// e la status bar vivono nel glue.

export interface DeployTaskGroup {
  DesiredTotal?: number;
  DesiredCanaries?: number;
  PlacedAllocs?: number;
  HealthyAllocs?: number;
  UnhealthyAllocs?: number;
}

export interface DeployAgg {
  desired: number;
  placed: number;
  healthy: number;
  unhealthy: number;
  canaries: number;
}

/** Somma i contatori dei task group di un deployment. */
export function aggregateDeployment(tgs: Record<string, DeployTaskGroup> | null | undefined): DeployAgg {
  const agg: DeployAgg = { desired: 0, placed: 0, healthy: 0, unhealthy: 0, canaries: 0 };
  for (const tg of Object.values(tgs ?? {})) {
    agg.desired += tg.DesiredTotal ?? 0;
    agg.placed += tg.PlacedAllocs ?? 0;
    agg.healthy += tg.HealthyAllocs ?? 0;
    agg.unhealthy += tg.UnhealthyAllocs ?? 0;
    agg.canaries += tg.DesiredCanaries ?? 0;
  }
  return agg;
}

export interface DeployStatus {
  pct: number;
  active: boolean; // in corso (running/pending/paused)
  done: boolean; // stato terminale
  ok: boolean; // successful
  failed: boolean; // failed/cancelled
}

export function deployStatus(status: string, agg: DeployAgg): DeployStatus {
  const ok = status === 'successful';
  const failed = status === 'failed' || status === 'cancelled';
  const active = status === 'running' || status === 'pending' || status === 'paused';
  const pct = agg.desired > 0 ? Math.round((agg.healthy / agg.desired) * 100) : ok ? 100 : 0;
  return { pct, active, done: ok || failed, ok, failed };
}

/** Testo per la status bar (sintassi `$(icon)` di VS Code, ma è solo una stringa). */
export function deployStatusBar(jobId: string, status: string, agg: DeployAgg): string {
  const s = deployStatus(status, agg);
  const icon = s.ok ? '$(check)' : s.failed ? '$(error)' : '$(sync~spin)';
  const canary = agg.canaries ? ` · canary ${agg.canaries}` : '';
  return `${icon} deploy ${jobId} ${agg.healthy}/${agg.desired}${canary}`;
}
