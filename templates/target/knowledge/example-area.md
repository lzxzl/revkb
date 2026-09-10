---
kind: knowledge
target: example-target
snapshot: example-v1
status: reviewed
---
# Example architecture area

## Current conclusion

External input reaches the core flow after crossing the documented trust boundary.

## Business flow

External actor → entry → authorization → core flow.

## Security-relevant behavior

Authorization occurs at the trust boundary.

## Remaining unknowns

The privileged dispatch path still needs analysis.

## Evidence

[Example evidence](../evidence/example-evidence.md)
