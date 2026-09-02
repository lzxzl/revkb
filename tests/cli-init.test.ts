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
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  };
}

describe("revkb CLI initialization", () => {
  it.each([
    ["--help"],
    ["-h"],
    ["help"],
    ["init", "--help"],
    ["context", "--help"],
    ["checkpoint", "-h"],
  ])("prints help successfully for %j", async (...args) => {
    const io = captureIo();
    expect(await runCli(args, process.cwd(), io.io)).toBe(0);
    expect(io.stdout()).toContain("revkb init [<target-id>] --artifact <path>");
    expect(io.stderr()).toBe("");
  });

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
  ])("reports a syntax error for $args", async ({ args, message }) => {
    const io = captureIo();
    expect(await runCli(args, process.cwd(), io.io)).toBe(2);
    expect(io.stderr()).toContain(message);
    expect(io.stderr()).toContain("revkb context [<target-id>]");
  });

  it("initializes and operates a local Target without repeating its ID", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-cli-local-"));
    await fs.writeFile(path.join(workspace, "app.apk"), "abc");
    await fs.writeFile(path.join(workspace, "native.so"), "native");

    const initIo = captureIo();
    expect(
      await runCli(
        [
          "init",
          "--target",
          "yuanbao",
          "--snapshot",
          "yuanbao-5040",
          "--artifact",
          "app.apk",
          "--artifact",
          "native.so",
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
    expect(initIo.stdout()).toContain(
      "Initialized targets/demo for demo at Snapshot demo-initial",
    );
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
      await runCli(
        ["init", "--target", "nested", "--artifact", "../app.apk"],
        nested,
        secondIo.io,
      ),
    ).toBe(1);
    expect(secondIo.stderr()).toContain(
      `Already inside local Target at ${path.join(workspace, ".revkb")}`,
    );
    await expect(fs.stat(path.join(nested, ".revkb"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("initializes and operates local mode through the compiled binary", async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: path.resolve(".") });
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "revkb-bin-local-"));
    const targetId = path.basename(workspace);
    await fs.writeFile(path.join(workspace, "sample.apk"), "abc");
    const cli = path.resolve("dist/cli.js");
    const run = (args: string[]) =>
      execFileAsync(process.execPath, [cli, ...args], { cwd: workspace });

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
});
