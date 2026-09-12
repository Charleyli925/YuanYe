# ADR 0064: Source structure edits use stable IDs and semantic operations

- Status: Accepted
- Date: 2026-08-30

## Context

The semantic kernel already defines insert, delete and move operations, but the
Canvas previously exposed only same-parent reorder. Editing preview DOM would
mix authored elements with Script-generated nodes and could serialize runtime
state. Cloning authored markup also cannot retain the original persistent IDs.

## Decision

- Insert, duplicate, delete and cross-parent move address authored elements by
  `data-pageroot-id` and run through `SemanticOperationKernel`.
- Insert accepts exactly one identity-free source element. The kernel allocates
  a fresh ID for every element in the inserted subtree.
- Duplicate removes every persistent ID from the selected source subtree before
  using the insert contract. The original and copy never share an ID.
- Move preserves the selected subtree and all of its IDs. Delete retires those
  IDs; later operations never deliberately reuse them.
- The Canvas toolbar exposes duplicate, explicitly confirmed delete and the
  existing same-parent up/down actions. Delete has no armed state: every attempt
  opens a blocking confirmation, cancellation has no source effect, and only an
  accepted confirmation dispatches the semantic operation. The editor port also
  supports identity-addressed insertion
  and cross-parent move without introducing an element palette, component
  system or layout engine.
- Only elements proven in the current `SourceIndex` are eligible. Runtime DOM
  descendants, document roots, stale targets, cycles and ambiguous insertion
  points fail closed. After parsing, insert and move must still place the same
  stable root ID as a direct child of the requested parent; raw-text and other
  parser-reparenting destinations are rejected.
- Every accepted operation publishes complete next HTML and exact inverse
  patches plus a system-derived `identityDelta`. The delta records the actual
  added/removed/moved IDs, retained target root and requested target/parent/
  insertion-position evidence. It is derived from the semantic operation and
  independently parsed before/after complete HTML, never supplied as caller
  authority.
- Repository replays SourcePatch only to prove the exact before/after byte,
  Hash, CAS and crash-recovery chain. It independently recomputes the identity
  delta and cross-validates it with the complete public semantic-operation
  schema/envelope and type-specific fields; a legacy patch
  `kind` cannot authorize ID-set or topology changes. Successful save reseals
  the new tag/parent/order binding for later external-conflict detection.
- For insert and `replaceSubtree`, Repository also removes only the exact
  kernel-form identity attributes from the saved result and requires the
  resulting identity-free subtree bytes to equal `operation.html`. A caller
  cannot pair unrelated payload HTML with fresh-looking IDs and a recomputed
  delta.
- Every structural operation is additionally bound to one complete patch
  plan reconstructed by a pure planner shared with Canvas. Delete, insert,
  replacement, cross-parent move and the comment-aware minimal same-parent
  reorder must match that plan in patch count, range, before/after bytes and
  kind. Same-parent reorder retains the existing explicit-end/void/source-
  self-closing sibling and safe-parent-boundary prerequisites; optional implicit
  end tags cannot gain authority only at the Repository boundary. A valid
  identity transition cannot carry an extra unrelated patch.
- Native editable-island line breaks enter the semantic contract as bare
  `<br>` nodes. The initial `editableIslandTextOperation` carries logical text
  and canonical `contentHtml` but no fresh IDs. The Kernel's single materializer
  allocates new IDs in DOM order, returns them as allocation evidence, and
  seals them into the accepted `setText` operation only after Canvas validates
  the result. Semantic replay with declared IDs must reproduce that exact
  identified `contentHtml`, including the ordered association between each new
  `<br>` and its system allocation. Repository replays the shared materializer
  with the declared ID sequence and binds the operation to the target's one
  exact editable-island patch, so a matching ID inventory cannot authorize
  unrelated island bytes. After acceptance, the controller applies only those
  source-allocated IDs to the corresponding live `<br>` nodes as an expected
  mutation. The controller accepts that reconciliation only when the live
  canonical island exactly equals the newly saved source, then advances both
  its owned and baseline canonical values while preserving the active selection
  and edit session. The attribute remains identity, not new Runtime authority.
- Plain `setText` without `contentHtml` is also one closed kernel plan, not a
  caller-authored patch allowance. Canvas and Repository share the same pure
  planner: it rejects void and raw-text targets, escapes `&`, `<` and `>` once,
  and requires one exact target-content patch. Equivalent decoded text, an
  unrelated extra patch or a target Canvas cannot edit is not authorized.
- A range-style operation that adds wrappers is independently replayed at the
  Repository boundary. Its logical range and quote must map to the exact
  authored text segments; wrapper count, offsets, canonical guard/style bytes
  and allocated IDs must equal the retained forward evidence for forward,
  undo and redo. An identified but differently placed or styled subtree is not
  authorized. Canvas and Repository consume the same pure editable-island and
  single-CSS-value validators; exact caller-authored bytes cannot bypass the
  inline schema, protected-attribute, atom/comment or style-injection rules.
- Identity-preserving operations have the same exact save-boundary rule.
  Repository reconstructs every `replaceTextRange`, `setAttribute` and
  non-range `setStyle` patch from the original forward source and public
  operation, then compares the entire retained patch array. A range style that
  canonically coalesces onto its target or an existing immediate wrapper is
  replayed as that exact inline-style plan; a partial range cannot omit its
  wrapper identities. Canvas and Repository use one text-host capability, so
  dedicated-editor roots and foreign-content ranges cannot gain save authority.
  A self-consistent Hash, inverse and `identityDelta` never
  authorize an unrelated identity-preserving byte change.
- The operation rules are closed: insert/duplicate add only fresh subtree IDs;
  delete removes only the addressed subtree; move retains every subtree ID;
  `replaceSubtree` retains its root ID while replacing descendants; `setText`
  may remove target descendants; range/style-created wrappers and line breaks
  must list kernel-allocated IDs. Other identity effects fail closed.
- This joins ADR 0063's current-open, 20-step memory history and the existing
  Hash/CAS atomic autosave path.

## Consequences

- Structure editing and comments share stable authored identity; deleting a
  target makes its comment orphaned instead of heuristically rebinding it.
- Structural changes normally rebuild the disposable preview from complete
  source. Runtime DOM is never serialized back to HTML.
- Runtime simplification, Review pairing and AI Candidate validation remain in
  PR7, PR8 and PR9 respectively.
