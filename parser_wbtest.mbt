///|
fn tiny() -> String {
  (
    #|{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count"],"node_types":[["synthetic","object"],"string","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["property","weak","shortcut","internal","element","hidden"],"string_or_number","node"]},"node_count":4,"edge_count":4},"nodes":[0,0,1,0,2,1,1,9007199254740993,10,1,1,2,5,20,1,1,3,7,30,0],"edges":[0,1,5,0,2,10,0,3,15,0,3,15],"strings":["root","A","B","shared"]}
  )
}

///|
test "V8 may emit unused trailing type descriptors" {
  let source = tiny().replace(
    old="\"number\",\"number\",\"number\"]",
    new="\"number\",\"number\",\"number\",\"number\"]",
  )
  assert_eq(parse(source).node_count(), 4)
}

///|
test "metadata parser preserves exact ids and shared edges" {
  let s = parse(tiny())
  assert_eq(s.node_count(), 4)
  assert_eq(s.edge_count(), 4)
  assert_eq(s.total_shallow_bytes(), 60L)
  assert_eq(s.find_id("9007199254740993"), Some(1))
  assert_eq(s.node(1).name, "A")
  assert_eq(s.edge(3).source, 2)
  assert_eq(s.edge(3).target, 3)
}

///|
test "reject malformed structures without panicking" {
  let bad = [
    "{}",
    "{",
    "[]",
    "{\"snapshot\":1}",
    tiny().replace(old="\"node_count\":4", new="\"node_count\":5"),
    tiny().replace(old="\"edge_count\":4", new="\"edge_count\":3"),
    tiny().replace(old="9007199254740993", new="1"),
    tiny().replace(old="9007199254740993", new="18446744073709551616"),
    tiny().replace(old="9007199254740993", new="-1"),
    tiny().replace(old="9007199254740993", new="1.5"),
    tiny().replace(old="0,3,15", new="0,3,14"),
    tiny().replace(old="0,3,15", new="0,99,15"),
    tiny().replace(old="\"property\"", new="\"unknown\""),
    tiny().replace(
      old="\"node_count\":4",
      new="\"node_count\":4,\"node_count\":4",
    ),
    tiny().replace(old="\"self_size\"", new="\"id\""),
  ]
  for input in bad {
    let rejected = try {
      ignore(parse(input))
      false
    } catch {
      _ => true
    }
    assert_true(rejected, msg=input)
  }
}

///|
test "resource limits and public bounds" {
  let small = { ..Limits::default(), max_nodes: 2, }
  assert_true(
    try {
      ignore(parse(tiny(), limits=small))
      false
    } catch {
      _ => true
    },
  )
  let small = { ..Limits::default(), max_chars: 20, }
  assert_true(
    try {
      ignore(parse(tiny(), limits=small))
      false
    } catch {
      _ => true
    },
  )
  let s = parse(tiny())
  assert_true(
    try {
      ignore(s.node(-1))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(s.edge(4))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "node fields may be reordered" {
  let source = tiny()
    .replace(
      old="\"type\",\"name\",\"id\",\"self_size\",\"edge_count\"",
      new="\"name\",\"type\",\"id\",\"self_size\",\"edge_count\"",
    )
    .replace(
      old="[[\"synthetic\",\"object\"],\"string\"",
      new="[\"string\",[\"synthetic\",\"object\"]",
    )
    .replace(old="1,2,5,20,1,1,3,7,30,0", new="2,1,5,20,1,3,1,7,30,0")
  let s = parse(source)
  assert_eq(s.node(2).name, "B")
  assert_eq(s.node(3).kind, "object")
}
