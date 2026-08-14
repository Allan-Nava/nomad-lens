// Cluster dashboard webview (NOM-23). Pure HTML renderer — NO 'vscode' import.
// Returns a self-contained, CSP-locked HTML document; the webview plumbing
// (panel, nonce, message handling) lives in extension.ts.

import { JobSummary, NodeSummary, DeploymentSummary } from '../api';
import { jobHealth } from '../report';
import { nodeNeedsAttention, nodeStateLabel } from '../nodes';
import { donut, progressBar, DonutSegment } from './charts';

export interface DashboardData {
  cluster: string;
  jobs: JobSummary[];
  nodes: NodeSummary[];
  deployments: DeploymentSummary[];
  nonce: string;
  cspSource: string;
}

const HEALTH_COLORS: Record<string, string> = {
  running: 'var(--vscode-charts-green, #3FE0A8)',
  degraded: 'var(--vscode-charts-orange, #ff9f43)',
  pending: 'var(--vscode-charts-yellow, #ffd166)',
  failed: 'var(--vscode-charts-red, #ff5f56)',
  lost: 'var(--vscode-charts-red, #ff5f56)',
  dead: 'var(--vscode-descriptionForeground, #8fa3b3)',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inner body markup only (no <html>/<head>/<script>) — reused for live updates. */
export function renderDashboardBody(d: DashboardData): string {
  // health mix
  const mix = new Map<string, number>();
  for (const j of d.jobs) {
    const h = jobHealth(j);
    mix.set(h, (mix.get(h) ?? 0) + 1);
  }
  const order = ['running', 'degraded', 'pending', 'failed', 'lost', 'dead'];
  const segments: DonutSegment[] = order
    .filter((k) => mix.get(k))
    .map((k) => ({ label: k, value: mix.get(k) ?? 0, color: HEALTH_COLORS[k] ?? HEALTH_COLORS.dead }));

  const problems = d.jobs.filter((j) => ['degraded', 'pending', 'failed', 'lost'].includes(jobHealth(j)));
  const badNodes = d.nodes.filter((nd) => nodeNeedsAttention(nd));
  const activeDeploys = d.deployments.filter((dep) => ['running', 'pending', 'paused'].includes(dep.status));
  const healthy = problems.length === 0 && badNodes.length === 0;

  const legend = segments
    .map(
      (s) =>
        `<span class="lg"><i style="background:${s.color}"></i>${esc(s.label)} ${s.value}</span>`
    )
    .join('');

  const problemRows = problems.length
    ? problems
        .map(
          (j) =>
            `<tr><td>${esc(j.id)}</td><td><span class="dot" style="background:${
              HEALTH_COLORS[jobHealth(j)] ?? HEALTH_COLORS.dead
            }"></span>${esc(jobHealth(j))}</td><td class="num">${j.running}/${j.desired}</td><td class="num">${
              j.failed || ''
            }</td></tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="muted">No problem jobs.</td></tr>`;

  const nodeRows = badNodes.length
    ? badNodes
        .map((nd) => `<li>🔴 ${esc(nd.name)} — ${esc(nodeStateLabel(nd))}</li>`)
        .join('')
    : `<li class="muted">All nodes ready and eligible.</li>`;

  const deployRows = activeDeploys.length
    ? activeDeploys
        .map(
          (dep) =>
            `<div class="dep"><div class="dep-h"><b>${esc(dep.jobId)}</b><span class="muted">${esc(
              dep.status
            )} · ${dep.healthy}/${dep.desired}${dep.canaries ? ` · canary ${dep.canaries}` : ''}</span></div>${progressBar(
              dep.healthy,
              dep.desired,
              HEALTH_COLORS.running
            )}</div>`
        )
        .join('')
    : `<p class="muted">No active deployments.</p>`;

  return `
  <div class="head">
    <h1>Nomad · ${esc(d.cluster)} <span class="live" id="live" title="live"></span></h1>
    <button id="refresh">↻ Refresh</button>
  </div>
  <p class="sub">${healthy ? 'All green ✅' : `${problems.length} problem job(s), ${badNodes.length} node(s) to watch`}</p>

  <div class="row">
    ${donut(segments)}
    <div>
      <div>${legend || '<span class="muted">No jobs.</span>'}</div>
      <div class="stats">
        <span>${d.jobs.length} jobs</span>
        <span>${d.nodes.length} nodes</span>
        <span>${activeDeploys.length} active deployments</span>
      </div>
    </div>
  </div>

  <h2>⚠ Needs attention</h2>
  <table>
    <tr><th>Job</th><th>Health</th><th class="num">Alloc</th><th class="num">Failed</th></tr>
    ${problemRows}
  </table>

  <h2>Nodes</h2>
  <ul>${nodeRows}</ul>

  <h2>Deployments</h2>
  ${deployRows}`;
}

const DASHBOARD_CSS = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 20px 32px; }
  h1 { font-size: 1.4rem; margin: 20px 0 2px; }
  h2 { font-size: 1rem; margin: 26px 0 10px; opacity: .85; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
  .row { display: flex; gap: 28px; align-items: center; flex-wrap: wrap; }
  .lg { display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; font-size: .85rem; }
  .lg i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .muted { color: var(--vscode-descriptionForeground); }
  ul { margin: 0; padding-left: 18px; }
  .dep { margin: 10px 0; }
  .dep-h { display: flex; justify-content: space-between; font-size: .9rem; margin-bottom: 4px; }
  .stats { display: flex; gap: 22px; margin-top: 6px; font-size: .9rem; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    border: none; padding: 5px 14px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .live { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #3FE0A8); opacity: 0; vertical-align: middle; }
  .live.on { opacity: 1; transition: opacity .1s; }
`;

/** Full webview document. The body lives in #root so it can be swapped in place
 *  by a live update (NOM-28) without reloading the page (scroll kept, no flicker). */
export function renderDashboard(d: DashboardData): string {
  const csp = `default-src 'none'; style-src 'nonce-${d.nonce}'; script-src 'nonce-${d.nonce}'; img-src ${d.cspSource} data:;`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style nonce="${d.nonce}">${DASHBOARD_CSS}</style>
</head>
<body>
  <div id="root">${renderDashboardBody(d)}</div>
  <script nonce="${d.nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'refresh') vscode.postMessage({ type: 'refresh' });
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
