# Security model

PageRoot edits local files and renders user-controlled HTML, so its default policy is least privilege and fail-closed validation.

## Main controls

- Electron renderer sandbox, context isolation, disabled Node integration and explicit Content Security Policy
- Narrow preload APIs with payload validation instead of direct IPC exposure
- Project-path allowlisting and real-path checks for privileged file operations
- v4 Registry-bound write allowlisting: a privileged project-file write
  requires one Registry record whose `projectId`, registered root path,
  recovered root identity, `project.json`, and manifest mappings agree
- Hash-checked v4 Working Copy saves with recoverable no-replace publication
  and fail-closed external-modification checks; Canvas Undo/Redo persists only
  through this normal save route, with no separate Bridge history action or
  journal
- Repository-owned source-element identity migration with sealed before/after
  Hashes, complete recovery bytes and the same Working Copy CAS writer; only a
  registered current Working Copy may migrate, while external originals and
  immutable Versions remain unchanged
- Same-directory filename changes with a fixed HTML extension, source Hash
  precondition, no-overwrite destination check and a crash-recoverable
  operation journal
- Main-owned document recovery journals under `userData` with fixed versioned
  storage, strict project/document/Working-Copy/revision/Hash validation, temporary
  write + fsync + atomic rename + directory fsync, read-back verification and
  CAS receipts for replacement/path-rebase/deletion. File count, entry bytes,
  total scan bytes and scan duration are bounded, and one corrupt entry is
  isolated. The narrow preload API exposes only commit/read/rebase/remove/list
  outcomes; it never returns the journal directory,
  `userData` path or arbitrary filesystem-read capability. Journal evidence may
  authorize reversible detach, but never a source overwrite or conflict adopt.
- Per-process Bridge authentication token and managed workspace boundaries
- Narrow Edit-menu IPC: the main process sends only `undo`/`redo` intent, and
  native field history exposes only Electron's fixed undo/redo commands; the
  renderer cannot submit a filesystem path or arbitrary editing command
- Per-task Agent delivery choice: the portable path remains exact clipboard
  write plus readback, while the managed path is a Bridge-owned Qoder ACP
  session. Renderer payloads contain only registered task identity and an
  opaque preflight ticket; they cannot choose a command, cwd, environment,
  prompt, Request path, Candidate path or finalizer.
- Managed Qoder starts only after explicit `trusted-local-agent-v1` consent and
  a pre-Request preflight. Opening delivery or About performs a separate
  disk-only discovery that rejects the CLI embedded in Qoder.app and accepts
  only a protected standalone `@qoder-ai/qodercli` package at the minimum
  reviewed version; it never runs Qoder, contacts Qoder, creates a Request or
  locks the Canvas. Only explicit “Qoder CLI” activation performs `--version`
  and `--list-models`, verifies executable realpath/mode/content identity and
  obtains an opaque short-lived ticket; a changed executable invalidates that
  ticket. Arbitrary command overrides are enabled only when both dedicated E2E
  environment fences are present. Official Qoder/Codex login is started by the
  already-verified installation's `login` command; Main opens only an https URL
  whose host is on that provider's allowlist. Main restates that allowlist in
  `desktop/agent-login-url.mjs` because `shared/agent-login-url.mjs` ships as a
  Bridge extraResource and cannot be imported from asar. The renderer may request
  `html-agent-access:open-login` with `providerId` only and never supplies a URL,
  command or path. Public catalog snapshots expose `loginUrlPresent` without the
  OAuth URL. Opening the login page records success or an in-place failure so the
  user can retry without guessing. Official logout runs the verified installation's
  `logout` command for `cli-login` / ChatGPT accounts. Environment PAT/API keys are reported as `environment` auth scope
  and are not claimed to be revoked by in-app logout. The 源页 HTTP Agent may redirect preflight and
  chat to a loopback `127.0.0.1` base URL only when both `PAGEROOT_E2E=1` and
  `PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL=1` are set; production never honors
  `PAGEROOT_HTTP_AGENT_BASE_URL`.
- Fixed app-resource lookup for the packaged user statement and disclaimer;
  the renderer can request it but cannot choose a local path
- Default-browser opening accepts only an already known HTML source path,
  revalidates that file in the main process, and converts it there to a local
  file URL; the renderer cannot supply an arbitrary URL or protocol
- External OS/QoderWork opening accepts only a validated absolute `.html` or
  `.htm` path behind a main-process-created opaque request ID. The renderer may
  consume that ID once but cannot substitute a path; stale IDs are rejected,
  and the main-process project-open queue serializes its validation, reading
  and active-project mutation with every other active/recent-project transition
  so an older request cannot overwrite the newer active source. An external
  delivery interrupts an uncommitted close; after close commits it is stored
  only as the latest validated path in a private one-shot handoff, then passes
  the same mailbox validation again only after the next launch owns the
  single-instance lock. Classification of that path is read-only until the user
  confirms. The renderer receives only `requestId` and display facts; it cannot
  submit a filesystem path, source key or trash target. Optional deletion of a
  newly imported original is a one-shot Main `shell.trashItem` after Canvas
  verification, and only when the file still hashes the same, is a regular
  non-symlink file, and lies outside the projects root. It never grants a
  renderer path or a late
  active-project mutation.
- Desktop interactive preview runs under a dedicated `pageroot-preview:`
  origin. Its main-process session is size/count/time bounded, exposes no
  PageRoot preload bridge, and serves only a session-specific allowlist of
  declared relative script, style, image, font and media assets after source
  path authority, realpath and containment checks. Dotfiles, undeclared
  siblings and files reachable only through an escaping symlink are never
  exposed. The document response blocks `file:` resource loading and authored
  base URLs. The application renderer's CSP remains strict and the preview
  scheme does not receive `bypassCSP`.
- Ordinary static Edit may use the same contained resource root for images,
  fonts, styles and media, but not for renderer or authored scripts:
  `pageroot-preview:` is absent from `script-src` and every source transition
  revokes the previous session. After an external HTML import, Main substitutes
  the original sibling directory as that preview/edit resource root without
  exposing the original path to the renderer. The separate disposable Script
  path never reuses that preview session.
- Desktop Edit author runtime is a trusted-local authoring capability, not a
  hostile-page sandbox. Main re-reads the active source and requires exact
  HTML/SHA, Canvas generation, bounded supported scripts and contained resource
  paths before creating a scoped `pageroot-edit-runtime:` session. The visible
  iframe parses the complete source with author-script placeholders inert,
  registers parser-authored source objects once, and then activates that closure
  in source order with the sandbox tokens required for in-place editing. Relative assets resolve only through
  the declared contained map; direct `file:` assets and external or source-root-
  escaping authored base URLs are blocked. A first contained relative base is
  resolved inside the same resource closure. The protocol has no `bypassCSP`, directory listing or project-path
  response. Popup, form submission and top-level navigation remain blocked.
  `PAGEROOT_E2E=1` may hold Main `prepare` behind a process-local latch so tests
  can prove static Active acknowledgement without a grant; production never
  installs that latch.
  A fixed bootstrap privately proves the complete source-node set after parsing
  and before author code runs. An authored head script therefore
  cannot register a generated object against a future parser-node identity;
  copied public markers remain non-authoritative. The bootstrap does not
  freeze author activity or audit Runtime DOM. Its one-shot private capability
  also reports author activation outcome only after validating source window,
  session, execution and frame token. Script resource/bootstrap failures reject
  the Candidate; synchronous author errors and immediate unhandled rejections
  mark it partial and still require critical-content readiness before promotion.
  This signal does not inspect pixels, Canvas contents or later Runtime
  behavior. Exact ECharts 5.4.3 and 5.6.0 minified CDN
  references use their same-version packaged SHA-verified libraries. Exact-version allowlisted
  ECharts core URLs may be retained in a private content-addressed byte store:
  canonical URL metadata never replaces SHA-256 verification, corrupted entries
  fail open to the bounded network loader, and the store owns neither source nor
  execution authority. Exact immutable redirects must retain version, core
  filename and query identity before their bytes may be cached under the
  requested URL. There is no cross-version compatibility substitution or
  recovery session. An unavailable or corrupted packaged pin fails closed;
  other immutable versions use only their exact cache entry or bounded exact
  network request.
  Under the accepted product risk in ADR 0065, author scripts in that iframe can reach
  renderer-exposed contextBridge APIs on the parent. The iframe itself still
  has no Node integration and no preload or IPC sender of its own. Terminal
  preparation, provenance or resource load failure revokes the session and
  renders static Edit. Edit must not answer a security
  concern by converting to PNG.
  Main admits two concurrent preparations and retains a bounded recent request-
  ID replay window. Completed IDs age out, so renderer IDs cannot grow memory
  without bound and ordinary use cannot exhaust the app lifetime.
  Remaining low-cost boundaries: no directory listing or project path on the
  edit-runtime protocol, no popup, no worker, no top-level navigation.
- Strict schemas, frozen inputs and identity/Hash/path checks before accepting
  AI output; complete-document and non-empty-body checks remain protocol
  boundaries. Authored scripts, handlers, executable URLs and refresh directives
  are candidate content and are not inspected, classified or surfaced during
  acceptance; existing sandboxes contain execution separately. Weak page
  continuity forces isolated review instead of silently opening or falsely
  rejecting the candidate.
- The history-only decoder accepts both August 2026 Developer Preview
  candidate-assessment shapes after regular-file and four-Hash verification,
  re-runs only current document-health and continuity checks, and strips any
  retired executable fields or conclusions in memory. It never rewrites
  history or participates in source writes; archived outcomes stay terminal.
- Review-before-open reads only the frozen current HTML and immutable candidate
  Version after rechecking their identities and Hashes. Both copies render in
  unique-origin sandboxed frames; authored scripts, refresh directives and
  inline handlers are removed, nested frames are re-sandboxed, and links/forms
  cannot navigate or submit. On desktop, each sanitized copy uses a bounded
  `pageroot-preview:` session so the exact review bootstrap loads as an external
  script without weakening the application renderer CSP; the root sandbox still
  grants only scripts. Only that review scroll/focus bridge may execute, and its
  messages are bound to the exact frame and review session.
- Main-process-only usage telemetry with exact event/property allowlists,
  random installation/session UUIDs and HMAC project pseudonyms; no hardware
  identifier, content, path, filename, raw exception or stack is accepted
- No silent application update or binary replacement

## V4 Registry and managed-root authority

The v4 Registry is the canonical write allowlist, not a cache for locating
projects. A privileged project-file write requires one Registry record whose
`projectId`, registered root path, recovered root identity, `project.json`, and
manifest mappings agree. The root must be a direct child of the configured
projects directory, and every managed control path is real-path checked with no
symlink traversal.

The only mutable Registry compatibility path is the exact pre-hardening V4
shape with `schemaVersion: "4.0.0"`, no `pendingImports`, and no project-record
fields beyond `projectRootPath` and `updatedAt`. The migration reader validates
a current Registry read-only. Before completing that legacy shape, every record must
prove its valid key, direct-child real non-symlink root and matching
`.pageroot/project.json`; the new root identity comes only from the live
directory stat. A short-lived exclusive migration lock serializes the one
replacement across Bridge processes; dead-owner reclamation atomically claims
the exact sealed token marker, and every waiter re-reads under that lock
before it may publish. Validation finishes before the old Registry bytes are
copied to a Hash-named backup and one atomic current Registry is published. The
backup is not runtime authority. Any validation or publication failure leaves the old
Registry bytes in place and never resets, drops, scans, imports or reassociates
a Project. HTML Hashes and equal bytes never participate in this migration.

A registered project may relocate within the configured Projects root only when
one direct-child project has its stable project identity and a complete valid
project contract. Duplicate IDs isolate that project even if its registered
name still exists. Registry updates compare the recorded business mapping;
`rootFileIdentity` is a refreshable observation, never a restart gate. Returning
or copy-delete moving a complete project within this root may rebuild local
bindings after content verification. Moving outside this root still grants no
write authority. Import recovery remains limited to Registry-owned pending
intents; an arbitrary `.pageroot/import.json` is not an import grant.
The same canonical external path binds to at most one `projectId`. Content Hash
never matches a file at another path into that project. Duplicate source-key
claims fail closed without deleting or merging projects. Ordinary Registry
mutations take a current write lock under `.pageroot-registry-write-lock/`,
which is the only Registry lock. A Registry that is not a valid current Registry
fails closed and keeps its exact bytes; there is no migration and no fallback to
an empty Registry, because an empty Registry would let the next import
atomically replace the real file.

That lock is reclaimable, never terminal. A lock whose owner marker proves a
dead local process is retired through its exact observed owner token. A lock
whose ownership cannot be resolved at all — an empty directory left by a crash
between `mkdir` and its owner write, a doubled marker left between the two
retire renames, or a damaged owner file — is crash residue rather than a held
lock, and can never become resolvable again. Such a directory is reclaimed once
it is older than a grace period, after re-proving both its filesystem identity
and its still-unresolved lease. Age is measured from creation and content
timestamps only, never from inode metadata time, so an unrelated metadata touch
cannot restore a permanently busy Registry. A live resolvable owner is never
reclaimed on age alone. Releasing that lock is cleanup and never authority: a
release that cannot complete leaves an inert directory to be reclaimed on age,
and never becomes the outcome of an operation that already committed nor replaces
the original error whose code drives recovery.

Working-copy filename changes retain their immutable IDs. The Repository owns
`.pageroot/source-bindings/<workingCopyId>.ref` hard links as recoverable locator
evidence. A registered relative path selects a member; its state Hash validates
bytes. If that path is absent, only a unique currently matching anchor/file pair
can recover its name. Equal bytes at an unlisted path never grant membership.
Multiple visible links or conflicting member paths fail closed. Persisted
`device`, `inode`, and `birthtimeMs` never authorize startup, open or writes.
Physical comparisons use live observations within one operation only.

Retiring an ordinary save journal requires current project/member, source Hash,
state and previous-byte verification before existing recovery cleanup, followed
by identity/source/state revalidation after required publication synchronization.
Recovery removal must be durably synchronized before journal unlink. Unsupported
sync or cleanup failure retains the journal whenever unlink has not happened;
failure after unlink is an unconfirmed cleanup outcome, with recovery absence
already durable. This optional collection never broadens save authority and does
not collect identity migration, history or Promotion receipts.

After pending transaction recovery, valid registered members gain anchors
without changing HTML or Version records. Atomic anchor publication is the
per-member migration checkpoint. Missing/unsupported anchors do not invalidate
a verified registered path. A missing file remains missing until the user
requests restoration; the Repository rechecks the state Hash and publishes
only at its registered path without replacement. Metadata/version browsing is
independent of source probing, and source failures remain project-local.

HTML identity and bytes come from the same no-follow descriptor, with fstat,
Hash, and post-read path revalidation. Save retains the old object and prepares
a new binding inside the existing recovery directory, revalidates the current
project/member and expected Hash, atomically publishes, then switches the live
anchor. Recovery accepts only the transaction's old/new Hashes and retains
external changes as conflicts. Filesystem operations are not a lock against an
uncooperative external writer; displaced old bytes remain available for conflict
recovery. Promotion continues to derive IDs, lineage, paths and Hashes from the
runtime-sealed Candidate; its preparation file supplies live publication
identity, never the previous process's stat values. Collision publication stays
no-replace. An invalid prepared Hash or changed visible content is never deleted.

Source-element identity migration is narrower than path identity recovery. A
new import materializes IDs only in its managed Working Copy; the external file
and immutable V1 remain exact evidence. A legacy Working Copy may migrate only
under its valid Registry/project/manifest/state tuple. The transaction records
its exact old and new Hashes and stages complete byte sequences before the
same-directory CAS. Restart accepts only those two sides. Malformed or duplicated
IDs, a missing identity previously claimed by the current source, a mismatch
against the state-sealed ID/tag/parent/order binding Hash, and any third Hash
fail closed without first recording the external bytes. Existing direct editing may
allocate an ID for a newly authored inline source element, and the Repository may
fill only otherwise-valid new-element omissions after proving every prior claim
survives. Explicit force-unlock clears both the marker and binding seal before
adopting disk bytes and re-entering migration, including recovery from a prior
build that already recorded the disk Hash. Runtime DOM never participates.

The external AI Agent can write within the Request / Attempt workspace, so
those files are evidence to validate rather than runtime authority. Reopen and
crash recovery may follow only an already-sealed `runtime-state.json` Request /
Attempt / Working Copy anchor, or a registered Promotion transaction. A cleared
or missing runtime state never scans Request directories to revive an active
Request or to adopt a replacement input-manifest digest.

The packaged Qoder ACP provider/runtime path narrows the protocol surface but
does not change that trust statement. Current execution binds by canonical
provider/runtime selection; historical `mode: "qoder-acp"` remains readable at
the delivery codec. Unknown identifiers fail
closed. Provider/runtime IDs, the opaque installation digest and capabilities
remain inside the Bridge ticket, and preload exposes no executable, spawn,
command or path capability. One restricted driver serves execution policy
through the provider-neutral modules under `bridge/agent/policies/` and
`bridge/agent/hosts/`. Only the execution Host is registered, and every turn
must prove completion. It checks the runtime-sealed manifest Hash, exact current
Request layout, frozen file identities, single Candidate path and exact
official finalizer; every other ACP filesystem and terminal request is rejected.
It revalidates runtime authority before mutations and Candidate publication,
stages the output beside its destination, then atomically renames it. Prompt,
frames, updates, Agent metadata and public session history are bounded. Abort
closes the mutation surface before Qoder cancellation/process-group cleanup;
the Bridge cancels the durable Request only after that bounded stop completes.
Before spawn, an exclusive project-local lease and a final executable
dev/inode/size/mtime/content identity comparison fence duplicate launch. The
standalone npm JavaScript bundle is then loaded by PageRoot's trusted runtime
from the already-opened verified file descriptor, so a pathname replacement
cannot substitute different script bytes after that comparison. A normally
settled process releases that lease only after bounded process-group cleanup.
If the Bridge crashes, the lease remains: PageRoot never invents a
surviving session, and the processing Request becomes interrupted and
non-retryable. Durable cancellation then fences the old Request, but does not
claim an unknown old process has stopped; the user must submit a new Request.
Unknown cleanup and any unfinalized output/completion likewise block retry and
clipboard fallback instead of being overwritten.
Pre-Request version/model probes use the same bounded process-group cleanup.
An unconfirmed probe descendant creates no Request but remains a non-prunable
Bridge-level fence, so later preflight and application shutdown both fail
closed rather than forgetting an unowned local process.

PageRoot may also keep a product-managed ACP install under Application Support
`agents/<providerId>/<version>/` (Electron `userData`, overridable with
`HTML_AI_AGENTS_ROOT`). That tree is written only by the Bridge installer after
npm integrity and package-identity checks. It is not a user document root, not
a Request workspace, and not visible to the renderer as a path. A user-installed
CLI still wins when it passes the current identity checks; an invalid user
installation is diagnostic only when a healthy managed copy exists, and remains
fail-closed when it is the only candidate.
Quit, relaunch and update installation also fail closed: the Bridge stays alive
and the desktop app remains open unless all owned Agent cleanup is confirmed.

Every provider, ticket and launch descriptor freezes one `securityProfile`.
The installed Qoder and Codex ACP mappings are `client-mediated`: the Host
modules can allow or deny only file and terminal requests sent through the ACP
Client Host. They do not constrain native file or command operations performed
inside the Agent process. The PageRoot native HTTP Agent is also
`client-mediated`: PageRoot mediates every file read and the unique Candidate
write, and the vendor model never receives filesystem or terminal access. There
is no registered `agent-native` mapping and no Codex executable or private
runtime in the packaged application. Both installed ACP providers use one fresh
ephemeral session with approval `never`; strict configuration disables MCP,
skills, plugins, apps, Web/browser/computer use, memories and subagents. The
turn uses a workspace-write sandbox rooted only at the Request output
directory, with tool network access disabled and the system temporary roots
excluded. Any permission request, unsupported ACP request, unconfirmed
process-group cleanup, write residue beside the unique Candidate or
fixed-finalizer failure fails closed before Candidate publication. Unknown or
mixed ticket/launch profiles fail closed, and any future registered
`agent-native` provider requires its own sandbox conformance and security gate
before registration.

The Codex ACP profile is still a trusted-local-Agent boundary, not
hostile-process isolation. Codex runs with the signed-in user's OS identity,
may read local files that identity can access, and uses the Codex service for
the user-authorized task; the packaged privacy notices disclose those facts.

Codex JavaScript adapters use the same verified-descriptor host JavaScript
runtime for diagnosis, formal preflight and execution. A GUI launch does not
depend on `node` being present in the shell PATH. Executable identity and
closure checks remain required; native login/status still use the verified
native executable. Native authentication success is distinct from adapter
initialization success and never authorizes sending without formal preflight.

Discussion is not an authorized Agent surface. The Bridge has no discussion
routes, policy, Host, snapshot or session owner, and provider capabilities and
preflight tickets reject any non-execution purpose. Historical Conversation
records remain data only and cannot reopen an Agent process.

The driver may retain at most 16 KiB of raw Qoder stderr only inside the live
Bridge promise to classify authentication/capacity/process failures. It is
discarded after classification and never enters public Agent status, PageRoot
telemetry, reports or user-facing errors. Agent visible text that matches a
capacity failure is classified the same way and must not be projected as chat.
Absolute Request paths necessarily
appear in the user-authorized Qoder task prompt and may therefore be processed
by Qoder; the user statement and Privacy notice disclose that third-party path.

The 源页 Agent may be connected with a vendor API Token (DeepSeek, 智谱,
阿里通义, OpenAI, or another OpenAI-compatible HTTPS endpoint). Renderer posts
`POST /agent/session-credential` with `vendorId` and optional `baseUrl`; Bridge
keeps the secret in coordinator process memory and injects only
`PAGEROOT_API_KEY` / `PAGEROOT_API_VENDOR` / `PAGEROOT_API_BASE_URL` into this
provider's preflight and HTTP launch. Empty `apiKey` clears it. The secret is
never written to `ui-preferences.json`, logs, GET responses or renderer
snapshots. If the user explicitly checks “在此 Mac 上记住 API Key”, Main encrypts
it with Electron `safeStorage` into `agent-session-credential.v1.json` and never
returns the plaintext. Custom vendors may also persist the non-secret Model ID
in that same file. Encryption unavailable refuses to persist and does not
fall back to plaintext. Persist failure cannot be rewritten as a complete
connection success. Shutdown discards the session copy; a remembered
ciphertext may be restored into Coordinator memory after Bridge is ready.
Anthropic is not registered. Codex and Qoder do not accept a session Token.

This is an explicit trusted-local-Agent policy, not hostile-process isolation.
The Qoder subprocess still runs with the signed-in local user's OS identity and
can theoretically read or modify files without using ACP. The selection dialog
keeps only the concise task-specific disclosure that Qoder reads this turn's
HTML, comments and attachments and that results enter review; the packaged user
statement retains the complete local-permission, third-party-processing and
non-sandbox disclosure. The restricted ACP host is a cooperative
least-privilege boundary and must never be described as an OS sandbox.
Candidate completion still requires the official finalizer and Repository
validation; ACP stop/progress cannot create, adopt or activate a Version. See
ADR 0032. The synthetic live probe remains diagnostic evidence only and is not
a release gate (ADR 0056).

Installation and login guidance is copied only after the user's explicit
button action and must pass the same clipboard write/readback check as the
normal portable handoff. A local availability failure never writes the
clipboard. “获取 API Key” opens only the vendor HTTPS page returned by
`publicAgentVendorKeyUrl()` through Main `shell.openExternal`; that helper
ships in app.asar and must not also be listed in extraResources. Renderer sends
a vendor id, never a URL. Neither the delivery card nor About receives or displays command
paths, npm prefixes, versions or model counts; stable error classes remain in
local diagnostics.

## V2 editable-island trust boundary

The rendered preview DOM is disposable and never becomes a whole-document
persistence source. PageRoot 0.9.0 has one controlled `contenteditable="true"`
route:

The pure semantic-operation kernel is also source-only. It requires complete
persistent identity plus exact source, revision, tag and subtree-Hash evidence;
SourcePatch re-plans its lowered ranges before apply. New structural fragments
cannot provide PageRoot IDs, moves preserve exact identified bytes, replacement
retains the target root ID/tag, and generated exact-source inverse objects lose
authority when cloned. The kernel has no save, IPC, filesystem or Runtime DOM
capability in PR4.

- SourceIndex and TargetResolver must prove one exact, explicit-end-tag HTML
  element before activation.
- Runtime layout, text style, Selection, focus and restoration must pass the
  live preflight.
- The controller prevents ordinary `beforeinput` mutations and applies owned
  text, grapheme deletion, `<br>`, plain-text paste and safe inline formatting.
  Browser-created rich HTML has no authority.
- Authored comments and embedded/foreign content are immutable inventory;
  protected attributes cannot be introduced or changed through text editing.
- IME starts from a frozen island and logical Selection. Confirmation is
  replayed once at that frozen source affinity; cancellation restores the
  snapshot.
- MutationObserver rejects and restores any child/text mutation not owned by
  the controller.
- SourcePatch may replace only the selected element's exact content range.
  Nested non-inline HTML stays frozen inventory inside that range. Outside
  bytes and source Hash preconditions remain exact; only the authorized island
  may be minimally normalized and reparsed.
- Canvas undo/redo never serializes that preview DOM. The Bridge applies only a
  retained exact inverse/forward Patch after matching project/document
  identity, source Hash, history revision and cursor. Source HTML and the
  bounded journal share one crash-recoverable pending-write boundary; an
  external write or broken chain establishes a fresh boundary or fails closed.
  Reusing the mounted iframe is allowed only when exact target identity,
  byte-equal island-external source and the complete ephemeral source-node map
  all validate against those Bridge-returned bytes; otherwise the Canvas loads
  a fresh verified frame.

Pure-browser preview is a different, strictly weaker capability: authored scripts and interactions may run inside the sandbox, but PageRoot editing, comments, attachments, local persistence and AI submission are unavailable. Its transient page state is never treated as unsaved PageRoot content.

Desktop preview is likewise untrusted authored content. The iframe has no
top-navigation authority, new windows are denied, and preview IPC is available
only to the trusted application main frame. A direct preview frame that tries
to self-navigate is fenced by the main process; before its first load completes,
its volatile session becomes a one-way scriptless fallback retaining only the
owned external bootstrap, while later attempts leave the loaded page intact.
When the user returns to ordinary editing, PageRoot accepts only an allowlisted
source-backed presentation diff. It rejects unknown or duplicated source nodes,
stale Hashes, arbitrary one-sided runtime classes, text/HTML, inline style,
form state and runtime children. The desktop disposable Script page may keep
real author Canvas/SVG and generated DOM for display; those nodes have no source
or persistence authority and are never serialized. Save, review comparison and Request creation continue
from authoritative source bytes (the Bridge copies those exact bytes to
`input/base/index.html`), and the SourcePatch checks remain unchanged.

The AI review workspace is an isolated interactive review preview with no
activation or persistence authority. It preserves the identity/Hash-validated authored
scripts and inline events in a disposable review copy so source-backed Tabs,
disclosures and local controls can be inspected. The review iframe uses only
`allow-scripts`: it has no same-origin authority, form submission, top navigation,
popup, download, modal or host IPC capability. Parent-side capture also blocks
anchor navigation and form submission, nested iframes receive an empty sandbox,
and refresh/CSP meta directives are removed only from the disposable review copy
so they cannot navigate the frame or suppress the trusted review bootstrap.
Review facts come only from the two frozen HTML documents. The review renderer has no screenshot owner, runtime-capture IPC, PNG envelope, pixel parser or runtime binding. It reports precise text evidence and outermost element presence; movement, attributes, CSS, layout, wrapping and runtime drawing produce no Review fact.

Comment location remains separately private. Each source-resolved local target
may use an opaque initial-bootstrap binding: the element's `data-pageroot-id`,
an element path plus a narrow static fingerprint. Review never writes a parseKey
or second identity attribute into authored or prepared HTML. The managed
preview serves that binding only to the first parser-blocking bootstrap request,
then falls back to an unbound response. The trusted parent sends the final
key-to-target mapping only to the before bootstrap over a challenged private
`MessageChannel`. Comment body, key, Stable ID and locator-map data are absent
from document bytes and later bootstrap reads. A unique source `id`, `data-*`,
`name`, or `aria-label` is only a safe fallback; missing, ambiguous, replaced or
disconnected targets omit the comment marker rather than rebinding by guess.
This capability cannot discover or authorize additional Review facts. The user
still invokes the existing fail-closed ready-version activation path through
“直接打开” or the review confirmation “打开 AI 修改后”.

Current Edit comments use a separate ADR 0061 identity boundary. On a complete
managed Working Copy, a TargetRef resolves officially only through SourceIndex's
valid unique `data-pageroot-id` map; missing, invalid or deleted identity
becomes orphaned. Selector, fingerprint, source-offset and text-affix
heuristics are not an official result and are not retained as a shadow path.
Incomplete identity HTML cannot rebound across a hash change and cannot enable
direct Canvas edit. Whole-page comments use the body's Stable ID.
Selected-text locators contain source-backed decoded text offsets and
never authorize persistence from preview DOM.

Edit-mode reveal actions use the same trust boundary. They accept only strict
Tabs whose selected panel is proved by `aria-selected` plus `hidden`, native
details with one direct summary, and local button/region disclosures whose
`aria-controls`, `aria-labelledby`, `aria-expanded` and `hidden` states agree.
`data-p` / `data-tab` class-token Tabs and constant-index handlers such as
`switchChart(0)` are not edit-mode presentation actions; those pages still use
Preview when authored scripts must run. Links, forms, grouped details, popups,
popovers, drawers and authored event handlers are never executed. The action
changes disposable attributes only and
has no source-write, filesystem, navigation or implicit scroll authority.

## Untrusted inputs

HTML, attachments, AI output, update manifests and IPC payloads are treated as untrusted. Tests and fixtures must use synthetic data. A renderer compromise should not provide arbitrary Node or filesystem access; any new privileged API needs explicit validation and negative tests.

The default-browser HTML action first drains the exact renderer edit revision
to the authoritative source file. Its main-process operation accepts only an
authorized main-frame sender and a known ordinary `.html` or `.htm` project
path, then derives the `file:` URL itself. Executable negative tests prove
malformed, non-HTML, unknown, unsafe and unauthorized requests cannot reach
the shell launch adapter.

Close reconciliation never writes from a preview or from stale metadata. It
hashes the frozen authoritative renderer bytes, fences the current project
identity, and uses a bounded read-only `/source` query only when acknowledged
local state is insufficient. The response must match the captured registered
identity and its declared Hash must match independently hashed content before
it can repair the renderer projection. Any real byte divergence remains
fail-closed and preserves both the in-memory editor copy and the disk copy.

The telemetry preload method is fire-and-forget and does not expose a generic
network API. The main process verifies the sender frame and independently
sanitizes the event through a closed schema. Persistent telemetry state is
bounded, atomically replaced and private to the user. PostHog capture disables
person-profile processing and GeoIP resolution; autocapture and session replay
are not installed. HTTPS transport still exposes the source IP to receiving
network infrastructure, so product copy must not claim absolute anonymity.

## Distribution and update trust

Public macOS candidates fail closed unless they are signed by the expected Developer ID team, use Hardened Runtime, pass Apple notarization, carry a stapled ticket, and embed the reviewed stable GitHub `app-update.yml` before signing. The candidate gate validates the exact provider, owner, repository, release type and updater-cache contract; includes those bytes in the signed-App checkpoint; and verifies the signature, Team ID, Gatekeeper assessment, DMG, update ZIP, blockmap, update metadata and frozen hashes before publication.

The main-process update controller accepts only the stable GitHub Release channel, owns both the startup-plus-four-hour schedule and coalesced manual checks, downloads the hash-described ZIP only after an explicit renderer intent, keeps differential transfer enabled, and disables install-on-ordinary-quit. The renderer receives only a bounded immutable status snapshot and narrow check/download/install intents. The About entry opens only the main-process constant for the project repository; renderer input can never choose an external URL. The same surface opens the user statement and disclaimer only from its fixed signed-app resource path and accepts neither renderer paths nor URLs. A downloaded update can install only after a second explicit restart confirmation and the normal renderer/Bridge drain succeeds; update metadata never gains filesystem or editor authority.

The current application contains no legacy manifest parser, fetch client, or
version decision path. Clients from the earlier ad-hoc update era cannot
securely self-bootstrap into this trust chain; they must manually install a
signed and notarized migration release once. Formal 0.9.8 also lacks the
embedded provider configuration and therefore requires one manual install of a
patched signed release before automatic updates can resume. The legacy
`update-manifest.json` remains a Release-produced compatibility artifact only,
so already-published clients can find that migration release without restoring
the retired client code to the current application.

Install-level UI preferences (`ui-preferences.json`) are Main-owned, bounded
and atomically replaced. Schema v1 is migrated to schema v2, whose allowlisted
`workspace` fields are `rememberPanelWidths`, `sidebarWidth`, `inspectorWidth`,
`motion`, `restoreTabsOnLaunch`, `defaultAgentProviderId` and
`disabledAgentProviderIds`, plus `agentConfigurations` (only the three known
providers, each with a bounded provider-namespaced `modelId` and requested
`reasoning`, or null). No API Key, endpoint or installation path is accepted
in that map. Main strictly validates field types, provider identifiers and the
200–420px / 280–520px width ranges; damaged values are safely normalized on
read and unsafe patches are rejected. The renderer receives only trusted
`get`/`record` for a narrow workspace patch. A queued read-modify-write and
atomic replacement prevents Settings and Agent updates from clobbering one
another. The file must not contain HTML, paths, comments, credentials or
localStorage state.
Preference errors remain a Settings-page retry state; bounded close flushing
is best effort and cannot block a source HTML close that already completed its
own safety boundary.

The renderer may name only a provider selection. It cannot provide executable
commands, paths, permissions or a security profile. Preflight resolves the
installed provider/runtime and freezes canonical selection plus fingerprint in
a one-use ticket; start compares that ticket to the durable Request selection.
Malformed policies, cross-provider model ids, unknown providers and selection
drift fail closed.

### Manual historical Version creation

The existing Registry-authorized Repository serializes manual creation and its
recovery. A renderer-supplied path is not write authority: project/document and
Working Copy identity, expected current Hash, selected immutable snapshot Hash,
next ordinal and transaction provenance must agree. Snapshot and visible HTML
publication never overwrite an existing file. The final boundary rechecks the
old source plus prepared/published file identity and bytes before the manifest
commit. Replays validate operation inputs and return committed facts; a render
failure cannot allocate another Version. AI task/Candidate decisions are never
automatically cancelled by manual creation.

Codex managed execution uses an ephemeral read-only native thread and no native
approval grants. Native environments, inherited MCP servers, apps/plugins and
additional agents are disabled for this thread. Stemmio exposes only three
dynamic tools through its ACP adapter:
allowlisted frozen reads, exact Candidate submission and the frozen finalizer.
The existing execution host validates all three; the adapter cannot finalize a
turn from prose or a native write. Session/turn identity mismatches and unknown
tools are rejected. No additional listening port or credential transport is added.
