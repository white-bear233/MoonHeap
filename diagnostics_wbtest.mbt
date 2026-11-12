///|
test "multiple retaining paths enumerate diamond, cycles and search budgets" {
  let g = parse(tiny()).graph()
  let found = g.root_paths(3)
  assert_true(found.complete)
  assert_eq(found.paths.length(), 2)
  assert_eq(found.paths[0].length(), 2)
  assert_eq(found.paths[1][0].target, 2)
  assert_true(!g.root_paths(3, max_paths=1).complete)
  assert_eq(g.root_paths(3, max_depth=1).stop_reason, "depth_limit")
  assert_eq(g.root_paths(3, max_work=1).stop_reason, "work_limit")
  let cyclic = graph_fixture(4, [
    (0, 1, "property"),
    (1, 2, "property"),
    (2, 1, "property"),
    (2, 3, "property"),
  ])
  assert_eq(cyclic.graph().root_paths(3).paths.length(), 1)
}

///|
test "cycle groups distinguish shared DAG, self references and weak loops" {
  assert_eq(parse(tiny()).graph().cycles().length(), 0)
  let g = graph_fixture(6, [
    (0, 1, "property"),
    (1, 2, "property"),
    (2, 1, "property"),
    (3, 3, "property"),
    (4, 5, "weak"),
    (5, 4, "property"),
  ]).graph()
  let cycles = g.cycles()
  assert_eq(cycles.length(), 2)
  assert_true(cycles.any(c => c.members == [1, 2] && c.shallow_bytes == 3L))
  assert_true(cycles.any(c => c.members == [3]))
  let a = parse(tiny()).graph().analyze()
  assert_eq(a.dominator_chain(3).map(n => n.index), [3, 0])
}
