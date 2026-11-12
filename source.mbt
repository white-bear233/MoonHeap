///|
#derive(Debug, Eq)
pub(all) struct SourceLocation {
  script_id : Int32
  line : Int32
  column : Int32
}

///|
pub extend SourceLocation with Debug::{to_repr}

///|
pub extend SourceLocation with Eq::{equal, not_equal}

///|
pub(all) struct AllocationFrame {
  function_id : String
  name : String
  script_name : String
  script_id : Int32
  line : Int32
  column : Int32
}

///|
priv struct AllocationTrace {
  parent : Int32
  function_index : Int32
  count : Int64
  bytes : Int64
}

///|
priv struct SourceIndex {
  origins : Array[Int32]
  locations : Map[Int32, SourceLocation]
  functions : Array[AllocationFrame]
  traces : Map[Int32, AllocationTrace]
}

///|
fn empty_sources(count : Int32) -> SourceIndex {
  {
    origins: Array::make(count, 0),
    locations: Map([]),
    functions: [],
    traces: Map([]),
  }
}

///|
fn signed_index(v : Json, context : String) -> Int32 raise HeapError {
  guard v is Number(_, ..) else {
    raise Invalid("\{context}: expected integer")
  }
  @string.parse_int(v.stringify()) catch {
    _ => raise Invalid("\{context}: invalid integer")
  }
}

///|
fn safe_bytes(v : Json, context : String) -> Int64 raise HeapError {
  let n = unsigned(v, context)
  guard n <= 9007199254740991UL else {
    raise Limit("\{context}: exceeds exact byte range")
  }
  n.reinterpret_as_int64()
}

///|
priv struct TraceWork {
  items : Array[Json]
  parent : Int32
}

///|
fn parse_sources(
  metadata : Map[String, Json],
  meta : Json,
  fields : Array[String],
  raw_nodes : Array[UInt64],
  strings : Array[String],
  count : Int32,
) -> SourceIndex raise HeapError {
  let source = empty_sources(count)
  for col in 0..<fields.length() {
    if fields[col] == "trace_node_id" {
      for i in 0..<count {
        source.origins[i] = index_value(
          raw_nodes[i * fields.length() + col],
          "trace_node_id",
        )
      }
    }
  }
  match metadata.get("locations") {
    Some(v) => {
      let records = array(v, "locations")
      if !records.is_empty() {
        let fs = string_array(field(meta, "location_fields"), "location_fields")
        unique_fields(fs)
        let at = offset(fs, "object_index")
        let script = offset(fs, "script_id")
        let line = offset(fs, "line")
        let column = offset(fs, "column")
        guard records.length() % fs.length() == 0 else {
          raise Invalid("location record width mismatch")
        }
        for row = 0; row < records.length(); row = row + fs.length() {
          let raw = integer(records[row + at], "location object_index")
          guard raw % fields.length() == 0 && raw / fields.length() < count else {
            raise Invalid("location target out of range")
          }
          let node = raw / fields.length()
          guard !source.locations.contains(node) else {
            raise Invalid("duplicate object location")
          }
          source.locations[node] = {
            script_id: signed_index(records[row + script], "script_id"),
            line: signed_index(records[row + line], "line"),
            column: signed_index(records[row + column], "column"),
          }
        }
      }
    }
    None => ()
  }
  match metadata.get("trace_function_infos") {
    Some(v) => {
      let records = array(v, "trace_function_infos")
      if !records.is_empty() {
        let fs = string_array(
          field(meta, "trace_function_info_fields"),
          "trace_function_info_fields",
        )
        unique_fields(fs)
        let fid = offset(fs, "function_id")
        let name = offset(fs, "name")
        let script = offset(fs, "script_name")
        let sid = offset(fs, "script_id")
        let line = offset(fs, "line")
        let column = offset(fs, "column")
        guard records.length() % fs.length() == 0 else {
          raise Invalid("function info width mismatch")
        }
        for row = 0; row < records.length(); row = row + fs.length() {
          source.functions.push({
            function_id: unsigned(records[row + fid], "function_id").to_string(),
            name: indexed(
              strings,
              integer(records[row + name], "function name"),
              "function name",
            ),
            script_name: indexed(
              strings,
              integer(records[row + script], "script name"),
              "script name",
            ),
            script_id: signed_index(records[row + sid], "script_id"),
            line: signed_index(records[row + line], "line"),
            column: signed_index(records[row + column], "column"),
          })
        }
      }
    }
    None => ()
  }
  match metadata.get("trace_tree") {
    Some(v) => {
      let first = array(v, "trace_tree")
      if !first.is_empty() {
        let fs = string_array(
          field(meta, "trace_node_fields"),
          "trace_node_fields",
        )
        unique_fields(fs)
        let tid = offset(fs, "id")
        let fi = offset(fs, "function_info_index")
        let ct = offset(fs, "count")
        let sz = offset(fs, "size")
        let child = offset(fs, "children")
        let work : Array[TraceWork] = [{ items: first, parent: 0, }]
        let mut cursor = 0
        while cursor < work.length() {
          let part = work[cursor]
          cursor += 1
          guard part.items.length() % fs.length() == 0 else {
            raise Invalid("trace node width mismatch")
          }
          for row = 0; row < part.items.length(); row = row + fs.length() {
            let id = integer(part.items[row + tid], "trace id")
            let index = integer(part.items[row + fi], "function info index")
            guard id > 0 &&
              !source.traces.contains(id) &&
              index < source.functions.length() else {
              raise Invalid("invalid or duplicate allocation trace")
            }
            source.traces[id] = {
              parent: part.parent,
              function_index: index,
              count: safe_bytes(part.items[row + ct], "allocation count"),
              bytes: safe_bytes(part.items[row + sz], "allocation size"),
            }
            let children = array(part.items[row + child], "trace children")
            if !children.is_empty() {
              work.push({ items: children, parent: id, })
            }
          }
        }
      }
    }
    None => ()
  }
  for id in source.origins {
    guard id == 0 || source.traces.contains(id) else {
      raise Invalid("node references missing allocation trace")
    }
  }
  source
}

///|
/// Object locations use V8's zero-based line/column coordinates.
pub fn Snapshot::source_location(
  self : Snapshot,
  node : Int32,
) -> SourceLocation? raise HeapError {
  ignore(self.node(node))
  self.source.locations.get(node)
}

///|
/// Leaf allocation site first, followed by callers. Frames preserve V8 values.
pub fn Snapshot::allocation_stack(
  self : Snapshot,
  node : Int32,
) -> Array[AllocationFrame] raise HeapError {
  ignore(self.node(node))
  let result : Array[AllocationFrame] = []
  let mut id = self.source.origins[node]
  while id != 0 {
    let t = self.source.traces.get(id).unwrap()
    result.push(self.source.functions[t.function_index])
    id = t.parent
  }
  result
}

///|
/// Allocations recorded at this trace site, not this object's current size.
pub fn Snapshot::allocation_totals(
  self : Snapshot,
  node : Int32,
) -> (Int64, Int64)? raise HeapError {
  ignore(self.node(node))
  self.source.traces.get(self.source.origins[node]).map(t => (t.count, t.bytes))
}
