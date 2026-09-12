# Architecture

PageRoot is an Electron application with a React renderer and a local Bridge process.

```text
User HTML bytes
  -> SourceIndex / TargetResolver
  -> isolated authored-DOM preview
  -> native Selection + IslandEditingController
  -> canonical editable island (non-inline descendants stay frozen atoms)
  -> semantic operation foundation or current exact content SourcePatch
  -> renderer SourceHistorySession + normal complete-HTML autosave
  -> serialized atomic file writer

Comments + frozen input
  -> Change Request / Attempt
  -> Agent Bridge provider registry (源页 HTTP Agent, Qoder/Codex ACP, or clipboard fallback)
  -> completion + candidate health/continuity assessment
  -> immutable Version
  -> explicit user-controlled activation
```

The product Agent Bridge is Bridge-owned and never owns Request, Candidate,
Version or Working Copy state. A user may explicitly choose 源页 Agent (user
Token, OpenAI-compatible HTTPS), a managed Qoder or Codex ACP session, or the
existing clipboard fallback. Internally, current execution binds by canonical
provider/runtime selection. Historical `mode: "qoder-acp"` Request records are
projected to the `qoder` provider and shared `acp` runtime at the delivery
codec; Codex uses the same runtime with `providerId: "codex"`; 源页 Agent uses `pageroot` /
`http`, with model and thinking-depth choice on the conversation sidebar.
Unknown providers and runtimes fail closed. The packaged application
contains no private Codex runtime or native Codex package; Codex is resolved
through the managed ACP catalog. Renderer
`AgentCatalogState` owns provider-keyed availability, `enabled`, the current
access operation, the canonical selected selection and selection-keyed
preflight cache. `RunWorkflow` exposes the same
projection to the delivery surface and Settings. Settings calls the separate
side-effect-free `diagnose` route: providers may verify installation, login or
bounded protocol/service facts, but diagnosis never creates a ticket or Agent
session and never resolves a different model. Its four public dimensions are
installation, authentication, protocol and service; weaker Settings evidence
cannot overwrite a stronger preflight/use failure. An explicit disconnect
(`enabled=false`) also cannot be overwritten by a later ready diagnose. Only
the send path performs the complete use-time preflight and freezes its one-use
ticket. The ACP runtime then starts
only a Request whose durable `agentDelivery` record authorizes the trusted-local
policy. ACP progress is presentation evidence only: only the official finalizer
plus Repository validation can create a pending-review Candidate, and only an
explicit user action can promote it. The ACP allowlist is not an OS sandbox;
see ADR 0032. ADR 0039 defines the provider/runtime boundary; ADR 0056 remains
the historical synthetic-spike decision.

## Boundaries

- `docs/ARCHITECTURE_MAP.md` is the default capability map (owners and
  entry files). `docs/ARCHITECTURE_CONTRACT.md` is the normative dependency,
  state-ownership, asynchronous outcome and drain contract.
  `docs/STATE_OWNERSHIP.md` names the sole owner of each mutable fact.
  `docs/GUARD_LEDGER.md` records user-visible blocks and their defense class.
- `app/` owns the visual workbench, source mapping and direct-edit transaction model.
- `desktop/` owns privileged filesystem access, windows, lifecycle, update checks, usage telemetry and safe IPC exposure.
- `bridge/` owns the local Bridge, protocol finalization, AI candidate assessment and packaged runtime modules.
- `scripts/` owns automated gates, packaging, CLI and developer spikes.
- `schemas/` defines persisted and exchanged records. `fixtures/` proves strict current and legacy behavior.
- Preview DOM is disposable. It is never a persistence source.
- Current-source and generated-Version changes use prepare-then-publish: all
  project/document identities, canonical path, Version state, HTML bytes and
  Hash are validated before one synchronous renderer publication. No async
  query may expose a new path or Hash beside old Document bytes.
- `DocumentSession` advances one Canvas authority generation whenever the
  authoritative bytes/view are replaced. Edit and preview readiness are
  disposable acknowledgements tagged by that generation and the rendered
  source Hash; stale acknowledgements are ignored. “Safely saved” additionally
  requires the visible surface acknowledgement to match the persisted source.
- A clean projection mismatch is repaired automatically by one authoritative
  source reread and one bounded Canvas rebuild. Failure stays fail-closed and
  never asks the user to reconcile internal Hash state manually.
- Pure-browser preview is a supported read-only route. It may run authored page interactions inside the sandbox, but it exposes no PageRoot edit, comment, attachment, project-write, or AI-submit authority.
- Desktop interactive preview uses a short-lived `pageroot-preview:` document
  instead of `srcdoc`, so the authored page does not inherit the renderer's
  `script-src 'self'` policy. The main process owns the volatile session and
  serves only its prepared HTML, its fixed bootstrap and a session-specific
  manifest of declared relative assets beside the known source HTML. It never
  turns the source directory into a general-purpose local-file origin. A
  direct-frame authored navigation is canceled. If it occurs before the first
  load completes, that session becomes a one-way, stricter-CSP scriptless
  fallback retaining only the owned bootstrap, then reloads the same frame;
  attempts after load leave the current document intact.
- Preview-to-edit carries only a bounded `PageViewContext`: source-backed
  active/inactive class transitions and `hidden`, `open`, `aria-selected` or
  `aria-expanded` state. It never carries runtime DOM, pixels or table markup.
- On desktop, a clean persisted document with a supported executable `script`
  program may receive one Main-authorized resource closure. The visible Edit
  iframe parses source with author scripts inert, proves the complete parser-
  authored object set, then activates those scripts in source order; PageRoot does not
  wait for arbitrary script completion, freeze activity or audit Runtime DOM against source.
  Same-origin `window.parent` access, including renderer-exposed preload APIs,
  remains the accepted in-place-editing cost. Unsupported programs fail closed
  to static Edit. Reviewed 5.4.3 and 5.6.0 core CDN mappings render from their
  respective same-version SHA-pinned packaged files; other immutable versions
  use only exact cache/network bytes. No cross-version substitution or recovery
  session exists. Resource failures reject the Candidate; noncritical author
  errors may keep a critical-content-ready page as an explicit partial Runtime.
  Structural or author-program changes that cannot be proven in place rebuild
  the disposable iframe and rerun the author program; successful ordinary text,
  common-style and same-parent reorder projections end in the mounted document.
  Generated descendants are display-only
  and map to the nearest still-proven authored source host for comments. Runtime
  DOM has no persistence authority and Edit screenshot/capture/projection count
  remains 0.
- Review is static source-diff only. It reads the frozen before/after HTML and
  emits bounded text facts plus stable-ID movement/attribute/inline-style/
  CSS/Script source facts and outermost element-presence facts. Scripts are not
  executed to derive facts; pixels, computed style, Canvas/SVG runtime output,
  PNGs and a Review runtime owner do not participate. Runtime descendants remain display-only preview
  state and never enter SourcePatch, save, Version, Review analysis or AI
  Request input.
- Comment selection remains Stable-ID exact inside foreign content. Authored
  SVG children retain their own SourceIndex identity; runtime-only
  children fail closed and are never promoted to an ancestor `svg`.
- Comment-rail coordinates are a disposable Canvas measurement projection.
  Every snapshot is tagged with the rendered source Hash, the generation of
  the `PageViewContext` actually applied to the edit document and the exact
  sorted target-ID set. The same snapshot owns fresh source resolution,
  visible/hidden/missing presentation status, coordinates, marker eligibility
  and the authored document's natural content height. Workbench renders cards
  only after that complete snapshot is current; one missing coordinate degrades
  only its owning item and is not permission to use saved geometry or a page-end
  fallback. That natural Canvas height also owns the comment rail's fixed bottom:
  a longer comment queue is clipped and translated inside the rail instead of
  feeding height back into the Grid or shared page. Iframe viewport height is
  never fed back as authored content height. Each visible card is measured
  against a signature of every height-changing state (content, attachments,
  edit/delete/relink controls and target recovery). A DOM or size change
  invalidates the old measurement before layout; absolute `top` is applied
  without interpolation so two cards never animate through one another.
- In edit mode, the iframe root (`html` and `body`) never owns vertical page
  scrolling. The shared `.review-scroll-stage` is the sole page-level vertical
  scroll owner, so a root scrollbar cannot change the authored viewport width
  and feed a Canvas measurement back into layout. This is an injected editor
  policy only; authored nested `overflow: auto` containers retain their own
  scrolling behavior.
- Edit-mode presentation actions reuse that same context. A pure allowlist
  resolver recognizes strict source-backed ARIA Tabs, native details and local
  disclosures; one Canvas executor applies the accepted context. It never
  invokes authored handlers, serializes the preview DOM or creates a second
  interaction mode.
- Formal AI review owns one disposable reducer with independent page, change
  filter, context visibility, navigation, active focus-group, canonical presentation path, scroll
  and zoom fields. Warning-only impact counts come from the bounded Candidate
  assessment; historical Version full-array impact is projected at
  `candidateAssessmentFromRecord` and is not reinterpreted in the Review
  display. A cancellable, byte-bounded `ReviewAnalysisSession` yields
  between parse/control/pair/annotation/serialization phases and after bounded
  semantic row/list-item batches, then caches source-diff facts for the exact
  before/after HTML, source path and bootstrap mode. Comment text, comment
  anchors, the current Review `sessionId` and Frame geometry stay out of that
  cache key. A hit still rebinds comments and stamps the current session onto
  the disposable projection; the cache is not adoption authority and never
  reuses a previous session's Document, Element, runtime geometry or Frame.
  The 32 MiB bound covers the source-fact cache only. The document analyzer first builds a hierarchy of semantic
  units (`direct-flow`/`br-line`, list/list item, table/row group/row/cell,
  leaf text owner and atomic non-text content such as media, controls and
  foreign-namespace graphics), then aligns only siblings of an already-paired
  parent.
  `review-semantic-alignment` is the pure, bounded alignment helper: it consumes
  only unique explicit stable identities and exact-equality signatures first,
  cuts remaining intervals on those anchors, then uses a weighted monotonic
  alignment or a finite-lookahead fallback. Stable identity, exact equality and
  self compatibility are separate facts: an exact subtree can skip an unchanged
  branch but can never replace the identity of a paired container. Analysis-local
  `WeakMap` signatures describe stable identity, own non-presentation
  compatibility and exact subtree equality; empty Canvas/SVG/media/control and
  empty-container units may enter weighted matching only when that own
  compatibility agrees under the same paired parent. Repeated, low-confidence
  and ambiguous candidates remain unmatched; it never promotes tag, class,
  position or geometric proximity into a change fact.
  The shared pair graph derives copy, structure and visual facts once, and only
  then emits a typed canonical fact list. One prepared element may carry more
  than one independent fact (for example, a box-style change and a layout
  change), each with its own fact identity, disposable semantic owner and
  geometry owner. Facts never merge merely because they share an element or
  are geometrically close; final projection rectangles require the same fact
  and owners, except for the explicit structural-owner dominance rule. Neither
  identity is persisted, sent over IPC, or available to comments. The
  trusted analyzer fails explicitly rather than silently discarding a 25th
  distinct fact for one element; untrusted serialized input remains bounded by
  the 24-fact/12,000-byte parser limit and fails closed when it exceeds it.
  ready-review session prepares that immutable document pair from cached source
  facts plus the current comment set and session before the React review
  surface mounts; rerenders reuse the projected pair, and comment-only changes
  rebind without rerunning the HTML diff. The analyzer compares only frozen
  HTML: text uses bounded evidence ranges and semantic pairing; unique valid
  stable IDs strongly pair elements and provide movement, authored attribute,
  inline-style and CSS/Script source facts; element presence emits only the
  outermost unmatched subtree. Legacy no-ID inputs retain bounded semantic
  pairing. CSS impact, layout, computed style and runtime-discovered nodes do
  not become Review facts. The projection layer keeps its geometry and mask records
  disposable, and the initial private bootstrap is used only for exact
  before-side comment targeting; neither capability changes the diff authority.

  Frozen comments use a separate private locator capability. Review reads
  `data-pageroot-id` already present in frozen source HTML and never writes a
  parseKey or second identity attribute onto the prepared document. For every
  source-resolved before target the analyzer keeps an opaque initial-bootstrap
  binding: the Stable ID plus a parser path and a narrow static fingerprint.
  The managed preview serves it only to the first
  parser-blocking bootstrap request, then serves an unbound fallback. The
  trusted parent subsequently delivers targets only over a challenged private
  `MessageChannel`. Comment body, key, Stable ID and locator-map data are
  absent from document bytes and later bootstrap reads. A unique source `id`,
  `data-*`, `name`, or `aria-label` is only a safe fallback; missing, ambiguous,
  replaced or disconnected targets omit the before-side marker rather than
  rebinding by guess. This comment capability does not authorize runtime host
  discovery. Only the before bootstrap reports geometry, so authored code
  cannot react to a comment marker.
  Exact leaf text ranges remain immutable evidence. Presentation is a separate,
  explicit contract: `displayScope` names the reading semantics while
  `geometryMode` independently selects text-content, element-box, container-box
  or numbered-line Range measurement; neither field enters the exact fact key.
  Paragraphs, headings, blockquotes and direct flow resolve to one complete
  reading block; simple list items/cells and components use their full element,
  complex list items/cells keep the smallest inner reading block, and numbered
  `br` lines stay separate. A simple-selector CSS source may span several
  targets; each inline-style attribute remains its own operation even when a
  sibling has the same property delta. Shared CSS facts may keep one semantic
  group, but each reading locality and concrete owner receives its own region;
  geometry, target count or distance never creates a group or promotes a parent
  container into the visible target.
  The analyzer is the sole author of bounded `ReviewFocusGroupPlan` records,
  including change-scoped exact atom keys, per-side region IDs, correlation,
  presentation, owner IDs, geometry modes and presence. The first bootstrap
  validates and privately binds that plan; Runtime resolves current owners and
  geometry but never reconstructs group membership or IDs. Exact-evidence
  occurrence bindings are validated independently, so an invalid/oversized
  semantic plan closes frames and masks without erasing red/green source facts.
  `changeId` remains navigation identity; `activeFocusGroupId` plus one explicit
  per-side region ID owns the current locality.
  Overview has no outline or dim mask. A pure paint plan keeps source evidence,
  navigation cues, context masking and focus outlines as independent channels.
  Explicit focus may create one local mask hole per side without any outline;
  text and ordinary attributes never outline, source structural changes may,
  and style outlines additionally require a confirmed visual-change verdict.
  When an outline exists it reuses its region mask path, but `maskHoles` does not
  imply `outlinePaths`. One SVG luminance mask keeps a full-page white background
  and adds the chosen region path as a black hole. Its per-render identifier is
  scoped to the review session, side and projection epoch. The disposable
  projection uses reserved attributes plus inline and static important resets,
  preventing authored `svg`/`div` rules from restyling its mask primitives or
  frames. The context layer is a masked semi-transparent white fade only:
  active holes preserve authored pixels, while the outside follows context
  visibility. Review mask primitives prohibit `filter`, `backdrop-filter` and
  `mix-blend-mode`; real backdrop blur is not part of the formal Review
  contract because Chromium may composite it before applying the SVG hole.
  Mask correctness is proved from final rendered pixels as well as DOM paths.
  Inactive regions remain navigation-only. `page-presentation-dom` is the
  shared explicit-ID and strict indexed-Tab discovery contract consumed by
  Canvas comment presentation and formal review. Before/after panel and action keys
  are assigned as pairs before either isolated document is prepared, so safe
  runtime actions mirror bidirectionally even when copy or order differs. A
  parent-owned presentation epoch removes stale projections immediately and
  commits both frames only after their new layout is stable. Frozen comments
  resolve against the immutable before source, but their text never enters the
  authored iframe. The before frame receives only an opaque target key and
  reports anonymous viewport geometry; the trusted React host joins that
  geometry to the frozen text and renders read-only hover markers above the
  before page. Linked vertical scroll follows semantic region
  progress through frame-to-frame convergence instead of a single jump;
  Scroll mode controls only scroll following. No review state or authored
  runtime mutation has source, Version or project authority.
- `IslandEditingController` is the only production text-edit engine in PageRoot 0.9.0. `contenteditable="true"` supplies focus, caret, Selection and IME composition, while the controller owns insertion, deletion, line breaks, paste and formatting. Chromium DOM serialization never has commit authority.
- `editable-island` owns the V2 capability and normalization contract. An accepted edit replaces only the selected element's parsed `contentRange`; bytes outside that range remain exact. Inside the range, parse5 may perform the smallest safe normalization needed to preserve inline semantics, comments and immutable authored atoms.
- Transparent inline host discovery records the nearest safe editable island while climbing. Nested non-inline HTML, embeds and foreign subtrees stay frozen atoms inside that island; they are never a second text engine or a disposable fragment host.
- `native-edit-policy` owns shared session attributes and checkpoint timing. `native-layout-fingerprint` records geometry and text style so `HtmlCanvasEditor` can observe post-entry drift; it does not refuse to enter an island. MutationObserver rollback and checkpoint scope remain the fail-closed safety net. The retired `nativeRuntimePreflight` / `RuntimeDomSourceMap` stack is not on the production path; `HtmlCanvasEditor` only coordinates selection, the island session and SourcePatch.

## Module map

`createRuntimeWorkspaceController()` in the Application layer is the runtime
composition root for the review workspace. It creates the one typed Bridge
client, shared `RunSession`, and remaining fact-owning Sessions, then hands
their workflows to one `WorkspaceController`. The Controller is the only
Application aggregate observer: it publishes one frozen Project/Document/
Comment/Run/Version snapshot and an event stream without copying mutable facts.
`app/workbench.tsx` is a presentation adapter: it subscribes to that aggregate,
derives visual state, supplies narrow host adapters and dispatches user intent.
It imports neither the Bridge client nor business Sessions. Pure Workbench
models hold deterministic formatting and transition helpers. Presentation
modules receive snapshots and callbacks only; they do not import application
services.

| Boundary | Owner |
| --- | --- |
| Bridge routes, timeouts and structured outcomes | `app/application/bridge-client.js` |
| Runtime Bridge/Session/workflow composition, aggregate frozen snapshot and application event stream | `createRuntimeWorkspaceController()` and `WorkspaceController` in `app/application/workspace-controller.js` |
| Desktop workbench navigation and tabs | `createRuntimeWorkspaceController()` constructs one `WorkbenchNavigationSession`, one `WorkbenchTabsSession` and one byte-bounded `DocumentSurfaceCacheSession`; `WorkspaceController` owns their `WorkbenchNavigationWorkflow`, startup arbitration, Registry reconciliation, aggregate projection and commands. The cache admits only persisted, Canvas-verified exact HTML, retains at most three script-disabled hot iframes plus eight/48 MiB warm entries, and never persists or authorizes editing. Every startup/restore, local/recent, registered/sidebar/tab, OS-external and confirmation intent enters one ordered admission stream with a transaction ID. Before mutating Controller Sessions, `ProjectWorkflow` must synchronously authorize any non-null transaction/application generation and then obtain its matching application receipt; null identifies a legal authority refresh, while mismatched or terminal identity is stale. `project-applied` is informational only. Pre-apply failure restores the captured tab authority, while a post-apply failure either restores both Controller and tabs from the same receipt or retains the aligned document as committed-error. Closing the active document first obtains the Project switch/recovery protection, then removes that tab, then opens the successor without repeating the outgoing drain; successor failure falls back to Start and never resurrects the closed tab. Desktop close freezes this admission stream before its first await and retains the freeze only when ready; `workbench-tabs.json` continues best-effort and is not content-safety authority. Close rejection releases the exact request freeze before at most one automatic retry. `app/workbench/WorkbenchChrome.tsx` and cached surfaces are presentation only. |
| Open/registered project identity, session generation and late-query fencing | `app/application/project-session.js` |
| External OS/QoderWork HTML-open FIFO delivery with explicit renderer acknowledgement, opaque request deduplication, read-only A/B/C classification, Prepared Intent, committed-exit one-shot handoff, cold-start native failure presentation from stable product codes, whole project-open transition ordering, blocker-gated deferred head retention, request-keyed ack-only retry, accepted-result FIFO and final renderer fence | `desktop/external-file-open.mjs`, `desktop/prepared-html-open.mjs`, `desktop/project-open-queue.mjs`, `app/application/external-file-open-session.js`, `app/application/project-application-session.js` |
| First-open and already-imported confirmation prompt | Auto-confirmed by Workbench from `ProjectWorkflow.openConfirmation`; delete-original still uses a registered `window.confirm` |
| Current source bytes, persisted/working/Canvas/protection Hashes, revisions, persistence projection, source-write single flight, coalesced recovery-journal queue, verified recovery/export evidence and Canvas authority generation | `app/application/document-session.js` and `app/application/document-workflow.js`; reversible detach requires working = Canvas = protection, while failed/conflict and the disk-confirmed persisted Hash remain visible |
| Renderer draft revision, pending operations and reconciliation | `app/application/draft-session.js` |
| Renderer comment working copy, composer and saved-comment edit projection | `app/application/comment-session.js` |
| Active/background runs, Agent delivery projection, background outcomes, submission lifecycle locks and operation locks | `app/application/run-session.js` |
| Renderer Agent catalog, provider-keyed diagnostic projection, selected provider/runtime/model/reasoning, bounded public model catalog, selection-keyed use-time preflight and submission sequencing | `app/application/agent-provider-catalog.js`, `app/domain/agent-provider-state.js` and `app/application/run-workflow.js`; `qoder-availability.js` and `QoderAvailabilityCard.tsx` are compatibility wrappers only. Settings consumes `AgentDiagnosticSnapshot` and never creates an execution ticket. Neither card receives command, version, path, npm prefix or Token bytes |
| Product ACP allowlist, managed-install inventory, in-flight install/login jobs and install/login drain | `bridge/agent/catalog/agent-catalog.mjs`, `agent-installer.mjs` and `agent-access-auth.mjs`; Coordinator does not own install or login. Login operations keep a Bridge-minted `operationId` through succeeded/cancelled/failed; diagnosis cannot finish or clear them. Qoder and Codex ACP are the installable shipped ACP entries. 源页 Agent is not installable |
| Provider-neutral dispatch, provider/runtime/security-profile/execution-purpose tickets, process/session lifetime, canonical events, cancellation-before-durable-Request and shutdown drain | `bridge/agent/agent-runtime-coordinator.mjs` plus provider/runtime registries; current execution binds by canonical selection only; historical `mode: "qoder-acp"` conversion stays in the delivery codec; legacy Services are stateless façades and durable Request/Candidate authority remains in `ProjectFileRepository` |
| Trusted-local Qoder installation discovery, read-only diagnosis, package/version/login/model preflight, error classification and ACP launch descriptor | `bridge/agent/providers/qoder-provider.mjs`; diagnosis uses only version/model-list commands and does not open ACP. Candidates are collected before selecting a valid user CLI, then a PageRoot-managed installation. A broken lower-priority candidate is diagnostic only when a valid higher-priority candidate exists. Historical `mode: "qoder-acp"` remains readable at the delivery codec and status projection; current execution does not map a leftover driver alias |
| Codex ACP installation discovery, pinned adapter+native closure, read-only login diagnosis, ACP initialize/session preflight and client-mediated launch | `bridge/agent/providers/codex-acp-provider.mjs`; candidates are collected before selecting explicit test configuration, PageRoot-managed installation, then user-global installation. A broken lower-priority candidate is diagnostic only when a valid higher-priority candidate exists. Start-time verification rechecks both the adapter and native executable identities against the ticket |
| PageRoot native OpenAI-compatible HTTP Agent, bounded diagnosis, vendor Token preflight and model catalog | `bridge/agent/providers/openai-compatible-provider.mjs` plus `shared/openai-compatible-vendors.mjs`; built-in vendors may diagnose through `/models`, while Custom validates saved configuration without assuming that route. Session Token stays in Coordinator memory; an explicit remember writes only Main `safeStorage` ciphertext. Anthropic is not registered |
| Provider-neutral ACP protocol, process supervisor and immutable standard event envelope | `bridge/agent/runtimes/acp-runtime.mjs`, `acp-protocol.mjs`, `acp-process.mjs` and `acp-verified-javascript.mjs`; `bridge/qoder-acp-client.mjs` is a compatibility façade |
| PageRoot native HTTP runtime: streaming `/chat/completions`, unique output write and official finalizer | `bridge/agent/runtimes/http-runtime.mjs`; SSE content is accumulated only inside Bridge, while reasoning/usage/heartbeat update activity without entering narration. HTTP and ACP turns use a 45-minute sliding inactivity watchdog rather than a total-duration deadline. A disconnect, cancellation or timeout before protocol completion writes no Candidate; Candidate authority remains the official finalizer |
| Public Agent failure recovery | `agent-runtime-coordinator.mjs` computes `safeToRetry` independently from `recoveryKind`; `agent-session-projector.mjs` exposes only that structured pair plus a bounded error. Renderer actions never infer recovery from provider text and remain capped at two |
| Frozen execution policy and single-output client-mediated Host Port | `bridge/agent/policies/` and `bridge/agent/hosts/`; these constrain only requests made through the ACP Client Host, never native filesystem/command actions inside an Agent process |
| Immutable Version projection and history-view transition | `app/application/version-session.js` |
| `PROJECT.md` editor working copy, generation, composition fence and save projection facts | `app/application/project-rules-session.js` |
| `PROJECT.md` Bridge read/write, 700ms autosave, unknown-write reconciliation, close/switch drain and editor-restore host port | `app/application/project-rules-workflow.js`, composed by `WorkspaceController` |
| Renderer source-history context, pending Patch operations and action intent | `app/application/source-history-session.js` |
| Pure comment/edit-event/tombstone transition rules | `shared/draft-aggregate.mjs` |
| Source-operation ID generation and exact pending-save Patch validation | `shared/source-history.mjs`, re-exported through `app/domain/source-history.js`; cursor transitions and replay stay inside Renderer `SourceHistorySession` |
| Bridge-side draft command validation and CAS | `bridge/draft-service.mjs` |
| Durable Project File Registry, Working Copy CAS, Version/Candidate and Request/Draft records | `bridge/project-file-repository.mjs` façade over `bridge/project-file-repository/` internals (path safety, Registry, Working Copy CAS, Version/Candidate, Request/Draft). Callers keep importing the façade; there is no second persistence owner |
| Close, switch, submit and history obligations | `app/application/drain-coordinator.js` |
| Late query rejection and monotonic draft reads | `app/application/project-query-fence.js` |
| Crash recovery | Main-process `desktop/recovery-journal-store.mjs` owns per-document atomic, read-back verified journals under `userData`. `DocumentWorkflow` restores document HTML only from that journal. `app/application/recovery-store.js` remains the comment-draft RecoveryStore and is not a document-HTML authority |
| Desktop renderer host assertion before Controller construction | `app/application/desktop-host.js` |
| Same-directory source rename, operation journal and durable active/recent path rebase | `desktop/source-rename.mjs` |
| Directory-change hint, live source-file early warning and non-authoritative active managed locator cache | `desktop/source-file-watch.mjs`, `desktop/active-managed-locator.mjs` |
| Renderer source-rename and Finder locator rebase, Hash/identity fence, lost-response reconciliation and synchronous Project/Document/Run publication | `app/application/project-workflow.js` through its narrow `ProjectOpenPort.renameSource` / `reconcileActiveManagedSource` |
| Known-source Finder reveal | narrow project IPC in `desktop/ipc/project-ipc.mjs`, composed from `desktop/main.mjs` |
| Validated default-browser HTML launch | `desktop/open-in-default-browser.mjs`, behind `desktop/project-ipc-security.mjs` sender authority |
| Pseudonymous identity, strict event schemas, local queue and PostHog delivery | `desktop/usage-telemetry.mjs` |
| Preview sanitization and verified frame injection | `app/components/html-preview-sandbox.js` |
| Canvas disposable runtime frame identity and exact-program reuse | `app/components/html-canvas-frame.js`; `HtmlCanvasEditor` owns iframe mount/reload |
| Native deferred-command arbitration (user-explicit vs system, lease matching, stale drain) | `app/components/html-canvas-native-commands.js`; the editor supplies the live session/lease and still retires the queue before host replacement |
| Canvas comment-target measurement, insertion-point identities and marker layout | `app/components/html-canvas-comment-layout.ts`, `app/components/html-canvas-insertion-layout.js`; insertion identities cache on source Hash plus document identity; comment geometry remains disposable |
| Canvas selection chrome, comment markers, hover hints and edit toolbar presentation | `app/components/html-canvas-selection-chrome.tsx`; snapshots and callbacks only, no source or editing authority |
| Volatile desktop preview sessions and contained local-asset serving | `desktop/preview-protocol.mjs` |
| Imported project's original sibling-asset directory | `desktop/imported-asset-root.mjs` plus Main `html-projects.json` |
| Edit script/resource limits, exact program identity and direct-frame grant | `app/domain/edit-runtime-contract.js`, `app/application/edit-author-runtime-session.js` |
| Scoped Edit author-resource closure, contained asset/script serving and source-provenance bootstrap | `desktop/edit-runtime-protocol.mjs`, `desktop/edit-runtime-bootstrap.mjs` |
| Verified immutable ECharts CDN byte cache, exact-URL classification and LRU | `desktop/edit-runtime-library-store.mjs` |
| Source-backed preview/edit display-state filtering, rebinding and safe action resolution | `app/lib/page-view-context.js` |
| Run lifecycle decoding and transition policy | `app/domain/run-lifecycle.js` |
| Request freeze/persisted-boundary validation, authority reconciliation, run polling, cancellation, conflict commands and confirmed handoff | `app/application/run-workflow.js` |
| Workbench pure record/comment/project/version/browser helpers | `app/workbench/*-model.ts`, `app/workbench/browser-io.ts` |
| History, attachment and preview presentation | `app/workbench/presentation.tsx` |
| Workbench visual cascade | `app/globals.css` is import-only; `app/styles/*.css` load in fixed order (tokens/base, shell, review V5/V5.1/V5.2 canvas, comment hierarchy, project/sidebar context, about/chrome, top toolbar). Later layers override earlier ones; the two `:root` blocks stay split |
| File title, rename and file-action presentation | `app/workbench/file-header-view.tsx` |
| Comment rail presentation | `app/workbench/comment-rail-view.tsx` |
| Project context/sidebar presentation and settings tab | `app/workbench/WorkbenchChrome.tsx`, `app/workbench/workbench-sidebar-container.tsx`, `app/components/SettingsPage.tsx` |
| AI run conversation and live narration presentation | `app/workbench/run-conversation-outlet.tsx`, `app/workbench/AiConversationSidebar.tsx` |
| Formal AI review state transitions | `app/workbench/review-state.ts` |
| Bounded pure sibling alignment for semantic review units | `app/lib/review-semantic-alignment.js` |
| Persistent source element ID format, generation and attribute classification | `app/lib/pageroot-element-identity.js`; ADR 0059 |
| Typed, per-element review projection fact normalization and filtering | `app/lib/review-projection-facts.js` |
| Formal AI review text and element-presence analysis, first-bootstrap exact comment binding, global mask and overlay projection | `app/workbench/review-document.ts` orchestrates `app/workbench/review/` pipeline modules (parse, semantic pairing, element-presence diff, text diff, comment binding, projection and serialize) |
| Formal AI review composition, private comment/projection port lifecycle and isolated-frame coordination | `app/workbench/AiReviewWorkspace.tsx` |

The V2 source-fidelity path remains a protected core: `SourceIndex`,
`TargetResolver`, `editable-island`, `IslandEditingController`,
`SemanticOperationKernel` owns the pure stable-ID operation contract and lowers
to `SourcePatchEngine`. Canvas materializes once: it lowers the command to a
semantic operation, applies the kernel, and publishes that complete HTML/Hash.
SourcePatch remains internal. The complete next HTML remains source-derived and
Runtime DOM is never serialized. `SourcePatchEngine` and the atomic source writer
may be split only around a
proven invariant, not to satisfy a line-count target. The retired V1
`NativeEditingController`, its per-keystroke tracker, shadow block draft,
FormatSkeleton and structural planner have been removed. The architecture gate
rejects reintroducing those files or imports; production text editing has one
V2 controller route with one element-island transaction scope.

`SourceIndex` also recognizes the ADR 0059 `data-pageroot-id` contract and maps
only valid, document-unique values back to exact source element records. Missing,
malformed and duplicated identities are diagnostics, not an instruction from
the parser to rewrite HTML. The persistent element identity is only
`data-pageroot-id`. Parser-local handles (`nodeId` / `parseKey`) stay inside
`SourceIndex` / `SourcePatchEngine` for one parse of one revision: they never
enter Runtime DOM, TargetRef, Selection, comments, Review or history.
ADR 0060 gives `ProjectFileRepository` the separate one-time migration
authority: new imports create an identified managed Working Copy while
preserving the external file and immutable V1 bytes; legacy managed Working
Copies materialize missing IDs only through a Hash-checked recoverable
transaction on editable workspace entry. Incomplete or invalid identities fail
closed and do not enable direct edit. ADR 0061 makes that index the exclusive
resolver: official location uses only a valid unique `elementId`. Selector,
ancestor fingerprint, source-offset distance and text prefix/suffix scoring
are not an official result. Deletion or a missing ID is orphaned without
heuristic fallback. SourcePatch remains the private source materializer, but
its public command entry is the same Stable ID: `elementId` on the command or
TargetRef, then the current `SourceIndex` range, then the semantic operation.
`command.nodeId`, `command.textNodeId`, preview parseKey lookup and TargetRef
selector/fingerprint fallback are not edit authorities. `html`, `head` and `body` carry Stable IDs like every other
element; whole-page comments persist the body's `elementId`. Semantic saving remains
outside this foundation.

The external original and the hidden V1 snapshot remain byte-exact copies of
the first imported HTML, without PageRoot Stable ID metadata. The visible V1
Working Copy is the editable project file and may differ immediately because
PageRoot materializes Stable IDs. Before an AI Candidate is promoted, its HTML
is normalized with Stable IDs; V2 and later immutable Versions store the full
accepted Candidate HTML and may therefore contain those IDs. A new V2+ Working
Copy starts byte-identical to its corresponding Version snapshot; later local
editing changes only that Working Copy and never rewrites the established
snapshot. Stable IDs never write back to the external original. There is one
export action: it copies the complete current Working Copy HTML as-is,
including Stable IDs, and does not mutate Project, Version, Registry, Recent or
the current open file. Undo/Redo remains the bounded session history of the
current open document and is not formal Version history.

`HtmlCanvasEditor.tsx` remains the Canvas coordinator. Parsing, DOM
instrumentation, interaction policy, preview synchronization, selection,
source-backed page view and style inspection live in the adjacent
`html-canvas-*.ts` modules. Authoritative HTML replacement writes a static
Active frame and completes Canvas verify without waiting for author Script.
Dynamic refresh starts those scripts only through `startRuntimeCandidate()` in
a hidden slot. One-shot runtime frame verification lives in
`html-canvas-frame.js`. Native deferred-command arbitration lives in
`html-canvas-native-commands.js`. Comment-target geometry lives in
`html-canvas-comment-layout.ts`. Selection chrome, comment markers, hover hints and
the edit toolbar are presented by `html-canvas-selection-chrome.tsx`; they
receive snapshots and callbacks only. Those helpers do not gain a second source or
editing authority; `IslandEditingController` owns native text interaction,
`SemanticOperationKernel` is the public authorization entry, and
`SourcePatchEngine` remains the private range materializer. Canvas publishes
the kernel's single materialization, including tracked target mappings. Inside
one semantic apply,
the kernel reuses the owned before-index for target checks and planning, and
reuses `applyPatchPlan`'s after-index for identity delta and the next state;
it does not skip hash, range, identity or parse-integrity checks.
`runtime-continuity-probe.js`
records frame lifecycle and visual samples only after a test enables it; it has
no source, Runtime or persistence authority. `edit-pipeline-counters.js`
likewise records index/patch/insertion-scan counts only after a test enables it.
Canvas undo/redo restores the open-document history tuple and is counted
separately from a new semantic `fullPatchApply`.

## Persistence

Desktop tab restoration uses a separate validated `workbench-tabs.json`. Its
strict version-1 schema contains only tab IDs and durable `projectId +
documentId` pairs; titles are refreshed from the Registry projection after
open. It never persists source paths, HTML, Hashes or AI authority. Writes use
same-directory temporary creation plus atomic rename. `html-projects.json`
continues to own `activePath` compatibility. Any valid tabs record suppresses
that compatibility startup: `activeTabId: null` restores Start, while a stored
active document remains pending until Registry open, a newer Controller epoch
and source hydration succeed. Canvas Hash verification decides whether the
projection may be edited, reused from cache or statically degraded; it does
not gate Working HTML publication, save or project switch. Registry-title/missing-item
reconciliation and restore ordering live below React in `WorkspaceController`:
the Controller reads tabs first, requests the Registry catalog when needed,
removes missing items with an actionable Finder recovery event, and activates
the pending identity through its owned workflow.

`ProjectFileRepository` also owns durable file binding. Stable project/document/
Working Copy IDs plus the registered mapping and state Hash select a member;
persisted stat fields are observations only. `source-binding.mjs` owns live
hard-link locator operations under the same Repository serialization. Initialize
recovers transactions before migrating each member; one project's failure never
blocks another. Catalog rows retain project metadata and an independent source
status; Version summaries do not require a usable HTML file. User-requested
missing-file restoration crosses the existing ProjectWorkflow/ProjectOpenPort,
trusted desktop IPC and Bridge boundary with only a project ID. Detailed
recovery and authority rules live in `SECURITY_MODEL.md`.

Direct edits form ordered revisions and are written through a single queue. Every write checks the expected source Hash. Working Copy saves stage complete replacement bytes, capture and verify the actual displaced source in the existing recovery directory, publish without replacing a newly occupied path, then reread the result. External modification causes a fail-closed conflict.

The same Repository serialization owns Working Copy source-element identity.
`working-copy-state.v4` records the adopted identity schema and a canonical
binding Hash over ID, tag, identified parent and source order. A legacy migration
stages complete before/after HTML, publishes only through the existing
same-directory CAS, then atomically updates Working Copy state and manifest
file identity. Restart recovery follows only the registered transaction and
accepts only its exact before or after Hash. Clean external text/style changes
must preserve the binding Hash; structural identity drift is an explicit
conflict and only force-unlock may adopt it before controlled migration.
Immutable Versions, frozen Requests and Runtime DOM are never migration inputs
or destinations.
On the existing direct-edit path, `IslandEditingController` owns only the
controlled DOM, Selection and IME checkpoint. Canvas submits logical `setText`
with canonical content HTML and no new IDs; the Kernel's single materialization
allocates any browser-created line-break IDs, and Canvas seals the accepted IDs
before synchronizing the live projection. New inline wrappers remain owned by
the text-range style planner. Deleting a hard break retires its ID with the node. The
Repository verifies that every current non-break claim survives and may fill
only otherwise-valid missing IDs on genuinely new source elements before the
CAS; it never repairs a lost prior claim.

`/autosave` retains its own transport decoding and revision checks, then
delegates the current-source write to `ProjectFileRepository`. Path safety,
Registry, Working Copy CAS, Version/Candidate and Request/Draft helpers live
under `bridge/project-file-repository/`; the façade remains the only public
module and the only persistence owner. The v3 Bridge `SourceTransaction`
kernel, persistent history journal and action route are retired. There is no
second inline current-source writer in `workspace-bridge.mjs`.

At close, `DocumentSession` independently hashes the frozen renderer HTML and
accepts any acknowledged persisted revision at or beyond the close cutoff. A
stale Canvas Hash or renderer projection is repaired silently. Only when local
authority cannot prove the exact bytes does the renderer perform a bounded
authoritative source read; identical content repairs the projection, confirmed
divergence enters the source-conflict owner, and an invalid content/Hash pair
enters the persistent workspace recovery surface without overwriting either
copy.

A durable command for an already registered v4 Project File carries one captured
`projectId + documentId + sourcePath` context plus the OpenTarget. The Bridge
resolves only the v4 Project File Registry (`.pageroot-registry.json`); it does
not read `project-registry.json` or historical Documents workspace roots. It
never creates a project while serving a registered mutation. Only
`/project/ensure` may import unregistered HTML as a new v4 V1. An HTML file
that is not a registered v4 Project File is unmanaged: GET `/workspace` and
GET `/source` return that state, and mutation routes fail closed with
`PROJECT_NOT_FOUND`. GET `/source-preview` and GET `/source-stat` are
read-only disk inspections: they never hydrate runtime or mutate Working Copy
state. This decision is recorded in
`docs/decisions/0012-id-first-project-context.md` for the historical v3
identity rule and superseded at the desktop open boundary by v4-only Project
Files.

Every accepted Canvas edit is independently expressed as a semantic operation.
The semantic kernel materializes complete next HTML plus the exact forward and
inverse patches used by the current-open editing session. The renderer
`SourceHistorySession` owns a memory-only cursor capped at the latest 20 edits
for one open HTML. A new forward edit truncates redo; switching HTML, closing
the document or restarting clears the stack.

Authored structure edits use the same boundary. Insert accepts one identity-free
source element and allocates IDs for its whole subtree; duplicate first removes
the selected subtree's IDs; delete retires them; same-parent and cross-parent
move preserve them. Only current `SourceIndex` elements are eligible. Script-
generated nodes and preview DOM are never structural inputs. Duplicate additionally
compares the complete selected live subtree with its current canonical source
subtree; a generated descendant, opaque runtime surface or authored program makes
the parent selection unsupported. Known-unsupported copy is absent from the
toolbar and rejected again at the common command boundary, while independent
source-backed siblings, delete/move, text copy and complete-HTML save/export keep
their existing contracts. The visible toolbar keeps this deliberately small:
duplicate, delete and sibling up/down; the Canvas port exposes raw insertion and
cross-parent move for product workflows without adding a component or layout
system. See ADR 0064 and ADR 0065.

Undo and redo first checkpoint any active editable island and drain the source
queue. The renderer applies the exact inverse or forward patches locally, then
saves the resulting complete HTML through the normal Hash/CAS and atomic
autosave path. Crash recovery can finish that save from exact operation
evidence but never restores the user-visible history stack. A v4 Project File
does not persist a Bridge source-history journal. The old schema, decoder,
client command and action route are retired and cannot become a second history
authority.

After that acknowledgement, the Canvas may keep the current iframe only when
both history targets resolve exactly to the same editable-island identity, the
source prefix and suffix prove that every byte outside that island is unchanged,
and the complete mounted source-node sequence validates against the next
`SourceIndex`. It then replaces only the island's children from an instrumented
canonical parse, refreshes ephemeral node IDs and restores the logical Selection
and viewport. Any failed proof uses the existing fresh verified-frame path. The
mounted DOM remains a disposable projection and is never serialized into source.

The desktop `Edit` menu is a router, not another history owner. Focused native
text inputs use Electron/Chromium's local text undo. Canvas focus routes
Undo/Redo intent to the renderer memory session. Comment/card, attachment and
project actions never enter the Canvas stack.

An explicit filename change is a separate desktop source-path transaction, not
an HTML write. `desktop/source-rename.mjs` validates one stable operation ID,
the current source Hash, a same-directory target and an unchanged HTML
extension. It writes `pendingRename` to the active-file record before the
exclusive hard-link/unlink move, which cannot replace a destination created
after preflight, then atomically rebases active/recent paths and records
`lastRename`. The linked inode and Hash are revalidated before and after
removing the old name; a late source change rolls back to the old name. Startup
reconciles the prepared operation from the old/new paths and expected Hash.
The Bridge's existing physical-file identity relink keeps
the same Project and Document and updates only canonical `sourcePath` and
display name; no Version is created.

After the desktop transaction returns a complete identity, `ProjectWorkflow`
owns the renderer-side transition. It first drains the existing source, draft,
attachment and rule obligations, fences the native Canvas, and captures the
current Project context plus source Hash. A lost desktop response is reconciled
only through the trusted active-project port when the expected renamed filename
and Hash both match. It then synchronously rebases `RunSession`, advances
`ProjectSession`, publishes `DocumentSession`, clears stale recovery state and
refreshes canonical workspace authority. A late result never mutates a newer
Project context; no generic desktop executor or duplicate Session fact is used.

Finder same-root renames share that source-locator transition. The desktop
watcher reports that the current source directory or its parent changed; it
does not claim a new path. When the watched HTML is still a regular file, Main
forwards `sourceMissing: false` and `ProjectWorkflow` only hash-observes the
current source. It does not drain switch or ask Bridge to rebind, so sibling
writes such as `PROJECT.md` cannot flush unsaved project rules. `ProjectWorkflow.reconcileExternalSourceLocator()` and
`renameSource()` share one locator lock. Locator rebase and switch drain run
when Main reports the path missing, at startup, or when the title bar starts a
rename. Main asks Bridge
`POST /managed-working-copy/reconcile` for the unique Working Copy that still
matches the verified identity tuple. If the watched file itself disappears
(including a same-parent project folder rename that Electron's directory
watch may miss), Main uses the same locator cache as startup, then forwards
the original path hint so the renderer can rebase. Hash mismatch can report `content-changed`
after the path is rebound, but never adopts external bytes; `DocumentWorkflow`
then compares hashes and enters the existing conflict state. The local
`activeManagedLocator` cache is only a restart hint for Main and is not a
second write authority.

When no desktop project can be restored, the main process provisions the built-in welcome content once as a regular HTML source beside the selected workspace and immediately registers its initial V1 through the authenticated Bridge. Existing welcome bytes are never replaced on startup. From that point onward it uses the same source, comment, Request, handoff and Version boundaries as any user-opened HTML.

For newly imported project files, the Finder project root is the durable
container: `.pageroot/project.json` owns `projectId`/`documentId`,
`.pageroot/manifest.json` owns relative Version/Working Copy mapping, and the
v4 Registry is the canonical `projectId → registeredProjectRootPath` write
whitelist. Optional `importSourceKey` / `importSourceSha256` on a project
record are a long-lived lookup from one canonical external path to that
`projectId`; they are not write authority, not a Hash index, and not a reason
to merge two files. A root filesystem identity is only a unique same-parent rename
clue; it is never a portable write credential. An exact OpenTarget preserves
the requested path; matching Hashes validate bytes but never redirect
navigation. Managed paths require lexical containment plus component-by-
component real-path validation. A root moved out of the configured projects
directory is not followed or re-associated: writes pause until it returns to
its exact registered path. Copies, damaged registrations, and every pre-v4
project state are external HTML at the v4 boundary; a path that already has a
unique external-source binding returns that project's current Working Copy
instead of creating a second V1. Unbound HTML is classified first and imported
as a fresh v4 V1 only after the user confirms; the original HTML bytes remain
untouched unless the user later opts into Trash after the published project is
retained. Canvas failure never rolls that publication back. A current Registry
write lock serializes ordinary Registry mutations across Bridge processes and is
the only Registry lock. A Registry that is not a valid current Registry fails
closed through that one validator; there is no metadata-completion migration and
no fallback to an empty Registry, because an empty Registry would let the next
import atomically replace the real file and destroy its recorded external-source
bindings and root identities. It neither imports, reassociates nor changes a Project, Working
Copy, Version, Draft, comment, attachment or HTML. There is no v3 compatibility
ingress, broader physical migration, or dual write. The decisions are recorded
in `docs/decisions/0022-user-owned-project-root-identity.md`,
`docs/decisions/0026-external-source-project-binding.md`,
`docs/decisions/0027-prepared-open-intent.md` and
`docs/decisions/0028-unrecognized-registry-fails-closed.md`.

Initial and accepted AI results are immutable versions. Routine local edits do not create versions. A validated AI result is not activated until the user explicitly chooses it. Promotion may stage a provisional output path, but its final visible path is frozen only after the no-replace publication succeeds; a pre-publication collision reallocates and retries without overwriting user bytes.

Candidate assessment is Attempt evidence, not current-source authority. The
historical Version and archived terminal-outcome queries have one bounded
adapter for the two `1.0.0` Developer Preview shapes: records may omit or carry
the now-retired executable-surface fields. It verifies immutable base/candidate
bytes and all four Hashes, re-runs the current document-health and continuity
assessment, normalizes retired fields out in memory, and leaves the old file
unchanged. Script conclusions from an old record never affect current status or
review routing. Archived outcomes remain terminal and cannot become openable
candidates through this adapter.

`ProjectRulesWorkflow` owns `PROJECT.md`'s debounced autosave and is flushed before project switch or close; its Session retains only the working copy and composition fence. One recoverable unsaved comment composer is allowed at a time. Attachment uploads, rule saves and ordinary source writes are finished or surfaced in their owning panel before navigation proceeds.

Persistent source and Draft failures share the single workspace status-banner
surface, ordered by safety priority. The source failure owns its export and
reload/retry action; otherwise the Draft failure owns the comment retry action.
The comment rail does not render a duplicate failure card. Product copy is
selected from stable error codes and strips local paths, IDs, Hash fields and
raw English exception text before rendering.

Draft mutations carry stable operation identities. Deletion tombstones and
processed-operation acknowledgements live in `draft/annotations.json`. A stale
revision or unknown POST outcome is reconciled against the authoritative draft,
rebased and retried within a bounded loop; a blind retry of the same stale
snapshot is not a recovery action.

A draft artifact stores its own revision, timestamp and operation
acknowledgements. If the Bridge stops after atomically replacing that artifact
but before refreshing the runtime pointer, the next read may adopt an artifact
that is exactly one revision ahead and verifies its Hash. A larger forward jump
is not a valid crash window and fails closed, as does an artifact older than the
runtime pointer or a same-revision Hash mismatch.

A close or navigation boundary performs a final draft verification through the
same session. If the aggregate fingerprint is already acknowledged, that
verification is a no-op: it neither POSTs the draft nor advances its revision.
The runtime capability manifest selects exactly one close coordinator:
Electron's acknowledged handshake for the desktop app, or `beforeunload` for a
browser runtime. They never compete over the same close.
The immutable preload manifest is the only capability authority: absent or
malformed declarations fail closed to browser capabilities, and the presence
of an individual preload API cannot restore desktop authority.

The renderer close result also classifies who owns presentation. Known
recoverable blockers remain in their Canvas/banner/panel and cause Electron to
return focus without a duplicate native dialog. Missing handlers, renderer
timeouts and unexpected close-coordination faults default to the native
fail-closed surface.

The main-process application-update controller is the sole owner of stable
channel checks, the startup-plus-four-hour schedule, coalesced manual checks,
download progress and downloaded-install readiness. It exposes only immutable
status snapshots and narrow check/download/install intents through preload IPC. The
renderer can also request the fixed project repository URL, but cannot supply
an arbitrary external URL. The Settings surface may request the packaged user
notice through one app-level IPC intent; the main process resolves the fixed
resource name for development or the signed app bundle, and the renderer cannot
supply a local path. A renderer download intent is accepted only while
the controller owns an available stable update; it does not grant exit
authority. Restart installation is a second explicit intent that reuses the
same Electron drain coordinator before invoking the signed updater. Ordinary
app quit never installs a pending update.

The main-process usage-telemetry controller is the sole owner of analytics
identity, filtering, persistence and delivery. A narrow preload channel accepts
only renderer intent; the main process drops every event or property outside
the exact allowlist. One random installation UUID and one installation-local
HMAC secret persist in `usage-telemetry.json`; every launch gets a new session
UUID, and raw project IDs are converted to installation-specific pseudonyms
before entering the queue. Direct edits and successful saves are aggregated,
then all events use a bounded queue and batched best-effort delivery. Telemetry
never participates in editor authority or close/navigation drains.

## Trust model

The renderer is sandboxed with context isolation and no Node integration. The preload exposes narrow validated IPC methods. The Bridge uses a per-process authentication token and only operates on managed project paths. AI output is untrusted until protocol, project identity, Hash, path, complete/displayable-document and source-element identity checks succeed. A unique retained stable ID remains the sole element identity even when tag, parent, order or content changes; malformed, duplicate, forged or demonstrably lost IDs fail closed. PageRoot assigns IDs only to identity-free elements proven new after that validation, seals submitted and normalized output Hashes plus an identity report, and gives Review/Promotion the normalized complete HTML. Authored scripts, handlers, executable URLs and refresh directives are accepted as candidate content without detection or UI signaling; their execution remains contained by the existing preview, edit and review sandboxes. A coarse continuity fingerprint compares visible text, stable anchors, classes, assets and title with the frozen base. Strong continuity enters the normal ready flow; weak continuity preserves the immutable candidate but removes direct-open and requires side-by-side review. Frozen comment targets remain generation and review context, not a subtree-exact acceptance gate. Telemetry schemas have no fields for HTML, user text, attachments, clipboard data, filenames, paths, raw exceptions, account identity or hardware identity.

Every renderer request to the Bridge is bounded: ordinary state/file operations use 15 seconds, attachments use 30 seconds, and Request creation uses 60 seconds. Busy refs are released in `finally`, so an unresponsive local service cannot leave a permanent UI lock. An unknown Request POST outcome remains fail-closed and is reconciled against the durable workspace state before editing resumes.

If the utility Bridge exits after startup, the main process retains one
workspace-recovery issue. It sends the narrow
`html-app:workspace-unavailable` event only after the Workbench listener
acknowledges readiness; a late listener or renderer reload receives the retained
issue through the readiness handshake. Before that acknowledgement, the
two-path native recovery dialog remains the fail-closed fallback. The renderer
keeps in-memory content visible and exportable while blocking new Bridge-backed
mutations. `html-app:relaunch` still runs the normal renderer close-readiness
handshake; an unsafe relaunch is rejected until the user exports or resolves
pending writes.

Only a non-in-place main-frame navigation revokes renderer readiness. Canvas
iframe loads and same-document navigation are subordinate UI activity; treating
them as a Workbench reload would bypass the final close drain and is forbidden.

Provider Registry owns the public Agent catalog and dispatch. The shared Agent
Delivery codec owns durable validation and legacy read projection; the runtime
coordinator converts a still-supported incoming driver once, then freezes
canonical selection and fingerprint in its one-use ticket. Unknown providers
stay readable and cancellable, but they are not start authority and do not fall
back to another shipped provider.
Workspace Bridge exposes provider, diagnose, preflight, start, status and
cancel routes. Diagnose is read-only and ticketless; preflight is execution-only.
Status publishes only the bounded `PublicExecutionSession` activity projection
(`phase`, timestamps, received HTML bytes and safe error fields), never hidden
reasoning, command arguments, paths, stderr or partial HTML.

The renderer freezes a full selection synchronously at the user intent. Its
preflight key includes provider, runtime, requested/resolved model, reasoning,
installation digest, trust-policy version and purpose. Request creation,
uncertain-POST reconciliation, start, retry and restart recovery read the
durable Request selection; changing the catalog selection affects only the next
intent. Provider differences reach React as descriptor/presentation data, and
workflow modules cannot import provider implementations.
