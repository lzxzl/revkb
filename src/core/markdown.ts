import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface Note {
  absolutePath: string;
  relativePath: string;
  key: string;
  title: string;
  data: Record<string, unknown>;
  frontmatter: string;
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

interface MarkdownLine {
  text: string;
  inFencedCode: boolean;
  fenceInfo: string | undefined;
}

function scanMarkdown(content: string): MarkdownLine[] {
  let fence: { character: "`" | "~"; length: number } | undefined;
  return content.split("\n").map((text) => {
    if (fence) {
      const close = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(text);
      const closesFence =
        close?.[1]?.[0] === fence.character && (close[1]?.length ?? 0) >= fence.length;
      if (closesFence) fence = undefined;
      return { text, inFencedCode: true, fenceInfo: undefined };
    }

    const open = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    const delimiter = open?.[1];
    if (!delimiter) return { text, inFencedCode: false, fenceInfo: undefined };

    fence = { character: delimiter[0] as "`" | "~", length: delimiter.length };
    return { text, inFencedCode: true, fenceInfo: (open[2] ?? "").trim() };
  });
}

export function markdownOutsideFencedCode(content: string): string {
  return scanMarkdown(content)
    .map((line) => (line.inFencedCode ? "" : line.text))
    .join("\n");
}

export function wikilinkKeys(content: string): string[] {
  return [
    ...markdownOutsideFencedCode(content).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g),
  ].map((match) => normalizeKey(match[1] ?? ""));
}

export function firstHeading(body: string, level: number): string {
  const prefix = "#".repeat(level);
  for (const line of scanMarkdown(body)) {
    if (line.inFencedCode) continue;
    const match = new RegExp(`^${prefix}\\s+(.+?)\\s*$`).exec(line.text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function hasSection(body: string, heading: string): boolean {
  const wanted = heading.trim().toLowerCase();
  return scanMarkdown(body).some((line) => {
    if (line.inFencedCode) return false;
    const match = /^##\s+(.+?)\s*$/.exec(line.text);
    return match?.[1]?.trim().toLowerCase() === wanted;
  });
}

export function hasFencedCodeBlock(body: string, language: string): boolean {
  const wanted = language.trim().toLowerCase();
  return scanMarkdown(body).some(
    (line) => line.fenceInfo?.split(/\s+/, 1)[0]?.toLowerCase() === wanted,
  );
}

export function section(body: string, heading: string): string {
  const lines = scanMarkdown(body);
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => {
    if (line.inFencedCode) return false;
    const match = /^##\s+(.+?)\s*$/.exec(line.text);
    return match?.[1]?.trim().toLowerCase() === wanted;
  });
  if (start < 0) return "";

  const content: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (!line.inFencedCode && /^#{1,2}\s+/.test(line.text)) break;
    content.push(line.text);
  }
  return content.join("\n").trim();
}

function frontmatterSource(raw: string): string {
  return /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)?.[1] ?? "";
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
  const title = firstHeading(parsed.content, 1) || path.basename(relativePath, ".md");
  const wikilinks = wikilinkKeys(parsed.content);
  return {
    absolutePath,
    relativePath: relativePath.replaceAll("\\", "/"),
    key: normalizeKey(relativePath),
    title,
    data: parsed.data as Record<string, unknown>,
    frontmatter: frontmatterSource(raw),
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
