# Changelog

## 0.1.0

- Cluster explorer: job con health reale (running incompleto = degraded), allocation con restart count, task, nodi, deployment.
- Plan diff repo-vs-running: parse HCL server-side + plan con diff renderizzato accanto all'editor.
- Log follow in streaming (stdout/stderr) in Output channel dedicati.
- Incident bundle: `incidents/<data>-<job>-<alloc>/` con report.md (timeline eventi) + log allegati.
- Cluster snapshot report in markdown (problemi in cima, tabella completa).
- Multi-cluster da settings; token ACL solo da env var, mai visualizzati.
