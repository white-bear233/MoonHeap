///|
test "cleanup budgets count all candidates and sum shallow bytes without overlap" {
  let a = graph_fixture(1, []).graph().analyze()
  let b = graph_fixture(4, [
      (0, 1, "property"),
      (1, 2, "property"),
      (1, 3, "property"),
    ])
    .graph()
    .analyze()
  let c = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
    .graph()
    .analyze()
  let failed = check_cleanup(a, b, c, same_isolate=true)
  assert_eq(failed.status, "exceeded")
  assert_eq(failed.matched_survivors, 2)
  assert_eq(failed.shallow_bytes, 3L)
  assert_eq(
    check_cleanup(a, b, c, same_isolate=true, max_survivors=Some(2)).status,
    "passed",
  )
  assert_eq(
    check_cleanup(a, b, c, same_isolate=true, max_survivor_bytes=Some(3L)).status,
    "passed",
  )
  assert_eq(
    check_cleanup(a, b, c, same_isolate=true, max_survivor_bytes=Some(2L)).status,
    "exceeded",
  )
  assert_eq(check_cleanup(a, b, a, same_isolate=true).status, "passed")
  assert_eq(
    check_cleanup(
      a,
      b,
      c,
      same_isolate=true,
      query="node2",
      max_survivors=Some(1),
    ).matched_survivors,
    1,
  )
  assert_eq(
    check_cleanup(a, b, c, same_isolate=true, kind="synthetic").matched_survivors,
    0,
  )
  assert_true(
    try {
      ignore(check_cleanup(a, b, c))
      false
    } catch {
      Identity(_) => true
      _ => false
    },
  )
  assert_true(
    try {
      ignore(check_cleanup(a, b, c, same_isolate=true, max_survivors=Some(-1)))
      false
    } catch {
      Invalid(_) => true
      _ => false
    },
  )
}

///|
test "ambiguous identities cannot turn a cleanup check green" {
  let a = graph_fixture(1, []).graph().analyze()
  let b = graph_fixture(3, [(0, 1, "property")]).graph().analyze()
  let raw = graph_fixture(3, [(0, 1, "property")])
  raw.nodes[1] = { ..raw.nodes[1], name: "other", }
  let c = raw.graph().analyze()
  let result = check_cleanup(
    a,
    b,
    c,
    same_isolate=true,
    exclude_conflicts=true,
    max_survivors=Some(100),
  )
  assert_eq(result.status, "inconclusive")
  assert_eq(result.excluded_ids, ["1"])
  assert_eq(result.unreachable_survivors, 1)
  assert_eq(result.matched_survivors, 1)
}

///|
test "cleanup checks evaluate beyond both sample and query page limits" {
  let i = Inspector::new(max_snapshots=3)
  let a = i.accept(graph_fixture(1, []))
  let b = i.accept(graph_fixture(1205, []))
  let c = i.accept(graph_fixture(1205, []))
  let result = i.check_cleanup(
    a, b, c, "{\"same_isolate\":true,\"max_survivors\":1203,\"limit\":1,\"offset\":1204}",
  )
  assert_eq(text(field(result, "status"), "status"), "exceeded")
  assert_eq(integer(field(result, "matched_survivors"), "count"), 1204)
  assert_eq(array(field(result, "sample"), "sample").length(), 20)
}
