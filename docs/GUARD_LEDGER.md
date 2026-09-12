# Guard ledger

Living inventory of user-visible blocks. This file does not delete code.
A later change that removes or moves a guard must update the row in the same
PR. Defense classes are defined in `ENGINEERING_STANDARDS.md`.

## Decision rules

- Irreversible and unique protection: keep.
- Irreversible but duplicated: keep only the authority-boundary copy.
- Reversible with recovery: cancel the user block.
- Presentation-only: degrade or post-validate.
- Never fires and no theoretical path: delete code and tests later.
- Legacy-format compatibility: delete the old branch after the current ingress migrates.
- Do not delete a class-1 guard without shadow evidence or an equivalent test.

Shadow mode (later): the old guard records whether it would have refused;
the new path actually recovers. Delete the old check only after no source
corruption or lost user work.

## Columns

| Column | Meaning |
| --- | --- |
| Guard | The check the user can feel |
| Invariant | What it prevents |
| Class | authority / reversible / presentation |
| User cost | dialog, forbidden click, wait, failure |
| Duplicate | A later authority check already exists |
| Recovery | reread, rebuild, rollback |
| Decision | keep / merge / defer / degrade / delete |

## Current inventory

| Guard | Invariant | Class | User cost | Duplicate | Recovery | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| External HTML import confirmation | Do not trash the original without consent | authority | confirm only when deleting original | no | no | degrade |
| Source conflict banner | External write must not overwrite editor bytes | authority | banner | no | preview / force-unlock / retry | keep |
| Failed source write at reversible detach | Leaving must not imply the source was updated, but navigation/exit must retain an escape path | reversible | in-grid workspace banner; no global lock after exact protection | source Drain | atomic recovery journal or verified export, read-back + context/revision/HTML Hash | degrade source blocker to document-scoped protection evidence; irreversible overwrite remains fail-closed |
| Workbench tab-layout persistence | Restart convenience must not outrank current content safety | presentation | no close block | close aggregate | background best-effort write | remove from close gate |
| Unsaved next-round conversation draft | Do not discard newly typed text on exit | authority | bounded close/switch drain; save failure remains visible through the existing close result | no | document-keyed pending text retained for retry/reopen; no new dialog | keep |
| Desktop close retry | A retry must change ownership/preconditions and remain bounded | reversible | at most one 400ms retry | renderer close freeze | exact `close-aborted`, release freeze, then retry once | keep bounded; unbounded loop forbidden |
| Recovery-journal location change | A renamed/moved source must not orphan the same document revision | reversible | no navigation block after exact protection | document recovery receipt | CAS rebase by project/document/Working Copy/revision/HTML Hash | path is location only; stale receipt remains fail-closed |
| Recovery-journal startup/scan failure | Recovery support must not become an application-start dependency | reversible degradation | main window still opens; export remains available | Main journal capability | bounded scan and per-entry isolation | degrade journal capability; never fail the whole startup |
| Recovery-journal write burst | Full HTML writes must not serialize every intermediate revision | reversible | boundary waits only for latest revision | DocumentWorkflow journal queue | one in-flight plus one coalesced latest pending | superseded intermediate revisions are not durability obligations |
| Request freeze before AI submit | Freeze persisted HTML/revision before creating a Request | authority | send waits on save | Drain + autosave | flush then continue | keep |
| `RUN_SUBMISSION_TARGET_UNSAFE` | Current comment must resolve exact by stable element ID; whole-page comments persist the body's `elementId`; ID-less targets are orphaned | authority | cannot send; relink card | rail `canLocateTarget` | explicit relink then continue send | keep; extra Toast → degrade |
| Unsaved composer/edit before send | No dirty composer when submitting | authority | sticky “continue filling” | RunWorkflow plan; Workbench presents the authority result | save or cancel | merged; legacy predicate equivalence matrix retained in `run-submit-plan.test.mjs` |
| Native edit fence (`showCommitBlocked`) | IME / uncheckpointed native input cannot preview, send or undo | authority | inline block | several fence call sites | finish input | keep port; copy → degrade |
| `PROJECT.md` unsaved close/switch | Rules must land before fold/switch | authority | blocks close/switch | no | autosave/drain | keep |
| Browser preview read-only | Pure browser has no edit/comment/AI write | authority | permanent read-only | runtime capabilities | no | keep |
| Cancel AI run dialog | Do not silently drop an Agent that may still be writing | authority | modal | no | no | keep |
| Restart-update dialog | Installing an update exits the process | authority | non-blocking badge + close drain | close drain | no | degrade |
| Canvas ACK vs “safely saved” | Visible canvas Hash must match authoritative HTML before direct edit | reversible | header pending; projection non-editable or static degrade; never roll back published source | Workbench effect + DocumentWorkflow | one reread + rebuild | merge to DocumentSession; Toast deleted |
| Deferred external/application retry | Switch only after drain/Canvas is safe | reversible | session auto-resume with one-shot bound | Session auto-resume | blocker-transition resume | cancel user block; Toast deleted |
| Catalog/recent refresh failure | A failed listing must not freeze the current document | reversible | sidebar error | no | next refresh | degrade |
| `interactionLocked` composite | Run/preview/hydration/conflict/history forbids comment and send | presentation | whole chrome frozen | `RunSession.activeLocked` | clears when owners settle | merge to one authority projection |
| Canvas `readOnly` during AI | Processing run is browse-only | presentation | iframe “locked” | `interactionLocked` | unlocks when run ends | merge to run lock |
| Patch host refuse (`data-edit-block-detail`) | Non-exact target or locked canvas does not write source | presentation / post-validate | silent refuse | Canvas + DocumentWorkflow | reload/unlock | post-validate; do not forbid entry |
| Runtime-generated surface continuity | Do not present an incomplete dynamic Candidate as a complete Runtime refresh | presentation | latest verified static HTML stays editable and quiet | source/document verification already protects edit authority | bounded dynamic retry in More; verified source reload only if the static document itself fails | degrade; missing Canvas/SVG must never lock the document |
| Literal `暂时不能直接编辑` / `COMMENT_TARGET_MISSING` | n/a | n/a | n/a | n/a | n/a | delete later if docs still name them; they are not in this tree |
| New global `setToast` / `NoticeBar` | Extra interruption besides Confirmation and workspace safety | presentation | overlay | classified ledger | silent recover / in-place / safety banner | freeze; generic `setToast` retired; remaining N5 kinds may only shrink |
| Access-repair resend identity | Resend continues only the stored Request/document; switching files is not authorization to retarget | authority | in-place “当前文件已变化，不会重新发送” | RunWorkflow repair intent | stay on the original document or start a new round | keep |
| Login stop unconfirmed | User cancel is not a confirmed stop; cleanup failure must not become cancelled or signed-in | reversible | in-card “停止未确认”; cancel drain returns false | Bridge `AgentAccessAuth` job state | retry cancel or wait for a later confirmed terminal | keep |
| Review nonempty-change admission | Locate changes only when evidence exists; it does not establish Candidate validity | presentation | formerly refused the comparison for source-only output | validated Candidate plus existing VersionWorkflow adoption | same Review with an inline empty state | retired; empty-fact adopt/discard Electron coverage replaces the presentation gate |
| Review canonical-fact annotation overflow | One element accepts at most 24 nonmergeable canonical facts; this does not establish Candidate validity | presentation | optional change annotations unavailable | Candidate identity/hash/path and explicit adoption remain authoritative | only the actual trusted overflow class rebuilds both original pages, pairs interactions and uses the same formal Review projection | degrade; unknown errors, serialization/transport budgets and cancellation still reject |

## Sample now exists; deletion still needs shadow

Comments contract (`comment-rail-contract.ts`) and document `save-plan` are in
tree. Presentation-class rows above may move to **merge** / **degrade** only
after shadow evidence or an equivalent test. Do not delete a class-1
authority guard without that evidence.

Project open/switch/close now have `ready | wait | reject` plans. Those
classifiers are not a license to delete navigation, close-generation, or tab
persistence guards. Those rows stay **keep** until a comments-scale contract
plus shadow exists for the same operation.

## Working Copy recovery

Persisted filesystem-number drift is reversible internal uncertainty: refresh
observations after stable project/member/content verification. Never expose it
as a project lock. Missing source, external changes and duplicate bindings are
separate per-project states; metadata and Version browsing remain available.
“恢复工作文件” requires a missing registered target and the anchor's exact state
Hash, and publishes without replacement. “重新检查文件” re-reads after the user
has returned a missing file or removed duplicate folders/links. It never grants
a same-hash unregistered copy write authority. See `SECURITY_MODEL.md`.

- Durable save / Request handoff: a submit drain may refresh only the captured Working Copy Hash to its verified frozen bytes; epoch, project, document, root, path, Working Copy and Version must still match. `tests/run-workflow.test.mjs` rejects unrelated authority changes; the Electron static-fallback editing test covers the real pending-save handoff.
