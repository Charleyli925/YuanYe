import { expect, test } from "@playwright/test";

import { REAL_HTML_OPERATION_IDS } from "../electron/real-html/plan.mjs";
import { runtimeOperationOutcomes } from "../electron/real-html/runtime-lifecycle.mjs";
import {
  attributeRuntimeObserverRequests,
  setRuntimeLifecycleObservationContext,
  startRuntimeLifecycleObservation,
  startRuntimeCandidateObservation,
  stopRuntimeLifecycleObservation,
  stopRuntimeCandidateObservation,
  summarizeRuntimeObserverRecords,
} from "../electron/real-html/runtime-observer.mjs";

const OBSERVER_KEY = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";

test("repeated same-source rebuild requests remain separate without inventing missing requests", async ({ page }) => {
  await page.setContent('<main data-runtime-root></main>');
  const root = page.locator('[data-runtime-root]');
  await root.evaluate(startRuntimeLifecycleObservation);
  await root.evaluate(setRuntimeLifecycleObservationContext, {
    fileId: "H01", round: 2, targetIndex: 3,
    targetId: "pr1_11111111111111111111111111111111",
    behavior: "structure-rebuild", operation: "copy-edit-delete-element",
  });
  for (let cycle = 1; cycle <= 2; cycle++) {
    await root.evaluate(e => {
      e.setAttribute('data-runtime-refresh-pending', '');
      e.setAttribute('data-runtime-refresh-pending-source-revision', 'same-source');
      e.setAttribute('data-runtime-refresh-pending-reason', 'history');
    });
    await expect.poll(() => root.evaluate((e, key) => globalThis[key].lifecycleRecords.filter(r => r.kind === 'rebuild-request').length,
      OBSERVER_KEY)).toBe(cycle);
    await root.evaluate(e => {
      e.removeAttribute('data-runtime-refresh-pending');
      e.removeAttribute('data-runtime-refresh-pending-source-revision');
      e.removeAttribute('data-runtime-refresh-pending-reason');
    });
  }
  const before = await root.evaluate((e, key) => globalThis[key].lifecycleRecords.length, OBSERVER_KEY);
  await root.evaluate(e => e.setAttribute('data-runtime-candidate-id', 'candidate-only'));
  const stopped = await root.evaluate(stopRuntimeLifecycleObservation);
  const requests = stopped.records.filter(r => r.kind === 'rebuild-request');
  expect(requests).toHaveLength(2);
  expect(requests.map(r => r.requestOrdinal)).toEqual([1, 2]);
  expect(summarizeRuntimeObserverRecords(stopped.lifecycleRecords.slice(before)).hasRequest).toBe(false);
});

async function startObservation(root) {
  await root.evaluate(startRuntimeCandidateObservation);
}

async function observedRecords(root) {
  return root.evaluate((element, key) => globalThis[key]?.records || [], OBSERVER_KEY);
}

async function stopObservation(root) {
  return root.evaluate(stopRuntimeCandidateObservation);
}

function outcomes(candidateEvidence) {
  return runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence,
  });
}

test("Candidate observer accepts the canonical absent-to-present transition", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent('<main data-runtime-root><iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe></main>');
  const root = page.locator("[data-runtime-root]");
  await startObservation(root);

  await root.evaluate((element) => {
    element.setAttribute("data-runtime-candidate-id", "candidate-2");
  });
  await expect.poll(async () => (await observedRecords(root)).length).toBeGreaterThan(0);
  const records = await stopObservation(root);
  const canonical = records.find((record) => (
    record.evidence === "candidate-id-absent-to-present"
  ));

  expect(canonical).toMatchObject({
    kind: "candidate-created",
    evidence: "candidate-id-absent-to-present",
    candidateId: "candidate-2",
  });
  expect(outcomes(canonical)[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state).toBe("PASS");
});

test("generation change without a Candidate transition is rejected", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent('<main data-runtime-root><iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe></main>');
  const root = page.locator("[data-runtime-root]");
  await startObservation(root);

  await root.locator('iframe[data-runtime-slot-role="active"]').evaluate((frame) => {
    frame.setAttribute("data-frame-generation", "2");
  });
  await page.waitForTimeout(0);
  const records = await stopObservation(root);
  const result = outcomes(records.find((record) => (
    record.evidence === "candidate-id-absent-to-present"
  )) || null);

  expect(records).toEqual([]);
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state).toBe("PASS");
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state).toBe("PASS");
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE]).toMatchObject({
    state: "FAIL",
    details: { exactReason: "CANDIDATE_CREATION_NOT_OBSERVED" },
  });
});

test("lifecycle observer proves Candidate, generation, promotion and Runtime terminal separately", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent(`<section class="canvas-edit-surface"
    data-edit-runtime-phase="preparing"
    data-edit-runtime-outcome="pending">
    <main data-runtime-root>
      <iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe>
    </main>
  </section>`);
  const root = page.locator("[data-runtime-root]");
  await root.evaluate(startRuntimeLifecycleObservation);
  await root.evaluate(setRuntimeLifecycleObservationContext, {
    fileId: "H01", round: 2, targetIndex: 3,
    targetId: "pr1_11111111111111111111111111111111",
    behavior: "structure-rebuild", operation: "copy-edit-delete-element",
  });

  await root.evaluate((element) => {
    const oldActive = element.querySelector('iframe[data-runtime-slot-role="active"]');
    const candidate = document.createElement("iframe");
    element.setAttribute("data-runtime-refresh-pending", "");
    element.setAttribute("data-runtime-refresh-pending-source-revision", "source-2");
    element.setAttribute("data-runtime-refresh-pending-reason", "structure-edit");
    candidate.setAttribute("data-runtime-slot-role", "candidate");
    candidate.setAttribute("data-frame-role", "runtime-candidate");
    candidate.setAttribute("data-frame-generation", "2");
    candidate.setAttribute("data-runtime-candidate-id", "candidate-2");
    element.setAttribute("data-runtime-candidate-id", "candidate-2");
    element.setAttribute("data-runtime-candidate-generation", "2");
    element.setAttribute("data-runtime-candidate-source-revision", "source-2");
    element.append(candidate);
    element.setAttribute("data-runtime-last-known-good-id", "candidate-2");
    element.setAttribute("data-runtime-last-known-good-generation", "2");
    element.setAttribute("data-runtime-last-known-good-source-revision", "source-2");
    oldActive.setAttribute("data-runtime-slot-role", "previous");
    oldActive.setAttribute("data-frame-role", "runtime-previous");
    candidate.setAttribute("data-runtime-slot-role", "active");
    candidate.removeAttribute("data-frame-role");
    candidate.removeAttribute("data-runtime-candidate-id");
    element.removeAttribute("data-runtime-candidate-id");
    element.removeAttribute("data-runtime-refresh-pending");
    element.removeAttribute("data-runtime-refresh-pending-source-revision");
    element.removeAttribute("data-runtime-refresh-pending-reason");
    const surface = element.closest(".canvas-edit-surface");
    surface.setAttribute("data-edit-runtime-phase", "settled");
    surface.setAttribute("data-edit-runtime-outcome", "ready");
  });

  await expect.poll(async () => root.evaluate((element, key) => {
    const state = globalThis[key];
    return (state?.records?.length || 0) + (state?.lifecycleRecords?.length || 0);
  }, OBSERVER_KEY)).toBeGreaterThan(3);
  const stopped = await root.evaluate(stopRuntimeLifecycleObservation);
  const summary = summarizeRuntimeObserverRecords(stopped.records);

  expect(summary).toMatchObject({
    hasRequest: true,
    hasCandidate: true,
    candidateId: "candidate-2",
    hasCandidateTerminal: true,
    hasGeneration: true,
    hasRuntimeTerminal: true,
    hasActiveIdentity: true,
  });
  expect(summary.request).toMatchObject({
    sourceRevision: "source-2",
    reason: "structure-edit",
    status: "submitted",
  });
  expect(summary.candidateTerminal).toMatchObject({
    candidateId: "candidate-2",
    terminal: "ready",
  });
  expect(summary.generation).toMatchObject({
    beforeGeneration: "1",
    afterGeneration: "2",
  });
  expect(summary.runtimeTerminal).toMatchObject({ terminal: "ready" });
  expect(summary.activeIdentity).toMatchObject({
    candidateId: "candidate-2",
    generation: "2",
  });
  const attributions = attributeRuntimeObserverRequests(stopped.records);
  expect(attributions).toHaveLength(1);
  expect(attributions[0]).toMatchObject({
    requestOrdinal: 1,
    execution: { fileId: "H01", round: 2, targetIndex: 3,
      targetId: "pr1_11111111111111111111111111111111",
      behavior: "structure-rebuild", operation: "copy-edit-delete-element" },
    reason: "structure-edit",
    sourceRevision: "source-2",
    candidateIds: ["candidate-2"],
  });
  expect(attributions[0].generations.some(result => result.after === "2")).toBe(true);
  expect(attributions[0].candidateTerminals).toContainEqual({ candidateId: "candidate-2", terminal: "ready" });
});

test("promotion is bound to its iframe, not delayed last-known-good metadata", async ({ page }) => {
  await page.setContent(`<main data-runtime-root data-runtime-last-known-good-id="candidate-old">
    <iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe>
    <iframe data-runtime-slot-role="inactive" data-frame-generation="0"></iframe>
  </main>`);
  const root = page.locator("[data-runtime-root]");
  await root.evaluate(startRuntimeLifecycleObservation);
  // Candidate identity exists on the real product iframe before promotion.
  await root.evaluate((element) => {
    const frame = element.querySelector('iframe[data-runtime-slot-role="inactive"]');
    frame.setAttribute("data-runtime-candidate-id", "candidate-new");
    frame.setAttribute("data-frame-generation", "2");
    frame.setAttribute("data-frame-role", "runtime-candidate");
    element.setAttribute("data-runtime-candidate-id", "candidate-new");
  });
  await root.evaluate((element) => {
    const frame = element.querySelector('iframe[data-frame-role="runtime-candidate"]');
    element.querySelector('iframe[data-runtime-slot-role="active"]').setAttribute("data-runtime-slot-role", "previous");
    frame.setAttribute("data-runtime-slot-role", "active");
    frame.removeAttribute("data-runtime-candidate-id");
    frame.removeAttribute("data-frame-role");
    element.removeAttribute("data-runtime-candidate-id");
    // Deliberately leave root metadata stale, as in the real H06 first failure.
  });
  const stopped = await root.evaluate(stopRuntimeLifecycleObservation);
  expect(stopped.lifecycleRecords.find((record) => record.kind === "active-identity"))
    .toMatchObject({ candidateId: "candidate-new", generation: "2" });
  expect(stopped.lifecycleRecords.find((record) => record.kind === "candidate-terminal"))
    .toMatchObject({ candidateId: "candidate-new", terminal: "ready" });
  expect(stopped.lifecycleRecords.some((record) => record.candidateId === "candidate-old")).toBe(false);
});

test("an unbound promoted iframe cannot borrow a global Candidate identity", async ({ page }) => {
  await page.setContent(`<main data-runtime-root data-runtime-last-known-good-id="candidate-wrong">
    <iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe>
    <iframe data-runtime-slot-role="inactive" data-frame-generation="2"></iframe>
  </main>`);
  const root = page.locator("[data-runtime-root]");
  await root.evaluate(startRuntimeLifecycleObservation);
  await root.evaluate((element) => {
    element.querySelector('iframe[data-runtime-slot-role="active"]').setAttribute("data-runtime-slot-role", "previous");
    element.querySelector('iframe[data-runtime-slot-role="inactive"]').setAttribute("data-runtime-slot-role", "active");
  });
  const stopped = await root.evaluate(stopRuntimeLifecycleObservation);
  const summary = summarizeRuntimeObserverRecords(stopped.records);
  expect(summary.hasCandidate).toBe(false);
  expect(summary.hasActiveIdentity).toBe(false);
  expect(stopped.lifecycleRecords.find((record) => record.kind === "active-identity").candidateId).toBeNull();
});

test("lifecycle observer does not invent a Candidate from generation alone", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent(`<section class="canvas-edit-surface" data-edit-runtime-phase="settled">
    <main data-runtime-root>
      <iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe>
    </main>
  </section>`);
  const root = page.locator("[data-runtime-root]");
  await root.evaluate(startRuntimeLifecycleObservation);
  await root.locator("iframe").evaluate((frame) => {
    frame.setAttribute("data-frame-generation", "2");
  });
  await page.waitForTimeout(0);
  const stopped = await root.evaluate(stopRuntimeLifecycleObservation);
  const summary = summarizeRuntimeObserverRecords(stopped.records);

  expect(summary.hasGeneration).toBe(true);
  expect(summary.hasCandidate).toBe(false);
  expect(summary.hasCandidateTerminal).toBe(false);
});
