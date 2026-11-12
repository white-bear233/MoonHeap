///|
fn field(value : Json, key : String) -> Json raise HeapError {
  match value {
    Object(m) =>
      match m.get(key) {
        Some(v) => v
        None => raise Invalid("missing field: \{key}")
      }
    _ => raise Invalid("expected object containing \{key}")
  }
}

///|
fn array(value : Json, context : String) -> Array[Json] raise HeapError {
  match value {
    Array(a) => a
    _ => raise Invalid("\{context}: expected array")
  }
}

///|
fn text(value : Json, context : String) -> String raise HeapError {
  match value {
    String(s) => s
    _ => raise Invalid("\{context}: expected string")
  }
}

///|
fn unsigned(value : Json, context : String) -> UInt64 raise HeapError {
  guard value is Number(_, ..) else {
    raise Invalid("\{context}: expected integer")
  }
  let raw = value.stringify()
  guard raw.length() > 0 else { raise Invalid(context) }
  for c in raw.iter() {
    guard c >= '0' && c <= '9' else {
      raise Invalid("\{context}: expected nonnegative decimal integer")
    }
  }
  @string.parse_uint64(raw) catch {
    _ => raise Invalid("\{context}: integer overflow")
  }
}

///|
fn integer(value : Json, context : String) -> Int32 raise HeapError {
  let n = unsigned(value, context)
  guard n <= 2147483647UL else {
    raise Limit("\{context}: exceeds index range")
  }
  n.to_int()
}

///|
fn string_array(
  value : Json,
  context : String,
) -> Array[String] raise HeapError {
  array(value, context).map(v => text(v, context))
}

///|
fn offset(fields : Array[String], name : String) -> Int32 raise HeapError {
  for i in 0..<fields.length() {
    if fields[i] == name {
      return i
    }
  }
  raise Invalid("missing metadata field: \{name}")
}

///|
fn unique_fields(fields : Array[String]) -> Unit raise HeapError {
  let seen : Map[String, Bool] = Map([])
  for f in fields {
    guard !seen.contains(f) else {
      raise Invalid("duplicate metadata field: \{f}")
    }
    seen[f] = true
  }
}

///|
fn indexed(
  strings : Array[String],
  index : Int32,
  context : String,
) -> String raise HeapError {
  guard index >= 0 && index < strings.length() else {
    raise Invalid("\{context}: index out of range")
  }
  strings[index]
}

///|
/// Read a V8 snapshot. All arrays and metadata are validated before graph analysis.
pub fn parse(
  input : String,
  limits~ : Limits = Limits::default(),
) -> Snapshot raise HeapError {
  validate_limits(limits)
  guard input.length() <= limits.max_chars else {
    raise Limit("input exceeds max_chars")
  }
  let doc = @json.parse(
    input,
    reject_duplicate_keys=true,
    preserve_number_repr=true,
    max_nesting_depth=64,
  ) catch {
    e => raise Invalid("JSON: \{e}")
  }
  parse_document(doc, limits)
}

///|
fn parse_document(doc : Json, limits : Limits) -> Snapshot raise HeapError {
  let header = field(doc, "snapshot")
  let meta = field(header, "meta")
  let nf = string_array(field(meta, "node_fields"), "node_fields")
  let ef = string_array(field(meta, "edge_fields"), "edge_fields")
  unique_fields(nf)
  unique_fields(ef)
  let nt = offset(nf, "type")
  let nn = offset(nf, "name")
  let ni = offset(nf, "id")
  let ns = offset(nf, "self_size")
  let nc = offset(nf, "edge_count")
  let et = offset(ef, "type")
  let en = offset(ef, "name_or_index")
  let ed = offset(ef, "to_node")
  let node_meta = array(field(meta, "node_types"), "node_types")
  let edge_meta = array(field(meta, "edge_types"), "edge_types")
  guard node_meta.length() == nf.length() && edge_meta.length() == ef.length() else {
    raise Invalid("field/type metadata length mismatch")
  }
  let node_types = string_array(node_meta[nt], "node type names")
  let edge_types = string_array(edge_meta[et], "edge type names")
  let count = integer(field(header, "node_count"), "node_count")
  let ecount = integer(field(header, "edge_count"), "edge_count")
  guard count > 0 else { raise Invalid("snapshot must contain root") }
  guard count <= limits.max_nodes && ecount <= limits.max_edges else {
    raise Limit("node/edge budget exceeded")
  }
  let raw_nodes = array(field(doc, "nodes"), "nodes")
  let raw_edges = array(field(doc, "edges"), "edges")
  guard raw_nodes.length().to_int64() ==
    count.to_int64() * nf.length().to_int64() &&
    raw_edges.length().to_int64() == ecount.to_int64() * ef.length().to_int64() else {
    raise Invalid("flat array length/count mismatch")
  }
  let raw_strings = array(field(doc, "strings"), "strings")
  guard raw_strings.length() <= limits.max_strings else {
    raise Limit("string table budget exceeded")
  }
  let strings = raw_strings.map(v => text(v, "string table"))
  // Validate extra numeric fields too; unknown optional columns can be retained by the producer.
  for v in raw_nodes {
    ignore(unsigned(v, "nodes"))
  }
  for v in raw_edges {
    ignore(unsigned(v, "edges"))
  }
  let ids : Map[String, Int32] = Map([])
  let nodes : Array[Node] = []
  let mut edge_cursor = 0
  let mut total = 0L
  for i in 0..<count {
    let b = i * nf.length()
    let id = unsigned(raw_nodes[b + ni], "node id").to_string()
    guard !ids.contains(id) else { raise Invalid("duplicate node id: \{id}") }
    ids[id] = i
    let size = unsigned(raw_nodes[b + ns], "self_size")
    guard size <= 9007199254740991UL else {
      raise Limit("self_size exceeds exact byte range")
    }
    total += size.reinterpret_as_int64()
    guard total <= 9007199254740991L else {
      raise Limit("total size exceeds exact byte range")
    }
    let edges = integer(raw_nodes[b + nc], "node edge_count")
    guard edges <= ecount - edge_cursor else {
      raise Invalid("node edge counts exceed total")
    }
    nodes.push({
      index: i,
      id,
      kind: indexed(
        node_types,
        integer(raw_nodes[b + nt], "node type"),
        "node type",
      ),
      name: indexed(
        strings,
        integer(raw_nodes[b + nn], "node name"),
        "node name",
      ),
      self_size: size.reinterpret_as_int64(),
      edge_start: edge_cursor,
      edge_count: edges,
    })
    edge_cursor += edges
  }
  guard edge_cursor == ecount else {
    raise Invalid("node edge counts do not sum to edge_count")
  }
  let root_raw = match header {
    Object(m) => m.get("root_index")
    _ => None
  }
  let root_offset = match root_raw {
    Some(v) => integer(v, "root_index")
    None => 0
  }
  guard root_offset % nf.length() == 0 && root_offset < raw_nodes.length() else {
    raise Invalid("invalid root offset")
  }
  let root = root_offset / nf.length()
  guard nodes[root].kind == "synthetic" else {
    raise Invalid("root must be synthetic")
  }
  let edges : Array[Edge] = []
  for node in nodes {
    for index in node.edge_start..<(node.edge_start + node.edge_count) {
      let b = index * ef.length()
      let kind = indexed(
        edge_types,
        integer(raw_edges[b + et], "edge type"),
        "edge type",
      )
      guard kind == "context" ||
        kind == "element" ||
        kind == "property" ||
        kind == "internal" ||
        kind == "hidden" ||
        kind == "shortcut" ||
        kind == "weak" else {
        raise Invalid("unsupported edge type: \{kind}")
      }
      let dest = integer(raw_edges[b + ed], "to_node")
      guard dest % nf.length() == 0 && dest < raw_nodes.length() else {
        raise Invalid("edge target must be a node offset")
      }
      let name = if kind == "element" || kind == "hidden" {
        unsigned(raw_edges[b + en], "edge name").to_string()
      } else {
        indexed(strings, integer(raw_edges[b + en], "edge name"), "edge name")
      }
      edges.push({
        index,
        source: node.index,
        target: dest / nf.length(),
        kind,
        name,
      })
    }
  }
  { nodes, edges, ids, root, total_size: total, limits, }
}
