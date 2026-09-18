import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { displayPath } from "./display-path.js";
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
  markdownLinks: string[];
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

function encodeMarkdownPath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

export function markdownLink(label: string, relativePath: string): string {
  const escapedLabel = label.replaceAll("\\", "\\\\").replace(/[\[\]|]/g, "\\$&");
  return `[${escapedLabel}](${encodeMarkdownPath(relativePath)})`;
}

interface InlineMarkdownLink {
  end: number;
  destinationStart: number;
  destinationEnd: number;
  destination: string;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function backtickRunLength(source: string, index: number): number {
  let end = index;
  while (source[end] === "`") end += 1;
  return end - index;
}

function codeSpanEnd(source: string, start: number): number | undefined {
  const openingLength = backtickRunLength(source, start);
  let cursor = start + openingLength;
  while (cursor < source.length) {
    const next = source.indexOf("`", cursor);
    if (next < 0) return undefined;
    const closingLength = backtickRunLength(source, next);
    if (closingLength === openingLength) return next + closingLength;
    cursor = next + closingLength;
  }
  return undefined;
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function linkEndAfterDestination(source: string, start: number): number | undefined {
  let cursor = skipWhitespace(source, start);
  if (source[cursor] === ")") return cursor + 1;

  const opener = source[cursor];
  const closer = opener === '"' ? '"' : opener === "'" ? "'" : opener === "(" ? ")" : undefined;
  if (!closer) return undefined;
  cursor += 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\" && cursor + 1 < source.length) {
      cursor += 2;
      continue;
    }
    if (source[cursor] === closer) {
      cursor = skipWhitespace(source, cursor + 1);
      return source[cursor] === ")" ? cursor + 1 : undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function inlineMarkdownLinkAt(source: string, start: number): InlineMarkdownLink | undefined {
  if (
    source[start] !== "[" ||
    isEscaped(source, start) ||
    (source[start - 1] === "!" && !isEscaped(source, start - 1))
  ) {
    return undefined;
  }

  let cursor = start + 1;
  let labelDepth = 1;
  while (cursor < source.length && labelDepth > 0) {
    if (source[cursor] === "\\" && cursor + 1 < source.length) {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "[") labelDepth += 1;
    if (source[cursor] === "]") labelDepth -= 1;
    cursor += 1;
  }
  if (labelDepth !== 0 || source[cursor] !== "(") return undefined;

  cursor = skipWhitespace(source, cursor + 1);
  let destinationStart: number;
  let destinationEnd: number | undefined;
  let end: number | undefined;
  if (source[cursor] === "<") {
    destinationStart = cursor + 1;
    cursor = destinationStart;
    while (cursor < source.length && source[cursor] !== "\n") {
      if (source[cursor] === "\\" && cursor + 1 < source.length) {
        cursor += 2;
        continue;
      }
      if (source[cursor] === ">") break;
      cursor += 1;
    }
    if (source[cursor] !== ">") return undefined;
    destinationEnd = cursor;
    end = linkEndAfterDestination(source, cursor + 1);
  } else {
    destinationStart = cursor;
    let parenthesisDepth = 0;
    while (cursor < source.length) {
      if (source[cursor] === "\\" && cursor + 1 < source.length) {
        cursor += 2;
        continue;
      }
      if (source[cursor] === "(") {
        parenthesisDepth += 1;
        cursor += 1;
        continue;
      }
      if (source[cursor] === ")") {
        if (parenthesisDepth === 0) {
          destinationEnd = cursor;
          end = cursor + 1;
          break;
        }
        parenthesisDepth -= 1;
        cursor += 1;
        continue;
      }
      if (/\s/.test(source[cursor] ?? "")) {
        destinationEnd = cursor;
        end = linkEndAfterDestination(source, cursor);
        break;
      }
      cursor += 1;
    }
  }

  if (destinationEnd === undefined || end === undefined) return undefined;
  return {
    end,
    destinationStart,
    destinationEnd,
    destination: source.slice(destinationStart, destinationEnd),
  };
}

function inlineMarkdownLinks(source: string): InlineMarkdownLink[] {
  const links: InlineMarkdownLink[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] === "`" && !isEscaped(source, cursor)) {
      const end = codeSpanEnd(source, cursor);
      if (end !== undefined) {
        cursor = end;
        continue;
      }
      cursor += backtickRunLength(source, cursor);
      continue;
    }
    const link = inlineMarkdownLinkAt(source, cursor);
    if (link) {
      links.push(link);
      cursor = link.end;
      continue;
    }
    cursor += 1;
  }
  return links;
}

interface ResolvedMarkdownDestination {
  path: string;
  suffix: string;
}

function resolveMarkdownDestination(
  destination: string,
  sourceRelativePath: string,
): ResolvedMarkdownDestination | undefined {
  const trimmed = destination.trim();
  let suffixIndex = -1;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === "\\") {
      index += 1;
      continue;
    }
    if (trimmed[index] === "?" || trimmed[index] === "#") {
      suffixIndex = index;
      break;
    }
  }
  const encodedPath = suffixIndex < 0 ? trimmed : trimmed.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : trimmed.slice(suffixIndex);
  const normalizedSourcePath = path.posix.normalize(sourceRelativePath.replaceAll("\\", "/"));
  if (!encodedPath) {
    return suffix ? { path: normalizedSourcePath, suffix } : undefined;
  }
  if (encodedPath.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(encodedPath)) {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  let unescapedPath = "";
  for (let index = 0; index < decodedPath.length; index += 1) {
    const character = decodedPath[index] ?? "";
    const next = decodedPath[index + 1];
    const nextCode = next?.charCodeAt(0) ?? 0;
    const punctuation =
      (nextCode >= 33 && nextCode <= 47) ||
      (nextCode >= 58 && nextCode <= 64) ||
      (nextCode >= 91 && nextCode <= 96) ||
      (nextCode >= 123 && nextCode <= 126);
    if (character === "\\" && next && punctuation) {
      unescapedPath += next;
      index += 1;
    } else {
      unescapedPath += character;
    }
  }
  if (path.posix.isAbsolute(unescapedPath) || /^[a-z][a-z0-9+.-]*:/i.test(unescapedPath)) {
    return undefined;
  }

  const sourceDirectory = path.posix.dirname(normalizedSourcePath);
  return {
    path: path.posix.normalize(
      path.posix.join(sourceDirectory === "." ? "" : sourceDirectory, unescapedPath),
    ),
    suffix,
  };
}

export function markdownLinkKeys(content: string, sourceRelativePath: string): string[] {
  const keys: string[] = [];
  for (const link of inlineMarkdownLinks(markdownStructuralText(content))) {
    const resolved = resolveMarkdownDestination(link.destination, sourceRelativePath);
    if (
      !resolved ||
      !/\.md$/i.test(resolved.path) ||
      resolved.path === ".." ||
      resolved.path.startsWith("../")
    ) {
      continue;
    }
    keys.push(normalizeKey(resolved.path));
  }
  return keys;
}

export function rebaseMarkdownLinks(
  content: string,
  sourceRelativePath: string,
  destinationRelativePath: string,
): string {
  const destinationDirectory = path.posix.dirname(destinationRelativePath.replaceAll("\\", "/"));
  let cursor = 0;
  let result = "";
  for (const link of inlineMarkdownLinks(content)) {
    result += content.slice(cursor, link.destinationStart);
    const resolved = resolveMarkdownDestination(link.destination, sourceRelativePath);
    if (!resolved) {
      result += link.destination;
    } else {
      const rebasedPath = path.posix.relative(
        destinationDirectory === "." ? "" : destinationDirectory,
        resolved.path,
      );
      result += `${encodeMarkdownPath(rebasedPath || path.posix.basename(resolved.path))}${resolved.suffix}`;
    }
    cursor = link.destinationEnd;
  }
  return result + content.slice(cursor);
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

// Vault Markdown is parsed, compared, and rewritten with LF endings; pages
// saved with CRLF by Windows editors are normalized once at load.
function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const title = firstHeading(parsed.content, 1) || path.basename(normalizedRelativePath, ".md");
  const wikilinks = wikilinkKeys(parsed.content);
  const markdownLinks = markdownLinkKeys(parsed.content, normalizedRelativePath);
  return {
    absolutePath,
    relativePath: normalizedRelativePath,
    key: normalizeKey(normalizedRelativePath),
    title,
    data: parsed.data as Record<string, unknown>,
    frontmatter: frontmatterSource(raw),
    body: parsed.content,
    raw,
    wikilinks,
    markdownLinks,
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
      const relativePath = path
        .relative(location.targetRoot, absolutePath)
        .replaceAll("\\", "/");
      return parseNote(
        absolutePath,
        relativePath,
        normalizeNewlines(await fs.readFile(absolutePath, "utf8")),
      );
    }),
  );
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const panorama = notes.find((note) => note.relativePath === "PANORAMA.md");
  if (!panorama) throw new Error(`Missing ${displayPath(path.join(location.targetRoot, "PANORAMA.md"))}`);
  return { ...location, panorama, notes };
}

export async function loadTarget(vaultRoot: string, targetId: string): Promise<TargetVault> {
  return loadTargetAt(centralTargetLocation(vaultRoot, targetId));
}
