#!/usr/bin/env node
// Backlog -> GitHub milestones + issues sync.
// BACKLOG.md e' la sorgente unica (vedi CLAUDE.md): questo script rende
// GitHub un mirror di sola lettura del file, mai il contrario.
//
// Mappatura:
//   "## v0.2 — Daily driver"           -> milestone (title = testo heading)
//   "- [ ] **NOM-1 — Titolo**: corpo"  -> issue (label `backlog`, milestone = sezione)
//   "- [x] ..."                        -> issue chiusa (state_reason: completed)
//
// Ogni issue e' ancorata al suo id stabile via marker nel body
// `<!-- backlog:NOM-1 -->`, cosi' il matching non dipende dal titolo.
// Idempotente: creare/aggiornare/chiudere solo cio' che diverge.
//
// Env:
//   GITHUB_TOKEN       (richiesto)  token con permessi issues:write
//   GITHUB_REPOSITORY  (richiesto)  "owner/repo" (fornito da Actions)
//   BACKLOG_FILE       (opz.)       default "BACKLOG.md"
//   DRY_RUN            (opz.)       se valorizzato: nessuna scrittura, solo log

import { readFileSync } from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const FILE = process.env.BACKLOG_FILE || "BACKLOG.md";
const DRY_RUN = !!process.env.DRY_RUN;
const LABEL = "backlog";

if (!TOKEN) fail("GITHUB_TOKEN mancante");
if (!REPO || !REPO.includes("/")) fail("GITHUB_REPOSITORY mancante o malformato");

const [OWNER, NAME] = REPO.split("/");
const API = "https://api.github.com";

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function gh(method, path, body) {
  if (DRY_RUN && method !== "GET") {
    console.log(`  [dry-run] ${method} ${path}${body ? " " + JSON.stringify(body) : ""}`);
    return { __dryRun: true };
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "nomad-lens-backlog-sync",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    fail(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.status === 204 ? {} : res.json();
}

async function ghPaged(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await gh("GET", `${path}${sep}per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// --- Parsing di BACKLOG.md ------------------------------------------------

function parseBacklog(md) {
  const sections = []; // { title, items: [...] }
  let current = null;
  const itemRe = /^- \[([ xX])\]\s+\*\*(NOM-\d+)\s*[—-]\s*(.+?)\*\*\s*:?\s*(.*)$/;

  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      current = { title: h2[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const m = line.match(itemRe);
    if (m && current) {
      current.items.push({
        done: m[1].toLowerCase() === "x",
        id: m[2],
        title: m[3].trim(),
        desc: m[4].trim(),
        milestone: current.title,
      });
    }
  }
  // Solo sezioni con almeno un item NOM-n diventano milestone.
  return sections.filter((s) => s.items.length > 0);
}

// --- Sync -----------------------------------------------------------------

async function ensureLabel() {
  const existing = await gh("GET", `/repos/${OWNER}/${NAME}/labels/${LABEL}`);
  if (existing) return;
  console.log(`+ label "${LABEL}"`);
  await gh("POST", `/repos/${OWNER}/${NAME}/labels`, {
    name: LABEL,
    color: "0e8a16",
    description: "Voce tracciata da BACKLOG.md (sync automatico)",
  });
}

async function syncMilestones(sections) {
  const existing = await ghPaged(`/repos/${OWNER}/${NAME}/milestones?state=all`);
  const byTitle = new Map(existing.map((m) => [m.title, m]));
  const result = new Map(); // title -> milestone number

  for (const s of sections) {
    const allDone = s.items.every((i) => i.done);
    const wantState = allDone ? "closed" : "open";
    let ms = byTitle.get(s.title);
    if (!ms) {
      console.log(`+ milestone "${s.title}" (${wantState})`);
      ms = await gh("POST", `/repos/${OWNER}/${NAME}/milestones`, {
        title: s.title,
        state: wantState,
      });
    } else if (ms.state !== wantState && !DRY_RUN) {
      console.log(`~ milestone "${s.title}" -> ${wantState}`);
      ms = await gh("PATCH", `/repos/${OWNER}/${NAME}/milestones/${ms.number}`, {
        state: wantState,
      });
    }
    result.set(s.title, ms.number ?? (ms.__dryRun ? -1 : ms.number));
  }
  return result;
}

function marker(id) {
  return `<!-- backlog:${id} -->`;
}

function issueBody(item) {
  const lines = [];
  if (item.desc) lines.push(item.desc, "");
  lines.push(marker(item.id));
  lines.push("", "_Gestita da BACKLOG.md — non modificare a mano; le modifiche vanno nel file._");
  return lines.join("\n");
}

function issueTitle(item) {
  return `${item.id} — ${item.title}`;
}

async function syncIssues(items, milestoneByTitle) {
  const existing = await ghPaged(`/repos/${OWNER}/${NAME}/issues?state=all&labels=${LABEL}`);
  // Escludi le PR (l'endpoint issues le include).
  const issues = existing.filter((i) => !i.pull_request);
  const byId = new Map();
  for (const it of issues) {
    const m = (it.body || "").match(/<!-- backlog:(NOM-\d+) -->/);
    if (m) byId.set(m[1], it);
  }

  for (const item of items) {
    const wantTitle = issueTitle(item);
    const wantBody = issueBody(item);
    const wantState = item.done ? "closed" : "open";
    const msNumber = milestoneByTitle.get(item.milestone);
    const found = byId.get(item.id);

    if (!found) {
      console.log(`+ issue ${item.id} "${item.title}" (${wantState})`);
      const created = await gh("POST", `/repos/${OWNER}/${NAME}/issues`, {
        title: wantTitle,
        body: wantBody,
        labels: [LABEL],
        milestone: msNumber > 0 ? msNumber : undefined,
      });
      // Le issue nascono aperte: se l'item e' gia' spuntato, chiudila.
      if (item.done && created && created.number) {
        await gh("PATCH", `/repos/${OWNER}/${NAME}/issues/${created.number}`, {
          state: "closed",
          state_reason: "completed",
        });
      }
      continue;
    }

    const patch = {};
    if (found.title !== wantTitle) patch.title = wantTitle;
    if ((found.body || "") !== wantBody) patch.body = wantBody;
    if (found.state !== wantState) {
      patch.state = wantState;
      if (wantState === "closed") patch.state_reason = "completed";
    }
    const foundMs = found.milestone ? found.milestone.number : null;
    if (msNumber > 0 && foundMs !== msNumber) patch.milestone = msNumber;

    if (Object.keys(patch).length === 0) continue;
    console.log(`~ issue ${item.id} #${found.number} ${Object.keys(patch).join(",")}`);
    await gh("PATCH", `/repos/${OWNER}/${NAME}/issues/${found.number}`, patch);
  }

  // Item rimossi dal file ma ancora aperti su GitHub: segnalali (non chiudere:
  // la chiusura implicita e' pericolosa, meglio un avviso).
  const fileIds = new Set(items.map((i) => i.id));
  for (const [id, it] of byId) {
    if (!fileIds.has(id) && it.state === "open") {
      console.log(`! issue ${id} #${it.number} aperta ma assente da ${FILE} (chiudi a mano o ripristina la voce)`);
    }
  }
}

async function main() {
  const md = readFileSync(FILE, "utf8");
  const sections = parseBacklog(md);
  const items = sections.flatMap((s) => s.items);
  console.log(`${FILE}: ${sections.length} milestone, ${items.length} voci${DRY_RUN ? " (dry-run)" : ""}`);

  const dupes = items
    .map((i) => i.id)
    .filter((id, idx, arr) => arr.indexOf(id) !== idx);
  if (dupes.length) fail(`Id duplicati in ${FILE}: ${[...new Set(dupes)].join(", ")}`);

  await ensureLabel();
  const milestoneByTitle = await syncMilestones(sections);
  await syncIssues(items, milestoneByTitle);
  console.log("✓ sync completato");
}

main().catch((e) => fail(e.stack || String(e)));
