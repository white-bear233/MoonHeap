///|
fn frame_json(f : AllocationFrame) -> Json {
  {
    "function_id": @json.to_json(f.function_id),
    "name": @json.to_json(f.name),
    "script_name": @json.to_json(f.script_name),
    "script_id": @json.to_json(f.script_id),
    "line": @json.to_json(f.line),
    "column": @json.to_json(f.column),
  }
}

///|
fn advanced_query(
  a : Analysis,
  req : Json,
  op : String,
  offset : Int32,
  limit : Int32,
) -> Json raise HeapError {
  let s = a.graph.snapshot
  match op {
    "source" => {
      let index = selected_node(s, req)
      let frames = s.allocation_stack(index)
      let location = match s.source_location(index) {
        None => Json::null()
        Some(l) =>
          {
            "script_id": @json.to_json(l.script_id),
            "line": @json.to_json(l.line),
            "column": @json.to_json(l.column),
            "coordinate_base": 0,
          }
      }
      let totals = match s.allocation_totals(index) {
        None => Json::null()
        Some((count, size)) =>
          { "count": bytes_json(count), "bytes": bytes_json(size) }
      }
      {
        "node": node_json(a, s.nodes[index]),
        "location": location,
        "frames": @json.to_json(frames.map(frame_json)),
        "allocation_totals": totals,
        "available": @json.to_json(!frames.is_empty()),
        "interpretation": "Allocation frames require tracking during capture. Counts and bytes describe the allocation site, not this object's current size.",
      }
    }
    "paths" => {
      let search = a.graph.root_paths(
        selected_node(s, req),
        max_paths=int_option(req, "max_paths", 5),
        max_depth=int_option(req, "max_depth", 64),
        max_work=int_option(req, "max_work", 50000),
      )
      {
        "paths": @json.to_json(
          search.paths.map(p => p.map(e => edge_json(a, e))),
        ),
        "complete": @json.to_json(search.complete),
        "examined": @json.to_json(search.examined),
        "stop_reason": @json.to_json(search.stop_reason),
      }
    }
    "tree" => {
      let node = match optional(req, "id") {
        Some(_) => selected_node(s, req)
        None => int_option(req, "index", s.root)
      }
      {
        "node": node_json(a, s.node(node)),
        "children": node_page_json(a, a.dominated(node, offset~, limit~)),
        "ancestors": @json.to_json(
          a.dominator_chain(node).map(n => node_json(a, n)),
        ),
      }
    }
    "cycles" | "cycle" => {
      let q = string_option(req, "query", "")
      let all = a.graph.cycles()
      if op == "cycle" {
        let id = int_option(req, "cycle_id", -1)
        let mut group : CycleGroup? = None
        for c in all {
          if c.id == id {
            group = Some(c)
            break
          }
        }
        match group {
          None => raise NotFound("cycle \{id}")
          Some(c) => {
            let items : Array[Json] = []
            for i in 0..<c.members.length() {
              if i >= offset && items.length() < limit {
                items.push(node_json(a, s.nodes[c.members[i]]))
              }
            }
            {
              "items": @json.to_json(items),
              "total": @json.to_json(c.members.length()),
              "offset": @json.to_json(offset),
              "cycle_id": @json.to_json(id),
            }
          }
        }
      } else {
        let groups = all.filter(c => {
          q == "" || c.members.any(i => s.nodes[i].name.contains(q))
        })
        let items : Array[Json] = []
        for i in 0..<groups.length() {
          if i >= offset && items.length() < limit {
            let c = groups[i]
            let sample : Array[Json] = []
            for j in 0..<c.members.length() {
              if j < 8 {
                sample.push(node_json(a, s.nodes[c.members[j]]))
              }
            }
            items.push({
              "cycle_id": @json.to_json(c.id),
              "count": @json.to_json(c.members.length()),
              "shallow_bytes": bytes_json(c.shallow_bytes),
              "sample": @json.to_json(sample),
            })
          }
        }
        {
          "items": @json.to_json(items),
          "total": @json.to_json(groups.length()),
          "offset": @json.to_json(offset),
          "interpretation": "Strong reference cycles, including self references. Cycles alone do not prove a leak.",
        }
      }
    }
    _ => raise Invalid("unknown operation: \{op}")
  }
}
