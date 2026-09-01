import fs from "node:fs/promises";
import path from "node:path";
import { loadTarget, section, wikilinkKeys, type Note, type TargetVault } from "./markdown.js";

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
const activeInvestigationStatuses = new Set(["analyzing", "blocked"]);
const leadStatuses = new Set(["discovered", "queued", "needs-revalidation"]);
const investigationStatusPriority = new Map([
  ["analyzing", 0],
  ["blocked", 1],
  ["queued", 2],
  ["discovered", 3],
  ["needs-revalidation", 4],
]);
const generatedRegions = ["coverage", "investigations", "leads", "findings"] as const;
const requiredPanoramaSections = [
  "Current understanding",
  "Overall architecture",
  "Key attack surfaces",
  "Audit coverage",
  "Active investigations",
  "Unreviewed branches",
  "Confirmed findings",
  "Snapshots",
] as const;

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
  nextActions: string[];
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";

  constructor(public readonly report: ValidationReport) {
    super("Target validation failed");
  }
}

function frontmatterString(note: Note, field: string): string {
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

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

interface Artifact {
  type: string;
  path: string;
  sha256: string;
  columnCount: number;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function artifactTable(note: Note): Artifact[] | undefined {
  const lines = note.body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = tableCells(line).map((cell) => cell.toLowerCase());
    return cells.length === 3 && cells[0] === "type" && cells[1] === "path" && cells[2] === "sha-256";
  });
  if (headerIndex < 0 || !/^\|(?:\s*:?-+:?\s*\|){3}$/.test((lines[headerIndex + 1] ?? "").trim())) {
    return undefined;
  }

  const artifacts: Artifact[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^\|.*\|$/.test(line.trim())) break;
    const cells = tableCells(line);
    const [type = "", artifactPath = "", sha256 = ""] = cells;
    artifacts.push({ type, path: artifactPath, sha256, columnCount: cells.length });
  }
  return artifacts;
}

function isIsoTimestamp(candidate: unknown): boolean {
  if (candidate instanceof Date) return !Number.isNaN(candidate.getTime());
  return (
    typeof candidate === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) &&
    !Number.isNaN(Date.parse(candidate))
  );
}

function hasSection(note: Note, heading: string): boolean {
  const wanted = heading.trim().toLowerCase();
  return note.body.split("\n").some((line) => {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    return match?.[1]?.trim().toLowerCase() === wanted;
  });
}

function validate(target: TargetVault): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const notesByKey = new Map(target.notes.map((note) => [note.key, note]));
  const snapshots = new Set(
    target.notes
      .filter((note) => frontmatterString(note, "kind") === "snapshot")
      .map((note) => frontmatterString(note, "snapshot")),
  );
  const activeSnapshot = frontmatterString(target.panorama, "snapshot");

  for (const note of target.notes) {
    const kind = frontmatterString(note, "kind");
    const snapshot = frontmatterString(note, "snapshot");
    const status = frontmatterString(note, "status");

    if (!kinds.has(kind)) errors.push(issue("error", "invalid-kind", note, "kind is missing or unsupported"));
    if (frontmatterString(note, "target") !== target.targetId) {
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
    if (kind === "finding" && !section(note.body, "Impact")) {
      errors.push(issue("error", "missing-finding-impact", note, "Confirmed Finding requires Impact"));
    }
    if (kind === "finding" && !section(note.body, "Preconditions")) {
      errors.push(issue("error", "missing-finding-preconditions", note, "Confirmed Finding requires Preconditions"));
    }
    if (
      kind === "finding" &&
      !wikilinkKeys(section(note.body, "Related")).some((key) => {
        const related = notesByKey.get(key);
        return related && ["knowledge", "investigation"].includes(frontmatterString(related, "kind"));
      })
    ) {
      errors.push(
        issue(
          "error",
          "missing-finding-related",
          note,
          "Confirmed Finding requires a Related link to Knowledge or an Investigation",
        ),
      );
    }
    if (kind === "finding" && !section(note.body, "Evidence")) {
      errors.push(issue("error", "finding-without-evidence", note, "Confirmed Finding requires Evidence"));
    }
    if (kind === "snapshot") {
      const created = note.data.created;
      if (created === undefined || created === null || created === "") {
        errors.push(issue("error", "missing-snapshot-created", note, "Snapshot requires an ISO-8601 created time"));
      } else if (!isIsoTimestamp(created)) {
        errors.push(
          issue(
            "error",
            "invalid-snapshot-created",
            note,
            "Snapshot created time must be ISO-8601 with a timezone",
          ),
        );
      }
      if (!section(note.body, "Known changes")) {
        warnings.push(
          issue(
            "warning",
            "snapshot-without-known-changes",
            note,
            "Snapshot should describe known changes relative to its parent",
          ),
        );
      }
      const artifacts = artifactTable(note);
      if (!artifacts) {
        errors.push(
          issue(
            "error",
            "missing-artifact-table",
            note,
            "Snapshot requires a Type | Path | SHA-256 Artifact table",
          ),
        );
      } else if (artifacts.length === 0) {
        errors.push(issue("error", "missing-artifact", note, "Snapshot requires at least one Artifact"));
      }
      if (artifacts?.some((artifact) => artifact.columnCount !== 3)) {
        errors.push(issue("error", "invalid-artifact-row", note, "Artifact rows require exactly three columns"));
      }
      if (artifacts?.some((artifact) => !artifact.type)) {
        errors.push(issue("error", "invalid-artifact-type", note, "Every Artifact requires a type"));
      }
      if (artifacts?.some((artifact) => !artifact.path)) {
        errors.push(issue("error", "invalid-artifact-path", note, "Every Artifact requires a path"));
      }
      if (artifacts?.some((artifact) => !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
        errors.push(issue("error", "invalid-artifact-hash", note, "Artifact SHA-256 must contain 64 hex characters"));
      }
      const parent = frontmatterString(note, "parent");
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
    if (kind === "investigation" && isOpenInvestigationStatus(status) && !section(note.body, "Next action")) {
      warnings.push(
        issue("warning", "missing-next-action", note, "Open Investigation or Lead should name its next action"),
      );
    }
    if (
      ["knowledge", "investigation"].includes(kind) &&
      snapshot &&
      activeSnapshot &&
      snapshot !== activeSnapshot &&
      status !== "needs-revalidation"
    ) {
      warnings.push(
        issue(
          "warning",
          "stale-snapshot",
          note,
          `Revalidate for ${activeSnapshot} and update snapshot, or set status: needs-revalidation; currently ${snapshot}`,
        ),
      );
    }
  }

  if (!snapshots.has(activeSnapshot)) {
    errors.push(issue("error", "unknown-active-snapshot", target.panorama, `Active Snapshot ${activeSnapshot} does not exist`));
  }
  if (frontmatterString(target.panorama, "kind") !== "panorama") {
    errors.push(issue("error", "invalid-panorama-kind", target.panorama, "PANORAMA.md requires kind: panorama"));
  }
  for (const heading of requiredPanoramaSections) {
    if (!hasSection(target.panorama, heading)) {
      errors.push(
        issue("error", "missing-panorama-section", target.panorama, `PANORAMA.md requires ## ${heading}`),
      );
    }
  }
  if (!/```mermaid(?:\s|\n)[\s\S]*?```/i.test(section(target.panorama.body, "Overall architecture"))) {
    errors.push(
      issue(
        "error",
        "missing-architecture-diagram",
        target.panorama,
        "Overall architecture requires a Mermaid diagram",
      ),
    );
  }

  for (const key of architectureAreas(target.panorama)) {
    const coverageNote = notesByKey.get(key);
    if (!coverageNote || frontmatterString(coverageNote, "kind") !== "knowledge") {
      warnings.push(
        issue(
          "warning",
          "architecture-area-without-coverage",
          target.panorama,
          `Architecture area [[${key}]] must reference a Knowledge page`,
        ),
      );
    }
  }

  for (const name of generatedRegions) {
    const start = `<!-- revkb:${name}:start -->`;
    const end = `<!-- revkb:${name}:end -->`;
    if (
      countOccurrences(target.panorama.raw, start) !== 1 ||
      countOccurrences(target.panorama.raw, end) !== 1
    ) {
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

function isOpenInvestigationStatus(status: string): boolean {
  return activeInvestigationStatuses.has(status) || leadStatuses.has(status);
}

function isActiveInvestigation(note: Note): boolean {
  return (
    frontmatterString(note, "kind") === "investigation" &&
    activeInvestigationStatuses.has(frontmatterString(note, "status"))
  );
}

function isLead(note: Note): boolean {
  return frontmatterString(note, "kind") === "investigation" && leadStatuses.has(frontmatterString(note, "status"));
}

function isConfirmedFinding(note: Note): boolean {
  return frontmatterString(note, "kind") === "finding" && frontmatterString(note, "status") === "confirmed";
}

function renderNextActionLines(investigations: Note[]): string[] {
  return [...investigations]
    .sort(
      (left, right) =>
        (investigationStatusPriority.get(frontmatterString(left, "status")) ?? Number.MAX_SAFE_INTEGER) -
          (investigationStatusPriority.get(frontmatterString(right, "status")) ?? Number.MAX_SAFE_INTEGER) ||
        left.relativePath.localeCompare(right.relativePath),
    )
    .filter((note) => isOpenInvestigationStatus(frontmatterString(note, "status")))
    .map((note) => {
      const action = section(note.body, "Next action");
      return action
        ? `${note.title} — ${frontmatterString(note, "status")} — ${firstLine(action)} — [[${note.key}]]`
        : "";
    })
    .filter(Boolean);
}

function generatePanoramaRegions(target: TargetVault): Record<(typeof generatedRegions)[number], string> {
  const notesByKey = new Map(target.notes.map((note) => [note.key, note]));
  const investigations = target.notes.filter((note) => frontmatterString(note, "kind") === "investigation");
  const coverageRows = architectureAreas(target.panorama).map((key) => {
    const note = notesByKey.get(key);
    if (!note || frontmatterString(note, "kind") !== "knowledge") {
      return `| ${key} | missing | - | 0 | [[${key}]] |`;
    }
    const branchCount = investigations.filter(
      (candidate) => frontmatterString(candidate, "status") !== "dismissed" && candidate.wikilinks.includes(key),
    ).length;
    return `| ${note.title} | ${frontmatterString(note, "status")} | ${frontmatterString(note, "snapshot")} | ${branchCount} | [[${key}]] |`;
  });

  const coverage = [
    "| Area | Status | Snapshot | Open branches | Detail |",
    "|---|---|---|---:|---|",
    ...coverageRows,
  ].join("\n");
  const investigationLines = investigations
    .filter(isActiveInvestigation)
    .map((note) => `[[${note.key}|${note.title}]] — ${frontmatterString(note, "status")} — Next: ${firstLine(section(note.body, "Next action"))}`);
  const leadLines = investigations
    .filter(isLead)
    .map((note) => `[[${note.key}|${note.title}]] — ${frontmatterString(note, "status")}`);
  const findingLines = target.notes
    .filter(isConfirmedFinding)
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
  const bodies = generatePanoramaRegions(target);
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
    .filter((note): note is Note => note !== undefined && frontmatterString(note, "kind") === "knowledge");
  const investigations = target.notes.filter((note) => frontmatterString(note, "kind") === "investigation");
  const active = investigations
    .filter(isActiveInvestigation)
    .map((note) => `${note.title} — ${frontmatterString(note, "status")} — [[${note.key}]]`);
  const leads = investigations
    .filter(isLead)
    .map((note) => `${note.title} — ${frontmatterString(note, "status")} — [[${note.key}]]`);
  const findings = target.notes
    .filter(isConfirmedFinding)
    .map((note) => `${note.title} — [[${note.key}]]`);
  const warningLines = report.warnings.map((item) => `${item.code} ${item.path}: ${item.message}`);
  const attackSurfaces = section(target.panorama.body, "Key attack surfaces") || "None.";
  const actions = renderNextActionLines(investigations);

  return `# Reverse Audit Context: ${target.panorama.title}

Active Snapshot: ${frontmatterString(target.panorama, "snapshot")}

## Current Architecture
${section(target.panorama.body, "Current understanding") || "Not recorded."}

## High-risk Areas
${attackSurfaces}

## Audit Coverage
${bullets(areas.map((note) => `${note.title} — ${frontmatterString(note, "status")} — [[${note.key}]]`))}

## Active Investigations
${bullets(active)}

## Unreviewed Leads
${bullets(leads)}

## Confirmed Findings
${bullets(findings)}

## Recommended Next Actions
${bullets(actions)}

## Warnings
${bullets(warningLines)}
`;
}

export async function checkpoint(vaultRoot: string, targetId: string): Promise<CheckpointResult> {
  const target = await loadTarget(vaultRoot, targetId);
  const report = requireValid(target);
  const actions = renderNextActionLines(
    target.notes.filter((note) => frontmatterString(note, "kind") === "investigation"),
  );
  const rendered = renderPanorama(target);
  if (rendered === target.panorama.raw) {
    return {
      panoramaPath: target.panorama.absolutePath,
      changed: false,
      warnings: report.warnings,
      nextActions: actions,
    };
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
  return {
    panoramaPath: target.panorama.absolutePath,
    changed: true,
    warnings: report.warnings,
    nextActions: actions,
  };
}

export function formatIssue(item: Issue): string {
  return `${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`;
}
