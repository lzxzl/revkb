import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { displayPath } from "./display-path.js";

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

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

async function targetIdFromPanorama(panoramaPath: string): Promise<string> {
  const raw = await fs.readFile(panoramaPath, "utf8");
  const parsed = (() => {
    try {
      return matter(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${displayPath(panoramaPath)}: ${message}`, { cause: error });
    }
  })();
  const targetId = parsed.data.target;
  if (typeof targetId !== "string" || !targetId.trim()) {
    throw new Error(`${displayPath(panoramaPath)}: frontmatter target must be a nonempty string`);
  }
  return targetId;
}

export async function findLocalTarget(startDirectory: string): Promise<TargetLocation | undefined> {
  let current = path.resolve(startDirectory);
  while (true) {
    const panoramaPath = path.join(current, ".revkb", "PANORAMA.md");
    if (await isRegularFile(panoramaPath)) {
      return localTargetLocation(current, await targetIdFromPanorama(panoramaPath));
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function discoverLocalTarget(startDirectory: string): Promise<TargetLocation> {
  const location = await findLocalTarget(startDirectory);
  if (!location) {
    throw new Error("No local .revkb Target found; run revkb init or provide a Target ID");
  }
  return location;
}
