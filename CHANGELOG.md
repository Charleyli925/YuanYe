# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

- 普通保存完成且恢复目录删除已持久化后，退役对应恢复事务；无法证明持久化时继续保留，历史版本和采用回执不参与清理。

- 修复中文组词、内部文字恢复与历史操作后格式化节点失去编辑能力的问题，保留对页面脚本伪造节点的保护。
- 修复含模板内容的复杂 HTML 格式化时不必要的画布重建；重新载入成功提示现在核对可编辑状态，静态恢复解除旧只读降级。
- 修复撤销换页后键盘焦点留在旧 iframe 导致重做无响应；同内容重新加载等待新画面完成，不再取消正在恢复的图表。
- 连续撤销/重做按用户操作顺序处理，后到的重做不再被正在保存的撤销吞掉；切换文件或出现独立编辑后不重放旧请求。
- 格式按钮只统计实际选中的字符；已是相同格式的有效请求保持编辑会话，不再让文字退出编辑。
- 撤销重做后的页面可继续编辑，不再因后台等待保存回执而拒绝格式修改；等待中的旧撤销不会覆盖后来输入的内容。
- 统一顶部通知样式，移除可编辑静态页面的常驻黄色提示；增加全目录真实 HTML Electron 验收入口。

- 应用图标换成新的紫色 S 品牌标：Dock、Finder 和安装包使用同一份图标，favicon 与应用内品牌图同步更新。
- 项目重启、重挂载后不再因为设备号或文件编号变化而不可用。工作副本使用稳定项目身份、内容校验和隐藏文件绑定恢复位置；旧项目自动迁移，不改 HTML、不新增版本。文件缺失、外部变化和重复身份只影响对应项目，侧栏仍可浏览版本；原文件仍在隐藏绑定中时可恢复到登记位置。保存和 Promotion 的中断恢复也使用同一套内容证据。
- 连续编辑遇到上次保存正在清理恢复日志时，新内容会继续自动写入，不再停在等待保存；动态内容降级到静态页面后仍保持相同行为。

- 设置页的 AI 服务列出内置 AI、Qoder 和 Codex 三行，可以全部收起；浏览或展开某行不改变默认服务。展开区不再重复服务名称。API Key 使用“连接 / 更换 API Key”，官方账号认证才叫登录。更多菜单区分断开（保留凭据）和移除 API Key。断开或移除会停止该服务相关任务；确认区显示处理中，失败不会报成功，断开后仍可移除已记住的 Key。记住 API Key 失败时保持连接表单，标明仅本次可用；Custom 会一并记住 Model ID。侧栏可选择服务并原位打开同一接入面板；接通后才把该服务设为默认，设置页接通备用服务不会改默认。Key 失效直达更换表单，修复后按新执行身份重新发送，不会对另一文件误发。断开的默认服务不会被静默换成另一家。普通设置页不再套用模态 Tab 循环。 Candidate / source-gate 会列出 DeepSeek、Qoder、Codex 的真实协议未验收项，CI 绿色不能当成供应商已验收。
- 正式安装包可直接选择 DeepSeek 默认模型，无需 Beta 开关。源页连接表单默认只填 API Key，验证成功后才替换当前连接；可选“记住 API Key”使用系统安全存储，失败不明文降级。
- 源页可作为默认 AI 服务并在重启后恢复；无效的本机 Qoder CLI 不再挡住健康的受管安装；Codex 按锁定 ACP 契约读取 `modelId`，不再把显示名当成机器 ID，也无法识别的目录不会伪装成 `codex:default`。安装取消完成后可以再次安装，不会停在“正在取消”。
- AI 服务的安装、登录等待和显式断开共用同一份接入状态：设置页与诊断看到相同的操作代次；关闭面板再打开会恢复进行中的安装；显式断开后后台扫描不会自动重新启用。
- Qoder 与 Codex 的登录改走官方 CLI，由主进程打开允许名单内的 https 登录页；新用户不必复制命令。登录身份由后台独占，授权成功后动作会正常结束，不会把诊断就绪误判成过期。打不开时可以重新打开登录页。cli-login / ChatGPT 账号可退出后重新登录；环境变量凭据会标明来源，应用不会宣称已注销全局 Token。
- Agent 设置页现在只做无副作用、selection-keyed 的四项连接诊断，正式发送时才预检并冻结模型配置；Custom 接口不再假设存在 `/models`，Codex 诊断会验证 ACP 协议。受管安装期间可直接取消。DeepSeek 改为 SSE 增量接收，HTTP 与 ACP 都只在连续 45 分钟无有效协议数据时中断；运行区只显示等待时间、已接收大小和当前可执行操作。Agent 失败会立即替换“处理中”，并将技术重试安全性与认证、模型、厂商、限流或安装恢复动作分开，不生成半成品 Candidate；历史对话按日期与轮次分组。
- 源 HTML 写入失败不再锁死整个工作台。源页独立跟踪磁盘已确认 Hash、当前工作 HTML Hash、Canvas Hash 和保护 Hash；只有后三者精确一致才放行可逆导航，`failed/conflict` 和原文件 Hash 保持真实。Main 恢复日志支持同文档路径 CAS rebase、Main/local 合并恢复、单 in-flight + latest pending 写入合并、成功保存后 CAS 退役，并在目录不可用或单记录损坏时降级而不阻止启动。得到精确恢复或导出凭证后可切换标签、关闭文档和退出；活动标签先保护再关闭，标签布局 best-effort，桌面关闭最多自动重试一次并释放精确冻结。失败横幅占用工作区自身布局，可展开和复制诊断。本项不把 Draft、`PROJECT.md`、附件或 AI 不可逆提交重分类为 HTML 保护凭证。
- 多个 HTML 标签现在会保留受内存预算约束的只读页面缓存：最近页面可先显示、再在后台核对最新源文件，切换时不再反复空白重载。AI 候选就绪后会预热审阅；未命中缓存时也先显示修改前后页面，再补变化标注。采纳后在新版本安全提交时立即回到新 HTML，最终编辑画布与项目资料继续后台准备。
- 工作台改为统一的浏览器式外壳：全局项目侧栏占据产品完整左侧并可从系统红黄绿按钮旁
  收起或展开；标签页、模式切换、审阅工具、项目、文件夹/默认浏览器动作与 AI 入口对齐在
  两条紧凑顶栏中。新标签页去掉白色卡片并优先“查看现有项目”，文件标题、HTML 品牌块和
  打开“+”不再重复占用工具栏；审阅工具在编辑/预览时原位禁用，进入审阅后原位启用。
- AI 审阅聚焦到可准确解释的“文字”和“元素”两类变化。工具栏现在只有“全部 / 文字 / 元素”；元素新增与删除都只标最外层元素，整块新增或删除里的文字不再重复打点。
- 审阅现在以稳定源码 ID 可靠报告元素移动、属性、内联样式及 CSS/Script 源码变化；ID 被删除、替换或错误迁移时明确显示为删除加新增，移动子树仍会逐个识别后代文字及元素增删。CSS 最终影响、排版、换行和 Canvas/SVG 运行态视觉差异仍不推断；主进程截图、PNG/像素判定、Runtime DOM 对账和冻结图表脚本不会恢复。
- 现在能看到“更新了什么”。“关于源页”的更新卡常驻一条“查看更新内容”，无论
  当前是已是最新、发现新版本还是已下载待重启，都能直接打开该版本的更新说明；
  页面没有打开时在同一张卡下方说明原因。以前这个位置只能跳到仓库首页，
  用户无处得知一个版本修了什么。
- 正式 Release 的说明正文改为 `CHANGELOG.md` 中该版本的小节，不再是自动生成的
  英文 Pull Request 标题列表，并附上该 tag 上完整 CHANGELOG 的固定链接，跳版本
  升级的用户也能补齐中间的变更。缺少或空白的版本小节会在创建 tag 之前就中止
  发布，不会再发出一个没有可读说明的版本。

- Filename “打开本地HTML” and “在默认浏览器中打开” hover/focus hints now
  sit horizontally centered above their icons instead of the top-right.
- AI 审阅里，删除文字恢复为穿过原字的红色横虚线，新增文字在每个字下叠一层小绿点；两者都不再改作者颜色、字号或行距。绿点不再使用会撑开行高的 CSS 着重号。
- Canvas hover and click now share one pointer hit: pointing at child
  content selects that small target, pointing at a filled module's own
  padding or gap selects the module, and a completely empty module is not
  selectable. The hover pill sits inside the outlined hit box, so clicking
  that caption selects the advertised target. Deselect still uses Escape,
  the header, the comment-rail blank, and the page root. There is no
  Preview-mode hover state.
- 移除了首次打开本地 HTML 时出现的“快速开始”浮层；现有的画布 Hover 提示、直接编辑、
  评论与发送 AI 流程保持不变。

- Importing HTML no longer reports a failure for work that already succeeded. If
  the project Registry lock could not be cleaned up afterwards — for example
  because its coordination file was damaged by an external write — the import was
  reported as failed even though the project had been fully created, and the
  error text named the lock file instead of anything the user did. Cleanup
  failures are now silent and the leftover lock is reclaimed automatically.

- The exact-legacy-V4 project Registry migration and its dedicated lock are
  removed. The shape it migrated existed only on the development branch for
  about six hours and was never part of a released PageRoot, so no installed
  version can produce it. An unrecognized Registry now fails closed and keeps
  its exact bytes, which is the path every other unknown shape already took;
  managed HTML, Versions, Drafts, comments and attachments are untouched.

- A project Registry lock left behind by an interrupted PageRoot process no
  longer blocks importing HTML forever. Previously only one residue shape (a
  single intact owner marker naming a dead process) could be reclaimed, so a
  crash between creating the lock and writing its owner, a crash between the two
  retire renames, or a damaged owner file made “打开外部 HTML” fail permanently
  with no in-app recovery — restarting did not help. Any lock whose ownership
  cannot be resolved is now reclaimed automatically once it is older than a
  grace period, while a lock still owned by a live process is never reclaimed.
  The busy message no longer claims that another PageRoot process is running.
- Preview sessions now refresh in place for the same Edit sibling-asset
  source path, and a full session map evicts the least-recently-accessed idle
  session instead of the oldest insert. Repeated saves and Preview toggles
  keep the live Edit/Preview resource base instead of dropping it after eight
  sessions.
- Browser encoding-error “重新选择” now reopens the HTML picker in the same
  click, then switches to the next UTF-8 HTML. The current page is not drained
  before the chooser appears, so the hidden file input keeps the user gesture
  Chromium requires. In-memory HTML now records its Hash so the next file can
  pass the canvas switch fence.
- Opening an unbound local HTML now asks before importing. A registered v4
  project still opens directly. Re-opening the same retained original returns
  to that project's current local edit with a short “already imported”
  confirmation, never a second project. First import copies into PageRoot,
  keeps the original by default, and only moves it to Trash after the new
  Canvas is verified. Sibling images, CSS and scripts stay beside the original
  and continue to load in Preview and Edit from that directory. The previous
  silent import toast is gone. If the file changes while the confirmation is
  open, import is refused with “文件在确认期间被修改，没有导入.”
- Finder 在同一受管项目目录内改名当前打开的 Working Copy 或同父目录的项目文件夹后，PageRoot 会按稳定身份自动同步新路径，并允许立刻在顶栏继续改名。顶栏先改名时也会把受管 OpenTarget 带到新路径，因此随后的 Finder 改名仍能重绑；若顶栏输入还没改、Finder 已改名，则采用 Finder 已确认的名称。重命名不创建 Project、Document、Working Copy 或 Version；跨磁盘、副本和多候选仍失败关闭。顶栏真实失败后不再强制聚焦，避免无法退出编辑。macOS 上 `/var` 与 `/private/var` 视为同一活动路径，NFC 与大小写折叠后的同一文件也不会丢掉身份；进程被杀掉后仍可从已同步路径恢复。项目目录里 `PROJECT.md` 等旁路写入只核对当前 HTML，不会把未还原的规则修改提前保存。
- Fixed the edit Canvas shaking continuously at window widths where the source
  iframe would gain or lose a vertical scrollbar. The shared page scroll stage
  now owns page-level vertical scrolling, while Canvas measures fractional
  natural content height before rounding so a sub-pixel overflow cannot reopen
  the scrollbar feedback loop. Nested authored scroll containers are unchanged.
- New projects now start with an empty `PROJECT.md` instead of generic preset
  sentences. Generated AI handoffs keep stable scope, file and completion
  boundaries in `AI_RULES.md`, while `PROMPT.md` contains only current-run
  identity, paths, attachments and commands, removing duplicated instructions.
- Simplified AI review text highlighting into two independent layers. Exact
  deletions now retain character-level red dashed strike-throughs, exact
  additions use one solid green dot below each added character, and both sides
  share a low-emphasis purple scope frame. Layout alone promotes phrase frames
  to one clean line rectangle at three changed phrase groups or 60% evidence
  span, then to one paragraph rectangle when at least 75% of three or more
  visual lines are promoted. The scope frame and dim-mask hole share identical
  geometry and always contain the character evidence; the former density,
  stable-sentence and shaped-outline decisions have been removed.
- Fixed formal macOS packages omitting the signed `app-update.yml` provider
  configuration, which made every update check appear unavailable even when
  GitHub Release metadata was healthy. Candidate assembly now generates the
  stable channel before signing, includes it in the signed-App checkpoint, and
  rejects missing or drifted provider/cache settings in both dry-run and final
  artifact verification. Existing 0.9.8 installations need one final manual
  update to a patched release before automatic updates can resume.

## [0.9.8] - 2026-08-11

- Fixed a Draft revision-reconciliation feedback loop that could issue a
  second aggregate write after a successful rebase and drop an acknowledged
  direct-edit event. Mutable Draft events now use their dedicated compatibility
  ingress and capture synchronous Version authority when assigned; rebased
  comments, edit events and deletion tombstones advance exactly one Draft
  revision and remain intact after restart.
- AI Attempt 输出现在保留用户原始文件名并附加系统分配的 `V1.x` 后缀，例如
  `市场概览-V1.9.html`。Prompt 明确给出每轮唯一的绝对输出路径，AI 不再把
  冻结输入的 `index.html` 误当成输出文件名；已冻结的旧 Attempt 仍可按原
  `output/index.html` 合同完成。
- Add a credential-free Release Dry Run for Pull Requests that change packaging,
  release metadata, Electron or packaged Bridge paths. Two independent macOS
  jobs now assemble and checkpoint an explicitly unsigned non-release App, then restore it in
  a clean checkout, rebuild the renderer oracle, revalidate telemetry/build
  metadata and launch-check the product name, version and Bundle ID. The
  checkpoint is always `releaseEligible: false`, uses only a synthetic public
  telemetry token, and cannot enter the signed/notarized Candidate or
  publication lanes.
- Fixed formal AI review missing chart palette, data, or configuration changes
  when the changed script did not directly name the rendered chart host. A
  source-empty chart directly covered by a saved local comment target, plus
  pairable charts in the target's nearest multi-chart group (including when the
  target is a caption or heading beside the charts), is now compared before
  ordinary runtime candidates. Global comments, charts outside that group, and
  other un-commented regions retain the strict host-reference gate and bounded
  budget. Comment scope remains analyzer-only: scope attributes are removed
  before either review document is serialized. Every source-resolved local
  target is instead represented only in a private initial-bootstrap binding:
  an element path plus a narrow static fingerprint, never a temporary DOM
  attribute. The desktop preview session serves that binding only to the
  parser-blocking first bootstrap request, then replaces it with an unbound
  fallback for later author-initiated reads. The trusted review host delivers
  comment targets only to the before frame via a challenged private port.
  Comment bodies, comment keys, source-node IDs and locator maps never enter
  document bytes or a later fetchable bootstrap response. A unique source `id`,
  `data-*`, `name`, or `aria-label` locator is only a safe fallback when the
  private binding is unavailable—never a mutable sibling ordinal. Missing,
  ambiguous, replaced or disconnected targets, and unavailable private
  transport, omit the marker rather than guessing a neighboring element. The
  bootstrap consumes both private-channel challenges in its first capture
  listener, before authored capture listeners can observe or forge either port.
  When comment scope, rather than a direct changed-script
  reference, admits a host and its first before/after comparison differs,
  PageRoot now reloads the same isolated pair once and requires each side's
  fingerprint to match its own fresh run. One-shot `Math.random()`/`Date.now()`
  initialization, a failed replay, or a replay mismatch keeps the existing
  static result; directly causal hosts and comment-scoped hosts with no initial
  difference do not pay for the extra run.
- Hardened runtime-chart candidate binding so host keys, source-box baselines
  and element locators are never serialized as authored-page attributes. The
  parser-blocking first bootstrap response alone receives opaque private
  bindings; the managed preview immediately consumes it and serves only an
  unbound fallback source to later reads. It retains the exact element/key/
  baseline mapping only in closed runtime state. A stale path may resolve only
  to one matching private fingerprint; an ambiguity, replacement or
  disconnection invalidates the complete supplemental batch, so authored CSS
  or scripts cannot use candidate metadata to manufacture a visual difference.
  A confirmation pair receives fresh preview sessions so its own first
  bootstrap response can safely carry its one-shot bindings.

## [0.9.7] - 2026-08-07

- Let macOS applications such as Qoder Work offer PageRoot as an alternate
  HTML editor. Selecting it now opens the exact current `.html` or `.htm`
  source in PageRoot whether the app is closed or already running, while
  preserving the user's current edits before switching projects. Rapid external
  open requests and ordinary local project opens now share one durable order,
  cannot leave PageRoot displaying an older file after a newer request has
  become active, and keep the Canvas frozen while external activation is still
  in flight. A failed later external request now keeps the last successfully
  opened file visible and durable. A deferred external open now waits for an
  observed switch blocker to clear, or for an explicit retry, so Canvas
  recovery cannot create an automatic retry loop. Every already accepted local
  or external result now enters a renderer FIFO and re-fences immediately
  before it is published, so an older result cannot unlock the Canvas and let a
  later queued open discard a newer user edit. A delayed startup catch-up can
  no longer replace a newer live external-open request in the renderer. If a
  cold-start file has moved or cannot be read, PageRoot now shows a stable
  product error code and message instead of exposing the local path or raw
  filesystem exception. Closing, restarting, or installing an update now waits
  for an external HTML switch to finish safely instead of interrupting it,
  including when the current project is still loading or has a read error. A
  new external open that arrives mid-close now cancels the uncommitted close or
  is safely handed to the next launch after shutdown commits.
- Update the shared `js-yaml` dependency closure to 4.3.1, removing the
  high-severity parsing advisory without changing the packaged runtime shape.
- Bring the review-first AI workflow into the public README, built-in welcome
  project, About dialog and first-open guide. The new user-facing story shows
  before and after side by side, explains copy, structure and visual change
  labels in plain language, and makes clear that users choose which version to
  open after reviewing; no AI result silently replaces the current HTML.

## [0.9.6] - 2026-08-06

- Stop Canvas text undo/redo from blanking and jumping the page. Bridge-verified
  changes confined to the active editable island now adopt canonical children,
  source-node identities, caret and viewport in the existing iframe; any failed
  proof still falls back to a fresh verified frame.
- Make frozen user comments easier to discover in AI review with a larger,
  always-purple “评” marker and white label. The marker remains anchored to
  the original comment target, and hovering still opens the existing read-only
  comment-detail bubble.
- Separate exact AI-review copy evidence from the frame users read. Nearby
  fragments now form bounded phrase or line rectangles, tiny edits gain a
  line-local readable width, stable sentences stay separate, and dense
  multi-line rewrites become one smallest-owner “段落改写” frame instead of a
  jagged union outline. Each semantic group carries one label. Removed copy
  keeps its red dashed strike and red dashed frame; added copy keeps its green
  dashed frame without an underline or background treatment.
- Detect stable script-generated HTML, SVG and Canvas chart changes inside
  uniquely paired source-empty hosts during AI review. Existing static frames
  remain authoritative and are never duplicated. A changed script must directly
  reference the host's distinctive identity; sharing a section is insufficient.
  The owned first script binds its DOM, computed-style, Canvas, scheduling, and
  text-normalization/digest readers before authored code runs, then resolves only
  a complete exact host-key set declared by frozen
  source analysis and records which parser-created element first claimed each
  key. Unknown claims are ignored; a missing, duplicated, transferred or
  replaced declared host, or any capture fault, silently keeps the existing
  static review.
  The bounded capture includes the host's own painted box, fully transparent
  host state and directly mutated size as well as generated descendants. It
  prunes every zero-opacity host or descendant subtree, including SVG wrapper
  groups, so hidden child churn
  cannot become a false positive while a visible subtree becoming transparent
  remains a real change. It caches evidence across
  asymmetric slow frame loads, gives managed frames 1.5s to register, starts
  its unchanged 500ms comparison budget only after both review frames load, and
  ignores unpainted geometry, page-flow shifts,
  identical final output, animation, incomplete or late analysis. Accepted
  chart facts commit with the initial review projection rather than appearing
  after interaction. Runtime evidence is enabled only on the managed desktop
  preview transport. If authored code tries to replace that subframe before its
  first load completes, the main process blocks it and reloads the same volatile session once as a scriptless
  copy that retains only the owned bootstrap; review then keeps the
  authoritative static result without adding a notice. A managed-session
  failure or frame that never finishes loading takes the same bounded static
  path; late runtime evidence cannot reopen the decision. Inline/browser
  review is static-only.
- Stop treating AI-authored script changes as an adoption failure. Candidate
  assessment now checks document usability and coarse continuity only; retired
  executable-surface fields in historical records are verified, normalized out
  of current status, and never rewritten or exposed as a present-day warning.
  Genuine assessment read errors also show an accurate failure instead of
  being mislabeled as a timeout.
- Keep AI review text frames aligned to semantic punctuation and word ranges.
  Replacing “品均基本持平” with “单品效率整体稳定，增幅仅+0.10%” now
  marks the complete old and new phrases instead of treating their accidental
  shared “品” character as unchanged or splitting the green frame. Short Chinese
  replacements remain pairable, while distant edits in long punctuation-free
  copy no longer pull the unchanged text between them into one oversized frame.
- Make visual-review frames follow the element that owns the changed paint or
  layout. Whole-card background, border, radius, shadow, size and layout
  changes now keep one complete component frame and matching mask hole, while
  logical block sizing follows the same rule. Inherited copy styling now uses
  the rendered text ranges instead of its container box, and neighboring cards
  cannot merge merely because they are close together.
- Show script-generated Canvas, SVG/HTML charts and dynamic table bodies
  automatically in desktop Edit as one source-Hash-bound read-only bitmap
  projection. The bitmap remains pointer-transparent so comments target the
  original HTML host, while source save, review diff, versions and AI input
  continue to use the complete original HTML without PageRoot projection data.
- Give developer test packages a distinct `PageRoot Developer Preview` app
  identity and deterministic versions derived from the latest formal tag; for
  example, the first two committed previews after `0.9.5` are `0.9.69991` and
  `0.9.69992`, with the exact source commit appended to the full preview
  version so divergent branches cannot share an app or DMG identity.
- Require every formal or developer installer handoff to include an exact
  package-content report with artifact Hash, source range, all associated Pull
  Requests, their live status and one-line purpose, plus direct commits without
  a Pull Request.
- Treat an unqualified latest-package request as current `origin/main` plus all
  applicable, non-excluded PR heads; compose unmerged work on a temporary
  integration branch and keep any such installer Developer Preview-only.
- Update Next.js and its ESLint configuration to 16.3.0, and refresh compatible
  transitive build dependencies so the dependency audit has no active security
  exceptions.
- Keep the desktop workspace Bridge startup pending while macOS is waiting for
  Documents-folder authorization, then resume the same launch automatically
  once the service reports ready instead of showing a false 12-second timeout.
- Restrict desktop interactive preview to declared local assets, including
  assets reachable from inline CSS and module imports, and reject dotfiles,
  undeclared sibling files, escaping symlinks and `file:` resource bases.
- Preserve the AI-Agent cancellation warning after reopening a processing
  Request whose prior clipboard handoff can no longer be proven.
- Fixed project and generated-Version switching so project identity, source
  path, Version authority, HTML bytes and Hash publish together; edit/preview
  canvases now acknowledge the same generation, safe-save status cannot reuse
  stale content, and the “+” project picker automatically repairs one clean
  projection mismatch instead of silently doing nothing.
- Reconciled safe close against the exact frozen HTML bytes so stale Canvas
  Hash or revision projections no longer contradict a “Safely saved” status.
  Matching authoritative bytes now repair the projection silently; confirmed
  external divergence or invalid source integrity stays fail-closed with an
  in-app recovery path. Renderer-owned blockers return to that path without a
  duplicate macOS alert, while missing, timed-out or faulty close coordination
  still uses the native fallback.
- Replaced subtree-exact AI acceptance with a simpler candidate check: complete
  visible HTML is the content requirement, while coarse page continuity routes
  uncertain results into mandatory side-by-side review instead of falsely
  failing broad but valid edits.
- Localized terminal AI errors, fixed long error text overlapping the process
  timeline, reduced duplicate terminal actions to one “Return to editing”
  action, and added a restart-safe “Previous run” entry for reopening the last
  error or no-change outcome.
- Made AI results review-first: ready results now offer a highlighted
  side-by-side review and a secondary direct-open action, with full-page
  change filters, synchronized navigation, and a reversible return-before-AI
  confirmation before the same audited activation path is used.
- Rebuilt the formal AI review workspace around independent page, change
  filter, context visibility, navigation, page-runtime, scrolling and zoom
  state. Page and filter buttons now remain selected independently, map
  navigation no longer changes review display, and single- and dual-page views
  fill the available Canvas with only minimal framing gaps.
- Unified Canvas comments and formal review on one Tab-discovery contract,
  including explicit and strict indexed page controls. Review now coordinates
  both pages through one presentation epoch, removes stale frames immediately,
  keeps dimming continuous while different-height Tabs settle, and converges
  linked vertical scrolling instead of jumping. Every semantic change group
  carries one short label, and its final readable rectangles provide the mask
  holes without a separate dimming geometry. Frozen user comments also
  appear only on the before page as a persistent read-only “评” marker with a
  hover-only bubble.
- Reworked linked review scrolling around a single input owner and a cached,
  monotonic semantic map. The active page now keeps native scrolling and
  momentum while the follower applies only the newest target per frame;
  rapid reversals and side switches invalidate stale work, unequal page
  boundaries no longer pull the longer page to its end, and scroll events no
  longer rebuild overlays or remeasure comment targets. Page-overview jumps
  now invalidate the active gesture before returning both panes to the top,
  and bounded comment coordinates remain available in very long documents.
- Unified review frames and dimming on one typed change footprint. Copy uses
  leaf-level exact ranges and high-confidence pairing instead of tag/position
  guesses. Connected frames merge without crossing columns, contained ancestor
  frames are removed, and the context mask now punches transparent holes from
  those exact final rectangles so frame interiors remain clear. Added copy uses
  green frames, removed copy red, structure blue and visual changes purple;
  repeated short copy and inserted structures no longer create unrelated text
  or visual frames. Before/after controls now use paired stable identities and
  mirror Tabs, disclosures, buttons and form state in both directions even
  while scrolling is independent; unsupported matches degrade silently.
- Made review open directly on the first change in synchronized dual-page All
  mode with 18% context. Added copy keeps the page's authored styling and uses
  one merged dashed frame; removed copy keeps its deletion treatment, while the
  final frame rectangle—not incidental DOM ancestry—defines the fully clear
  region for each Copy/Structure/Visual projection.
  The content map opens to the right of its handle, distinguishes changed rows,
  and dismisses on outside interaction. Linked review now mirrors authored
  page actions and form state, not only Tabs. Return confirmation locates the
  exact candidate HTML, while acceptance keeps review covering the live editor
  until the candidate is rendered, eliminating the waiting-page flash.
- End Canvas selection and native text editing when the user clicks elsewhere
  in the page or App—including blank space in the top bar or comment rail—by
  committing the current checkpoint and removing the edit toolbar and selection
  together. Selection-bound toolbar, comment-card and composer actions remain
  stable long enough to complete their intended operation.
## [0.9.5] - 2026-07-31

- Run desktop interactive previews in a short-lived isolated document so
  authored scripts, relative assets, Tab controls, SVG, Canvas and dynamic
  tables work without weakening the PageRoot renderer CSP.
- Make “Edit” return to the source-backed Tab selected in preview while keeping
  the normal script-disabled editable-island canvas, source bytes and existing
  native-action interception authoritative.
- Keep script-rendered Canvas charts and dynamic table rows visible in Edit as
  bounded, non-editable projections without copying them into source HTML.
- Keep current-tab comments aligned with the Canvas, render Tab comment counts
  as the existing floating violet `评N` marker, and remove redundant current-Tab
  metadata from the comment header. Other-Tab comments now expand as neutral
  saved-comment cards inside that header. Unsaved comments now stay at their
  page position, use one persistent current-Tab shortcut or a tagged card in
  the appropriate other-Tab group, and keep stable document order through
  focus, expansion and Tab changes until explicitly saved or deleted.
- Keep comment-card geometry fixed while actions appear, strengthen the focused
  boundary, align an explicitly selected card by translating the unchanged
  queue, and route wheel input over the rail through the shared page before
  restoring comments hidden above the top edge. Dense comments are now clipped
  at the Canvas page bottom instead of stretching a short HTML page; continued
  wheel input at that bottom pulls the remaining queue into view.
- Treat saved-comment text and attachment edits as one recoverable transaction:
  unchanged edits cancel automatically on Tab changes, while changed but
  unconfirmed edits remain available from an “unsaved modification” shortcut.
- Allow direct text edits beside preserved nested lists and `<wbr>` boundaries
  while keeping those authored structures byte-safe and non-editable.
- Added a concise AI Agent warning before ending a copied run, restored editing
  with a clear manual-stop reminder, and made late official finalization return
  a non-retryable cancelled result without creating a new Version.
- Save an in-place filename edit when the user clicks blank title-bar space,
  matching the existing Enter and click-away behavior without changing file
  identity or version history.
- Let edit mode reveal source-backed Tab panels, including strict explicit-ID
  and constant-number indexed report Tabs, plus native details and local
  disclosure regions from the selection toolbar or Option-click, while links,
  forms, popups, drawers and authored scripts remain inert.
- Keep the HTML identity icon centered on the two-line file summary in all
  three no-update, `New!` and `New! 重启更新` states; the update label overlays
  the icon independently without shifting the title-bar layout.
- Added persistent, source-exact undo and redo for Canvas text, style, safe
  structure and sibling-order edits through the existing macOS Edit menu and
  keyboard shortcuts, including continuation after reopening a project.
- Kept comment, project-rule and other focused text inputs on their native
  field-local undo history without adding a Canvas toolbar action or extending
  product-level undo to cards, attachments and other project operations.
- Restored the active Canvas text host and caret without a visible intermediate
  reload, kept comment anchors stable through undo/redo, and prevented late
  Chinese-composition input from reappearing after project-rule restore.
- Simplified About PageRoot by removing redundant platform, license, telemetry
  and update-channel labels while preserving the current version, architecture,
  update action, repository link and local user notice.
- Made project identity ID-first across comments, attachments, history, AI
  handoff and rapid project switching; equivalent local paths are canonicalized,
  stale project callbacks and unrelated same-path replacements fail closed,
  project-rule saves retain complete identity, and internal identifiers or paths
  are no longer surfaced as user-facing recovery messages.
- Refactored Workbench state into explicit project, document, comment, history,
  version and AI-run sessions, extracted presentation and Canvas modules, and
  retired the unused V1 editing path while keeping the V2 source-patch contract.
- Added governed task worktree audit, synchronization and retirement commands
  so active changes remain visible and protected throughout parallel work, with
  merged retirement proof bound to the exact current branch head.
- Aligned developer-preview and formal-candidate CI evidence validation with
  their preflight, signing, notarization, checkpoint and final-artifact stages
  so packaging cannot stop because of an unsupported stage name.
- Rebuilt the deterministic renderer comparison input in the candidate's fresh
  final-artifact job before revalidating the restored notarized App, while
  keeping the signed checkpoint App immutable.
- Restored the exact embedded build provenance and telemetry configuration from
  that checkpoint before fresh-job payload verification, without regenerating
  configuration or exposing its project token to final packaging.

## [0.9.4] - 2026-07-29

- Increased the workbench header height and bottom breathing room so the
  two-line file summary and all primary actions remain inside the title bar.
- Added compact filename actions for opening another local HTML and opening
  the current known HTML in the system default browser, with small hover and
  keyboard-focus tooltips that do not change header geometry.
- Made default-browser launch wait for the exact current edit revision to be
  safely written, and added fail-closed executable coverage for malformed,
  unknown, unsafe and unauthorized launch requests.

## [0.9.3] - 2026-07-29

- Added an always-visible, bolder plus action beside the current filename that
  opens the local HTML picker through the existing safe project-switch flow,
  while keeping the rename pencil hover-only and independently clickable.

## [0.9.2] - 2026-07-29

- Reframed the first-run welcome project and bilingual GitHub homepage around
  agent-agnostic local handoff, with Claude Code, Codex, WorkBuddy, Qoder and
  other filesystem-capable AI agents presented as compatible choices.
- Added concise AI Agent collaboration positioning to About PageRoot, replaced
  its duplicate update-schedule footer with a fixed local user notice entry,
  and packaged the complete statement and disclaimer with the macOS app.
- Added default-on, pseudonymous product telemetry for module use, project
  flows, edits, saves, faults, notifications and interruptions, with a strict
  no-content allowlist, local batching and an in-product usage-data notice.
- Redesigned the four-stage Qoder handoff flow with aligned numbered cards,
  stage-specific icons and explicit status pills, while moving the divider-free
  footer actions closer to the content.

## [0.9.1] - 2026-07-28

- Upgrade complete 0.9.0 project records additively on first start while
  retaining their existing UUID directories and every historical artifact.
- Clarified generated AI handoff files with PageRoot branding, plain-language
  sections, explicit run identities and clearer default project rules while
  preserving the existing frozen JSON protocol.
- Increased saved-comment text and edit text to 14px, collapsed comment tools
  until hover, keyboard focus or editing, and simplified normal and editing
  cards to one boundary with a compact divider-free action row.
- Name project-record folders from the HTML filename, project creation time and
  a short identity suffix, while retaining the full `projectId` as internal
  metadata.
- Keep Finder's regular `.DS_Store` metadata inert inside live AI Attempt
  folders, and mark an AI return only after the mandatory completion signal
  has actually appeared.
- Added stable-only macOS update checks with user-started differential
  ZIP/blockmap downloads, a restart confirmation, and the existing safe editor
  drain before installation.
- Added four-hour update checks while the app remains open, plus a redesigned
  About PageRoot dialog with manual update checking and the official GitHub
  repository link.
- Kept update status to one right-aligned red italic `New!` label above the
  Qoder handoff button, with no Canvas completion banner, progress animation or
  extra header icon.
- Replaced ad-hoc distribution with fail-closed Developer ID signing, Hardened
  Runtime, Apple notarization and candidate verification of both DMG and updater
  assets while retaining the legacy manifest for one-time migration.
- Added safe in-place filename editing for the current HTML: double-click the
  saved title, edit only its stem, and keep the same file bytes, Project,
  Document and Version history through collision checks and crash recovery.

## [0.9.0] - 2026-07-28

- Promoted the editable-island editor from the isolated V2 comparison build to
  the official PageRoot application, installer and GitHub update channel.
- Replaced the production native-text state machine with one controlled editable
  island route: outside bytes stay exact, while the edited island may be
  minimally normalized for visual, semantic and structural safety.
- Added deterministic start/middle/end insertion, grapheme deletion, line
  breaks, plain-text paste, frozen-selection IME replay and left-style boundary
  inheritance across paragraphs, headings, links, buttons, lists, tables,
  preformatted text, vertical writing and immutable embedded atoms.
- Kept edit warnings visible at the application viewport while the HTML page is
  scrolled, and added exhaustive synthetic plus opt-in real-complex-page edit
  censuses with machine-readable success/failure reports.

## [0.8.10] - 2026-07-27

- Allow ordinary typing at editable paragraph starts and ends, inline-style boundaries and link boundaries while preserving the intended neighboring style and exact source whitespace.
- Prevent links and authored controls from navigating while they are being edited, and keep final visible punctuation deletion source-exact.
- Simplify the Canvas comment surface by removing duplicate global-target copy and user-facing undo/redo history.
- Keep dotted PageRoot versions intact in exported HTML filenames.
- Make stale comment-draft reconciliation plus clean close/reopen a mandatory packaged-App release proof, while replacing repeated high-volume UI setup with lower-cost invariant coverage.

## [0.8.9] - 2026-07-26

- Treat already acknowledged deletion tombstones as durable Bridge authority when comparing draft content, so unchanged close and restart drains no longer create redundant operation IDs or advance the draft revision.

## [0.8.8] - 2026-07-26

- Unified project, document, draft, run and close ownership behind typed application services so the renderer and Bridge can no longer advance different identities or revisions.
- Reconcile stale or uncertain comment-draft writes against the authoritative Bridge draft, preserve deletions with durable tombstones, and avoid creating a new draft revision when close or project switch only verifies unchanged content.
- Rebase stale draft operations with stable operation IDs, replay them exactly once, reject impossible revision jumps, and recover the one valid artifact-ahead crash window without resurrecting deleted comments.
- Route close, project switch, Request submission and history boundaries through one drain coordinator; Electron close now waits for the exact source and draft generations while browser `beforeunload` remains browser-only.
- Retain Bridge-unavailable recovery until the Workbench listener acknowledges readiness, then replay it after renderer reloads instead of losing the only recovery action.
- Keep the packaged `parse5`/`entities` runtime on one verified dependency version and reject nested or incomplete Bridge dependency closures before building an installer.
- Keep only one unsaved comment at a time, reopen the processing panel when entering an active run, and preserve the Canvas scroll position when selecting commented content.
- Automatically normalize persisted whole-page comments across restarts so legacy records no longer block Qoder submission or require users to reselect “全局评论”.
- Make global notifications opt-in, automatically recover transient reads and unknown AI outcomes, and keep file, canvas, rule, attachment, and processing feedback in context instead of asking users to repeat failed actions.
- Replace raw scope-code warnings with concise before/after summaries and an explicit “采用这些额外变化” decision.
- Remove the product-level 100-comment cap while retaining virtualized rendering for large review rounds.
- Restored full-fidelity rendering for the frozen HTML preview and made preview/history return bars auto-collapse into a discoverable 2px edge that reopens on hover, focus or click.
- Added architecture contracts, a state-ownership registry, engineering standards, an ADR and executable CI checks that reject direct view-level Bridge/storage writes, duplicate lifecycle authority and uncoordinated drain paths.

## [0.8.7] - 2026-07-24

- Updated the exact App bundle allowlist and its fixture to verify the managed welcome-page module and logo that were added in 0.8.6, allowing a new immutable patch release without moving the failed 0.8.6 tag.

## [0.8.6] - 2026-07-24

- Refined “项目资料” into clear project-rule and Finder record actions, added a safer rules editor with loading/read-only/unsaved states, and prepares project records when the panel is opened.
- Restored the automatic GitHub update result as a compact `Update` action above “发送至 Qoder”; it opens the fixed latest-release page and never downloads silently.
- Isolated Qoder clipboard feedback, Request submission, cancellation, validation waiver, conflict resolution, result activation, and status polling by project and run identity.
- Prevented rapid duplicate submits from creating more than one Request and kept clipboard failures recoverable without disabling other projects.
- Hardened rapid switching and close recovery by rebuilding a missing autosave job from the authoritative in-memory revision and preventing a retired project's failure callback from contaminating the current project.
- Added a non-cancelling close action to the processing panel and made closed drawer overlays stop intercepting the canvas immediately.
- Canonicalized equivalent local paths such as `/var` and `/private/var`, kept one current source identity, and made consecutive generated versions survive relaunch without duplicate-document lockouts.
- Aligned AI supplement instruction identities across recording, sealing, scope validation and history, while allowing only exact before/after values explicitly authorized by an active supplement.
- Added compound-value comment targeting plus a 100-comment hard cap, shared markers and virtualized comment rendering for dense review rounds.
- Unified global and Canvas recovery feedback into one persistent, actionable `NoticeBar`, including safe file, attachment and blocked-edit recovery.
- Reduced repeated release validation by binding the full PR gate to an exact Git Tree Hash, using a fast post-merge smoke, and reusing fresh matching source evidence for installer-only release verification.
- Provision the first-run welcome page as a persistent ordinary HTML project with its own initial workspace, so edits, comments and QoderWork handoff work before users import another file.

## [0.8.5] - 2026-07-23

- Published the 0.8.4 source feature set from a new immutable release tag after the earlier artifact run stopped before publication.
- Updated the packaged-runtime release gate to exercise the current keyboard export path instead of a retired always-visible action.

## [0.8.4] - 2026-07-23

- Expanded source-preserving native text editing to more safely mapped text hosts.
- Added source-owned hard breaks, plain-text multiline paste, and simple paragraph or list-item splitting with undo and redo coverage.
- Reduced repeated DOM scans and draft copying on the native editing hot path.
- Redesigned the review workspace, project/version panels, comment tools, AI handoff state, and built-in welcome page.
- Added paired canvas/comment focus, dense-comment layout, full-bleed edit and preview surfaces, and a compact processing view without an outer scrollbar.
- Reserved the source tag; no installer assets were published after the packaged-runtime gate stopped before publication.

## [0.8.3] - 2026-07-23

- Opened the PageRoot source repository under Apache-2.0.
- Established repository governance, CI, release provenance and reproducible release assets.
- Prevented the packager from publishing before the complete artifact gate succeeds.

## [0.8.2] - 2026-07-23

- Completed the source-preserving native DOM editing path and automated persistence safeguards.
- Added deterministic browser, Electron, AI closed-loop and packaged-artifact gates.
- Added manual GitHub release update checks and PageRoot-branded macOS artifacts.
- Reserved the source tag; no installer assets were published after the release pipeline stopped before publication.

## [0.7.4] - 2026-07-20

- Published the first public macOS release in this repository under the earlier YuanYe artifact name.

[Unreleased]: https://github.com/Charleyli925/PageRoot/compare/v0.9.6...HEAD
[0.9.6]: https://github.com/Charleyli925/PageRoot/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/Charleyli925/PageRoot/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/Charleyli925/PageRoot/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/Charleyli925/PageRoot/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/Charleyli925/PageRoot/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Charleyli925/PageRoot/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Charleyli925/PageRoot/compare/v0.8.10...v0.9.0
[0.8.10]: https://github.com/Charleyli925/PageRoot/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/Charleyli925/PageRoot/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/Charleyli925/PageRoot/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/Charleyli925/PageRoot/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/Charleyli925/PageRoot/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/Charleyli925/PageRoot/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/Charleyli925/PageRoot/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Charleyli925/PageRoot/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Charleyli925/PageRoot/compare/v0.7.4...v0.8.2
[0.7.4]: https://github.com/Charleyli925/PageRoot/releases/tag/v0.7.4
