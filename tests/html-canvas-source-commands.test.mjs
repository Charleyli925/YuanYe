import test from "node:test";
import assert from "node:assert/strict";
import {
  editableIslandTextOperation,
  inlineStyleOperation,
  siblingReorderOperation,
  textRangeStyleCreatesWrapper,
  textRangeStyleOperation,
} from "../app/components/html-canvas-source-commands.js";
import { applySemanticOperation, createSemanticDocumentState } from "../app/lib/semantic-operation-kernel.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { buildSourceTextMap, textRangeToSourceSegments } from "../app/lib/source-text-map.js";
import { createTargetRef } from "../app/lib/target-resolver.js";
import { enableEditPipelineCounters, disableEditPipelineCounters, readEditPipelineCounters } from "../app/lib/edit-pipeline-counters.js";

const ids = Object.fromEntries(["html", "head", "body", "section", "a", "b", "c"].map(
  (name, index) => [name, `pr1_00000000000040008000${String(index + 1).padStart(12, "0")}`],
));
const a = `<p data-pageroot-id="${ids.a}" data-x=1 style='color : red !important;  padding:4px ; --Token: 10'>A &amp; B</p>`;
const b = `<p data-pageroot-id="${ids.b}">Second</p>`;
const c = `<p data-pageroot-id="${ids.c}">Third</p>`;
const prefix = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><section data-pageroot-id="${ids.section}">`;
const suffix = "</section></body></html>";
const html = `${prefix}${a}${b}${c}${suffix}`;

function setup(source = html) {
  const index = buildSourceIndex(source);
  return { index, state: createSemanticDocumentState(source, { sourceIndex: index }) };
}

function uuidFactory(...values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1);
}

function rangeSetup(source) {
  const index = buildSourceIndex(source);
  const paragraph = index.byPagerootId.get(ids.a);
  const textMap = buildSourceTextMap(index, paragraph.nodeId);
  return {
    index,
    paragraph,
    textMap,
    state: createSemanticDocumentState(source, { sourceIndex: index }),
  };
}

test("element style preserves exact surrounding bytes, priority and tracked targets through one materialization", () => {
  const { index, state } = setup();
  const tracked = createTargetRef(index, index.byPagerootId.get(ids.a), { targetId: "comment_style" });
  enableEditPipelineCounters();
  try {
    const operation = inlineStyleOperation(index, {
      elementId: ids.a, baseRevision: 0, operationId: "op_canvas_style_001",
      property: "color", value: "blue", important: false,
    });
    const result = applySemanticOperation(state, operation, { trackedTargetRefs: [tracked] });
    assert.equal(result.html, html.replace("color : red !important", "color : blue"));
    assert.equal(result.materialization.planType, "set-inline-style");
    assert.deepEqual(result.allocatedElementIds, []);
    assert.equal(result.materialization.sourcePatchResult.refreshedTrackedTargetRefs[0].elementId, ids.a);
    assert.equal(readEditPipelineCounters().fullPatchApplies, 1);
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, html);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  } finally {
    disableEditPipelineCounters();
  }
});

test("direct style and reorder retain a module-level caller target through the same materialization", () => {
  for (const operationForIndex of [
    (index) => inlineStyleOperation(index, {
      elementId: ids.a,
      baseRevision: 0,
      operationId: "op_canvas_module_style",
      property: "color",
      value: "blue",
      important: false,
    }),
    (index) => siblingReorderOperation(index, {
      elementId: ids.a,
      toIndex: 1,
      baseRevision: 0,
      operationId: "op_canvas_module_reorder",
    }),
  ]) {
    const { index, state } = setup();
    const tracked = createTargetRef(index, index.byPagerootId.get(ids.a), {
      targetId: "target_canvas_module_caller",
      level: "module",
    });
    const result = applySemanticOperation(state, operationForIndex(index), {
      trackedTargetRefs: [tracked],
    });
    assert.notEqual(result.materialization.sourcePatchResult.refreshedTargetRefs[0].targetId, tracked.targetId);
    const refreshed = result.materialization.sourcePatchResult.refreshedTrackedTargetRefs.find(
      (candidate) => candidate.targetId === tracked.targetId,
    );
    assert.equal(refreshed?.targetId, tracked.targetId);
    assert.equal(refreshed?.level, "module");
    assert.notEqual(refreshed?.resolution, "orphaned");
    assert.equal(
      result.materialization.sourcePatchResult.targetMappings.some(
        (mapping) => mapping.targetId === tracked.targetId && mapping.tracked === true,
      ),
      true,
    );
  }
});

test("direct range style carries the exact logical quote and uses one Kernel materialization with returned IDs", () => {
  const source = `${prefix}<p data-pageroot-id="${ids.a}">Alpha &amp; <strong data-pageroot-id="${ids.b}">Beta</strong> tail</p><aside data-pageroot-id="${ids.c}">outside</aside>${suffix}`;
  const { index, state, textMap } = rangeSetup(source);
  const segments = textRangeToSourceSegments(textMap, 3, 10);
  const operation = textRangeStyleOperation(index, {
    elementId: ids.a,
    baseRevision: 0,
    operationId: "op_canvas_range_style_001",
    segments,
    property: "font-weight",
    value: "700",
    important: false,
  });
  assert.deepEqual(operation.range, {
    startOffset: 3,
    endOffset: 10,
    quote: "ha & Be",
  });
  assert.equal(operation.createdPagerootIds, undefined);

  const tracked = createTargetRef(index, index.byPagerootId.get(ids.a), {
    targetId: "target_canvas_range_module",
    level: "module",
  });
  const firstId = "pr1_000000000000400080000000000000a1";
  const secondId = "pr1_000000000000400080000000000000a2";
  enableEditPipelineCounters();
  try {
    const result = applySemanticOperation(state, operation, {
      trackedTargetRefs: [tracked],
      randomUUID: uuidFactory(
        "00000000-0000-4000-8000-0000000000a1",
        "00000000-0000-4000-8000-0000000000a2",
      ),
    });
    assert.equal(
      result.html,
      `${prefix}<p data-pageroot-id="${ids.a}">Alp<span style="all: unset; display: inline !important; font-weight: 700" data-pageroot-id="${firstId}">ha &amp; </span><strong data-pageroot-id="${ids.b}"><span style="all: unset; display: inline !important; font-weight: 700" data-pageroot-id="${secondId}">Be</span>ta</strong> tail</p><aside data-pageroot-id="${ids.c}">outside</aside>${suffix}`,
    );
    assert.deepEqual(result.allocatedElementIds, [firstId, secondId]);
    assert.deepEqual(result.identityDelta.addedElementIds, [firstId, secondId]);
    assert.equal(result.materialization.planType, "set-text-range-style");
    assert.equal(
      textRangeStyleCreatesWrapper(result.materialization.sourcePatchResult),
      true,
    );
    assert.equal(readEditPipelineCounters().fullPatchApplies, 1);
    assert.equal(
      result.materialization.sourcePatchResult.refreshedTrackedTargetRefs.find(
        (candidate) => candidate.targetId === tracked.targetId,
      )?.level,
      "module",
    );
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, source);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  } finally {
    disableEditPipelineCounters();
  }
});

test("editable island text factory emits a complete envelope without preallocating line-break IDs", () => {
  const source = `${prefix}<p data-pageroot-id="${ids.a}">Alpha <strong data-pageroot-id="${ids.b}">Beta</strong> tail</p><aside data-pageroot-id="${ids.c}">outside</aside>${suffix}`;
  const { index, state } = setup(source);
  const operation = editableIslandTextOperation(index, {
    elementId: ids.a,
    baseRevision: state.revision,
    operationId: "op_canvas_island_text_01",
    text: "Alpha Beta\ntail",
    contentHtml: `Alpha <strong data-pageroot-id="${ids.b}">Beta</strong><br>tail`,
  });
  assert.deepEqual(Object.keys(operation).sort(), [
    "baseRevision",
    "contentHtml",
    "expectedSourceSha256",
    "operationId",
    "schemaVersion",
    "target",
    "text",
    "type",
  ]);
  assert.equal(operation.schemaVersion, 1);
  assert.equal(operation.operationId, "op_canvas_island_text_01");
  assert.equal(operation.baseRevision, 0);
  assert.equal(operation.expectedSourceSha256, index.sourceSha256);
  assert.equal(operation.type, "setText");
  assert.deepEqual(operation.target, {
    elementId: ids.a,
    tagName: "p",
    expectedOuterHtmlSha256: operation.target.expectedOuterHtmlSha256,
  });
  assert.match(operation.target.expectedOuterHtmlSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(operation.text, "Alpha Beta\ntail");
  assert.equal(
    operation.contentHtml,
    `Alpha <strong data-pageroot-id="${ids.b}">Beta</strong><br>tail`,
  );
  assert.equal(Object.hasOwn(operation, "createdPagerootIds"), false);

  const breakId = "pr1_000000000000400080000000000000b1";
  const result = applySemanticOperation(state, operation, {
    randomUUID: () => "00000000-0000-4000-8000-0000000000b1",
  });
  assert.deepEqual(result.allocatedElementIds, [breakId]);
  assert.deepEqual(result.identityDelta.addedElementIds, [breakId]);
  assert.match(result.html, new RegExp(`<br data-pageroot-id="${breakId}">`, "u"));
  const undo = applySemanticOperation(result.nextState, result.inverseOperation);
  assert.equal(undo.html, source);
  assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
});

test("direct range style avoids wrapper allocation for no-change and existing-wrapper projections", () => {
  const wholeSource = `${prefix}<p data-pageroot-id="${ids.a}" style="font-weight: 700">Alpha</p>${suffix}`;
  const whole = rangeSetup(wholeSource);
  const unchanged = applySemanticOperation(whole.state, textRangeStyleOperation(whole.index, {
    elementId: ids.a,
    baseRevision: 0,
    operationId: "op_canvas_range_same",
    segments: textRangeToSourceSegments(whole.textMap, 0, 5),
    property: "font-weight",
    value: "700",
    important: false,
  }));
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.allocatedElementIds, []);
  assert.equal(textRangeStyleCreatesWrapper(unchanged.materialization.sourcePatchResult), false);

  const wrappedSource = `${prefix}<p data-pageroot-id="${ids.a}"><span data-pageroot-id="${ids.b}" style="font-weight: 700">Alpha</span> tail</p>${suffix}`;
  const wrapped = rangeSetup(wrappedSource);
  const coalesced = applySemanticOperation(wrapped.state, textRangeStyleOperation(wrapped.index, {
    elementId: ids.a,
    baseRevision: 0,
    operationId: "op_canvas_range_coalesced",
    segments: textRangeToSourceSegments(wrapped.textMap, 0, 5),
    property: "font-style",
    value: "italic",
    important: false,
  }));
  assert.match(coalesced.html, /style="font-weight: 700; font-style: italic"/u);
  assert.equal((coalesced.html.match(/<span\b/gu) ?? []).length, 1);
  assert.deepEqual(coalesced.allocatedElementIds, []);
  assert.equal(textRangeStyleCreatesWrapper(coalesced.materialization.sourcePatchResult), false);
});

test("direct range style rejects stale revision, hash, target and quote evidence", () => {
  const source = `${prefix}<p data-pageroot-id="${ids.a}">Alpha Beta</p><p data-pageroot-id="${ids.b}">Other</p>${suffix}`;
  const { index, state, textMap } = rangeSetup(source);
  const operation = textRangeStyleOperation(index, {
    elementId: ids.a,
    baseRevision: 0,
    operationId: "op_canvas_range_guards",
    segments: textRangeToSourceSegments(textMap, 0, 5),
    property: "font-weight",
    value: "700",
    important: false,
  });
  for (const changed of [
    { ...operation, baseRevision: 1 },
    { ...operation, expectedSourceSha256: `sha256:${"0".repeat(64)}` },
    { ...operation, target: { ...operation.target, tagName: "div" } },
    { ...operation, target: { ...operation.target, expectedOuterHtmlSha256: `sha256:${"0".repeat(64)}` } },
    { ...operation, range: { ...operation.range, quote: "Omega" } },
  ]) assert.throws(() => applySemanticOperation(state, changed));

  const other = index.byPagerootId.get(ids.b);
  assert.throws(() => textRangeStyleOperation(index, {
    ...operation,
    elementId: ids.a,
    segments: [{
      textNodeId: other.textNodeIds[0],
      startOffset: 0,
      endOffset: 2,
    }],
  }));
  assert.throws(() => textRangeStyleOperation(index, { ...operation, elementId: "invalid" }));
});

test("unchanged element style preserves bytes without allocating identity", () => {
  const { index, state } = setup();
  const result = applySemanticOperation(state, inlineStyleOperation(index, {
    elementId: ids.a, baseRevision: 0, operationId: "op_canvas_style_same",
    property: "color", value: "red", important: true,
  }));
  assert.equal(result.html, html);
  assert.equal(result.changed, false);
  assert.deepEqual(result.allocatedElementIds, []);
});

test("sibling positions use the list without the moving element, including the final position", () => {
  for (const [elementId, toIndex, expected] of [
    [ids.a, 1, `${b}${a}${c}`],
    [ids.a, 2, `${b}${c}${a}`],
    [ids.c, 0, `${c}${a}${b}`],
  ]) {
    const { index, state } = setup();
    const result = applySemanticOperation(state, siblingReorderOperation(index, {
      elementId, toIndex, baseRevision: 0, operationId: "op_canvas_reorder_001",
    }));
    assert.equal(result.html, `${prefix}${expected}${suffix}`);
    assert.equal(result.materialization.planType, "reorder-sibling");
    assert.deepEqual(result.allocatedElementIds, []);
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, html);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  }
});

test("direct sibling reorder retains comment ownership and rejects mixed text boundaries", () => {
  const source = `${prefix}${a}<!-- belongs to A -->\n${b}${c}${suffix}`;
  const { index, state } = setup(source);
  const result = applySemanticOperation(state, siblingReorderOperation(index, {
    elementId: ids.a, toIndex: 2, baseRevision: 0, operationId: "op_canvas_comment_move",
  }));
  assert.equal(result.html, `${prefix}${b}${c}${a}<!-- belongs to A -->\n${suffix}`);
  const unsafe = setup(`${prefix}${a}meaningful text${b}${c}${suffix}`);
  assert.throws(() => applySemanticOperation(unsafe.state, siblingReorderOperation(unsafe.index, {
    elementId: ids.a, toIndex: 1, baseRevision: 0, operationId: "op_canvas_unsafe_move",
  })), /non-whitespace text/);
});

test("direct commands retain stale source, target identity and sibling bounds rejection", () => {
  const { index, state } = setup();
  const operation = inlineStyleOperation(index, {
    elementId: ids.a, baseRevision: 0, operationId: "op_canvas_guards_001",
    property: "color", value: "blue", important: false,
  });
  for (const changed of [
    { ...operation, baseRevision: 1 },
    { ...operation, expectedSourceSha256: `sha256:${"0".repeat(64)}` },
    { ...operation, target: { ...operation.target, tagName: "div" } },
    { ...operation, target: { ...operation.target, expectedOuterHtmlSha256: `sha256:${"0".repeat(64)}` } },
    { ...operation, important: undefined },
  ]) assert.throws(() => applySemanticOperation(state, changed));
  for (const elementId of ["", "invalid", "pr1_ffffffffffff4fff8fffffffffffffff"]) {
    assert.throws(() => inlineStyleOperation(index, { ...operation, elementId }));
    assert.throws(() => siblingReorderOperation(index, { elementId, toIndex: 0, baseRevision: 0 }));
  }
  for (const toIndex of [-1, 3, 0.5, NaN]) {
    assert.throws(() => siblingReorderOperation(index, { elementId: ids.a, toIndex, baseRevision: 0 }));
  }
  assert.throws(() => siblingReorderOperation(index, { elementId: ids.body, toIndex: 0, baseRevision: 0 }));
  assert.throws(() => createSemanticDocumentState(html.replace(`data-pageroot-id="${ids.b}"`, `data-pageroot-id="${ids.a}"`)));
});
