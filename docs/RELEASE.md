MoonHeap 0.3.0：MoonBit 1.0 验收维护与可自动运行的内存回归检查。

本版新增：

- MoonBit `1.0.0-rc1+3c0520448`；统一固定 CI 与发布工具链，明确执行检查、构建、测试。
- `check`：按名称/类型检查清理后残留对象的数量或浅体积，超限退出码 6，身份不确定退出码 4。
- `explain`：一次汇总对象、持有者、根路径、支配祖先和分配来源，支持 JSON 与 HTML。
- 网页对象详情中的「导出对象证据」按钮，保留分配来源回查信息与搜索截断标记。

本版修复：

- 采集清单接受错序、重复阶段、缺失运行 ID 的问题；来源哈希现在绑定实际解析的字节。
- 报告覆盖输入快照及其链接别名的问题；报告父目录不存在时自动创建。
- 支配树导出丢失选中对象和祖先上下文的问题。
- 新版 JSON 解析器弃用参数导致严格编译失败的问题，原深度预算仍然保留。

下载 `MoonHeap-v0.3.0.zip`，安装 Node.js 22+，解压后进入目录运行：

```sh
node scripts/serve.mjs
```

打开 http://127.0.0.1:4173，加载缓存增长示例。发行包包含源码和预编译引擎，运行界面不需要 MoonBit。

```sh
node bin/moonheap.mjs explain examples/shared.heapsnapshot --id 7 --json
node bin/moonheap.mjs check examples/before.heapsnapshot examples/growth.heapsnapshot examples/cleanup.heapsnapshot --same-isolate --query PhotoEntry --kind object --json
moon add white-bear233/moonheap@0.3.0
```

验证覆盖 40 个 MoonBit 测试、150 个随机图独立核对、15 个 Node 集成测试、
Node 22/24、JS/Wasm GC/Linux native、真实清理与残留、65 MiB 逐块输入以及桌面/手机浏览器。
发布流程会解压 ZIP 到独立目录，运行随包 CLI，检查精确 ID、对象证据和预算通过/失败分支。

每份快照默认上限 256 MiB，可调 1–1024 MiB；图仍在内存中分析。
WeakMap 条件引用采用公开的保守策略。预算通过仅表示所选对象符合阈值，不表示全程序无泄漏。
完整验收入口见 `docs/ACCEPTANCE.md`；Apache-2.0，附 ZIP 的 SHA-256 校验文件。
