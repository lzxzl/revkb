import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface Note {
  absolutePath: string;
  relativePath: string;
  key: string;
  title: string;
  data: Record<string, unknown>;
  body: string;
  raw: string;
  wikilinks: string[];
}

export interface TargetVault {
  vaultRoot: string;
  targetRoot: string;
  targetId: string;
  panorama: Note;
  notes: Note[];
}

function normalizeKey(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\.md$/, ""));
}

export function wikilinkKeys(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) =>
    normalizeKey(match[1] ?? ""),
  );
}

export function section(body: string, heading: string): string {
  const lines = body.split("\n");
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    return match?.[1]?.trim().toLowerCase() === wanted;
  });
  if (start < 0) return "";

  const content: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^#{1,2}\s+/.test(line)) break;
    content.push(line);
  }
  return content.join("\n").trim();
}

export function parseNote(absolutePath: string, relativePath: string, raw: string): Note {
  const parsed = (() => {
    try {
      return matter(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${relativePath}: ${message}`, { cause: error });
    }
  })();
  const title = /^#\s+(.+?)\s*$/m.exec(parsed.content)?.[1]?.trim() ?? path.basename(relativePath, ".md");
  const wikilinks = wikilinkKeys(parsed.content);
  return {
    absolutePath,
    relativePath: relativePath.replaceAll("\\", "/"),
    key: normalizeKey(relativePath),
    title,
    data: parsed.data as Record<string, unknown>,
    body: parsed.content,
    raw,
    wikilinks,
  };
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(entryPath)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
  }
  return files.sort();
}

export async function loadTarget(vaultRoot: string, targetId: string): Promise<TargetVault> {
  const targetRoot = path.join(vaultRoot, "targets", targetId);
  const files = await markdownFiles(targetRoot);
  const notes = await Promise.all(
    files.map(async (absolutePath) => {
      const relativePath = path.relative(targetRoot, absolutePath);
      return parseNote(absolutePath, relativePath, await fs.readFile(absolutePath, "utf8"));
    }),
  );
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const panorama = notes.find((note) => note.relativePath === "PANORAMA.md");
  if (!panorama) throw new Error(`Missing targets/${targetId}/PANORAMA.md`);
  return { vaultRoot, targetRoot, targetId, panorama, notes };
}
