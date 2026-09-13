import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SEEDED_FAULTS } from "../scripts/seeded-fault-oracles.mjs";
import { assertTestInventory } from "../scripts/generate-test-inventory.mjs";
import { validateImpactMap } from "../scripts/test-gate-core.mjs";

const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));
const ledger = JSON.parse(
  await readFile(new URL("./test-risk-ledger.json", import.meta.url), "utf8"),
);
const ownerIds = new Set(map.rules.map((rule) => rule.id));
const seededFaultIds = new Set(SEEDED_FAULTS.map((fault) => fault.id));

test("HtmlCanvasEditor draft canary includes all three runtime continuity scenarios", async () => {
  const source = await readFile(
    new URL("./e2e/electron/electron-runtime-continuity.spec.mjs", import.meta.url),
    "utf8",
  );
  for (const title of [
    "continuous editing keeps the Runtime document through type, Enter, style and save",
    "continuous editing on a Script page keeps the Runtime document",
    "comment rail and canvas width stay visually continuous while typing in a nested scroller",
    "ending Runtime text editing keeps the document and the sixth blank-line caret",
  ]) {
    assert.match(source, new RegExp(`${title}[\\s\\S]{0,80}@smoke-editing`, "u"));
  }
});

test("Playwright inventory stays aligned with the repository and E2E README", async () => {
  const inventory = await assertTestInventory();
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/electron-runtime-continuity.spec.mjs"));
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/electron-seeded-faults.spec.mjs"));
  assert.ok(inventory.gateFiles.includes("tests/e2e/browser/real-complex-html.gate.mjs"));
  assert.ok(inventory.execution.lanes.some(
    (lane) => lane.id === "browser-dom-editing-compatibility",
  ));
  assert.ok(inventory.execution.filesByStage["on-demand"].includes(
    "tests/e2e/electron/review-annotation-clarity.spec.mjs",
  ));
  assert.equal(
    inventory.execution.lanes.find((lane) => lane.id === "electron-ai").files.includes(
      "tests/e2e/electron/review-annotation-clarity.spec.mjs",
    ),
    false,
  );
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/ai-review-adoption.spec.mjs"));
  assert.equal(
    inventory.specFiles.includes("tests/e2e/browser/native-dom-editing.spec.mjs"),
    false,
  );
});

test("every Playwright spec has a risk ledger owner, oracle and stage", () => {
  assert.equal(ledger.version, 1);
  for (const [file, entry] of Object.entries(ledger.files)) {
    assert.ok(entry.riskId, file);
    assert.ok(ownerIds.has(entry.primaryOwner), `${file} owner ${entry.primaryOwner}`);
    assert.ok(entry.oracle, file);
    assert.match(String(entry.stage), /^(?:edit|draft-canary|ready-full|release|on-demand)$/u, file);
    if (entry.seededFault) {
      assert.ok(seededFaultIds.has(entry.seededFault), `${file} seededFault ${entry.seededFault}`);
    }
  }
});

test("risk ledger covers every Playwright spec file and no retired paths", async () => {
  const inventory = await assertTestInventory();
  const missing = inventory.specFiles.filter((file) => !ledger.files[file]);
  assert.deepEqual(missing, []);
  const extra = Object.keys(ledger.files).filter((file) => !inventory.specFiles.includes(file));
  assert.deepEqual(extra, []);
});

test("ledger ready-full files are selected by an actual Ready Playwright config", async () => {
  const inventory = await assertTestInventory();
  const readyFiles = new Set(inventory.execution.filesByStage["ready-full"] || []);
  const unexecuted = Object.entries(ledger.files)
    .filter(([, entry]) => entry.stage === "ready-full")
    .map(([file]) => file)
    .filter((file) => !readyFiles.has(file));
  assert.deepEqual(unexecuted, []);
});
