///|
test "inspector lifecycle and versioned JSON errors" {
  let i = Inspector::new()
  let first = i.open(tiny())
  let second = i.open(tiny())
  assert_true(
    try {
      ignore(i.open(tiny()))
      false
    } catch {
      _ => true
    },
  )
  let response = i.query(first, "{\"op\":\"node\",\"id\":\"9007199254740993\"}")
  assert_eq(field(response, "id"), Json::string("9007199254740993"))
  assert_eq(
    field(i.diff(first, second, "{}"), "mode"),
    Json::string("aggregate"),
  )
  assert_true(
    try {
      ignore(i.query(first, "{\"op\":\"unknown\"}"))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(i.query(first, "[]"))
      false
    } catch {
      _ => true
    },
  )
  i.close(first)
  assert_true(
    try {
      ignore(i.query(first, "{}"))
      false
    } catch {
      _ => true
    },
  )
  ignore(i.open(tiny()))
  assert_true(failure(Limit("budget")).contains("resource_limit"))
  assert_true(success(response).contains("api_version"))
}
