# revkb Initialization and Local Target Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-command Target initialization and allow `context` and `checkpoint` to operate from a reverse-engineering workspace backed by a local `.revkb/` directory, without breaking centralized `targets/<target-id>/` usage.

**Architecture:** A `TargetLocation` abstraction separates Target loading from its physical layout. Local discovery and centralized resolution both produce that value; a focused initializer hashes Artifacts, renders neutral Markdown into a staging directory, validates it, and atomically publishes it; the CLI parses `init`, optional Target arguments, and help without adding a dependency.

**Tech Stack:** Node.js 22, TypeScript 5, ESM, `gray-matter`, Vitest, Markdown, Mermaid

**Spec:** `docs/superpowers/specs/2026-09-02-revkb-initialization-and-local-mode-design.md`

## Global Constraints

- Existing `revkb context <target-id>` and `revkb checkpoint <target-id>` behavior must remain compatible.
- Local mode stores knowledge in `<workspace>/.revkb/` and discovers the nearest such Target by searching ancestors.
- At least one Artifact is required for initialization; Artifact bytes are read but never moved, copied, or modified.
- SHA-256 must be calculated with streaming I/O.
- Initialization must generate neutral content with no fabricated Knowledge, Evidence, architecture facts, or confirmed Finding.
- Initialization must refuse existing destinations and clean staging output after failure.
- `checkpoint` remains the only operation that edits generated regions of an existing `PANORAMA.md`.
- No runtime dependency may be added; Node.js 22 remains the minimum version.
- Do not edit or stage the user's untracked `targets/` directory or APK. All new behavior tests use temporary directories.
- Follow red-green-refactor for every production change and run the complete `npm run check` before completion.

## Planned File Map

```text
src/core/target-location.ts       centralized locations, local `.revkb` discovery, Target ID extraction
src/core/markdown.ts              load a Target from an explicit `TargetLocation`
src/core/knowledge-base.ts        location-based context/checkpoint entry points plus compatibility wrappers
src/core/atomic-directory.ts      stage, clean up, and publish a new directory as one operation
src/core/initialize.ts            identifier checks, Artifact hashing, neutral Markdown rendering, initialization
src/cli.ts                        explicit CLI parser, help, `init`, and optional Target dispatch
tests/target-location.test.ts     location loading and nearest-ancestor discovery
tests/atomic-directory.test.ts    publication, collision, and failed-population cleanup
tests/initialize.test.ts          hashing, rendering, validation, multi-Artifact and safety behavior
tests/cli-init.test.ts            CLI grammar and both location modes
tests/revkb.test.ts               adjusted legacy usage assertion; existing regression suite
README.md                         local-first quick start and centralized alternative
docs/reverse-audit-workflow.md    optional Target argument and local discovery workflow
```

---

### Task 1: Decouple Target loading from centralized paths

**Files:**
- Create: `src/core/target-location.ts`
- Create: `tests/target-location.test.ts`
- Modify: `src/core/markdown.ts`
- Modify: `src/core/knowledge-base.ts`

**Interfaces:**
- Produces: `TargetLocation`, `centralTargetLocation()`, `localTargetLocation()`, `findLocalTarget()`, and `discoverLocalTarget()`.
- Produces: `loadTargetAt()`, `buildContextAt()`, and `checkpointAt()` for layout-independent operations.
- Preserves: `loadTarget(vaultRoot, targetId)`, `buildContext(vaultRoot, targetId)`, and `checkpoint(vaultRoot, targetId)` as centralized wrappers.

- [ ] **Step 1: Write the failing Target-location tests**

Create `tests/target-location.test.ts` with real temporary directories. Copy the existing valid example template rather than mocking the filesystem:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextAt } from "../src/core/knowledge-base.js";
import { loadTargetAt } from "../src/core/markdown.js";
import {
  centralTargetLocation,
  discoverLocalTarget,
  findLocalTarget,
} from "../src/core/target-location.js";

async function createLocalExample(parent: string): Promise<string> {
  const workspace = path.join(parent, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  await fs.cp(path.resolve("templates/target"), path.join(workspace, ".revkb"), {
    recursive: true,
  });
  return workspace;
}

describe("Target locations", () => {
  it("loads the existing centralized layout through an explicit location", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-location-central-"));
    await fs.mkdir(path.join(root, "targets"), { recursive: true });
    await fs.cp(path.resolve("templates/target"), path.join(root, "targets/example-target"), {
      recursive: true,
    });

    const location = centralTargetLocation(root, "example-target");
    const target = await loadTargetAt(location);

    expect(target.targetRoot).toBe(path.join(root, "targets/example-target"));
    expect(target.targetId).toBe("example-target");
  });

  it("discovers and runs a local Target from a nested workspace directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-location-local-"));
    const workspace = await createLocalExample(root);
    const nested = path.join(workspace, "jadx/sources");
    await fs.mkdir(nested, { recursive: true });

    const location = await discoverLocalTarget(nested);

    expect(location).toEqual({
      vaultRoot: workspace,
      targetRoot: path.join(workspace, ".revkb"),
      targetId: "example-target",
    });
    expect((await discoverLocalTarget(workspace)).targetRoot).toBe(path.join(workspace, ".revkb"));
    expect((await discoverLocalTarget(path.join(workspace, ".revkb"))).targetRoot).toBe(
      path.join(workspace, ".revkb"),
    );
    expect(await buildContextAt(location)).toContain("# Reverse Audit Context: Example Target");
  });

  it("chooses the nearest nested local Target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-location-nearest-"));
    const outer = await createLocalExample(root);
    const inner = path.join(outer, "nested");
    await fs.mkdir(inner, { recursive: true });
    const source = await fs.readFile(path.resolve("templates/target/PANORAMA.md"), "utf8");
    await fs.mkdir(path.join(inner, ".revkb"));
    await fs.writeFile(
      path.join(inner, ".revkb/PANORAMA.md"),
      source.replaceAll("example-target", "inner-target"),
    );

    expect((await discoverLocalTarget(inner)).targetId).toBe("inner-target");
  });

  it("returns undefined from find and an actionable error from discover when absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-location-missing-"));

    expect(await findLocalTarget(root)).toBeUndefined();
    await expect(discoverLocalTarget(root)).rejects.toThrow(
      "No local .revkb Target found; run revkb init or provide a Target ID",
    );
  });
});
```

For the nearest-target test, only the Panorama is needed because discovery reads frontmatter but does not load or validate that Target.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/target-location.test.ts`

Expected: FAIL because the location module and location-based entry points do not exist.

- [ ] **Step 3: Implement the location abstraction and discovery**

Create `src/core/target-location.ts` with this public shape:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface TargetLocation {
  vaultRoot: string;
  targetRoot: string;
  targetId: string;
}

export function centralTargetLocation(vaultRoot: string, targetId: string): TargetLocation {
  const resolvedRoot = path.resolve(vaultRoot);
  return {
    vaultRoot: resolvedRoot,
    targetRoot: path.join(resolvedRoot, "targets", targetId),
    targetId,
  };
}

export function localTargetLocation(workspaceRoot: string, targetId: string): TargetLocation {
  const resolvedRoot = path.resolve(workspaceRoot);
  return {
    vaultRoot: resolvedRoot,
    targetRoot: path.join(resolvedRoot, ".revkb"),
    targetId,
  };
}

export async function findLocalTarget(startDirectory: string): Promise<TargetLocation | undefined>;
export async function discoverLocalTarget(startDirectory: string): Promise<TargetLocation>;
```

Implement ancestor traversal from `path.resolve(startDirectory)` to its filesystem root. A candidate exists only when `<ancestor>/.revkb/PANORAMA.md` is a regular file. Parse it with `gray-matter`; require a nonempty string `target` value and return `localTargetLocation(ancestor, targetId)`. Ignore only `ENOENT` while probing; propagate permission and parse errors with the Panorama path in the message.

- [ ] **Step 4: Add direct-location loaders and operations**

In `src/core/markdown.ts`, add:

```ts
import { centralTargetLocation, type TargetLocation } from "./target-location.js";

export async function loadTargetAt(location: TargetLocation): Promise<TargetVault> {
  const files = await markdownFiles(location.targetRoot);
  const notes = await Promise.all(
    files.map(async (absolutePath) => {
      const relativePath = path.relative(location.targetRoot, absolutePath);
      return parseNote(absolutePath, relativePath, await fs.readFile(absolutePath, "utf8"));
    }),
  );
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const panorama = notes.find((note) => note.relativePath === "PANORAMA.md");
  if (!panorama) throw new Error(`Missing ${path.join(location.targetRoot, "PANORAMA.md")}`);
  return { ...location, panorama, notes };
}

export async function loadTarget(vaultRoot: string, targetId: string): Promise<TargetVault> {
  return loadTargetAt(centralTargetLocation(vaultRoot, targetId));
}
```

Use the absolute `location.targetRoot` in the missing-Panorama error so it is correct in both modes.

In `src/core/knowledge-base.ts`, move the existing bodies behind these functions:

```ts
export async function buildContextAt(location: TargetLocation): Promise<string>;
export async function checkpointAt(location: TargetLocation): Promise<CheckpointResult>;

export async function buildContext(vaultRoot: string, targetId: string): Promise<string> {
  return buildContextAt(centralTargetLocation(vaultRoot, targetId));
}

export async function checkpoint(vaultRoot: string, targetId: string): Promise<CheckpointResult> {
  return checkpointAt(centralTargetLocation(vaultRoot, targetId));
}
```

The rendering and atomic Panorama replacement logic stays byte-for-byte equivalent; only Target loading changes.

- [ ] **Step 5: Run focused and regression tests**

Run: `npm test -- tests/target-location.test.ts tests/revkb.test.ts`

Expected: PASS with all existing centralized behavior unchanged.

- [ ] **Step 6: Commit the location seam**

```bash
git add src/core/target-location.ts src/core/markdown.ts src/core/knowledge-base.ts tests/target-location.test.ts
git commit -m "feat: resolve local revkb targets"
```

---

### Task 2: Add atomic directory publication

**Files:**
- Create: `src/core/atomic-directory.ts`
- Create: `tests/atomic-directory.test.ts`

**Interfaces:**
- Produces: `createDirectoryAtomically(finalPath, populate)` for initialization.
- Guarantees: successful population appears at the final path; population failure removes staging output; an existing final path is never intentionally replaced.

- [ ] **Step 1: Write failing filesystem behavior tests**

Create `tests/atomic-directory.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirectoryAtomically } from "../src/core/atomic-directory.js";

describe("createDirectoryAtomically", () => {
  it("publishes a fully populated directory", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-publish-ok-"));
    const target = path.join(parent, ".revkb");

    await createDirectoryAtomically(target, async (staging) => {
      await fs.writeFile(path.join(staging, "PANORAMA.md"), "complete");
    });

    expect(await fs.readFile(path.join(target, "PANORAMA.md"), "utf8")).toBe("complete");
  });

  it("removes staging output when population fails", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-publish-fail-"));
    const target = path.join(parent, ".revkb");

    await expect(
      createDirectoryAtomically(target, async (staging) => {
        await fs.writeFile(path.join(staging, "partial.md"), "partial");
        throw new Error("injected population failure");
      }),
    ).rejects.toThrow("injected population failure");

    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(parent)).filter((name) => name.includes("revkb-init"))).toEqual([]);
  });

  it("preserves an existing destination without invoking population", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-publish-existing-"));
    const target = path.join(parent, ".revkb");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "keep.md"), "keep");
    let populated = false;

    await expect(
      createDirectoryAtomically(target, async () => {
        populated = true;
      }),
    ).rejects.toThrow(`Target path already exists: ${target}`);

    expect(populated).toBe(false);
    expect(await fs.readFile(path.join(target, "keep.md"), "utf8")).toBe("keep");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/atomic-directory.test.ts`

Expected: FAIL because `atomic-directory.ts` does not exist.

- [ ] **Step 3: Implement stage, cleanup, and publication**

Create `src/core/atomic-directory.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function createDirectoryAtomically(
  finalPath: string,
  populate: (stagingPath: string) => Promise<void>,
): Promise<void> {
  const resolvedFinal = path.resolve(finalPath);
  if (await exists(resolvedFinal)) throw new Error(`Target path already exists: ${resolvedFinal}`);

  const parent = path.dirname(resolvedFinal);
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, `.${path.basename(resolvedFinal)}.revkb-init-`));
  let published = false;
  try {
    await populate(staging);
    if (await exists(resolvedFinal)) throw new Error(`Target path already exists: ${resolvedFinal}`);
    await fs.rename(staging, resolvedFinal);
    published = true;
  } finally {
    if (!published) await fs.rm(staging, { recursive: true, force: true });
  }
}
```

Keep the final existence recheck immediately before `rename`. Do not add an overwrite or force option.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm test -- tests/atomic-directory.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the publication primitive**

```bash
git add src/core/atomic-directory.ts tests/atomic-directory.test.ts
git commit -m "feat: publish initialized targets atomically"
```

---

### Task 3: Initialize a truthful Target from Artifact files

**Files:**
- Create: `src/core/initialize.ts`
- Create: `tests/initialize.test.ts`

**Interfaces:**
- Consumes: `TargetLocation`, an invocation root, Snapshot ID, Artifact paths, and an injectable clock.
- Produces: `initializeTarget(options): Promise<InitializationResult>`.
- Uses: `createDirectoryAtomically()` and validates staged Markdown with the existing loader and validator before publication.

- [ ] **Step 1: Write the failing successful-initialization test**

Create `tests/initialize.test.ts` with a deterministic clock and known Artifact bytes:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextAt, checkpointAt } from "../src/core/knowledge-base.js";
import { initializeTarget } from "../src/core/initialize.js";
import { localTargetLocation } from "../src/core/target-location.js";

const CREATED = new Date("2026-09-02T12:00:00.000Z");
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("initializeTarget", () => {
  it("hashes an Artifact and creates a valid neutral Target", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-ok-"));
    await fs.writeFile(path.join(workspace, "yuanbao.apk"), "abc");
    const location = localTargetLocation(workspace, "yuanbao");

    const result = await initializeTarget({
      invocationRoot: workspace,
      location,
      snapshotId: "yuanbao-5040",
      artifactPaths: ["./yuanbao.apk"],
      now: () => CREATED,
    });

    expect(result.artifacts).toEqual([
      { type: "apk", path: "yuanbao.apk", sha256: ABC_SHA256 },
    ]);
    const snapshot = await fs.readFile(
      path.join(workspace, ".revkb/snapshots/yuanbao-5040.md"),
      "utf8",
    );
    expect(snapshot).toContain("created: 2026-09-02T12:00:00.000Z");
    expect(snapshot).toContain(`| apk | yuanbao.apk | ${ABC_SHA256} |`);
    expect(await fs.readdir(path.join(workspace, ".revkb/findings"))).toEqual([]);
    expect(await fs.readdir(path.join(workspace, ".revkb/evidence"))).toEqual([]);
    expect(await fs.readdir(path.join(workspace, ".revkb/knowledge"))).toEqual([]);

    const context = await buildContextAt(location);
    expect(context).toContain("Initial target analysis — queued");
    expect(context).toContain("Inventory external entry points, major runtime modules, and trust boundaries.");
    expect(context).not.toContain("confirmed finding");

    expect((await checkpointAt(location)).changed).toBe(true);
    expect((await checkpointAt(location)).changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/initialize.test.ts`

Expected: FAIL because `initializeTarget()` does not exist.

- [ ] **Step 3: Implement identifier and Artifact inspection**

Create `src/core/initialize.ts` with these types:

```ts
export interface InitializedArtifact {
  type: string;
  path: string;
  sha256: string;
}

export interface InitializeTargetOptions {
  invocationRoot: string;
  location: TargetLocation;
  snapshotId: string;
  artifactPaths: string[];
  now?: () => Date;
}

export interface InitializationResult {
  location: TargetLocation;
  snapshotId: string;
  artifacts: InitializedArtifact[];
}
```

Inside `initializeTarget`, select the clock with `const now = options.now ?? (() => new Date());`. Tests pass a fixed clock; production callers omit the property.

Implement `assertInitializationId(label, value)` with Unicode regex `/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u`. The error names the invalid Target or Snapshot value.

For every Artifact:

```ts
const absolutePath = await fs.realpath(path.resolve(invocationRoot, inputPath));
const metadata = await fs.stat(absolutePath);
if (!metadata.isFile()) throw new Error(`Artifact is not a regular file: ${inputPath}`);

const hash = createHash("sha256");
for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
const sha256 = hash.digest("hex");
```

Deduplicate by canonical absolute path. Store `path.relative(path.resolve(invocationRoot), absolutePath)` with platform separators converted to `/`. Reject an empty recorded path, a line break, or `|`. Infer `type` from the final extension only when it matches `/^[a-z0-9]+$/`; otherwise use `binary`.

- [ ] **Step 4: Render and validate neutral Markdown before publication**

Render this semantic content with the supplied IDs and Artifact rows:

````md
---
kind: panorama
target: yuanbao
snapshot: yuanbao-5040
---
# yuanbao

## Current understanding

Initial analysis has not established the Target architecture yet.

## Overall architecture

```mermaid
flowchart LR
    Artifacts[Snapshot artifacts recorded] --> Pending[Architecture analysis pending]
```

## Key attack surfaces

Not established.
````

Append all four required generated regions unchanged and a `Snapshots` section containing `- [[snapshots/yuanbao-5040]] — active`.

Render `investigations/initial-analysis.md` with `status: queued` and these visible sections:

```md
# Initial target analysis

## Why it matters

Establish the Target's entry points, runtime boundaries, and security-relevant flows.

## Current hypothesis

No architecture hypothesis has been established.

## Confirmed observations

The initial Snapshot records the supplied Artifacts by SHA-256.

## Experiments

None yet.

## Newly discovered branches

None yet.

## Next action

Inventory external entry points, major runtime modules, and trust boundaries.

## Evidence

No Evidence Anchor has been created yet.
```

Use `createDirectoryAtomically(location.targetRoot, populate)`. Inside `populate`, create `snapshots`, `knowledge`, `investigations`, `findings`, and `evidence`; write the Panorama, Snapshot, and initial Investigation; then call `requireValid(await loadTargetAt({ ...location, targetRoot: staging }))`. Publish only if staged validation succeeds.

- [ ] **Step 5: Run the successful initialization test and verify GREEN**

Run: `npm test -- tests/initialize.test.ts`

Expected: PASS.

- [ ] **Step 6: Add failing safety and multi-Artifact tests**

Extend `tests/initialize.test.ts` with separate cases that assert:

```ts
async function expectAbsent(candidate: string): Promise<void> {
  await expect(fs.stat(candidate)).rejects.toMatchObject({ code: "ENOENT" });
}

it.each([
  { label: "empty Target", targetId: "", snapshotId: "snapshot-1" },
  { label: "dot Target", targetId: ".", snapshotId: "snapshot-1" },
  { label: "path Target", targetId: "../escape", snapshotId: "snapshot-1" },
  { label: "spaced Target", targetId: "two words", snapshotId: "snapshot-1" },
  { label: "Markdown Target", targetId: "bad|id", snapshotId: "snapshot-1" },
  { label: "unsafe Snapshot", targetId: "safe-target", snapshotId: "bad snapshot" },
])("rejects an unsafe $label ID", async ({ targetId, snapshotId }) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-id-"));
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");

  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, targetId),
      snapshotId,
      artifactPaths: ["app.apk"],
    }),
  ).rejects.toThrow(/Invalid (Target|Snapshot) ID/);

  await expectAbsent(path.join(workspace, ".revkb"));
});

it("records multiple Artifacts with inferred and fallback types", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-multi-"));
  await fs.writeFile(path.join(workspace, "app.APK"), "abc");
  await fs.writeFile(path.join(workspace, "firmware.bad-ext!"), "firmware");

  const result = await initializeTarget({
    invocationRoot: workspace,
    location: localTargetLocation(workspace, "demo"),
    snapshotId: "demo-initial",
    artifactPaths: ["app.APK", "firmware.bad-ext!"],
  });

  expect(result.artifacts.map(({ type, path: artifactPath }) => ({ type, path: artifactPath }))).toEqual([
    { type: "apk", path: "app.APK" },
    { type: "binary", path: "firmware.bad-ext!" },
  ]);
});

it("rejects a missing Artifact before publishing", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-missing-"));
  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: ["missing.apk"],
    }),
  ).rejects.toThrow("missing.apk");
  await expectAbsent(path.join(workspace, ".revkb"));
});

it("rejects a directory supplied as an Artifact", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-directory-"));
  await fs.mkdir(path.join(workspace, "not-a-file.apk"));
  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: ["not-a-file.apk"],
    }),
  ).rejects.toThrow("Artifact is not a regular file: not-a-file.apk");
  await expectAbsent(path.join(workspace, ".revkb"));
});

it("rejects duplicate canonical Artifact paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-duplicate-"));
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");
  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: ["app.apk", "./app.apk"],
    }),
  ).rejects.toThrow("Duplicate Artifact: ./app.apk");
  await expectAbsent(path.join(workspace, ".revkb"));
});

it("rejects a path that would corrupt the Artifact table", async () => {
  if (process.platform === "win32") return;
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-table-path-"));
  await fs.writeFile(path.join(workspace, "bad|name.apk"), "abc");
  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: ["bad|name.apk"],
    }),
  ).rejects.toThrow("Artifact path cannot contain a line break or |: bad|name.apk");
  await expectAbsent(path.join(workspace, ".revkb"));
});

it("refuses to overwrite an existing Target", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-existing-"));
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");
  await fs.mkdir(path.join(workspace, ".revkb"));
  const panorama = path.join(workspace, ".revkb/PANORAMA.md");
  await fs.writeFile(panorama, "keep");

  await expect(
    initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: ["app.apk"],
    }),
  ).rejects.toThrow(`Target path already exists: ${path.join(workspace, ".revkb")}`);

  expect(await fs.readFile(panorama, "utf8")).toBe("keep");
});
```

- [ ] **Step 7: Run the new tests and verify RED, then implement the minimum missing checks**

Run before implementation: `npm test -- tests/initialize.test.ts`

Expected: the new cases FAIL for the not-yet-enforced edges.

Implement only the validation and type/path behavior required by those failures. Run the same command again.

Expected after implementation: PASS.

- [ ] **Step 8: Commit initialization**

```bash
git add src/core/initialize.ts tests/initialize.test.ts
git commit -m "feat: initialize revkb targets from artifacts"
```

---

### Task 4: Expose `init`, local discovery, and help through the CLI

**Files:**
- Create: `tests/cli-init.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/revkb.test.ts`

**Interfaces:**
- Accepts: the exact command grammar in the approved spec.
- Dispatches: explicit IDs to centralized locations; omitted IDs to local initialization or discovery.
- Preserves: `runCli(args, cwd, io): Promise<number>` for existing tests and the npm binary.

- [ ] **Step 1: Write failing help and syntax tests**

Create `tests/cli-init.test.ts` with its own small `captureIo()` helper and assert:

```ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const execFileAsync = promisify(execFile);

function captureIo(): {
  stdout: () => string;
  stderr: () => string;
  io: { out(text: string): void; err(text: string): void };
} {
  let stdout = "";
  let stderr = "";
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    io: {
      out: (text) => { stdout += text; },
      err: (text) => { stderr += text; },
    },
  };
}

it.each([
  ["--help"],
  ["-h"],
  ["help"],
  ["init", "--help"],
  ["context", "--help"],
  ["checkpoint", "-h"],
])(
  "prints help successfully for %j",
  async (args) => {
    const io = captureIo();
    expect(await runCli(args, process.cwd(), io.io)).toBe(0);
    expect(io.stdout()).toContain("revkb init [<target-id>] --artifact <path>");
    expect(io.stderr()).toBe("");
  },
);

it("reports conflicting centralized and local Target IDs", async () => {
  const io = captureIo();
  expect(
    await runCli(
      ["init", "yuanbao", "--target", "other", "--artifact", "app.apk"],
      process.cwd(),
      io.io,
    ),
  ).toBe(2);
  expect(io.stderr()).toContain("Do not combine a positional Target ID with --target");
});

it.each([
  { args: ["init", "--unknown"], message: "Unknown option: --unknown" },
  { args: ["init", "--artifact"], message: "--artifact requires a value" },
  { args: ["init", "--target", "demo"], message: "At least one --artifact is required" },
  {
    args: ["init", "--target", "one", "--target", "two", "--artifact", "app.apk"],
    message: "--target may be specified only once",
  },
  {
    args: ["init", "--snapshot", "one", "--snapshot", "two", "--artifact", "app.apk"],
    message: "--snapshot may be specified only once",
  },
  { args: ["context", "one", "two"], message: "context accepts at most one Target ID" },
  { args: ["checkpoint", "../outside"], message: "Invalid Target ID: ../outside" },
])("reports syntax error for $args", async ({ args, message }) => {
  const io = captureIo();
  expect(await runCli(args, process.cwd(), io.io)).toBe(2);
  expect(io.stderr()).toContain(message);
  expect(io.stderr()).toContain("revkb context [<target-id>]");
});
```

In `tests/revkb.test.ts`, replace the old exact usage assertion with `expect(io.stderr()).toContain("revkb checkpoint [<target-id>]")` while retaining the exit-status assertion for every unsafe ID.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `npm test -- tests/cli-init.test.ts tests/revkb.test.ts`

Expected: FAIL because the current two-argument parser has no help or `init` grammar.

- [ ] **Step 3: Implement a typed explicit parser in `src/cli.ts`**

Use a discriminated union:

```ts
type CliCommand =
  | { kind: "help" }
  | { kind: "context" | "checkpoint"; targetId?: string }
  | {
      kind: "init";
      positionalTargetId?: string;
      targetOption?: string;
      snapshotId?: string;
      artifactPaths: string[];
    };
```

Parse only `--artifact`, `--target`, `--snapshot`, `--help`, and `-h`. Each value-taking option consumes exactly the next argument and rejects a missing value. Accumulate every `--artifact`; reject a second `--target` or `--snapshot`. `context` and `checkpoint` accept zero or one positional Target ID and no other options. Keep a dedicated usage-error class so syntax errors exit 2 while filesystem and validation failures exit 1.

The top-level help text must include:

```text
Usage:
  revkb init [<target-id>] --artifact <path> [--artifact <path> ...] [--target <target-id>] [--snapshot <snapshot-id>]
  revkb context [<target-id>]
  revkb checkpoint [<target-id>]
  revkb --help
```

- [ ] **Step 4: Run syntax tests and verify GREEN**

Run: `npm test -- tests/cli-init.test.ts tests/revkb.test.ts`

Expected: help and syntax cases PASS; operation cases are not yet present.

- [ ] **Step 5: Write failing command-dispatch tests**

Add real-filesystem cases to `tests/cli-init.test.ts`:

```ts
it("initializes and operates a local Target without repeating its ID", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-cli-local-"));
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");
  await fs.writeFile(path.join(workspace, "native.so"), "native");

  const initIo = captureIo();
  expect(
    await runCli(
      [
        "init",
        "--target", "yuanbao",
        "--snapshot", "yuanbao-5040",
        "--artifact", "app.apk",
        "--artifact", "native.so",
      ],
      workspace,
      initIo.io,
    ),
  ).toBe(0);
  expect(initIo.stdout()).toContain("Initialized .revkb");
  expect(initIo.stdout()).toContain("with 2 Artifact(s)");
  const snapshot = await fs.readFile(
    path.join(workspace, ".revkb/snapshots/yuanbao-5040.md"),
    "utf8",
  );
  expect(snapshot).toContain("| apk | app.apk |");
  expect(snapshot).toContain("| so | native.so |");

  const nested = path.join(workspace, "jadx/sources");
  await fs.mkdir(nested, { recursive: true });
  const contextIo = captureIo();
  expect(await runCli(["context"], nested, contextIo.io)).toBe(0);
  expect(contextIo.stdout()).toContain("# Reverse Audit Context: yuanbao");

  const checkpointIo = captureIo();
  expect(await runCli(["checkpoint"], nested, checkpointIo.io)).toBe(0);
  expect(checkpointIo.stdout()).toContain("Updated");
});

it("defaults local Target and Snapshot IDs from the workspace", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-cli-default-"));
  const targetId = path.basename(workspace);
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");
  const io = captureIo();

  expect(await runCli(["init", "--artifact", "app.apk"], workspace, io.io)).toBe(0);
  expect(io.stdout()).toContain(`for ${targetId} at Snapshot ${targetId}-initial`);
  expect(
    await fs.readFile(path.join(workspace, `.revkb/snapshots/${targetId}-initial.md`), "utf8"),
  ).toContain(`snapshot: ${targetId}-initial`);
});

it("initializes and operates a centralized Target with a positional ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-cli-central-"));
  await fs.writeFile(path.join(root, "app.apk"), "abc");
  const initIo = captureIo();

  expect(await runCli(["init", "demo", "--artifact", "app.apk"], root, initIo.io)).toBe(0);
  expect(initIo.stdout()).toContain("Initialized targets/demo for demo at Snapshot demo-initial");
  expect(await fs.stat(path.join(root, "targets/demo/PANORAMA.md"))).toBeDefined();

  const contextIo = captureIo();
  expect(await runCli(["context", "demo"], root, contextIo.io)).toBe(0);
  expect(contextIo.stdout()).toContain("# Reverse Audit Context: demo");
});

it("refuses local initialization inside an existing local Target", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-cli-nested-"));
  await fs.writeFile(path.join(workspace, "app.apk"), "abc");
  const firstIo = captureIo();
  expect(await runCli(["init", "--artifact", "app.apk"], workspace, firstIo.io)).toBe(0);

  const nested = path.join(workspace, "unpacked");
  await fs.mkdir(nested);
  const secondIo = captureIo();
  expect(
    await runCli(["init", "--target", "nested", "--artifact", "../app.apk"], nested, secondIo.io),
  ).toBe(1);
  expect(secondIo.stderr()).toContain(
    `Already inside local Target at ${path.join(workspace, ".revkb")}`,
  );
  await expect(fs.stat(path.join(nested, ".revkb"))).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 6: Run dispatch tests and verify RED**

Run: `npm test -- tests/cli-init.test.ts`

Expected: FAIL because `runCli` does not dispatch the new core operations.

- [ ] **Step 7: Wire location resolution and initialization**

For `init` without a positional ID:

1. call `findLocalTarget(cwd)` and reject if it finds an existing ancestor Target;
2. choose `targetOption ?? path.basename(path.resolve(cwd))`;
3. choose `snapshotId ?? `${targetId}-initial``;
4. use `localTargetLocation(cwd, targetId)`;
5. call `initializeTarget` with Artifact paths resolved against `cwd`.

For centralized `init`, reject `--target`, choose the same Snapshot default, and use `centralTargetLocation(cwd, positionalTargetId)`.

For `context` and `checkpoint`, use an explicit centralized location when a Target ID is present and `discoverLocalTarget(cwd)` otherwise. Dispatch through `buildContextAt()` and `checkpointAt()`.

Print `Initialized <relative-target-path> for <target-id> at Snapshot <snapshot-id> with <count> Artifact(s).` after success. Preserve existing Checkpoint warning and next-action output.

- [ ] **Step 8: Run CLI and full regression tests**

Run: `npm test -- tests/cli-init.test.ts tests/target-location.test.ts tests/initialize.test.ts tests/revkb.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the CLI surface**

```bash
git add src/cli.ts tests/cli-init.test.ts tests/revkb.test.ts
git commit -m "feat: add revkb init and local CLI mode"
```

---

### Task 5: Document and verify the complete workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/reverse-audit-workflow.md`
- Modify: `tests/cli-init.test.ts`

**Interfaces:**
- Documents: local mode as the default single-Target workflow and centralized mode as the multi-Target workflow.
- Verifies: the compiled npm-style binary can initialize and operate a local Target.

- [ ] **Step 1: Add a failing built-binary acceptance test**

Extend `tests/cli-init.test.ts` with this subprocess test. It builds once, invokes `dist/cli.js` through `process.execPath`, verifies the source bytes' known SHA-256, and proves Checkpoint idempotence:

```ts
it("initializes and operates local mode through the compiled binary", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: path.resolve(".") });
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-bin-local-"));
  const targetId = path.basename(workspace);
  await fs.writeFile(path.join(workspace, "sample.apk"), "abc");
  const cli = path.resolve("dist/cli.js");
  const run = (args: string[]) => execFileAsync(process.execPath, [cli, ...args], { cwd: workspace });

  const initialized = await run(["init", "--artifact", "sample.apk"]);
  expect(initialized.stderr).toBe("");
  expect(initialized.stdout).toContain(`for ${targetId} at Snapshot ${targetId}-initial`);

  const snapshot = await fs.readFile(
    path.join(workspace, `.revkb/snapshots/${targetId}-initial.md`),
    "utf8",
  );
  expect(snapshot).toContain(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );

  const context = await run(["context"]);
  expect(context.stderr).toBe("");
  expect(context.stdout).toContain(`# Reverse Audit Context: ${targetId}`);

  const firstCheckpoint = await run(["checkpoint"]);
  expect(firstCheckpoint.stderr).toBe("");
  expect(firstCheckpoint.stdout).toContain("Updated .revkb/PANORAMA.md");

  const secondCheckpoint = await run(["checkpoint"]);
  expect(secondCheckpoint.stderr).toBe("");
  expect(secondCheckpoint.stdout).toContain("No generated Panorama changes.");
});
```

- [ ] **Step 2: Run the acceptance test and verify its current result**

Run: `npm run build && npm test -- tests/cli-init.test.ts`

Expected before the final wiring/build adjustment: FAIL if the compiled binary or output contract differs from the source-level expectations. If it already passes because Task 4 completed the interface, record that it is an acceptance test over already-tested behavior and proceed without manufacturing a failure.

- [ ] **Step 3: Rewrite README quick start around `init`**

In `README.md`, make this the first operational example:

```bash
cd /path/to/yuanbao
revkb init --snapshot yuanbao-5040 --artifact ./yuanbao-release-prod-signed-5040.apk
revkb context
revkb checkpoint
```

Document that Target defaults to the workspace directory name and Snapshot defaults to `<target>-initial`. Add examples for `--target`, repeated `--artifact`, nested-directory discovery, and centralized initialization:

```bash
revkb init yuanbao --snapshot yuanbao-5040 --artifact ./yuanbao.apk
revkb context yuanbao
revkb checkpoint yuanbao
```

Move `cp -R templates/target ...` under a clearly labeled manual fallback. State that `init` refuses an existing destination and never creates a sample Finding.

- [ ] **Step 4: Update the shared Agent workflow**

Change step 1 of `docs/reverse-audit-workflow.md` to say:

```md
1. Run `revkb context` inside a local Target workspace, or `revkb context <target-id>` in a centralized Vault, and choose one active Investigation.
```

Add one concise setup sentence before the numbered list: use `revkb init --artifact <path>` for a local Target or `revkb init <target-id> --artifact <path>` for a centralized Target. Do not change the Checkpoint discipline or generated-region rules.

- [ ] **Step 5: Run formatting checks, focused acceptance, and full verification**

Run:

```bash
git diff --check
npm test -- tests/cli-init.test.ts
npm run check
```

Expected: no whitespace errors; all tests pass; TypeScript compiles; `dist/cli.js` is rebuilt.

- [ ] **Step 6: Confirm user-owned files remain untouched**

Run:

```bash
git status --short
git diff -- targets
```

Expected: the pre-existing untracked `targets/` directory remains untracked and has no staged or tracked diff. The APK remains ignored and unchanged.

- [ ] **Step 7: Commit documentation and acceptance coverage**

```bash
git add README.md docs/reverse-audit-workflow.md tests/cli-init.test.ts dist/cli.js dist/core
git commit -m "docs: explain revkb local target workflow"
```

If `dist/` remains ignored and is not tracked, omit it from `git add`; the authoritative TypeScript build must still pass.

- [ ] **Step 8: Review the completed implementation against the spec**

Use the repository's code-review workflow to compare all implementation commits after this plan against `docs/superpowers/specs/2026-09-02-revkb-initialization-and-local-mode-design.md`. Correct any Standards or Spec findings with focused tests, rerun `npm run check`, and only then report completion.
