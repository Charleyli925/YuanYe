import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  annotateGatePlan,
  assertFullyAutomatedPlan,
  assertGateWidthPolicy,
  compactGatePlan,
  GATE_WIDTH_LIMITS,
  omitMissingNodeTests,
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";
import {
  assertCapabilityContextMap,
  loadCapabilityContextMap,
  mergeRequiredDocSections,
  selectCapabilityContext,
} from "../scripts/capability-context.mjs";
import {
  assembleGateCapabilityPlan,
  coalesceRuntimeSuites,
  parseArguments as parseGateArguments,
} from "../scripts/test-gate.mjs";
import { CI_HEALTH_WORKFLOW_INPUTS } from "../scripts/ci-health-report.mjs";
import { nodeTestGroups } from "../scripts/test-node-group.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));

function suiteIds(plan) {
  return plan.suites.map(({ id }) => id);
}

const TASK_OWNER_CASES = [
  {
    file: "app/lib/comment-rail-layout.js",
    nodeTests: ["tests/comment-rail-layout.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted", "build-web", "browser-comments-smoke"],
    directOwners: ["tests/comment-rail-layout.test.mjs"],
    unrelatedOwners: ["tests/application-update.test.mjs", "tests/notification-policy.test.mjs"],
  },
  {
    file: "app/components/html-canvas-pointer-capability.ts",
    nodeTests: [
      "tests/canvas-pointer-capability.test.mjs",
      "tests/html-canvas-capability-hover.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-web", "browser-editing-smoke"],
    directOwners: ["tests/canvas-pointer-capability.test.mjs"],
    unrelatedOwners: [
      "tests/editable-island.test.mjs",
      "tests/html-preview-sandbox.test.mjs",
    ],
  },
  {
    file: "app/components/html-canvas-frame.js",
    nodeTests: [
      "tests/edit-runtime-contract.test.mjs",
      "tests/html-canvas-frame.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "electron-editing-smoke"],
    directOwners: ["tests/html-canvas-frame.test.mjs"],
    unrelatedOwners: [
      "tests/editable-island.test.mjs",
      "tests/html-preview-sandbox.test.mjs",
    ],
  },
  {
    file: "app/components/html-canvas-native-commands.js",
    nodeTests: [
      "tests/editable-island.test.mjs",
      "tests/html-canvas-native-commands.test.mjs",
      "tests/native-layout-guard.test.mjs",
    ],
    suites: [
      "typecheck",
      "lint",
      "node-targeted",
      "build-web",
      "browser-editing-smoke",
      "build-desktop",
      "electron-editing-smoke",
    ],
    directOwners: ["tests/html-canvas-native-commands.test.mjs"],
    unrelatedOwners: [
      "tests/html-preview-sandbox.test.mjs",
    ],
  },
  {
    file: "app/workbench/review-document.ts",
    nodeTests: [
      "tests/review-analysis-session.test.mjs",
      "tests/review-badge-aggregation.test.mjs",
      "tests/review-projection-facts.test.mjs",
    ],
    suites: [
      "typecheck",
      "lint",
      "node-targeted",
      "build-web",
      "browser-review-smoke",
      "build-desktop",
      "ai-review-smoke",
    ],
    directOwners: [
      "tests/review-analysis-session.test.mjs",
      "tests/review-badge-aggregation.test.mjs",
      "tests/review-projection-facts.test.mjs",
    ],
    unrelatedOwners: [
      "tests/desktop-package.test.mjs",
      "tests/desktop-preload-ipc.test.mjs",
      "tests/notification-policy.test.mjs",
      "tests/review-text-diff.test.mjs",
    ],
  },
  {
    file: "app/workbench/review/parse.ts",
    nodeTests: [
      "tests/review-badge-aggregation.test.mjs",
      "tests/review-projection-facts.test.mjs",
    ],
    suites: [
      "typecheck",
      "lint",
      "node-targeted",
      "build-web",
      "browser-review-smoke",
      "build-desktop",
      "ai-review-smoke",
    ],
    directOwners: ["tests/review-badge-aggregation.test.mjs", "tests/review-projection-facts.test.mjs"],
    unrelatedOwners: [
      "tests/desktop-package.test.mjs",
      "tests/desktop-preload-ipc.test.mjs",
      "tests/notification-policy.test.mjs",
      "tests/review-text-diff.test.mjs",
    ],
  },
  {
    file: "app/components/NoticeBar.tsx",
    nodeTests: ["tests/notification-policy.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted", "build-web", "browser-comments-smoke"],
    directOwners: ["tests/notification-policy.test.mjs"],
    unrelatedOwners: ["tests/architecture-boundaries.test.mjs", "tests/html-preview-sandbox.test.mjs"],
  },
  {
    file: "app/application/comment-session.js",
    nodeTests: ["tests/comment-session.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted"],
    directOwners: ["tests/comment-session.test.mjs"],
    unrelatedOwners: [
      "tests/draft-session.test.mjs",
      "tests/project-session.test.mjs",
      "tests/run-session.test.mjs",
      "tests/version-session.test.mjs",
    ],
  },
  {
    file: "app/globals.css",
    nodeTests: ["tests/workbench-css.test.mjs"],
    suites: ["typecheck", "node-targeted", "build-web", "browser-editing-smoke"],
    directOwners: ["tests/workbench-css.test.mjs"],
    unrelatedOwners: ["tests/application-update.test.mjs", "tests/notification-policy.test.mjs"],
  },
  {
    file: "desktop/application-update.mjs",
    nodeTests: ["tests/application-update.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "electron-editing-smoke"],
    directOwners: ["tests/application-update.test.mjs"],
    unrelatedOwners: [
      "tests/desktop-file-writer.test.mjs",
      "tests/desktop-package.test.mjs",
    ],
  },
  {
    file: "bridge/workspace-bridge.mjs",
    nodeTests: [
      "tests/attachment-storage.test.mjs",
      "tests/compatibility-decoders.test.mjs",
      "tests/conversation-bridge.test.mjs",
      "tests/html-source-parser.test.mjs",
      "tests/lifecycle-core.test.mjs",
      "tests/product-contract.test.mjs",
      "tests/project-file-bridge.test.mjs",
      "tests/targeted-change-schema.test.mjs",
      "tests/user-supplement.test.mjs",
      "tests/workspace-bridge.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "ai-run-lifecycle-smoke"],
    directOwners: ["tests/workspace-bridge.test.mjs"],
    unrelatedOwners: ["tests/desktop-package.test.mjs", "tests/application-update.test.mjs"],
  },
  {
    file: "bridge/candidate-assessment.mjs",
    nodeTests: [
      "tests/ai-candidate-identity-contract.test.mjs",
      "tests/candidate-assessment.test.mjs",
      "tests/candidate-source-identity.test.mjs",
      "tests/project-candidate-promotion.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "ai-review-smoke"],
    directOwners: ["tests/candidate-assessment.test.mjs"],
    unrelatedOwners: ["tests/project-request-authority.test.mjs", "tests/application-update.test.mjs"],
  },
  {
    file: "bridge/project-file-repository.mjs",
    nodeTests: [
      "tests/durable-working-copy-binding.test.mjs",
      "tests/history-creation.test.mjs",
      "tests/project-ai-task-projection.test.mjs",
      "tests/project-candidate-promotion.test.mjs",
      "tests/project-catalog-readonly.test.mjs",
      "tests/project-file-bridge.test.mjs",
      "tests/project-file-finalizer.test.mjs",
      "tests/project-file-repository.integration.test.mjs",
      "tests/project-file-schema.test.mjs",
      "tests/project-path-security-and-locks.test.mjs",
      "tests/project-registry-and-open.test.mjs",
      "tests/project-request-authority.test.mjs",
      "tests/project-working-copy-save.test.mjs",
      "tests/save-retirement.test.mjs",
      "tests/source-element-identity-migration.test.mjs",
      "tests/workspace-performance-timing.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "ai-review-smoke"],
    directOwners: ["tests/project-registry-and-open.test.mjs"],
    unrelatedOwners: ["tests/desktop-package.test.mjs", "tests/application-update.test.mjs"],
  },
  {
    file: "bridge/project-file-repository/path-safety.mjs",
    nodeTests: [
      "tests/project-path-security-and-locks.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted"],
    directOwners: ["tests/project-path-security-and-locks.test.mjs"],
    unrelatedOwners: [
      "tests/desktop-package.test.mjs",
      "tests/project-registry-and-open.test.mjs",
    ],
  },
  {
    file: "tests/helpers/bridge-test-environment.mjs",
    nodeTests: [
      "tests/bridge-test-environment.test.mjs",
      "tests/schema-contract.test.mjs",
      "tests/workspace-bridge.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted"],
    directOwners: ["tests/bridge-test-environment.test.mjs"],
    unrelatedOwners: ["tests/desktop-package.test.mjs", "tests/application-update.test.mjs"],
  },
];

test("edit and task gates select deterministic impact-based coverage", () => {
  const changedFiles = ["app/lib/source-patch-engine.js"];
  const edit = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "edit", changedFiles }));
  const task = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "task", changedFiles }));

  assert.deepEqual(suiteIds(edit), ["typecheck", "node-targeted"]);
  assert.ok(edit.selectedNodeTests.includes("tests/source-patch-engine.test.mjs"));
  assert.ok(edit.selectedNodeTests.includes("tests/generated-source-invariants.test.mjs"));
  assert.deepEqual(suiteIds(task), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-web",
    "browser-editing-smoke",
    "build-desktop",
    "electron-editing-smoke",
  ]);
});

test("a changed Node test runs itself without expanding to the full Node suite", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/source-text-map.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/source-text-map.test.mjs"]);
});

test("deleted Node tests are omitted from the executable plan", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: [
      "tests/source-text-map.test.mjs",
      "tests/runtime-dom-source-map.test.mjs",
    ],
  });
  assert.ok(plan.selectedNodeTests.includes("tests/runtime-dom-source-map.test.mjs"));
  const executable = omitMissingNodeTests(
    plan,
    (file) => file !== "tests/runtime-dom-source-map.test.mjs",
  );
  assert.equal(
    executable.selectedNodeTests.includes("tests/runtime-dom-source-map.test.mjs"),
    false,
  );
  assert.ok(executable.selectedNodeTests.includes("tests/source-text-map.test.mjs"));
  assert.deepEqual(suiteIds(executable), ["node-targeted"]);
});

test("a changed owned Node test still runs only itself", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/comment-session.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/comment-session.test.mjs"]);
});

test("owner rules select only the direct regression coverage for representative files", () => {
  let totalNodeTests = 0;
  for (const ownerCase of TASK_OWNER_CASES) {
    const plan = assertFullyAutomatedPlan(selectGatePlan({
      map,
      lane: "task",
      changedFiles: [ownerCase.file],
    }));
    assert.deepEqual(plan.selectedNodeTests, ownerCase.nodeTests, ownerCase.file);
    assert.deepEqual(suiteIds(plan), ownerCase.suites, ownerCase.file);
    for (const owner of ownerCase.directOwners) {
      assert.ok(plan.selectedNodeTests.includes(owner), `${ownerCase.file} must keep ${owner}`);
    }
    for (const owner of ownerCase.unrelatedOwners) {
      assert.equal(plan.selectedNodeTests.includes(owner), false, `${ownerCase.file} must omit ${owner}`);
    }
    totalNodeTests += plan.selectedNodeTests.length;
  }
  assert.ok(totalNodeTests <= 70, `representative ownership selected ${totalNodeTests} Node tests`);
});

test("Candidate runtime seals map schema changes to every producer and boundary consumer", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["schemas/project-runtime-state.v4.schema.json"],
  });
  for (const owner of [
    "tests/project-registry-and-open.test.mjs",
    "tests/project-working-copy-save.test.mjs",
    "tests/project-candidate-promotion.test.mjs",
    "tests/project-request-authority.test.mjs",
    "tests/project-ai-task-projection.test.mjs",
    "tests/project-path-security-and-locks.test.mjs",
    "tests/project-file-repository.integration.test.mjs",
    "tests/project-file-finalizer.test.mjs",
    "tests/project-file-bridge.test.mjs",
    "tests/project-file-schema.test.mjs",
    "tests/bridge-test-environment.test.mjs",
    "tests/electron-app-fixture.test.mjs",
    "tests/desktop-preload-ipc.test.mjs",
    "tests/desktop-package.test.mjs",
  ]) {
    assert.ok(plan.selectedNodeTests.includes(owner), owner);
  }
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "electron-project-lifecycle-smoke",
    "ai-review-smoke",
  ]);
});

test("Bridge fixture changes select the helper and its schema, scope, and workspace owners", () => {
  const expected = [
    "tests/bridge-test-environment.test.mjs",
    "tests/schema-contract.test.mjs",
    "tests/workspace-bridge.test.mjs",
  ];
  for (const file of [
    "tests/helpers/bridge-test-environment.mjs",
    "tests/helpers/ai-attempt-fixture.mjs",
  ]) {
    const plan = selectGatePlan({ map, lane: "edit", changedFiles: [file] });
    assert.deepEqual(plan.selectedNodeTests, expected, file);
    assert.deepEqual(suiteIds(plan), ["node-targeted"], file);
  }
});

test("unmapped code still falls back to the core Node group", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["app/unmapped-owner.ts"],
  });
  assert.deepEqual(suiteIds(plan), ["node-core"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("unmapped production code keeps fallback coverage beside mapped owners", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: [
      "app/lib/source-patch-engine.js",
      "app/unmapped-owner.ts",
    ],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "node-targeted", "node-core"]);
  assert.ok(plan.selectedNodeTests.includes("tests/source-patch-engine.test.mjs"));
  assert.ok(
    plan.suites.find(({ id }) => id === "node-core")?.reasons.includes(
      "unmapped code fallback: app/unmapped-owner.ts",
    ),
  );
});

test("Draft runs HtmlCanvasEditor canaries while edit stays Node-only", () => {
  const edit = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["app/components/HtmlCanvasEditor.tsx"],
  });
  assert.deepEqual(suiteIds(edit), ["typecheck", "node-targeted"]);
  assert.ok(edit.selectedNodeTests.includes("tests/seeded-fault-oracles.test.mjs"));
  assert.ok(edit.selectedNodeTests.includes("tests/runtime-continuity-probe.test.mjs"));
  assert.ok(edit.selectedNodeTests.length <= GATE_WIDTH_LIMITS.leafFileNodeTests);
  assert.deepEqual(edit.matchedOwners, ["runtime-continuity"]);

  const draft = selectGatePlan({
    map,
    lane: "draft",
    changedFiles: ["app/components/HtmlCanvasEditor.tsx"],
  });
  assert.deepEqual(suiteIds(draft), [
    "typecheck",
    "node-targeted",
    "build-web",
    "browser-editing-smoke",
    "build-desktop",
    "electron-editing-smoke",
  ]);
});

test("a changed Playwright spec selects itself on Draft", () => {
  const plan = selectGatePlan({
    map,
    lane: "draft",
    changedFiles: ["tests/e2e/browser/native-dom-boundaries.spec.mjs"],
  });
  assert.ok(suiteIds(plan).includes("browser-changed-specs"));
  assert.ok(suiteIds(plan).includes("browser-editing-smoke"));
  assert.deepEqual(plan.selectedChangedSpecs["browser-changed-specs"], [
    "tests/e2e/browser/native-dom-boundaries.spec.mjs",
  ]);
});

test("Draft runtime suites coalesce tags and changed specs into one execution", () => {
  const plan = selectGatePlan({
    map,
    lane: "draft",
    changedFiles: [
      "app/components/HtmlCanvasEditor.tsx",
      "tests/e2e/electron/electron-workbench-tabs.spec.mjs",
    ],
  });
  const execution = coalesceRuntimeSuites(plan.suites, plan, "/tmp/pageroot-test-plan");
  const electron = execution.find(({ id }) => id === "electron-selected-tests");
  assert.ok(electron);
  assert.ok(electron.sourceSuites.includes("electron-editing-smoke"));
  assert.ok(electron.sourceSuites.includes("electron-smoke"));
  assert.ok(electron.sourceSuites.includes("electron-changed-specs"));
  assert.deepEqual(electron.runtimeSelection.tags, [
    "@gate-smoke",
    "@smoke-editing",
  ]);
  assert.deepEqual(electron.runtimeSelection.files, [
    "tests/e2e/electron/electron-workbench-tabs.spec.mjs",
  ]);
  assert.equal(execution.filter(({ id }) => id.startsWith("electron-")).length, 1);
});

test("version workflow changes retain candidate, history, Canvas and AI coverage", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["app/application/version-workflow.js"],
  });
  assert.deepEqual(plan.selectedNodeTests, [
    "tests/run-session.test.mjs",
    "tests/version-review-plan.test.mjs",
    "tests/version-session.test.mjs",
    "tests/version-workflow.test.mjs",
  ]);
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "ai-review-smoke",
  ]);
});

test("delivery contracts select their direct package, verifier and release-architecture owners", () => {
  const packageManifest = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["package.json"],
  });
  assert.deepEqual(packageManifest.selectedNodeTests, [
    "tests/dependency-audit-policy.test.mjs",
    "tests/desktop-package.test.mjs",
    "tests/packaged-artifact-gate.test.mjs",
    "tests/source-history-retirement.test.mjs",
  ]);

  const verifier = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["scripts/verify-packaged-artifact.mjs"],
  });
  assert.deepEqual(verifier.selectedNodeTests, [
    "tests/desktop-package.test.mjs",
    "tests/packaged-artifact-gate.test.mjs",
  ]);

  const releaseWorkflow = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: [".github/workflows/release-candidate.yml"],
  });
  for (const owner of [
    "tests/package-delivery-report.test.mjs",
    "tests/release-app-stage.test.mjs",
    "tests/release-candidate-provenance.test.mjs",
    "tests/source-gate-provenance.test.mjs",
  ]) {
    assert.ok(releaseWorkflow.selectedNodeTests.includes(owner));
  }
  assert.equal(
    releaseWorkflow.selectedNodeTests.includes("tests/desktop-package.test.mjs"),
    false,
  );

  const updateController = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["desktop/application-update.mjs"],
  });
  assert.deepEqual(updateController.selectedNodeTests, [
    "tests/application-update.test.mjs",
  ]);
});

test("shared release evidence fixtures select every direct consumer and their own freshness contract", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/helpers/release-evidence-fixtures.mjs"],
  });
  assert.deepEqual(plan.selectedNodeTests, [
    "tests/developer-preview-package.test.mjs",
    "tests/packaged-artifact-gate.test.mjs",
    "tests/release-app-stage.test.mjs",
    "tests/release-candidate-provenance.test.mjs",
    "tests/release-evidence-fixtures.test.mjs",
    "tests/release-provenance.test.mjs",
    "tests/source-gate-provenance.test.mjs",
  ]);
});

test("the one rendered Node test schedules its production build before the targeted test", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/rendered-html.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["build-web", "node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/rendered-html.test.mjs"]);
});

test("Workbench and review surfaces route to architecture or observable runtime owners", () => {
  const workbench = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["app/workbench.tsx"],
  });
  assert.deepEqual(workbench.selectedNodeTests, [
    "tests/comment-rail-contract.test.mjs",
    "tests/desktop-preload-ipc.test.mjs",
    "tests/edit-author-runtime-session.test.mjs",
    "tests/edit-runtime-bootstrap.test.mjs",
    "tests/edit-runtime-contract.test.mjs",
    "tests/edit-runtime-library-store.test.mjs",
    "tests/edit-runtime-preparation-fence.test.mjs",
    "tests/edit-runtime-protocol.test.mjs",
    "tests/html-canvas-frame.test.mjs",
    "tests/html-canvas-runtime-startup.test.mjs",
    "tests/html-preview-sandbox.test.mjs",
    "tests/project-rules-workflow.test.mjs",
    "tests/project-workflow.test.mjs",
    "tests/source-rename.test.mjs",
    "tests/workspace-controller.test.mjs",
  ]);
  assert.deepEqual(suiteIds(workbench), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-web",
    "browser-editing-smoke",
    "build-desktop",
    "electron-editing-smoke",
    "ai-review-smoke",
  ]);

  const reviewUi = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["app/workbench/AiReviewWorkspace.tsx"],
  });
  assert.deepEqual(reviewUi.selectedNodeTests, []);
  assert.deepEqual(suiteIds(reviewUi), [
    "typecheck",
    "lint",
    "build-desktop",
    "ai-review-smoke",
  ]);

  const reviewFocusState = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["app/workbench/review-state.ts"],
  });
  assert.deepEqual(reviewFocusState.selectedNodeTests, ["tests/review-state.test.mjs"]);
  assert.deepEqual(suiteIds(reviewFocusState), ["typecheck", "lint", "node-targeted"]);

  const commentRail = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["app/workbench/comment-rail-view.tsx"],
  });
  assert.deepEqual(commentRail.selectedNodeTests, [
    "tests/comment-rail-contract.test.mjs",
    "tests/project-rules-workflow.test.mjs",
    "tests/project-workflow.test.mjs",
    "tests/source-rename.test.mjs",
  ]);
  assert.ok(suiteIds(commentRail).includes("browser-editing-smoke"));
  assert.ok(suiteIds(commentRail).includes("electron-editing-smoke"));
  assert.ok(suiteIds(commentRail).includes("ai-review-smoke"));

  const bootstrap = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/helpers/generated-review-bootstrap.mjs"],
  });
  assert.deepEqual(bootstrap.selectedNodeTests, []);
  assert.deepEqual(suiteIds(bootstrap), [
    "typecheck",
    "lint",
    "build-web",
    "browser-review-smoke",
  ]);
});

test("documentation-only changes produce an explicit no-test plan", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["README.md", "tests/TEST_STRATEGY.md"],
  });
  assert.deepEqual(plan.suites, []);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("every CI Health workflow input selects its ownership coverage", () => {
  for (const workflow of Object.values(CI_HEALTH_WORKFLOW_INPUTS)) {
    const plan = selectGatePlan({
      map,
      lane: "edit",
      changedFiles: [`.github/workflows/${workflow}`],
    });
    assert.ok(
      plan.selectedNodeTests.includes("tests/ci-health-report.test.mjs"),
      `${workflow} must select CI Health contract coverage`,
    );
  }
});

test("real-HTML gate changes run the discovery oracle instead of an unrelated smoke subset", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/browser/real-complex-html.gate.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint", "build-web", "real-html"]);
});

test("the shared fixture driver schedules both browser and Electron smoke", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/browser/pageroot-driver.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "build-web",
    "browser-editing-smoke",
    "build-desktop",
    "electron-editing-smoke",
  ]);
});

test("the shared Electron app fixture schedules Native and AI smoke with its cleanup contract", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/electron/helpers/pageroot-app-fixture.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "electron-editing-smoke",
    "ai-review-smoke",
  ]);
  assert.ok(plan.selectedNodeTests.includes("tests/electron-app-fixture.test.mjs"));
  assert.ok(plan.selectedNodeTests.includes("tests/electron-window-policy.test.mjs"));
});

test("the Electron app fixture contract test selects itself without a desktop launch", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/electron-app-fixture.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/electron-app-fixture.test.mjs"]);
});

test("packaged-runtime test changes wait for the artifact boundary instead of running unrelated Electron smoke", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/electron/packaged-runtime-smoke.spec.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("developer-preview startup changes also stay outside the ordinary Electron smoke lane", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: [
      "tests/e2e/electron/packaged-startup-smoke.spec.mjs",
      "tests/e2e/electron/playwright.packaged-startup.config.mjs",
    ],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("desktop handoff changes select Electron and deterministic AI closed-loop coverage", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["desktop/qoder-handoff.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "electron-agent-smoke",
    "ai-review-smoke",
  ]);
  assert.ok(plan.selectedNodeTests.includes("tests/qoder-handoff.test.mjs"));
});

test("Qoder ACP transport changes select Qoder and ACP owners without the package-closure suite", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["bridge/qoder-acp-client.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "ai-provider-smoke",
  ]);
  assert.deepEqual(plan.selectedNodeTests, [
    "tests/agent-provider-contract.test.mjs",
    "tests/qoder-acp-spike-client.test.mjs",
  ]);
  assert.equal(plan.selectedNodeTests.includes("tests/desktop-package.test.mjs"), false);
});

test("notification, comment, and presentation Browser owners select their smoke lane", () => {
  const cases = [
    ["tests/e2e/browser/native-dom-notification-recovery.spec.mjs", "browser-comments-smoke"],
    ["tests/e2e/browser/native-dom-comment-tabs.spec.mjs", "browser-comments-smoke"],
    ["tests/e2e/browser/native-dom-presentation-actions.spec.mjs", "browser-editing-smoke"],
  ];
  for (const [file, canary] of cases) {
    const plan = selectGatePlan({ map, lane: "task", changedFiles: [file] });
    assert.deepEqual(
      suiteIds(plan),
      ["typecheck", "lint", "build-web", "browser-changed-specs", canary],
      file,
    );
    assert.deepEqual(plan.selectedNodeTests, [], file);
  }
});

test("release and artifact lanes use complete automated coverage and never smoke aliases", () => {
  const release = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "release" }));
  assert.deepEqual(suiteIds(release), [
    "typecheck",
    "lint",
    "dependency-audit",
    "build-web",
    "node-full",
    "browser-full",
    "real-html",
    "build-desktop",
    "electron-full",
    "ai-closed-loop",
  ]);
  assert.equal(suiteIds(release).some((id) => id.endsWith("-smoke")), false);

  const artifact = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "artifact" }));
  assert.deepEqual(suiteIds(artifact).slice(-4), [
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
  assert.equal(
    artifact.suites.some((suite) => /manual|human|人工|真人|手工|checklist/iu.test(
      `${suite.id} ${suite.description}`,
    )),
    false,
  );

  const main = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "main" }));
  assert.deepEqual(suiteIds(main), [
    "node-smoke",
    "build-web",
    "browser-smoke",
  ]);

});

test("developer package is opt-in, lightweight and verifies contents before startup", () => {
  const developerPackage = assertFullyAutomatedPlan(
    selectGatePlan({ map, lane: "developer-package" }),
  );
  assert.deepEqual(suiteIds(developerPackage), [
    "build-desktop",
    "developer-package-build",
    "developer-packaged-verify",
    "developer-packaged-startup",
    "developer-package-report",
  ]);
  for (const formalLane of ["release", "artifact"]) {
    const formal = selectGatePlan({ map, lane: formalLane });
    assert.equal(
      suiteIds(formal).some((id) => id.startsWith("developer-")),
      false,
      `${formalLane} must not trigger the optional developer package`,
    );
  }
});

test("formal candidate app proves contents and runtime before signing stages can begin", () => {
  const candidateApp = assertFullyAutomatedPlan(
    selectGatePlan({ map, lane: "candidate-app" }),
  );
  assert.deepEqual(suiteIds(candidateApp), [
    "build-desktop",
    "candidate-app-build",
    "candidate-app-verify",
    "candidate-app-runtime",
  ]);
});

test("Node groups partition every top-level test exactly once outside full", async () => {
  const groups = await nodeTestGroups(path.join(productRoot, "tests"));
  const relative = (file) => path.basename(file);
  const categorized = [
    ...groups.core,
    ...groups.contract,
    ...groups.integration,
    ...groups.package,
  ].map(relative);
  assert.equal(new Set(categorized).size, categorized.length);
  assert.deepEqual([...new Set(categorized)].sort(), groups.full.map(relative).sort());
  assert.deepEqual(groups.contract.map(relative), [
    "adr-index.test.mjs",
    "architecture-boundaries.test.mjs",
    "semantic-identity-architecture-contract.test.mjs",
    "stable-id-review-contract.test.mjs",
  ]);
  assert.ok(groups.core.some((file) => file.endsWith("notification-policy.test.mjs")));
  assert.equal(
    groups.contract.some((file) => /(?:notification-ui|workbench-shell-ux)\.test\.mjs$/u.test(file)),
    false,
  );
  assert.ok(groups.package.some((file) => file.endsWith("packaged-artifact-gate.test.mjs")));
  assert.deepEqual(
    groups.smoke.map(relative).sort(),
    [
      "product-contract.test.mjs",
      "source-patch-engine.test.mjs",
    ],
  );
});

test("ordinary production files do not rerun architecture-boundaries Node tests", () => {
  for (const file of [
    "app/application/version-workflow.js",
    "app/application/workspace-controller.js",
    "app/components/HtmlCanvasEditor.tsx",
  ]) {
    const plan = selectGatePlan({ map, lane: "edit", changedFiles: [file] });
    assert.equal(
      plan.selectedNodeTests.includes("tests/architecture-boundaries.test.mjs"),
      false,
      file,
    );
  }
  const architecture = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["scripts/check-architecture.mjs"],
  });
  assert.ok(architecture.selectedNodeTests.includes("tests/architecture-boundaries.test.mjs"));
});

test("gate plans expose owner provenance and width warnings without failing", () => {
  const raw = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["bridge/project-file-repository.mjs"],
  });
  const plan = annotateGatePlan(raw, {
    map,
    inventoryFiles: [
      "bridge/project-file-repository.mjs",
      "bridge/project-file-repository/path-safety.mjs",
      "bridge/agent-bridge-service.mjs",
    ],
    tagCounts: {
      "ai:@smoke-review": 3,
    },
  });
  assert.ok(plan.matchedOwners.includes("project-file-lifecycle"));
  assert.equal(plan.fileMatches[0].file, "bridge/project-file-repository.mjs");
  assert.ok(plan.nodeTestOrigins["tests/project-registry-and-open.test.mjs"].length > 0);
  assert.ok(plan.runtimeCanaries.includes("ai-review-smoke"));
  assert.equal(plan.estimatedFanout.aiTests, 3);
  assert.ok(plan.selectedNodeTests.length > GATE_WIDTH_LIMITS.leafFileNodeTests);
  assert.ok(plan.warnings.some((warning) => warning.code === "leaf-file-node-fanout"));
  assert.equal(plan.warnings.find((warning) => warning.code === "leaf-file-node-fanout").blocking, false);
  const compact = compactGatePlan(plan);
  assert.deepEqual(compact.changedFiles, ["bridge/project-file-repository.mjs"]);
  assert.ok(compact.warnings.some((warning) => warning.code === "leaf-file-node-fanout"));
});

test("expired width exceptions become hard failures", () => {
  const raw = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["bridge/project-file-repository.mjs"],
  });
  const expired = annotateGatePlan(raw, {
    map,
    inventoryFiles: [
      "bridge/project-file-repository.mjs",
      "bridge/project-file-repository/path-safety.mjs",
      "bridge/agent-bridge-service.mjs",
    ],
    now: new Date("2027-01-02T00:00:00.000Z"),
  });
  assert.ok(expired.warnings.some((warning) => warning.blocking));
  assert.throws(() => assertGateWidthPolicy(expired), /width budget exceeded/u);
});

test("gate:plan capability-context schema v2 exposes contract-first and implementation reading sets", () => {
  const capabilityMap = loadCapabilityContextMap();
  assert.equal(capabilityMap.schemaVersion, 2);
  assert.equal(capabilityMap.defaultLevel, "contract");
  const comments = selectCapabilityContext({
    changedFiles: ["app/application/comment-workflow.js"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(comments.domains, ["comments"]);
  assert.equal(comments.defaultLevel, "contract");
  assert.ok(comments.owners.includes("CommentWorkflow"));
  for (const ownerContract of [
    "app/application/comment-workflow.d.ts",
    "app/application/comment-session.d.ts",
    "app/workbench/comment-rail-contract.ts",
    "app/application/comment/commit-plan.d.ts",
    "app/application/workspace-controller-capabilities.d.ts",
  ]) {
    assert.ok(comments.contract.files.includes(ownerContract));
  }
  assert.ok(!comments.contract.files.includes("app/application/comment-workflow.js"));
  assert.ok(comments.implementation.files.includes("app/application/comment-workflow.js"));
  assert.ok(comments.implementation.files.includes("app/application/comment/commit-plan.js"));
  assert.ok(comments.implementation.files.includes("tests/comment-workflow.test.mjs"));
  assert.ok(comments.implementation.files.includes("docs/ARCHITECTURE_MAP.md"));
  assert.ok(comments.contract.estimatedBytes > 0);
  assert.ok(comments.implementation.estimatedBytes > comments.contract.estimatedBytes);
  assert.ok(comments.contract.files.every((file) => comments.implementation.files.includes(file)));

  const ownerContractsByChangedFile = new Map([
    ["app/application/document-workflow.js", [
      "app/application/document-workflow.d.ts",
      "app/application/document-session.d.ts",
      "app/application/document/save-plan.d.ts",
      "app/application/verified-project-context.d.ts",
      "app/application/workspace-controller-capabilities.d.ts",
    ]],
    ["app/application/project-workflow.js", [
      "app/application/project-workflow.d.ts",
      "app/application/project-session.d.ts",
      "app/application/project/open-intent.d.ts",
      "app/application/project/switch-plan.d.ts",
      "app/application/project/close-plan.d.ts",
      "app/application/project/source-locator-plan.d.ts",
      "app/application/workspace-controller-capabilities.d.ts",
    ]],
    ["app/application/run-workflow.js", [
      "app/application/run-workflow.d.ts",
      "app/application/run-session.d.ts",
      "app/application/version-workflow.d.ts",
      "app/application/version-session.d.ts",
      "app/application/run/submit-plan.d.ts",
      "app/application/version/review-plan.d.ts",
      "app/application/workspace-controller-capabilities.d.ts",
    ]],
    ["app/application/workbench-navigation-workflow.js", [
      "app/application/workbench-navigation-workflow.d.ts",
      "app/application/workbench-navigation-session.d.ts",
      "app/application/workbench-tabs-session.d.ts",
      "app/application/workspace-controller-capabilities.d.ts",
    ]],
    ["app/components/HtmlCanvasEditor.tsx", [
      "app/components/html-canvas-selection-chrome-contract.ts",
      "app/components/HtmlCanvasEditor.types.ts",
      "app/application/edit-author-runtime-session.d.ts",
    ]],
  ]);
  for (const [changedFile, ownerContracts] of ownerContractsByChangedFile) {
    const context = selectCapabilityContext({
      changedFiles: [changedFile],
      map: capabilityMap,
      productRoot,
    });
    for (const ownerContract of ownerContracts) {
      assert.ok(context.contract.files.includes(ownerContract));
    }
    assert.ok(!context.contract.files.some((file) => /workflow\.js$/u.test(file)));
    assert.ok(context.implementation.files.includes(changedFile));
    assert.ok(context.contract.estimatedBytes < context.implementation.estimatedBytes);
  }

  const unknown = selectCapabilityContext({
    changedFiles: ["README.md"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(unknown.domains, []);
  assert.equal(unknown.defaultLevel, "contract");
  assert.deepEqual(unknown.contract, { files: [], estimatedBytes: 0 });
  assert.deepEqual(unknown.implementation, { files: [], estimatedBytes: 0 });

  const compact = compactGatePlan({
    changedFiles: ["app/application/comment-workflow.js"],
    matchedOwners: ["comment-workflow"],
    selectedNodeTests: ["tests/comment-workflow.test.mjs"],
    capabilityContext: comments,
  });
  assert.deepEqual(compact.capabilityContext.domains, ["comments"]);
  assert.equal(compact.capabilityContext.defaultLevel, "contract");
  assert.deepEqual(compact.capabilityContext.contract, comments.contract);
  assert.deepEqual(compact.capabilityContext.implementation, comments.implementation);
  assert.equal("entryInterfaces" in compact.capabilityContext, false);
  assert.equal("estimatedContextBytes" in compact.capabilityContext, false);
  assert.equal("capabilityContext" in map, false);
  assert.equal(JSON.stringify(map).includes("estimatedBytes"), false);

  const capabilityContract = selectCapabilityContext({
    changedFiles: ["app/application/workspace-controller-capabilities.d.ts"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(capabilityContract.domains, ["workspace-controller-capabilities"]);
  assert.deepEqual(capabilityContract.contract.files, [
    "app/application/workspace-controller-capabilities.d.ts",
  ]);
  assert.ok(capabilityContract.implementation.files.includes(
    "tests/workspace-controller-capabilities.typecheck.ts",
  ));
  assert.ok(comments.implementationFiles.files.includes("app/application/comment-workflow.js"));
  assert.ok(!comments.implementationFiles.files.includes("tests/comment-workflow.test.mjs"));
  assert.ok(comments.focusedTests.files.includes("tests/comment-workflow.test.mjs"));
  assert.ok(comments.requiredDocs.files.includes("docs/INTERACTION_FLOW.md"));
  assert.ok(comments.requiredDocs.sections.some((section) => (
    section.path === "docs/INTERACTION_FLOW.md" && section.headings.includes("## 6. 评论")
  )));
  assert.deepEqual(compact.capabilityContext.implementationFiles, comments.implementationFiles);
  assert.deepEqual(compact.capabilityContext.focusedTests, comments.focusedTests);
  assert.deepEqual(compact.capabilityContext.requiredDocs, comments.requiredDocs);
});

test("whole-file doc requirements cover chapter requirements when domains merge", () => {
  const capabilityMap = loadCapabilityContextMap();
  const comments = capabilityMap.domains.find((domain) => domain.id === "comments");
  const documentSave = capabilityMap.domains.find((domain) => domain.id === "document-save");
  const merged = mergeRequiredDocSections([comments, documentSave]);
  assert.equal(
    merged.some((section) => section.path === "docs/ARCHITECTURE_MAP.md"),
    false,
  );
  const interaction = merged.find((section) => section.path === "docs/INTERACTION_FLOW.md");
  assert.ok(interaction.headings.includes("## 5. 直接编辑与自动写回"));
  assert.ok(interaction.headings.includes("## 6. 评论"));

  const selected = selectCapabilityContext({
    domainIds: ["comments", "document-save"],
    map: capabilityMap,
    productRoot,
  });
  assert.ok(selected.requiredDocs.files.includes("docs/ARCHITECTURE_MAP.md"));
  assert.equal(
    selected.requiredDocs.sections.some((section) => section.path === "docs/ARCHITECTURE_MAP.md"),
    false,
  );
  const selectedInteraction = selected.requiredDocs.sections.find((section) => (
    section.path === "docs/INTERACTION_FLOW.md"
  ));
  assert.ok(selectedInteraction.headings.includes("## 5. 直接编辑与自动写回"));
  assert.ok(selectedInteraction.headings.includes("## 6. 评论"));
});

test("chapter-only domains merge headings for the same file", () => {
  assert.deepEqual(
    mergeRequiredDocSections([
      {
        requiredDocs: ["docs/ARCHITECTURE_MAP.md"],
        requiredDocSections: [{
          path: "docs/ARCHITECTURE_MAP.md",
          headings: ["## Comment render boundary"],
        }],
      },
      {
        requiredDocs: ["docs/ARCHITECTURE_MAP.md"],
        requiredDocSections: [{
          path: "docs/ARCHITECTURE_MAP.md",
          headings: ["## Capability domains"],
        }],
      },
    ]),
    [{
      path: "docs/ARCHITECTURE_MAP.md",
      headings: ["## Capability domains", "## Comment render boundary"],
    }],
  );
});

test("capability-context map rejects missing files and missing doc headings", () => {
  const capabilityMap = loadCapabilityContextMap();
  assertCapabilityContextMap(capabilityMap, productRoot);
  const stale = structuredClone(capabilityMap);
  stale.domains[0].entryInterfaces = ["does-not-exist.d.ts"];
  assert.throws(
    () => assertCapabilityContextMap(stale, productRoot),
    /missing files/,
  );
  const brokenHeading = structuredClone(capabilityMap);
  brokenHeading.domains[0].requiredDocSections = [{
    path: "docs/INTERACTION_FLOW.md",
    headings: ["## this heading does not exist"],
  }];
  assert.throws(
    () => assertCapabilityContextMap(brokenHeading, productRoot),
    /missing doc headings/,
  );
});

test("capability-context can be queried before files change and keeps classes separate", () => {
  const capabilityMap = loadCapabilityContextMap();
  const byDomain = selectCapabilityContext({
    domainIds: ["canvas-runtime"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(byDomain.domains, ["canvas-runtime"]);
  assert.ok(byDomain.contract.files.includes("app/domain/edit-runtime-contract.d.ts"));
  assert.ok(byDomain.contract.files.includes("app/components/edit-runtime-refresh-decision.d.ts"));
  assert.ok(byDomain.implementationFiles.files.includes("desktop/edit-runtime-protocol.mjs"));
  assert.ok(byDomain.implementationFiles.files.includes("app/components/edit-runtime-refresh-decision.js"));
  assert.ok(byDomain.focusedTests.files.includes("tests/edit-runtime-contract.test.mjs"));
  assert.ok(byDomain.focusedTests.files.includes("tests/edit-runtime-refresh-decision.test.mjs"));
  assert.ok(!byDomain.contract.files.includes("desktop/edit-runtime-protocol.mjs"));

  const unknownDomain = selectCapabilityContext({
    domainIds: ["not-a-domain"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(unknownDomain.domains, []);
  assert.deepEqual(unknownDomain.unmatchedDomains, ["not-a-domain"]);

  const unmatched = selectCapabilityContext({
    queryFiles: ["README.md"],
    map: capabilityMap,
    productRoot,
  });
  assert.deepEqual(unmatched.domains, []);
  assert.deepEqual(unmatched.unmatchedFiles, ["README.md"]);

  const representativeEntries = [
    ["app/lib/source-structure-edit.js", "semantic-source-editing"],
    ["app/components/html-canvas-structure-commands.ts", "semantic-source-editing"],
    ["app/domain/edit-runtime-contract.js", "canvas-runtime"],
    ["app/components/edit-runtime-refresh-decision.js", "canvas-runtime"],
    ["bridge/agent/agent-runtime-coordinator.mjs", "agent-runtime"],
    ["desktop/main.mjs", "desktop-host"],
  ];
  for (const [file, domain] of representativeEntries) {
    const context = selectCapabilityContext({
      queryFiles: [file],
      map: capabilityMap,
      productRoot,
    });
    assert.ok(context.domains.includes(domain), `${file} should map to ${domain}`);
    assert.deepEqual(context.unmatchedFiles, []);
  }
});

test("gate:plan context flags never affect test lanes", () => {
  const planOptions = parseGateArguments(["plan", "--context-domain", "comments,canvas-runtime"]);
  assert.deepEqual(planOptions.contextDomains, ["comments", "canvas-runtime"]);
  assert.equal(planOptions.lane, "plan");
  const fileOptions = parseGateArguments(["plan", "--context-file", "app/lib/source-structure-edit.js"]);
  assert.deepEqual(fileOptions.contextFiles, ["app/lib/source-structure-edit.js"]);
  assert.throws(
    () => parseGateArguments(["task", "--context-domain", "comments"]),
    /only supported for gate:plan/,
  );
  const capabilityMap = loadCapabilityContextMap();
  const changedFiles = ["app/application/comment-workflow.js"];
  const selectionOf = (assembled) => ({
    changedFiles: assembled.testPlan.changedFiles,
    suites: assembled.testPlan.suites.map((suite) => suite.id),
    selectedNodeTests: assembled.testPlan.selectedNodeTests,
    matchedOwners: assembled.testPlan.matchedOwners,
  });
  const baseline = assembleGateCapabilityPlan({
    changedFiles,
    impactMap: map,
    capabilityMap,
    productRoot,
  });
  const byDomain = assembleGateCapabilityPlan({
    changedFiles,
    contextDomains: ["semantic-source-editing"],
    impactMap: map,
    capabilityMap,
    productRoot,
  });
  const byFile = assembleGateCapabilityPlan({
    changedFiles,
    contextFiles: ["app/lib/source-structure-edit.js"],
    impactMap: map,
    capabilityMap,
    productRoot,
  });
  const cleanQuery = assembleGateCapabilityPlan({
    changedFiles: [],
    contextDomains: ["comments"],
    impactMap: map,
    capabilityMap,
    productRoot,
  });
  assert.deepEqual(selectionOf(byDomain), selectionOf(baseline));
  assert.deepEqual(selectionOf(byFile), selectionOf(baseline));
  assert.deepEqual(baseline.testPlan.changedFiles, changedFiles);
  assert.ok(baseline.testPlan.matchedOwners.includes("comment-workflow"));
  assert.ok(baseline.capabilityContext.domains.includes("comments"));
  assert.ok(byDomain.capabilityContext.domains.includes("semantic-source-editing"));
  assert.ok(!byDomain.capabilityContext.domains.includes("comments"));
  assert.ok(byFile.capabilityContext.domains.includes("semantic-source-editing"));
  assert.ok(!byFile.capabilityContext.domains.includes("comments"));
  assert.notDeepEqual(byDomain.capabilityContext.domains, baseline.capabilityContext.domains);
  assert.notDeepEqual(byFile.capabilityContext.domains, baseline.capabilityContext.domains);
  assert.deepEqual(cleanQuery.testPlan.changedFiles, []);
  assert.deepEqual(cleanQuery.testPlan.selectedNodeTests, []);
  assert.deepEqual(cleanQuery.testPlan.matchedOwners, []);
  assert.ok(cleanQuery.capabilityContext.domains.includes("comments"));
  assert.ok(cleanQuery.capabilityContext.contract.files.length > 0);
});

test("capability contracts select only their independent typecheck owner", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: [
      "app/application/workspace-controller-capabilities.d.ts",
      "tests/workspace-controller-capabilities.typecheck.ts",
    ],
  });
  assert.deepEqual(plan.matchedOwners, ["workspace-controller-capability-contracts"]);
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint"]);
  assert.deepEqual(plan.selectedNodeTests, []);
  assert.ok(!plan.matchedOwners.includes("workspace-controller"));
  assert.ok(!plan.suites.some(({ id }) => id.includes("electron") || id.includes("browser")));
});

test("Version ingress changes select production decoder coverage", () => {
  const plan = selectGatePlan({ lane: "edit", changedFiles: ["app/workbench/version-model.ts"], map });
  assert.ok(plan.selectedNodeTests.includes("tests/workspace-ingress.test.mjs"));
});


test("changed review annotation is discovered through the AI selection runtime", () => {
  const file = "tests/e2e/electron/review-annotation-clarity.spec.mjs";
  const plan = selectGatePlan({ map, lane: "task", changedFiles: [file] });
  assert.deepEqual(plan.selectedChangedSpecs["ai-changed-specs"], [file]);
  assert.equal(plan.selectedChangedSpecs["electron-changed-specs"], undefined);
});
