///|
/// A portable consumer example. The file-reading CLI lives in bin/moonheap.mjs.
fn main {
  let input =
    #|{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count"],"node_types":[["synthetic","object"],"string","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["property"],"string_or_number","node"]},"node_count":2,"edge_count":1},"nodes":[0,0,1,0,1,1,1,3,32,0],"edges":[0,1,5],"strings":["root","cache"]}
  try {
    let snapshot = @heap.parse(input)
    let analysis = snapshot.graph().analyze()
    println("objects: \{snapshot.node_count()}")
    println("root retained bytes: \{analysis.retained_bytes(0).unwrap()}")
    println(
      "cache root distance: \{analysis.graph().root_distance(1).unwrap()}",
    )
  } catch {
    e => println(@heap.failure(e))
  }
}
