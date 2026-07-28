// Visual diff panel (NOM-25). Pure HTML renderer for a Nomad `JobDiff` (plan diff
// or version diff) as a colour-coded, collapsible tree. NO 'vscode' import.

import { JobDiff, ObjectDiff, FieldDiff } from '../api';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cls(type: string): string {
  return type === 'Added' ? 'add' : type === 'Deleted' ? 'del' : type === 'Edited' ? 'edit' : 'none';
}
function mark(type: string): string {
  return type === 'Added' ? '+' : type === 'Deleted' ? '-' : type === 'Edited' ? '~' : ' ';
}

function renderFields(fields: FieldDiff[] | null | undefined): string {
  return (fields ?? [])
    .filter((f) => f.Type !== 'None')
    .map((f) => {
      let body: string;
      if (f.Type === 'Added') body = `${esc(f.Name)} = ${esc(JSON.stringify(f.New))}`;
      else if (f.Type === 'Deleted') body = `${esc(f.Name)} = ${esc(JSON.stringify(f.Old))}`;
      else body = `${esc(f.Name)}: ${esc(JSON.stringify(f.Old))} → ${esc(JSON.stringify(f.New))}`;
      return `<div class="f ${cls(f.Type)}"><span class="mk">${mark(f.Type)}</span>${body}</div>`;
    })
    .join('');
}

function renderObject(obj: ObjectDiff, label = obj.Name): string {
  if (obj.Type === 'None') return '';
  const inner = renderFields(obj.Fields) + (obj.Objects ?? []).map((o) => renderObject(o)).join('');
  return `<details open class="o ${cls(obj.Type)}"><summary><span class="mk">${mark(obj.Type)}</span>${esc(label)}</summary><div class="body">${inner}</div></details>`;
}

/** The collapsible, colour-coded diff tree. Pure and tested. */
export function renderDiffTree(diff?: JobDiff): string {
  if (!diff || diff.Type === 'None') {
    return `<p class="none">No differences: the job spec matches the running one.</p>`;
  }
  const parts: string[] = [renderFields(diff.Fields)];
  for (const o of diff.Objects ?? []) parts.push(renderObject(o));
  for (const tg of diff.TaskGroups ?? []) {
    if (tg.Type === 'None') continue;
    const inner =
      renderFields(tg.Fields) +
      (tg.Objects ?? []).map((o) => renderObject(o)).join('') +
      (tg.Tasks ?? []).map((t) => renderObject(t, `task ${t.Name}`)).join('');
    parts.push(
      `<details open class="o ${cls(tg.Type)}"><summary><span class="mk">${mark(tg.Type)}</span>group ${esc(
        tg.Name
      )}</summary><div class="body">${inner}</div></details>`
    );
  }
  const body = parts.join('');
  return body.trim() ? body : `<p class="none">No differences.</p>`;
}

export interface DiffPageData {
  title: string;
  diff?: JobDiff;
  nonce: string;
  cspSource: string;
  warnings?: string;
  failedPlacements?: string[];
}

export function renderDiffPage(d: DiffPageData): string {
  const warn = d.warnings
    ? `<p class="warn">⚠ Warnings: ${esc(d.warnings)}</p>`
    : '';
  const failed = d.failedPlacements && d.failedPlacements.length
    ? `<p class="warn">⚠ Placement failed for: ${esc(d.failedPlacements.join(', '))}</p>`
    : '';

  const css = `
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 18px 28px; }
    h1 { font-size: 1.15rem; margin: 18px 0 12px; }
    .none { color: var(--vscode-descriptionForeground); }
    .warn { color: var(--vscode-charts-red, #ff5f56); }
    details { margin: 3px 0; }
    summary { cursor: pointer; font-weight: 600; }
    .o > .body { border-left: 1px solid var(--vscode-panel-border); margin-left: 6px; padding-left: 12px; }
    .f, summary { font-family: var(--vscode-editor-font-family, monospace); font-size: .88rem; }
    .f { padding: 1px 0; white-space: pre-wrap; }
    .mk { display: inline-block; width: 1.1em; font-weight: 700; }
    .add > summary, .f.add { color: var(--vscode-charts-green, #3FE0A8); }
    .del > summary, .f.del { color: var(--vscode-charts-red, #ff5f56); }
    .edit > summary, .f.edit { color: var(--vscode-charts-orange, #ff9f43); }
  `;
  const csp = `default-src 'none'; style-src 'nonce-${d.nonce}'; img-src ${d.cspSource} data:;`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style nonce="${d.nonce}">${css}</style>
</head>
<body>
  <h1>${esc(d.title)}</h1>
  ${failed}${warn}
  <div class="tree">${renderDiffTree(d.diff)}</div>
</body>
</html>`;
}
