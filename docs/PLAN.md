# MoonHeap implementation and acceptance plan

Offline V8 `.heapsnapshot` analysis, with a portable MoonBit library, Node CLI,
and an offline browser explorer running the same compiled library in a worker.

## Milestones (each validated and pushed separately)

- [x] Architecture, scope and acceptance criteria.
- [x] Immutable public model, limits, errors and synthetic fixtures.
- [x] Strict metadata-driven parser: exact IDs, reordered fields, malformed data.
- [x] Forward/reverse reference indexes and retaining-edge policy.
- [x] Reachability, dominators and retained bytes, checked by an independent oracle.
- [x] Group/ranking queries, references and shortest root paths.
- [x] Aggregate comparison and explicitly confirmed same-isolate identity comparison.
- [x] Versioned JSON interface and CLI with resource limits and meaningful exit codes.
- [x] Real V8 baseline/growth/cleanup snapshots and differential verification.
- [x] Offline browser explorer with worker isolation.
- [x] Cross-backend CI, scale benchmark and consumer example.
- [x] Documentation, proposal, distribution packaging and Mooncakes publication.

## Delivered evidence

Version 0.1.0 is published as `white-bear233/moonheap`. An independent consumer
installed it from the registry and ran the public API on JS and Wasm GC.
Linux native is verified in CI. Browser workflows, cancellation, real V8 data
and scaling measurements are recorded in [VALIDATION.md](VALIDATION.md).

The GitHub release workflow builds source + precompiled CLI/browser ZIPs for
version tags; release status and downloads are available on the repository's
[Releases page](https://github.com/white-bear233/MoonHeap/releases).

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
