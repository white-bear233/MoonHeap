# 验证与复现记录

记录日期：2026-11-12。所有真实快照来自仓库的专用测试进程。

## 环境

- Windows x64，Intel Core i7-12700H，Node v24.18.0。
- moon 0.1.20261104；moonc v0.10.20+65efd5b93（2026-11-05）。
- GitHub Actions 在 Linux 上验证相同 MoonBit 工具链、Node 22/24、JS/Wasm GC/native。
- 具体运行记录见 [CI](https://github.com/white-bear233/MoonHeap/actions/workflows/ci.yml)。

## 核心与宿主

20 个 MoonBit 测试覆盖：元数据重排与尾随描述、UInt64 ID 精度、15 种畸形输入、资源限制、根与不可达节点、弱/快捷/自引用策略、循环、共享对象、查询分页、比较身份冲突、Inspector 生命周期与公共结果隔离。

支配关系额外在 **150 个固定种子随机图** 上与独立删除节点算法核对。删除每个节点、重新从根遍历，再计算损失字节；该算法不调用 MoonHeap 的支配树。另有 2000 节点深链、很小的工作预算触发超限等测试。

Node 集成测试覆盖命令行的所有操作、无损 ID、JSON 输出、错误退出码、非法 UTF-8、64 MiB 文件上限、会话释放，以及本地服务的路由边界。CLI 与 Worker 使用相同编译产物。

```sh
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon test --target native --deny-warn
npm run build
npm test
```

Windows 的 native 测试需要 MSVC Build Tools；本机未安装，原生后端结果来自 Linux CI。

## 真实 V8 数据

`tests/real.test.mjs` 每次重新采集三份快照。2026-11-12 本机一次运行：

| 阶段 | 节点数 | self_size 合计 | MoonHeapMarker 实例数 | 标记对象浅体积 |
|---|---:|---:|---:|---:|
| before | 65,861 | 7,012,404 B | 0 | 0 B |
| growth | 66,224 | 7,156,660 B | 64 | 2,560 B |
| cleanup | 65,904 | 7,015,308 B | 0 | 0 B |

进程启动、Node 版本和 GC 会改变总体统计，测试只要求业务标记和计算关系稳定。

独立校验直接读取 V8 原始元数据与数值记录，核对对象数、总浅体积及标记对象大小；真实图中的根、10 个标记对象及根路径上的若干节点再用删除节点算法核对 retained bytes。路径必须经过 `moonheapFixture` 全局属性。相同 isolate 的比较要求新增 64 个、清理后消失 64 个标记实例。

```sh
node --test tests/real.test.mjs
```

这不是与 Chrome DevTools 每项数据完全相等的声明；两个工具的引用策略并不相同。

## 浏览器验证

本机 Chromium 通过以下流程；同样的脚本已纳入 Node 24 的 CI：

- 加载示例，验证 42 个对象和 PixelBuffer +512 KiB。
- aggregate/identity 切换；32 个新增 ID；变化列表第二页。
- 分组下钻、精确 ID 搜索、入边/出边、最短根路径、直接支配对象。
- 替换文件清除旧的同 isolate 声明。
- 导出 JSON，确认大整数 ID 和保留字节数正确。
- 对象名称含 HTML 时仅显示文本，不生成 HTML 元素。
- 畸形输入提示；真实快照计算中取消、清空并重新加载。
- 1440×1040 桌面与 390×844 手机布局，页面无整体横向溢出；宽表格在自身容器滚动。
- 浏览器控制台没有错误和警告。

复现（先另开终端运行 `npm run demo`，且已经执行 `npm test` 生成真实快照）：

```sh
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap open http://127.0.0.1:4173
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap run-code --filename scripts/browser-smoke.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli -s=moonheap close
```

截图和报告写入被忽略的 `work/`，检查失败会以非零退出码结束。该开发检查需要可用的 Chrome/Chromium。

## 可重复规模测量

```sh
node scripts/benchmark.mjs
```

每组在新的 Node 进程中运行，测量从文本解析到引用图、支配树和保留体积的时间，并另测前 25 名排序查询。峰值 RSS 包含 Node、输入生成及临时 JSON 对象，并非仅算法内存。以下是一次本机实测，不是跨机器保证：

| 图 | 节点 / 边 | 输入字节 | 打开并分析 | 排序查询 | 峰值 RSS |
|---|---|---:|---:|---:|---:|
| 链 | 10,000 / 9,999 | 242,559 | 108 ms | 4 ms | 82 MiB |
| 链 | 50,000 / 49,999 | 1,272,560 | 321 ms | 6 ms | 235 MiB |
| 链 | 100,000 / 99,999 | 2,622,561 | 589 ms | 7 ms | 285 MiB |
| 共享 DAG | 10,000 / 19,997 | 340,326 | 119 ms | 4 ms | 97 MiB |
| 共享 DAG | 50,000 / 99,997 | 1,800,326 | 436 ms | 7 ms | 253 MiB |
| 共享 DAG | 100,000 / 199,997 | 3,700,328 | 803 ms | 8 ms | 320 MiB |

简单图不代表所有真实工作负载。复杂图可能触及工作预算；实际内存消耗远大于文件大小。64 MiB 是输入上限，不是内存用量保证。

## 发布前复核

`moon info` 和 `moon fmt` 保持生成接口与格式一致；`moon publish --dry-run` 会打包、解包、重新检查并向注册表验证。正式发布后还会从注册表创建外部消费者项目验证调用，不只依赖仓库内相对路径。

