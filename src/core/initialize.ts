import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createDirectoryAtomically } from "./atomic-directory.js";
import { loadTargetAt } from "./markdown.js";
import type { TargetLocation } from "./target-location.js";
import { requireValid } from "./validation.js";

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

function assertInitializationId(label: "Target" | "Snapshot", value: string): void {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value)) {
    throw new Error(`Invalid ${label} ID: ${value || "(empty)"}`);
  }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function portablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function inspectArtifacts(
  invocationRoot: string,
  artifactPaths: string[],
): Promise<InitializedArtifact[]> {
  if (artifactPaths.length === 0) throw new Error("At least one Artifact is required");
  const resolvedRoot = await fs.realpath(path.resolve(invocationRoot));
  const canonicalPaths = new Set<string>();
  const artifacts: InitializedArtifact[] = [];
  for (const inputPath of artifactPaths) {
    const absolutePath = await fs.realpath(path.resolve(resolvedRoot, inputPath));
    const metadata = await fs.stat(absolutePath);
    if (!metadata.isFile()) throw new Error(`Artifact is not a regular file: ${inputPath}`);
    if (canonicalPaths.has(absolutePath)) throw new Error(`Duplicate Artifact: ${inputPath}`);
    canonicalPaths.add(absolutePath);

    const recordedPath = portablePath(path.relative(resolvedRoot, absolutePath));
    if (!recordedPath || /[\r\n|]/.test(recordedPath)) {
      throw new Error(`Artifact path cannot contain a line break or |: ${inputPath}`);
    }
    const extension = path.extname(absolutePath).slice(1).toLowerCase();
    artifacts.push({
      type: /^[a-z0-9]+$/.test(extension) ? extension : "binary",
      path: recordedPath,
      sha256: await sha256(absolutePath),
    });
  }
  return artifacts;
}

function renderPanorama(targetId: string, snapshotId: string): string {
  return `---
kind: panorama
target: ${targetId}
snapshot: ${snapshotId}
---
# ${targetId}

## Current understanding

Initial analysis has not established the Target architecture yet.

## Overall architecture

\`\`\`mermaid
flowchart LR
    Artifacts[Snapshot artifacts recorded] --> Pending[Architecture analysis pending]
\`\`\`

## Key attack surfaces

Not established.

## Audit coverage
<!-- revkb:coverage:start -->
<!-- revkb:coverage:end -->

## Active investigations
<!-- revkb:investigations:start -->
<!-- revkb:investigations:end -->

## Unreviewed branches
<!-- revkb:leads:start -->
<!-- revkb:leads:end -->

## Confirmed findings
<!-- revkb:findings:start -->
<!-- revkb:findings:end -->

## Snapshots

- [[snapshots/${snapshotId}]] — active
`;
}

function renderSnapshot(
  targetId: string,
  snapshotId: string,
  created: string,
  artifacts: InitializedArtifact[],
): string {
  const rows = artifacts
    .map((artifact) => `| ${artifact.type} | ${artifact.path} | ${artifact.sha256} |`)
    .join("\n");
  return `---
kind: snapshot
target: ${targetId}
snapshot: ${snapshotId}
created: ${created}
---
# ${snapshotId}

| Type | Path | SHA-256 |
|---|---|---|
${rows}

## Known changes

Initial Snapshot.
`;
}

function renderInitialInvestigation(targetId: string, snapshotId: string): string {
  return `---
kind: investigation
target: ${targetId}
snapshot: ${snapshotId}
status: queued
---
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
`;
}

export async function initializeTarget(
  options: InitializeTargetOptions,
): Promise<InitializationResult> {
  assertInitializationId("Target", options.location.targetId);
  assertInitializationId("Snapshot", options.snapshotId);
  const now = options.now ?? (() => new Date());
  const artifacts = await inspectArtifacts(options.invocationRoot, options.artifactPaths);

  await createDirectoryAtomically(options.location.targetRoot, async (staging) => {
    await Promise.all(
      ["snapshots", "knowledge", "investigations", "findings", "evidence"].map((directory) =>
        fs.mkdir(path.join(staging, directory)),
      ),
    );
    await Promise.all([
      fs.writeFile(
        path.join(staging, "PANORAMA.md"),
        renderPanorama(options.location.targetId, options.snapshotId),
        "utf8",
      ),
      fs.writeFile(
        path.join(staging, "snapshots", `${options.snapshotId}.md`),
        renderSnapshot(
          options.location.targetId,
          options.snapshotId,
          now().toISOString(),
          artifacts,
        ),
        "utf8",
      ),
      fs.writeFile(
        path.join(staging, "investigations", "initial-analysis.md"),
        renderInitialInvestigation(options.location.targetId, options.snapshotId),
        "utf8",
      ),
    ]);
    requireValid(await loadTargetAt({ ...options.location, targetRoot: staging }));
  });

  return {
    location: options.location,
    snapshotId: options.snapshotId,
    artifacts,
  };
}
