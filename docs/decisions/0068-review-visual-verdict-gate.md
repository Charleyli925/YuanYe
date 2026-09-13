# ADR 0068: Position-bound Review changes and private source diagnostics

- Status: Accepted
- Date: 2026-08-31
- Amended: 2026-09-12
- Extends: ADR 0046 and ADR 0066

## Decision

Review is a position-bound page comparison, not a general source-code audit.
Only a `ReviewChange` that can be attached to a concrete page element or text
range enters `全部 / 文字 / 元素`, navigation, masking and projection. Precise
text differences, outermost addition/removal, cross-parent movement, uniquely
attributable same-parent movement, parent-level ambiguous reorder, authored
attributes, inline style and safely mapped simple-selector CSS are eligible.

CSS/Script comments, formatting, whitespace and any whole-page source
difference that cannot be mapped to a concrete Stable ID become private
`ReviewDiagnostic` records. Diagnostics may be retained with task/version
evidence, but they never create a `ReviewChange`, `<html>` marker, mask hole,
outline entry, risk banner or user-visible `unverified` claim. A validated Candidate with
diagnostics but no position-bound change opens the same comparison surface.
It has no markers or change navigation; both authored pages and the existing
explicit adoption/discard decisions remain available. The in-place explanation
says no locatable changes were found, never that the page has no visual change.
Exact HTML equality has its own factual explanation and is not pixel equality.

Current-frame observation remains bounded, non-authoritative diagnostic input
only for pure-style Stable-ID evidence that belongs both to a `visual-change`
focus region and its corresponding source change. Text, structure, mixed evidence
and `never` outline regions start no observation. Shared challenged ports still
serve source projection and comments, including after each frame reload.
Observation may help measure DOM
presentation, images, SVG, Canvas 2D and runtime descendants, but missing,
stale, hidden, unsupported, unstable or budget-limited observation does not add
a user-facing change or warning. The authored frame realm is not an isolated
security oracle. No Main/Preload/IPC/screenshot/PNG evidence owner is restored.

Each `ReviewChange` owns a side-specific `ReviewPresentation`. Its ordered
steps currently admit a panel key and a Stable-ID-bound `<details>` disclosure.
The path is derived from the actual marker/evidence host, not the coarse section
pair. Explicit selection coordinates both disposable iframes to the requested
states, waits for both presentations, then focuses and scrolls. Initial navigation
may reveal the first locatable change while keeping overview's null focus.
Presentation changes never persist to authored HTML.

Entry starts in overview with null focus. When changes exist, initial navigation
may reveal the first locatable change without activating focus; empty facts do
not start navigation. Text changes retain precise added/removed marks. Element
changes retain quiet page-edge revision bars. Optional outlines follow the
current focus-presentation contract in ARCHITECTURE_CONTRACT.md. The existing
change directory is absent when its filtered collection is empty.

Same-parent topology names a concrete moved element only when removing exactly
one candidate restores the sibling order. If more than one element is an
equivalent explanation, Review attaches `元素顺序调整` to the shared Stable-ID
parent and suppresses false text delete/insert evidence for that interval.
Cross-parent movement remains an exact element fact.

Review is a no-floating-notice surface. Visual status, unverified state, scope
summary, candidate attention and background success Toasts are not rendered
over the comparison. Blocking frame load errors stay in the existing canvas
error area. Each new Review session opens the existing AI conversation decision panel;
the user may close it and reopen it through the toolbar without replacing the
Review session.

Review comments remain trusted React UI outside authored HTML. The marker rail
is fixed to the right edge of the Before pane, nearby comments aggregate to
`评2`/`评3`, and active comment keys are owned by the parent. Static-fallback
element commenting is outside this ADR and remains a separate PR.

## Required tests

- CSS/Script comment-only Candidates create diagnostics but zero Review changes;
- a simple changed selector maps only its concrete Stable-ID targets;
- hidden Tab and closed `<details>` targets reveal on both sides before focus;
- no Review visual/scope/attention/Toast overlay is present;
- the existing AI conversation decision panel opens once per new Review session and can reopen;
- ambiguous same-parent reorder becomes one parent-level `元素顺序调整` fact;
- uniquely attributable and cross-parent movement remain exact;
- initial overview with null focus, quiet sibling revision bars and persistent text marks;
- comment marker unmount, document replacement and port-rebind cleanup.
