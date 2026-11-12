# 参考资料与实现边界

MoonHeap 的解析、索引、支配关系、查询和比较为本仓库原创 MoonBit 实现，Apache-2.0。没有复制或分发 Chrome DevTools、MemLab、v8-profiler-rs 的实现。开发中使用 AI 辅助编程。

- [Node.js V8 API](https://nodejs.org/api/v8.html)：快照采集接口和使用限制。
- [Chrome heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)：术语和调查方式。
- [Chrome DevTools HeapSnapshot.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/entrypoints/heap_snapshot_worker/HeapSnapshot.ts)：核对 V8 记录和保留边的相关语义；本项目的明确差异见 docs/SEMANTICS.md。
- Cooper, Harvey, Kennedy, *A Simple, Fast Dominance Algorithm*：迭代支配算法的公开描述。
- [MemLab](https://github.com/facebook/memlab)：调查流程参考，非运行依赖或功能兼容承诺。

运行依赖仅为 MoonBit 标准库；CLI 和网页桥接由 MoonBit 编译器生成。Node.js、浏览器、MoonBit 工具链和 Playwright CLI 是各自独立分发的运行/开发工具，遵循其各自许可证。

