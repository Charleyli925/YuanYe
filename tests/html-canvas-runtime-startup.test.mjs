import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { queuedStaticFallbackOracle } from "./e2e/electron/queued-static-fallback-oracle.mjs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const SHAPE_ASSERTION_SUCCESSORS = Object.freeze([
  {
    removed: "loadFrameSource/startRuntimeCandidate/requestDynamicRuntimeRefresh must be useCallback bodies with mode:static vs disposable-runtime",
    successorFile: "tests/e2e/electron/electron-edit-runtime.spec.mjs",
    successorName: "a failed dynamic candidate promotes the latest Script-disabled static page",
  },
  {
    removed: "first open, late grant, retry and history must call requestDynamicRuntimeRefresh at listed source sites",
    successorFile: "tests/e2e/electron/electron-edit-runtime.spec.mjs",
    successorName: "same-source history cancellation reloads through a fixed Runtime candidate",
  },
  {
    removed: "promoteRuntimeCandidate/commitRuntimeCandidate/cancelRuntimeCandidate callback-body call order",
    successorFile: "tests/e2e/electron/electron-edit-runtime.spec.mjs",
    successorName: "a Candidate commit verification failure restores the visible Active",
  },
  {
    removed: "reading-position restore must call applyReadingPosition in the editor source",
    successorFile: "tests/e2e/electron/electron-runtime-continuity.spec.mjs",
    successorName: "comment rail and canvas width stay visually continuous while typing in a nested scroller",
  },
  {
    removed: "scheduleLatestStaticFallbackAfterFailure helper must contain E2E release hook text",
    successorFile: "tests/e2e/electron/electron-edit-runtime.spec.mjs",
    successorName: "a queued static fallback follows the latest Working HTML after Native Edit",
  },
]);

test("retired Canvas implementation-shape assertions name a behavior successor", () => {
  for (const entry of SHAPE_ASSERTION_SUCCESSORS) {
    assert.equal(existsSync(new URL(`../${entry.successorFile}`, import.meta.url)), true, entry.successorFile);
    const spec = source(entry.successorFile);
    assert.match(
      spec,
      new RegExp(entry.successorName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      entry.removed,
    );
  }
});

test("retired Runtime handoff and comment-layout restore paths stay deleted", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  assert.doesNotMatch(editor, /forceRuntimeHandoff/u);
  assert.doesNotMatch(editor, /runtimeNeedsRerenderRef/u);
  assert.doesNotMatch(editor, /rollbackRuntimeCandidatePromotion/u);
  assert.doesNotMatch(editor, /type RuntimeActiveFrameSnapshot/u);
  assert.doesNotMatch(editor, /lastValidCommentLayoutRef/u);
});

test("Canvas source transitions are receipt-gated rather than HTML-echo guessed", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  assert.doesNotMatch(editor, /lastEmittedHtmlRef|pendingHtmlEchoesRef/u);
  assert.match(editor, /lastSourceReceiptRef/u);
  assert.match(editor, /sameSourceReceiptContext/u);
  assert.match(editor, /sourceReceipt\.origin !== "authority"/u);
});

test("ADR 0065 no longer requires native session or comment-layout handoff restore", () => {
  const adr = source("docs/decisions/0065-disposable-edit-runtime.md");
  assert.match(adr, /hidden Candidate/u);
  assert.match(adr, /Active has no second path that executes Script/u);
  assert.match(adr, /must not restore Caret, Range,\s+Focus or a native editing session/u);
  assert.match(adr, /One commit then\s+switches Active identity and visibility together/u);
  assert.doesNotMatch(adr, /native Range\/Caret\/Focus state/u);
  assert.doesNotMatch(adr, /last complete comment layout/u);
});

test("queued-static oracle rejects a stale R1 static frame after R2 is on disk", () => {
  assert.throws(() => queuedStaticFallbackOracle({
    diskHtml: "<p>静态候选必须跟随最新源码 最新来源</p><p>静态候选必须跟随最新源码 最新来源</p>",
    visibleTexts: ["静态候选必须跟随最新源码", "静态候选必须跟随最新源码"],
    sandbox: "allow-same-origin",
    expectedSnippet: "最新来源",
    expectedVisibleCount: 2,
  }), /Visible static frame is not the latest Working HTML/u);
});

test("queued-static oracle accepts R2 on disk and in the static frame", () => {
  queuedStaticFallbackOracle({
    diskHtml: "<p>静态候选必须跟随最新源码 最新来源</p><p>静态候选必须跟随最新源码</p>",
    visibleTexts: ["静态候选必须跟随最新源码 最新来源", "静态候选必须跟随最新源码"],
    sandbox: "allow-same-origin",
    expectedSnippet: "最新来源",
    expectedVisibleCount: 2,
  });
});
