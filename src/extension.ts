import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { renderDashboard, renderDashboardBody, parseDashboardMessage } from './core/webview/dashboard';
import { renderDiffPage } from './core/webview/diff';
import { JobDiff } from './core/api';
import { renderJobPanel, renderJobPanelBody, isAllowedPanelCommand, isAllocPanelCommand, GaugeTask } from './core/webview/job';
import { renderLogConsole, classifyLines, classifyLine } from './core/webview/logs';
import {
  ClusterConfig,
  NomadClient,
  JobSummary,
  AllocSummary,
  NodeSummary,
  tokenSentInClear,
  mapPool,
} from './core/api';
import { DRAIN_DEADLINE_PRESETS, nodeNeedsAttention, nodeStateLabel } from './core/nodes';
import { grepLogs, renderGrepReport, LogSource } from './core/grep';
import {
  summarizeJob,
  compareJobSpecs,
  renderComparison,
  jobImages,
  renderImageInventory,
  ClusterInventory,
  RawJob,
} from './core/drift';
import {
  renderSnapshot,
  renderPlanDiff,
  buildIncidentBundle,
  jobHealth,
  allocWarnings,
  snapshotFileName,
  jobMatchesFilter,
  isFilterActive,
  filterLabel,
  EMPTY_JOB_FILTER,
  JobFilter,
} from './core/report';
import { decideVulncheckFix, VULNCHECK_SETTING, VulncheckFixTarget } from './core/vulncheck';
import { ACTIONS, NomadActionKind, confirmMessage } from './core/actions';
import { parseVersions, versionPickItem, renderVersionHistory, renderVersionDiff } from './core/versions';
import { latestPlacementFailures, placementSummary, renderPlacementReport } from './core/placement';
import { parseAllocStats, renderResourceUsage, taskRequests, TaskUsage } from './core/resources';
import { deployStatus, deployStatusBar, deployNotification, isDeployStalled } from './core/deploy';

/** Max placement checks in flight while marking stuck jobs in the tree. */
const PLACEMENT_CONCURRENCY = 4;

type Node =
  | { kind: 'section'; label: 'Jobs' | 'Nodes' | 'Deployments' }
  | { kind: 'job'; job: JobSummary }
  | { kind: 'alloc'; alloc: AllocSummary }
  | { kind: 'task'; alloc: AllocSummary; task: string }
  | { kind: 'node'; node: NodeSummary }
  | { kind: 'filter'; label: string }
  | { kind: 'leaf'; label: string; iconId?: string };

const HEALTH_ICON: Record<string, string> = {
  running: 'pass-filled',
  degraded: 'warning',
  pending: 'sync',
  dead: 'circle-slash',
  failed: 'error',
};

class NomadTree implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  /** jobId → why the scheduler cannot place it (NOM-15), refreshed with the list. */
  private placementWarn = new Map<string, string>();
  /** Active job filter (NOM-18). */
  private filter: JobFilter = EMPTY_JOB_FILTER;

  constructor(private getClient: () => NomadClient | null) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getFilter(): JobFilter {
    return this.filter;
  }

  setFilter(filter: JobFilter): void {
    this.filter = filter;
    this.refresh();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'section': {
        const item = new vscode.TreeItem(
          node.label,
          node.label === 'Jobs'
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.iconPath = new vscode.ThemeIcon(
          node.label === 'Jobs' ? 'rocket' : node.label === 'Nodes' ? 'server-environment' : 'history'
        );
        item.id = `section:${node.label}`;
        return item;
      }
      case 'job': {
        const health = jobHealth(node.job);
        const item = new vscode.TreeItem(node.job.id, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `job:${node.job.id}`;
        item.description = `${health} · ${node.job.running}/${node.job.desired} alloc${node.job.failed ? ` · ${node.job.failed} failed` : ''}`;
        item.iconPath = new vscode.ThemeIcon(HEALTH_ICON[health] ?? 'question');
        item.contextValue = 'job';
        const stuck = this.placementWarn.get(node.job.id);
        if (stuck) {
          item.description = `⚠ cannot place · ${item.description}`;
          item.iconPath = new vscode.ThemeIcon('warning');
          item.tooltip = `Placement failed — ${stuck}`;
        }
        return item;
      }
      case 'alloc': {
        const a = node.alloc;
        const item = new vscode.TreeItem(a.id.slice(0, 8), vscode.TreeItemCollapsibleState.Collapsed);
        const warns = allocWarnings(a);
        if (warns.length) {
          item.description = `⚠ ${warns.join(' · ')} · ${a.nodeName}`;
          item.iconPath = new vscode.ThemeIcon('warning');
          item.tooltip = `${a.clientStatus} — ${warns.join(', ')} · ${a.nodeName}`;
        } else {
          item.description = `${a.clientStatus} · ${a.nodeName}${a.restarts ? ` · restarts ${a.restarts}` : ''}`;
          item.iconPath = new vscode.ThemeIcon(
            a.clientStatus === 'running' ? 'pass-filled' : a.clientStatus === 'failed' ? 'error' : 'circle-outline'
          );
        }
        item.contextValue = `alloc-${a.clientStatus}`;
        return item;
      }
      case 'task': {
        const item = new vscode.TreeItem(node.task, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('terminal');
        item.contextValue = 'task';
        item.command = {
          command: 'nomadLens.followLogs',
          title: 'Follow Logs',
          arguments: [node],
        };
        return item;
      }
      case 'node': {
        const n = node.node;
        const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
        item.description = nodeStateLabel(n);
        const attention = nodeNeedsAttention(n);
        item.iconPath = new vscode.ThemeIcon(attention ? (n.drain ? 'debug-pause' : 'warning') : 'pass-filled');
        item.tooltip = `${n.name} (${n.id})\nstatus: ${n.status} · eligibility: ${n.eligibility}${n.drain ? ' · draining' : ''}`;
        // The context value drives which drain/eligibility commands are offered.
        item.contextValue = `node-${n.drain ? 'draining' : n.eligibility}`;
        return item;
      }
      case 'filter': {
        const item = new vscode.TreeItem(`filter: ${node.label}`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('filter');
        item.tooltip = 'Click to clear the filter';
        item.command = { command: 'nomadLens.clearFilter', title: 'Clear Filter' };
        return item;
      }
      case 'leaf': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        if (node.iconId) item.iconPath = new vscode.ThemeIcon(node.iconId);
        return item;
      }
    }
  }

  /** Flags the jobs the scheduler cannot place (NOM-15). Only jobs that already
   *  look stuck are checked — one extra API call each — and a failure here is
   *  swallowed: diagnostics must never take the tree down. */
  private async markStuckJobs(client: NomadClient, jobs: JobSummary[]): Promise<void> {
    this.placementWarn.clear();
    const stuck = jobs.filter((j) => j.status !== 'dead' && j.desired > 0 && j.running === 0);
    await mapPool(stuck, PLACEMENT_CONCURRENCY, async (j) => {
      try {
        const report = latestPlacementFailures(await client.evaluations(j.id));
        if (report) this.placementWarn.set(j.id, placementSummary(report));
      } catch {
        /* best effort */
      }
    });
  }

  /** Only jobs are revealed (NOM-30); their parent is the Jobs section. */
  getParent(node: Node): Node | undefined {
    if (node.kind === 'job') return { kind: 'section', label: 'Jobs' };
    return undefined;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const client = this.getClient();
    if (!client) return [{ kind: 'leaf', label: 'No cluster configured (nomadLens.clusters)', iconId: 'gear' }];
    try {
      if (!node) {
        return [
          { kind: 'section', label: 'Jobs' },
          { kind: 'section', label: 'Nodes' },
          { kind: 'section', label: 'Deployments' },
        ];
      }
      if (node.kind === 'section' && node.label === 'Jobs') {
        const all = await client.jobs();
        const jobs = all.filter((j) => jobMatchesFilter(j, this.filter));
        await this.markStuckJobs(client, jobs);
        const items: Node[] = jobs
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((job) => ({ kind: 'job' as const, job }));
        if (isFilterActive(this.filter)) {
          // The filter must be visible: a silently truncated list reads as an
          // empty cluster. The entry clears the filter when clicked.
          items.unshift({
            kind: 'filter',
            label: filterLabel(this.filter, jobs.length, all.length),
          });
        }
        return items;
      }
      if (node.kind === 'section' && node.label === 'Nodes') {
        const nodes = await client.nodes();
        return nodes.map((n) => ({ kind: 'node' as const, node: n }));
      }
      if (node.kind === 'section' && node.label === 'Deployments') {
        const deps = await client.deployments();
        if (!deps.length) return [{ kind: 'leaf', label: '(no deployment)', iconId: 'dash' }];
        return deps.map((d) => ({
          kind: 'leaf' as const,
          label: `${d.jobId} — ${d.status}${d.description ? ` · ${d.description}` : ''}`,
          iconId: d.status === 'successful' ? 'pass-filled' : 'sync',
        }));
      }
      if (node.kind === 'job') {
        const allocs = await client.allocations(node.job.id);
        return allocs
          .filter((a) => a.clientStatus !== 'complete')
          .map((alloc) => ({ kind: 'alloc' as const, alloc }));
      }
      if (node.kind === 'alloc') {
        return node.alloc.tasks.map((task) => ({ kind: 'task' as const, alloc: node.alloc, task }));
      }
      return [];
    } catch (err) {
      return [{ kind: 'leaf', label: `error: ${err}`, iconId: 'error' }];
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let client: NomadClient | null = null;
  const logStreams = new Map<string, { controller: AbortController; channel: vscode.OutputChannel }>();

  const clusters = (): ClusterConfig[] =>
    vscode.workspace.getConfiguration('nomadLens').get<ClusterConfig[]>('clusters', []);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 88);
  status.command = 'nomadLens.selectCluster';
  const updateStatus = () => {
    status.text = client ? `$(rocket) nomad: ${client.clusterName}` : '$(rocket) nomad: select cluster';
    status.show();
  };

  // Warn (once per cluster) if an ACL token would be sent in cleartext over http://.
  const warnedInsecure = new Set<string>();
  const warnIfInsecureToken = (cfg: ClusterConfig) => {
    const tokenPresent = !!(cfg.tokenEnv && process.env[cfg.tokenEnv]);
    if (tokenSentInClear(cfg.address, tokenPresent) && !warnedInsecure.has(cfg.name)) {
      warnedInsecure.add(cfg.name);
      void vscode.window.showWarningMessage(
        `Nomad Lens: the ACL token of cluster "${cfg.name}" would be sent in cleartext over ${cfg.address}. Use https://.`
      );
    }
  };

  const initial = clusters()[0];
  if (initial) {
    client = new NomadClient(initial);
    warnIfInsecureToken(initial);
  }
  updateStatus();

  const tree = new NomadTree(() => client);
  const treeView = vscode.window.createTreeView('nomadLens.explorer', { treeDataProvider: tree });
  context.subscriptions.push(treeView, status);
  // Reveal a job in the tree (NOM-30); best-effort — never let it throw.
  const revealJob = async (jobId: string) => {
    if (!client) return;
    try {
      const job = (await client.jobs()).find((j) => j.id === jobId);
      if (job) await treeView.reveal({ kind: 'job', job }, { select: true, focus: false, expand: true });
    } catch {
      /* reveal is best-effort */
    }
  };

  const stopAllStreams = () => {
    for (const [, s] of logStreams) s.controller.abort();
    logStreams.clear();
  };

  // --- Cluster dashboard webview (NOM-23) --------------------------------------
  let dashPanel: vscode.WebviewPanel | undefined;
  const renderDashboardPanel = async () => {
    if (!dashPanel || !client) return;
    const active = client;
    try {
      const [jobs, nodes, deployments] = await Promise.all([active.jobs(), active.nodes(), active.deployments()]);
      dashPanel.title = `Nomad: ${active.clusterName}`;
      dashPanel.webview.html = renderDashboard({
        cluster: active.clusterName,
        jobs,
        nodes,
        deployments,
        nonce: crypto.randomBytes(16).toString('base64'),
        cspSource: dashPanel.webview.cspSource,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Dashboard failed — ${err}`);
    }
  };

  // Live update (NOM-28): swap the dashboard body in place, no full reload.
  const updateDashboardLive = async () => {
    if (!dashPanel || !client) return;
    const active = client;
    try {
      const [jobs, nodes, deployments] = await Promise.all([active.jobs(), active.nodes(), active.deployments()]);
      if (!dashPanel) return;
      void dashPanel.webview.postMessage({
        type: 'update',
        body: renderDashboardBody({ cluster: active.clusterName, jobs, nodes, deployments, nonce: '', cspSource: dashPanel.webview.cspSource }),
      });
    } catch {
      /* transient: next tick */
    }
  };

  // --- Visual diff panel (NOM-25): plan diff / version diff as a colour tree ---
  let diffPanel: vscode.WebviewPanel | undefined;
  const showDiffPanel = (title: string, diff?: JobDiff, extras?: { warnings?: string; failedPlacements?: string[] }) => {
    if (!diffPanel) {
      diffPanel = vscode.window.createWebviewPanel('nomadLens.diff', title, vscode.ViewColumn.Beside, {
        enableScripts: false,
      });
      diffPanel.onDidDispose(() => (diffPanel = undefined), null, context.subscriptions);
    }
    diffPanel.title = title;
    diffPanel.webview.html = renderDiffPage({
      title,
      diff,
      warnings: extras?.warnings,
      failedPlacements: extras?.failedPlacements,
      nonce: crypto.randomBytes(16).toString('base64'),
      cspSource: diffPanel.webview.cspSource,
    });
    diffPanel.reveal(vscode.ViewColumn.Beside);
  };

  // --- Job detail panel (NOM-24) -----------------------------------------------
  let jobPanel: vscode.WebviewPanel | undefined;
  let jobPanelId: string | undefined;
  let jobPanelAllocs: AllocSummary[] = [];
  // Ring buffer of recent per-task usage samples, keyed by `${jobId}/${task}`,
  // so the sparklines grow across panel refreshes (NOM-29).
  const usageBuffers = new Map<string, { cpu: number[]; mem: number[] }>();
  const USAGE_SAMPLES = 30;

  const collectGauges = async (jobId: string, allocs: AllocSummary[]): Promise<GaugeTask[]> => {
    if (!client) return [];
    const active = client;
    const running = allocs.filter((a) => a.clientStatus === 'running');
    if (!running.length) return [];
    const requests = taskRequests((await active.job(jobId)) as Parameters<typeof taskRequests>[0]);
    const perAlloc = await mapPool(running, 8, async (a): Promise<TaskUsage[]> => {
      try {
        return parseAllocStats(a.id, await active.allocStats(a.id), requests);
      } catch {
        return [];
      }
    });
    const agg = new Map<string, { cpuUsed: number; memUsed: number; cpuReq: number; memReq: number }>();
    for (const list of perAlloc) {
      for (const u of list) {
        const g = agg.get(u.task) ?? { cpuUsed: 0, memUsed: 0, cpuReq: 0, memReq: 0 };
        g.cpuUsed += u.cpuMhz;
        g.memUsed += u.memMib;
        g.cpuReq += u.cpuRequestMhz;
        g.memReq += u.memRequestMib;
        agg.set(u.task, g);
      }
    }
    return [...agg.entries()].map(([task, g]) => {
      const key = `${jobId}/${task}`;
      const buf = usageBuffers.get(key) ?? { cpu: [], mem: [] };
      buf.cpu.push(g.cpuUsed);
      buf.mem.push(g.memUsed);
      if (buf.cpu.length > USAGE_SAMPLES) buf.cpu.shift();
      if (buf.mem.length > USAGE_SAMPLES) buf.mem.shift();
      usageBuffers.set(key, buf);
      return {
        task,
        cpuUsed: g.cpuUsed,
        cpuReq: g.cpuReq,
        memUsed: g.memUsed,
        memReq: g.memReq,
        cpuSamples: [...buf.cpu],
        memSamples: [...buf.mem],
      };
    });
  };

  const renderJobPanelFor = async (jobId: string) => {
    if (!client) return;
    const active = client;
    try {
      const [jobs, allocs, deployments] = await Promise.all([
        active.jobs(),
        active.allocations(jobId),
        active.deployments(),
      ]);
      const job = jobs.find((j) => j.id === jobId);
      if (!job || !jobPanel) return;
      jobPanelAllocs = allocs;
      const gauges = await collectGauges(jobId, allocs);
      if (!jobPanel) return;
      jobPanel.title = `Nomad: ${jobId}`;
      jobPanel.webview.html = renderJobPanel({
        job,
        allocs,
        deployment: deployments.find((d) => d.jobId === jobId),
        gauges,
        nonce: crypto.randomBytes(16).toString('base64'),
        cspSource: jobPanel.webview.cspSource,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Job panel failed — ${err}`);
    }
  };
  // Live update (NOM-28): swap the job-panel body in place, no full reload.
  const updateJobPanelLive = async () => {
    if (!jobPanel || !jobPanelId || !client) return;
    const active = client;
    const jobId = jobPanelId;
    try {
      const [jobs, allocs, deployments] = await Promise.all([active.jobs(), active.allocations(jobId), active.deployments()]);
      const job = jobs.find((j) => j.id === jobId);
      if (!job || !jobPanel) return;
      jobPanelAllocs = allocs;
      const gauges = await collectGauges(jobId, allocs);
      if (!jobPanel) return;
      void jobPanel.webview.postMessage({
        type: 'update',
        body: renderJobPanelBody({
          job,
          allocs,
          deployment: deployments.find((d) => d.jobId === jobId),
          gauges,
          nonce: '',
          cspSource: jobPanel.webview.cspSource,
        }),
      });
    } catch {
      /* transient: next tick */
    }
  };

  // --- Deployment watch (NOM-2): progress in the status bar + notifications ----
  const deployBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 87);
  context.subscriptions.push(deployBar);
  const deployState = new Map<string, { status: string; healthy: number; since: number; warnedStall: boolean }>();

  const pollDeployments = async () => {
    const cfg = vscode.workspace.getConfiguration('nomadLens');
    // Live panels (NOM-28): push in-place updates on the same tick, independent
    // of the deployment watch below.
    if (client && cfg.get<boolean>('livePanels', true)) {
      void updateDashboardLive();
      void updateJobPanelLive();
    }
    if (!client || !cfg.get<boolean>('deploymentWatch', true)) {
      deployBar.hide();
      return;
    }
    let deps;
    try {
      deps = await client.deployments();
    } catch {
      return; // transient: retry on the next tick
    }
    const now = Date.now();
    for (const d of deps) {
      const prev = deployState.get(d.id);
      const notice = deployNotification(prev?.status, d.jobId, d.status, d.description);
      if (notice?.kind === 'success') void vscode.window.showInformationMessage(notice.message);
      else if (notice?.kind === 'failure') void vscode.window.showWarningMessage(notice.message);
      if (!prev || prev.status !== d.status || prev.healthy !== d.healthy) {
        deployState.set(d.id, { status: d.status, healthy: d.healthy, since: now, warnedStall: false });
      }
    }
    for (const id of [...deployState.keys()]) if (!deps.some((d) => d.id === id)) deployState.delete(id);

    const active = deps.find((d) => deployStatus(d.status, d).active);
    if (!active) {
      deployBar.hide();
      return;
    }
    deployBar.text = deployStatusBar(active.jobId, active.status, active);
    deployBar.tooltip = `Deploy ${active.jobId}: ${active.status} — healthy ${active.healthy}/${active.desired}, unhealthy ${active.unhealthy}`;
    deployBar.show();

    const st = deployState.get(active.id)!;
    const stallMs = Math.max(10, cfg.get<number>('deploymentStallSeconds', 90)) * 1000;
    if (!st.warnedStall && isDeployStalled(active.status, now - st.since, stallMs)) {
      st.warnedStall = true;
      void vscode.window.showWarningMessage(
        `Deploy ${active.jobId} looks stalled: healthy ${active.healthy}/${active.desired} for ~${Math.round((now - st.since) / 1000)}s`
      );
    }
  };

  const pollSec = Math.max(2, vscode.workspace.getConfiguration('nomadLens').get<number>('deploymentPollSeconds', 5));
  const deployTimer = setInterval(() => void pollDeployments(), pollSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(deployTimer) });
  void pollDeployments();

  context.subscriptions.push(
    vscode.commands.registerCommand('nomadLens.refresh', () => tree.refresh()),

    // --- job filter (NOM-18) ---------------------------------------------------

    vscode.commands.registerCommand('nomadLens.filterJobs', async () => {
      const current = tree.getFilter();
      const text = await vscode.window.showInputBox({
        prompt: 'Filter jobs by name (substring, case-insensitive). Empty clears the text filter.',
        value: current.text,
        placeHolder: 'e.g. transcoder',
      });
      if (text === undefined) return; // escaped: leave the filter untouched
      tree.setFilter({ ...current, text });
    }),

    vscode.commands.registerCommand('nomadLens.toggleProblemsOnly', () => {
      const current = tree.getFilter();
      tree.setFilter({ ...current, problemsOnly: !current.problemsOnly });
      void vscode.window.setStatusBarMessage(
        current.problemsOnly ? 'Nomad Lens: showing all jobs' : 'Nomad Lens: showing problem jobs only',
        3000
      );
    }),

    vscode.commands.registerCommand('nomadLens.clearFilter', () => tree.setFilter(EMPTY_JOB_FILTER)),

    vscode.commands.registerCommand('nomadLens.selectCluster', async () => {
      const all = clusters();
      const picked = await vscode.window.showQuickPick(
        all.map((c) => ({ label: c.name, description: c.address, c })),
        { placeHolder: 'Nomad cluster' }
      );
      if (!picked) return;
      stopAllStreams();
      deployState.clear();
      deployBar.hide();
      client = new NomadClient(picked.c);
      warnIfInsecureToken(picked.c);
      updateStatus();
      tree.refresh();
      void pollDeployments();
      void renderDashboardPanel();
    }),

    vscode.commands.registerCommand('nomadLens.followLogs', async (node?: { alloc: AllocSummary; task: string }) => {
      if (!client || !node) return;
      const type = (await vscode.window.showQuickPick(['stdout', 'stderr'], {
        placeHolder: `Logs of ${node.task} (alloc ${node.alloc.id.slice(0, 8)})`,
      })) as 'stdout' | 'stderr' | undefined;
      if (!type) return;
      const key = `${node.alloc.id}/${node.task}/${type}`;
      if (logStreams.has(key)) {
        logStreams.get(key)!.channel.show(true);
        return;
      }
      const channel = vscode.window.createOutputChannel(`Nomad: ${node.alloc.jobId}/${node.task} ${type}`);
      channel.show(true);
      const controller = client.followLogs(
        node.alloc.id,
        node.task,
        type,
        (text) => channel.append(text),
        (err) => {
          channel.appendLine(err ? `\n--- stream error: ${err.message} ---` : '\n--- stream closed ---');
          logStreams.delete(key);
        }
      );
      logStreams.set(key, { controller, channel });
    }),

    vscode.commands.registerCommand('nomadLens.stopLogs', async () => {
      const key = await vscode.window.showQuickPick([...logStreams.keys()], { placeHolder: 'Stream to stop' });
      if (!key) return;
      logStreams.get(key)?.controller.abort();
      logStreams.delete(key);
    }),

    vscode.commands.registerCommand('nomadLens.planFile', async () => {
      if (!client) return;
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !/\.(nomad|hcl)$/.test(doc.fileName)) {
        void vscode.window.showWarningMessage('Open a .nomad/.hcl job spec before running the plan.');
        return;
      }
      try {
        const job = await client.parseHcl(doc.getText());
        const plan = await client.plan(job);
        showDiffPanel(`Plan — ${path.basename(doc.fileName)} vs ${client.clusterName}`, plan.Diff, {
          warnings: plan.Warnings,
          failedPlacements: plan.FailedTGAllocs ? Object.keys(plan.FailedTGAllocs) : undefined,
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`nomad plan failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.incidentBundle', async (node?: { alloc: AllocSummary }) => {
      if (!client || !node) return;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Open a working folder to save the bundle into.');
        return;
      }
      try {
        const allocRaw = await client.allocation(node.alloc.id);
        const logs: Record<string, { stdout: string; stderr: string }> = {};
        for (const task of node.alloc.tasks) {
          logs[task] = {
            stdout: await client.logsTail(node.alloc.id, task, 'stdout'),
            stderr: await client.logsTail(node.alloc.id, task, 'stderr'),
          };
        }
        const bundle = buildIncidentBundle({ cluster: client.clusterName, alloc: node.alloc, allocRaw, logs });
        const dir = vscode.Uri.joinPath(folder.uri, 'incidents', bundle.dirName);
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'report.md'), Buffer.from(bundle.markdown));
        for (const f of bundle.files) {
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, f.name), Buffer.from(f.content));
        }
        const reportDoc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(dir, 'report.md'));
        await vscode.window.showTextDocument(reportDoc);
        void vscode.window.showInformationMessage(`Incident bundle: incidents/${bundle.dirName}/`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Incident bundle failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.snapshot', async () => {
      if (!client) return;
      try {
        const [jobs, nodes, deployments] = await Promise.all([client.jobs(), client.nodes(), client.deployments()]);
        const md = renderSnapshot(client.clusterName, jobs, nodes, deployments);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Snapshot failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.restartAlloc', async (node?: { alloc: AllocSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('restartAlloc', node.alloc.id.slice(0, 8)))) return;
      try {
        await client.restartAllocation(node.alloc.id);
        void vscode.window.showInformationMessage(`Allocation ${node.alloc.id.slice(0, 8)} restarted.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Restart allocation failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.stopJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('stopJob', node.job.id))) return;
      try {
        await client.stopJob(node.job.id);
        void vscode.window.showInformationMessage(`Job ${node.job.id} stopped.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Stop job failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.startJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('startJob', node.job.id))) return;
      try {
        await client.startJob(node.job.id);
        void vscode.window.showInformationMessage(`Job ${node.job.id} started.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Start job failed — ${err}`);
      }
    }),

    // --- node drain / eligibility (NOM-17) -------------------------------------

    vscode.commands.registerCommand('nomadLens.drainNode', async (item?: { node: NodeSummary }) => {
      if (!client || !item) return;
      const n = item.node;
      const deadline = await vscode.window.showQuickPick(
        DRAIN_DEADLINE_PRESETS.map((p) => ({ label: p.label, seconds: p.seconds })),
        { placeHolder: `Drain deadline for ${n.name} — allocations still running when it expires are killed` }
      );
      if (!deadline) return;
      // Typed confirmation on the node id: draining evicts everything on it.
      if (!(await confirmAction('drainNode', n.name))) return;
      try {
        await client.drainNode(n.id, deadline.seconds);
        void vscode.window.showInformationMessage(`Node ${n.name} is draining (${deadline.label}).`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Drain node failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.stopDrain', async (item?: { node: NodeSummary }) => {
      if (!client || !item) return;
      if (!(await confirmAction('stopDrain', item.node.name))) return;
      try {
        await client.stopDrain(item.node.id);
        void vscode.window.showInformationMessage(`Drain of ${item.node.name} cancelled.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Stop drain failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.toggleEligibility', async (item?: { node: NodeSummary }) => {
      if (!client || !item) return;
      const n = item.node;
      const makeEligible = n.eligibility === 'ineligible';
      if (n.drain && !makeEligible) {
        void vscode.window.showWarningMessage(`${n.name} is draining: it is already ineligible.`);
        return;
      }
      if (!(await confirmAction(makeEligible ? 'nodeEligible' : 'nodeIneligible', n.name))) return;
      try {
        await client.setNodeEligibility(n.id, makeEligible);
        void vscode.window.showInformationMessage(
          `Node ${n.name} is now ${makeEligible ? 'eligible' : 'ineligible'} for scheduling.`
        );
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Eligibility change failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.resourceUsage', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      const active = client;
      try {
        const [allocs, spec] = await Promise.all([active.allocations(node.job.id), active.job(node.job.id)]);
        const running = allocs.filter((a) => a.clientStatus === 'running');
        if (!running.length) {
          void vscode.window.showInformationMessage(`No running allocation for ${node.job.id}.`);
          return;
        }
        const requests = taskRequests(spec as Parameters<typeof taskRequests>[0]);
        const perAlloc = await mapPool(running, 8, async (a): Promise<TaskUsage[]> => {
          try {
            return parseAllocStats(a.id, await active.allocStats(a.id), requests);
          } catch {
            // The stats endpoint is served by the client node: one unreachable
            // node must not void the whole report.
            return [];
          }
        });
        const md = renderResourceUsage(node.job.id, active.clusterName, perAlloc.flat());
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      } catch (err) {
        void vscode.window.showErrorMessage(`Resource usage failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.explainPlacement', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      try {
        const report = latestPlacementFailures(await client.evaluations(node.job.id));
        const md = renderPlacementReport(node.job.id, report);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      } catch (err) {
        void vscode.window.showErrorMessage(`Placement diagnostics failed — ${err}`);
      }
    }),

    // --- job version history + revert (NOM-14) ---------------------------------

    vscode.commands.registerCommand('nomadLens.jobHistory', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      const active = client;
      try {
        const versions = parseVersions(await active.versions(node.job.id));
        if (!versions.length) {
          void vscode.window.showInformationMessage(`No version history for ${node.job.id}.`);
          return;
        }
        const current = versions[0].version;
        const picked = await vscode.window.showQuickPick(
          versions.map((v) => ({ ...versionPickItem(v, current), v })),
          { placeHolder: `Version history — ${node.job.id} (pick a version to see what it changed)` }
        );
        if (!picked) return;
        const historyDoc = await vscode.workspace.openTextDocument({
          content: renderVersionHistory(node.job.id, versions, current),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(historyDoc, { preview: true });
        if (picked.v.diffToPrevious) {
          showDiffPanel(`${node.job.id} — v${picked.v.version} vs v${picked.v.previousVersion}`, picked.v.diffToPrevious);
        } else {
          void vscode.window.showInformationMessage(`v${picked.v.version} is the oldest version — nothing to diff.`);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Job history failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.revertJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      const active = client;
      let versions;
      try {
        versions = parseVersions(await active.versions(node.job.id));
      } catch (err) {
        void vscode.window.showErrorMessage(`Job history failed — ${err}`);
        return;
      }
      const current = versions[0]?.version;
      const older = versions.slice(1);
      if (!older.length) {
        void vscode.window.showInformationMessage(`${node.job.id} has a single version: nothing to revert to.`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        older.map((v) => ({ ...versionPickItem(v, current), v })),
        { placeHolder: `Revert ${node.job.id} to which version?` }
      );
      if (!picked) return;

      // Preview first: plan that old spec against what is running, so the diff is
      // on screen before the confirmation. Best-effort — a failed plan must not
      // block a revert the user then explicitly confirms.
      try {
        const plan = await active.plan(picked.v.raw);
        const text = [
          `# revert preview — ${node.job.id} → v${picked.v.version} (cluster ${active.clusterName})`,
          `# ${new Date().toISOString()}`,
          '',
          renderPlanDiff(plan),
        ].join('\n');
        const doc = await vscode.workspace.openTextDocument({ content: text, language: 'diff' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      } catch (err) {
        void vscode.window.showWarningMessage(`Revert preview unavailable — ${err}`);
      }

      if (!(await confirmAction('revertJob', node.job.id))) return;
      try {
        await active.revertJob(node.job.id, picked.v.version);
        void vscode.window.showInformationMessage(`Job ${node.job.id} reverted to v${picked.v.version}.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Revert job failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.grepJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      const query = await vscode.window.showInputBox({
        prompt: `Search the logs of every allocation of ${node.job.id}`,
        placeHolder: 'string to search for (case-insensitive)',
      });
      if (!query) return;
      const active = client;
      try {
        const allocs = await active.allocations(node.job.id);
        const targets = allocs.flatMap((a) =>
          a.tasks.flatMap((task) =>
            (['stdout', 'stderr'] as const).map((type) => ({ alloc: a, task, type }))
          )
        );
        if (!targets.length) {
          void vscode.window.showInformationMessage(`No allocation with logs for ${node.job.id}.`);
          return;
        }
        const sources: LogSource[] = await mapPool(targets, 8, async (t) => ({
          alloc: t.alloc.id,
          task: t.task,
          type: t.type,
          text: await active.logsTail(t.alloc.id, t.task, t.type, 65536),
        }));
        const matches = grepLogs(sources, query);
        if (!matches.length) {
          void vscode.window.showInformationMessage(`No match for "${query}" in ${node.job.id}.`);
          return;
        }
        const md = renderGrepReport(node.job.id, query, matches);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Cross-alloc grep failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.compareClusters', async (node?: { job: JobSummary }) => {
      const all = clusters();
      if (all.length < 2) {
        void vscode.window.showWarningMessage('At least two clusters are needed in nomadLens.clusters.');
        return;
      }
      const jobId = node?.job.id ?? (await vscode.window.showInputBox({ prompt: 'Job id to compare across two clusters' }));
      if (!jobId) return;
      const pickA = await vscode.window.showQuickPick(
        all.map((c) => ({ label: c.name, description: c.address, c })),
        { placeHolder: 'Cluster A' }
      );
      if (!pickA) return;
      const pickB = await vscode.window.showQuickPick(
        all.filter((c) => c.name !== pickA.c.name).map((c) => ({ label: c.name, description: c.address, c })),
        { placeHolder: 'Cluster B' }
      );
      if (!pickB) return;
      try {
        const [ja, jb] = await Promise.all([new NomadClient(pickA.c).job(jobId), new NomadClient(pickB.c).job(jobId)]);
        const rows = compareJobSpecs(summarizeJob(ja as unknown as RawJob), summarizeJob(jb as unknown as RawJob));
        const md = renderComparison(jobId, pickA.c.name, pickB.c.name, rows);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      } catch (err) {
        void vscode.window.showErrorMessage(`Compare clusters failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.imageInventory', async () => {
      const all = clusters();
      if (!all.length) {
        void vscode.window.showWarningMessage('No cluster configured (nomadLens.clusters).');
        return;
      }
      try {
        const data = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Nomad Lens: image inventory…' },
          async (): Promise<ClusterInventory[]> => {
            const out: ClusterInventory[] = [];
            for (const c of all) {
              const cl = new NomadClient(c);
              const list = await cl.jobs();
              const jobs = await mapPool(list, 8, async (j) => ({
                id: j.id,
                images: jobImages((await cl.job(j.id)) as unknown as RawJob),
              }));
              out.push({ cluster: c.name, jobs });
            }
            return out;
          }
        );
        const doc = await vscode.workspace.openTextDocument({
          content: renderImageInventory(data),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Image inventory failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.snapshotToFile', async () => {
      if (!client) return;
      const active = client;
      const cfg = vscode.workspace.getConfiguration('nomadLens');
      let target = (cfg.get<string>('snapshotPath', '') ?? '').trim();
      if (target.startsWith('~')) target = path.join(os.homedir(), target.slice(1));
      if (!target) {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('Set nomadLens.snapshotPath (or open a working folder).');
          return;
        }
        target = folder.uri.fsPath;
      }
      try {
        const [jobs, nodes, deployments] = await Promise.all([active.jobs(), active.nodes(), active.deployments()]);
        const md = renderSnapshot(active.clusterName, jobs, nodes, deployments);
        const date = new Date().toISOString().slice(0, 10);
        const file = target.endsWith('.md') ? target : path.join(target, snapshotFileName(active.clusterName, date));
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, md, 'utf8');
        const pick = await vscode.window.showInformationMessage(`Snapshot saved: ${file}`, 'Open');
        if (pick === 'Open') {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Snapshot to file failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.dashboard', async () => {
      if (!client) {
        void vscode.window.showWarningMessage('No cluster configured (nomadLens.clusters).');
        return;
      }
      if (dashPanel) {
        dashPanel.reveal();
        await renderDashboardPanel();
        return;
      }
      dashPanel = vscode.window.createWebviewPanel(
        'nomadLens.dashboard',
        `Nomad: ${client.clusterName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      dashPanel.onDidDispose(() => (dashPanel = undefined), null, context.subscriptions);
      dashPanel.webview.onDidReceiveMessage(
        (m) => {
          const msg = parseDashboardMessage(m);
          if (msg?.type === 'refresh') void renderDashboardPanel();
          else if (msg?.type === 'open') {
            void vscode.commands.executeCommand('nomadLens.jobPanel', { job: { id: msg.jobId } });
            void revealJob(msg.jobId);
          }
        },
        undefined,
        context.subscriptions
      );
      await renderDashboardPanel();
    }),

    vscode.commands.registerCommand('nomadLens.jobPanel', async (node?: { job: JobSummary }) => {
      if (!client) {
        void vscode.window.showWarningMessage('No cluster configured (nomadLens.clusters).');
        return;
      }
      const jobId = node?.job.id ?? (await vscode.window.showInputBox({ prompt: 'Job id' }));
      if (!jobId) return;
      jobPanelId = jobId;
      if (!jobPanel) {
        jobPanel = vscode.window.createWebviewPanel('nomadLens.jobPanel', `Nomad: ${jobId}`, vscode.ViewColumn.Active, {
          enableScripts: true,
          retainContextWhenHidden: true,
        });
        jobPanel.onDidDispose(() => (jobPanel = undefined), null, context.subscriptions);
        jobPanel.webview.onDidReceiveMessage(
          async (m) => {
            if (!client || m?.type !== 'action' || typeof m.command !== 'string' || !isAllowedPanelCommand(m.command)) {
              return;
            }
            if (isAllocPanelCommand(m.command)) {
              const alloc = jobPanelAllocs.find((a) => a.id === m.allocId);
              if (alloc) await vscode.commands.executeCommand(m.command, { alloc });
            } else if (jobPanelId) {
              const job = (await client.jobs()).find((j) => j.id === jobPanelId);
              if (job) await vscode.commands.executeCommand(m.command, { job });
            }
            if (jobPanelId) void renderJobPanelFor(jobPanelId);
          },
          undefined,
          context.subscriptions
        );
      } else {
        jobPanel.reveal();
      }
      await renderJobPanelFor(jobId);
    }),

    vscode.commands.registerCommand('nomadLens.logConsole', async (node?: { alloc: AllocSummary; task: string }) => {
      if (!client || !node) return;
      const active = client;
      const type = (await vscode.window.showQuickPick(['stdout', 'stderr'], {
        placeHolder: `Log console — ${node.task} (alloc ${node.alloc.id.slice(0, 8)})`,
      })) as 'stdout' | 'stderr' | undefined;
      if (!type) return;
      const panel = vscode.window.createWebviewPanel(
        'nomadLens.logConsole',
        `Logs: ${node.alloc.jobId}/${node.task} ${type}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      const tail = await active.logsTail(node.alloc.id, node.task, type, 65536).catch(() => '');
      panel.webview.html = renderLogConsole({
        title: `${node.alloc.jobId}/${node.task} · ${type}`,
        lines: classifyLines(tail),
        nonce: crypto.randomBytes(16).toString('base64'),
        cspSource: panel.webview.cspSource,
      });
      let buf = '';
      const controller = active.followLogs(
        node.alloc.id,
        node.task,
        type,
        (chunk) => {
          buf += chunk;
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          if (parts.length) void panel.webview.postMessage({ type: 'append', lines: parts.map(classifyLine) });
        },
        (err) => {
          if (buf) void panel.webview.postMessage({ type: 'append', lines: [classifyLine(buf)] });
          void panel.webview.postMessage({ type: 'end', error: err?.message });
        }
      );
      panel.onDidDispose(() => controller.abort(), null, context.subscriptions);
    })
  );

  context.subscriptions.push({ dispose: stopAllStreams });

  void maybeFixGoVulncheck();
}

// On activation, fixes the Go extension's broken `go.diagnostic.vulncheck: "Prompt"`
// default (gopls rejects it). Transparent and reversible; the decision is pure in
// core/vulncheck.ts, here there is only the settings I/O.
async function maybeFixGoVulncheck(): Promise<void> {
  const nl = vscode.workspace.getConfiguration('nomadLens');
  const cfg = vscode.workspace.getConfiguration();
  const inspected = cfg.inspect<string>(VULNCHECK_SETTING);

  const decision = decideVulncheckFix({
    goExtensionInstalled: vscode.extensions.getExtension('golang.go') !== undefined,
    autoFixEnabled: nl.get<boolean>('autoFixGoVulncheck', true),
    fixTarget: nl.get<VulncheckFixTarget>('goVulncheckFixValue', 'Off'),
    effectiveValue: cfg.get<string>(VULNCHECK_SETTING),
    workspaceValue: inspected?.workspaceValue,
  });
  if (decision.action !== 'fix') return;

  const target =
    decision.scope === 'workspace'
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

  try {
    await cfg.update(VULNCHECK_SETTING, decision.to, target);
  } catch (err) {
    void vscode.window.showWarningMessage(`Nomad Lens: could not fix ${VULNCHECK_SETTING} — ${err}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Nomad Lens: fixed ${VULNCHECK_SETTING} ("${decision.from}" → "${decision.to}"): gopls rejects "${decision.from}".`,
    'Undo',
    'Stop fixing this'
  );
  if (choice === 'Undo') {
    await cfg.update(VULNCHECK_SETTING, undefined, target);
  } else if (choice === 'Stop fixing this') {
    await nl.update('autoFixGoVulncheck', false, vscode.ConfigurationTarget.Global);
  }
}

// Confirmation of the mutating commands (NOM-3). Destructive → double confirmation;
// stop job → typed confirmation. Never a default button (modals + exact input box).
async function confirmAction(kind: NomadActionKind, target: string): Promise<boolean> {
  const m = ACTIONS[kind];
  const first = await vscode.window.showWarningMessage(confirmMessage(kind, target), { modal: true }, m.verb);
  if (first !== m.verb) return false;
  if (m.requireType) {
    const typed = await vscode.window.showInputBox({
      prompt: `Type "${target}" to confirm`,
      placeHolder: target,
      validateInput: (v) => (v === target ? undefined : 'Does not match'),
    });
    return typed === target;
  }
  if (m.destructive) {
    const ok = 'Yes, proceed';
    const second = await vscode.window.showWarningMessage(
      `Confirm for good? ${confirmMessage(kind, target)}`,
      { modal: true },
      ok
    );
    return second === ok;
  }
  return true;
}

export function deactivate(): void {}
