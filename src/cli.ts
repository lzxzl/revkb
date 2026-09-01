#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext, checkpoint, formatIssue, ValidationError } from "./core/knowledge-base.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

const usage = "Usage: revkb context <target-id> | revkb checkpoint <target-id>\n";

export async function runCli(args: string[], cwd: string, io: CliIo): Promise<number> {
  const targetId = args[1] ?? "";
  const validTargetId =
    targetId !== "" && targetId !== "." && targetId !== ".." && path.basename(targetId) === targetId;
  if (args.length !== 2 || !["context", "checkpoint"].includes(args[0] ?? "") || !validTargetId) {
    io.err(usage);
    return 2;
  }
  const [command = ""] = args;
  try {
    if (command === "context") {
      io.out(await buildContext(cwd, targetId));
      return 0;
    }

    const result = await checkpoint(cwd, targetId);
    io.out(
      result.changed
        ? `Updated ${path.relative(cwd, result.panoramaPath)}\n`
        : "No generated Panorama changes.\n",
    );
    for (const warning of result.warnings) io.out(`${formatIssue(warning)}\n`);
    const actions = result.nextActions.length
      ? result.nextActions.map((action) => `- ${action}`).join("\n")
      : "None.";
    io.out(`Next actions:\n${actions}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ValidationError) {
      for (const item of [...error.report.errors, ...error.report.warnings]) io.err(`${formatIssue(item)}\n`);
    } else {
      io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 1;
  }
}

function canonicalPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

const invokedPath = process.argv[1] ? canonicalPath(process.argv[1]) : "";
if (invokedPath === canonicalPath(fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli(process.argv.slice(2), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
