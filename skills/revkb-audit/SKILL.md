---
name: revkb-audit
description: Use when working on authorized APK, firmware, native-binary, or application reverse engineering, when the workspace contains .revkb, or when the user asks to initialize, resume, record, checkpoint, or hand off an audit with revkb.
---

# revkb Audit

Use revkb as durable state. Artifact bytes and reproducible behavior are
authoritative; the Vault is an evidence-backed model, not a log.

## Resume before analyzing

1. Prefer `revkb`. If unavailable and this skill is in a revkb checkout containing
   `dist/cli.js`, use `node <checkout>/dist/cli.js`. Otherwise report the
   build/install blocker; never claim a command succeeded.
2. Select exactly one location mode before running a state command:
   - **Centralized:** only when the user explicitly selected a
     `targets/<target-id>` Vault. Resume with `revkb context <target-id>`. If the
     user instead asked to create that centralized Target, run
     `revkb init <target-id> --artifact <path>`, then the ID-bearing context command.
     Do not probe or initialize a local Target.
   - **Local (default):** run `revkb context` from the current directory before the
     first analysis command. It searches upward for the nearest
     `.revkb/PANORAMA.md`. A Target ID inside local metadata does not make it
     centralized. If none exists, continue without creating one unless the user
     asked to establish durable tracking. That request is sufficient authority: run
     `revkb init --artifact <path>`, then `revkb context`.
3. Add `--snapshot` or repeated `--artifact` only for known values.
   `--target <target-id>` is local-init only and cannot accompany a centralized ID.
4. Choose one active Investigation and its concrete `Next action` from the context.

## Maintain the model

Store durable conclusions and minimal reproducible anchors:

- **Investigation / Lead:** unexplored paths and hypotheses, each with a concrete
  next action.
- **Knowledge:** supported system behavior or architecture.
- **Evidence:** the smallest command, location, trace, hash, or reproduction needed
  to verify a claim; leave verbose raw output outside the Vault.
- **Finding:** a verified vulnerability with demonstrated reachability, impact,
  preconditions, related Knowledge or Investigation, and Evidence.

Never promote a call path, dangerous API, or plausible exploit to a
Finding before attacker control and impact are reproducible. Correct or delete
claims disproved by later evidence. Record `reviewed` only for an explicit examined
scope; it never means safe.

Update human-maintained architecture and attack-surface prose when the model changes.
Never hand-edit text between `revkb` generated-region markers.

Use relative standard Markdown links with explicit `.md` extensions for durable
cross-note references, for example
`[Runtime trace](../evidence/runtime-trace.md)`. Accept legacy
`[[evidence/runtime-trace]]`, but do not create new human-visible Wikilinks. Keep
`%% revkb-area: [[knowledge/...]]` unchanged because it is a machine marker.

## Checkpoint before handoff

After a stable discovery, new Lead, Investigation transition, Finding decision,
Snapshot change, or before ending/handoff, run:

- Local Target: `revkb checkpoint` (no Target ID, even if local metadata names one).
- Explicit centralized Target: `revkb checkpoint <target-id>`.

Checkpoint only an opened or initialized Target. Without one, skip it unless
tracking was requested, and report that no Vault changed.
Resolve hard validation errors before claiming the handoff is ready.

`$archify` is only for explicitly requested standalone visualizations; it never
replaces PANORAMA or checkpoint.
