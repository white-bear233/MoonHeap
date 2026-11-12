///|
test "unchanged shallow size containers expose retained growth" {
  let before = graph_fixture(3, [(0, 1, "property")]).graph().analyze()
  let after = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
    .graph()
    .analyze()
  let diff = before.compare(after, same_isolate=true)
  let container = diff.changes.filter(c => c.id == "1")[0]
  assert_eq(container.status, "retention_changed")
  assert_eq(container.before_bytes, container.after_bytes)
  assert_eq(container.retained_delta, Some(2L))
  assert_eq(before.compare(after).changes.length(), 0)
}

///|
test "three snapshots distinguish cleanup from surviving new objects" {
  let before = graph_fixture(2, [(0, 1, "property")]).graph().analyze()
  let growth = graph_fixture(4, [
      (0, 1, "property"),
      (1, 2, "property"),
      (1, 3, "property"),
    ])
    .graph()
    .analyze()
  let cleanup = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
    .graph()
    .analyze()
  let result = investigate(before, growth, cleanup, same_isolate=true)
  assert_eq(result.created, Some(2))
  assert_eq(result.released, Some(1))
  assert_eq(result.survivors.map(n => n.id), ["2"])
  assert_eq(investigate(before, growth, cleanup).survivors.length(), 0)
  let cleared = investigate(before, growth, before, same_isolate=true)
  assert_eq(cleared.survivors.length(), 0)
  assert_eq(cleared.released, Some(2))
}
