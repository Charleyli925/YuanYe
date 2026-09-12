import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let fixtureJavaScript;
test.beforeAll(async () => {
  const entry = path.join(root, "review-annotation-fallback-fixture.js");
  const result = await build({
    configFile: false, logLevel: "silent",
    plugins: [{ name: "review-annotation-fallback-fixture",
      resolveId: (id) => id === entry ? `\0${entry}` : null,
      load: (id) => id === `\0${entry}` ? `
        export * from ${JSON.stringify(path.join(root, "app/workbench/review-document.ts"))};
        export { appendTrustedReviewProjectionFact } from ${JSON.stringify(path.join(root, "app/lib/review-projection-facts.js"))};
      ` : null,
    }],
    build: { write: false, minify: false, lib: { entry, name: "ReviewFallbackFixture", formats: ["iife"] } },
  });
  fixtureJavaScript = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
});

test("canonical annotation overflow rebuilds clean pages with comments and paired interactions", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: fixtureJavaScript });
  const result = await page.evaluate(() => {
    const api = globalThis.ReviewFallbackFixture;
    const id = (index) => `pr1_00000000000040008000${String(index).padStart(12, "0")}`;
    const before = `<!doctype html><html data-pageroot-id="${id(1)}"><head data-pageroot-id="${id(2)}"></head>
      <body data-pageroot-id="${id(3)}"><nav data-pageroot-id="${id(4)}">
      <button data-pageroot-id="${id(5)}" role="tab" aria-controls="details-panel">Details</button></nav>
      <section data-pageroot-id="${id(6)}" id="details-panel" role="tabpanel">
      <p data-pageroot-id="${id(7)}" id="comment-host">Alpha old statement.</p>
      <button data-pageroot-id="${id(8)}" id="paired-action">Do action</button></section></body></html>`;
    const after = before.replace("old statement", "new statement");
    let injected = false;
    let partialMarkers = 0;
    const originalSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      originalSet.call(this, name, value);
      if (injected || name !== "data-pageroot-review-marker") return;
      injected = true;
      partialMarkers = this.ownerDocument.querySelectorAll("span[data-pageroot-review-text]").length;
      let facts = [];
      for (let index = 0; index < 25; index += 1) {
        facts = api.appendTrustedReviewProjectionFact(facts, {
          id: `overflow-${index}`, type: "structure", semanticOwnerId: `owner-${index}`,
          geometryOwnerId: `geometry-${index}`, scope: "element", operation: "insert", tone: "added",
        });
      }
    };
    let documents;
    try {
      documents = api.buildReviewDocuments(before, after, {
        sessionId: "fallback-review", sourcePath: "/tmp/synthetic-review.html", externalBootstrap: true,
        comments: [{ key: "frozen-comment", text: "Keep this requirement", target: {
          selector: "#comment-host", label: "Alpha", level: "element", tagName: "p",
          sourceAnchor: { elementId: id(7) },
        } }],
      });
    } finally {
      Element.prototype.setAttribute = originalSet;
    }
    const parser = new DOMParser();
    const inspect = (html) => {
      const doc = parser.parseFromString(html, "text/html");
      return {
        text: doc.getElementById("comment-host")?.textContent,
        wrappers: doc.querySelectorAll("span[data-pageroot-review-text]").length,
        markers: doc.querySelectorAll("[data-pageroot-review-marker],[data-pageroot-outline-id]").length,
        panel: doc.getElementById("details-panel")?.getAttribute("data-pageroot-review-panel-key"),
        action: doc.getElementById("paired-action")?.getAttribute("data-pageroot-review-action-key"),
        sourceIds: doc.querySelectorAll("[data-pageroot-id]").length,
      };
    };
    return {
      injected, partialMarkers, availability: documents.annotationAvailability,
      before: inspect(documents.before), after: inspect(documents.after),
      factCounts: [documents.changes.length, documents.outline.length, documents.focusGroups.length],
      comments: documents.commentGroups, targets: documents.commentTargets,
      visual: [documents.visualBinding.identity, documents.visualEvidence.length],
      bootstrap: [documents.bootstrapJavaScript.before.length, documents.bootstrapJavaScript.after.length],
    };
  });
  expect(result.injected).toBe(true);
  expect(result.partialMarkers).toBeGreaterThan(0);
  expect(result.availability).toBe("unavailable");
  expect(result.factCounts).toEqual([0, 0, 0]);
  expect(result.before.text).toBe("Alpha old statement.");
  expect(result.after.text).toBe("Alpha new statement.");
  expect(result.before.wrappers + result.after.wrappers + result.before.markers + result.after.markers).toBe(0);
  expect(result.before.panel).toBeTruthy();
  expect(result.before.panel).toBe(result.after.panel);
  expect(result.before.action).toBeTruthy();
  expect(result.before.action).toBe(result.after.action);
  expect([result.before.sourceIds, result.after.sourceIds]).toEqual([8, 8]);
  expect(result.comments[0].items[0].text).toBe("Keep this requirement");
  expect(result.targets).toHaveLength(1);
  expect(result.visual[0]).toBe("supported");
  expect(result.visual[1]).toBeGreaterThan(0);
  expect(result.bootstrap.every((size) => size > 0)).toBe(true);
});

test("formal Review projection still rejects the exact-atom bootstrap budget", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: fixtureJavaScript });
  const outcome = await page.evaluate(async () => {
    const api = globalThis.ReviewFallbackFixture;
    const original = "<!doctype html><html><body><p>Original</p></body></html>";
    const facts = await api.buildReviewSourceFactsAsync(original, original);
    const doc = new DOMParser().parseFromString(original, "text/html");
    for (let index = 0; index < 4097; index += 1) {
      const element = doc.createElement("p");
      element.setAttribute("data-pageroot-review-marker", `change-${index}`);
      element.setAttribute("data-pageroot-review-projection-facts", JSON.stringify([{
        id: `fact-${index}`, type: "structure", semanticOwnerId: `owner-${index}`,
        geometryOwnerId: `geometry-${index}`, scope: "element", operation: "insert", tone: "added",
      }]));
      doc.body.append(element);
    }
    try {
      api.projectReviewDocuments(original, {
        ...facts, annotatedBeforeHtml: doc.documentElement.outerHTML,
      }, { sessionId: "exact-atom-budget", externalBootstrap: true });
      return "unexpected-success";
    } catch (cause) {
      return cause.message;
    }
  });
  expect(outcome).toBe("Review exact atom occurrence payload exceeds its bootstrap contract.");
});
