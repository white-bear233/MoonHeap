///|
pub(all) struct PathSearch {
  paths : Array[Array[Edge]]
  complete : Bool
  examined : Int32
  stop_reason : String
}

///|
priv struct PathWork {
  node : Int32
  trail : Array[Int32]
  visited : Array[Int32]
}

///|
/// Enumerate bounded simple retaining paths. Search completeness is explicit.
pub fn Graph::root_paths(
  self : Graph,
  node : Int32,
  max_paths~ : Int32 = 5,
  max_depth~ : Int32 = 64,
  max_work~ : Int32 = 50000,
) -> PathSearch raise HeapError {
  ignore(self.snapshot.node(node))
  guard max_paths > 0 &&
    max_paths <= 100 &&
    max_depth >= 0 &&
    max_depth <= 4096 &&
    max_work > 0 &&
    max_work <= self.snapshot.limits.max_work else {
    raise Invalid("invalid path search budget")
  }
  let paths : Array[Array[Edge]] = []
  if self.distance[node] < 0 {
    return { paths, complete: true, examined: 0, stop_reason: "unreachable", }
  }
  if self.distance[node] > max_depth {
    return { paths, complete: false, examined: 0, stop_reason: "depth_limit", }
  }
  let work : Array[PathWork?] = [Some({ node, trail: [], visited: [node], })]
  let mut head = 0
  let mut examined = 0
  let mut reason = "complete"
  while head < work.length() {
    let item = work[head].unwrap()
    work[head] = None
    head += 1
    if item.node == self.snapshot.root {
      paths.push(item.trail.rev().map(i => self.snapshot.edges[i]))
      if paths.length() == max_paths {
        if head < work.length() {
          reason = "path_limit"
        }
        break
      }
      continue
    }
    if item.trail.length() >= max_depth {
      reason = "depth_limit"
      continue
    }
    for
      p in self.incoming_offsets[item.node]..<self.incoming_offsets[item.node +
      1] {
      examined += 1
      if examined > max_work {
        return {
          paths,
          complete: false,
          examined: max_work,
          stop_reason: "work_limit",
        }
      }
      let edge = self.incoming_edges[p]
      let from = self.snapshot.edges[edge].source
      if self.retaining[edge] &&
        self.distance[from] >= 0 &&
        !item.visited.contains(from) {
        if work.length() - head >= 4096 {
          return {
            paths,
            complete: false,
            examined,
            stop_reason: "frontier_limit",
          }
        }
        let trail = item.trail.copy()
        trail.push(edge)
        let visited = item.visited.copy()
        visited.push(from)
        work.push(Some({ node: from, trail, visited, }))
      }
    }
  }
  { paths, complete: reason == "complete", examined, stop_reason: reason, }
}

///|
pub(all) struct CycleGroup {
  id : Int32
  members : Array[Int32]
  shallow_bytes : Int64
}

///|
/// Strongly connected groups. A cycle alone is not evidence of a leak.
pub fn Graph::cycles(self : Graph) -> Array[CycleGroup] {
  let n = self.snapshot.node_count()
  let seen = Array::make(n, false)
  let cursors = self.snapshot.nodes.map(n => n.edge_start)
  let post : Array[Int32] = []
  for root in 0..<n {
    if seen[root] {
      continue
    }
    let stack = [root]
    seen[root] = true
    while !stack.is_empty() {
      let v = stack[stack.length() - 1]
      let item = self.snapshot.nodes[v]
      let mut descended = false
      while cursors[v] < item.edge_start + item.edge_count {
        let e = cursors[v]
        cursors[v] += 1
        let to = self.snapshot.edges[e].target
        if self.retaining[e] && !seen[to] {
          seen[to] = true
          stack.push(to)
          descended = true
          break
        }
      }
      if !descended {
        ignore(stack.pop())
        post.push(v)
      }
    }
  }
  let assigned = Array::make(n, false)
  let result : Array[CycleGroup] = []
  for root in post.rev() {
    if assigned[root] {
      continue
    }
    let stack = [root]
    assigned[root] = true
    let members : Array[Int32] = []
    let mut size = 0L
    let mut id = root
    while !stack.is_empty() {
      let v = stack.pop().unwrap()
      members.push(v)
      size += self.snapshot.nodes[v].self_size
      if v < id {
        id = v
      }
      for p in self.incoming_offsets[v]..<self.incoming_offsets[v + 1] {
        let e = self.incoming_edges[p]
        let from = self.snapshot.edges[e].source
        if self.retaining[e] && !assigned[from] {
          assigned[from] = true
          stack.push(from)
        }
      }
    }
    let mut self_cycle = false
    if members.length() == 1 {
      let v = self.snapshot.nodes[root]
      for e in v.edge_start..<(v.edge_start + v.edge_count) {
        let edge = self.snapshot.edges[e]
        if edge.target == root && edge.kind != "weak" && edge.kind != "shortcut" {
          self_cycle = true
        }
      }
    }
    if members.length() > 1 || self_cycle {
      members.sort()
      result.push({ id, members, shallow_bytes: size, })
    }
  }
  result.sort_by((a, b) => {
    if a.shallow_bytes > b.shallow_bytes {
      -1
    } else if a.shallow_bytes < b.shallow_bytes {
      1
    } else {
      a.id - b.id
    }
  })
  result
}

///|
pub fn Analysis::dominator_chain(
  self : Analysis,
  node : Int32,
  max_depth~ : Int32 = 1024,
) -> Array[Node] raise HeapError {
  ignore(self.graph.snapshot.node(node))
  guard max_depth > 0 else { raise Invalid("max_depth must be positive") }
  let result : Array[Node] = []
  let mut at = node
  while at >= 0 {
    guard result.length() < max_depth else {
      raise Limit("dominator chain exceeds max_depth")
    }
    result.push(self.graph.snapshot.nodes[at])
    if at == self.graph.snapshot.root {
      break
    }
    at = self.idom[at]
  }
  result
}
