import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadPaintPlan() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/review-paint-plan.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "review-paint-plan.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`
  );
}

const { buildReviewPaintPlan, eligibleReviewVisualEvidence, EMPTY_REVIEW_PAINT_PLAN } = await loadPaintPlan();

function focusGroup(policy, regions = {
  before: [{ id: "region-before-1", changeIds: ["change-1"], visualEvidenceStableIds: ["stable-1"] }],
  after: [{ id: "region-after-1", changeIds: ["change-1"], visualEvidenceStableIds: ["stable-1"] }],
}) {
  return {
    id: "focus-change-1",
    changeIds: [...new Set(Object.values(regions).flatMap((side) => (
      side.flatMap((region) => region.changeIds)
    )))],
    focusOutlinePolicy: policy,
    regions,
  };
}

const changes = [
  { id: "change-1", evidenceStableIds: ["stable-1"] },
  { id: "change-2", evidenceStableIds: ["stable-2"] },
];
const visualEvidence = [
  { stableId: "stable-1", kinds: ["style"] },
  { stableId: "stable-2", kinds: ["style"] },
];
const selection = {
  before: "region-before-1",
  after: "region-after-1",
};

test("overview paints source evidence and navigation only, with no mask or outline", () => {
  assert.equal(buildReviewPaintPlan({
    focusGroups: [focusGroup("source-change")],
    changes,
    visualEvidence,
    visualVerdicts: { "stable-1": "changed" },
    activeFocusGroupId: null,
    activeFocusRegionIds: selection,
  }), EMPTY_REVIEW_PAINT_PLAN);
});

test("text focus keeps context mask but never invents a rectangle", () => {
  const plan = buildReviewPaintPlan({
    focusGroups: [focusGroup("never")],
    changes,
    visualEvidence,
    visualVerdicts: { "stable-1": "changed" },
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: selection,
  });
  assert.deepEqual(plan.before.contextMask, { regionId: "region-before-1" });
  assert.equal(plan.before.focusOutline, null);
  assert.deepEqual(plan.after.contextMask, { regionId: "region-after-1" });
  assert.equal(plan.after.focusOutline, null);
});

test("source outlines are explicit while visual outlines require a confirmed visual verdict", () => {
  const sourcePlan = buildReviewPaintPlan({
    focusGroups: [focusGroup("source-change")],
    changes,
    visualEvidence,
    visualVerdicts: {},
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: selection,
  });
  assert.deepEqual(sourcePlan.before.focusOutline, { regionId: "region-before-1" });

  const unresolvedVisualPlan = buildReviewPaintPlan({
    focusGroups: [focusGroup("visual-change")],
    changes,
    visualEvidence,
    visualVerdicts: { "stable-1": "unchanged" },
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: selection,
  });
  assert.equal(unresolvedVisualPlan.before.focusOutline, null);

  const changedVisualPlan = buildReviewPaintPlan({
    focusGroups: [focusGroup("visual-change")],
    changes,
    visualEvidence,
    visualVerdicts: { "stable-1": "changed" },
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: selection,
  });
  assert.deepEqual(changedVisualPlan.after.focusOutline, { regionId: "region-after-1" });
});

test("a stale side-local region fails closed without affecting the paired side", () => {
  const plan = buildReviewPaintPlan({
    focusGroups: [focusGroup("source-change")],
    changes,
    visualEvidence,
    visualVerdicts: {},
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: { before: "region-after-1", after: "region-after-1" },
  });
  assert.equal(plan.before.contextMask, null);
  assert.equal(plan.before.focusOutline, null);
  assert.deepEqual(plan.after.contextMask, { regionId: "region-after-1" });
});

test("a selected style region cannot borrow a changed verdict from another region", () => {
  const regions = {
    before: [
      { id: "region-before-a", changeIds: ["change-1"], visualEvidenceStableIds: ["stable-1"] },
      { id: "region-before-b", changeIds: ["change-2"], visualEvidenceStableIds: ["stable-2"] },
    ],
    after: [
      { id: "region-after-a", changeIds: ["change-1"], visualEvidenceStableIds: ["stable-1"] },
      { id: "region-after-b", changeIds: ["change-2"], visualEvidenceStableIds: ["stable-2"] },
    ],
  };
  for (const bVerdict of ["unchanged", "unverified"]) {
    const plan = buildReviewPaintPlan({
      focusGroups: [focusGroup("visual-change", regions)],
      changes,
      visualEvidence,
      visualVerdicts: { "stable-1": "changed", "stable-2": bVerdict },
      activeFocusGroupId: "focus-change-1",
      activeFocusRegionIds: { before: "region-before-b", after: "region-after-b" },
    });
    assert.deepEqual(plan.before.contextMask, { regionId: "region-before-b" });
    assert.equal(plan.before.focusOutline, null, `B=${bVerdict} must remain frameless`);
    assert.equal(plan.after.focusOutline, null, `B=${bVerdict} must remain frameless`);
  }
});

test("mixed source evidence cannot prove a region-local style outline", () => {
  const plan = buildReviewPaintPlan({
    focusGroups: [focusGroup("visual-change")],
    changes,
    visualEvidence: [{ stableId: "stable-1", kinds: ["style", "text"] }],
    visualVerdicts: { "stable-1": "changed" },
    activeFocusGroupId: "focus-change-1",
    activeFocusRegionIds: selection,
  });
  assert.deepEqual(plan.before.contextMask, { regionId: "region-before-1" });
  assert.equal(plan.before.focusOutline, null);
});


test("observation candidates are the region/change intersection of pure style evidence", () => {
  const evidence = [
    { stableId: "style-used", kinds: ["style"] },
    { stableId: "style-region-only", kinds: ["style"] },
    { stableId: "style-change-only", kinds: ["style"] },
    { stableId: "style-orphan", kinds: ["style"] },
    { stableId: "mixed", kinds: ["style", "text"] },
    { stableId: "move", kinds: ["moved"] },
    { stableId: "attribute", kinds: ["attribute"] },
  ];
  const group = focusGroup("visual-change", {
    before: [{ id: "before", changeIds: ["a"], visualEvidenceStableIds: ["style-used", "style-region-only", "mixed", "move", "attribute"] }],
    after: [{ id: "after", changeIds: ["a"], visualEvidenceStableIds: ["style-used"] }],
  });
  const facts = [{ id: "a", evidenceStableIds: ["style-used", "style-change-only", "mixed", "move", "attribute"] }];
  const result = eligibleReviewVisualEvidence({ focusGroups: [group], changes: facts, visualEvidence: evidence });
  assert.deepEqual(result, [evidence[0]]);
  assert.equal(result[0], evidence[0], "the plan reuses source evidence without creating new facts");
});

for (const [label, groups, evidence] of [
  ["text", [focusGroup("never")], [{ stableId: "stable-1", kinds: ["text"] }]],
  ["structure", [focusGroup("source-change")], [{ stableId: "stable-1", kinds: ["added"] }]],
  ["large-container policy never", [focusGroup("never")], visualEvidence],
  ["mixed style and text", [focusGroup("visual-change")], [{ stableId: "stable-1", kinds: ["style", "text"] }]],
  ["mixed style and attributes", [focusGroup("visual-change")], [{ stableId: "stable-1", kinds: ["style", "attribute"] }]],
  ["empty facts", [], visualEvidence],
]) {
  test(`${label} creates no optional-outline observation candidates`, () => {
    assert.deepEqual(eligibleReviewVisualEvidence({ focusGroups: groups, changes, visualEvidence: evidence }), []);
  });
}

test("a change in another region cannot authorize observation and a one-sided locality can", () => {
  const group = focusGroup("visual-change", {
    before: [{ id: "before", changeIds: ["change-2"], visualEvidenceStableIds: ["stable-1"] }],
    after: [{ id: "after", changeIds: ["change-1"], visualEvidenceStableIds: ["stable-1"] }],
  });
  assert.deepEqual(eligibleReviewVisualEvidence({ focusGroups: [group], changes, visualEvidence }), [visualEvidence[0]]);
  assert.deepEqual(eligibleReviewVisualEvidence({
    focusGroups: [{ ...group, regions: { ...group.regions, after: [] } }],
    changes,
    visualEvidence,
  }), []);
});
