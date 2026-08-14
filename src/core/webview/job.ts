// Job detail panel (NOM-24). Pure HTML renderer + a tested message contract.
// NO 'vscode' import: the buttons post {type:'action', command, allocId?} and the
// glue routes them through the EXISTING commands (which carry the confirmations).

import { JobSummary, AllocSummary, DeploymentSummary } from '../api';
import { jobHealth, allocWarnings } from '../report';
import { usageFlag } from '../resources';
import { JobVersion } from '../versions';
import { progressBar, sparkline } from './charts';

/** Job-scoped panel commands (invoked with `{ job }`). */
export const JOB_PANEL_JOB_COMMANDS = [
  'nomadLens.stopJob',
  'nomadLens.startJob',
  'nomadLens.scaleJob',
  'nomadLens.scaleStatus',
  'nomadLens.forcePeriodic',
  'nomadLens.dispatchJob',
  'nomadLens.revertJob',
  'nomadLens.jobHistory',
  'nomadLens.resourceUsage',
  'nomadLens.explainPlacement',
] as const;

/** Allocation-scoped panel commands (invoked with `{ alloc }`). */
export const JOB_PANEL_ALLOC_COMMANDS = ['nomadLens.restartAlloc', 'nomadLens.incidentBundle'] as const;

export function isAllowedPanelCommand(cmd: string): boolean {
  return (JOB_PANEL_JOB_COMMANDS as readonly string[]).includes(cmd) ||
    (JOB_PANEL_ALLOC_COMMANDS as readonly string[]).includes(cmd);
}
export function isAllocPanelCommand(cmd: string): boolean {
  return (JOB_PANEL_ALLOC_COMMANDS as readonly string[]).includes(cmd);
}

/** Per-task resource usage for the inline gauges (NOM-29), aggregated across the
 *  job's running allocations. `*Samples` are recent values for the sparkline. */
export interface GaugeTask {
  task: string;
  cpuUsed: number;
  cpuReq: number;
  memUsed: number;
  memReq: number;
  cpuSamples: number[];
  memSamples: number[];
}

export interface JobPanelData {
  job: JobSummary;
  allocs: AllocSummary[];
  deployment?: DeploymentSummary;
  gauges?: GaugeTask[];
  versions?: JobVersion[];
  versionsCurrent?: number;
  nonce: string;
  cspSource: string;
}

/** Inline version history (NOM-31): the last few versions of the job. */
export function renderVersionList(versions: JobVersion[], current: number, limit = 8): string {
  if (!versions.length) return '';
  const rows = versions
    .slice(0, limit)
    .map((v) => {
      const tags = [v.version === current ? 'current' : '', v.stable ? 'stable' : ''].filter(Boolean).join(' · ');
      const when = v.submitTimeMs ? new Date(v.submitTimeMs).toISOString().replace('T', ' ').slice(0, 19) : '—';
      return `<tr><td>v${v.version}</td><td class="mono">${when}</td><td class="muted">${esc(tags)}</td></tr>`;
    })
    .join('');
  return `<table><tr><th>Version</th><th>Submitted (UTC)</th><th></th></tr>${rows}</table>`;
}

function gaugeRow(label: string, used: number, req: number, unit: string, samples: number[]): string {
  const pct = req > 0 ? ` (${Math.round((used / req) * 100)}%)` : '';
  return `<div class="grow"><span class="gl">${label}</span>${progressBar(
    used,
    req,
    'var(--vscode-charts-green, #3FE0A8)',
    140
  )}<span class="gv">${used}/${req || '—'} ${unit}${pct}</span>${sparkline(samples, 90, 20)}</div>`;
}

/** Per-task CPU/memory gauges vs requested + a sparkline of recent samples. */
export function renderResourceGauges(tasks: GaugeTask[]): string {
  if (!tasks.length) {
    return `<p class="muted">No statistics — tasks not running, or the client node is unreachable.</p>`;
  }
  return tasks
    .map((t) => {
      const flag = usageFlag({
        alloc: '',
        task: t.task,
        cpuMhz: t.cpuUsed,
        memMib: t.memUsed,
        cpuRequestMhz: t.cpuReq,
        memRequestMib: t.memReq,
      });
      const badge =
        flag === 'over'
          ? '<span class="warn">⚠ near limit</span>'
          : flag === 'under'
            ? '<span class="muted">💤 oversized</span>'
            : '';
      return `<div class="gauge"><div class="gh">${esc(t.task)} ${badge}</div>${gaugeRow(
        'CPU',
        t.cpuUsed,
        t.cpuReq,
        'MHz',
        t.cpuSamples
      )}${gaugeRow('Mem', t.memUsed, t.memReq, 'MiB', t.memSamples)}</div>`;
    })
    .join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function btn(cmd: string, label: string, allocId?: string): string {
  return `<button data-cmd="${esc(cmd)}"${allocId ? ` data-alloc="${esc(allocId)}"` : ''}>${esc(label)}</button>`;
}

/** Inner body markup only (no <html>/<head>/<script>) — reused for live updates. */
export function renderJobPanelBody(d: JobPanelData): string {
  const health = jobHealth(d.job);
  const jobBtns = [
    btn('nomadLens.jobHistory', 'History / Revert'),
    btn('nomadLens.resourceUsage', 'Resource usage'),
    btn('nomadLens.explainPlacement', 'Why not placing?'),
    btn('nomadLens.scaleJob', 'Scale…'),
    btn('nomadLens.scaleStatus', 'Scaling status'),
    d.job.periodic ? btn('nomadLens.forcePeriodic', 'Force run') : '',
    d.job.parameterized ? btn('nomadLens.dispatchJob', 'Dispatch…') : '',
    btn('nomadLens.stopJob', 'Stop'),
    btn('nomadLens.startJob', 'Start'),
  ]
    .filter(Boolean)
    .join(' ');

  const dep =
    d.deployment && ['running', 'pending', 'paused'].includes(d.deployment.status)
      ? `<h2>Deployment · ${esc(d.deployment.status)}</h2><div class="depbar">${progressBar(
          d.deployment.healthy,
          d.deployment.desired,
          'var(--vscode-charts-green, #3FE0A8)',
          260
        )}<span class="muted">${d.deployment.healthy}/${d.deployment.desired}${
          d.deployment.canaries ? ` · canary ${d.deployment.canaries}` : ''
        }</span></div>`
      : '';

  const rows = d.allocs.length
    ? d.allocs
        .map((a) => {
          const warns = allocWarnings(a);
          return `<tr>
            <td class="mono">${esc(a.id.slice(0, 8))}</td>
            <td>${esc(a.clientStatus)}${warns.length ? ` <span class="warn">⚠ ${esc(warns.join(' · '))}</span>` : ''}</td>
            <td>${esc(a.nodeName)}</td>
            <td class="num">${a.restarts || ''}</td>
            <td>${btn('nomadLens.restartAlloc', 'Restart', a.id)} ${btn('nomadLens.incidentBundle', 'Bundle', a.id)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="muted">No active allocations.</td></tr>`;

  return `
  <h1>${esc(d.job.id)} <span class="live" id="live" title="live"></span></h1>
  <p class="sub">${esc(health)} · ${d.job.running}/${d.job.desired} allocations${d.job.failed ? ` · ${d.job.failed} failed` : ''}</p>
  <div class="actions">${jobBtns}</div>
  ${dep}
  ${d.gauges ? `<h2>Resource usage</h2>${renderResourceGauges(d.gauges)}` : ''}
  ${d.versions && d.versions.length ? `<h2>Version history</h2>${renderVersionList(d.versions, d.versionsCurrent ?? -1)}` : ''}
  <h2>Allocations</h2>
  <table>
    <tr><th>ID</th><th>Status</th><th>Node</th><th class="num">Restarts</th><th>Actions</th></tr>
    ${rows}
  </table>`;
}

const JOB_PANEL_CSS = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 18px 28px; }
  h1 { font-size: 1.2rem; margin: 18px 0 2px; }
  h2 { font-size: 1rem; margin: 22px 0 8px; opacity: .85; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); }
  .muted { color: var(--vscode-descriptionForeground); }
  .warn { color: var(--vscode-charts-orange, #ff9f43); }
  .depbar { display: flex; align-items: center; gap: 10px; }
  .gauge { margin: 8px 0 12px; }
  .gh { font-weight: 600; margin-bottom: 3px; }
  .grow { display: flex; align-items: center; gap: 10px; font-size: .85rem; margin: 2px 0; }
  .gl { width: 34px; color: var(--vscode-descriptionForeground); }
  .gv { min-width: 130px; font-variant-numeric: tabular-nums; }
  .live { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #3FE0A8); opacity: 0; vertical-align: middle; }
  .live.on { opacity: 1; transition: opacity .1s; }
`;

/** Full webview document. Body in #root so a live update (NOM-28) can swap it in
 *  place; button clicks use event delegation so they survive the swap. */
export function renderJobPanel(d: JobPanelData): string {
  const csp = `default-src 'none'; style-src 'nonce-${d.nonce}'; script-src 'nonce-${d.nonce}'; img-src ${d.cspSource} data:;`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style nonce="${d.nonce}">${JOB_PANEL_CSS}</style>
</head>
<body>
  <div id="root">${renderJobPanelBody(d)}</div>
  <script nonce="${d.nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-cmd]') : null;
      if (b) vscode.postMessage({ type: 'action', command: b.dataset.cmd, allocId: b.dataset.alloc });
    });
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m && m.type === 'update' && typeof m.body === 'string') {
        const y = window.scrollY;
        document.getElementById('root').innerHTML = m.body;
        window.scrollTo(0, y);
        const live = document.getElementById('live');
        if (live) { live.classList.add('on'); setTimeout(() => live.classList.remove('on'), 700); }
      }
    });
  </script>
</body>
</html>`;
}
