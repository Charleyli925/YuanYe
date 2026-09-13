# Architecture contract

This document is normative for state ownership, asynchronous coordination and
persistence. Product behavior remains normative in `docs/MVP_PRD.md` and
`docs/INTERACTION_FLOW.md`; when those documents disagree, the conflict must be
resolved in the same Pull Request before implementation proceeds.

## Dependency direction

```text
React views
  -> application sessions and coordinators
    -> domain state and pure transition functions
      -> typed Bridge client

Bridge route adapters
  -> application commands and queries
    -> domain transitions
      -> repositories
        -> project lock and atomic filesystem writer
```

- Views render snapshots and dispatch user intent. They do not know Bridge
  routes, use raw `fetch`, or read and write browser persistence.
- `app/workbench.tsx` is the renderer composition root. It may connect
  application-session snapshots to view props and callbacks, but it may not
  recreate a session-owned fact as an independently writable ref or state
  variable.
- Workbench presentation files (`presentation.tsx` and `*-view.tsx`) are
  snapshot-and-callback views. They may import domain types and pure Workbench
  models, but not `app/application` sessions or services.
- Application modules own session identity, request generations, mutation
  outcomes, recovery and orchestration. `WorkspaceController` is the public
  workflow facade: it may sequence injected Session transitions, but it is not
  a second fact store and may not import React, Workbench presentation,
  components or desktop code.
- Domain modules are pure and may be shared by the renderer and Bridge. They do
  not import React, DOM components, Electron or filesystem adapters.
- Existing source-fidelity engines under `app/lib` are also pure shared core;
  narrow `scripts/` re-export adapters may consume them. They cannot import
  Workbench, React components or application sessions.
- Bridge routes decode transport input and delegate. Durable state changes run
  under the Project File repository boundary. `/autosave` retains only
  route-specific validation and response encoding; `ProjectFileRepository`
  owns the current-source write. The persistent source-history journal, decoder
  and Bridge action route are retired. The retired v3 `SourceTransaction`
  service is not a live Bridge owner.
- `scripts/check-architecture.mjs` enforces the dependency direction. Do not
  weaken the gate to land a feature.
- Production rendering is Desktop-only. `app/application/desktop-host.js`
  validates the immutable preload manifest and the required project, preview
  and close-handshake functions before the Controller is constructed. Missing
  or malformed Desktop authority fails closed with an explicit initialization
  error. Electron owns close safety through its acknowledged handshake; there
  is no browser product fallback.

## State ownership

Every mutable fact has exactly one owner, listed in `docs/STATE_OWNERSHIP.md`.
React state may project an owner snapshot for rendering, but a state/ref pair
must not become two independent authorities.

The renderer's main workspace facts are partitioned as follows:

- `ProjectSession`: open/registered identity, generation and query fencing;
- `DocumentSession`: current HTML bytes, Hash, edit/persist revisions,
  persistence projection, pending write, flush single flight, Canvas authority
  generation and exact-byte reconciliation at persistence boundaries;
- `CommentSession`: disposable comment working copy, composer, tombstones and
  saved-comment edit session;
- `DraftSession`: acknowledged Draft revision, pending mutation and
  unknown-outcome reconciliation;
- `CommentWorkflow`: durable-comment command sequencing, crash-only Draft
  recovery projection, attachment staging/upload count and stale/cancel
  compensation; it publishes through `CommentSession` and `DraftSession` and
  is not a second Draft aggregate owner;
- `ProjectRulesSession`: `PROJECT.md` working copy, generation, composition
  fence and save projection facts and the verified immutable history preview bytes;
- `ProjectRulesWorkflow`: `PROJECT.md` Bridge read/write, 700ms autosave,
  unknown-write authority reconciliation, close/switch drain and narrow native
  editor-restore host port. It publishes through `ProjectRulesSession` and is
  not a second editor-state owner;
- `RunSession`: current/background run projections, per-Request Agent delivery
  status, background outcomes, the one preparing/frozen/uncertain submission
  lock, and operation locks. ACP events remain bounded presentation facts and
  never become completion authority;
- `RunWorkflow`: ticketless Agent diagnosis for Settings, pre-Request Agent use-time check, Request freeze/persisted-boundary
  verification, final-saved-HTML text-locator preflight, safely fenced same-Request
  Agent start/retry, unknown-POST authority reconciliation, tracked-run polling,
  stop-before-durable-cancel ordering,
  conflict commands and confirmed clipboard fallback. It publishes through
  `RunSession` and never creates a second run store;
- Bridge `AgentRuntimeCoordinator`: ticketless provider diagnosis, ephemeral
  provider/runtime/security-profile/purpose-bound preflight tickets, both
  session lifetimes, persistent launch fence, bounded canonical progress and
  cleanup. `AgentDiagnosticSnapshot` and `PublicExecutionSession` are the only
  renderer projections; commands, paths, stderr, hidden reasoning and partial
  HTML remain private. Diagnostics expose only installation, authentication,
  protocol and service facts; use-time evidence outranks weaker Settings
  diagnosis. Execution failure projects `safeToRetry` separately from its
  structured `recoveryKind`, so a technically clean balance/model/auth failure
  cannot be presented as an unchanged resend. Legacy Services only delegate.
  It never owns or writes Request/Candidate/Version state; task authority is
  re-derived from the registered Repository/runtime record, and only the
  official finalizer plus Repository status path can publish a Candidate;
- Bridge Agent provider/runtime registries: the provider registry is the sole
  provider dispatch point, and the runtime registry
  is the sole runtime dispatch point. Current Coordinator execution binds by
  canonical selection only; leftover driver aliases fail closed. Historical
  `mode: "qoder-acp"` records are converted by the Agent Delivery Codec, not
  the registry. The Qoder provider owns installation identity,
  version, login/model preflight and raw-error normalization. The Codex ACP
  provider owns the same facts for `providerId: "codex"`; missing login is
  `session/new` JSON-RPC `-32000`, not advertised `authMethods`. The PageRoot
  native provider owns read-only reachability diagnosis, vendor Token preflight
  and streaming `/chat/completions` for
  `providerId: "pageroot"` / `runtimeId: "http"`. Unknown IDs fail
  closed; opaque installation facts, digests and capabilities stay inside the
  ticket;
- Bridge Agent runtimes: HTTP SSE and ACP session updates share a sliding
  activity watchdog. Valid content, reasoning, usage or heartbeat resets the
  45-minute inactivity window; elapsed wall time alone never ends a turn.
  Startup/login/preflight probes retain their short bounded timeouts. Runtime
  silence is `AGENT_TURN_TIMEOUT`, never a preflight error, and incomplete
  output cannot reach the finalizer;
- Bridge Agent catalog/installer: `AgentCatalog` owns the product ACP
  allowlist, public provider projection and managed-command candidates.
  `AgentInstaller` owns in-flight install jobs, atomic verified layout under
  `userData/agents` and shutdown drain. `AgentAccessAuth` owns in-flight login
  jobs, Bridge-minted login `operationId` values, terminal login snapshots and
  login drain. Coordinator does not own install or login. This
  is a product allowlist, not a live public registry; Qoder and Codex ACP are
  the installable shipped ACP entries. `pageroot`/`http` is a non-installable
  shipped HTTP Agent (ADR 0069). The packaged application contains no
  private Codex runtime or native Codex package;
  public catalog snapshots also hydrate Bridge-owned `installState`, including
  an in-flight job whose original install HTTP request has not settled, so the
  Renderer can issue exactly one cancellation without becoming a job owner;
- Bridge Agent Host/Policy Ports: `bridge/agent/policies/` owns the execution
  policy and freezes all readable files, including comment-attachment bytes,
  output/completion paths,
  runtime authority and finalizer authority. `bridge/agent/hosts/` owns the
  single-output Execution surface, including cancellation fencing, completion proof and managed terminal
  cleanup. Provider/runtime code may invoke these ports but cannot choose their
  paths, command, success criteria or durable outcome;
  these Ports constrain only requests mediated through the ACP Client Host.
  They are not a sandbox for native filesystem or command operations performed
  by an Agent process. After the Codex ACP cut-over there is no registered `agent-native` provider.
  Both installed ACP providers use one fresh ephemeral session, approval
  `never`, disabled MCP/skills/plugins/apps/Web/subagents, tool network
  disabled, a Request-output-only workspace-write root, fixed finalizer,
  unique Candidate acceptance and confirmed process-group cleanup; they remain
  trusted local processes with the signed-in user's native read authority. Any
  future registered `agent-native` provider requires a separate sandbox
  conformance and security gate before registration;
- `VersionSession`: immutable Version records, verified immutable history preview bytes, plus the current/history
  projection facts;
- `VersionWorkflow`: Version operation identity/generation, Bridge version
  reads and activation mutation, review-candidate preparation, historical
  Working Copy continuation, manual historical creation/result reconciliation, complete project/document/version/OpenTarget
  identity and Hash validation, synchronous cross-Session publication, and
  read-only history verification and projection publication. History reads never
  publish through DocumentSession; return-current removes that projection and
  delegates external-file observation to DocumentWorkflow without reloading bytes. A committed historical
  activation recovers forward through its receipt; it never restores V6 over
  durable V2 state. It publishes through `ProjectSession`,
  `DocumentSession`, `VersionSession`, `DraftSession` and `CommentSession`; it
  never owns a second mutable Version store. Manual creation journals and their
  manifest commit remain in ProjectFileRepository; creation receipts do not
  publish Document authority until the separate validated open completes;
- `SourceHistorySession`: current-open 20-step exact Patch cursor and pending-save evidence.
- `ExternalFileOpenSession`: opaque external-open delivery IDs, one active
  switch, newest queued request, deferred safe-switch retry and stale-result
  fencing for work that has not yet been accepted.
- `ProjectApplicationSession`: FIFO accepted project results, final renderer
  switch fence, deferred application retry and successor preservation.
- `ProjectWorkflow`: hydration generation/load outcome, picker/external/switch
  operation identity, accepted-result execution, close request lifecycle,
  project-switch publication, typed source-rename transition and the unified
  managed-source prepare/commit handoff used by Candidate promotion, historical
  Working Copy continuation and future Registry opens. The command fences/drains
  existing owners, validates the expected source Hash and trusted desktop result
  (including lost-response reconciliation), then synchronously publishes through
  existing Session owners. It is an operation owner, not a second owner of any
  Session fact.

`CommentSession` does not replace the Draft aggregate or Bridge CAS authority,
and `VersionSession` does not make mutable copies of immutable Version files.
The composition root may derive labels, availability and other read-only view
data from these snapshots, but all writes return to the listed owner.

Fact ownership and workflow ownership are separate. A workflow may hold only
its operation identity, single-flight, timer, reconciliation and publication
sequence; it must publish through the existing fact-owning Sessions.
`createRuntimeWorkspaceController()` is the sole production composition path:
it creates one typed Bridge client, one shared `RunSession`, and the remaining
Project, Document, Comment, Draft, Version and SourceHistory fact owners before
constructing `WorkspaceController`. Its injected constructor remains a
Node-test seam only; it may not become a second production composition path.

`WorkspaceController` is the only Application observer of the Project,
Document, Comment, Run and Version Sessions. It exposes their immutable
aggregate snapshot through its fixed `getSnapshot()`/`subscribe()` contract and
forwards typed workflow events through `subscribeEvents()`; it does not create a
second mutable store. It owns the unique `DrainCoordinator`, protocol Sessions,
and Project, Comment, Run, Version and Workbench Tabs workflow composition.
Capability facets such as `controller.comments`, `controller.runs`,
`controller.navigation` and the narrow
`controller.projectCatalog` projection are stable views of this same
Controller instance. A facet exposes only `getSnapshot`, `subscribe` and typed
business commands; it neither stores copied facts nor exposes another
capability. React capability containers subscribe to facets directly so local
draft or focus updates do not publish through the Workbench composition root.
The aggregate contract remains available during migration and for genuinely
cross-capability presentation.

Comment geometry is a disposable presentation port, not Controller or Session
state. `HtmlCanvasEditor` publishes source-tagged layout snapshots to one stable
`commentCanvasPort`; `CommentRailContainer` alone subscribes, owns composer/edit
disclosure, delete confirmation and file-input refs, measures cards, virtualizes
the rail and routes paired reveal/focus/relink intents. Workbench may issue a
typed presentation intent or read the latest target status inside a user command,
but it must not subscribe its composition render to comment presentation changes.
`WorkbenchGlobalSidebarContainer` and the Start surface subscribe
`controller.projectCatalog` independently and render only project identity,
open/switch actions and the existing version-tree context. There is no
user-facing project management panel, `controller.projects` presentation facet
or `projectPanelPort`. `ProjectRulesSession` and `ProjectRulesWorkflow` retain
the durable rules facts and safe lifecycle commands, but rules editing,
version-detail presentation, Finder/export actions and history-preview entry
points are not exposed through a drawer or a React editor container.
`RunConversationOutlet` subscribes `controller.runs`; public Agent narration
and its timestamps therefore commit only the conversation region. Workbench's
aggregate comparator still publishes run identity, lifecycle, phase and error
changes needed by cross-capability locks and navigation.
`WorkbenchTabBarContainer` subscribes `controller.navigation` and owns tab
commands, keyboard shortcuts and post-close focus restoration. Startup restore,
Registry reconciliation and tab persistence enter through Controller-owned
commands and narrow host ports, never React refs or Workbench effects. `DocumentSession`
may derive `hasPendingWrite` and `isFlushing` for that snapshot, but neither a
pending-write payload nor a Promise crosses into Workbench.

Workbench owns only cross-capability presentation state and narrow host
adapters. Capability-local presentation state belongs in its container.
Workbench receives the aggregate snapshot, stable facets and Controller
commands, never a business Session or the
Bridge client. Its direct-Bridge allowance is exactly 0: the checked architecture
gate permits no `bridgeClient.*` call, generic Bridge-command escape, business
Session/Workflow construction or Session ref in Workbench. The gate also forbids React,
Workbench, component or desktop imports from Application composition code.

Workbench navigation has one application transaction contract. Startup restore,
local/recent/Registry selection, tab activation, OS
external FIFO delivery and confirmation continuations enter the same admission
order. Each admitted intent owns one `transactionId` and moves through:

```text
idle -> admitted -> preparing -> awaiting-user/opening
     -> applied(identity, epoch, application receipt)
     -> display-ready -> committed -> idle

background readiness after display-ready:
     -> hydrating -> canvas-verified/edit-ready -> context-ready
```

`ProjectWorkflow` calls the synchronous navigation application port while the
new Project/Document authority is being published. A non-null transaction must
first pass the navigation workflow's live transaction/application-generation
authorization; mismatched, expired or terminal transactions are rejected before
any Controller Session changes. A null transaction remains the explicit legal
path for an authority refresh. The returned receipt is the
only authority for tab mutation and the start of background hydration and
Canvas settlement;
`project-applied` remains presentation information and React may not infer an
application from any-pending state. A pre-applied failure restores the captured
tab authority without changing the Controller. Once the exact bytes are
display-ready, navigation is successful; a later hydration or Canvas failure
retains the tab, marks its readiness error and keeps edit authority closed. A
failure inside a still-atomic Prepared Intent may restore Controller and tabs
from the same receipt. A close may cancel an awaiting-user prompt, but it
must wait for committing, applied, hydrating, finalizing and acknowledgement
work to reach a terminal receipt. Cold-start priority is explicit OS external
FIFO, persisted active tab, `activePath` compatibility, then Start.

Registered-project opening uses one Repository-produced immutable open envelope
for the exact `Project + Document + OpenTarget + path + HTML + Hash` tuple.
Desktop must not repeat `/workspace` and a filesystem HTML read before Renderer
publication. Renderer workspace hydration may skip `/source` and a repeated
content hash only when the live `/workspace` identity and Hash exactly match
that opening envelope; every mismatch remains fail-closed and read-only.

Desktop close synchronously freezes that admission stream before its first
await. The freeze spans navigation-idle settlement, a pinned tabs-persistence
revision, and the ProjectWorkflow close drain. Ready keeps the freeze through
final exit; blocked or aborted close releases it, including final-exit abort IPC,
before navigation retry. External FIFO acknowledgement requires a correlated
terminal navigation outcome and never treats a missing terminal as success.

An asynchronous result may update state only when its complete identity is
current:

```text
projectId + documentId + sourcePath + session generation + query sequence
```

Revisions are monotonic. A query result with an older revision may never
replace an acknowledged state, even if the project identity is unchanged.

External HTML delivery is separately authorized but not separately ordered.
The main-process mailbox accepts only a validated, opaque `.html`/`.htm`
request ID and replaces an older unaccepted OS request with the newer one.
`ProjectOpenQueue` then assigns the whole classify/prepare/commit/finalize,
picker/read/Bridge-check and
active-project transition its FIFO position at entry, shared by local picker,
recent-project, external, startup, generated-version, rename and forget
routes. Class A activates the managed project. Classes B and C store a
Prepared Intent and return only a public `requestId` descriptor; they do not
activate the original file. The renderer's `ExternalFileOpenSession` owns delivery de-duplication,
one active request, one newest queued request and a deferred retry when the
normal project-switch boundary cannot yet close safely. Preload subscribes
before requesting its readiness catch-up, and drops that catch-up if a live
delivery arrives first, so an older mailbox snapshot cannot replace a newer
external intent. The session fences only an
older request that has not yet been accepted when a newer request is queued,
and it freezes the Canvas from the final safe switch fence through the awaited
external acceptance; a newer external request inherits that freeze. Each
renderer open/application session owns its own deferred retry transition. It
records whether `DrainCoordinator.inspect("switch")` observed a relevant
blocker, resumes only after that blocker clears, and otherwise leaves the
explicit retry action available. Project hydration is an explicit switch
obligation rather than a copied Workbench boolean. If the final fence captures
a post-cutoff native edit, it does not begin the IPC, releases that edit to
normal persistence, and resumes only after that source blocker clears.

An external delivery that arrives while the Electron close handshake is still
awaiting the renderer cancels that exact close attempt before the request is
published. Once close is committed, the exiting process never publishes or
accepts another external request: it atomically writes only the latest
validated native HTML path to a private one-shot handoff. Only the next launch
that acquires Electron's single-instance lock claims and deletes that handoff
before routing it through the same mailbox, so a losing secondary process
cannot consume the request and no late delivery can mutate active/recent-project
authority without a matching renderer publication.

`ProjectApplicationSession` owns every successful local or external project
result after main-process acceptance and before renderer publication. It keeps
those results FIFO, so a later accepted result cannot erase a deferred or
successfully published predecessor. `ProjectWorkflow` consumes the FIFO and,
before applying each result, re-enters the complete switch boundary and takes
one synchronous final Canvas freeze. A post-drain native edit leaves that accepted result in the session
until a relevant blocker transition or explicit continuation makes another
attempt safe. Thus a slow later read cannot unlock the Canvas through an older
result and then discard an intervening edit. Ordinary Workbench project-picker
retry state may not carry either external delivery or accepted-result protocol.

A transition that changes the current source or Version has two phases. The
asynchronous phase prepares and validates one complete candidate: project and
document identity, canonical path, full OpenTarget/Working Copy identity,
Version authority, HTML bytes and Hash. The publication phase contains no
`await`: it synchronously advances `ProjectSession`, publishes the complete
`DocumentSession` tuple, updates `VersionSession`, `DraftSession` and
`CommentSession`, then invalidates prior Canvas acknowledgements. Publishing
only the path, only the Hash or any other partial combination is forbidden.

The history “continue editing” command is not a Version restore or snapshot
write. It accepts only the current project identity, one `versionId` and an
operation ID; Repository chooses the one matching existing Working Copy after
validating its state and immutable snapshot, atomically records V2 as active
with a `desktop-pending` receipt, and confirms that receipt only after Desktop
activation. If a Bridge, Desktop or confirmation response is lost, the same
receipt operation is safe to replay and must resolve to the same `workingCopyId`;
it must not roll durable V2 back to V6. A background Candidate carries its own
complete OpenTarget and may never use whichever target happens to be mounted in
the foreground.

## Canvas target contract

The Edit Canvas resolves one pointer event into three deliberately different
objects. `hitElement` is the precise DOM hit and is retained for caret placement,
Double Click and Option-click page actions. `targetElement` is the canonical
long-lived source target used by selection, comments, AI targets and structural
operations. `visualElement` owns Hover, selected chrome and toolbar geometry.
The resolver also returns one `HtmlCanvasSelection`, its `SourceTargetRef` when
the source mapping is exact, a non-persistent `targetKey`, the current DOM
generation and the Runtime fail-closed proof. `targetKey` is only an interaction
identity; it is never persisted or used as source authority. Its priority is a
valid `elementId`, then the current `TargetRef.targetId`, and finally a
generation-scoped WeakMap key. Parse-local SourceIndex handles never become
target identity.

The following invariants are normative:

1. Pointer Hit remains the precise pointer hit.
2. Canonical Target is the user's long-lived selection object.
3. Visual Target owns only chrome and toolbar geometry.
4. Hover promotes to Selected through the same canonical target.
5. Comments, AI and structural operations use canonical Stable Source Identity.
6. Caret placement and Option-click use the precise Pointer Hit.
7. Runtime DOM may be rebuilt; Selection rebinds only through Stable ID.

Ordinary inline source text uses the existing native edit host as its canonical
target. Independent block-level inline elements, SVG/MathML dedicated surfaces,
Canvas, iframe and controls retain their existing special semantics. Runtime
generated or ambiguous nodes never gain edit or persistent precise-comment
authority merely by carrying a copied source or stable ID.

## Registry catalog and AI-task display projections

The Registry is the sole project-catalog membership and write-authority source.
`ProjectFileRepository` may enumerate only its registered records, recover a
verified same-parent root rename through the existing Registry path, and return
ready/unavailable/invalid rows independently. Optional `importSourceKey` values
are a long-lived lookup to at most one `projectId`; they do not grant writes
and do not deduplicate by Hash. Current Registry mutations serialize through a
dedicated write lock, the only Registry lock; a Registry that is not a valid
current Registry fails closed rather than migrating. Desktop Recent records contribute
only sorting, `lastOpenedAt` and startup preference; they cannot add a member,
remove a member or authorize an open. A Workbench catalog intent carries only
`projectId`; the Bridge re-resolves and validates the complete Project,
Document, Working Copy, OpenTarget, bytes and Hash tuple before the normal
source-transition publication boundary. Automatic Recent/catalog refreshes are
deferrable projections: the renderer publishes Project/Document/Version/Draft/
Comment authority and confirms Working Copy activation first, then schedules
the list refresh behind the current context fence. A slow or failed catalog
scan therefore cannot reorder the Repository mutation queue ahead of a
confirmation or downgrade a completed rename/continuation to unknown.

`AI任务/` is intentionally outside every authority chain. Once a durable
Request or verified Candidate already exists, the Repository validates the
frozen project/request/attempt/candidate lineage and hashes, then delegates
only those verified bytes to the narrow `ai-task-projection` materializer. Its
receipt under `.pageroot/recovery/ai-task-projections/` records display recovery
progress; it cannot recreate an active Request, Candidate, Version or runtime
state. The materializer publishes a frozen `PROMPT.md`, then a finalizer-verified
`*-Vn-待审阅.html`, using exclusive directories and no-replace files. It neither
writes nor reads `附件与图片/`, `附件快照说明.md`, `AI_RULES.md`, `PROJECT.md` or a
formal Version in P2.

Desktop's `revealAiTask` accepts the current source locator rather than a
Renderer-supplied Request path. The Bridge returns a root-contained,
non-symlink `AI任务/<single-child>` result only after validation. A deleted,
tampered or user-occupied display path cannot affect review or Promotion and
may only be rebuilt from hidden authority or replaced with a new safe display
directory. The project Finder entry opens the validated project root; the
Version Finder entry opens the validated visible Working Copy rather than the
hidden immutable snapshot.

Comment attachment bytes cross the Draft-to-AI boundary only during
`ProjectFileRepository.#prepareRequest()`. The repository validates every
comment/attachment identity, project-relative path, regular-file status, size
and SHA-256 before creating any Request-owned attachment; it then copies and
re-reads each byte into `input/attachments/<commentId>/`. The complete frozen
Request bundle, including those copies, is first assembled under
`.pageroot/recovery/request-freeze/<requestId>/`. A verified recovery marker is
written only after every bundle file and manifest digest has been checked; the
staging directory is then atomically renamed to
`.pageroot/requests/<requestId>/` before Runtime authority is published. A
restart verifies and resumes a ready marker, discards only markerless
unpublished staging, and fails closed if staging and a published directory both
exist. The annotations, `change-request.json`, `PROMPT.md` and
`input-manifest.json` projections must refer to the same attachment IDs and
Request-relative paths. A failed attachment or bundle validation stops before
public `request.json` and Runtime authority are published, and the copy is
never a hard link to the mutable Draft.

Edit and preview surfaces acknowledge the exact Canvas authority generation and
rendered source Hash. Acknowledgements are disposable and generation-fenced;
they never become source authority. The safe-save projection requires both the
persisted Document revision/Hash and the currently visible surface
acknowledgement. A missing acknowledgement triggers at most one Canvas rebuild;
a clean source mismatch triggers at most one authoritative reread before that
rebuild. Neither recovery path delegates internal reconciliation to the user.

The preview-to-edit `PageViewContext` is a non-durable projection owned by the
Workbench for one current document key and preview generation. It contains
only allowlisted source-backed presentation state. A capture result may apply
only while that complete identity is still current. Project/source changes,
history navigation, a newer preview generation or a failed capture discard it.
It never registers a drain obligation and never changes source, Draft or
Version authority.

Edit has no runtime-snapshot authority. It normally remains script-disabled and
renders source-static content, but desktop may choose one bounded direct author
runtime before the initial editable frame becomes interactive. The sole
`EditAuthorRuntimeSession`, composed by `WorkspaceController`, keys the attempt
to `(sourcePath, canvasGeneration)` rather than an autosave revision, source
echo or comment state. A same-directory path-only rename that keeps the same
HTML, source SHA and canvas generation relocates that live key and does not
consume another prepare. It accepts one exact persisted-source prepare result
only for the same source SHA and generation; a late old result is revoked and a
settled session cannot prepare again. The stable attempt key is distinct from
the latest retry identity: every valid refresh observes current Working HTML,
but only a persisted idle revision becomes eligible for explicit retry. This
observation never auto-prepares on text, style, autosave or comment changes.
At click time `WorkspaceController` supplies the current `DocumentSession`
HTML, persisted SHA and revision state; pending or failed persistence cannot
fall back to the failure-time HTML. Async preparation and recovery remain
fenced to the exact attempted HTML/SHA as well as the stable key. Its
`preparing` snapshot first commits
the non-interactive loading surface; only that presentation acknowledgement
starts the narrow prepare port, so a fast grant cannot promote a static iframe
that has already mounted.

Hover captions are disposable Canvas presentation and must not change the click
selection path.

The direct path accepts a bounded supported executable `script` program. Main
re-reads the active persisted HTML, verifies exact Hash and Canvas generation,
then prepares only contained local/inline resources plus reviewed ECharts CDN
mappings. Exact immutable ECharts URLs first consult a Main-owned,
content-addressed byte store under Application Support. Cache entries are keyed
by canonical exact-version URL and verified by length and SHA-256 on every
read; they own no runtime session, source identity or DOM. For an HTML-only
imported V1, Main records the original selected
HTML directory in desktop `html-projects.json` and uses it as the contained
local asset root for Preview, static Edit and the disposable Edit runtime. The
renderer neither supplies nor learns that original path; the Working Copy
remains source authority.

The visible frame parses complete source while author-script placeholders stay
inert, registers the parser-authored source object set once, then activates the
author program in source order. There is no visual-signal classifier, hidden
probe, real-paint/quiet-frame gate, runtime activity freeze, host mutation
audit, script prewarm or Runtime/DOM cache. The only disk cache contains
verified immutable external script bytes.
Before author code runs, the fixed bootstrap captures a one-time parent-owned
registration port. Registration completes after full parsing and before any
author placeholder activates, so a script cannot preclaim a future parser
object. The parent deletes the public entry and keeps proved source
DOM references in a private parent-realm `WeakSet`; copied attributes or
author-realm properties cannot grant edit authority, and changing a proved
element's public source identity revokes that authority. Every source mutation
must revalidate the live DOM object, its registered stable ID and its current
SourceIndex mapping; cached selection state is never mutation authority. A runtime descendant is
display-only and resolves to the nearest still-proven source host for comments;
it cannot become a semantic source edit. Element duplication proves the complete
selected live subtree against one detached canonical parse cached only by the
exact immutable SourceIndex. Geometry-only React renders reuse that canonical
side, while command execution always revalidates the current live target and
private Runtime proof. Adjacent browser Text nodes compare as one continuous
text run; their object partition is not HTML content. Generated descendants,
opaque runtime surfaces and authored programs reject the entire selected subtree
at both toolbar and command boundaries without disabling independent source-backed
siblings. Every supported semantic source change materializes complete HTML. A
successful direct text/common-style/same-parent-reorder change also updates the
proved current DOM projection and ends without a deferred rebuild. Structure,
program-identity change, failed local projection or stale projection
authority rebuilds the disposable frame and reruns the author program. The
resource session may be reused only while exact authored script
markup/body identity is unchanged; a Script change requires a new generation.
`RuntimeFrameCoordinator` solely owns two fixed physical slots (`a` and `b`),
their monotonically increasing slot leases, the active/candidate identities,
and the `preparing → positioning → terminal` decision for every disposable
candidate. Stable state contains one active loaded slot and one empty inert
slot; it never allocates a third iframe or moves a keyed iframe between React
positions.
When a newer source edit arrives while a Candidate owns the inactive slot, it
replaces only the deferred latest request. The current Candidate first settles
and retires; if its source has become stale it settles as `superseded`, then the
latest request starts against the now-empty slot. It is not an authored-program
failure, and two revisions never concurrently reuse one inactive browsing
context or registration capability. Every load, activation, deadline,
animation-frame, microtask and
positioning result must prove the current candidate identity before changing
state; only the latest candidate may publish `ready`, `rejected` or `failed`.
The coordinator also owns the last-known-good frame identity and the native-edit
transaction gate; React owns only the fenced slot DOM, viewport and Selection
effects. Candidate Script runs while its slot is hidden; after validation React
positions that Candidate iframe without rewriting Active identity. Immediately
before the commit it re-captures the minimal anchor from the still-visible
Active frame, so Candidate-time scrolling or reselection replaces the older
launch snapshot. Native Edit remains available against that visible Active
until `beginPositioning`; starting an edit prevents this Candidate from
promoting and must keep the live toolbar and selection chrome. One commit then changes Active identity and visibility
together. Failure before that commit discards only the Candidate. If
`connectFrame` fails after the slot switch, the one-shot commit restores the
previous Active identity and `data-render-verified` attribute. That short
transactional rollback does not span the Candidate lifecycle and never rolls
back Working HTML. The former
active slot is cleared to an inert empty document on the next frame. A user
Native Edit or IME composition may let a candidate prepare but
cannot promote or retire a browsing context. Promotion waits until that
browser transaction has ended and its checkpoint has produced the latest
complete source HTML. A text Selection retained across the handoff is
presentation only and is discarded when its target or source text segments no
longer match, without blocking a fresh native edit session on the current exact
target.
An already necessary pending Runtime recovery follows later accepted source
revisions and clears only after the Candidate for that exact revision is fully
connected and promoted. Preparing or beginning a different operation cannot
clear it, and a failed post-switch connection restores presentation without
manufacturing recovery success.
The same one-time private capability returns an activation-result callback bound
to the source window, session, execution and frame token. Resource/bootstrap
errors report `activation-resource-failed`; synchronous author errors and
immediate unhandled rejections through the deferred `DOMContentLoaded` task
report `activation-author-error`; only an error-free activation reports
`activation-ready`. An author-error Candidate may promote only after its
source-host runtime-generated critical content is ready, and remains explicitly
`runtime-partial`; a source-authored SVG icon is not such proof, and a recognized
ECharts Candidate must expose the matching live ECharts instance.
Frame load, source proof and the verification token remain necessary but are
not sufficient for Runtime success. Reviewed query-free 5.4.3 and 5.6.0
ECharts core URLs resolve to their same-version SHA-pinned packaged bytes.
Other exact immutable versions use only their exact cache or bounded network
request. No cross-version substitution or second recovery session exists.
Every redirect used to obtain an exact immutable library must preserve its
version, core filename and query identity before those bytes can enter the
exact cache.
Main enforces two concurrent preparations and a bounded recent request-ID replay
window. Completed identities age out, so repeated ordinary use never exhausts a
permanent application-lifetime allowance or requires PageRoot to restart. An
unavailable resource remains a recoverable preparation state while its
independent bounded download is active. A terminal preparation, exact-resource
load, provenance or unfinished execution-deadline failure selects an explicit
script-disabled static Edit projection. A dynamic Candidate failure prepares
the latest Working HTML once more with Script disabled while the prior frame
remains visible. If Native Edit advances Working HTML before that deferred
static request starts, the stale request is replaced by exactly one request for
the newest complete HTML; dropping it may never leave `static-preparing` as a
terminal state. Static success promotes that latest editable source; static
failure preserves the prior last-known-good frame as read-only without rolling
Working back. The severe notice cannot be dismissed and retains reload plus
export actions. Direct unsupported, desktop-unavailable or preparation-failed
static pages use the distinct `direct-static-visible` projection and say that
the current static page is already displayed; they never imply a Candidate is
still preparing. Only transient preparation or execution failures expose an
effective retry. Retry always freezes the latest persisted
Working HTML/SHA observed at the click, never the failure-time request. A
successful retry removes the notice. The Workbench must not interpret iframe
`load` alone as Runtime success.
The frame coordinator is the sole owner of whether a physical
last-known-good iframe exists. It reports that settlement fact to
`EditAuthorRuntimeSession`; the application session never reconstructs or
caches its own boolean. The Canvas freeze contract reports the latest complete
working-source Hash separately from the visible verified-projection Hash and a
stale-projection flag. A preserved older iframe never advances the latter.
Only successful exact Candidate promotion or a proved in-place synchronization
publishes the newer rendered identity and `data-render-verified`; merely ending
a Native Edit cannot do so.
Canvas acknowledgement is presentation/cache authority only; it is not
authorization for save, export, AI freeze, project switch or close. Those
boundaries use the complete Working HTML plus exact persistence or recovery
evidence while retaining an older rendered Hash as an explicit stale fact.
They never substitute the working-source Hash for a missing or stale rendered
Hash.
Runtime DOM never becomes SourcePatch, Source HTML, save, Version, export,
Request, Candidate or Review input.

`data-pageroot-id` is persistent source identity, not Runtime edit authority.
An equal ID on another DOM object grants nothing by itself. Runtime source
proof is a private `WeakMap<Element, PagerootElementId>` sealed before author
Script activation: it answers whether this DOM object is the original parsed
source object. It is not a second identity. Offset-derived Source Node IDs are
not written onto Runtime DOM or Review HTML, do not authorize edits, and are never refreshed
across Working HTML revisions. For each Runtime
generation, the private source-object authority set is established exactly once
before author Script activation and is then sealed. A registered object may be
revoked when its live identity fails, but author code can never add another
trusted object after activation; generated, copied and forged nodes remain
display/comment-only. Exact parser-time execution order is not an Edit Runtime
contract: PageRoot may finish source parsing and authority registration before
activating parser-blocking, `async`, `defer` or module scripts. Reproducing every
edge timing must not reintroduce Runtime snapshots, freeze, per-node provenance
reconciliation or Script execution-state migration.

The supported compatibility surface is deliberately finite: parser-blocking
classic scripts, inline classic scripts, `defer`, import-free modules, author
`DOMContentLoaded` listeners and a first contained relative `<base href>` must
run in real Electron. Program identity and Main resource preparation use the
same first live-document `base[href]`; href-less base elements, inert
`<template>` contents and foreign-namespace lookalikes cannot win, while
absolute or escaping bases fail closed.
Only Script elements in the live parsed document enter execution identity;
apparent markup inside comments, raw-text elements or inert `template.content`
does not become an author program.
The bounded syntax recognizer rejects actual static and dynamic imports while
distinguishing comments, strings, regular expressions, property/private names
and module metadata. `import.meta` is metadata rather than a loading dependency;
the maintained parser is used only to recognize dependency syntax and does not
add module-graph loading.
The dependency surface is separately finite: the three standard, query-free
ECharts 5.4.3 and 5.6.0 minified core CDN URLs may use only their respective
same-version packaged files. Near matches, version ranges, unknown paths,
integrity-constrained tags and plugin/library scripts use exact cache/network
resolution or fail closed; they never use a version substitution.
The bootstrap may hold and redeliver `DOMContentLoaded`
after the supported non-async activation sequence. Module import graphs,
external/source-root-escaping bases and other non-equivalent programs must enter
the explicit static-degraded state rather than partially or silently execute.
Author `location.assign()` and `location.replace()` are blocked at the
direct-child frame navigation boundary; this is navigation policy, not author
API freezing. Popup/form guards and the existing resource/CSP boundaries remain
defence in depth.

The Edit Canvas has one normative experience/persistence contract. Direct
source text, common-style and same-parent reorder edits are reflected in the
current projection without a user refresh. After source and current-DOM synchronization succeeds,
high-frequency input, edit completion, target changes, waiting and ordinary
save must retain the same document and must not rerun author Script. A structure
or Script-dependent semantic operation, failed local projection or stale
projection authority may rebuild one disposable frame at its checkpoint;
unnecessary rebuilds are forbidden. A
rebuild restores the shared scroll position, exposed zoom context and
stable-element-ID selection when each target remains valid. Every completed
operation first materializes complete HTML and enters the ordinary Hash/CAS,
atomic-save and recovery boundary; close/reopen must reproduce source edits
from that HTML. Author Script then regenerates runtime presentation.
Host acceptance of that complete HTML is irreversible within the Canvas command
result: a later live-session rebase or projection failure keeps the accepted
source/history result and enters the existing recovery path. It cannot return
the pre-acceptance rejection outcome. Acceptance still does not claim either a
current visible projection or a successful persistence receipt.
These phase deadlines bound an unfinished wait. A settled current Candidate that
already passed its identity and readiness checks remains usable when reported
elapsed time exceeds a performance target; a cancelled, terminated, superseded
or expired Candidate remains ineligible and can never reclaim Active.

A soft checkpoint materializes delivered input as complete Working HTML,
allocates required Stable IDs and enters the ordinary autosave/recovery queue
without ending native editing. Continuous input, delete, paste, Enter,
composition completion, common text styles, autosave, Cmd+S, comment save,
attachment save and export use this boundary; they retain the iframe,
contenteditable host, Selection, caret and focus, and never start a Runtime
candidate merely to acknowledge persistence. On an editable static fallback,
the same checkpoint updates the Session's next retry input only after the
revision is persisted; it still does not execute Script. A hard leave ends native editing.
An in-place text Undo/Redo that proves every byte outside the editable island and
rebinds the mounted source surface is also terminal for projection work; it does
not leave a deferred whole-page Runtime refresh.
Text-range formatting always allocates any persistent wrapper through
SourcePatch, updates the current iframe in place and resumes the logical range;
only nodes imported by that trusted patch may extend Runtime's private source
authority registration. If layout safety rejects a wrapper-producing format,
source remains unchanged and the same native text session, caret and logical
selection resume in the current document. Author Script cannot gain authority
by copying public Stable-ID or marker attributes.
When its destination leaves Edit Canvas, `leave-canvas` records the same source
checkpoint but does not rebuild or start a candidate before departure, even
while a Runtime refresh is pending or the visible projection Hash is stale. An aborted
leave may later refresh as recovery; it must not clear the stale fact to
manufacture success. History retains its separate bookmark and canonical
adoption behavior.

This contract grants no Runtime DOM persistence, timer/rAF/Observer/listener
freeze, runtime snapshot recovery, Canvas/SVG pixel save, runtime/source
per-node reconciliation, Script execution-state migration, dual-iframe state
synchronization, or equality for random/time/animation state after reopen.
Presentation restoration is best effort and cannot widen source authority. The
lowest-complexity safe local update or rebuild remains the required design.

Review has no runtime-snapshot owner, BrowserWindow or PNG evidence path. Its
source layer compares the frozen before/after HTML, but user-visible
`ReviewChange` is position-bound: precise text, outermost element presence,
exact movement, parent-level ambiguous reorder, explicit authored attributes,
inline style and safely mapped simple-selector CSS enter filters, navigation
and projection. Whole-page CSS/Script differences that cannot bind to a
concrete Stable ID become private `ReviewDiagnostic` records; they cannot
create `<html>` markers, mask holes, outline entries or user-facing uncertainty.
`SourceEvidence` is only a bounded diagnostic plan for concrete hosts. One
`ReviewChange` keeps `evidenceStableIds[]`, so multi-host facts retain their
original change ID and exact character ranges.

The two Review frames may return best-effort Stable-ID-bound visible text,
computed presentation, image, SVG, Canvas 2D and runtime-descendant summaries
through a random-challenge `MessagePort`. Parser-time source-host references
reject disconnect, ID drift, duplicate claims and same-ID replacement, and a
later iframe load clears the old generation. This code shares the authored
frame realm and echoes a parent-provided source label; it is not an isolated
security oracle. WebGL, tainted Canvas, live media, running animation, hidden
surfaces, global budget overflow, unstable samples and stale generations remain
internal diagnostics. They do not create an `unverified` Review change or
banner. Runtime DOM remains observation evidence only; it never enters source,
save, Version, Candidate, Promotion, comment identity or persistence authority.

Candidate assessment also compares the frozen base HTML with the identity-
normalized Candidate HTML at the source-byte boundary. It computes Stable-ID
signatures in linear passes using parent ID and previous/next retained sibling
IDs; absolute sibling indexes are not evidence, so inserting a sibling does not
relabel every following element. Its `allowedScopeIds` closure contains each
frozen target root and all of its source descendants, plus descendants and
newly materialized elements that remain under a retained target in the
Candidate. A page-level `body`/`module` target covers the whole page and
overlapping roots are unioned. Deletions inside the frozen closure remain in
scope; an element moved out of a retained target is evaluated at its Candidate
location. The durable impact projection stores only
`changedElementCount`, `requestedTargetCount`, `outsideTargetCount`, at most 100
IDs in each changed/outside sample, and `truncated`; the complete HTML remains
the source of truth for on-demand Review analysis. These facts remain
task/version diagnostics rather than a floating Review warning: comment targets
remain context, never a subtree-exact source-write or Candidate-acceptance boundary. Runtime DOM,
Script-generated nodes and screenshots cannot contribute to the assessment.
Historical Candidate assessments with the old unbounded arrays remain readable
through the compatibility decoder; new records cannot mix the legacy and
bounded forms, and malformed partial impact evidence is rejected at the
durable Candidate boundary.

Prepared formal-review documents are derived from a cancellable
`ReviewAnalysisSession` that caches source-diff facts keyed to exact
before/after Hash, source path and bootstrap mode. Comment collections and
the current Review session are applied after a cache hit; they are not cache
identity and never authorize Candidate adoption. The multi-entry cache is
byte bounded at 32 MiB for those source facts only, not a second full prepared
copy. Parsing and annotation yield between phases,
and stale work stops before publication. Complete, valid and unique
`data-pageroot-id` enables exact persistent continuity and current-frame visual
enhancement. Absent, partial, malformed or duplicate identity makes visual
enhancement `unsupported`, but does not cancel source Review: the existing
semantic matcher remains the historical-source fallback. When Stable-ID
continuity exists, it distinguishes insertion from reorder and cross-parent
movement while added/removed subtrees retain the outermost-only rule.

Every planned observation settles internally to `changed`, `unchanged` or
`unverified`, but those verdicts neither replace deterministic position-bound
facts nor appear as Review status chrome. Observation is batched across frames
with one sample-wide node/pixel/time budget and never silently truncates
concrete candidates. Equal bounded summaries cannot prove arbitrary CSS/Script
behavior; unmapped source-only differences stay private diagnostics instead of
becoming a page-level claim.
`added`/`removed` whole-element facts own descendant text evidence. A moved
stable subtree compares each stable descendant against its exact before/after
ID counterpart through the existing semantic text diff, never through flattened
whole-subtree text. Text transferred between different stable descendants
therefore reports movement plus the corresponding removed/added text facts;
unchanged moved text produces no text fact. A cross-region stable-common root
suppresses only its own false addition/removal and traversal continues through
descendants, so images, modules and other non-text elements added or removed
during the move remain visible. Authored candidate regions and their pairing
are frozen before disposable Review text wrappers are inserted, and each
moved-subtree graph has a distinct semantic/geometry owner namespace. Review
markup therefore cannot steal root movement ownership or merge facts across
independent moved roots. The later one-sided candidate-region graphs suppress
only duplicate text evidence.
Attribute, inline-style and mapped simple-selector CSS facts likewise coexist
with simultaneous text facts. Ordered authored CSS and Script inventories may
be retained with task/version diagnostics, but adding a no-ID `<style>`,
stylesheet `<link>` or `<script>` does not manufacture a page Review marker.
Topology groups common IDs by source parent in one pass before sibling-order
analysis, and each parent's identified-child indexes are built once. Per-parent
rescans of the complete inventory and per-child rescans of siblings are forbidden.
Analysis-local signature caches and projection facts are
disposable; a trusted 25th distinct fact is an explicit analysis failure, while
an oversized serialized payload fails closed rather than being treated as a
complete review.

Exact completed review entries survive unrelated tab applications; only stale
in-flight analysis is cancelled. Candidate-ready state does not start analysis;
only the explicit Review command may populate the cache and it waits for complete analyzed documents before opening;
a Candidate with diagnostics but no position-bound change stays outside Review
and uses the existing no-effective-page-change result.

Successful Candidate adoption and stale Review invalidation clear the prepared
document cache immediately. Unmounting the Review workspace then releases its
paired preview sessions and iframes. Workbench keeps exactly one active Edit
Canvas mounted for the current document; script refresh stays inside that
editor's bounded A/B Runtime slots. Inactive document tabs retain only bounded
script-disabled static projections and never retain an `HtmlCanvasEditor` or
Runtime DOM. DocumentSurfaceCache may cover a pending tab switch; it must not
replace or inert the same document's live editor during text input or Runtime
refresh.

Formal Review has no runtime-snapshot supplement. The trusted
`AiReviewWorkspace` begins with the immutable static document pair and keeps
the analysis, navigation, masking and acceptance paths display-only. Inline
and browser Review use the same static contract.

Each change owns a side-specific `ReviewPresentation` derived from its actual
marker/evidence host. Ordered reveal steps currently admit a panel key and a
Stable-ID-bound `<details>` ancestor. Review coordinates both disposable frames,
waits for their presentation acknowledgements, then focuses the first change;
no reveal state is persisted to source. Review renders no non-blocking visual
status, scope card, candidate-attention notice or global Toast. A new Review
session hides the AI conversation once; an explicit user reopen remains visible
for that session.

Comment location remains a separate private capability. An opaque initial
bootstrap binding may identify a frozen before target for comment geometry, but
it neither reaches authored markup nor authorizes runtime host discovery. No
TargetRef, source binding or runtime output enters either review frame's
authored HTML or the Review fact list. Edit does not invoke any Review resolver
or owner and has no Review snapshot state; its disposable author-runtime
session is governed by ADR 0065. Edit screenshot/capture/projection count must
be 0.

For each Review side and active filter, overlay frames and context masking
consume the same final canonical projection records. All text facts and only
the active element change cut mask holes; other element changes retain quiet
page-edge revision bars until hover/focus. The mask is a session-, side- and
projection-epoch-scoped SVG luminance mask: a white full-page background
retains the dim rectangle and each emphasized record path is a black transparent
hole. Therefore overlapping emphasized facts stay transparent as a geometric
union; a full-page `evenodd` path is not a permitted representation. Reserved
mask background, hole and dim primitives reset authored fill, stroke, opacity,
filter and transform while preserving the current context-opacity value.

Comment layout is measured only after current disposable presentation is
applied. The Workbench accepts no card coordinates until the Canvas reports a
complete target set for the current rendered source Hash and applied generation;
missing coordinates remain an explicit recovery state and are never synthesized
from historical geometry.

Edit-mode content reveal is another transition of that same projection, not a
new owner. `HtmlCanvasEditor` may propose only an allowlisted source-backed
presentation action: the strict ARIA/HTML semantic adapter, native details and
local disclosures. Workbench accepts it only for the current document key and
preserves the shared page scroll position. The Canvas then applies the accepted
context without calling `onChange`, SourcePatch, authored handlers or
persistence. No React view may keep a second copy of this state for shortcut
handling or toolbar rendering. The rail's transient vertical offset is likewise
Workbench-owned presentation state: Canvas natural height supplies its bottom
bound, and neither the offset nor queued card height may become source, Draft
or Version authority.

Opening a user HTML may remain lazy until the first durable product action.
During that interval the renderer owns only an `epoch + sourcePath` locator,
not a registered project context. A registered context always has non-empty
`projectId`, `documentId` and canonical `sourcePath`. Registration is one
application transition owned by `WorkspaceController`: it adopts those
identifiers and activates Draft authority from the same Bridge response. If a
registered page later finds its Draft session inactive or bound to another
context, the Controller queries current workspace authority and safely rebinds
before creating a mutation; it does not leave an unchangeable close blocker.

Every registered mutation captures that complete ProjectContext once. The
Bridge resolves `projectId + documentId` against the registry before consulting
the mutable path and uses `sourcePath` only to prove that the command remains
inside the registered source or an explicit alias. Supplying exactly one ID is
invalid. Omitting both IDs is a temporary compatibility route that may address
an existing registration but may not create one; `/project/ensure` is the sole
creation boundary. `/project/open-classification` is an authenticated read-only
classifier: it must not write Registry bytes, create a project, or return raw
source keys, external absolute paths, hidden snapshot paths or HTML bodies.
Desktop Prepared Intent commit is the only path that may later call
`/project/ensure` for a class-C confirmation. Attachments and their compensating cleanup use the same
captured context, plus their composer/edit identity, for their complete
asynchronous lifetime. `CommentWorkflow` is the only renderer application
owner that may stage an attachment, call its Bridge repository, or compensate a
late write. Desktop attachments always use the registered project Bridge path.

`SourceHistorySession` is the sole Canvas undo owner. It owns one memory-only
cursor and at most 20 exact operation pairs for the currently open HTML, plus
pending-save evidence until autosave acknowledges it. React state may display
capabilities but cannot maintain a parallel stack. Switching HTML, closing the
document or restarting clears the cursor; recovery evidence may finish an
interrupted complete-HTML save but never rebuild undo capability. The preview
DOM, browser editing history, the retired Bridge journal and edit-audit list are
not current history authorities.

The semantic source-operation foundation is a pure pre-persistence boundary.
It accepts only complete identity-v1 HTML plus an operation carrying stable
operation identity, exact base revision, complete-source Hash and stable
ID/tag/outer-Hash target evidence. It returns complete next HTML, Hash, lineage
and a system-derived `identityDelta` plus a generated in-process inverse. The
stable ID is the sole element identity; tag, parent, order and outer Hash are
operation preconditions or change evidence, not alternate identities. Intent is lowered to SourcePatch, whose
apply path independently re-plans the operation before enforcing exact ranges,
outside-scope equality and parse integrity. The kernel may reuse a
`buildSourceIndex` result only when it still corresponds to the exact current
HTML bytes and a freshly computed Hash; that reuse is not a skip-validation
flag and not a persisted index cache. Runtime DOM is never an input.
Text, style, sibling reorder, insert, duplicate, delete and cross-parent move
already use this boundary. Canvas publishes the kernel's single SourcePatch
materialization, including tracked comment and selection target mappings;
SourcePatch is not a second public apply. Persistence checks remain independent.
Repository and Desktop Main do not own
or persist the semantic revision or the current-open history stack.

## Mutation protocol

Every durable command defines:

1. a stable operation identity;
2. the expected revision or Hash;
3. an idempotent acknowledgement;
4. explicit rejected and unknown outcomes;
5. an authoritative query used for reconciliation;
6. deterministic retry or a genuine user-owned semantic conflict.

Network failure after a mutation is an **unknown outcome**, not a rejection.
The client queries authority before retrying. A retry action must change its
precondition through reconciliation, refreshed identity, backoff or new user
information; resending the same known-stale command is forbidden.

An accepted Canvas semantic operation retains exact forward and reverse patches,
before/after source Hashes, a system-derived identity delta, bounded logical target snapshots and optional
Selection only in the current-open renderer session. Autosave receives the
resulting complete HTML and operations as identity/save evidence. Repository
independently parses each before/after HTML pair, recomputes its ID-set and
topology delta, validates the complete public operation schema/envelope plus
type-specific fields, and cross-validates that fact against the operation and
delta. Insert and subtree replacement additionally reconstruct the exact
identity-free result by removing only kernel-form identity attributes, then
require those bytes to equal `operation.html`; fresh-looking IDs alone are not
allocation authority.
All four structural operations then pass through the same pure structural plan
replayer used by Canvas. Repository compares the whole retained patch array,
including comment-aware same-parent reorder, so no valid move/delete/insert/
replacement can authorize an additional source change. The shared planner also
owns the safe parent boundary and explicit-end/void/source-self-closing sibling
preconditions, preventing Repository from accepting a reorder Canvas rejects.
Native editable-island `<br>` nodes receive fresh IDs in the accepted Canvas
plan before `setText` is formed, and Repository binds that operation to one
exact target-content patch and the shared materializer's normalized
`contentHtml`; multiple new line breaks must retain their declared allocation
order, not merely the same ID set. Deleting a hard break retires that break
identity with the node; other persistent element identities remain fail-closed. Canvas copies only
those accepted IDs onto the matching live line-break objects under its expected
mutation guard. The controller first proves the prior live DOM still equals its
owned canonical draft, then proves the reconciled live DOM equals the newly
saved canonical island before advancing both owned and baseline state without a
page reload; this identity update does not grant Runtime source authority. Plain
`setText` uses one shared Canvas/Repository planner that rejects void/raw-text
targets and binds the exact target range, original bytes, canonical escaped
text bytes and patch kind; decoded-equivalent entities and extra patches fail
closed. Repository also independently reconstructs the complete original-
forward patch plan for `replaceTextRange`, `setAttribute` and non-range
`setStyle`, including authored attribute spelling/quote form and canonical
inline-style placement; missing, substituted or additional patches fail
closed even when Hash, inverse, topology and `identityDelta` are self-
consistent. Range-style wrappers are independently reconstructed from the
operation's logical range/quote, canonical guard and declaration, exact source
offsets and fresh ID list. When the same range canonically coalesces onto the
whole target or its existing immediate wrapper, Repository instead requires
that exact inline-style plan; a partial range without wrapper identity evidence
fails closed. Canvas and Repository share one text-host capability, so
dedicated-editor roots and foreign-content ranges fail at both boundaries.
Canvas and Repository share the pure editable-island normalizer and
single-CSS-value declaration validator, so exact self-consistent evidence still
cannot change protected island attributes or inject another CSS declaration.
The same proof selects the original forward patches when validating undo;
self-consistent wrapper inventories or legacy patch kinds are insufficient.
Exact SourcePatch replay proves only the byte/Hash/CAS/recovery chain; patch
`kind` cannot authorize identity changes. Undo or redo creates another normal
complete-HTML save; its inverse is session-local exact restore evidence, not an
externally authorable or persistent semantic command. There is no durable
history action ID, cursor CAS, history candidate or restart migration.

The file contract is intentionally single-path: the external original and
hidden V1 preserve the first-import bytes without PageRoot Stable ID metadata,
while the visible V1 Working Copy may contain materialized IDs and therefore
need not be byte-identical. AI Candidate HTML is normalized with Stable IDs
before promotion; V2 and later immutable Versions preserve the complete
accepted Candidate HTML and may contain those IDs. A new V2+ Working Copy is
initially byte-identical to its corresponding Version snapshot, and later local
editing changes only the Working Copy. Stable IDs never write back to the
external original. The only export copies the complete current Working Copy,
including its IDs, through the existing protected atomic file-copy path; it does
not update Project, Version, Registry, Recent or the current open file.
Undo/Redo remains session-local to the current open document and never becomes
formal Version history.

Autosave then enters `ProjectFileRepository`. It is the only live Bridge-side
owner of the current-source write for a registered v4 Project File. The retired
v3 `SourceTransaction` kernel is not on this path. An AI Version publication
remains a separate immutable transaction. Undo/Redo has no Bridge action route
or persistent journal.

That same Repository is the sole source-element identity migration owner. New
imports preserve the external file and immutable V1 snapshot while writing an
identified managed Working Copy. A legacy registered Working Copy migrates only
on editable workspace hydration, after normal save recovery and external-change
reconciliation. The transaction seals exact before/after Hashes and complete
recovery bytes, uses the Working Copy CAS writer, then publishes the state schema
marker, canonical ID/tag/parent/order binding Hash and fresh manifest file
identity. Restart accepts only the sealed old or new side. A clean external edit
may reconcile only when that binding Hash survives; a changed or missing binding
requires explicit force-unlock before a new controlled migration. Invalid
identities, an unresolved save state or third-party bytes fail closed; no
historical Version, Request, Candidate or Runtime DOM is serialized.

The Repository is also the sole AI Candidate source-identity validator. The AI
continues to submit one complete HTML document; comments and text ranges provide
context but never restrict that document to one target subtree. The frozen
identity-complete HTML is the only comparison base. Retained elements must keep
their unique IDs even when tag, parent, order or content changes; those facts
are Review evidence, not a second element identity. Duplicate, malformed or
invented IDs fail closed. When exact source or stable retained
neighbours show that an existing element merely lost its ID, validation also
fails closed instead of guessing. An equal-cardinality repeated exact-source or
stable retained-neighbour group fails closed when it proves identity stripping
even if individual members remain ambiguous. Only after those checks may
identity-free elements be classified as new and receive Repository-allocated IDs.

The Repository seals the submitted-output Hash separately from the normalized
complete Candidate Hash and persists one identity report containing retained,
deleted, added and assigned counts plus both binding hashes. Review and explicit
Promotion consume that normalized Candidate; it cannot overwrite the current
Working Copy before adoption. Existing schema-v4 Candidate records without the
optional report remain read-only compatible and are never rewritten. Runtime
DOM, generated nodes, computed style and pixels are not Candidate identity or
persistence evidence. See ADR 0067.
Every structural Canvas edit now enters the semantic boundary. New fragments
must be identity-free and receive kernel-owned IDs; duplicate cannot inherit an
existing ID, move preserves IDs, delete retires the exact target subtree, and
replacement retains its root while replacing descendant identities. `setText`
retains the target but may retire authored descendants. New inline wrappers and
line breaks receive kernel-owned IDs recorded in the same identity delta. A
successful semantic save reseals the exact tag/parent/order binding; this seal
detects later external topology drift but is not a second element identity.
Without semantic proof, additions, removals, swaps, transplants, forgeries,
duplicates, tag changes and moves all fail closed.

Current managed TargetRefs add `elementId` and the expected canonical source
Hash, refreshed by deterministic current-source rebind. A complete managed
Working Copy selects one official resolver contract: only the valid unique
SourceIndex ID entry may resolve. Tag changes retain that identity; deletion
or a missing/invalid ID is orphaned without heuristic fallback. Selector,
ancestor-fingerprint, source-offset and text-affix scoring are not an official
result and are not retained as a shadow path. Incomplete identity HTML may
resolve the same-revision source-anchor only; it cannot rebound across a
hash change and cannot enable direct Canvas edit. A source target that survives while its
current Canvas projection cannot display it remains the same target with a
missing/hidden presentation state, never a guessed replacement. `targetId` remains per-record identity; optional selected-text
locators are UTF-16 ranges inside the owning element's decoded descendant text.
Whole-page comments use the body's `elementId`. Immutable
Version records are never rewritten. See ADR 0061.

A Renderer-applied history result may advance the mounted editable-island
projection without replacing its iframe only after exact old/new target
resolution through the recorded TargetRef transition, byte-equal source
prefix/suffix outside the island and a complete next-`SourceIndex` DOM mapping
all succeed. This is a projection optimization, not another history application
path: the session applies exact source patches locally and persists the complete
result through normal autosave. Failure at any proof point retires the frame and
loads the canonical source through the normal verified fallback.

The Renderer history stack is bounded to 20 edits and resets at an open-document
boundary. A forward edit after undo truncates redo. Source mismatch never
attempts best-effort patching and never serializes preview DOM; it clears the
session history or reports the existing source conflict.

An inode change is not by itself proof of a new document because PageRoot's
same-directory atomic replacement intentionally changes it. The Bridge may
repair the registered file identity only when current source bytes match the
registered current Hash, a compatible legacy document stamp, or the durable
target Hash in the existing project's `pendingWrite`. No other Hash or path
observation may silently relink or create a project.

Comment deletion tombstones and processed operation identities are durable
draft data. Attachments must be tied to a durable comment operation or cleaned
as unreferenced staged data. The draft artifact carries the authoritative
revision needed to recover the crash window between artifact replacement and
runtime-pointer refresh.

No durable command may be constructed with empty identity fields. In a
persistence-capable app, starting a comment composer counts as a real project
action: registration may begin eagerly, and confirming the comment must await
that identity so the visible comment and its recovery record have one owner.
The pure browser preview is explicitly non-durable and may demonstrate a
temporary comment without claiming that it was saved.

One unresolved failure has one visible recovery owner. A source persistence
failure takes precedence over a Draft persistence failure on the workspace
status-banner surface; when it clears, an outstanding Draft failure may own the
same surface. Views must not duplicate either issue in the comment rail.
User-visible error text is derived from stable product codes and must
not expose bridge fields, local paths, Hashes or raw exception messages.

## React effects

Effects are for DOM integration, subscriptions and timers. Business
persistence is invoked by an application session or coordinator. Adding an
effect that writes because several React values changed requires an ADR and a
behavior test proving there is one write authority and no feedback loop.

## Drain boundaries

Close, project switch, Request freeze and history navigation consume the same
registered obligations:

- native edit checkpoint;
- source autosave;
- draft/comment persistence;
- attachment staging;
- project-rule persistence;
- Request freeze or outcome reconciliation.

`WorkspaceController` owns exactly one `DrainCoordinator`; workflows and
injected Sessions register obligations on that coordinator instead of composing
dirty booleans in React. `ProjectWorkflow` owns the request-scoped desktop close
lifecycle. The Workbench close listener synchronously registers only
`detail.waitUntil(controller.prepareClose(...))`; abort and browser fallback are
commands to the same workflow, not parallel close authorities.

`CommentWorkflow` supplies the `draft/comment persistence` and `attachment
staging` obligations; `ProjectRulesWorkflow` supplies `project-rule
persistence`. `ProjectWorkflow` delegates those obligations without reading
React refs or reproducing mutable snapshots; Workbench only renders the
Controller projection and dispatches durable commands.

A Canvas undo/redo request uses the same native-edit checkpoint and source
autosave obligations before it reads the Renderer memory cursor. It does not
drain or mutate comment cards, attachments or project rules. Focused native
text controls keep their platform-local input history and do not invoke this
Canvas drain. Project-rule autosave is not eligible while its native control
owns an active composition; explicit restore retires that control before
adopting the saved value.

Each obligation reports pending, draining, resolved or blocked. A blocked
result includes an action that changes the condition. Entry points must not
copy their own boolean lists. An obligation may request a final verification
without reporting permanent pending state; an already acknowledged aggregate
must drain as a no-op without advancing its revision.

Source durability and detach protection are separate facts. A failed/conflict
source write may resolve the reversible switch/close obligation only after
`DocumentWorkflow` writes and reads back the exact current revision from the
Main-owned recovery journal (or verifies an exact export receipt) and matches
`workingHtmlSha256 === canvasRenderedSha256 === protectionHtmlSha256`.
`persistedSourceSha256` remains the last disk-confirmed Hash and is not required
to equal those three values after a failed write. That evidence never changes
`persistState` to `idle`,
never authorizes an irreversible overwrite, and remains document-scoped. Tab
layout persistence is restart-convenience metadata and is excluded from the
content-safety close aggregate.

The recovery-journal identity is project + document + Working Copy + revision
and HTML Hash; `sourcePath` is a rebased location. A path change requires the
prior journal receipt and an exact CAS rebase. Document HTML crash recovery
reads only that verified Main journal. Browser RecoveryStore records are
comment-draft metadata and never contribute HTML bytes, recovery identity,
audit events or history operations to `DocumentWorkflow`.
Journal writes retain at most one in-flight record and one latest pending
record. Startup scan failure degrades the journal capability without preventing
window creation; bounded scans isolate corrupt entries and Start lists only
verified summaries. Draft, PROJECT.md, attachment and other non-HTML drains
retain their existing owner-specific policies and are not reclassified as HTML
protection evidence by this contract.

After the aggregate drains, `ProjectWorkflow` asks `DocumentWorkflow` to
reconcile source close readiness against the independently hashed frozen HTML
and `DocumentSession` authority. An acknowledged
revision may be ahead of the cutoff. A stale Canvas Hash or renderer projection
is not itself a blocker; only an unresolved exact-byte check may trigger the
bounded authoritative source read. Matching bytes repair the projection, while
confirmed divergence or invalid source integrity remains fail-closed in its
owning renderer recovery surface.

Electron may automatically repeat a transient close request once. It must
first send `close-aborted` for the exact request and release renderer/navigation
freeze ownership. A second blocked result returns to an operable window; a
fixed-interval unbounded retry is not a recovery state.

A lazily opened page with no durable material closes as a no-op and remains
unregistered. If it contains a comment, composer recovery, tombstone or edit
audit, the Draft obligation first completes project registration and authority
binding, then drains the aggregate.

## Compatibility

Compatibility belongs at one versioned decoder or route adapter per retired
producer. Each fallback must state the old producer, removal condition and
focused coverage. Domain and view code use only current canonical states.
Inline aliases and permanent “just in case” branches are not allowed.

The supported compatibility adapters are:

- An exact pre-hardening V4 `.pageroot-registry.json` may complete its missing
  Registry-only root identity metadata through `ProjectFileRepository`. The
  current shape is validated and read without a write. The historical shape
  must have exactly `schemaVersion: "4.0.0"`, no `pendingImports`, and only
  `{ projectRootPath, updatedAt }` project records. Every record must prove its
  ID, direct-child non-symlink root, real-path containment and matching
  `.pageroot/project.json`; current `rootFileIdentity` comes from that live
root stat, never a filename or HTML Hash. A short-lived exclusive migration
lock serializes this replacement across Bridge processes; sealed dead-owner
reclamation first atomically claims the exact token-named marker, while an
unsealed or malformed lock fails busy. After acquiring it,
the repository re-reads the Registry and returns a current record without a
write when another process already completed it. All entries validate before
the old raw bytes are backed up by Hash and the full current Registry is
atomically published. A failure preserves the old Registry, cannot reset or
reassociate a project, and grants no write authority. Remove this migration
  only after a read-only Registry census proves the exact historical shape is
  outside the supported upgrade window.
- Complete PageRoot 0.9.0 v3 project records whose registry, `project.json`,
  initial Version and existing `projects/<projectId>` directory prove one
  identity may gain `displayName`, `createdAt` and
  `storageDirectoryName=projectId` in place without renaming or scanning
  directories. Remove this adapter only when 0.9.0 project records leave the
  supported upgrade window. v1/v2 and incomplete records remain unsupported.
- Draft commands must carry a current `draftop_` identifier. Missing
  `operationId` values fail closed. Previously persisted
  `draftop_legacy_*` acknowledgements remain readable opaque IDs; nothing
  creates them. Direct-edit ingress accepts only
  `basedOnVersionId` / `revision`. Unknown fields fail closed.
- Candidate records require `identityReport` and `submittedOutputSha256`.
  `candidate-assessment.json` accepts only the current bounded impact shape.
  Retired executable-surface fields and full-array impact facts fail closed
  there. Historical Version records may still store the retired full-array
  impact shape; `candidateAssessmentFromRecord` projects those arrays into
  bounded counts and samples in memory and does not rewrite the file. Review
  display consumes only that bounded result.
  Sealed HTML Hash verification still runs for current assessments.

The full producer, fixture, persistence and deletion-evidence register is
[`COMPATIBILITY.md`](COMPATIBILITY.md). The legacy Release
`update-manifest.json` is a historical-client distribution artifact, not a
current application compatibility decoder.

## Change requirements

A change affecting state, persistence or lifecycle must include:

- owner and transition;
- late-response behavior;
- crash and unknown-outcome recovery;
- close/switch/submit impact;
- behavior and failure-injection coverage;
- updated architecture or product documentation when the contract changes.

Source-string tests are reserved for packaging, dependency and security
boundaries. Runtime coordination is proven through public behavior, bytes,
Hashes, state transitions and fault injection.

### Architecture gate assertion forms

`scripts/check-architecture.mjs` enforces the boundaries above as six explicit
responsibility groups:

- `layerBoundaryViolations`: import direction between Domain, Application,
  Views, Bridge and build scripts;
- `ownershipBoundaryViolations`: the single runtime composition root and the
  approved persistence owners;
- `escapeBoundaryViolations`: typed Bridge access, browser persistence,
  endpoint knowledge and provider-neutral workflow boundaries;
- `retiredArtifactViolations`: deleted production modules, their imports, and
  retired compatibility identifiers (`commitPendingEdit`, `baseVersionId`,
  `editEvents` and related aliases).
- `dialogPolicyViolations`: `dialog.showErrorBox`, ordinary
  `dialog.showMessageBox`, and unregistered `window.confirm`. The only remaining
  native error box is the startup failure that happens before a renderer exists.
  Content-loss confirms (delete, overwrite, abandon unsaved edits) must be
  registered in `ALLOWED_WINDOW_CONFIRM_PREFIXES`.
- `noticePolicyViolations` plus the inventory ratchet in
  `scripts/notice-policy.mjs`: production `setToast` creates must stay at 0.
  `NoticeBar` JSX, `background-result` and `uncatalogued` literals are frozen to
  `scripts/notice-disposition-ledger.json`. Counts may only decrease. New
  wrapper aliases of `setToast` fail. Remaining ledger sites are N5
  `GlobalInterruption` kinds; the allowlist may only shrink. N0 success
  notices, N1 internal reliability notices, N2 existing-control notices and
  N3 workspace-safety toasts are already deleted. Workspace safety uses the
  existing persist/unavailable banners via `WorkspaceSafetyState`.

The gate uses structural queries from `scripts/architecture-ast-query.mjs`
(`moduleSpecifiers`, `callNames`, `callExpressions`, `jsxElementNames`, `newExpressionNames`, filesystem-write
classification and literal comparisons). These queries operate on dependency,
call, construction and data-category facts. They do not assert private fields,
private methods, exact object properties or the spelling/order of a business
call, so a responsibility-preserving rename or reflow cannot fail the gate.
Document-content checks remain in the ADR and packaging gates where the text or
artifact itself is the boundary.

The gate must not assert that a specific code fragment *exists* by substring or
by ordered substring (`String.prototype.includes` on code, ordered marker
lists). A required behavior is proven by a behavior or fault-injection test, not
by matching its source text.

#### Review behavior test debt

Converting the gate away from ordered source-string matching exposed renderer
behaviors whose ordering guarantees are now asserted only structurally (call
presence), because the repository has no DOM test harness for
`HtmlCanvasEditor.tsx`. Native deferred-command arbitration now has a Node
unit test on `html-canvas-native-commands.js` (system work blocked by a pending
user-explicit command, supersede, and stale-lease drain). The remaining items
still need Electron/Playwright behavior coverage:

- Canvas fail-closed freeze: a source transition must abort when
  `freezeNow()` fails or returns bytes that differ from the live source.
- Canonical host replacement: the native lease must be disposed before the
  authored DOM host is replaced.

### Complexity budget ratchet

`scripts/architecture-budget.json` records a line count and total React-hook
count ceiling for files with a demonstrated regrowth risk (currently
`app/workbench.tsx`, `app/components/HtmlCanvasEditor.tsx` and
`bridge/project-file-repository.mjs`). The gate counts hooks structurally, so generic-typed calls such as
`useState<T>()` are included.

This is a guardrail against silent drift, not a hard cap, and it is deliberately
not applied to every large file:

- Exceeding a ceiling is advisory only: the architecture check prints a visible
  notice naming the low-friction escape valve — if the growth is intentional,
  raise the number in the same change — but a budget notice never fails the
  gate, CI or merge, and no test asserts the ceilings. Growth is allowed, but
  it must be a conscious, reviewed decision rather than silent drift.
- Lowering a ceiling is not an acceptance goal. Do not split a module only to
  reduce `maxLines`.
- When a file shrinks for a real invariant boundary, the check may hint to
  lower the ceiling; that hint is observational.
- Prefer a narrower public command surface over moving lines to a new file
  that still exports the same illegal state combinations.

The budget is a trend brake, not a design target. There is no enforced descent
schedule; the numbers track real progress, they do not mandate it.
