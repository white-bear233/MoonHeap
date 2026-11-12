# MoonHeap 0.2 API

## MoonBit 库

公开类型以 [pkg.generated.mbti](../pkg.generated.mbti) 为准。错误为 HeapError 的 Invalid、Limit、NotFound、Identity。

| 对象 | 主要接口 |
|---|---|
| Decoder | new(limits?)、feed(chunk)、finish()、characters_read() |
| Snapshot | node/edge、find_id、node_count/edge_count/root_index/total_shallow_bytes、graph、source_location、allocation_stack、allocation_totals |
| Graph | analyze、references、root_path、root_paths、cycles、root_distance、is_retaining、weakmap_edge_count |
| Analysis | nodes、groups、retained_bytes、immediate_dominator、dominated、dominator_chain、compare |
| Inspector | new(max_snapshots?)、open、accept、query、diff、investigate、report、export_report、close |

`parse(input, limits?)` 使用同一个增量解析器一次性 feed。Decoder 失败或 finish 后不能重用。feed 接受已正确解码的文本，跨块转义、数字和字符串受支持；宿主必须保持 UTF-8 多字节边界。

Inspector 默认容量仍为 2 以兼容旧调用；三阶段调查使用 `Inspector::new(max_snapshots=3)`。容量参数夹到 1–8。accept 接受已解析 Snapshot 并完成图分析。句柄单调分配，重复 close 无副作用。

旧的 `compare(Snapshot, Snapshot, same_isolate=false)` 只比较数量、自身体积及身份。新增 `Analysis::compare(after, same_isolate=false)` 返回 RetentionDiff，同时计算保留体积变化。`investigate(Analysis, Analysis, Analysis, same_isolate=false)` 提供三阶段结果。

Snapshot、Graph、Analysis、Decoder、Inspector 是抽象类型，调用者不能改写内部索引。Node/Edge 记录及返回数组可独立使用。

## JSON 桥接和逐块导入

构建后由 `dist/moonheap.mjs` 导出以下同步函数。所有结果除 close/abort 外都是 **JSON 字符串信封**；浏览器应在 Worker 调用：

```js
import {
  begin_snapshot, feed_snapshot, finish_snapshot, abort_snapshot,
  load_snapshot, query_snapshot, diff_snapshots, investigate_snapshots,
  export_report, close_snapshot
} from './dist/moonheap.mjs';

function unwrap(raw) {
  const r = JSON.parse(raw);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}
const importHandle = unwrap(begin_snapshot('{"max_mib":256}'));
let snapshotHandle;
try {
  // 对宿主的严格 UTF-8 解码流逐块调用；这里仅展示接口。
  for await (const chunk of decodedTextStream) {
    unwrap(feed_snapshot(importHandle, chunk));
  }
  snapshotHandle = unwrap(finish_snapshot(importHandle));
  console.log(unwrap(query_snapshot(snapshotHandle, '{"op":"summary"}')));
} finally {
  abort_snapshot(importHandle);
  if (snapshotHandle != null) close_snapshot(snapshotHandle);
}
```

同时最多一个增量导入、三份已完成快照。feed 失败或 finish 会释放导入句柄；abort 幂等。finish 返回快照句柄，不是导入句柄。feed 成功数据为已读字符数。旧 load_snapshot(text) 保留，方便小文本调用。

begin_snapshot 支持 max_mib（默认 256，1–1024）、max_nodes、max_edges、max_strings、max_work；后四项与 Limits 对应。宿主另外校验文件实际字节数。

成功和失败信封：

```json
{"api_version":1,"ok":true,"data":{"items":[],"total":0,"offset":0}}
{"api_version":1,"ok":false,"error":{"code":"not_found","message":"object id 99"}}
```

请求最长 8192 个 String.length() 单位，JSON 嵌套最多 16，不接受重复键；使用的字段必须类型正确，多余字段忽略。所有对象 ID 用十进制字符串，不能先转 JS Number。字节数在精确范围 ±(2^53−1) 内，以 JSON 数字输出；缺失值用 null。

## 单快照查询

`query_snapshot(handle, requestJSON)` / `Inspector.query(handle, requestJSON)`：

| op | 参数 | 返回 data |
|---|---|---|
| summary（默认） | 无 | nodes、edges、root_id、reachable_nodes、unreachable_nodes、total_shallow_bytes、reachable_bytes、policy、conditional_weakmap_edges、dominator_iterations |
| nodes | query、kind、order、min_shallow、min_retained、reachability、offset、limit | items、total、offset |
| groups | query、kind、offset、limit | items、total、offset |
| node | id 或 index | 节点摘要 |
| references | id/index、incoming=true、retaining_only=false、offset、limit | 边分页 |
| path | id/index、max_depth=1024 | reachable、edges |
| paths | id/index、max_paths=5、max_depth=64、max_work=50000 | paths、complete、examined、stop_reason |
| source | id/index、可选 fallback_handle 与 same_isolate | node、location、frames、allocation_totals、available、source_snapshot_handle、used_fallback |
| dominated | id/index、offset、limit | 支配树直接子节点分页 |
| tree | id/index（省略选根）、offset、limit | node、children 分页、ancestors |
| cycles | query、offset、limit | 循环组分页；每行 cycle_id、count、shallow_bytes、sample |
| cycle | cycle_id、offset、limit | 指定循环组成员分页 |

order 为 retained、shallow、index。query 对名称区分大小写，并可精确匹配完整 ID；kind 精确匹配。reachability 为 all、reachable、unreachable。min_shallow/min_retained 为非负字节下限；未设置 retained 下限时包含不可达对象。offset 非负，limit 为 1–1000，默认 100。

节点字段：index（记录下标）、id、kind、name、shallow_bytes、retained_bytes、distance、dominator_id、dominated_count。根的 dominator_id 为 null；不可达节点 retained_bytes、distance、dominator_id 均为 null。边字段：index、kind、name、retaining、source、target；source/target 是节点摘要。

groups 求和 shallow_bytes，给出 max_retained_bytes，不相加可能重叠的保留子树。tree.ancestors 为当前对象到根的顺序；dominated_count 是直接子节点数量。cycles.sample 最多 8 个代表节点，完整成员通过 cycle 获取；cycle_id 是该快照内的组标识，不能跨快照匹配。

path 对根返回空路径，对不可达对象返回 reachable=false/edges=null；超过深度报 Limit。paths 枚举不重复经过同一节点的路径，受路径条数、深度、遍历和队列预算限制；complete=false 必须同时阅读 stop_reason，不能视为找到了所有路径。

source.frames 从分配位置向调用者排列，保留 V8 原始值。location 的 line/column 是 0-based；分配函数帧通常是 1-based，0 或负值可表示未知，不能按 location 的规则再次加一。allocation_totals 是分配位置统计，**不是当前对象大小**。available 表示是否存在分配栈，单独 location 仍可能存在。没有跟踪记录时返回空 frames，不推测归因。

source 可在 `same_isolate:true` 时使用 fallback_handle：仅当当前没有分配帧时查找另一个快照中相同 ID，并核对类型/名称。来源可能来自另一快照，node 摘要仍是当前对象；used_fallback 与 source_snapshot_handle 显式标明。

## 双快照比较

`diff_snapshots(before, after, requestJSON)` 参数包括 same_isolate=false、query、kind、status、min_growth、group_offset、change_offset、limit。group_offset/change_offset 独立，兼容旧 offset 作为各自默认值。

返回 mode（aggregate 或 identity_asserted）、groups、total_groups、changes、total_changes、group_offset、change_offset、added、removed、survived、interpretation。

groups 含 kind/name、before_count/after_count/count_delta、before_bytes/after_bytes/bytes_delta，按浅体积增量降序。changes 含 id/kind/name/status、before_bytes/after_bytes、before_retained_bytes/after_retained_bytes、retained_delta，按保留体积增量降序。

status 可为 added、removed、resized、retention_changed；最后一项包含**自身大小未变、保留体积或可达性变化**的容器。新增对象 delta 使用 after_retained，删除使用负 before_retained；存活对象的任一 retained 为 null 时 delta 为 null。

min_growth 过滤组浅体积增量及对象保留体积增量；无法计算的对象 delta 在筛选时按 0 处理，返回值仍是 null。status 只影响对象变化表。不同对象的 retained_delta 不能直接相加当作堆总增量。

aggregate 的身份计数为 null，changes 为空。只有来源已确认属于同一 V8 isolate 才启用身份比较；矛盾的同 ID 类型/名称默认报 identity_conflict，但无矛盾本身不是来源证明。

公开 compare、Analysis.compare、investigate 还接受 exclude_conflicts=false。明确设为 true 时，把矛盾 ID 从身份变化、身份计数和候选中排除，聚合统计不变。库结果包含 excluded_ids；JSON 返回 excluded_id_count 和最多 10 个 excluded_ids_sample。三阶段会排除任意一对快照中发生矛盾的 ID；这些对象不能判断为新增、释放或存活。浏览器确认身份后采用此方式并提示，CLI 须传 --exclude-conflicts。分配来源回查仍严格校验选中对象身份。

## 三阶段调查

`investigate_snapshots(baseline, growth, cleanup, requestJSON)` 参数：same_isolate、query、kind、min_retained、residual_only=true、offset、limit。

返回：
- groups/total_groups：before/growth/cleanup 的 count/bytes，以及 remaining_count/remaining_bytes（清理减基线）。
- items/total：仅身份模式提供，候选满足 A 中不存在、B 中存在、C 中仍存在；按 C 的保留体积排序。
- created/released/survivor_count：全堆新出现、其中清理后消失、其中仍存在的计数，不受 query 过滤影响；聚合模式为 null。
- mode、offset、interpretation。

residual_only 默认保留增长后数量仍高于基线的组；在身份模式下，含新增存活对象的组也保留，即使总数量回到基线。min_retained 只过滤候选对象，不过滤组。库接口 offset 对两张表都生效；网页通过独立请求维持各自分页。

## 完整报告

`export_report(handle, requestJSON)` 信封的 data 是报告文本。库还提供 `Inspector.report` 返回 Json，以及 `Inspector.export_report` 返回 String。

参数 view 默认 nodes，format 为 json/csv/html，max_rows 默认 100000，允许 1–1000000。view=diff 需要 after_handle；view=investigate 需要 growth_handle、cleanup_handle。其余参数沿用对应查询。

导出从第 0 行收集所有匹配项，忽略传入的分页起点。每个结果列表超过 max_rows 就失败，不生成部分报告。tree 报告包含当前节点的**全部直接子节点**与祖先上下文，放在 data.items；不是把整棵递归树扁平化。cycles 报告包含所有匹配循环组，每组 sample 仍是代表节点，完整成员应导出 cycle 视图。

JSON 为 moonheap-report-v2，含 complete、view、policy、request、summary、data。外层 complete 表示全部匹配行；paths 的搜索完整性仍由 data.complete 表达。支持在请求中附加 sources、generated_at、provenance_run_id 等证据，原样保留。summary 是主句柄的摘要，diff/investigate 的主句柄应是基线。

CSV 适用于有表格行的视图（nodes/groups/references/refs/dominated/tree/cycles/cycle/diff/investigate）。非表格视图应选 JSON 或 HTML。CSV 的 source/target 等嵌套内容使用 JSON 单元格；ID 加前导单引号保护电子表格精度，危险文本前缀也进行防公式处理。HTML 转义所有数据，不含脚本。有身份排除项时，CSV/HTML 额外插入 record_type=identity_exclusions 的说明行，保留排除数量和 ID 样本，即使没有匹配的数据行也不会丢失该信息。

输出文本限制为 64 Mi 个 String.length() 单位；JSON 序列化后校验，CSV/HTML 写入时校验。行数和文本限制不是内存硬配额。报告包含对象名和来源路径，分享前应检查内容。

## CLI 与网页约定

CLI 使用 `--json` 时，stdout 仅含成功结果，stderr 含错误信封；帮助、版本为文本。report 本身输出所选格式；使用 --output 时，stdout 是保存结果，默认拒绝覆盖，--force 才允许。

| 退出码 | code | 含义 |
|---|---|---|
| 0 | 无 | 成功 |
| 2 | invalid_input / not_found | 参数、格式、对象错误 |
| 3 | resource_limit | 文件、输出、节点或算法预算超限 |
| 4 | identity_conflict | 身份矛盾、来源校验失败 |
| 5 | io_error | 文件、采集子进程等宿主错误 |

validate 会完整解析和分析。CLI 每次重新打开文件，交互应用优先重用 Inspector。capture 运行指定模块的 setup/exercise/cleanup；--manifest 验证输入与采集清单的字节数和 SHA-256 一致，然后启用同 isolate 模式。清单是采集来源记录，不是对任意外来文件的加密身份认证。

网页支持三份文件、多文件选择/拖放、读取进度、终止 Worker 取消、查询历史和对象书签。保存工作区把 File、筛选、身份声明、视图及书签存入当前来源的 IndexedDB；恢复会重新解析。取消/清空当前不删除已保存数据；“删除已保存数据”单独移除持久记录。浏览器配额或隐私设置不允许保存时，显示错误，不声称成功。
