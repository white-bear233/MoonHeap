///|
test "rankings, search and pages return stable node identities" {
  let a = parse(tiny()).graph().analyze()
  assert_eq(a.nodes(limit=2).items.map(n => n.index), [0, 3])
  assert_eq(
    a.nodes(order="shallow", offset=1, limit=2).items.map(n => n.index),
    [2, 1],
  )
  assert_eq(a.nodes(query="A").total, 1)
  assert_eq(a.nodes(kind="object").total, 3)
  assert_eq(a.nodes(offset=2147483647).total, 4)
  assert_eq(a.nodes(offset=2147483647).items.length(), 0)
  assert_true(
    try {
      ignore(a.nodes(limit=0))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(a.dominated(0).total, 3)
}

///|
test "groups use shallow bytes and reference paging preserves totals" {
  let a = parse(tiny()).graph().analyze()
  let groups = a.groups()
  assert_eq(groups[0].name, "shared")
  assert_eq(groups[0].shallow_bytes, 30L)
  let page = a.graph.references(3, offset=1, limit=1)
  assert_eq(page.total, 2)
  assert_eq(page.items[0].source, 2)
  assert_eq(a.graph.references(0, incoming=false).total, 2)
}
