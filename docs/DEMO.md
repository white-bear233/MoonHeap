# 五分钟演示

先运行 npm run build、npm run demo，打开 http://127.0.0.1:4173。
只使用仓库的专用数据生成程序。可提前执行下列真实采集命令，避免演示时等待。

## 0:00—1:00：从增长到清理后残留

点击“加载缓存增长示例”，自动打开 A/B/C 三份合成快照。
图片条目数量是 2 → 18 → 4。A → B 的 PixelBuffer 浅体积增加 512 KiB。

确认同一实例，切换“清理后调查”，搜索 PhotoEntry、类型选 object。
解释：清理后的 4 个条目中，2 个基线就存在，另外 2 个属于新增后仍存活的候选。
数量增长与存活提供调查证据，还需要结合业务预期。

## 1:00—2:00：沿引用找到持有者

点击候选，当前快照自动切换到 C。查看最短根路径：
root → Window → PhotoCache → Array → PhotoEntry。

查看入边/出边、收藏对象，再沿引用切换对象并使用前进/后退。
切换支配树，展开缓存子树，观察当前直接子树的保留体积分布。

## 2:00—3:00：共享对象与多条路径

打开 examples/shared.heapsnapshot 到 A。搜索 A：
ID 为 9007199254740993，界面不会丢失精度。A 自身 10 B、B 自身 20 B，
shared 自身 30 B；A/B 各自的保留体积不包含 shared，因为它有两个持有者。

搜索 shared，打开“多条根路径”，看到经 A 和经 B 的两条路径。
解释路径搜索的 complete 与预算提示；循环引用组同样是调查线索，不自动视为泄漏。

## 3:00—4:00：真实采集与分配来源

预先生成真实测试数据（输出目录应是新目录）：

```sh
node bin/moonheap.mjs capture --scenario examples/cache-scenario.mjs --output-dir work/demo-capture --iterations 2 --allocation-traces
node bin/moonheap.mjs investigate work/demo-capture/before.heapsnapshot work/demo-capture/growth.heapsnapshot work/demo-capture/cleanup.heapsnapshot --manifest work/demo-capture/capture.json --exclude-conflicts --query MoonHeapCapturedEntry --kind object --json
```

真实对象数是 0 → 16 → 1。将三份文件拖入 A/B/C，确认来源后搜索 MoonHeapCapturedEntry。
查看唯一候选的“分配来源”，通常可看到 cache-scenario.mjs 的 exercise。
当前快照缺少记录时回查增长快照并标明；V8 没有留下记录时展示缺失原因，不猜测代码行。

## 4:00—5:00：交付完整证据

选择 HTML 报告，导出全部匹配结果。报告包含查询条件和数据，文件可独立打开。
切到对象列表导出：即使页面只显示 25 条，也会导出全部匹配对象。
CSV 供表格查看，JSON 供程序处理，超过明确预算会报错。

保存工作区，刷新，恢复三份文件、筛选与书签。删除已保存数据只删除浏览器存储，
清空当前工作区只关闭当前分析，二者行为分开。

展示 GitHub CI、Mooncakes 包、命令行和预编译发行版。核心算法在 MoonBit，
CLI/网页复用同一引擎。说明默认每份 256 MiB、可配置预算、WeakMap 保守语义，
不把保留体积当 RSS，也不输出自动泄漏判决。
