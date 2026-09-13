# Architecture map

Start here. This is the default architecture reading set: capability domains,
owners and entry files. Full owner tables stay in `STATE_OWNERSHIP.md`.
Dependency direction and drain contracts stay in `ARCHITECTURE_CONTRACT.md`.
Defense class for a user-visible block is in `GUARD_LEDGER.md` and
`ENGINEERING_STANDARDS.md`.

There is one runtime `WorkspaceController`. Narrow command interfaces are
facets of that Controller, not extra controllers. `Verified*Context` objects
live only inside one operation.

## Layers

```text
React views
  -> WorkspaceController (workflow facade)
    -> Sessions (fact owners) + Workflows (operation owners)
      -> domain transitions
        -> typed Bridge client
```

Workbench renders a snapshot and dispatches product intent. It does not import
the Bridge client, construct Sessions, or own debounce, polling, or drain.

## Capability domains

| Domain | Fact owner | Operation owner | Entry |
| --- | --- | --- | --- |
| Navigation and tabs | `WorkbenchTabsSession`, `WorkbenchNavigationSession` | `WorkbenchNavigationWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.navigation`), `workbench-navigation-container.tsx` |
| Document save and detach protection | `DocumentSession` owns current bytes/durability; Main recovery journal owns crash bytes | `DocumentWorkflow` owns source write plus verified recovery/export evidence | `document-workflow.js`, `document/save-plan.js`, `verified-project-context.js`, `desktop/recovery-journal-store.mjs` |
| Source element identity migration | `ProjectFileRepository` Working Copy state | `ProjectFileRepository` serialized migration transaction | `bridge/project-file-repository.mjs`, `bridge/project-file-repository/working-copy.mjs` |
| Semantic source editing | immutable semantic document state, stable-ID operation intent and lineage | pure `SemanticOperationKernel`; SourcePatch is its internal materializer; Canvas owns only current-open invocation | `app/lib/semantic-operation-kernel.js`, `app/lib/source-structure-edit.js`, `app/lib/source-patch-engine.js`, `app/components/html-canvas-structure-commands.ts`, `schemas/semantic-operation.v1.schema.json` |
| Comments | `CommentSession`; `sourceAnchor` is the only persistent source authority and resolves through `TargetResolver`; bounded `visualHint` is explanatory runtime context, including when `body` is only a safe fallback anchor | `CommentWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.comments`), `comment-workflow.js`, `comment/commit-plan.js`, `target-resolver.js`, `runtime-comment-hint.js`, `comment-text-locator.js`, `comment-rail-container.tsx`, `comment-canvas-port.js`, `comment-rail-view.tsx` |
| Attachments | Draft attachment repository; Request freeze owns independent byte copies and recovery staging | `CommentWorkflow` before send, `ProjectFileRepository` during Request preparation/publication | `comment-workflow.js` upload/read/delete, `bridge/project-file-repository/request-attachments.mjs`, `request-draft.mjs` |
| Run and AI request | `RunSession` | `RunWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.runs`), `run-workflow.js`, `run/text-locator-validation.js`, `run/submit-plan.js`, `run-conversation-outlet.tsx` |
| Review and Candidate | Repository owns immutable Candidate HTML, runtime seal, source-identity report and bounded Stable-ID impact assessment with descendant scope closure; historical Version records may still store full-array impact, which `candidateAssessmentFromRecord` projects into the same bounded facts; `VersionSession` owns only the renderer projection | Repository validates/normalizes full-HTML Candidate; `VersionWorkflow` prepares Review and accepts; the explicit Review command starts cancellable source-fact analysis, then projects comments and the current session onto those facts and presents bounded warning-only impact context | `bridge/candidate-assessment.mjs`, `bridge/candidate-assessment-decoder.mjs`, `bridge/project-file-repository/candidate-identity.mjs`, `bridge/project-file-repository/version-candidate.mjs`, `app/domain/run-lifecycle.js`, `app/application/version-workflow.js`, `app/workbench/review-analysis.ts`, `app/workbench/review-document.ts`, `app/workbench/AiReviewWorkspace.tsx` |
| Version and history | `VersionSession` owns immutable records and verified history preview bytes; `DocumentSession` remains the current working source | `VersionWorkflow` verifies history before publishing its read-only projection; return-current only clears it and observes external changes | `version-workflow.js`, `version/review-plan.js` |
| Project context and version navigation | `ProjectSession`, `ProjectRulesSession`, `VersionSession` | `ProjectWorkflow`, `ProjectRulesWorkflow` | `workspace-controller-capabilities.d.ts` (`controller.projectCatalog`), `workbench-sidebar-container.tsx`, `WorkbenchChrome.tsx`, `project-rules-editor.tsx` |
| Canvas edit runtime | `EditAuthorRuntimeSession` owns one scoped exact resource grant; Main's library store owns only verified immutable CDN bytes and reviewed same-version packaged pins; source HTML remains authoritative | `HtmlCanvasEditor` ends proven text/style/same-parent reorder projections in place, rejects element copy when the selected live subtree is not wholly source-backed, and rebuilds only resource, structural, program-identity or failed-projection boundaries; `DocumentWorkflow` persists complete HTML; test-only `runtime-continuity-probe.js` records frame/visual samples after enable | `edit-runtime-contract.js`, `HtmlCanvasEditor.tsx`, `runtime-continuity-probe.js`, `desktop/edit-runtime-protocol.mjs`, `desktop/edit-runtime-library-store.mjs`, `desktop/edit-runtime-bootstrap.mjs` |
| Preview | disposable preview session | Desktop preview protocol | `desktop/` preview owner, `HtmlInteractionPreview` |
| Project open / switch / close | `ProjectSession` | `ProjectWorkflow` | `project-workflow.js`, `project/open-intent.js`, `project/switch-plan.js`, `project/close-plan.js`, `project/source-locator-plan.js` |
| External open | Main mailbox + `ExternalFileOpenSession` + `ProjectApplicationSession` | `ProjectWorkflow` | `desktop/prepared-html-open.mjs`, Workbench auto-confirm of `openConfirmation` |
| Close and drain | unique `DrainCoordinator`; tab layout is best-effort metadata | `ProjectWorkflow` close op and bounded Electron handshake | `app/application/project-workflow.js`, `desktop/close-recovery.mjs` |
| Packaging and release | exact Git Tree | release workflows | `docs/RELEASING.md` |
| Conversation handoff | `ConversationRepository` / `ConversationSession` | `ConversationWorkflow` | `app/workbench/AiConversationSidebar.tsx` |
| Agent session Token | Coordinator owns the live session Token in process memory; Main `desktop/agent-session-credential-store.mjs` owns optional `safeStorage` ciphertext after an explicit remember | Catalog/Workbench persist or clear only through narrow IPC; never plaintext, logs, GET responses or `ui-preferences.json` | `desktop/agent-session-credential-store.mjs`, `shared/agent-vendor-key-url.mjs` |

Project identity, hydration, switch, rename and managed-source handoff stay
with `ProjectSession` + `ProjectWorkflow`. Open/switch/close now have
`ready | wait | reject` plans; the executor remains the unique
`ProjectWorkflow`. Do not split that workflow for line budget, and do not
add a second Controller.

Ordinary save recovery and bounded retirement remain Repository operations in
`bridge/project-file-repository.mjs`; `save-retirement.mjs` contains only the
required-sync cleanup sequence. It owns no separate journal or background job.
The deletion proof and retained-record cases are defined in `STATE_OWNERSHIP.md`.

## Workspace response ingress

`decodeWorkspaceResponse` in the existing Controller codecs module is the
single workspace-response normalization step. It uses injected Workbench
codecs; application code does not import Workbench. Decode and validate the
complete response before publishing any Session. Invalid Version IDs,
ordinals, ownership, pointers or draft records retain the previous authority;
records must not be silently filtered into a partial success.

| Raw response / entry | Decoder | Published owners |
| --- | --- | --- |
| Ordinary open, reload, restart recovery: workspace Core + Supplemental | `decodeWorkspaceResponse` → `versionsFromWorkspace`, `draftAuthorityFromWorkspace`, comment/event codecs | Project, Document, Version, Draft, Comment Sessions |
| Registration / canonical refresh: `ensureProject` | same decoder before registration publication | Project, Document, Version, Draft; CommentWorkflow reconciles its projection |
| Draft authority rebound: `workspace` | same decoder before replacing draft authority | Draft; CommentWorkflow reconciles Comment |
| Continue editing history: activation receipt | same decoder before managed-source publication | Project, Document, Version, Draft, Comment Sessions |
| AI adoption refresh | ProjectWorkflow workspace path above | same existing Session owners |

Bridge/disk records keep `versionId`; decoded Version models keep `id`.
DraftSession keeps persisted draft records, while CommentSession receives the
comment/event models produced by the same ingress. Current and latest markers
are derived independently from their respective authoritative IDs; absent IDs
remain unknown. A malformed receipt after a possible disk commit remains an
unknown outcome, not a claim that the operation never happened. This does not
change disk schemas, historical Working Copy behavior or Canvas publication.

## Current edit contract

Visual edits use Stable ID semantic operations as the public authorization
entry. The current source materializer and commit checks produce complete
Working HTML. SourcePatch is the internal implementation for scope, replay,
inverse operations and integrity; it is not a second public edit API. Do not
bypass hash, identity, scope or persistence checks, and do not serialize
Runtime DOM as the save source.

**Current fact.** `HtmlCanvasEditor.applySourceCommand()` materializes once
for an accepted edit: it lowers the canvas command to a semantic operation,
applies the kernel, and publishes that complete HTML/Hash plus the kernel's
SourcePatch target mappings. SourcePatch remains the internal materializer
inside the kernel; Canvas does not apply a second independent plan or compare
two HTML results before publishing. Comment and selection tracking pass
`trackedTargetRefs` into that same kernel apply. Official `resolveTargetRef()`
uses only a managed unique `elementId`; missing or invalid IDs are orphaned.
Selector, fingerprint, offset and text-affix scoring are not an official result
and are not a live shadow path. Inside one kernel apply, a `SourceIndex`
produced by `buildSourceIndex` may be reused for the exact same HTML bytes after
Hash is recomputed from those bytes; `applyPatchPlan` may reuse that
before-index the same way. Reuse is not a Session, not a history pool, and not a
skip-validation flag. A caller-supplied object that was not built by
`buildSourceIndex`, or that does not match the current HTML/Hash, is rejected.
Built indexes are read-only. Insertion-point identities (parent, sibling and
sourceAnchor) scan the preview tree only when the current source Hash or iframe
document identity changes; overlay, scroll, resize and selection updates reuse
those identities. Coordinates, visibility and geometric overlap are not part of
that cache and have no remaining Canvas consumers, so they are not stored or
refreshed. Comment-target geometry is still measured from the current layout on
each overlay tick. Unused insertion-point React state is not a second layout
owner. Geometry or outline failure still must not refuse edit entry.

**Transitional.** Heuristic helpers may still exist in `target-resolver.js`,
but the official entry does not call them and does not record fallback-only
metrics. Canvas still constructs capability-specific SourcePatch commands
beside kernel operations so it can recover island metadata before the single
apply. Opt-in `edit-pipeline-counters.js` can count
full-document index builds, full patch applies and insertion-point full-tree
scans in tests; it is not a Session and has no production stream. Undo/redo
restores the open-document history tuple and is not a new `fullPatchApply`. Live
`SemanticDocumentState` objects may remember the owned index for their current
bytes until they are collected; that is not a global source-index cache.

**Target, not done.** `Verified*Context` objects still live only inside one
operation and are not a reusable source-index cache.

Living ADR status is in `docs/decisions/README.md`. Read this map and the
Living rows for ADR 0062, 0064 and 0065 for today's contract. Historical
paragraphs inside an ADR body, including early "do not migrate Canvas yet"
context, are not the daily implementation entry.

`HtmlCanvasEditor.tsx` and `bridge/project-file-repository.mjs` are composition
surfaces. Start from the capability-context contract, owners and named
symbols; do not default to reading the whole file. Independent decision
functions may be extracted when they have explicit inputs and outputs;
do not split one state owner across hooks only to reduce line count.

## Default reading set by task

| Task | Read first |
| --- | --- |
| Comments UI or composer | this map, `workspace-controller-capabilities.d.ts`, `CommentWorkflow`, `CommentSession`, `comment-rail-container.tsx`, `comment-canvas-port.js`, `comment-rail-contract.ts`, focused comment tests |
| Save / autosave / conflict | this map, `DocumentWorkflow`, `DocumentSession`, P1-B CAS in `ProjectFileRepository` |
| Open / switch / tabs / close | this map, `WorkbenchNavigationWorkflow`, `ProjectWorkflow`, `project/*.js` plans, `INTERACTION_FLOW.md` sections 2, 3, 4 and 12 |
| AI submit / cancel / review | this map, `RunWorkflow`, `VersionWorkflow`, `CHANGE_REQUEST_PROTOCOL.md` |
| Agent connection, API Key or login | this map, `STATE_OWNERSHIP.md` Agent rows, `SECURITY_MODEL.md` credentials, `agent-provider-catalog.js`, `AgentSetupPanel.tsx`, `INTERACTION_FLOW.md` settings / AI 服务, `shared/agent-protocol-acceptance.mjs` |
| Cross-owner or persistence | `STATE_OWNERSHIP.md` and `ARCHITECTURE_CONTRACT.md` |

## Architecture gate

The gate must enforce responsibility, not private field names:

- Views cannot import or call the Bridge.
- Application cannot import React, Workbench presentation, components or desktop.
- Domain is pure.
- Sessions are constructed only by `createRuntimeWorkspaceController()`.
- Repository internals are not a second writer.
- Retired modules stay deleted.
- Global Notice growth is frozen to `scripts/notice-disposition-ledger.json`.
  Generic `setToast` is retired. Remaining interruptions are closed
  `GlobalInterruption` kinds; lasting content-safety states use
  `WorkspaceSafetyState` on existing workspace banners.
- Internal reliability failures log through `reportInternalFailure()`; they must not create Notice.

Do not add checks for `#privateField`, private method names, or “this call
text must appear in this file”. Public outcome tests own those invariants.
Line-count ceilings are observational; they are not a reason to split files.

## Comment render boundary

```text
CommentSession + CommentWorkflow
  -> WorkspaceController.comments { getSnapshot, subscribe, commands }
    -> CommentRailContainer
      -> stable CommentRailView model/actions

HtmlCanvasEditor selection + dual runtime target (operation/visual/comment anchor)
  -> source-backed TargetRef + bounded visualHint
  -> commentCanvasPort
    -> CommentRailContainer
```

`CommentSession` keeps immutable collection identities when only draft text
changes. `CommentRailContainer` owns capability-local subscriptions, disclosure,
delete confirmation, composer/edit refs, the attachment picker, card measurement,
virtualization, rail scrolling and reveal/focus timing. `commentCanvasPort`
stabilizes disposable cross-region presentation: Canvas selection, layout authority,
target geometry, document height, composer/edit/focus disclosure and draft-target/picker
intents; it never owns comment facts. Workbench's aggregate
subscription may suppress composer-text and edit-text-only revisions; saved
comments, attachment structure, persistence errors and every non-comment
capability still invalidate the composition root.
Persistent `sourceAnchor.elementId`, refreshed expected source Hash and optional text locator are
Comment/Draft facts; `TargetResolver` maps a complete managed Working Copy only by that ID
and never consults disposable geometry or Runtime DOM. The old heuristic resolver is not an
official result and is not retained as a shadow path. A runtime `visualHint` is bounded display context only: Canvas may best-effort
match it inside the proven source host after a rerun, using a generation-scoped spatial index for
hover and a bounded kind/path candidate set for restore, then fall back to that host without changing
permissions. A `body` source anchor with a runtime hint is never an explicit global comment; only a
body target without a runtime hint receives global marker, rail and whole-page task semantics.
`commentCanvasPort` carries only the resulting selection and measurements.

## Project render boundary

```text
ProjectSession + ProjectWorkflow + ProjectRulesWorkflow + VersionSession
  -> WorkspaceController.projectCatalog { getSnapshot, subscribe, commands }
    -> WorkbenchGlobalSidebarContainer / StartPage catalog containers
      -> current-project context and version-tree navigation
```

The global sidebar owns the visible project context, safe project switching, the
single mixed project list and the fixed settings entry. The current project
contains the “长期规则” row; it is not part of the version timeline and opens
the singleton `project-rules` tab in the workbench without a version date.
Project rows are deduplicated by `projectId` and ordered by the authoritative
content-update timestamp; opening a project does not update that order.
`ProjectRulesSession` and `ProjectRulesWorkflow` remain fact and lifecycle
owners for persistence, autosave and close/switch safety; the editor is only a
projection over that workflow. The document canvas remains mounted while the
rules tab is visible, so switching presentation does not rebuild the HTML
iframe. The repository may continue to persist the rules in its internal
`PROJECT.md` file without exposing that filename in the UI.

## Run and navigation render boundaries

```text
RunSession + RunWorkflow
  -> WorkspaceController.runs { getSnapshot, subscribe, commands }
    -> RunConversationOutlet
      -> AiConversationSidebar

WorkbenchTabsSession + WorkbenchNavigationWorkflow
  -> WorkspaceController.navigation { getSnapshot, subscribe, commands }
    -> WorkbenchTabBarContainer
```

Agent narration, truncation and narration timestamps are high-frequency
presentation facts. The Run outlet subscribes them directly; Workbench wakes
only when run identity, lifecycle, handoff phase or error structure changes.
The retired Handoff drawer has no parallel lifecycle or recovery UI: progress,
candidate decisions, conflict resolution and terminal failure recovery all live
in the conversation. The Tabs container owns keyboard selection/close/new and
focus restoration, while Workbench retains only the active-outlet composition
and the host callback that snapshots page presentation before a switch.

## Capability-context for `gate:plan`

`scripts/capability-context.json` is the reading map. It is separate from
`tests/test-impact-map.json`. Impact-map owners choose tests; capability-context
chooses what to read.

Use the same map in two ways:

| Stage | Command | Selects |
| --- | --- | --- |
| Before edits | `npm run gate:plan -- --context-domain <id>` or `--context-file <path>` | Owners, contract files, implementation, focused tests and named doc sections |
| After edits | `npm run gate:plan -- --base origin/main` | The same reading set for files in the real Git diff, plus test selection |

`--context-domain` and `--context-file` never change test selection or the
`task:finish` `origin/main` base. When those flags are present, the reading set
comes only from the requested domains or paths, not from the current Git diff.
When several domains share a document, a whole-file requirement covers any
chapter requirement for that file; chapter lists merge only when every matching
domain is chapter-scoped. Adding a domain must not shrink an existing reading
requirement. Read `capabilityContext.contract.files`
first. Expand `implementationFiles`, `focusedTests` and `requiredDocs`
(including `requiredDocs.sections`) only as needed. The flattened
`implementation` set remains the union of those lists. Unknown paths and
unknown domain ids appear as `unmatchedFiles` / `unmatchedDomains`; missing
map references fail map load instead of silently shrinking the estimate.

Repeatable locate comparison for five representative tasks lives in
`scripts/capability-context-locate.mjs`. It compares the frozen pre-change map
and frozen file-size snapshot in `tests/fixtures/capability-context/` with the
current cold-start query. The byte columns are **preset first-locate reading
size**, not observed Agent reading. The current map still validates that
referenced paths and headings exist; the historical baseline does not require
those old paths to remain in today's tree.

### Read-only project catalog query path

Sidebar/start page → existing `projectCatalog` capability → ProjectWorkflow
summary/list port → Repository metadata validation and locator probing.
`project-catalog-query.js` is a stateless query procedure under WorkspaceController;
it owns no Session or Store. The Controller retains summaries and request generations,
and injected `project-version-tree-model.ts` projections normalize current and
background rows. This path never enters open, activation or recovery.

### Workbench display projection

Session snapshots → `workbench-header-projection.ts` → tab title/view badge,
sidebar selection and toolbar permissions/reasons. This is a pure view projection;
it cannot change history locks, canvas mode or file-operation authority.
`project-version-tree.tsx` renders an ordinal list; `version-graph.ts` now retains
only entry-title projection, with lane layout and connector algorithms removed.

Historical creation (E): `ProjectFileRepository.createVersionFromHistory` owns
the manual Version transaction and idempotent recovery; Bridge exposes
`/history-version/create`, `/result`, `/opened`. VersionWorkflow and the existing
Controller expose create/query outcomes. The UI cut-over is F. See the unique
contract in `VERSION_AND_PROJECT_FILES_PRD.md`.


History actions F: Workbench history Edit → HistoryCreationDialog → existing
VersionWorkflow create/query/openCreatedHistoryVersion. Opening validates a full
workspace through injected codecs before managed-source transition; rendering
acknowledgement is separate from Repository commit. Project hydration forwards
the durable history operation locator to the same workflow for recovery.

Codex execution transport: `bridge/agent/runtimes/codex-client-tools.mjs` adapts
verified native client tools into the shared ACP host; lifecycle remains in
`acp-process.mjs`, authority in `hosts/execution-host.mjs`. See ADR 0053's
2026-09-09 client-tool execution section.
