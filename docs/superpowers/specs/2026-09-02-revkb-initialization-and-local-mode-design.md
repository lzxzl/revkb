# revkb Initialization and Local Target Mode Design

**Status:** Approved

**Date:** 2026-09-02

## Purpose

Make a new reverse-audit Target usable with one command and allow `revkb` to live beside an existing reverse-engineering workspace without mixing knowledge files into the workspace root.

The existing centralized `targets/<target-id>/` layout remains supported. A new local mode stores the same Target format under `.revkb/` in the reverse-engineering workspace.

## Problems

The current setup requires copying `templates/target` and then changing the Target and Snapshot identifiers in six files. The copied template also contains illustrative Knowledge, Evidence, Investigation, and Finding content that must not be mistaken for facts about the real Target.

The current CLI also treats its working directory as a centralized Vault root and requires a Target ID on every command. Consequently, it cannot naturally be invoked from a directory that already contains an APK, unpacked code, debugger state, and other reverse-engineering materials.

## Goals

- Initialize a valid Target with one non-interactive command.
- Calculate Artifact SHA-256 values rather than asking the user to copy them manually.
- Support a Target-local `.revkb/` knowledge directory.
- Discover a local Target from the workspace or any descendant directory.
- Preserve the existing centralized commands and Target Markdown format.
- Generate only neutral, truthful initial content; never create a sample confirmed Finding.
- Refuse destructive overwrites and avoid partially initialized Target directories.

## Non-goals

- Moving or copying Artifact files.
- Inferring application architecture or vulnerabilities during initialization.
- Automatically importing decompiler, debugger, IDA, Ghidra, or MCP output.
- Adding interactive prompts or a full configuration system.
- Migrating existing centralized Targets into local mode.
- Integrating Archify into `init`, `context`, or `checkpoint`.

## Chosen Approach

Use one CLI with two compatible location modes.

1. With a positional Target ID, commands use the existing centralized location under `<cwd>/targets/<target-id>/`.
2. Without a positional Target ID, commands use local mode. `init` creates `<cwd>/.revkb/`; `context` and `checkpoint` search upward for the nearest `.revkb/PANORAMA.md`.

This preserves every existing command while making the common single-Target workspace require no repeated Target argument. It is preferable to making local mode the only layout because existing multi-Target Vaults remain useful, and preferable to a mandatory `--root` option because everyday commands stay short.

## CLI Contract

```text
revkb init [<target-id>] --artifact <path> [--artifact <path> ...]
           [--target <target-id>] [--snapshot <snapshot-id>]
revkb context [<target-id>]
revkb checkpoint [<target-id>]
revkb --help
revkb <command> --help
```

### Local initialization

When `init` has no positional Target ID:

- the destination is `<cwd>/.revkb/`;
- `--target` supplies the Target ID;
- without `--target`, the Target ID is the basename of the resolved current directory;
- `--snapshot` supplies the Snapshot ID;
- without `--snapshot`, the Snapshot ID is `<target-id>-initial`.

Example:

```bash
cd /work/yuanbao
revkb init --snapshot yuanbao-5040 --artifact ./yuanbao-release-prod-signed-5040.apk
revkb context
revkb checkpoint
```

The Target ID in this example defaults to `yuanbao`.

### Centralized initialization

When `init` has a positional Target ID:

- the destination is `<cwd>/targets/<target-id>/`;
- the positional value is the Target ID;
- specifying `--target` at the same time is an error;
- the same Snapshot defaults and Artifact handling apply.

Example:

```bash
cd /work/reverse-audit-vault
revkb init yuanbao --snapshot yuanbao-5040 \
  --artifact ./yuanbao-release-prod-signed-5040.apk
revkb context yuanbao
revkb checkpoint yuanbao
```

### Context and Checkpoint resolution

`context <target-id>` and `checkpoint <target-id>` retain their current behavior and resolve `<cwd>/targets/<target-id>/`. Explicit Target IDs do not trigger local discovery.

Without a Target ID, the CLI examines the current directory and then each ancestor. At each level it looks for `.revkb/PANORAMA.md`; the nearest match wins. The Target ID is read from that Panorama's frontmatter and is then subjected to the normal Target validation.

If discovery reaches the filesystem root without finding a local Target, the command fails with an actionable error that recommends `revkb init` or an explicit Target ID.

### Identifier safety

Identifiers created by `init` must match `^[\p{L}\p{N}][\p{L}\p{N}._-]*$` in Unicode mode: they start with a Unicode letter or number and then contain only letters, numbers, `.`, `_`, or `-`. This keeps generated filenames, YAML scalars, headings, and wikilinks unambiguous. Absolute values, path separators, whitespace, control characters, and Markdown delimiters are rejected.

Explicit IDs supplied to the existing `context` and `checkpoint` commands retain their current nonempty single-path-segment validation, so previously created Targets remain addressable. Their values still cannot be `.`, `..`, absolute paths, or path-like IDs.

### Help and errors

`--help`, `-h`, and `help` print current command syntax and exit successfully. Invalid options or incomplete commands print a focused explanation plus usage and exit with status 2. Operational or validation failures exit with status 1.

`--artifact` is the only repeatable option. Repeating `--target` or `--snapshot` is a syntax error rather than silently selecting one value.

## Artifact Handling

At least one `--artifact` is required. The option is repeatable so one Snapshot can contain an APK, DEX, SO, KO, firmware image, or other related binaries.

For each Artifact, initialization:

1. resolves the input path against the invocation working directory;
2. requires it to be an existing regular file;
3. rejects duplicate canonical paths;
4. calculates SHA-256 with a stream so large binaries are not loaded fully into memory;
5. derives the type from a lowercase alphanumeric final filename extension, or uses `binary` when there is no safe extension;
6. records a portable path relative to the invocation working directory, using `/` separators;
7. rejects a recorded path containing a line break or `|`, because either value would corrupt the Markdown Artifact table.

Initialization reads but never moves, copies, or modifies Artifact bytes.

## Generated Target

Both modes produce the same Target document format:

```text
<target-root>/
├── PANORAMA.md
├── snapshots/
│   └── <snapshot-id>.md
├── knowledge/
├── investigations/
│   └── initial-analysis.md
├── findings/
└── evidence/
```

`PANORAMA.md` contains all required sections and generated-region markers. Its initial prose explicitly says that architecture and attack surfaces are not yet established. Its Mermaid block shows only the known Snapshot Artifacts and that analysis is pending; it does not invent components, trust boundaries, or business flows. It initially contains no `revkb-area` marker because no Knowledge area has yet been established.

The Snapshot page contains the current UTC ISO-8601 creation time, the calculated Artifact rows, and `Initial Snapshot.` under `Known changes`.

`investigations/initial-analysis.md` is a queued Investigation with the concrete next action to inventory external entry points, major runtime modules, and trust boundaries. It contains no fabricated observations or evidence links.

The `knowledge/`, `findings/`, and `evidence/` directories start empty. In particular, initialization never creates a confirmed Finding.

Running `context` immediately after a successful `init` must succeed and recommend the initial analysis action. Running `checkpoint` must populate only the existing generated regions and then be idempotent.

## Filesystem Safety

Initialization refuses to proceed when the final Target path already exists, whether it is a file or directory. There is no overwrite flag.

All Artifact validation and hashing finish before Target files are staged. The initializer then writes a uniquely named sibling staging directory and renames that directory to the final Target path only after every write succeeds. A failed operation removes its staging directory and must not leave `.revkb/` or `targets/<target-id>/` partially populated. Creating the centralized parent `targets/` directory is allowed even if a later initialization step fails.

Local initialization also refuses to create a nested Target when the current directory is already within a discoverable `.revkb` Target; the error reports the existing Target path.

## Internal Design

### CLI parsing

Replace the fixed two-argument check in `src/cli.ts` with a small explicit parser for the three commands and their supported options. The parser returns a typed command rather than letting core operations interpret raw arguments.

No third-party argument-parsing dependency is needed for this command surface.

### Target locations

Introduce a Target-location value containing `targetRoot` and `targetId`. Central resolution constructs it from the working directory and explicit ID. Local discovery finds `.revkb/PANORAMA.md`, reads its Target ID, and returns the same value.

Refactor Markdown loading and the knowledge-base operations to consume that location. Existing exported APIs may remain as compatibility wrappers where useful, but filesystem construction must live in one location module rather than be repeated by commands.

### Initialization

A focused initialization module owns option validation, Artifact inspection, neutral Markdown rendering, staging, and atomic publication. Rendering functions receive explicit Target ID, Snapshot ID, creation time, and Artifact metadata so tests can be deterministic.

The checked-in illustrative `templates/target/` remains available as documentation and a manual example, but README instructions promote `revkb init` as the normal path. Runtime initialization does not depend on mutating that valid example template.

## Compatibility

- Existing Target Markdown requires no migration.
- Existing `revkb context <target-id>` and `revkb checkpoint <target-id>` commands remain valid.
- Generated-region ownership is unchanged: only `checkpoint` writes inside the four marked regions.
- `init` creates a new Target but never edits an existing Target or any existing generated region.
- Node.js 22 remains the minimum supported version and no runtime dependency is added.

## Documentation

README usage begins with `revkb init` rather than manual recursive copying. It documents local mode first and centralized mode second, including multi-Artifact initialization, discovery behavior, defaults, and the refusal to overwrite.

The manual template-copy instructions remain as an advanced fallback and clearly state that all illustrative facts must be replaced.

## Testing

Automated tests cover:

- parsing successful local and centralized `init` commands;
- help and actionable syntax errors;
- default and explicitly supplied Target and Snapshot IDs;
- rejection of unsafe identifiers and conflicting positional/`--target` values;
- initialization from one and multiple Artifact files;
- correct streamed SHA-256 values, type inference, and recorded relative paths;
- rejection of missing, non-file, and duplicate Artifacts before publication;
- creation of a clean Target with no fabricated Knowledge, Evidence, or Finding;
- immediate successful `context` and idempotent `checkpoint` after initialization;
- local discovery from the workspace root, `.revkb/`, and nested workspace directories;
- nearest-ancestor discovery when nested local Targets exist;
- refusal to overwrite an existing Target or initialize inside an existing local Target;
- cleanup of staging output on a failed initialization;
- unchanged behavior of all existing centralized commands and validation tests.

The full `npm run check` command remains the completion gate.

## Acceptance Criteria

1. From a directory containing an Artifact, a user can create a valid local Target with one `revkb init --artifact <path>` command.
2. The user does not manually repeat the Target ID or Snapshot ID across Markdown files.
3. Artifact hashes in the Snapshot match the source bytes.
4. `revkb context` and `revkb checkpoint` work without a Target argument anywhere below the local workspace root.
5. A centralized Vault can initialize and operate Targets using explicit Target IDs exactly as before.
6. Initialization never creates a false confirmed Finding or evidence claim.
7. Existing Targets are never overwritten and failed initialization leaves no partial Target.
8. All existing and new automated checks pass.
