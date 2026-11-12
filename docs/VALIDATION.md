# 验证与复现记录

记录日期：2026-11-12，版本 0.2.0。所有真实快照来自专用测试进程。

## 环境与核心

Windows x64，Intel Core i7-12700H；Node v24.18.0 与 v22.23.5。
MoonBit 工具链为 moonc v0.10.20+65efd5b93。Linux GitHub Actions 还验证 native，
以及 Node 22/24 的宿主和 Node 24 的浏览器流程。具体状态见 [CI](https://github.com/white-bear233/MoonHeap/actions/workflows/ci.yml)。

**34 个 MoonBit 测试**覆盖元数据重排、UInt64 ID、畸形输入、增量读取、转义与整数跨块、
资源限制、可达性、共享/弱/快捷/自引用、支配、分页、分配来源、多路径、循环、
保留变化、三阶段调查、歧义身份排除与完整报告。

支配结果在 **150 个固定种子随机图** 上与独立删除节点算法核对：
逐个删除节点，重新从根遍历，比较损失字节，不调用 MoonHeap 的支配实现。
另有 2000 节点深链和工作预算超限测试。

完整报告测试跨越默认 1000 行查询上限：1205 个对象、1204 个树直接子节点均全部导出；
设置较小 max_rows 时必须报错。CSV 防公式/ID 精度、HTML 转义、引用边列和排除说明也有验证。

```sh
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon test --target native --deny-warn
moon info
moon fmt
npm run build
npm test
```

本机 JS/Wasm GC 均为 34/34；Windows 未安装 MSVC，native 结果由 Linux CI 提供。

## Node 集成与真实数据

9 个 Node 集成测试覆盖 CLI、三会话桥接、错误退出码、非法 UTF-8、资源预算、
真实快照独立核对、本地服务、通用采集与来源校验、逐块文件和完整报告。
Node 22/24 均执行完整测试。测试需要生成真实快照，机器压力会改变耗时和总体节点数。

真实完全清理场景一次本机 Node 24 记录：

| 阶段 | 节点数 | self_size 合计 | MoonHeapMarker 实例 | 标记对象浅体积 |
|---|---:|---:|---:|---:|
| before | 65861 | 7012404 B | 0 | 0 B |
| growth | 66224 | 7156660 B | 64 | 2560 B |
| cleanup | 65904 | 7015308 B | 0 | 0 B |

独立代码直接读取 V8 元数据与原始记录，核对对象数、浅体积和业务标记；
根、10 个标记以及根路径上的若干节点再用删除节点 oracle 核对 retained。
路径必须经过 moonheapFixture 全局属性。业务标记 ID 新增 64、清理后消失 64。

通用 setup/exercise/cleanup 场景用 --iterations 2 --allocation-traces 生成
**0 → 16 → 1** 个 MoonHeapCapturedEntry。验证唯一新增存活候选、持有路径、
分配帧或与原始 trace_node_id 一致的缺失信息、JSON/HTML 报告，以及
capture.json 文件大小/SHA-256 校验；篡改哈希必须退出码 4。

跟踪采集中曾观察到同 ID 对应不同类型/名称。默认严格比较拒绝此输入；
显式 exclude_conflicts 模式排除歧义 ID，计数、候选、CSV/HTML 均保留说明。
测试独立检查默认拒绝和排除后的计数，不把歧义对象算作已释放或仍存活。
分配记录也可能在 GC 后缺失；测试对照原始记录，并独立验证实际存在的多条分配栈。

大文件测试构造 65 MiB 空白加有效快照：64 MiB 预算拒绝、80 MiB 预算成功，
触发超过 1000 次读取进度回调。它验证真正逐块解析，不代表承诺处理所有同大小复杂图。
文件与临时记录位于被忽略的 work/ 或测试临时目录。

```sh
node --test tests/real.test.mjs
node --test tests/workflow.test.mjs
```

## 浏览器验收

本机 Chromium 及 CI 使用同一个 scripts/browser-smoke.js。覆盖：

- 三份示例、42 个增长快照对象、PixelBuffer 增加 512 KiB。
- 身份比较、新增 32、对象变化独立第二页、保留变化过滤。
- 三阶段 2→18→4、2 个新增存活条目、在 C 中检查持有路径。
- 入边/出边、最短与多条根路径、分配信息与缺失提示。
- 支配树展开、祖先导航、体积分布图、循环组与成员。
- 过滤、精确大 ID、42 行完整导出（页面只有 25 行）。
- 书签与对象前进/后退，保存工作区、刷新、恢复文件/筛选/书签、删除保存。
- 对象名称含 HTML 时仅显示文本；文件替换清除来源声明。
- 真实带跟踪采集的唯一存活对象及来源/根路径。
- 畸形输入、真实大快照解析中取消、清空并重新加载。
- 1440×1040 桌面和 390×844 手机，页面无整体横向溢出；宽表格自身滚动。
- 本机最终浏览器控制台 0 个错误、0 个警告。

复现：先运行 npm test 生成真实输入，另开终端 npm run demo，再执行：

```sh
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap open http://127.0.0.1:4173
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap run-code --filename scripts/browser-smoke.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap close
```

失败返回非零退出码。截图、JSON 导出位于 work/；README 展示验收后的桌面截图。
浏览器检查需要可用的 Chrome/Chromium。

## 规模测量

每组在独立 Node 进程测量文本解析、图与支配分析，然后查询前 25 名。
峰值 RSS 包含 Node、输入生成、解析记录与索引，并非仅算法内存。

```sh
node scripts/benchmark.mjs
```

本机一次记录：

| 图 | 节点 / 边 | 输入字节 | 打开并分析 | 排序查询 | 峰值 RSS |
|---|---|---:|---:|---:|---:|
| 链 | 10000 / 9999 | 242559 | 75 ms | 5 ms | 71 MiB |
| 链 | 50000 / 49999 | 1272560 | 178 ms | 10 ms | 145 MiB |
| 链 | 100000 / 99999 | 2622561 | 300 ms | 12 ms | 221 MiB |
| 共享 DAG | 10000 / 19997 | 340326 | 91 ms | 6 ms | 79 MiB |
| 共享 DAG | 50000 / 99997 | 1800326 | 237 ms | 10 ms | 173 MiB |
| 共享 DAG | 100000 / 199997 | 3700328 | 417 ms | 13 ms | 282 MiB |

简单图不能代表全部真实工作负载；复杂图可能触及工作预算。256 MiB 默认输入上限
不是内存用量保证，也不是保证能处理任意 256 MiB 快照。

## 发布复核

moon publish --dry-run 已完成打包、解包和重新检查，注册表返回 202 Accepted。
正式包消费者和 GitHub 分发包采用独立目录验证：从 Mooncakes 下载，
运行新 Decoder/Inspector 接口；解压发行 ZIP 后直接运行预编译 CLI，不依赖原仓库编译路径。
发布状态与资产见 [v0.2.0](https://github.com/white-bear233/MoonHeap/releases/tag/v0.2.0)。
