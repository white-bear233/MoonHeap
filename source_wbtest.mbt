///|
test "allocation metadata preserves locations and ordered caller chain" {
  let input =
    #|{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count","trace_node_id"],"node_types":[["synthetic","object"],"string","number","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["property"],"string_or_number","node"],"trace_function_info_fields":["function_id","name","script_name","script_id","line","column"],"trace_node_fields":["id","function_info_index","count","size","children"],"location_fields":["object_index","script_id","line","column"]},"node_count":2,"edge_count":1},"nodes":[0,0,1,0,1,0,1,1,3,32,0,2],"edges":[0,1,6],"strings":["root","cache","caller","allocate","app.mjs"],"trace_function_infos":[1,2,4,7,2,1,2,3,4,7,10,3],"trace_tree":[1,0,1,32,[2,1,1,32,[]]],"locations":[6,7,9,2]}
  let s = parse(input)
  assert_eq(s.source_location(1), Some({ script_id: 7, line: 9, column: 2, }))
  let stack = s.allocation_stack(1)
  assert_eq(stack.length(), 2)
  assert_eq(stack[0].name, "allocate")
  assert_eq(stack[1].name, "caller")
  assert_eq(s.allocation_totals(1), Some((1L, 32L)))
  assert_eq(s.allocation_stack(0).length(), 0)
  for
    bad in [
      input.replace(old="\"locations\":[6", new="\"locations\":[5"),
      input.replace(old="32,0,2]", new="32,0,99]"),
      input.replace(old="[2,1,1,32,[]]", new="[1,1,1,32,[]]"),
    ] {
    assert_true(
      try {
        ignore(parse(bad))
        false
      } catch {
        _ => true
      },
    )
  }
}
