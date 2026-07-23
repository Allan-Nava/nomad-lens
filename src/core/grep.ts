// Grep cross-allocation (NOM-4): ricerca pura su testi di log già scaricati.
// NIENTE import 'vscode' — il fetch parallelo e la presentazione vivono nel glue.

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

/** Cerca `query` (sottostringa, case-insensitive di default) in ogni sorgente,
 *  restituendo le righe che matchano con numero di riga. */
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

/** Report markdown dei match, raggruppati per allocazione. */
export function renderGrepReport(job: string, query: string, matches: GrepMatch[]): string {
  const allocs = [...new Set(matches.map((m) => m.alloc))];
  const lines: string[] = [
    `# grep "${query}" — ${job}`,
    '',
    `${matches.length} match in ${allocs.length} allocation.`,
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
