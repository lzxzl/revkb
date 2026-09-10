import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  initializeTarget,
  portableRelativeArtifactPath,
} from "../src/core/initialize.js";
import { buildContextAt, checkpointAt } from "../src/core/knowledge-base.js";
import { localTargetLocation } from "../src/core/target-location.js";

const CREATED = new Date("2026-09-02T12:00:00.000Z");
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

async function expectAbsent(candidate: string): Promise<void> {
  await expect(fs.stat(candidate)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("initializeTarget", () => {
  it("rejects an Artifact on a different Windows volume", () => {
    expect(() =>
      portableRelativeArtifactPath("C:\\work", "D:\\artifacts\\app.apk", path.win32),
    ).toThrow("Artifact cannot be recorded relative to the invocation directory");
    expect(
      portableRelativeArtifactPath("C:\\work", "C:\\artifacts\\app.apk", path.win32),
    ).toBe("../artifacts/app.apk");
  });

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
    expect(await fs.readFile(path.join(workspace, ".revkb/PANORAMA.md"), "utf8")).toContain(
      "[yuanbao-5040](snapshots/yuanbao-5040.md)",
    );

    const context = await buildContextAt(location);
    expect(context).toContain("Initial target analysis — queued");
    expect(context).toContain(
      "Inventory external entry points, major runtime modules, and trust boundaries.",
    );
    expect(context).not.toContain("Example confirmed finding");

    expect((await checkpointAt(location)).changed).toBe(true);
    expect((await checkpointAt(location)).changed).toBe(false);
  });

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

  it("accepts valid IDs that YAML would otherwise coerce to non-string values", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-yaml-id-"));
    await fs.writeFile(path.join(workspace, "app.apk"), "abc");
    const location = localTargetLocation(workspace, "123");

    await initializeTarget({
      invocationRoot: workspace,
      location,
      snapshotId: "true",
      artifactPaths: ["app.apk"],
    });

    expect(await buildContextAt(location)).toContain("# Reverse Audit Context: 123");
  });

  it("supports a Snapshot ID that already ends in .md", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-dot-id-"));
    await fs.writeFile(path.join(workspace, "app.apk"), "abc");
    const location = localTargetLocation(workspace, "demo");

    await initializeTarget({
      invocationRoot: workspace,
      location,
      snapshotId: "release.md",
      artifactPaths: ["app.apk"],
    });

    expect(await fs.stat(path.join(workspace, ".revkb/snapshots/release.md.md"))).toBeDefined();
    expect(await buildContextAt(location)).toContain("Active Snapshot: release.md");
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

    expect(
      result.artifacts.map(({ type, path: artifactPath }) => ({ type, path: artifactPath })),
    ).toEqual([
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

  it("rejects an empty Artifact list before publishing", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-empty-"));
    await expect(
      initializeTarget({
        invocationRoot: workspace,
        location: localTargetLocation(workspace, "demo"),
        snapshotId: "demo-initial",
        artifactPaths: [],
      }),
    ).rejects.toThrow("At least one Artifact is required");
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

  it("escapes HTML syntax in Artifact paths without changing returned metadata", async () => {
    if (process.platform === "win32") return;
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-init-html-path-"));
    const commentPath = "foo<!--.apk";
    const htmlPath = "<img src=x onerror=boom>.apk";
    const linkPath = "[click](javascript:boom).apk";
    await fs.writeFile(path.join(workspace, commentPath), "abc");
    await fs.writeFile(path.join(workspace, htmlPath), "native");
    await fs.writeFile(path.join(workspace, linkPath), "link");

    const result = await initializeTarget({
      invocationRoot: workspace,
      location: localTargetLocation(workspace, "demo"),
      snapshotId: "demo-initial",
      artifactPaths: [commentPath, htmlPath, linkPath],
    });

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      commentPath,
      htmlPath,
      linkPath,
    ]);
    const snapshot = await fs.readFile(
      path.join(workspace, ".revkb/snapshots/demo-initial.md"),
      "utf8",
    );
    expect(snapshot).toContain("foo&lt;!--.apk");
    expect(snapshot).toContain("&lt;img src=x onerror=boom&gt;.apk");
    expect(snapshot).not.toContain("<img src=x onerror=boom>");
    expect(snapshot).toContain("&#91;click&#93;&#40;javascript:boom&#41;.apk");
    expect(snapshot).not.toContain("[click](javascript:boom)");
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
});
