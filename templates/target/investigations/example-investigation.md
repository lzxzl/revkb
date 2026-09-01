---
kind: investigation
target: example-target
snapshot: example-v1
status: analyzing
---
# Example authorization bypass investigation

## Why it matters

Bypassing the trust-boundary check may expose privileged behavior.

## Current hypothesis

One alternate entry may reach the core flow without the primary authorization check.

## Confirmed observations

The primary entry performs authorization before dispatch.

## Experiments

No alternate entry has been tested yet.

## Newly discovered branches

- Alternate entry discovered while following [[knowledge/example-area]].

## Next action

Trace the alternate entry to the first privileged operation.

## Evidence

[[evidence/example-evidence]]
