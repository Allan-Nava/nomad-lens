// Cross-allocation grep (NOM-4): pure search over already-downloaded log text.
// NO 'vscode' import — the parallel fetching and the presentation live in the glue.

export interface LogSource {
  alloc: string;
  task: string;
  type: 'stdout' | 'stderr';
  text: string;
}

export interface GrepMatch {
  alloc: string;
  task: string;
  type: 'stdout' | 'stderr';
  line: number; // 1-based
  text: string;
}

/** Searches `query` (substring, case-insensitive by default) in every source,
 *  returning the matching lines with their line number. */
export function grepLogs(
  sources: LogSource[],
  query: string,
  opts: { caseSensitive?: boolean } = {}
): GrepMatch[] {
  if (!query) return [];
  const cs = opts.caseSensitive ?? false;
  const needle = cs ? query : query.toLowerCase();
  const out: GrepMatch[] = [];
  for (const s of sources) {
    const lines = s.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const hay = cs ? lines[i] : lines[i].toLowerCase();
      if (hay.includes(needle)) {
        out.push({ alloc: s.alloc, task: s.task, type: s.type, line: i + 1, text: lines[i] });
      }
    }
  }
  return out;
}

/** Markdown report of the matches, grouped by allocation. */
export function renderGrepReport(job: string, query: string, matches: GrepMatch[]): string {
  const allocs = [...new Set(matches.map((m) => m.alloc))];
  const lines: string[] = [
    `# grep "${query}" — ${job}`,
    '',
    `${matches.length} match${matches.length === 1 ? '' : 'es'} in ${allocs.length} allocation${allocs.length === 1 ? '' : 's'}.`,
    '',
  ];
  for (const alloc of allocs) {
    lines.push(`## alloc ${alloc.slice(0, 8)}`, '');
    for (const m of matches.filter((x) => x.alloc === alloc)) {
      lines.push(`- \`${m.task}/${m.type}:${m.line}\` ${m.text.trim()}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
