import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DocumentSession } from "../app/application/document-session.js";
import { buildSourceIndex } from "../app/lib/source-patch-core.js";
import {
  attachRuntimeContinuityProbe,
  enableRuntimeContinuityProbe,
  sampleRuntimeContinuityVisuals,
  summarizeRuntimeContinuity,
} from "../app/components/runtime-continuity-probe.js";
import { SEEDED_FAULTS } from "../scripts/seeded-fault-oracles.mjs";
import {
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";

const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));
const ID_A = "pr1_11111111111141118111111111111111";
const ID_B = "pr1_22222222222242228222222222222222";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fakeEditor({ includeIframe = true, includeCandidate = false } = {}) {
  const iframe = {
    tagName: "IFRAME",
    attributes: includeIframe ? { title: "HTML", "data-frame-generation": "1", width: "640", height: "400" } : {},
    children: [],
    isConnected: includeIframe,
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 640, height: 400 };
    },
  };
  const candidate = {
    tagName: "IFRAME",
    attributes: { "data-frame-role": "runtime-candidate", width: "640", height: "400" },
    children: [],
    isConnected: true,
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 640, height: 400 };
    },
  };
  const frames = [
    ...(includeIframe ? [iframe] : []),
    ...(includeCandidate ? [candidate] : []),
  ];
  const editor = {
    tagName: "DIV",
    attributes: { "data-testid": "html-canvas-editor", width: "640" },
    children: frames,
    parentElement: null,
    closest() {
      return this;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe") return frames;
      if (selector === 'iframe[data-frame-role="runtime-candidate"]') {
        return includeCandidate ? [candidate] : [];
      }
      return [];
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 640, height: 400 };
    },
  };
  const window = {
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
  };
  return { editor, window };
}

test("seeded faults keep a Draft canary that would kill the corresponding owner", () => {
  for (const fault of SEEDED_FAULTS) {
    const plan = selectGatePlan({
      map,
      lane: "draft",
      changedFiles: [fault.productionFile],
    });
    assert.ok(
      plan.matchedOwners.includes(fault.owner),
      `${fault.id} owner ${fault.owner}`,
    );
    assert.ok(
      plan.suites.some((suite) => suite.id === fault.killer),
      `${fault.id} killer ${fault.killer}`,
    );
  }
  assert.deepEqual(
    SEEDED_FAULTS.filter((fault) => fault.detection === "electron-live-canary").map((fault) => fault.id),
    ["active-iframe-cleared", "candidate-created-during-edit"],
  );
});

test("duplicate Stable IDs fail closed in the production source index", () => {
  const unique = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_B}">two</p></main>`,
  );
  assert.equal(unique.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"), false);
  const duplicated = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_A}">two</p></main>`,
  );
  assert.equal(
    duplicated.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"),
    true,
  );
  const restored = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_B}">two</p></main>`,
  );
  assert.equal(restored.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"), false);
});

test("canvas confirmation stays fenced when working HTML was skipped before save", () => {
  const html = "<main>one</main>";
  const digest = sha256(html);
  const session = new DocumentSession({
    html,
    persistedSourceSha256: digest,
  });
  session.reloadCanvas();
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: digest,
  }), true);
  const edited = "<main>two</main>";
  const revision = session.beginEdit(edited);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(edited),
  }), false);
  assert.equal(session.confirmWorkingHtml({
    revision,
    htmlSha256: sha256(edited),
  }), true);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(edited),
  }), false);
  const corrected = session.publishAuthority({
    html: edited,
    persistedSourceSha256: sha256(edited),
    workingHtmlSha256: sha256(edited),
    operationId: "seeded-fault-corrected-working-hash",
  }).sourceReceipt;
  assert.equal(session.confirmCanvas({
    generation: corrected.canvasGeneration,
    renderedSha256: sha256(edited),
    workingHtmlSha256: sha256(edited),
    renderedHtml: edited,
    receipt: corrected,
  }), true);
});

test("clearing the Active iframe is visible to the continuity canary and restoring it recovers", () => {
  const healthy = fakeEditor({ includeIframe: true });
  attachRuntimeContinuityProbe(() => healthy.editor, healthy.window);
  enableRuntimeContinuityProbe(healthy.window);
  const before = sampleRuntimeContinuityVisuals(healthy.editor, healthy.window);
  const cleared = fakeEditor({ includeIframe: false });
  const injected = sampleRuntimeContinuityVisuals(cleared.editor, cleared.window);
  const restored = sampleRuntimeContinuityVisuals(healthy.editor, healthy.window);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [before, before] }).missingVisibleFrame, false);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [before, injected] }).missingVisibleFrame, true);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [restored, restored] }).missingVisibleFrame, false);
});

test("a Candidate iframe created during edit is visible to the continuity canary", () => {
  const healthy = fakeEditor({ includeCandidate: false });
  const injected = fakeEditor({ includeCandidate: true });
  const before = sampleRuntimeContinuityVisuals(healthy.editor, healthy.window);
  const during = sampleRuntimeContinuityVisuals(injected.editor, injected.window);
  const after = sampleRuntimeContinuityVisuals(healthy.editor, healthy.window);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [before, before] }).unexpectedCandidate, false);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [before, during] }).unexpectedCandidate, true);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [after, after] }).unexpectedCandidate, false);
});
