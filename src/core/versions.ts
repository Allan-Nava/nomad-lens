// Job version history (NOM-14): pure parsing and rendering of
// GET /v1/job/:id/versions?diffs=true. No vscode imports — unit-tested.
//
// Nomad returns the versions newest-first and, with `diffs=true`, a parallel
// `Diffs` array where `Diffs[i]` is the diff of `Versions[i]` against the next
// older one (`Versions[i+1]`). So the oldest version never has a diff.
import { JobDiff, JobVersionsResult, RawJobVersion } from './api';
import { renderJobDiffLines } from './report';

export interface JobVersion {
  version: number;
  stable: boolean;
  /** Submit time in milliseconds (the API reports nanoseconds); 0 when unknown. */
  submitTimeMs: number;
  /** Raw job object of this version — replayed through `plan` to preview a revert. */
  raw: Record<string, unknown>;
  /** Diff against the immediately older version; absent on the oldest one. */
  diffToPrevious?: JobDiff;
  /** Version this one is diffed against; null on the oldest one. */
  previousVersion: number | null;
}

/** Normalizes the versions response, pairing every version with its diff.
 *  The pairing follows the API order, so it must happen before any re-sorting. */
export function parseVersions(res: JobVersionsResult): JobVersion[] {
  const raw = res.Versions ?? [];
  const diffs = res.Diffs ?? [];
  const parsed = raw.map((v: RawJobVersion, i) => {
    const older = raw[i + 1];
    return {
      version: v.Version ?? 0,
      stable: v.Stable === true,
      submitTimeMs: v.SubmitTime ? Math.round(v.SubmitTime / 1e6) : 0,
      raw: v as unknown as Record<string, unknown>,
      diffToPrevious: older ? diffs[i] ?? undefined : undefined,
      previousVersion: older ? older.Version ?? 0 : null,
    };
  });
  return parsed.sort((a, b) => b.version - a.version);
}

function submitted(v: JobVersion): string {
  return v.submitTimeMs ? new Date(v.submitTimeMs).toISOString() : 'unknown';
}

/** QuickPick entry for a version: `v3` + `current · stable · <submit time>`. */
export function versionPickItem(v: JobVersion, currentVersion: number): { label: string; description: string } {
  const tags = [
    v.version === currentVersion ? 'current' : '',
    v.stable ? 'stable' : '',
    submitted(v),
  ].filter(Boolean);
  return { label: `v${v.version}`, description: tags.join(' · ') };
}

/** Markdown table of the whole history, newest first. */
export function renderVersionHistory(jobId: string, versions: JobVersion[], currentVersion: number): string {
  const lines = [
    `# Job history — ${jobId}`,
    '',
    '| Version | Submitted | Stable | |',
    '|---|---|:---:|---|',
  ];
  for (const v of versions) {
    lines.push(
      `| v${v.version} | ${submitted(v)} | ${v.stable ? '✔' : ''} | ${v.version === currentVersion ? 'current' : ''} |`
    );
  }
  return lines.join('\n');
}

/** The diff of one version against the immediately older one, as markdown. */
export function renderVersionDiff(jobId: string, v: JobVersion): string {
  const head = `## ${jobId} — v${v.version} vs v${v.previousVersion ?? '?'}`;
  if (v.previousVersion === null) {
    return [`## ${jobId} — v${v.version}`, '', 'Oldest version: there is nothing older to diff against.'].join('\n');
  }
  if (!v.diffToPrevious || v.diffToPrevious.Type === 'None') {
    return [head, '', `No changes between v${v.version} and v${v.previousVersion}.`].join('\n');
  }
  const body = renderJobDiffLines(v.diffToPrevious);
  if (!body.length) {
    return [head, '', `No changes between v${v.version} and v${v.previousVersion}.`].join('\n');
  }
  return [head, '', '```diff', ...body, '```'].join('\n');
}
