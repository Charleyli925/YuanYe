import assert from "node:assert/strict";
import test from "node:test";

import {
  assessHtmlCandidate,
} from "../bridge/candidate-assessment.mjs";
import {
  normalizeCandidateAssessmentPolicy,
} from "../bridge/candidate-assessment-decoder.mjs";

function documentHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Scope fixture</title>
  <style id="shared-style">.card { color: red; }</style>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <main id="target">
    <h1 class="title">目标标题</h1>
    <p id="inside">目标正文</p>
  </main>
  <aside id="outside">目标外正文</aside>
  <footer id="second-target">第二目标</footer>
</body>
</html>`;
}

test("candidate assessment ignores script changes while checking document health and continuity", () => {
  const baseHtml = documentHtml();
  const related = assessHtmlCandidate({
    baseHtml,
    outputHtml: baseHtml
      .replace('<p id="inside">', '<div id="inside">')
      .replace("</p>", "</div>"),
  });
  assert.equal(related.status, "ready");
  assert.equal(related.health.completeDocument, true);

  const unrelated = assessHtmlCandidate({
    baseHtml,
    outputHtml: `<!doctype html><html><head><title>另一页</title><script id="shared-script">window.scopeFixture = 1;</script></head><body><article>全新的内容与结构</article></body></html>`,
  });
  assert.equal(unrelated.status, "attention");
  assert.deepEqual(unrelated.issueCodes, ["PAGE_CONTINUITY_UNCERTAIN"]);

  const empty = assessHtmlCandidate({
    baseHtml,
    outputHtml: `<!doctype html><html><head><title>空页</title><script id="shared-script">window.scopeFixture = 1;</script></head><body></body></html>`,
  });
  assert.equal(empty.status, "blocked");
  assert.deepEqual(empty.issueCodes, ["HTML_BODY_EMPTY"]);

  const scriptChange = assessHtmlCandidate({
    baseHtml,
    outputHtml: baseHtml.replace(
      "window.scopeFixture = 1",
      "window.scopeFixture = 2",
    ),
  });
  assert.equal(scriptChange.status, "ready");
  assert.deepEqual(scriptChange.issueCodes, []);
  assert.equal("executable" in scriptChange, false);
  assert.equal("executableSurfaceUnchanged" in scriptChange.health, false);
});

test("candidate assessment reports bounded stable-element impact", () => {
  const targetId = "pr1_00000000000040008000000000000000";
  const outsideId = "pr1_11111111111141118000000000000000";
  const baseHtml = `<!doctype html><html><head><title>Impact</title></head><body>
<main><p data-pageroot-id="${targetId}">评论目标</p></main>
<aside data-pageroot-id="${outsideId}">评论目标之外</aside>
</body></html>`;
  const outputHtml = baseHtml
    .replace("评论目标</p>", "评论目标已修改</p>")
    .replace("评论目标之外</aside>", "评论目标之外也被修改</aside>");

  const assessment = assessHtmlCandidate({
    baseHtml,
    outputHtml,
    requestedTargetElementIds: [targetId],
    requestedTargetCount: 1,
  });

  assert.equal(assessment.changedElementCount, 2);
  assert.deepEqual(assessment.changedElementIdSample, [targetId, outsideId].sort());
  assert.equal(assessment.outsideTargetCount, 1);
  assert.deepEqual(assessment.outsideTargetElementIdSample, [outsideId]);
  assert.equal(assessment.truncated, false);
  assert.equal(assessment.requestedTargetCount, 1);
});

test("candidate impact scope includes descendants, additions, deletions, page comments and overlaps", () => {
  const ids = {
    section: "pr1_00000000000040008000000000000000",
    heading: "pr1_11111111111141118000000000000000",
    paragraph: "pr1_22222222222242228000000000000000",
    outside: "pr1_33333333333343338000000000000000",
    first: "pr1_44444444444444448000000000000000",
    second: "pr1_55555555555545558000000000000000",
    added: "pr1_66666666666646668000000000000000",
  };
  const baseHtml = `<!doctype html><html><head><title>Scope</title></head><body>
<section data-pageroot-id="${ids.section}"><h2 data-pageroot-id="${ids.heading}">标题</h2><p data-pageroot-id="${ids.paragraph}">正文</p></section>
<aside data-pageroot-id="${ids.outside}">旁支</aside>
<ul><li data-pageroot-id="${ids.first}">第一项</li><li data-pageroot-id="${ids.second}">第二项</li></ul>
</body></html>`;
  const assess = (outputHtml, targets, options = {}) => assessHtmlCandidate({
    baseHtml: options.baseHtml ?? baseHtml,
    outputHtml,
    requestedTargetElementIds: targets,
    requestedTargetCount: options.requestedTargetCount ?? targets.length,
    requestedTargetIsPage: options.requestedTargetIsPage ?? false,
  });

  const descendantEdit = assess(
    baseHtml.replace(">标题</h2>", ">新标题</h2>").replace(">正文</p>", ">新正文</p>"),
    [ids.section],
  );
  assert.equal(descendantEdit.changedElementCount, 2);
  assert.equal(descendantEdit.outsideTargetCount, 0);

  const addedInside = assess(
    baseHtml.replace(
      "</section>",
      `<em data-pageroot-id="${ids.added}">新增</em></section>`,
    ),
    [ids.section],
  );
  assert.deepEqual(addedInside.changedElementIdSample, [ids.added]);
  assert.equal(addedInside.outsideTargetCount, 0);

  const deletedInside = assess(
    baseHtml.replace(
      `<p data-pageroot-id="${ids.paragraph}">正文</p>`,
      "",
    ),
    [ids.section],
  );
  assert.deepEqual(deletedInside.changedElementIdSample, [ids.paragraph]);
  assert.equal(deletedInside.outsideTargetCount, 0);

  const insertedBeforeSiblings = assess(
    baseHtml.replace(
      `<li data-pageroot-id="${ids.first}">第一项</li>`,
      `<li data-pageroot-id="${ids.added}">插入项</li><li data-pageroot-id="${ids.first}">第一项</li>`,
    ),
    [ids.first],
  );
  assert.deepEqual(insertedBeforeSiblings.changedElementIdSample, [ids.added]);
  assert.deepEqual(insertedBeforeSiblings.outsideTargetElementIdSample, [ids.added]);

  const pageComment = assess(
    baseHtml.replace(">旁支</aside>", ">旁支已改</aside>"),
    [],
    { requestedTargetCount: 1, requestedTargetIsPage: true },
  );
  assert.equal(pageComment.outsideTargetCount, 0);
  assert.equal(pageComment.requestedTargetCount, 1);

  const overlappingTargets = assess(
    baseHtml.replace(">标题</h2>", ">重叠目标标题</h2>").replace(">正文</p>", ">重叠目标正文</p>"),
    [ids.section, ids.heading],
  );
  assert.equal(overlappingTargets.outsideTargetCount, 0);

  const manyIds = Array.from({ length: 101 }, (_, index) => (
    `pr1_${String(index + 1).padStart(12, "0")}40008${String(index + 1).padStart(15, "0")}`
  ));
  const manyChangesBase = `<!doctype html><html><head><title>Many</title></head><body>${manyIds
    .map((id, index) => `<p data-pageroot-id="${id}">item-${index}</p>`)
    .join("")}</body></html>`;
  const manyChanges = assess(
    manyChangesBase.replace(/>(item-\d+)</gu, ">changed-$1<"),
    [],
    { baseHtml: manyChangesBase },
  );
  assert.equal(manyChanges.changedElementCount, 101);
  assert.equal(manyChanges.outsideTargetCount, 101);
  assert.equal(manyChanges.changedElementIdSample.length, 100);
  assert.equal(manyChanges.outsideTargetElementIdSample.length, 100);
  assert.equal(manyChanges.truncated, true);
});

test("candidate impact stays linear and bounded near the HTML size limit", () => {
  const bodyId = "pr1_4444444444444444b444444444444444";
  const elementId = (index) => (
    `pr1_${String(index).padStart(12, "0")}40008${String(index).padStart(15, "0")}`
  );
  const filler = "x".repeat(640);
  const rows = Array.from({ length: 12_000 }, (_, index) => (
    `<p data-pageroot-id="${elementId(index + 1)}" data-fixture="${filler}">row-${index}</p>`
  )).join("");
  const baseHtml = `<!doctype html><html><head><title>Large</title></head><body data-pageroot-id="${bodyId}">${rows}</body></html>`;
  const outputHtml = baseHtml.replace("row-11999", "row-11999 changed");
  assert.ok(Buffer.byteLength(baseHtml, "utf8") > 8 * 1024 * 1024);
  const startedCpu = process.cpuUsage();
  const assessment = assessHtmlCandidate({
    baseHtml,
    outputHtml,
    requestedTargetElementIds: [bodyId],
    requestedTargetCount: 1,
  });
  const elapsedCpu = process.cpuUsage(startedCpu);
  const elapsedCpuMs = (elapsedCpu.user + elapsedCpu.system) / 1_000;
  assert.equal(assessment.changedElementCount, 1);
  assert.equal(assessment.outsideTargetCount, 0);
  assert.equal(assessment.truncated, false);
  assert.ok(assessment.changedElementIdSample.length <= 100);
  assert.ok(
    elapsedCpuMs < 10_000,
    `candidate impact used ${elapsedCpuMs.toFixed(0)}ms of CPU`,
  );
});

test("candidate impact scope crosses unlabelled source wrappers", () => {
  const sectionId = "pr1_00000000000040008000000000000000";
  const childId = "pr1_11111111111141118000000000000000";
  const outsideId = "pr1_22222222222242228000000000000000";
  const baseHtml = `<!doctype html><html><head><title>Wrapper</title></head><body>
<section data-pageroot-id="${sectionId}"><div><p data-pageroot-id="${childId}">正文</p></div></section>
<aside data-pageroot-id="${outsideId}">旁支</aside>
</body></html>`;
  const outputHtml = baseHtml.replace("正文", "更新后的正文");
  const assessment = assessHtmlCandidate({
    baseHtml,
    outputHtml,
    requestedTargetElementIds: [sectionId],
    requestedTargetCount: 1,
  });

  assert.deepEqual(assessment.changedElementIdSample, [childId]);
  assert.equal(assessment.outsideTargetCount, 0);
});

test("current candidate policy does not interpret retired executable-surface fields", () => {
  const current = assessHtmlCandidate({
    baseHtml: documentHtml(),
    outputHtml: documentHtml().replace(
      "window.scopeFixture = 1",
      "window.scopeFixture = 2",
    ),
  });
  const legacy = {
    ...current,
    status: "blocked",
    issueCodes: ["EXECUTABLE_CONTENT_CHANGED"],
    health: {
      ...current.health,
      executableSurfaceUnchanged: false,
    },
    executable: {
      unchanged: false,
      baseCount: 1,
      outputCount: 1,
      changedCount: 1,
    },
  };

  const normalized = normalizeCandidateAssessmentPolicy(legacy);
  assert.equal(normalized.status, "blocked");
  assert.deepEqual(normalized.issueCodes, ["EXECUTABLE_CONTENT_CHANGED"]);
  assert.equal("executable" in normalized, true);
  assert.equal(normalized.health.completeDocument, current.health.completeDocument);
  assert.equal("executableSurfaceUnchanged" in normalized.health, false);

  const currentRecordWithUnexpectedConclusion = {
    ...current,
    status: "blocked",
    issueCodes: ["UNEXPECTED_CONCLUSION"],
  };
  assert.deepEqual(
    normalizeCandidateAssessmentPolicy(currentRecordWithUnexpectedConclusion),
    {
      ...currentRecordWithUnexpectedConclusion,
      health: {
        completeDocument: current.health.completeDocument,
        bodyHasContent: current.health.bodyHasContent,
      },
    },
  );
});
