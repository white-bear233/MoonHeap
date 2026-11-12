///|
test "default diff is aggregate, even when ids happen to match" {
  let s = parse(tiny())
  let d = compare(s, s)
  assert_eq(d.mode, "aggregate")
  assert_eq(d.added, None)
  assert_eq(d.changes.length(), 0)
  for g in d.groups {
    assert_eq(g.before_count, g.after_count)
  }
}

///|
test "explicit identity handles additions removals and resized survivors" {
  let before = parse(tiny())
  let after = parse(
    tiny()
    .replace(old="9007199254740993", new="9007199254740995")
    .replace(old="5,20,1", new="5,25,1"),
  )
  let d = compare(before, after, same_isolate=true)
  assert_eq(d.added, Some(1))
  assert_eq(d.removed, Some(1))
  assert_eq(d.survived, Some(3))
  assert_eq(d.changes.length(), 3)
  assert_eq(d.groups[0].after_bytes - d.groups[0].before_bytes, 5L)
}

///|
test "contradictory identities reject instead of silently pairing unrelated objects" {
  let before = parse(tiny())
  let after = parse(tiny().replace(old="\"A\"", new="\"Other\""))
  assert_true(
    try {
      ignore(compare(before, after, same_isolate=true))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(compare(before, after).mode, "aggregate")
}
