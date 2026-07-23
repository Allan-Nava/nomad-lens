# Nomad Lens — Guida d'uso

Operazioni HashiCorp Nomad dentro VS Code: esplori cluster/job/allocation/task, segui i log in streaming, fai il **diff tra lo spec nel repo e il job running** prima di deployare, esporti un incident bundle con un click e generi uno snapshot del cluster. Zero dipendenze runtime: parla con l'API HTTP di Nomad via `fetch` nativo.

---

## 1. Installazione

- **Marketplace**: cerca "Nomad Lens" (publisher `allannava95`) e installa.
- **Da `.vsix`**: `code --install-extension nomad-lens-<versione>.vsix`, oppure dalla vista Extensions → `…` → *Install from VSIX*.

Dopo l'installazione compare l'icona **Nomad** nella Activity Bar (barra laterale).

## 2. Configurare i cluster

Le impostazioni vivono in `settings.json` (utente o workspace), sotto `nomadLens.clusters`:

```jsonc
"nomadLens.clusters": [
  { "name": "dev",  "address": "http://nomad-dev.example:4646" },
  {
    "name": "prod",
    "address": "https://nomad.example:4646",
    "namespace": "default",
    "tokenEnv": "NOMAD_TOKEN_PROD"   // NOME della env var, non il token
  }
]
```

| Campo       | Obbligatorio | Note |
|-------------|:---:|------|
| `name`      | ✔ | Etichetta mostrata nella status bar e nel picker. |
| `address`   | ✔ | `http(s)://host:4646`. |
| `namespace` |   | Namespace Nomad; aggiunto come query param a ogni chiamata. |
| `tokenEnv`  |   | **Nome** della variabile d'ambiente che contiene il token ACL. |

### Token ACL — regola di sicurezza
Il token **non si mette mai** nelle settings. In `tokenEnv` indichi il *nome* di una env var; l'estensione legge il token da lì a runtime e lo invia come header `X-Nomad-Token`. Il token non viene mai salvato né mostrato.

Assicurati che VS Code veda quella env var (esportala nel profilo shell da cui lanci `code`, o usa un `.env`/launcher del tuo setup). Esempio:

```bash
export NOMAD_TOKEN_PROD="…"   # nel tuo ~/.zshrc, letto prima di avviare VS Code
```

## 3. L'explorer del cluster

Apri il pannello **Nomad**. Vedrai tre sezioni:

- **Jobs** — ogni job con la sua **health reale**. Attenzione: un job `running` con allocazioni mancanti o fallite viene marcato **degraded** (🟠), non "running". Espandendo un job vedi le sue allocation (escluse le `complete`), e dentro ciascuna i task.
- **Nodes** — nodi con stato `ready`/altro e flag `drain`.
- **Deployments** — deployment attivi/recenti con stato e descrizione.

Comandi utili dalla vista:
- **Refresh** (icona ↻ nel titolo) — ricarica.
- **Select Cluster** — cambia cluster attivo (anche dalla status bar in basso, `$(rocket) nomad: <cluster>`). Cambiare cluster ferma tutti gli stream di log aperti.

## 4. Plan diff: repo vs running

Il cuore del workflow "sai cosa cambi prima di deployare".

1. Apri un job spec `.nomad` o `.hcl`.
2. Click destro nell'editor → **Nomad Lens: Plan Current Job File (diff vs running)** (o dal Command Palette).
3. L'estensione manda lo spec a `POST /v1/jobs/parse` (HCL→JSON, `Canonicalize: true`), poi fa il **plan** contro il job running e apre il **diff a fianco** dell'editor.

Legge così:
- `~ campo: vecchio → nuovo` (modificato), `+` (aggiunto), `-` (rimosso), ricorsivo su TaskGroup → Task → Config.
- `Nessuna differenza …` se lo spec coincide col running.
- Evidenzia `⚠ Placement fallito per: …` e i `⚠ Warnings` del plan.

Se il diff contiene più di quanto ti aspettavi, **lo scopri prima** di applicare.

## 5. Log in streaming

- Espandi job → alloc → task e clicca il task (o click destro → **Follow Task Logs**).
- Scegli `stdout` o `stderr`: si apre un Output channel dedicato che **streamma** (non fa polling), con più stream affiancabili.
- **Stop Following Logs** dal Command Palette per fermare uno stream. Gli stream si chiudono anche al cambio cluster e alla disattivazione (nessuna connessione appesa).

## 6. Incident bundle in un click

Su un'allocazione problematica (click destro → **Export Incident Bundle for Allocation**):

- Crea `incidents/<data>-<job>-<alloc>/` nella tua cartella di lavoro con:
  - `report.md` — metadati alloc/nodo/restart, **timeline degli eventi** dei task (timestamp in ISO), elenco dei log allegati, e una sezione *Analisi* da compilare (causa/impatto/remediation).
  - `<task>.stdout.log` / `<task>.stderr.log` — la coda dei log di ogni task.

Il report si apre subito: il tuo incident è già mezzo scritto.

> Serve una cartella aperta in VS Code (workspace folder): è lì che viene salvato il bundle.

## 6b. Azioni con conferma (mutative)

Dal menu contestuale del tree, azioni che **modificano** il cluster — sempre dietro conferma esplicita, mai un default:

- **Restart Allocation** (su un'alloc) — riavvia i task dell'allocazione. Doppia conferma modale.
- **Stop Job** (su un job) — deregistra il job. Conferma **digitando l'id del job** (la più forte).
- **Start Job** (su un job) — rilegge lo spec del job, azzera `Stop` e ri-registra. Conferma singola.

Nessuna di queste ha un pulsante di default: `Invio` non le innesca.

## 7. Snapshot del cluster

**Nomad Lens: Cluster Snapshot Report** genera un markdown di salute:
- riepilogo (job totali/problemi, nodi non-ready/drain, deployment non healthy);
- **problemi in cima** (job degraded/pending/failed, nodi in drain, deploy bloccati);
- tabella completa di tutti i job sotto.

Perfetto per il check del mattino o come baseline preflight prima di un intervento.

## 8. Auto-fix di `go.diagnostic.vulncheck`

Se usi anche la Go extension, il suo default `go.diagnostic.vulncheck: "Prompt"` viene rifiutato da `gopls` (`Invalid settings: … invalid option "Prompt"`). All'avvio Nomad Lens rileva il caso e imposta un valore valido, con notifica e possibilità di annullare.

- `nomadLens.autoFixGoVulncheck` (default `true`) — disattiva l'auto-fix.
- `nomadLens.goVulncheckFixValue` (`"Off"` default | `"Imports"`) — valore da usare; `"Imports"` attiva la scansione vulnerabilità con govulncheck.

## 9. Troubleshooting

| Sintomo | Causa / rimedio |
|---|---|
| "Nessun cluster configurato" | Aggiungi `nomadLens.clusters` nelle settings. |
| `errore: … HTTP 403` nel tree | Token ACL mancante o non valido: verifica che la env var in `tokenEnv` sia esportata **prima** di avviare VS Code. |
| `HTTP 400 Failed to parse job` sul plan | Lo spec HCL non è valido per la versione di Nomad del cluster (es. blocco single-line con più argomenti). |
| Il plan dice "Apri un job spec .nomad/.hcl" | Il file attivo non ha estensione `.nomad`/`.hcl`. |
| Log non partono | L'allocazione non è più sul nodo, o il task non ha ancora prodotto output. |

## 10. Sicurezza in breve

- Token ACL **solo** da env var (`tokenEnv`), mai in settings/log/output.
- I comandi sono **read-only**: l'estensione non fa restart/stop/drain (le azioni mutative, quando arriveranno, richiederanno conferma esplicita).
- Usa `https://` per i cluster remoti: su `http://` il token ACL viaggerebbe in chiaro.
