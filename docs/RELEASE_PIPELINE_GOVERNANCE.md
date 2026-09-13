# Release pipeline governance

PageRoot keeps the release standard high while avoiding repeated proof of the same source tree. The unit of reusable evidence is an exact Git Tree Hash and package version, not a branch name, a local checkout or a previous green-looking run.

## Delivery boundaries

| Boundary | Trigger | Evidence | What it must not do |
| --- | --- | --- | --- |
| PR feedback | Draft Pull Request opens, updates or reopens without `full-gate` | Impact-selected Node/compiler feedback for the current head | Report `release-gate` or run the complete Browser/Electron matrix |
| Informational Codex review | Ready, opened already Ready, or `full-gate` | At most one `@codex review` comment per exact head, plus a non-blocking thread snapshot | Fail `release-gate`, merge, or become a required check |
| Dependency baseline | Branch policy pass on the full-gate path | Unchanged advisory threshold plus exact packaged-runtime closure | Start a complete source lane or macOS runner while the global baseline is red |
| Source candidate | Ready or `full-gate` after the dependency baseline | Full Node, three Browser shards, DOM editing compatibility scan, three native Electron shards and deterministic AI; exact-tree attestation | Package or publish an installer; wait on Codex review |
| Release dry run | `candidate-context` identifies packaging/release metadata/Electron/Bridge/Schema/resource risk on a full-gate candidate | Credential-free unsigned App, non-release checkpoint, clean-job renderer/metadata revalidation and startup identity | Read signing/Apple secrets, create distributables or enter Candidate/publication; reject a PR merely because it is large |
| Main integrity | Source candidate is merged | Match merged PR, Tree Hash, version and fresh PR attestation | Repeat any Node, Browser or Electron source test |
| Developer preview | Explicit manual request only | Clean Tree, stable Developer ID DMG, packaged-content audit, isolated startup and non-release attestation | Notarize, create updater assets, become a prerequisite, tag or publish; missing/failed signing cannot fall back to ad-hoc |
| Release candidate | Manual `Release Candidate` dispatch on current `main` | Pre-sign content/runtime proof, signed-App checkpoint, final DMG/ZIP/update checks, release asset hashes and candidate attestation | Rebuild the verified App after checkpoint, create a tag or GitHub Release |
| Publication | Manual `Release` dispatch for the exact version on current `main` | Fresh matching candidate, downloaded byte hashes and provenance | Rebuild, replace or silently mutate candidate bytes |

The publication workflow creates the annotated tag only after the pre-tag candidate has passed. It publishes the exact downloaded candidate files. A failed candidate therefore does not consume a version tag.

The `Developer Preview` workflow exists only for an explicitly requested
installation check. No push, Pull Request, schedule, formal candidate or
publication event triggers it. It must run where the stable Developer ID
Application identity is available (normally the developer's local keychain);
otherwise it stops rather than producing an ad-hoc package. Its seven-day
artifact cannot be promoted; formal release evidence starts independently from
reviewed `main`.

`candidate-context` is a narrow deterministic path classifier. It reports
packaging risk, changed-file count and advisory scope, but never rejects a Pull
Request for size. When it finds packaging risk, `ci.yml` calls the reusable
`Release Dry Run` workflow for that exact candidate head. It uses two clean
macOS jobs and a synthetic public-format telemetry token, but no repository
secret. Its checkpoint says `releaseEligible: false` and has a separate kind,
directory and filename that the formal signed-App restore will not accept. A
source-only candidate skips it successfully. It is deterministic pre-merge
feedback, not reusable release evidence.

`PR Feedback` and the source-candidate jobs share a per-PR concurrency key
inside `ci.yml`. A new commit therefore cancels an in-flight complete run for
the stale head; `release-gate` skips that cancelled run instead of recording
an artificial gate failure. Returning to Draft skips the full matrix; a later commit on a
Ready PR reruns the complete matrix for the new head. Keep parallel PR scope a
judgement call, not a fixed capacity rule.

A push to `main` is keyed per commit instead, and is never cancelled.
Successive merges land separate commits that each need their own
`main-integrity` verification, so draining a merge backlog must never cancel an
earlier commit's attestation check.

## CI ownership and isolation

- `ci.yml` is the only Pull Request workflow. It grants `pull-requests: write` solely to post the informational `@codex review` comment. It never uses `pull_request_target`, never grants `contents: write`, and never merges.
- Draft without `full-gate` runs `pr-feedback` (`gate:draft`: Node plus selected canaries). Ready, opened already Ready, or `full-gate` runs the complete source matrix. `codex-review` is `continue-on-error` and is not listed in `release-gate.needs`.
- `branch-policy` and `candidate-context` have no dependency on one another. `baseline-policy` waits only for branch policy and runs `audit:dependencies`, whose single command owns both advisory policy and packaged-runtime closure and writes a lockfile snapshot. `linux-deps` / `macos-deps` plus `source-build`, Native Electron and AI Electron depend on this job, so a red global baseline consumes no macOS runner and later jobs restore one OS/lockfile `node_modules` cache instead of repeating `npm ci`. `release-gate` verifies the snapshot instead of scanning twice.
- Linux builds and shares only the Web renderer used by Node and Browser lanes.
- Each macOS Electron lane builds the Electron renderer locally. The build is normally sub-second and removes Linux-to-macOS build output as a variable.
- Native Electron and deterministic AI run as separate jobs. A failure can be rerun independently. Native Electron spreads its self-contained tests across three shards, because a single-worker lane of forty tests otherwise dominated total gate latency. Every shard still runs one worker, so no two Electron apps share a runner. The shards are passed `--fully-parallel` deliberately: Playwright otherwise splits by spec file, and this two-file suite would leave one shard holding every test while the others passed vacuously.
- Each macOS job first runs a product-independent synthetic Electron environment preflight. It proves that the hosted window is visible and that renderer timers and animation frames advance before PageRoot code or assertions begin, so an environment failure on either runner stays classified as deterministic `ci_environment` rather than degrading to `source-test/needs_triage`.
- Every `ci.yml` step carries an explicit `timeout-minutes` bound. Browser lanes first launch the restored or freshly installed Chromium; only a failed readiness probe runs one `playwright install-deps` fallback, under a ten-minute budget. The fallback never retries apt, because killing a slow parent can leave its child holding the dpkg lock. An external apt mirror or network hang therefore costs a bounded fallback instead of every Browser lane's normal path.
- Real HTML, Browser shards, native Electron shards and deterministic AI are product contracts and keep `retries: 0`. Only the `@infra-sensitive` hosted-window preflight may retry once in CI. `release-gate` reads the machine-readable flaky summaries and refuses attestation when a product suite has `failed`, `flaky` or `retries` above zero, or when the same SHA has an untriaged product-step failure from an earlier attempt. Environment-only step failures and an unexpired `pageroot-ci-triage` comment remain the only ways to rerun the same SHA. Reliability remains anchored in deterministic readiness and fail-closed evidence, not blanket retrying.
- Release Dry Run has two sequential macOS jobs. The first builds metadata and an explicitly unsigned App, runs the shared packaged verifier with the dry-run signature policy and freezes a non-release checkpoint. The second restores the checkpoint in a fresh checkout, restores its exact metadata, rebuilds `dist-desktop`, reruns the same verifier, then launches the App to compare runtime name/version and Bundle ID with the source package contract. Neither job builds a DMG or sees signing/notarization inputs. Formal Candidate profiles keep their ad-hoc pre-sign and Developer ID signature gates unchanged.
- Release Candidate has two sequential macOS jobs. `preflight-sign-and-notarize-app` first assembles an ad-hoc App, checks packaged contents (including the absence of private Codex/App Server resources), runs the complete packaged-runtime oracle, signs it and proves signed startup before the App is submitted to Apple. Only after App acceptance does it upload an archive/hash/source-bound checkpoint.
- `package-and-verify-candidate` downloads and revalidates that checkpoint, restores the exact embedded build and telemetry metadata as comparison inputs, rebuilds only the deterministic Electron renderer as a source-comparison oracle, uses electron-builder `--prepackaged` to avoid rebuilding the App, creates updater assets, submits only the final DMG to Apple and performs final mounted/extracted verification. The fresh job never regenerates telemetry configuration or receives its project token. The jobs have 90- and 75-minute guards; App and DMG Apple steps have 45- and 50-minute limits. All non-Apple steps keep explicit 2–10 minute limits.
- The formal Candidate checkpoint transfer is its only added normal-path handoff. Its ZIP is uploaded without redundant Actions compression. This small fixed cost prevents content/runtime failures from consuming Apple queue time and lets a failed second job resume without rebuilding, rerunning packaged runtime, resigning or renotarizing the App.

## Failure evidence and classification

Every critical CI command runs through `scripts/ci-evidence.mjs`. It writes:

```text
output/ci-evidence/<suite>.json
output/ci-evidence/<suite>.log
```

The JSON binds the suite, stage, command, commit, Tree Hash, GitHub run/job/attempt, duration, exit state and a normalized failure signature. Volatile timestamps, runner temporary paths and commit SHAs are removed before the signature is calculated so repeated failure shapes can be grouped.

Use exactly one final category after triage:

| Category | Meaning | Normal owner |
| --- | --- | --- |
| `product` | Production behavior or source invariant is wrong | Product change |
| `test_script` | Oracle, readiness condition, locator, fixture or test timing is wrong | Test change |
| `ci_environment` | Hosted runner/window/network/tooling state failed before a product assertion | CI change or rerun |
| `packaged_artifact` | App bundle, packaged runtime, signature, DMG, checksum or release manifest is wrong | Packaging/release change |

`environment-preflight` failures are deterministically marked `ci_environment`. Source-suite failures remain `needs_triage` with candidate categories; a test failure must not be called a product bug merely because the assertion failed. Artifact-stage failures carry a `packaged_artifact` hint but still require checking whether the runner itself failed.

Use the CI incident issue template to record the final category, signature, exact SHA, run URL and local reproduction result. Never commit real user HTML, local paths, credentials or private logs.

## Rerun and two-strike policy

1. Freeze the failing SHA while triaging. Do not create a no-op commit to obtain another run.
2. Inspect the failed job's CI evidence, Playwright trace and first failed assertion.
3. If evidence points to the CI environment, classify it with a dated `pageroot-ci-triage` comment or confirm only environment-preflight steps failed, then rerun only the failed job for the same SHA.
   When only `package-and-verify-candidate` failed, use **Re-run failed jobs** so
   the successful signed-App checkpoint is retained. Do not use **Re-run all
   jobs**, which deliberately rebuilds the checkpoint under a new attempt.
4. If the same normalized signature occurs twice on the same SHA without a local reproduction, stop the release candidate. Classify it as a CI incident and fix or quarantine the environment contract in a reviewed PR.
5. If the signature changes, or local reproduction succeeds, return to product/test-script triage. Do not count it as the same strike.
6. Any source change invalidates the old source and candidate evidence. Run the appropriate gate for the new Tree Hash.

Do not raise global timeouts, enable blanket retries or rerun an entire green matrix to hide one unstable job. A narrowly justified timeout change must identify the measured operation and retain a deterministic oracle.

## Release procedure

1. Update the version/change PR onto current `main`, promote that frozen head from Draft to Ready, and merge only after its exact `release-gate` passes.
2. Confirm `main-integrity` is green for the merge commit. It reuses the exact source evidence and does not rerun source smoke.
3. Confirm the signing `.p12` and fresh notarization credentials are present in GitHub encrypted secrets, then dispatch `Release Candidate` from `main`. It requires a source-gate attestation no older than 168 hours and fails before assembly when a required credential is missing.
4. Confirm the pre-sign content/runtime gate passed before App notarization and that the final job consumed the matching signed-App checkpoint. Candidate/checkpoint artifacts are retained for 14 days; the completed candidate is reusable for publication for 72 hours. A failed-job rerun creates a distinct final candidate identity and publication resolves only the successful attempt.
5. Dispatch `Release` from `main` with the exact package version. It verifies and publishes the candidate, then creates the annotated immutable tag and GitHub Release.
6. If publication fails after the exact tag was created but before the Release exists, rerun the same publication workflow. It may resume only when the existing annotated tag resolves to the identical commit.

Manual tag pushes are outside the governed path. Never move an existing tag or replace published assets.

## Operating metrics

Review these metrics per release and as a rolling 30-day view:

| Metric | Target |
| --- | --- |
| Complete source-gate attempts per released Tree Hash | P50 `1`, average at most `1.5` |
| Complete source-gate runs per Pull Request | Average at most `1.25` |
| Ready-PR full gate wall time | P50 under `6 min`, P95 under `10 min` |
| Final candidate to merge | P50 under `40 min` |
| Ready candidate test completion | P50 under `20 min` |
| Required gate to merge wait | P50 under `10 min` |
| CI-environment false-failure rate | Under `2%` of critical jobs |
| Repeated green runner share | Under `20%` of runner minutes |
| Later candidate-SHA churn | Under `20%` of all PR runner minutes |
| Candidate App rebuilds after signed checkpoint | `0` |
| Time to assign a failure category | Under `10 min` |
| Publication rebuilds after candidate approval | `0` |

Runner minutes and wall time are different signals. Splitting Electron lanes may use similar total macOS minutes while reducing critical-path time and allowing only the failed lane to rerun. The goal is less repeated evidence, not simply fewer tests.

`npm run ci:health` reads recent `ci.yml` Actions history and reports run and
job outcomes, queue time separated from execution time, full-gate wall time
separated from Draft feedback, retry-recovered jobs, same-SHA wash-green
counts, test-level product retries when flaky evidence is supplied, and
budget violations. The `CI Health` workflow publishes the same report weekly
from a GitHub-hosted runner; after two consecutive weeks of blocking budget
violations it opens a `ci-health` Issue. It is not a merge gate and no
substitute for `release-gate`. The workflow files live in
`CI_HEALTH_WORKFLOW_INPUTS`, so adding a workflow without mapping it fails
the source gate.

## Change control

Changes to workflow topology, test ownership, provenance, retention or publication update this document, `docs/DEVELOPMENT.md`, `tests/TEST_STRATEGY.md`, `docs/RELEASING.md` and `docs/POST_MVP_CLEANUP_PROGRAM.md` in the same PR. Changes that weaken an oracle or remove a protected source/artifact boundary require an explicit rationale and replacement evidence.
