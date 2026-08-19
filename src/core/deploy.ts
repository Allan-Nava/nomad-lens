// Pure logic for the deployment watch (NOM-2): aggregation of a deployment's task
// groups and derivation of state/progress. NO 'vscode' import — the poller and the
// status bar live in the glue.

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

/** Sums the counters of a deployment's task groups. */
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
  active: boolean; // in progress (running/pending/paused)
  done: boolean; // terminal state
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

/** True when an active deployment has canaries that Nomad can promote. */
export function canPromoteDeployment(deployment: { status: string; canaries: number }): boolean {
  return ['running', 'paused'].includes(deployment.status) && deployment.canaries > 0;
}

/** Request promotion of every canary in a deployment. */
export function promoteDeploymentBody(deploymentId: string): { DeploymentID: string; All: true } {
  return { DeploymentID: deploymentId, All: true };
}

export type DeploymentControl = 'pause' | 'resume' | 'fail' | 'cancel';

/** Whether a deployment state supports the requested operational control. */
export function canControlDeployment(status: string, control: DeploymentControl): boolean {
  if (control === 'resume') return status === 'paused';
  if (control === 'pause' || control === 'fail') return status === 'running' || status === 'paused';
  return status === 'running' || status === 'paused' || status === 'pending';
}

export function pauseDeploymentBody(deploymentId: string, paused: boolean): { DeploymentID: string; Pause: boolean } {
  return { DeploymentID: deploymentId, Pause: paused };
}

export type DeployNotice = { kind: 'success' | 'failure'; message: string } | null;

/** Notification to emit when a deployment's status changed since the previous
 *  polling round. Pure and testable. */
export function deployNotification(
  prevStatus: string | undefined,
  jobId: string,
  status: string,
  description: string
): DeployNotice {
  if (!prevStatus || prevStatus === status) return null;
  if (status === 'successful') return { kind: 'success', message: `Deploy ${jobId}: completed ✅` };
  if (status === 'failed' || status === 'cancelled') {
    return { kind: 'failure', message: `Deploy ${jobId}: ${status} — ${description}` };
  }
  return null;
}

/** True when a running deployment has not progressed for too long. Pure. */
export function isDeployStalled(status: string, elapsedMs: number, thresholdMs: number): boolean {
  return status === 'running' && elapsedMs > thresholdMs;
}

/** Status bar text (VS Code's `$(icon)` syntax, but it is just a string). */
export function deployStatusBar(jobId: string, status: string, agg: DeployAgg): string {
  const s = deployStatus(status, agg);
  const icon = s.ok ? '$(check)' : s.failed ? '$(error)' : '$(sync~spin)';
  const canary = agg.canaries ? ` · canary ${agg.canaries}` : '';
  return `${icon} deploy ${jobId} ${agg.healthy}/${agg.desired}${canary}`;
}
