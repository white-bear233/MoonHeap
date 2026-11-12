///|
fn html_escape(s : String) -> String {
  s
  .replace_all(old="&", new="&amp;")
  .replace_all(old="<", new="&lt;")
  .replace_all(old=">", new="&gt;")
  .replace_all(old="\"", new="&quot;")
}

///|
fn display_json(v : Json) -> String {
  match v {
    String(s) => s
    Null => ""
    _ => v.stringify()
  }
}

///|
fn csv_cell(v : Json, key : String) -> String {
  let raw = display_json(v)
  let guarded = match v {
    String(_) =>
      if key == "id" ||
        raw.has_prefix("=") ||
        raw.has_prefix("+") ||
        raw.has_prefix("-") ||
        raw.has_prefix("@") ||
        raw.has_prefix("\t") ||
        raw.has_prefix("\r") {
        "'" + raw
      } else {
        raw
      }
    _ => raw
  }
  "\"" + guarded.replace_all(old="\"", new="\"\"") + "\""
}

///|
priv struct ReportWriter {
  builder : StringBuilder
  mut size : Int32
}

///|
fn ReportWriter::write(
  self : ReportWriter,
  text : String,
) -> Unit raise HeapError {
  guard text.length() <= 67108864 - self.size else {
    raise Limit("report exceeds 64 Mi characters; narrow the query")
  }
  self.builder.write_string(text)
  self.size += text.length()
}

///|
/// Collect every matching row, fail explicitly when max_rows would be exceeded.
pub fn Inspector::report(
  self : Inspector,
  handle : Int32,
  input : String,
) -> Json raise HeapError {
  let req = request(input)
  let view = string_option(req, "view", "nodes")
  let cap = int_option(req, "max_rows", 100000)
  guard cap > 0 && cap <= 1000000 else {
    raise Invalid("max_rows must be in 1..1000000")
  }
  let opts = match req {
    Object(m) => m.copy()
    _ => Map([])
  }
  opts["op"] = @json.to_json(view)
  opts["limit"] = @json.to_json(1000)
  let items : Array[Json] = []
  let groups : Array[Json] = []
  let changes : Array[Json] = []
  let mut cursor = 0
  let mut first = Json::null()
  while true {
    opts["offset"] = @json.to_json(cursor)
    opts["group_offset"] = @json.to_json(cursor)
    opts["change_offset"] = @json.to_json(cursor)
    let options = @json.to_json(opts).stringify()
    let page = if view == "diff" {
      self.diff(handle, int_option(req, "after_handle", handle), options)
    } else if view == "investigate" {
      self.investigate(
        handle,
        int_option(req, "growth_handle", handle),
        int_option(req, "cleanup_handle", handle),
        options,
      )
    } else {
      self.query(handle, options)
    }
    if cursor == 0 {
      first = page
    }
    let mut total = 0
    for key in ["total", "total_groups", "total_changes"] {
      match optional(page, key) {
        Some(v) => {
          let n = integer(v, key)
          if n > total {
            total = n
          }
        }
        None => ()
      }
    }
    guard total <= cap else {
      raise Limit(
        "report has \{total} rows in a section, exceeding max_rows=\{cap}; no partial report was produced",
      )
    }
    for
      (key, target) in [
        ("items", items),
        ("groups", groups),
        ("changes", changes),
      ] {
      match optional(page, key) {
        Some(v) =>
          for item in array(v, key) {
            target.push(item)
          }
        None => ()
      }
    }
    cursor += 1000
    if cursor >= total {
      break
    }
  }
  let result = match first {
    Object(m) => {
      let merged = m.copy()
      if merged.contains("items") {
        merged["items"] = @json.to_json(items)
      }
      if merged.contains("groups") {
        merged["groups"] = @json.to_json(groups)
      }
      if merged.contains("changes") {
        merged["changes"] = @json.to_json(changes)
      }
      merged["offset"] = @json.to_json(0)
      if merged.contains("group_offset") {
        merged["group_offset"] = @json.to_json(0)
        merged["change_offset"] = @json.to_json(0)
      }
      @json.to_json(merged)
    }
    _ => first
  }
  {
    "format": "moonheap-report-v2",
    "complete": true,
    "view": @json.to_json(view),
    "policy": "snapshot-strong-v1",
    "request": req,
    "summary": self.query(handle, "{}"),
    "data": result,
    "interpretation": "All matching rows within the declared budget. Bounded path searches have their own completeness flag. Growth and survival are evidence for investigation, not automatic leak verdicts.",
  }
}

///|
fn report_columns(view : String) -> Array[String] {
  match view {
    "groups" => ["kind", "name", "count", "shallow_bytes", "max_retained_bytes"]
    "diff" =>
      [
        "record_type", "kind", "name", "id", "status", "before_count", "after_count",
        "count_delta", "before_bytes", "after_bytes", "bytes_delta", "before_retained_bytes",
        "after_retained_bytes", "retained_delta",
      ]
    "investigate" =>
      [
        "record_type", "kind", "name", "id", "before_count", "growth_count", "cleanup_count",
        "remaining_count", "before_bytes", "growth_bytes", "cleanup_bytes", "remaining_bytes",
        "shallow_bytes", "retained_bytes", "distance",
      ]
    "cycles" => ["cycle_id", "count", "shallow_bytes", "sample"]
    _ =>
      [
        "index", "id", "kind", "name", "shallow_bytes", "retained_bytes", "distance",
        "dominator_id", "dominated_count",
      ]
  }
}

///|
pub fn Inspector::export_report(
  self : Inspector,
  handle : Int32,
  input : String,
) -> String raise HeapError {
  let req = request(input)
  let format = string_option(req, "format", "json")
  guard ["json", "csv", "html"].contains(format) else {
    raise Invalid("format must be json, csv or html")
  }
  let report = self.report(handle, input)
  let writer = { builder: StringBuilder(), size: 0, }
  if format == "json" {
    writer.write(report.stringify())
    return writer.builder.to_string()
  }
  let view = string_option(req, "view", "nodes")
  let columns = report_columns(view)
  let data = field(report, "data")
  let records : Array[Json] = []
  for section in ["items", "groups", "changes"] {
    match optional(data, section) {
      Some(v) =>
        for row in array(v, section) {
          match row {
            Object(m) => {
              let copy = m.copy()
              copy["record_type"] = @json.to_json(section)
              records.push(@json.to_json(copy))
            }
            _ => ()
          }
        }
      None => ()
    }
  }
  if format == "csv" {
    guard !records.is_empty() ||
      optional(data, "items") is Some(_) ||
      optional(data, "groups") is Some(_) else {
      raise Invalid("CSV requires a tabular view")
    }
    writer.write(columns.join(",") + "\r\n")
    for row in records {
      let cells = columns.map(key => {
        csv_cell(optional(row, key).unwrap_or(Json::null()), key)
      })
      writer.write(cells.join(",") + "\r\n")
    }
  } else {
    writer.write(
      "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>MoonHeap report</title><style>body{font:14px/1.6 system-ui;margin:32px;color:#173f39}table{border-collapse:collapse}th,td{border:1px solid #dce5e2;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eff6f2}</style><h1>MoonHeap · 完整调查报告</h1><p>视图：" +
      html_escape(view) +
      " · 已包含全部匹配行。增长或存活本身不证明泄漏。</p><h2>概览与查询条件</h2><pre>" +
      html_escape(field(report, "summary").stringify()) +
      "\n" +
      html_escape(req.stringify()) +
      "</pre>",
    )
    if records.is_empty() {
      writer.write(
        "<h2>结果</h2><pre>" + html_escape(data.stringify()) + "</pre>",
      )
    } else {
      writer.write("<table><thead><tr>")
      for key in columns {
        writer.write("<th>" + html_escape(key) + "</th>")
      }
      writer.write("</tr></thead><tbody>")
      for row in records {
        writer.write("<tr>")
        for key in columns {
          writer.write(
            "<td>" +
            html_escape(
              display_json(optional(row, key).unwrap_or(Json::null())),
            ) +
            "</td>",
          )
        }
        writer.write("</tr>")
      }
      writer.write("</tbody></table>")
    }
    writer.write(
      "<p>引用策略：snapshot-strong-v1。WeakMap 条件边保守计算；保留体积不等于进程 RSS。</p></html>",
    )
  }
  writer.builder.to_string()
}
