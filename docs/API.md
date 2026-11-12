# MoonHeap 0.1 API

## MoonBit 接口

`parse(input, limits?) -> Snapshot raise HeapError` 接受快照文本。错误分为 `Invalid`、`Limit`、`NotFound`、`Identity`。

| 对象 | 方法 | 说明 |
|---|---|---|
| Snapshot | node_count / edge_count / root_index / total_shallow_bytes | 基本统计 |
| Snapshot | node(index) / edge(index) | 按记录下标查询，越界抛错 |
| Snapshot | find_id(decimal_string) | 精确 ID 查询，未找到为 None |
| Snapshot | graph() | 建立双向引用索引和根可达关系 |
| Graph | analyze() | 计算根可达子图的支配关系及保留体积 |
| Graph | references(index, incoming?, retaining_only?, offset?, limit?) | 引用分页 |
| Graph | root_path(index, max_depth?) | 一条最短根路径，默认最多 1024 条边 |
| Graph | root_distance / is_retaining / weakmap_edge_count | 距离、边策略和条件边计数 |
| Analysis | nodes(order?, query?, kind?, offset?, limit?) | 对象分页 |
| Analysis | groups() | 按类型及名称汇总 |
| Analysis | retained_bytes / immediate_dominator | 按节点下标查询，可为空 |
| Analysis | dominated(index, offset?, limit?) | 支配树直接子节点 |
| Inspector | new / open / query / diff / close | 会话式 JSON 接口，最多同时两份快照 |

`compare(before, after, same_isolate=false)` 可直接比较两个 Snapshot，无需计算支配树。Inspector 为交互使用会在打开时完整分析。

查询参数：`order` 为 `retained`、`shallow` 或 `index`；名称搜索区分大小写。对象搜索还接受**完整 ID 精确匹配**。`kind` 按 V8 类型匹配。`offset >= 0`，`limit` 为 1–1000，默认 100。排序相同时用记录顺序稳定排序。节点记录的 `self_size` 为浅体积；分组为浅体积求和与单个对象的最大保留体积。

根节点的 immediate_dominator 是 None。不可达节点的 retained_bytes 与 root_distance 是 None。root_path 对根返回 Some([])，不可达返回 None，超出路径预算抛 Limit。

快照、图、分析和 Inspector 是抽象类型，内部数组不可从其他包访问。Node/Edge 等记录字段不可变，分页数组为独立结果，可由调用者处理。

## JSON 桥接

构建后由 `dist/moonheap.mjs` 导出：

```js
import {
  load_snapshot, query_snapshot, diff_snapshots, close_snapshot
} from './dist/moonheap.mjs';
const opened = JSON.parse(load_snapshot(snapshotText));
if (!opened.ok) throw new Error(opened.error.message);
const handle = opened.data;
try {
  console.log(JSON.parse(query_snapshot(handle, '{"op":"summary"}')));
} finally {
  close_snapshot(handle);
}
```

前三个函数同步返回**JSON 字符串**，close_snapshot 返回 void。浏览器必须放入 Worker，避免大快照阻塞界面。重用 Inspector 可以避免每次查询重新解析。

成功：

```json
{"api_version":1,"ok":true,"data":{"items":[],"total":0,"offset":0}}
```

失败：

```json
{"api_version":1,"ok":false,"error":{"code":"not_found","message":"object id 99"}}
```

`load_snapshot(text)` 成功时 data 是数字句柄，`close_snapshot(handle)` 释放句柄；重复关闭无副作用。句柄不会立即重用。第三份快照在未关闭已有两份时返回 resource_limit。

`query_snapshot(handle, requestJSON)` 请求：

| op | 额外参数 | data |
|---|---|---|
| summary（默认） | 无 | nodes, edges, root_id, reachable_nodes, unreachable_nodes, total_shallow_bytes, reachable_bytes, policy, conditional_weakmap_edges, dominator_iterations, interpretation |
| nodes | order, query, kind, offset, limit | items, total, offset |
| groups | query, offset, limit | items, total, offset |
| node | id 或 index | 单个节点 |
| references | id/index, incoming（默认 true）, retaining_only（默认 false）, offset, limit | 边分页 |
| path | id/index, max_depth | reachable, edges |
| dominated | id/index, offset, limit | 节点分页 |

JSON 节点字段：

- `index`：节点记录下标，不是 V8 原始数组偏移。
- `id`：精确十进制字符串，不能先转成 JavaScript Number。
- `kind`、`name`：V8 类型与名称。
- `shallow_bytes`：自身字节数。
- `retained_bytes`：保留体积，不可达为 null。
- `distance`：最短根距离，不可达为 null。
- `dominator_id`：直接支配者 ID；根和不可达节点为 null。

边字段为 `index`、`kind`、`name`、`retaining`、`source`、`target`；两端是完整节点摘要。

`diff_snapshots(beforeHandle, afterHandle, requestJSON)`：

```json
{"same_isolate":false,"query":"","offset":0,"limit":100}
```

返回 mode、groups、total_groups、added、removed、survived、changes、total_changes、offset、interpretation。mode 为 aggregate 或 identity。aggregate 模式的三个身份计数为 null、changes 为空。组变化包括 before_count/after_count/count_delta 和 before_bytes/after_bytes/bytes_delta，按字节增量降序排序。减少项位于后面，不应只看第一页。

identity 的 changes 状态为 added、removed 或 resized。**存活且浅体积没变的对象不会出现在 changes**；其引用和保留体积仍可能改变。before_bytes/after_bytes 按存在情况为数字或 null。分页 offset/limit 同时应用于分组与变化列表，二者 total 独立；调用方应分别处理各自的总数。

请求最长 8192 个 MoonBit 字符串单位，嵌套深度最多 16，不接受重复 JSON 键。已使用字段必须类型正确；多余字段忽略。不承诺逐字段拒绝未知选项。

JSON 字节数转换前已限制在 ±(2^53−1) 范围，保持精确；MoonBit 库内部使用 Int64。可空值使用 null，不使用 MoonBit Option 的默认 JSON 数组表示。

## CLI 错误约定

| 退出码 | code | 含义 |
|---|---|---|
| 0 | 无 | 成功 |
| 2 | invalid_input / not_found | 参数、格式或查找错误 |
| 3 | resource_limit | 文件、节点、路径或算法预算超限 |
| 4 | identity_conflict | 同 ID 对应不同类型/名称 |
| 5 | io_error | 文件读取等宿主错误 |

使用 `--json` 时，stdout 仅含成功结果，stderr 仅含错误 JSON。帮助和版本是文本。validate 会完整解析并分析，也可能因支配算法预算超限失败。CLI 每次调用重新分析输入，批量交互优先使用 Inspector。

## 浏览器导出

导出文件 `moonheap-<view>-report.json` 包含 `format: moonheap-report-v1`、生成时间、源文件名、策略、当前快照摘要、查询参数和当前分页 data。它是**当前视图/当前页报告**，不是整份快照备份，也不包含对象详情面板内容。报告仍可能含对象名等敏感内容；是否分享由使用者决定。

