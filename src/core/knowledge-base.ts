import fs from "node:fs/promises";
import path from "node:path";
import { loadTarget, section, type Note, type TargetVault } from "./markdown.js";

const kinds = new Set(["panorama", "snapshot", "knowledge", "investigation", "finding", "evidence"]);
const statuses = new Set([
  "discovered",
  "queued",
  "analyzing",
  "reviewed",
  "blocked",
  "dismissed",
  "needs-revalidation",
]);
const generatedRegions = ["coverage", "investigations", "leads", "findings"] as const;

export interface Issue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
}

export interface CheckpointResult {
  panoramaPath: string;
  changed: boolean;
  warnings: Issue[];
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";

  constructor(public readonly report: ValidationReport) {
    super("Target validation failed");
  }
}

function value(note: Note, field: string): string {
  const candidate = note.data[field];
  return typeof candidate === "string" ? candidate : "";
}

function issue(
  severity: Issue["severity"],
  code: string,
  note: Note,
  message: string,
): Issue {
  return { severity, code, path: note.relativePath, message };
}

function count(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

function artifactHashes(note: Note): string[] {
  return note.body
    .split("\n")
    .filter((line) => /^\|.+\|$/.test(line.trim()))
    .slice(2)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim())[2] ?? "");
}

function validate(target: TargetVault): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const notesByKey = new Map(target.notes.map((note) => [note.key, note]));
  const snapshots = new Set(
    target.notes.filter((note) => value(note, "kind") === "snapshot").map((note) => value(note, "snapshot")),
  );
  const activeSnapshot = value(target.panorama, "snapshot");

  for (const note of target.notes) {
    const kind = value(note, "kind");
    const snapshot = value(note, "snapshot");
    const status = value(note, "status");

    if (!kinds.has(kind)) errors.push(issue("error", "invalid-kind", note, "kind is missing or unsupported"));
    if (value(note, "target") !== target.targetId) {
      errors.push(issue("error", "wrong-target", note, `target must be ${target.targetId}`));
    }
    if (!snapshot) errors.push(issue("error", "missing-snapshot", note, "snapshot is required"));
    if (kind !== "snapshot" && snapshot && !snapshots.has(snapshot)) {
      errors.push(issue("error", "unknown-snapshot", note, `Snapshot ${snapshot} does not exist`));
    }
    if ((kind === "knowledge" || kind === "investigation") && !statuses.has(status)) {
      errors.push(issue("error", "unknown-status", note, `status ${status || "(missing)"} is unsupported`));
    }
    if (kind === "finding" && status !== "confirmed") {
      errors.push(issue("error", "unconfirmed-finding", note, "Findings require status: confirmed"));
    }
    if (kind === "finding" && !section(note.body, "Evidence")) {
      errors.push(issue("error", "finding-without-evidence", note, "Confirmed Finding requires Evidence"));
    }
    if (kind === "snapshot") {
      const hashes = artifactHashes(note);
      if (hashes.length === 0) errors.push(issue("error", "missing-artifact", note, "Snapshot requires an Artifact table"));
      if (hashes.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))) {
        errors.push(issue("error", "invalid-artifact-hash", note, "Artifact SHA-256 must contain 64 hex characters"));
      }
      const parent = value(note, "parent");
      if (parent && !snapshots.has(parent)) {
        errors.push(issue("error", "missing-parent-snapshot", note, `Parent Snapshot ${parent} does not exist`));
      }
    }
    for (const link of note.wikilinks) {
      if (!notesByKey.has(link)) errors.push(issue("error", "broken-wikilink", note, `[[${link}]] does not exist`));
    }
    if (kind === "knowledge" && status === "reviewed" && !section(note.body, "Evidence")) {
      warnings.push(issue("warning", "reviewed-without-evidence", note, "Reviewed Knowledge should include Evidence"));
    }
    if (kind === "investigation" && ["analyzing", "blocked"].includes(status) && !section(note.body, "Next action")) {
      warnings.push(issue("warning", "missing-next-action", note, "Active Investigation should name its next action"));
    }
    if (
      ["knowledge", "investigation"].includes(kind) &&
      snapshot &&
      activeSnapshot &&
      snapshot !== activeSnapshot &&
      status !== "needs-revalidation"
    ) {
      warnings.push(issue("warning", "stale-snapshot", note, `Page is scoped to ${snapshot}, not ${activeSnapshot}`));
    }
  }

  if (!snapshots.has(activeSnapshot)) {
    errors.push(issue("error", "unknown-active-snapshot", target.panorama, `Active Snapshot ${activeSnapshot} does not exist`));
  }

  for (const name of generatedRegions) {
    const start = `<!-- revkb:${name}:start -->`;
    const end = `<!-- revkb:${name}:end -->`;
    if (count(target.panorama.raw, start) !== 1 || count(target.panorama.raw, end) !== 1) {
      errors.push(issue("error", "invalid-generated-region", target.panorama, `${name} markers must appear exactly once`));
    } else if (target.panorama.raw.indexOf(start) > target.panorama.raw.indexOf(end)) {
      errors.push(issue("error", "invalid-generated-region", target.panorama, `${name} markers are reversed`));
    }
  }

  const sort = (left: Issue, right: Issue) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code);
  return { errors: errors.sort(sort), warnings: warnings.sort(sort) };
}

function architectureAreas(panorama: Note): string[] {
  const architecture = section(panorama.body, "Overall architecture");
  return [
    ...new Set(
      [...architecture.matchAll(/^\s*%%\s+revkb-area:\s+\[\[([^\]]+)\]\]\s*$/gm)].map(
        (match) => (match[1] ?? "").replace(/\.md$/, ""),
      ),
    ),
  ].sort();
}

function firstLine(content: string): string {
  return content.split("\n").map((line) => line.trim()).find(Boolean) ?? "Not recorded.";
}

function bullets(lines: string[]): string {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "None.";
}

function openInvestigation(status: string): boolean {
  return status !== "dismissed" && status !== "reviewed";
}

function generated(target: TargetVault): Record<(typeof generatedRegions)[number], string> {
  const notesByKey = new Map(target.notes.map((note) => [note.key, note]));
  const investigations = target.notes.filter((note) => value(note, "kind") === "investigation");
  const coverageRows = architectureAreas(target.panorama).map((key) => {
    const note = notesByKey.get(key);
    if (!note) return `| ${key} | missing | - | 0 | [[${key}]] |`;
    const branchCount = investigations.filter(
      (candidate) => openInvestigation(value(candidate, "status")) && candidate.wikilinks.includes(key),
    ).length;
    return `| ${note.title} | ${value(note, "status")} | ${value(note, "snapshot")} | ${branchCount} | [[${key}]] |`;
  });

  const coverage = [
    "| Area | Status | Snapshot | Open branches | Detail |",
    "|---|---|---|---:|---|",
    ...coverageRows,
  ].join("\n");
  const investigationLines = investigations
    .filter((note) => ["analyzing", "blocked"].includes(value(note, "status")))
    .map((note) => `[[${note.key}|${note.title}]] — ${value(note, "status")} — Next: ${firstLine(section(note.body, "Next action"))}`);
  const leadLines = investigations
    .filter((note) => ["discovered", "queued", "needs-revalidation"].includes(value(note, "status")))
    .map((note) => `[[${note.key}|${note.title}]] — ${value(note, "status")}`);
  const findingLines = target.notes
    .filter((note) => value(note, "kind") === "finding" && value(note, "status") === "confirmed")
    .map((note) => `[[${note.key}|${note.title}]]`);
  return {
    coverage,
    investigations: bullets(investigationLines),
    leads: bullets(leadLines),
    findings: bullets(findingLines),
  };
}

function replaceRegion(source: string, name: (typeof generatedRegions)[number], body: string): string {
  const start = `<!-- revkb:${name}:start -->`;
  const end = `<!-- revkb:${name}:end -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex || source.indexOf(start, startIndex + 1) >= 0) {
    throw new Error(`Invalid ${name} generated-region markers`);
  }
  return `${source.slice(0, startIndex + start.length)}\n${body.trim()}\n${source.slice(endIndex)}`;
}

function renderPanorama(target: TargetVault): string {
  const bodies = generated(target);
  return generatedRegions.reduce((source, name) => replaceRegion(source, name, bodies[name]), target.panorama.raw);
}

function requireValid(target: TargetVault): ValidationReport {
  const report = validate(target);
  if (report.errors.length) throw new ValidationError(report);
  return report;
}

export async function buildContext(vaultRoot: string, targetId: string): Promise<string> {
  const target = await loadTarget(vaultRoot, targetId);
  const report = requireValid(target);
  const areas = architectureAreas(target.panorama)
    .map((key) => target.notes.find((note) => note.key === key))
    .filter((note): note is Note => Boolean(note));
  const investigations = target.notes.filter((note) => value(note, "kind") === "investigation");
  const active = investigations
    .filter((note) => ["analyzing", "blocked"].includes(value(note, "status")))
    .map(
      (note) =>
        `${note.title} — ${value(note, "status")} — Next: ${firstLine(section(note.body, "Next action"))} — [[${note.key}]]`,
    );
  const leads = investigations
    .filter((note) => ["discovered", "queued", "needs-revalidation"].includes(value(note, "status")))
    .map((note) => `${note.title} — ${value(note, "status")} — [[${note.key}]]`);
  const findings = target.notes
    .filter((note) => value(note, "kind") === "finding" && value(note, "status") === "confirmed")
    .map((note) => `${note.title} — [[${note.key}]]`);
  const warningLines = report.warnings.map((item) => `${item.code} ${item.path}: ${item.message}`);

  return `# Reverse Audit Context: ${target.panorama.title}

Active Snapshot: ${value(target.panorama, "snapshot")}

## Current Architecture
${section(target.panorama.body, "Current understanding") || "Not recorded."}

## High-risk Areas
${bullets(areas.map((note) => `${note.title} — ${value(note, "status")} — [[${note.key}]]`))}

## Active Investigations
${bullets(active)}

## Unreviewed Leads
${bullets(leads)}

## Confirmed Findings
${bullets(findings)}

## Warnings
${bullets(warningLines)}
`;
}

export async function checkpoint(vaultRoot: string, targetId: string): Promise<CheckpointResult> {
  const target = await loadTarget(vaultRoot, targetId);
  const report = requireValid(target);
  const rendered = renderPanorama(target);
  if (rendered === target.panorama.raw) {
    return { panoramaPath: target.panorama.absolutePath, changed: false, warnings: report.warnings };
  }

  const tempPath = `${target.panorama.absolutePath}.revkb-tmp`;
  let created = false;
  try {
    const handle = await fs.open(tempPath, "wx");
    created = true;
    try {
      await handle.writeFile(rendered, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, target.panorama.absolutePath);
    created = false;
  } finally {
    if (created) await fs.unlink(tempPath).catch(() => undefined);
  }
  return { panoramaPath: target.panorama.absolutePath, changed: true, warnings: report.warnings };
}

export function formatIssue(item: Issue): string {
  return `${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`;
}
