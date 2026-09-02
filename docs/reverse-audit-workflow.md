# Reverse Audit Agent Workflow

Create knowledge beside a reverse-engineering workspace with
`revkb init --artifact <path>`, or create a centralized Vault Target with
`revkb init <target-id> --artifact <path>`.

1. Start with `revkb context` for the nearest local Target, or
   `revkb context <target-id>` for a centralized Target, and choose one active
   Investigation.
2. Treat Artifact bytes and reproducible runtime behavior as authoritative.
3. Keep hypotheses inside Investigations; do not present them as Knowledge or Findings.
4. Use available static-analysis, dynamic-analysis, and MCP tools without copying verbose raw output into the Vault.
5. Checkpoint after a stable architecture change, a new Lead, an Investigation transition, a Finding decision, a Snapshot change, or before ending the session.
6. Before Checkpoint, correct or delete disproved Knowledge, retain only minimal reproducible Negative Audit Results, and write one concrete next action.
7. Keep `PANORAMA.md` human-readable and update its overall Mermaid architecture when the current model changes.
8. Run `revkb checkpoint` locally, or `revkb checkpoint <target-id>` centrally, and
   resolve hard errors before handing off.

## Exploration discipline

- Temporary reasoning and verbose tool output stay in the working session.
- A new unexplored path becomes a Lead or queued Investigation.
- A supported explanation becomes Knowledge.
- A verified vulnerability becomes a Finding.
- A disproved hypothesis is deleted; retain only a reproducible negative result that prevents repeated work.
- `reviewed` means a declared scope was examined. It never means safe.
