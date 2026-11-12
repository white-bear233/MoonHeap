///|
struct Inspector {
  sessions : Map[Int32, Analysis]
  mut next_id : Int32
}

///|
pub fn Inspector::new() -> Inspector {
  { sessions: Map([]), next_id: 1, }
}

///|
pub fn Inspector::open(
  self : Inspector,
  input : String,
  limits~ : Limits = Limits::default(),
) -> Int32 raise HeapError {
  guard self.sessions.length() < 2 else {
    raise Limit("close a snapshot before loading more than two")
  }
  guard self.next_id < 2147483647 else {
    raise Limit("inspector handle range exhausted")
  }
  let a = parse(input, limits~).graph().analyze()
  let id = self.next_id
  self.next_id += 1
  self.sessions[id] = a
  id
}

///|
pub fn Inspector::close(self : Inspector, handle : Int32) -> Unit {
  self.sessions.remove(handle)
}

///|
fn Inspector::get(self : Inspector, handle : Int32) -> Analysis raise HeapError {
  match self.sessions.get(handle) {
    Some(a) => a
    None => raise NotFound("snapshot handle \{handle}")
  }
}

///|
fn request(input : String) -> Json raise HeapError {
  guard input.length() <= 8192 else { raise Limit("request too large") }
  let v = @json.parse(input, reject_duplicate_keys=true, max_nesting_depth=16) catch {
    _ => raise Invalid("invalid request JSON")
  }
  guard v is Object(_) else { raise Invalid("request must be an object") }
  v
}

///|
fn optional(doc : Json, key : String) -> Json? {
  match doc {
    Object(m) => m.get(key)
    _ => None
  }
}

///|
fn string_option(
  doc : Json,
  key : String,
  fallback : String,
) -> String raise HeapError {
  match optional(doc, key) {
    None => fallback
    Some(v) => text(v, key)
  }
}

///|
fn int_option(
  doc : Json,
  key : String,
  fallback : Int32,
) -> Int32 raise HeapError {
  match optional(doc, key) {
    None => fallback
    Some(v) => integer(v, key)
  }
}

///|
fn bool_option(
  doc : Json,
  key : String,
  fallback : Bool,
) -> Bool raise HeapError {
  match optional(doc, key) {
    None => fallback
    Some(True) => true
    Some(False) => false
    _ => raise Invalid("\{key}: expected boolean")
  }
}

///|
fn selected_node(s : Snapshot, req : Json) -> Int32 raise HeapError {
  match optional(req, "id") {
    Some(v) => {
      let id = text(v, "id")
      match s.find_id(id) {
        Some(i) => i
        None => raise NotFound("object id \{id}")
      }
    }
    None => {
      let i = integer(field(req, "index"), "index")
      ignore(s.node(i))
      i
    }
  }
}

///|
// Sizes are limited to the JS-safe range by the parser. IDs stay strings.
fn bytes_json(value : Int64) -> Json {
  @json.to_json(value.to_double())
}

///|
fn optional_bytes(value : Int64?) -> Json {
  match value {
    Some(n) => bytes_json(n)
    None => Json::null()
  }
}

///|
fn optional_count(value : Int32?) -> Json {
  match value {
    Some(n) => @json.to_json(n)
    None => Json::null()
  }
}

///|
fn node_json(a : Analysis, n : Node) -> Json {
  let parent = if n.index == a.graph.snapshot.root || a.idom[n.index] < 0 {
    Json::null()
  } else {
    @json.to_json(a.graph.snapshot.nodes[a.idom[n.index]].id)
  }
  {
    "index": @json.to_json(n.index),
    "id": @json.to_json(n.id),
    "kind": @json.to_json(n.kind),
    "name": @json.to_json(n.name),
    "shallow_bytes": bytes_json(n.self_size),
    "retained_bytes": optional_bytes(
      if a.retained[n.index] < 0L {
        None
      } else {
        Some(a.retained[n.index])
      },
    ),
    "distance": optional_count(
      if a.graph.distance[n.index] < 0 {
        None
      } else {
        Some(a.graph.distance[n.index])
      },
    ),
    "dominator_id": parent,
  }
}

///|
fn edge_json(a : Analysis, e : Edge) -> Json {
  {
    "index": @json.to_json(e.index),
    "kind": @json.to_json(e.kind),
    "name": @json.to_json(e.name),
    "retaining": @json.to_json(a.graph.retaining[e.index]),
    "source": node_json(a, a.graph.snapshot.nodes[e.source]),
    "target": node_json(a, a.graph.snapshot.nodes[e.target]),
  }
}

///|
fn node_page_json(a : Analysis, p : NodePage) -> Json {
  {
    "items": @json.to_json(p.items.map(n => node_json(a, n))),
    "total": @json.to_json(p.total),
    "offset": @json.to_json(p.offset),
  }
}

///|
pub fn Inspector::query(
  self : Inspector,
  handle : Int32,
  input : String,
) -> Json raise HeapError {
  let req = request(input)
  let a = self.get(handle)
  let s = a.graph.snapshot
  let op = string_option(req, "op", "summary")
  let offset = int_option(req, "offset", 0)
  let limit = int_option(req, "limit", 100)
  page_bounds(offset, limit)
  match op {
    "summary" =>
      {
        "nodes": @json.to_json(s.node_count()),
        "edges": @json.to_json(s.edge_count()),
        "root_id": @json.to_json(s.nodes[s.root].id),
        "reachable_nodes": @json.to_json(a.reachable_count),
        "unreachable_nodes": @json.to_json(s.node_count() - a.reachable_count),
        "total_shallow_bytes": bytes_json(s.total_size),
        "reachable_bytes": bytes_json(a.retained[s.root]),
        "policy": "snapshot-strong-v1",
        "conditional_weakmap_edges": @json.to_json(a.graph.conditional_edges),
        "dominator_iterations": @json.to_json(a.iterations),
        "interpretation": "Reported-strong graph bytes; not RSS, GC prediction, or an automatic leak verdict. WeakMap conditional edges remain conservative graph edges.",
      }
    "nodes" =>
      node_page_json(
        a,
        a.nodes(
          order=string_option(req, "order", "retained"),
          query=string_option(req, "query", ""),
          kind=string_option(req, "kind", ""),
          offset~,
          limit~,
        ),
      )
    "groups" => {
      let q = string_option(req, "query", "")
      let groups = a.groups().filter(g => q == "" || g.name.contains(q))
      let items : Array[Json] = []
      for i in 0..<groups.length() {
        if i >= offset && items.length() < limit {
          let g = groups[i]
          items.push({
            "kind": @json.to_json(g.kind),
            "name": @json.to_json(g.name),
            "count": @json.to_json(g.count),
            "shallow_bytes": bytes_json(g.shallow_bytes),
            "max_retained_bytes": optional_bytes(g.max_retained_bytes),
          })
        }
      }
      {
        "items": @json.to_json(items),
        "total": @json.to_json(groups.length()),
        "offset": @json.to_json(offset),
      }
    }
    "node" => node_json(a, s.node(selected_node(s, req)))
    "dominated" =>
      node_page_json(a, a.dominated(selected_node(s, req), offset~, limit~))
    "references" => {
      let p = a.graph.references(
        selected_node(s, req),
        incoming=bool_option(req, "incoming", true),
        retaining_only=bool_option(req, "retaining_only", false),
        offset~,
        limit~,
      )
      {
        "items": @json.to_json(p.items.map(e => edge_json(a, e))),
        "total": @json.to_json(p.total),
        "offset": @json.to_json(offset),
      }
    }
    "path" => {
      let path = a.graph.root_path(
        selected_node(s, req),
        max_depth=int_option(req, "max_depth", 1024),
      )
      {
        "reachable": @json.to_json(path is Some(_)),
        "edges": match path {
          Some(p) => @json.to_json(p.map(e => edge_json(a, e)))
          None => Json::null()
        },
      }
    }
    _ => raise Invalid("unknown operation: \{op}")
  }
}

///|
pub fn Inspector::diff(
  self : Inspector,
  before : Int32,
  after : Int32,
  input : String,
) -> Json raise HeapError {
  let req = request(input)
  let offset = int_option(req, "offset", 0)
  let limit = int_option(req, "limit", 100)
  page_bounds(offset, limit)
  let result = compare(
    self.get(before).graph.snapshot,
    self.get(after).graph.snapshot,
    same_isolate=bool_option(req, "same_isolate", false),
  )
  let query = string_option(req, "query", "")
  let rows = result.groups.filter(g => query == "" || g.name.contains(query))
  let groups : Array[Json] = []
  for i in 0..<rows.length() {
    if i >= offset && groups.length() < limit {
      let g = rows[i]
      groups.push({
        "kind": @json.to_json(g.kind),
        "name": @json.to_json(g.name),
        "before_count": @json.to_json(g.before_count),
        "after_count": @json.to_json(g.after_count),
        "count_delta": @json.to_json(g.after_count - g.before_count),
        "before_bytes": bytes_json(g.before_bytes),
        "after_bytes": bytes_json(g.after_bytes),
        "bytes_delta": bytes_json(g.after_bytes - g.before_bytes),
      })
    }
  }
  let changes : Array[Json] = []
  let filtered = result.changes.filter(c => {
    query == "" || c.name.contains(query)
  })
  for i in 0..<filtered.length() {
    if i >= offset && changes.length() < limit {
      let c = filtered[i]
      changes.push({
        "id": @json.to_json(c.id),
        "name": @json.to_json(c.name),
        "kind": @json.to_json(c.kind),
        "status": @json.to_json(c.status),
        "before_bytes": optional_bytes(c.before_bytes),
        "after_bytes": optional_bytes(c.after_bytes),
      })
    }
  }
  {
    "mode": @json.to_json(result.mode),
    "groups": @json.to_json(groups),
    "total_groups": @json.to_json(rows.length()),
    "added": optional_count(result.added),
    "removed": optional_count(result.removed),
    "survived": optional_count(result.survived),
    "changes": @json.to_json(changes),
    "total_changes": @json.to_json(filtered.length()),
    "offset": @json.to_json(offset),
    "interpretation": "Growth is not proof of a leak. Identity mode relies on caller-confirmed same-isolate provenance.",
  }
}

///|
pub fn success(value : Json) -> String {
  ({ "api_version": 1, "ok": true, "data": value } : Json).stringify()
}

///|
pub fn failure(error : HeapError) -> String {
  let (code, message) = match error {
    Invalid(s) => ("invalid_input", s)
    Limit(s) => ("resource_limit", s)
    NotFound(s) => ("not_found", s)
    Identity(s) => ("identity_conflict", s)
  }
  (
    {
      "api_version": 1,
      "ok": false,
      "error": {
        "code": @json.to_json(code),
        "message": @json.to_json(message),
      },
    } : Json).stringify()
}
