# PageRoot 自动化测试策略

目标不是增加测试数量，而是在尽量短的反馈时间内发现真实缺陷。所有活动门禁都必须无人值守：不等待真人点击、输入、观察、判断或把任务转交给外部模型。测试物料可以由确定性生成器产生，但判断标准必须由源码字节、Hash、状态机、DOM/几何或明确协议字段自动给出。

## Review visual verdict matrix

`tests/review-visual-model.test.mjs` covers the visual identity boundary and
pure verdict reducer: incomplete/duplicate identity disables only visual
enhancement; identical Stable IDs create no observation-only candidates;
stale, one-sided, hidden or unstable observations are unverified; deterministic
source facts remain visible independently. `native-dom-review-visual-observation.spec.mjs` exercises
the real pre-author bootstrap and private port with position/class no-ops,
computed presentation, text, runtime DOM, SVG, Canvas 2D, WebGL, running
animation, live media, global pixel budget, delayed mutation and a genuinely
tainted Canvas. Its projection case proves that the parent can activate the
existing source character marks without generating replacement facts. A
same-ID runtime replacement remains unverified rather than reacquiring the
forged node. External runtime libraries never blanket-taint ordinary text,
added or removed source facts.

The AI Review Electron flow owns the host integration oracle: source changes
enter filters/navigation before visual observation; frame reload and authored
navigation invalidate the old generation and surface explicit unverified state;
the Before comment marker remains on the pane-right track during horizontal
HTML scrolling, and hover/focus highlights the same Stable ID in both frames.
Real-page fixtures retain identical, scroll/position-only,
equal-computed-style, text/add/remove/image/style/SVG/Canvas/runtime-DOM/
visibility cases, plus random/time, side failure and hidden-tab replacement.
Every matrix row asserts a non-zero candidate so unsupported discovery cannot
turn into a zero-work green result.

## 本地反馈与三道交付边界

| 门禁 | 使用时机 | 覆盖 | 目标 |
|---|---|---|---|
| `npm run gate:edit` | 一次局部修改后 | 只运行影响映射命中的 Node 文件；必要时 typecheck | 快速发现局部逻辑错误，不启动浏览器或 Electron |
| `npm run gate:plan -- --base origin/main` | 选择或开始跑门禁前 | 输出紧凑 JSON：改动文件、owner、Node 文件、能力级 canary、预计数量，以及分类后的阅读集 | 不必读取整份 impact map；已有超宽规则在过期日前只告警，新增超宽为硬失败 |
| `npm run gate:plan -- --context-domain <id>` | 尚未改文件、需要先定位阅读入口时 | 同一份 capability-context 阅读集；可按能力名或 `--context-file` 查询。多域共享同一文档时，整文件要求覆盖章节要求 | 不选择测试，也不改变 `task:finish` 的 `origin/main` 基准 |
| `npm run gate:draft` | CI Draft，或本地复现 Draft canary | 受影响 Node 文件加上命中的 Browser/Electron/AI canary，以及被修改的 Playwright spec；同一运行环境按实际用例合并去重 | 本地 `gate:edit` 仍保持 Node-only；Draft 绿灯必须覆盖被修改能力，且计划/发现/执行必须对账 |
| `npm run gate:task` | 一个开发任务完成时 | 静态检查、受影响 Node 文件，以及相关能力级 Browser/Electron/AI 冒烟 | 叶子改动只接通对应 canary；Ready PR 仍跑完整矩阵 |
| `npm run gate:task -- --resume <run-id>` | 同一源码 Hash 上环境抖动后 | 复用已通过的 typecheck/lint/Node/build，只重跑失败与未执行 suite | 源代码、base、lockfile、Node/平台或 suite 命令变化时拒绝复用 |
| PR `pr-feedback` | Draft PR 的 `opened/synchronize/reopened` | 轻量 Job 冻结一次计划，Linux Node/Browser 与按需 macOS Electron/AI 并行消费 | 普通 Draft 推送不消费完整矩阵；失败或取消保留 Playwright 诊断 |
| PR 完整矩阵 + `release-gate` | Ready（含直接以 Ready 开 PR） | 全量 Node、三分片 Browser、独立 Native Electron、独立 AI 闭环、真实 HTML、依赖基线、按需 dry run、exact-tree 凭证 | `release-gate` 是唯一合并硬门；Codex 评审只展示、不阻断 |
| `codex-review` | 与完整矩阵相同的触发条件 | 为当前 head 至多发一条 `@codex review`，并写 informational 线程快照 | `continue-on-error`；不在 `release-gate.needs` 中 |
| `baseline-policy` | 完整矩阵路径上，分支策略通过后 | 全局依赖 advisory policy 与 packaged-runtime closure，并写下 lockfile 快照 | 基线红时不启动 Linux build、Browser 或 macOS Electron runner；`release-gate` 只核验快照 |
| `linux-deps` / `macos-deps` | 完整矩阵路径上，基线通过后 | 按 OS + lockfile + 是否包含 Electron 填充一次 `node_modules` 缓存 | 后续分片只恢复缓存，不再各自 `npm ci`；Ubuntu 跳过 Electron 二进制 |
| 一次性晋升 `release-gate` | baseline、完整测试和相关 dry run 都完成的最终 PR Tree | 全量源码车道汇合后签发 Tree Hash 凭证 | 每个 Ready head 跑一次；后续新 SHA 重新跑完整矩阵 |
| `Release Dry Run` | `candidate-context` 判定完整矩阵候选有打包、release metadata、Electron、Bridge、Schema 或资源风险 | clean job 生成 stable `app-update.yml`、组装/静态校验显式未签名（`identity=null`）App → 非发布 checkpoint → 第二 clean job 恢复精确 metadata、重建 renderer oracle、再次校验并启动核对名称/版本/Bundle ID | 不读取签名或 Apple 凭证、不生成 DMG/updater 制品、不成为 Candidate、不创建 tag、不发布；PR 大小只作建议，不作为触发或阻断 |
| `main-integrity` | 合并到 `main` | 校验合并 PR、Tree Hash、package/lockfile 版本和凭证时效 | 相等即复用完整源码证据，不重复 Node、Browser 或 Electron 测试；不相等直接失败 |
| 按需 `Developer Preview` | 仅在开发者明确要求时 | 干净 Tree、最新 renderer、稳定 Developer ID DMG、独立运行目录、包内容完整性、一次隔离启动和精确 PR/内容交付报告 | 缺少签名身份直接失败；不成为正式门禁、不检查或安装更新 |
| `Release Candidate` | 打标签之前，凭证新鲜且 Tree/版本完全一致 | 预签名 App 内容/完整运行校验 → Developer ID 签名后启动 → App 公证 checkpoint → 从同一 App 生成并公证 DMG → 最终字节校验 | 内容错误不消耗 Apple 队列；后段失败只重跑后段 |
| `Release` | 候选包通过且不超过 72 小时 | 重新校验候选凭证和每个文件 Hash，创建 tag 并发布原字节 | 发布阶段不重新构建、不悄悄替换文件 |

本地 `release` 和完整 `artifact` 不根据改动缩减范围。`Developer Preview` 是独立的可选入口，正式 `release` 和 `artifact` 都不会自动调用它；自动部分不等待人工安装结果，开发者的短验证仅是反馈，不签发正式凭证。`Release Candidate` 使用 `gate:candidate-app:auto`：执行器会拒绝缺少 CI 信任决定、Tree Hash 或版本不一致的调用，只允许在七天内成功 PR 凭证与当前 Tree Hash、版本完全一致时进入。发布工作流只接受同一 Tree/版本、已验证且 72 小时内的候选包。`edit` 和 `task` 的选择由 `tests/test-impact-map.json` 决定，模型或开发者只选择门禁层级，不临时拼接测试命令。

## 影响映射所有权

`edit` 和 `task` 按生产所有权选择直接 Node oracle：一个文件只进入它实际实现或调用的 owner；一个文件确实跨两个 owner 时，选择器安全地取两者并集。精确规则必须从通用规则中排除，不能再用宽泛目录正则把整个 Session、Workbench 子模块或 Desktop 目录绑成一个桶。Canvas、Review、Agent、Repository 和 Desktop IPC 已按叶子模块拆开：叶子算法或 IPC 文件只接通自己的 Node oracle（必要时再加一个能力 canary）；`HtmlCanvasEditor.tsx` 走 `runtime-continuity`，评论布局走 `browser-comments-smoke`，持久化走 `electron-recovery-smoke`。超宽规则必须登记 `widthExceptions` 与退役日期，过期或新增超宽都会硬失败。新增或移动测试时，同步更新其生产 owner 的精确 `nodeTests` 列表和 `tests/test-gate-selection.test.mjs` 的选择回归；顶层 Node 测试始终至少运行自身，且本所有权基线中的 owned test 不扩张到整组。无法建立精确 owner 的代码继续走既有 `node-core` fallback。无论 edit/task 如何收窄，`release` 的完整 suite 与 prerequisite 顺序都不变。

“最新安装包”的多 PR 源码组合是打包前的 Git 流程：门禁只验证当前干净
Tree，不在测试执行期间自动合并分支。组合 Tree 含任何未合并 PR 时，
只能进入 Developer Preview 门禁，不能进入正式候选或发布门禁。

工作区有未提交修改时，`edit/task` 自动读取 staged、unstaged 和 untracked 文件。任务已经提交后应运行 `npm run gate:task -- --base <基准分支或提交>`；干净工作区又没有 `--base` 时门禁会明确失败，不会把“零测试”伪装成通过。

`npm run task:finish` 是 `gate:task -- --base origin/main` 的安全任务包装，也是唯一的任务收尾入口；不要在它之前机械重复运行同一个 `gate:task`。`tests/task-workflow.test.mjs` 在独立临时 Git 仓库中验证分支名、干净 primary `main`、远端同步、隔离 worktree 创建、现有分支 attach、脏工作区拒绝、GitHub PR/本地独有提交分类、retire 默认 dry-run、显式放弃围栏和最终差异报告，不会操作开发者的真实分支。

PR 必须从 Draft 开始。普通 Draft 推送由 `ci.yml` 的 `pr-feedback` 汇合
Ubuntu Node/Browser canary 与按需 macOS Electron/AI canary。本地
`gate:edit` 仍保持 Node-only。Ready 或直接以 Ready 开
PR 后才跑完整矩阵；`release-gate` 是唯一合
并硬门。同一路径会为当前 head 至多请求一次 Codex 评审并写 informational
快照，P0/P1 只展示、不阻断。没有 probe marker、没有 30 秒 settle、没
有 review-gate recovery，也没有 weekly review-debt Issue。

`branch-policy`、`baseline-policy` 与 `candidate-context` 按依赖并行：
完整 Linux/Browser/Electron job 只等待基线。`release-gate` 汇合它们，
针对打包风险要求 dry run 成功、针对 source-only 允许 dry run 跳过，
刷新基线后签发凭证。Ready PR 上的新提交会取消旧 run 并为新 head 重跑
完整矩阵。PR 批量是建议而非固定限制。

每个 macOS Electron lane 仍然本地构建 renderer（通常亚秒级，且排除
Linux→macOS 构建产物变量），并各自跑 hosted-window preflight（`@infra-sensitive`，
CI 可重试一次）。real HTML、Browser 三分片、native Electron 与 AI 闭环都是产品合同，
默认 `retries: 0`。`release-gate` 读取各 lane 的 flaky evidence：产品测试必须
`failed = 0`、`flaky = 0`、`retries = 0`。同一 SHA 若曾出现未归因的产品失败，
不能通过重跑生成 attestation，除非失败步骤被分类为 `ci_environment`，或 PR 上存在
未过期的 `pageroot-ci-triage` 记录。JSON reporter 仍写入
`output/ci-evidence/`。完整 Playwright diagnostics 只在失败或取消时上传。

## 测试类型与去重

- 核心 Node：算法、状态机、序列化、事务、错误关闭和 forward/inverse 不变量。
- Runtime Continuity Probe：`runtime-continuity-probe.js` 只在测试调用 enable 后记录 `frameCreated` / `candidateCreated`、canvas/评论栏宽度、scrollTop 和可见 Frame。生产路径默认静默。Electron `electron-runtime-continuity.spec.mjs` 用静态页、嵌套滚动页和 Script 图表页证明连续编辑不重建 Runtime、评论栏宽度不闪、以及重建后第 6 个空行的 Caret 落点。`electron-seeded-faults.spec.mjs` 在同一探针上注入 Active iframe 消失和编辑中 Candidate iframe，证明 canary 会失败并在恢复后收敛。
- 编辑链路计算计数：`edit-pipeline-counters.js` 只在测试显式 enable 后累计整文 `buildSourceIndex`、完整 `applyPatchPlan` 和插入点全树扫描。默认关闭，事件不含 HTML。`tests/edit-pipeline-baseline.test.mjs` 冻结当前 kernel 与 Canvas 单路物化次数；后续删除重复工作时必须更新这些数字。kernel 在同一次 apply 内复用已构建索引后，不得把状态包装或身份计算的重复解析算回基线。插入点全树扫描只在源码 Hash 或 iframe document 身份变化时发生，overlay/滚动/选区更新不得另计一次。片段解析、浏览器 DOM 解析和独立持久化验证不计入同一组。
- 已删除的 Canvas `useCallback` 源码切片断言由既有 Electron 行为测试接替，映射写在 `tests/html-canvas-runtime-startup.test.mjs`。保留的只是退役路径禁令（例如 `forceRuntimeHandoff`、`lastValidCommentLayoutRef`）和 queued-static oracle。
- 测试 Inventory 与风险账本：`npm run test:inventory` 从实际 Playwright 配置的 `testMatch` 生成执行清单（含 Ready / Draft smoke / packaged / real-html，以及明确标为 `on-demand` 的 review-annotation），并核对 `tests/test-risk-ledger.json` 的 `ready-full` 文件确实被某个 Ready 配置选中。源码正则只用于辅助提取标题与 Tag，不能单独证明用例会被执行。
- `DocumentWorkflow`：fake Scheduler、Hash、RecoveryStore、Canvas Port 和 Bridge
  验证 100ms 非 checkpoint 合并写入、native-edit checkpoint 立即 flush、单飞 flush、未登记首次登记、精确 HTML/Hash/revision/history
  回执、未知 history action 的权威核对与同一 actionId 重放、恢复记录与 stale context。
  Workbench 只把 Canvas 输入及结构化 Outcome/Event 映射为界面，不再持有 timer、
  audit in-flight、recovery identity 或 history Promise。
- `ProjectWorkflow`：fake Canvas/ProjectOpen Port、窄 `ViewStatePort`/`RecentRunsPort`
  与既有 Session owner 直接验证
  hydration generation fence、accepted-result FIFO、drain 后 native input 延后与恢复、
  close-awaiting external cancellation、committed close/abort freeze 身份、stuck hydration
  快速关闭、load/source stale fence，以及 Canvas acknowledgement 失败时旧页面权威回滚。
  同一集还验证安全文件重命名的完整 Hash/context fence、丢失桌面响应的 active-file
  对账、单飞与迟到结果不能 rebase 新项目，以及 Finder 同目录改名后的
  `reconcileExternalSourceLocator` 单飞行：身份四元组不变、新路径与
  `activeManagedLocator` 原子更新（含 macOS `/var` 与 `/private/var` 同一路径）、
  同父目录项目文件夹改名靠父目录监听提示、当前 HTML 仍在时只 hash-observe 且不
  drain 切换边界，内容 Hash 不同则进入既有冲突且不覆盖任一侧。顶栏
  `renameSource` 必须把 managed OpenTarget 的 `exactSourcePath` rebase 到新路径，
  hydration 不得因 workspace 省略 OpenTarget 或 `/private`/NFC/大小写拼写差异丢掉该身份，
  否则随后的 Finder 重绑会跳过 Bridge，顶栏会报“当前工作文件暂时不可用”。
  `WorkspaceController` 负责把 `RecentRunsPort` 和 ProjectWorkflow event channel 接回
  aggregate snapshot/event stream。Workbench 只保留 file input、host adapter 和
  Outcome/Event 的展示映射；专项 Node 集与完整 Electron 套件共同证明真实
  close/open/hydration 路径。
- `ProjectRulesWorkflow`：fake Bridge、Scheduler 与 Project/Run Session 验证 `PROJECT.md` 的
  700ms debounce、保存中继续输入时的完整 drain、unknown-write 单次 authority
  reconciliation、late read/write stale fence、run lock、dispose timer fence 与显式还原先退役原生输入节点。`ProjectRulesSession` 只验证 working copy/composition/save projection；Workbench 只转发规则工作流 intent，长期规则页的正文草稿留在编辑器本地，保存状态仍来自工作流快照。
- `CommentWorkflow`：fake Bridge、RecoveryStore 和现有 Comment/Draft Session 证明
  lazy registration、单次 Draft 持久化、附件部分成功、跨项目迟到上传补偿、编辑取消
  仅删除 staged 附件，以及 unknown Draft POST 只通过 authority query 收敛而不重复
  mutation。Workbench 只保留 File、Object URL 和焦点映射；Browser memory
  附件不得调用 Bridge。
- `ProjectFileRepository` Request freeze：Node 集成覆盖附件-only 评论、多评论多附件的
  独立字节副本、annotations/requirements/instruction/manifest 的 attachmentId 对齐、
  Draft 原件删除后的继续读取，以及缺失、篡改、长度超限、目录、软链接和路径逃逸在
  `request.json`/Runtime authority 发布前失败。Agent Policy 必须按 manifest 读取真实附件
  字节，而不是只接受附件元数据。Request 级 failpoint 矩阵还要覆盖附件写完、完整
  bundle/marker 就绪、staging 目录发布、Runtime 写入和最终准备；前置失败不得留下
  public Request，模拟进程中断后 `recoverProject` 必须校验 marker、逐文件 Hash 并恢复
  Runtime，而不是重复复制附件或产生孤儿目录。
- `RunWorkflow`：fake Bridge、Scheduler、Canvas/Handoff/Hash Port 和既有 Run/Project/
  Document/Comment Session 证明 source freeze 与 persisted SHA/revision 边界、最终
  保存 HTML 上 Stable-ID/UTF-16 textLocator 的唯一重定位与 stale/ambiguous 阻断、
  一次 Request、unknown POST 只读 authority reconciliation、A/B 并行 polling、dispose
  late-callback fence、取消/冲突 scoped identity，以及 clipboard failure 后只重试复制。
  Workbench 只保留 intent 和 Outcome/Event 映射，不持有 poll timer 或
  run mutation I/O。
- `VersionWorkflow`：fake Bridge、Project/Document/Version/Run Session 与 Canvas/Hash
  Port 证明 Review candidate 只读且不可变、明确 activation 的完整 identity/hash/time
  校验、Project/Document/Version 同步 publication、Candidate 的 Stable-ID 目标范围评估
  与旧 assessment 兼容、background result 不抢占当前 Canvas，以及 history/current
  navigation 的完整 Document + Version rollback 与 byte oracle。Candidate impact Node
  oracle 必须覆盖目标后代、目标内增删、兄弟前插、整页评论、重叠根和接近 HTML 上限的
  O(N) 计算；持久化样例最多 100 个且 `truncated` 与计数一致。Electron AI Review
  场景还必须看到评论目标数、实际修改元素数、目标外修改数和进入全部变化的入口；
  该警告不得阻止 Candidate 继续审阅或采纳。
  Workbench 只保留 review filters/layout/lease、动画和 Outcome 映射；architecture
  gate 将其直接 Bridge 调用锁定为 0。
- `WorkspaceController`：runtime factory 是生产组合的唯一入口；它构造唯一的 Bridge
  client、共享 RunSession、`EditAuthorRuntimeSession` 与各业务 Session，并作为唯一
  application aggregate observer 生成冻结的 Project/Document/Comment/Run/Version/Edit
  aggregate snapshot。Edit runtime 的纯 Session 测试证明键仅为
`(sourcePath, canvasGeneration)`、非权威源码随后变为权威时仍可开始一次、准备
loading surface 确认前不调用窄 port、同代不因 autosave/评论重试、旧结果只撤销；
Workbench 只确认已提交 loading surface、传入窄 port 并消费快照。Node 测试证明晚到 observer
  在 `dispose()` 后不再发布；Document snapshot 只投影 `hasPendingWrite`/`isFlushing`，
  不泄露写入内容或 Promise。Workbench 只能订阅该 aggregate snapshot 与 event stream。
- `WorkbenchNavigationSession/Workflow` + `WorkbenchTabsSession`：Node 直接证明单一 admission/receipt 顺序、`projectId + documentId` 去重、多开始页、
  活动 Start 原位承载新文档/去重已有文档、较多标签仍保持顺序与身份去重且不设产品数量上限、状态投影、关闭不删业务权威、close/activate 竞态 fail-closed，以及 Start 和文档
  激活严格按 `ProjectWorkflow.prepareSwitch` 的 native fence/drain → Registry 打开 → 新 epoch
  身份挂载 → display-ready 提交，hydration/Canvas settle 作为后台就绪继续；相同旧身份不得提前完成。
  测试必须证明水合仍 pending 时下一标签可以进入、旧水合按 epoch 退休、后台失败只标记标签并锁住
  编辑。已登记项目的 exact open envelope 必须证明 Renderer 水合不再重复 `/source`，干净且 generation/
  Hash 完全一致的 verified Canvas 必须证明不会重复 render fence。
  `DocumentSurfaceCacheSession` 另以 Node 证明只接纳已持久化且 Canvas Hash 一致的投影、
  3 个 hot / 8 项 / 48 MiB LRU、滚动与 PageViewContext 恢复，以及淘汰不关闭标签；Electron
  标签页用例证明缓存显示仍进入正常项目打开链路。Registry-before-hydrate 与
  hydrate-before-Registry 都必须得到相同标题/缺失项结果。持久化测试拒绝 title/path/HTML/Hash
  和未知字段，验证 `activeTabId:null`、原子替换与无效文件 fail-closed；Electron 证明 Left/Right/
  Home/End 的 roving focus、键盘关闭后的活动标签焦点、Start 冷重启抑制 activePath、Start→Registry 原位打开、Registry 标题恢复及 unmounted outlet 安全关闭。
- Accepted ProjectApplication 的慢 A/快 B Node 联测把真实 `project-applied`
  事件同步投影到同一 `WorkbenchTabsSession`，必须同时保留 A/B、只聚焦 B 且不重复；pending
  registered switch 的展示事件不得替代 `WorkbenchNavigationWorkflow` 的同步应用回执。
- Browser-file identity Node 测试证明版本化 metadata/content 摘要重选稳定、同内容异名不混同且不携带
  path/HTML/Hash 权威；ProjectWorkflow→TabsSession 联测证明 Start 原位成为文档、重复打开仍只有一个标签。
- 外部打开 FIFO：Main mailbox Node 测试证明队首在 renderer 显式 ack 前不消费、不发送后继；renderer
  Session/ProjectWorkflow 测试证明两个未登记 OS 请求依次显示确认，并覆盖接受、取消、拒绝与 deferred
  的回执顺序；另证明直接/终态/确认后 ack 失败只重试同一回执且不重复打开或提交，以及关闭会逐个取消并回执全部排队确认。preload 合同只暴露 opaque requestId
  的 accept/ack，不暴露路径权威。
- Bridge 集成环境：每个真实 Bridge 测试各自创建临时 root、workspace、sources、端口、子进程与 stdout/stderr；同一测试可为重启恢复顺序启动新进程，但不同测试绝不共享 workspace 或长寿命 Bridge。环境默认携带配置的 Bridge auth token，测试缺失/错误 token 时必须显式关闭或覆盖它；HTTP/连接失败保留 response text 与 Bridge 日志，不重试 mutation。
- Agent Host/Policy contract：公共 owner 位于 `bridge/agent/policies/` 与 `bridge/agent/hosts/`；`tests/agent-provider-contract.test.mjs` 证明公共层只产生通用 Agent error/brand，旧 façade 在边界映射回既有 provider/transport error name、code 与 copy，并以 source literal gate 阻止 provider/transport ownership 回流。Discussion capability 和非 execution ticket 必须 fail-closed。`tests/qoder-acp-spike-client.test.mjs` 属于 Node integration owner，只使用合成 HTML、隔离的真实 v4 `ProjectFileRepository`、进程内 fake ACP Agent 与官方 finalizer。oracle 必须独立证明外部封存的 manifest Hash、精确 readOrder/role/media type、单一 Candidate 写路径与原子 no-replace 发布、无 shell 的精确 finalizer、session/permission/terminal 绑定、completion/output Hash、runtime authority drift、macOS `/var` realpath alias、事件/prompt 边界、timeout cancel 后拒绝晚到写入/finalizer、Agent 早退出与孤儿进程组清理，以及 Candidate ready 后 Working Copy 全量状态、manifest 和 Version 快照均未变化。
- Product Agent Bridge：`tests/agent-provider-contract.test.mjs` 使用无用户路径/秘密的合成 provider/runtime fixture，拥有 legacy `qoder-acp` → `qoder`/`acp` 唯一 registry 分派、内部 installation digest/capabilities ticket、未知 provider/runtime fail-closed，以及 availability/preflight/start 的旧公开投影。`tests/agent-bridge-service.test.mjs` 拥有只读本地检查不运行 Qoder、同进程安装后重读、npmrc/nvm/Volta/fnm/mise 发现、非法包不误报未安装、trusted-local consent、使用前检查、一次性 execution ticket、最终 spawn identity、不泄露 command/path、持久 crash lease、task-keyed 幂等、取消、restart-interrupted、retry output refusal 与公开错误脱敏。`tests/run-workflow.test.mjs` 证明只读检查零 Request/冻结/剪贴板、`agentDelivery: qoder-acp`、Execution 投影、安装与登录引导剪贴板隔离、Settings 检查不授权稍后发送、同一发送意图的 ticket 只供紧接着的 Agent 启动复用，以及预检失败不解锁一张从未锁定的 Canvas。`tests/agent-bridge-workspace.test.mjs` 必须启动真实 Bridge 与 fake ACP 子进程，证明自动完成只产生 pending-review Candidate、Working Copy/Version 不变，取消先终止 Qoder 再 durable cancel，以及 Bridge 强杀后同 Request 重启被 fence、旧 Request 取消后才能重新发送。`tests/desktop-preload-ipc.test.mjs` 证明 preload 不暴露 Agent executable/spawn/command/path capability。Electron AI closed-loop 必须额外证明自动模式不接触剪贴板、不自动 Adoption，并能进入真实 Review UI；未登录时 Settings 保持、复制任务始终可用、零 Request 且 About 保持产品信息。package owner必须递归拒绝 symlink/特殊文件，并用打包 Helper、打包 Bridge、fake ACP 与打包 finalizer 证明 pending-review 闭环及 SDK/Zod 精确运行时闭包。`npm run spike:qoder-acp` 的真实账号/网络探测仅是额外开发证据，失败或成功都不进入自动门禁；ACP allowlist 也不得被描述成 Qoder 本地进程的 OS 沙箱。
- Schema 与 scope 的纯函数矩阵继续独立拥有 strict union、identity/path/hash drift、TargetRef/topology 与 guidance 判定；真实 lifecycle 集成只证明产物 bundle、official finalizer、ready/attention 和 activation 的持久化边界。SourceTransaction failpoint 表逐 case 保留独立的 disk、runtime、history 与 audit exactly-once oracle，不以最终 200 取代 commit-point 断言。
- Agent 诊断、流式和恢复：`tests/agent-provider-contract.test.mjs` 证明 diagnose 调用真实只读 provider probe，但不创建 preflight ticket/session 或改变 selection。`tests/openai-compatible-agent.test.mjs` 覆盖 `stream: true`、分段 UTF-8、跨 chunk/多行 SSE、`[DONE]`、断线半成品丢弃、结构化 provider error 和 content/reasoning/usage/heartbeat 滑动 activity。`tests/agent-protocol-acceptance.test.mjs` 证明产品可见的 DeepSeek 与 Qoder/Codex 在真实协议账本上仍为未验收，source-gate / Candidate 必须带上该账本，CI mock 不能把它写成 accepted。`tests/qoder-acp-spike-client.test.mjs` 覆盖 ACP 同一 inactivity 语义与 cancel fence；测试用短窗口或伪时钟证明总时长超过一个窗口仍可持续，不真实等待 45 分钟。Conversation/Run 测试必须证明同 request/attempt 失败优先、最多两个恢复操作、重试复用冻结选择、结束走 durable cancel，以及历史仅按日期/turn/request 派生分组。
- 外部源绑定：Repository Node 测试按能力拆在 `tests/project-registry-and-open.test.mjs`、`tests/project-working-copy-save.test.mjs`、`tests/project-candidate-promotion.test.mjs`、`tests/project-request-authority.test.mjs`、`tests/project-ai-task-projection.test.mjs`、`tests/project-path-security-and-locks.test.mjs` 与少量跨模块 `tests/project-file-repository.integration.test.mjs`。它们共同拥有编辑/晋升/历史 Working Copy 后重开、Hash 变化仍保持 B、同内容另一路径仍为 C、跨实例同源唯一与异源不丢写、多 claim 失败关闭、损坏绑定不降级为 C，以及当前 Registry 写锁的活/死 owner。`tests/project-file-bridge.test.mjs` 拥有 `/project/open-classification` 的 A/B/C DTO、无副作用和禁止回传 source key/原稿绝对路径。分类测试必须独立计算期望 Hash，不能调用被测 source-key helper 当 oracle。
- 语义身份与保存：`tests/semantic-identity-save-contract.test.mjs` 独立证明八类语义操作的系统导出 `identityDelta`、标签变化不换身份、wrapper/`br` 显式新 ID，以及伪造 delta、缺少 schema/envelope/类型必填字段、携带未知字段或用不相关 `operation.html` 冒充 insert/replace kernel 物化结果的证据失败关闭。结构矩阵必须从真实 kernel 计划出发，对 delete/insert/replace/同父 move/跨父 move 各附加一条自洽的无关 patch，并证明共享纯 structure replayer 以整组 range/before/after/kind 拒绝；undo/redo 还要选中原始 forward proof。纯文本 `setText` 必须把 exact range/before/escaped-after/kind 与内核计划绑定并拒绝无关 patch，forward/undo/redo 都选择原始语义证据；受管 native `<br>` 必须由 Canvas 计划从无 ID 节点按 DOM 顺序分配 fresh ID，多换行只匹配 ID 集合但交换分配顺序也必须拒绝，预置新 ID 失败；真实 Electron 必须在首次换行保存后立即证明 controller 未进入 blocked state、live `<br>` 已同步 ID、owned/baseline canonical 已推进，再继续同一会话输入，证明 Selection 不丢且没有额外整页重建。Repository 还要用共享纯 normalizer 拒绝修改 protected attribute 的自洽 identified `setText`，并用共享 single-CSS-value validator 根据逻辑 range/quote、源位置、wrapper 数量、canonical style 字节和 ID 列表拒绝伪造或注入声明的 range-style subtree。`tests/project-semantic-identity-save.test.mjs` 必须使用真实受管 Working Copy 和 Repository，覆盖 delete、包含后代的 `setText`、`replaceSubtree`、同父/跨父 move、insert/duplicate 的保存重开，20 步且不跨重启的 Undo/Redo，Hash/CAS、原子保存与崩溃恢复。没有语义证据的 ID 删除、新增、交换、移植、伪造、重复或移动必须拒绝；仅文字/属性/样式且 binding 完整的外部修改仍走既有合同。精确 SourcePatch 回放只证明字节链，测试必须反向证明旧 `kind` 不能授权身份变化。Native Electron 再证明受管换行和其他画布操作经真实 autosave 关闭/重开保留、删除源码元素时关联评论同步删除且重启不恢复。Runtime DOM/Script 生成节点不得出现在保存 HTML，保持 ADR 0065 的独立既有 Electron 证据。
- 身份不变的语义字节同样必须失败关闭：`replaceTextRange`、`setAttribute`、非 range `setStyle` 与合并到目标/现有 wrapper 的 range style 都从 original-forward 源码独立重建完整 patch 数组，正向/撤销/重做拒绝完全缺失声明修改或附加无关 patch；矩阵覆盖跨 run 文字、属性增改删、单双/无引号和 style 更新/追加，部分 range 不得缺少 wrapper ID。
- 导入确认与 Prepared Intent：`tests/prepared-html-open.test.mjs` 拥有公开 descriptor 不含路径、commit action 拒绝 `view-initial`、幂等 commit/finalize、较新请求取消旧 intent，以及同一原稿路径复用已 prepared/committing 的 intent。`tests/external-open-copy.test.mjs` 拥有“已经导入”确认框里版本句子的出现判定：版本一致、序号缺失或不可解析、工作稿领先于最新版时都必须为空，只有工作稿落后于最新正式版本时才给出两个真实序号和落点。`tests/project-workflow.test.mjs` 拥有确认前零 switch、冷启动 epoch 0 确认不围栏不存在的 Canvas、Canvas 失败不 finalize 删除、以及“打开之前的项目”不再导入。`tests/workspace-controller.test.mjs` 在要求 ProjectWorkflow 之前拒绝 `view-initial`。`tests/document-session.test.mjs` 与 `tests/document-workflow.test.mjs` 拥有 Canvas pending/verified/failed 与 verify 失败关闭。Electron 夹具先识别确认框再接受 `ready`；欢迎页已 ready 后仍短等确认 overlay，再点“导入并打开”或“打开之前的项目”，不得设置 `SKIP_IMPORT_CONFIRM`。`packaged-startup-smoke` 对 argv 与运行中 `open-file` 同样先驱动确认框，再断言 managed V1。不得把确认 descriptor 的空 `sourcePath` 当成已导入成功。
- 通知合同：TypeScript 封闭 `GlobalInterruption` kind 联合拥有允许的中断事实；文案只来自 `globalInterruptionPresentation()`。Node 测试拥有产品错误清洗与工作区安全状态优先级。Browser 测试拥有 `aria-live`、键盘、按钮和 hover/focus pause。不得再扫描 Workbench AST 或内部 helper 名称来证明某个 `setToast` 调用是否合法；生产 `setToast` 创建调用必须保持为 0。
- 源码字符串合同只保留显式 architecture/security/packaging/dependency/workflow boundary。应用架构形状由 `scripts/check-architecture.mjs` 唯一拥有，`tests/architecture-boundaries.test.mjs` 只执行该 checker；当前显式清单为层级 import/retired operation，Workbench Bridge 调用为 0、final runtime factory、aggregate Session observer、唯一 Session construction owner、typed drain owner、Controller 反向 UI import 和 generic Bridge escape，及 SourcePatch + SourceTransaction 发布、精确 source freeze 及 AI 请求绑定、Edit runtime projection 禁止、native user/system priority、DOM replacement 前 lease retirement，以及 pointer capability 不得引用 `isNativeDirectEditRoot`。该集还必须保留 View Bridge call、Controller React import、generic Bridge escape、duplicate Session owner、missing drain command 的负 fixture。业务测试不得读取、拼接 Workbench/Canvas 大文件或扫描 JSX/CSS/copy/callback 顺序；它们使用 Session、算法、Browser 或 Electron 的可观察结果。`tests/rendered-html.test.mjs` 是独立例外：它必须执行真实 `dist/server/index.js`/`worker.fetch`，只验证公开 SSR 入口与已退役托管/编辑器 surface，不读取生产实现源码。`tests/workbench-css.test.mjs` 拥有 Workbench 级联入口：`app/globals.css` 必须只含固定顺序的 `@import`，拼接后的 `app/styles/` 字节保留顶栏与 tooltip 的源码顺序合同。
- 交付合同按 owner 分层：desktop-package.test.mjs 只拥有 package.json allowlist、Bridge/Schema/资源闭包、CSP、entitlements、Info.plist 清理和固定包身份；packaged-artifact-gate.test.mjs 必须调用真实 verifier，拥有 app.asar、Bridge、Schema、metadata、retired closure、签名 profile 和 DMG/ZIP 边界；预加载 IPC、更新、Preview、窗口、Bridge 生命周期、遥测和 Workbench 行为必须留在各自 Node 或 Electron owner，不能因它们被打包而回流到 package 测试。
- Developer Preview、Release Dry Run、Candidate 和 Release 是四个显式 trust profile。公共 release fixture 每次创建独立 package/build-info/telemetry/application-update/identity 值和独立临时目录；它不签名、不调用 Apple 命令、不访问网络，也不能以无 profile 的宽泛对象混淆正式与非正式通道。fixture Hash 期望值必须继续由测试侧独立 crypto 计算，不能调用被测 evaluator。
- Workflow 源码扫描只证明凭证、exact Tree、权限和阶段顺序等 release architecture 边界；普通步骤文案和已由 verifier/owner 覆盖的行为不得作为第二个字符串 oracle。
- Browser 冒烟：固定覆盖脚本隔离、源码字节、可编辑岛、源码权威围栏和能力降级五类关键风险；完整 Browser 包含全部活动 V2 回归。裸文本片段结束会话后必须仍能把工具条/快捷键格式写入源码，不能把已拆除的 fragment 宿主当成失连而阻断。V1 的 per-keystroke tracker、FormatSkeleton 和 IME tail 状态机实现及测试已从仓库删除；V2 岛内字节 oracle、输入矩阵和 composition 快照用例是唯一产品合同。
- Electron 冒烟：固定覆盖真实 authored DOM 输入和一次带磁盘持久化的 composition；完整 Electron 保留保存、关闭重开和逐字节 forward 结果等全部路径。
- Electron 产品套件默认使用隐藏、禁止后台节流的 BrowserWindow，不抢键盘焦点；后台模式保留 macOS Dock 图标，点击图标可手动调出窗口查看或再次最小化；自动触发的原生弹窗在所有 E2E 模式下一律拦截并写入测试日志，即使显式设置 `PAGEROOT_E2E_FOREGROUND=1` 观察窗口也不会出现系统弹窗。CI 环境预检保留可见但不聚焦的 accessory 窗口，用于证明 WindowServer 绘制能力。
- 交互预览与 Edit 可丢弃 Script 页：Electron 用四类真实用例证明普通脚本
  持续运行、`async`/`defer` 属性保留、本地 ECharts 生成真实 Canvas，以及语义
  结构操作会用完整 next HTML 重建 iframe 并重跑作者程序。运行时后代必须
  映射到最近源码宿主，只保留评论能力，不暴露文字/样式/结构编辑。元素复制要同时
  证明整个选中子树：运行生成内容及包含它的外层容器隐藏复制入口，保留评论和
  其他结构动作，并且旧的按钮引用或其他调用者也必须在公共命令边界被拒绝；同页独立的
  纯源码子树仍可复制。原始
  HTML 与 Working Copy 均不得出现生成节点标记。协议/bootstrap 单测拥有资源闭包
  复用、revoke、CSP、导航拦截、源码证明、无预热/Runtime cache 边界，以及
  精确 URL 内容寻址字节缓存的损坏回退、并发去重、严格容量 LRU 和原子发布。
  5.4.3 / 5.6.0 定向矩阵必须证明三类标准 CDN URL 使用各自同版本、固定 Hash
  的内置字节且不访问网络；缺失版本只请求准确 URL，损坏内置字节直接失败，
  不允许跨版本替代或第二次恢复 Session。Activation 测试还要区分资源失败与
  作者脚本错误，并证明只有关键图表已经就绪时，后者才能保留为可编辑的
  `runtime-partial`；源码自带的静态 SVG 图标不得冒充运行时图表，识别出的
  ECharts 必须存在对应的实时实例。`runtime-partial` 必须保留显式动态重试，
  重试使用最新已保存源码和新的 Runtime Session；重复部分失败仍可编辑，之后的
  完整成功会清除降级状态和重试入口。
  候选时限用例必须分开：未完成的 activation/关键内容等待按阶段上限终止；
  已在当前身份下通过必要检查的慢结果不因上报耗时超过性能目标而事后降级；
  已取消、已终止、被更新候选替代或 lease 过期的迟到结果永不接管。
  模块识别回归覆盖真实静态/动态 import，以及注释、字符串、正则、属性/私有名和
  `import.meta` 的非依赖情形；不要用代码字符串扫描代替可观察能力结果。
  Session 单测还覆盖外部来源切换至托管 V1 时，即使 SHA/Canvas generation
  未变也会发布新的准备路径；而 macOS `/var` 与 `/private/var` 同一文件别名
  不会消耗额外尝试。
  桌面编辑画布还必须
  证明同目录图片通过同一条受控资源根加载成功，而 `script-src` 没有因此
  获得 `pageroot-preview:` 权限。首次导入把原稿目录记在 desktop
  `html-projects.json` 里：Preview 会话、静态 Edit 资源 base 和可丢弃
  Script runtime 都从该目录解析相对资源，而不是从项目内 V1 目录；原稿 HTML
  被移入废纸篓后仍可使用同目录剩余文件。B 类“打开之前的项目”、重启后打开
  同一项目工作稿，以及工作文件从 V1 切到 V2，都不得丢掉这条资源根。Browser 的确定性
  Tab 评论用例同时证明 `评N` 标记悬浮于标签控制右上角、顶部栏不重复
  显示当前标签、其他标签评论以中性评论卡片在顶部栏内部展开，并可从
  具体卡片切换标签并定位对应评论。未保存评论在当前标签页保留持久入口，
  切换标签后只作为对应分组中带“未保存”状态的卡片出现；点击恢复不会移除
  入口，保存或明确删除才会移除，且草稿不增加主评论数或 `评N`。
  高密度短页面用例还必须证明 Canvas 自然底边保持不变，评论队列不会撑长
  共享页面；页面到底后可继续向下把底部卡片拉入，反向滚动可恢复自然位置。
- 编辑模式安全内容切换：Node 证明语义 ARIA Tab/details/disclosure 白名单，
  以及 `data-p` / `data-tab`、固定索引处理器、链接、弹窗、分组 details
  和歧义标记保持无动作；Browser 证明 ARIA 页签可通过工具条和
  `Option + 单击` 切换且共享滚动位置不变、作者处理器未运行且导出字节不变，
  旧式页签不再出现切换动作；Electron 独立重读真实源文件，证明作者事件未运行
  且磁盘字节不变。
- 编辑画布指针提示与命中：Node 证明指针能力只按进入文字编辑的证明分三档，
  可编辑优先于「像按钮」；Hover 快划不闪、400ms 才出文案，且与单击同一命中。
  有内容模块的 padding 选中该模块，空模块不选；标签画在命中轮廓内侧。Browser 证明点模块
  留白选中该模块、点子内容选中小框、点空模块不选中，已选 A 时单击 B 一次改选，
  点 Hover 标签像素选中同一模块，以及单击 canvas 选专用根而不是外层模块。启动先
关掉后台节流，若 `#root` 仍空则 reload 一次。Native 套件的
  `waitForProjectReady` / `loadedDiskFrame` 与共享 helper 一样使用 60s hydration
  预算，避免 CI 在导入确认后卡在 30s 帽上。`main.workbench` 渲染时
  `data-project-state` 必定是 failed/hydrating/ready/unbound 之一，因此状态为空只
  代表元素不存在。等待就绪时按文档标记身份区分三种情况：首次挂载前是
  pending 继续等；文档被换掉（启动路径已有的 reload 兜底）属正常；同一文档
  丢掉已挂载的 workbench 则是渲染器故障，立即失败并附上 `#root` 子节点数、
  hydration stage 与捕获到的 `pageerror` / `console.error`，不靠 60s 超时把 React
  拆树掩盖成一次可重试的 flaky。
- AI 闭环：Node 集成必须分别证明普通/跨标签相关改动可建版、不相关但可用
  HTML 进入 `attention` 并强制审阅、脚本/inline handler 等作者内容变化
  照常建版且不生成检测字段或提示，以及身份/Hash/路径/协议失败与
  no-change 可从 workspace 恢复。
  Electron AI 闭环还必须从真实评论附件上传开始，验证 Request 内冻结文件的
  实际字节、manifest Hash 与删除 Draft 原件后的可读性，不得只断言 JSON 元数据。
  `ReviewAnalysisSession` 的 Node oracle 另证明确切 key 合并、异步让步、运行中
  取消和按字节 LRU。`review-annotation-fallback` 的 Node oracle 执行生产编排与真实
  canonical fact 累计器，证明 24/25/可合并边界、仅实际溢出类降级、恢复失败继续拒绝、
  取消后不发布或缓存；真实 Chromium companion 在已插入文本标记后注入同一累计器
  的溢出，证明重解析原始双页、清除临时标记、保留评论、panel/action 配对及正式 bootstrap。
  Node fixture 不替代真实 DOM 或 Electron 中的采用/不用验收。Node oracle 必须区分普通插入、同父重排与跨父移动，证明
  Stable ID 支持多宿主 evidence 映射，并证明重复/非法/缺失 ID 只禁用视觉增强，
  不取消既有源码 matcher。纯函数 oracle 覆盖 `changed / unchanged / unverified`、
  source Hash、Session、generation、隐藏内容、外链运行库、1001 个 Stable ID 后的
  源码变化与单侧 added/removed 证据；真实 Chromium 覆盖本文开头的 Review visual
  matrix、整轮预算和延迟变化。Electron 闭环验证源码变化始终进入计数和导航，
  unverified 有内联状态与采纳提示，同时评论固定轨道、cleanup、Tab 与导航合同
  不回归。preload、IPC、package allowlist 与 artifact verifier 仍不存在
  Review capture owner。
- Electron E2E 夹具与场景归属：`tests/e2e/electron/helpers/pageroot-app-fixture.mjs` 是兼容 re-export。能力实现分别在 `electron-app-launch.mjs`、`electron-project-fixture.mjs`、`electron-project-ready.mjs`、`electron-comment-driver.mjs`、`electron-legacy-project-fixture.mjs` 与 `electron-safe-cleanup.mjs`。它们只拥有独立 userData/workspace/source、隐藏窗口启动、Bridge 路径、close-first
  cleanup、诊断输出和已加载 frame；不包含产品断言、整条用户流程或自动重试。
  启动或 hydration 未就绪时，fixture 必须记录主 frame、Workbench/
  `data-project-state`、hydration stage、可见失败状态、主进程输出、活动窗口和隔离
  Registry 摘要，并直接失败；不得 reload、延长等待或标记 flaky 来掩盖异常。
  fixture 的 Node contract 必须证明 close event 或已确认的 Electron process exit 先于
  cleanup、close listener 覆盖 exit request 与 SIGTERM/SIGKILL 的完整有界 shutdown budget、stop 幂等、
  SIGTERM/SIGKILL 有界 fallback，以及两者均未确认时不删除
  Bridge-owned 文件。AI 闭环保留 verified
  review/accept、pre-load navigation、顺序 Version/relaunch、internal supplement、
  no-change、return、clipboard failure、A/B 隔离、double-click、cancel/restart、
  unknown reconcile、missing finalizer、malformed HTML、broad related、activation
  failure；legacy global comment 的跨重启恢复仍处在兼容窗口，继续保留为独立
  Electron 场景。Native Electron 拥有 rapid switch/close 的真实 DOM 与磁盘 oracle；
  project rules/drain 与 update/Settings 均由其更窄的 Node/Preload/UI owner 覆盖。首个
  review/accept 场景的 geometry helper
  必须把每个表驱动 case 的 fixture、filter/page/context、change type、element/Range
  owner、frame/mask count、tolerance 与负例写全；表只能消除样板，不能合并不同
  故障模型。

  基线的 21 个 AI Electron 场景中，核心 AI 场景按能力拆在 `ai-review-adoption.spec.mjs`、`ai-provider-availability.spec.mjs`、`ai-run-lifecycle.spec.mjs`、`ai-candidate-validation.spec.mjs` 与 `ai-request-comments.spec.mjs`；其余 5 个非 AI/重复排列按下表有明确 owner。

  | 已收敛场景 | 唯一 owner |
  | --- | --- |
  | first project registration 的 global comment | `comment-rail-layout`: `global comments stay before local comments regardless of canvas position`；Browser `native-dom-comment-stress`: `comments virtualize immediately above the threshold and remain navigable`（首个保存等待 lazy registration committed） |
  | orphan comment recovery | Native Electron: `orphaned comments stay card-local and block send without a relink flow`（异常失联只显示卡片删除重建建议，发送聚焦首条且不创建 Request） |
  | update/Settings | Native Electron: `automatic update actions keep the sidebar product geometry and split About from Settings`（update badge、About/restart dialog 与 Settings lifecycle）；Node/Preload owners 继续覆盖 update protocol |
  | rapid switch/close | `tests/e2e/electron/electron-project-lifecycle.spec.mjs` |
  | workbench tabs / Start / Registry restore | `tests/e2e/electron/electron-workbench-tabs.spec.mjs` |

  叶子 owner 收敛后，下列重复 oracle 已删除。每行删除都保留：故障注入时主
  oracle 仍失败、至少一条 Browser/Electron/AI canary 证明产品接线、Ready 完整
  矩阵仍覆盖平台边界。未删除 IME/Selection、CAS/原子写、未知结局对账、
  Candidate/Version/Request 权威、IPC/路径/打包闭包，以及各能力至少一条真实
  循环 canary。

  | 已删除重复 oracle | 主 oracle | Canary |
  | --- | --- | --- |
  | `canvas-pointer-capability` 扫描 `HtmlCanvasEditor` / 引导文案 / hover 源码形状 | `canvasPointerCapabilityFromProof`、`moduleHasSubstance`、`native-edit-capability.test.mjs`；architecture 禁止 pointer 层引用 `isNativeDirectEditRoot` | Browser hover/padding/dedicated-surface；Electron V2 island |
  | Browser hover caption 右缘与窄画布几何 | `html-canvas-capability-hover.test.mjs` 的 `placeCanvasHoverHint` | 保留 hugs-copy 与 widen-restore 作为 CSS 接线 |
  | `review-text-evidence-marks` 扫描 serialize/文档冻结合同 | `reviewTextEvidenceStyleViolations` 与标记几何 Node 测试 | Electron `review-annotation-clarity`、AI review-adoption |
- 完整 HTML 持久化性能决策：`npm run benchmark:persistence` 只构建一次
  renderer，并在同一机器、同一 frozen main 与固定的 0.5/1.25/2.5MiB
  synthetic HTML 上串行运行。它必须同时保留 external-write conflict、
  restart recovery 与 exact-byte oracle；restart recovery 不仅验证磁盘
  字节，也必须重新打开已注册 workspace 并验证项目/文档身份、Hash 和
  persisted revision；并报告样本数、p50/p95/max、
  request/response bytes、renderer/Bridge RSS、renderer rAF gap 和明确的
  `skip-12` 或 `authorize-12-pr1` 决策；不同 SHA、并行负载或旧诊断样本
  不得混合。

- 完整 HTML 工作流性能诊断：`npm run benchmark:html-workflows` 的默认
  `--app` 指向打包 Developer Preview，默认 `--html-dir` 指向本机测试 HTML
  目录。不得用默认参数把旧安装版结果当作当前分支证据。本轮编辑链路对照
  优先使用精确 HEAD 的 Electron 测试入口；若使用该打包基准，必须显式传入
  `--app`、`--html-dir`、`--commit` 和 `--label`，绑定本次构建与合成样本。
  命令 `npm run benchmark:html-workflows -- --app
  <Developer Preview.app> --html-dir <真实 HTML 目录> --output <隔离输出目录>
  --commit <精确 SHA> --label <样本标签>` 串行测量打开、编辑、Preview、
  最多 20 标签切换、Review、采纳和采纳后再打开。它必须使用新打包 App、
  隔离 userData 和源文件字节级副本，并在结束时重新计算每个原文件 SHA。
  HTML 正文出现、受支持图表真实绘制、Project hydration、Canvas authority
  和整页稳定是不同完成边界；不得用 `readyState`、PageRoot ready 或静态
  iframe 代替图表完成。结果保留 Desktop 启动 mark、同一 hydration
  operation 的 Bridge/Repository 阶段计时、iframe churn、逐进程内存、
  长任务和最多 50 条错误样本。对比两个提交时必须在同一机器串行运行，
  使用同一 HTML 清单和相同测试顺序，不混入其他 PR。
  内存检查点至少保留 `launch`、`5-tabs`、`20-tabs-after-stress`、
  `review-dual-page`、`accept` 和 `post-accept-open`；每个检查点同时记录
  当前/峰值工作集、热画布与 Review iframe 资源、图表完整度、page error、
  console error 和 renderer crash。采纳后必须证明 Review workspace/iframe
  已卸载且五个热 Edit Canvas 的资源预算仍未收缩。
  除其明确的 harness、报告与命令元数据外，任何受版本控制的运行时输入
  相对 `origin/main` 的变化都会在测量前拒绝；Electron autosave、dirty
  switch 与 dirty close 都必须按完整预期 HTML 字节比较，不能只验证 token
  存在。每个操作的 elapsed 必须在自身的持久化、目标 frame 或关闭事件完成时
  立即截取，不能混入后续 switch、close、监控停止或 byte oracle 的耗时。
  任务级跑正常闭环和一个硬失败代表场景；
  发布级覆盖复制失败、缺失 finalizer、非法 HTML、版本激活失败与终态
  返回/重开。正式 Electron 审阅用例必须证明默认“双页 + 全部变化”总览有精确证据与页边导航，
  但无边框、无 dim；变化聚焦与评论聚焦的全局偏好默认分别为 25% / 15%，工具栏不再有滑杆。
  `全部 / 文字 / 元素`、页面、导航、聚焦、页内运行态、滚动和缩放彼此独立，左右单页和
  双页均铺满 Canvas，并覆盖采纳和返回修改前的持久化边界。
  Node 直接覆盖精确字符范围、纯插入/删除镜像、完全重写 singleton 的兼容配对、
  重复多解不猜、超预算有界退化，以及 projection 只接受 `text/structure`，其
  结构子类为 `added/removed/moved/attribute/style/css-source/script-source`。真实 Electron 证明文字替换保留红色删除虚线与绿色逐字实点；
  真正新增/删除的 `li/tr/卡片/区块` 只显示一个最外层“新增元素 / 删除元素”框，
  内部元素和文字零重复；新增编号 `<br>` 行仍是文字事实；稳定 ID 的兄弟/跨父
  移动、普通属性、内联样式和 CSS/Script 源码变化进入元素事实，纯换行及
  Canvas/SVG Runtime 绘制仍为零变化。Node 必须分别覆盖事实、几何与 paint plan：总览只启用
  `evidenceMarks/navigationCues`；文字聚焦启用一个局部 mask 但 outline 恒为空；来源明确的新增、删除、
  移动可以有一个局部 outline；style 只有当前 region 自己的纯样式 Stable host 得到 `changed` 视觉结论才有 outline，
  另一 region 的 `changed` 不能外借，混合文字/属性证据、`unchanged/unverified` 均无；
  每侧至多一个 mask hole 和一个 outline。两个远距离段落是两个 focus group，点击各自位置后必须揭示
  并滚动到对应段落，但不得出现文字框。同一 CSS 规则可以共享 group，却按阅读局部与 owner 保留精确
  region；页边可聚合为密度提示，目录仍列出带内容线索的全部位置，任何命中数量都不得提升成父容器框。相同 inline
  delta 即使同父级也必须是不同 group。Node 继续覆盖 `displayScope`/`geometryMode` 分离、change-scoped
  atom key、group/region/payload 上限和重复 ID 拒绝；Browser 必须证明 257-group 或畸形 plan 只关闭
  mask/outline 而不删除精确红绿证据、multi-host atom 合法聚合、parser-time decoy 与 live prototype
  篡改失败关闭；长 `tbody`、列表和 multi-screen section 必须保留完整 mask 与导航但无巨型 outline，也不能裁成视口框。
  Electron 必须覆盖首次自动定位收到可定位回执后才提交、不聚焦、失败顺延及用户输入取消；短目标居中、长目标展示开头；
  目录选择原子写入 group 与两侧 region、关闭后焦点回到 summary、目录先消费 Escape、再次点击保持激活、
  Escape/手动滚出/手动换 Tab 返回总览、筛选不激活、单侧新增/删除另一侧无 mask/scroll、评论态优先并
  在点击、移出或 Escape 后恢复变化 focus，marker 到自适应气泡可连续 hover，以及每个文档标签分别恢复页面、筛选、focus、Tab/折叠、双页滚动、横向位置
  与缩放。顶栏“刷新本页面”必须在同一 Review 身份下恢复这些状态；“从磁盘重新载入 HTML”在待决定
  Review 中可见但禁用。50%–200% 缩放、resize 与字体变化后，前后页保持同一 group/region；mask 与
  可选 outline 各自遵守每侧一个的预算，outline 存在时才与 mask 复用 canonical path。
  评论、Tab、同步/独立滚动、缩放和采纳闭环继续运行。真实 Electron 像素
  oracle 还必须在同一侧比较总览/聚焦的稳定作者元素：mask 孔内像素基本不变，
  孔外明显接近白色，并在密集文字、表格、长页面和复杂背景截图中直接确认边框数量与局部性；即使作者 CSS 全局设置
  `filter`/`backdrop-filter`/`mix-blend-mode !important`，Review 自有 mask
  primitive 仍不得被污染。DOM path、属性或 computed style 不能单独证明最终
  遮罩或边框正确。
- 审阅滚动回归必须直接证明页面概览会递增手势代次、取消待执行跟随帧并保留语义映射；评论布局契约还必须接受超出 100,000px 的有限长文档坐标，同时继续拒绝非有限值和超过安全上限的坐标。
- 评论标记必须覆盖无 `id`、`data-*`、`name`、`aria-label` 的 class-only 普通目标；私有绑定、评论正文和 locator map 不进入 authored HTML 或后续 bootstrap，恶意作者 listener 不能抢先伪造评论端口。
- 应用更新：Node 用伪 updater 证明 stable-only、点击后单次下载、差分开启、普通退出不安装、仅 downloaded 状态可安装和错误降级；Preload/Workbench 合同证明状态快照、下载/安装意图、无 Canvas 完成横幅与重启确认保持窄边界。
- 本地外部动作：Finder、默认浏览器和项目文件外部动作由 Node 以真实调用计数证明一次用户意图只执行一次副作用，失败会保留可见错误和可用项目，等待超过旧 retry delay 也不会重放；第二次调用只能来自新的用户意图。Bridge 的只读 GET/HEAD 重试保留在 transport 层，`openFolder` 等命令不复用它。默认浏览器打开还直接执行主进程操作与 sender 权限门，证明 malformed、非 HTML、未知项目、非普通文件和非可信 frame 均不会调用 shell；Workbench 合同只补充证明精确 edit revision 的围栏、写回和 IPC 顺序。
- 使用数据：Node 使用伪网络端点证明安装 ID 持久、会话 ID 轮换、
  项目 ID 只以 HMAC 假名出现、编辑聚合、队列上限和失败重试。负向样本
  必须同时注入 HTML、评论、Prompt、附件名、文件路径和原始异常，最终
  批次及本地队列都不得出现这些值；测试永不访问真实 PostHog。
- 开发者测试包：先证明正式 tag 后的提交序号被确定性映射为独立测试版本（例如 `0.9.5` 后依次为 `0.9.69991`、`0.9.69992`），再对独立名称/Bundle ID 的 Developer ID `.app` 做 app.asar、Bridge、Schema、资源、运行目录标识、版本和 DMG 静态校验，并从真实可执行文件做一次应用名/版本/首窗/Bridge/Workbench/正常退出冒烟；验证首次启动只创建新的 Preview 根目录且不读取旧 PageRoot 根目录，连续安装仍复用新根目录，Preview 更新检查/安装保持关闭；最后把 DMG Hash、tag-to-commit 范围、全部关联 PR 的实时状态/一句话摘要及无 PR 直接提交写入 JSON/Markdown 交付报告。GitHub 元数据缺失时交付失败，但不把可变 PR 状态嵌入 App 或正式字节凭证。
- 发布 dry-run：只在相关 PR 路径变化时运行。第一台 macOS runner 用固定合成 PostHog 项目 token 生成启用态 telemetry metadata，同时从唯一 stable GitHub publish 契约生成 `app-update.yml`，与 build metadata 一起装入显式未签名（`identity=null`）App，复用正式 verifier 检查 app.asar、Bridge、Schema、资源、更新通道和身份字段，并创建 `releaseEligible: false` 的独立 checkpoint。第二台 clean runner 验证 archive/payload Hash、原样恢复 metadata、重建 `dist-desktop` renderer oracle、再次复用正式 verifier，再从真实可执行文件核对 `app.getName()`、版本和 `CFBundleIdentifier`。workflow 不引用 `secrets.*`，dry-run kind/目录/文件名均不能被正式 signed-App restore 接受。
- 候选包：先在签名前生成 stable `app-update.yml`，并对 ad-hoc `.app` 校验 app.asar、Bridge、Schema、资源闭包、更新通道，再从真实可执行文件运行完整源码字节 oracle；通过后才做 Developer ID 签名，并在 Apple 请求前做一次 Hardened Runtime 启动。App 公证后冻结包含更新配置的 archive/payload/Tree Hash checkpoint，下一 job 只把同一 App 作为 `--prepackaged` 输入生成 DMG、ZIP、blockmap 和 `latest-mac.yml`，再校验 Team、App/DMG 公证票据、Gatekeeper、只读挂载与 ZIP 解包内容。
  新 job 会先从 checkpoint App 原样恢复 build-info、遥测与应用更新配置作为比较输入，
  再从同一源码 Tree 重建确定性的 Electron renderer 作为 payload oracle；
  不得重新生成遥测或应用更新配置，也不得重新组装、签名、公证或替换 checkpoint App。
  最终 DMG 通过后另生成实时安装包内容报告；发布阶段对下载的同一 DMG
  刷新 PR 状态，报告不参与冻结字节 Hash，避免可变协作状态污染不可变候选。

持久状态只保留四个跨层不变量：过期 revision 自动读取权威草稿并 rebase、结果未知时按 operation ID 查询、已确认的相同聚合 drain 为 no-op、草稿文件领先 runtime pointer 最多只允许一个已校验的崩溃窗口。纯函数和 Session 是主证明，Bridge 只证明持久边界；候选包把四者压缩为一个真实 App 冒烟，不在 Browser、Electron 和打包层各复制整套排列。

评论虚拟化的数量算法由 Node 使用 100 条确定性记录验证；Browser 只创建 `threshold + 1` 条跨过真实渲染边界，再新增一条证明交互仍接通。不得用上百次重复 UI 创建来充当测试数据生成器，也不得为了注入测试数据给产品增加测试专用接口。

评论栏纵向布局由 Node 对全局优先级、页面位置、同目标顺序、实测高度、
固定间距、原位文字编辑期间的坐标冻结和顶部栏安全起点做确定性验证；
Browser 验证真实 DOM 中保存卡片、草稿卡片和输入框在当前/其他标签页
切换、聚焦和展开后的相对顺序、无重叠结果，以及输入框自动聚焦、
`Enter` 保存、`Shift + Enter` 换行。

顶层 Node 测试在一次执行中只出现一次。精确影响映射优先；只有找不到任何精确用例时才启用 `node-core` 兜底。PR CI 在 Linux 构建一次 Web renderer，供 Node 和 Browser 共享；共享产物名称绑定唯一 `run_id` 而不绑定 `run_attempt`，并保留 30 天，因此同一 workflow run 只重跑失败 job 时可以复用已通过的构建。若 `source-build` 本身重跑，则以相同名称覆盖同一 run 的旧产物。每个 macOS Electron job 在目标系统本地构建 renderer，并先用独立 preflight 证明窗口可见、计时器和 animation frame 正常推进。Native Electron 与 AI 闭环分成两个 job，Browser 保持每个分片单 worker、零重试，但跨三个独立分片并发。测试直接提交隐藏文件 input 时不会经过真实“打开”动作的 pre-picker switch fence；共享 fixture driver 只允许在旧画布仍为 render-verified、input 仍 attached 时有限重提，不能重跑整条用例或掩盖加载后的产品断言失败。

关键 CI 命令通过 `scripts/ci-evidence.mjs` 记录 commit、Tree、job、耗时、退出状态、标准化失败摘要与稳定签名。环境 preflight 失败可直接归类为 `ci_environment`；源码测试失败先标 `needs_triage`，再依据独立 oracle 归为 `product`、`test_script` 或 `ci_environment`。同一 SHA 的环境嫌疑只重跑失败 job；正式流程第二 job 失败时保留并复用第一 job 的签名 App checkpoint，不重新做已通过的构建、运行、签名和 App 公证。相同签名连续两次失败且本地不复现时冻结候选并登记 CI incident。完整规则见 `docs/RELEASE_PIPELINE_GOVERNANCE.md`。
`tests/ci-evidence.test.mjs` 会枚举源码、开发预览、候选与发布工作流实际使用的
每个 evidence stage；任何未同步到允许列表的名称必须在源码门禁中失败，不能等到
正式候选打包才暴露。

`npm run ci:health` 可本地或手动汇总最近 `ci.yml` 的结论与重试恢复 job。
它不是定时 workflow，也不是合并门禁。报告写在 `output/ci-health/`。

## 判断标准优先级

1. 原始 Buffer、SHA-256、forward/inverse Patch、磁盘重读结果。
2. 明确状态机字段、revision、协议 Schema、失败码和文件清单。
3. DOM 身份、Selection、caret、几何、scroll 和布局指纹。
4. 截图、trace 和视频只作为失败诊断物，不要求真人看图后决定通过。

`tests/generated-source-invariants.test.mjs` 用固定种子生成 BOM、LF/CRLF、单双引号、多语言 Unicode、entity、注释和脚本文本组合。每个失败都带 seed；测试用独立字节替换 oracle 验证未命中范围、inverse 原子恢复和同一计划重放，而不是复用被测实现计算期望值。

画布撤销/重做不得使用 Chromium DOM history，也不得维护整页 HTML
快照栈。每次被接受的编辑把实际 forward Patch、exact inverse
Patch、前后 Hash 和目标写入当前打开文档的内存 `SourceHistorySession`
（最多 20 条）；Node 证明文字、样式、结构和
排序共享一个严格 cursor，新修改截断 redo，篡改或不连续 Hash
fail-closed。Bridge 故障注入分别覆盖 source commit point 前后的
HTML/历史联合恢复，以及稳定 action ID 的结果未知重放。

Native Electron 是最终交互 oracle：真实 Edit 菜单和快捷键依次执行文字、
工具栏样式、岛内换行结构和同级下移，关闭重开后仍能撤销，并以原始
Buffer 验证每次 undo/redo。焦点在评论正文或 `PROJECT.md` 时，同一个
Edit 菜单必须只触发原生控件文字撤销，源 HTML、评论卡片与附件保持
不变。文字撤销还必须证明 canonical 采用后焦点、逻辑 Selection 和评论
TargetRef 仍落在原源码宿主；可证明的岛内快速路径逐帧保持同一个 iframe、
`render-verified`、可见性和共享滚动位置，评论位置不消失、不掉底且不产生
伪 orphan。`PROJECT.md` 覆盖 composition 中的局部撤销，以及显式还原后从
已废弃输入节点迟到的 input/compositionend；两者都不得留下中间拼音。
Browser 测试继续证明 SourcePatch forward/inverse 和各编辑入口，但不把
无持久权限的浏览器预览伪装成跨重启历史证明。

## 真实 HTML 与输入法边界

长期要求：涉及编辑、格式化、选择、历史、页面切换、Runtime/iframe、加载恢复或保存重开的相关改动，必须在真实 Electron App 中使用用户指定的本地 HTML 语料进行验收；通用编辑或 Runtime 生命周期变更覆盖语料目录内全部 HTML。语料路径由本地工作区规则或环境配置提供，不写入公共仓库。此要求适用于以后所有相关任务，不只某次问题修复。合成物料仅用于可公开的确定性测试与边界覆盖，不能替代真实文档验收。

`PAGEROOT_REAL_HTML_DIR` 指向该语料目录后，运行 `npm run test:real-html:electron`；缺少目录或空目录直接失败，完整结果与截图写入系统临时目录，不进入 Git。该入口对每个文件至少选取页面上、中、下部且尽量不同标签的多个真实编辑宿主，使用鼠标/键盘输入执行段首、段尾、连续空格、删除/撤销重做、连续加粗/斜体/下划线、元素复制与删除。普通文字/格式轮次还必须跨越保存、结束编辑、清除选中和等待，逐个确认 Document token、iframe generation 和既有待刷新状态未变，且没有候选页。同时覆盖文档内可见页签、预览/编辑切换、完整来源重载、保存后重开及变更后的持续可编辑性。文档特有图表等行为仍需按本次改动追加场景。

原件只读，测试必须使用独立项目、用户数据目录和 HTML 副本，并核对原件 Hash。相关场景包含连续格式化、继续输入、撤销重做、切换页面、重新加载、保存后重开；绑定被测源码版本，分别记录计划、执行、通过、失败、跳过和未覆盖项。外部语料缺失时报告验收未完成，不回退到简单自造页面并宣称通过。私人 HTML、路径、截图和日志仅留本机；CI 的合成测试通过不等同于本地真实文档验收通过。


`npm run test:real-html` 默认使用仓库内复杂 HTML 物料，自动发现一个可编辑岛和一个明确降级根，并验证几何、岛外字节与磁盘不变量。用 `PAGEROOT_REAL_HTML_PATH` 覆盖真实文件时，还会自动发现所有当前可见且通过 V2 capability 的唯一编辑宿主，对每个宿主执行段首、段中、段尾输入/删除、换行/删除换行及已有末尾 grapheme 删除/恢复，并单独复测页头品牌、Hero 长段落末尾、按钮式链接边界和模块说明末尾。门禁附加机器可读的宿主数、成功/失败操作数和逐宿主结果。

原文件不会被写入。真实页只要求 DOM 已进入可交互状态，不等待可能被外部字体或媒体永久拖住的整页 `load`；进入编辑前必须连续取得稳定的目标、文字、可见源码节点和文档尺寸几何快照。

合成 V2 矩阵必须覆盖段首/段中/段尾、非空行内样式交界、注释和文字两侧的不可变原子；代表宿主至少包括标题、段落、列表项、链接、按钮、表格单元格、`pre/code` 和竖排文字。独立 oracle 检查岛外字节完全不变、岛内结果等于受约束的最小规范化、既有语义/注释/原子未改变。IME 用例冻结输入前 Selection，并证明最终候选只在该锚点插入一次。

当前自动化能证明 Chromium/Electron composition 事件序列、Apple 拼音临时 wrapper 轨迹、取消/迟到事件、持久化和 canonical reconcile。它不能诚实证明第三方 macOS 输入法候选窗本身。该能力在出现可无人值守、可复现并有机器 oracle 的 OS 级驱动前只登记为覆盖边界，不设人工门禁，也不伪装成已自动验证。

## 证据与新增测试准入

每次门禁写入 `output/test-runs/<run-id>/selection.json` 和 `results.json`，记录 HEAD、工作区内容 Hash、改动文件、选择原因、命令、耗时和首个失败。Playwright 的失败截图、trace、视频和 HTML report 继续位于 `output/playwright/`。

新增测试至少要回答四件事：对应哪个真实故障；使用哪个独立 oracle；属于哪个门禁层；是否已经被更低成本测试覆盖。不能给出明确答案的重复排列或纯“代码里存在某个字符串”测试，不应加入常规门禁。

### 第一批版本展示快速回归

复用 Electron 合成项目及现有 Playwright 配置：
`npx playwright test --config tests/e2e/electron/playwright.smoke.config.mjs --grep @smoke-version-display`
以及 `npx playwright test --config tests/e2e/electron/playwright.ai-smoke.config.mjs --grep @smoke-version-display`。
两个既有配置分别负责原生界面和 AI 场景，可加 `--repeat-each 2` 验证重复执行。
固定覆盖有继承分支的 V1…V3 顺序、后台历史打开、返回当前、跨项目切换、键盘打开，
同时断言左侧选中、标签标题、工具栏历史/审阅标识与编辑权限。
该组同时保留原有 project-lifecycle / review 标签，进入对应交付门禁。
纯函数测试不能替代这组真实 Electron 证据。
