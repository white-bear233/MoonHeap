///|
#derive(Debug)
pub(all) suberror HeapError {
  Invalid(String)
  Limit(String)
  NotFound(String)
  Identity(String)
}

///|
pub extend HeapError with Debug::{to_repr}

///|
pub extend Limits with Debug::{to_repr}

///|
pub extend Node with Debug::{to_repr}

///|
pub extend Node with Eq::{equal, not_equal}

///|
pub extend Edge with Debug::{to_repr}

///|
pub extend Edge with Eq::{equal, not_equal}

///|
#derive(Debug)
pub(all) struct Limits {
  max_chars : Int32
  max_nodes : Int32
  max_edges : Int32
  max_strings : Int32
  max_work : Int32
}

///|
pub fn Limits::default() -> Limits {
  {
    max_chars: 67108864,
    max_nodes: 1000000,
    max_edges: 8000000,
    max_strings: 2000000,
    max_work: 200000000,
  }
}

///|
#derive(Debug, Eq)
pub(all) struct Node {
  index : Int32
  id : String
  kind : String
  name : String
  self_size : Int64
  edge_start : Int32
  edge_count : Int32
}

///|
#derive(Debug, Eq)
pub(all) struct Edge {
  index : Int32
  source : Int32
  target : Int32
  kind : String
  name : String
}

///|
pub struct Snapshot {
  nodes : Array[Node]
  edges : Array[Edge]
  ids : Map[String, Int32]
  root : Int32
  total_size : Int64
  limits : Limits
}

///|
pub fn Snapshot::node_count(self : Snapshot) -> Int32 {
  self.nodes.length()
}

///|
pub fn Snapshot::edge_count(self : Snapshot) -> Int32 {
  self.edges.length()
}

///|
pub fn Snapshot::root_index(self : Snapshot) -> Int32 {
  self.root
}

///|
pub fn Snapshot::total_shallow_bytes(self : Snapshot) -> Int64 {
  self.total_size
}

///|
pub fn Snapshot::node(self : Snapshot, index : Int32) -> Node raise HeapError {
  guard index >= 0 && index < self.nodes.length() else {
    raise NotFound("node index \{index}")
  }
  self.nodes[index]
}

///|
pub fn Snapshot::edge(self : Snapshot, index : Int32) -> Edge raise HeapError {
  guard index >= 0 && index < self.edges.length() else {
    raise NotFound("edge index \{index}")
  }
  self.edges[index]
}

///|
pub fn Snapshot::find_id(self : Snapshot, id : String) -> Int32? {
  self.ids.get(id)
}

///|
fn validate_limits(limits : Limits) -> Unit raise HeapError {
  guard limits.max_chars > 0 &&
    limits.max_nodes > 0 &&
    limits.max_edges > 0 &&
    limits.max_strings > 0 &&
    limits.max_work > 0 else {
    raise Invalid("limits must be positive")
  }
}
