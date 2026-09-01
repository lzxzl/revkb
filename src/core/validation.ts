import {
  firstHeading,
  hasFencedCodeBlock,
  hasSection,
  markdownOutsideFencedCode,
  section,
  wikilinkKeys,
  type Note,
  type TargetVault,
} from "./markdown.js";
import {
  architectureAreas,
  frontmatterString,
  generatedRegions,
  metadataForStatus,
} from "./model.js";

const kinds = new Set(["panorama", "snapshot", "knowledge", "investigation", "finding", "evidence"]);
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

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";

  constructor(public readonly report: ValidationReport) {
    super("Target validation failed");
  }
}

function issue(severity: Issue["severity"], code: string, note: Note, message: string): Issue {
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
  const lines = markdownOutsideFencedCode(note.body).split("\n");
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

function frontmatterScalar(note: Note, field: string): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = new RegExp(`^${escapedField}:\\s*(.*?)\\s*$`, "m").exec(note.frontmatter)?.[1]?.trim();
  if (!raw) return undefined;

  const withoutComment = raw.replace(/\s+#.*$/, "").trim();
  if (withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    try {
      const parsed = JSON.parse(withoutComment);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (withoutComment.startsWith("'") && withoutComment.endsWith("'")) {
    return withoutComment.slice(1, -1).replaceAll("''", "'");
  }
  return withoutComment;
}

function isIsoTimestamp(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      candidate,
    );
  if (!match) return false;

  const [
    ,
    yearText = "",
    monthText = "",
    dayText = "",
    hourText = "",
    minuteText = "",
    secondText = "",
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = monthLengths[month - 1] ?? 0;

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function isOpenInvestigationStatus(status: string): boolean {
  const category = metadataForStatus(status)?.investigationCategory;
  return category === "active" || category === "lead";
}

export function validateTarget(target: TargetVault): ValidationReport {
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
    if ((kind === "knowledge" || kind === "investigation") && !metadataForStatus(status)) {
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
      } else if (!isIsoTimestamp(frontmatterScalar(note, "created"))) {
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
    errors.push(
      issue("error", "unknown-active-snapshot", target.panorama, `Active Snapshot ${activeSnapshot} does not exist`),
    );
  }
  if (frontmatterString(target.panorama, "kind") !== "panorama") {
    errors.push(issue("error", "invalid-panorama-kind", target.panorama, "PANORAMA.md requires kind: panorama"));
  }
  if (!firstHeading(target.panorama.body, 1)) {
    errors.push(issue("error", "missing-panorama-title", target.panorama, "PANORAMA.md requires a # title"));
  }
  for (const heading of requiredPanoramaSections) {
    if (!hasSection(target.panorama.body, heading)) {
      errors.push(issue("error", "missing-panorama-section", target.panorama, `PANORAMA.md requires ## ${heading}`));
    }
  }
  if (!hasFencedCodeBlock(section(target.panorama.body, "Overall architecture"), "mermaid")) {
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
    if (countOccurrences(target.panorama.raw, start) !== 1 || countOccurrences(target.panorama.raw, end) !== 1) {
      errors.push(issue("error", "invalid-generated-region", target.panorama, `${name} markers must appear exactly once`));
    } else if (target.panorama.raw.indexOf(start) > target.panorama.raw.indexOf(end)) {
      errors.push(issue("error", "invalid-generated-region", target.panorama, `${name} markers are reversed`));
    }
  }

  const sort = (left: Issue, right: Issue) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code);
  return { errors: errors.sort(sort), warnings: warnings.sort(sort) };
}

export function requireValid(target: TargetVault): ValidationReport {
  const report = validateTarget(target);
  if (report.errors.length) throw new ValidationError(report);
  return report;
}

export function formatIssue(item: Issue): string {
  return `${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`;
}
