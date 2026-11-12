# MoonHeap

**找出对象被谁保留，解释程序为什么越来越占内存。**

MoonHeap 是用 MoonBit 编写的离线 V8 堆快照分析库，附带命令行工具和浏览器界面。解析、引用索引、支配树、保留体积、查询和比较全部由 MoonBit 实现，两个界面复用同一个内核。

[![CI](https://github.com/white-bear233/MoonHeap/actions/workflows/ci.yml/badge.svg)](https://github.com/white-bear233/MoonHeap/actions/workflows/ci.yml)
[Mooncakes](https://mooncakes.io/docs/white-bear233/moonheap) · [API 与 JSON 协议](docs/API.md) · [计算含义](docs/SEMANTICS.md) · [验证记录](docs/VALIDATION.md) · [项目申报稿](docs/PROPOSAL.md)

![MoonHeap 快照比较界面](docs/assets/explorer.png)

## 能做什么

- 打开 Node.js / Chrome 导出的 V8 `.heapsnapshot`，按文件元数据解析字段，不依赖固定列顺序。
- 按浅体积或保留体积查找对象，按类型和名称汇总，精确查询 64 位对象 ID。
- 查看入边、出边、一条最短根路径和直接支配的对象，解释共享引用与循环。
- 比较两份快照的对象数量和浅体积；明确确认来自同一 V8 实例后，可查看新增、消失、体积变化的对象 ID。
- 在浏览器后台线程分析、取消操作、导出当前视图的 JSON 报告。文件保留在本机，不上传。
- 把核心库嵌入其他 MoonBit 项目；已验证 JS、Wasm GC、Linux 原生后端。

**使用边界：**当前版本分析已有快照，默认每个输入文件最多 64 MiB。保留体积采用明确的强引用图策略，不等于 RSS，不预测 GC，也不自动判定泄漏。WeakMap 条件引用、Chrome 的页面/调试器专用规则见[语义说明](docs/SEMANTICS.md)。

## 三分钟体验

需要 Node.js 22+ 和 MoonBit 工具链；本版本使用 `moonc v0.10.20+65efd5b93` 验证。核心只依赖 MoonBit 标准库，运行界面无需安装 npm 依赖。

```sh
git clone https://github.com/white-bear233/MoonHeap.git
cd MoonHeap
npm run build
npm run demo
```

打开 [本地界面](http://127.0.0.1:4173)，点击「加载缓存增长示例」。

1. 「快照比较」显示 PixelBuffer 从 2 个增长到 18 个，浅体积增加 512 KiB。
2. 在「对象列表」搜索 PhotoCache，打开对象详情。
3. 查看「最短根路径」，得到 `root → Window → PhotoCache`，沿引用继续检查缓存数组。
4. 打开清理后的 `examples/cleanup.heapsnapshot`，观察对象减少。内置示例是合成数据，真实 Node 验证另见下文。

无需构建工具链的预编译包可在 [GitHub Releases](https://github.com/white-bear233/MoonHeap/releases) 获取；解压后用 Node 运行其中的 `scripts/serve.mjs` 或 `bin/moonheap.mjs`。

## 命令行

从仓库根目录运行；首次运行前执行 `npm run build`。

```sh
node bin/moonheap.mjs summary examples/growth.heapsnapshot
node bin/moonheap.mjs nodes examples/growth.heapsnapshot --kind object --order retained --limit 10
node bin/moonheap.mjs node examples/shared.heapsnapshot --id 9007199254740993
node bin/moonheap.mjs refs examples/growth.heapsnapshot --id 7
node bin/moonheap.mjs path examples/growth.heapsnapshot --id 7 --json
node bin/moonheap.mjs diff examples/before.heapsnapshot examples/growth.heapsnapshot --json
```

完整命令：`summary`、`validate`、`nodes`、`groups`、`node`、`refs`、`path`、`dominated`、`diff`。参数见 `node bin/moonheap.mjs --help`。

默认比较无需同进程假设。`--same-isolate` 是调用者对快照来源的声明，工具不能从文件自动证实。只有确认来源时才使用：

```sh
node bin/moonheap.mjs diff work/real/before.heapsnapshot work/real/growth.heapsnapshot --same-isolate --query MoonHeapMarker --json
```

`--json` 输出 `api_version: 1` 的结果；错误写入 stderr，退出码非零。对象 ID 始终是字符串，字节数是精确范围内的 JSON 数字。详见[API 文档](docs/API.md)。

## 作为 MoonBit 库

```sh
moon add white-bear233/moonheap@0.1.0
```

调用方的 `moon.pkg`：

```moonbit
import { "white-bear233/moonheap" @heap }
```

拿到快照字符串后：

```moonbit
fn inspect_snapshot(input : String) -> Unit raise @heap.HeapError {
  let snapshot = @heap.parse(input)
  let analysis = snapshot.graph().analyze()
  let page = analysis.nodes(kind="object", order="retained", limit=10)
  for node in page.items {
    println("\{node.id}  \{node.name}  shallow=\{node.self_size}")
  }
}
```

一个可直接运行的独立调用示例位于 [cmd/main](cmd/main/main.mbt)：

```sh
moon run cmd/main --target js
moon run cmd/main --target wasm-gc
```

公开接口清单由 `moon info` 生成：[pkg.generated.mbti](pkg.generated.mbti)。快照、图和分析结果的内部索引对调用方隐藏，查询结果可以独立使用。

## 获取与验证真实快照

浏览器中可使用 Chrome DevTools 的 Memory 面板保存 Heap snapshot；Node.js 可使用 `node:v8` 的 `writeHeapSnapshot`。采集本身会暂停目标进程，并可能需要显著额外内存；应先在可控环境中进行。参见 [Node 官方说明](https://nodejs.org/api/v8.html#v8writeheapsnapshotfilenameoptions)。

仓库包含专用、无业务数据的采集程序：

```sh
npm run fixtures
node bin/moonheap.mjs diff work/real/before.heapsnapshot work/real/growth.heapsnapshot --same-isolate --query MoonHeapMarker
node bin/moonheap.mjs diff work/real/growth.heapsnapshot work/real/cleanup.heapsnapshot --same-isolate --query MoonHeapMarker
```

它在同一个 V8 实例中生成「基线 → 保留 64 个对象 → 清空缓存」三份快照，包含共享引用和循环。预期标记对象数量为 `0 → 64 → 0`。采集文件和进程来源记录写入被 Git 忽略的 `work/real/`。

## 开发与验证

```sh
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon info
moon fmt
npm run build
npm test
node scripts/benchmark.mjs
```

Linux 上还可运行 `moon test --target native --deny-warn`。Windows 原生编译需要 MSVC C++ 工具链，JS 和 Wasm GC 不需要它。

20 个 MoonBit 测试包括 150 个随机图的独立删除节点验证、深链、共享引用、弱边、循环、精度及错误输入。Node 测试覆盖命令行、JSON 桥接、真实 V8 数据和本地服务。浏览器检查可重复运行，步骤与结果见 [VALIDATION.md](docs/VALIDATION.md)。

## 架构与范围

```text
.heapsnapshot
      ↓
MoonBit: parser → graph → dominators → queries / diff → Inspector
                                                      ↓
                                compiled JavaScript bridge
                                        ↙             ↘
                              Node CLI           Web Worker
                                                      ↓
                                                 本地网页
```

v0.1 不包含在线采样、自动修复、分配栈归因、Chrome 所有内部启发式规则或超大快照流式解析。它分析 V8 文件，不是 MoonBit 原生运行时的专用采集器。当前应用以 JS 后端运行；Wasm GC 与原生后端验证的是可移植核心库。

与 [moon-pprof](https://github.com/mizchi/moon-pprof) 的采样/pprof 工具和 [moon-hprof](https://mooncakes.io/docs/clhhhhhh/moon-hprof) 的 JVM HPROF 解析相比，MoonHeap 重点提供 V8 对象引用图、支配关系、保留体积和离线交互调查。检索范围与差异说明见[申报稿](docs/PROPOSAL.md)，不以检索未命中宣称生态中绝无同类项目。

## 许可证

原创实现，Apache-2.0，见 [LICENSE](LICENSE)。开发过程中使用 AI 辅助编程。格式与算法参考、第三方边界见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。

