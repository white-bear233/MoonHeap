# 2026 年 11 月验收索引

维护日期：2026-11-27；本轮版本：0.3.0。
按照赛事通知，验收依据为 **2026-11-30 23:59（北京时间）的 GitHub 仓库快照**。
本项目初审已通过；此文索引代码、复现命令和证据，供验收时查看。

## 九项要求对应材料

| 要求 | 本项目材料 |
|---|---|
| MoonBit 为主要语言，moonc ≥ 1.0.0-rc1 | 解析、引用图、支配关系、比较、预算判断、证据汇总与报告均在根目录 `.mbt`；[.moonbit-version](../.moonbit-version) 固定 `1.0.0-rc1+3c0520448` |
| 公开仓库与清晰提交 | [GitHub](https://github.com/white-bear233/MoonHeap)、[逐项提交记录](https://github.com/white-bear233/MoonHeap/commits/main) |
| 结构清晰、核心功能可用 | [核心接口](../pkg.generated.mbti)、[语义范围](SEMANTICS.md)、[API](API.md)；Node/浏览器共用同一 MoonBit 引擎 |
| README 可复现 | [安装、三分钟体验、真实采集、回归检查、对象证据](../README.md) |
| CI 覆盖检查、构建、测试 | [CI 配置](../.github/workflows/ci.yml)：JS、Wasm GC、native 分别执行 check/build/test；Node 22/24 集成与真实浏览器 |
| 至少一个运行样例 | [MoonBit 消费者](../cmd/main/main.mbt)、[Node 业务采集场景](../examples/cache-scenario.mjs)、仓库内五份合成快照 |
| 核心路径完整测试 | 40 个 MoonBit 测试、其中包含 150 个随机图独立核对；15 个 Node 集成测试；[验证与复现](VALIDATION.md) |
| Mooncakes 发布 | [white-bear233/moonheap](https://mooncakes.io/docs/white-bear233/moonheap)，本轮包版本 `0.3.0` |
| OSI 开源许可证 | [Apache-2.0](../LICENSE)；[原创实现、格式和算法参考说明](../ACKNOWLEDGEMENTS.md) |

## 本轮实质维护

1. 适配 MoonBit 1.0.0-rc1，移除弃用 JSON 参数而保留深度限制，固定 CI/发布工具链。
2. 复现并修复错序清单、重复输入、无效清单、报告覆盖输入等问题；为实际解析字节校验哈希。
3. 新增 MoonBit 清理预算与 CLI `check`，判断全量匹配对象，不受分页影响，明确区分通过、超限和身份不确定。
4. 新增对象证据查询及网页一键 HTML 导出；修复支配树报告上下文丢失。
5. 同步文档、版本与发行流程，新增独立解压运行发行包的检查脚本。

## 评审快速复现

安装 Node.js 22+、MoonBit 1.0.0-rc1 或更新版本后，在仓库根目录运行：

```sh
moonc -v
moon check --target js --deny-warn
moon build --target js --deny-warn
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon run cmd/main --target js
npm run build
npm test
npm run demo
```

网页加载缓存示例，确认同一 V8 实例，打开「清理后调查」，按 `PhotoEntry` / `object` 筛选：
2 个新增对象仍存活；点击其中一个，检查根路径，再导出对象证据。

```sh
# 完全清理，退出码 0
node bin/moonheap.mjs check examples/before.heapsnapshot examples/growth.heapsnapshot examples/cleanup.heapsnapshot --same-isolate --query PhotoEntry --kind object --json
# 残留 2 个对象，默认零残留预算，退出码 6（预期结果）
node bin/moonheap.mjs check examples/before.heapsnapshot examples/growth.heapsnapshot examples/residual.heapsnapshot --same-isolate --query PhotoEntry --kind object --json
# 放宽到 2 个，边界值通过，退出码 0
node bin/moonheap.mjs check examples/before.heapsnapshot examples/growth.heapsnapshot examples/residual.heapsnapshot --same-isolate --query PhotoEntry --kind object --max-survivors 2 --json
node bin/moonheap.mjs report examples/shared.heapsnapshot --view explain --id 7 --format html --output work/object.html
```

真实场景完整采集与分析命令见 README；测试会分别核对完全清理的 `0→64→0` 和残留的 `0→16→1`。
Linux native 需系统 C 编译器，由 CI 实际执行；Windows 未安装 C 编译器时先运行 JS/Wasm GC。
输入范围是 V8 堆快照，保留体积采用公开图策略；不把预算通过、对象残留或循环引用自动解释为泄漏结论。
