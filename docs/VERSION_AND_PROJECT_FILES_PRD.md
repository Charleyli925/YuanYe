# PageRoot 版本与项目文件产品需求

> Current durable binding amendment: persisted `device / inode / birthtime`
> observations do not gate project availability or writes. Within the configured
> Projects root, unique stable identity, registered member paths and verified
> content evidence recover renamed/copy-moved projects automatically. Duplicate
> project identities isolate that project while catalog browsing remains usable.
> Hidden hard links locate renamed members and support explicit no-overwrite
> missing-file restoration. This supersedes the older physical-identity and
> duplicate-copy rows below; detailed current rules: `SECURITY_MODEL.md`, section
> “V4 Registry and managed-root authority”. Outside-root writes remain forbidden.


- 文档版本：PRD v1.4
- 最近更新：2026-08-31（Asia/Shanghai，UTC+8）
- 状态：产品规则已确认，按两期串行实施
- 适用范围：桌面版本地 HTML 导入、持续编辑、评论与附件、AI 候选审阅、正式版本历史、Registry 项目目录与 Finder 体验
- 关联文档：[MVP 产品需求](MVP_PRD.md)、[交互流程](INTERACTION_FLOW.md)、[Change Request 协议](CHANGE_REQUEST_PROTOCOL.md)、[ADR 0022](decisions/0022-user-owned-project-root-identity.md)、[ADR 0024](decisions/0024-registry-catalog-and-ai-task-projections.md)、[首次打开导入确认](IMPORT_CONFIRMATION_PRD.md)

本文定义下一阶段目标规则。桌面打开路径只承认有效 v4 Project；所有 v4 以前的项目状态均不兼容，不迁移、不恢复、也不作为读取回退。任何不属于有效 v4 Project 的 HTML 都从新 v4 Project 的 V1 开始；实施本 PRD 时必须同步更新关联协议、Schema、测试和 ADR，不能只修改界面文案。

## 0. PR1–PR10 后的文件与历史合同

1. 外部原 HTML 与隐藏 V1 快照保留首次导入时的原始字节，且不写入 PageRoot Stable ID。
2. 项目内可见的 V1 Working Copy 会物化 Stable ID，因此不保证与外部原稿或隐藏 V1 逐字节相同。
3. AI Candidate 在晋升前完成 Stable ID 归一化；AI 产生的不可变 Version 保存完整的已采纳 Candidate HTML。手动历史创建原样复制所选不可变快照；若旧快照没有 Stable ID，新 Working Copy 在打开时沿用现有身份物化，快照字节保持不变。Stable ID 不回写外部原文件。
4. V2+ 新 Working Copy 建立时与对应 Version 快照逐字节一致；之后本地编辑只修改 Working Copy，不改写已建立的 Version 快照。
5. 文件菜单保留一个上下文导出入口：当前页“导出当前 HTML…”复制完整 Working Copy（包括 Stable ID）；历史页“导出此版本…”复制正在查看的不可变快照。导出不改变项目、Version、评论、Registry、Recent 或当前打开文件。
6. Undo/Redo 仅属于当前打开文档的会话历史；普通自动保存可以保存结果 HTML，但不创建正式 Version，且历史不跨切换、关闭或重启恢复。

`baseSha256`、`currentSha256` 和 `differsFromBase` 继续只表达实际存储字节关系；它们不是单独的用户可见修改徽标或第二套项目状态系统。

## 1. 产品结论

PageRoot 必须把以下三件事分开：

1. **本地编辑与保存**：用户修改文字、样式、结构、评论、附件或项目资料后，系统立即持久化，不丢数据。
2. **AI 候选**：用户把本轮评论发送给 AI，AI 返回一份待审阅 HTML；它尚不是正式版本。
3. **正式版本**：用户明确采纳有效 AI 候选，或明确从历史快照创建新稿后，系统创建下一个正式版本。

核心规则如下：

> 保存不等于晋升版本。正式版本是不可变里程碑；本地编辑持续保存在“基于该版本的工作文件”中。明确采纳 AI 候选和明确从历史创建新稿，是初始导入之后的两种建版方式。

项目是容器，版本是项目内的历史节点。历史默认为独立只读浏览；明确创建后才切换工作文件。例如最新 V6，查看 V2 后确认创建 V7：

```text
V1 → V2 → V3 → V4 → V5 → V6 → V7（历史创建，之后本地编辑持续保存）
      └───────────────────── 内容来源 ──┘
```

V7 记录 `basedOnVersionId=ver_0002` 和 `previousVersionId=ver_0006`。存量项目已经在旧工作稿上编辑的情况保留，不因升级自动跳到最新版本。

这两个字段不能合并，否则无法同时解释“从哪里改”和“它何时成为最新版本”。

## 2. 背景与问题

现有产品和协议存在四类混淆：

1. 界面显示“版本 2”，工作文件却使用 `V1.1`，用户需要理解两套编号。
2. 当前文件路径、最新正式版本、正在查看的历史版本和内容 Hash 恰好匹配的版本，可能被一个含糊的“当前版本”状态混用。
3. 用户打开历史 HTML 时，系统可能因为路径别名、Hash 识别或异步切换而跳到另一份 HTML，造成版本身份和画布内容不一致，甚至出现切换卡死。
4. 项目技术记录、用户 HTML、AI 返回文件、评论附件和图片没有形成清晰的用户目录合同。

本 PRD 的目标不是减少正确性校验，而是让每项校验只回答一个问题：

| 校验 | 只负责回答 |
|---|---|
| 项目身份 | 这份文件属于哪个项目 |
| 版本身份 | 用户明确打开的是哪个正式版本或工作文件 |
| 内容 Hash | 当前字节是否与某个不可变快照完全相同 |
| 路径校验 | 本次读写是否发生在允许的具体文件 |
| 并发校验 | 保存或采纳前，基础内容是否已被其他操作改变 |

Hash 相同只能说明内容相同，不能让系统把用户选择的文件“别名跳转”为另一份文件。打开谁就显示谁，是最高优先级的界面事实。

## 3. 目标与非目标

### 3.1 目标

- 所有用户修改都可恢复、可自动保存，不因“尚未形成正式版本”而丢失。
- 正式版本一旦建立，其隐藏快照永远不被本地编辑覆盖。
- 用户可从任意历史版本继续工作，并始终看见“当前基于版本几”。
- 用户打开某一份 HTML 时，画布必须显示这份文件的精确内容，不自动切换到最新文件或同 Hash 文件。
- 界面、Finder 文件名和内部 ordinal 只使用一套连续整数版本号。
- 用户能在默认的 PageRoot 项目目录中找到版本工作 HTML、项目 Markdown 和 AI 待审阅文件；可见评论附件与图片属于 P3。
- 用户可以在配置项目目录内重命名项目文件夹，也可以对项目内的受管 HTML 改名、移出后放回；在可安全唯一识别时，系统低打扰地恢复原项目和 Working Copy 关系。
- 首次导入成功后，界面明确告知文件已经进入 PageRoot，并提供“在文件夹中打开”。
- 导入、保存、冻结 Request 和采纳候选均具备原子性、冲突检测和崩溃恢复。
- 新规则能够逐步引入，不静默移动或破坏旧项目、旧 Request 和旧版本证据。

### 3.2 非目标

- MVP 不提供“覆盖当前版本”“恢复并删除后续版本”或改写历史。
- MVP 不提供分支命名、合并、变基或 Git 概念。
- 不提供任意保存即建版或空白手动建版；只增加明确从历史快照创建新版本的能力。
- MVP 不因每次按键、自动保存、添加评论或发送 AI 而递增正式版本号。
- MVP 不删除正式版本，也不复用被拒绝候选的身份作为历史事实。
- MVP 不把 PageRoot 扩展为任意多文件网站编辑器；当前仍以可安全管理的单 HTML 文档为边界。
- MVP 不静默改写 HTML 来重定向外部资源，也不承诺复制后仍能解析任意绝对或相对依赖。
- MVP 不把单个 HTML 移入另一个项目后自动合并项目，也不允许用户任意重排、修改或删除 `.pageroot/` 中的技术文件。
- MVP 不把整个项目文件夹移出配置项目目录后的新位置继续识别、重新关联或写入，也不承诺跨磁盘移动项目。
- MVP 不接管复制到其他位置的项目文件夹，不为重复 `projectId` 提供副本选择或自动重签身份，也不在整个磁盘中后台搜索丢失项目。

### 3.3 分期交付与串行边界

本 PRD 的长期目标不因分期而删除；每个验收项会以 `[第一期]`、`[第二期]` 或 `[后续]` 标明其最早交付期。两期必须串行：PR 2 只能基于已经合并并完成验证的 PR 1，不能在未验证的身份或版本模型上叠加历史与文件体验。

| 阶段 | PR 范围 | 不在本阶段扩张的内容 |
|---|---|---|
| 第一阶段（PR 1） | 稳定项目/文档身份、原子导入、持续保存、Candidate 与用户采纳晋升、配置目录内项目文件夹改名、受管 HTML 改名/移出/放回恢复、精确打开状态机 | 整个项目文件夹跨目录或跨磁盘移动后的继续管理、历史继续编辑、完整项目列表、多文件可见性 UI |
| 第二阶段（PR 2） | 历史继续编辑、正式版本独立工作文件、Registry 全量项目目录、可见 AI任务、完整顶部状态和项目体验 | 可见附件与图片、附件 Finder 定位与回收区（P3），v4 以前项目状态的处理、完整项目克隆、多文件网站 |
| 后续 | 完整项目克隆、资源包/多文件网站 | v4 以前项目状态继续保持不兼容，不在 PR 1 或 PR 2 中隐式实现 |

第一期的 Candidate 权威数据始终位于 Request / Attempt 与 `.pageroot/`；它不以 Finder 可见的 AI 任务文件夹作为写入或身份事实。PR 2B 的 `AI任务/` 与完整项目界面是第二期的派生展示；可见附件目录、附件 Finder 定位与回收区明确留到 P3。它们都不得反向成为 Request、Candidate、Version 或 Promotion 的权威来源。

PR 1 内部按“文档与 Schema → Repository → Workflow → 最低限度 UI → 故障注入”形成可回退的清晰提交；该顺序不是新的运行时全局 Store。状态仍由现有 `ProjectSession`、`DocumentSession` 与 `VersionSession` 各自拥有并扩展。

## 4. 产品术语

| 名称 | 用户是否需要看见 | 定义 |
|---|---:|---|
| 项目 Project | 是 | 围绕同一页面长期工作的容器，拥有版本、工作文件、评论、附件和 AI 任务 |
| 正式版本 Official Version | 是 | 初始版本 1，或用户采纳 AI 候选后形成的不可变里程碑 |
| 历史快照 Historical Snapshot | 否 | 正式版本对应的不可变 HTML 字节，存放在隐藏管理目录中 |
| 版本工作文件 Version Working File | 是 | Finder 中可编辑的 `<名称>-Vn.html`，初始内容基于正式版本 n，之后可持续本地修改 |
| Working Copy | 否 | 系统对版本工作文件、保存状态和草稿的内部状态对象；界面不使用该术语 |
| 评论草稿 Draft | 否 | 尚未冻结发送的评论、附件和本轮项目要求 |
| Request | 可在任务详情中看见 | 用户发送 AI 时冻结的精确输入、评论、附件和基础 HTML |
| Candidate | 是 | AI 返回并通过基础校验、等待用户审阅的完整 HTML |
| 正式版本晋升 Promotion | 是 | 用户明确采纳 Candidate 后，原子创建下一正式版本的动作 |

### 4.1 “编辑”和“保存”的定义

下列行为属于持久化动作，但不创建新的正式版本：

- 修改文字、样式、同级排序或受支持的结构。
- 撤销、重做后形成新的当前内容。
- 新增、修改、删除评论。
- 添加、删除评论附件或图片。
- 修改可见的项目 Markdown。
- 在 PageRoot 管理的 HTML 上进行受支持的外部文件修改，并按无歧义自动采用或双边冲突确认规则进入当前 Working Copy。

“尚未形成正式版本”不等于“临时且可以丢弃”。所有上述内容都必须保存，并在应用重启后恢复。

### 4.2 正式版本的创建条件

正式版本只在三个时点创建：

1. 一份外部 HTML 第一次被正式导入 PageRoot 时，创建版本 1。
2. 用户明确采纳一份有效 AI 候选时，创建下一个整数版本。
3. 用户明确从历史快照创建新稿时，创建下一个整数版本（`sourceType=history-copy`），不创建 AI Request 或 Candidate。

仅点击“发送给 AI”不会创建正式版本；AI 返回也不会自动创建正式版本。候选被拒绝、失败、取消或无有效变化时，正式版本序号不增加。


### 历史创建：E 的事务合同与 F 的入口切换

E 提供应用命令和持久化能力，F 已接通用户入口。本文旧第二期中“重新激活历史工作稿”的描述仅保留为存量状态/兼容实现说明，不再定义产品的历史编辑入口；升级不会把正在编辑旧工作稿的用户暗中切到最高版本。

从 V1～V8 中所见的 V3 创建，Repository 分配 V9，记录 `basedOnVersionId=ver_0003`、`previousVersionId=ver_0008`。`sourceOperationId` 记录本次操作，`sourceRequestId` 和 `sourceCandidateId` 为 null。旧工作稿、草稿、附件及项目级 PROJECT.md 保留，新稿草稿为空。

- 创建前验证 Registry、项目/文档、当前工作稿及其预期 Hash、所见历史快照 Hash，并阻止未完成 AI 任务和待处理 Candidate。
- `.pageroot/transactions/history_<operationId>/transaction.json` 持有唯一创建意图。序号在后端分配，准备文件通过不覆盖的链接发布；文件名碰撞重新分配可见名称，不改版本序号。manifest 是建版提交点。
- 同一操作重复请求必须返回同一 Version；复用操作 ID 却改变来源或预期 Hash 会拒绝。恢复完成已有事务，不为丢回执分配新版本。
- 提交前已确认的来源变化会终止该操作，记录 `aborted` 并退役未提交的私有记录。为避免删除外部程序已替换的文件，已发布但未纳入 manifest 的可见准备文件保留；下一次明确创建使用新操作 ID，并避让已有文件名。
- 结果查询明确返回 `not-created` 或 `created`；网络或验证未能确认时应用保留 `unknown` 和同一操作 ID。`created` 回执不要求画布成功，也不重新激活已完成操作的旧文件。
- `openedAt` 是单独的打开确认；已创建未打开可以继续打开同一稿。运行时仅保存最后创建操作的定位信息，事务记录和 manifest 才是持久化结果。

F 的历史工具栏“编辑”和“创建新版本并编辑”打开同一确认：“基于 V3 创建新版本？新版本将作为当前编辑文件，原有版本保留。”取消不调用创建；确认后关闭提示框不代表取消磁盘事务。

创建结果未知时只查询同一操作；已创建但打开失败时只打开已创建版本，不能再建。完整工作区通过生产 decoder、文件身份与 Hash 校验后，现有 managed-source transition 一次发布当前内容、版本和草稿；画布确认成功后记录独立 openedAt。重启读取 runtime 的操作定位并查询事务结果，未确认打开的版本保留恢复入口。项目切换使迟到打开结果失效。

历史菜单“导出此版本…”使用 VersionSession 中校验过的快照字节；“在 Finder 中显示当前工作文件”和“在浏览器中打开当前工作文件”明确指向后台工作文件，不声称它等于所见快照。侧边栏既有版本文件定位仍定位可见工作文件。历史动态预览传输失败时可显示禁止脚本的静态内容并刷新重试，不将其认定为创建失败。

这是一项 v4 可选字段扩展，不迁移旧记录、不重编号、不改写旧快照。旧版本来源未声明 `sourceType` 时继续按既有初始/AI 记录解释；新 `history-copy` 来源需要支持本合同的客户端。

## 5. 统一版本编号与文件命名

取消“界面版本 2、文件 V1.1”的双重编号。

| 对象 | 统一规则 | 示例 |
|---|---|---|
| 界面版本 | `版本 <ordinal>` | `版本 2` |
| 正式版本内部 ID | `ver_<四位 ordinal>` | `ver_0002` |
| 用户可见工作文件 | `<当前首选文件名主干>-V<ordinal><当前扩展名>` | `产品首页-V2.html` |
| AI 待审阅文件 | `<当前首选文件名主干>-V<nextOrdinal>-待审阅<当前扩展名>` | `产品首页-V7-待审阅.html` |
| 正式版本说明 | `版本 <ordinal> · 基于版本 <baseOrdinal>` | `版本 7 · 基于版本 2` |

规则：

- 第一次导入时，以外部文件的主干和 `.html` / `.htm` 扩展名建立当前首选命名；例如 `产品首页.htm` 首次成为 `产品首页-V1.htm`。
- 项目文件夹改名只改变项目显示名，不改变 HTML 的当前首选主干。例如项目文件夹从 `A` 改名为 `我的作品` 后，下一正式版本仍沿用 HTML 自己的命名。
- 受管 HTML 在项目根目录内完成可信改名后，manifest 更新相对路径、当前首选主干和扩展名；稳定 `workingCopyId` 不变，未来 Candidate 与 Promotion 继承新名称。例如 `A-V1.html` 改为 `B-V1.html` 后，下一正式版本优先创建 `B-V2.html`。
- 推导首选主干时，只移除与该 Working Copy 当前 ordinal 完全匹配的末尾 `-Vn`。例如 `B-V1.html` 得到 `B`，`B.html` 得到 `B`，`产品-final-V1.html` 得到 `产品-final`；文件名永远不反向决定身份。
- 版本 1 的工作文件叫 `<名称>-V1.html`，第一份被采纳的 AI 文件叫 `<名称>-V2.html`。
- 不再新建 `V1.1`、`V1.2` 等用户文件名。
- 内部 ID 可使用补零形式，但 ordinal 必须和界面、文件名一致。
- 候选尚未被采纳时只显示“候选版本 N”，不能显示成已经存在的“版本 N”。
- 被拒绝的候选不占用正式版本序号；下一次发送仍可生成“候选版本 N”。每个候选另有稳定 `candidateId`，避免内部身份复用。
- 如果首选 Promotion 路径已经存在，不覆盖、不复用、不提示用户，继续追加同一版本后缀直到得到空闲名称。例如 `A-V2.html` 已存在时创建 `A-V2-V2.html`；仍冲突则创建 `A-V2-V2-V2.html`。
- 目录、软链接或任何文件都算路径已占用。Promotion 先持久记录候选可见相对路径、私有准备路径、首选命名、分配 ordinal、Candidate Hash、身份物化后 Working Copy Hash、准备文件身份和严格 Working Copy 对象；AI Candidate 在晋升前完成 Stable ID 归一化，不可变 Version 保存完整的已采纳 Candidate HTML，私有准备 Working Copy 以同一已归一化字节建立。私有准备文件属于该事务，但候选可见相对路径在成功发布前尚未冻结。必须以操作系统级 no-replace 发布私有准备文件：仅当最终 `link()` 返回 `EEXIST` 时，才持久记录下一个同 ordinal 后缀路径并重试；其他错误立即失败关闭并保留 Candidate。成功发布后，该可见路径才成为唯一冻结路径，崩溃恢复必须复用它。实现可设置有限但足够高的冲突尝试上限；到达上限同样失败关闭。准备文件或已发布文件被替换、manifest 出现不可解释的正式 ordinal 冲突时，均不得覆盖或删除用户文件。

## 6. 默认项目目录

### 6.1 根目录与项目名

新项目默认建立在：

```text
~/Documents/PageRoot/项目/<项目名称>/
```

项目名称默认取第一次导入 HTML 的文件名，不含 `.html` 或 `.htm`。

- 例如首次打开 `复杂HTML综合测试页.html`，项目文件夹默认叫 `复杂HTML综合测试页`。
- 同名项目使用用户可理解的 Finder 规则：`复杂HTML综合测试页 (2)`、`复杂HTML综合测试页 (3)`。
- `~/Documents/PageRoot/项目/` 是配置项目目录；Registry 为每个 `projectId` 登记其中唯一一个可写项目根目录。PageRoot 只管理这个登记根目录内由 manifest 或明确技术合同注册的文件。
- 项目文件夹名就是用户看到的项目名。在配置项目目录内重命名该文件夹时，PageRoot 可唯一确认后更新 Registry 登记路径和界面项目名，`projectId` 不变；该操作不重命名任何 HTML。
- 将整个项目文件夹移出配置项目目录或跨磁盘移动后，新位置不再是受管项目。PageRoot 不搜索、不定位、不重新关联，也不向新位置写入；将整个项目文件夹复制到其他位置同样不接管副本。
- `.pageroot/project.json` 中的 `projectId` 只在 Registry 登记的项目根目录内证明项目身份；复制到未登记位置的同一 ID 不获得写入授权。一个 `projectId` 同一时刻只允许一个登记根目录，禁止原目录与副本双写。
- Registry 因而不是普通“上次位置缓存”，而是 `projectId → registeredProjectRootPath` 的位置与写入白名单；当前 `ProjectSession` 只投影本次打开的有效绑定。
- 重命名项目内的受管 HTML 不自动重命名项目文件夹，也不创建 Version；HTML 所属 Version / Working Copy 由 manifest 的稳定 ID 确定，文件名只影响后续可见文件命名。

### 6.2 PR 2B：Finder 默认可见内容

本节是 PR 2B 的用户可见投影，不是第一期的目录承诺。第一期只以根目录工作 HTML、`PROJECT.md` 和隐藏 `.pageroot/` 中的受管记录完成身份、Request、Candidate 与 Promotion；AI 不直接创建 Finder 可见的正式版本或候选权威文件。可见附件与图片、附件 Finder 定位和回收区属于 P3。

```text
~/Documents/PageRoot/项目/复杂HTML综合测试页/
├── 复杂HTML综合测试页-V1.html
├── 复杂HTML综合测试页-V2.html
├── PROJECT.md
├── AI任务/                         # PR 2B 只读派生展示
│   └── 2026-08-15-候选版本3/
│       ├── PROMPT.md
│       └── 复杂HTML综合测试页-V3-待审阅.html
└── .pageroot/
    ├── project.json
    ├── manifest.json
    ├── versions/
    ├── working-copies/
    ├── drafts/
    ├── requests/
    ├── transactions/
    ├── recovery/
    ├── runtime-state.json
    └── audit/
```

用户默认需要看见：

- 所有版本工作 HTML。
- 当前项目的关键 Markdown。
- AI 返回、尚待审阅的完整 HTML 和该轮可读 Prompt。`[PR 2B]`
- 用户评论中上传、拖入或粘贴的附件与图片。`[P3]`

用户默认不需要看见：

- 不可变正式版本快照。
- Hash、Schema、锁、事务日志、恢复记录、内部 ID 映射。
- Request 的机器输入副本和附件不可变快照。

这些技术记录统一放入 `.pageroot/`。macOS Finder 默认隐藏以点开头的目录，但系统仍必须设置权限边界和路径校验，不能只依赖“看不见”。

项目根目录也允许用户自行增加其他文件或文件夹，但这些内容默认属于用户：

- PageRoot 只读写 manifest 或明确技术合同中已注册的相对路径；未知文件不得因名称、扩展名或 Hash 相同而被自动纳入。
- 用户新增的其他文件必须原样保留，PageRoot 不对其做版本化、冻结、恢复、改名或删除。
- 用户新增的额外 HTML 按外部 HTML 处理；打开只精确查看，第一次持久化时另行导入新项目，不并入当前项目。
- 每次写入仍须通过登记项目根目录、真实路径包含关系和无软链接逃逸校验。

### 6.3 Markdown 文件

- `PROJECT.md`：唯一由用户长期维护的项目规则、背景和约束；新项目首次打开时预填“项目目标、目标受众、内容与事实规则、视觉与表达、AI 修改边界”五段简洁 Markdown 模板。用户可随时编辑或清空为零字节。它不预填系统规则，也不承担身份或事务职责；它独立于 HTML 版本时间线，单独导出 HTML 时不附带该文件。
- `AI_RULES.md`：PageRoot 维护的稳定 AI 行为边界，例如冻结输入、唯一输出、附件、完成与取消规则。它是 Request 输入，不复制到 `PROJECT.md` 或每轮 Prompt。
- `PROMPT.md`：当前 Request / Attempt 的精简入口，只包含本轮身份、读取顺序、当前附件/补充、唯一输出路径和 finalizer 命令；它引用 `AI_RULES.md`，不得重复稳定规则或要求 AI 推导文件名、版本号。
- `.pageroot/requests/<requestId>/PROMPT.md`、冻结的 `input/PROJECT.md` 与 `input/AI_RULES.md` 是机器执行记录；PR 2B 的 `AI任务/<轮次>/PROMPT.md` 只复制已经冻结的精简 Prompt，不重新拼接稳定规则，且不改变任何权威路径。

## 7. 首次打开与导入

> 打开未登记且未绑定的 HTML 时先确认再导入；默认复制，可选在新画布确认后将原稿移入废纸篓。同一 canonical 外部路径若已有唯一项目绑定，再次打开显示“这个文件之前已经导入过了”并打开之前的项目，不再建第二个项目。规范与验收见 [首次打开导入确认](IMPORT_CONFIRMATION_PRD.md)。

### 7.1 打开时分类并确认

用户从 Finder 或“打开文件”选择 HTML 时，PageRoot 先只读分类，确认前不写入活动文件或 Registry：

- 有效 v4 Project 按当前项目打开和恢复，不出现导入确认。
- 已绑定的外部原路径再次打开时显示关联确认，主操作打开该唯一项目的当前活动 Working Copy，不分配新 `projectId`，也不因 V1 已编辑、已晋升或活动 Working Copy 已切换而失败。
- 其他任何未绑定状态（包括 v3 及更早项目状态、损坏的 v4 记录、同内容的另一路径，以及从未管理过的 HTML）显示首次导入确认；用户确认后才建立新的 v4 Project 与初始 V1。
- 导入不移动、不覆盖、不改名或改写用户选择的原始 HTML 字节；只有用户勾选删除且新画布已确认，才把该原稿移入废纸篓。v4 打开路径不迁移、不恢复、也不读取 v4 以前的项目状态。

### 7.2 确认后的导入事务

用户确认导入后，打开流程必须按以下顺序原子完成：

1. 再次读取外部 HTML，并验证它没有在预览后被外部修改。
2. 分配唯一项目目录和内部 `projectId`，先在 Registry 写入带登记根目录的 `pendingImports` 意图；此时尚未让任意目录取得写入授权。
3. 仅在私有 staging 目录原样复制 HTML 字节到隐藏的版本 1 快照；该 V1 快照不含 PageRoot Stable ID。可见 `<名称>-V1.html` 工作文件在同一事务中物化 Stable ID，全部 v4 元数据仍在该目录内生成。
4. 原外部 HTML 再次校验后，将完整 staging 目录原子发布到该登记根目录。
5. 由该 Registry pending intent 验证已发布目录的项目/文档 ID，写入正式 Registry 白名单并清除 pending intent；恢复器只处理这种意图，绝不扫描任意副本的 `import.json`。
6. 将当前打开目标切换到 PageRoot 内的 V1 工作文件，并发布该新 v4 Project 的身份。
7. 显示初始 V1 已建立；后续编辑、评论、附件和 AI 请求全部只针对这个新的 v4 Project。

任一步失败：

- 原外部文件保持不变。
- 不对外宣布导入成功。
- 不应用一半修改，也不留下已注册但不可打开的项目。
- 可恢复的临时目录由事务恢复器完成或清理，不能靠扫描猜测项目身份。

### 7.3 导入后的提示

导入成功后，版本区立即显示：

> 版本 1 · 已导入 PageRoot　[在文件夹中打开]

交互规则：

- 首次成功时显示一次约 5 秒的完整成功提示。
- 只要项目最新正式版本仍是版本 1，紧凑状态“已导入 PageRoot”和“在文件夹中打开”在每次打开项目时都保留。
- 第一次采纳 AI 候选并产生版本 2 后，“已导入 PageRoot”状态自动退出；“在文件夹中打开”仍保留为项目常驻操作。
- 用户不需要理解内部复制路径；点击操作直接打开该项目的用户可见根目录。

### 7.4 外部资源安全边界

导入不得为了让页面“看起来正常”而改写原 HTML 字节；相对资源也不能决定这个 HTML 是否可以成为新的 v4 Project：

- 任何完整 UTF-8 HTML 都直接建立原字节的 V1，原外部 HTML 和其相对资源均不被写入、移动或纳入 v4 管理。
- 相对资源的可用性只影响预览，不影响 v4 身份或导入结果；缺失资源不能把 HTML 降级回外部只读状态。
- 多文件网站、资源包复制、重写或长期管理仍须由单独的资源包合同定义；本阶段不借导入读取、写入或跟随这些资源。

## 8. 本地编辑与持续保存

### 8.1 工作文件与正式快照

每个正式版本包含两份角色不同的 HTML：

| 文件 | 可否编辑 | 用途 |
|---|---:|---|
| `.pageroot/versions/ver_0002/index.html` | 否 | 版本 2 的不可变历史事实 |
| `复杂HTML综合测试页-V2.html` | 是 | 基于版本 2 的当前本地工作文件 |

V2 工作文件第一次建立时与 V2 正式快照逐字节一致。V2 正式快照来自晋升前已完成 Stable ID 归一化的完整 Candidate HTML，因此两者都可以包含 Stable ID。此后用户只修改 V2 工作文件，系统持续保存，但隐藏快照保持不变。

界面状态示例（仅表示当前打开动作与保存过程，不表示基线字节差异）：

- `版本 2 · 只读快照`
- `基于版本 2 的本地编辑 · 已保存`
- `基于版本 2 的本地编辑 · 正在保存…`
- `基于版本 2 的本地编辑 · 保存失败`

“Working Copy”只用于内部模型。界面使用“本地编辑”“已保存”等普通语言，避免引入新的用户概念。

### 8.2 自动保存

- 所有受支持的直接编辑都自动保存到当前版本工作文件。
- 关闭窗口、切换项目、发送 AI 和退出应用前必须形成持久化边界。
- 保存成功后，重启应用应恢复相同 HTML、评论、附件和持久审计状态；当前打开 HTML 的 20 步撤销栈不跨重启恢复。
- 保存失败必须保留内存草稿和恢复信息，并禁止发送基于错误文件的 AI Request。
- 保存工作 HTML 时不得以无条件替换覆盖可见文件：系统先在私有恢复目录保留旧源字节，再以 no-replace 方式发布已验证的新字节。窗口期出现的外部写入必须保留并报告冲突；即使外部编辑器持有已停放旧 inode 的文件描述符并在发布后继续写入，清理前也必须复验并保留该恢复副本，不能删除。若进程已写入 `committed` 但私有恢复目录仍在，重开时也必须先做同一复验，不能跳过为已完成。崩溃恢复只能完成已安全停放的事务或恢复旧字节，不能猜测或删除外部文件。
- `Cmd+S` 可立即触发同一保存机制，但不创建正式版本。

### 8.3 从历史版本开始新迭代

历史查看和编辑是两个动作。打开版本 2 时精确显示 V2 的不可变快照，保持只读且不替换当前 DocumentSession。工具栏“编辑”先确认创建下一正式版本；取消保持历史视图和原工作文件。确认后使用现行历史创建事务，由 create、query 和 openCreatedHistoryVersion 完成创建、结果核对和打开。创建结果未知时只查询同一 operation，已创建但打开失败时只重试打开，不分配第二个版本。

Finder 定位历史 Version 的可见工作文件仍执行受控重命名恢复：只有稳定 `workingCopyId` 和同根唯一文件标识足以核对，才更新 manifest；不能改为定位隐藏快照或猜测另一份 HTML。

旧版本已经写入的 `historyActivation` 保持兼容：当前 Renderer 不再提供旧激活命令；旧 `/history-version/continue` 只能重放匹配的存量回执，不能创建回执或更换活动工作稿。项目、文档、Version、前序和目标 Working Copy 必须完整一致；缺失或不匹配时，在任何 Workspace 恢复、改名修复或外部源协调之前拒绝。重复点击返回原 operation ID；桌面确认只将原回执从 pending 改为 confirmed 一次，重复确认返回 `confirmed: false`。

存量项目若最新正式版本为 V6、活动工作稿仍基于 V2，重启、打开和保存继续保留该 V2 工作稿，不因最新指针或相同 Hash 跳到 V6，也不改写不可变 V2 快照。以后明确采纳 Candidate 创建 V7，其谱系仍为 `basedOnVersionId=V2`、`previousVersionId=V6`。当前历史创建与 Promotion 成功时继续按各自既有事务清除旧激活回执；不批量迁移历史记录。

### 8.4 从 Finder 打开与受管 HTML 路径变化

- 打开 Registry 登记项目根目录中的可见 HTML 时，PageRoot 读取该根目录的 `.pageroot/project.json`，再通过 `.pageroot/manifest.json` 中稳定的 `versionId` / `workingCopyId` 确认它是哪一份工作文件；`<名称>-V2.html` 只是默认可读名称，不承担身份判断。
- 用户在登记项目根目录内重命名受管 HTML 时，可信且唯一的重新识别应静默更新 manifest 相对路径和首选命名，继续进入同一 Working Copy；不创建新项目或 Version。Candidate 已待审阅但尚未采纳时，Promotion 也使用采纳时最新确认的首选主干。
- 单个受管 HTML 被移出登记项目根目录后立即变为未受管外部文件，PageRoot 不向外部位置写入。若它是当前打开文件，系统暂停保存、保留内存修改并只显示一个非重复打扰的“文件暂不可用”状态。
- 文件原样放回旧相对路径且内容未变时，即使 inode 已改变，也应在校验登记项目、Working Copy 和 Hash 后静默恢复。
- 文件以新名称放回登记项目根目录时，只要受控身份线索能唯一确认，就静默重绑定、更新首选命名并继续保存；只有存在两个以上合理候选或身份线索冲突时才要求用户选择一次。
- 文件在外部被修改后放回时，仍可恢复为原 Working Copy：PageRoot 内没有未保存修改时自动采用磁盘变化；两边都已修改时保留两份字节并进入真正的内容冲突处理，不得静默覆盖。
- 文件留在项目外部并被再次打开时，系统重新执行有效 v4 Project 检查；未通过时立即按新外部来源建立新的 v4 V1，不回写、合并、重新关联或迁移原项目。单个 HTML 被移动到另一个项目根目录时同样不自动合并。
- workspace 先恢复登记项目，再解析可见源，确保保存中暂时缺失的源和未收口的 Promotion 能恢复。解析后仅在项目 ID、文档 ID 和规范根路径完全一致时复用这次恢复；不同目标仍独立恢复，后续目标和元数据继续重新校验。
- 打开隐藏不可变快照时，只允许历史只读查看。
- PR 1 的受管工作 HTML 只位于登记项目根目录的可见顶层；不借本规则扩展任意嵌套 HTML 或多文件网站管理。
- Hash 只校验内容和冲突，不能在多个路径间决定身份；无法唯一确认时保持未受管，直到用户明确操作需要一次选择。

## 9. P3：评论附件、图片与可见文件体验

本节定义 P3 的可见附件目录、归档和 Finder 体验。PR 2B 继续保存当前评论附件、大小/数量限制与隐藏 Request 冻结快照，但不以此宣称已经交付可见附件目录、附件 Finder 定位或回收区。

### 9.1 保存与可见性

评论、附件和图片是本地工作的一部分：

- 新建或修改评论后立即保存到当前工作文件对应的草稿。
- 添加附件或图片时的 P3 可见副本复制到项目根目录的 `附件与图片/`，不能只留在系统临时目录。
- 保留用户原始文件名；重名使用 `文件名 (2).ext`，不静默覆盖。
- 每个可见文件都有内部稳定 `attachmentId`、内容 Hash、原始文件名、相对路径、所属评论和所属基础版本。
- 粘贴图片使用可读默认名，例如 `粘贴图片-20260812-153012.png`。
- 继续沿用安全限制：每条评论最多 10 个附件，单文件最大 25 MB；类型不支持或超限时，在复制前失败并说明原因。

### 9.2 目录组织

附件按“当前基础版本 + 本轮评论草稿”组织，而不是按正式版本结果反向猜测：

```text
附件与图片/
└── 版本2-本轮评论/
    ├── 首页参考.png
    └── 产品说明.pdf
```

P3 中当用户发送 AI 时：

- 当前评论及附件身份被冻结进 Request。
- `.pageroot/requests/<requestId>/` 保存不可变附件快照和 Hash。
- `AI任务/<轮次>/附件快照说明.md` 提供用户可读清单，但机器校验以隐藏快照为准；PR 2B 不创建此文件。
- 发送后用户删除或替换可见附件，不得改变已经冻结的 Request。

### 9.3 删除和归档

- Request 冻结前删除附件：从当前评论草稿移除，并把可见文件移入项目内可恢复回收区；不能直接永久删除。
- Request 冻结后删除可见附件：只影响后续草稿，不影响冻结 Request 和审阅证据。
- 用户采纳候选后：已发送评论和附件归档到该次 AI 任务；新正式版本建立一个空的新草稿。
- 用户拒绝候选后：原工作文件、评论与附件继续保留，可修改后再次发送。

## 10. 发送 AI、候选与正式晋升

### 10.1 发送边界

用户点击发送前，系统必须：

1. 完成当前 HTML、评论、附件和项目资料的保存。
2. 冻结当前工作文件的精确字节与 Hash。
3. 冻结 `basedOnVersionId`、当前最新正式版本 `previousVersionId`、评论和附件快照。
4. 建立稳定 `requestId`、`attemptId` 和 `candidateId`。
5. 仅把清单中允许的冻结输入交给 AI。

评论冻结沿用现有记录格式：唯一评论 codec 从运行态 `sourceAnchor` 输出兼容 `target` 与 `sourceAnchor`，保留可选文字定位、视觉说明、附件及未知扩展；这不是第二份运行状态。读取旧记录不批量重写 Draft、Request 或不可变历史。

发送本身不改变正式版本号。提交该 Request 的项目在 AI 处理期间进入只读处理态，避免同一冻结输入出现并发歧义；用户可以继续切换和编辑其他项目。MVP 中一个项目同一时间最多只有一个活动 Request 或待处理候选，避免多个候选争用同一个下一版本号。

### 10.2 候选身份

假设最新正式版本为版本 6，当前在 V2 工作文件上发送：

```text
候选版本：7
基于版本：2
前一正式版本：6
输入工作文件 Hash：<sha256>
```

AI 只能写入固定 Attempt 输出 `.pageroot/requests/<requestId>/attempts/<attemptId>/output/candidate.html`。它必须先完成身份、输出路径、完整 HTML、Hash、连续性和安全校验；通过 finalizer 后，隐藏 Request Candidate 记录才成为审阅事实。AI 不直接创建 Finder 可见的正式 Version 或其工作文件。校验通过后才显示：

> 候选版本 7 · 基于版本 2 · 待审阅

新的成功 finalizer completion 统一为 `completed`。合法完整 HTML 即使与冻结输入逐字节相同，也建立普通 Candidate，进入同一审阅流程，由用户明确选择采纳或不用；Hash 相同不再自动结束本轮。既有 `completion.json` 重放保持原字节，仍在 processing 的历史 v4 `no-change` completion 经当前校验后也进入 Candidate。

第一期的候选 HTML 与记录保存在 Request / Attempt 的隐藏路径中。PR 2B 的 `AI任务/<轮次>/` 只展示经校验后的派生副本，不能替代 Attempt 输出、Candidate 记录或 Promotion 输入：

1. Repository 先重新验证 Registry 绑定、Project/Document、Request/Attempt、Candidate 身份与 Hash、`proposedVersionId`、`basedOnVersionId`、`previousVersionId` 和项目根真实路径，才把已验证字节交给派生写入器。
2. 写入器先在 `.pageroot/recovery/ai-task-projections/` 持久记录投影收据，再排他创建 `AI任务/<日期>-候选版本N[/冲突后缀]/`；目录预检后出现的 `EEXIST` 同样视为用户/并发占用，必须保留该目录并分配新后缀。随后才以 no-replace 写入冻结 `PROMPT.md`；Candidate 通过 finalizer 后才以 no-replace 写入 `<主干>-Vn-待审阅.html`。
3. P2 不创建 `附件快照说明.md`、`附件与图片/`、`AI_RULES.md` 或 `PROJECT.md` 副本，也不创建正式 Version。`PROMPT.md` 只复制本轮已冻结的精简 Prompt。
4. 删除、篡改或用用户文件/目录/软链接占用派生位置时绝不覆盖；同一连续收据的完整投影可重建，冲突或篡改则分配新的安全展示目录。隐藏 Candidate、审阅和 Promotion 不读取此副本。
5. 产品 UI 的 Finder 命令只提交当前 `sourcePath`；Bridge 重新解析并验证后才返回位于已登记根的 `AI任务/<单一子目录>`。它不接受 Renderer 提供的 Request 路径，也不打开 `.pageroot/requests/...`。
6. `<主干>-Vn-待审阅.html` 是当前已验证 Working Copy 命名的展示结果，不是 Candidate 身份。若 Finder 在 `PROMPT.md` 发布后把同根 Working Copy 重命名，下一次投影会更新这一展示名，并仅在安全目录可复用时复用；已有不同展示文件时分配新的安全目录，绝不因此拒绝隐藏 Candidate、审阅或 Promotion。
7. 已终态的历史 v4 `no-change` 或不可用输出的 `error` 只保留运行时封存的 `lastAiTask` 展示锚点，不恢复活动 Request。应用重启后必须先用该锚点校验精确 Request 记录，再把它投影为“上轮处理”，从而仍可定位该轮 `AI任务/`；锚点缺失或校验失败时不得扫描 Request 目录猜测终态。

### 10.3 用户审阅

用户可以：

- 采纳候选。
- 拒绝候选并继续编辑原工作文件。
- 返回编辑，不丢当前评论、附件和候选记录。
- 在不改变正式历史的前提下重新发送新 Attempt。

候选不能在 AI 返回时自动切换为正式当前文件，也不能覆盖 V2 工作文件。

仅当可选标注遭遇真实的单元素 canonical fact 超限时，同一 Review 可重建无标注的前后页面，原位说明“变化标注暂不可用，可直接查看前后页面。”；评论、页面交互和明确采用／不用本次保持。该临时状态不落盘，不证明内容相同或要求已完成。取消丢弃结果；身份、Hash、路径、未知异常及安全投影／传输失败仍拒绝，采用校验不变。

同内容候选使用同一 Review 和原采用确认框，明确说明：“HTML 内容相同，采纳后仍会创建正式版本，并归档本轮已提交且未再修改的要求。”明确采用才执行普通 Promotion；不用本次不新增 Version，保留要求。采纳只归档本轮冻结后未再修改的已提交要求，新增和再次编辑的要求继续保留。已终态历史 `no-change` 保持原终态、`lastAiTask`、submission receipt 与 outbox，不复活为 Candidate，也不批量迁移。

### 10.4 采纳候选

用户点击“采纳并成为版本 7”后，系统必须原子完成：

1. 验证候选 Hash 仍与审阅内容一致。
2. 验证运行时封存 Candidate 的 `requestId`、`proposedVersionId` / ordinal、`basedOnVersionId`、`previousVersionId`、输出 Hash 和当前项目身份。崩溃恢复时，必须由该 Candidate 与其 `sourceWorkingCopyId` 当前受管命名重新推导版本、谱系、准备路径和可见路径；事务另行封存身份物化后的 Working Copy Hash 与文件身份。任一不一致都失败关闭，不得发布或补全 Version。
3. 根据当前 Working Copy 最新确认的首选主干与扩展名分配 V7 候选可见路径；若占用则连续追加 `-V7`。先在事务中准备私有字节，再以操作系统级 no-replace `link()` 发布。只有 `EEXIST` 可以持久分配下一个同 ordinal 路径并重试；其他发布错误失败关闭。成功 `link()` 后才冻结最终相对路径。
4. 在晋升前完成 Candidate 的 Stable ID 归一化，并把完整的已采纳 Candidate HTML 写入 `.pageroot/versions/ver_0007/index.html`。
5. 在事务私有准备文件中以同一份已归一化字节按冻结路径 no-replace 建立工作文件；正式快照与新 Working Copy 初始逐字节一致，且不得覆盖任何用户已有文件。
6. 提交正式版本元数据与项目 `latestOfficialVersionId=ver_0007`。
7. 将当前编辑目标切换到 V7 工作文件。
8. 归档本轮 Request、评论和附件，并建立 V7 的空草稿。

只有全部成功后，界面才显示：

> 版本 7 · 基于版本 2

任一步失败，版本 7 不得半提交，V2 工作文件仍可继续编辑，Candidate 仍可审阅或重试。成功发布后的恢复必须复用事务已冻结的可见路径；发布前的 `EEXIST` 重试按本节重新持久分配下一个路径。正常命名冲突不弹窗，只在成功状态和 Finder 中展示实际采用的文件名。

## 11. 第二期：完整界面要求

第一期只承诺导入成功提示、项目目录入口、Candidate 审阅和不把 Candidate 显示为正式 Version 所需的最低界面；本节的常驻顶部状态、Registry 项目目录、完整版本列表与 Finder 定位体验由 PR 2B 交付。可见附件体验不在本节交付，属于 P3。

### 11.1 顶部版本区

顶部必须由纯投影同时表达下列现有权威事实；不得以多层互斥三元表达式隐藏其中任一项：

- 当前打开的是哪个版本工作文件或历史快照。
- 是否存在本地修改，是否已经保存。
- 当前内容基于哪个正式版本。
- 项目最新正式版本是哪个。
- 当前是否存在待审阅候选。

状态文案示例：

| 场景 | 主状态 | 辅助状态/操作 |
|---|---|---|
| 首次导入 | `V1 · 已导入 PageRoot` | `在文件夹中打开` |
| V1 本地修改 | `基于 V1 · 本地修改已保存` | `项目最新 V1` |
| 打开历史快照 | `正在查看 V2 · 只读浏览` | `编辑`（确认创建新版本） |
| 编辑历史 V2 | `基于 V2 · 项目最新 V6 · 本地修改已保存` | `当前编辑基础 V2` |
| AI 已返回 | `基于 V2 · 项目最新 V6 · 候选 V7 待审阅` | `审阅候选` |
| 候选已采纳 | `基于 V2 · 项目最新 V7` | `在文件夹中打开` |
| 保存失败 | `基于 V2 · 保存失败` | `重试`、`查看详情` |

### 11.2 项目和版本列表

- Registry 决定项目列表成员资格；项目列表以 Registry 登记项目文件夹名为用户项目名，不显示内部 `projectId`。用户在配置项目目录内改名后，重新识别时同步更新列表名称，不联动 HTML 名称。
- 项目列表的一次只读查询只扫描一次候选目录身份，并保留同一 `projectId` 的全部候选；各登记项仍分别校验完整 Project、Manifest 和 Runtime。隐藏目录、软链接和坏目录不能授予身份，重复有效项目身份仍隔离。列表不读取 HTML、不写回登记，不保留跨查询目录缓存；打开和保存重新核对当前路径、身份与内容。
- Desktop Recent 只提供 `lastOpenedAt`、启动优先和排序；已登记但未进入 Recent 的项目仍显示，Recent 中未登记的外部 HTML 不显示成项目，清除 Recent 不移除项目。
- 版本列表按正式 ordinal 排列，每行展示 `基于 Vn`、`前一正式版本 Vn`、`最新正式版本`、`当前编辑基础`、`有本地修改` 或 `当前只读浏览` 等适用的谱系/投影事实。
- 当前存在本地编辑的历史版本显示圆点或“有本地修改”，不能伪装成新正式版本。
- AI 候选与正式版本视觉上明确区分。
- 不提供“恢复并覆盖最新版本”的动作。
- 不提供“删除后续版本”的动作。

### 11.3 文件夹入口

- 项目顶部常驻“在文件夹中打开”。
- 首次导入提示中的同名操作指向项目根目录，而不是 `.pageroot/` 或原下载目录。
- 对历史 Version 提供“在 Finder 中显示”，定位它对应的可见 Version Working Copy，不伪装隐藏不可变快照为用户文件。`[PR 2B]`
- 对 AI 候选提供“查看 AI任务”，定位到该轮经验证的 `AI任务/` 派生展示，不暴露隐藏 Request 目录。`[PR 2B]`
- 对附件提供“在 Finder 中显示”并定位可见文件。`[P3]`

## 12. 数据与状态合同

### 12.1 状态权威位置

PR 1 不引入并行的全局 Store。下表是每类状态的唯一权威位置。项目内文件描述“它是谁”，Registry 登记“PageRoot 当前获准在哪个根目录管理和写入它”；两者都通过后才形成有效项目绑定。

| 状态 | 权威位置 |
|---|---|
| `projectId` / `documentId` | Registry 登记根目录内的 `.pageroot/project.json` |
| 正式 Version、Working Copy 与相对路径映射 | `.pageroot/manifest.json` |
| 每个 Working Copy 的 Hash、draft、保存状态 | 对应 `.pageroot/working-copies/<workingCopyId>.json` |
| `activeWorkingCopyId` / 活跃 Request | 项目 runtime state；Request / Attempt 记录只能被它校验，不能反向重建它 |
| `viewingVersionId` | 现有 renderer `VersionSession` |
| `registeredProjectRootPath` | Registry 的 `projectId → registeredProjectRootPath` 唯一登记与写入白名单 |
| 项目目录成员资格 | Registry；Recent 只能投影排序/最后打开时间，不能授权或移除成员 |
| 当前有效 `projectRootPath` | 当前 `ProjectSession`，必须是上述登记路径的本次验证投影 |
| `AI任务/` 派生路径与发布进度 | `.pageroot/recovery/ai-task-projections/` 中的投影收据；它只允许恢复展示，不能重建 Request、Candidate、Version 或运行态 |

项目的显示名不是一个另行的权威字段：它始终是登记项目文件夹名的显示投影。配置项目目录内完成可信文件夹改名后，Registry 原子更新登记路径，再从新目录名投影显示值。

外部 AI Agent 可写的 Request / Attempt 目录是待验证的执行证据，不是运行态权威。重开或崩溃恢复只能沿着已经存在的 runtime 封存 Request / Attempt / Working Copy 锚点（或已登记的 Promotion 事务）验证和继续；若 runtime 已清空或缺失，系统不得扫描 Request 目录来猜测、复活或授予新的活动 Request 权限。

### 12.2 项目身份

```json
{
  "schemaVersion": "4.0.0",
  "projectId": "project_...",
  "documentId": "doc_...",
  "createdAt": "2026-08-13T12:00:00+08:00"
}
```

字段职责：

- `projectId`：来自登记项目根目录内 `.pageroot/project.json` 的稳定身份，不随配置项目目录内的文件夹改名或受管 HTML 改名而改变；它不赋予移出或复制到未登记位置的目录管理授权。
- `documentId`：保留现有内部文档身份，用于 Request、Candidate 和正式 Version 的交叉校验。
- `createdAt`：只记录项目创建时间，不是路径或显示名的身份替代。

不得重新引入一个同时承担四种含义的 `currentVersionId`。绝对路径本身不是项目身份，但 Registry 的登记绝对根路径是写入范围的一部分，不能被副本内相同 `projectId` 绕过。

### 12.3 Working Copy 内部状态

```json
{
  "workingCopyId": "work_ver_0002",
  "basedOnVersionId": "ver_0002",
  "sourceRelativePath": "复杂HTML综合测试页-V2.html",
  "preferredFileStem": "复杂HTML综合测试页",
  "preferredExtension": ".html",
  "baseSha256": "...",
  "currentSha256": "...",
  "differsFromBase": true,
  "draftId": "draft_...",
  "lastSavedAt": "2026-08-12T15:30:12+08:00",
  "lastOpenedAt": "2026-08-12T15:31:00+08:00"
}
```

一个正式版本在 MVP 中最多有一份受管理的版本工作文件。重复“基于 V2 继续编辑”时打开同一份 V2 工作文件，避免产生多个无法区分的 V2 草稿。这份状态文件是 Hash、draft 和保存状态的唯一权威；`manifest.json` 只保留稳定 ID、Version、相对路径和可见命名事实的结构映射。

`.pageroot/manifest.json` 以 `versionId` / `workingCopyId` 映射当前相对路径、首选文件名主干、扩展名和受控文件身份。上例中的三个命名字段是该 manifest 映射的逻辑投影；Hash、draft 和保存状态仍以 Working Copy 状态文件为权威。`sourceRelativePath`、`preferredFileStem` 和 `preferredExtension` 可以随可信用户改名而更新，但稳定 ID 不变；系统不得反向解析文件名来生成或猜测这些 ID。

manifest 可记录平台文件标识（例如 device、inode、birthtime）作为受管 HTML 改名或移出后放回的辅助证据，但它不是业务身份。重新识别按“登记根目录与项目 ID → 用户明确打开的路径或原相对路径 → manifest 缺失映射与平台标识 → 内容校验”的证据链处理；单一安全命中可静默恢复。文件标识变化并不单独阻止恢复，Hash 也只能验证字节，不能在多个候选路径间替系统作选择；只有真实歧义才请求用户确认。

### 12.4 正式版本状态

```json
{
  "versionId": "ver_0007",
  "ordinal": 7,
  "basedOnVersionId": "ver_0002",
  "previousVersionId": "ver_0006",
  "contentSha256": "...",
  "snapshotRelativePath": ".pageroot/versions/ver_0007/index.html",
  "sourceRequestId": "request_...",
  "sourceCandidateId": "candidate_..."
}
```

### 12.5 内容等价不是导航授权

系统可维护 `currentExactVersionId` 或等价索引，用于回答“当前字节是否与某个正式版本完全相同”。该字段只能用于：

- 显示“内容与版本 N 相同”。
- 去重存储或校验。
- 冲突和恢复判断。

它不能用于：

- 改变当前打开路径。
- 改变 `activeWorkingCopyId`。
- 把历史版本跳到最新版本。
- 替用户决定项目归属。

## 13. 文件打开与切换状态机

每次文件切换都必须由单一 Document Session owner 完成：

```text
请求打开具体路径
    ↓
判断路径是否位于配置项目目录中的 Registry 登记根目录，或是否为已验证的同目录改名结果
    ├─ 否：按外部 HTML 精确打开，不取得项目写入授权
    ↓
校验真实路径包含关系，并读取 .pageroot/project.json 与 manifest
    ↓
交叉验证 Registry 登记、projectId、versionId / workingCopyId 与具体相对路径
    ↓
取消或隔离上一轮过期异步加载
    ↓
读取该路径精确字节并计算 Hash
    ↓
发布唯一 active sourcePath + sessionToken
    ↓
画布确认加载相同 sessionToken 和 Hash
    ↓
界面宣布切换完成
```

要求：

- 路径、Session token、画布 Hash 三者不一致时失败关闭，不得显示“已切换”。
- Registry 登记根目录是项目写入范围；项目目录内稳定 ID 与 manifest 是对象身份。两类证据缺一不可，未登记副本内相同 `projectId` 不能取得写入授权。
- 配置项目目录内的项目文件夹改名只能通过同父目录文件事件、平台文件标识等证据完成一次受控 Registry 路径更新；仅发现另一个相同 `projectId` 目录不等于改名。
- 上一文件的迟到回调不能覆盖新文件状态。
- 同 Hash 文件仍保持不同路径和用户选择身份。
- 受管 HTML 放回后能够安全唯一识别时静默恢复；只有用户正在执行需要绑定的操作且存在真实身份歧义时才确认一次，不能按文件名或 Hash 自动认领。
- 加载失败必须保留可返回的上一稳定文件，并给出“重试”或“返回上一文件”。
- 禁止在“识别项目”“定位最新版”“加载画布”三个模块中分别修改当前文件。

该状态机是解决“切换 HTML 后卡死”的核心实现边界；减少重复或交叉校验可以，但不能删掉身份、字节、并发和事务四类独立校验。

## 14. 异常与恢复

### 14.1 外部修改

如果版本工作文件在 PageRoot 外部被修改：

- 尚未有未保存 PageRoot 修改且受控身份没有歧义时，自动载入外部变化，并用非阻断状态说明已更新。
- 同时存在 PageRoot 未保存内容时，必须进入冲突状态，保留两份字节并要求选择，不能静默覆盖。
- 外部变化仍是同一工作文件上的本地编辑，不自动创建正式版本。

### 14.2 文件改名、移动或丢失

项目文件夹层面的规则：

- 在配置项目目录内重命名项目文件夹，属于受支持的同父目录改名。唯一确认后原子更新 Registry 登记路径与显示名，项目/文档 ID 和所有 HTML 名称保持不变。
- 将整个项目文件夹移出配置项目目录或跨磁盘移动，视为离开管理范围。PageRoot 不追踪新位置、不要求用户“定位项目”、不重新关联，也不向新位置写入。
- 当前打开项目的登记根目录消失时，立即停止所有旧路径写入，保留内存修改，仅显示一个非重复打扰的“项目暂不可用”状态。文件夹回到原登记路径后，重新验证 `projectId` 与 manifest 即可继续保存。
- 复制整个项目文件夹到其他位置时，副本保持普通用户文件，不弹出重复项目选择，也不更新 Registry。只有原登记根目录可写；从副本打开 HTML 按外部文件处理，主动持久化时另行导入新项目，而不是克隆隐藏历史。
- 不允许全盘搜索、按同名目录或仅按相同 `projectId` 自动认领。完整项目克隆仍是后续独立能力。

受管 HTML 层面的规则：

| 用户操作 | PageRoot 行为 | 是否打扰用户 |
|---|---|---:|
| 在登记项目根目录内改名 | 继续同一 Working Copy，更新 manifest 路径与首选命名，未来版本继承新文件名 | 安全唯一时不提示 |
| 移出登记项目根目录 | 外部位置立即不受管；若当前打开则暂停保存并保留内存修改 | 仅显示一次非阻断状态 |
| 未修改并放回原相对路径 | 校验后恢复原 Working Copy，即使 inode 改变 | 不提示 |
| 未修改、改名后放回 | 受控证据唯一时重绑定并继承新名称 | 不提示；真实歧义才选择一次 |
| 在外部修改后放回 | 仍恢复原 Working Copy；PageRoot 侧干净则自动采用磁盘内容 | 仅双方均修改时进入内容冲突 |
| 留在外部并重新打开 | 重新验证有效 v4 Project；未通过即建立新的 v4 V1，不回写或重新关联原项目 | 不弹“重新关联” |
| 移入另一个项目 | 不合并、不改写另一项目 manifest | 按外部 HTML 处理 |

找不到工作文件时，PR 1 只进入“文件暂不可用”并保留内存修改；不得用不可变快照静默重建或覆盖用户文件。只有原路径或唯一可证明的根目录内改名回归，才恢复同一 Working Copy。

### 14.3 候选和采纳失败

- AI 失败、取消、超时、返回无效 HTML、用户拒绝或已终态的历史 `no-change`，都不增加正式版本序号。新的合法同内容 Candidate 只有在用户明确采纳后才增加正式版本序号。
- 采纳时发现候选 Hash 改变，停止提交并要求重新审阅。
- 采纳事务崩溃后，要么恢复为完整正式版本，要么回滚为仍待审阅候选，不能出现界面有 V7、快照却不存在。
- 删除或篡改 `AI任务/` 中的派生 Prompt/Candidate，或用用户文件、目录、软链接占用其路径，不改变隐藏 Candidate、审阅或 Promotion；Finder 入口只会由收据安全重建原投影或分配新的展示目录。

### 14.4 P3 附件异常

- 以下可见附件体验在 P3 实现；PR 2B 仍保留当前附件记录与隐藏 Request 冻结快照的正确性。
- 复制失败时不创建空附件记录。
- 可见附件被 Finder 删除时，评论显示缺失状态；若已有冻结 Request，则仍可使用隐藏快照完成审阅。
- 相同 Hash 不代表同一用户附件；身份仍由 `attachmentId` 决定。

## 15. v4 以前的项目状态

现有 `~/Documents/PageRoot/项目记录/projects`、旧可读目录名、`working/*-V1.x.html`、冻结 Request 和 Attempt 不属于 v4 打开路径。它们既不迁移，也不以兼容、恢复、只读展示或路径映射的形式参与项目识别。用户选择其中任一 HTML 时，PageRoot 只把该 HTML 当作外部来源，建立全新的 v4 Project 和初始 V1；原文件及其旧目录保持不变。

规则：

1. 新项目使用本 PRD 的 `~/Documents/PageRoot/项目/<项目名称>/` 结构和 v4 manifest 映射。
2. 旧目录、旧 Registry、旧 Request、旧 Attempt、旧 Version 和旧运行态均不读取、不保存、不恢复、不双写。
3. 不提供 v3 到 v4 的迁移计划、路径映射、重定向或回滚机制；它们不在本 PRD 范围内。
4. [ADR 0022](decisions/0022-user-owned-project-root-identity.md) 将 Registry 定义为 v4 写入白名单；只有该白名单证明的根目录能恢复既有 v4 项目。

## 16. 验收标准

### 16.1 版本与保存

- [ ] 导入外部 `A.html` 后创建隐藏不可变版本 1 和可见 `A-V1.html`，外部原文件与隐藏快照字节不变且不含 Stable ID；可见 V1 工作文件可以因 Stable ID 物化而不同。`[第一期]`
- [ ] 唯一“导出当前 HTML…”入口原样复制完整 Working Copy，包括 Stable ID，且不改变项目、Version、Registry、Recent 或当前打开文件。`[PR1–PR10 合同]`
- [ ] Undo/Redo 仅属于当前打开文档会话，不属于正式 Version 历史，也不跨切换、关闭或重启恢复。`[PR1–PR10 合同]`
- [ ] AI Candidate 在晋升前完成 Stable ID 归一化；V2 及后续不可变 Version 保存完整的已采纳 Candidate HTML，因此可以包含 Stable ID；对应 V2+ 新 Working Copy 初始与 Version 快照逐字节一致，之后本地编辑只修改 Working Copy。`[PR1–PR10 合同]`
- [ ] 用户连续修改 `A-V1.html` 100 次并重启应用，内容全部保存，正式版本仍只有版本 1。`[第一期]`
- [ ] 添加、删除、修改评论和附件后重启应用，草稿完整恢复，不创建正式版本 2。`[第二期]`
- [ ] 发送 AI 后，界面显示候选版本 2；AI 返回但未采纳时，正式历史仍只有版本 1。`[第一期]`
- [ ] AI 只能写入固定 Attempt `output/candidate.html`；未经用户采纳不得创建根目录正式工作文件或推进正式版本号。`[第一期]`
- [ ] 用户采纳后才出现正式版本 2、隐藏 V2 快照和可见 `A-V2.html`，三者 ordinal 一致。`[第一期]`
- [ ] 将受管 `A-V1.html` 改名为 `B-V1.html` 后采纳候选，创建 `B-V2.html`；项目文件夹改名则不改变该 HTML 主干。`[第一期]`
- [ ] 用户已有 `B-V2.html` 时采纳候选，不覆盖、不弹窗，创建 `B-V2-V2.html`；继续冲突时继续追加 `-V2`。`[第一期]`
- [ ] `B-V2.html` 被目录或软链接占用时同样视为冲突路径，不跟随链接、不覆盖目标，并选择下一个可用名称。`[第一期]`
- [ ] 所有新文件不再出现 `V1.1`、`V1.2` 双重编号。`[第一期]`

### 16.2 历史编辑

- [ ] 最新为版本 6 时打开历史版本 2，画布精确显示 V2 快照，不跳到 V6。`[第二期]`
- [ ] 点击“基于版本 2 继续编辑”后打开 `A-V2.html`；本地修改保存但不覆盖隐藏 V2。`[第二期]`
- [ ] 连续点击或在 Bridge/桌面响应丢失后重试“基于此版本继续编辑”，始终得到同一个 `work_ver_0002`；不会新建 V2 Working Copy。`[第二期]`
- [ ] V2 Working Copy 修改并重启恢复后，隐藏 `versions/ver_0002/index.html` 仍保留原始 V2 字节。`[第二期]`
- [ ] 基于 V2 的候选被采纳后创建版本 7，记录 `basedOnVersionId=V2`、`previousVersionId=V6`。`[第二期]`
- [ ] 重新打开 `A-V2.html` 时继续原有 V2 本地编辑，不创建第二个 V2 工作文件或新项目。`[第二期]`
- [ ] 两份内容 Hash 相同但路径不同的 HTML，用户打开哪一份就显示哪一份。`[第一期]`

### 16.3 导入提示与目录

- [ ] 打开未登记 HTML 时先确认再导入；默认复制，可选在成功后将原稿移入废纸篓。验收以 [首次打开导入确认](IMPORT_CONFIRMATION_PRD.md) §16 为准。`[已实施]`
- [ ] 导入完成后显示一次成功状态，并提供项目目录入口。`[第一期]`
- [ ] 版本 1 顶部显示“已导入 PageRoot”和“在文件夹中打开”。`[第二期]`
- [ ] 关闭并重开仍显示该状态，直到第一次晋升版本 2。`[第二期]`
- [ ] 晋升版本 2 后导入状态消失，常驻文件夹入口仍存在。`[第二期]`
- [ ] Registry 中 A/B 两个项目且 Recent 只有 A 时，A/B 都显示且 A 仅因 Recent 排在前；未登记 Recent 项不显示，清除 Recent 不移除项目。`[PR 2B]`
- [ ] Finder 项目根目录能直接找到版本 HTML、`PROJECT.md`、每轮 AI任务的 `PROMPT.md` 和 AI 待审阅文件；不新建 `附件与图片/`。`[PR 2B]`
- [ ] 历史 Version 的 Finder 命令定位该 Version 的可见 Working Copy，项目 Finder 命令打开经验证项目根，Candidate 命令只打开派生 `AI任务/`。`[PR 2B]`
- [ ] 可见评论附件和图片、附件 Finder 定位及回收区。`[P3]`
- [ ] `.pageroot/` 保存不可变快照、Request、事务和恢复记录，正常 Finder 浏览时不干扰用户。`[第一期]`
- [ ] 同名项目建立为 `<名称> (2)`，内部仍使用不同稳定 `projectId`。`[第一期]`
- [ ] 在配置项目目录内重命名项目文件夹后，恢复同一 `projectId`、版本和草稿，更新项目显示名，但所有受管 HTML 名称保持不变。`[第一期]`
- [ ] 整个项目文件夹移出配置项目目录或跨磁盘移动后，新位置不被识别或写入，也不出现“定位/重新关联项目”流程。`[第一期]`
- [ ] 当前打开项目被整体移出后立即停止旧路径写入并保留内存修改；文件夹回到原登记路径后校验通过即可继续保存。`[第一期]`
- [ ] 复制整个项目文件夹到同卷或其他卷后，只有 Registry 登记根目录可写，副本不弹重复项目选择、不被双写；从副本持久化 HTML 时另行导入新项目。`[第一期]`
- [ ] 重命名项目内受管 HTML 后重新打开，仍进入同一 `workingCopyId`，更新未来版本首选命名，不创建新项目或新版本。`[第一期]`
- [ ] 受管 HTML 移出后不向外部位置写入；未修改后放回原路径或唯一可识别的新名称时静默恢复。`[第一期]`
- [ ] 受管 HTML 在外部修改后放回：PageRoot 侧干净时自动采用，双方均修改时保留两份字节并进入内容冲突。`[第一期]`

### 16.4 原子性与恢复

- [ ] 在导入七步中的任一步注入崩溃，原外部文件不变，系统不留下半注册项目。`[第一期]`
- [ ] 在保存、发送冻结、AI 返回和采纳提交各阶段注入崩溃，重启后都能回到唯一可解释状态。`[第一期]`
- [ ] Promotion 成功 no-replace 发布后，在各后续写入点注入崩溃并重试，始终复用同一冻结路径；若最终发布前 `link()` 返回 `EEXIST`，持久分配下一个同 ordinal 路径并重试，其他错误失败关闭并保留 Candidate。`[第一期]`
- [ ] 文件切换压力测试中，迟到异步回调不能改变新 Session 的路径、Hash 或画布。`[第一期]`
- [ ] 保存失败时禁止用旧磁盘内容发送 AI，并提供恢复操作。`[第一期]`
- [ ] Request 冻结后删除可见附件，不影响该 Request 的附件 Hash 和审阅。`[第二期]`
- [ ] 在投影收据、目录分配、Prompt 写入、Candidate 写入、完成标记或 Finder 返回前注入失败并重试，不覆盖用户文件、不产生第二个 Candidate、不推进正式 Version。`[PR 2B]`
- [ ] 删除或篡改 `AI任务/` 派生 HTML 后，隐藏 Candidate 仍可审阅并按其 Hash Promotion；投影只能安全重建或另分配展示目录。`[PR 2B]`

### 16.5 源码与安全

- [ ] 仅打开和导入时，供应的外部单文件 HTML 字节逐字节不变；V1 隐藏快照保留同一原始字节且不含 Stable ID，可见 V1 Working Copy 的 Stable ID 物化不回写原稿或隐藏快照。`[第一期]`
- [ ] 本地局部编辑仍通过受支持 SourcePatch 路径，只改变授权范围。`[第一期]`
- [ ] 预览 DOM 从不成为保存或版本快照事实源。`[第一期]`
- [ ] 相对资源依赖不阻止完整 HTML 建立原字节 V1；资源包复制、重写和长期管理不在第一期隐式交付。`[第一期]`
- [ ] 所有可见路径与隐藏路径均防止 `..`、软链接逃逸和跨项目写入。`[第一期]`
- [ ] 项目根目录中的用户新增文件、目录和额外 HTML 在导入、保存、改名恢复及 Promotion 前后字节不变，且不会因文件名或 Hash 被自动纳入 manifest。`[第一期]`
- [ ] 整个项目副本无论位于同卷还是跨卷，都不能凭复制的 `.pageroot/project.json` 绕过 Registry 登记根目录取得写入授权。`[第一期]`

### 16.6 不随前两期隐式交付的范围

- [ ] 旧 `项目记录/projects` 的迁移或兼容层。`[不在范围]`
- [ ] 为复制项目重签全部内部 ID 的“完整克隆项目”能力。`[后续]`
- [ ] 多文件网站、资源包、外部资源自动重写或管理。`[后续]`
- [ ] 可见 `附件与图片/`、附件 Finder 定位与项目内回收区。`[P3]`

## 17. 实施范围与文档联动

实施本 PRD 至少需要同步评审：

- 项目注册、默认 workspace 和项目目录解析。
- Document/Project Session 对具体路径的唯一所有权。
- Version、Working Copy、Draft、Request、Candidate 的 Schema 和状态机。
- Source transaction 的保存目标与 `currentExactVersionId` 权限边界。
- AI 输出命名、候选提交点和三方 Hash 校验。
- 评论附件的现有记录、Hash 与 Request 隐藏快照；可见副本、附件 Finder 定位和删除回收属于 P3。
- 配置项目目录内文件夹改名、受管 HTML 的改名/移出/放回、外部修改与低打扰重绑定。
- 登记根目录写入白名单、项目副本不接管，以及跨卷路径的拒绝写入测试。
- 任何旧 `V1.x` 项目迁移或兼容层。
- [MVP 产品需求](MVP_PRD.md)、[交互流程](INTERACTION_FLOW.md)、[Change Request 协议](CHANGE_REQUEST_PROTOCOL.md)、Schema fixtures、测试策略和 ADR 0022/0024；其中 v4 AI 交接必须保持 `PROJECT.md`、`AI_RULES.md`、`PROMPT.md` 职责不重叠，ADR 0022/0024 必须同步登记根目录、Hash、Promotion 与 AI任务派生发布边界。

现有实现若包含以下行为，均与 PRD v1.4 冲突，进入 PR 审查前必须删除、禁用或改写干净，不能作为无提示兼容分支继续保留：

- 整个项目文件夹移出或跨卷后自动定位、重新关联并继续写入。
- 对复制项目弹出“重新关联到此位置 / 作为新项目”选择，并允许 Registry 跟随副本更新。
- 把 Registry 当作可被任意同 `projectId` 目录覆盖的上次位置缓存。
- 永久沿用首次导入 HTML 主干，不继承受管 HTML 后续改名。
- Promotion 因可见文件同名而失败或打扰用户，而不是冻结并使用追加版本后缀的空闲路径。

建议实施顺序：

1. PR 1：先修正文件打开 Session 与“Hash 不得改变导航”的边界，再建立登记根目录写入范围、稳定身份、原子导入、文件夹改名、受管 HTML 恢复、命名继承，以及 Candidate 与 Promotion 分离。
2. PR 1 内部依次交付文档与 Schema、Repository、Workflow、最低限度 UI 与故障注入；每个边界都需要可回退的提交。
3. PR 2：仅在 PR 1 合并且验证通过后，实现历史继续编辑、Registry 项目目录、完整版本状态和可见 AI任务；可见附件/回收体验单列为 P3。
4. 旧项目状态保持完全不兼容；只在未来另有明确产品决策时再讨论迁移。完整克隆和多文件网站也须另行设计。

## 18. 最终产品口径

用户只需要理解五句话：

1. **打开不会改动原文件；若它不属于有效 v4 Project，PageRoot 会立即把它导入自己的项目文件夹并从 V1 开始。**
2. **你的文字、样式、评论、附件和图片都会自动保存，但不会因此不停增加版本号。**
3. **从历史版本继续修改没有问题；界面会一直告诉你当前基于版本几。**
4. **AI 返回的是待审阅候选，只有你采纳以后，它才成为下一个正式版本。**
5. **PageRoot 只管理“PageRoot/项目”里已登记的文件；整个项目文件夹搬走或复制出去后不会被两边同时写。**

## 19. 更新记录

### 2026-08-15（Asia/Shanghai，UTC+8）— PRD v1.4 / PR 2B

本次更新把第二期的已交付边界收敛为一个可验证的 PR 2B：

| 议题 | 确认后的判断 | 对实施与验收的影响 |
|---|---|---|
| 项目目录成员资格 | Registry 是唯一成员与写入授权；Desktop Recent 只排序、显示最后打开时间和启动优先。 | 已登记但未 Recent 的项目仍显示；未登记 Recent 项不成为项目。 |
| 顶部与版本列表 | 只投影既有 Version/Document/Draft/Run 事实，同时展示基础版本、项目最新版本、保存/本地修改、Candidate 和历史只读状态。 | 不新增全局 Store，也不把 Working Copy 修改写进不可变 Version。 |
| Finder | 项目入口打开已验证项目根；历史 Version 定位可见 Working Copy；Candidate 只打开经验证 `AI任务/`。 | 产品 UI 不再打开 `.pageroot/requests/...`，隐藏快照不伪装为用户文件。 |
| `AI任务/` | `PROMPT.md` 与通过 finalizer 的待审阅 HTML 是可删除、可重建、no-replace 发布的派生展示；收据只服务恢复展示。 | 删除/篡改不影响隐藏 Candidate、审阅或 Promotion，AI 也不能写此目录。 |
| 可见附件 | `附件与图片/`、附件 Finder 定位和回收区移到 P3；现有附件记录、限制与冻结隐藏快照不后退。 | P2 不创建附件可见目录或附件快照说明。 |

### 2026-08-14（Asia/Shanghai，UTC+8）— PRD v1.3

本次更新澄清已确认的 v4 执行与展示边界：

| 议题 | 修订后的判断 | 对实施与验收的影响 |
|---|---|---|
| Promotion 路径冻结 | 私有准备文件可先建立；只有 no-replace `link()` 成功后最终可见路径才冻结。发布前仅 `EEXIST` 可持久分配下一个同 ordinal 路径并重试，其他错误失败关闭。 | 事务、恢复和故障注入须区分“发布前 EEXIST”与“成功发布后恢复”。 |
| Candidate 与可见 AI 任务 | AI 唯一写入固定 Attempt `output/candidate.html`；Request / Attempt 与 Candidate 记录才是权威。`AI任务/` 仅在第二期作为只读派生展示。 | 不得由 AI 直接写 Finder 可见正式 Version，也不得以可见副本作为 Promotion 输入。 |
| AI Markdown 职责 | `PROJECT.md` 默认预填五段长期规则模板且可清空，是用户长期规则；`AI_RULES.md` 是稳定系统边界；`PROMPT.md` 只给出本轮精简执行入口并引用规则。 | 禁止在 Prompt 重复稳定规则或要求 AI 推导输出文件名、版本号。 |
| Hash 与身份 | Hash 只验证内容，绝不单独补回 Working Copy 映射或授予管理权。 | ADR 0022 与恢复实现必须删除 Hash 身份回退。 |
| 第二期可见体验 | 可见 AI 任务、附件与完整顶部/项目界面明确属于第二期。 | 第一期开箱与验收不以这些 Finder 目录或完整 UI 为前提。 |

### 2026-08-13 16:25（Asia/Shanghai，UTC+8）— PRD v1.2

本次更新记录 2026-08-13 产品与技术讨论中确认的判断变化。它取代 PRD v1.1 中与下表冲突的条款，并由 ADR 0022、v4 Schema、Repository 和测试共同执行。

| 议题 | PRD v1.1 / 此前判断 | 2026-08-13 更新后的判断 | 对实施与验收的影响 |
|---|---|---|---|
| 项目管理边界 | `.pageroot/project.json` 可随整个项目文件夹移动，PageRoot 可从新位置恢复项目 | `~/Documents/PageRoot/项目/` 是配置项目目录；只管理其中 Registry 登记的项目根目录和已注册文件 | 删除整夹移出后的定位、重新关联和继续写入；跨卷测试改为验证“不识别、不写入” |
| 项目文件夹改名 | 文件夹改名和任意移动按同一种可携带身份处理 | 只支持配置项目目录内的同父目录改名；更新项目显示名和登记路径，不改 HTML 名称 | 需要受控 Registry 路径更新；验收 `projectId` 不变且 HTML 名称不变 |
| 整个项目文件夹复制 | 重复 `projectId` 时提示“重新关联”或“作为新项目” | 副本不接管、不弹选择、不更新 Registry；只有原登记根目录可写 | 删除重复项目选择 UI，补同卷/跨卷副本不可写和禁止双写测试 |
| Registry 职责 | 仅缓存项目上次位置，项目目录内 ID 可覆盖缓存 | Registry 是 `projectId → registeredProjectRootPath` 的唯一位置登记与写入白名单；项目内 ID 只证明登记根目录中的对象身份 | 修改状态权威表、打开状态机和每次写入前校验；ADR 0022 必须同步修订 |
| 用户自行增加文件 | 未明确 PageRoot 是否会扫描或管理项目根目录中的其他文件 | 未注册文件和目录完全归用户；保留但不版本化、不冻结、不恢复、不删除，额外 HTML 按外部 HTML 处理 | 所有 Repository 写入改为 manifest/合同路径白名单，并补未知文件不变测试 |
| 受管 HTML 改名 | 可恢复同一 Working Copy，但未定义未来版本命名 | 同一 Working Copy 不变；更新 manifest 相对路径、首选主干和扩展名，后续 Candidate / Promotion 继承新名称 | 增加 `A-V1.html → B-V1.html → B-V2.html` 验收；文件名仍不承担身份 |
| 受管 HTML 移出与放回 | 移出后按外部文件处理；放回、改名放回和外部修改后的恢复不完整 | 移出后停止外部写入；原样放回、唯一可识别的改名放回应静默恢复；外部修改在 PageRoot 侧干净时自动采用，双方修改才进入冲突 | 补全丢失、返回和冲突状态机；默认非阻断提示，只有真实歧义或双边修改才要求选择 |
| Promotion 文件名冲突 | 首选路径冲突时倾向失败关闭并提示 | 不覆盖、不提示，按同一 ordinal 连续追加后缀，例如 `A-V2-V2.html`；v1.3 以 no-replace 成功发布后冻结最终路径为准 | 增加目录/软链接占位、连续冲突及崩溃重试不重复追加测试 |
| 候选待审阅期间改名 | 未明确 Candidate 建立后 HTML 再改名的结果 | Promotion 使用采纳时最新确认的 Working Copy 首选主干；Candidate 身份和内容 Hash 不变 | Candidate 文件名可与最终正式工作文件名不同，不能据此改变身份 |
| 旧项目与 ADR | 旧项目兼容；ADR 0022 曾采用用户目录身份优先、Registry 缓存模型 | v4 以前状态完全不兼容；选中的 HTML 新建 v4 V1，ADR 0022 是 v4 Registry 白名单模型 | 旧状态不得成为绕过登记根目录的第二身份系统 |


### 创建回执与恢复任务的边界

创建时的文件名和物理观察值不是永久创建身份。回执按不可变版本/操作/来源验证，返回当前已登记位置；改名不使已完成创建变为未知。准备阶段由私有硬链接锚点、当前准备/可见文件对象及事务 Hash 共同证明，不能用同 Hash 的外部替换文件冒充。

结果携带 `recoveryState=pending|opened|superseded`。后续版本或当前工作目标接替后，旧操作只保留创建事实，不再提供恢复打开，不清除用户当前工作版本。当前已验证打开的版本可以补 openedAt 而不再次载入工作区；重新打开前再次查询结果是否仍待处理。
