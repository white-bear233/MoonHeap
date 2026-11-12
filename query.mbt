///|
pub(all) struct NodePage {
  items : Array[Node]
  total : Int32
  offset : Int32
}

///|
pub(all) struct EdgePage {
  items : Array[Edge]
  total : Int32
  offset : Int32
}

///|
pub(all) struct Group {
  kind : String
  name : String
  count : Int32
  shallow_bytes : Int64
  max_retained_bytes : Int64?
}

///|
fn page_bounds(offset : Int32, limit : Int32) -> Unit raise HeapError {
  guard offset >= 0 && limit > 0 && limit <= 1000 else {
    raise Invalid("offset >= 0 and limit in 1..1000 required")
  }
}

///|
pub fn Analysis::nodes(
  self : Analysis,
  order~ : String = "retained",
  query~ : String = "",
  kind~ : String = "",
  offset~ : Int32 = 0,
  limit~ : Int32 = 100,
) -> NodePage raise HeapError {
  page_bounds(offset, limit)
  guard order == "retained" || order == "shallow" || order == "index" else {
    raise Invalid("unknown node sort order")
  }
  let found = self.graph.snapshot.nodes.filter(n => {
    (query == "" || n.name.contains(query) || n.id == query) &&
    (kind == "" || n.kind == kind)
  })
  if order != "index" {
    found.sort_by((a, b) => {
      let av = if order == "retained" {
        self.retained[a.index]
      } else {
        a.self_size
      }
      let bv = if order == "retained" {
        self.retained[b.index]
      } else {
        b.self_size
      }
      if av > bv {
        -1
      } else if av < bv {
        1
      } else {
        a.index - b.index
      }
    })
  }
  let items : Array[Node] = []
  for i in 0..<found.length() {
    if i >= offset && items.length() < limit {
      items.push(found[i])
    }
  }
  { items, total: found.length(), offset, }
}

///|
/// Groups sum shallow bytes only. max_retained_bytes is not additive.
pub fn Analysis::groups(self : Analysis) -> Array[Group] {
  let groups : Map[(String, String), Group] = Map([])
  for node in self.graph.snapshot.nodes {
    let key = (node.kind, node.name)
    let retained = self.retained[node.index]
    let r = if retained < 0L { None } else { Some(retained) }
    match groups.get(key) {
      None =>
        groups[key] = {
          kind: node.kind,
          name: node.name,
          count: 1,
          shallow_bytes: node.self_size,
          max_retained_bytes: r,
        }
      Some(g) => {
        let max_r = match (g.max_retained_bytes, r) {
          (Some(a), Some(b)) => Some(if a > b { a } else { b })
          (Some(a), None) => Some(a)
          (None, value) => value
        }
        groups[key] = {
          ..g,
          count: g.count + 1,
          shallow_bytes: g.shallow_bytes + node.self_size,
          max_retained_bytes: max_r,
        }
      }
    }
  }
  let result = groups.values().to_array()
  result.sort_by((a, b) => {
    if a.shallow_bytes > b.shallow_bytes {
      -1
    } else if a.shallow_bytes < b.shallow_bytes {
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
  result
}

///|
pub fn Graph::references(
  self : Graph,
  node : Int32,
  incoming~ : Bool = true,
  retaining_only~ : Bool = false,
  offset~ : Int32 = 0,
  limit~ : Int32 = 100,
) -> EdgePage raise HeapError {
  page_bounds(offset, limit)
  let n = self.snapshot.node(node)
  let start = if incoming { self.incoming_offsets[node] } else { n.edge_start }
  let end = if incoming {
    self.incoming_offsets[node + 1]
  } else {
    n.edge_start + n.edge_count
  }
  let result : Array[Edge] = []
  let mut total = 0
  for cursor in start..<end {
    let i = if incoming { self.incoming_edges[cursor] } else { cursor }
    if retaining_only && !self.retaining[i] {
      continue
    }
    if total >= offset && result.length() < limit {
      result.push(self.snapshot.edges[i])
    }
    total += 1
  }
  { items: result, total, offset, }
}

///|
pub fn Analysis::dominated(
  self : Analysis,
  node : Int32,
  offset~ : Int32 = 0,
  limit~ : Int32 = 100,
) -> NodePage raise HeapError {
  page_bounds(offset, limit)
  ignore(self.graph.snapshot.node(node))
  let items : Array[Node] = []
  let mut total = 0
  for n in self.graph.snapshot.nodes {
    if n.index != node && self.idom[n.index] == node {
      if total >= offset && items.length() < limit {
        items.push(n)
      }
      total += 1
    }
  }
  { items, total, offset, }
}
