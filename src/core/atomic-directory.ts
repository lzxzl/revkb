import fs from "node:fs/promises";
import path from "node:path";
import { displayPath } from "./display-path.js";

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function createDirectoryAtomically(
  finalPath: string,
  populate: (stagingPath: string) => Promise<void>,
): Promise<void> {
  const resolvedFinal = path.resolve(finalPath);
  if (await exists(resolvedFinal)) throw new Error(`Target path already exists: ${displayPath(resolvedFinal)}`);

  const parent = path.dirname(resolvedFinal);
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, `.${path.basename(resolvedFinal)}.revkb-init-`));
  let published = false;
  try {
    await populate(staging);
    if (await exists(resolvedFinal)) throw new Error(`Target path already exists: ${displayPath(resolvedFinal)}`);
    await fs.rename(staging, resolvedFinal);
    published = true;
  } finally {
    if (!published) await fs.rm(staging, { recursive: true, force: true });
  }
}
