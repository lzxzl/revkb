#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath } from "./core/display-path.js";
import { initializeTarget } from "./core/initialize.js";
import { buildContextAt, checkpointAt } from "./core/knowledge-base.js";
import {
  centralTargetLocation,
  discoverLocalTarget,
  findLocalTarget,
  localTargetLocation,
} from "./core/target-location.js";
import { formatIssue, ValidationError } from "./core/validation.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

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

class CliUsageError extends Error {
  override readonly name = "CliUsageError";
}

const usage = `Usage:
  revkb init [<target-id>] --artifact <path> [--artifact <path> ...] [--target <target-id>] [--snapshot <snapshot-id>]
  revkb context [<target-id>]
  revkb checkpoint [<target-id>]
  revkb --help
`;

function isHelp(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

function isValidTargetId(targetId: string): boolean {
  return (
    targetId !== "" && targetId !== "." && targetId !== ".." && path.basename(targetId) === targetId
  );
}

function parseCli(args: string[]): CliCommand {
  if (
    (args.length === 1 && (isHelp(args[0]) || args[0] === "help")) ||
    (args.length === 2 && ["init", "context", "checkpoint"].includes(args[0] ?? "") && isHelp(args[1]))
  ) {
    return { kind: "help" };
  }

  const [name, ...rest] = args;
  if (name === "context" || name === "checkpoint") {
    const positional = rest[0] === "--" ? rest.slice(1) : rest;
    if (rest[0] === "--" && positional.length === 0) {
      throw new CliUsageError("-- requires a Target ID");
    }
    if (rest[0] !== "--") {
      const option = rest.find((argument) => argument.startsWith("-"));
      if (option) throw new CliUsageError(`Unknown option: ${option}`);
    }
    if (positional.length > 1) throw new CliUsageError(`${name} accepts at most one Target ID`);
    const targetId = positional[0];
    if (targetId !== undefined && !isValidTargetId(targetId)) {
      throw new CliUsageError(`Invalid Target ID: ${targetId || "(empty)"}`);
    }
    return targetId === undefined ? { kind: name } : { kind: name, targetId };
  }

  if (name !== "init") {
    throw new CliUsageError(name ? `Unknown command: ${name}` : "A command is required");
  }

  const command: Extract<CliCommand, { kind: "init" }> = {
    kind: "init",
    artifactPaths: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? "";
    if (["--artifact", "--target", "--snapshot"].includes(argument)) {
      const value = rest[index + 1];
      if (value === undefined) throw new CliUsageError(`${argument} requires a value`);
      index += 1;
      if (argument === "--artifact") {
        command.artifactPaths.push(value);
      } else if (argument === "--target") {
        if (command.targetOption !== undefined) {
          throw new CliUsageError("--target may be specified only once");
        }
        command.targetOption = value;
      } else {
        if (command.snapshotId !== undefined) {
          throw new CliUsageError("--snapshot may be specified only once");
        }
        command.snapshotId = value;
      }
      continue;
    }

    if (argument.startsWith("-")) throw new CliUsageError(`Unknown option: ${argument}`);
    if (command.positionalTargetId !== undefined) {
      throw new CliUsageError("init accepts at most one positional Target ID");
    }
    command.positionalTargetId = argument;
  }

  if (command.artifactPaths.length === 0) {
    throw new CliUsageError("At least one --artifact is required");
  }
  if (command.positionalTargetId !== undefined && command.targetOption !== undefined) {
    throw new CliUsageError("Do not combine a positional Target ID with --target");
  }
  return command;
}

export async function runCli(args: string[], cwd: string, io: CliIo): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCli(args);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    io.err(`${error.message}\n${usage}`);
    return 2;
  }

  if (command.kind === "help") {
    io.out(usage);
    return 0;
  }

  try {
    if (command.kind === "init") {
      const existing =
        command.positionalTargetId === undefined ? await findLocalTarget(cwd) : undefined;
      if (existing) throw new Error(`Already inside local Target at ${displayPath(existing.targetRoot)}`);

      const targetId =
        command.positionalTargetId ?? command.targetOption ?? path.basename(path.resolve(cwd));
      const snapshotId = command.snapshotId ?? `${targetId}-initial`;
      const location =
        command.positionalTargetId === undefined
          ? localTargetLocation(cwd, targetId)
          : centralTargetLocation(cwd, targetId);
      const result = await initializeTarget({
        invocationRoot: cwd,
        location,
        snapshotId,
        artifactPaths: command.artifactPaths,
      });
      io.out(
        `Initialized ${displayPath(path.relative(cwd, location.targetRoot))} for ${targetId} at Snapshot ${snapshotId} with ${result.artifacts.length} Artifact(s).\n`,
      );
      return 0;
    }
    const location = command.targetId
      ? centralTargetLocation(cwd, command.targetId)
      : await discoverLocalTarget(cwd);
    if (command.kind === "context") {
      io.out(await buildContextAt(location));
      return 0;
    }

    const result = await checkpointAt(location);
    io.out(
      result.changed
        ? `Updated ${displayPath(path.relative(cwd, result.panoramaPath))}\n`
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
