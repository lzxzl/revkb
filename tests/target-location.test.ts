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

  it("discovers and runs a local Target from workspace and nested directories", async () => {
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
