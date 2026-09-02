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

`npm link` makes the `revkb` command available globally. It is optional: from this
repository you can use `node dist/cli.js`, or invoke that file by absolute path from
another directory. `rg` is useful during reverse engineering, but `revkb` itself does
not require it.

## Quick start: keep knowledge beside a reverse-engineering workspace

```bash
cd /path/to/yuanbao
revkb init --artifact ./yuanbao-release-prod-signed-5040.apk
revkb context
revkb checkpoint
```

`init` creates a complete knowledge base in `.revkb/`. By default, the Target ID is
the workspace directory name (`yuanbao` above), and the Snapshot ID is
`<target-id>-initial`. It calculates each Artifact's SHA-256 without moving, copying,
or modifying the Artifact. The generated Knowledge, Evidence, and Finding directories
are empty; no architecture or vulnerability is invented.

Supply explicit IDs or multiple Artifacts when needed:

```bash
revkb init \
  --target yuanbao \
  --snapshot yuanbao-5040 \
  --artifact ./yuanbao-release-prod-signed-5040.apk \
  --artifact ./lib/arm64-v8a/libexample.so
```

From the workspace root or any descendant directory, `revkb context` and
`revkb checkpoint` search upward for the nearest `.revkb/PANORAMA.md`. You do not
need to repeat the Target ID. Initialization refuses to overwrite an existing
`.revkb/` and refuses to create a nested Target while already inside one.

Run `revkb --help` (or `revkb <command> --help`) for the complete syntax.

## Centralized multi-Target Vault

The original `targets/<target-id>/` layout remains supported. A positional Target ID
selects this mode:

```bash
cd /path/to/reverse-audit-vault
revkb init yuanbao \
  --snapshot yuanbao-5040 \
  --artifact ./yuanbao-release-prod-signed-5040.apk
revkb context yuanbao
revkb checkpoint yuanbao
```

This creates `targets/yuanbao/`. Existing `context <target-id>` and
`checkpoint <target-id>` commands keep the same behavior, and initialization refuses
to overwrite an existing Target.

## Target layout

Local and centralized Targets use the same Markdown structure:

```text
<target-root>/
├── PANORAMA.md
├── snapshots/
├── knowledge/
├── investigations/
├── findings/
└── evidence/
```

`PANORAMA.md` is the human entry point. Its Mermaid diagram shows the overall business/data flow and trust boundaries; linked pages provide progressively deeper detail.

### Required page contracts

- `PANORAMA.md` keeps the required overview sections, a Mermaid diagram under `Overall architecture`, and one `%% revkb-area: [[knowledge/...]]` marker for each coverage area.
- A Snapshot declares an ISO-8601 `created` value, an optional parent Snapshot, a `Type | Path | SHA-256` Artifact table, and `Known changes`.
- A confirmed Finding includes `Impact`, `Preconditions`, `Related`, and `Evidence`; `Related` links to Knowledge or an Investigation.
- Every open Investigation or Lead records a concrete `Next action`.

Snapshot Artifact rows require exactly three nonempty fields. SHA-256 values are 64 hexadecimal characters.

## Agent context

```bash
revkb context              # nearest local .revkb Target
revkb context my-target    # centralized targets/my-target
```

The command prints the active Snapshot, current architecture, human-maintained high-risk attack surfaces, audit coverage, active Investigations, unreviewed Leads, confirmed Findings, recommended next actions, and warnings. It intentionally omits verbose evidence bodies.

## Checkpoint

```bash
revkb checkpoint              # nearest local .revkb Target
revkb checkpoint my-target    # centralized targets/my-target
```

Checkpoint validates the Target and refreshes only these marked regions in `PANORAMA.md`:

- audit coverage
- active Investigations
- unreviewed Leads
- confirmed Findings

Everything outside the markers, including the overall Mermaid architecture and human prose, is preserved. A hard validation error causes zero file writes. Warnings do not block the refresh. After validation, Checkpoint reports the change result, warnings, and concrete next actions.

Run Checkpoint after meaningful discoveries and before ending or handing off an analysis session—not after every reverse-engineering tool call.

## Manual template fallback

`templates/target/` remains a worked example for readers who deliberately want to
assemble a Target by hand. Copy it to `.revkb/` or `targets/<target-id>/`, then replace
every example Target ID, Snapshot ID, timestamp, hash, and illustrative claim before
using it. In particular, delete the example Finding unless it is independently
confirmed for the real Target. For normal setup, prefer `revkb init`.

## Obsidian and MCP tools

Obsidian is an optional human view over the same Markdown. IDA, Ghidra, debugger, and MCP tools remain independent evidence sources orchestrated by Codex, Claude Code, or another Agent. `revkb` does not depend on or directly call them.

`reviewed` records coverage of a declared scope. It never means the area is safe or free of vulnerabilities.
