///|
struct Analysis {
  graph : Graph
  idom : Array[Int32]
  retained : Array[Int64]
  reachable_count : Int32
  iterations : Int32
}

///|
priv struct Budget {
  mut left : Int32
}

///|
fn Budget::spend(self : Budget) -> Unit raise HeapError {
  if self.left <= 0 {
    raise Limit("dominator work budget exhausted")
  }
  self.left -= 1
}

///|
/// Iterative reverse-postorder dominators (Cooper-Harvey-Kennedy).
/// No recursion: deeply nested object graphs cannot overflow the call stack.
pub fn Graph::analyze(self : Graph) -> Analysis raise HeapError {
  let n = self.snapshot.node_count()
  let root = self.snapshot.root
  let budget = { left: self.snapshot.limits.max_work, }
  let seen = Array::make(n, false)
  let cursors = self.snapshot.nodes.map(n => n.edge_start)
  let stack = [root]
  let post : Array[Int32] = []
  seen[root] = true
  while !stack.is_empty() {
    budget.spend()
    let v = stack[stack.length() - 1]
    let node = self.snapshot.nodes[v]
    let mut descended = false
    while cursors[v] < node.edge_start + node.edge_count {
      budget.spend()
      let e = cursors[v]
      cursors[v] += 1
      let w = self.snapshot.edges[e].target
      if self.retaining[e] && !seen[w] {
        seen[w] = true
        stack.push(w)
        descended = true
        break
      }
    }
    if !descended {
      ignore(stack.pop())
      post.push(v)
    }
  }
  let order = post.rev()
  let rank = Array::make(n, -1)
  for i in 0..<order.length() {
    rank[order[i]] = i
  }
  let idom = Array::make(n, -1)
  idom[root] = root
  let mut changed = true
  let mut iterations = 0
  while changed {
    budget.spend()
    iterations += 1
    changed = false
    for i in 1..<order.length() {
      let v = order[i]
      let mut candidate = -1
      for j in self.incoming_offsets[v]..<self.incoming_offsets[v + 1] {
        budget.spend()
        let edge = self.incoming_edges[j]
        let p = self.snapshot.edges[edge].source
        if self.retaining[edge] && idom[p] >= 0 {
          if candidate < 0 {
            candidate = p
          } else {
            let mut a = candidate
            let mut b = p
            while a != b {
              budget.spend()
              if rank[a] > rank[b] {
                a = idom[a]
              } else {
                b = idom[b]
              }
            }
            candidate = a
          }
        }
      }
      if idom[v] != candidate {
        idom[v] = candidate
        changed = true
      }
    }
  }
  let retained = Array::make(n, -1L)
  for v in order {
    retained[v] = self.snapshot.nodes[v].self_size
  }
  for v in post {
    if v != root {
      retained[idom[v]] += retained[v]
    }
  }
  { graph: self, idom, retained, reachable_count: order.length(), iterations, }
}

///|
pub fn Analysis::graph(self : Analysis) -> Graph {
  self.graph
}

///|
pub fn Analysis::reachable_count(self : Analysis) -> Int32 {
  self.reachable_count
}

///|
pub fn Analysis::iterations(self : Analysis) -> Int32 {
  self.iterations
}

///|
pub fn Analysis::retained_bytes(
  self : Analysis,
  node : Int32,
) -> Int64? raise HeapError {
  ignore(self.graph.snapshot.node(node))
  if self.retained[node] < 0L {
    None
  } else {
    Some(self.retained[node])
  }
}

///|
pub fn Analysis::immediate_dominator(
  self : Analysis,
  node : Int32,
) -> Int32? raise HeapError {
  ignore(self.graph.snapshot.node(node))
  if node == self.graph.snapshot.root || self.idom[node] < 0 {
    None
  } else {
    Some(self.idom[node])
  }
}
