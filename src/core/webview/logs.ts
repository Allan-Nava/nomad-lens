// Log console panel (NOM-27). Pure log-line classification + the webview shell.
// NO 'vscode' import: the streaming stays on the existing followLogs plumbing;
// here we only strip ANSI, tag a level, and render/append lines.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | '';

const ANSI = /\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** Best-effort level detection from a log line (word-boundaried, case-insensitive). */
export function logLevel(line: string): LogLevel {
  const s = line.toLowerCase();
  if (/\b(error|err|fatal|panic|exception)\b/.test(s)) return 'error';
  if (/\b(warn|warning)\b/.test(s)) return 'warn';
  if (/\b(info|notice)\b/.test(s)) return 'info';
  if (/\b(debug|trace)\b/.test(s)) return 'debug';
  return '';
}

export interface LogLine {
  level: LogLevel;
  text: string;
}

export function classifyLine(text: string): LogLine {
  const t = stripAnsi(text);
  return { level: logLevel(t), text: t };
}

export function classifyLines(chunk: string): LogLine[] {
  return chunk.split('\n').map(classifyLine);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface LogConsoleData {
  title: string;
  lines: LogLine[];
  nonce: string;
  cspSource: string;
}

function lineHtml(l: LogLine): string {
  return `<div class="ln${l.level ? ' lvl-' + l.level : ''}">${esc(l.text)}</div>`;
}

export function renderLogConsole(d: LogConsoleData): string {
  const initial = d.lines.map(lineHtml).join('');
  const css = `
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; height: 100vh; display: flex; flex-direction: column; }
    .bar { display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto; }
    .bar input[type=text] { flex: 1; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 8px; }
    .bar label { font-size: .85rem; color: var(--vscode-descriptionForeground); user-select: none; }
    #log { flex: 1 1 auto; overflow: auto; padding: 8px 12px; font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px); white-space: pre; }
    #log.wrap { white-space: pre-wrap; word-break: break-word; }
    .ln { padding: 0 2px; }
    .ln.lvl-error { color: var(--vscode-charts-red, #ff5f56); }
    .ln.lvl-warn { color: var(--vscode-charts-orange, #ff9f43); }
    .ln.lvl-info { color: var(--vscode-charts-blue, #6cb6ff); }
    .ln.lvl-debug { color: var(--vscode-descriptionForeground); }
    .hidden { display: none; }
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
  <div class="bar">
    <strong>${esc(d.title)}</strong>
    <input id="filter" type="text" placeholder="filter (substring)…" />
    <label><input id="follow" type="checkbox" checked/> follow</label>
    <label><input id="wrap" type="checkbox"/> wrap</label>
  </div>
  <div id="log">${initial}</div>
  <script nonce="${d.nonce}">
    const logEl = document.getElementById('log');
    const filterEl = document.getElementById('filter');
    const followEl = document.getElementById('follow');
    const wrapEl = document.getElementById('wrap');
    let filter = '';
    const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
    const esc = (s) => s.replace(/[&<>]/g, (c) => escMap[c]);
    function applyOne(node) {
      node.classList.toggle('hidden', !!filter && !node.textContent.toLowerCase().includes(filter));
    }
    function append(lines) {
      const frag = document.createDocumentFragment();
      for (const l of lines) {
        const div = document.createElement('div');
        div.className = 'ln' + (l.level ? ' lvl-' + l.level : '');
        div.textContent = l.text;
        applyOne(div);
        frag.appendChild(div);
      }
      logEl.appendChild(frag);
      if (followEl.checked) logEl.scrollTop = logEl.scrollHeight;
    }
    filterEl.addEventListener('input', () => {
      filter = filterEl.value.toLowerCase();
      for (const n of logEl.children) applyOne(n);
    });
    wrapEl.addEventListener('change', () => logEl.classList.toggle('wrap', wrapEl.checked));
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m && m.type === 'append' && Array.isArray(m.lines)) append(m.lines);
      if (m && m.type === 'end') append([{ level: '', text: m.error ? '--- stream error: ' + m.error + ' ---' : '--- stream closed ---' }]);
    });
    logEl.scrollTop = logEl.scrollHeight;
  </script>
</body>
</html>`;
}
