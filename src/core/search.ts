// Global job search (NOM-33): flatten jobs from every configured cluster into a
// pickable list. Pure — NO 'vscode' import; the QuickPick + cluster switch live
// in the glue. VS Code's QuickPick does the fuzzy filtering over label/description.

import { JobSummary } from './api';
import { jobHealth } from './report';

export interface GlobalJobItem {
  cluster: string;
  jobId: string;
  label: string;
  description: string;
}

/** Build the pick list: one entry per job per cluster, sorted by cluster then id. */
export function buildGlobalJobItems(perCluster: { cluster: string; jobs: JobSummary[] }[]): GlobalJobItem[] {
  const items: GlobalJobItem[] = [];
  for (const { cluster, jobs } of perCluster) {
    for (const j of jobs) {
      items.push({
        cluster,
        jobId: j.id,
        label: j.id,
        description: `${cluster} · ${jobHealth(j)} · ${j.running}/${j.desired}`,
      });
    }
  }
  return items.sort((a, b) => a.cluster.localeCompare(b.cluster) || a.jobId.localeCompare(b.jobId));
}
