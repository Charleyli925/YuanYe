# Development guide

## Requirements

- macOS 12 or newer for the Electron and packaging gates
- Node.js 22.13.0 or a compatible Node 22 release
- npm, Git and Chromium installed through Playwright
- Authenticated GitHub CLI (`gh`) for Pull Request-aware worktree audits

```bash
nvm use
npm ci
npx playwright install chromium
```

`npm ci` is the dependency source of truth. Change dependencies with npm so that `package.json` and `package-lock.json` remain synchronized.

Run `npm run audit:dependencies` after dependency changes. The policy and temporary reviewed upstream exceptions are documented in `docs/DEPENDENCY_SECURITY.md`.

## Running the application

```bash
npm run dev             # web development server
npm run desktop:dev     # build renderer and launch Electron
```

## Agent task lifecycle

```bash
npm run task:status
npm run task:start -- fix/short-description
# enter the reported .codex-worktrees/fix/short-description path, then edit
npm run task:finish
```

`task:start` requires the clean synchronized primary `main`, leaves it unchanged
and creates an isolated worktree under `.codex-worktrees/<prefix>/<name>`.
`task:finish` runs the task gate against `origin/main` and reports committed
plus uncommitted task files. It is the single end-of-task entry; do not run the
same `gate:task` immediately before it. Neither command commits, pushes, merges or
releases.

Use `npm run task:audit` for a read-only inventory. After a squash merge, preview
the exact local cleanup with `npm run task:retire -- <branch>` and add `--apply`
only after reviewing its actions. Use `task:attach` for an existing local branch
and `task:sync-main` to fast-forward the clean primary checkout. See `AGENTS.md`
and `docs/CODEX_WORKFLOW.md` for the complete automation and authorization
boundary.

## Product ACP Agent Bridge

The packaged Bridge owns the product session through
`bridge/agent/agent-runtime-coordinator.mjs`; the old Service exports only
delegate existing routes. Current execution binds by canonical selection;
historical `mode: "qoder-acp"` is projected at the delivery codec, not by a
registry driver map. The registry registers both Qoder and Codex through the single
`acp` runtime in `bridge/agent/runtimes/acp-runtime.mjs`; unknown
provider/runtime IDs fail closed. The restricted Host Ports now live in
`bridge/agent/hosts/`, while frozen execution policy lives in
`bridge/agent/policies/`.
`bridge/qoder-acp-client.mjs` retains the legacy transport façade and exact
compatibility exports without a second policy brand. The
renderer can request `POST /agent/preflight` and `POST /agent/start` with
registered task identity, the fixed `qoder-acp` driver, explicit
`trusted-local-agent-v1` consent and an opaque short-lived ticket. When Qoder
is not installed it may also `POST /agent/install` for the catalog-pinned
managed copy. It cannot provide a command, cwd, environment or filesystem path
policy.

`GET /agent/diagnose` is the Settings status route. It resolves and verifies
the selected installation, then returns four bounded facts: installation,
authentication, protocol and service. Built-in HTTP vendors may use `/models`;
a Custom OpenAI-compatible endpoint validates only its saved configuration and
does not require a catalog route. Qoder uses version/model-list checks and
Codex verifies login plus ACP `initialize` without opening a task session. The
route creates no preflight ticket or ACP session and cannot change the selected
model. A diagnosis is selection-keyed single-flight with a bounded 30-second UI receipt and configuration-generation fencing. Native Codex login owns automatic browser opening; Stemmio only reopens it on explicit user action. Concurrent login callers reuse the live Bridge operation, including unconfirmed cleanup. A weak Settings result
cannot erase a stronger failure learned during preflight or execution.
`GET /agent/availability` remains the disk-only compatibility route. Codex
collects all candidates before applying explicit-test, managed, then
user-global priority, so a broken lower-priority global shim cannot mask a
valid managed installation.

Before execution, the one-use ticket revalidates both the Codex ACP adapter and
its pinned native executable identity; a changed or incomplete closure fails
closed without spawning the Agent.

Discussion is retired. The renderer and Bridge expose no discussion start,
status or cancel route; only execution-purpose tickets are accepted. Historical
Conversation records remain readable through the ordinary conversation routes.

Product discovery accepts a protected standalone `@qoder-ai/qodercli` package
at version 1.1.27 or newer. It intentionally rejects the executable embedded in
Qoder.app and ordinary `PAGEROOT_QODER_ACP_COMMAND` overrides. Tests may inject
a synthetic executable only with both `PAGEROOT_E2E=1` and
`PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND=1`. The 源页 HTTP Agent may use a
loopback `127.0.0.1` chat endpoint only with both `PAGEROOT_E2E=1` and
`PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL=1`. The readiness probe runs before
Request creation; a failed CLI/version/login/model-list check must leave no new
Request, and a successful ticket is reused by the immediately following
submission instead of probing twice. Same-Request retry is allowed only while the current
Bridge has confirmed its process group stopped and no output/completion remains.
A crash lease, unknown cleanup or residue requires cancelling the old Request as
an authority fence and submitting a new one. Candidate completion remains owned
by the official finalizer plus Repository polling.

HTTP execution requests SSE with `stream: true`; incremental document bytes
stay inside Bridge and are written only after `[DONE]`, complete-HTML validation
and the ordinary authority recheck. HTTP and ACP execution use a 45-minute
sliding inactivity watchdog. Valid content, reasoning, usage or heartbeat
resets it, while startup/login/preflight retain short timeouts. Runtime silence
is `AGENT_TURN_TIMEOUT`; disconnect, cancellation and timeout never finalize a
partial Candidate.

`PublicExecutionSession` keeps retry safety separate from recovery guidance.
`safeToRetry` says whether the same frozen Request is technically safe to run
again; `recoveryKind` says what the user must do (`retry`, `wait`,
`reauthenticate`, `change-model`, `change-provider`, `repair-installation` or
`end`). Renderer actions are derived from that structured pair, never from
provider prose. Managed-install progress is likewise hydrated from the
Bridge-owned `installState`, so cancellation remains available while the
original install request is pending.

The purpose-bound one-use ticket stores provider/runtime IDs, a frozen security
profile, an opaque installation digest
and frozen capabilities only inside the Bridge. The renderer and Electron
preload never receive those fields or an executable, command, spawn or path
capability. Provider/runtime contract fixtures must be synthetic and must not
contain a real home directory, account output or secret.

Run the deterministic owners directly while developing this boundary:

```bash
node --test tests/qoder-acp-spike-client.test.mjs
node --test tests/codex-acp-provider.test.mjs
node --test tests/codex-candidate-authority.test.mjs
node --test tests/agent-provider-contract.test.mjs
node --test tests/agent-bridge-service.test.mjs
node --test tests/agent-bridge-workspace.test.mjs
```

ACP is not an OS sandbox. The product presents and records an explicit
trusted-local-Agent choice; see `docs/SECURITY_MODEL.md`, ADR 0032 and ADR 0039.

## Qoder ACP v1 synthetic spike

`npm run spike:qoder-acp` is a development-only compatibility probe. It
requires an independently installed, signed-in Qoder CLI with ACP v1 support;
set `PAGEROOT_QODER_ACP_COMMAND` to an absolute executable path when it is not
on `PATH`. The command creates a synthetic v4 Request under an isolated
temporary Project File, drives Qoder over ACP, runs the official finalizer and
verifies that the result is a pending-review Candidate while the Working Copy
and Version remain unchanged.

The command never accepts a real user HTML path. Its sanitized result is written
to ignored `output/qoder-acp-spike/report.json`; Agent text, account details,
credentials and temporary paths are not retained. A Qoder login, model-capacity
or network failure is a blocked live probe, not release evidence and not a test
pass. The current harness constrains ACP calls but does not OS-sandbox the local
Qoder process, so it must not be repurposed for real user Requests. See
`docs/decisions/archive/0056-qoder-acp-v1-spike.md`.

## Test lanes

Private real-HTML execution is currently migrating to reviewed local manifests.
The old `local-html-corpus.mjs` entry allows read-only `capability-preflight-only`
and rejects automatic-discovery qualification. The frozen micro entry
is `node tests/e2e/electron/frozen-html-operation.mjs`, with the local manifest
path and independent SHA-256 supplied through `PAGEROOT_FROZEN_MANIFEST` and
`PAGEROOT_FROZEN_MANIFEST_SHA256`. Reviewed plans choose either one selection or
the fixed native text chain (activate, type, Backspace, save, undo, redo).
The `core-text-format` scope adds explicit unbold preparation, bold and restart
verification on the same frozen target. Its manifest fixes the expected history
adoption path and source/contract basis before execution. History waits for
source-matched handoff completion; only a pre-reviewed Candidate path may bind
the same target ID in a new Document. Direct text/style edits retain their
no-rebuild check. Runtime history plans declare session end plus explicit
same-ID reentry as separate operations; observing lost focus alone is not a
product failure or permission for an unplanned recovery click. Generation comes from the unique Active iframe; promotion
identity comes from that iframe's Candidate binding, not delayed root metadata.
Format scope is also frozen: source-safe range wrapping and element-level style
overrides are distinct capabilities. A forbidden flex/grid range wrapper does
not authorize an execution-time switch to element formatting or another target.
These partial scopes do not attest eight-file core acceptance or full qualification.
The separate `element-text-format` scope accepts reviewed h1–h6/p/li/td/th
hosts with a frozen text-node path, character offset and initial text digest.
The reviewed native-end trailing whitespace is frozen too; it must match exactly,
not be inferred from the live caret. This scope permits only link raw attribute-token
reordering inside the edited host, retaining exact values and outside bytes.
It reuses the in-place text/history and element-format oracles, adds explicit
forward Delete and Enter-with-continuation evidence, and requires exactly one
fresh source break with unchanged surrounding bytes. It does not broaden old
paragraph/pressure manifests or discover replacement targets during execution.
`core-three-cycle` composes the same text/structure operations over two reviewed
targets in one Electron session. It runs exactly three cycles, retaining text,
comments and history; copy insertion offsets never change or get rediscovered.
The fixed structure prefix must still match before each copy. Each rebuild has
a no-refocus input probe followed by explicit same-ID text reentry. Comments use
persisted comment ID/source anchor, survive the final reopen, then are deleted.
This representative diagnostic is neither an eight-file result nor a pressure run.
The separate `core-pressure-20` scope reuses this fixed chain for exactly twenty
cycles in one fresh session, with all twenty comments checked after reopening
and individually deleted. Run it only after same-version eight-file core
acceptance; the scope alone does not attest that prerequisite. Three-cycle
diagnostics and different sessions cannot be added to its count. Any failure
stops the run. The `core-pressure-50` and `core-pressure-100` scopes use the same
fixed chain and accept only their exact numeric cycle counts. They require a
clean analysis of the previous tier before execution; accepting a manifest is
not pressure qualification, and counts from separate sessions cannot be joined.
Initial load and reopen also wait for the manifest's declared Runtime terminal
before the handoff barrier: an idle temporary static iframe during resource
preparation is not a completed dynamic startup. Fallback remains explicit failure.
The bounded `core-structure-leaf` scope freezes one reviewed plain-text span or paragraph and
its source insertion offset. Copy output identity is bound only after an independent
byte oracle proves a single fresh leaf at that offset; edit/delete never discover
or substitute another target. Static rebuild and Runtime Candidate adoption are
separate declared paths. The separate `core-copy-denied` scope binds one reviewed
Runtime-added attribute absent from source and verifies exact UI/live refusal,
fresh probe acknowledgement, hidden copy action and unchanged source/Document.
Reviewed boundary witnesses may also prove a nonempty extra style/SVG/chart
attribute, an authored empty container populated by Runtime, or an opaque Canvas.
The witness ID, source-relative diagnostic path and single padding point are frozen.
Canvas records its pointer-transparent parent's raw hit separately from the
Canvas selected ID; neither that mapping nor the click point is inferred at run time.
It does not force-dispatch a hidden command or count as a successful copy.
An explicitly frozen `session-ended-no-refocus` structure probe adds direct
keyboard delivery checks immediately after copy/delete, before any target click.
Wrong focus, observed input delivery, source changes or a missing observer fail;
the later fixed copy selection/edit remains a separate operation. This micro
probe is not a three-cycle mixed-session or stress acceptance result.
See `tests/TEST_STRATEGY.md` for the separate eight-file core acceptance scope.

| Command | Purpose |
| --- | --- |
| `npm run gate:edit` | Fast, impact-selected feedback for uncommitted work |
| `npm run gate:plan -- --base origin/main` | Compact JSON of the task-lane selection: owners, Node tests, capability canaries, estimated fan-out and capability reading sets |
| `npm run gate:plan -- --context-domain <id>` | Same reading map before any files have changed; does not select tests or change `task:finish` |
| `node scripts/capability-context-locate.mjs` | Compare five representative locate tasks against the frozen pre-change map and size snapshot; reports preset first-locate reading size, not observed Agent reading |
| `npm run gate:task` | Static checks plus impacted Node tests and capability-level Browser/Electron/AI canaries |
| `npm run gate:task -- --resume <run-id>` | Replay a failed task gate on the identical source hash; reuse passed suites only when fingerprints match |
| `npm run gate:main:auto` | Optional local/diagnostic Node/browser smoke; it is not part of the automatic post-merge path |
| `Release Dry Run` Actions workflow | Candidate-classified Ready packaging check: generate the stable application-update config, assemble an explicitly unsigned (`identity=null`) App, cross a clean-job checkpoint, rebuild metadata/renderer oracles and launch-check identity without credentials; source-only candidates skip it |
| `npm run gate:release:auto` | Complete source gate on a clean commit |
| `npm run package:developer` | Optional arm64 Developer Preview requested explicitly: distinct app/Bundle identity, stable-tag-derived test version, stable Developer ID DMG, isolated runtime roots, packaged-content verification, one startup, and an exact live PR/content delivery report; no notarization or publication |
| `npm run gate:candidate-app:auto` | Guarded internal formal-candidate preflight: assemble one ad-hoc App, verify contents, then run the complete packaged-runtime oracle before signing |
| `npm run release:mac` | Complete source gate, signed arm64 DMG/ZIP package, packaged runtime test, artifact verification and exact live PR/content delivery report; release credentials are required for notarization proof |
| `npm run test:electron:ci-preflight` | Synthetic hosted-macOS window, timer and animation-frame preflight used before Electron product suites |
| `npm run benchmark:persistence` | Build one Electron renderer, then serially collect frozen-main full-HTML persistence decision evidence: it rejects changed runtime inputs outside its explicit harness/report allowlist; each autosave, switch and close duration stops at that operation's own endpoint; and it measures memory, event-loop and safety oracles |

Every `gate:edit` or `gate:task` run writes its selected files, suites and reasons
to `output/test-runs/<run-id>/selection.json`, including which rule matched each
file, which owner selected each test, rule-to-production coverage and width
warnings. `gate:plan` prints the compact subset of that record to stdout. Inspect
these files when validating a local ownership change instead of inferring
selection from command duration. When changing `tests/test-impact-map.json`, run
`node --test tests/test-gate-selection.test.mjs` before the ordinary gate. The
selection contract keeps direct-owner coverage narrow while the `release` lane
remains a fixed complete suite. Canvas pointer/selection/overlay, Review
algorithm files, Agent provider/runtime leaves, Repository internals and
Desktop IPC modules each have their own owner so a leaf change does not
reselect the old wide union. Task canaries are Playwright tags such as
`@smoke-editing`; the original global `@gate-smoke` union remains the `main`
lane smoke. Ready PRs still run `node-full`, `browser-full`, `electron-full`,
`ai-closed-loop` and `dom-editing-compatibility`. The synthetic scan runs through
`npm run test:dom-editing-compatibility`; it does not replace the opt-in
private-corpus Electron acceptance. After the selected local gate has passed,
do not rerun the complete matrix or packaging unless the diff changed, a check
failed, or a specific unresolved risk remains. Node passing does not prove
Enter, IME, caret or iframe continuity.

Node business tests use public Session/algorithm outcomes rather than scanning
Workbench, Canvas, JSX, CSS, or callback source. Explicit application
source-shape invariants are centralized in `scripts/check-architecture.mjs` and
run by `typecheck`. `tests/architecture-boundaries.test.mjs` owns the checker's
AST fixtures and is selected only when the checker, its AST query, budget/config
or those fixtures change. Package, dependency,
security, and workflow scans remain with their dedicated owners. The one SSR
test, `tests/rendered-html.test.mjs`, imports the real `dist/server/index.js`, so
impact selection schedules `build-web` before running it.

The developer-preview, release and artifact lanes stop if the worktree is dirty or if HEAD/tree changes during the run. Test reports are written to the ignored `output/test-runs/` directory; successful installer lanes additionally write `package-delivery-report.json` and `.md` below `output/`. The final report step requires live GitHub PR metadata and fails the installer handoff if it cannot enumerate the exact tag-to-commit range. Package commands always build the exact current clean Tree; they do not discover or merge other PRs. For an unqualified "latest" package request, prepare the required `origin/main` plus non-excluded-PR integration Tree first as documented in `docs/GIT_WORKFLOW.md`. `package:developer` is never called by another lane: run it only after an explicit developer request. Its Developer ID, optionally unnotarized DMG is retained for short installation feedback and is never release-eligible; missing identity or signing failure is a hard stop, with no ad-hoc fallback. Preview auto-update checks and installs are disabled. See `docs/DEVELOPER_PREVIEW_PLAYBOOK.md` for the isolated roots.

The package delivery report resolves commit-to-PR metadata with at most eight
concurrent requests and an in-run response cache. It prints the current item
and completed/total count to stderr, stops after an eight-minute overall
deadline by default, and accepts `--deadline-ms` for a deliberately chosen
override. Before writing the report it rechecks the exact source HEAD and Tree
so a slow metadata scan cannot silently describe a different package.

Desktop development and Electron E2E disable live update checks. The pure
application-update controller is covered by Node tests; the Release Candidate
lane owns the installed-App, Developer ID, notarization, signed-App checkpoint,
ZIP/blockmap and `latest-mac.yml` evidence. It validates contents and full
packaged runtime against a pre-sign App, proves signed startup, then passes the
same notarized App to the final artifact job without rebuilding. That fresh job
restores the App's exact embedded build, telemetry and application-update
metadata, then builds only
the deterministic Electron renderer used to compare the restored App payload
against the identical source tree. It does not regenerate telemetry or
application-update configuration, or receive the project token. Formal local
packaging is a distribution build and therefore requires a valid Developer ID
identity; publication credentials remain in GitHub encrypted secrets. The
separate developer-preview profile removes release, Apple and telemetry
credentials from its child environment, keeps only the local signing identity
inputs, and requires a Developer ID Application signature. It never silently
falls back to ad-hoc signing.

Final Ready candidates that touch packaging, release metadata, Electron, packaged
Bridge, Schema or bundled-resource paths run `Release Dry Run` through the
candidate classifier. Source-only candidates skip it successfully. Its first
macOS job builds the renderer, generates build metadata, the stable GitHub
application-update configuration, plus an enabled synthetic telemetry
configuration, assembles and verifies an explicitly unsigned
(`identity=null`) App, then
uploads a source-bound checkpoint. A second clean macOS job restores the
checkpoint and its exact metadata, rebuilds the renderer comparison oracle,
revalidates the payload and launches the App to compare `app.getName()`, the
runtime version and `CFBundleIdentifier` with `package.json`. The workflow does
not reference repository secrets, build a DMG or updater asset, sign with
Developer ID, notarize, tag or publish. Its checkpoint is always
`releaseEligible: false` and is structurally rejected by the formal Candidate
checkpoint verifier.

Desktop development and every automated test also leave live usage telemetry
disabled unless `PAGEROOT_TELEMETRY_DEV=1` is explicitly set. Telemetry tests
inject a fake fetch implementation and synthetic project token, so local test
runs never send product events. A distribution package embeds only the public
PostHog project ingestion token generated from `PAGEROOT_POSTHOG_TOKEN`; never
use a personal or project secret API key.

Electron product suites run their BrowserWindow hidden by default and keep
background timers and frame commits enabled, so local automation does not
activate PageRoot or cover other applications. Background mode still keeps the
macOS Dock icon: click it to bring the window forward, inspect the run, and
minimize it again. Every E2E mode suppresses automatically triggered native
dialogs and logs them instead of popping up, including
`PAGEROOT_E2E_FOREGROUND=1` visual debugging. The hosted-macOS environment
preflight uses a visible inactive accessory window because that suite must
prove WindowServer painting without stealing keyboard focus.

Draft Pull Request opens, updates and reopens first freeze one impact plan in a lightweight Job. Ubuntu Node/Browser and any selected macOS Electron/AI lane then consume that exact plan in parallel. Within each runtime, capability tags and changed specs are discovered together, deduplicated by project, file and full title path, then executed once from a Playwright test list. The reconciliation evidence distinguishes passed, failed, skipped and not-executed tests; missing selectors or planned tests fail closed. Draft failures and cancellations upload `output/playwright`. Local `gate:edit` remains Node-only. Returning to Draft skips the full matrix. Ready or a PR opened already Ready starts the complete source matrix: `branch-policy`, `candidate-context`, `baseline-policy`, `linux-deps` / `macos-deps`, Linux Node/Browser, both macOS Electron lanes, optional credential-free Release Dry Run, and `release-gate`. `codex-review` posts at most one `@codex review` comment for the current head and writes an informational thread snapshot; it is `continue-on-error` and is not a merge hard gate. Linux builds and shares only the Web renderer used by Node and Browser, and those jobs skip the Electron binary download. Each macOS job restores one OS/lockfile `node_modules` cache populated by `macos-deps`, builds the Electron renderer locally, runs the hosted-window preflight, then owns either the native Electron suite or the AI suite. Playwright and Electron downloads remain cached by lockfile identity. Clean successes upload only flaky evidence; full Playwright diagnostics upload on failure. The native Electron and AI lanes do not retry product tests. Hosted-window preflight is `@infra-sensitive` and may retry once in CI. `release-gate` downloads flaky evidence and refuses attestation when a product suite is flaky, retried, or the same SHA has an untriaged product failure. Dependency, Playwright and Electron downloads are cached by lockfile identity.

After merge, `main-integrity` verifies the merged PR, exact Tree Hash and package/lockfile version against the fresh source-gate attestation, resolving the pull request from the squash subject’s trailing `(#N)` before the commit association lookup. It does not rerun Node or Browser smoke. A missing PR association fails closed. An explicit emergency bypass requires `PAGEROOT_EMERGENCY_MAIN_BYPASS=1` plus `--emergency-reason` and writes an audit record; it is not a silent warn-pass.

Critical workflow commands write machine-readable evidence and normalized failure signatures under `output/ci-evidence/`. The full taxonomy, same-SHA rerun rule, two-strike policy and operating metrics are in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
The CI-evidence contract test enumerates every stage used by the active source,
developer-preview, candidate and publication workflows, so an unsupported stage
name fails during source review rather than after formal packaging begins.

`npm run ci:health` is a local/manual summary of recent `ci.yml` conclusions and retry-recovered jobs. It is not a scheduled workflow and not a merge gate. Reports are written under `output/ci-health/`.

The native HTTP Agent has a credential-backed protocol smoke that is intentionally
outside the synthetic test suite. Product visibility (`releaseChannel`) is not
acceptance. CI Electron AI, fake ACP servers and local HTTP fixtures stay
`ci-synthetic` in `shared/agent-protocol-acceptance.mjs` and must be listed as
未验收 on the source-gate and Candidate `agentProtocol` record. Before claiming real-protocol acceptance, run
`npm run smoke:agent-vendors:real` with the four
`PAGEROOT_SMOKE_<VENDOR>_API_KEY` secrets (and optional matching `_MODEL`
overrides). It calls each real `/models` and `/chat/completions` endpoint, never
prints a Token, and must pass for DeepSeek, 智谱, 阿里通义, and OpenAI. Qoder and
Codex need a clean-machine install, official login, first round and review.

## Design constraints

- Treat the current HTML bytes as authoritative.
- Route edits through SourcePatchEngine and preserve unrelated bytes.
- Derive Canvas history only from accepted SourcePatch forward/exact-inverse
  results; never add a preview-DOM or component-local snapshot stack.
- Fail closed on ambiguous mapping or patch scope for direct source edits. For AI
  candidates, keep protocol/identity/Hash/path/complete-HTML checks hard, but do
  not inspect or signal authored script changes; treat comment targets as review
  guidance and low page continuity as a mandatory-review signal rather than a
  failed Attempt.
- Keep local filesystem operations behind the Electron/Bridge boundary.
- Add schema fixtures and compatibility tests for protocol changes.
- Never include real user documents in tests.

See `tests/TEST_STRATEGY.md` for suite ownership and `docs/ARCHITECTURE.md` for component boundaries.
