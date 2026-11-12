///|
test "full reports cross pagination boundaries and refuse silent truncation" {
  let i = Inspector::new()
  let h = i.accept(graph_fixture(1205, []))
  let report = i.report(
    h, "{\"view\":\"nodes\",\"order\":\"index\",\"max_rows\":1300}",
  )
  let data = field(report, "data")
  assert_eq(array(field(data, "items"), "items").length(), 1205)
  assert_eq(integer(field(data, "total"), "total"), 1205)
  assert_true(
    try {
      ignore(i.report(h, "{\"max_rows\":100}"))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "report serialization escapes HTML and protects spreadsheet text" {
  let i = Inspector::new()
  let h = i.open(tiny().replace(old="\"A\"", new="\"=SUM(1,2)<img>\""))
  let csv = i.export_report(h, "{\"format\":\"csv\"}")
  assert_true(csv.contains("'9007199254740993"))
  assert_true(csv.contains("'=SUM(1,2)<img>"))
  let html = i.export_report(h, "{\"format\":\"html\"}")
  assert_true(html.contains("&lt;img&gt;"))
  assert_true(!html.contains("<img>"))
}
