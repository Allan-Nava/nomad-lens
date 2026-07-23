// Unit tests (pure renderers) + integration test against a throwaway local
// `nomad agent -dev` (skipped when the binary is not available).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { NomadClient, JobSummary, PlanResult } from '../src/core/api';
import { renderSnapshot, renderPlanDiff, buildIncidentBundle, jobHealth } from '../src/core/report';

let failures = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((err) => {
      failures++;
      console.error(`FAIL ${name}\n     ${err}`);
    });
}

async function main(): Promise<void> {
  // --- unit: renderers ---------------------------------------------------------
  const jobs: JobSummary[] = [
    { id: 'transcoder', name: 'transcoder', type: 'service', status: 'running', running: 3, desired: 3, failed: 0 },
    { id: 'packager', name: 'packager', type: 'service', status: 'running', running: 2, desired: 3, failed: 1 },
    { id: 'cleanup', name: 'cleanup', type: 'batch', status: 'dead', running: 0, desired: 0, failed: 0 },
  ];

  await test('jobHealth: running-but-incomplete is degraded', () => {
    assert.strictEqual(jobHealth(jobs[0]), 'running');
    assert.strictEqual(jobHealth(jobs[1]), 'degraded');
    assert.strictEqual(jobHealth(jobs[2]), 'dead');
  });

  await test('snapshot: problems section lists only unhealthy jobs', () => {
    const md = renderSnapshot(
      'test-cluster',
      jobs,
      [
        { id: 'n1', name: 'worker-01', status: 'ready', drain: false },
        { id: 'n2', name: 'worker-02', status: 'ready', drain: true },
      ],
      [{ id: 'd1', jobId: 'packager', status: 'running', description: 'canary in corso' }]
    );
    const problemsSection = md.split('## ⚠ Da guardare')[1].split('## Tutti i job')[0];
    assert.ok(problemsSection.includes('| packager |'), 'packager should be flagged');
    assert.ok(!problemsSection.includes('| transcoder |'), 'transcoder healthy, not in problems');
    assert.ok(md.includes('worker-02'), 'drain node listed');
    assert.ok(md.includes('canary in corso'));
  });

  await test('plan diff: rendered fields and no-change case', () => {
    const plan: PlanResult = {
      Diff: {
        Type: 'Edited',
        Name: 'demo',
        Fields: null,
        Objects: null,
        TaskGroups: [
          {
            Type: 'Edited',
            Name: 'web',
            Fields: [{ Type: 'Edited', Name: 'Count', Old: '2', New: '3' }],
            Objects: null,
            Tasks: [
              {
                Type: 'Edited',
                Name: 'app',
                Fields: null,
                Objects: [
                  {
                    Type: 'Edited',
                    Name: 'Config',
                    Fields: [{ Type: 'Edited', Name: 'image', Old: 'nginx:1.25', New: 'nginx:1.27' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const text = renderPlanDiff(plan);
    assert.ok(text.includes('Count'), 'count change shown');
    assert.ok(text.includes('nginx:1.27'), 'image change shown');
    assert.ok(renderPlanDiff({}).includes('Nessuna differenza'));
  });

  await test('incident bundle: markdown + log files', () => {
    const bundle = buildIncidentBundle({
      cluster: 'test',
      alloc: {
        id: 'abcdef1234567890',
        name: 'packager.web[0]',
        jobId: 'packager',
        taskGroup: 'web',
        clientStatus: 'failed',
        nodeName: 'worker-02',
        tasks: ['app'],
        restarts: 4,
      },
      allocRaw: {
        TaskStates: {
          app: {
            State: 'dead',
            Failed: true,
            Events: [
              { Type: 'Started', Time: 1786000000000000000, DisplayMessage: 'Task started' },
              { Type: 'Terminated', Time: 1786000100000000000, DisplayMessage: 'OOM killed' },
            ],
          },
        },
      },
      logs: { app: { stdout: 'hello\n', stderr: 'boom\n' } },
    });
    assert.ok(bundle.dirName.includes('packager-abcdef12'));
    assert.ok(bundle.markdown.includes('OOM killed'));
    assert.ok(bundle.markdown.includes('restarts: 4'));
    assert.strictEqual(bundle.files.length, 2);
    assert.ok(bundle.files.some((f) => f.name === 'app.stderr.log' && f.content === 'boom\n'));
  });

  // --- integration: throwaway nomad agent -dev ----------------------------------
  const bin = process.env.NOMAD_BIN || 'nomad';
  const port = 44000 + Math.floor(Math.random() * 1000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomadlens-'));
  let server: ChildProcess | null = null;

  const HCL = `
job "lens-demo" {
  datacenters = ["dc1"]
  type = "service"
  group "web" {
    count = 2
    task "app" {
      driver = "docker"
      config {
        image = "nginx:1.25"
      }
      resources {
        cpu    = 100
        memory = 64
      }
    }
  }
}
`;

  try {
    if (spawnSync(bin, ['version'], { stdio: 'ignore' }).error) {
      throw new Error(`binario '${bin}' non disponibile`);
    }
    fs.writeFileSync(path.join(tmp, 'config.hcl'), `ports { http = ${port} }\n`);
    server = spawn(bin, ['agent', '-dev', `-config=${path.join(tmp, 'config.hcl')}`], { stdio: 'ignore' });
    server.on('error', () => {});

    const client = new NomadClient({ name: 'dev', address: `http://127.0.0.1:${port}` });
    let up = false;
    for (let i = 0; i < 100; i++) {
      try {
        await client.nodes();
        up = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!up) throw new Error('nomad agent -dev did not start');

    await test('integration: parse HCL + register + list jobs', async () => {
      const job = await client.parseHcl(HCL);
      assert.strictEqual((job as { ID?: string }).ID, 'lens-demo');
      await client.registerJob(job);
      for (let i = 0; i < 20; i++) {
        const list = await client.jobs();
        if (list.some((j) => j.id === 'lens-demo')) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.fail('lens-demo not in job list');
    });

    await test('integration: plan shows diff for modified spec', async () => {
      const modified = await client.parseHcl(HCL.replace('count = 2', 'count = 3').replace('nginx:1.25', 'nginx:1.27'));
      const plan = await client.plan(modified);
      const text = renderPlanDiff(plan);
      assert.ok(text.includes('Count') || text.includes('count'), `diff should mention count:\n${text}`);
      assert.ok(text.includes('nginx:1.27'), `diff should mention new image:\n${text}`);
    });

    await test('integration: plan with identical spec has no diff', async () => {
      const same = await client.parseHcl(HCL);
      const plan = await client.plan(same);
      assert.ok(renderPlanDiff(plan).includes('Nessuna differenza'));
    });

    await test('integration: allocations listing does not throw', async () => {
      const allocs = await client.allocations('lens-demo');
      assert.ok(Array.isArray(allocs));
    });
  } catch (err) {
    console.log(`skip integration tests (${err})`);
  } finally {
    server?.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} test failed`);
    process.exit(1);
  }
  console.log('\nall tests passed');
}

void main();
