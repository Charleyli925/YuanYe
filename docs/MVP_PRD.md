# PageRoot MVP 产品需求

- 状态：v3 引擎合同；桌面打开边界为 v4-only
- 适用范围：本地 HTML 源码局部编辑、内部 AI 交接、候选健康/连续性检查与版本历史
- 上位文档：[架构说明](ARCHITECTURE.md)
- 安全边界：[安全模型](SECURITY_MODEL.md)
- 验证策略：[测试策略](../tests/TEST_STRATEGY.md)
- 协议文档：[Change Request 协议](CHANGE_REQUEST_PROTOCOL.md)
- 交互文档：[交互流程](INTERACTION_FLOW.md)
- 下一阶段专项 PRD：[版本与项目文件产品需求](VERSION_AND_PROJECT_FILES_PRD.md)
- 首次打开导入确认：[首次打开导入确认](IMPORT_CONFIRMATION_PRD.md)

本文描述目标产品，不描述 0.5.x 旧实现。若旧数据、旧说明或旧测试与本文冲突，以目标计划为准。

> 版本、工作文件、AI 候选、项目可见目录和评论附件的下一阶段目标规则，以专项 PRD 为准。桌面打开路径只接受有效 v4 Project；v4 以前的项目状态不迁移、不恢复，也不作为读取回退。未登记且未绑定的 HTML 先确认再导入为新的 v4 V1，默认保留原稿，见 [首次打开导入确认](IMPORT_CONFIRMATION_PRD.md)。PR 2B 已交付 Registry 全量项目目录、状态/Version 投影、历史 Working Copy Finder 定位与可删除的 `AI任务/` 派生展示；可见附件、附件 Finder 定位与回收区是 P3。

## 1. 产品结论

PageRoot 让用户在真实本地 HTML 上完成两类工作：

1. 文字、inline 样式和同级模块顺序等直接编辑，由单一 SourcePatchEngine 对真实源码做局部 Patch 后自动写回源文件。
2. 生成内容、跨区域修改和整体调整，通过页面评论冻结为 Request，交给内部 AI 返回完整 HTML。

核心合同只有一句：

> 用户选中谁，直接编辑就只 Patch 谁；内部 AI 对一次冻结提交返回完整且可显示、身份与 Hash 一致并完成事务提交的 HTML，系统才创建下一版，且在用户确认前绝不替换提交前的 HTML；作者脚本变化不检测、不提示，与上一版连续性不足时必须先审阅。

## 2. 目标与非目标

### 2.1 MVP 目标

- 用户无需理解或执行手动保存。
- 用户始终知道当前内容是否已经写回文件。
- 第一次打开自己的 HTML 时，工作台右下角用一次安装级卡片说明
  「编辑→评论→发给 AI」闭环；指针 Hover 持续说明单击选择和双击改字。
  卡片不跟页面滚动。点右上角发送进入等待后结束；Esc 和单击画布不关卡片。
  Hover 与单击共用同一命中：点内容选小框，点有内容模块的留白选大框，空模块不选。
  不把「预览可操作」做成第四种指针状态。
- 交给 AI Agent 时，瞬时准备只去重发送；只有待编辑文字提交、冻结与持久 Hash 校验全部成功后，当前项目才真实锁定。
- 用户可以在一个项目处理期间继续处理其他项目。
- 每个 AI Version 都能回答：哪个项目、哪个文件、基于哪版、前一版是什么、何时提交、何时完成、具体是哪份内容。
- 新 Version 打开时，版本身份、源 HTML、历史快照和画布内容严格一致。
- 连续 AI 修改后，用户最初打开的 HTML、每一份旧工作文件、每轮冻结输入和每份不可变历史 HTML 都完整保留。
- 历史查看与创建新 Version 是两个不同动作；历史页只读，不提供覆盖当前 HTML 的恢复旁路。
- 纯浏览器预览是正式只读能力：可运行页面自身交互，但不能编辑 PageRoot HTML、添加评论、附件或发送 AI，且所有页面操作都不会保存。
- 桌面交互预览真实运行当前 HTML；从预览点击“编辑”时直接打开刚才
  选择的 source-backed Tab/显示状态，不增加第三种模式、额外确认或
  滚动定位。
- 崩溃、外部冲突、取消、失败和 no-change 不丢评论、不留半提交。
- 旧项目记录和 0.6.1 完整、只读、Hash 可校验地归档；v3 从干净工作区开始。

### 2.2 非目标

- 不做低代码搭建器。
- 不让用户逐个接受 AI 的多个候选区块。
- 不把临时文件、自动写回、事务恢复快照或恢复日志显示为 Version。
- 不把文件名、页面标题或文件系统修改时间当作版本身份。
- 不依赖固定时间窗口推断内部 AI 已完成。
- 不维护一个会被反复覆盖、可能与项目当前路径分叉的含糊 `current/index.html`。有效 Candidate 经用户采纳后才创建按当前受管文件主干与连续 `Vn` 命名的可见 Version Working Copy 并切换项目路径，不要求用户手动管理副本。
- 不让预览 DOM 序列化结果成为保存事实源。
- 不把运行时生成的节点、文字、Canvas 像素、表单值或滚动位置伪装成
  可编辑源码；编辑态完整视觉内容由源码内联 SVG、静态 HTML 或 PNG
  回退提供。
- 不提供 legacy DOM、v2 Reader、迁移器或新旧引擎开关。
- 不修改共享 CSS Rule、CSS variable、断点、伪状态或外部 CSS。

## 3. 术语

| 名称 | 定义 |
|---|---|
| Project | 工作台中的独立项目，拥有自己的状态、锁、版本与 Request |
| Document | 项目绑定的源 HTML 稳定身份，由 `documentId` 表示 |
| Current HTML | 当前受管、经完整 OpenTarget/Hash 验证的可见 Version Working Copy；采纳 Candidate 后才切换到下一份 |
| Version | 初始 V1 或一次有效内部 AI 返回形成的不可变里程碑 |
| Request | 一次冻结的用户意图和精确输入 |
| Attempt | 内部 AI 对某个 Request 的一次执行 |
| Candidate Version | 系统为当前 Request 预留、尚未提交的下一版身份 |
| Completion | 受支持 finalizer 最后原子写入的唯一完成信号 |
| Commit marker | 让 Version 正式进入历史的唯一提交点 |
| Comment | 用户对模块、子区域、文字或插入位置留下的本轮要求 |
| Edit event | 本地直接编辑的审计事实，不是 Version |

## 4. 产品对象与身份

系统必须区分：

| 字段 | 作用 |
|---|---|
| `projectId` | 稳定的内部项目身份，不直接作为 Finder 文件夹名 |
| `displayName` | 默认取 HTML 文件名（不含扩展名）的用户可读项目名称 |
| `createdAt` | 不可变的项目创建时间 |
| `storageDirectoryName` | 固定的可读项目目录名，由显示名、创建时间和短项目标识组成 |
| `documentId` | 源 HTML 身份 |
| `versionId` | 机器版本 ID，例如 `ver_0009` |
| `versionOrdinal` | 连续序号，例如 `9` |
| `versionLabel` | 用户可读标签，例如 `V9`；界面、正式 Version 与工作文件使用同一 ordinal |
| `outputRelativePath` | 冻结的 AI 唯一输出路径，例如 `requests/<requestId>/attempts/<attemptId>/output/candidate.html`；不由 AI 推导或改名 |
| `basedOnVersionId` | 当前提交内容的谱系基础 |
| `previousVersionId` | 时间线上前一个正式 Version |
| `requestId` | 本轮用户意图 |
| `attemptId` | 内部 AI 执行身份 |
| `baseSnapshotSha256` | 冻结输入的精确 Hash |
| `contentSha256` | 正式 Version HTML 的精确 Hash |

不得使用一个含糊的 `currentVersionId` 同时表达最新正式版本、当前谱系基础、当前精确匹配版本和正在查看的历史版本。

## 5. 功能需求

### 5.1 打开项目

用户可以：

- 打开本地 HTML。
- 从最近项目切换。
- 从 Registry 全量项目目录切换；Recent 只影响排序、最后打开时间和启动优先。
- 在一个项目处理时打开或切换另一个项目。

工作台不负责新建 HTML。每次打开本地 HTML 时，系统先只读分类：有效 v4 项目文件直接打开；已绑定的外部原文件显示“已经导入”确认，主操作打开之前的项目；真正全新的外部 HTML 显示首次导入确认，用户确认后才建立新的 v4 Project 与初始 V1。导入不覆盖或改写原始 HTML；只有用户勾选「成功导入后，同意将原文件移至废纸篓。」且新画布已确认后，才把该原稿移入废纸篓。v4 以前的项目状态不迁移、不恢复，也不作为读取回退。V1 是初始只读基线，不是一次手动保存。详见 [首次打开导入确认](IMPORT_CONFIRMATION_PRD.md)。

每个项目拥有稳定 `projectId`，每个源 HTML 拥有稳定 `documentId`。新建项目时，系统以 HTML 文件名（不含扩展名）建立 `displayName`，在配置项目目录下分配用户可读的 `<displayName>`（同名时 `<displayName> (2)`）根目录并由 Registry 登记。项目根同父目录改名可受控更新 Registry 路径与显示名；改受管 HTML 文件名只更新其 Working Copy 映射，不能只依赖文件名匹配，也不改变项目身份。

项目目录成员资格与写入授权只来自 Registry。已登记但从未出现在 Recent 的项目必须显示；Recent 内未登记的外部 HTML 不得显示为项目，清除 Recent 不得把项目移出目录。点击目录行时 Renderer 只提交 `projectId`，Bridge/Repository 重验 Project、Document、Working Copy、OpenTarget、HTML 与 Hash，成功后才一次性发布现有 Session。

桌面版在当前 HTML 已安全保存、项目空闲且没有冲突时，允许用户单击顶部文件名或铅笔图标原位重命名。输入只包含主文件名，现有 `.html/.htm` 后缀和所在目录保持不变；`Enter` 或失焦提交，`Escape` 取消。同名文件不得覆盖。成功重命名只改变当前真实文件路径、桌面活动/最近记录和项目显示名，不改变 HTML 字节、`projectId`、`documentId`、Version 或历史。事务必须有稳定 operation ID、预期源 Hash 和崩溃恢复记录。

初始 Version 的内部 ID 为 `ver_0001`，界面显示 `V1`，可见工作文件为 `<原用户文件名>-V1.html`。用户采纳第一份有效 AI Candidate 后创建 `ver_0002`、显示 `V2`，并生成 `<原用户文件名>-V2.html`；之后按同一 ordinal 递增。`input/base/index.html` 是冻结输入的机器名，不是用户文件名；AI 只能写入 Prompt 给出的固定 Attempt 输出 `requests/<requestId>/attempts/<attemptId>/output/candidate.html`。Candidate 在用户采纳前不是正式 Version，该文件路径和标签不得被用作用户界面的版本身份，也不得回写并破坏严格 v4 Project Schema。

### 5.2 直接编辑与自动写回

支持的直接编辑至少包括：

- 从交互预览返回编辑时保留当前 source-backed Tab/显示状态；该状态
  只影响本次画布展示，不产生 SourcePatch，也不改变源码默认 Tab。
- 编辑模式中，语义完整且能唯一映射到源码的 Tab、原生 details 和本地
  disclosure 可从选框工具条或 `Option + 单击` 切换；普通单击仍只选择，
  双击仍进入文字编辑。快捷提示只在悬停动作按钮时出现。
- Hyperlink、表单、任意作者脚本、仅靠 class 识别的控件、弹窗、Popover
  和抽屉在编辑模式中继续保持禁用；真实页面行为只在隔离预览中运行。
- 受支持的脚本页在编辑画布直接展示运行结果：图表、Canvas/SVG、动态表格可选中并按最近源码宿主留评论。
  这些运行内容不因显示而获得不可靠的双击编辑或元素复制权限，Runtime DOM 也不反写源码。
  不使用 runtime capture、PNG/Blob 缓存或位图投影来冒充可保存内容。
- 图表数量不会使整份 HTML 降级；数据分析报告仍保留受支持图表的展示和评论，其他可证明的源码区域继续直接编辑。
  普通编辑完成只承诺编辑结果与源码映射正确，保存仍以实际持久化结果为准；不承诺修改正文数字会重新计算所有图表。
- 登录、实时接口、复杂表单或大量运行生成内容可以按具体区域限制直接编辑，不承诺复杂网页应用具有文档级连续编辑体验，也不因此无条件关闭整页脚本。
- AI 返回后的 Review 可以在静态 before/after 对比完成后，由唯一 owner
  对同一批受限候选补充一组 before/after runtime capture；这是失败关闭的
  辅助证据，不阻塞审阅、不创建编辑状态，也绝不进入编辑画布或持久化源码。
- 双击 source-backed 静态文字后，光标直接出现在点击位置，不先选中整词；已在编辑中再双击才按浏览器习惯选词。普通文字和安全的混合行内文字都可输入、删除和选择。
- 行内节点向上寻找宿主；复杂父容器也可以成为岛，非行内后代保持冻结原子。
- 可编辑宿主的可视段首、段尾和非空样式交界均可输入：可视段首继承右侧首字符，其他交界继承左侧字符，工具栏显示与下一次输入一致的样式。
- 文字 checkpoint 可以跨多个源码 text node，但不得拍平或序列化既有行内标签。
- 字体、字号、字重、斜体和颜色。
- 背景、填充、边框和常用间距。
- 同级模块顺序。
- 源码元素复制、删除，以及按稳定 ID 执行的插入和跨父移动。复制与新增分配全新 ID，移动保留 ID；
  复制检查整个选中子树，脚本生成内容及包含它的外层容器都不可进入复制链路，同页其他源码内容不受影响。
- 画布文字、样式、安全结构变化和同级模块顺序共享当前打开 HTML 的内存撤销/重做历史；只保留最近 20 次，切换 HTML、关闭文档或重启应用即清空。
- 不在画布工具栏增加撤销入口。沿用系统 `Edit > 撤销/重做`，并支持 `Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z` 与 `Ctrl+Y` 重做。
- 焦点位于评论正文、项目长期规则或其他真实文字输入框时，撤销/重做只使用该输入框的原生局部输入历史，不触碰画布源码历史。评论卡片、评论/附件的新增删除和其他项目操作不纳入本轮撤销范围。

每次本地修改：

1. 文字双击时由 `IslandEditingController` 为当前源码宿主建立唯一可编辑岛；向上提升时非行内后代保持冻结原子。浏览器只负责光标、Selection 和 IME，Controller 接管实际变更。
2. 约 700ms、格式、Cmd+S、目标切换、关闭或发送边界生成带目标身份、源 Hash、逻辑文字与 canonical content HTML 的 `setText` 语义操作；初始操作不预置新 ID，由 Kernel 单次物化分配换行 ID，Canvas 仅在整次结果验收后封存。编辑工具栏及与当前选区绑定的评论操作不结束会话，点击除此之外的页面或 App 区域则提交 checkpoint，并同时清除编辑态、选区与工具栏。
3. SourceIndex/TargetResolver 唯一定位真实源码范围；无法唯一定位时保留草稿并阻止操作。
4. SemanticOperationKernel 把文字、样式或结构意图降低为 SourcePatchEngine 的精确 range patch，并验证未授权范围逐字节不变。文本节点删除时仍由存活父 TargetRef 授权；结构新增、删除和移动只使用 SourceIndex 中的稳定元素 ID，保证 exact inverse 可恢复；不保存整页 DOM 快照。
5. 用 Patch 结果更新内存 HTML 并原子重建 projection；失败时保留原会话和草稿。
6. 增加 `editRevision` 并追加稳定 ID 的 edit event。
7. 触发有上限 debounce 的同一条串行写入队列。
8. 写入成功后推进 `lastPersistedRevision` 和显示时间。

用户合同不是固定 700 毫秒，而是“无需手动保存，状态真实可见”。实现应以约 700 毫秒为初值并通过性能测试调整。

PageRoot 0.9.0 只有一个受控 `contenteditable="true"` 路线，不再在
`plaintext-only`、浏览器富文本和自定义补丁间切换。粘贴只读取纯文本；
换行固定生成 `<br>`；折叠光标在可视段首向右继承，其余文字、样式和
链接边界向左继承。Controller 以 grapheme 为单位处理删除，并以冻结
Selection 重放 IME 最终文本。

安全岛可保留行内语义、注释和不可变的图片、SVG、MathML、Canvas、
表单控件及媒体原子。MutationObserver 发现非 Controller 所有的 DOM
变化时立即恢复。脚本、样式、表单/嵌入根和不安全块结构本身不
进入文字编辑；其安全行内子节点仍按精确边界编辑，非行内后代保持冻结原子。最终只能提交完整岛，经受保护属性、原子、注释、
重解析、范围和源码 Hash 校验；预览 DOM 永远不能整页序列化回源码。

编辑画布必须明确提示“本地文本编辑会直接修改源文件并保存”。这里的“源文件”指项目当前指向的 HTML：首次打开后是当前受管 Version Working Copy；Candidate 被采纳后才切换到下一份可见 Working Copy。

自动写回必须：

- 只接收 SourcePatchEngine 产出的完整下一份源码。
- 在写入前读取磁盘当前 Hash。
- 仅当 Hash 等于上次已知基线时继续。
- 写入同目录临时文件。
- 刷新并原子替换源 HTML。
- 替换后重读并校验 Hash。
- 串行处理新旧 revision，旧写入不能覆盖新编辑。
- Patch 后重新解析失败时不进入写入队列。
- `contenteditable`、临时 IME wrapper、预览 nodeId 和编辑器样式永不写入源文件；canonical item 只能由受权 SourcePatch plan 创建，并拥有 exact inverse。

界面策略：

- 顶栏不提供保存状态区域，不显示“正在更新…”“已更新到文件”或绿色成功点。
- 保存、冲突与失败仍由 Document/Project 工作流持有；失败时保留内存内容、暂停后续写入、禁止提交给内部 AI，并提供全局重试或导出当前 HTML。
- 外部 Hash 冲突时不覆盖外部内容，提供重新载入外部文件或导出当前 HTML；用户明确处理前不得假装已更新。

外部 Hash 冲突时：

- 不覆盖外部内容。
- 提供重新载入外部文件、导出当前 HTML。
- 用户明确处理前不得假装已更新。

### 5.3 文件菜单与快捷键

- 主编辑流程不显示“保存”或“另存为”按钮。
- “导出 HTML 副本”放在次级文件菜单，只复制 HTML 内容，不附带 `PROJECT.md`，不改变项目绑定，不创建 Version。
- `Cmd+S` 只立即刷新当前自动写入队列；完成写回后不在顶栏增加状态点或文字，真实错误进入全局恢复提示。
- 系统 `Edit` 菜单中的既有「撤销 / 重做」是唯一菜单入口，不在画布编辑栏重复增加按钮。画布撤销前必须先完成当前 IME/文字 checkpoint 并刷盘；结果通过同一 Hash 校验与原子写入链路落盘，不创建 Version。
- 新的画布修改会截断当前位置之后的 redo。外部源码变化、AI 工作文件切换或无法证明连续 Hash 时建立新的历史边界，绝不把旧 Patch 套到未知字节上。
- 原生菜单和右键菜单不得存在另一条会创建 Version 的保存链路。

### 5.4 评论与目标

用户可以对以下层级添加评论：

- 整个模块。
- 模块内子区域。
- 具体文字。
- 两个模块之间的插入位置。

每条评论立即获得稳定 `commentId`、创建/更新时间、正文、附件、目标定位和持久性类型。用户可通过“添加图片或文件”选择多个本地文件，也可直接在评论输入框粘贴剪贴板图片。图片以缩略图显示，点击打开大图预览；缩略图悬停后右上角显示移除按钮。普通文件以紧凑文件条显示文件名和大小，长文件名必须截断但保留完整 title。

单轮评论不设置产品层面的条数上限。超过 40 条时，评论栏按共享滚动视口加前后缓冲区虚拟化渲染；被聚焦、编辑或等待删除确认的卡片必须始终保留。画布仍保存全部目标位置与完整评论数据，跳转远处评论时先把目标卡片纳入渲染窗口再同步滚动，不能因优化丢失评论或串错目标。

附件立即复制到项目记录的 `draft/attachments/<commentId>/`，不能依赖桌面、下载目录、移动硬盘或其他原始文件继续存在；项目记录也不保存这些外部原始路径。每个附件保存稳定 `attachmentId`、类型、文件名、媒体类型、字节数、Hash、项目相对路径和来源（剪贴板或文件选择）。附件与评论共享同一 TargetRef，因此图片/文件、评论正文和模块/子区域位置形成可审计的一对多关系。

v3 TargetRef 保存 label、层级、selector/结构锚点、源码位置、源 Hash、稳定属性、祖先指纹、文字前后缀及 `exact|rebound|ambiguous|orphaned` 状态。

排序或局部修改后唯一重找到的目标显示 `rebound`；多个候选显示 `ambiguous`。用户主动删除源码元素时，确认文案显示该元素及后代关联的评论数，确认后这些当前 Working Copy 评论随元素批量删除，不产生常规 `orphaned` 评论。只有外部改写、旧记录或身份损坏造成的异常失联才保留评论与审计，并在卡片中建议删除后于正确位置重新评论；不安全目标不能驱动直接写入。

评论和附件独立于 HTML 自动写回持久化。评论/附件的创建、编辑和删除不创建 Version。删除当前草稿附件时清理项目草稿副本；已经冻结到 Request 或归档 Version 所引用的附件保持不可变。冻结优先使用同一文件系统的 copy-on-write 副本并在发布 Request 前同步到磁盘，不支持时安全回退为完整复制；无论采用哪种物理方式，语义上都是不再依赖草稿或外部原文件的独立快照。

交给内部 AI / QoderWork 时，`PROMPT.md` 和 `change-request.json` 为每个附件提供 Request 管理的本机绝对路径，同时保留 Request 相对路径用于项目整体移动后的恢复。交接内容不得包含附件 Base64，也不得暴露或要求 AI 追踪用户选择文件时的外部原始路径。

本地直接编辑写入 `edit-audit.jsonl` 或等价追加记录，至少包含稳定事件 ID、revision、时间、类型、目标、before 和 after。

### 5.5 发给 AI

提交入口为 AI 助手与对话侧栏。无评论时显示“写评论后再发送”且不可用；有评论后显示“发给 AI”。Agent 的安装、登录、连接状态和重新检查统一在设置页处理；“复制任务”仍可用，受管模式和复制模式共用同一冻结 Request 合同。

用户触发提交后必须按唯一顺序执行：

1. 提交当前原生编辑 checkpoint；composition、映射或 Patch 失败立即停止。
2. 校验本轮评论并同步进入瞬时 `preparing`；它只去重快速双击、快捷键和重复事件，不锁 Canvas。
3. 选择 Qoder 时先执行完整使用前检查；复制模式直接继续。检查期间的后续编辑由最终冻结捕获，失败不建立 Request。
4. 完成必要的首次项目登记并重新读取当前评论。
5. 同步执行 `freezeNow()`，得到届时最新、可验证的 HTML、source SHA 与 revision。
6. 只有冻结成功才设置 `projectLocked=true` 并进入 `submitting`。
7. 等待自动写回追平 revision，并重读磁盘 Hash；任一步失败都回到 editing，不建立或发布 Request。

锁定不能早于原生编辑 checkpoint/freeze 成功，否则失败会留下“未提交却被锁定”的假状态。

锁定后允许：

- 滚动和被动查看冻结页面与评论。
- 查看本轮处理状态。
- 取消本轮。
- 再次复制交接内容。
- 通过左侧栏继续查看项目上下文，但不打开项目管理面板。
- 打开或切换其他项目。

锁定后禁止当前项目：

- 画布编辑、样式、排序。
- 添加、修改或删除评论。
- 项目规则修改。
- 再次提交。

历史版本始终先以只读快照查看，不提供替换当前 HTML 的能力；仅当项目空闲并已精确进入该历史视图时，用户可选择“基于此版本继续编辑”来激活该 Version 原有的受管 Working Copy。该操作不是恢复、替换或改写历史快照。

提交准备流程：

1. 等待同一自动写入队列追平 `freezeCutoffRevision`。
2. 再读当前 HTML，确认实际 Hash 等于已写入内容，并把完整字节冻结到 `input/base/index.html`。
3. 冻结评论、附件和相关 edit event；重新核对附件大小与 Hash，拒绝选择后被篡改或丢失的文件。
4. 生成 Request、Attempt、候选 Version 身份。
5. 保存精确 `input/base/index.html` 和 Hash。
6. 写入 v3 Request、annotation records、input manifest 和 Prompt。
7. 切换为 `processing`。

任何准备步骤失败都必须安全回到 `editing`，保留原评论和本地内容。

PR 2B 在 Request 已持久化后，才从冻结 Prompt 建立 `AI任务/<日期>-候选版本N/` 的派生展示：处理中只含 `PROMPT.md`，Candidate 通过 finalizer 后才加入 `*-Vn-待审阅.html`。它由收据驱动、排他/no-replace 写入，可删除、可重建，且从不参与 Candidate、审阅、Promotion 或版本身份判断。P2 不创建 `附件快照说明.md`、`附件与图片/`、`AI_RULES.md` 或 `PROJECT.md` 副本；可见附件体验是 P3。

桌面端在每轮发送前让用户选择“Qoder CLI”或“复制任务”。发送前的使用前检查只在当前 Agent 交付动作中执行，不由 About 触发；设置页负责显式的 Agent 安装、登录、连接状态和重新检查。检查失败不得锁定项目或创建 Request。检查成功后，Bridge 才为带固定 `agentDelivery` 授权的同一 Request 启动受管 ACP 会话。Renderer 不得提供命令、cwd、环境、Prompt、Request/output/finalizer 路径，也不得把 ACP stop 或进度当作 Candidate 完成。

复制模式仍只把交接消息写入系统剪贴板；写入后必须逐字 readback 一致才报告“已复制”，
且产品不自动打开或粘贴到外部 Agent。交付状态必须按项目和本轮 Request/Attempt 隔离。
自动模式普通启动失败时，只有当前 Bridge 已确认进程组退出且没有 output/completion 残留，
才可重试同一 Request 或回退复制。Bridge 崩溃、进程清理无法确认或存在残留时，本轮变为
不可重试：用户先结束旧 Request 形成持久 fence，再重新发送为新 Request。取消受管会话时，
必须先关闭 ACP mutation surface 并有界停止 Qoder 进程组，再持久取消 Request；重启后的
未知旧进程无法由 PageRoot 停止时，durable cancel 本身是 authority fence，界面必须保守
提示它仍可能运行。无论采用哪种交付方式，结果都只能成为待审阅 Candidate，不得自动替换
当前 HTML。

`input/base/index.html` 是本轮修改前完整、不可变的 HTML。后续 AI 成功、失败、取消或 no-change 都不得改写它。

### 5.6 项目级状态机

```text
editing
  → submitting
  → processing
  → validating
  → committing
  → ready-to-open
  ↔ review view（隔离可交互、不可持久化；runtime 仍为 ready-to-open）
  → editing
```

附加持久状态：

- `awaiting-conflict-resolution`
- `recovering-transaction`

`submitting`、`processing`、`validating`、`committing`、冲突和事务恢复均锁定当前项目。`ready-to-open` 表示新版已经安全生成但尚未成为当前源；界面默认突出“审阅对比”，同时保留“直接打开”。正式审阅页在无保存与激活权限的隔离沙箱中展示冻结当前版与 AI 候选。进入审阅默认显示“双页 + 全部变化 + 同步滚动 + 100%”总览；第一次只把第一处变化作为导航目标并定位，不激活遮罩或边框。变化筛选、目录导航、局部聚焦、页内运行态、滚动与缩放彼此独立；变化聚焦与评论聚焦的上下文偏好在设置中保存，默认分别为 25% / 15%。

审阅事实保持精确文字与 `text/structure` 来源分类；显示层另行消费正式 region 与 paint plan。文字保留红色删除虚线和绿色逐字实点，聚焦时只有局部遮罩孔而不画段落框；来源明确的新增、删除、移动可以画一个局部框，普通属性默认无框，style 只有视觉变化已确认才画框。每侧至多一个遮罩孔与一个局部框，不把多个目标提升为父容器框。Review 的 best-effort Runtime 视觉观察只决定样式框能否显示，不覆盖源码事实，不成为采纳权限。

审阅页没有退回本轮处理页的入口；“返回 AI 修改前”结束 active run 并恢复修改前 HTML 的编辑状态，但保留评论、编辑记录、Candidate、working HTML 和本轮记录。“打开 AI 修改后”需要确认；审阅层保持覆盖到候选编辑画布完全就绪后再一次性移除，完成 Hash 校验后回到 `editing`。

状态与 active run 的唯一事实源是该项目自己的 `runtime-state.json`。`project.json` 不保存第二份 active run。

### 5.7 候选版本

系统是唯一编号权威。假设最新正式 Version 是 V8：

- 系统预留 `ver_0009 / V9`。
- Request 和 Prompt 明确写入候选身份。
- AI 不得自行计算或改写版本号。
- 失败、取消、no-change 或未采用冲突不消耗 V9。

历史版本不能在当前版本链内回写。若用户把旧快照作为普通文件重新打开，它会获得新的 Document、V1 和独立候选编号。

### 5.8 内部 AI 输出与 finalizer

每个新 Attempt 的唯一 HTML 输出是 PageRoot 冻结的 `requests/<requestId>/attempts/<attemptId>/output/candidate.html`。Prompt 给出固定绝对输出路径，AI 不得自行命名。通过 finalizer 后，Repository 才能按已验证 Candidate 字节生成可见 `AI任务/` 派生 HTML；该名称不反向决定 Version 身份或正式工作文件命名。

内部 AI 完成全部修改后必须执行 Prompt 中的完整 finalizer 命令。finalizer：

1. 从冻结 Request 读取全部身份与 Hash。
2. 核对 Request/Attempt 仍是唯一 active run。
3. 校验输出是完整可加载 HTML。
4. 统一写入 HTML 机器元数据。
5. 计算精确 Hash 与规范化比较 Hash。
6. 最后原子写入 `completion.json`。

以下均不是完成条件：

- 只出现完整 HTML。
- 文件在任意固定时间内没有变化。
- 标签闭合。
- AI 写了一段摘要。
- 旧 Attempt 中残留输出。

完成后 output 视为封存；若继续变化，标记协议违规并阻止建版。

### 5.9 校验与 no-change

工作台发现 completion 后进入 `validating`，必须独立校验：

- Schema 和 finalizer 版本受支持。
- 项目、文档、Request、Attempt 和候选身份全部相同。
- active run 仍有效且未取消、失败或被替代。
- 冻结输入 Hash 相同。
- 实际 output Hash 与 completion 相同。
- HTML 完整可加载。
- body 存在可显示内容。
- 脚本、inline handler、`javascript:` URL 和 meta refresh 作为普通候选内容，不参与检测、分级或提示。
- 规范化比较可重复。
- 候选与上一版的粗粒度连续性评估可重复。

规范化比较只允许移除以下工作台自有 meta：

- `html-ai-document-id`
- `html-ai-version-id`
- `html-ai-version-label`
- `html-ai-based-on-version-id`
- `html-ai-request-id`

同一确定性解析/序列化算法计算两侧比较 Hash。不得忽略 CSS、JavaScript、正文、结构、属性或普通空白变化。

若比较 Hash 相同：

- 状态显示“未识别到明确的页面变化”。
- 不创建 Version。
- 不消耗候选号。
- 保留 Request、Attempt、评论和诊断记录。
- 解锁当前项目，允许用户修改要求后再次提交。

若比较 Hash 不同，必须生成符合 `candidate-assessment.v1.schema.json` 的记录。完整性或
可显示 body 失败时保留 output、completion、assessment 和 outcome，不创建 Version。
脚本、inline handler、可执行 URL 和 refresh 指令变化不检测、不提示。连续性证据不足时仍创建不可变 Version，但状态为 `attention`，处理页只允许进入
对比审阅；普通正文、属性、结构和样式变化不按评论 TargetRef 判失败。

2026 年 8 月的短期 Developer Preview 产生过两种 `1.0.0` 历史 assessment：省略或
包含 `executable` 与 `health.executableSurfaceUnchanged`。历史 Version 或已归档终态
通过单一兼容入口读取两种形态：系统必须从普通文件形式保留的冻结 base 与不可变候选证据
重算四个 Hash 和当前文档健康/连续性 assessment。结果只在内存中移除退役字段与旧脚本
结论，不改写 Attempt；归档失败结果仍保持终态，也不以辅助展示记录阻止当前权威 HTML
继续编辑。

### 5.10 两阶段 Version 提交

校验通过后进入 `committing`：

准备阶段：

1. 再次确认 active run。
2. 建立持久事务日志。
3. 准备不可变 HTML、v3 `version.json` 和评论归档；Attempt assessment 由 `requestId + attemptId` 关联。
4. 核对候选 Hash。
5. 核对当前源 Hash 等于 `baseSnapshotSha256`。
6. 保存并校验源 HTML 短期恢复文件。
7. 刷盘并将事务标为 `prepared`。

应用阶段：

1. 再次核对源 Hash。
2. 以 create-new/no-clobber 语义创建候选的下一份可见 Version Working Copy；同名不同内容时失败关闭，不覆盖。
3. 重读新工作文件并校验候选 Hash，标记 `source-applied`；提交前当前 HTML 保持不变。
4. 原子发布到 `versions/<version-id>/`。
5. 原子写入 `committed.json`，这是唯一提交点。
6. 将项目和 registry 的 canonical path 切换到新工作文件，原始路径与旧工作路径保留为同一项目的别名。
7. 从提交标记重建 `project.json` 缓存。
8. 从新工作文件重新打开 current 画布。
9. 校验新工作文件、Version 快照和画布三个 Hash 相同。
10. 清理恢复文件并显示成功。

没有有效 `committed.json` 的目录不出现在历史或 latest Version 中。

### 5.11 外部冲突

如果 AI 完成时源文件已由外部程序修改：

- 不覆盖源文件。
- 不写 commit marker。
- 进入持久 `awaiting-conflict-resolution`。
- 保留候选输出、外部内容与所有 Hash。
- 当前项目继续锁定，其他项目不受影响。

用户选择采用 AI 候选：

1. 记录确认时间和当时外部 Hash。
2. 将外部内容保存为恢复文件。
3. 将事务 `expectedSourceHash` 更新为经确认的外部 Hash。
4. 再次确认外部内容未继续变化。
5. 创建新的可见 Version Working Copy 并继续两阶段事务；外部修改后的旧文件仍完整保留。

用户选择保留外部内容或取消：

- 不创建 Version。
- 释放候选号。
- 恢复冻结评论到 editing。
- 以外部源内容重新建立当前谱系状态。

### 5.12 Version 历史

版本历史只列：

- 原生 v3 `initial` 和 `internal-ai` Version。

旧 Version、评论和 Request 只存在于切换前只读归档，不进入新产品历史列表。

每个正式 Version 显示：

- `V9`
- 生成时间
- 基于 V5
- 上一版 V8
- Request/Attempt
- 摘要与评论数量

用户动作分开：

1. “查看此版本”：进入 `viewMode=history`，从精确不可变路径打开，只读。
2. “在文件夹中打开”：定位该 Version 对应的可见 Working Copy；Repository/Bridge 必须验证 Version、唯一 `workingCopyId`、根内普通非软链接文件与 Hash，不把隐藏不可变快照作为产品 Finder 文件。
3. “返回当前 HTML”：回到项目当前指向的工作文件。
4. “基于此版本继续编辑”：只在精确历史视图且项目空闲时可用。Bridge 只接收当前完整项目身份、目标 Version ID 和 operation ID；Repository 必须找到该 Version 唯一原有的 `workingCopyId`，完整验证 Working Copy state、不可变快照和当前工作文件 Hash 后，原子写入 `desktop-pending` 激活回执。缺失、重复或验证失败保持历史只读，不从快照猜测或创建替代文件。

历史模式必须显示：

```text
正在查看 V6（只读）
当前项目：基于 V9
[返回当前 HTML]
```

E 已增加从不可变历史创建下一版本的独立命令和可恢复事务，旧继续编辑入口在 F 切换前仍保持下述行为；详见 `VERSION_AND_PROJECT_FILES_PRD.md` 的历史创建合同。存量旧工作稿不因升级而自动切换。

历史模式不提供覆盖、替换或恢复当前 HTML 的按钮；Bridge 同样不暴露历史 HTML 回写路由。唯一的继续编辑路由只能激活已有受管 Working Copy，且桌面/Bridge/确认响应丢失后的同一回执操作重试必须返回同一 `workingCopyId`。回执提交后不得回滚较新的历史路径；Desktop 与 Bridge 确认成功时才在一个同步发布边界更新 Project、Document、Version、Draft 和 Comment Session，随后才接受新 Canvas 的渲染确认。

### 5.13 时间语义

必须区分：

| 时间 | 含义 |
|---|---|
| 当前 HTML 修改时间 | 最近一次自动写回成功时间 |
| Request 提交时间 | 输入冻结并发布的时间 |
| AI 完成时间 | finalizer 写入 completion 的时间 |
| Version 生成时间 | commit marker 成功提交的时间 |

文件系统 mtime 不能代替 Version 生成时间。

## 6. 数据与目录

```text
~/Documents/PageRoot/项目/<project-name>/
├── <stem>-V1.html                 # 可见 Version Working Copy
├── PROJECT.md
├── AI任务/                         # PR 2B 可删除、可重建派生展示
│   └── <YYYY-MM-DD>-候选版本N/
│       ├── PROMPT.md
│       └── <stem>-Vn-待审阅.html  # Candidate ready 后才存在
└── .pageroot/                      # 唯一权威与技术记录
    ├── project.json
    ├── manifest.json
    ├── working-copies/
    ├── requests/
    ├── runtime-state.json
    └── recovery/ai-task-projections/
```

事实源：

| 事实 | 权威位置 |
|---|---|
| 当前可编辑 HTML | 当前受管 Version Working Copy；完整 source/OpenTarget/Hash 在项目运行态与 manifest 映射中验证 |
| 项目/文档身份、显示名、登记根 | `.pageroot/project.json` 与 Registry；Registry 同时决定项目目录成员与写入授权 |
| 整个项目长期使用的 AI 规则 | `PROJECT.md` |
| active run、项目锁、冲突与恢复事务 | `runtime-state.json` |
| 当前评论、edit event、删除 tombstone、草稿 revision 与已处理 operation ID | `draft/annotations.json`；`runtime-state.json` 只保存其指针与 revision |
| 当前画布撤销/重做 cursor 与精确 Patch | Renderer `SourceHistorySession` 的当前打开 HTML 内存；最多 20 次，不跨 HTML、不跨关闭或重启；恢复记录只保留完成中断保存所需的证据 |
| 本地直接编辑审计 | `edit-audit.jsonl` |
| 冻结输入 | Request 的 `input/` |
| AI 完成 | Attempt 的 `completion.json` |
| 正式 Version | 带有效 `committed.json` 的 Version 目录 |
| `AI任务/` 展示路径与进度 | 仅 `.pageroot/recovery/ai-task-projections/` 收据；不可作为 Request/Candidate/Promotion 权威 |

任何渲染缓存都可丢弃，不能参与判断当前事实或最新 Version。

“项目资料”不再是面向用户的管理面板。PROJECT.md 仍是项目长期规则的持久事实，用户从左侧当前项目下固定的“长期规则”入口进入唯一标签页编辑；读取完成前与 AI 处理期间只读，停止输入约 700ms 后自动保存，`⌘S` 可立即保存。项目身份、Version、Candidate、历史和 AI 冻结读取链保持不变，切换规则页与 HTML 页不重建 HTML 画布。

正式签名的 macOS App 在启动约 5 秒后检查 stable 更新，并在应用持续打开期间每 4 小时再次检查；设置页提供“立即检查”“查看更新内容”、Agent 连接恢复和固定 GitHub 仓库入口，以及安装包内固定“用户声明与免责声明”文本文件的本地打开入口。About 只保留产品信息、版本、架构、GitHub 和用户声明，不触发 Agent 或更新检查。页面不能为该入口提供任意文件路径。自动与手动检查必须合并到同一个主进程更新控制器，不得并发建立两套下载或安装状态。检测到 stable 新版本时，侧栏 HTML 图标下缘显示小号红色斜体 `New!`；当前版本或自动检查失败时不占位，设置页显示手动检查结果和失败原因。只有用户点击 `New!` 或设置页中的“下载更新”后才开始下载；下载期间不显示百分比、进度条或动画。下载完成后弹出“现在重启 / 稍后”确认；选择稍后时入口变为 `New! 重启更新`，再次点击打开同一确认，Canvas 不显示下载完成横幅。只有编辑器写入、草稿和 Bridge 关闭排空全部成功后才重启安装。

正式桌面版本默认回传有限的产品使用与故障统计，不显示首次确认弹窗，
也不增加产品设置开关。收集范围包括模块/项目流程、编辑与保存类别、
AI 阶段、提醒/打断及结构化故障；严格排除 HTML、页面文字、评论、
Prompt、AI 返回、附件、剪贴板、文件名/路径、账号、电脑序列号和原始
异常。安装身份必须由应用随机生成，会话每次启动随机生成，项目仅使用
安装级密钥生成的假名键。完整且持续可见的说明放在首次打开说明、
“关于源页”和 `PRIVACY.md`。

## 7. 数据合同

新写入必须符合：

- `version-manifest.v3.schema.json`
- `change-request.v3.schema.json`
- `task-spec.v1.schema.json`（当前 v4 Request 自动编译的本轮执行要求）
- `annotation-records.v3.schema.json`
- `project-state.v3.schema.json`
- `runtime-state.v3.schema.json`
- `candidate-assessment.v1.schema.json`
- `scope-report.v1.schema.json`（直接 Patch/旧 Attempt 证据，不由新 AI Attempt 写入）
- `completion.v1.schema.json`
- `input-manifest.v1.schema.json`
- `attempt-outcome.v1.schema.json`
- `version-transaction.v1.schema.json`
- `committed-marker.v1.schema.json`

项目、运行态、Request、annotations 和 Version 使用 v3 干净主 Schema；completion、scope report、transaction、commit marker 等独立对象维持各自严格版本。

## 8. v3 干净切换

正式切换必须：

1. 完整备份 0.6.1 安装包、源码、QA 结果、活动 HTML 与旧 `项目记录`。
2. 对活动源和归档副本做逐字节或 SHA-256 对账。
3. 将旧记录备份标记为只读并与 v3 活动目录隔离。
4. v3 使用空 registry、空 `projects/` 和严格新 Schema。
5. 用户继续编辑的 HTML 作为普通 HTML 重新登记为新项目 V1。
6. 不自动恢复旧 Version 序号、评论绑定、Request、Attempt 或运行态。
7. v1/v2 主记录返回 `UNSUPPORTED_SCHEMA_VERSION`，不做推断或补字段。
8. 缺少 `displayName`、`createdAt` 或 `storageDirectoryName` 的旧 UUID 项目目录不迁移、不重命名也不删除；Bridge 直接拒绝该 workspace，由用户另行保留或清理旧记录。

旧 HTML 快照仍可作为普通 HTML 打开或重新导入；这是新建项目，不是历史迁移。

## 9. 非功能要求

### 9.1 一致性

- 文件写入原子化。
- 自动写入队列串行化。
- completion、事务和 commit marker 幂等。
- 状态转换持久化。
- 对关键路径重复计算 Hash，不信任缓存或单方声明。

### 9.2 可恢复性

- debounce 期间崩溃可从短期日志恢复。
- `prepared`、`source-applied`、Version 发布、commit marker、缓存更新各边界均可恢复。
- 恢复结果只能是完整旧状态或完整同一新 Version。

### 9.3 安全边界

- Request 可移植 JSON 只使用受控相对路径。
- finalizer 只读取当前冻结 Request，只写当前 Attempt 和受控项目事务目录。
- 拒绝路径穿越、软链接逃逸和不属于 active run 的 completion。
- 不执行 HTML 中的任意本地命令。
- 遥测 IPC 与本地队列只接受严格白名单字段；禁止从电脑序列号、硬件
  UUID、设备名或账号派生身份，遥测失败不得影响任何编辑或持久化流程。

## 10. 验收标准

### 10.1 自动写回

- 主界面、原生菜单和右键菜单不存在独立保存建版入口。
- 连续编辑并自动写回 20 次，版本号和历史条数不变。
- `Cmd+S` 只刷新同一队列。
- 重启后源 HTML 包含最后一次成功写回。
- 自动写入失败或外部冲突时不能提交。
- 页面草稿 revision 落后 Bridge 时，先读取权威草稿并重放稳定 operation；旧快照不能覆盖新评论，也不能让已经删除的评论复活。
- 草稿 POST 超时后先按 operation ID 查询是否已确认；不得把“可能已成功”当成失败后盲目重发。
- 在草稿内容未变化时连续触发关闭或项目切换，Bridge draft revision 保持不变，应用不会进入永久“尚未安全记录”状态。

### 10.2 锁定与多项目

- 触发提交的同一时刻，当前项目所有修改入口禁用。
- 快速双击只生成一个 Request。
- 刷新或重启仍恢复精确 active run 和锁。
- 当前项目处理时可以切换并编辑其他项目。
- A 项目剪贴板失败、取消、豁免、冲突或打开结果的迟到回调不改变 B 项目的忙碌态和按钮可用性。
- A、B 的状态轮询并行，单个项目响应慢不阻塞另一个项目。
- 快速切换后立即关闭并重启，最后一次原位编辑仍同时存在于源文件与画布；revision 差异不得因缺少内存 queued write 而永久阻止关闭。

### 10.3 强完成

- output 单独存在任意时长都不建版。
- 只有受支持 finalizer 写出的有效 completion 才进入校验。
- 任一身份或 Hash 不匹配都不建版。
- completion 后 output 再变化会标记协议违规。
- no-change 不建版且不消耗候选号。

### 10.4 版本与历史

- 新写入只有 `initial` 和 `internal-ai` 两类。
- 本地编辑、自动写回、评论、导出、历史恢复、失败、取消和冲突未采用都不建版。
- no-change、失败、取消和冲突未采用也不创建下一份可见 Version Working Copy。
- 新版提示只在新工作文件、不可变快照、画布 Hash 一致且 canonical path 已切换后显示。
- 历史查看永远只读且只打开精确 Version 路径。
- 每个历史版本可一键在文件夹中打开精确、经过验证的可见 Working Copy；隐藏快照不作为产品 Finder 入口。
- “基于此版本继续编辑”只重用该 Version 原有工作文件；已写入历史激活回执后，失败只能同一操作向前恢复，不得把该工作文件回滚为较新的活动 Version。
- 连续两次 AI 成功后，原始 HTML 与第一份工作文件逐字节不变，项目当前路径指向第二份工作文件。
- 历史页不提供恢复或覆盖当前 HTML；需要以旧快照开始时，将其作为普通文件登记为新的 Document 与 V1。

### 10.5 事务、候选检查与干净切换

- 每个事务故障点均能恢复到完整旧态或完整新态。
- 无 commit marker 的候选不出现在历史。
- 身份、协议、路径、Hash、完整文档和可显示 body 属于硬校验，失败时不创建 Version、不消耗候选号；候选脚本内容不参与校验或提示。
- 与上一版连续性证据不足写入 `candidate-assessment.json` 的 `attention`，不阻断候选 Version，但必须先审阅且不能直接打开。
- 历史 Version 或已归档终态的已知 Developer Preview assessment 使用任一旧形态时，只有冻结 base、不可变候选证据和四个 Hash 均可重现才可在内存中按当前规则读取；退役字段及脚本结论必须移除，不得修改旧 Attempt 或复活终态。
- 评论 TargetRef 只指导生成、审阅和历史解释；目标外正文、属性、普通结构与样式联动不再单独生成失败或 waiver。
- 失败与 no-change 返回编辑后仍可从“上轮处理”恢复，重启后行为一致；界面不显示内部英文异常或校验代码串。
- v3 运行时、前端历史和发布包不包含旧 Schema Reader、migration report 或 legacy marker 分支。
- 0.6.1 与切换前数据已有独立只读归档，可用于整体回退。

### 10.6 PR 2B 项目、版本与 Finder

- Registry 有 A/B 且 Recent 仅有 A 时，左侧项目列表仍显示 A/B；Recent 只影响排序，未登记 Recent 文件不能成为项目。
- 顶栏不显示保存状态徽章、状态文字或项目管理入口。Version、项目最新版本、本地修改和 Candidate 身份仍由左侧版本树、标签页、对话侧栏与历史画布表达；保存失败和冲突进入全局恢复提示。
- Version Finder 命令定位该 Version 的可见 Working Copy；左侧栏负责打开或切换 HTML，隐藏不可变快照和 `.pageroot/requests/...` 不作为产品入口。
- `AI任务/` 只由验证后的冻结 Prompt/Candidate 生成；删除、篡改、软链接或用户占位不能改变隐藏 Candidate，也不能阻止按隐藏 Hash 审阅和 Promotion。重试只能重建安全投影或选择新展示目录。
- P2 不创建 `附件与图片/`、附件快照说明、附件 Finder 定位或回收区；这些可见附件体验属于 P3，现有附件冻结正确性保持。
