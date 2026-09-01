import fs from "node:fs/promises";
import path from "node:path";
import { loadTarget, section, type Note, type TargetVault } from "./markdown.js";
import {
  architectureAreas,
  frontmatterString,
  generatedRegions,
  isOpenInvestigationStatus,
  metadataForStatus,
} from "./model.js";
import { requireValid, type Issue } from "./validation.js";

export interface CheckpointResult {
  panoramaPath: string;
  changed: boolean;
  warnings: Issue[];
  nextActions: string[];
}

function firstLine(content: string): string {
  return content.split("\n").map((line) => line.trim()).find(Boolean) ?? "Not recorded.";
}

function bullets(lines: string[]): string {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "None.";
}

function isActiveInvestigation(note: Note): boolean {
  return (
    frontmatterString(note, "kind") === "investigation" &&
    metadataForStatus(frontmatterString(note, "status"))?.investigationCategory === "active"
  );
}

function isLead(note: Note): boolean {
  return (
    frontmatterString(note, "kind") === "investigation" &&
    metadataForStatus(frontmatterString(note, "status"))?.investigationCategory === "lead"
  );
}

function isConfirmedFinding(note: Note): boolean {
  return frontmatterString(note, "kind") === "finding" && frontmatterString(note, "status") === "confirmed";
}

function renderNextActionLines(investigations: Note[]): string[] {
  return [...investigations]
    .sort(
      (left, right) =>
        (metadataForStatus(frontmatterString(left, "status"))?.actionPriority ?? Number.MAX_SAFE_INTEGER) -
          (metadataForStatus(frontmatterString(right, "status"))?.actionPriority ?? Number.MAX_SAFE_INTEGER) ||
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
