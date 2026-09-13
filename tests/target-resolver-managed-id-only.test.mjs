import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";

const ID_ROOT = "pr1_11111111111141118111111111111111";
const ID_ALPHA = "pr1_22222222222242229222222222222222";
const ID_BETA = "pr1_3333333333334333a333333333333333";

const MANAGED = `<!doctype html><html data-pageroot-id="${ID_ROOT}"><head data-pageroot-id="${ID_BETA}"><title data-pageroot-id="pr1_4444444444444444b444444444444444">t</title></head><body data-pageroot-id="pr1_55555555555545558555555555555555"><section data-pageroot-id="${ID_ALPHA}" class="old" data-key="a"><h2 data-pageroot-id="pr1_66666666666646669666666666666666">Alpha 唯一标题</h2></section></body></html>`;

test("incomplete identity HTML cannot use selector or fingerprint fallback", () => {
  const html = `<main id="root"><section class="old" data-key="a"><h2>Alpha 唯一标题</h2></section><section data-key="b"><h2>Beta</h2></section></main>`;
  const index = buildSourceIndex(html);
  const alpha = index.elements.find(
    (element) => element.stableAttributes["data-key"] === "a",
  );
  const alphaRef = createTargetRef(index, alpha.nodeId, { level: "module" });
  const reordered = `<main id="root"><section data-key="b"><h2>Beta</h2></section><section class="renamed" data-key="a"><h2>Alpha 唯一标题</h2></section></main>`;
  const rebound = resolveTargetRef(buildSourceIndex(reordered), alphaRef, {
    surface: "edit",
  });
  assert.equal(index.pagerootIdentity.complete, false);
  assert.equal(rebound.resolution, "orphaned");
  assert.equal(rebound.reason, "managed-element-id-required");
});

test("managed Working Copy locates only by elementId", () => {
  const index = buildSourceIndex(MANAGED);
  assert.equal(index.pagerootIdentity.complete, true);
  const alpha = index.byPagerootId.get(ID_ALPHA);
  const withId = createTargetRef(index, alpha.nodeId);
  const official = resolveTargetRef(index, withId, { surface: "edit" });
  assert.equal(official.resolution, "exact");
  assert.equal(official.reason, "stable-element-and-source-hash-match");

  const idLess = { ...withId };
  delete idLess.elementId;
  const orphaned = resolveTargetRef(index, idLess, { surface: "comments" });
  assert.equal(orphaned.resolution, "orphaned");
  assert.equal(orphaned.reason, "managed-element-id-required");
});

test("managed documents orphan ID-less historical refs", () => {
  const index = buildSourceIndex(MANAGED);
  const historical = {
    targetId: "target_legacy_comment",
    label: "Alpha 唯一标题",
    level: "subregion",
    selector: "section[data-key=\"a\"]",
    textQuote: "Alpha 唯一标题",
    fingerprint: {
      tagName: "section",
      stableAttributes: { "data-key": "a" },
      ancestorFingerprint: [],
      textPrefix: "Alpha 唯一标题",
      textSuffix: "Alpha 唯一标题",
    },
    sourceAnchor: {
      startOffset: 0,
      endOffset: 8,
      sourceSha256: `sha256:${"ab".repeat(32)}`,
    },
  };
  const official = resolveTargetRef(index, historical, { surface: "review" });
  assert.equal(official.resolution, "orphaned");
  assert.equal(official.reason, "managed-element-id-required");
});

test("a deleted managed ID stays orphaned even if a similar node remains", () => {
  const index = buildSourceIndex(MANAGED);
  const alpha = index.byPagerootId.get(ID_ALPHA);
  const target = createTargetRef(index, alpha.nodeId);
  const replaced = MANAGED.replace(
    `data-pageroot-id="${ID_ALPHA}"`,
    `data-pageroot-id="pr1_8888888888884888a888888888888888"`,
  );
  const official = resolveTargetRef(buildSourceIndex(replaced), target, {
    surface: "review",
  });
  assert.equal(official.resolution, "orphaned");
  assert.equal(official.reason, "stable-element-not-found");
  assert.equal(official.target, null);
});

test("whole-page comments require the body Stable ID", () => {
  const index = buildSourceIndex(MANAGED);
  const body = index.elements.find((element) => element.tagName === "body");
  const official = resolveTargetRef(index, {
    targetId: "target_page",
    label: "整个页面",
    level: "module",
    selector: "body",
    resolution: "exact",
  }, { surface: "comments" });
  assert.equal(official.resolution, "orphaned");
  assert.equal(official.reason, "managed-element-id-required");

  const withId = resolveTargetRef(index, {
    targetId: "target_page",
    elementId: body.pagerootId,
    label: "整个页面",
    level: "module",
    resolution: "exact",
  }, { surface: "comments" });
  assert.equal(withId.resolution, "exact");
  assert.equal(withId.target?.pagerootId, body.pagerootId);
});

test("managed insertion points require a parent elementId", () => {
  const index = buildSourceIndex(MANAGED);
  const body = index.elements.find((element) => element.tagName === "body");
  const insertion = createInsertionPointTargetRef(index, { parentId: body.nodeId });
  const exact = resolveTargetRef(index, insertion, { surface: "edit" });
  assert.equal(exact.resolution, "exact");

  const idLess = { ...insertion };
  delete idLess.elementId;
  const orphaned = resolveTargetRef(index, idLess, { surface: "edit" });
  assert.equal(orphaned.resolution, "orphaned");
  assert.equal(orphaned.reason, "managed-insertion-requires-parent-id");
});


test("insertion targets never guess a parent from an invalid or ambiguous Stable ID", () => {
  const index = buildSourceIndex(MANAGED);
  const parent = index.byPagerootId.get(ID_ALPHA);
  const insertion = createInsertionPointTargetRef(index, { parentId: parent.nodeId });
  for (const elementId of [undefined, null, "", false, 0, NaN, " ", "invalid-id"]) {
    const result = resolveTargetRef(index, { ...insertion, elementId }, { surface: "edit" });
    assert.equal(result.resolution, "orphaned", String(elementId));
    assert.equal(result.target, null);
  }
  const missing = MANAGED.replace(ID_ALPHA, "pr1_8888888888884888a888888888888888");
  const duplicate = MANAGED.replace(ID_BETA, ID_ALPHA);
  for (const html of [missing, duplicate]) {
    const result = resolveTargetRef(buildSourceIndex(html), insertion, { surface: "edit" });
    assert.equal(result.resolution, "orphaned");
    assert.equal(result.reason, "stable-parent-not-found");
  }
});

test("a valid insertion parent still rebinds its child boundary after a source shift", () => {
  const index = buildSourceIndex(MANAGED);
  const parent = index.byPagerootId.get(ID_ALPHA);
  const insertion = createInsertionPointTargetRef(index, { parentId: parent.nodeId });
  const shifted = buildSourceIndex(`<!-- source shift -->${MANAGED}`);
  const result = resolveTargetRef(shifted, insertion, { surface: "edit" });
  assert.equal(result.resolution, "rebound");
  assert.equal(result.target.parentId, shifted.byPagerootId.get(ID_ALPHA).nodeId);
  assert.equal(result.target.offset, shifted.byPagerootId.get(ID_ALPHA).contentRange.endOffset);
});
