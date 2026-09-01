import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const HASH = "a".repeat(64);
const execFileAsync = promisify(execFile);

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

## Key attack surfaces
- External parser
- Privileged native dispatch

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
[[snapshots/demo-v1]]

Manual text must survive checkpoint.
`,
  );
  await fs.writeFile(
    path.join(target, "snapshots/demo-v1.md"),
    `---
kind: snapshot
target: demo-target
snapshot: demo-v1
created: 2026-09-01T00:00:00Z
---
# Demo v1

| Type | Path | SHA-256 |
|---|---|---|
| so | artifacts/libdemo.so | ${HASH} |

## Known changes
Initial Snapshot.
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

## Impact
An unauthenticated caller can execute a native command.

## Preconditions
The external entry is reachable.

## Related
[[knowledge/external-entry]]
[[investigations/auth-bypass]]

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
  it.each(["", ".", "..", "../outside", "nested/target"])(
    "rejects an unsafe Target ID %j",
    async (targetId) => {
      const io = captureIo();

      expect(await runCli(["checkpoint", targetId], "/tmp/revkb-target-id-test", io.io)).toBe(2);
      expect(io.stderr()).toBe("Usage: revkb context <target-id> | revkb checkpoint <target-id>\n");
    },
  );

  it("runs context through an npm-style bin symlink", async () => {
    const root = await createVault();
    await execFileAsync("npm", ["run", "build"], { cwd: path.resolve(".") });
    const binDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-bin-"));
    const binPath = path.join(binDirectory, "revkb");
    await fs.symlink(path.resolve("dist/cli.js"), binPath);

    const result = await execFileAsync(process.execPath, [binPath, "context", "demo-target"], {
      cwd: root,
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("# Reverse Audit Context: Demo Target");
  });

  it("distinguishes attack surfaces from audit coverage in context", async () => {
    const root = await createVault();
    const io = captureIo();

    expect(await runCli(["context", "demo-target"], root, io.io)).toBe(0);
    expect(io.stdout()).toContain("## High-risk Areas\n- External parser\n- Privileged native dispatch");
    expect(io.stdout()).toContain(
      "## Audit Coverage\n- External entry — reviewed — [[knowledge/external-entry]]",
    );
  });

  it("reports recommended next actions from context and checkpoint", async () => {
    const root = await createVault();
    const contextIo = captureIo();

    expect(await runCli(["context", "demo-target"], root, contextIo.io), contextIo.stderr()).toBe(0);
    expect(contextIo.stdout()).toContain(
      "## Recommended Next Actions\n- Authentication bypass — analyzing — " +
        "Trace the unauthenticated caller into the native dispatcher. — [[investigations/auth-bypass]]",
    );

    const checkpointIo = captureIo();
    expect(
      await runCli(["checkpoint", "demo-target"], root, checkpointIo.io),
      checkpointIo.stderr(),
    ).toBe(0);
    expect(checkpointIo.stdout()).toContain(
      "Next actions:\n- Authentication bypass — analyzing — " +
        "Trace the unauthenticated caller into the native dispatcher. — [[investigations/auth-bypass]]",
    );
  });

  it("prioritizes active Investigation actions over queued Leads", async () => {
    const root = await createVault();
    await fs.writeFile(
      path.join(root, "targets/demo-target/investigations/aaa-queued.md"),
      `---
kind: investigation
target: demo-target
snapshot: demo-v1
status: queued
---
# Earlier filename Lead

## Next action
Inspect the queued branch later.
`,
    );
    const io = captureIo();

    expect(await runCli(["context", "demo-target"], root, io.io)).toBe(0);
    const actions = io.stdout().split("## Recommended Next Actions\n")[1] ?? "";
    expect(actions.indexOf("Authentication bypass")).toBeLessThan(actions.indexOf("Earlier filename Lead"));
  });

  it("rejects unrelated tables as Snapshot Artifact metadata", async () => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(
      snapshotPath,
      snapshot.replace(
        `| Type | Path | SHA-256 |\n|---|---|---|\n| so | artifacts/libdemo.so | ${HASH} |`,
        `| Name | Description | Digest |\n|---|---|---|\n| sample | unrelated | ${HASH} |`,
      ),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-artifact-table");
  });

  it.each([
    { field: "type", row: `| | artifacts/libdemo.so | ${HASH} |`, code: "invalid-artifact-type" },
    { field: "path", row: `| so | | ${HASH} |`, code: "invalid-artifact-path" },
    {
      field: "three-column shape",
      row: `| so | artifacts/libdemo.so | ${HASH} | unexpected |`,
      code: "invalid-artifact-row",
    },
  ])("rejects an Artifact without its $field", async ({ row, code }) => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(snapshotPath, snapshot.replace(`| so | artifacts/libdemo.so | ${HASH} |`, row));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain(code);
  });

  it("warns when a Snapshot omits known changes", async () => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(snapshotPath, snapshot.replace("\n## Known changes\nInitial Snapshot.\n", "\n"));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(0);
    expect(io.stdout()).toContain("WARNING snapshot-without-known-changes snapshots/demo-v1.md:");
  });

  it("warns when a queued Lead omits its next action", async () => {
    const root = await createVault();
    const investigationPath = path.join(root, "targets/demo-target/investigations/auth-bypass.md");
    const investigation = await fs.readFile(investigationPath, "utf8");
    await fs.writeFile(
      investigationPath,
      investigation
        .replace("status: analyzing", "status: queued")
        .replace("\n## Next action\nTrace the unauthenticated caller into the native dispatcher.\n", "\n"),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(0);
    expect(io.stdout()).toContain("WARNING missing-next-action investigations/auth-bypass.md:");
  });

  it.each([
    { label: "missing", created: "", code: "missing-snapshot-created" },
    { label: "malformed", created: "created: someday\n", code: "invalid-snapshot-created" },
    {
      label: "impossible calendar date",
      created: "created: 2026-02-30T00:00:00Z\n",
      code: "invalid-snapshot-created",
    },
    {
      label: "impossible timezone offset",
      created: "created: 2026-09-01T00:00:00+99:99\n",
      code: "invalid-snapshot-created",
    },
  ])("rejects a Snapshot with $label creation time", async ({ created, code }) => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(snapshotPath, snapshot.replace("created: 2026-09-01T00:00:00Z\n", created));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain(code);
  });

  it("does not accept an Artifact table shown only inside a fenced example", async () => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(
      snapshotPath,
      snapshot.replace(
        `| Type | Path | SHA-256 |\n|---|---|---|\n| so | artifacts/libdemo.so | ${HASH} |`,
        `\`\`\`text\n| Type | Path | SHA-256 |\n|---|---|---|\n| so | artifacts/libdemo.so | ${HASH} |\n\`\`\``,
      ),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-artifact-table");
  });

  it.each([
    {
      location: "an HTML comment",
      wrap: (table: string) => `<!--\n${table}\n-->`,
    },
    {
      location: "four-space indented code",
      wrap: (table: string) =>
        table
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n"),
    },
  ])("does not accept an Artifact table shown only inside $location", async ({ wrap }) => {
    const root = await createVault();
    const snapshotPath = path.join(root, "targets/demo-target/snapshots/demo-v1.md");
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    const table = `| Type | Path | SHA-256 |\n|---|---|---|\n| so | artifacts/libdemo.so | ${HASH} |`;
    await fs.writeFile(snapshotPath, snapshot.replace(table, wrap(table)));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-artifact-table");
  });

  it.each([
    {
      field: "impact",
      fragment: "## Impact\nAn unauthenticated caller can execute a native command.\n\n",
      code: "missing-finding-impact",
    },
    {
      field: "preconditions",
      fragment: "## Preconditions\nThe external entry is reachable.\n\n",
      code: "missing-finding-preconditions",
    },
    {
      field: "related architecture or Investigation",
      fragment: "## Related\n[[knowledge/external-entry]]\n[[investigations/auth-bypass]]\n\n",
      code: "missing-finding-related",
    },
  ])("rejects a confirmed Finding without $field", async ({ fragment, code }) => {
    const root = await createVault();
    const findingPath = path.join(root, "targets/demo-target/findings/command-injection.md");
    const finding = await fs.readFile(findingPath, "utf8");
    await fs.writeFile(findingPath, finding.replace(fragment, ""));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain(code);
  });

  it("does not accept a required Finding section shown only inside a fenced example", async () => {
    const root = await createVault();
    const findingPath = path.join(root, "targets/demo-target/findings/command-injection.md");
    const finding = await fs.readFile(findingPath, "utf8");
    await fs.writeFile(
      findingPath,
      finding.replace(
        "## Impact\nAn unauthenticated caller can execute a native command.\n",
        "```text\n## Impact\nAn unauthenticated caller can execute a native command.\n```\n",
      ),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-finding-impact");
  });

  it.each([
    {
      contract: "panorama kind",
      mutate: (source: string) => source.replace("kind: panorama", "kind: evidence"),
      code: "invalid-panorama-kind",
    },
    {
      contract: "title",
      mutate: (source: string) => source.replace("# Demo Target\n\n", ""),
      code: "missing-panorama-title",
    },
    {
      contract: "mandatory section",
      mutate: (source: string) =>
        source.replace("## Key attack surfaces\n- External parser\n- Privileged native dispatch\n\n", ""),
      code: "missing-panorama-section",
    },
    {
      contract: "Mermaid architecture",
      mutate: (source: string) => source.replace("```mermaid", "```text"),
      code: "missing-architecture-diagram",
    },
  ])("rejects a Panorama without its $contract", async ({ mutate, code }) => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    await fs.writeFile(panoramaPath, mutate(panorama));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain(code);
  });

  it("does not accept a mandatory Panorama heading shown only inside a fenced example", async () => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    await fs.writeFile(
      panoramaPath,
      panorama.replace(
        "## Key attack surfaces\n- External parser\n- Privileged native dispatch\n\n",
        "```text\n## Key attack surfaces\n- External parser\n- Privileged native dispatch\n```\n\n",
      ),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-panorama-section");
  });

  it.each([
    {
      location: "an HTML comment",
      replacement: "<!--\n# Demo Target\n-->\n\n",
    },
    {
      location: "four-space indented code",
      replacement: "    # Demo Target\n\n",
    },
  ])("does not accept a Panorama title shown only inside $location", async ({ replacement }) => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    await fs.writeFile(panoramaPath, panorama.replace("# Demo Target\n\n", replacement));
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-panorama-title");
  });

  it("does not accept a Mermaid example nested inside another code fence", async () => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    await fs.writeFile(
      panoramaPath,
      panorama
        .replace("```mermaid", "````text\n```mermaid")
        .replace("```\n\n## Key attack surfaces", "```\n````\n\n## Key attack surfaces"),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("missing-architecture-diagram");
  });

  it.each([
    {
      location: "a fenced code block",
      wrap: (markers: string) => `\`\`\`text\n${markers}\n\`\`\``,
    },
    {
      location: "four-space indented code",
      wrap: (markers: string) =>
        markers
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n"),
    },
  ])("rejects generated-region markers hidden inside $location", async ({ wrap }) => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    const markers = "<!-- revkb:coverage:start -->\n<!-- revkb:coverage:end -->";
    await fs.writeFile(panoramaPath, panorama.replace(markers, wrap(markers)));
    const before = await fs.readFile(panoramaPath, "utf8");
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("invalid-generated-region");
    expect(await fs.readFile(panoramaPath, "utf8")).toBe(before);
  });

  it("rejects generated-region markers under the wrong Panorama section", async () => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    const markers = "<!-- revkb:coverage:start -->\n<!-- revkb:coverage:end -->";
    await fs.writeFile(
      panoramaPath,
      panorama
        .replace(`${markers}\n\n`, "")
        .replace("## Active investigations\n", `## Active investigations\n${markers}\n`),
    );
    const before = await fs.readFile(panoramaPath, "utf8");
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("invalid-generated-region");
    expect(await fs.readFile(panoramaPath, "utf8")).toBe(before);
  });

  it("warns when an architecture area lacks Knowledge coverage", async () => {
    const root = await createVault();
    const panoramaPath = path.join(root, "targets/demo-target/PANORAMA.md");
    const panorama = await fs.readFile(panoramaPath, "utf8");
    await fs.writeFile(
      panoramaPath,
      panorama.replace("[[knowledge/external-entry]]", "[[evidence/runtime-trace]]"),
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(0);
    expect(io.stdout()).toContain("WARNING architecture-area-without-coverage PANORAMA.md:");
    expect(await fs.readFile(panoramaPath, "utf8")).toContain(
      "| evidence/runtime-trace | missing | - | 0 | [[evidence/runtime-trace]] |",
    );
  });

  it("ships a valid idempotent Target template", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-template-"));
    const targetPath = path.join(root, "targets/example-target");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(path.resolve("templates/target"), targetPath, { recursive: true });

    const contextIo = captureIo();
    expect(await runCli(["context", "example-target"], root, contextIo.io)).toBe(0);
    expect(contextIo.stdout()).toContain("## Recommended Next Actions");

    const firstCheckpoint = captureIo();
    expect(await runCli(["checkpoint", "example-target"], root, firstCheckpoint.io)).toBe(0);
    const secondCheckpoint = captureIo();
    expect(await runCli(["checkpoint", "example-target"], root, secondCheckpoint.io)).toBe(0);
    expect(secondCheckpoint.stdout()).toContain("No generated Panorama changes.");
  });

  it("counts every non-dismissed related Investigation in coverage", async () => {
    const root = await createVault();
    await fs.writeFile(
      path.join(root, "targets/demo-target/investigations/completed-review.md"),
      `---
kind: investigation
target: demo-target
snapshot: demo-v1
status: reviewed
---
# Completed review

## Confirmed observations
The reviewed path reaches [[knowledge/external-entry]].
`,
    );
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(0);
    expect(await fs.readFile(path.join(root, "targets/demo-target/PANORAMA.md"), "utf8")).toContain(
      "| External entry | reviewed | demo-v1 | 2 | [[knowledge/external-entry]] |",
    );
  });

  it("reports the Markdown path for malformed frontmatter", async () => {
    const root = await createVault();
    const knowledgePath = path.join(root, "targets/demo-target/knowledge/external-entry.md");
    await fs.writeFile(knowledgePath, "---\nkind: [\n---\n# Broken frontmatter\n");
    const io = captureIo();

    expect(await runCli(["checkpoint", "demo-target"], root, io.io)).toBe(1);
    expect(io.stderr()).toContain("knowledge/external-entry.md");
  });

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
