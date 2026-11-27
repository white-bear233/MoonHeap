///|
test "object evidence keeps shared holders and bounded-search completeness explicit" {
  let i = Inspector::new()
  let h = i.accept(
    graph_fixture(5, [
      (0, 1, "property"),
      (0, 2, "property"),
      (1, 3, "property"),
      (2, 3, "property"),
    ]),
  )
  let result = i.query(h, "{\"op\":\"explain\",\"id\":\"3\"}")
  assert_eq(integer(field(field(result, "retainers"), "total"), "total"), 2)
  assert_eq(
    array(field(field(result, "root_paths"), "paths"), "paths").length(),
    2,
  )
  assert_eq(field(field(result, "node"), "retained_bytes"), @json.to_json(3))
  assert_eq(field(result, "complete"), @json.to_json(true))
  assert_eq(
    field(field(result, "allocation"), "available"),
    @json.to_json(false),
  )
  let bounded = i.report(
    h, "{\"view\":\"explain\",\"id\":\"3\",\"retainer_limit\":1,\"max_paths\":1}",
  )
  assert_eq(field(bounded, "complete"), @json.to_json(false))
  let isolated = i.query(h, "{\"op\":\"explain\",\"id\":\"4\"}")
  assert_eq(field(isolated, "reachable"), @json.to_json(false))
  assert_eq(field(isolated, "complete"), @json.to_json(true))
}

///|
test "HTML object and tree reports preserve context and escape untrusted names" {
  let snapshot = graph_fixture(3, [(0, 1, "property"), (1, 2, "property")])
  snapshot.nodes[1] = {
    ..snapshot.nodes[1],
    name: "<script>alert(1)</script>",
  }
  let i = Inspector::new()
  let h = i.accept(snapshot)
  let html = i.export_report(
    h, "{\"view\":\"explain\",\"id\":\"1\",\"format\":\"html\"}",
  )
  assert_true(html.contains("&lt;script&gt;"))
  assert_true(!html.contains("<script>"))
  for title in ["直接持有者", "根路径", "分配来源", "支配关系"] {
    assert_true(html.contains(title))
  }
  let tree = i.export_report(
    h, "{\"view\":\"tree\",\"id\":\"1\",\"format\":\"html\"}",
  )
  assert_true(tree.contains("&lt;script&gt;"))
  assert_true(tree.contains("node0"))
  assert_true(tree.contains("node2"))
  assert_true(
    try {
      ignore(
        i.export_report(
          h, "{\"view\":\"explain\",\"id\":\"1\",\"format\":\"csv\"}",
        ),
      )
      false
    } catch {
      Invalid(_) => true
      _ => false
    },
  )
}
