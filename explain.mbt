///|
fn Inspector::explain_query(
  self : Inspector,
  handle : Int32,
  req : Json,
) -> Json raise HeapError {
  let a = self.get(handle)
  let node = selected_node(a.graph.snapshot, req)
  let limit = int_option(req, "retainer_limit", 100)
  page_bounds(0, limit)
  let incoming = a.graph.references(
    node,
    incoming=true,
    retaining_only=true,
    limit~,
  )
  let paths = advanced_query(a, req, "paths", 0, 100)
  {
    "node": node_json(a, a.graph.snapshot.nodes[node]),
    "reachable": @json.to_json(a.graph.distance[node] >= 0),
    "dominators": @json.to_json(
      a.dominator_chain(node).map(n => node_json(a, n)),
    ),
    "retainers": {
      "items": @json.to_json(incoming.items.map(e => edge_json(a, e))),
      "total": @json.to_json(incoming.total),
      "complete": @json.to_json(incoming.items.length() == incoming.total),
    },
    "root_paths": paths,
    "allocation": self.source_query(handle, req),
    "complete": @json.to_json(
      incoming.items.length() == incoming.total &&
      bool_option(paths, "complete", false),
    ),
    "interpretation": "One object's recorded retention evidence. Incoming retainers and root paths have independent completeness flags; allocation records may be absent. Dominators run from this object toward the root. This is not an automatic leak verdict.",
  }
}

///|
fn evidence_table(
  writer : ReportWriter,
  columns : Array[String],
  rows : Array[Json],
) -> Unit raise HeapError {
  writer.write("<div style=\"overflow-x:auto\"><table><thead><tr>")
  for key in columns {
    writer.write("<th>" + html_escape(key) + "</th>")
  }
  writer.write("</tr></thead><tbody>")
  for row in rows {
    writer.write("<tr>")
    for key in columns {
      writer.write(
        "<td>" +
        html_escape(display_json(optional(row, key).unwrap_or(Json::null()))) +
        "</td>",
      )
    }
    writer.write("</tr>")
  }
  writer.write("</tbody></table></div>")
}

///|
fn evidence_edges(
  writer : ReportWriter,
  rows : Array[Json],
) -> Unit raise HeapError {
  let edges = rows.map(row => {
    let source = field(row, "source")
    let target = field(row, "target")
    (
      {
        "source": field(source, "name"),
        "source_id": field(source, "id"),
        "reference": field(row, "name"),
        "kind": field(row, "kind"),
        "target": field(target, "name"),
        "target_id": field(target, "id"),
      } : Json)
  })
  evidence_table(
    writer,
    ["source", "source_id", "reference", "kind", "target", "target_id"],
    edges,
  )
}

///|
fn evidence_html(writer : ReportWriter, data : Json) -> Unit raise HeapError {
  writer.write("<h2>对象与保留体积</h2>")
  evidence_table(writer, report_columns("nodes"), [field(data, "node")])
  writer.write("<h2>直接持有者</h2>")
  let refs = field(data, "retainers")
  writer.write(
    "<p>保留引用共 " +
    display_json(field(refs, "total")) +
    " 条；是否全部列出：" +
    display_json(field(refs, "complete")) +
    "。</p>",
  )
  evidence_edges(writer, array(field(refs, "items"), "items"))
  writer.write("<h2>根路径</h2>")
  let paths = field(data, "root_paths")
  writer.write(
    "<p>是否穷尽：" +
    display_json(field(paths, "complete")) +
    "；停止原因：" +
    html_escape(display_json(field(paths, "stop_reason"))) +
    "。</p>",
  )
  for index, path in array(field(paths, "paths"), "paths") {
    writer.write("<h3>路径 " + (index + 1).to_string() + "</h3>")
    evidence_edges(writer, array(path, "path"))
  }
  writer.write("<h2>支配关系（对象 → 根）</h2>")
  evidence_table(
    writer,
    ["id", "name", "kind", "shallow_bytes", "retained_bytes"],
    array(field(data, "dominators"), "dominators"),
  )
  writer.write("<h2>分配来源</h2>")
  let source = field(data, "allocation")
  writer.write(
    "<p>分配调用栈可用：" +
    display_json(field(source, "available")) +
    "；回查其他快照：" +
    display_json(field(source, "used_fallback")) +
    "。</p><pre>对象位置：" +
    html_escape(field(source, "location").stringify()) +
    "</pre>",
  )
  evidence_table(
    writer,
    ["name", "script_name", "line", "column"],
    array(field(source, "frames"), "frames"),
  )
  writer.write(
    "<p>没有记录的来源不会推测填充。分配调用栈坐标保留 V8 原值；对象位置坐标从 0 起算。</p>",
  )
}
