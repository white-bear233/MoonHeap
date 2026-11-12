///|
fn size_option(
  req : Json,
  key : String,
  fallback : Int64,
) -> Int64 raise HeapError {
  match optional(req, key) {
    None => fallback
    Some(v) => safe_bytes(v, key)
  }
}

///|
fn change_json(c : RetentionChange) -> Json {
  {
    "id": @json.to_json(c.id),
    "kind": @json.to_json(c.kind),
    "name": @json.to_json(c.name),
    "status": @json.to_json(c.status),
    "before_bytes": optional_bytes(c.before_bytes),
    "after_bytes": optional_bytes(c.after_bytes),
    "before_retained_bytes": optional_bytes(c.before_retained),
    "after_retained_bytes": optional_bytes(c.after_retained),
    "retained_delta": optional_bytes(c.retained_delta),
  }
}

///|
fn retention_diff_json(
  before : Analysis,
  after : Analysis,
  req : Json,
) -> Json raise HeapError {
  let offset = int_option(req, "offset", 0)
  let go = int_option(req, "group_offset", offset)
  let co = int_option(req, "change_offset", offset)
  let limit = int_option(req, "limit", 100)
  page_bounds(go, limit)
  page_bounds(co, limit)
  let result = before.compare(
    after,
    same_isolate=bool_option(req, "same_isolate", false),
  )
  let query = string_option(req, "query", "")
  let kind = string_option(req, "kind", "")
  let status = string_option(req, "status", "")
  guard ["", "added", "removed", "resized", "retention_changed"].contains(
    status,
  ) else {
    raise Invalid("invalid change status")
  }
  let min_growth = size_option(req, "min_growth", -9007199254740991L)
  let rows = result.aggregate.groups.filter(g => {
    (query == "" || g.name.contains(query)) &&
    (kind == "" || g.kind == kind) &&
    g.after_bytes - g.before_bytes >= min_growth
  })
  let items : Array[Json] = []
  for i in 0..<rows.length() {
    if i >= go && items.length() < limit {
      let g = rows[i]
      items.push({
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
  let filtered = result.changes.filter(c => {
    (query == "" || c.name.contains(query) || c.id == query) &&
    (kind == "" || c.kind == kind) &&
    (status == "" || c.status == status) &&
    c.retained_delta.unwrap_or(0L) >= min_growth
  })
  let changes : Array[Json] = []
  for i in 0..<filtered.length() {
    if i >= co && changes.length() < limit {
      changes.push(change_json(filtered[i]))
    }
  }
  {
    "mode": @json.to_json(result.aggregate.mode),
    "groups": @json.to_json(items),
    "total_groups": @json.to_json(rows.length()),
    "changes": @json.to_json(changes),
    "total_changes": @json.to_json(filtered.length()),
    "group_offset": @json.to_json(go),
    "change_offset": @json.to_json(co),
    "offset": @json.to_json(offset),
    "added": optional_count(result.aggregate.added),
    "removed": optional_count(result.aggregate.removed),
    "survived": optional_count(result.aggregate.survived),
    "interpretation": "Retained changes include unchanged-size containers. Identity relies on confirmed same-isolate provenance; retention is not a leak verdict.",
  }
}

///|
pub fn Inspector::investigate(
  self : Inspector,
  before : Int32,
  growth : Int32,
  cleanup : Int32,
  input : String,
) -> Json raise HeapError {
  let req = request(input)
  let offset = int_option(req, "offset", 0)
  let limit = int_option(req, "limit", 100)
  page_bounds(offset, limit)
  let a = self.get(before)
  let b = self.get(growth)
  let c = self.get(cleanup)
  let result = investigate(
    a,
    b,
    c,
    same_isolate=bool_option(req, "same_isolate", false),
  )
  let q = string_option(req, "query", "")
  let kind = string_option(req, "kind", "")
  let min_retained = size_option(req, "min_retained", -1L)
  let only_residual = bool_option(req, "residual_only", true)
  let surviving_groups : Map[String, Bool] = Map([])
  for node in result.survivors {
    surviving_groups[node.kind + ":" + node.name] = true
  }
  let groups = result.groups.filter(g => {
    (q == "" || g.name.contains(q)) &&
    (kind == "" || g.kind == kind) &&
    (
      !only_residual ||
      (g.growth_count > g.before_count && g.cleanup_count > g.before_count) ||
      surviving_groups.contains(g.kind + ":" + g.name)
    )
  })
  let rows : Array[Json] = []
  for i in 0..<groups.length() {
    if i >= offset && rows.length() < limit {
      let g = groups[i]
      rows.push({
        "kind": @json.to_json(g.kind),
        "name": @json.to_json(g.name),
        "before_count": @json.to_json(g.before_count),
        "growth_count": @json.to_json(g.growth_count),
        "cleanup_count": @json.to_json(g.cleanup_count),
        "remaining_count": @json.to_json(g.cleanup_count - g.before_count),
        "before_bytes": bytes_json(g.before_bytes),
        "growth_bytes": bytes_json(g.growth_bytes),
        "cleanup_bytes": bytes_json(g.cleanup_bytes),
        "remaining_bytes": bytes_json(g.cleanup_bytes - g.before_bytes),
      })
    }
  }
  let survivors = result.survivors.filter(n => {
    (q == "" || n.name.contains(q) || n.id == q) &&
    (kind == "" || n.kind == kind) &&
    c.retained[n.index] >= min_retained
  })
  let items : Array[Json] = []
  for i in 0..<survivors.length() {
    if i >= offset && items.length() < limit {
      items.push(node_json(c, survivors[i]))
    }
  }
  {
    "mode": @json.to_json(result.mode),
    "groups": @json.to_json(rows),
    "total_groups": @json.to_json(groups.length()),
    "items": @json.to_json(items),
    "total": @json.to_json(survivors.length()),
    "offset": @json.to_json(offset),
    "created": optional_count(result.created),
    "released": optional_count(result.released),
    "survivor_count": if result.mode == "aggregate" {
      Json::null()
    } else {
      @json.to_json(result.survivors.length())
    },
    "interpretation": "Candidates were absent from baseline, present after workload, and still present after cleanup. Intentional caches and runtime activity can also survive.",
  }
}
