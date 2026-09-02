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
