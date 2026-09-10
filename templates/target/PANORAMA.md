---
kind: panorama
target: example-target
snapshot: example-v1
---
# Example Target

## Current understanding

The Target receives external input, crosses a trust boundary, and dispatches work to a privileged module.

## Overall architecture

```mermaid
flowchart LR
    Actor[External actor] --> Entry[External entry]
    Entry --> Boundary{Trust boundary}
    Boundary --> Core[Core business flow]
    Core --> Native[Native or privileged module]
    %% revkb-area: [[knowledge/example-area]]
```

## Key attack surfaces

- External input parsing
- Trust-boundary authorization
- Native or privileged dispatch

## Audit coverage
<!-- revkb:coverage:start -->
<!-- revkb:coverage:end -->

## Active investigations
<!-- revkb:investigations:start -->
<!-- revkb:investigations:end -->

## Unreviewed branches
<!-- revkb:leads:start -->
<!-- revkb:leads:end -->

## Confirmed findings
<!-- revkb:findings:start -->
<!-- revkb:findings:end -->

## Snapshots

- [example-v1](snapshots/example-v1.md) — active
