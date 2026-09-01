# Reverse Audit Knowledge Base Design

## Purpose

Build a small, binary-first knowledge system for vulnerability-oriented reverse engineering. It must let Codex, Claude Code, humans, and future agents continuously improve their understanding of a logical Target without restarting analysis in each session.

The system exists to answer five questions at any time:

1. How does the Target work at an architectural and business-flow level?
2. Which entry points, flows, and modules have been Reviewed?
3. Which discovered branches have not been analyzed?
4. Which Investigation is the best place to continue?
5. Which Snapshot, Artifacts, and Evidence Anchors support the current account?

Vulnerability research remains the primary activity. Knowledge maintenance occurs only at meaningful Checkpoints and must not interrupt every reverse-engineering tool call.

## Governing Principles

### Binary-first truth

Every evidence-backed statement is scoped to a Snapshot containing exact Artifacts identified by SHA-256. APK, DEX, SO, KO, executables, firmware, and other binaries use the same model.

Markdown contains the current best explanation of those bytes and observed runtime behavior. When later evidence disproves an explanation, the explanation is corrected or deleted. The active knowledge base does not preserve an incorrect alternative account.

Git may retain file history for recovery and collaboration, but history is not part of the Agent's default current context.

### Human-first navigation

Each Target has one `PANORAMA.md` landing page. A human begins with the Target-wide architecture and coverage, then follows ordinary wikilinks into a business flow, Investigation, Finding, or Evidence Anchor.

The pages remain useful as plain Markdown. Obsidian enhances navigation but is not required for correctness.

### Agent-first operation

Codex or Claude Code orchestrates reverse-engineering tools such as IDA, Ghidra, debuggers, and MCP servers. The knowledge system is tool-agnostic: it does not directly call or wrap those tools.

Temporary reasoning and verbose tool output remain in the working session. Stable Knowledge, new Leads, active Investigation state, confirmed Findings, and necessary evidence are persisted at a Checkpoint.

### Minimal scope

The first version consists of a Markdown convention and a headless TypeScript CLI with two capabilities: `context` and `checkpoint`. It does not include an Obsidian plugin, graph database, automatic MCP ingestion, automatic binary understanding, or complete Snapshot diffing.

## Domain Model

### Target and Snapshot

A Target is the stable logical unit that owns one Panorama. A Target may span multiple Artifacts and cross their implementation boundaries. For example, one flow may move from an APK entry point through JNI into an SO and then through an ioctl into a KO.

A Snapshot is a named set of exact Artifacts. Snapshots form a parent-child history under the Target so earlier versions remain available for patch comparison and regression research.

The Panorama shows the active Snapshot. Knowledge and Evidence Anchors declare the Snapshot to which they apply. When a new Snapshot becomes active, unchanged Artifact hashes retain their exact identity; pages tied to changed Artifacts require an explicit revalidation decision.

Automatic semantic migration and binary diffing are deferred. The first version records enough hashes and parent relationships to add those capabilities later.

### Knowledge and evidence

Knowledge is mutable current understanding. Evidence Anchors make that understanding reproducible without forcing the Vault to retain complete reverse-engineering output.

An Evidence Anchor may identify:

- an Artifact hash and function, class, symbol, or method;
- a virtual address, file offset, section, or instruction range;
- a static or dynamic call chain;
- a request, response, input, or runtime trace;
- the environment and conditions required to reproduce an observation.

Evidence stays inline where concise. A separate `evidence/` page is created only for material such as long traces, request/response pairs, or selected decompilation excerpts.

### Exploration

A Lead is a discovered branch that has not been selected for active work. An Investigation is a resumable exploration of one question and may contain hypotheses that are explicitly not Knowledge.

An Investigation records only what is useful for continuing the work:

- why the question matters;
- the current hypothesis;
- confirmed observations;
- experiments and their conditions;
- newly discovered Leads;
- blockers;
- the next concrete action;
- relevant Evidence Anchors.

At a Checkpoint:

- supported facts are promoted to Knowledge;
- a confirmed vulnerability becomes a Finding;
- unexamined paths remain Leads;
- an unfinished Investigation retains its resume state;
- disproved hypotheses are deleted;
- a reproducible negative result may be compacted into a minimal Negative Audit Result;
- raw MCP output, duplicate decompilation, and disposable reasoning may be discarded.

### Coverage statuses

Coverage uses the following vocabulary:

- `discovered`: seen but not yet triaged;
- `queued`: selected as worth future analysis;
- `analyzing`: currently under Investigation;
- `reviewed`: examined within an explicitly declared scope;
- `blocked`: unable to proceed because an input, environment, or runtime condition is missing;
- `dismissed`: confirmed irrelevant, duplicate, or unnecessary to pursue;
- `needs-revalidation`: affected by a Snapshot or upstream-knowledge change.

`reviewed` never means safe, exhaustive, or vulnerability-free. Findings are represented separately from coverage.

## Information Architecture

Each Target uses this directory shape:

```text
targets/<target>/
├── PANORAMA.md
├── snapshots/
├── knowledge/
├── investigations/
├── findings/
└── evidence/
```

### Progressive disclosure

Navigation moves from broad to specific:

```text
Workspace overview
└── Target Panorama
    ├── Architecture and business flows
    ├── Coverage and unreviewed branches
    ├── Business-flow detail
    ├── Investigation detail
    ├── confirmed Finding
    └── Evidence Anchor
```

Every detail page starts with its current conclusion or question, status, applicable Snapshot, remaining uncertainty, and relevant next action before presenting deeper evidence.

## Panorama

`PANORAMA.md` is the mandatory human entry point and contains these sections:

```md
# Target name

## Current understanding
## Overall architecture
## Key attack surfaces
## Audit coverage
## Active investigations
## Unreviewed branches
## Confirmed findings
## Snapshots
```

### Overall architecture diagram

The `Overall architecture` section must contain an Agent-maintained Mermaid diagram. It emphasizes business flows, data flows, external entry points, trust boundaries, and major runtime modules. Artifact types and names may annotate nodes, but the diagram must not collapse into a file-dependency graph.

The diagram remains high-level. Function, address, and instruction details live in linked pages. Each meaningful architecture area corresponds to a row in the coverage section. Status must be expressed with text even when color is also used.

When understanding changes, the Agent redraws the current diagram and removes the superseded account.

### Generated regions

The Panorama's prose and architecture diagram are hand-maintained. `checkpoint` may replace only explicit generated regions, such as the coverage table and lists of active Investigations or Findings. Generated regions use recognizable start and end markers. Content outside those markers must remain byte-for-byte unchanged.

## Markdown Format

Pages are ordinary human-readable Markdown with minimal YAML frontmatter. The common fields are:

```yaml
---
kind: investigation
target: yuanbao-android
snapshot: yuanbao-2.82.0
status: analyzing
---
```

Relations use ordinary `[[wikilink]]` syntax. File slugs act as local identifiers; the first version does not add a graph database or universal ID scheme.

### Investigation page

```md
# Question under investigation

## Why it matters
## Current hypothesis
## Confirmed observations
## Experiments
## Newly discovered branches
## Next action
## Evidence
```

### Knowledge page

```md
# Business or architecture topic

## Current conclusion
## Business flow
## Security-relevant behavior
## Remaining unknowns
## Evidence
```

### Snapshot page

```md
# Snapshot name

- Parent Snapshot
- Creation time
- Artifact type, path, and SHA-256
- Known changes relative to the parent
```

### Finding page

A Finding page represents only a confirmed vulnerability or security issue and includes its impact, preconditions, affected Snapshot, reproduction evidence, and related architecture or Investigation pages. A suspected vulnerability remains an Investigation.

## Agent Workflow

### Start or resume

1. Run `revkb context <target>`.
2. Read the active Snapshot, architecture summary, high-risk areas, active Investigations, queued Leads, and recommended next action.
3. Select or resume one Investigation.
4. Use available static and dynamic reverse-engineering tools as needed.

### Event-triggered Checkpoints

The Agent does not update the Vault after every MCP call. It runs a Checkpoint when:

- it forms a stable new architectural understanding;
- it discovers an entry point, business branch, or attack surface;
- an Investigation changes state;
- a vulnerability claim is confirmed, disproved, or materially corrected;
- the active Snapshot or its Artifacts change;
- the Agent is about to end, hand off work, or lose context.

Before invoking `checkpoint`, the Agent edits the Markdown so it states:

- what was confirmed;
- which old Knowledge was corrected or deleted;
- which new Leads were discovered;
- where the active Investigation currently stands;
- the next concrete action;
- which Artifacts and Evidence Anchors support the update.

Short shared instructions describe this workflow. `AGENTS.md` and `CLAUDE.md` may point their respective agents to the same instructions rather than duplicating the rules.

## CLI Design

The first version is TypeScript running on Node.js. It remains one small CLI project rather than a package collection.

```text
src/
├── core/
├── context.ts
├── checkpoint.ts
└── cli.ts
templates/
tests/fixtures/
```

The internal core is independent of terminal input and output so a future Obsidian plugin can reuse it. No plugin interface or plugin package is created until a second adapter actually exists.

### `revkb context <target>`

This read-only command emits a compact Agent context in this order:

1. Target and active Snapshot;
2. current architecture summary;
3. high-risk entry points;
4. active Investigations;
5. unreviewed Leads;
6. confirmed Findings;
7. recommended next actions.

It links to evidence but does not inline large traces or decompilation. The Agent follows links only when the current Investigation needs them.

### `revkb checkpoint <target>`

This command:

1. parses all Target Markdown;
2. performs validation without writing;
3. stops with a nonzero exit code if any hard error exists;
4. computes all generated Panorama sections in memory;
5. writes generated regions atomically only after validation succeeds;
6. reports changes, warnings, and next actions.

Checkpoint does not judge semantic truth, rewrite natural-language conclusions, select reverse-engineering tools, or commit to Git.

## Validation and Failure Behavior

Hard errors cause zero file writes:

- malformed required frontmatter;
- an unknown coverage status;
- a reference to a nonexistent Snapshot;
- an Artifact without SHA-256;
- a broken required wikilink;
- a Finding without confirmation evidence;
- malformed or unmatched generated-region markers.

Warnings do not block generated-region refresh:

- an active Investigation lacks a next action;
- a page remains scoped only to an older Snapshot;
- an architecture area has no coverage entry;
- a `reviewed` entry lacks an Evidence Anchor;
- a new Snapshot exists and related Knowledge has not been marked valid or `needs-revalidation`.

The CLI must report file paths and actionable explanations for every error and warning.

## Testing

The minimum automated test suite covers:

- parsing each supported Markdown page shape;
- allowed and rejected coverage statuses;
- wikilink, Snapshot, and Artifact-hash validation;
- deterministic `context` output from a fixture Target;
- deterministic generated Panorama regions;
- preservation of every hand-maintained byte outside generated markers;
- new-Snapshot revalidation warnings;
- confirmed-Finding evidence requirements;
- zero file writes after any hard validation error;
- atomic replacement behavior for successful Checkpoints.

Tests use small fixture Vaults and golden outputs where the intended human-readable result matters.

## Explicit Non-goals for the First Version

- Obsidian plugin or custom Obsidian views;
- graph database or ontology engine;
- direct integration with IDA, Ghidra, debuggers, or MCP servers;
- automatic import of raw tool output;
- automatic semantic contradiction detection;
- automatic architecture-diagram generation;
- automatic binary diffing or patch-vulnerability detection;
- confidence-scoring systems;
- automatic Git commits;
- preserving disproved hypotheses as active Knowledge.

## Acceptance Criteria

The design is successfully implemented when:

1. A human can open one `PANORAMA.md`, understand the Target's current architecture, see Reviewed and unreviewed areas, and navigate into details.
2. The Panorama contains a mandatory overall business/data-flow Mermaid diagram with Artifact annotations where useful.
3. Codex or Claude Code can run `context` and resume an active Investigation without reading the entire Vault.
4. An Agent can use any available MCP reverse-engineering tools without the knowledge system depending on those tools.
5. `checkpoint` refreshes coverage and activity lists while preserving hand-maintained content.
6. Incorrect Knowledge can be corrected or deleted without retaining it in the current model.
7. Open Leads and unfinished Investigations survive session changes with a concrete next action.
8. Old Snapshots and Artifact hashes remain available for later patch comparison.
9. Validation failures never partially rewrite the Vault.
10. The system remains fully usable as plain Markdown without Obsidian or an Obsidian plugin.
