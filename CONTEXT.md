# Reverse Audit Knowledge Base

This context describes a binary-first knowledge base that helps human and AI reverse engineers understand a target, track audit coverage, and resume vulnerability research without repeating prior work.

## Language

**Target**:
A logical subject of reverse engineering whose behavior may span multiple binaries and versions.
_Avoid_: Object, project, binary

**Artifact**:
An exact binary input identified by a cryptographic hash, such as an APK, DEX, SO, KO, executable, firmware image, or memory image.
_Avoid_: File, sample

**Snapshot**:
A named set of Artifacts that represents the Target at a particular point and records its relationship to a parent Snapshot.
_Avoid_: Version, release

**Panorama**:
The current human-facing overview of a Target's architecture, business and data flows, trust boundaries, audit coverage, active investigations, and unreviewed branches.
_Avoid_: Dashboard, graph, index

**Knowledge**:
The current best explanation supported by evidence from a Snapshot. Incorrect Knowledge is corrected or deleted rather than retained as an alternative account.
_Avoid_: Note, belief, history

**Evidence Anchor**:
A reproducible coordinate that ties an observation or conclusion to an Artifact or runtime event, such as a function, symbol, address, offset, call chain, request, or trace.
_Avoid_: Citation, source

**Lead**:
A newly discovered path or question that may deserve analysis but has not yet been selected for active work.
_Avoid_: Task, finding

**Investigation**:
A resumable unit of vulnerability exploration containing the current question, hypotheses, observations, experiments, newly discovered Leads, and next action.
_Avoid_: Scratchpad, note, ticket

**Finding**:
A vulnerability or security issue that has been confirmed with sufficient evidence. Suspected vulnerabilities remain Investigations.
_Avoid_: Hypothesis, lead

**Negative Audit Result**:
Minimal evidence that a specific path did not exhibit the hypothesized behavior under stated conditions. It prevents repeated work without preserving a disproved hypothesis as Knowledge.
_Avoid_: Failed attempt, rejected finding

**Reviewed**:
An audit status meaning that a declared scope was examined for a particular Snapshot. It never means safe, exhaustive, or free of vulnerabilities.
_Avoid_: Audited, safe, complete

**Checkpoint**:
An event-triggered reconciliation that validates the Target's Markdown, refreshes derived Panorama sections, and records enough current state for another Agent to resume.
_Avoid_: Autosave, log entry
