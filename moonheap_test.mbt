///|
test "public query results cannot mutate the indexed snapshot" {
  let input =
    #|{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count"],"node_types":[["synthetic","object"],"string","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["property"],"string_or_number","node"]},"node_count":2,"edge_count":1},"nodes":[0,0,1,0,1,1,1,3,32,0],"edges":[0,1,5],"strings":["root","cache"]}
  let snapshot = @moonheap.parse(input)
  let graph = snapshot.graph()
  let analysis = graph.analyze()
  let page = analysis.nodes()
  page.items.clear()
  let refs = graph.references(1)
  refs.items.clear()
  let groups = analysis.groups()
  groups.clear()
  assert_eq(analysis.nodes().total, 2)
  assert_eq(graph.references(1).total, 1)
  assert_eq(analysis.retained_bytes(0), Some(32L))
  assert_eq(snapshot.find_id("3"), Some(1))
}
