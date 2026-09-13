import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import {
  appendTrustedReviewProjectionFact,
  ReviewProjectionFactOverflowError,
} from "../app/lib/review-projection-facts.js";
import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "../app/application/review-analysis-session.js";

// Execute the production orchestration with bounded collaborator fixtures.
// Real DOM cleanup/comment/panel behavior belongs to the Browser companion.
const source = readFileSync(new URL("../app/workbench/review-document.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("review-document.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set([
  "emptySourceFacts", "sourceFactsFromDocuments", "prepareReviewSourcePairSteps",
  "buildReviewSourceFactSteps", "runYieldingAnalysis",
]);
const declarations = file.statements.filter((node) => (
  ts.isFunctionDeclaration(node) && names.has(node.name?.text)
)).map((node) => source.slice(node.getStart(file), node.end)).join("\n");
assert.equal(file.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).length, names.size);
const compiled = ts.transpileModule(declarations, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText;

function fact(index) {
  return { id: `fact-${index}`, type: "structure", semanticOwnerId: `owner-${index}`,
    geometryOwnerId: `geometry-${index}`, scope: "element", operation: "insert", tone: "added" };
}

function harness({ count = 25, merge = false, failure, visualFailure, initialParseFailure,
  parseFailure, pairFailure, serializeFailure,
  onPhase = () => {} } = {}) {
  const parsed = [];
  const visual = { binding: { identity: "supported", sessionId: "source-facts" }, evidence: [{ stableId: "source-id" }] };
  let annotationCalls = 0;
  const context = vm.createContext({
    ReviewProjectionFactOverflowError,
    DOMParser: class {
      parseFromString(html) {
        if (initialParseFailure) throw initialParseFailure;
        if (parsed.length === 2 && parseFailure) throw parseFailure;
        const doc = { html, reserved: true, marker: false, facts: [], panels: false, actions: false };
        parsed.push(doc);
        return doc;
      }
    },
    clearReservedReviewMarkup(doc) { doc.reserved = false; },
    annotatePanelPairs(before, after) {
      if (parsed.length === 4 && pairFailure) throw pairFailure;
      before.panels = after.panels = true;
    },
    annotateActionPairs(before, after) { before.actions = after.actions = true; },
    buildReviewVisualEvidence() {
      if (visualFailure) throw visualFailure;
      return visual;
    },
    *annotateReviewSourceFactSteps(before, after) {
      annotationCalls += 1;
      // Model a partial disposable text wrapper before the actual trusted
      // accumulator reaches its canonical-fact boundary.
      before.marker = after.marker = true;
      yield "partial-marker";
      if (failure) throw failure;
      for (let index = 0; index < count; index += 1) {
        before.facts = appendTrustedReviewProjectionFact(before.facts, fact(merge && index === 24 ? 0 : index));
      }
      return { changes: [{ id: "change-1" }], outline: [], focusGroups: [], diagnostics: [] };
    },
    serializeReviewMarkup(doc) {
      if (serializeFailure) throw serializeFailure;
      return JSON.stringify(doc);
    },
    yieldReviewAnalysisTask: () => new Promise((resolve) => setImmediate(resolve)),
    measureReviewAnalysisPhase: (phase) => onPhase(phase, parsed.length),
    REVIEW_ANALYSIS_PHASES: [],
  });
  new vm.Script(compiled).runInContext(context);
  return {
    parsed, visual,
    get annotationCalls() { return annotationCalls; },
    build: (control = {}) => context.runYieldingAnalysis(context.buildReviewSourceFactSteps("before-original", "after-original"), control),
  };
}

for (const [count, merge, availability] of [[24, false, "available"], [25, true, "available"], [25, false, "unavailable"]]) {
  test(`canonical fact boundary: count=${count}, merge=${merge}`, async () => {
    const h = harness({ count, merge });
    const result = await h.build();
    assert.equal(result.annotationAvailability, availability);
    assert.equal(h.annotationCalls, 1);
    assert.equal(h.parsed.length, availability === "unavailable" ? 4 : 2);
    assert.equal(result.visualBinding, h.visual.binding);
    assert.equal(result.visualEvidence, h.visual.evidence);
    if (availability === "available") assert.equal(result.changes.length, 1);
    else {
      assert.equal(result.changes.length + result.outline.length + result.focusGroups.length, 0);
      for (const [html, original] of [[result.annotatedBeforeHtml, "before-original"], [result.annotatedAfterHtml, "after-original"]]) {
        assert.deepEqual(JSON.parse(html), { html: original, reserved: false, marker: false, facts: [], panels: true, actions: true });
      }
      assert.equal(h.parsed[0].marker, true, "failed analysis really left partial markup");
    }
  });
}

for (const failure of [new Error("unknown"), new RangeError("budget"), new TypeError("invalid"),
  Object.assign(new Error("forged"), { name: "ReviewProjectionFactOverflowError", code: "REVIEW_PROJECTION_FACTS_OVERFLOW" })]) {
  test(`only the actual overflow class recovers: ${failure.message}`, async () => {
    const h = harness({ failure });
    await assert.rejects(h.build(), (cause) => cause === failure);
    assert.equal(h.parsed.length, 2);
  });
}

for (const key of ["parseFailure", "pairFailure", "serializeFailure"]) {
  test(`fallback ${key} rejects without retrying or publishing`, async () => {
    const failure = new Error(key === "serializeFailure" ? "exact atom serialization budget" : key);
    const h = harness({ [key]: failure });
    await assert.rejects(h.build(), (cause) => cause === failure);
    assert.equal(h.annotationCalls, 1);
    assert.ok(h.parsed.length <= 4);
  });
}

for (const key of ["visualFailure", "initialParseFailure", "serializeFailure"]) {
  test(`even the actual overflow class outside annotation rejects: ${key}`, async () => {
    const failure = new ReviewProjectionFactOverflowError();
    const h = harness({ count: 24, [key]: failure });
    await assert.rejects(h.build(), (cause) => cause === failure);
    assert.equal(h.parsed.length, key === "serializeFailure" ? 2 : 0);
  });
}

for (const stage of ["before", "partial-marker", "annotation-unavailable", "recovered-pair", "complete"]) {
  test(`cancel ${stage} never publishes or caches annotation fallback`, async () => {
    const session = new ReviewAnalysisSession();
    let cancelled = false;
    const h = harness({ onPhase(phase, parsed) {
      if (!cancelled && (phase === stage || (stage === "recovered-pair" && phase === "actions" && parsed === 4))) {
        cancelled = true;
        session.cancel();
      }
    } });
    const pending = session.analyze({ key: "exact-pair", compute: ({ isCancelled }) => h.build({ isCancelled }) });
    if (stage === "before") session.cancel();
    await assert.rejects(pending, ReviewAnalysisCancelledError);
    assert.equal(session.peek("exact-pair"), null);
    if (stage === "before") assert.equal(h.parsed.length, 0);
    if (stage === "annotation-unavailable") assert.equal(h.parsed.length, 2);
    session.dispose();
  });
}
