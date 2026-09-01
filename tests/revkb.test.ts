import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const HASH = "a".repeat(64);

async function createVault(options: { brokenLink?: boolean } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-test-"));
  const target = path.join(root, "targets/demo-target");
  await Promise.all(
    ["snapshots", "knowledge", "investigations", "findings", "evidence"].map((dir) =>
      fs.mkdir(path.join(target, dir), { recursive: true }),
    ),
  );

  await fs.writeFile(
    path.join(target, "PANORAMA.md"),
    `---
kind: panorama
target: demo-target
snapshot: demo-v1
---
# Demo Target

## Current understanding
The target accepts external input and dispatches a native command.

## Overall architecture
\`\`\`mermaid
flowchart LR
  External --> Entry
  %% revkb-area: [[knowledge/external-entry]]
\`\`\`

Manual text must survive checkpoint.

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
`,
  );
  await fs.writeFile(
    path.join(target, "snapshots/demo-v1.md"),
    `---
kind: snapshot
target: demo-target
snapshot: demo-v1
---
# Demo v1

| Type | Path | SHA-256 |
|---|---|---|
| so | artifacts/libdemo.so | ${HASH} |
`,
  );
  await fs.writeFile(
    path.join(target, "knowledge/external-entry.md"),
    `---
kind: knowledge
target: demo-target
snapshot: demo-v1
status: reviewed
---
# External entry

## Current conclusion
External callers reach the native dispatcher.

## Evidence
[[evidence/runtime-trace]]
${options.brokenLink ? "[[evidence/absent]]" : ""}
`,
  );
  await fs.writeFile(
    path.join(target, "investigations/auth-bypass.md"),
    `---
kind: investigation
target: demo-target
snapshot: demo-v1
status: analyzing
---
# Authentication bypass

## Current hypothesis
An unauthenticated caller may reach the dispatcher.

## Next action
Trace the unauthenticated caller into the native dispatcher.

## Evidence
[[knowledge/external-entry]]
`,
  );
  await fs.writeFile(
    path.join(target, "findings/command-injection.md"),
    `---
kind: finding
target: demo-target
snapshot: demo-v1
status: confirmed
---
# Command injection

## Evidence
[[evidence/runtime-trace]]
`,
  );
  await fs.writeFile(
    path.join(target, "evidence/runtime-trace.md"),
    `---
kind: evidence
target: demo-target
snapshot: demo-v1
---
# Runtime trace

SECRET_VERBOSE_TRACE_BODY
`,
  );
  return root;
}

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
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  };
}

describe("revkb", () => {
  it("renders compact context and refreshes only generated Panorama regions", async () => {
    const root = await createVault();
    const contextIo = captureIo();

    expect(await runCli(["context", "demo-target"], root, contextIo.io)).toBe(0);
    expect(contextIo.stdout()).toContain("# Reverse Audit Context: Demo Target");
    expect(contextIo.stdout()).toContain("Authentication bypass");
    expect(contextIo.stdout()).not.toContain("SECRET_VERBOSE_TRACE_BODY");

    const checkpointIo = captureIo();
    expect(await runCli(["checkpoint", "demo-target"], root, checkpointIo.io)).toBe(0);
    const panorama = await fs.readFile(path.join(root, "targets/demo-target/PANORAMA.md"), "utf8");
    expect(panorama).toContain("Manual text must survive checkpoint.");
    expect(panorama).toContain("| External entry | reviewed | demo-v1 | 1 | [[knowledge/external-entry]] |");
    expect(panorama).toContain("[[investigations/auth-bypass|Authentication bypass]]");
    expect(panorama).toContain("[[findings/command-injection|Command injection]]");

    const secondIo = captureIo();
    expect(await runCli(["checkpoint", "demo-target"], root, secondIo.io)).toBe(0);
    expect(secondIo.stdout()).toContain("No generated Panorama changes.");
  });

  it("does not write Panorama when a hard validation error exists", async () => {
    const root = await createVault({ brokenLink: true });
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const before = await fs.readFile(panoramaPath, "utf8");
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("broken-wikilink");
    expect(await fs.readFile(panoramaPath, "utf8")).toBe(before);
  });
});
