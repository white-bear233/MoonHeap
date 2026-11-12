///|
test "resource budgets reject zero and negative limits" {
  let l = Limits::default()
  validate_limits(l)
  let bad = { ..l, max_nodes: 0, }
  let rejected = try {
    validate_limits(bad)
    false
  } catch {
    _ => true
  }
  assert_true(rejected)
}
