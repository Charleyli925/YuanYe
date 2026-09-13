# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action, registered identity, renderer generation and late-query fence | Renderer `ProjectSession` | active-file record before registration; project registry and `project.json` afterwards | Application workflows and the Controller aggregate snapshot |
| FIFO OS/QoderWork HTML-open requests, the single renderer-delivered head awaiting explicit acknowledgement, committed-exit handoff, plus active/recent-project transitions | Main-process external-file-open mailbox and `ProjectOpenQueue` | in-memory for the current process plus one private, validated `userData` handoff record after close commits; no renderer-supplied path authority | preload lifecycle delivery, startup adoption and trusted project IPC; Main never publishes the next head before renderer accept/cancel/reject acknowledgement |
| Prepared A/B/C open intent, commit receipt and one-shot original-file trash disposition | Main-process `desktop/prepared-html-open.mjs` store | none; process memory only; delete consent is never persisted | trusted project IPC and `ProjectWorkflow` commit/finalize/rollback |
| Open-confirmation busy/retry projection and optional delete-original consent | Renderer `ProjectWorkflow` | none; reset per request and cancelled on close | Workbench auto-confirms ordinary import/reopen; delete-original keeps a registered confirm |
| External HTML request IDs, active/queued/deferred renderer delivery, blocker-transition/manual retry policy and unaccepted-result fence | Renderer `ExternalFileOpenSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Accepted local/external project results, their FIFO renderer publication and deferred final-fence blocker-transition/manual retry policy | Renderer `ProjectApplicationSession` | none; bounded in-memory state only | `ProjectWorkflow` composition and Workbench presentation |
| Registered mutation context resolution and atomic-replacement source observation | `ProjectFileRepository` (`bridge/project-file-repository.mjs` façade; internals under `bridge/project-file-repository/` do not become a second owner) | v4 `.pageroot-registry.json` plus the owning Project File working copy and `.pageroot` metadata | Bridge mutation routes and `/project/ensure` |
| Canonical external-source path → unique `projectId` lookup, first-import Hash relation, and read-only A/B/C open classification | `ProjectFileRepository` | Registry `importSourceKey` / `importSourceSha256` pair plus the bound project's current active Working Copy | `/project/open-classification`, `/project/ensure` and Desktop Prepared Intent |
| Registry project-catalog membership, availability and validated registered-project OpenTarget resolution | `ProjectFileRepository` Registry reader | Registry `projectId → registeredProjectRootPath` records plus validated per-project metadata; Desktop Recent may rank but never add/remove/authorize a member | read-only catalog route, `ProjectWorkflow` projectId open command and Workbench project list |
| Runtime Bridge/Session/workflow composition, aggregate-observer lifecycle, registration operation identity, single-flight, stale-result fence and cross-Session publication sequence | `createRuntimeWorkspaceController()` and `WorkspaceController` | none; the factory creates the one fact-owner set and the Controller publishes only frozen aggregate projections through existing Project, Document, Comment, Draft, Version and SourceHistory owners | Workbench aggregate-snapshot subscription, Controller commands and presentation-event adapter |
| Desktop workbench navigation admission, receipt and tab order/active/pending/mounted/runtime-owner identity | Renderer `WorkbenchNavigationSession` owns the transaction phase/receipt and `WorkbenchTabsSession` owns the tab projection; the Controller-owned `WorkbenchNavigationWorkflow` is the only coordinator | validated `workbench-tabs.json` stores only `tabId + projectId + documentId` and the active document tab; it is restart-convenience metadata written best-effort, with no close veto and no path, title, HTML, Hash, Request, Candidate, Version or Conversation authority | Startup/restore, local/recent, registered/sidebar/tab, OS-external and confirmation all enter one ordered admission stream; ProjectWorkflow applies the tab mutation synchronously through the correlated application receipt before its presentation event |
| Read-only tab display projections, hot/warm LRU order and per-tab Canvas mode/PageViewContext/scroll restoration | Controller-owned `DocumentSurfaceCacheSession` owns source projections; Workbench owns at most five mounted inert static iframe presentations and exactly one active `HtmlCanvasEditor`; `WorkbenchNavigationWorkflow` only touches/removes projection entries | none; bounded process memory only, maximum five static display iframes, one active Edit Canvas and its bounded editor-internal A/B handoff slot, 20 HTML entries and 32 MiB of source projections; inactive tabs retain no editor or Runtime DOM | pending tab presentation may show a script-disabled cached frame while canonical registered-project open validates the sole editable authority; the cache never covers the same document's live editor during text input or Runtime refresh; Runtime DOM never enters this cache contract |
| Project hydration generation and load outcome, switch/open operation, accepted-result execution, close request identity, project-switch publication, Prepared Intent commit after confirmation, and the unified managed-source prepare/commit handoff for Candidate promotion, historical Working Copy continuation and Registry opens | Renderer `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through existing Session owners and trusted ProjectOpen/Canvas ports | Workbench commands and presentation-event adapter |
| Durable source filename transaction, pending operation and active/recent path rebase | Desktop source-rename transaction | active-file `pendingRename` / `lastRename`, then filesystem path | trusted desktop rename port and Bridge relink |
| Current active managed Working Copy restart cache | Main `activeManagedLocator` in the private active-file record | none; non-authoritative, fail-closed cache of the last verified identity tuple and path. Registry plus project metadata remain the only write authority. Missing cache never guesses by name or Hash | startup `getActiveProject`, Finder locator reconcile and trusted `reconcileActiveManagedSource` IPC |
| Renderer source-rename and Finder locator rebase, expected Hash/context fence, lost-response reconciliation and synchronous Project/Document/Run publication | `ProjectWorkflow`, composed by `WorkspaceController` | none; it publishes through the existing Session owners after desktop/Bridge validate the same identity tuple. Present-file directory hints only hash-observe; missing-path hints, startup and title-bar rename drain switch and rebind | Workbench filename intent, directory-change hints and presentation-event adapter |
| Current source bytes, disk-confirmed Hash, working-HTML Hash, edit revision, persistence projection, pending write, single-flight source flush, Canvas-rendered Hash, exact-byte boundary reconciliation and protection evidence | Renderer `DocumentSession` owns current bytes/state; `DocumentWorkflow` owns revision/context-bound verified recovery/export receipts | source HTML and runtime autosave record; Main owns the atomic per-document recovery journal; journal path is a CAS-rebased location, and the Canvas generation itself is disposable | Canvas acknowledgements authorize presentation/cache reuse only. Save/export/AI/leave consume complete Working HTML and exact persistence or recovery evidence; a stale rendered projection remains a distinct honest fact |
| Force-unlock of a Working Copy conflict (adopt disk Hash as `saved`, no HTML write; clear `runtime.activeRequest` if present; keep `lastPersistedRevision`) | `ProjectFileRepository.forceUnlockWorkingCopy` via `POST /conflict/resolve` `force-unlock` | Working Copy state record and runtime request pointer | `DocumentWorkflow.forceUnlockConflict` / `reloadAuthority({ acceptExternalConflict: true })` and the conflict banner |
| Allowlisted GlobalInterruption | Renderer Workbench via `globalInterruptionPresentation()` | none; closed kind union only | existing `NoticeBar` with `className="toast"` |
| WorkspaceSafetyState | Renderer Workbench derived from `workspaceIssue` / persist / pending-exit | none; at most one kind | existing workspace-unavailable / persist banners and chrome status |
| Current-source commit, same-directory two-state CAS replacement (`prepared` → atomic rename → `committed`) and Project File settlement | `ProjectFileRepository` | source HTML working copy and `.pageroot` runtime/autosave records; the save journal is two-state CAS owned by `ProjectFileRepository`; each `#serial()` turn caches one verified project root (realpath, not a symlink) | `/autosave` route adapter and restart recovery |
| Managed Working Copy source-element identity schema, sealed binding Hash, one-time materialization and crash recovery | `ProjectFileRepository` (`working-copy.mjs` supplies pure inspection/materialization/binding and CAS paths; the façade owns transaction sequencing) | current Working Copy HTML, `working-copy-state.v4.sourceElementIdentitySchemaVersion + sourceElementIdentityBindingSha256`, manifest file identity, committed `source-element-identity-migration.v1` transaction and temporary complete before/after recovery bytes | editable workspace hydration; external clean edits must preserve the sealed ID/tag/parent/order binding or require explicit force-unlock; `IslandEditingController` and the text-range style planner preserve existing IDs and allocate them for new inline source descendants, while normal save verifies every prior claim and fills only valid new-element omissions; historical Versions, external originals, Runtime DOM, comments and Review are not consumers with write authority |
| Pure semantic document revision, accepted operation lineage, system-derived identity delta and generated in-process inverse | `SemanticOperationKernel` | Canvas supplies current source/revision and receives complete HTML from one kernel apply; tracked comment/selection refs pass through that apply. An owned `SourceIndex` may be remembered on a live semantic state object for those exact bytes only; it is not a second fact owner, Session, or history pool. SourcePatch remains an internal exact-range materializer, not a second public edit API | text/style/reorder and stable-ID insert/duplicate/delete/move/replace paths; Repository independently verifies the delta but does not create semantic authority; Desktop, Runtime DOM, AI and Review do not own this state |
| Current-open Canvas undo/redo context, at most 20 exact Patch pairs, cursor and pending-save evidence | Renderer `SourceHistorySession` | bounded process memory only; recovery may retain exact save evidence but never a restorable cursor; no Bridge action route or persistent history schema exists | Canvas, Document session, desktop Edit intent router |
| Durable AI Conversation, its Contexts, Turns and terminal messages, the per-Document current-conversation pointer and the Composer draft | Bridge-owned `ConversationRepository` in `bridge/conversation-repository.mjs` is the only writer | `.pageroot/conversations/`: one record per Conversation plus a per-project index and a separate small draft record, all atomically replaced. A Conversation belongs to exactly one Document, so a cross-Document read fails closed on identity rather than being filtered at read time. `sequence` is assigned from the record's own `lastSequence`; the single writer makes strict increase need no coordination. A streaming fragment is never written: `draft`, `queued` and `streaming` are refused, so every stored message is terminal and crash recovery repairs nothing. A stored message carries no interface member | typed Bridge routes `/conversation`, `/conversation/list` and `/conversation/draft`; renderer receives a read projection only |
| Renderer conversation projection, load status and unsent Composer text/intent | Renderer `ConversationSession` | none; it holds a disposable projection of the Bridge record. Switching Document clears it before the next load so one Document's messages can never appear under another | AI sidebar through the aggregate `WorkspaceController` snapshot |
| Conversation load ordering, document-keyed response acceptance and debounced single-flight draft persistence | Renderer `ConversationWorkflow`, composed by `WorkspaceController` | none; it publishes only through `ConversationSession` and reads only the Bridge projection. A response for a Document the user already left is discarded; draft writes capture the original document identity and latest text before deactivation; failed captures stay in the workflow until acknowledged and are restored on reopen. The Controller registers this workflow with DrainCoordinator so switch/close await writes; a failed close drain never claims the draft is saved. The existing ProjectWorkflow close phase freezes both draft command ingress and the input during preparing/ready, so a later drain cannot admit unsaved text; a failed/aborted close returns to idle and restores editing. | AI sidebar commands on `WorkspaceController` and the typed Bridge client |
| Focused comment/rules/filename text input undo history and active composition | The native text control and Electron/Chromium editing engine; `ProjectRulesSession` records rules-editor composition and the workflow owns its eligibility/explicit restore orchestration | in-memory control-local history only | desktop Edit intent router, `ProjectRulesWorkflow` |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Draft snapshot recovery sequence/operation, attachment upload count, in-flight attachment identity and stale/cancel compensation | Renderer `CommentWorkflow` | recovery store is crash-only; Draft aggregate and managed attachment repository remain the durable authority | `WorkspaceController.comments` projection, aggregate compatibility snapshot and `ProjectWorkflow` drain |
| Renderer comment/edit-event working copy, deletion tombstones, composer fields and saved-comment edit session | Renderer `CommentSession` | none; disposable projection until Draft acknowledgement | `WorkspaceController.comments` projection, Draft session and Request preparation |
| Comment-rail composer/edit/focus/target-loss disclosure, delete confirmation, draft target reselection, input refs, card measurement, virtualization, paired reveal/focus, Canvas selection and source-tagged target geometry | `CommentRailContainer` and `commentCanvasPort` | none; disposable React/adapter state only, never a comment fact | comment rail view; Workbench host commands may read current presentation intent without subscribing the root render |
| Acknowledged comments, edit events, tombstones and operation identities | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | Draft session and Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| Active/background AI run projections, per-Request Agent delivery mode/session status, recovered handoff-risk disposition, background results, submission phase/unknown-outcome lock and renderer operation locks | Renderer `RunSession` | none beyond authoritative runtime and immutable Request/Attempt records; ACP events are bounded presentation evidence, never Candidate authority | `RunWorkflow`, conversation sidebar, drain coordinator and project context |
| Renderer Agent provider availability, selected provider/runtime/model/reasoning, bounded public model catalog, installable/installSource/installState projection and selection-keyed preflight cache | `AgentCatalogState` | Settings consumes the Bridge-owned four-fact `AgentDiagnosticSnapshot`; diagnosis is selection-keyed single-flight, never owns a ticket or changes selection, and cannot erase stronger preflight/use evidence. Renderer hydrates `installState` but Bridge remains the install-job owner. Execution tickets are keyed by frozen provider/runtime/model/reasoning/installation/trust and deleted when handed to execution | `WorkspaceController`, Settings, conversation sidebar and `RunWorkflow` |
| 源页 Agent session Token | Bridge `AgentRuntimeCoordinator` | process memory for the live session, injected only as `PAGEROOT_API_KEY` / `PAGEROOT_API_VENDOR` / `PAGEROOT_API_BASE_URL` for `pageroot`/`http`; optional Main `safeStorage` ciphertext under `userData/agent-session-credential.v1.json` only after explicit remember, including non-secret Custom `modelId`; never plaintext secrets on disk, `ui-preferences.json`, logs or GET responses | Settings connection card; Renderer posts `POST /agent/session-credential` and never rereads the secret. `RunWorkflow.manageAgentAccess` owns disconnect/remove/reconnect sequencing; persist failure remains a partial success and cannot be rewritten as complete success |
| Product ACP allowlist, managed Agent inventory, in-flight install/login jobs and install/login drain | Bridge `AgentCatalog` / `AgentInstaller` / `AgentAccessAuth` | managed bytes live under Electron `userData/agents/<providerId>/<version>/` (or `HTML_AI_AGENTS_ROOT`); jobs are process-local with a monotonic `generation`; user-global npm is never spawned; official login URLs stay in process memory; login `operationId` is minted only by Bridge. Cleanup failure stays `stop-unconfirmed` and must not drain as cancelled | `GET /agent/providers`, `POST /agent/install`, `POST /agent/install/cancel`, `POST /agent/login`, `POST /agent/login/cancel`, `POST /agent/logout`, `GET /agent/login/url`, Qoder/Codex provider discovery and Coordinator shutdown; public rows expose in-flight `activeOperation`, terminal `lastOperation` and `loginUrlPresent` without paths or OAuth URLs |
| Agent access-operation projection (`install`/`login`/later auth kinds), `enabled`, pending-default intent and credential persist | Renderer `AgentCatalogState`; `shared/agent-access-operation.mjs` is a pure helper with no persistence | `enabled=false` persists only as workspace `disabledAgentProviderIds`; `activeOperation` holds only in-flight or `stop-unconfirmed` work, `lastOperation` holds the latest terminal result. Pending default is a process-local `{intentId, queuedSelection, validatedSelection}` generation; `displaySelection` follows that pending service while it is not ready, without writing the saved default. Credential persist holds status/reason only, never the raw Key. Bridge listings without login `authSource` must not erase renderer API-token vendor facts | Settings cards and Controller `applyDisabledAgentProviders`; diagnose/preflight consume the same snapshot; Workbench retries persist without repeating connection validation; the sidebar Composer follows `displaySelection` |
| AI Request freeze, pre-Request Agent use-time check, persisted-boundary verification, safely fenced same-Request Agent start/retry, unknown-POST authority reconciliation, polling lifecycle, cancellation ordering, conflict command sequence, pending sidebar default adoption and access-repair resend | Renderer `RunWorkflow`, composed by `WorkspaceController` | the user intent synchronously freezes selection; after Request publication every path reads the durable Request selection and never the mutable catalog selection. Sidebar pending default commits only the validated selection of that `intentId` after save compare-and-set. Access-repair identity is `{repairIntentId, requestId, attemptId, projectId, documentId, sessionEpoch}` in process memory; a document switch keeps the intent and refuses resend, a newer round on the same document consumes it | Workbench intent/conversation/sidebar adapter, typed Bridge client and Bridge run lifecycle |
| AI Request/Attempt lifecycle transition | Bridge run lifecycle | runtime state and immutable Request/Attempt records | `RunWorkflow`, RunSession and finalizer |
| `AI任务/` derived prompt/Candidate publication, collision allocation and recovery stage | `ProjectFileRepository` plus narrow `ai-task-projection` materializer | immutable Request/Attempt/Candidate records remain authoritative; `.pageroot/recovery/ai-task-projections/` receipt is only a rebuildable display-progress record; runtime `lastAiTask` is a sealed no-change/error Finder anchor, never an active run or Candidate authority | `/ai-task`, trusted Desktop Finder port and handoff presentation |
| AI Candidate complete-HTML source identity, normalization and report | `ProjectFileRepository` through the pure `candidate-identity` validator | frozen base binding Hash, submitted-output Hash, normalized Candidate Hash and sealed identity report; current Working Copy remains unchanged until Promotion | Candidate Review, Promotion and historical Candidate readers; Runtime DOM is never an input |
| Immutable Version list, verified read-only history preview and based-on/exact/restored/current-history projection facts | Renderer `VersionSession` | immutable Version records and current runtime pointers | `VersionWorkflow`, Workbench history and Canvas projection |
| Version activation, review-candidate preparation, current/history navigation and historical Working Copy continuation operation identity, Bridge I/O, full OpenTarget/Hash/time validation, receipt-forward recovery and synchronous cross-Session publication | Renderer `VersionWorkflow`, composed by `WorkspaceController` | Repository owns the durable history activation receipt; the workflow publishes only through Project, Document, Version, Draft and Comment owners | Workbench review/history commands, presentation-event adapter and Bridge version lifecycle |
| `PROJECT.md` content, editor generation, composition fence and save projection | Renderer `ProjectRulesSession` | managed `PROJECT.md` | `ProjectRulesWorkflow` and Request freeze |
| `PROJECT.md` Bridge reads/writes, 700ms autosave timer, unknown-write authority reconciliation and close/switch drain | Renderer `ProjectRulesWorkflow`, composed by `WorkspaceController` | none; it publishes only through `ProjectRulesSession` and the managed `PROJECT.md` remains authoritative | `ProjectWorkflow` drain and Request freeze |
| Close/switch/submit/history readiness and desktop close lifecycle | The unique `DrainCoordinator` owned by `WorkspaceController`; `ProjectWorkflow` owns the request-scoped close operation | composed owner snapshots, request identity and bounded presentation class; no copied dirty booleans | Electron close handshake, browser fallback and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client created by the runtime Controller factory | no durable state | application workflows only |
| Product Agent diagnosis, dispatch, use-time execution ticket/session, cancellation, activity timeout, lease, structured recovery, bounded canonical events and shutdown drain | Bridge-owned `AgentRuntimeCoordinator`; `AgentBridgeService` is the route façade. Provider-specific diagnosis/preflight stays in the registry/provider | diagnosis is ticketless and creates no execution session; a provider may own a short-lived no-capability ACP smoke session solely to prove protocol, identity, session creation and process cleanup. Tickets bind provider/runtime/security profile/execution purpose/installation digest, are one-use and expire in memory. Runtime sessions own `lastActivityAt`, `receivedBytes`, `safeToRetry` and `recoveryKind`; Request/Attempt/Candidate remain durable authority | `AgentDiagnosticSnapshot`, typed Agent routes and bounded `PublicExecutionSession`; hidden reasoning, paths, stderr and partial HTML never cross them |
| Product Agent process cleanup and crash/restart fence | `AgentRuntimeCoordinator` owns the unified provider/runtime/purpose/project/document/turn-or-request lease and cancellation order `requested → provider-acknowledged → termination-confirmed → durable-cancelled` | an exclusive `.pageroot/agent-bridge-leases/` record is a crash/orphan fence, never task authority. Old leases are never reclaimed or adopted. Release false/throw preserves the fence and blocks retry, durable cancellation and shutdown | coordinator façades only; workspace/Desktop shutdown own no tickets or sessions |
| Development synthetic provider/runtime fixture and Qoder ACP live-probe report | `tests/fixtures/agent-provider/qoder-provider.mjs` provides path-free registry evidence; `scripts/qoder-acp-spike.mjs` reuses `bridge/qoder-acp-client.mjs` only against its disposable synthetic Project File | no product authority; the fixture is process-only and ignored `output/qoder-acp-spike/report.json` is diagnostic evidence only | provider contract tests and developers evaluating live account/network compatibility; never a release gate or Candidate authority |
| Codex ACP installation evidence | `codex-acp-provider.mjs` owns user/managed installation discovery, package identity, preflight and model catalog; catalog items use locked ACP `{ modelId, name, description }`, never display names as machine IDs | process-only version, installation digest, auth class and provider-namespaced model catalog; no account details, thread, Request, Candidate or Conversation write | default Provider catalog and managed `userData/agents/codex/` closure |
| Codex ACP execution process, ephemeral Provider binding and visible progress | `codex-acp-provider.mjs` plus the shared `acp` runtime own launch, ACP session and process cleanup. Coordinator continues to own ticket, lease, cancel and session projection | Agent text is disposable process evidence. Only the fixed finalizer plus Repository validation creates a pending-review Candidate; Working Copy and Version authority never move on ACP completion | existing Conversation/sidebar projection and Candidate Review; pure discussion remains disabled |
| Bridge startup operation, live utility process and ready-only port | Main-process Bridge startup lifecycle | no durable state; one in-memory single-flight operation per app process | window bootstrap, graceful shutdown and workspace-unavailable recovery |
| Undelivered Bridge-unavailable recovery issue and renderer-listener readiness | Main-process recovery mailbox | in-memory for the current app process | preload handshake, native fallback and Workbench banner |
| Renderer edit, project-picker, attachment-persistence, close-coordination and interactive-preview capabilities | Runtime capability resolver | immutable preload manifest; fail-closed browser default | Workbench presentation host adapters |
| Volatile interactive-preview document, bootstrap, allowed source-relative asset root, completed-frame identity set and one-way pre-load scriptless navigation-fallback flag | Main-process preview protocol controller plus the owning window's navigation fence | none; bounded in-memory session/window state only; the fallback cannot be reversed inside a session | isolated preview iframe and the script-disabled edit iframe's resource base |
| Current preview/edit display context, safe reveal transition and per-surface render acknowledgement | Workbench page-view context state | none; source-bound in-memory projection tagged by `DocumentSession` Canvas generation and rendered source Hash | `HtmlCanvasEditor`, `HtmlInteractionPreview` and toolbar |
| Disposable Edit author-runtime program identity, scoped exact prepare grant, public phase/load outcome and latest persisted retry identity | `EditAuthorRuntimeSession`, composed by `WorkspaceController`; `DocumentSession` remains the sole source owner and Main owns exact-source admission plus immutable exact resource sessions | none; bounded process memory only. Attempt admission remains keyed by `(sourcePath, canvasGeneration)` so source checkpoints never auto-prepare. A same-directory Finder rename that keeps HTML, SHA and canvas generation relocates that live key instead of consuming another prepare. Within that key the Session separately tracks the latest persisted `{HTML, source SHA}` only for explicit retry; failure-time HTML cannot be reused after Working advances. Script descriptors, effective authored base and program identity come from one analysis of that exact revision. It does not own or cache physical last-known-good availability | Workbench loading acknowledgement, Controller-provided current Document identity and the frame coordinator's identity-bound settlement result. Explicit retry first joins the existing Document save flight; after awaiting it, Controller rechecks source path and canvas generation and passes only the latest authoritative identity to Session. The notice displays pending/failure feedback; no new persistence queue is introduced. Runtime DOM never enters persistence |
| Two fixed Edit Runtime slots, slot leases, active/latest-candidate phase, last-known-good identity, ignored stale callbacks and Native Edit/IME promotion gate | Pure `RuntimeFrameCoordinator`; `HtmlCanvasEditor` owns only the corresponding two iframe DOM effects, minimal presentation anchor and Selection effects | none; bounded renderer memory only. Stable state is exactly one loaded active slot plus one inert empty slot. A Candidate keeps the inactive browsing context until terminal settlement; a newer revision replaces only the deferred latest request and starts after `superseded` retirement. `superseded` is coordination, never authored-program failure; a former active slot is cleared on the next frame after promotion. Successful finalization releases rollback-only retired-slot references after cleanup; idle registration cleanup is a shared function that cannot capture promotion history or retired SourceIndex/Document state | candidate load/activation/deadline/rAF/microtask/position callbacks and `EditAuthorRuntimeSession`; only proven local synchronization or successful exact Candidate promotion may publish a newer rendered-source identity, and only the latest identity/current slot lease may publish a terminal result |
| Current Edit Runtime degradation presentation (`none`, `runtime-partial`, `static-preparing`, `static-visible`, `last-known-good-readonly`) | `HtmlCanvasEditor`; Workbench only derives `direct-static-visible` when `EditAuthorRuntimeSession` reports a direct static fallback before any Editor failure transition | none; disposable renderer presentation. `runtime-partial` requires a usable critical surface despite a noncritical author error; Session records that truthful outcome and owns its explicit fresh-Session retry. `static-visible` is the verified latest Working HTML, remains editable and quiet, with optional dynamic retry in the More menu. Runtime-generated surface loss cannot turn it read-only. `last-known-good-readonly` is reserved for failure to verify the static document itself and its recovery joins Document save before invoking the ordinary source reload | Workbench notice and read-only projection; it cannot change Working HTML, Runtime outcome or slot identity |
| Exact-version external ECharts script bytes, URL metadata and LRU | Main `desktop/edit-runtime-library-store.mjs` | `Application Support/PageRoot/edit-runtime-library-cache/v1`; content-addressed blobs plus atomically replaced bounded index; reviewed 5.4.3/5.6.0 URLs use their same-version packaged Hash pin, while other immutable versions use only exact cache/network bytes; bytes are verified on every read and are never source or runtime-session authority | `desktop/edit-runtime-protocol.mjs` resource preparation only; no cross-version substitution or recovery session exists |
| Imported project's original sibling-asset directory | Main `importedAssetRoots` in `userData/html-projects.json` plus process `activeImportedAssetSourcePath` | desktop project state keyed by project root; renderer never receives the original path | preview protocol, edit-runtime protocol and the script-disabled Edit iframe resource base |
| AI review page view, change filter, context visibility, navigation target, canonical page-presentation path, scroll mode and zoom mode | `AiReviewWorkspace` review reducer | none; disposable state bound to the frozen before/after pair | review toolbar, content map and isolated review frames |
| AI review semantic pair graph, stable-ID topology, text/element-presence/movement/attribute/inline-style/CSS/Script source facts, disposable fact/semantic/geometry owner IDs, prepared immutable review documents and canonical frame/mask geometry | Cancellable `ReviewAnalysisSession` plus `review-document` analyzer (`app/workbench/review/` pipeline), ready-review session and isolated-frame projection runtime | none; byte-bounded multi-entry cache keyed by base/candidate Hash, bootstrap mode and source path. The cache stores annotated HTML plus source-diff facts only; comment binding and current-session/Frame projection are derived after a hit and are not cache keys. Cache hits are not adoption authority. Mutable Document/Element, runtime geometry and an old Frame are never reused across sessions. Fact identities are analysis-only and never persisted | review outline, semantic frames and context mask; Runtime DOM, computed style and pixels are never inputs |
| AI review Tab/disclosure/control presentation state and transition epoch | Parent `AiReviewWorkspace` presentation coordinator; either frame may propose an intent | none; disposable parent state plus frame projection only | both review frames, content map and overlay/mask projection |
| Frozen review comment set and read-only before-page marker projection | Ready-review session owns comment text; `review-document` resolves opaque targets during analysis via unique `data-pageroot-id`, strips temporary review attributes, and carries Stable-ID bindings only in the parser-blocking first private bootstrap response; trusted `AiReviewWorkspace` delivers targets only through a challenged private port, then joins anonymous viewport geometry and renders it | none beyond the immutable Request/Draft evidence already frozen for the run | trusted review host above the before frame only; authored frames never receive comment text, comment keys, a comment marker, or a Stable-ID/locator map in HTML or later bootstrap source |
| Current source-backed comment identity, runtime visual hint, resolution, visibility, coordinates, marker eligibility and natural document height | `CommentSession`/Draft carry the validated `sourceAnchor` as the only source authority; `TargetResolver` owns Stable-ID-only official resolution on complete managed Working Copies; leftover heuristic helpers in the resolver module are unused by the official entry and are not a shadow metrics path; `html-canvas-comment-layout` measurement is owned by `HtmlCanvasEditor` and stabilized by `commentCanvasPort` | `sourceAnchor` persists `elementId`, current expected canonical source Hash and optional text locator; bounded `visualHint` is explanatory only and is best-effort matched inside that host after a rerun; tag/fingerprint is compatibility evidence only; geometry remains a disposable snapshot tagged by rendered source Hash, applied page-view generation and exact target-ID set | `CommentRailContainer` and the inherited Canvas-height CSS variable; Workbench root does not subscribe; runtime operation targets never become source authority |
| Stable application update schedule, coalesced manual check, download progress and restart-install readiness | Main-process application-update controller | signed GitHub Release metadata plus updater cache; no editor authority | preload status snapshot, Settings PageRoot, sidebar update entry, drain coordinator |
| Random installation identity, project pseudonym secret, aggregate counters and unsent usage events | Main-process usage-telemetry controller | bounded `usage-telemetry.json` under PageRoot Application Support | PostHog batch ingestion only |
| Settings tab/category, settings-mode sidebar and return/focus route | Workbench presentation state (`settingsCategory` plus the existing tab navigation commands) | none; the category is disposable and is reset only after the settings tab is truly closed | Settings sidebar/Page, gear entry, Agent install/login entry and Escape/return actions |
| Workspace layout/motion/restore/default-Agent/`disabledAgentProviderIds` projection, pending patch, save error and bounded retry/flush | Renderer `WorkspacePreferencesSession`, composed by `useWorkspacePreferences` and `WorkspaceController`; Workbench only renders the projection | Main `desktop/ui-preferences.mjs` owns the v2 `workspace` object, strict field/range validation, migration and atomic queued writes; it contains no HTML, comments, attachments, credentials or localStorage authority | Settings Page; startup tab coordinator consumes only `restoreTabsOnLaunch`, Agent Catalog consumes the validated default provider and explicit disconnect list, resizers submit widths only at an interaction boundary |
| Edit-canvas pointer-capability hover cursor, delayed outline and one-line caption | `HtmlCanvasEditor` presentation | none; disposable overlay of `resolveCanvasPointerHit`, hidden on click, scroll or text editing | `html-canvas-selection-chrome` overlay |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| V2 text-session lease, editable-island host DOM, logical Selection and IME snapshot | `IslandEditingController` | in-memory until the exact island SourcePatch is acknowledged | Canvas coordinator and document session |
| Last proven comment-target geometry during Canvas replacement | `commentCanvasPort` | in-memory and cleared on project transition | `CommentRailContainer` only |
| Current source/Draft persistence recovery banner | Workbench status-banner projection, with source failure priority | owner snapshots only; no independent durable state | workspace view and recovery actions |

Rules:

- `AgentCatalogState` owns one configuration per provider in its existing map;
  the selected default points to that provider's configuration, not to a second
  independently editable model/reasoning record. Configuration compare-and-set
  checks the target provider even when another provider is the default. Late
  preference hydration cannot replace a provider changed since startup.
  `workspace.agentConfigurations` persists only provider-namespaced model IDs
  and requested reasoning through the existing Main preferences port. The
  configuration action awaits its serialized save receipt; a failure appears
  beside the field and must not claim persistence. There is no source, Request
  or Candidate drain obligation: these convenience preferences never veto
  source close. Submitted Main writes retain its atomic queue; an interrupted
  unacknowledged renderer action can restore the last acknowledged preference.
  Default-provider and disabled-provider writes remain separate narrow patches.
- Codex login completion checks native authentication only. The subsequent
  initialize-only diagnosis independently records protocol readiness and cannot
  erase confirmed authentication. Provider diagnosis returns bounded internal
  stage/code/version/exit-code/reason evidence; the public registry strips it
  along with commands, paths and stderr. Settings and sidebar derive the same
  recovery action from the existing public four-fact snapshot. No extra
  persisted login state or renderer diagnostic log is introduced.
- A consumer never writes another owner's fields directly.
- Registry membership is distinct from Desktop Recent. The Repository may return a
  registered row as ready, unavailable or invalid without granting a second
  authority path; Recent contributes only ranking/last-opened presentation.
  Renderer catalog commands carry only `projectId`, and every open revalidates
  the Registry/Project/Document/Working Copy/OpenTarget/HTML/Hash tuple before
  any Session publication.
- External `importSourceKey` is a lookup, not a write credential. Equal HTML
  bytes at another path remain a new project. Multiple claims for one source
  key fail closed and do not present a chooser.
- Recent and Registry-catalog lists are deferrable projections. Automatic
  refreshes run only after the authoritative transition has settled
  (hydration, Working Copy confirmation or synchronous cross-Session
  publication), are fenced by the current Project context, and never
  participate in or block a rename, history continuation, Candidate adoption
  or hydration. A catalog failure can only surface a projection event; it
  cannot downgrade a completed transition to unknown.
- `AI任务/` is a display projection, not a second Candidate store. The
  materializer first validates the complete frozen identity and hashes, writes
  a recovery receipt before no-replace output, and never reads a visible copy
  for review or Promotion. A deleted, tampered, user-owned or symlinked target
  is rebuilt only from hidden authority or allocated a different safe display
  directory. The Finder port accepts only the current source locator and opens
  only a Bridge-validated direct child of `AI任务/`; it never accepts a
  renderer-supplied Request path or exposes `.pageroot/requests/...`.
- External HTML delivery has four explicit owners plus a Prepared Intent
  store. The main mailbox accepts only its latest unconsumed opaque request.
  `ProjectOpenQueue` assigns every classify/prepare/commit/finalize and
  active/recent-project transition its order before a picker, source read or
  Bridge check can finish; local picker, recent-project, external, startup,
  generated-version, rename and forget transitions therefore share one durable
  state boundary.   Class A activates immediately. Classes B and C write a
  process-memory Prepared Intent and wait for confirmation; they do not
  activate the original, import, or trash. Re-querying the same canonical
  last-active path while an intent is still `prepared` or `committing` reuses
  that `requestId`. Cold-start confirmation at epoch 0 skips the Canvas fence,
  then hydrates after the Working HTML is published so the workbench can leave
  `hydrating`. Canvas Hash verification may fail independently: the projection
  becomes non-editable or statically degraded, and already published source is
  never rolled back. The renderer
  `ExternalFileOpenSession` deduplicates delivery
  IDs and owns active, queued and deferred switching. Preload suppresses an
  older readiness catch-up once it has observed a live request, so delivery
  order cannot reverse at the renderer boundary; `ProjectWorkflow` never stores
  an external request in an ordinary picker retry. A newer queued
  external request fences only older work that has not yet been accepted and
  inherits its Canvas freeze. Each renderer session owns its deferred retry
  transition: it records whether `DrainCoordinator.inspect("switch")` has
  observed a relevant blocker, resumes only after that blocker clears, and
  otherwise reports that the explicit retry action remains necessary. Project
  hydration is an explicit switch obligation rather than a copied Workbench
  boolean. If the final pre-IPC fence itself captures a post-cutoff native
  edit, no external activation starts; that edit returns to normal persistence
  before the session retries.
  Once main-process acceptance succeeds, `ProjectApplicationSession` becomes
  the sole owner of accepted-result FIFO and deferred application state.
  `ProjectWorkflow` executes those results, repeats the switch drain and takes
  a synchronous final Canvas freeze immediately before every publication. A deferred final fence keeps
  its already-accepted result until a relevant blocker clears or the user
  explicitly continues. An accepted project therefore publishes before a later
  queued result runs, and that later result replaces it only on its own safe
  application. After the FIFO settles, the visible project and main-process
  active/recent source stay aligned without discarding input or losing a prior
  successful open to a failed successor. Close treats both a main-process
  external acceptance and an accepted renderer application as drain
  obligations before either the hydration or load-error close fast path; it
  cannot approve shutdown while either owner is active or deferred. An unanswered
  open confirmation is cancelled during close drain. A new
  external delivery during an uncommitted close cancels that exact handshake
  before normal mailbox delivery. After close commits, the mailbox does not
  accept the request in the exiting process; its owner atomically records only
  the latest validated path in a one-shot handoff that only the next
  single-instance owner claims and deletes before normal delivery.
- `workbench.tsx` is a composition root, not an additional state owner. It
  subscribes to Session/Controller snapshots, derives read-only presentation
  values, adapts narrow host ports and dispatches user intent to the owning
  Session or workflow facade.
- `WorkspaceController` owns the renderer's unique `DrainCoordinator` and
  composes `ProjectWorkflow`, `CommentWorkflow`, `RunWorkflow` and
  `VersionWorkflow`. The workflows own operation state only: they create the
  narrow external-open/application protocol Sessions, receive the existing
  Project, Document, Comment, Draft, Run, Version and SourceHistory owners,
  and must never duplicate their facts. Workbench's direct Bridge-call
  allowance is exactly 0; the checked architecture gate permits no
  `bridgeClient.*` call from Workbench.
- A tab is presentation and navigation, never a second Workspace. The renderer
  creates exactly one runtime `WorkspaceController`. `WorkbenchNavigationWorkflow`
  asks the existing `ProjectWorkflow.openProject(kind=registered)` to run its
  canonical `prepareSwitch`/drain/Canvas fence, rejects pre-open matching
  identity, then mounts only a newer aggregate Project epoch. The operation
  commits its user-facing admission as soon as the correlated application has
  published exact display bytes. Hydration, accepted-result FIFO and Canvas
  verification remain background readiness owned by `ProjectWorkflow` and the
  close drain. A failure after display readiness remains attached to the mounted
  target tab, keeps editing closed and offers hydration retry; it is never
  handled as a failed open or pre-commit cleanup.
  A byte-bounded `DocumentSurfaceCacheSession` may retain exact, fully persisted
  and Canvas-verified HTML for recent tabs. At most three script-disabled display
  iframes remain mounted; they never retain contenteditable, Selection, IME,
  observers or source serialization. Warm entries retain only allowlisted
  presentation context and scroll. Evicted tabs become cold identities without
  being closed, and every activation still enters canonical project open.
  Start activation calls the same canonical `prepareSwitch`; only then
  does it unmount the document outlet while retaining `runtimeOwnerTabId`, so
  close/quit obligations remain owned by the same Controller. Close and activate
  are mutually exclusive. Inactive tabs keep no contenteditable, Selection or
  IME DOM.
- Every authoritative `project-applied` publication carries the already
  verified `projectId + documentId` pair and is synchronously projected into
  `WorkbenchTabsSession` before React aggregate rendering. Accepted-project
  FIFO successors therefore cannot erase a predecessor tab. A pending
  registered-tab switch may stage or refresh that identity, but only
  `WorkbenchNavigationWorkflow` may commit its active/mounted tab through the
  synchronous application receipt after Controller
  identity verification. A non-null transaction/application generation is
  synchronously authorized before ProjectWorkflow mutates Controller Sessions;
  expired or terminal generations cannot later resume a deferred application.
  Null transaction identity is reserved for legal authority refresh.
- Browser-only file input has no filesystem locator authority. After bytes are
  decoded and hashed, it mints a presentation identity from a versioned digest
  of NFC filename, size, last-modified time and content Hash. The resulting
  `project_browser_* + doc_browser_*` pair lets reselection deduplicate and
  `project-applied` replace Start, but it never becomes path, HTML or Hash
  authority. Desktop identities continue to come only from verified
  Bridge/managed-open results.
- A failed Desktop acknowledgement retains an opaque request-keyed completion
  in `ProjectWorkflow`: retry performs only that ack, while the external Session
  keeps the FIFO head and withholds successors. Close drain cancels and
  acknowledges every queued confirmation until the Session is idle.
- Desktop close synchronously freezes the same navigation admission stream
  before awaiting idle, then enters the Project content-safety boundary. Tab
  layout persistence continues best-effort and cannot veto exit. Ready retains
  the navigation freeze through final exit; close rejection or abort releases
  the exact request before at most one automatic retry. Finder FIFO
  acknowledgement requires the matching terminal navigation outcome.
- `RunSession` owns the one in-memory submission lifecycle. `preparing` blocks
  duplicate intent and drain without freezing the current canvas; `frozen`
  blocks edits until the Request is known; `uncertain` preserves a current
  read-only fence while reconciliation determines whether a durable run exists.
  Workbench must derive its active lock and submission presentation from that
  snapshot rather than maintain a second boolean or ref.
- `RunWorkflow` owns the I/O sequence around that Session fact: it soft-checkpoints
  native input, performs one `leave-canvas` freeze, drains the authoritative source, submits only one Request,
  reconciles an unknown POST with read-only workspace authority, and fences
  timer/late callbacks by run identity and disposal generation. Clipboard
  success means exact readback only; it never implies an external Agent has run.
- Workbench presentation modules receive snapshots and callbacks only. They
  may not import application sessions, Bridge services or persistence
  adapters. File header, comment rail and project-files drawer live in
  `app/workbench/*-view.tsx` modules composed by `workbench.tsx`; they do not
  own Sessions or create a second Store.
- An opened source locator is not a registered project context. Empty
  `projectId` or `documentId` values may not be used as placeholder authority.
- The first durable action atomically registers the project identity and binds
  the Draft session to the returned authoritative draft before local aggregate
  state can be acknowledged.
- A registered mutation captures one complete `projectId + documentId +
  sourcePath` context. The Bridge resolves both IDs before validating the path;
  only `/project/ensure` may create a new registration. A `pendingWrite` target
  Hash may repair PageRoot's own atomic-replacement window but never authorize
  an unrelated external replacement.
- `/autosave` may decide its own command preconditions, but it may not own a
  partial write path. `ProjectFileRepository` alone advances the current-source
  write for a registered v4 Project File. Canvas undo/redo submits complete HTML
  through that same path; the retired Bridge history journal and action cursor
  cannot become current authority. AI Version publication remains a separate
  immutable transaction.
- Cross-owner operations are coordinated explicitly; they do not synchronize
  through incidental React effects.
- `DocumentWorkflow.flush()` includes recovery-journal retirement in its
  single-flight promise. A checkpoint queued during that retirement must
  re-enter single-flight admission after the old receipt settles; waiting for
  the old receipt alone cannot acknowledge the newer revision. Concurrent
  waiters join one next drain using the updated expected source Hash.
- An Undo/Redo drain may refresh its captured Hash only for the same complete
  OpenTarget route and session, with unchanged requested HTML/revision and
  matching persisted/working Hashes. Navigation, a different Working Copy or a
  different project root still invalidates the history request.
- `DocumentWorkflow` serializes distinct history commands on its existing
  history promise tail. A queued command adopts the preceding command's new
  Hash only when that successful receipt matches the current complete route,
  persisted/working Hash and revision with no pending write. Another edit or
  navigation invalidates the queued request; it never shares the preceding
  command's success as if its own direction had executed.
- A history request checks its captured HTML/revision after the initial save
  drain even when the route Hash stays unchanged. A newer edit invalidates that
  request before history apply. After canonical history apply, further edits
  may extend the verified source chain while its save receipt drains; receipt
  latency alone cannot revoke editing on the published projection.
- A current-source transition first stages one complete candidate containing
  project identity, full OpenTarget identity, source path, Version authority,
  HTML bytes and verified Hash. Only after every field is valid may the
  coordinator synchronously publish Project, Document, Version, Draft and
  Comment state and advance the Canvas authority generation. A Hash-only or
  path-only publication is invalid.
- Historical continue-edit owns no mutable Version snapshot. `VersionWorkflow`
  may call the narrow Bridge activation route only from the exact read-only
  history view; Repository atomically owns the `desktop-pending`/`desktop-confirmed`
  receipt, and `ProjectWorkflow` passes its operation ID to the same managed-source
  primitive as Candidate promotion. A lost Bridge, Desktop or confirmation response
  may be retried only against that complete receipt identity; it must not borrow
  another project's OpenTarget or roll durable V2 back to V6.
- Edit and preview acknowledge rendering with the exact Document Canvas
  generation and source Hash. A late acknowledgement from an older generation
  is discarded and cannot make persistence appear safe.
- A filename transition never owns HTML bytes or Document identity. It may
  advance the source locator only after the expected source Hash is verified;
  `ProjectWorkflow` then rebases the existing Run/Project/Document facts as one
  typed renderer operation. A lost response may reconcile only against the
  trusted active file's expected path and Hash; a late result is stale and
  cannot rebase a newer Project context. After validation, the project session
  adopts the Bridge-confirmed path for the same
  `projectId` and `documentId`.
- Runtime features are declared independently. The presence of a project-picker
  API never implies source-edit or attachment-persistence authority.
- Interactive-preview sessions, page-view context and the direct Edit
  author-runtime resource session are disposable. They do
  not participate in save, switch, submit or close drains, and cannot become a
  second copy of the source HTML. Desktop `pageroot-preview` sessions are owned
  by the preview protocol controller: Edit static sibling-asset sessions
  refresh in place for the same source path, and a full map evicts the
  least-recently-accessed idle session rather than the oldest insert. The Edit
  session has no bitmap/projection state: it serves disposable script-enabled
  frames while exact program identity remains current and never persists
  runtime descendants. Edit screenshot count must be 0.
- `HtmlCanvasEditor` owns native-edit checkpoint disposition. Soft checkpoints
  materialize complete Working HTML and autosave/recovery evidence while
  retaining the iframe, contenteditable, Selection, caret and focus.
  Host acceptance is final for that source command: failure to rebase the live
  native session retains the accepted HTML/history result, marks projection
  recovery required and reloads the editor from current source. It is not
  reported or restored as a rejected edit.
  `leave-canvas` retires native editing without queuing a candidate or clearing
  a pending Runtime refresh; a later unlock may refresh only as recovery. History
  retains its separate bookmark and canonical-adoption path.
- The pure `decideEditRuntimeRefresh()` policy owns the projection decision for
  an accepted source operation: safe static text/style/reorder stays in place;
  Runtime text/common-style/same-parent reorder
  also end in place after successful source and DOM synchronization, without
  creating a later refresh obligation.
  Runtime structure or any authored-program identity change prepares a candidate
  immediately. A failed local projection or separately stale Runtime
  authority may still store the latest pending source revision/reason/count for
  recovery diagnostics. Later accepted source edits advance that same obligation
  to the newest revision; only successful connection and promotion of the exact
  revision clears it. That state is not save authority and never retains an
  intermediate iframe revision.
  Ending native editing cannot publish a newer whole-page rendered identity;
  only already-proven local synchronization or exact Candidate promotion may do
  so. Successful in-place text Undo/Redo is itself that proof and clears any
  obsolete recovery obligation instead of scheduling a history-named rebuild.
- Project hydration is published before provisional Working HTML. Runtime
  preparation treats that interval as source-not-authoritative and resumes from
  the final hydrated source; the Controller refreshes Runtime on hydration
  transitions as well as Project/Document publications.
- An active last-known-good Edit Runtime remains visible while the latest
  candidate prepares. A failed dynamic Candidate leases one Script-disabled
  Candidate for the latest Working revision; its predecessor identity and
  source revision prevent an older failure from superseding newer work. During
  Native Edit or IME no Candidate may promote and no active frame may retire.
  If that deferred static request becomes stale while Native Edit advances the
  source, `HtmlCanvasEditor` replaces it with one request for the latest full
  Working HTML instead of treating the dropped request as a settled fallback.
  The static Candidate is judged by source/document verification, not by
  Runtime-generated Canvas/SVG continuity. Once verified it becomes the
  editable latest source without a persistent notice; optional dynamic retry
  remains in the More menu. Only a failure to verify that static document may
  retain the last-known-good frame read-only; its reload first joins Document
  save and uses the ordinary verified source-reload operation. Working HTML
  never rolls back.
- `RuntimeFrameCoordinator` uses exactly two fixed DOM slots. Candidate
  preparation never changes the visible active slot or Active identity.
  Hidden Candidate positioning restores the candidate iframe reading position
  without rewriting Editor Active refs or the shared outer scroller, and does
  not take the Native Edit commit lock. One
  commit then flips Active identity, slot roles and visibility together after
  a final identity/source/native-edit check. Failure before that commit
  discards only the Candidate. If `connectFrame` fails after the slot switch,
  the one-shot commit restores the previous Active identity and
  `data-render-verified` attribute; that short transactional rollback does not
  span the Candidate lifecycle and never rolls back Working HTML. The former
  active document is cleared on the
  next animation frame. A recovered Runtime grant arriving during positioning
  retains its deferred request; completion synchronizes the terminal slot
  projection and replays that request against the now committed Active frame.
  A stale callback cannot act after its slot lease has been reused. Immediately before the commit, `HtmlCanvasEditor` re-captures
  the small Presentation Anchor from the still-visible Active frame so
  scrolling during preparation is the current user intent rather than an old
  restoration target. A selected element becomes the viewport anchor only when
  it is currently visible; otherwise the current reading region is kept.
  Comment layout is measured from the currently visible frame after commit,
  not migrated as a frozen proof that the new revision was already measured.
- AI review state fields are orthogonal. Page, filter, visibility, navigation,
  page presentation, scroll and zoom actions may update only their own reducer field. Review
  navigation can reveal a hidden panel in both frames but cannot become a
  second filter or mask owner. The parent owns the full nested panel path and
  one transition epoch; frames report readiness but cannot independently
  commit a new overlay state. The paired action-key projection mirrors safe
  runtime presentation in either direction and never writes source bytes,
  Version records or project state. Frozen review comments remain read-only
  evidence. Their text stays in the trusted host. Scope attributes are removed
  before either document is serialized. A source-resolved local before target
  is represented only by an opaque private initial-bootstrap binding: an
  element path plus a narrow static fingerprint, never a source-node identity
  in authored-page markup. The managed preview serves it only to the
  parser-blocking first bootstrap request, then returns an unbound fallback to
  later reads. The trusted parent releases targets only to the before bootstrap
  through a challenged private port; comment text, keys, source-node IDs and
  locator maps never enter document bytes or later fetchable bootstrap source.
  A unique source `id`, `data-*`, `name`, or `aria-label` is only a safe
  fallback when private binding is unavailable, never a positional sibling
  path. An unsafe, ambiguous, replaced or disconnected target, or an
  unavailable capability, produces no marker. Neither review frame receives
  comment text or a comment marker in authored-page markup.
- Semantic pairing is analysis-local. Its parent-scoped pair graph,
  `semanticOwnerId`/`geometryOwnerId`, and exact stable-sentence geometry
  offsets may annotate the disposable prepared
  documents so the projection can group one frozen review result, but they have
  no database, source, Version, comment locator, Bridge or IPC authority and
  are discarded with that review session or its bounded cache entry. Its
  analysis-local signatures distinguish unique explicit identity, exact subtree
  equality and own non-presentation compatibility; a deep child change cannot
  unpair a stable ancestor, and an ambiguous empty sibling never gains a
  positional identity. Trusted fact generation reports an overflow instead of
  silently publishing a partial fact set.
- Review facts are static and analysis-local. Stable-ID pairing may produce
  text, outermost presence, movement, authored attribute/inline-style and
  CSS/Script source facts under ADR 0066. A valid ID is sole identity; tag,
  parent and order are reported changes rather than replacement identities.
  Layout, wrapping, computed cascade impact and runtime drawing have no formal
  fact owner. Main, preload and authored frames expose no Review capture or
  screenshot capability.
- `CommentSession` is a renderer working copy, not durable Draft authority.
  Runtime state is likewise not a second copy of draft contents: it carries
  lifecycle state and a revisioned pointer to the draft repository.
- Local recovery records are an outbox/fallback, never an equal authority to an
  acknowledged Bridge revision.
- A persistence issue has one visible owner. Source persistence takes priority
  on the workspace banner; otherwise Draft persistence uses that same surface.
  The comment rail does not repeat either issue.
- Canvas never owns a parallel snapshot or DOM undo stack. A pending history
  operation is built from the accepted semantic result, its system-derived
  identity delta and exact SourcePatch byte proof. `SourceHistorySession` alone
  owns the acknowledged at-most-20-entry cursor for the current open HTML.
  Optional
  logical Selection and the operation's TargetRef transition may restore
  presentation identity after canonical adoption but cannot change bytes. A
  proven island-only result may update the disposable mounted projection in the
  same iframe; failed proof replaces that projection and never changes history
  authority.
- The desktop Edit menu owns no history. It routes focused native text controls
  to platform undo and all eligible Canvas intent to `SourceHistorySession`.
  Comment cards, attachments and project actions are outside both histories.
- Repository owns Hash/CAS, atomic complete-HTML publication, recovery and
  external-conflict detection. It recomputes semantic identity transitions and
  verifies kernel evidence; it does not infer product authorization from an
  exact patch kind. The tag/parent/order binding is a resealed integrity fact,
  not an identity owner.
- Telemetry is observational and best effort. It never owns product state,
  never receives content or paths, and never registers a drain obligation for
  edit, save, switch, submit, close or update installation.
- Provider Registry owns installed descriptors and dispatch. Agent Delivery
  Codec owns canonical Request selection, shipped-binding checks for new
  managed Requests, and historical `mode: "qoder-acp"` projection at the read
  boundary. Coordinator execution binds by selection only; leftover driver
  aliases are not converted there. Status without a live session may still
  project a historical `driver` for Qoder records. Conversation Repository is
  the only v2 writer; v1 conversation records are never migrated in place.

## 文件与历史合同

外部原 HTML 与首次导入的隐藏 V1 快照保留原始字节且不含 Stable ID。可见 V1
Working Copy 可以因物化 Stable ID 而与它们逐字节不同。AI Candidate 在晋升前
完成 Stable ID 归一化；V2 及后续不可变 Version 保存完整的已采纳 Candidate
HTML，因此可以包含 Stable ID。V2+ 新 Working Copy 初始与对应 Version 快照逐字节
一致，之后本地编辑只更新 Working Copy，不改写已建立的 Version 快照。Stable ID
不回写外部原文件。唯一导出动作原样复制当前完整 Working Copy，包括 Stable ID，
不改变项目、Version、Registry、Recent 或当前打开文件。Undo/Redo 只属于当前打开
文档会话，不属于正式 Version 历史，也不跨切换、关闭或重启恢复。

## Durable Working Copy file binding

`ProjectFileRepository` owns the registered member mapping, current source state,
transaction recovery and `.pageroot/source-bindings/` locator evidence. Helpers
have no independent queues or authority. All bind/restore/save/Promotion work
runs in the Repository serialization. There is no renderer-persisted binding
state and no new drain participant: restoration publishes a missing registered
file synchronously before returning; save remains in DocumentWorkflow's drain.
Catalog source status is a disposable projection, with per-project failure
isolation. The live authority rules are in `SECURITY_MODEL.md`.

Ready-result notifications: Workbench clears the preceding run notice only on the transition into `ready-to-open`. Repeated status observations preserve a later user-triggered Review outcome until its normal dismissal; polling does not own that notice lifetime.

Workspace response normalization is owned by the existing injected Controller
codecs (`decodeWorkspaceResponse`), before Session publication. VersionSession
rejects missing or duplicate application `id` values. Bridge `versionId` and
persisted Draft records are not renamed on disk; CommentSession receives decoded
comment/event projections. See the ingress table in `ARCHITECTURE_MAP.md`.

### Project catalog summaries

`WorkspaceController.projectCatalog` owns the in-memory version summary entries,
loading/error status and request generations. Entries include document identity;
a replacement document cannot reuse a previous document's rows. The stateless
`project-catalog-query.js` procedure reads and publishes through this owner.
Version Session publication refreshes the active entry and advances its generation;
a safe document save updates the active timestamp without loading the workspace.
Rename, relocation and restore refresh the affected summary. A failed refresh
retains existing rows and exposes the error; stale responses cannot publish.
Sidebar components own expansion only, and subscribe to this existing capability.
Both Session and Bridge rows use the same injected summary projection.

Repository catalog and summary reads validate metadata and probe locators without
HTML loading, activation, recovery or registry/binding writes. Catalog readiness
means metadata is available; `sourceStatus: unknown` means file content still needs
checking. Real open/save/restore retains full identity and content validation.
Startup recovery is unchanged. A discovered folder name is only a display hint
until an authorized file operation revalidates and records it.

Catalog reads capture the Controller's in-memory catalog revision. If a verified
Session publishes while a read is pending, ProjectWorkflow discards that result
and rereads once before publishing any catalog event (including tab reconciliation).
A second overlap returns stale and preserves the prior projection; a later stable
read may still remove projects or replace document identity normally.
A confirmed save timestamp is tied to project/document and the exact decoded
active Version object. Fresh workspace authority uses its own modifiedAt; cached
historical row times never override it. This receipt is process-local projection
input, not a write permission or persisted schema.
Normal ready/unknown catalog rows do not show repair actions. Repository, Bridge
and Desktop preserve unknown until the existing open flow validates the file.

### Shared workbench display projection

`workbench-header-projection.ts` is the pure display projection for the active
Session, selected navigation tab and existing safety conditions. The tab bar,
sidebar selection and toolbar consume this result. It owns no mutable state;
region subscriptions remain separate. Version rows sort by ordinal, retaining
lineage only as detail. Current editing and latest remain independent identities.

Document-dependent header actions require the active tab's project/document to
match the Session target. An unmatched snapshot clears display identity and
cannot offer preview, review, file opening, export or refresh for another target.
This pure header rule does not change persistence-failure/recovery export actions;
a matching unsaved document still exposes its current-source export.

A source-less document has no registered project identity. For this existing
in-memory case only, the navigation Session's runtimeOwnerTabId must match the
active document tab before edit/preview/current-source export is offered. This
never authorizes registered-document mismatches or disk/open/review actions.

Historical viewing keeps current Working HTML, persistence evidence and Draft in
their existing owners. VersionSession owns only the verified immutable snapshot
projection; HtmlInteractionPreview displays it without acknowledging or replacing
the current editor authority. Returning clears that projection and restores the
working display mode. External-file observation can report a conflict but cannot
replace protected working bytes. A failed history read leaves the prior view intact.

### Manual history creation (E)

ProjectFileRepository owns the durable `history_<operationId>` journal and
manifest commit. Existing Repository serialization and Registry write locking
cover create/replay/recovery; there is no second queue or persistence store.
VersionWorkflow owns the in-memory creation result and query generation; it
exposes creation and same-operation reconciliation without publishing Document
authority. F wires the confirmation UI and opens an already-created result through
the existing managed-source transition. Source ownership changes only at that
validated opening boundary, regardless of creation receipt delivery.

HistoryCreationDialog owns only the confirmation target, scoped by project,
document and version. Transaction phases and receipts remain in VersionWorkflow.
Restoration queries the operation locator from the existing project hydration
event; no component cache or second mutable transaction store is introduced.

Creation receipts prove immutable project/document/version/operation and source
lineage facts. Their source path comes from current registered Working Copy
metadata, not the creation filename. `recoveryState` separately reports pending,
opened or superseded using the current manifest/runtime. Prepared recovery uses
fresh prepared/private-anchor/visible object evidence and the sealed hash; stored
physical observations are diagnostics, not persistent write authorization.

A creation receipt is permanent evidence, not a permanent recovery task.
VersionWorkflow suppresses superseded receipts and checks again before opening.
If hydration has already opened the matching current Working Copy, it verifies
that Canvas and repairs openedAt without another workspace load or publication.

Legacy activation seam: no production Workbench/UI caller uses
`continueEditingHistoryVersion`. The Controller forwarding method and workflow
remain deprecated compatibility surfaces exercised by the legacy activation
protocol tests (`tests/version-workflow.test.mjs`); Repository recovery of old
`historyActivation` journals remains separate. New UI commands must use create,
query and openCreatedHistoryVersion. This batch does not remove the disk protocol.

## Preflight submission receipts

ProjectFileRepository serializes `submissions/<submissionOperationId>.json` inside the managed control root. The receipt owns only frozen submission requirements, preflight acceptance outcome, and stable Conversation/Request linkage. It is not an execution owner. Request/Attempt and Promotion retain execution and result authority. Receipt write precedes Conversation projection; stable identities allow projection repair without replaying Agent execution.

### Execution history recovery

AgentRuntimeCoordinator emits bounded, fixed-category execution facts through its injected repository writer. The start fact must persist before invoking a provider. Stage facts are serialized independently of Renderer mounts; a persistence failure aborts execution and disallows automatic retry. Raw provider text, arguments and output do not enter this history path. On execution settlement, only the assembled visible-text allowlist is sealed as a public summary, redacted by the public projector and bounded to 4096 characters; hidden reasoning and tool output remain excluded. The existing submission receipt replays this immutable summary after restart; Request and Promotion outboxes continue to own result and decision facts.

ProjectFileRepository writes terminal Request state and stable Conversation event IDs together in request.json, then projects those facts through the submission receipt into the fixed Conversation. A crash between these files replays the same event IDs; it never restarts generation. initialize() reconciles only submissions created by this flow: accepted without a Request becomes not-started, and processing Requests receive an interrupted fact while retaining existing Request/lease authority. Missing older submissions never cause invented history. Promotion confirmation remains owned by the completed Promotion transaction.

### Public execution progress and stop ordering

The public projector bounds assembled text to 64 KiB, redacts credentials/paths/URLs and suppresses generated markup. Hidden reasoning and raw tool arguments never enter the public event allowlist. Tool activity is translated from known event categories to fixed labels, with a distinct event identity for each occurrence. HTTP starts generation progress only after actual content arrives, separately reporting response receipt and validation.

For submissions, the durable stop-requested fact fences late completion inside the repository serial writer while cleanup is unconfirmed. A Candidate already authoritative before stop remains available; only an explicit discard intent rejects it. Renderer cancellation reconciles a result-ready receipt instead of clearing that result. The stop-requested fact is not a cancelled result.

## Document Agent preference

Main `ui-preferences` is the only durable writer of bounded `documentAgentSelections` (document ID to provider ID). WorkspacePreferencesSession projects it; the sidebar selects the current document, Settings changes only the initial default. Disabled providers remain selectable. Preference failure remains visible; it never silently routes execution to another provider. A submitted Request continues to own its frozen provider/model identity.

### Conversation read refresh

ConversationWorkflow owns a bounded single-flight read refresh while the sidebar is open. It preserves local draft state, fences document/load generations, and stops when closed. The Renderer writes no history facts. Sidebar groups retain stable Turn keys when execution changes to history; header, scrolling facts, current actions and submission controls are separate regions. Current actions derive only from the live Run projection.

### Trusted modification adoption

VersionWorkflow drains current source and Draft before adoption. The decision carries the reviewed Candidate ID, original source hash and existing `promote_<candidateId>` transaction identity. Promotion freezes comments whose content/revision differs from the submission and publishes them with the next Working Copy; unchanged submitted comments alone are consumed. Completed Promotion is the authority for an idempotent adopted Conversation fact. Unknown or failed delivery never implies adoption. The sidebar opens Review first; adopt and explicit discard remain separate decisions.

PR-8: AgentRuntimeCoordinator owns in-flight execution startup keyed by the
existing execution identity. Cancellation marks that startup, waits for its
bounded settlement and only then allows durable cancellation. The final launch
check prevents a stopped, unpublished startup from spawning later. This registry
is transient coordination, not a new durable Task/Run authority. VersionWorkflow retains and reconciles lost adoption responses using the identical Candidate decision operation; Promotion remains the idempotent authority.
### Adoption receipt reconciliation

VersionWorkflow owns an ephemeral pending-activation projection keyed by the existing
Run operation identity. It retains the original Promotion decision payload and
replays that same idempotent decision after unknown Bridge receipts; the persisted
Promotion transaction remains the only adoption authority. Two lost replies show
`adoptionPhase: unknown`, retain the per-Run activation lock, and release navigation.
Reconciliation backs off to 30 seconds, pauses publication away from the original
Run, and stops on disposal. Review cannot override this projection and RunWorkflow
refuses an opposite cancellation while the decision remains unresolved. Restart
reconstructs the outcome from the persisted Promotion transaction, never a new AI run.
Before accepting a submission, Conversation Repository reserves 128 messages, two contexts, one turn and 2 MiB for the bounded execution history, public summary and adoption decision. Near message/context/turn/byte limits it rotates only a settled Conversation, preserving both links and all prior records; interrupted rotation repairs the current index from the archived link. Submission requirements are losslessly split into bounded messages; more than 1 MiB of JSON-encoded requirements is rejected before acceptance or provider contact. Progress is capped before projection, while Request/Promotion terminal facts remain authoritative and replayable.
Every RunWorkflow submit exit before a known Request settles the original submission identity in finally, including stale navigation after receipt or ticket arrival. A dispatched unknown Request is excluded and stays with existing reconciliation. The in-memory pending run is removed only after this pre-Request settlement path; navigation never changes its target.

Sidebar Turn presentation keeps submitted requirements, sealed public summaries, results and decisions in reading order. Typed progress and legacy fixed-stage facts are default-collapsed under a keyboard-accessible native details element; expanding history never exposes an executable decision. Successful CI desktop/AI evidence includes synthetic visual captures from output/design-qa.

The history view renders the legacy Candidate-ready fact as “修改已准备好。”;
its former “尚未采用” wording is not reused as a current adoption assertion.
Current adoption status comes exclusively from the active operation projection.
RunSession preserves that transient adoption projection across same-Run hydration
and navigation; a ready Request reread cannot erase an outstanding decision.
Explicit reconciliation or a terminal authority can clear it.
Retry preflight is fenced by the original Run's continued membership and cancellation occupancy before dispatch. After dispatch, AgentRuntimeCoordinator owns the pending execution start and waits for its termination/lease cleanup before authorizing durable cancellation. A late preflight or an unpublished provider start must never resurrect an ended Run.

The Codex client-tool adapter (`bridge/agent/runtimes/codex-client-tools.mjs`)
owns only native protocol requests and the current thread/turn binding. It maps
three dynamic tools to the existing ACP client host. `execution-host.mjs` remains
the sole owner of frozen reads, the Candidate write and restricted finalization;
the shared ACP process supervisor owns the child lifetime. No model-supplied path
or command can grant additional write authority.

### Controller-owned source node copies

`HtmlCanvasEditor` retains private Runtime source identity. `IslandEditingController` reports only its own snapshot clone pairs and canonical source imports; the editor transfers proof only from an already registered object in the same frame/execution, or from a canonical import under a proved host. IME snapshots, rollback, canonical remount and history adoption must preserve this provenance. Public DOM attributes, author-created clones and source-identical runtime nodes do not confer authority. Semantic source commits keep their existing revision/identity checks.

Inline format state counts only characters actually covered by the selection, excluding zero-length boundary text. After semantic identity and materialization checks succeed, an unchanged HTML result may resume the existing native edit session without publishing a write; rejected commands retain their failure path.

Explicit source reload additionally checks the verified physical frame generation: identical source bytes in the previous frame cannot acknowledge recovery. Workbench waits for an admitted author candidate; a settled static/failure outcome uses the existing bounded static rebuild. Frame promotion transfers keyboard focus only when the retiring Canvas owns it, without reconstructing a native caret or taking focus from another input. Commit rollback returns focus only if the failed candidate still owns it.
