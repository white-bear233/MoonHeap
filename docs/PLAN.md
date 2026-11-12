# MoonHeap implementation and acceptance plan

Offline V8 `.heapsnapshot` analysis, with a portable MoonBit library, Node CLI,
and an offline browser explorer running the same compiled library in a worker.

## Milestones (each validated and pushed separately)

1. Architecture, scope and acceptance criteria.
2. Immutable public model, limits, errors and synthetic fixtures.
3. Strict metadata-driven parser: exact IDs, reordered fields, malformed data.
4. Forward/reverse reference indexes and retaining-edge policy.
5. Reachability, dominators and retained bytes, checked by an independent oracle.
6. Group/ranking queries, references and shortest root paths.
7. Aggregate comparison and explicitly confirmed same-isolate identity comparison.
8. Versioned JSON interface and CLI with resource limits and meaningful exit codes.
9. Real V8 baseline/growth/cleanup snapshots and differential verification.
10. Offline browser explorer with worker isolation.
11. Cross-backend CI, scale benchmark and consumer example.
12. Documentation, proposal, release and Mooncakes publication.

## Semantic contract

- Decode fields by metadata; reject structural corruption.
- Preserve IDs as exact decimal strings even beyond JS safe integers.
- Shallow sizes are reported `self_size`, not RSS or complete native memory.
- `snapshot-strong-v1` excludes weak edges, self edges and non-root shortcuts.
  Root shortcuts remain. WeakMap conditional relationships are identified and
  reported as a caveat: graph retention is not a garbage-collection prediction.
- Dominance covers root-reachable nodes only. Unreachable retained sizes are null.
- Group summaries sum shallow sizes, never sum arbitrary retained subtrees.
- Aggregate diffs work across processes; identity diffs require same-isolate
  confirmation and reject contradictory overlapping IDs.
- Growth is an investigation lead, not an automatic memory-leak verdict.

## Acceptance

Malformed-input and precision tests; weak/shared/cyclic graphs; brute-force
node-removal oracle; seeded random graphs; real Node baseline/growth/cleanup;
CLI errors; browser interaction; JS/Wasm/native core checks; reproducible scale
measurements. Every user-facing calculation goes through the MoonBit library.

Original Apache-2.0 implementation. Consult Node/V8 and Chrome DevTools for
format semantics. MemLab/v8-profiler-rs are references, not bundled dependencies.
No claim of full MemLab compatibility, live collection, automatic repair, or
Chrome-specific page/debugger ownership heuristics.
