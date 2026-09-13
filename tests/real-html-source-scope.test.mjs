import assert from "node:assert/strict";
import test from "node:test";
import { boldMarkerPattern } from "./e2e/electron/real-html/frozen-text.mjs";
import { bindFrozenCopy } from "./e2e/electron/real-html/frozen-structure.mjs";
import { frozenDigest } from "./e2e/electron/real-html/frozen-selection.mjs";

import {
  compareElementScopedMutation,
  compareElementSourceDelta,
  compareElementStyleMutation,
  formattedMarkerAppendedPattern,
  SOURCE_SCOPE_POLICIES,
} from "./e2e/electron/real-html/source-scope.mjs";

const SOURCE_ID = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

test("continuing a styled span accepts only raw attribute order normalization", () => {
  const id = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<p data-pageroot-id="${SOURCE_ID}">Text <span style="font-weight: 700" data-pageroot-id="${id}">bold</span></p><!--keep-->`;
  const after = before.replace(`style="font-weight: 700" data-pageroot-id="${id}"`,
    `data-pageroot-id="${id}" style="font-weight: 700"`).replace("bold</", "bold MORE</");
  const check = (value, allow = true) => compareElementScopedMutation({ before, after: value, sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE, expectedAfterContains: [" MORE"],
    expectedAppendedPattern: / MORE/u, allowSpanAttributeOrder: allow });
  assert.equal(check(after).ok, true); assert.equal(check(after, false).ok, false);
  for (const bad of [after.replace("700", "400"), after.replace("keep", "wrong"), after.replace("bold", "wrong"),
    after.replace('style="font-weight: 700"', "style='font-weight: 700'")])
    assert.equal(check(bad).ok, false);
  assert.throws(() => check(after.replace(id, SOURCE_ID)), { code: "SOURCE_SCOPE_IDENTITY_MISSING" });
});

test("nested newline insertion aligns shared delimiter bytes without allowing other changes", () => {
  const child = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb", fresh = "pr1_cccccccccccc4ccc8ccccccccccccccc";
  const before = `<h1 data-pageroot-id="${SOURCE_ID}"><span data-pageroot-id="${child}">文字</span></h1><!-- outside -->`;
  const inserted = `<br data-pageroot-id="${fresh}">PRLINE_H02`;
  const after = before.replace("文字", `文字${inserted}`);
  const check = value => compareElementScopedMutation({ before, after: value, sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_NEWLINE, expectedAfterContains: ["PRLINE_H02"],
    expectedAppendedPattern: /<br data-pageroot-id="pr1_[0-9a-f]{32}">PRLINE_H02/u });
  const proof = check(after);
  assert.equal(proof.ok, true);
  assert.equal(Buffer.from(after).subarray(proof.appendedByteRange.start, proof.appendedByteRange.end).toString(), inserted);
  for (const bad of [after.replace("文字", "错字"), after.replace("outside", "wrong"),
    after.replace(fresh, child), after.replace("<br", "br"), after.replace("PRLINE_H02", "PRLINE_H02EXTRA"),
    after.replace("</span>", "<!-- extra --></span>")]) assert.equal(check(bad).ok, false);
});

test("element text permits only link attribute order, retaining values and outside bytes", () => {
  const linkId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<p data-pageroot-id="${SOURCE_ID}">Text <a href="#safe" data-pageroot-id="${linkId}">link</a>.\n    </p><!-- outside -->`;
  const after = before.replace(`href="#safe" data-pageroot-id="${linkId}"`,
    `data-pageroot-id="${linkId}" href="#safe"`).replace(".\n", ". MARK\n");
  const check = (value, allowAttributeOrderOnly = true) => compareElementScopedMutation({
    before, after: value, sourceId: SOURCE_ID, normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: [" MARK"], expectedAppendedPattern: / MARK/u, allowAttributeOrderOnly });
  assert.equal(check(after).ok, true);
  assert.equal(check(after, false).ok, false);
  assert.ok(check(after).changedRanges.before.end > check(after).changedRanges.before.start);
  for (const bad of [after.replace("#safe", "#wrong"), after.replace(">link<", ">changed<"),
    after.replace("outside", "wrong"), after.replace("\n    ", "\n   "),
    after.replace('href="#safe"', "href='#safe'"), after.replace("</a>", "</a><!-- extra -->"),
    after.replace(". MARK", "wrong. MARK")]) assert.equal(check(bad).ok, false);
});

test("each repeated bold operation compares with its verified unbold preparation, not the cycle baseline", () => {
  const bold = `<p data-pageroot-id="${SOURCE_ID}" style="font-weight: 700">Fixed</p><!-- outside -->`;
  const plain = bold.replace("700", "normal");
  const check = (before, after, expectedValue) => compareElementStyleMutation({ before, after,
    sourceId: SOURCE_ID, expectedProperty: "font-weight", expectedValue });
  assert.equal(check(bold, plain, "normal").ok, true);
  assert.equal(check(plain, bold, "700").ok, true);
  assert.equal(check(bold, bold, "700").expectedPropertyChanged, false);
  assert.equal(check(bold, bold, "700").ok, false);
  assert.equal(check(plain, plain, "700").ok, false);
  assert.equal(check(plain, bold.replace("outside", "wrong"), "700").outsideElementUnchanged, false);
});

for (const tag of ["span", "p"]) test(`copy binding for ${tag} accepts only the frozen insertion with a fresh identity and unchanged outside bytes`, () => {
  const parentId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const copyId = "pr1_cccccccccccc4ccc8ccccccccccccccc";
  const siblingId = "pr1_dddddddddddd4ddd8ddddddddddddddd";
  const original = `<${tag} data-pageroot-id="${SOURCE_ID}">中文 text</${tag}>`;
  const sibling = `<aside data-pageroot-id="${siblingId}">Outside</aside>`;
  const before = Buffer.from(`<div data-pageroot-id="${parentId}">${original}\n${sibling}</div>`);
  const byteOffset = before.indexOf(sibling);
  const target = { selectedId: SOURCE_ID, selectedTag: tag, copyBinding: {
    parentId, beforeSiblingId: siblingId, byteOffset, originalElementSha256: frozenDigest(original) } };
  const inserted = `<${tag}  data-pageroot-id="${copyId}">中文 text</${tag}>`;
  const after = Buffer.concat([before.subarray(0, byteOffset), Buffer.from(inserted), before.subarray(byteOffset)]);
  assert.equal(bindFrozenCopy(before, after, target).copyId, copyId);
  for (const broken of [
    after.toString().replace(copyId, SOURCE_ID), after.toString().replace(copyId, "stale"),
    after.toString().replace("Outside", "Changed"), after.toString().replace(inserted, inserted.replace("text", "wrong")),
    after.toString().replace(inserted, `${inserted}${inserted}`),
    `${inserted}${before}`, before.toString(),
  ]) {
    assert.throws(() => bindFrozenCopy(before, Buffer.from(broken), target), error => {
      assert.equal(error.code, "FROZEN_COPY_SOURCE_INVALID");
      assert.ok(Object.values(error.details.conditions).includes(false));
      assert.ok(error.details.actualChangedRanges);
      return true;
    });
  }
  for (const change of [{ byteOffset: byteOffset + 1 }, { parentId: copyId }, { beforeSiblingId: null },
    { originalElementSha256: "0".repeat(64) }]) {
    assert.throws(() => bindFrozenCopy(before, after, { ...target, copyBinding: { ...target.copyBinding, ...change } }),
      { code: "FROZEN_COPY_SOURCE_INVALID" });
  }
});

test("fixed bold oracle accepts the declared wrapper but rejects extra formatting and outside writes", () => {
  const before = `<p data-pageroot-id="${SOURCE_ID}">Original</p><!-- outside -->`;
  const formatted = ' <span style="all: unset; display: inline !important; font-weight: 700" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">PRCORE_H03</span>';
  const after = before.replace("Original", `Original${formatted}`);
  const check = (html) => compareElementScopedMutation({ before, after: html, sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT, expectedAfterContains: ["PRCORE_H03"],
    expectedAppendedPattern: boldMarkerPattern("PRCORE_H03", true) });
  assert.equal(check(after).ok, true);
  const outside = check(after.replace("outside", "changed"));
  assert.equal(outside.ok, false);
  assert.equal(outside.outsideUnchanged, false);
  for (const broken of [after.replace("700", "400"), after.replace("700", "700; color: red")]) {
    assert.equal(check(broken).ok, false);
    assert.equal(check(broken).appendedShapeValid, false);
  }
});

function sourcePair() {
  const before = Buffer.from(`<p data-pageroot-id="${SOURCE_ID}">SAFE</p>`);
  const after = Buffer.from(`<p data-pageroot-id="${SOURCE_ID}">EVIL</p>`);
  const beforeStart = before.indexOf("SAFE");
  const afterStart = after.indexOf("EVIL");
  return {
    before,
    after,
    beforeRange: { start: beforeStart, end: beforeStart + 4 },
    afterRange: { start: afterStart, end: afterStart + 4 },
  };
}

test("source-scope helper rejects observed-after-derived expectations", () => {
  const pair = sourcePair();
  const report = compareElementSourceDelta({
    ...pair,
    sourceId: SOURCE_ID,
    expectedBefore: "SAFE",
    expectedAfter: "SAFE",
    domSelector: `[data-pageroot-id="${SOURCE_ID}"]`,
  });
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "REGION_EXPECTED_AFTER_MISMATCH");
  assert.throws(
    () => compareElementSourceDelta({
      ...pair,
      sourceId: SOURCE_ID,
      expectedBefore: "SAFE",
      domSelector: `[data-pageroot-id="${SOURCE_ID}"]`,
    }),
    (error) => error?.code === "SOURCE_SCOPE_EXPECTATION_REQUIRED",
  );
});

test("source-scope helper requires an explicit subrange", () => {
  const pair = sourcePair();
  assert.throws(
    () => compareElementSourceDelta({
      before: pair.before,
      after: pair.after,
      sourceId: SOURCE_ID,
      expectedBefore: "SAFE",
      expectedAfter: "EVIL",
    }),
    (error) => error?.code === "SOURCE_SCOPE_RANGE_REQUIRED",
  );
});

test("element-style oracle accepts exactly one independently expected declaration", () => {
  const parentId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<main data-pageroot-id="${parentId}"><p class="sample" data-pageroot-id="${SOURCE_ID}">Original</p><aside>Sibling</aside></main>`;
  const after = `<main data-pageroot-id="${parentId}"><p class="sample" data-pageroot-id="${SOURCE_ID}" style="font-size: 29px">Original</p><aside>Sibling</aside></main>`;
  const report = compareElementStyleMutation({
    before,
    after,
    sourceId: SOURCE_ID,
    expectedProperty: "font-size",
    expectedValue: "29px",
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.changedProperties, ["font-size"]);
  assert.equal(report.outsideElementUnchanged, true);
  assert.equal(report.nonStyleAttributesUnchanged, true);
  assert.equal(report.elementContentAndClosingUnchanged, true);
});

test("element-style oracle rejects an extra declaration and a wrong expected value", () => {
  const before = `<p style="color: #111111" data-pageroot-id="${SOURCE_ID}">Original</p>`;
  const after = `<p style="color: #123456; margin-top: 9px" data-pageroot-id="${SOURCE_ID}">Original</p>`;
  const extra = compareElementStyleMutation({
    before,
    after,
    sourceId: SOURCE_ID,
    expectedProperty: "color",
    expectedValue: "#123456",
  });
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.changedProperties, ["color", "margin-top"]);
  assert.equal(extra.expectedPropertyChanged, false);

  const wrongValue = compareElementStyleMutation({
    before,
    after: `<p style="color: #123456" data-pageroot-id="${SOURCE_ID}">Original</p>`,
    sourceId: SOURCE_ID,
    expectedProperty: "color",
    expectedValue: "#654321",
  });
  assert.equal(wrongValue.ok, false);
  assert.equal(wrongValue.expectedValueApplied, false);
});

test("element-style oracle rejects target content and outside-byte corruption", () => {
  const parentId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<main data-pageroot-id="${parentId}"><p data-pageroot-id="${SOURCE_ID}">Original</p></main>`;
  const contentChanged = compareElementStyleMutation({
    before,
    after: `<main data-pageroot-id="${parentId}"><p data-pageroot-id="${SOURCE_ID}" style="line-height: 53px">Changed</p></main>`,
    sourceId: SOURCE_ID,
    expectedProperty: "line-height",
    expectedValue: "53px",
  });
  assert.equal(contentChanged.ok, false);
  assert.equal(contentChanged.elementContentAndClosingUnchanged, false);

  const outsideChanged = compareElementStyleMutation({
    before,
    after: `<main class="corrupt" data-pageroot-id="${parentId}"><p data-pageroot-id="${SOURCE_ID}" style="line-height: 53px">Original</p></main>`,
    sourceId: SOURCE_ID,
    expectedProperty: "line-height",
    expectedValue: "53px",
  });
  assert.equal(outsideChanged.ok, false);
  assert.equal(outsideChanged.outsideElementUnchanged, false);
});

test("element-style oracle rejects duplicate style syntax and unrelated target attributes", () => {
  const before = `<p class="sample" data-pageroot-id="${SOURCE_ID}">Original</p>`;
  const duplicateAttribute = compareElementStyleMutation({
    before,
    after: `<p class="sample" style="color:#123456" style="margin-top:9px" data-pageroot-id="${SOURCE_ID}">Original</p>`,
    sourceId: SOURCE_ID,
    expectedProperty: "color",
    expectedValue: "#123456",
  });
  assert.equal(duplicateAttribute.ok, false);
  assert.equal(duplicateAttribute.styleSyntaxValid, false);

  const duplicateProperty = compareElementStyleMutation({
    before,
    after: `<p class="sample" style="color:#111111;color:#123456" data-pageroot-id="${SOURCE_ID}">Original</p>`,
    sourceId: SOURCE_ID,
    expectedProperty: "color",
    expectedValue: "#123456",
  });
  assert.equal(duplicateProperty.ok, false);
  assert.equal(duplicateProperty.styleSyntaxValid, false);

  const attributeChanged = compareElementStyleMutation({
    before,
    after: `<p class="changed" style="color:#123456" data-pageroot-id="${SOURCE_ID}">Original</p>`,
    sourceId: SOURCE_ID,
    expectedProperty: "color",
    expectedValue: "#123456",
  });
  assert.equal(attributeChanged.ok, false);
  assert.equal(attributeChanged.nonStyleAttributesUnchanged, false);

  for (const injected of [
    "font-size: 29px; GARBAGE",
    "font-size: 29px; /* injected */",
  ]) {
    const invalidTail = compareElementStyleMutation({
      before,
      after: `<p class="sample" style="${injected}" data-pageroot-id="${SOURCE_ID}">Original</p>`,
      sourceId: SOURCE_ID,
      expectedProperty: "font-size",
      expectedValue: "29px",
    });
    assert.equal(invalidTail.ok, false, injected);
    assert.equal(invalidTail.styleSyntaxValid, false, injected);
    assert.equal(invalidTail.syntaxComplete.after, false, injected);
  }
});

test("operation-scoped oracle rejects changes outside the Stable-ID element", () => {
  const before = `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">before</p></main>`;
  const validAfter = `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">before TOKEN</p></main>`;
  const valid = compareElementScopedMutation({
    before,
    after: validAfter,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.outsideUnchanged, true);

  const outsideChanged = compareElementScopedMutation({
    before,
    after: `<main class="changed" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">after TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(outsideChanged.ok, false);
  assert.equal(outsideChanged.outsideUnchanged, false);

  const targetAttributeChanged = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p class="corrupt" data-pageroot-id="${SOURCE_ID}">after TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(targetAttributeChanged.ok, false);
  assert.equal(targetAttributeChanged.outsideUnchanged, false);

  const targetContentCorrupted = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">UNRELATED DAMAGE TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(targetContentCorrupted.ok, false);
  assert.equal(targetContentCorrupted.preservedBeforeContent, false);
});

test("operation-scoped oracle requires a closed normalization policy", () => {
  assert.throws(() => compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">before</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">after</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: "anything-goes",
    expectedAppendedPattern: /after/u,
  }), { code: "SOURCE_SCOPE_POLICY_INVALID" });
});

test("operation-scoped oracle rejects a marker that already existed before input", () => {
  const report = compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">TOKEN</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">TOKEN</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: /TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.unexpectedBefore, ["TOKEN"]);
});

test("operation-scoped oracle rejects extra appended garbage around a valid marker", () => {
  const report = compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">Original</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">Original<script>corruption()</script> TOKEN EXTRA</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: /TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.equal(report.appendedShapeValid, false);
});

test("operation-scoped oracle accepts one exact insertion before preserved trailing whitespace", () => {
  const before = `<p data-pageroot-id="${SOURCE_ID}">Original\n  </p>`;
  const after = `<p data-pageroot-id="${SOURCE_ID}">Original TOKEN\n  </p>`;
  const report = compareElementScopedMutation({
    before,
    after,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(report.ok, true);
  assert.equal(report.outsideUnchanged, true);
  assert.equal(report.preservedBeforeContent, true);
  assert.equal(report.changedRanges.before.start, report.changedRanges.before.end);
  assert.equal(report.appendedByteRange.end - report.appendedByteRange.start, 6);
});

test("operation-scoped oracle rejects an outside byte change around an otherwise exact insertion", () => {
  const parentId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<main data-pageroot-id="${parentId}"><p data-pageroot-id="${SOURCE_ID}">Original\n  </p></main>`;
  const after = `<main class="changed" data-pageroot-id="${parentId}"><p data-pageroot-id="${SOURCE_ID}">Original TOKEN\n  </p></main>`;
  const report = compareElementScopedMutation({
    before,
    after,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.equal(report.outsideUnchanged, false);
  assert.equal(report.preservedBeforeContent, true);
});

test("operation-scoped oracle rejects replacement even when the expected marker is present", () => {
  const before = `<p data-pageroot-id="${SOURCE_ID}">Original\n  </p>`;
  const after = `<p data-pageroot-id="${SOURCE_ID}">Replaced TOKEN\n  </p>`;
  const report = compareElementScopedMutation({
    before,
    after,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.equal(report.outsideUnchanged, true);
  assert.equal(report.preservedBeforeContent, false);
});

test("format oracle permits only the Stable ID and three requested declarations", () => {
  const before = `<p data-pageroot-id="${SOURCE_ID}">Original</p>`;
  const marker = "PRQA_0_FORMAT";
  const pattern = formattedMarkerAppendedPattern(marker);
  const validAfter = `<p data-pageroot-id="${SOURCE_ID}">Original <span style="all: unset; display: inline !important; font-weight: 700; font-style: italic; text-decoration-line: underline" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span></p>`;
  assert.equal(compareElementScopedMutation({
    before,
    after: validAfter,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
    expectedAfterContains: [marker],
    expectedAppendedPattern: pattern,
  }).ok, true);

  for (const appended of [
    ` <span onclick="steal()" style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
    ` <span style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline;background:url(javascript:evil)" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
    ` <span style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline" class="unexpected" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
  ]) {
    const rejected = compareElementScopedMutation({
      before,
      after: `<p data-pageroot-id="${SOURCE_ID}">Original${appended}</p>`,
      sourceId: SOURCE_ID,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
      expectedAfterContains: [marker],
      expectedAppendedPattern: pattern,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.appendedShapeValid, false);
  }
});

test("newline and format oracles reject a Stable ID reused from a sibling", () => {
  const siblingId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original</p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`;
  const newlineMarker = "PRQA_NEWLINE";
  const newline = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original BEFORE<br data-pageroot-id="${siblingId}">${newlineMarker}</p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_NEWLINE,
    expectedAfterContains: [newlineMarker],
    expectedAppendedPattern: new RegExp(
      ` BEFORE<br data-pageroot-id="${siblingId}">${newlineMarker}`,
      "u",
    ),
  });
  assert.equal(newline.ok, false);
  assert.equal(newline.sourceIdentityValid, false);
  assert.equal(newline.freshStableIdsValid, false);

  const formatMarker = "PRQA_FORMAT";
  const format = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original <span style="all: unset; display: inline !important; font-weight: 700; font-style: italic; text-decoration-line: underline" data-pageroot-id="${siblingId}">${formatMarker}</span></p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
    expectedAfterContains: [formatMarker],
    expectedAppendedPattern: formattedMarkerAppendedPattern(formatMarker),
  });
  assert.equal(format.ok, false);
  assert.equal(format.sourceIdentityValid, false);
  assert.equal(format.freshStableIdsValid, false);
});
