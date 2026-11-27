///|
pub(all) struct CleanupCheck {
  status : String
  matched_survivors : Int32
  shallow_bytes : Int64
  unreachable_survivors : Int32
  max_survivors : Int32?
  max_survivor_bytes : Int64?
  excluded_ids : Array[String]
  sample : Array[Node]
}

///|
/// Check all matching new survivors, independently of result pagination.
/// Byte budgets sum shallow sizes, never overlapping retained subtrees.
/// Excluded identities make the result inconclusive, even if within budget.
pub fn check_cleanup(
  before : Analysis,
  growth : Analysis,
  cleanup : Analysis,
  same_isolate~ : Bool = false,
  exclude_conflicts~ : Bool = false,
  query~ : String = "",
  kind~ : String = "",
  max_survivors~ : Int32? = None,
  max_survivor_bytes~ : Int64? = None,
) -> CleanupCheck raise HeapError {
  guard same_isolate else {
    raise Identity("cleanup checks require confirmed same-isolate snapshots")
  }
  guard max_survivors.unwrap_or(0) >= 0 &&
    max_survivor_bytes.unwrap_or(0L) >= 0L &&
    max_survivor_bytes.unwrap_or(0L) <= 9007199254740991L else {
    raise Invalid("cleanup thresholds must be nonnegative safe integers")
  }
  let count_limit = if max_survivors is None && max_survivor_bytes is None {
    Some(0)
  } else {
    max_survivors
  }
  let result = investigate(
    before,
    growth,
    cleanup,
    same_isolate~,
    exclude_conflicts~,
  )
  let mut count = 0
  let mut shallow = 0L
  let mut unreachable_count = 0
  let sample : Array[Node] = []
  for node in result.survivors {
    if (query == "" || node.name.contains(query) || node.id == query) &&
      (kind == "" || node.kind == kind) {
      count += 1
      shallow += node.self_size
      if cleanup.retained[node.index] < 0L {
        unreachable_count += 1
      }
      if sample.length() < 20 {
        sample.push(node)
      }
    }
  }
  let count_exceeded = match count_limit {
    Some(limit) => count > limit
    None => false
  }
  let bytes_exceeded = match max_survivor_bytes {
    Some(limit) => shallow > limit
    None => false
  }
  {
    status: if !result.excluded_ids.is_empty() {
      "inconclusive"
    } else if count_exceeded || bytes_exceeded {
      "exceeded"
    } else {
      "passed"
    },
    matched_survivors: count,
    shallow_bytes: shallow,
    unreachable_survivors: unreachable_count,
    max_survivors: count_limit,
    max_survivor_bytes,
    excluded_ids: result.excluded_ids,
    sample,
  }
}

///|
pub fn Inspector::check_cleanup(
  self : Inspector,
  before : Int32,
  growth : Int32,
  cleanup : Int32,
  input : String,
) -> Json raise HeapError {
  let req = request(input)
  let c = self.get(cleanup)
  let result = check_cleanup(
    self.get(before),
    self.get(growth),
    c,
    same_isolate=bool_option(req, "same_isolate", false),
    exclude_conflicts=bool_option(req, "exclude_conflicts", false),
    query=string_option(req, "query", ""),
    kind=string_option(req, "kind", ""),
    max_survivors=match optional(req, "max_survivors") {
      Some(value) => Some(integer(value, "max_survivors"))
      None => None
    },
    max_survivor_bytes=match optional(req, "max_survivor_bytes") {
      Some(value) => Some(safe_bytes(value, "max_survivor_bytes"))
      None => None
    },
  )
  {
    "status": @json.to_json(result.status),
    "passed": @json.to_json(result.status == "passed"),
    "matched_survivors": @json.to_json(result.matched_survivors),
    "shallow_bytes": bytes_json(result.shallow_bytes),
    "unreachable_survivors": @json.to_json(result.unreachable_survivors),
    "max_survivors": optional_count(result.max_survivors),
    "max_survivor_bytes": optional_bytes(result.max_survivor_bytes),
    "excluded_id_count": @json.to_json(result.excluded_ids.length()),
    "excluded_ids_sample": excluded_sample(result.excluded_ids),
    "sample": @json.to_json(result.sample.map(n => node_json(c, n))),
    "query": @json.to_json(string_option(req, "query", "")),
    "kind": @json.to_json(string_option(req, "kind", "")),
    "provenance_run_id": optional(req, "provenance_run_id").unwrap_or(
      Json::null(),
    ),
    "policy": "snapshot-strong-v1",
    "interpretation": "Checks all matching new survivors, including unreachable records. Bytes sum shallow sizes, not overlapping retained sizes. Passing a chosen budget is not proof of no memory leak; excluded identities make the result inconclusive.",
  }
}
