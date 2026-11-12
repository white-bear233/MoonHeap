///|
fn graph_fixture(n : Int32, links : Array[(Int32, Int32, String)]) -> Snapshot {
  let nodes : Array[Node] = []
  let edges : Array[Edge] = []
  let ids : Map[String, Int32] = Map([])
  let mut total = 0L
  for v in 0..<n {
    let start = edges.length()
    for (a, b, kind) in links {
      if a == v {
        edges.push({
          index: edges.length(),
          source: a,
          target: b,
          kind,
          name: "ref",
        })
      }
    }
    let size = v.to_int64()
    total += size
    ids[v.to_string()] = v
    nodes.push({
      index: v,
      id: v.to_string(),
      kind: if v == 0 {
        "synthetic"
      } else {
        "object"
      },
      name: "node\{v}",
      self_size: size,
      edge_start: start,
      edge_count: edges.length() - start,
    })
  }
  { nodes, edges, ids, root: 0, total_size: total, limits: Limits::default(), }
}

///|
fn oracle_reach(s : Snapshot, removed : Int32) -> Array[Bool] {
  let visited = Array::make(s.node_count(), false)
  if removed == s.root {
    return visited
  }
  visited[s.root] = true
  let mut changed = true
  while changed {
    changed = false
    for e in s.edges {
      if e.source != removed &&
        e.target != removed &&
        visited[e.source] &&
        !visited[e.target] &&
        e.kind != "weak" &&
        (e.kind != "shortcut" || e.source == s.root) {
        visited[e.target] = true
        changed = true
      }
    }
  }
  visited
}

///|
test "shared diamond does not charge shared child to either owner" {
  let a = parse(tiny()).graph().analyze()
  assert_eq(a.retained_bytes(0), Some(60L))
  assert_eq(a.retained_bytes(1), Some(10L))
  assert_eq(a.retained_bytes(2), Some(20L))
  assert_eq(a.immediate_dominator(3), Some(0))
}

///|
test "cycles, weak reachability and unreachable components" {
  let s = graph_fixture(6, [
    (0, 1, "property"),
    (1, 2, "property"),
    (2, 1, "property"),
    (2, 3, "weak"),
    (3, 4, "property"),
    (4, 3, "property"),
    (5, 5, "property"),
  ])
  let a = s.graph().analyze()
  assert_eq(a.reachable_count(), 3)
  assert_eq(a.retained_bytes(1), Some(3L))
  assert_eq(a.retained_bytes(3), None)
  assert_eq(a.immediate_dominator(5), None)
}

///|
test "150 seeded graphs agree with independent node removal oracle" {
  let mut rng = 173
  for trial in 0..<150 {
    let n = 3 + trial % 10
    let links : Array[(Int32, Int32, String)] = []
    for v in 0..<n {
      for w in 0..<n {
        rng = (rng * 251 + 17) % 65521
        if rng % 5 == 0 {
          links.push((v, w, if rng % 7 == 0 { "weak" } else { "property" }))
        }
      }
    }
    let s = graph_fixture(n, links)
    let a = s.graph().analyze()
    let reachable = oracle_reach(s, -1)
    let removal = Array::makei(n, v => oracle_reach(s, v))
    for v in 0..<n {
      if !reachable[v] {
        assert_eq(a.retained_bytes(v), None)
        continue
      }
      let mut expected = 0L
      for w in 0..<n {
        if reachable[w] && !removal[v][w] {
          expected += s.nodes[w].self_size
        }
      }
      assert_eq(
        a.retained_bytes(v),
        Some(expected),
        msg="trial \{trial} node \{v}",
      )
      if v != 0 {
        let mut parent = -1
        for p in 0..<n {
          if p == v || !reachable[p] || removal[p][v] {
            continue
          }
          let mut closest = true
          for other in 0..<n {
            if other != v &&
              other != p &&
              reachable[other] &&
              !removal[other][v] &&
              removal[other][p] {
              closest = false
            }
          }
          if closest {
            parent = p
          }
        }
        assert_eq(a.immediate_dominator(v), Some(parent))
      }
    }
  }
}

///|
test "deep chain is iterative and work exhaustion is explicit" {
  let links : Array[(Int32, Int32, String)] = []
  for v in 0..<1999 {
    links.push((v, v + 1, "property"))
  }
  let s = graph_fixture(2000, links)
  assert_eq(s.graph().analyze().retained_bytes(1), Some(s.total_size))
  let s = { ..s, limits: { ..s.limits, max_work: 5, }, }
  assert_true(
    try {
      ignore(s.graph().analyze())
      false
    } catch {
      _ => true
    },
  )
}
