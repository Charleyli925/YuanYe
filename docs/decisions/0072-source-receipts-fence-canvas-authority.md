# ADR 0072: Source receipts fence Canvas authority

Status: Accepted contract

## Decision

`DocumentSession` remains the sole owner of current source HTML and publishes
one monotonic `DocumentSourceReceipt` for every accepted source transition. A
receipt records its `sessionIncarnation` plus monotonic `sequence`, its
`origin` (`local-edit`, `history` or
`authority`), `operationId`, `editRevision`, `canvasGeneration`,
`sourceSha256`, and the complete project/session context (`projectId`,
`documentId`, source route, epoch and session epoch).

`DocumentWorkflow` and project/workspace workflows are receipt producers;
`HtmlCanvasEditor` is only a receipt consumer. Local-edit and history receipts
may update the mounted frame in place. Authority receipts always advance the
Canvas generation and reload the physical frame, even when the source bytes are
equal. No consumer may infer ownership from HTML equality or a membership list
of previously emitted HTML strings.

Canvas verification returns only an immutable observation containing the
receipt, rendered HTML, rendered Hash and physical frame generation.
`DocumentWorkflow` is the only production confirmer; the Canvas verifier and
WorkspaceController never mutate source authority. The observation must match
the current receipt incarnation/sequence, origin/context, generation, exact
rendered HTML and source Hash. Old, duplicate, cross-document, cross-project
or cross-generation acknowledgements are discarded. A failed receipt is
terminal until a newer authority receipt is published; a verified receipt
cannot be failed. Source HTML, persistence Hashes, exact-ACK checks, semantic
no-op handling, history Hashes, external stat reconciliation, identity repair
and frame/lease fences remain unchanged and authoritative at their existing
owners.

When a composed verifier has already confirmed an exact observation, an
internal `ensureCurrentCanvas` check may accept that same observation as an
idempotent success; an external duplicate confirmation still returns false.
Managed Working Copy adoption and hydration carry the final project context,
HTML/Hash tuple and edit revisions into one authority publication. A same-route
Hash-only autosave refresh remains an in-place persistence update and does not
rebuild the Canvas.

## Consequences

- Same-byte authority reloads become observable and cannot reuse a stale
  physical frame.
- A late acknowledgement cannot consume or overwrite a newer source receipt.
- A rebuilt DocumentSession cannot reuse a lower sequence: its incarnation
  fences old callbacks even when the tab and context are unchanged.
- Canvas owns no receipt state beyond disposable consumption fences, and IPC or
  filesystem authority does not expand.
- Tests must cover same-byte authority reload, local/history frame reuse,
  A→B late ACK rejection, duplicate/stale/context mismatch rejection, exact
  HTML/Hash acknowledgement, failed/verified terminal settlement and
  semantic no-op negatives.
