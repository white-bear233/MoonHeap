///|
test "incremental decoder accepts every split including integers and escapes" {
  let input = tiny().replace(
    old="\"shared\"",
    new="\"escaped\\\\slash\\nquote\\\"\\u4e2d\"",
  )
  let expected = parse(input)
  for width in [1, 2, 3, 7, 31, 128] {
    let decoder = Decoder::new()
    let chars = input.iter().to_array()
    let mut i = 0
    while i < chars.length() {
      let b = StringBuilder()
      for _ in 0..<width {
        if i < chars.length() {
          b.write_char(chars[i])
          i += 1
        }
      }
      decoder.feed(b.to_string())
    }
    let actual = decoder.finish()
    assert_eq(actual.node(1).id, "9007199254740993")
    assert_eq(actual.node(3).name, expected.node(3).name)
    assert_eq(actual.edge_count(), 4)
  }
}

///|
test "streaming reader rejects truncation separators and poisoned reuse" {
  for
    input in [
      "{",
      "{\"nodes\":[1,]}",
      "{\"nodes\":[01]}",
      "{\"nodes\":[1e3]}",
      "{\"strings\":[\"x\",]}",
      "{\"snapshot\":{},}",
      "{\"nodes\":[1 2]}",
      "{\"nodes\":[18446744073709551616]}",
      tiny() + "x",
      tiny().replace(old="\"strings\":[", new="\"nodes\":[],\"strings\":["),
    ] {
    let d = Decoder::new()
    assert_true(
      try {
        d.feed(input)
        ignore(d.finish())
        false
      } catch {
        _ => true
      },
    )
  }
  let d = Decoder::new()
  d.feed(tiny())
  ignore(d.finish())
  assert_true(
    try {
      d.feed(" ")
      false
    } catch {
      _ => true
    },
  )
}
