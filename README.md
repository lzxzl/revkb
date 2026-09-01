# revkb

`revkb` is a small, binary-first Markdown knowledge base for vulnerability-oriented reverse engineering. It helps humans and AI agents answer:

1. How does this Target work?
2. Which areas have been Reviewed?
3. Which discovered branches remain unexplored?
4. Which Investigation should continue next?
5. Which Snapshot, Artifacts, and Evidence Anchors support the current account?

The current Markdown is a living model, not an append-only research log. Correct or delete explanations that later binary evidence disproves.

## Requirements and installation

- Node.js 22 or newer
- npm

```bash
npm install
npm run build
npm link
```

`npm link` is optional; without it, run `node dist/cli.js` in place of `revkb`.

## Create a Target

```bash
mkdir -p targets
cp -R templates/target targets/my-target
```

Replace `example-target`, `example-v1`, the example Artifact hash, and the illustrative content before the first Checkpoint. Delete the example Finding unless it represents a confirmed vulnerability in the real Target.

Each Target uses:

```text
targets/<target-id>/
├── PANORAMA.md
├── snapshots/
├── knowledge/
├── investigations/
├── findings/
└── evidence/
```

`PANORAMA.md` is the human entry point. Its Mermaid diagram shows the overall business/data flow and trust boundaries; linked pages provide progressively deeper detail.

## Agent context

```bash
revkb context my-target
```

The command prints the active Snapshot, current architecture, coverage areas, active Investigations, unreviewed Leads, confirmed Findings, warnings, and concrete next actions. It intentionally omits verbose evidence bodies.

## Checkpoint

```bash
revkb checkpoint my-target
```

Checkpoint validates the Target and refreshes only these marked regions in `PANORAMA.md`:

- audit coverage
- active Investigations
- unreviewed Leads
- confirmed Findings

Everything outside the markers, including the overall Mermaid architecture and human prose, is preserved. A hard validation error causes zero file writes.

Run Checkpoint after meaningful discoveries and before ending or handing off an analysis session—not after every reverse-engineering tool call.

## Obsidian and MCP tools

Obsidian is an optional human view over the same Markdown. IDA, Ghidra, debugger, and MCP tools remain independent evidence sources orchestrated by Codex, Claude Code, or another Agent. `revkb` does not depend on or directly call them.

`reviewed` records coverage of a declared scope. It never means the area is safe or free of vulnerabilities.
