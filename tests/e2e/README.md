# Native DOM browser and Electron gates

These suites exercise the real PageRoot canvas in Chromium and Electron. Fast
Chromium fixtures run behind a simulated Desktop preload host; the Electron
disk-transaction gate starts from an isolated desktop recent-project record
and opens a real temporary HTML file through the production project IPC. Both
paths enter the same-origin edit iframe and operate authored DOM with real
mouse, keyboard, Selection, clipboard, `beforeinput`, and Chromium composition
events. They do not inject an editor implementation.

The gates require the authored fixture element itself to become the measured
`plaintext-only` host or the controlled `contenteditable="true"` fallback,
with browser-native Selection, caret, `beforeinput`, composition and guarded
mutation behavior. A passing build keeps the iframe `Document` alive during
typing, creates no substitute editing surface, and persists only the minimal
PageRoot SourcePatch transaction.

## Dependency condition

The repository declares Playwright as a development test dependency. Install
the matching Chromium binary once for the current lockfile, then run:

```sh
npx playwright install chromium
npx playwright test --config tests/e2e/browser/playwright.config.mjs
```

An explicitly chosen already-running server can be used without letting the
config start one:

```sh
PAGEROOT_BASE_URL=http://127.0.0.1:3000 \
  npx playwright test --config tests/e2e/browser/playwright.config.mjs
```

Without `PAGEROOT_BASE_URL`, the gate starts this checkout's production server
and refuses to silently reuse another process already listening on port 3000.

For Electron, build the renderer first, then run the isolated app tests:

```sh
npm run desktop:renderer
npx playwright test --config tests/e2e/electron/playwright.config.mjs
```

The final comment-to-AI loop has a separate deterministic Electron gate:

```sh
npm run test:ai-closed-loop:smoke
npm run test:ai-closed-loop
```

It creates an isolated temporary HTML and workspace, adds a comment through the
real canvas UI, freezes one Request, and exercises both verified clipboard delivery and a
managed fake-Qoder ACP session. The controlled Agent result runs the official finalizer,
becomes a separate Candidate, enters Review without changing the Working Copy, and only
after the test's explicit adoption creates and opens a non-overwriting working HTML. It also injects clipboard-copy failure,
missing finalizer, malformed HTML, out-of-scope output, and generated-version
activation failure.
The suite never pauses for a person or an external model. Its oracle is the
frozen input, generated output, scope report, finalizer records and exact files
opened by the production application.

Electron tests pass a dedicated `PAGEROOT_E2E_USER_DATA_DIR` that is accepted
only when `PAGEROOT_E2E=1` and the path is an isolated
`pageroot-native-e2e-*` directory under the system temporary directory. They
run the native window hidden by default, keep its renderer unthrottled, place
the bridge workspace inside that directory, remove only validated test
directories, and never change `HOME` or open the user's real HTML project. Set
`PAGEROOT_E2E_FOREGROUND=1` only for deliberate visual debugging. Background
mode keeps the macOS Dock icon (click it to inspect or minimize the window)
and all E2E modes suppress automatically triggered native dialogs, logging
them instead. The real-file case checkpoints and autosaves a temporary disk
HTML, proves that
only the authorized bytes changed, and then closes and reopens the app against
the same forward result.

## Coverage and release interpretation

This document defines gates; it does not record a pass for the current HEAD.
Results become release evidence only when every command is rerun against the
same final commit and content hash recorded by the automated gate report.

The live Playwright and Node inventory is generated from the repository, not
from this list:

```sh
npm run test:inventory
```

`scripts/generate-test-inventory.mjs` walks every `*.spec.mjs` and the Node
test groups. `tests/test-inventory.test.mjs` fails if this README names a
spec that is no longer in the repository, or if `tests/test-risk-ledger.json`
is missing a file-level risk owner.

Capability smoke uses Playwright tags (`@smoke-editing`, `@smoke-project-lifecycle`,
`@smoke-recovery`, `@smoke-agent`, `@smoke-review`, `@smoke-provider` and
`@smoke-run-lifecycle`) rather than title regular expressions. Native Electron
files are `electron-*.spec.mjs` plus `conflict-force-unlock.spec.mjs`; Runtime
handoff and queued-static fallback live in `electron-edit-runtime.spec.mjs`,
visual continuity in `electron-runtime-continuity.spec.mjs`, and live seeded
faults in `electron-seeded-faults.spec.mjs`. AI Review adoption and Version
projection stay in `ai-review-adoption.spec.mjs`.

- `native-editable`: the real authored element owns the caret and is directly
  editable.
- `select-comment`: native selection remains available, while direct mutation
  is withheld and the user is guided to a selection-scoped comment.
- `comment-only`: structurally generated or non-uniquely mapped content remains
  untouched and accepts only module/subregion comments.

Every source test treats the imported HTML bytes as the oracle. BOM, line
endings, entities, quotes, comments, duplicate attributes, formatting, and all
other bytes outside the approved SourcePatch ranges must remain unchanged.
The canvas has no DOM or component-local undo/redo stack. Source-reversal
shortcuts route through the document-owned, persistent byte-patch journal;
every undo/redo must validate the exact current and resulting source hashes.
Native undo remains local to focused comment and project-rule text fields.
A DOM serialization that merely renders the same page is a failure.

Playwright traces, screenshots, videos and reports are written only below
`output/playwright/`.

## DOM editing compatibility scan

The gate uses `tests/fixtures/native-dom/complex-layout.html` by default, so it
is deterministic and unattended:

```sh
npm run test:dom-editing-compatibility
```

An absolute local sample can optionally replace that input without changing
the test logic:

```sh
PAGEROOT_REAL_HTML_PATH='/absolute/path/to/complex-page.html' npm run test:dom-editing-compatibility
```

An override path must be an absolute existing `.html` file. The test reads it into a
Buffer and opens those bytes through the simulated Desktop host; it never
writes the original file. The config has `retries: 0`, uses only
`real-complex-html.gate.mjs`, and writes its artifacts under
`output/playwright/dom-editing-compatibility/`. A missing safe editable target or an
explicit `select-comment`/`comment-only` target fails with candidate
diagnostics instead of weakening the assertions.

`npm run test:real-html` remains a compatibility alias. This Browser lane
dispatches synthetic DOM input events and is reported only as a **DOM editing
compatibility scan**; it is not real mouse/keyboard acceptance. The fixed
Electron sample in `electron-native-input.spec.mjs` owns real click/dblclick,
keyboard input, Backspace, Delete and Enter. Private
corpus acceptance remains `PAGEROOT_REAL_HTML_DIR=... npm run
test:real-html:electron` and reports A text, B structure and C Runtime/iframe
as separate file/stage/operation rows. Operations execute and report in the
same order; every A mutation freezes and checks its own source baseline. The
private report binds HEAD plus staged, unstaged and untracked source bytes.
The private deterministic paste probe requires an empty system clipboard and verifies that it is
empty again afterward. Any non-empty clipboard marks only Paste as
`NOT_APPLICABLE` before mutation; lossless preservation of system clipboard
formats belongs to a separate acceptance lane and does not suppress later
operations in the same file.

The current capability manifest contains 23 cases. If `cases.json` changes,
the release report must use the count from that final file rather than copying
this number or an older test total.
