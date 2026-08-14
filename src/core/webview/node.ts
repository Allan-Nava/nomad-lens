// Node detail panel (NOM-32). Pure HTML renderer + message allow-list.
// NO 'vscode' import: buttons post {type:'action', command} routed by the glue
// through the existing confirmed node commands.

import { NodeSummary, NodeAlloc } from '../api';
import { nodeStateLabel } from '../nodes';

/** Node-scoped panel commands (invoked with `{ node }`). */
export const NODE_PANEL_COMMANDS = ['nomadLens.drainNode', 'nomadLens.stopDrain', 'nomadLens.toggleEligibility'] as const;

export function isAllowedNodePanelCommand(cmd: string): boolean {
  return (NODE_PANEL_COMMANDS as readonly string[]).includes(cmd);
}

export interface NodePanelData {
  node: NodeSummary;
  allocs: NodeAlloc[];
  nonce: string;
  cspSource: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function btn(cmd: string, label: string): string {
  return `<button data-cmd="${esc(cmd)}">${esc(label)}</button>`;
}

export function renderNodePanel(d: NodePanelData): string {
  const n = d.node;
  const actions = n.drain
    ? btn('nomadLens.stopDrain', 'Stop draining')
    : `${btn('nomadLens.drainNode', 'Drain node')} ${btn(
        'nomadLens.toggleEligibility',
        n.eligibility === 'ineligible' ? 'Make eligible' : 'Make ineligible'
      )}`;

  const active = d.allocs.filter((a) => a.clientStatus !== 'complete');
  const byJob = new Map<string, NodeAlloc[]>();
  for (const a of active) byJob.set(a.jobId, [...(byJob.get(a.jobId) ?? []), a]);
  const jobs = [...byJob.keys()].sort();

  const groups = jobs.length
    ? jobs
        .map(
          (job) =>
            `<div class="jg"><div class="jh">${esc(job)} <span class="muted">(${byJob.get(job)!.length})</span></div>${byJob
              .get(job)!
              .map(
                (a) =>
                  `<div class="al"><span class="mono">${esc(a.id.slice(0, 8))}</span> <span class="muted">${esc(
                    a.taskGroup
                  )} · ${esc(a.clientStatus)}</span></div>`
              )
              .join('')}</div>`
        )
        .join('')
    : `<p class="muted">No active allocations on this node.</p>`;

  const css = `
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 18px 28px; }
    h1 { font-size: 1.2rem; margin: 18px 0 2px; }
    h2 { font-size: 1rem; margin: 22px 0 8px; opacity: .85; }
    .sub { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
    button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background);
      border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .jg { margin: 6px 0 12px; }
    .jh { font-weight: 600; }
    .al { padding-left: 14px; font-size: .9rem; }
    .mono { font-family: var(--vscode-editor-font-family, monospace); }
    .muted { color: var(--vscode-descriptionForeground); }
  `;
  const csp = `default-src 'none'; style-src 'nonce-${d.nonce}'; script-src 'nonce-${d.nonce}';`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style nonce="${d.nonce}">${css}</style>
</head>
<body>
  <h1>${esc(n.name)}</h1>
  <p class="sub">${esc(nodeStateLabel(n))} · <span class="mono">${esc(n.id.slice(0, 8))}</span>${
    n.drain && n.drainRemaining !== undefined ? ` · ${n.drainRemaining} allocation(s) left to drain` : ''
  }</p>
  <div class="actions">${actions}</div>
  <h2>Allocations by job</h2>
  ${groups}
  <script nonce="${d.nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-cmd]') : null;
      if (b) vscode.postMessage({ type: 'action', command: b.dataset.cmd });
    });
  </script>
</body>
</html>`;
}
