///|
test "explicit exclusion never matches contradictory IDs or counts them as survivors" {
  let a = graph_fixture(2, [(0, 1, "property")]).graph().analyze()
  let b = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
    .graph()
    .analyze()
  let raw = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
  raw.nodes[2] = { ..raw.nodes[2], name: "reused", kind: "code", }
  let c = raw.graph().analyze()
  assert_true(
    try {
      ignore(investigate(a, b, c, same_isolate=true))
      false
    } catch {
      _ => true
    },
  )
  let result = investigate(a, b, c, same_isolate=true, exclude_conflicts=true)
  assert_eq(result.excluded_ids, ["2"])
  assert_eq(result.created, Some(0))
  assert_eq(result.released, Some(0))
  assert_eq(result.survivors.length(), 0)
  let diff = b.compare(c, same_isolate=true, exclude_conflicts=true)
  assert_eq(diff.aggregate.excluded_ids, ["2"])
  assert_eq(diff.aggregate.survived, Some(2))
  assert_true(!diff.changes.any(change => change.id == "2"))
  let inspector = Inspector::new()
  let before = inspector.accept(b.graph.snapshot)
  let after = inspector.accept(c.graph.snapshot)
  let csv = inspector.export_report(
    before,
    "{\"view\":\"diff\",\"after_handle\":\{after},\"same_isolate\":true,\"exclude_conflicts\":true,\"format\":\"csv\"}",
  )
  assert_true(csv.contains("identity_exclusions"))
  assert_true(csv.contains("excluded_id_count"))
}

///|
test "node and group filters preserve unreachable semantics" {
  let i = Inspector::new()
  let h = i.accept(graph_fixture(4, [(0, 1, "property"), (1, 2, "property")]))
  let result = i.query(h, "{\"op\":\"nodes\",\"reachability\":\"unreachable\"}")
  let rows = array(field(result, "items"), "items")
  assert_eq(rows.length(), 1)
  assert_eq(field(rows[0], "retained_bytes"), Json::null())
  let filtered = i.query(
    h, "{\"op\":\"nodes\",\"min_shallow\":2,\"min_retained\":2}",
  )
  assert_eq(integer(field(filtered, "total"), "total"), 1)
  let groups = i.query(h, "{\"op\":\"groups\",\"kind\":\"synthetic\"}")
  assert_eq(integer(field(groups, "total"), "total"), 1)
}

///|
test "tree and references reports include every child and meaningful edge columns" {
  let links : Array[(Int32, Int32, String)] = []
  for v in 1..<1205 {
    links.push((0, v, "property"))
  }
  let i = Inspector::new()
  let h = i.accept(graph_fixture(1205, links))
  let report = i.report(h, "{\"view\":\"tree\"}")
  assert_true(
    try {
      ignore(i.report(h, "{\"view\":\"diff\"}"))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(
    array(field(field(report, "data"), "items"), "items").length(),
    1204,
  )
  let csv = i.export_report(
    h, "{\"view\":\"refs\",\"id\":\"0\",\"incoming\":false,\"format\":\"csv\"}",
  )
  assert_true(csv.contains("source,target"))
  assert_true(csv.contains("node1204"))
  assert_true(csv.contains("property"))
}

///|
test "new survivors remain visible when group count has returned to baseline" {
  let before = graph_fixture(2, [(0, 1, "property")])
  let growth = graph_fixture(3, [(0, 1, "property"), (0, 2, "property")])
  growth.nodes[2] = { ..growth.nodes[2], name: "node1", }
  let cleanup = graph_fixture(2, [(0, 1, "property")])
  cleanup.nodes[1] = { ..cleanup.nodes[1], id: "2", }
  cleanup.ids.remove("1")
  cleanup.ids["2"] = 1
  let i = Inspector::new(max_snapshots=3)
  let a = i.accept(before)
  let b = i.accept(growth)
  let c = i.accept(cleanup)
  let result = i.investigate(a, b, c, "{\"same_isolate\":true}")
  assert_eq(integer(field(result, "total"), "total"), 1)
  assert_eq(integer(field(result, "total_groups"), "total_groups"), 1)
  let group = array(field(result, "groups"), "groups")[0]
  assert_eq(integer(field(group, "remaining_count"), "remaining_count"), 0)
  assert_eq(
    integer(field(i.investigate(a, b, c, "{}"), "total_groups"), "total_groups"),
    0,
  )
}

///|
test "group and object change pagination can move independently" {
  let i = Inspector::new()
  let a = i.accept(graph_fixture(1, []))
  let b = i.accept(graph_fixture(40, []))
  let all = i.diff(a, b, "{\"same_isolate\":true}")
  let page = i.diff(
    a, b, "{\"same_isolate\":true,\"group_offset\":3,\"change_offset\":7,\"limit\":1}",
  )
  assert_eq(
    array(field(page, "groups"), "groups")[0],
    array(field(all, "groups"), "groups")[3],
  )
  assert_eq(
    array(field(page, "changes"), "changes")[0],
    array(field(all, "changes"), "changes")[7],
  )
}
