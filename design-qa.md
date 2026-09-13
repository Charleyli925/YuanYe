# Design QA

## 2026-09-12 — Run identity and aggregate (historical pre-P1 review evidence)

- Internal identity/coordination repair; no layout, control, copy, chat or execution-purpose change. One locator-keyed RunSession entry now owns run/result/handoff/recovery/outcome facts, while active presentation keeps only locator keys. Request origin and the current display locator remain distinct; pending submissions reuse their in-memory token, and the public methods/snapshot remain unchanged.
- Two new regressions first reproduced production failures: rebinding A removed B's run in the same project/document, and reconciling unknown A removed B's pending run. The original failing log is retained locally. Both passed after narrowing locator selection and run/submission matching.
- The first expanded ProjectWorkflow fixture put a processing Run on the current page; the existing locator lock correctly blocked that operation. The fixture now exercises the permitted state: editable A, processing B in the same project. No production lock was relaxed.
- Scoped evidence: 259 Node checks passed across RunSession/RunWorkflow/decoder and Project/Version/WorkspaceController consumers, including the expanded aggregate, legacy, late-writer and alias cases. A real synthetic Bridge Request → Candidate → Promotion check passed and preserved the source Working Copy identity. Its first launch was blocked by sandbox loopback `EPERM`; the authorized rerun passed. No UI, full task gate, real-vendor, private-corpus, packaged-app or performance acceptance is claimed.
- Typecheck/architecture and 48 selection/context checks passed. Targeted aggregate lint reported no errors or warnings; the earlier identity-preparation pass reported only its two existing ProjectWorkflow/Bridge warnings.

This section records the pre-review M6 evidence and is not final acceptance; the
current post-review checks are recorded below.

## 2026-09-13 — M6 identity and managed-source repair (post-review focused evidence)

- Scope is internal Run/Project/Workspace identity coordination. There is no
  layout, control, copy, chat or execution-purpose change. The strict recent-run
  authority requires complete top-level workspace identity plus a matching
  OpenTarget; Request origin remains independent from the current Working Copy.
  Managed Finder/Version/registration transitions reserve both Sessions before
  Desktop awaits and publish one complete aggregate tuple, with an explicit
  same-operation `unknown` outcome when host/local state cannot be proven.
- Current evidence is tied to the frozen base `e1ebe3dfc306286e37c774d31c4bddfc11914449`;
  the exact dirty tracked-diff SHA is reported with this handoff rather than
  self-embedded in the evidence file. The current focused Node combination
  passed 218/218, the Session/Controller batch passed 71/71, and the preload
  batch passed 41/41. Coverage includes Recent hydration ABA/authority and
  Candidate identity negatives, Finder reservation fences, managed activation
  receipt replay, background Version no-publication,
  same-project/different-document no-publication, legacy-history receipt
  retention and aggregate publication. The Bridge HTTP suite was attempted
  separately: 0/14 passed because every case
  stopped at sandbox `listen EPERM 127.0.0.1`, with no assertion failure.
  `npm run typecheck`, `npm run desktop:renderer`, syntax checks and diff checks
  passed; Electron receipt execution was not rerun in this short pass (the
  prior attempt stopped at sandbox `kill EPERM`/`SIGABRT`).
  No UI, full task gate, real-vendor, private-corpus, packaged-app or
  performance acceptance is claimed.

- Sixth-round receipt fence evidence: the focused Node set passed 339/339,
  including the existing managed activation and identity regressions. The
  renderer build passed with only the existing large-chunk warning. The three
  focused Electron receipt cases (clean pending restart, pending A→B followed
  by persisted Y/Z returning to A, and completed-receipt replay) were attempted
  but all stopped before app launch at sandbox `kill EPERM`/Electron `SIGABRT`;
  therefore no Electron pass is claimed. The new persisted
  `activeEffectGeneration` plus predecessor-effect fence is asserted by the
  Node source contract and exercised by the deterministic persistence fixture;
  the runtime result remains awaiting an authorized Electron environment.

## 2026-09-13 — Current P1 boundary follow-up

- Candidate mutation authority: the real Bridge suite passed 14/14 after an
  authorized loopback run. The focused Candidate promotion test passed 22/22;
  the broader 91-test repository batch passed 90/91, with its only failure the
  unrelated sandbox `listen EPERM 127.0.0.1` startup case (the same test passed
  in the authorized Bridge run). Missing/wrong Candidate decision identity and
  lost-response same-operation replay both assert no duplicate manifest Version.
- Source rename and Version identity: `source-rename.test.mjs` passed 13/13,
  including managed/generated A→C→A predecessor invalidation;
  `project-workflow.test.mjs` passed 75/75 and `version-workflow.test.mjs`
  passed 42/42, including complete target/hash/document fences, no-publication
  same-project/different-document paths, and preseeded legacy receipt X
  retention while renderer request Y fails later validation.
- Final local checks for this follow-up: syntax checks, `git diff --check`,
  architecture/typecheck and renderer build passed; lint reported 0 errors and
  26 existing warnings. The new focused production rename Electron case was
  attempted and stopped before app launch at sandbox `kill EPERM` / `SIGABRT`,
  matching the prior focused Electron limitation; no Electron pass is claimed.

## 2026-09-13 — M6 final acceptance

- Final production/test-source gate `2026-09-12T23-44-39-699Z-task` passed all
  10 selected steps: architecture/typecheck, lint with 0 errors and 26 existing
  warnings, dependency audit, Node targeted 1340/1340, contract 16/16, Web and
  Desktop builds, Browser 26/26, Electron 73/73, and AI 25/25. Every Playwright
  selection reconciled with 0 failed, skipped, or unexecuted cases.
- The Electron set includes structured contextBridge error redaction, lost
  activation reply recovery, exact-predecessor restart, intermediate activation
  ABA rejection, production rename A-C-A rejection, and completed-receipt replay.
  The focused structured-error/ProjectWorkflow Node set separately passed
  141/141, and the real synthetic Bridge boundary passed 14/14.
- The first full gate exposed a deterministic M1 package-closure defect: the
  native HTTP provider imported `shared/agent-input-policy.mjs`, but the shared
  resource was absent from the packaged Bridge allowlist. The final source adds
  that exact resource to the manifest, package oracle, artifact verifier and
  synthetic artifact fixture; the impact map now selects the package-closure
  owner for future native HTTP provider/policy changes. Focused package,
  artifact and selection checks passed 73/73 before the final full gate.
- Independent final review reported no P0, P1 or P2. Remaining P3 debt is limited
  to a narrower TypeScript description for the one nested reclassification DTO
  and more granular mutant-catching assertions for invalid confirmation shape
  and the HTTP runtime impact-map path. No layout, copy, control, real-vendor,
  installed-app, private-corpus or packaged-artifact execution claim is added.

## 2026-09-12 — Shared HTTP Agent input policy

- Mode: DESIGN CHANGE + AI EXPERIENCE LENS; base `353fb6c3`. Scope is admission/attachment policy, with the existing Agent controls and rejection copy. No layout, new mode, chat purpose or additional notification is introduced.
- Flow: explicit comment submission → current-input estimate → existing frozen Request/ticket → verified serialized Runtime input → Candidate. Attachments increase input demand; expected complete output comes from frozen HTML. Unknown model capability remains unknown, with the existing HTTP byte cap. Runtime verifies every file's actual reread bytes rather than trusting an old label. Failed validation precedes any model request/output publication.
- Scoped evidence: 131 Node checks passed across shared policy, HTTP runtime/provider, RunWorkflow and Coordinator; typecheck/architecture passed. Boundary checks cover small HTML with large text input, unknown capability, output headroom, BOM/NUL/invalid UTF-8, changed frozen attachment bytes and selected ticket capability snapshots. Existing submission cancellation/configuration and clipboard tests remain in those suites.
- First new regression run expected an unprefixed policy error code; the existing policy-error adapter correctly returned `AGENT_FROZEN_INPUT_DRIFT`. Only the exact expected code was corrected; the first log remains local. No production check was relaxed.
- Final frozen-source task gate `2026-09-12T09-42-17-991Z-task`: 6/6 selected steps passed (typecheck, lint, Node targeted 369/369 in 24 files, contract 16/16, desktop build, source Electron AI 13/13). No selected failure, skip, flaky or missing execution; source fingerprints were unchanged and test processes exited. Node groups may overlap. No Browser/core/standalone editing Electron lane was selected.
- Evidence limits: synthetic local protocol/provider fixtures, no real vendor/tokenizer or timing claim, installed-app or private-corpus validation. The existing identity-repair test does not prove the real Runtime retry budget path; this P2 coverage gap remains recorded without expanding this change. No new layout or pixel-equivalence claim.

## 2026-09-08 — 独立服务配置与接入恢复

- Truth: 本批三条真实旅程要求；沿用既有桌面视觉语言，共享控件但分别布局设置页与侧栏。
- Evidence: `output/design-qa/agent-setup-journeys/` 中的 `settings-key-form.png`、
  `settings-deepseek-high.png`、`settings-codex-authenticated-repair.png`、
  `narrow-sidebar-generating.png`、`narrow-sidebar-codex-repair.png`、
  `review-result.png`、`codex-second-round.png`（真实 Electron，合成页面与本地协议 fixture）。
- 核对：复选框实际 16×16 CSS px；正文 13–14px、控件 34px；无遗留品牌空列或浏览器默认按钮。
  默认 Codex 标记在故障时保留；非默认 DeepSeek 的“高”经进程重启仍保留，实际请求与 Candidate
  fixture 标记一致。生成状态与停止在同一条目，没有空 Thinking 消息，字节数折叠。
  侧栏恢复区只有一个强调修复操作，原发送区被替换；修复后完成首轮、审阅采纳和第二轮。
- 修复复核：旧安装行停留在安装前状态，改为从现有 access operation / installState 派生临时状态；
  删除设置行旧有的 140–220px 控制槽、10px 按钮与 11px 截断说明覆盖规则，并以实际计算样式和按钮横坐标回归；
  受管任务完成后也不再重新出现旧交接摘要，审阅截图等待真实审阅工作区出现。
  尚未检查的折叠服务显示“未检查 / 检查”，不把初始未知状态伪装成正在执行检查。
  未确认认证的普通连接失败不再误导为组件修复。字段错误在对应控件附近，更多菜单不被卡片裁切。
- 验收边界：组件故障与安装回执使用受控 fixture，不能代替真实下载安装或账号旅程。
  真实浏览器登录及其后两轮验收由用户明确暂缓；本批不启动浏览器登录，不替换已安装应用。
- final result: scoped visual/fixture journeys passed; real-account acceptance pending.

## AI review workspace — final seven-state contract

Date: 2026-08-03

### Comparison target

- Source visual truth: `/tmp/review-toolbar-unified-v3.png`
- Rendered implementation: `output/design-qa/ai-review-final.png`
- Additional rendered state: `output/design-qa/ai-review-map.png`
- Full combined comparison: `output/design-qa/comparison-full.png`
- Focused toolbar comparison: `output/design-qa/comparison-toolbar.png`

The source board establishes the accepted visual language: one quiet white
review surface, neutral gray segmented controls, one violet selected state,
compact labels and a centered retractable handle. The later product decision
supersedes two information-architecture details visible in that board:

1. the two version cards are removed and replaced by one `整页 / 左页 / 右页`
   page-preview group;
2. the former mixed review group is separated into `页面预览` and
   `变化审阅（全部变化 / 文案 / 结构 / 视觉）`, while both groups retain the
   same segmented-control treatment.

The implementation is judged against that later contract, not against the
superseded card content.

### Viewport, pixels and density normalization

- Source board: `1720 × 402` physical pixels.
- Electron implementation: `2880 × 1920` physical pixels from a
  `1440 × 960` CSS-pixel window at Retina `2×` density.
- Primary state: light theme, toolbar pinned, `整页` selected, context `22%`,
  synchronized scrolling selected, zoom `100%`, content map closed.
- Additional state: the same viewport and controls with the complete content
  map pinned open.
- Full comparison normalization: the implementation's top `2880 × 620`
  physical-pixel crop is Lanczos-downsampled to `1720 × 370` and vertically
  combined with the source board at its native `1720 × 402` size.
- Focused comparison normalization: source toolbar crop `1592 × 120`
  (`x=64, y=218`) is combined with implementation toolbar crop `2824 × 224`
  (`x=28, y=190`) downsampled to `1592 × 126`.
- The source says `7 处变化` and the deterministic Electron fixture says
  `4 处变化`; these are dynamic document facts and are not treated as visual
  drift.

### Full-view and focused evidence

- The full comparison confirms the formal PageRoot header, review surface,
  centered retractable handle and dual-page canvas form one clear vertical
  hierarchy. The pinned toolbar ends before the version headers begin, so it
  no longer covers either page caption.
- The focused comparison makes every persistent toolbar label readable. All
  seven review states share the same height, radius, gray resting surface,
  violet active color and white selected tile.
- The explicit `整页` button is the selected entry state. `左页` and `右页`
  sit in the same group, while the four change modes form a distinct but
  visually identical group. This is the final requested hierarchy.
- The map-state screenshot confirms that the drawer remains attached to the
  right edge, preserves the full-height page canvas, shows unchanged as well
  as changed regions and does not collide with the pinned review toolbar.

### Required fidelity surfaces

- Fonts and typography: the implementation uses the product's system stack
  (`-apple-system`, `SF Pro Display`, `Segoe UI`) and follows the source's
  compact optical hierarchy. Labels, active weights, metadata and percentages
  remain single-line and legible without truncating a core mode name.
- Spacing and layout rhythm: toolbar padding, 38 px segmented shells, 32 px
  selected tiles, 10 px control labels, 15 px outer radius, quiet elevation
  and the centered handle reproduce the source's density. Grid tracks were
  rebalanced so the four-item change group receives enough width.
- Colors and visual tokens: neutral `#f1f1f5` controls, white active tiles,
  gray metadata and the single violet family (`#6258d6` / `#4f47b8`) preserve
  the source's one-emphasis-color rule. Before/after identity uses only a quiet
  neutral dot and a violet dot; red/green comparison surfaces are absent.
- Image quality and asset fidelity: the target contains no photographic or
  illustrative asset. All visible interface icons use the existing Phosphor
  icon package and the product's HTML file icon treatment; no emoji,
  handcrafted SVG, CSS drawing or placeholder image replaces a source asset.
- Copy and content: persistent copy matches the frozen contract — `页面预览`,
  `整页`, `左页`, `右页`, `变化审阅`, `全部变化`, `文案`, `结构`, `视觉`,
  `上下文可见度`, `滚动方式` and `画布缩放`. The formal header actions are
  `返回 AI 修改前` and `接受全部并打开`.
- Icons and controls: icon weight and 12–20 px sizing are consistent with the
  existing workbench. Selected, resting, disabled, focus-visible and pinned
  states remain distinguishable.
- Accessibility and resilience: both segmented groups support arrow keys plus
  Home/End, every state exposes `aria-pressed`, the confirmation dialog traps
  focus and restores it to its trigger, reduced motion removes toolbar/drawer
  transitions, and the tested `1440 px` and constrained `1180/980 px` grids do
  not hide persistent mode labels.

### Findings and comparison history

1. Initial comparison — `[P2]` the pinned toolbar overlaid both page-version
   headers. Fix: the pinned state now reserves `118px` above the canvas grid,
   uses border-box sizing and disables that transition under reduced motion.
2. Initial comparison — `[P2]` the last item in the four-mode change group
   could clip because the context slider owned too much grid width. Fix: grid
   tracks were reordered and rebalanced at the base, `1180px` and `980px`
   layouts, then the implementation was recaptured.
3. Post-fix focused comparison — `整页`, all four change labels, sync controls
   and `100%` are fully readable; no overlap, clipping or inconsistent selected
   surface remains.
4. Post-fix full comparison — the official header, toolbar, dual-page headers,
   page canvas and optional content map retain clear boundaries at the same
   Electron viewport.

No actionable P0, P1 or P2 finding remains. The source's version cards and
single mixed mode row are intentionally superseded by the user's later,
explicit seven-state hierarchy.

### Interaction and automated evidence

- Default entry is a clean dual-page `整页` preview; `左页` and `右页` each
  render one page, and the explicit `整页` action restores the dual-page view.
- Any change mode restores the dual-page canvas and focuses the first matching
  change. Empty modes expose a status message instead of leaving stale marks.
- All-change overview uses sparse outer dashed regions. Text mode uses
  sentence groups plus precise insert/remove markers, structure mode detects
  pure movement, and visual mode uses violet-blue dashed presentation marks.
- The complete map reveals an authored hidden Tab before focusing its region.
- Linked horizontal scrolling mirrors pixel position; linked vertical
  scrolling aligns by outline-region ID and relative progress rather than raw
  page offset.
- Both return and accept paths require confirmation; the accept path activates
  the verified candidate only after explicit confirmation.
- The real Electron closed-loop suite passes both AI review/acceptance and
  broad-related-result scenarios with the source file unchanged until accept.

### Implementation checklist

- [x] Shared official workbench header.
- [x] One mutually exclusive seven-state model rendered as two control groups.
- [x] Explicit whole-page return from either single-page view.
- [x] Sparse, mode-specific diff presentation.
- [x] Complete map, hidden-panel reveal and semantic scroll synchronization.
- [x] Keyboard, focus-dialog and reduced-motion behavior.
- [x] Same-state full and focused visual comparison after P2 fixes.

final result: passed

## Comment, safe page-switching and update-header polish

Date: 2026-07-31

Source visual truth:

- User-provided local captures (not committed) showed a focused comment hidden
  by the sticky header, a page-switch action that must preserve scroll, and the
  required whole-page-first comment order.
- Additional local captures established the existing HTML identity control,
  available header space and centered no-update geometry.
- Two real-report captures established the supported `data-p` and
  constant-index `onclick` Tab patterns; another showed that dense comments
  must stop at the authored page bottom rather than stretching the review
  stage.

Implementation evidence:

- `output/design-qa/comment-presentation-header-polish/no-update.png`
- `output/design-qa/comment-presentation-header-polish/new-update.png`
- `output/design-qa/comment-presentation-header-polish/restart-update.png`
- `output/design-qa/comment-presentation-header-polish/header-geometry.json`
- `tests/e2e/browser/native-dom-comment-tabs.spec.mjs`
- `tests/e2e/browser/native-dom-presentation-actions.spec.mjs`
- `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs`

Viewport, density and state:

- Header captures come from the real Electron renderer at a `1440px` CSS
  viewport. Each screenshot clips the top-left `900 × 88` CSS-pixel region
  and is saved at Retina 2× density as `1800 × 176` pixels.
- `no-update.png` captures the normal identity control before update state is
  injected. `new-update.png` uses the real update-available IPC state. The
  downloaded state dismisses the normal restart confirmation with “稍后” before
  `restart-update.png` is captured, so the header is evaluated without a
  modal overlay.
- The browser interaction oracle runs at `1600 × 900` CSS pixels with normal
  mouse, keyboard, textarea and scroll input.

Full-view and focused comparison evidence:

- The HTML icon remains `34 × 34px` inside a fixed `60 × 42px` interaction
  cluster and uses the cluster's exact vertical center in all three states.
  Both update labels are absolutely positioned in the lower part of that same
  cluster, producing the attached badge treatment without changing icon,
  cluster or neighboring title geometry.
- The cluster, icon and two-line title/metainfo block all share the exact
  `y=53.875` center. The icon remains at `y=36.875…70.875` in the no-update,
  available and downloaded captures. The visible update text ends at
  `y=75.375`, leaving `12.625px` above the `88px` header boundary.
- The longer visible label ends at `x=82.992`; the title/metainfo column begins
  at `x=92`, retaining a measured `9.008px` gap. The compact `New!` label has
  substantially more space. Neither label touches the title, metadata, plus
  action or open-in-folder action.
- Clicking the HTML icon opens the existing About dialog; the icon remains a
  single accessible button, and its update child action has its own accessible
  label.

Behavioral evidence:

- Opening a new comment requests focus after the composer mounts. Enter saves;
  Shift+Enter inserts a newline; IME composition never submits. The same
  keyboard contract applies when editing a saved comment.
- A selected comment is aligned no higher than the sticky header's measured
  safe bottom. Whole-page comments use an explicit leading scope rank, while
  all other page-position ordering remains stable.
- The Canvas natural height owns the rail bottom. A dense queue is vertically
  clipped rather than increasing shared-page height; after the page reaches its
  bottom, continued downward wheel input translates later cards into view and
  reverse input restores the natural queue.
- During native text editing, visible comment targets retain their last stable
  top and height. Runtime text reflow therefore cannot make adjacent cards
  jump, while the next settled layout can still refresh normally.
- Page-presentation switching captures the shared Canvas scroll position and
  restores it after the presentation mutation. The old unconditional
  “presentation became ready” reveal is removed; explicit user navigation still
  reveals its intended target.
- The legacy page switchers are deliberately narrow: either one uniform
  `data-p` / `data-tab` control group with unique panel IDs, or one sibling
  control group with the same exact constant-index handler and one uniquely
  related uniform panel group. Both require a single matching active pair and
  permit only disposable `active` class changes. Authored scripts are never
  executed and source bytes are never written.
- The supplied `26Q2搜索市场概览(1).html` resolves three safe controls, exposes
  “切换到此页签” for `p2`, changes only the isolated rendered presentation and
  leaves the source unchanged. Ambiguous, mixed, duplicate and multi-active
  fixtures fail closed.
- The newly supplied four-Tab report resolves the exact
  `switchChart(0…3)` sequence to four controls. Selecting its second control
  proposes one `activate-tab` action with exactly four disposable class
  transitions; no source write or handler execution is involved. Duplicate,
  skipped, mixed, compound, multi-active and multi-panel-candidate variants
  remain inert.

Findings:

- No actionable P0, P1 or P2 visual or interaction defect remains in this
  scope.
- The update label is intentionally small and attached to the HTML icon. It
  stays readable in both states without displacing or obscuring any neighboring
  header element.
- The comment and page-switching changes are presentation-only. They do not
  reorder persisted comments, execute authored page scripts, or modify source
  bytes.

Interaction and regression history:

1. Pure helpers established the sticky-header clamp, whole-page-first rank,
   text-edit geometry freeze and keyboard submission contract.
2. Browser tests exercised real focus, Enter/Shift+Enter, saved-comment edit,
   native content reflow, queue ordering and preserved scroll.
3. Electron tests injected both real update states, opened About through the
   HTML icon, measured all header rectangles and captured the final images.
4. The final visual comparison found no clipping, overlap, header overflow or
   unintended spacing change; no subsequent P0/P1/P2 repair was required.
5. The complete task gate passed: architecture, TypeScript, lint, 310 Node
   assertions, production web build, 10 browser smoke tests, real-HTML
   authority, desktop build, 6 Electron smoke tests and 2 AI closed-loop
   tests. The report is
   `output/test-runs/2026-07-31T05-05-54-402Z-task/results.json`.

final result: passed

---

## About dialog simplification

Date: 2026-07-30

Source visual truth:

- User-provided local reference image (not committed).
- User direction: remove the four red-marked regions—“PageRoot for macOS”,
  “Apache-2.0”, the complete usage-data notice, and the update-channel
  eyebrow—then realign the remaining content into a balanced compact dialog.

Implementation evidence:

- `output/about-dialog-after.png`
- `output/about-dialog-comparison.png`
- `output/about-dialog-focused-comparison.png`

Viewport and normalization:

- Source and implementation full captures are both `1252 × 1128` pixels.
- Implementation browser viewport: `1252 × 1128` CSS pixels at 1× density.
- The source dialog is a Retina-style capture. For the authoritative focused
  comparison, its `1160 × 1078` dialog crop is downsampled to `580 × 539`.
  The implementation dialog is compared at its native `580 × 388` CSS-pixel
  size, aligned at the same normalized width.
- State: current stable application version, Apple silicon, About dialog open.

Full-view and focused comparison evidence:

- All four requested regions are absent from the rendered dialog; a bounded
  text check also confirms no hidden residual copy remains.
- The remaining identity, metadata, update, GitHub, and footer surfaces share
  the same `518px` left/right content baseline.
- The dialog measures `580 × 388px` and does not scroll. Removing the long
  notice therefore reduces height without leaving a blank middle region.
- Vertical rhythm is compact and regular: identity to metadata `18px`,
  metadata to update card `20px`, update card to GitHub card `12px`, and
  GitHub card to footer `15px`.
- The update title now becomes the first text line beside its icon, preserving
  the status hierarchy after the eyebrow is removed.

Findings:

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the established family, weights, sizes, line heights,
  truncation behavior, and Chinese hierarchy remain unchanged; only the
  explicitly removed eyebrow text is gone.
- Spacing and layout rhythm: the dialog is centered, all major sections use
  the same horizontal baseline, and the reduced height has no dead space,
  clipping, overlap, or scrollbar.
- Colors and visual tokens: the existing white/indigo identity surface, green
  current-version card, borders, radii, blur, and shadows remain intact.
- Image and icon fidelity: the supplied PageRoot logo and existing Phosphor
  icons are unchanged and remain sharp at their intended sizes.
- Copy and content: exactly the four marked content groups are removed. Version,
  architecture, update state, GitHub description, and disclaimer entry remain.

Comparison history:

1. The source contained four user-marked regions that lengthened the dialog
   and diluted the primary product/update hierarchy.
2. The first implementation removed those regions and tightened metadata and
   update-card margins.
3. Post-fix rendering confirmed a `580 × 388px` non-scrolling dialog, aligned
   `518px` content tracks, no residual marked copy, and no page or console
   errors. No subsequent P0/P1/P2 fix was required.

Interaction checks:

- The unique close button closes the dialog and the local desktop-state fixture
  reopens it successfully.
- The current-version action remains enabled and visually aligned.
- Page errors: none.
- Browser console warnings and errors: none.

final result: passed

---

## Fixed comment geometry, queue alignment and recoverable edits

Date: 2026-07-31

Source visual truth:

- Three user-provided local captures (not committed) established the original
  Canvas/comment-rail composition, the stronger selected-card boundary and the
  recovery state for a changed but unconfirmed saved-comment edit.
- The approved external interaction fixture (not committed) supplies the
  queue-translation and wheel-handoff oracle.

Implementation evidence:

- `tests/e2e/browser/native-dom-comment-tabs.spec.mjs` covers clean/dirty edit
  switching, exact draft resumption, stable hover geometry, selected boundary,
  Canvas framing, unchanged DOM order, aligned queue offset and wheel routing.
- `tests/comment-rail-layout.test.mjs` covers deterministic queue layout,
  aligned offset, page-first wheel routing and page-top rail restoration.
- The approved fixture's live 1280 × 720 comparison was rechecked beside the
  original PageRoot capture after the hint removal and fixed-height update.

Required fidelity surfaces:

- Card geometry: the 30px action row plus 6px gap is reserved in default,
  hover, selected and edit states. Only opacity and pointer availability
  change, so ResizeObserver does not move neighboring cards on pointer entry.
- Focus boundary: the selected card keeps one physical boundary, strengthens
  it to `#8f8ae8`, and adds the `#5e58d9` leading emphasis without a second
  outer halo or a width-changing state transition.
- Queue behavior: natural `top` values and DOM order remain source-position
  based. Explicit card/draft navigation changes one shared CSS translation;
  target and selected card settle within 3px in the browser oracle.
- Wheel behavior: input over the right rail changes the shared review stage.
  Upward input restores a negative rail offset only after the stage reaches
  its top; down and non-top movement retain page priority.
- Edit transaction: text and attachment changes stay outside the saved
  `CommentItem` until confirmation. A clean edit cancels when its target leaves
  the active Tab; a dirty edit persists one local recovery record and resumes
  at the original framed target from “有一条未保存修改”.
- Copy: no “向上滑动找回隐藏评论” hint is introduced in production or the
  approved fixture.

Interaction checks:

- Existing current/other-Tab draft route suite: passed.
- New clean/dirty saved-edit Tab suite: passed.
- New fixed-height, selected alignment, order and wheel suite: passed.
- Pure rail helper suite: 10/10 passed.
- TypeScript and architecture contract: passed.
- Full task gate: passed (430 Node assertions, browser smoke, real-HTML
  discovery, Electron smoke and AI closed-loop smoke; no failures).
- Browser console/page errors in the covered flows: none.

Findings:

- No actionable P0, P1 or P2 mismatch remains in this scope.
- The queue translation is deliberately presentation-only; it never changes
  source anchors, comment identity, timestamps or persistence order.

final result: passed

---

## Unsaved comment routing and stable rail order

Date: 2026-07-30

Source visual truth:

- Three approved generated references (not committed) define the current-Tab
  header hierarchy, other-Tab expansion with neutral cards and the resumed
  composer styling.
- Final user annotations supersede two details in those images: a hidden-Tab
  draft has no duplicate “有一条未保存评论” shortcut, and every saved card,
  collapsed draft and composer follows page-position order rather than giving
  the composer priority.

Implementation evidence:

- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-draft-recovery.png`
- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-other-tab-draft.png`
- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-hidden-draft-resumed.png`

Combined comparison inputs:

- `output/design-qa/2026-07-30-comment-draft-routing/comparison-current-draft.png`
- `output/design-qa/2026-07-30-comment-draft-routing/comparison-other-tab-draft.png`
- `output/design-qa/2026-07-30-comment-draft-routing/comparison-resumed-composer.png`

Viewport and normalization:

- Implementation viewport: `1600 × 900` CSS pixels at 1× density; the visible
  comment rail crop is `376 × 812` pixels from below the application header.
- Source images: `906 × 1736`, `940 × 1672` and `906 × 1736` pixels. Each
  source rail was proportionally downsampled to `376` pixels wide and placed
  at the top of a `376 × 812` neutral canvas.
- Each combined comparison places the normalized source on the left and the
  final implementation rail on the right, separated by a `20px` neutral gutter.
- States: current-Tab collapsed draft; other-Tab group expanded with one saved
  card and one tagged draft; hidden draft selected and resumed in its original
  current-Tab composer.

Full-view and focused comparison evidence:

- The current-Tab header keeps the approved `评论 4` hierarchy and two compact
  full-width actions. The page-position draft card uses the same unselected
  saved-card surface, with only a small “未保存” status pill.
- The other-Tab state has one header action, keeps expansion inside the header,
  removes the redundant group count pill, and shows exactly the two cards
  counted by “其他标签页评论 2”.
- The resumed composer keeps the existing PageRoot target summary, textarea,
  attachment tools and primary action. The new trash action uses the same
  Phosphor tool-button treatment and leads to an inline confirmation.
- Focused comparisons are the rail crops themselves: every label, badge,
  border, icon and card gap remains readable at the implementation’s exact
  1× density, so a narrower secondary crop would not add evidence.

Required fidelity surfaces:

- Fonts and typography: existing PageRoot system-font family, optical weights,
  9–15px control hierarchy, line heights and truncation are retained. The
  generated source was normalized by rail width; its larger raster text is not
  treated as an implementation font-size requirement.
- Spacing and layout rhythm: header actions retain the approved stacked rhythm.
  Saved cards, collapsed drafts and composers use measured heights plus at
  least `16px` visible separation; the Browser oracle confirms the order
  remains `Tab comment 1 → Tab comment 2 → page comment → composer`.
- Colors and visual tokens: white surfaces, cool gray rail, violet status and
  focus tokens, neutral borders and shadows all reuse the existing comment
  card system. “未保存” is a quiet state label rather than a warning banner.
- Image quality and asset fidelity: this flow contains no raster product
  assets. Existing Phosphor caret, attachment, image, trash, close and comment
  icons are reused; no handcrafted icon or placeholder asset was added.
- Copy and content: “有一条未保存评论”, “其他标签页评论 N” and “未保存”
  match the approved copy. Close still means preserve; only the explicit
  “删除未保存评论” path can discard the draft.

Comparison history:

1. The pre-change rail gave the composer/focused item layout priority, which
   could move earlier page comments below it and let the recovery surface
   compete with saved cards. This was a P1 ordering and comprehension issue.
2. The first implementation removed focus-based ordering and unified all
   current-Tab items under one deterministic page-position layout. Browser QA
   then exposed a transient same-target fallback that could split two Tab
   comments while a hidden draft was restored.
3. Target positions are now normalized by shared Canvas marker identity,
   preferring measured positions over stale selection fallback coordinates.
   Post-fix Browser assertions wait for ResizeObserver measurement and prove
   the complete order plus a minimum `16px` gap before the final screenshots.

Interaction checks:

- Current-Tab shortcut locates and focuses the original composer without
  disappearing.
- Preview-to-Edit Tab switching moves the draft into the correct other-Tab
  group and removes the duplicate current shortcut.
- Clicking the entire hidden draft card switches back, restores the exact text
  and focuses the composer.
- Saving removes the shortcut in the recovery suite; explicit deletion removes
  shortcut, draft card and composer together.
- Main `评论 4`, send count and Canvas `评1` remain unchanged while the draft
  exists.
- Header expansion moves the rail items down without changing their relative
  order, and measured hover/composer states do not overlap.
- Browser console warnings and errors: none.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- Intentional differences from the generated images are limited to the two
  later user decisions documented under source visual truth.

final result: passed

---

## Workbench header height and overflow

Date: 2026-07-29

Source visual truth:

- User-provided macOS application capture (not committed) showing the two-line
  file summary and primary actions touching or crossing the old header divider.
- The source attachment is local-only and remains outside the repository.
- User direction: preserve the existing header hierarchy and styling while
  adding enough height for every icon and label to remain inside the bar.
- User follow-up direction: add a diagonal default-browser action beside the
  filename plus action, give both icons concise upper-right hover hints, and
  keep the already approved header height unchanged.

Implementation evidence:

- `output/design-qa/2026-07-29-header-height/implementation-cdp-full.png`
- `output/design-qa/2026-07-29-header-height/implementation-compact-full.png`
- `output/design-qa/2026-07-29-header-file-actions/implementation-wide-open-tooltip.png`
- `output/design-qa/2026-07-29-header-file-actions/implementation-compact-browser-tooltip.png`

Combined comparison inputs:

- `output/design-qa/2026-07-29-header-height/comparison-source-vs-implementation.png`
- `output/design-qa/2026-07-29-header-height/comparison-actions-focused.png`

Viewport and normalization:

- Source pixels: `2872 × 182`, representing a `1436 × 91` CSS-pixel Retina
  application crop at 2× density.
- Wide implementation: `2560 × 1440` pixels from a `1280 × 720` CSS viewport
  at 2× density.
- Compact implementation: `1800 × 1440` pixels from a `900 × 720` CSS
  viewport at 2× density.
- The full comparison keeps the source at its native pixels and centers the
  implementation's top `2560 × 220` pixels in a same-width white comparison
  frame. The focused comparison uses native-density right-action crops.
- The source contains macOS traffic lights and a desktop project state. The
  browser implementation omits native window chrome and uses the read-only
  welcome project; those state differences are excluded from layout judgment.

Full-view and focused comparison evidence:

- The workbench header now measures exactly `88px`; the review stage begins at
  `y = 88px`, so the shared grid row and header box remain synchronized.
- Header padding computes to `30px 16px 12px 22px` at the wide viewport and
  `30px 12px 12px 20px` at the compact breakpoint.
- At both widths, every measured header descendant is inside the header.
  The lowest elements are the file metadata and send button at
  `y = 77.75px`, leaving `10.25px` before the divider.
- The compact `900px` viewport keeps the complete title, quick-open action,
  edit/preview group, project, global comment and send button within the
  horizontal viewport; `scrollWidth` equals `clientWidth`.
- The two filename actions form one fixed `57 × 28px` group. A synthetic long
  filename shrinks to `161px` with ellipsis at the compact viewport while the
  complete action group remains inside its `220px` title row.
- Both tooltip boxes are absolutely positioned and therefore do not change the
  title row or header box. The longer browser tooltip measures about
  `107 × 24px`, remains fully inside the viewport, and starts at `y = 2px`
  rather than clipping against the top edge.
- The focused right-action comparison shows the intentional new bottom
  breathing room while retaining the existing control order, spacing, radii,
  icon scale and visual hierarchy.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- Fonts and typography: font family, size, weight, line height, wrapping and
  labels are unchanged by this patch. Different source/implementation labels
  come only from the desktop versus browser-preview state.
- Spacing and layout rhythm: header height increases from `76px` to `88px`,
  bottom padding from `8px` to `12px`, and the notification offset consumes
  the same shared height variable.
- Colors and visual tokens: backgrounds, borders, state colors, shadows and
  translucency are unchanged.
- Image and icon fidelity: the existing Phosphor plus icon is retained and the
  matching Phosphor `ArrowSquareOut` icon supplies the requested lower-left to
  upper-right direction; no approximate SVG or image asset was introduced.
- Copy and content: the two tooltips use exactly “打开本地HTML” and
  “在默认浏览器中打开”. In the browser-only preview the latter icon is visibly
  disabled while its explanatory tooltip remains full-contrast.

Comparison history:

1. The source exposed a P1 persistent-header containment failure: the old
   `76px` row left the two-line file metadata and `38px` send button on the
   divider, with visible content/shadows extending below it.
2. The row height, header minimum height and notice offset were unified behind
   `--notice-header-height: 88px`; wide and compact bottom padding became
   `12px`.
3. Post-fix wide and compact measurements show a minimum `10.25px` bottom gap,
   no descendant outside the header, no page-width overflow and no console
   warning or error.
4. The follow-up action cluster preserves the same `88px` header and
   `10.25px` minimum bottom gap. The first tooltip draft touched the viewport
   edge and inherited disabled opacity; moving it down `3px` and scoping
   disabled opacity to the SVG made the hint fully legible without affecting
   layout.
5. User review rejected the dark tooltip surface. The final treatment uses the
   header's near-white surface, a `#e1e2e8` border, muted gray text and a soft
   shadow; geometry and placement remain unchanged.

Interaction checks:

- The header's unique “项目” button opened its panel with
  `aria-expanded="true"` and closed it again with `aria-expanded="false"`.
- The project panel content was visible while expanded.
- Hover-state inspection showed each exact tooltip after its short delay; the
  default-browser action stays unavailable when the desktop preload bridge is
  absent.
- The desktop bridge accepts only a validated known HTML path, converts it to a
  `file:` URL in the main process, and exposes no renderer-controlled URL.
- Browser console warnings and errors: none.

final result: passed

---

## Qoder handoff progress-card redesign

Date: 2026-07-29

Source visual truth:

- User-provided approved flow-panel capture
  (`codex-clipboard-207a9bc1-c4a1-40f8-a453-b1c0a386fd81.png`, local-only).
- The capture was reviewed locally and remains outside the repository.

Implementation evidence:

- `output/design-qa/2026-07-29-handoff-redesign/handoff-waiting-final-1400x900.png`
- `output/design-qa/2026-07-29-handoff-redesign/handoff-waiting-final-1280x720.png`

Combined comparison input:

- `output/design-qa/2026-07-29-handoff-redesign/comparison-reference-vs-final.png`

Viewport and normalization:

- Full-height application viewport: `1400 × 900` CSS pixels. The handoff drawer
  measured `1040 × 760` pixels and the process panel measured
  `504.398 × 489` pixels.
- Compact application viewport: `1280 × 720` CSS pixels. The process panel
  measured `504.398 × 353` pixels.
- The source process-panel crop (`1010 × 977`) and full-height implementation
  process-panel crop (`504 × 489`) were each normalized to `600` pixels wide
  without stretching their heights.
- State: one completed handoff stage, AI stage in progress, validation and
  result pending.

Visible comparison:

- The four cards retain the approved green, indigo and neutral hierarchy with
  numbered circles, stage-specific icon wells, aligned copy and right-edge
  status.
- The validation card uses the approved Phosphor floppy-disk outline, centered
  in the same `40 × 40` icon well as the other stages.
- The active AI card keeps its dashed icon ring and status pill. The bright
  blue outline and dotted text boxes visible in the source are Figma selection
  chrome and are intentionally absent from production.
- The footer divider is removed. The existing actions keep their order and
  button treatment while aligning to the footer top edge, closer to the content.
- Header, summary and body padding were tightened enough to preserve the tall
  card rhythm at the full-height viewport without changing the right-side
  record hierarchy.

Measured checks:

- At `1280 × 720`, all four card rows remain visible at approximately
  `65.95` pixels high.
- Every row's number, icon and status share the same measured vertical center.
- The process panel has no horizontal or vertical overflow.
- The longer validation detail has no text clipping.
- The computed footer top border is `0px`.
- A clean page load produced no browser warnings or errors.

final result: passed

---

## Comment card hierarchy and progressive actions

Date: 2026-07-28

Source visual truth:

- Three user-provided comment-card captures covering visible actions, editing
  hierarchy and the normal-state outer halo. They were reviewed locally and
  remain excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-28-comment-card/comment-card-default-full.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-default.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-hover.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-editing.png`

Combined comparison inputs:

- `output/design-qa/2026-07-28-comment-card/comparison-default-source-vs-production.png`
- `output/design-qa/2026-07-28-comment-card/comparison-hover-source-vs-production.png`
- `output/design-qa/2026-07-28-comment-card/comparison-editing-source-vs-production.png`

Viewport and normalization:

- Production browser viewport and full screenshot: `1280 × 720` CSS pixels at
  1× output density.
- Focused production rail fixture: `376 × 430` CSS pixels; rendered card width
  `348` pixels.
- Source captures: `1486 × 546`, `712 × 542` and `762 × 698` pixels. Their CSS
  viewport and density are unavailable.
- Each focused comparison crops the source and production card regions, then
  normalizes both rail widths to `600` pixels without stretching their heights.
- States: saved comment at rest, actual forced `:hover`, keyboard focus within
  the card, and focused editing.

Full-view comparison evidence:

- The production build was opened at the target viewport and the real PageRoot
  stylesheet was exercised with a temporary synthetic comment-card fixture.
  The fixture used the production markup classes and the same Phosphor icons as
  the application; it was removed after the check.
- The normal card retains the existing right-rail placement, connector,
  typography hierarchy and semantic purple accent while removing the second
  outer ring.
- No page overflow, clipping, broken radius or unexpected surrounding layout
  change appeared in the full capture.

Focused comparison evidence:

- Fonts and typography: saved-comment text and edit text both compute to
  `14px` with `23.1px` line height. Existing target-label and timestamp
  hierarchy remains unchanged.
- Spacing and layout rhythm: the default footer computes to `0px` height and
  `0px` top margin. Hover, keyboard focus and editing reveal a `30px` footer
  with `6px` separation; the card grows by exactly `36px`.
- Colors and tokens: normal, located-focus and editing states each compute to
  one `1px` border, no outline and one
  `0 15px 32px rgb(45 42 104 / 7%)` shadow.
- Editor hierarchy: the focused textarea has a `0px` border, no outline, a
  light-gray tonal background and one `2px` inset purple focus underline.
- Image and icon fidelity: the existing Phosphor paperclip, image, pencil,
  trash, cancel and confirm icons are retained. No replacement asset or
  approximate glyph was introduced.
- Copy and content: production labels, timestamp format and comment content
  remain unchanged; only the approved text size and presentation states move.
- Divider: the footer computes to a `0px` top border in every checked state.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- The compact reveal is safe for keyboard users: programmatic keyboard focus on
  the card reveals the same `30px` tools while retaining a single card shadow.
- Dense-card placement continues to use the existing `ResizeObserver` height
  measurements, so the additional `36px` revealed height is fed back into the
  established non-overlap layout rather than being reserved at rest.

Comparison history:

1. Source inspection found a P2 hierarchy issue that would have survived a
   base-card-only change: the later `data-focused="true"` rule still added a
   second purple ring and an animated multi-shadow.
2. The composer focus treatment was separated from saved-comment focus.
   Normal, located-focus and editing cards now share one border and one shadow;
   the editor uses a tonal plane and focus underline.
3. Post-fix computed measurements confirmed default footer height `0px`, hover
   and editing footer height `30px`, `6px` reveal spacing, `14px` comment text,
   no divider, no card outline and no second shadow.

Browser checks:

- Production build loaded successfully at the target viewport.
- Default, hover, keyboard-focus and editing states were captured and compared.
- The browser console contained no warnings or errors.

final result: passed

---

# Welcome badge top-right alignment QA

Date: 2026-07-29

Source visual truth:

- `codex-clipboard-bb90f74c-2ac3-4652-b498-dc0d2fd33f92.png` — user-provided temporary reference attachment, `248 × 118` pixels, intentionally excluded from the public repository.
- User direction: preserve the existing badge and the rest of the welcome page, while moving the badge to the upper-right corner of the full hero.
- Scope baseline: commit `9541d13`, the existing PR #52 head before this badge-alignment request. Statements about unchanged surrounding content in this section apply only to the later alignment subchange; the PR's earlier agent-positioning rewrite is documented by the other welcome-page QA evidence.

Implementation evidence:

- `docs/assets/pageroot-welcome-hero.png`
- `output/design-qa/2026-07-29-welcome-badge/desktop-1080x900.png`
- `output/design-qa/2026-07-29-welcome-badge/compact-720x1000.png`
- `output/design-qa/2026-07-29-welcome-badge/badge-region-desktop.png`

Combined comparison input:

- `output/design-qa/2026-07-29-welcome-badge/reference-vs-final.png`

Viewport and state:

- Desktop viewport: `1080 × 900` CSS px; hero region: `1038 × 512` pixels.
- Compact viewport: `720 × 1000` CSS px.
- Source pixels: `248 × 118`; focused implementation pixels: `248 × 118`.
- Both implementation captures used device scale factor 1, so no density normalization was required.
- State: standalone built-in welcome page, default scroll position, fonts loaded.

## Findings

- No actionable P0, P1, or P2 visual issue remains.
- Fonts and typography: the badge retains the existing font size, tracking, weight, and single-line label. No other typography changed.
- Spacing and layout rhythm: on desktop the badge is positioned `44px` from the hero top and `50px` from its right edge. At the compact breakpoint it is `30px` from the top and `24px` from the right. It does not overlap the brand lockup or source card at either viewport.
- Colors and visual tokens: the existing translucent violet surface, white border, muted text, and rounded shape are unchanged.
- Image quality and asset fidelity: the provided reference and final focused region were inspected together. The implemented badge preserves the same visual treatment and renders sharply; no new image or icon asset was introduced.
- Copy and content: relative to the `9541d13` scope baseline, the label remains exactly “内置介绍页” and this alignment subchange does not alter other welcome-page content or visible controls.
- Responsiveness: desktop and compact renders have no horizontal overflow, clipping, or collision.

## Comparison history

1. The baseline placed the badge at the right edge of the hero's left grid column, which left it near the upper middle of the full hero.
2. The badge was moved to be a direct child of the hero and positioned against the hero's upper-right inset. Compact offsets were matched to the existing compact hero padding.
3. Final full-view and focused captures show the badge in the requested corner with the surrounding layout unchanged.

## Browser checks

- Verified the rendered page at `1080 × 900` and `720 × 1000`.
- Confirmed loaded fonts, exact offsets, no element overlap, no horizontal overflow, and no browser console errors.

## Follow-up polish

- None required for this focused alignment change.

final result: passed

---

Viewport: 1280 × 720

References:

- `implementation-v5-composer-tools-1280x720.jpg`
- `implementation-v5-version-panel-1280x720.jpg`

Implementation captures:

- `output/ui-v5-global-composer-1280x720.png`
- `output/ui-v5-version-panel-1280x720.png`

Combined comparison inputs:

- `output/ui-v5-composer-reference-vs-final.png`
- `output/ui-v5-version-reference-vs-final.png`

Visible review:

- The 64 px white header, filename hierarchy, and action order match the approved V5 shell.
- The canvas retains the dominant width while the 376 px comment rail reaches the right application edge.
- Global comment opens directly in the rail; attachment and image controls are visually separated and do not overlap.
- The comment header participates in the same scroll surface as comments, so it does not pin over later cards.
- The project/version panel uses one compact right-side surface, with the history icon placed before the heading.
- Borders, shadows, indigo accents, and warm tones remain restrained; the implementation is slightly whiter than the mock as requested.
- Focus, hover, loading, modal stacking, and reduced-motion behavior remain explicit.
- No broken layout, cropped control, unexpected horizontal overflow, or inconsistent radius was found at the target viewport.
- Content differs intentionally: the implementation capture uses the real PageRoot welcome HTML, while the reference uses the research-page fixture.

## Final status

passed

---

# Welcome page redesign QA

Date: 2026-07-23

Source visual truth:

- User-provided baseline capture, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- Desktop top, core-section, workflow-section, and compact captures were reviewed locally and are intentionally excluded from the public repository.

Combined comparison input:

- A side-by-side baseline/final comparison was reviewed locally and is intentionally excluded from the public repository.

Viewport and state:

- Desktop application viewport: `1280 × 720` CSS px at device scale factor 1.
- Desktop canvas iframe viewport: `904 × 656` CSS px; welcome page width `864` px.
- Compact application viewport: `820 × 900` CSS px; canvas iframe viewport `500 × 836` CSS px.
- State: unbound built-in welcome page, edit mode, zero comments, page scrolled to matching regions for focused captures.
- Pixel dimensions: desktop captures `1280 × 720`; compact capture `820 × 900`; combined comparison `2560 × 720`.
- Density normalization: none required; source and final desktop captures use the same CSS viewport and 1× density.

## Findings

- No actionable P0, P1, or P2 visual mismatch remains.
- Fonts and typography: the existing Songti display hierarchy, system sans body copy, weight contrast, and violet accent are preserved. The first implementation produced an awkward headline wrap; the final version uses a semantic two-line break with no orphaned character.
- Spacing and layout rhythm: the hero proportions, 30 px page radius, warm-paper spacing, card radii, and restrained elevation remain aligned with the source visual. The new two-by-two capability grid keeps equal rows and clean dividers.
- Colors and visual tokens: the original warm paper, near-black violet gradient, muted body text, green safety dots, and violet accents are unchanged.
- Image quality and asset fidelity: the supplied PageRoot brand logo remains the only image asset, with the same crop, size, and treatment. No placeholder, generated, or approximate asset was introduced.
- Copy and content: the page now foregrounds smooth native text editing, point-to-target local changes, comments with attachments, and complete validation. The onboarding flow reflects the current explicit “打开最新版” step and the top “项目” entry.
- Responsiveness: the compact canvas switches the hero and four capability cards to one column. Measured horizontal overflow is false at both checked viewports.

## Comparison history

1. Initial implementation review found one P2 typography issue: the accented second half of the hero headline wrapped after its first character.
2. The headline was shortened and the accent span was made a block, producing two balanced semantic lines.
3. Post-fix desktop, core-section, workflow-section, and compact captures show no remaining actionable P0/P1/P2 issue.

## Browser checks

- Primary changed experience tested: welcome page load, iframe rendering, vertical scrolling through all redesigned sections, desktop layout, compact responsive layout, and the top “项目” entry opening and closing the expected project panel.
- Browser console was checked. Reloads surfaced an existing application-level `MutationObserver.observe` error that was already present during the baseline capture; this welcome-page change adds no script and does not alter that runtime path.
- No broken crop, hidden welcome-page content, horizontal overflow, missing logo, or unreadable section was observed.

## Follow-up polish

- None required for this content refresh.

final result: passed

---

# AI handoff four-stage flow QA

Date: 2026-07-28

Source visual truth:

- Three user-provided captures covering the approved process-panel boundary,
  native footer-button treatment, and state-specific actions.
- The source captures were reviewed locally and remain outside the repository.

Implementation evidence:

- `output/design-qa/2026-07-28-ai-flow/handoff-waiting-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-copy-failure-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-success-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-no-change-4-stage.jpg`

Combined comparison inputs:

- `output/design-qa/2026-07-28-ai-flow/comparison-waiting-reference-vs-final.png`
- `output/design-qa/2026-07-28-ai-flow/comparison-process-panel-reference-vs-final.png`

Viewport and state:

- Waiting, copy-failure, and no-change captures: `1152 × 768` screen pixels.
- Success capture: `1336 × 768` screen pixels after the native window zoom
  action; the application content keeps the same desktop breakpoints.
- The waiting-state combined comparison normalizes both source and
  implementation to `1152 × 768` and compares the same locked-processing
  state.
- All states ran in isolated Electron user-data and workspace directories;
  the user's installed application and project records were not used.

## Findings

- No actionable P0, P1, or P2 visual or interaction issue remains.
- Scope: the title area, lock summary, right-side “本轮记录” panel, Finder row,
  modal shell, and existing waiting-state footer remain visually unchanged.
- Progress: seven internal implementation checks are represented as four
  user-facing phases—prepare/copy, wait for AI, validate/save, and result.
- Truthfulness: waiting shows one completed phase and one current phase;
  completion is not inferred from an output file, elapsed time, or a generic
  error.
- State placement: clipboard failure is shown in phase one, no-change ends in
  a neutral result row, and a verified new version ends in the current
  confirmation row.
- Visual hierarchy: each phase is a compact native card using the existing
  green, indigo, neutral, and error tokens. Text remains inside the panel
  without clipping or horizontal overflow.
- Footer actions: the existing waiting buttons retain their original order,
  icons, size, radius, outline, and filled-primary treatment. New actions use
  those same project classes instead of adding a second button design.
- Decision placement: success, no-change, copy recovery, and conflict actions
  belong to the fixed footer; the process cards contain status only.

## Interaction checks

- Created a real frozen Request and confirmed the waiting state shows exactly
  four phases plus the unchanged cancel, preview, and re-copy actions.
- Injected a clipboard write failure and confirmed “重新复制” and “取消本轮”
  are the only footer decisions.
- Ran the official finalizer with changed HTML and confirmed
  “打开最新版” plus “稍后处理”.
- Ran the official finalizer with comparison-identical HTML and confirmed no
  Version was created and the footer offers “修改要求” plus “返回编辑”.
- Checked the accessibility tree in every captured state; phase labels,
  details, counts, and buttons are exposed in reading order.

## Automated checks

- Focused lifecycle, shell, and notification tests: 41 passed.
- Full Node suite: 481 passed, 3 skipped, 0 failed.
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run task:finish`: passed, including 197 Node tests, 8 browser
  smoke tests, 3 Electron smoke tests, and 2 AI closed-loop smoke tests.

## Follow-up polish

- None required inside the approved modification boundary.

final result: passed

---

# Paired review focus and full-bleed canvas QA

Date: 2026-07-23

Source visual truth:

- Three user-provided reference captures, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-23-v52/comment-composer-paired-focus.png`
- `output/design-qa/2026-07-23-v52/comment-marker-paired-focus.png`
- `output/design-qa/2026-07-23-v52/preview-full-bleed.png`
- `output/design-qa/2026-07-23-v52/handoff-no-outer-scroll.png`

Combined comparison inputs:

- `output/design-qa/2026-07-23-v52/comparison-comment-focus.png`
- `output/design-qa/2026-07-23-v52/comparison-preview.png`
- `output/design-qa/2026-07-23-v52/comparison-handoff.png`

Viewport and state:

- Application viewport: `1280 × 720` CSS px at device scale factor 2.
- States checked: seven long global comments, one element-level comment, toolbar comment creation, comment-card focus, canvas “评” marker focus, interactive preview, and waiting-for-Qoder overlay.
- Preview container: `1280 × 644` CSS px with `0` padding, border, and radius; its iframe occupies the full remaining `1280 × 608` CSS px beneath the 36 px preview status bar.
- Waiting panel: `1040 × 624` CSS px; outer drawer and body both have equal client/scroll heights and `overflow: hidden`.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains.
- Paired focus: opening a comment from the canvas toolbar aligns the composer with the selected canvas heading. In the measured state, the composer began at `168.02` px and the selected target at approximately `163` px.
- Reverse focus: clicking the canvas “评” marker brought both the marker (`146.03–170.03` px) and its matching comment card (`168.03–331.83` px) into the viewport.
- Dense comments: eight comments retained a measured minimum visual gap of `21` px. The focused card is placed first at its target; comments that cannot fit above it are packed below without overlap.
- Focus feedback: the selected card uses a restrained border, soft ring, and short arrival transition; `aria-current="location"` and a polite live-region message expose the same state semantically. Reduced-motion users receive the final state without animation.
- Unified surface: Canvas has no application-shell padding, border, radius, or shadow. The divider between Canvas and comments is removed. Any remaining paper margin belongs to the loaded source HTML and is not rewritten by PageRoot.
- Preview: the preview wrapper and iframe fill Canvas, with no nested application scrollbar.
- Waiting page: the former outer scrollbar is gone. Only the round comment record list scrolls when eight comments exceed its available height.
- Process visibility: all seven steps fit within the timeline panel after compacting each row to 34 px; the final “打开最新版” step remains fully visible.

## Interaction checks

- Opened the global composer seven times and added long comments.
- Opened the element-level composer from the canvas toolbar and confirmed simultaneous target/composer visibility.
- Clicked a lower comment card and confirmed it became the focused, visible card while retaining the shared document scroll.
- Clicked the canvas “评” marker after focusing another comment and confirmed the associated card returned to the target position.
- Entered preview and confirmed the application-level preview frame fills Canvas.
- Sent the mock round to Qoder, confirmed the truthful “已复制至剪贴板” state, and measured no outer drawer scrollbar.

## Automated checks

- `npm run lint`
- `npm run build`
- `npm run gate:edit` — 161 tests passed
- Targeted workbench, notification, and desktop package tests — 27 tests passed
- `git diff --check`

final result: passed

---

# Unified review surface and comment interaction QA

Date: 2026-07-23

Source visual truth:

- Six user-provided reference captures, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-23-v51/main-unified-scroll.png`
- `output/design-qa/2026-07-23-v51/composer-attachments.png`
- `output/design-qa/2026-07-23-v51/comment-edit.png`
- `output/design-qa/2026-07-23-v51/delete-confirm.png`
- `output/design-qa/2026-07-23-v51/dense-comments.png`
- `output/design-qa/2026-07-23-v51/handoff-modal.png`

Combined comparison inputs:

- `output/design-qa/2026-07-23-v51/compare-dense-comments.png`
- `output/design-qa/2026-07-23-v51/compare-comment-controls.png`
- `output/design-qa/2026-07-23-v51/compare-unified-surface.png`
- `output/design-qa/2026-07-23-v51/compare-composer.png`

Viewport and state:

- Application viewport: `1280 × 720` CSS px at device scale factor 1.
- Unified review stage: `1280 × 644` CSS px.
- Canvas editor measured height in the welcome fixture: `1817` CSS px.
- States checked: empty rail, global composer, image plus file attachments, completed comment, comment editing, delete confirmation, three long comments, sent-HTML preview, waiting-for-Qoder overlay, and return-to-waiting.
- Native macOS chrome does not render inside the browser capture. Its `hiddenInset` title bar and traffic-light position `{ x: 18, y: 15 }` were verified by the desktop package contract test.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains.
- Header: the filename, version, and save state now sit on the lower title-bar row beneath the native macOS controls. The browser-only preview correctly omits fake traffic-light artwork.
- Unified surface: the shell and comment rail share the same cool-white panel token. Only the HTML page, comment cards, composer, and rail header use elevation.
- Scrolling: the document and comments are children of one `.review-scroll-stage`. Measured state shows `overflow-y: auto` on the stage and `overflow-y: visible` on the comment rail; the document body does not become a second application scrollbar.
- Dense comments: three long comments measured `157.45` px tall each and retained `20.55` px visual gaps. Cards never overlap, and their order remains top-to-bottom.
- Composer: selected borders are restrained, the former keyboard-hint copy is absent, the primary action reads “评论”, and attachment/image controls have separated focus rings.
- Attachments: native file chooser events fired for both image and general-file actions. A PNG rendered as a thumbnail and `README.md` rendered as a compact file row beneath the text.
- Editing: activating edit keeps the card in view and exposes a semantic red cancel control plus green confirmation control.
- Destructive action: the trash action opens an in-context “删除这条评论？” confirmation with separate cancel and delete choices; no immediate deletion occurs.
- Processing: sending the welcome-page mock opens a centered `1040 × 624` waiting panel at this viewport, leaving a visible outer margin. Previewing the frozen sent HTML and returning to the waiting panel both work.
- Header send state: after handoff, the button uses the truthful “已复制至剪贴板” state; the integration remains clipboard-only.

## Comparison history

1. The first implementation still let the browser preserve an internal scroll anchor when a composer or tool control changed height, which could move the active card out of view.
2. The review stage disabled automatic scroll anchoring, and composer/edit/delete transitions now explicitly return to their target without scrolling the comment rail independently.
3. The initial full-height canvas override collapsed the editor because it replaced the component height with `auto`; the final rule retains the measured canvas custom property while the outer review stage owns scrolling.
4. Final combined comparisons show the beige shell gap removed, focus borders softened, long comments separated, and the requested controls fully represented.

## Automated checks

- `npm run lint`
- `npm run build`
- `npm run gate:edit` — 161 tests passed
- Targeted workbench, notification, and desktop package tests — 27 tests passed

## Follow-up polish

- None required for this review-surface pass.

final result: passed

---

# Welcome hero copy refinement QA

Date: 2026-07-23

Source visual truth:

- One user-provided reference capture, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/ui-v6-hero-copy-1280x720.jpg`
- `output/ui-v6-hero-copy-focus.png`

Combined comparison input:

- `output/ui-v6-hero-reference-vs-final.png`

Viewport and state:

- Desktop application viewport: `1280 × 720` CSS px at device scale factor 1.
- Compact desktop application viewport: `940 × 720` CSS px.
- State: unbound built-in welcome page, edit mode, zero comments.
- Source pixels: `932 × 316`; implementation full-view pixels: `1280 × 720`.
- Focused implementation crop: `930 × 316`, normalized to `932 × 316` only for the combined comparison.

## Findings

- No actionable P0, P1, or P2 issue remains.
- Fonts and typography: the headline now uses a lighter Songti optical weight, tighter display tracking, balanced two-line semantics, and a deliberate second-line inset. Both lines remain readable and unbroken at the desktop and compact desktop viewports.
- Spacing and layout rhythm: the smaller second line and asymmetric inset introduce editorial tension without changing the hero grid, card position, body-copy measure, or surrounding layout.
- Colors and visual tokens: the existing near-black violet surface is preserved; the second line uses a restrained lavender tone with a low-opacity shadow that does not reduce contrast.
- Image quality and asset fidelity: no image asset was changed or introduced. The PageRoot logo and all existing imagery remain untouched.
- Copy and content: the functional slogan was replaced with the more concise pair “所见，即可落笔。 / 所改，止于所选。” It retains the direct-editing and scoped-change meanings while reading as a refined product statement.
- Responsiveness: the title stays on two intentional lines at `1280 × 720` and `940 × 720`. The PageRoot application remains desktop-scoped; the existing narrow-phone shell behavior is outside this focused change.

## Comparison history

1. The supplied reference showed a P2 copy-and-typography issue: the headline was oversized, mechanically aligned, and phrased as a literal feature instruction.
2. The copy was rewritten as two parallel editorial statements; display weight, tracking, line height, accent scale, and second-line alignment were refined.
3. The focused before/after comparison shows improved whitespace, a clearer reading cadence, and no new wrapping or collision issue.

## Browser checks

- Verified the final welcome-page render at desktop and compact desktop widths.
- Confirmed the semantic H1 contains exactly two intended lines and the rest of the welcome page remains unchanged.
- The only captured runtime exception originates from the in-app browser's design-annotation preload `MutationObserver`, not from a PageRoot project script. No PageRoot log error or new error overlay appeared in the independent preview.

## Follow-up polish

- None required for this focused refinement.

final result: passed

---

# Comment rail design QA

## Comparison target

- Source visual truth:
  - `1-Photo-1.jpg` — user-provided, local-only Figma review capture.
  - `2-Photo-2.jpg` — user-provided, local-only Figma review capture.
- Superseding product direction: keep the existing saved-comment and unsaved-recovery card visuals unchanged; fix their positions only. Move other-tab summaries into the comment header, collapsed by default, with a compact expanded state.
- Rendered implementation:
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-folded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-expanded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-draft-recovery.png`
- Combined focused comparisons:
  - `output/design-qa/other-tabs-comparison.png`
  - `output/design-qa/draft-position-comparison.png`

## Capture normalization

- Source images: 589 × 1280 px mobile screenshots of the Figma canvas.
- Implementation captures: 1600 × 900 CSS px, device scale factor 1, Desktop Chrome test runtime.
- Comparison crops: the source's visible comment-rail concept and the implementation's 400 px comment rail were normalized to a shared 760 px height. Browser/device chrome and the unrelated Canvas area were excluded from the judgment.
- State coverage:
  - other-tab summary folded by default;
  - compact expanded other-tab group and tab-location action;
  - current-tab saved comment aligned to its Canvas target;
  - existing unsaved-recovery card above a saved card without collision.

The Figma screenshots show the earlier expanded-card proposals, not a same-viewport production screen. Pixel-for-pixel comparison of the full frames would therefore be misleading. The focused comparison evaluates the revised information hierarchy, card preservation and spacing requested after those screenshots.

## Findings

- No actionable P0, P1 or P2 differences remain.
- Accepted intentional difference: the implementation does not reproduce the large unsaved draft card shown in Photo 1. It keeps PageRoot's existing `draft-recovery-card rail-status-card` presentation, as explicitly requested, and changes only its computed rail position.
- Accepted intentional difference: the large “其他标签页” card shown in Photo 2 is replaced by a compact header control. It is closed on entry and expands in place to show grouped tab labels, counts and a location action.
- Saved comment cards retain their existing component markup and visual classes. No `comment-card` visual rules were changed.

## Required fidelity surfaces

- Fonts and typography: existing PageRoot font family, optical weights, sizes and line heights remain unchanged for saved and recovery cards. New header metadata uses the existing compact UI scale and remains legible without wrapping the primary count.
- Spacing and layout rhythm: the header owns its measured height; Canvas-aligned cards begin below it. Saved comments, composer and recovery card share one collision-avoidance layout with a 20 px item gap. The tested recovery-to-saved-card gap is at least 16 px.
- Colors and visual tokens: existing neutral surfaces, borders, violet focus/accent color and shadows are reused. No new palette or gradients were introduced.
- Image quality and asset fidelity: this rail contains no custom raster imagery, illustration or logo asset. Existing icon components and product chrome remain unchanged.
- Copy and content: “其他标签页 N” communicates the folded total; expanded rows use the authored tab label and comment count. Existing saved-comment and unsaved-recovery copy is unchanged.

## Interaction and browser evidence

- Tested: save comments in two tabs, enter Preview, switch tabs, return to Edit, confirm only the preview-selected tab's card is Canvas-aligned, open the folded summary, switch/locate the other tab, and recover an unsaved draft without overlap.
- The interaction test passed at 1600 × 900.
- No actionable browser console errors or page errors occurred. The test runtime's expected sandbox message for intentionally blocked edit-frame scripts was excluded from the error set.

## Comparison history

- Initial Figma review: the proposed unsaved draft and other-tab sections consumed too much vertical space and changed existing card presentation.
- Product correction applied: preserve card visuals, move only the recovery position into the shared rail layout, and collapse other-tab content into the header.
- Post-fix visual evidence: the two combined focused comparisons above show the preserved card boundary, non-overlapping recovery position and compact header grouping.

## Implementation checklist

- [x] Existing saved-comment card styles unchanged.
- [x] Existing unsaved-recovery card styles unchanged.
- [x] Recovery and saved cards cannot overlap.
- [x] Other-tab comments are folded by default.
- [x] Expanded other-tab summaries remain inside the compact header.
- [x] Switching a summary activates and locates the corresponding tab comment.
- [x] Preview/Edit or tab context changes return the header to its folded state.

## Follow-up polish

- P3: with many unusually long tab names, a future density pass could add a bounded two-line label. This is not visible in the tested state and does not block acceptance.

final result: passed

---

# Tab comment hierarchy follow-up QA

## Superseding direction

- This follow-up supersedes the earlier compact grouped-summary treatment in
  “Comment rail design QA”.
- Source visual truth:
  - `output/design-qa/2026-07-30-tab-comments/source-tab-markers.png`
  - `output/design-qa/2026-07-30-tab-comments/source-comment-header.png`
  - `output/design-qa/2026-07-30-tab-comments/source-comment-expanded.png`
- Rendered implementation:
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-folded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-expanded.png`
- Combined comparisons:
  - `output/design-qa/2026-07-30-tab-comments/compare-tab-markers.png`
  - `output/design-qa/2026-07-30-tab-comments/compare-comment-header.png`
  - `output/design-qa/2026-07-30-tab-comments/compare-comment-expanded.png`

## Findings

- Tab comment counts now reuse the existing violet Canvas comment marker and
  render `评N` as one floating badge. Tab controls use a top-right placement so
  the count is not styled as authored Tab text and does not cover the next Tab.
- The redundant current-Tab label and count are removed from the comment
  header. The total comment count remains the primary header fact.
- The other-Tab trigger retains the existing full-width secondary-row
  hierarchy. Its expanded content increases the height of the same measured
  header instead of creating accordion cards outside it.
- Every expanded comment is a specific neutral saved-comment card, with the
  existing white surface, 16 px radius, subtle violet edge and quiet shadow.
  There is no selected or editing treatment until the user chooses the card.
- Clicking a card activates its authored Tab, collapses the header expansion
  and focuses that exact saved comment in the normal Canvas-aligned rail.

## Automated evidence

- The focused Browser case passed at 1600 × 900 with zero unexpected console
  or page errors.
- Geometry asserts that the center of the `评2` badge sits beyond the Tab's
  right edge and its bottom remains within the upper eight pixels of the Tab,
  keeping it visually floating rather than embedded.
- DOM ownership asserts that the expanded other-Tab region is a child of the
  comment header, and computed style asserts the neutral comment card has a
  white background and 16 px radius.
- The same case verifies the current-Tab label is absent, the exact other-Tab
  card switches the authored Tab and focuses its comment, and draft recovery
  retains at least 16 px clearance from the next saved card.

## Checklist

- [x] `评1` / `评2` use the existing Canvas marker visual.
- [x] Tab markers float outside the authored label treatment.
- [x] Current-Tab summary is omitted.
- [x] Other-Tab comments expand inside the top comment header.
- [x] Expanded entries use the neutral saved-comment card visual.
- [x] A specific card switches Tab and focuses the matching comment.
- [x] Keyboard focus and accessible names remain available.

final result: passed

## AI review workspace — adjacent same-summary badge aggregation

Date: 2026-08-18

### Problem

Every review overlay box may carry one summary badge ("新增内容", "视觉调整"…)
anchored above its top-right corner. Badge chrome is counter-scaled by
`--pageroot-review-ui-scale` (= 1 ÷ zoom) so it keeps a constant on-screen size.
In dense regions this made several same-kind badges stack and overlap each other
and the content beneath — worst at "适应" zoom, where the reach is largest. The
`核心结论` region alone stacked four `新增内容` captions over `实验效果概览` /
`锁单确认` / `CVR`.

### Comparison target

- Rendered before (crowding): `output/design-qa/badge-overlap-demo.png`
- Rendered after (aggregated): `output/design-qa/badge-aggregated-demo.png`
- Full state: `output/design-qa/ai-review-text-changes.png`

### Design decision

- Adjacent, same-summary, label-bearing boxes collapse into one representative
  badge that reads `{summary} ×N`. The four `新增内容` captions become a single
  `新增内容 ×4`.
- Aggregation is geometry preserving. Every change keeps its own outline,
  transparent mask hole and character evidence (green dots / red strike); only
  the repeated text caption collapses. No footprint, tone, mask or box identity
  changes, and the navigable "变化区域" count is untouched.
- It never merges different summaries and never links boxes that do not share a
  column or fall within one badge's vertical reach. The reach scales with zoom,
  so aggregation is more active at "适应" than at "100%".
- The focused change always stays the representative badge of its cluster, so
  navigation never hides the active change's caption.
- Badge count and the toolbar/navigator "变化区域" count remain two distinct
  meters: one region may hold several differently-labelled badges.

### Automated evidence

- The AI closed-loop smoke case passed 2/2 with zero unexpected console or page
  errors, and the design-QA capture regenerated cleanly.
- At "适应" the after canvas asserts that every `[data-pageroot-review-label-count]`
  badge carries `N ≥ 2` and its text ends with ` ×N`, proving a real cluster
  collapsed rather than a malformed count.
- The all-changes label invariant now allows an aggregated neighbour to carry no
  caption while still forbidding more than one caption per box or text group,
  and still requires at least one caption present.
- The pure aggregation helper is unit tested for cluster counting, same-column
  requirement, distance and different-summary independence, focus-preserved
  representative, suppressed-label exclusion, and input immutability.

### Consequence resolved

- This supersedes the entry-state batch's known consequence that overlay badge
  crowding became more visible at the "适应" default. Dense same-kind badges now
  aggregate instead of overlapping.

## Checklist

- [x] Adjacent same-summary badges render one `{summary} ×N` representative.
- [x] Every change keeps its outline, mask hole and character evidence.
- [x] Different summaries and distant/other-column boxes never aggregate.
- [x] The focused change stays its cluster's labelled representative.
- [x] The navigable 变化区域 count is unchanged by aggregation.
- [x] Helper is self-contained for iframe injection and unit tested.

final result: passed

---

# AI review entry-state and diff-legend QA

Date: 2026-08-18

## Superseding direction

- This entry supersedes two visual rules recorded in “AI review workspace —
  final seven-state contract”:
  1. the entry zoom is now `适应` instead of `100%`, so a dual-page comparison
     is fully visible on first paint instead of being cropped horizontally;
  2. before/after identity is no longer carried by the neutral and violet dots
     alone, and the toolbar is no longer free of red/green surfaces.
- Everything else in that contract stays in force: one quiet white review
  surface, neutral gray segmented shells, white selected tiles, the single
  violet selection family (`#6258d6` / `#4f47b8`) and the frozen persistent
  copy for the seven review states.

## Findings

- Entry state is `双页 + 全部变化 + 18% + 同步滚动 + 适应`. `100%` remains one
  click away on the same zoom axis; no state is derived from `pageView`.
- The `AI 修改后` pane header adds a 2 px violet inset top edge and a
  `#faf9ff` surface. The `修改前` header stays neutral, so the new version is
  identifiable after horizontal scrolling. The inset edge is drawn with a
  box shadow, which keeps the 36 px header row and the pane's 7 px rounded
  corners unchanged.
- `文案 / 结构 / 视觉` each carry 5 px legend dots that reuse the canvas diff
  tones by importing the same constants: removed red and added green for
  `文案`, structure blue for `结构` and visual violet for `视觉`. `全部变化`
  carries no dot. Selection emphasis remains the single violet family, so the
  legend explains the marks without becoming a second accent color.
- Change counts read as one two-level scale and stay mutually consistent under
  one filter. The toolbar shows `N 个变化区域` for all changes and
  `N/M 个变化区域` under a type filter, sharing its `N` with the navigator
  total. Content-map groups read `N/M 个区域有变化` for all changes and
  `N/M 个区域含…变化` under a filter, so a filtered `0` never reads as "this
  group has no changes at all". Canvas badges remain per-fact detail and are
  excluded from every one of these numbers.

## Automated evidence

- `assertReviewControlDefaults` in the Electron AI closed-loop spec asserts
  `适应` is pressed on entry, alongside the existing dual-page, all-changes and
  18 % default assertions.
- The same spec asserts that switching to a type filter lands on the first
  matching change (navigator reads `1` and the focused change has a rendered
  footprint), and that a target which still matches keeps the user's position.
- The mask-union pixel section now selects `100%` explicitly, because it maps
  in-frame CSS coordinates onto an element screenshot and needs 1:1 pixels; the
  projection-geometry section still asserts the same geometry under `适应` and
  `100%`, so both zoom modes stay covered.

## Known consequence

- The entry zoom change makes overlay badge crowding more visible in dense
  regions. Badge chrome is counter-scaled by `--pageroot-review-ui-scale` to
  keep a constant on-screen size, so at `适应` it covers proportionally more of
  the shrunken content than at `100%`; several adjacent `新增内容` labels can
  overlap each other and the text underneath. Tones, footprints and masks stay
  correct, and `100%` is one click away. Aggregating adjacent same-type badges
  into one `… ×N` chip is the proper fix and is deliberately out of this
  entry-state batch.

## Checklist

- [x] Dual-page entry is not horizontally cropped.
- [x] Filter switching never leaves the navigator on an unmatched target.
- [x] Region counts agree across toolbar, content map and navigator.
- [x] A filtered count never reads as an absolute "no changes" statement.
- [x] `AI 修改后` header is identifiable without reading its label.
- [x] Legend dots use the canvas tone constants, not a new palette.
- [x] Selection emphasis remains one violet family.

final result: passed

## Open-HTML popover and the centered project console

Date: 2026-08-19

### What changed and why

Two entry points were separated by presentation as well as content. The title-bar
“+” used to fire the OS file picker directly; it now opens an **anchored popover**
“打开 HTML” that drops directly under the button with their left edges aligned and
**no dimmed backdrop** — a lightweight menu-like surface holding two blocks only:
最近打开 (recent files, up to six, current file excluded, each removable) and
打开本地 HTML. The “项目” button, which used to slide a top-right card in, now opens
a **centered modal console** over a dimmed, blurred backdrop, sized larger
(`min(680px, 100vw-48px)`) as the foundation for a future project-management
console. The project console no longer carries 最近打开 or the 打开本地 HTML
button, so the split reads cleanly: “项目” manages existing registered projects,
“+” opens a new or recent file. Only the popover’s 打开本地 HTML button (or a recent
row) reaches the system picker, which always starts at the managed project root
and does not remember the last-used directory.

### Design-language conformance

- The centered console mirrors the already-accepted handoff console: same
  centered geometry, translate/scale entrance and dimmed-blur overlay, reusing
  the shared `.side-drawer` / `.drawer-overlay` machinery via `data-drawer`
  scoping. The handoff drawer stays a right-anchored panel; only files/history
  became centered. No new modal vocabulary was introduced.
- The popover keeps the accepted card chrome (radius, one-shadow, hairline
  border) but drops the backdrop dim/blur, because a menu anchored to its
  trigger should not darken the page it hangs from.
- The popover body reuses the existing `.recent-files`, `.recent-file-row`,
  `.recent-file-remove` and `.open-local-button` classes verbatim; the recent
  list and the open-local affordance stay pixel-identical to before.
- Both surfaces use the shared `--indigo-soft` / `--indigo-deep` tokens and the
  standard focus-ring color; no second emphasis color appears.

### Behavior and accessibility

- Popover: `role="dialog"` + `aria-label`, positioned fixed from the button rect
  and clamped to the viewport, Escape-to-close, click-outside-to-close, focus
  starts on 打开本地 HTML, Tab wraps, and closing returns focus to the “+” button,
  which carries `aria-haspopup="dialog"` and `aria-expanded`.
- Console: the existing overlay click and “关闭” button dismiss it; `inert` is
  applied while closed.
- The popover never stacks under the first-import confirmation: selecting a
  recent item or 打开本地 HTML closes the popover before the open flow runs, and
  the popover is suppressed whenever an external-open confirmation is present.

### Checklist

- [x] Two entry points differ in both content and presentation (项目 console vs “+” popover).
- [x] Popover anchors under “+”, left edges aligned, no backdrop dim.
- [x] Project console is centered over a dimmed, blurred backdrop and larger.
- [x] Popover and import confirmation never appear stacked.
- [x] System picker starts at 文稿 › PageRoot › 项目 and forgets last directory.

final result: passed

## First-import confirmation: folder name, emphasised 复制, borderless option

Date: 2026-08-19

### What changed and why

- Source visual truth: a user screenshot of the shipped confirmation where the
  clickable projects-root breadcrumb rendered as a two-line underlined path
  (`var › folders › … › project-files`). The user's verdict—the link is ugly
  and unreadable, and the body copy is too long—supersedes the four-paragraph
  copy previously fixed in `docs/IMPORT_CONFIRMATION_PRD.md` §5.1.
- The path no longer appears in the body. The sentence now names the projects
  root **folder** (`PageRoot › 项目`, or just the folder when “parent › folder”
  exceeds 28 characters, as in temporary E2E roots). The complete breadcrumb
  survives in the `title` tooltip and in the button's accessible name, so no
  fact is lost, only the visual noise.
- 「（点击打开）」 became the only link-styled element in the dialog; the folder
  name itself is plain ink text.
- Three explanatory paragraphs (V1 identity, `-V2`/`-V3` creation, sibling
  assets) were removed. Their product facts still hold and stay documented in
  the PRD; the bolded “复制” in “复制本文件并保存为 …-V1.html” now carries the
  one reassurance a user needs at this moment: the original is copied, never
  rewritten.
- The trash option lost its card border and background; its checkbox left edge
  now sits on the same line as the sentence above it.

### Design-language conformance

- One emphasis family only: the checked-state amber tint (`#fff8f1`/`#ead7c4`)
  was off-palette and is gone. Checked state is now the existing indigo box
  with the white check, so the dialog carries no second accent color.
- Focus moved from the whole option row onto the checkbox, which is the control
  that actually receives focus; buttons keep the shared ring.
- No new component vocabulary: the sentence reuses `.fileChip`, the option row
  reuses the existing checkbox art, and the icon stays the Phosphor
  `FileHtml` duotone.

### Evidence

- Real Electron dialog, captured from the first-open confirmation with a
  synthetic `产品首页.html`: `output/design-qa/import-confirm-real-default.png`,
  `-hover.png` (underline lands on 点击打开 only, parentheses untouched) and
  `-checked.png`. Design draft for the decision: `import-confirm-plan-c.png`.
- The Electron fixture assertion was retargeted to “复制本文件并保存为” and to the
  `^点击打开 ` accessible name, so the folder-open affordance stays gated.
- `npm run gate:edit` passed on the change (260 node tests, typecheck,
  architecture check).

### Known consequence

- A full-width 。 after the lavender file chip still reads slightly detached
  (chip padding plus the full-width period's own bearing). Pre-existing, judged
  P3; the alternative is dropping the chip, which was drafted and not chosen.

### Checklist

- [x] No filesystem path in the dialog body; full path reachable via tooltip
      and accessible name.
- [x] 「（点击打开）」 is the single link-styled affordance and opens the
      projects root.
- [x] “复制” is the only bolded word in the sentence.
- [x] Option checkbox aligns with the sentence's left edge, no border, no
      second accent color when checked.
- [x] Copy in `docs/IMPORT_CONFIRMATION_PRD.md` §5.1 and catalog entry B05
      match the shipped strings.

final result: passed

## Project console refocused on the current project

### What changed and why

The 项目 panel had grown into a mixed drawer: a two-tab split (当前项目 /
版本历史), a full "所有项目" registry list interleaving other projects with the
current one, and a collapsed 项目资料 disclosure that buried PROJECT.md and
exposed a raw "项目记录文件夹" entry into the internal `.pageroot` working
directory. The user's verdict: the panel should be one quiet current-project
workbench — surface this project's status, its rules and its version history;
do not show other projects here; and stop sending users into a folder of
internal JSON/JSONL they cannot read.

- The two tabs are gone. The `Drawer` type dropped its `"history"` member; the
  panel renders one vertical workbench for `drawer === "files"`.
- The "所有项目" registry list was removed from the panel. Switching to another
  project stays the job of the "+" popover (recent + open local HTML), giving a
  clean split: "+" = open/switch, 项目 = manage the current project. The
  `registeredProjects` state, its catalog event branches and the
  `refreshRegisteredProjects` / `openRegisteredProject` callbacks were deleted
  from the view; the controller wiring other surfaces use is untouched.
- PROJECT.md was promoted out of the 项目资料 disclosure into a first-class
  「项目规则」 card between the current-file card and version history.
- The raw 项目记录文件夹 entry was removed. `runtime-state.json`,
  `edit-audit.jsonl` and the transaction dirs stay on disk but are no longer a
  product entry; per-round requirements, AI returns and historical files remain
  reachable through version history (summaries, comments, direct edits,
  attachments and per-version Finder reveal).
- The header eyebrow/title changed from 源页工作区 / 项目与版本 to
  当前项目 / {project name}, so the whole surface reads as "this project".
- The current-file card's "在文件夹中打开" now always reveals the source HTML's
  folder (`showProjectInFolder`) instead of the records root.

### Design-language conformance

- Progressive disclosure (2.7) applied the right way: the one thing a user
  actually maintains — the project rules — is visible by default instead of
  folded, while the truly internal records are removed rather than surfaced.
- Honest copy (2.4): the internal transaction directory is no longer a
  browsable product entry, matching "不把内部实现词暴露给用户".
- Same-shape reuse (2.5): the rules card reuses the existing
  `.project-resource-icon/copy/meta` vocabulary and the shared caret; version
  history reuses `HistoryVersionItem` unchanged. Centered-modal positioning
  (inset/translate + dimmed, blurred backdrop) is unchanged; the dead
  `[data-drawer="history"]` selector was folded into `[data-drawer="files"]`.
- One emphasis family (2.2): the rules card reuses the soft indigo-family tint
  the earlier rule-card style already defined (`#faf9ff` / `#d5d0ef`); no new
  accent, no new `:root` tokens. Radii 14–16px, 14px card gaps and the 9–15px
  compact type scale are as-is.

### Evidence

- Real render from the Next dev server (welcome / browser-preview project),
  window ~1440×960: `output/design-qa/project-panel-current.png` shows the
  centered console over the dimmed, blurred backdrop with header 当前项目 /
  欢迎来到源页.html, the current-file card, the standalone 项目规则 card, and the
  版本历史 section with its empty state — and no 所有项目 list, no 项目记录文件夹
  entry. Workbench context: `output/design-qa/project-panel-workbench.png`.
- The PROJECT.md editor drill-in (管理 AI 修改规则, the textarea and 返回项目) is
  disabled in browser-only preview; it stays covered by the Electron E2E
  (`tests/e2e/electron/native-dom-electron.spec.mjs`), which now opens the
  rules card directly (no 项目资料 disclosure) and no longer asserts the removed
  项目记录文件夹 entry.
- `npm run gate:edit` passed (260 node tests, typecheck, architecture check);
  the workbench.tsx ratchet was tightened to 8851 lines / 313 hooks.
- Contract synced in `docs/INTERACTION_FLOW.md` §2.

### Checklist

- [x] Single current-project workbench; no 当前项目/版本历史 tab split.
- [x] No other-project list in the panel; switching projects stays on "+".
- [x] 项目规则 (PROJECT.md) is a first-class visible card, not folded.
- [x] 项目记录文件夹 entry removed; internal records no longer a product entry.
- [x] Header reads 当前项目 / {project name}.
- [x] No new tokens or component treatments; centered-modal behavior unchanged.

final result: passed

## Project console as a version-tree workbench

### What changed and why

The console the previous entry shipped was still a stack of boxes: a card for the
current file, a card for the rules, and a card-in-card version list, with copy
that explained itself twice (“安全保留每一次修改”, “在画布中查看不会覆盖…”)
and statistics nobody asked for (个附件, 画布类型, 已定位). The user's brief:
fewer frames, denser and more valuable information, and above all show how the
project actually evolved — which version each version was modified from.

- **One shell, three bands.** The panel now uses the same glass footprint and
  header/body/footer rhythm as the AI handoff panel (`min(1040px, 100vw - 96px)`
  × `min(760px, 100vh - 96px)`, radius 24, `blur(24) saturate(135%)` over a 74%
  overlay). Cards were replaced by bands separated with one hairline.
- **Version tree, master-detail.** The left column is a lane graph ordered oldest
  first; the right column is the selected version. Sequential work runs straight
  down its lane; branching off a version that is no longer a lane tip opens a new
  lane and draws a right-angle elbow out of the parent, so connectors never
  overlap the line they left. Lanes are never recycled, which is what keeps the
  20-version / 4-lane case legible.
- **Titles come from the user, not from `summary`.** Tracked the provenance:
  `completion.v1` and `candidate.v4` have no summary field at all, so a version's
  `summary` is system-authored (it degrades to “已采纳的 AI Candidate”), and every
  managed file in a project shares one name. A version row is therefore titled by
  the user's own first requirement (“目标：要求”, plus “等 N 条”), with
  “原始导入” for V1 and “本地编辑 · N 处” when a version only carries local edits.
- **Detail keeps a neutral heading.** The right pane is headed “版本 N” so the same
  sentence never appears twice on one screen; the requirement lives under
  “我留的评论”. Lineage reads “基于 版本 N · {that version's requirement}” and is
  clickable. AI 对话补充 renders only when it exists; 本地编辑 is a
  before→after line. Attachment counts, canvas type and target-resolution labels
  are gone; candidate assessment speaks only when flagged attention/blocked.
- **Rules edit in place.** The rules row is a disclosure inside the console
  instead of a view that replaced the panel, so expanding it no longer hides the
  version tree. Subtitle is “每次 AI Agent 修改本项目 HTML 都会读取”. Save state
  is silent by default and only announces “项目规则已保存” (green dot) after a
  real edit reaches disk.
- **Actions read as actions.** 在文件夹中打开 / 导出副本 became bordered icon
  buttons in the header; the single decision, 在画布中预览, sits bottom-right in
  the footer. The duplicate version-level Finder entry was removed, so the panel
  has exactly one folder affordance.

### Design-language conformance

- One emphasis family (2.2): the four lane depths are all indigo
  (`--version-lane-0..3`); no second accent enters for branches. Green stays a
  fact (saved), amber only for a flagged assessment.
- Quiet by default (2.3): the header status line and the rules save state say
  nothing until there is a fact to report.
- Honest copy (2.4): removed the self-congratulating “安全保留每一次修改” and the
  misplaced canvas caveat; kept the one caveat that matters (只读备份) on the
  version itself.
- Geometry stability (2.6): row height, lane width and elbow radius are shared
  constants between the SVG rails and the rows, so hover never shifts a dot.

### Evidence

- Real Electron app, populated project: `output/design-qa/impl-10-console-populated.png`
  (V1 selected, 最新版本/当前编辑基础 flags, lineage line, footer action) and
  `output/design-qa/impl-11-console-rules-open.png` (rules expanded with the
  version tree still in place below).
- `tests/version-graph.test.mjs` (15 cases) pins the lane algorithm and the
  title rule, including the 20-version history that forks at V3, V4 and V16 and
  resolves to four lanes with three outward-only edges.
- `npm run gate:edit` passed (283 node tests, typecheck, architecture check).
  Three Electron E2E specs that own the rules flow pass against the rebuilt
  renderer: `project resources drain edited rules before leaving`,
  `PROJECT.md read failure never becomes editable data and recovers in place`,
  and the live-composition undo spec.
- Contract synced in `docs/INTERACTION_FLOW.md` §2.

### Fixed during QA

- `.drawer-header > div` is a grid, which stacked the two header buttons; the
  actions row now forces `display: flex`.
- `.project-file-editor` carried `min-height: 360px` from the era when it owned
  the whole panel, pushing the tree off-screen; inside the disclosure it is
  bounded to `190px`–`34vh`.

### Second pass: real branching history (20 versions, 3 forks)

The first pass only ever rendered a one-version project, so the tree — the whole
point of the redesign — was unverified. Re-ran the console in the real Electron
app against production-shaped `schemaVersion: "4.0.0"` rows carrying the
documented lineage (fork at V3, V4 and V16). The graph itself was correct on the
first try: four lanes, three outward elbows, no crossings, correct dots and
selection. Three real defects surfaced, all now fixed:

1. **The console had no height**, so it grew past the drawer body; any
   `scrollIntoView` then shifted the entire panel and left the detail column
   blank while the rules row scrolled out of sight. `.project-console` now fills
   the body (`height: 100%`) and the drawer body stops being a scroller, so the
   tree and the detail are the only two scrollers and the rules row stays put.
   Evidence: `output/design-qa/verify-02-branch-detail.png`.
2. **Every AI version was titled “AI 修改”**, and the lineage read
   “基于 版本 16 · AI 修改”. Root cause is a data fact, not a copy choice: the v4
   workspace payload sets `comments`, `directEdits` and `supplements` to empty
   (`app/workbench/version-model.ts`), because a v4 manifest version entry only
   carries `versionId/ordinal/basedOnVersionId/previousVersionId/contentSha256/`
   `snapshotRelativePath/sourceRequestId/sourceCandidateId/createdAt`. A filler
   label repeated on 19 rows is worse than none, so an unknown requirement now
   yields no title, and the lineage line drops the meaningless suffix.
3. **A branch head looked identical to a sequential version.** With no
   requirement text there was nothing to distinguish them, so a version whose
   `basedOnVersionId` is not its `previousVersionId` is now labelled
   “从 V3 分出”. This is derived only from fields the payload really has, and it
   makes the tree self-explanatory. Evidence:
   `output/design-qa/verify-01-branching-tree.png`.

The empty “我留的评论 · 这一版没有留评论” block was also removed: when a version
carries no records at all the pane states that once, quietly, instead of
rendering a section header with a zero count.

### Third pass: the requirement is wired through

The gap the second pass left — a tree of V-numbers and times, because the v4
payload carries no per-version requirement — is now closed at the source. A
version records its `sourceRequestId`, and that round's frozen
`change-request.json` keeps `requirements.summary`, a string built by joining the
user's own comment texts (`app/application/run-workflow.js#summary`). The bridge
now reads it per version and returns it on the version row:

- **Cached by round.** A promoted round is immutable, so a requirement read once
  is reused for the life of the bridge process; repeated console reads cost no
  I/O. Failures are deliberately not cached, so a round that is merely busy is
  retried rather than hidden for the session.
- **Bounded.** The text is condensed to one line and capped at 120 characters, so
  the workspace payload grows by a few KB rather than ~100KB.
- **Fail-soft, as agreed.** A retired or unreadable round yields no requirement
  and the row falls back to its branch label; the workspace read never fails.
- **Guarded.** Only a plain `req_…` id is ever joined into a path, so a version
  entry can never walk out of its own project's request directory.

Title precedence is now: the version's own first comment (legacy records) → the
round's frozen requirement → `本地编辑 · N 处` → `从 V16 分出` → empty, with
`原始导入` for V1. The detail pane shows the requirement under `本轮要求` when a
version has no per-comment records, so the pane is no longer bare.

Evidence: `output/design-qa/verify-10-requirements.png` (every row reads as the
user's own words, forks still labelled) and
`output/design-qa/verify-11-requirement-detail.png` (V19 selected: lineage reads
“基于 版本 16 · 订阅表单：邮箱填错时的提示要友好一点” and 本轮要求 carries this
round's text). `tests/version-requirement-bridge.test.mjs` drives real rounds
end to end — adoption, condensing, truncation, cache reuse, and the unreadable
round — against a live bridge.

### Checklist

- [x] No card-in-card: bands and hairlines only.
- [x] Lineage visible for every version; branches never cross.
- [x] Version titles derive from the user's requirement, never from `summary`.
- [x] Rules edit in place; save state silent until a real save.
- [x] Header actions look clickable; one folder entry; one footer decision.
- [x] Same glass shell and footprint as the handoff panel.
- [x] Tree, detail and rules verified against a 20-version, 3-fork history in
      the real Electron app; the tree and the detail scroll independently.
- [x] No filler labels: an unknown requirement shows nothing, a branch head
      names its fork point.
- [x] Each version is named by the user's own requirement, read from its round
      and cached, with a fail-soft fallback for retired rounds.

final result: passed

# UI polish batch — accent, shadow, badge, tooltip and lightbox QA

Date: 2026-08-19

## Scope

- One batch of eight interaction and visual polish fixes that were ranked by
  ROI in the UX audit. The batch is deliberately incremental: it tightens the
  existing design-language contract without introducing any new surface, tone
  or component shape. Items 4 (review arrow-key navigation) and 6 (drawer
  focus trilogy) from the audit were explicitly deferred and are out of scope.

## Findings

- Deleting a comment no longer strands keyboard focus. The confirm control
  that replaces the delete affordance in place now receives focus, so the
  keyboard and screen-reader user lands on the next logical action instead of
  being reset to the document root.
- The second accent color is removed. The remaining blue-tinted icon surfaces
  now read from the indigo family, and the two gradient faces that introduced
  an off-palette violet-blue were collapsed onto the single `--indigo` ramp,
  closing the one-accent-color contract line.
- Near-purple literal values on the canvas and the global sheet are
  converged onto the `--indigo` family (`var(--indigo)`, `var(--indigo-deep)`,
  `var(--indigo-soft)`). Convergence uses the values that are actually in
  force: the sheet declares two `:root` token blocks and the later "PageRoot
  V5" block wins the cascade, so `--indigo` resolves to `#5a55df` and
  `--indigo-deep` to `#4843c9`. The dual-`:root` conflict itself is a
  separate, deliberately untouched problem.
- The AI review workspace keeps its own documented selection violet family
  (`#6258d6` / `#4f47b8`) instead of converging to `--indigo`. That family is
  the recorded review-selection contract and is asserted by the AI handoff
  closed-loop spec, so this batch leaves it intact. The two violets differ by
  only a few RGB steps and read as one accent in practice; folding them into
  `--indigo` would require updating the contract and the spec together and is
  a separate decision.
- The amber `#fffaf0` family is used consistently across the product as the
  warning surface, so it is kept and registered as the third semantic surface
  in `docs/DESIGN_LANGUAGE.md` rather than recolored.
- The attachment lightbox is now a native `<dialog>` driven by `showModal()`
  and `close()`, reusing the existing dialog pattern instead of a hand-rolled
  overlay. Escape-to-close, backdrop dismissal and initial focus come from the
  platform; the pseudo-modal is gone.
- Floating-panel `box-shadow` values are converged onto the shared
  `--shadow` token so depth reads as one definition with global effect.
- Badge and meta labels that rendered at 7-8 px are raised to a 9 px floor,
  which is the smallest size that stays legible at default density.
- Toolbar affordances move from the native `title` attribute to the shared
  `data-tooltip` mechanism, so shortcut hints become visible to keyboard users
  on focus, not only on hover. Each control's `data-tooltip` text now matches
  its `aria-label` exactly, so the visible hint and the announced name agree.

## Automated evidence

- `npm run gate:edit` passes (291 tests, 0 failures): architecture budget,
  `tsc --noEmit` typecheck and the node test group all run clean against the
  batch. The `workbench.tsx` line budget in `scripts/architecture-budget.json`
  is ratcheted down to the new physical line count after the lightbox
  extraction.
- The tooltip mechanism is exercised through the existing
  `[data-tooltip]::after` rule, which triggers on hover, `focus-visible` and
  `focus-within`, so the keyboard-visible hint is covered by the same path as
  the pointer hint.

## Known consequence

- None of the changes alters layout geometry, component boundaries or state
  flow; every edit is a token, copy, focus-target or element swap within the
  existing surfaces. The dual-`:root` token conflict in `app/globals.css` is
  recorded here and left intact for a dedicated follow-up.

## Checklist

- [x] Focus moves to the in-place confirm control after a comment delete.
- [x] One accent family remains; no blue or gradient face survives.
- [x] Canvas and global near-purple literals resolve to the `--indigo` family.
- [x] Review selection violet family (`#6258d6` / `#4f47b8`) is preserved.
- [x] Amber warning surface is registered, not recolored.
- [x] Lightbox is a native `showModal()` dialog.
- [x] Floating panels read depth from `var(--shadow)`.
- [x] No badge or meta label renders below 9 px.
- [x] Toolbar hints use `data-tooltip` and match their `aria-label`.

final result: passed

# Post-review fixes — lightbox Escape, badge shadow hue and preview label clipping

Date: 2026-08-19

## Scope

- A focused review pass over the UI polish batch surfaced three concrete
  defects introduced by the batch. All three are fixed here before the PR is
  promoted. The muted-purple convergence decisions were re-examined and left
  as-is per product-owner direction.

## Findings

- The native attachment lightbox now owns the Escape path through the dialog
  `cancel`/`close` contract. A leftover document-level Escape listener that
  predated the dialog is removed; it bypassed the native contract and would
  have diverged from any future `onCancel` handling.
- The pink update badge keeps a shadow in its own hue. The batch had swept the
  badge's magenta shadow into the brick-red `--red` family, which clashed with
  the `#ff4f87` brand-pink fill. The shadow is restored to the matching
  magenta so the halo stays in the badge's hue family.
- The review preview segmented label is no longer clipped. Raising its font to
  9px left an 8px line box under `overflow: hidden`, which cropped the CJK
  glyphs ("修改前" / "修改后"). The line-height is raised to 10px so the
  glyphs fit.

final result: passed

## Glass material unification: real translucency, warm-fog overlays and paper grain

Date: 2026-08-19

### What changed and why

An audit of all `backdrop-filter` declarations found most blurs were
decorative rather than material: surfaces at 94–98 % opacity gave the blur
nothing to transmit, and the modal overlays each used a different dim color
and blur radius (3/5/6/8/10 px). This entry replaces that drift with the one
formula the handoff console had already validated (deep blur, saturation
lift, inset top highlight) and records it in DESIGN_LANGUAGE.md §3.

- Review pinned toolbar, its handle, the content-map handle and the map
  panel: 95–98 % opaque white → 76–85 % white with
  `blur(20px) saturate(180%)` and an inset top highlight, so page content
  now visibly breathes through the chrome while the segmented controls keep
  their own opaque gray shells for readability.
- Modal overlays (project drawer, external-open confirmation, review adopt
  confirmation, About) unified to one warm fog: `rgb(34 32 27 / 36%)` +
  `blur(16px) saturate(140%)`, with the blur animating from 0 on entry via
  the existing overlay transition. The lightbox keeps its dark room and only
  tightens to blur(12px).
- Canvas floating tools (lock notice, editing toolbar, capability hint,
  edit-status pill, history banner, comment rail header, notice bar) now share
  the same glass family at 78–88 % opacity
  with `saturate(140–180%)`; the source-conflict banner stays fully opaque
  because a red alert must read as a fact, not a material.
- The shell and workbench base layers carry a 3.5 % alpha SVG `feTurbulence`
  grain (`--grain`), giving the flat paper tones a physical tooth. No
  gradients were added anywhere (2.2 stays intact).

### Design-language conformance

- One emphasis family (2.2): no new accent color; the review violet family
  `#6258d6` / `#4f47b8` and every segmented-control surface are untouched.
- Quiet first (2.3): nothing animates without a state change; the overlay
  blur only sweeps in while a modal opens.
- Honest surfaces: grid areas that never overlay content (title bar, fixed
  rail) keep their flat treatment — blur is only spent where content really
  passes beneath.
- DESIGN_LANGUAGE.md §3 gained a "材质与虚化" subsection so the formula is
  reusable instead of rediscovered.

### Evidence

- Real Electron review run (`PAGEROOT_CAPTURE_REVIEW=1`,
  ai-handoff-closed-loop "stays pending through desktop review", 1 passed):
  `output/design-qa/ai-review-final.png` (glass toolbar and handles) and
  `output/design-qa/ai-review-map.png` (map panel over live content).
- Real render from the vinext dev server, 1440×900 @2x:
  `output/design-qa/glass-workbench.png` (grain shell) and
  `output/design-qa/glass-project-drawer.png` (warm-fog overlay).
- `npm run gate:edit` passed (113 node tests, typecheck, architecture
  check); the Electron closed-loop spec passed unchanged, confirming no
  registered contract (violet family, segmented shells, copy) moved.

### Known consequence

- More live `backdrop-filter` area means slightly higher compositing cost;
  blur radii are deliberately capped at 20 px and the grain layer is a
  static 180 px tile, so no per-frame paint work is added.
- The in-flight open-html-picker branch rewrites the project drawer and the
  "+" popover on these same surfaces; whichever lands second should point
  the new popover chrome at the same glass family instead of reintroducing
  an opaque card.

### Checklist

- [x] Review toolbar, handles and map panel transmit page content visibly.
- [x] All dimmed modal overlays share one warm-fog recipe.
- [x] Grain is present on shell/workbench bases only; review surface pixels
      and diff masks are unaffected.
- [x] Review violet family, segmented controls and all copy unchanged.
- [x] Reduced-motion paths untouched (no animation added or removed).

final result: passed

# Comment composer quiet action row

Date: 2026-08-20

## Comparison target

- Source visual truth:
  `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-deaeb859-b738-4c0c-af0b-d6bc59153f5f.png`
  (`484 × 152` px, user-provided focused action-row crop).
- Rendered implementation:
  `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-08dd1-h-Shift-Enter-for-new-lines/comment-rail-local-composer-quiet-actions.png`
  (`1600 × 900` px at a `1600 × 900` CSS viewport, DPR 1).
- Focused implementation crop:
  `output/playwright/native-dom-browser/comment-rail-local-composer-quiet-actions-crop.png`
  (`390 × 330` px).
- State: enabled ordinary-target new-comment Composer with text entered. The
  same assertions also run against the global-comment Composer.
- Density normalization: the source is a zoomed crop rather than a complete
  1:1 screen, so comparison is limited to icon order, relative size, color,
  framing and center-to-center spacing. The implementation crop remains at
  native DPR 1.

## Full-view comparison

- The Composer remains the only elevated comment surface. Its target label,
  inset textarea, card dimensions, close position and submission behavior are
  unchanged.
- The normal and global Composer screenshots keep the same card structure and
  differ only in target copy, as intended.

## Focused comparison

- Attachment, image, delete and confirm controls are transparent and
  borderless by default.
- All four action buttons retain the original DOM/layout structure while using
  one `8px` adjacency gap; a browser geometry assertion limits center-gap drift
  to at most `1px`.
- The confirm mark is now a `20px` filled Phosphor check-circle in
  `var(--indigo)`; the other action icons remain `17px` and neutral gray.
- Hover and keyboard focus use a light state surface without restoring a
  visible border.

## Comparison history

1. P2 — the first implementation still exposed the old filled submit button
   and framed close/tool controls. Fixed by making Composer and saved-comment
   actions transparent with color-only/light-surface interaction feedback.
2. P2 — an intermediate interpretation regrouped the controls. Reverted that
   structural change, preserved the original layout, standardized only the
   spacing, and enlarged the confirm icon to `20px` with the product purple.
3. Post-fix evidence — the source crop and final focused implementation crop
   were opened together. No P0/P1/P2 visual mismatch remains in the requested
   action row.

## Required fidelity surfaces

- Typography: unchanged; no action text was added to the quiet icon row.
- Spacing/layout rhythm: equal adjacent gaps; card padding and elevation
  unchanged.
- Colors/tokens: neutral action icons plus one purple confirmation accent.
- Image/icon quality: existing Phosphor assets are retained; no substitute
  glyphs or handcrafted SVGs were introduced.
- Copy/content: accessible labels and the existing close/delete/submit
  behavior remain unchanged.

final result: passed

## Review toolbar as a real overlay: open by default, no page displacement

Date: 2026-08-20

### What changed and why

The review toolbar looked like an overlay but behaved like a layout row: the
pinned state pushed a 117 px top padding into the canvas grid, so every
expand/collapse re-laid out both pages, moved the pane headers and re-measured
the projection. It also started collapsed, so the first thing a reviewer saw
was a 22 px handle instead of the review controls.

- The toolbar now enters review already expanded and floats above both pages.
  The pages keep the full canvas at every moment; expanding or collapsing only
  slides the overlay itself (one 210 ms transform, no reflow, no re-measure).
- The dock no longer swallows pointer events: only the glass toolbar and its
  handle are hit-testable, so a collapsed toolbar leaves the top of both pages
  clickable instead of covering it with an invisible full-width strip.
- Reveal is now click-only. The old `:hover` reveal fired anywhere in that
  invisible strip and, with the dock's transparent padding no longer capturing
  the pointer, would have flickered at the overlay's own edge.
- The content-map drawer still steps down while the toolbar is expanded, on the
  same curve, so the overlay never covers the map panel title.

### Design-language conformance

- Material unchanged: the same glass recipe, radius, shadow and violet family;
  no new color, size or copy.
- Honest surfaces (§3): the toolbar is now genuinely a surface floating over
  content, which is what its blur was already claiming.
- Quiet first: one transform per state change; reduced-motion now silences the
  drawer offset too, and the removed grid transition left nothing behind.

### Evidence

- Real Electron review run, expanded default state:
  `output/design-qa/review-annotation-all.png` — both pages start at the canvas
  top and pass under the toolbar; page content is visible immediately below it.
- Real Electron review run, collapsed state (`PAGEROOT_CAPTURE_REVIEW=1`):
  `output/design-qa/ai-review-comment.png` — handle at top center, both pane
  headers and the full page visible, nothing shifted.
- `npm run gate:edit` passed. `playwright.ai-closed-loop.config.mjs`: 17
  passed; the review geometry test now asserts the overlay relationship and
  that collapsing does not move the pane header.
  `playwright.review-annotation.config.mjs`: 1 passed.

### Known consequence

- While the toolbar is expanded it covers the two pane headers and the first
  ~90 px of both pages; that is the point of an overlay, and one click on the
  handle reveals them. Reviewers who want the page edge collapse the toolbar.
- The page-end scroll-sync test needed an explicit "both pages start at the
  same offset" precondition. The taller viewport made a pre-existing gap
  visible: a harness-driven `scrollIntoViewIfNeeded` can leave the coordinator
  holding a stale follower position, which the next gesture then preserves as a
  fixed takeover offset. The assertion itself is unchanged.

### Checklist

- [x] Toolbar is expanded when review opens.
- [x] Expanding or collapsing never moves, resizes or re-measures the pages.
- [x] Collapsed state leaves the top of both pages interactive.
- [x] Only the handle click changes the state; hover does nothing.
- [x] Content-map panel title is never covered by the expanded toolbar.

final result: passed

## Open-HTML popover: borderless list, compact rows, full name on hover

Date: 2026-08-20

### Source visual truth

A user screenshot of the shipped “打开 HTML” popover, with the verdict: drop the
borders around 最近打开 and 打开本地 HTML, tighten the information density, let a
truncated file name be readable on hover, and keep the result minimal and
elegant. That verdict supersedes the 2026-08-19 entry’s promise that the popover
body stays “pixel-identical” to the earlier list treatment — the classes are
still the same ones, but their treatment is now the popover’s own.

### What changed and why

- **No boxes inside a box.** The recent list lost its `1px` card border, white
  fill and 14px radius, and every row lost its hairline divider; 打开本地 HTML
  lost its border and card fill too. A popover is already a surface — a second
  and third framed surface inside it only added weight. Grouping now comes from
  the 最近打开 section label and whitespace, and each row is a 9px-radius hover
  band inset 8px from the card edge, like a menu item.
- **Rows are one line, 30px instead of 58px.** The folder subline left the row;
  the row is now `HTML icon · name · (state) · time`, so six entries read as one
  quiet column instead of six stacked cards. Popover height drops from ~490px to
  ~270px with the same six files.
- **The full name is on hover, and it carries the folder.** A truncated name is
  no longer a dead end: hovering a row shows the complete file name plus the
  folder that used to occupy the second line, so nothing was removed from the
  interface, only moved to where it is needed.
- **Chrome quietened to match.** The header tile is 28px, the close button lost
  its border and box, the per-row caret is gone (the whole row is the button),
  and the remove `×` is a borderless 24px slot that appears on hover. The file
  counter is hidden when there is nothing to count.

### Design-language conformance

- Hover uses the single accent family (`--indigo` at 6%) with the name shifting
  to `--indigo-deep`; no second emphasis colour, no gradient face (2.2).
- The hover tooltip reuses the shared `[data-tooltip]` mechanism instead of a
  native `title` (2.5). The one addition is `data-tooltip-wrap="true"`, which
  lets the existing bubble wrap a long name over two lines rather than run past
  its own box; the first row flips to `data-tooltip-side="below"` so the bubble
  never covers the dialog heading.
- Geometry is stable (2.6): the remove slot keeps its 24px column in the default
  state and hover only changes opacity, so no row shifts when the pointer
  enters. Typography stays inside the 9–15px compact scale, icons stay Phosphor,
  radius stays in the accepted set (16px card / 9px row).
- Progressive disclosure (2.7) now applies to the row: the destructive action
  and the full identity of the file appear on demand, the state badge and time
  stay visible.

### Behavior and accessibility

- Escape, click-outside, focus start on 打开本地 HTML, Tab wrapping and focus
  return to the “+” button are untouched.
- The remove button stays in the tab order and `:focus-visible` reveals it, so
  the hover-only affordance is still keyboard-reachable; `@media (hover: none)`
  keeps it permanently visible.
- The tooltip appears on keyboard focus as well as hover, because the shared
  mechanism binds `:focus-visible`.
- `prefers-reduced-motion` removes the new hover transitions along with the
  existing popover animation.
- The popover no longer scrolls at supported window heights (the list is capped
  at six rows and the app enforces a 680px minimum), which is what lets the
  tooltip escape the card; below 560px viewport height it regains
  `max-height`/`overflow`, where a clipped bubble is the accepted trade.

### Evidence

- `output/design-qa/open-html-popover-rest.png`, `-hover.png`,
  `-hover-last.png`, `-status.png`, `-error.png`, `-empty.png` — the real
  component rendered with the real stylesheets at 2× (900×700 viewport),
  covering rest, first-row and mid-list hover, an AI-processing badge, the amber
  read-failure banner and the empty list.
- `npm run gate:edit` passed (876 tests).

### Checklist

- [x] No border or card fill remains around 最近打开 or 打开本地 HTML.
- [x] Six recent files fit without scrolling and read as one column.
- [x] A truncated name is fully readable on hover, together with its folder.
- [x] Hover and focus never move a row or a neighbouring row.
- [x] Amber read-failure banner and empty state survive the borderless list.
- [x] One emphasis colour; icons remain Phosphor-only.

final result: passed

## Quick-action tooltip lifecycle and open-HTML click-outside dismissal

Date: 2026-08-21

### Reported defects

A user screenshot of the shipped title bar: the “打开新的本地 HTML” bubble sits
above the “+” while its own popover is open, and the report adds that the bubble
“sometimes cannot be dismissed and stays on screen”. The second report asks for
click-outside dismissal on that popover, because “only the X closes it”.

### Root causes

- The shared tooltip revealed itself on `:focus-within`, which also matches the
  element itself. Chromium leaves a clicked button focused, so any mouse click on
  a header quick action pinned its bubble until focus moved elsewhere — including
  the programmatic focus return after the popover closes. With the pointer still
  resting on the trigger, `:hover` additionally kept the bubble over the popover
  the click had just opened.
- The dismiss layer covers the `-webkit-app-region: drag` title bar the popover
  hangs from but did not opt out of dragging. macOS therefore consumed every
  click in that strip as a window drag, so clicking the header beside the popover
  or the “+” again never reached the DOM handler that was already implemented.
  Only the canvas area below the header dismissed the popover, which is why the
  X button looked like the only exit. The 2026-08-20 entry above recorded
  click-outside as “untouched”; that was true of the handler, not of the reachable
  area.

### What changed and why

- **Tooltip reveal is pointer- and keyboard-scoped.** `[data-tooltip]` now
  reveals on `:hover` and `:focus-visible` only. Mouse focus no longer pins a
  bubble; keyboard focus still explains the control.
- **An opened surface owns the explanation.** `[data-tooltip][aria-expanded="true"]`
  suppresses the bubble, so a pointer resting on the trigger cannot leave it
  floating over the popover. The rule stays last in the file because it shares
  specificity with the reveal rules.
- **The dismiss layer is not draggable.** The popover backdrop declares
  `-webkit-app-region: no-drag`, matching the existing `.workbench-header button`
  exception. The whole window, title bar included, counts as “outside” again.

### Design-language conformance

- 2.5 同类同形: one `[data-tooltip]` mechanism, now with one documented
  lifecycle; no control gains a private `title` fallback.
- 2.6 几何稳定: the bubble stays absolutely positioned and out of layout; nothing
  moves when it appears or leaves.
- 2.7 渐进披露: hover and keyboard focus still disclose the label, while the open
  surface replaces it instead of doubling it.

### Behavior and accessibility

- Hover reveal, the 180ms delay, `data-tooltip-side="below"`, wrapping row
  tooltips and `prefers-reduced-motion` are unchanged.
- Tab focus still reveals the bubble (`:focus-visible` verified true), so the
  keyboard path keeps its explanation.
- Escape, the X button, the focus trap and focus return to “+” are unchanged; the
  popover still cannot be double-opened by a second click on the trigger.

### Evidence

- `output/design-qa/quick-action-tooltip-open-popover-retired.png` — the reported
  defect, reproduced by re-adding the two retired rules to the fixed build.
- `output/design-qa/quick-action-tooltip-open-popover.png` — the same state after
  the fix: no bubble over the popover.
- `output/design-qa/quick-action-tooltip-hover.png` — hover still explains the
  control.
- Real-component Chromium probe (real `OpenHtmlDialog`, real stylesheets), before
  → after: mouse click on a quick action `visible/1` → `hidden/0`; bubble while
  the popover is open `visible/1` → `hidden/0`; after X close with the pointer
  away `visible/1` → `hidden/0`; keyboard Tab focus `visible/1` → `visible/1`;
  outside canvas click dismissed the popover in both runs.
- The drag-region half cannot be exercised by automation: CDP-synthesized input
  bypasses the browser-process hit test that consumes title-bar clicks. It is
  guarded by the CSS contract assertion on the backdrop and by the same
  no-drag exception the header buttons already depend on to be clickable at all.
- `npm run gate:edit` passed.

### Known consequence

The Electron window can no longer be dragged by its title bar while the popover
is open. That is the intended trade: a modal dismiss layer must own the pointer
it covers.

### Checklist

- [x] A mouse click on a header quick action leaves no pinned bubble.
- [x] No bubble overlaps the open “打开 HTML” popover.
- [x] Keyboard focus still reveals the tooltip.
- [x] Clicking the title bar beside the popover, or the “+” again, dismisses it.
- [x] Escape and the X button still close the popover.

final result: passed

---

# AI review annotations — quiet-by-default layered model

Date: 2026-08-21

## Superseding direction

- This entry supersedes the visual presentation half of "AI review workspace —
  adjacent same-summary badge aggregation" (2026-08-18) and the structure-blue
  legend detail of "AI review entry-state and diff-legend QA" (2026-08-18):
  1. confirmed change boxes no longer rest as always-on dashed outlines; a
     per-fact caption no longer exists;
  2. the structure tone folded into the single violet accent family
     (`REVIEW_STRUCTURE_TONE_COLOR` = `#6d5ce7`); at a 1.5px outline the old
     blue was indistinguishable from violet, so the change kind is carried by
     caption text and the filter legend, not by hue.
- Everything else stays in force: the dim mask as the only "where" surface,
  the frozen character-evidence marks (green dots / red dashed strike), the
  amber suspected frame, mask/box geometry equivalence, and the aggregation
  *logic* (now applied to caption anchors of spatial stretches instead of
  per-record badges).

## Design decision

- Quiet by default → loud on reach. At rest a confirmed change paints no
  outline: the dim mask says "where", one clickable violet revision bar per
  contiguous stretch of a change sits at the page's left edge as a position
  index, and each stretch carries exactly one content-language caption
  ("新增内容 · 视觉调整", ≥3 kinds → "综合调整") at its topmost box.
- A change that touches places far apart on the page (a document-wide text
  pass spans thousands of pixels) gets one caption and one bar per *spatial
  stretch* (`reviewRegionAnnotations`, cluster gap 28 × UI scale), not one
  distant caption per changeId; navigation and the 变化区域 count stay per
  change.
- Hover previews: pointing at a stretch or its bar shows the change's precise
  boxes as low-emphasis thin solid outlines; leaving rests them again.
- Focus claims: the navigated change's boxes turn solid violet with a 4%
  violet tint, its bars highlight, and each of its stretch captions upgrades
  to per-kind fact counts ("新增内容 ×3 · 视觉调整 ×3"). Clicking a bar or a
  caption navigates to that change (`select-change` message).
- Adjacent same-caption stretches still collapse into one "{caption} ×N"
  representative, judged by caption-anchor distance (stretch top edges) so
  tall regions no longer over-merge; the focused change always keeps its own
  captions without the cluster count.
- The amber suspected frame and the character evidence never go quiet: one is
  an unverified-visibility hint, the other is the character-level proof.

## Automated evidence

- `tests/e2e/electron/review-annotation-clarity.spec.mjs` extends the dense
  report contract: resting boxes are transparent, captions ≤ stretches per
  change with well-formed ×N cluster suffixes, every change is indexed by a
  revision bar, hover previews and rests, focus claims while others rest.
- `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs` passes end to end with
  the new contract: per-record vocabulary anchored on `data-summary`, quiet /
  claimed border assertions, same-caption overlap forbidden at 适应, and the
  mask-union pixel section parks navigation on the page overview so the
  focused claim tint stays out of a pure dim contract.
- `tests/review-region-annotation.test.mjs` (15 cases) covers stretch
  clustering, caption composition, per-kind fact counts, carrier selection,
  suspected propagation and input immutability.
- `tests/e2e/browser/native-dom-runtime-projection-binding.spec.mjs` (18/18)
  confirms the suspected amber frame and chart-host tolerance from PR #249/#251
  survive unchanged.
- Rendered evidence: `output/design-qa/review-annotation-all.png` (entry state:
  focused stretch claimed, second change resting with bar + caption + red
  strike only), `review-annotation-text.png`, `review-annotation-structure.png`.

## Checklist

- [x] Resting canvas shows no confirmed outlines; bars + captions + evidence
      only.
- [x] One caption and one bar per contiguous stretch; navigation counts
      unchanged.
- [x] Hover previews without claiming; focus claims with per-kind counts.
- [x] Single violet accent family for confirmed marks; amber suspected and
      red/green evidence untouched.
- [x] Bar and caption clicks navigate to the change.
- [x] gate lanes: region-annotation unit 15/15, projection-binding 18/18,
      review-annotation-clarity 1/1, ai-closed-loop deterministic pass.

final result: passed

---

# Review annotation corrections found by driving the installed app

Date: 2026-08-21

## How these were found

The quiet-by-default entry above was reviewed by driving the *packaged*
Developer Preview through a real AI handoff on a dense Chinese report: a
680px prose column with a wrapped multi-sentence paragraph, a four-card metric
grid and two CDN ECharts hosts. Nine candidate shapes (pure insert, pure
delete, mixed rewrite, structure add/remove, chart-data-only, authored-script
rewrite with identical rendering, a change outside `<main>`, and all of them
combined) were replayed four times each. The projection was read back from
both review frames, so every finding below is a measurement of what the
shipped build actually painted, not a code reading.

## Findings and what changed

- **An unchanged chart was announced as 视觉调整 in 13 of 28 runs.** Two
  independent causes. The capture rect floored its origin while ceiling its
  size, so the captured band sat up to a full pixel off the host, and because
  that offset follows the host's fractional page position the two sides of one
  pair were sampled at different sub-pixel phases. Separately, one frame taken
  a fixed 1200ms after first paint let a chart library finish drawing on either
  side of that instant. The crop now rounds to the nearest whole pixel, and a
  candidate is accepted only once two consecutive frames of the same host agree
  (bounded attempts, still inside the owner deadline).
- **A byte difference was treated as a chart change.** The raster verdict now
  requires structural evidence — strongly different pixels (≥28/255 on one
  channel) covering ≥2% of the surface. A diffuse difference proves neither
  verdict and lands in 疑似有改动 rather than being announced as a change.
- **A two-character edit earned a frame about three characters wide.** The
  readable minimum for a phrase box was sized from the line box, so generous
  leading inflated it and the frame cut into the untouched glyph on each side.
  It is now sized from the text's own em (1.5em, floor 16px).
- **One caption spoke for two side-by-side cards.** Region clustering was
  vertical-only, so two cards in one grid row merged and the caption anchored
  on whichever card happened to be topmost. Horizontal distance now separates
  records that *share a row*; a phrase that flowed onto the next line still
  keeps its caption wherever it starts.
- **The deletion rule was reported as barely visible.** `#c74f4a` at
  `max(1, 0.07em)` reads as a grey hairline inside dimmed context. It is now
  `#d92d20` at `max(1.2, 0.1em)`, with the dash rhythm scaled ~20% so the
  heavier stroke still reads as dashes instead of a solid rule.

## Design-language conformance

- 2.2 单强调色: the strike stays a semantic fact colour in the existing red
  family — more saturated, not a second accent, and never used to express
  direction of change. The violet accent family is untouched.
- 2.3 安静优先: resting state is unchanged. Confirmed boxes still paint no
  outline until hover or focus reaches them; only the character evidence and
  the dim mask are always on.
- 2.6 几何稳定: nothing moves. The strike is an SVG overlay, and the tighter
  phrase box only shrinks an overlay rectangle.

## Automated evidence

- `tests/review-text-evidence-marks.test.mjs`: the rule stays ≥1.2px and
  ≤0.14em at 12/13/14/16px, and the gap never closes below the dash.
- `tests/review-region-annotation.test.mjs` (19 cases): side-by-side columns
  keep their own caption, a wrapped paragraph keeps one, and scattered edits on
  consecutive lines still collapse to one `删除内容 ×3`.
- `tests/review-runtime-visual.test.mjs`: the strong-pixel ratio separates a
  repainted area from a shifted edge; a raster difference with no structural
  evidence, or with no ratio at all, fails closed to unverified.
- `tests/review-runtime-capture-owner.test.mjs` (20 cases): a candidate costs
  two agreeing frames, hosts never interleave, and the settle wait still stays
  subordinate to the owner deadline.

## Rendered evidence

Captured at 100% canvas scale from the installed
`PageRoot-Developer-Preview-0.9.999997-dev.g8bce6ea…-arm64.dmg`:

- `output/review-verification/shots/zoom/red-tiny-delete.png` — the new rule
  through a two-character deletion.
- `output/review-verification/shots/02-long-para-clause-delete-C-lede-before-100.png`
  — one deleted sentence inside a dimmed paragraph.
- `output/review-verification/shots/03-long-para-rewrite-C-lede-before-100.png`
  — 14 deletion runs under a single paragraph rectangle.
- `output/review-verification/shots/05-dense-region-C-metrics-*.png` — five
  edits in one card grid, now captioned per card.

## Measured result

Against the same nine-shape matrix on the fixed build: unchanged charts were
announced in 0 of 21 runs (was 13 of 28), the real chart change was still
caught in every run, the authored-script rewrite still reported nothing about
the chart, and the four scattered two-character deletions read as one region,
one revision bar and one `删除内容 ×3`.

## Known consequence

Requiring two agreeing frames can drop a real chart change when the host never
settles inside the deadline; one such miss was observed before the attempt
budget was raised. That is the intended direction: the review may stay silent
about a chart it could not verify, but it must not announce a change that did
not happen.

## Checklist

- [x] The deletion rule reads as a deliberate red dashed line at body copy.
- [x] The rule never thickens into a band over the glyph.
- [x] A two-character edit no longer frames its untouched neighbours.
- [x] Side-by-side cards caption themselves; wrapped prose stays one region.
- [x] Unchanged charts stay silent; a repainted chart is still reported.
- [x] Resting canvas, violet accent family and mask behaviour unchanged.

final result: passed

---

# Unified global sidebar and document toolbar

Date: 2026-08-27

## Comparison target

- Source visual truth:
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-874b3be9-85a3-4fdf-bc39-681567a52de0.png` for the ChatGPT-style full-height sidebar and titlebar control relationship.
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-acab32ef-eca3-4387-8d20-03bcb3ef8a12.png` for the compact document toolbar.
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-3f932414-1909-448f-b00a-b8d0d80ff5f3.png` for the original start-page state that needed the card removed and the project action promoted.
- Rendered implementation:
  - `output/design-qa/unified-sidebar-toolbar/implementation-start-sidebar-open.jpeg`
  - `output/design-qa/unified-sidebar-toolbar/implementation-start-sidebar-collapsed.jpeg`
  - `output/design-qa/unified-sidebar-toolbar/implementation-document-toolbar.jpeg`
  - `output/design-qa/unified-sidebar-toolbar/implementation-document-sidebar-collapsed.jpeg`
- Same-input comparison evidence:
  - `output/design-qa/unified-sidebar-toolbar/comparison-sidebar.png`
  - `output/design-qa/unified-sidebar-toolbar/comparison-toolbar.png`

## Viewport and normalization

- Electron window CSS size: `1440 x 960`; minimum product size: `960 x 720`.
- Computer Use capture: `1152 x 768` JPEG, normalized by the capture service to 80% of the CSS window; no device frame or browser chrome was added.
- Sidebar source: `762 x 1993`; normalized to `294 x 768` before placing it beside the `1152 x 768` implementation capture.
- Toolbar source: `2870 x 156`; normalized to `1152 x 63`, then stacked with the implementation's `1152 x 72` titlebar-plus-toolbar crop.
- The source images are directional references rather than pixel-identical screens. The comparison therefore judges the requested shell hierarchy, control ownership, density, alignment, tokens, and states rather than copying ChatGPT product content.

## States and interactions tested

- Start page with sidebar collapsed: the titlebar contains one sidebar toggle beside the native traffic lights; the page has no white card; `查看现有项目` is the primary action above the Finder action.
- Start page with sidebar expanded: the sidebar owns the full left edge across tabs, toolbar, and content; the main product shifts as one surface; the HTML brand mark and project lists live in the sidebar.
- Registered project opened from the sidebar: the document header contains status, folder, and default-browser actions without the previous HTML icon, file title, plus button, or popup.
- Document with sidebar expanded and collapsed: the round trip preserves the selected tab and document, exposes exactly one collapse/expand control, and does not leave a narrow rail.
- Edit state with an AI candidate ready: edit/preview/review modes, review controls, project, and AI actions remain in one row; unavailable review controls remain visible and disabled.
- Accessibility tree confirmed named buttons for sidebar, folder, browser, modes, review filters, scrolling, zoom, project, and AI actions.
- The successful isolated launch produced no crash or unhandled renderer error. It did surface the expected welcome-workspace integrity warning from the disposable E2E profile; that banner was dismissed before comparison and did not affect the tested project.

## Fidelity review

- Fonts and typography: the implementation retains the product's system CJK stack and compact UI hierarchy. Sidebar labels, start-page actions, status copy, and toolbar labels remain legible without wrapping at the tested desktop size.
- Spacing and layout rhythm: native controls, the unique sidebar toggle, and tabs share one 40px titlebar rhythm. The sidebar uses a single quiet boundary; the document toolbar is one 48px aligned row. The start page removes the former card elevation and keeps content directly on the workspace surface.
- Colors and tokens: neutral shell surfaces, hairline dividers, semantic green save state, and the existing violet accent remain consistent. Disabled review controls are intentionally lower contrast but still present and identifiable.
- Image and asset fidelity: no source imagery was substituted with CSS drawings or placeholder art. Product controls use the existing Phosphor icon family; the HTML brand asset was moved to the sidebar instead of recreated.
- Copy and content: `继续编辑 HTML`, `查看现有项目`, `从 Finder 打开 HTML`, file actions, and mode/review labels match the requested hierarchy and remain product-specific.
- Icons and control states: the sidebar toggle, folder, external-browser, mode, review, project, and AI icons use consistent stroke weight and 32-34px control geometry. Selected, unavailable, and disabled states are visually distinct.
- Responsiveness and accessibility: no clipping or toolbar overlap appeared at the tested desktop window. The product minimum and responsive token contracts remain covered by the edit gate; reduced-motion handling is retained for the sidebar grid transition.

## Findings

- No actionable P0, P1, or P2 mismatch remained in the combined full-view and focused-toolbar comparisons.
- P3 follow-up polish: the disabled review cluster is deliberately quiet and dense; after regular use, its opacity can be tuned if users cannot distinguish individual tools at a glance. This does not block the requested persistent-but-disabled behavior.

## Comparison history

- Pass 1: the combined sidebar comparison preserved the reference's full-height shell ownership while applying Stemmio's project-focused information architecture. No P0/P1/P2 issue was found.
- Pass 1: the focused toolbar comparison confirmed that the old document identity block was removed, file actions moved into the compact status group, and mode/review/project/AI controls remained aligned in one row. No fix iteration was required.

## Implementation checklist

- [x] Full-height collapsible global sidebar with one titlebar control.
- [x] Native traffic lights and sidebar control aligned in both sidebar states.
- [x] Start page without a white card and with projects promoted over Finder.
- [x] Compact one-row document toolbar across modes.
- [x] Persistent disabled review tools outside review mode.
- [x] Folder and default-browser actions in the toolbar.
- [x] HTML mark moved to sidebar; document icon, title, plus, and popup removed.
- [x] Real isolated Electron interaction and screenshot evidence captured.

final result: passed

---

# AI assistant conversation redesign

Date: 2026-08-28

## Comparison target

- User references:
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-9854588a-06d5-434b-a124-545c4154b746.png` for the unreadable cumulative Agent text wall.
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-764fd582-dddb-450f-bfa6-736ee0269b5e.png` and `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-65981b4e-3c80-4a9b-b053-68f097ca88aa.png` for the duplicate collapse control, repeated PageRoot notices, ambiguous result copy, and unsigned decision.
  - `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-58c8460f-de8b-4b42-82ea-18851b4df198.png` for the oversized Agent selector disclosure.
- Rendered implementation:
  - `output/design-qa/ai-assistant-redesign/qoder-processing-thinking.png`
  - `output/design-qa/ai-assistant-redesign/qoder-result-ready.png`
  - `output/design-qa/ai-assistant-redesign/agent-selector-open.png`

## Viewport and states

- Isolated Electron window: `1440 x 960` CSS pixels at 2x device scale; screenshots are `2880 x 1920` PNGs.
- Processing: PageRoot identifies the exact HTML and sent context, then states the reliable current stage. Three Qoder public updates appear as separate rows under one Qoder identity, followed by a bounded animated `Thinking` line.
- Result: the completed-stage duplicate is removed. PageRoot alone signs `版本 2 等待你的决定` with its logo and actions; Agent narration remains readable above it.
- Agent chooser: the menu contains only logo plus Agent name, opens above the footer, closes on outside click, and leaves the left selector and right delivery actions vertically centered.
- Header: there is no internal collapse button; the single top `AI 助手` entry completes the open, close, and reopen cycle in preview and review.

## Functional and visual checks

- Canonical Qoder events rendered as three rows; Codex token deltas from one public message stayed in one row and its next public message became a second row. Hidden reasoning was absent.
- `Thinking` was visible during both managed-Agent runs and absent after the terminal decision appeared. Reduced-motion CSS disables its animation while retaining the status text.
- The stream remained at the newest content after both narration growth and the result action; user-upscroll protection and the `有新进展` recovery affordance remain intact.
- No document-level horizontal overflow, sidebar clipping, or Composer clipping was present. The Agent selector and delivery action centers differed by at most one CSS pixel.
- The dropdown cleared the long local-file disclosure and did not clip behind the Composer or preview.
- Typography, neutral surfaces, 22px speaker marks, 8px narration rhythm, violet PageRoot accent, and compact 30px footer controls form one restrained visual system.

## Findings

- The first visual pass exposed a state-projection error: after managed handoff, PageRoot could still say `正在准备本轮资料`. The outlet now passes the complete handoff fact, so the visible stage correctly reads `Qoder 正在修改页面` or the matching Agent name.
- The second pass exposed a redundant settled PageRoot line beside the decision. It was removed while retaining Agent narration and the signed version decision.
- Independent review found three accessibility/content-boundary gaps: punctuation-free explicit paragraphs could rejoin, the chooser used incomplete `listbox` semantics, and the Candidate decision had no isolated announcement. Explicit paragraph boundaries now persist, the chooser is a normal button group with stable focus through Agent checks, and the visible decision title is a polite atomic status.
- No remaining P0, P1, or P2 visual, interaction, accessibility, clipping, or stacking issue was found in the three final states.

## Checklist

- [x] Public Agent updates read line by line under one identity.
- [x] Dynamic `Thinking` appears only while the Agent is working.
- [x] New content follows the bottom without stealing a user-upscrolled viewport.
- [x] PageRoot names the file, sent context, current reliable stage, and final decision.
- [x] The PageRoot decision has both brand mark and actor name.
- [x] One top-level AI assistant toggle owns open and close.
- [x] Agent chooser is compact, dismissible, correctly layered, and aligned with actions.
- [x] Removed copy does not appear in app or Electron contracts.

final result: passed

---

# Start page as a lightweight work-resume surface

Date: 2026-09-01

## Comparison target

- Source visual truth: the user-provided start-page structure and state rules in this task. It supersedes the previous centered `继续编辑 HTML` action stack and the start-page recent-files list.
- Rendered implementation:
  - `output/design-qa/start-page/start-page-1440x900.png`
  - `output/design-qa/start-page/start-page-960x720.png`

## Viewport and states

- Isolated Electron windows at `1440 x 900` and `960 x 720` CSS pixels, captured at 2x device scale.
- Registry-backed continuing project with exact project name, active Working Copy file name, and one pending Candidate.
- The final screenshots exclude the unrelated import-success toast so the start-page hierarchy can be judged directly.

## Functional and visual checks

- `继续编辑` opens the Registry project through the existing registered-project navigation path and reuses the active Start tab.
- The pending-Candidate row is keyboard focusable and Enter opens the corresponding project; no intermediate explanation view is introduced.
- The page refreshes existing Recent and Registry projections on mount without adding a new persistence or task owner.
- The populated page uses one 840px content column, top alignment, one violet `新建项目` action, one light resume card, and border-only task rows. The left project sidebar remains the full project navigator.
- Both tested windows have no horizontal overflow, clipped content, card/action collision, or hidden primary control. Focus rings and reduced-motion overrides remain explicit.

## Findings

- The previous oversized centered icon, parallel `查看现有项目` / `从 Finder 打开 HTML` actions, and recent-file list duplicated the sidebar's navigation role. They were removed.
- Only the existing Registry `hasPendingCandidate` fact is projected as a task. Comment, conflict, Runtime, sync, and protocol facts were not inferred or duplicated into a new view-level task model.
- No P0, P1, or P2 visual, interaction, accessibility, clipping, or stacking issue remained in the final populated state.

## Checklist

- [x] Top-aligned 760–880px-class content column with no enclosing panel.
- [x] One-project `继续编辑` card with project and HTML identity.
- [x] Lightweight actionable task rows hidden as a section when empty.
- [x] One stable `新建项目` action; sidebar uses the same product wording.
- [x] First-project empty-state structure stays concise and uses the same single action.
- [x] Real isolated Electron interaction, compact-window fit, keyboard path, and screenshot evidence.

final result: passed

---

# Element delete and comment-anchor protection

Date: 2026-09-02

## Comparison target

- Source visual truth: the user screenshot showing the obsolete comment-rail relink card, superseded by the request to prevent normal target loss and keep exceptional guidance inside the affected comment card.
- Existing product truth: reuse the established element-delete confirmation, adding only a conditional comment consequence line.

## Viewport and states

- Browser editing surface at `1600 x 900` CSS pixels using an identified Working Copy fixture.
- One saved comment on a descendant heading, followed by selection of its containing source module.
- The first delete click opens the existing confirmation; cancel preserves both facts, while the second confirmation removes both.

## Functional and visual checks

- The confirmation names the selected module and explicitly states that one associated comment will also be deleted.
- The existing delete confirmation is unchanged when there are no comments; when comments exist, it appends only the associated-comment consequence line.
- The normal delete path consumes the semantic operation's removed Stable ID set, including descendants; the comment card and marker disappear with the module instead of becoming `orphaned`.
- Exceptional externally orphaned comments show only the card-local `评论位置已丢失` guidance and existing delete action; no global relink card or automatic send resumption remains.
- Cancel closes the existing confirmation without changing the source or comments; no parallel confirmation surface or new focus system is introduced.

## Findings

- The first visual pass right-aligned the 340px confirmation to a toolbar near the left viewport edge and clipped its leading copy. The final version chooses left or right alignment from toolbar geometry and uses a 420px bounded width.
- No remaining P0, P1, or P2 visual, interaction, accessibility, clipping or stacking issue was found in the final state.

## Checklist

- [x] Destructive result is explained before commit.
- [x] Associated comment count includes descendant source targets.
- [x] Cancel preserves the element and comments.
- [x] Confirm removes source and comment facts together.
- [x] No normal delete-created orphan card remains.
- [x] Exceptional target loss stays card-local with a concrete recovery instruction.

final result: passed

## AI Agent closed loop — 源页 / Qoder / Codex one-row Composer

Date: 2026-09-02

### Comparison target

- Source visual truth: the existing AI sidebar Composer in `output/design-qa/ai-assistant-redesign/` (Qoder processing and result-ready frames) plus Settings' one-card Agent section.
- Product decision that supersedes PRD §2.5 / §10.5 for 源页 HTTP Agent only: the sidebar may name model and thinking depth when the selected Agent actually offers a choice. Qoder and Codex remain provider-default with no thinking-depth control.

### Required fidelity surfaces

- Fonts and typography: Composer chips stay 11px / 680 weight on the system stack; thinking depth reads `思考 · 高` so the control is self-explanatory without a tooltip.
- Spacing and layout rhythm: Agent identity, model and thinking depth stay on one Composer row with the delivery actions. Chips ellipsize (`max-width: 108px`) instead of wrapping, so Qoder's existing same-row geometry contract is preserved.
- Colors and visual tokens: one indigo send button, quiet chip chrome, brand mark `./brand-logo.png` for 源页 Agent. No second accent, no new dialog, no NoticeBar.
- Copy: Settings shows only the selected Agent. Token Agents recover with “连接 …”; Qoder/Codex keep “登录 …”. Status words stay on the card (`需要 Token` / `已连接`); the extra toolbar sentence was removed.
- Icons and control states: 源页 uses the product brand mark; Codex keeps the OpenAI glyph; Qoder keeps its logo. No emoji or one-off SVG.
- Accessibility: thinking-depth and model triggers keep `aria-label` and exclusive lists; Escape and outside pointer close the open list.

### Findings

- P1: a third chip with only “高” failed 秒懂. Fixed by prefixing `思考 ·`.
- P1: Token Agents used “登录”, which is a Qoder/Codex fact. Fixed by `credentialKind === "api-token"` → “连接”.
- P2: 源页 Agent used the Code icon, colliding with a developer-tool reading. Fixed by the brand logo.
- P2: Settings explained the dropdown in a second sentence. Removed; the control already names the Agent.
- No remaining P0/P1/P2 layout jump, second emphasis color, or extra modal.

final result: passed

## AI Agent closed loop — 源页 HTTP Composer and Token card

Date: 2026-09-02

### Comparison target

- Source visual truth: the Qoder Composer frames in `output/design-qa/ai-assistant-redesign/` plus the existing one-card Settings Agent section.
- New rendered evidence: `output/design-qa/ai-assistant-redesign/pageroot-settings-connected.png`, `pageroot-composer-ready.png`, `pageroot-result-ready.png`.

### Required fidelity surfaces

- Fonts and typography: same 11px / 680 Composer chips; thinking depth still reads `思考 · 低` / `思考 · 高`; DeepSeek models use short `V4 Flash` / `V4 Pro` so the chip does not truncate the distinguishing word.
- Spacing and layout rhythm: Agent, model and thinking depth stay on one row with delivery actions. No wrap, no second surface.
- Colors and visual tokens: one indigo send button, quiet chip chrome, brand mark. Token form reuses the existing card field chrome.
- Copy: `需要 Token` / `填入 Token 后发送` / `连接`; after success `已连接` / `可从侧栏发送`. Rejected Token stays on the card: `Token 没有接通。` Sidebar next step is `连接 源页 Agent`.
- Icons and control states: 源页 brand mark in Settings and sidebar. No extra dialog.
- Accessibility: Token field keeps `aria-label="API Token"`; vendor select keeps `aria-label="厂商"`.

### Findings

- No remaining P0/P1/P2 crowding, second accent, or copy lecture. The three chips remain self-explanatory.

final result: passed


## 2026-09-07 — 第一批 C：版本顺序列表与统一展示

- Truth: 本批用户计划；保留既有侧栏/标签尺寸、颜色、文件名省略、时间与键盘操作。
- Evidence: `output/design-qa/version-projection/history.png`、`current.png`（真实 Electron 合成项目）。
- 核对：V1/V2/V3 按序号排列；历史选中 V1、标签 V1 + 历史、编辑禁用；返回当前选中 V3；侧栏宽度、行高、现有字体与强调色保持一致，分支来源保留悬停详情。
- 修复及复核：初次截图中长文件名遮掉历史标识，拆为不可收缩的标识后复拍，历史标识可见；未扩大标签。
- 自动回归：`@smoke-version-display` 的原生界面和 AI 审阅场景分别连续运行两次通过；项目切换使用实际可交互状态作为等待条件。
- 已记录 P2：历史页沿用的 Runtime 静态降级提示仍有“仍可编辑和保存”通用文案，与历史只读上下文不符；本批不改 Runtime，按钮的历史锁仍生效。
- final result: passed（本批展示范围；上述既有 Runtime 文案留待后续）


## 2026-09-08 — D：独立只读历史预览

- Truth: 用户第二批 D，沿用现有标签、侧栏和 HtmlInteractionPreview。
- Evidence: `output/playwright/native-dom-electron/results/electron-workbench-tabs-El-d7fb3-in-the-existing-project-tab/version-history-projection.png` 和同目录 `version-current-projection.png`。
- 核对：历史标签与左侧 V1 选中一致，顶部预览选中、编辑禁用；返回后仍为 V3 工作文件。历史读取失败保持当前视图并可继续切换项目。
- 修复及复核：初轮截图发现布局仍使用后台编辑模式，预览高度仅 150px；统一展示模式后复拍，完整预览可见，增加大于 400px 的真实窗口尺寸断言。
- 本 PR 不改变旧继续编辑入口；新建版本事务与入口分别由 E、F 接续。
- final result: passed（独立历史预览与既有视觉语言）。

## 2026-09-08 — F：历史创建、文件对象与结果恢复

- Truth: 用户 D/E/F 历史闭环；沿用既有确认弹窗、导航提示、侧栏与标签视觉语言。
- Evidence: Electron `@smoke-version-display`：V1～V8 查看 V3，取消确认无建版；历史导出实际字节等于 V3；丢创建回执和新稿加载失败后仍只产生 V9；打开、编辑保存并重启恢复。截图 `output/playwright/native-dom-electron/results/electron-workbench-tabs-El-d7fb3-in-the-existing-project-tab/history-created-v9.png`。
- 视觉核对：V9 侧栏选中、标签 V9、顶部编辑选中，真实原位文字修改可见；历史的编辑按钮只打开确认。成功打开清除前次打开失败提示。
- 验证边界：合成页面含抛错作者脚本，本场景验证静态内容仍可编辑、保存、重启。严格动态 Runtime 探针曾报告未推进到新来源的运行帧；不将本场景通过计作动态脚本运行成功，也不扩展重写 Runtime。
- P2 / 待核对：同标签切换到含抛错脚本的新稿后，Runtime 的 ready / last-known-good 元数据与静态可编辑内容并不同时推进。记录单独调查，当前完整 HTML 与保存目标通过字节验收。
- 创建提交前 aborted 的可见准备 HTML 保留策略沿用 E，清理不纳入 F。

### F 合并前恢复生命周期复核

- 四条真实 Electron 历史回归通过：原有丢回执/打开失败/编辑保存场景，以及 pending、合法 rename、后续 V10 superseded 三种重启组合。
- 三种重启后均确认可再次进入历史创建确认并取消；V10 再次普通重启不指定启动文件，旧 V9 回执仍缺少 openedAt，也不会出现旧恢复入口。
- V10 使用 Repository 的真实 Candidate/Promotion 链路生成；本组不冒充完整 AI 用户交互或动态 Runtime 验证。无视觉语言改动。

## 2026-09-08 — Stemmio trusted loop PR-6 sidebar integration

Synthetic Qoder Electron execution reached a validated Candidate and Review. The sidebar now keeps current decisions outside the scrolling history; 340/400/480 CSS-pixel layout assertions and screenshots passed. Exact test widths are set through the layout variable, independently of drag interaction. Inspected the 340px screenshot and tightened repeated system-message metadata; history starts at the top and retains the submitted requirement and service label.

Evidence: `output/design-qa/ai-assistant-redesign/trusted-loop-pr6-ready-{340,400,480}.png`, `qoder-processing-thinking.png`; scenario `Qoder ACP Agent Bridge streams public execution text without clipboard or automatic adoption`.

Remaining: full 200% zoom, long-history keyboard/scroll matrix, real accounts, and final adoption layout in PR-7/PR-8. This entry does not certify those paths. Continuous resize was timing-sensitive in the combined test and remains a separate check.

## 2026-09-08 — Trusted loop revision: compact, recoverable Turn history

- Visual truth: the existing four-region sidebar and the reviewed requirement → public summary → result → decision reading order. Per-stage articles are superseded by a native, default-closed “查看处理记录” disclosure.
- Verified in the current rebuilt Electron renderer with synthetic Qoder: sealed public narration appears once, eight stage facts are collapsed, expansion reveals all retained facts, and current actions remain outside the scroll region at 340/400/480 CSS px.
- Inspected `output/design-qa/ai-assistant-redesign/trusted-loop-pr6-ready-340.png`; summary, result and disclosure are readable, with existing typography, tokens and controls. The existing processing capture and `trusted-loop-process-expanded.png` preserve the before/expanded context. Native disclosure provides keyboard focus and activation without new motion.
- CI desktop feedback and formal AI evidence now upload `output/design-qa` on success as well as failure. Generated screenshots remain outside source control. Long-history/200% and adoption uncertainty evidence are integrated in PR-8; this entry does not certify real accounts.
- final result: passed (focused compact history and three supported widths).

## 2026-09-08 — Trusted loop revision: truthful pending adoption

- Visual truth: existing Review and fixed sidebar actions, with the reviewed “正在采用 / 采用结果待确认” distinction above Review's normal decision state.
- A rebuilt Electron scenario commits the real synthetic Candidate, holds the first reply, loses two replies, and later restores transport. Inspected `trusted-loop-adoption-unknown.png`: the pending status is visible and no opposite action is offered; the adopted history fact is supplied by the actual persisted Promotion, not a guessed frontend success.
- The scenario verifies the same decision payload on every reconciliation, one successful source publication, and exactly one adopted history result after restarting the application. Screenshots: `output/design-qa/ai-assistant-redesign/trusted-loop-{adopting,adoption-unknown,adopted-restarted}.png`; CI uploads the synthetic captures.
- Existing typography, neutral colors, Review controls and focus treatment are retained. Native disabled controls prevent double submission; transient status is not a new durable authority.
- final result: passed (actual backend receipt-loss and restart scenario).

## 2026-09-08 — Known Codex incompatibility recovery

- Rebuilt Electron Settings and sidebar fixtures verify that the known execution-contract incompatibility preserves the logged-in account and offers “使用其他 AI” plus a secondary recheck. The install endpoint is never called.
- Inspected `output/design-qa/agent-setup-journeys/codex-execution-unsupported-sidebar.png`; the explanation, alternative-service action and return control fit the existing repair card. Settings evidence is `codex-execution-unsupported-settings.png`. CI retains these captures.
- The focused two-surface scenario passed in 2.2 seconds. This is synthetic recovery UI evidence, not successful real Codex execution; the restricted finalizer compatibility blocker remains open.

## 2026-09-09 — AI settings and working Codex execution

- Truth: user screenshots request Settings-owned installation/diagnostics, a quiet connection overview, three fixed DeepSeek models, and removal of internal preference-save banners.
- Rebuilt source Electron: inspected `output/design-qa/ai-settings-real/settings-overview.png` and `codex-connected.png`. Three compact service rows show names and status; technical diagnostics stay collapsed at the bottom of the expanded service. The task sidebar contains no setup panel.
- Real authenticated Codex, no mocked provider: clicked service selection, submitted a synthetic page comment, received a validated Candidate and opened Review. `codex-review.png` shows the changed heading; original and Working Copy bytes remain unchanged. `result.json` records the real-account boundary. This supersedes the earlier real-Codex blocker; it is separate from synthetic recovery tests.
- Actual preference JSON contains both the default Codex service and the document selection, with no invalid-record or selection-not-saved banner. Isolated test data and screenshots remain outside source control.
- Fixed DeepSeek model IDs and limits match the vendor's current [Models & Pricing documentation](https://api-docs.deepseek.com/quick_start/pricing/); Vision remains visibly marked experimental. Existing Electron journeys cover switching all three choices, persistence and restart.
- Evidence applies to the rebuilt test application; no installed application replacement or package release is implied.
- final result: passed (visual inspection and real Codex Review; deterministic gate evidence is recorded separately).

## 2026-09-09 — Conversation progress feed and next-round draft

- Visual truth: the user's Stemmio sidebar screenshots and Codex conversation reference (private source images excluded from Git). The reference sets reading rhythm, not Codex branding or green accents; existing Stemmio tokens and Phosphor icons remain authoritative.
- Scope: signed Stemmio progress with default-visible chronological records, right-aligned user message, public Agent updates before the live tail status, one Review decision surface at a time, and a bottom-aligned persistent draft field.
- Acceptance: 340/400/480px sidebar, no horizontal overflow, no duplicate adoption buttons, visible draft with keyboard focus and native composition, scroll following and user scrollback, readable timestamps, real Electron captures using synthetic files only.
- Evidence: existing AI setup journey and provider acceptance captures under `output/`; root visual review follows the frozen task gate.
- Reviewed: Electron captures `output/design-qa/agent-setup-journeys/narrow-sidebar-generating.png` and `output/design-qa/ai-assistant-redesign/trusted-loop-pr6-ready-{340,400,480}.png`; signed/default-visible progress, right-aligned user identity, readable wrapping, focus ring, docked actions/draft, and scrollback affordance match the scoped reference. Existing indigo tokens and Phosphor assets remain consistent.
- Review full-page capture initially preceded iframe paint; the capture now waits for both synthetic review documents to be visible. The narrow sidebar's behavioral assertions (one adoption button, adjacent action/draft geometry and draft recovery after restart) already passed; final full-scene capture is recorded with the final task gate.
- Follow-up P2: live elapsed status is still repeated in the bottom Stop area; kept outside this request's button/stream scope. Historical public text is a bounded sealed summary, and legacy HTML-only services cannot supply public narration.
- final result: passed for the sidebar scope; complete task-gate evidence is required before delivery.

## 2026-09-09 — Editing continuity and compact conversation dock

- Visual truth: user-supplied screenshots; decisions are narrower than the input, with a translucent background and a light border. Existing Stemmio typography, indigo and icons remain in use. Private screenshots and source documents are excluded from Git.
- Implementation: compact comment footer; one bottom composer with Settings-owned Agent/model choices; attached decision layer; executor-owned process rows; sentence-separated public narration; metadata revealed on hover or keyboard focus.
- Real rebuilt Electron QA: Qoder synthetic execution through Candidate/Review, 340/400/480px sidebars, 200% zoom, scrollback, hover metadata, and decision/input geometry pass. Inspected `output/design-qa/ai-assistant-redesign/trusted-loop-pr6-ready-400.png` and `trusted-loop-process-expanded.png`.
- Runtime QA: repeated bold/underline keeps the active chart intact; delayed chart preparation retains the previous frame; failed initialization retains the usable older preview with reload/export. Real ECharts initialized in a hidden tab survives two edit/promotion cycles after restoring the tab before author activation.
- A private isolated copy of the reported document also passed three rounds of bold, underline and editing completion. Both reported charts retained nonzero geometry and painted pixels. The original file was not modified, and private evidence remains outside source control.
- Baseline contrast: the two chart continuity/failure regressions fail against the original editor and pass against the changed editor. Runtime surface checks establish visible surface continuity, not completion of arbitrary author scripts or animations.
- Evidence applies to source Electron launched with isolated profiles; no installed app replacement or release is implied. Task-level gate results are recorded separately by the existing runner.

- Recovery follow-through: a real Electron regression exposed a reload click arriving before autosave acknowledgement. Retry now joins the existing save flight, shows pending feedback and verifies the same document/canvas afterward. Electron recovery passes; controller negative cases cover save failure and document switching during the wait.

## 2026-09-09 — Stemmio Product Design System V1 试跑

- Scope：新增设计体系、审阅协议、历史设计倾向与仓库 Skill 路由；不修改产品运行代码。
- Product source：`d6137b76c2fa6de7ac6f20a00dbc7dc58015398a`；隔离 Electron、合成 HTML 与 finalizer fixture。
- Evidence：`output/design-qa/design-system/pilot-review.md`；既有 `ai-review-adoption.spec.mjs` 首用例
  两次运行分别 1/1 passed（20.6s / 17.0s），零失败、跳过、flaky；第二次只为补 trace，不是失败重试。
- 自动断言覆盖：评论提交、等待、Candidate 尚未采用、Review、明确采纳后的持久化与版本一致、
  预览返回，以及新建项目入口。首个项目由 fixture 打开；不是完整首次使用或真实厂商验收。
- 边界：成功 trace 未捕获 Electron 截图，未完成视觉审阅；拒绝、故障恢复、空态、重启与真实厂商调用未验证。
- SD-001 / CONTRACT-CONFLICT，P2、高置信：DESIGN_LANGUAGE §2.2 的红绿变化禁用与
  INTERACTION_FLOW §8.3 的文字删除红/新增绿规则冲突。记录待明确，不当成已重现的产品 bug，不扩大本次改动。
- final result: partial（主链路自动断言通过；完整视觉/异常状态审计未完成）。


## 2026-09-09 — Source-owned editing and truthful reload recovery

- Mode: DESIGN CHANGE. Visual truth is the user's compact purple top-center status capsule; the previous yellow editable-static banner is explicitly superseded. Existing Stemmio colors, typography and native controls remain authoritative.
- Frozen acceptance version: HEAD `1b7f4216495866015c6187ec0c37220026eb45c3`, base `44c636f329ea7d8e6a88c6c9668f554f874a0669`, working diff SHA-256 `91db8ddddf729e26cad150c577576f3be1491649c9c79ea7a531fb3c0fa88497`. The QA entry is the only subsequent source change before the final task gate.
- Real source Electron acceptance used isolated copies of all eight user-designated HTML files and isolated managed projects/profiles: every file passed 15 recorded steps (two formatting/input/save/history/reentry rounds, preview/edit, reload/reentry and reopening the same managed project). All original hashes remained unchanged. Private files, names, paths, screenshots and logs stay outside Git; the local acceptance runner emits their report locations.
- The reported chart document additionally passed two rounds of bold/italic/underline without replacing the active iframe, composition-event handling, subsequent text input/save, and reentry into an original inline element. Both charts retained nonzero geometry and painted pixels. Injected failure of future chart frames preserved the previous visible preview and exposed reload/export; successful reload restored both charts, editing and subsequent persisted input. Animation completion of arbitrary author scripts is not inferred from the pixel readiness check.
- Visually inspected the private corpus `accepted.png` plus chart `recoverable-failure-toast.png` and `reload-success-toast.png`: compact centered purple notification, readable recovery explanation and actions, preserved page context; successful editable static states have no yellow banner. Success wording is “页面已重新加载，可以继续编辑” only after a fresh verified projection and edit-lock release.
- Deterministic Electron coverage additionally checks source-owned snapshots versus forged author clones, repeated dynamic/static failure recovery, promoted-frame keyboard focus, rapid Undo/Redo, actual selected-character format state, equivalent numeric style requests, and editing a published Undo projection while its real save request waits. Node coverage rejects an old Undo when newer input arrives during its initial drain, and rejects queued history after route/receipt or independent-edit changes.
- Evidence boundary: rebuilt source Electron, not a replacement of the installed application; composition events do not certify every physical OS input method. Standard-width visual inspection is complete; dedicated narrow-window/200% recovery-toast inspection was not run. Independent notification owners can still overlap when unrelated notices arrive together (P2 follow-up); the generic corpus runner checks edit continuity, while deterministic tests check specific resulting styles.
- Result: passed for the described real-document flow and inspected visual states. Final task-gate version and results are recorded separately by the existing runner; this entry does not certify every application path.

- Draft CI follow-through: the forged-clone negative test originally injected into the retiring frame between Escape and deferred runtime promotion. CI retained the timeout/trace showing the clone being detached. The test now waits for a different active frame generation, retirement of the old document into the persistent empty inactive slot, and verified rendering before injection; no product behavior or assertion is relaxed. The focused Electron scenario passes. Real-corpus evidence remains applicable because product source is unchanged. Final updated-head gate evidence is recorded separately.

- The first synchronization correction incorrectly required the transient `active` handoff marker to remain present; the next task gate caught its normal cleanup. That failed trace is retained. Acceptance now observes the retired document being cleared from its persistent slot and the new projection being verified, preserving the original clone-authority assertions.

- CI run `34343278550` caught the incorrect assumption that an inactive physical slot disappears: this renderer intentionally keeps two iframe slots. The corrected synchronization requires the old slot to reach `inactive` (one empty spare slot), after its `previous` role retires, plus a new active generation and verified rendering. Product source and the actual forged-node rejection assertions remain unchanged; both CI failures are retained.

- CI run `34344638081` passed all 57 Electron cases, then exposed a separate Review test-script issue. Its trace shows three clicks on the same region bar while asynchronous projection settles; repeated clicks intentionally toggle the active group off. The geometry helper now activates the group once and waits for its explicit focus state, completed transition, counts and unchanged geometry tolerance. This preserves the physical click and exact geometry oracle without retrying a toggle action or changing product behavior.

## 2026-09-10 — Agent completion truth and chronological live status

- Mode: AI EXPERIENCE. The user screenshot and persisted execution record establish the reported truth: a verified Candidate must remain successful even when ACP process teardown is unconfirmed, and live Agent status must read as part of the current Agent message rather than a second Stemmio row pinned below it.
- Provider boundary: Qoder and Codex share the ACP coordinator and verified-completion contract; the source-owned HTTP Agent shares the same conversation renderer. Partial or unverified output still fails closed, and uncertain process cleanup keeps the execution fence even after the verified Candidate proceeds to Review.
- Rebuilt source Electron acceptance passed the existing Qoder ACP and DeepSeek closed-loop scenarios (2/2, 34.7s). Inspected `output/design-qa/ai-assistant-redesign/qoder-processing-thinking.png` and `output/design-qa/agent-setup-journeys/narrow-sidebar-generating.png`: Stemmio facts precede the Agent message, while Agent name, public narration, waiting state, elapsed timer and received bytes occupy one chronological message at the bottom. The separate live Stemmio progress row is absent during execution.
- Automated regressions cover verified Candidate plus cleanup rejection, cleanup precedence over partial residue, interleaved actor chronology, and the shared Qoder/DeepSeek Electron presentation. This is isolated rebuilt-app evidence; it does not claim a live vendor-account teardown failure was induced.
- Result: passed for completion classification and shared chronological live-status presentation; final task-gate evidence is recorded separately by the existing runner.

## 2026-09-10 — Ordinary Runtime edits end in place

- Mode: BEHAVIOR CHANGE. Successful ordinary text and common-format synchronization is now the end of that operation: Escape, target changes, selection clearing, waiting and ordinary save do not schedule a later Runtime rebuild. Existing double-frame recovery, source identity, stale-candidate rejection, program changes, structure edits, explicit reload and synchronization failure remain rebuild boundaries.
- Quiet-first result: no new control, banner or success message was added to the high-frequency edit path. The existing reload action now remains the explicit recovery boundary, and only reports “页面已重新加载，可以继续编辑” after a verified editable projection.
- All eight configured real HTML documents passed from read-only originals through isolated copies and profiles. Each file exercised at least three different text hosts and two duplicate/delete cycles; the matrix included repeated input, eight consecutive spaces, selection deletion, Undo/Redo, repeated bold/italic/underline, save, selection clearing, wait, Preview/Edit, source reload and managed-project reopen. Across 24 ordinary edit boundary checks, the active Document and generation remained unchanged, no pending refresh was created, and no deferred candidate appeared. All original hashes remained unchanged; private filenames, paths, screenshots and reports are excluded from Git.
- Focused Electron coverage additionally verifies author-script execution counts, visible chart continuity, hidden authored tabs, stale clone rejection, necessary dynamic/static recovery, repeated reload, and the inline-flex refusal boundary. When a wrapper-producing format is unsafe for an inline-flex/grid text host, the format remains rejected but the native edit session resumes with its selection, so immediate continued typing works without a second click.
- Visible Computer Use acceptance used a private isolated copy of the complex corpus document. Real mouse/keyboard actions edited four separated targets, entered consecutive-space text, repeatedly toggled bold/italic/underline, used Undo/Redo and save, changed targets, duplicated an element, triggered the inline-flex format refusal and continued typing without re-entry, then invoked More → Reload current HTML and edited the bottom heading again. The final screen remained editable with no lock/recovery banner. Element deletion is covered by the corpus runner's real mouse click in every file; the visible pass did not delete through macOS UI.
- Evidence boundary: rebuilt source Electron, not an installed-app replacement. The corpus runner uses Playwright mouse/keyboard events for interaction; DOM evaluation is discovery and oracle only. Exact task-gate evidence is recorded separately after this entry.
- Result: passed for the scoped continuity, recovery and real-document behaviors.

## 2026-09-10 — Review facts and paint plan separation

- Truth: the user-approved Review plan. Source facts, navigation, context masking and optional outlines are separate decisions: a change does not imply a box, and focus does not require a border.
- Rebuilt Electron evidence: `output/design-qa/review-focus-overview.png`, `review-focus-paragraph-{1,2}.png`, `review-focus-css-grid.png`, `review-focus-one-sided.png`. Overview keeps exact red/green evidence and edge navigation with zero masks and zero outlines. Text focus reveals one local reading region through the context mask and keeps zero text boxes. Source-owned structure may use one local outline; a missing side paints none.
- Interaction evidence: first entry navigates without activating focus; exact-position directory selection, repeated selection, explicit Escape, comment priority, filters, zoom/resize, assistant collapse/reopen, confirmation, document-tab round trip and per-document Review restoration pass in the focused Electron scenarios. “从磁盘重新载入 HTML” remains visible but disabled while a result is pending; “刷新本页面” preserves the Review snapshot.
- Settings evidence: Review context preferences default to 25% for changes and 15% for comments, persist through the validated preload/main boundary, and restore independently from the toolbar. The existing Settings Electron route verifies persistence, reset and restart behavior.
- Visual inspection: author content remains legible inside the active mask hole; exact evidence stays visible without nested phrase/line/paragraph rectangles; dense markers collapse into quiet edge clusters while the directory retains exact positions. Existing Stemmio typography, neutral chrome and indigo action hierarchy remain unchanged.
- Boundary: screenshots use isolated synthetic Review fixtures and certify the described paint and interaction states, not arbitrary author-script animation or installed-app behavior. Full real-HTML continuity and the task-level gate are recorded by their dedicated reports.
- final result: passed for the focused Review design and interaction scope.

### Follow-through: region-local proof, navigation and comment dismissal

- Mode: DESIGN CHANGE + AI EXPERIENCE LENS. Truth is the independent review supplied for this PR: semantic change detection, navigation, masking and visible outlines must remain separate decisions; one region may never borrow another region's visual verdict.
- Rebuilt source Electron evidence: `output/design-qa/ai-review-comment.png`. The inspected frame shows the intrinsic-width white comment bubble anchored to the indigo marker, fully readable inside the left Review pane without clipping or introducing a second emphasis color. Hover can cross the marker-to-bubble gap, pointer click dismisses instead of pinning focus, and Escape dismisses comments before the existing Review focus.
- Browser geometry evidence covers tall `tbody`, `ul` and `section` owners. Each keeps full authored geometry for navigation and the context mask while emitting zero focus outlines; the implementation does not crop or promote a substitute target. Short targets center and tall targets expose their authored beginning.
- Deterministic state evidence requires a style outline to own the current region's exact Stable ID, pure-style source candidate and current `changed` visual verdict. Changed evidence in region A cannot authorize unchanged or unverified region B. Per-tab recovery restores each Review identity, filter, zoom and positions independently; identity mismatch and stale focus/navigation IDs fail closed.
- Directory locations now expose side plus a short content cue, mark the current location, close on selection or Escape and restore focus to the summary. Initial navigation commits only after every expected side acknowledges a locatable target, falls through on failure and cancels on trusted user input without activating a visual focus border.
- The proposed timed 1.8-second related-comment hint remains deliberately deferred: no reliable comment-to-change semantic relation exists yet, so the product does not manufacture one from proximity. This is documented behavior, not a hidden timer omission.
- Focused automated checks and the captured Electron journey pass. Full task-gate and real-HTML evidence remain owned by their dedicated reports and are not inferred from this focused visual inspection.

## 2026-09-10 — Ordinary Runtime edits end in place

- Mode: BEHAVIOR CHANGE. Successful ordinary text and common-format synchronization is now the end of that operation: Escape, target changes, selection clearing, waiting and ordinary save do not schedule a later Runtime rebuild. Existing double-frame recovery, source identity, stale-candidate rejection, program changes, structure edits, explicit reload and synchronization failure remain rebuild boundaries.
- Quiet-first result: no new control, banner or success message was added to the high-frequency edit path. The existing reload action now remains the explicit recovery boundary, and only reports “页面已重新加载，可以继续编辑” after a verified editable projection.
- All eight configured real HTML documents passed from read-only originals through isolated copies and profiles. Each file exercised at least three different text hosts and two duplicate/delete cycles; the matrix included repeated input, eight consecutive spaces, selection deletion, Undo/Redo, repeated bold/italic/underline, save, selection clearing, wait, Preview/Edit, source reload and managed-project reopen. Across 24 ordinary edit boundary checks, the active Document and generation remained unchanged, no pending refresh was created, and no deferred candidate appeared. All original hashes remained unchanged; private filenames, paths, screenshots and reports are excluded from Git.
- Focused Electron coverage additionally verifies author-script execution counts, visible chart continuity, hidden authored tabs, stale clone rejection, necessary dynamic/static recovery, repeated reload, and the inline-flex refusal boundary. When a wrapper-producing format is unsafe for an inline-flex/grid text host, the format remains rejected but the native edit session resumes with its selection, so immediate continued typing works without a second click.
- Visible Computer Use acceptance used a private isolated copy of the complex corpus document. Real mouse/keyboard actions edited four separated targets, entered consecutive-space text, repeatedly toggled bold/italic/underline, used Undo/Redo and save, changed targets, duplicated an element, triggered the inline-flex format refusal and continued typing without re-entry, then invoked More → Reload current HTML and edited the bottom heading again. The final screen remained editable with no lock/recovery banner. Element deletion is covered by the corpus runner's real mouse click in every file; the visible pass did not delete through macOS UI.
- Evidence boundary: rebuilt source Electron, not an installed-app replacement. The corpus runner uses Playwright mouse/keyboard events for interaction; DOM evaluation is discovery and oracle only. Exact task-gate evidence is recorded separately after this entry.
- Result: passed for the scoped continuity, recovery and real-document behaviors.

## 2026-09-11 — Runtime edit and element-copy capability boundary

- Mode: DESIGN CHANGE. The visible change reuses the existing selection toolbar: a copy action that is known to be unsupported is absent, while a temporarily unavailable copy action keeps the same button in its existing disabled treatment. No new banner, dialog, recovery flow, color, icon or notification is introduced.
- Capability truth is selection-local. A Runtime-generated chart/table descendant and any selected parent containing it keep the comment entry but expose no executable element-copy action. An independent, unchanged source-backed subtree on the same chart-heavy page remains copyable; delete and move keep their existing boundaries. Ordinary text copy and complete-HTML save/export are unchanged.
- Focused rebuilt-source Electron checks cover the generated-descendant host, a retained reference to the formerly visible copy button, an independent safe source block, overlapping edits, a slow but already valid Candidate, stale-candidate rejection, and chart continuity around normal source content. The corresponding Node policy/capability checks also pass; final task-gate evidence is owned by the existing runner.
- Evidence boundary: these are isolated synthetic fixtures in rebuilt source Electron, not an installed-app replacement or proof for arbitrary web applications. The change conditionally removes one existing toolbar item and adds no new geometry, so no separate pixel-design artifact is claimed.
- Result: passed for the scoped copy availability and Runtime continuity behavior; full task-level verification remains separate.
