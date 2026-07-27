// Generates `site/guide.html` from `docs/GUIDE.md` (NOM-20).
//
// The guide in the repo is the single source of truth — the same rule BACKLOG.md
// follows. The published page is derived from it at deploy time, so the website
// can never document a version of the extension that no longer exists.
// Run with `npm run site`; the Pages workflow runs it before uploading.
import * as fs from 'fs';
import * as path from 'path';
import { renderMarkdown, Heading } from '../src/core/markdown';

// The bundle lands in `.site/`, so anchor on the working directory: npm scripts
// always run from the project root.
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'docs', 'GUIDE.md');
const OUTPUT = path.join(ROOT, 'site', 'guide.html');
const REPO = 'https://github.com/Allan-Nava/nomad-lens';

/** Table of contents from the `##` headings (the `#` title is the page header). */
function renderToc(headings: Heading[]): string {
  const items = headings
    .filter((h) => h.level === 2)
    .map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`)
    .join('\n');
  return `<nav class="toc" aria-label="Contents"><p class="toc-title">Contents</p><ol>${items}</ol></nav>`;
}

function page(title: string, bodyHtml: string, toc: string, version: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Nomad Lens</title>
  <meta name="description" content="Full documentation for Nomad Lens: cluster explorer, plan diff, job version history, placement diagnostics, resource usage, node drain, logs, incident bundles and snapshots." />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='20' font-size='20'%3E%F0%9F%94%8D%3C/text%3E%3C/svg%3E" />
  <style>
    :root {
      --green: #00CA8E; --green-2: #3FE0A8; --green-glow: rgba(0,202,142,.35);
      --bg: #070e17; --panel: rgba(19,37,54,.55); --ink: #e8eef3; --muted: #8fa3b3;
      --border: rgba(120,160,190,.14);
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; color-scheme: dark; }
    body {
      margin: 0; color: var(--ink); font: 16px/1.7 var(--sans); background: var(--bg);
      background-image:
        radial-gradient(60rem 40rem at 10% -10%, rgba(0,202,142,.13), transparent 60%),
        radial-gradient(50rem 40rem at 100% 0%, rgba(63,224,168,.08), transparent 55%);
      background-attachment: fixed;
    }
    a { color: var(--green); text-decoration: none; }
    a:hover { text-decoration: underline; }

    header.top {
      position: sticky; top: 0; z-index: 10; backdrop-filter: blur(10px);
      background: rgba(7,14,23,.82); border-bottom: 1px solid var(--border);
    }
    header.top .bar {
      max-width: 1180px; margin: 0 auto; padding: 12px 22px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    .brand { font-weight: 700; letter-spacing: -.01em; color: var(--ink); }
    .brand span { color: var(--green); }
    .ver { font: 600 .74rem/1 var(--mono); color: var(--muted); border: 1px solid var(--border);
           border-radius: 999px; padding: 5px 10px; }
    header.top nav { margin-left: auto; display: flex; gap: 16px; font-size: .94rem; }
    header.top nav a { color: var(--muted); }
    header.top nav a:hover { color: var(--green); }

    .layout { max-width: 1180px; margin: 0 auto; padding: 34px 22px 80px; display: grid;
              grid-template-columns: 260px minmax(0, 1fr); gap: 40px; align-items: start; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; gap: 20px; } }

    .toc { position: sticky; top: 76px; border: 1px solid var(--border); border-radius: 14px;
           background: var(--panel); padding: 18px 18px 10px; max-height: calc(100vh - 110px);
           overflow-y: auto; }
    @media (max-width: 900px) { .toc { position: static; max-height: none; } }
    .toc-title { margin: 0 0 10px; font: 600 .74rem/1 var(--mono); letter-spacing: .16em;
                 text-transform: uppercase; color: var(--green); }
    .toc ol { margin: 0; padding-left: 1.1rem; }
    .toc li { margin: 6px 0; font-size: .9rem; }
    .toc a { color: var(--muted); }
    .toc a:hover { color: var(--green); }

    main { min-width: 0; }
    main h1 { font-size: clamp(2rem, 4vw, 2.7rem); letter-spacing: -.03em; margin: 0 0 6px;
              background: linear-gradient(100deg, #fff 20%, var(--green-2) 70%);
              -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    main h2 { font-size: 1.5rem; letter-spacing: -.02em; margin: 46px 0 12px; padding-top: 12px;
              border-top: 1px solid var(--border); scroll-margin-top: 80px; }
    main h3 { font-size: 1.14rem; margin: 26px 0 8px; color: var(--green-2); scroll-margin-top: 80px; }
    main h4 { font-size: 1rem; margin: 20px 0 6px; }
    main p, main li { color: #d3dee6; }
    main strong { color: #fff; }
    main code { font-family: var(--mono); font-size: .87em; color: var(--green-2);
                background: rgba(0,202,142,.08); border: 1px solid rgba(0,202,142,.16);
                border-radius: 5px; padding: 1px 5px; }
    main pre { background: rgba(8,17,27,.9); border: 1px solid var(--border); border-radius: 12px;
               padding: 16px 18px; overflow-x: auto; }
    main pre code { background: none; border: none; padding: 0; color: #cfe3d8; font-size: .86rem;
                    line-height: 1.65; }
    main blockquote { margin: 18px 0; padding: 2px 18px; border-left: 3px solid var(--green);
                      background: rgba(0,202,142,.05); border-radius: 0 10px 10px 0; }
    main blockquote p { margin: 12px 0; color: var(--muted); }
    main hr { border: none; border-top: 1px solid var(--border); margin: 34px 0; }
    main ul, main ol { padding-left: 1.3rem; }
    main li { margin: 7px 0; }
    main li > ul, main li > ol { margin-top: 7px; }

    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; margin: 18px 0; }
    table { border-collapse: collapse; width: 100%; font-size: .93rem; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { font: 600 .78rem/1.4 var(--mono); letter-spacing: .04em; text-transform: uppercase;
         color: var(--green); background: rgba(0,202,142,.05); white-space: nowrap; }
    tr:last-child td { border-bottom: none; }

    footer { border-top: 1px solid var(--border); text-align: center; color: var(--muted);
             padding: 34px 22px 60px; font-size: .92rem; }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  </style>
</head>
<body>
  <header class="top">
    <div class="bar">
      <a class="brand" href="./">Nomad <span>Lens</span></a>
      <span class="ver">v${version}</span>
      <nav>
        <a href="./">Home</a>
        <a href="${REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Changelog</a>
        <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </div>
  </header>
  <div class="layout">
    ${toc}
    <main>
${bodyHtml}
    </main>
  </div>
  <footer>
    Generated from <a href="${REPO}/blob/main/docs/GUIDE.md" target="_blank" rel="noopener"><code>docs/GUIDE.md</code></a> — edit the guide, not this page.
    <br />Nomad Lens — MIT · Not affiliated with HashiCorp.
  </footer>
</body>
</html>
`;
}

function main(): void {
  const md = fs.readFileSync(SOURCE, 'utf8');
  const { html, headings } = renderMarkdown(md);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
  const title = headings.find((h) => h.level === 1)?.text ?? 'Guide';
  fs.writeFileSync(OUTPUT, page(title, html, renderToc(headings), version), 'utf8');
  console.log(`site: ${path.relative(ROOT, OUTPUT)} ← ${path.relative(ROOT, SOURCE)} (${headings.length} headings)`);
}

main();
