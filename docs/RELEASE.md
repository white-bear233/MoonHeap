MoonHeap 0.1.0：用 MoonBit 分析 V8 对象引用、保留体积和快照变化。

包含可复用 MoonBit 库、Node 命令行和本地网页。解析、引用图、支配关系、汇总、比较均使用同一个内核。真实 Node 快照验证了 64 个标记对象的增长与清理；核心在 JS、Wasm GC、Linux 原生后端通过测试。

下载 `MoonHeap-v0.1.0.zip` 并解压，安装 Node.js 22+，进入解压目录后运行：

```sh
node scripts/serve.mjs
```

打开 http://127.0.0.1:4173，点击「加载缓存增长示例」。命令行体验：

```sh
node bin/moonheap.mjs summary examples/growth.heapsnapshot
```

压缩包包含源代码和预编译引擎，使用界面无需安装 MoonBit。修改内核后仍需安装 MoonBit 并运行 `npm run build`。

Mooncakes：`moon add white-bear233/moonheap@0.1.0`。

默认每份输入最多 64 MiB。WeakMap 条件引用保守处理，结果不是 RSS 或自动泄漏结论。详细说明见包内 README 与 docs/SEMANTICS.md。

Apache-2.0。附 SHA-256 校验文件。

