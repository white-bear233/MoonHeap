# MoonHeap 项目申报稿

## 1. 项目名称与定位

**MoonHeap：面向 V8 堆快照的 MoonBit 内存引用分析库与离线调查工具。**

目标用户是需要排查浏览器、Node.js 或 MoonBit JS 程序中对象持续增长问题的开发者。输入已有 .heapsnapshot，输出内存分布、对象引用、根路径、支配关系和前后差异，帮助定位持有对象的缓存、全局变量或其他引用者。

## 2. 要解决的问题

“程序越来越占内存”不能只靠进程总内存曲线解释。开发者需要知道哪些对象增加、它们由谁持有、为什么共享对象的体积不能简单加总，以及清理后是否消失。传统快照文件难以直接阅读，可复用分析能力也不应绑定在某个浏览器界面中。

本项目提供可嵌入 MoonBit 项目的算法库，并以 CLI 和本地网页展示完整调查流程。

## 3. 生态检索与差异

检索日期：2026-11-12。通过 Mooncakes 网站与公开仓库检索 heap、heapsnapshot、heap snapshot、hprof、pprof 等词，并阅读相邻项目的功能介绍。

| 相邻项目 | 已有能力 | MoonHeap 的范围区别 |
|---|---|---|
| [mizchi/moon-pprof](https://github.com/mizchi/moon-pprof) | 多后端 profiling、pprof 转换，含内存采样相关工具 | MoonHeap 输入完整 V8 对象快照，计算对象引用与支配关系；不重复采样和 pprof 转换 |
| [clhhhhhh/moon-hprof](https://mooncakes.io/docs/clhhhhhh/moon-hprof) | JVM HPROF 解析、索引、查询和统计比较 | MoonHeap 输入 V8 格式，并提供支配树与图策略下的保留体积；不实现 HPROF |
| Chrome DevTools / [MemLab](https://github.com/facebook/memlab) | JavaScript 生态的成熟内存调查工具 | 作为格式与使用流程参考；MoonHeap 提供 MoonBit 核心和可移植接口，不宣称替代其全部功能 |

当前检索范围内未发现与本项目“MoonBit 实现的 V8 对象快照解析＋引用索引＋支配保留分析＋离线双端工具”高度重合的成熟维护项目。检索结果可能变化；这不是主办方资格审核结论。申报时可附本仓库语义、测试和 API 文档说明实际差异。

项目为原创实现，并非某个上游项目的完整移植。不会用全量 MemLab 或 Chrome DevTools 的功能清单描述本项目。

## 4. 本次提交的功能

- 元数据驱动解析、精确 64 位 ID、结构与资源限制验证。
- 双向引用索引、根可达性、一条最短保留路径。
- 支配树、保留体积；共享、循环、弱边场景有验证。
- 对象筛选排序、类型汇总、直接支配对象查询。
- 类型聚合比较；来源明确时的同 isolate ID 比较。
- 版本化 JSON 接口、CLI、Worker 中运行的本地网页、报告导出。
- 真实快照采集脚本、性能测量、跨后端 CI。

## 5. 技术方案与 MoonBit 工作量

MoonBit 负责 parser、graph、analysis、query、diff、inspector 六个主要计算部分。Node.js 仅提供文件、进程和开发服务；网页 JavaScript 负责交互、Worker 消息和结果展示。核心没有第三方运行时依赖，只使用 MoonBit 标准库。

图采用连续边记录与反向索引；最短路径采用 BFS；支配关系采用带预算的迭代算法。内部索引封装为抽象类型，应用不能改写已验证的图。

## 6. 三个验收场景

**场景一：图片缓存持续增长。**合成快照从 2 个图片条目增长到 18 个。比较显示 PixelBuffer 增加 512 KiB；通过 PhotoCache 的根路径定位 Window 持有的缓存，再沿 entries 找到条目。

**场景二：共享对象和循环。**菱形引用图中 A、B 共享一个对象，验证不能重复计算保留体积；随机图含循环和弱边，使用删除节点后的可达字节差独立核对。

**场景三：真实 Node.js 清理验证。**同一 isolate 采集基线、增长、清理三份快照。64 个 MoonHeapMarker 由全局缓存持有，包含共享 payload 和循环；清空缓存并 GC 后标记对象数量回到 0。核对原始记录统计、ID 增减、根路径及抽样保留体积。

## 7. 开发安排与完成记录

已按模块递进完成并提交：范围定义 → 解析器 → 引用图 → 支配分析 → 查询 → 比较 → JSON/CLI → 真实验证 → CI/性能 → 网页 → 接口封装 → 文档与发布。

每个独立部分在验证后提交并推送 GitHub main。实际提交历史见 [commits](https://github.com/white-bear233/MoonHeap/commits/main)，完成清单见 [PLAN.md](PLAN.md)。

后续扩展方向：流式/紧凑解析以降低峰值内存、WeakMap 条件语义、支配计算进一步优化、分配栈与源码位置关联。这些方向不计入本版本已完成能力。

## 8. 交付物、许可与验证

- [GitHub 仓库](https://github.com/white-bear233/MoonHeap)
- [Mooncakes 包](https://mooncakes.io/docs/white-bear233/moonheap)：white-bear233/moonheap
- 本地网页、命令行、MoonBit 消费者示例和可重复生成的快照。
- README、公开接口、语义边界、验证记录、演示流程与发布包。
- Apache-2.0；AI 辅助开发情况公开说明。
- 不使用业务进程内存数据；演示及真实验证数据由专用程序生成。

所有测量数据和功能限制以 [VALIDATION.md](VALIDATION.md) 与 [SEMANTICS.md](SEMANTICS.md) 为准。内存增长作为调查线索，不输出未经证实的自动泄漏结论。

