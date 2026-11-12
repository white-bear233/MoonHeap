///|
test "reverse graph contains both retainers and shortest path is deterministic" {
  let g = parse(tiny()).graph()
  assert_eq(g.incoming_offsets[4] - g.incoming_offsets[3], 2)
  assert_eq(g.root_distance(3), Some(2))
  let path = g.root_path(3).unwrap()
  assert_eq(path.length(), 2)
  assert_eq(path[0].source, 0)
  assert_eq(path[1].target, 3)
  assert_eq(g.root_path(0), Some([]))
}

///|
test "weak and non-root shortcut edges do not retain" {
  let s = tiny().replace_all(old="0,3,15", new="1,3,15")
  let g = parse(s).graph()
  assert_eq(g.root_distance(3), None)
  assert_eq(g.root_path(3), None)
  assert_true(!g.is_retaining(2))
  let s = tiny().replace_all(old="0,3,15", new="2,3,15")
  assert_eq(parse(s).graph().root_path(3), None)
  let s = tiny().replace(old="0,1,5", new="2,1,5")
  assert_eq(parse(s).graph().root_distance(1), Some(1))
}

///|
test "path budget fails explicitly" {
  let g = parse(tiny()).graph()
  assert_true(
    try {
      ignore(g.root_path(3, max_depth=1))
      false
    } catch {
      _ => true
    },
  )
}
