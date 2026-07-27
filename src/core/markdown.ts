// Minimal Markdown → HTML renderer, just enough for `docs/GUIDE.md` (NOM-20).
// Pure and testable, zero dependencies — the same rule as the rest of the core.
//
// Why write one instead of pulling a library in: the published guide must be
// generated from the single source of truth (`docs/GUIDE.md`) so the website and
// the repo can never drift, and the project ships no runtime dependencies.
// Supported: ATX headings, paragraphs, fenced code, GFM pipe tables, ordered and
// unordered lists (one nesting level), blockquotes, horizontal rules, and the
// inline set `code`, **bold**, *italic*, [links](url).

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  /** Headings in document order — used to build the table of contents. */
  headings: Heading[];
}

/** URL-safe anchor from heading text. Duplicate-free ids are the caller's job. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline formatting. Code spans are isolated first, so `**` inside backticks
 *  stays literal and no markup can smuggle raw HTML through. */
export function renderInline(src: string): string {
  return src
    .split(/(`[^`]*`)/g)
    .map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      let t = escapeHtml(part);
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
        const external = /^https?:/.test(href);
        const attrs = external ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${href}"${attrs}>${label}</a>`;
      });
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
      return t;
    })
    .join('');
}

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function renderList(items: ListItem[]): string {
  const tag = items[0].ordered ? 'ol' : 'ul';
  const out: string[] = [`<${tag}>`];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    // Collect the children of this item (anything more indented).
    const children: ListItem[] = [];
    let j = i + 1;
    while (j < items.length && items[j].indent > item.indent) {
      children.push(items[j]);
      j++;
    }
    out.push(`<li>${renderInline(item.text)}${children.length ? renderList(children) : ''}</li>`);
    i = j;
  }
  out.push(`</${tag}>`);
  return out.join('');
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/** GFM alignment row: `|---|:-:|---:|`. A single dash is legal (`:-:`), so do not
 *  demand two or the centred short form is silently treated as a paragraph. */
function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim()) && line.includes('-');
}

export function renderMarkdown(md: string): RenderedMarkdown {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const headings: Heading[] = [];
  const usedIds = new Set<string>();
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```\s*([a-zA-Z0-9]*)\s*$/);
    if (fence) {
      flushParagraph();
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const cls = lang ? ` class="language-${lang}"` : '';
      html.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].trim();
      let id = slugify(text);
      let n = 2;
      while (usedIds.has(id)) id = `${slugify(text)}-${n++}`;
      usedIds.add(id);
      headings.push({ level, text: text.replace(/`/g, ''), id });
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule (a table separator always starts with a pipe)
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      html.push('<hr>');
      i++;
      continue;
    }

    // table
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      html.push(
        '<div class="table-wrap"><table><thead><tr>' +
          head.map((c) => `<th>${renderInline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows
            .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
            .join('') +
          '</tbody></table></div>'
      );
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(body.join(' '))}</p></blockquote>`);
      continue;
    }

    // list (unordered or ordered, one nesting level via indentation)
    const listStart = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listStart) {
      flushParagraph();
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) {
          // a wrapped continuation line belongs to the previous item
          if (items.length && /^\s+\S/.test(lines[i]) && lines[i].trim()) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3].trim() });
        i++;
      }
      html.push(renderList(items));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();

  return { html: html.join('\n'), headings };
}
