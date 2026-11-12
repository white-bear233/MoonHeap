///|
pub(all) struct RetentionChange {
  id : String
  kind : String
  name : String
  status : String
  before_bytes : Int64?
  after_bytes : Int64?
  before_retained : Int64?
  after_retained : Int64?
  retained_delta : Int64?
}

///|
pub(all) struct RetentionDiff {
  aggregate : SnapshotDiff
  changes : Array[RetentionChange]
}

///|
fn delta_optional(before : Int64?, after : Int64?) -> Int64? {
  match (before, after) {
    (Some(b), Some(a)) => Some(a - b)
    _ => None
  }
}

///|
pub fn Analysis::compare(
  self : Analysis,
  after : Analysis,
  same_isolate~ : Bool = false,
) -> RetentionDiff raise HeapError {
  let before_s = self.graph.snapshot
  let after_s = after.graph.snapshot
  let aggregate = compare(before_s, after_s, same_isolate~)
  let changes : Array[RetentionChange] = []
  if same_isolate {
    for n in after_s.nodes {
      let current = after.retained_bytes(n.index)
      match before_s.find_id(n.id) {
        None =>
          changes.push({
            id: n.id,
            kind: n.kind,
            name: n.name,
            status: "added",
            before_bytes: None,
            after_bytes: Some(n.self_size),
            before_retained: None,
            after_retained: current,
            retained_delta: current,
          })
        Some(i) => {
          let previous = self.retained_bytes(i)
          let old = before_s.nodes[i]
          if old.self_size != n.self_size || previous != current {
            changes.push({
              id: n.id,
              kind: n.kind,
              name: n.name,
              status: if old.self_size != n.self_size {
                "resized"
              } else {
                "retention_changed"
              },
              before_bytes: Some(old.self_size),
              after_bytes: Some(n.self_size),
              before_retained: previous,
              after_retained: current,
              retained_delta: delta_optional(previous, current),
            })
          }
        }
      }
    }
    for n in before_s.nodes {
      if !after_s.ids.contains(n.id) {
        let previous = self.retained_bytes(n.index)
        changes.push({
          id: n.id,
          kind: n.kind,
          name: n.name,
          status: "removed",
          before_bytes: Some(n.self_size),
          after_bytes: None,
          before_retained: previous,
          after_retained: None,
          retained_delta: previous.map(v => -v),
        })
      }
    }
    changes.sort_by((a, b) => {
      let av = a.retained_delta.unwrap_or(0L)
      let bv = b.retained_delta.unwrap_or(0L)
      if av > bv {
        -1
      } else if av < bv {
        1
      } else {
        a.id.compare(b.id)
      }
    })
  }
  { aggregate, changes, }
}

///|
pub(all) struct ResidueGroup {
  kind : String
  name : String
  before_count : Int32
  growth_count : Int32
  cleanup_count : Int32
  before_bytes : Int64
  growth_bytes : Int64
  cleanup_bytes : Int64
}

///|
pub(all) struct Investigation {
  mode : String
  groups : Array[ResidueGroup]
  survivors : Array[Node]
  created : Int32?
  released : Int32?
}

///|
/// Candidates are newly observed after the workload and still present after cleanup.
/// This is evidence of survival, not a proof of unintended retention.
pub fn investigate(
  before : Analysis,
  growth : Analysis,
  cleanup : Analysis,
  same_isolate~ : Bool = false,
) -> Investigation raise HeapError {
  let first = compare(
    before.graph.snapshot,
    growth.graph.snapshot,
    same_isolate~,
  )
  ignore(compare(growth.graph.snapshot, cleanup.graph.snapshot, same_isolate~))
  ignore(compare(before.graph.snapshot, cleanup.graph.snapshot, same_isolate~))
  let groups : Map[(String, String), ResidueGroup] = Map([])
  for g in before.groups() {
    groups[(g.kind, g.name)] = {
      kind: g.kind,
      name: g.name,
      before_count: g.count,
      before_bytes: g.shallow_bytes,
      growth_count: 0,
      cleanup_count: 0,
      growth_bytes: 0L,
      cleanup_bytes: 0L,
    }
  }
  for g in growth.groups() {
    let old = groups
      .get((g.kind, g.name))
      .unwrap_or({
        kind: g.kind,
        name: g.name,
        before_count: 0,
        before_bytes: 0L,
        growth_count: 0,
        cleanup_count: 0,
        growth_bytes: 0L,
        cleanup_bytes: 0L,
      })
    groups[(g.kind, g.name)] = {
      ..old,
      growth_count: g.count,
      growth_bytes: g.shallow_bytes,
    }
  }
  for g in cleanup.groups() {
    let old = groups
      .get((g.kind, g.name))
      .unwrap_or({
        kind: g.kind,
        name: g.name,
        before_count: 0,
        before_bytes: 0L,
        growth_count: 0,
        cleanup_count: 0,
        growth_bytes: 0L,
        cleanup_bytes: 0L,
      })
    groups[(g.kind, g.name)] = {
      ..old,
      cleanup_count: g.count,
      cleanup_bytes: g.shallow_bytes,
    }
  }
  let rows = groups.values().to_array()
  rows.sort_by((a, b) => {
    let av = a.cleanup_bytes - a.before_bytes
    let bv = b.cleanup_bytes - b.before_bytes
    if av > bv {
      -1
    } else if av < bv {
      1
    } else {
      a.name.compare(b.name)
    }
  })
  let survivors : Array[Node] = []
  let mut released = 0
  if same_isolate {
    for n in growth.graph.snapshot.nodes {
      if !before.graph.snapshot.ids.contains(n.id) {
        match cleanup.graph.snapshot.ids.get(n.id) {
          Some(i) => survivors.push(cleanup.graph.snapshot.nodes[i])
          None => released += 1
        }
      }
    }
    survivors.sort_by((a, b) => {
      let av = cleanup.retained[a.index]
      let bv = cleanup.retained[b.index]
      if av > bv {
        -1
      } else if av < bv {
        1
      } else {
        a.index - b.index
      }
    })
  }
  {
    mode: if same_isolate {
      "identity_asserted"
    } else {
      "aggregate"
    },
    groups: rows,
    survivors,
    created: first.added,
    released: if same_isolate {
      Some(released)
    } else {
      None
    },
  }
}
