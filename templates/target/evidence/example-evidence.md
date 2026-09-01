---
kind: evidence
target: example-target
snapshot: example-v1
---
# Example evidence anchor

- Artifact: `sha256:0000000000000000000000000000000000000000000000000000000000000000`
- Location: `example_function+0x20`
- Observation: attacker-controlled input reaches the branch condition.
- Reproduction condition: invoke the alternate entry with an unauthenticated caller.
