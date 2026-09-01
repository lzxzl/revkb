import { fencedCodeBlockBodies, section, type Note } from "./markdown.js";

export const generatedRegions = ["coverage", "investigations", "leads", "findings"] as const;

export type InvestigationCategory = "active" | "lead" | "closed";

export interface StatusMetadata {
  investigationCategory: InvestigationCategory;
  actionPriority: number;
}

const statusMetadata = {
  discovered: { investigationCategory: "lead", actionPriority: 3 },
  queued: { investigationCategory: "lead", actionPriority: 2 },
  analyzing: { investigationCategory: "active", actionPriority: 0 },
  reviewed: { investigationCategory: "closed", actionPriority: Number.MAX_SAFE_INTEGER },
  blocked: { investigationCategory: "active", actionPriority: 1 },
  dismissed: { investigationCategory: "closed", actionPriority: Number.MAX_SAFE_INTEGER },
  "needs-revalidation": { investigationCategory: "lead", actionPriority: 4 },
} as const satisfies Record<string, StatusMetadata>;

type CoverageStatus = keyof typeof statusMetadata;

export function metadataForStatus(status: string): StatusMetadata | undefined {
  return Object.hasOwn(statusMetadata, status) ? statusMetadata[status as CoverageStatus] : undefined;
}

export function isOpenInvestigationStatus(status: string): boolean {
  const category = metadataForStatus(status)?.investigationCategory;
  return category === "active" || category === "lead";
}

export function frontmatterString(note: Note, field: string): string {
  const candidate = note.data[field];
  return typeof candidate === "string" ? candidate : "";
}

export function architectureAreas(panorama: Note): string[] {
  const architecture = section(panorama.body, "Overall architecture");
  return [
    ...new Set(
      fencedCodeBlockBodies(architecture, "mermaid").flatMap((diagram) =>
        [...diagram.matchAll(/^\s*%%\s+revkb-area:\s+\[\[([^\]]+)\]\]\s*$/gm)].map(
          (match) => (match[1] ?? "").replace(/\.md$/, ""),
        ),
      ),
    ),
  ].sort();
}
