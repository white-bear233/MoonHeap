# 五分钟演示

## 准备

`npm run build` 后运行 `npm run demo`，打开 http://127.0.0.1:4173。演示文件仅由专用程序生成。不要在演示时打开业务快照。

## 0:00—1:00：说明问题

“操作之后内存持续增长，先找增加的对象，再找持有者。”

点击「加载缓存增长示例」，切换到「快照比较」。PixelBuffer 从 64 KiB 增长到 576 KiB，新增 16 个对象，共增长 512 KiB。

解释这是**浅体积合计**，不是整个进程 RSS。

## 1:00—2:00：查到持有者

回到对象列表，搜索 PhotoCache 并点击对象。自身只有 48 B，却保留约 577 KiB。

查看「最短根路径」：root → Window → PhotoCache。再查看「它引用谁」找到 entries 数组。点击 Array，沿数组索引查看 PhotoEntry 及 pixels。

解释保留体积为什么能找到“小容器持有大量数据”的问题。

## 2:00—3:00：共享对象不会重复计算

打开 `examples/shared.heapsnapshot`。A 的 ID 为 9007199254740993，在 JavaScript Number 精确范围之外，但界面与导出完整保存。

A 自身 10 B、B 自身 20 B、shared 自身 30 B。shared 同时被 A 和 B 持有，因此 A 的保留体积仍是 10 B；shared 的直接支配者是 root。

## 3:00—4:00：真实数据复核

```sh
npm run fixtures
node bin/moonheap.mjs diff work/real/before.heapsnapshot work/real/growth.heapsnapshot --same-isolate --query MoonHeapMarker
node bin/moonheap.mjs diff work/real/growth.heapsnapshot work/real/cleanup.heapsnapshot --same-isolate --query MoonHeapMarker
```

展示 +64 与 −64。说明这三份文件由同一采集进程生成，才能声明同 isolate；普通跨进程快照默认只比较聚合数量。

## 4:00—5:00：展示工程交付

导出当前报告，打开 CI 查看三个后端和两个 Node 版本的结果。指出 MoonBit 中的 parser/graph/analysis/diff，说明计算不在网页 JavaScript 中重新实现。

最后说明边界：离线分析、64 MiB 输入上限、WeakMap 条件引用保守处理、增长不自动等于泄漏。后续计划降低解析峰值内存并改善条件引用语义。

