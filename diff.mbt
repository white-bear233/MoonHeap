///|
pub(all) struct GroupDelta {
  kind : String
  name : String
  before_count : Int32
  after_count : Int32
  before_bytes : Int64
  after_bytes : Int64
}

///|
pub(all) struct ObjectChange {
  id : String
  kind : String
  name : String
  status : String
  before_bytes : Int64?
  after_bytes : Int64?
}

///|
pub(all) struct SnapshotDiff {
  mode : String
  groups : Array[GroupDelta]
  added : Int32?
  removed : Int32?
  survived : Int32?
  changes : Array[ObjectChange]
}

///|
/// Identity is never inferred from IDs. same_isolate is a caller assertion.
pub fn compare(
  before : Snapshot,
  after : Snapshot,
  same_isolate~ : Bool = false,
) -> SnapshotDiff raise HeapError {
  let groups : Map[(String, String), GroupDelta] = Map([])
  for n in before.nodes {
    let key = (n.kind, n.name)
    let g = groups
      .get(key)
      .unwrap_or({
        kind: n.kind,
        name: n.name,
        before_count: 0,
        after_count: 0,
        before_bytes: 0L,
        after_bytes: 0L,
      })
    groups[key] = {
      ..g,
      before_count: g.before_count + 1,
      before_bytes: g.before_bytes + n.self_size,
    }
  }
  for n in after.nodes {
    let key = (n.kind, n.name)
    let g = groups
      .get(key)
      .unwrap_or({
        kind: n.kind,
        name: n.name,
        before_count: 0,
        after_count: 0,
        before_bytes: 0L,
        after_bytes: 0L,
      })
    groups[key] = {
      ..g,
      after_count: g.after_count + 1,
      after_bytes: g.after_bytes + n.self_size,
    }
  }
  let rows = groups.values().to_array()
  rows.sort_by((a, b) => {
    let ad = a.after_bytes - a.before_bytes
    let bd = b.after_bytes - b.before_bytes
    if ad > bd {
      -1
    } else if ad < bd {
      1
    } else {
      let c = a.kind.compare(b.kind)
      if c != 0 {
        c
      } else {
        a.name.compare(b.name)
      }
    }
  })
  if !same_isolate {
    return {
      mode: "aggregate",
      groups: rows,
      added: None,
      removed: None,
      survived: None,
      changes: [],
    }
  }
  let changes : Array[ObjectChange] = []
  let mut added = 0
  let mut removed = 0
  let mut survived = 0
  for n in after.nodes {
    match before.ids.get(n.id) {
      None => {
        added += 1
        changes.push({
          id: n.id,
          kind: n.kind,
          name: n.name,
          status: "added",
          before_bytes: None,
          after_bytes: Some(n.self_size),
        })
      }
      Some(i) => {
        let old = before.nodes[i]
        guard old.kind == n.kind && old.name == n.name else {
          raise Identity(
            "overlapping id \{n.id} changed type/name; identity comparison rejected",
          )
        }
        survived += 1
        if old.self_size != n.self_size {
          changes.push({
            id: n.id,
            kind: n.kind,
            name: n.name,
            status: "resized",
            before_bytes: Some(old.self_size),
            after_bytes: Some(n.self_size),
          })
        }
      }
    }
  }
  for n in before.nodes {
    if !after.ids.contains(n.id) {
      removed += 1
      changes.push({
        id: n.id,
        kind: n.kind,
        name: n.name,
        status: "removed",
        before_bytes: Some(n.self_size),
        after_bytes: None,
      })
    }
  }
  {
    mode: "identity_asserted",
    groups: rows,
    added: Some(added),
    removed: Some(removed),
    survived: Some(survived),
    changes,
  }
}
