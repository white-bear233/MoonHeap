MoonHeap 0.2.0：完整的离线内存调查流程。

从三阶段采集、逐块导入，到存活对象筛选、持有路径、分配来源和完整报告，
MoonBit 核心、Node CLI 与本地网页已接通。

本版新增：
- 真正逐块解析数值数组，进度与可配置输入预算。
- 分配调用栈、对象位置、多条根路径、循环组、支配树和体积分布图。
- 保留体积差分与独立分页；基线/增长/清理后三快照调查。
- 自定义 Node 场景采集，分配跟踪、SHA-256 文件来源记录。
- 全部匹配行的 JSON、CSV、自包含 HTML 报告。
- 网页书签、历史导航、保存/恢复工作区、多文件导入和取消恢复。

下载 MoonHeap-v0.2.0.zip，安装 Node.js 22+，解压后进入目录运行：

```sh
node scripts/serve.mjs
```

打开 http://127.0.0.1:4173，点击“加载缓存增长示例”。
包内含源代码和预编译引擎；使用界面无需安装 MoonBit。CLI 示例：

```sh
node bin/moonheap.mjs capture --scenario examples/cache-scenario.mjs --output-dir work/my-capture --iterations 2 --allocation-traces
node bin/moonheap.mjs summary examples/growth.heapsnapshot
```

Mooncakes：moon add white-bear233/moonheap@0.2.0。

验证包含 34 个核心测试、150 个随机图独立核对、Node 22/24 集成、
真实 0→64→0 清理与 0→16→1 残留场景、65 MiB 逐块输入和浏览器流程。
JS、Wasm GC、Linux native 共享同一核心。

每份输入默认 256 MiB，可配置 1–1024 MiB；仍受节点、边、元数据和计算预算限制。
WeakMap 条件引用保守计算；V8 未采集到的分配信息会明确显示缺失。
保留体积不是 RSS，存活不是自动泄漏结论。完整范围见 README 和 docs/SEMANTICS.md。

Apache-2.0。附 SHA-256 校验文件。
