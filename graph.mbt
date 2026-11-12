///|
pub struct Graph {
  snapshot : Snapshot
  incoming_offsets : Array[Int32]
  incoming_edges : Array[Int32]
  retaining : Array[Bool]
  distance : Array[Int32]
  parent_edge : Array[Int32]
  conditional_edges : Int32
}

///|
/// Build both directions and the root-reachable graph under snapshot-strong-v1.
pub fn Snapshot::graph(self : Snapshot) -> Graph {
  let n = self.node_count()
  let offsets = Array::make(n + 1, 0)
  let retaining = Array::make(self.edge_count(), false)
  let mut conditional = 0
  for edge in self.edges {
    offsets[edge.target + 1] += 1
    retaining[edge.index] = edge.kind != "weak" &&
      edge.source != edge.target &&
      (edge.kind != "shortcut" || edge.source == self.root)
    if edge.kind == "internal" &&
      edge.name.contains("part of key") &&
      edge.name.contains("WeakMap") {
      conditional += 1
    }
  }
  for i in 1..<(n + 1) {
    offsets[i] += offsets[i - 1]
  }
  let cursor = offsets.copy()
  let incoming = Array::make(self.edge_count(), 0)
  for edge in self.edges {
    incoming[cursor[edge.target]] = edge.index
    cursor[edge.target] += 1
  }
  let distance = Array::make(n, -1)
  let parent_edge = Array::make(n, -1)
  let queue = [self.root]
  distance[self.root] = 0
  let mut head = 0
  while head < queue.length() {
    let source = queue[head]
    head += 1
    let node = self.nodes[source]
    for i in node.edge_start..<(node.edge_start + node.edge_count) {
      let edge = self.edges[i]
      if retaining[i] && distance[edge.target] == -1 {
        distance[edge.target] = distance[source] + 1
        parent_edge[edge.target] = i
        queue.push(edge.target)
      }
    }
  }
  {
    snapshot: self,
    incoming_offsets: offsets,
    incoming_edges: incoming,
    retaining,
    distance,
    parent_edge,
    conditional_edges: conditional,
  }
}

///|
pub fn Graph::snapshot(self : Graph) -> Snapshot {
  self.snapshot
}

///|
pub fn Graph::weakmap_edge_count(self : Graph) -> Int32 {
  self.conditional_edges
}

///|
pub fn Graph::is_retaining(self : Graph, edge : Int32) -> Bool raise HeapError {
  ignore(self.snapshot.edge(edge))
  self.retaining[edge]
}

///|
pub fn Graph::root_distance(
  self : Graph,
  node : Int32,
) -> Int32? raise HeapError {
  ignore(self.snapshot.node(node))
  if self.distance[node] < 0 {
    None
  } else {
    Some(self.distance[node])
  }
}

///|
/// Shortest retaining path; None means no root path, an empty path means root.
pub fn Graph::root_path(
  self : Graph,
  node : Int32,
  max_depth~ : Int32 = 1024,
) -> Array[Edge]? raise HeapError {
  ignore(self.snapshot.node(node))
  guard max_depth >= 0 else { raise Invalid("max_depth must be nonnegative") }
  if self.distance[node] < 0 {
    return None
  }
  guard self.distance[node] <= max_depth else {
    raise Limit("root path exceeds max_depth")
  }
  let result : Array[Edge] = []
  let mut at = node
  while at != self.snapshot.root {
    let e = self.snapshot.edges[self.parent_edge[at]]
    result.push(e)
    at = e.source
  }
  Some(result.rev())
}
