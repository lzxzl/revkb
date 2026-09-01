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
  structuralText: string;
  fenceInfo: string | undefined;
}

function scanMarkdown(content: string): MarkdownLine[] {
  let fence: { character: "`" | "~"; length: number } | undefined;
  let inHtmlComment = false;

  const withoutHtmlComments = (text: string): string => {
    let remainder = text;
    let visible = "";
    while (remainder) {
      if (inHtmlComment) {
        const end = remainder.indexOf("-->");
        if (end < 0) return visible;
        inHtmlComment = false;
        remainder = remainder.slice(end + 3);
        continue;
      }

      const start = remainder.indexOf("<!--");
      if (start < 0) return visible + remainder;
      visible += remainder.slice(0, start);
      inHtmlComment = true;
      remainder = remainder.slice(start + 4);
    }
    return visible;
  };

  return content.split("\n").map((text) => {
    if (fence) {
      const close = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(text);
      const closesFence =
        close?.[1]?.[0] === fence.character && (close[1]?.length ?? 0) >= fence.length;
      if (closesFence) fence = undefined;
      return { text, structuralText: "", fenceInfo: undefined };
    }

    if (
      !inHtmlComment &&
      /^ {0,3}<!--\s*revkb:[a-z-]+:(?:start|end)\s*-->\s*$/.test(text)
    ) {
      return { text, structuralText: text, fenceInfo: undefined };
    }

    const structuralText = withoutHtmlComments(text);
    if (/^(?: {4}|\t)/.test(structuralText)) {
      return { text, structuralText: "", fenceInfo: undefined };
    }

    const open = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(structuralText);
    const delimiter = open?.[1];
    if (!delimiter) return { text, structuralText, fenceInfo: undefined };

    fence = { character: delimiter[0] as "`" | "~", length: delimiter.length };
    return { text, structuralText: "", fenceInfo: (open[2] ?? "").trim() };
  });
}

export function markdownStructuralText(content: string): string {
  return scanMarkdown(content)
    .map((line) => line.structuralText)
    .join("\n");
}

export function wikilinkKeys(content: string): string[] {
  return [
    ...markdownStructuralText(content).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g),
  ].map((match) => normalizeKey(match[1] ?? ""));
}

function headingText(line: MarkdownLine, level: number): string {
  const match = new RegExp(`^${"#".repeat(level)}\\s+(.+?)\\s*$`).exec(line.structuralText);
  return match?.[1]?.trim() ?? "";
}

function sectionStart(lines: MarkdownLine[], heading: string): number {
  const wanted = heading.trim().toLowerCase();
  return lines.findIndex((line) => headingText(line, 2).toLowerCase() === wanted);
}

export function firstHeading(body: string, level: number): string {
  for (const line of scanMarkdown(body)) {
    const heading = headingText(line, level);
    if (heading) return heading;
  }
  return "";
}

export function hasSection(body: string, heading: string): boolean {
  return sectionStart(scanMarkdown(body), heading) >= 0;
}

export function hasFencedCodeBlock(body: string, language: string): boolean {
  const wanted = language.trim().toLowerCase();
  return scanMarkdown(body).some(
    (line) => line.fenceInfo?.split(/\s+/, 1)[0]?.toLowerCase() === wanted,
  );
}

export function section(body: string, heading: string): string {
  const lines = scanMarkdown(body);
  const start = sectionStart(lines, heading);
  if (start < 0) return "";

  const content: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (/^#{1,2}\s+/.test(line.structuralText)) break;
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
