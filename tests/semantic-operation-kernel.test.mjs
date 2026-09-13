import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  SEMANTIC_OPERATION_SCHEMA_VERSION,
  SemanticOperationError,
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
} from "../app/lib/semantic-operation-kernel.js";
import {
  SourcePatchError,
  applyPatchPlan,
  planSemanticOperationPatch,
} from "../app/lib/source-patch-engine.js";
import {
  createTargetRef,
  planEditableIslandPatch,
  planTextRangeStylePatch,
} from "../app/lib/source-patch-core.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  disableEditPipelineCounters,
  enableEditPipelineCounters,
  readEditPipelineCounters,
  resetEditPipelineCounters,
} from "../app/lib/edit-pipeline-counters.js";
import {
  buildSourceTextMap,
  textRangeToSourceSegments,
} from "../app/lib/source-text-map.js";

function elementId(sequence) {
  return `pr1_000000000000400080000000${sequence.toString(16).padStart(8, "0")}`;
}

const IDS = {
  html: elementId(1),
  head: elementId(2),
  title: elementId(3),
  body: elementId(4),
  main: elementId(5),
  paragraph: elementId(6),
  strong: elementId(7),
  section: elementId(8),
  first: elementId(9),
  second: elementId(10),
};

function attr(element) {
  return `data-pageroot-id="${element}"`;
}

function managedHtml() {
  return `<!doctype html><html ${attr(IDS.html)}><head ${attr(IDS.head)}><title ${attr(IDS.title)}>Demo</title></head><body ${attr(IDS.body)}><main ${attr(IDS.main)}><p ${attr(IDS.paragraph)}>Hello <strong ${attr(IDS.strong)}>world</strong></p><section ${attr(IDS.section)}><span ${attr(IDS.first)}>A</span><span ${attr(IDS.second)}>B</span></section></main></body></html>`;
}

function state() {
  return createSemanticDocumentState(managedHtml());
}

function operation(documentState, operationId, type, fields = {}) {
  return {
    schemaVersion: SEMANTIC_OPERATION_SCHEMA_VERSION,
    operationId,
    baseRevision: documentState.revision,
    expectedSourceSha256: documentState.sourceSha256,
    type,
    ...fields,
  };
}

function target(documentState, id) {
  return createSemanticElementPrecondition(documentState.html, id);
}

function uuidFactory(...uuids) {
  let cursor = 0;
  return () => uuids[cursor++] ?? uuids.at(-1);
}

const INSERT_UUIDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];

test("semantic operation schema accepts the public command envelope and rejects generated restore authority", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../schemas/semantic-operation.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  assert.equal(ajv.validateSchema(contract), true, ajv.errorsText(ajv.errors));
  const validate = ajv.compile(contract);
  const baseline = state();
  assert.equal(validate(operation(baseline, "op_schema_00001", "deleteElement", {
    target: target(baseline, IDS.first),
  })), true, ajv.errorsText(validate.errors));
  assert.equal(validate(operation(baseline, "op_schema_text_01", "setText", {
    target: target(baseline, IDS.paragraph),
    text: "",
    contentHtml: "",
  })), true, ajv.errorsText(validate.errors));
  assert.equal(validate({
    schemaVersion: 1,
    operationId: "op_schema_00002",
    baseRevision: 0,
    expectedSourceSha256: baseline.sourceSha256,
    type: "restoreExactSource",
  }), false);
});

test("applies text, range, attribute and style operations through exact SourcePatch materialization", () => {
  const baseline = state();

  const textResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_set_text_0001",
    "setText",
    { target: target(baseline, IDS.paragraph), text: "A < B & C" },
  ));
  assert.match(textResult.html, />A &lt; B &amp; C<\/p>/u);
  assert.equal(textResult.materialization.kind, "source-patch");
  assert.equal(textResult.nextRevision, 1);
  assert.equal(buildSourceIndex(textResult.html).pagerootIdentity.complete, true);

  const rangeResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_text_range_01",
    "replaceTextRange",
    {
      target: target(baseline, IDS.paragraph),
      range: { startOffset: 3, endOffset: 8, quote: "lo wo" },
      text: "X&",
    },
  ));
  assert.match(rangeResult.html, />HelX&amp;<strong [^>]+>rld<\/strong><\/p>/u);

  const attributeResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_attribute_0001",
    "setAttribute",
    { target: target(baseline, IDS.section), name: "aria-label", value: "A & B" },
  ));
  assert.match(attributeResult.html, /aria-label="A &amp; B"/u);

  const styleResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_style_000001",
    "setStyle",
    {
      target: target(baseline, IDS.section),
      property: "color",
      value: "red",
      important: true,
    },
  ));
  assert.match(styleResult.html, /style="color: red !important"/u);
});

test("materializes rich text and range style semantically with a generated inverse", () => {
  const baseline = state();
  const textEdit = operation(baseline, "sourceop_legacy_text_01", "setText", {
    target: target(baseline, IDS.paragraph),
    text: "Hello semantic",
  });
  const textResult = applySemanticOperation(baseline, textEdit);
  assert.match(textResult.html, />Hello semantic<\/p>/u);
  assert.equal(textResult.materialization.sourcePatchResult.html, textResult.html);

  const richText = operation(baseline, "sourceop_rich_text_0001", "setText", {
    target: target(baseline, IDS.paragraph),
    text: "Hello semantic",
    contentHtml: `Hello <strong data-pageroot-id="${IDS.strong}">semantic</strong>`,
  });
  const richResult = applySemanticOperation(baseline, richText);
  assert.match(
    richResult.html,
    new RegExp(`Hello <strong data-pageroot-id="${IDS.strong}">semantic</strong>`),
  );
  assert.equal(buildSourceIndex(richResult.html).byPagerootId.has(IDS.strong), true);

  const rangeStyle = operation(baseline, "sourceop_legacy_style1", "setStyle", {
    target: target(baseline, IDS.paragraph),
    property: "font-weight",
    value: "700",
    important: false,
    range: { startOffset: 0, endOffset: 5, quote: "Hello" },
    createdPagerootIds: [elementId(30)],
  });
  const styled = applySemanticOperation(baseline, rangeStyle);
  assert.match(styled.html, /font-weight: 700/u);
  assert.match(styled.html, new RegExp(elementId(30), "u"));
});

test("replays the exact wrapper IDs allocated by an accepted Canvas range style plan", () => {
  const baseline = state();
  const index = buildSourceIndex(baseline.html);
  const paragraph = index.byPagerootId.get(IDS.paragraph);
  const textMap = buildSourceTextMap(index, paragraph.nodeId);
  const range = { startOffset: 0, endOffset: 5, quote: "Hello" };
  const forwardPlan = planTextRangeStylePatch(index, {
    type: "set-text-range-style",
    targetRef: createTargetRef(index, paragraph, { level: "subregion" }),
    segments: textRangeToSourceSegments(
      textMap,
      range.startOffset,
      range.endOffset,
    ),
    property: "font-weight",
    value: "700",
    important: false,
    expectedSourceSha256: baseline.sourceSha256,
  });
  const mapped = applyPatchPlan(forwardPlan, baseline.html);
  const createdPagerootIds = forwardPlan.metadata.createdPagerootIds;
  const semantic = applySemanticOperation(baseline, operation(
    baseline,
    "sourceop_canvas_style1",
    "setStyle",
    {
      target: target(baseline, IDS.paragraph),
      property: "font-weight",
      value: "700",
      important: false,
      range,
      createdPagerootIds,
    },
  ));

  assert.equal(createdPagerootIds.length, 1);
  assert.match(semantic.html, new RegExp(createdPagerootIds[0], "u"));
  assert.equal(semantic.html, mapped.html);
  assert.equal(semantic.sourceSha256, mapped.sourceSha256);
});

test("replays ordered line-break IDs allocated by an accepted Canvas text plan", () => {
  const baseline = state();
  const index = buildSourceIndex(baseline.html);
  const paragraph = index.byPagerootId.get(IDS.second);
  const beforeInnerHtml = baseline.html.slice(
    paragraph.contentRange.startOffset,
    paragraph.contentRange.endOffset,
  );
  const forwardPlan = planEditableIslandPatch(index, {
    type: "replace-editable-island",
    targetRef: createTargetRef(index, paragraph, { level: "subregion" }),
    beforeInnerHtml,
    nextInnerHtml: "B<br>semantic<br>ordered",
    expectedSourceSha256: baseline.sourceSha256,
  });
  const mapped = applyPatchPlan(forwardPlan, baseline.html);
  const createdPagerootIds = forwardPlan.metadata.createdPagerootIds;
  const semantic = applySemanticOperation(baseline, operation(
    baseline,
    "sourceop_canvas_break1",
    "setText",
    {
      target: target(baseline, IDS.second),
      text: "B\nsemantic\nordered",
      contentHtml: forwardPlan.metadata.nextInnerHtml,
      createdPagerootIds,
    },
  ));

  assert.equal(createdPagerootIds.length, 2);
  const orderedIds = [...forwardPlan.metadata.nextInnerHtml.matchAll(
    /<br data-pageroot-id="([^"]+)">/gu,
  )].map((match) => match[1]);
  assert.deepEqual(orderedIds, createdPagerootIds);
  assert.match(semantic.html, new RegExp(createdPagerootIds[0], "u"));
  assert.match(semantic.html, new RegExp(createdPagerootIds[1], "u"));
  assert.equal(semantic.html, mapped.html);
  assert.equal(semantic.sourceSha256, mapped.sourceSha256);
});

test("fresh editable-island text allocation seals ordered line-break IDs in one Kernel apply", () => {
  const baseline = state();
  const operationValue = operation(baseline, "sourceop_native_breaks_01", "setText", {
    target: target(baseline, IDS.paragraph),
    text: "Hello world\nline\nend",
    contentHtml: `Hello <strong data-pageroot-id="${IDS.strong}">world</strong><br>line<br>end`,
  });
  const firstBreakId = "pr1_10000000000040008000000000000011";
  const secondBreakId = "pr1_10000000000040008000000000000012";
  enableEditPipelineCounters();
  resetEditPipelineCounters();
  try {
    const result = applySemanticOperation(baseline, operationValue, {
      randomUUID: uuidFactory(
        "10000000-0000-4000-8000-000000000011",
        "10000000-0000-4000-8000-000000000012",
      ),
    });
    assert.equal(operationValue.createdPagerootIds, undefined);
    assert.deepEqual(result.allocatedElementIds, [firstBreakId, secondBreakId]);
    assert.deepEqual(result.identityDelta.addedElementIds, [firstBreakId, secondBreakId]);
    const orderedIds = [...result.html.matchAll(
      /<br data-pageroot-id="([^"]+)">/gu,
    )].map((match) => match[1]);
    assert.deepEqual(orderedIds, [firstBreakId, secondBreakId]);
    assert.equal(readEditPipelineCounters().fullPatchApplies, 1);
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, baseline.html);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  } finally {
    disableEditPipelineCounters();
  }
});

test("allocates new identities for insert and replacement while preserving the replacement root", () => {
  const baseline = state();
  const insertResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_insert_00001",
    "insertElement",
    {
      parent: target(baseline, IDS.section),
      before: target(baseline, IDS.second),
      html: "<article><em>New</em></article>",
    },
  ), { randomUUID: uuidFactory(...INSERT_UUIDS) });

  assert.equal(insertResult.allocatedElementIds.length, 2);
  assert.equal(insertResult.insertedRootElementId, "pr1_10000000000040008000000000000001");
  assert.match(insertResult.html, /<span [^>]+>A<\/span><article data-pageroot-id="pr1_1000/u);
  assert.equal(buildSourceIndex(insertResult.html).pagerootIdentity.complete, true);

  const replacementResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_replace_0001",
    "replaceSubtree",
    {
      target: target(baseline, IDS.section),
      html: "<section><em>Replacement</em></section>",
    },
  ), { randomUUID: uuidFactory(...INSERT_UUIDS) });
  const replacementIndex = buildSourceIndex(replacementResult.html);
  assert.equal(replacementIndex.byPagerootId.get(IDS.section)?.tagName, "section");
  assert.equal(replacementResult.allocatedElementIds.length, 1);
  assert.equal(replacementIndex.pagerootIdentity.complete, true);
});

test("deletes and moves only source elements addressed by stable identity", () => {
  const baseline = state();
  const deleteResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_delete_00001",
    "deleteElement",
    { target: target(baseline, IDS.first) },
  ));
  assert.equal(buildSourceIndex(deleteResult.html).byPagerootId.has(IDS.first), false);

  const moveResult = applySemanticOperation(baseline, operation(
    baseline,
    "op_move_0000001",
    "moveElement",
    {
      target: target(baseline, IDS.second),
      parent: target(baseline, IDS.section),
      before: target(baseline, IDS.first),
    },
  ));
  assert.equal(moveResult.materialization.planType, "reorder-sibling");
  assert.ok(moveResult.html.indexOf(`>${"B"}</span>`) < moveResult.html.indexOf(`>${"A"}</span>`));
  assert.equal(buildSourceIndex(moveResult.html).byPagerootId.get(IDS.second)?.parentId !== null, true);
});

test("generated inverse operations restore exact authoritative source bytes and support redo", () => {
  const baseline = state();
  const applied = applySemanticOperation(baseline, operation(
    baseline,
    "op_delete_inverse",
    "deleteElement",
    { target: target(baseline, IDS.first) },
  ));
  const restored = applySemanticOperation(applied.nextState, applied.inverseOperation);
  assert.equal(restored.html, baseline.html);
  assert.equal(restored.nextRevision, 2);
  const redone = applySemanticOperation(restored.nextState, restored.inverseOperation);
  assert.equal(redone.html, applied.html);

  const clonedInverse = { ...applied.inverseOperation };
  assert.throws(
    () => applySemanticOperation(applied.nextState, clonedInverse),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_INVERSE_UNTRUSTED",
  );
});

test("fails closed for stale, duplicate and changed target preconditions", () => {
  const baseline = state();
  const edit = operation(baseline, "op_fail_closed1", "setText", {
    target: target(baseline, IDS.paragraph),
    text: "Changed",
  });
  const applied = applySemanticOperation(baseline, edit);
  assert.throws(
    () => applySemanticOperation(applied.nextState, edit),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_OPERATION_DUPLICATE",
  );
  assert.throws(
    () => applySemanticOperation(baseline, { ...edit, operationId: "op_stale_rev_01", baseRevision: 1 }),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_OPERATION_STALE_REVISION",
  );
  assert.throws(
    () => applySemanticOperation(baseline, {
      ...edit,
      operationId: "op_stale_hash01",
      expectedSourceSha256: "sha256:deadbeef",
    }),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_OPERATION_STALE_HASH",
  );
  assert.throws(
    () => applySemanticOperation(baseline, {
      ...edit,
      operationId: "op_target_hash1",
      target: {
        ...edit.target,
        expectedOuterHtmlSha256: `sha256:${"0".repeat(64)}`,
      },
    }),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_TARGET_HASH_MISMATCH",
  );
});

test("replans semantic patches at apply time and rejects command, patch or insertion tag tampering", () => {
  const baseline = state();
  const section = target(baseline, IDS.section);
  const identified = `<aside data-pageroot-id="${elementId(20)}">X</aside>`;
  const plan = planSemanticOperationPatch(baseline.html, {
    type: "semantic-operation",
    semanticType: "insertElement",
    expectedSourceSha256: baseline.sourceSha256,
    parentElementId: section.elementId,
    parentTagName: section.tagName,
    beforeElementId: IDS.second,
    beforeTagName: "span",
    elementHtml: identified,
  });
  const tamperedPlan = {
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: `${patch.after}<!-- forged -->` })),
  };
  assert.throws(
    () => applyPatchPlan(tamperedPlan, baseline.html),
    (error) => error instanceof SourcePatchError && error.code === "PATCH_PLAN_TAMPERED",
  );
  assert.throws(
    () => planSemanticOperationPatch(baseline.html, {
      ...plan.metadata.semanticCommand,
      parentTagName: "article",
    }),
    (error) => error instanceof SourcePatchError && error.code === "SEMANTIC_ELEMENT_TAG_MISMATCH",
  );
});

test("is deterministic for the same state, operation and allocated identity stream", () => {
  const leftState = state();
  const rightState = state();
  const edit = operation(leftState, "op_determinism1", "insertElement", {
    parent: target(leftState, IDS.section),
    before: null,
    html: "<article><em>New</em></article>",
  });
  const left = applySemanticOperation(leftState, edit, {
    randomUUID: uuidFactory(...INSERT_UUIDS),
  });
  const right = applySemanticOperation(rightState, edit, {
    randomUUID: uuidFactory(...INSERT_UUIDS),
  });
  assert.equal(left.html, right.html);
  assert.equal(left.sourceSha256, right.sourceSha256);
  assert.deepEqual(left.lineageEntry, right.lineageEntry);
});

test("kernel apply remaps tracked comment targets without a second patch apply", () => {
  const documentState = state();
  const index = buildSourceIndex(documentState.html);
  const trackedComment = createTargetRef(
    index,
    index.byPagerootId.get(IDS.paragraph),
    { targetId: "comment_target_paragraph" },
  );
  const result = applySemanticOperation(
    documentState,
    operation(documentState, "op_track_style_1", "setStyle", {
      target: target(documentState, IDS.section),
      property: "color",
      value: "red",
      important: true,
    }),
    { trackedTargetRefs: [trackedComment] },
  );
  const materialization = result.materialization.sourcePatchResult;
  assert.match(result.html, /color: red/u);
  assert.equal(materialization.refreshedTrackedTargetRefs.length, 1);
  assert.equal(materialization.refreshedTrackedTargetRefs[0].targetId, "comment_target_paragraph");
  assert.equal(materialization.refreshedTrackedTargetRefs[0].elementId, IDS.paragraph);
  assert.equal(materialization.refreshedTrackedTargetRefs[0].resolution, "exact");
});
