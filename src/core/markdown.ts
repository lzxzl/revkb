import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { centralTargetLocation, type TargetLocation } from "./target-location.js";

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
  visibleText: string;
  structuralText: string;
  fenceInfo: string | undefined;
  fenceId: number | undefined;
  fenceBoundary: "open" | "content" | "close" | undefined;
}

interface HtmlBlock {
  end: RegExp | undefined;
  untilBlank: boolean;
}

const blockHtmlTags = [
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center",
  "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "frame", "frameset", "h[1-6]", "head", "header",
  "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav",
  "noframes", "ol", "optgroup", "option", "p", "param", "search", "section", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul",
].join("|");
const blockHtmlTag = new RegExp(
  `^(?: {0,3})<\\/?(?:${blockHtmlTags})(?:\\s|\\/?>|$)`,
  "i",
);

function htmlBlockStart(text: string): HtmlBlock | undefined {
  const literal = /^(?: {0,3})<(script|pre|style|textarea)(?:\s|>|$)/i.exec(text);
  if (literal?.[1]) {
    return { end: new RegExp(`</${literal[1]}\\s*>`, "i"), untilBlank: false };
  }
  return blockHtmlTag.test(text) ? { end: undefined, untilBlank: true } : undefined;
}

function htmlVisibleText(text: string): string {
  return text.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, " ");
}

function scanMarkdown(content: string): MarkdownLine[] {
  let fence: { character: "`" | "~"; length: number; id: number } | undefined;
  let nextFenceId = 1;
  let inHtmlComment = false;
  let htmlBlock: HtmlBlock | undefined;

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
      const activeFence = fence;
      const close = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(text);
      const closesFence =
        close?.[1]?.[0] === activeFence.character && (close[1]?.length ?? 0) >= activeFence.length;
      if (closesFence) fence = undefined;
      return {
        text,
        visibleText: closesFence ? "" : text,
        structuralText: "",
        fenceInfo: undefined,
        fenceId: activeFence.id,
        fenceBoundary: closesFence ? "close" : "content",
      };
    }

    if (htmlBlock) {
      const closesBlock = htmlBlock.end
        ? htmlBlock.end.test(text)
        : htmlBlock.untilBlank && !text.trim();
      if (closesBlock) htmlBlock = undefined;
      return {
        text,
        visibleText: htmlVisibleText(text),
        structuralText: "",
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    if (!inHtmlComment && /^(?: {4}|\t)/.test(text)) {
      return {
        text,
        visibleText: text,
        structuralText: "",
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    if (
      !inHtmlComment &&
      /^ {0,3}<!--\s*revkb:[a-z-]+:(?:start|end)\s*-->\s*$/.test(text)
    ) {
      return {
        text,
        visibleText: "",
        structuralText: text,
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    const structuralText = withoutHtmlComments(text);
    const startedHtmlBlock = !inHtmlComment ? htmlBlockStart(structuralText) : undefined;
    if (startedHtmlBlock) {
      if (!startedHtmlBlock.end?.test(structuralText)) htmlBlock = startedHtmlBlock;
      return {
        text,
        visibleText: htmlVisibleText(structuralText),
        structuralText: "",
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    if (/^(?: {4}|\t)/.test(structuralText)) {
      return {
        text,
        visibleText: structuralText,
        structuralText: "",
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    const open = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(structuralText);
    const delimiter = open?.[1];
    if (!delimiter) {
      return {
        text,
        visibleText: structuralText,
        structuralText,
        fenceInfo: undefined,
        fenceId: undefined,
        fenceBoundary: undefined,
      };
    }

    const fenceId = nextFenceId;
    nextFenceId += 1;
    fence = { character: delimiter[0] as "`" | "~", length: delimiter.length, id: fenceId };
    return {
      text,
      visibleText: "",
      structuralText: "",
      fenceInfo: (open[2] ?? "").trim(),
      fenceId,
      fenceBoundary: "open",
    };
  });
}

export function markdownStructuralText(content: string): string {
  return scanMarkdown(content)
    .map((line) => line.structuralText)
    .join("\n");
}

export function markdownVisibleText(content: string): string {
  return scanMarkdown(content)
    .map((line) => line.visibleText)
    .join("\n");
}

export function fencedCodeBlockBodies(content: string, language: string): string[] {
  const lines = scanMarkdown(content);
  const wanted = language.trim().toLowerCase();
  const fenceIds = lines
    .filter(
      (line) =>
        line.fenceBoundary === "open" &&
        line.fenceInfo?.split(/\s+/, 1)[0]?.toLowerCase() === wanted,
    )
    .map((line) => line.fenceId)
    .filter((id): id is number => id !== undefined);
  return fenceIds.map((id) =>
    lines
      .filter((line) => line.fenceId === id && line.fenceBoundary === "content")
      .map((line) => line.text)
      .join("\n"),
  );
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

export function visibleSection(body: string, heading: string): string {
  return markdownVisibleText(section(body, heading)).trim();
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

export async function loadTargetAt(location: TargetLocation): Promise<TargetVault> {
  const files = await markdownFiles(location.targetRoot);
  const notes = await Promise.all(
    files.map(async (absolutePath) => {
      const relativePath = path.relative(location.targetRoot, absolutePath);
      return parseNote(absolutePath, relativePath, await fs.readFile(absolutePath, "utf8"));
    }),
  );
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const panorama = notes.find((note) => note.relativePath === "PANORAMA.md");
  if (!panorama) throw new Error(`Missing ${path.join(location.targetRoot, "PANORAMA.md")}`);
  return { ...location, panorama, notes };
}

export async function loadTarget(vaultRoot: string, targetId: string): Promise<TargetVault> {
  return loadTargetAt(centralTargetLocation(vaultRoot, targetId));
}
