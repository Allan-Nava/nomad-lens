import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ClusterConfig, NomadClient, JobSummary, AllocSummary, tokenSentInClear, mapPool } from './core/api';
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
import { renderSnapshot, renderPlanDiff, buildIncidentBundle, jobHealth, allocWarnings, snapshotFileName } from './core/report';
import { decideVulncheckFix, VULNCHECK_SETTING, VulncheckFixTarget } from './core/vulncheck';
import { ACTIONS, NomadActionKind, confirmMessage } from './core/actions';
import { deployStatus, deployStatusBar, deployNotification, isDeployStalled } from './core/deploy';

type Node =
  | { kind: 'section'; label: 'Jobs' | 'Nodes' | 'Deployments' }
  | { kind: 'job'; job: JobSummary }
  | { kind: 'alloc'; alloc: AllocSummary }
  | { kind: 'task'; alloc: AllocSummary; task: string }
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

  constructor(private getClient: () => NomadClient | null) {}

  refresh(): void {
    this.emitter.fire(undefined);
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
        return item;
      }
      case 'job': {
        const health = jobHealth(node.job);
        const item = new vscode.TreeItem(node.job.id, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${health} · ${node.job.running}/${node.job.desired} alloc${node.job.failed ? ` · ${node.job.failed} failed` : ''}`;
        item.iconPath = new vscode.ThemeIcon(HEALTH_ICON[health] ?? 'question');
        item.contextValue = 'job';
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
      case 'leaf': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        if (node.iconId) item.iconPath = new vscode.ThemeIcon(node.iconId);
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const client = this.getClient();
    if (!client) return [{ kind: 'leaf', label: 'Nessun cluster configurato (nomadLens.clusters)', iconId: 'gear' }];
    try {
      if (!node) {
        return [
          { kind: 'section', label: 'Jobs' },
          { kind: 'section', label: 'Nodes' },
          { kind: 'section', label: 'Deployments' },
        ];
      }
      if (node.kind === 'section' && node.label === 'Jobs') {
        const jobs = await client.jobs();
        return jobs
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((job) => ({ kind: 'job' as const, job }));
      }
      if (node.kind === 'section' && node.label === 'Nodes') {
        const nodes = await client.nodes();
        return nodes.map((n) => ({
          kind: 'leaf' as const,
          label: `${n.name} — ${n.status}${n.drain ? ' (drain)' : ''}`,
          iconId: n.status === 'ready' && !n.drain ? 'pass-filled' : 'error',
        }));
      }
      if (node.kind === 'section' && node.label === 'Deployments') {
        const deps = await client.deployments();
        if (!deps.length) return [{ kind: 'leaf', label: '(nessun deployment)', iconId: 'dash' }];
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
      return [{ kind: 'leaf', label: `errore: ${err}`, iconId: 'error' }];
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

  // Avvisa (una volta per cluster) se un token ACL verrebbe inviato in chiaro su http://.
  const warnedInsecure = new Set<string>();
  const warnIfInsecureToken = (cfg: ClusterConfig) => {
    const tokenPresent = !!(cfg.tokenEnv && process.env[cfg.tokenEnv]);
    if (tokenSentInClear(cfg.address, tokenPresent) && !warnedInsecure.has(cfg.name)) {
      warnedInsecure.add(cfg.name);
      void vscode.window.showWarningMessage(
        `Nomad Lens: il token ACL del cluster "${cfg.name}" verrebbe inviato in chiaro su ${cfg.address}. Usa https://.`
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
  context.subscriptions.push(vscode.window.registerTreeDataProvider('nomadLens.explorer', tree), status);

  const stopAllStreams = () => {
    for (const [, s] of logStreams) s.controller.abort();
    logStreams.clear();
  };

  // --- Deployment watch (NOM-2): progress in status bar + notifiche ------------
  const deployBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 87);
  context.subscriptions.push(deployBar);
  const deployState = new Map<string, { status: string; healthy: number; since: number; warnedStall: boolean }>();

  const pollDeployments = async () => {
    const cfg = vscode.workspace.getConfiguration('nomadLens');
    if (!client || !cfg.get<boolean>('deploymentWatch', true)) {
      deployBar.hide();
      return;
    }
    let deps;
    try {
      deps = await client.deployments();
    } catch {
      return; // transitorio: riprova al prossimo tick
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
        `Deploy ${active.jobId} sembra bloccato: healthy ${active.healthy}/${active.desired} da ~${Math.round((now - st.since) / 1000)}s`
      );
    }
  };

  const pollSec = Math.max(2, vscode.workspace.getConfiguration('nomadLens').get<number>('deploymentPollSeconds', 5));
  const deployTimer = setInterval(() => void pollDeployments(), pollSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(deployTimer) });
  void pollDeployments();

  context.subscriptions.push(
    vscode.commands.registerCommand('nomadLens.refresh', () => tree.refresh()),

    vscode.commands.registerCommand('nomadLens.selectCluster', async () => {
      const all = clusters();
      const picked = await vscode.window.showQuickPick(
        all.map((c) => ({ label: c.name, description: c.address, c })),
        { placeHolder: 'Cluster Nomad' }
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
    }),

    vscode.commands.registerCommand('nomadLens.followLogs', async (node?: { alloc: AllocSummary; task: string }) => {
      if (!client || !node) return;
      const type = (await vscode.window.showQuickPick(['stdout', 'stderr'], {
        placeHolder: `Log di ${node.task} (alloc ${node.alloc.id.slice(0, 8)})`,
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
      const key = await vscode.window.showQuickPick([...logStreams.keys()], { placeHolder: 'Stream da fermare' });
      if (!key) return;
      logStreams.get(key)?.controller.abort();
      logStreams.delete(key);
    }),

    vscode.commands.registerCommand('nomadLens.planFile', async () => {
      if (!client) return;
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !/\.(nomad|hcl)$/.test(doc.fileName)) {
        void vscode.window.showWarningMessage('Apri un job spec .nomad/.hcl prima di lanciare il plan.');
        return;
      }
      try {
        const job = await client.parseHcl(doc.getText());
        const plan = await client.plan(job);
        const text = [
          `# nomad plan — ${path.basename(doc.fileName)} vs cluster ${client.clusterName}`,
          `# ${new Date().toISOString()}`,
          '',
          renderPlanDiff(plan),
        ].join('\n');
        const planDoc = await vscode.workspace.openTextDocument({ content: text, language: 'diff' });
        await vscode.window.showTextDocument(planDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      } catch (err) {
        void vscode.window.showErrorMessage(`nomad plan fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.incidentBundle', async (node?: { alloc: AllocSummary }) => {
      if (!client || !node) return;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Apri una cartella di lavoro dove salvare il bundle.');
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
        void vscode.window.showErrorMessage(`Incident bundle fallito — ${err}`);
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
        void vscode.window.showErrorMessage(`Snapshot fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.restartAlloc', async (node?: { alloc: AllocSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('restartAlloc', node.alloc.id.slice(0, 8)))) return;
      try {
        await client.restartAllocation(node.alloc.id);
        void vscode.window.showInformationMessage(`Allocation ${node.alloc.id.slice(0, 8)} riavviata.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Restart allocation fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.stopJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('stopJob', node.job.id))) return;
      try {
        await client.stopJob(node.job.id);
        void vscode.window.showInformationMessage(`Job ${node.job.id} fermato.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Stop job fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.startJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      if (!(await confirmAction('startJob', node.job.id))) return;
      try {
        await client.startJob(node.job.id);
        void vscode.window.showInformationMessage(`Job ${node.job.id} riavviato.`);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(`Start job fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.grepJob', async (node?: { job: JobSummary }) => {
      if (!client || !node) return;
      const query = await vscode.window.showInputBox({
        prompt: `Cerca nei log di tutte le allocation di ${node.job.id}`,
        placeHolder: 'stringa da cercare (case-insensitive)',
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
          void vscode.window.showInformationMessage(`Nessuna allocation con log per ${node.job.id}.`);
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
          void vscode.window.showInformationMessage(`Nessun match per "${query}" in ${node.job.id}.`);
          return;
        }
        const md = renderGrepReport(node.job.id, query, matches);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Grep cross-alloc fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.compareClusters', async (node?: { job: JobSummary }) => {
      const all = clusters();
      if (all.length < 2) {
        void vscode.window.showWarningMessage('Servono almeno due cluster in nomadLens.clusters.');
        return;
      }
      const jobId = node?.job.id ?? (await vscode.window.showInputBox({ prompt: 'Job id da confrontare tra due cluster' }));
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
        void vscode.window.showErrorMessage(`Compare clusters fallito — ${err}`);
      }
    }),

    vscode.commands.registerCommand('nomadLens.imageInventory', async () => {
      const all = clusters();
      if (!all.length) {
        void vscode.window.showWarningMessage('Nessun cluster configurato (nomadLens.clusters).');
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
        void vscode.window.showErrorMessage(`Image inventory fallito — ${err}`);
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
          void vscode.window.showWarningMessage('Imposta nomadLens.snapshotPath (o apri una cartella di lavoro).');
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
        const pick = await vscode.window.showInformationMessage(`Snapshot salvato: ${file}`, 'Apri');
        if (pick === 'Apri') {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Snapshot su file fallito — ${err}`);
      }
    })
  );

  context.subscriptions.push({ dispose: stopAllStreams });

  void maybeFixGoVulncheck();
}

// All'attivazione, corregge il default rotto `go.diagnostic.vulncheck: "Prompt"`
// della Go extension (gopls lo rifiuta). Trasparente e reversibile; la decisione
// e' pura in core/vulncheck.ts, qui c'e' solo l'I/O sulle settings.
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
    void vscode.window.showWarningMessage(`Nomad Lens: impossibile correggere ${VULNCHECK_SETTING} — ${err}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Nomad Lens: corretto ${VULNCHECK_SETTING} ("${decision.from}" → "${decision.to}"): gopls rifiuta "${decision.from}".`,
    'Annulla',
    'Non correggere più'
  );
  if (choice === 'Annulla') {
    await cfg.update(VULNCHECK_SETTING, undefined, target);
  } else if (choice === 'Non correggere più') {
    await nl.update('autoFixGoVulncheck', false, vscode.ConfigurationTarget.Global);
  }
}

// Conferma dei comandi mutativi (NOM-3). Distruttivi → doppia conferma; stop job
// → conferma digitata. Mai un bottone di default (modali + input box esatto).
async function confirmAction(kind: NomadActionKind, target: string): Promise<boolean> {
  const m = ACTIONS[kind];
  const first = await vscode.window.showWarningMessage(confirmMessage(kind, target), { modal: true }, m.verb);
  if (first !== m.verb) return false;
  if (m.requireType) {
    const typed = await vscode.window.showInputBox({
      prompt: `Digita "${target}" per confermare`,
      placeHolder: target,
      validateInput: (v) => (v === target ? undefined : 'Non combacia'),
    });
    return typed === target;
  }
  if (m.destructive) {
    const ok = 'Sì, procedi';
    const second = await vscode.window.showWarningMessage(
      `Confermi definitivamente? ${confirmMessage(kind, target)}`,
      { modal: true },
      ok
    );
    return second === ok;
  }
  return true;
}

export function deactivate(): void {}
