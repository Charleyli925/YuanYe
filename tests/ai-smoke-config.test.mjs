import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GATE_SMOKE_TAG } from "./e2e/smoke-tags.mjs";

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "e2e/electron");

test("AI smoke configuration selects review activation and broad-edit regression paths", async () => {
  const files = (await readdir(electronDir))
    .filter((name) => /^ai-(?:review-adoption|provider-availability|run-lifecycle|candidate-validation|request-comments)\.spec\.mjs$/u.test(name))
    .sort();
  const sources = await Promise.all(files.map((name) => readFile(path.join(electronDir, name), "utf8")));
  const tagged = sources.flatMap((source) => (
    [...source.matchAll(/test\("([^"]+)", \{\n  tag: (\[[^\]]+\]),/gu)]
      .filter((match) => match[2].includes(JSON.stringify(GATE_SMOKE_TAG)))
      .map((match) => match[1])
  ));
  assert.deepEqual(tagged, [
    "a verified AI result stays pending through desktop review until the user accepts it",
    "a broad but related AI return is accepted without a target-scope error",
    "stable-ID Review keeps movement, reorder, attributes and styles position-bound",
    "a rewrite outside <main> is still reviewed",
    "Review keeps Candidate scope diagnostics out of the comparison canvas",
    "CSS and Script comment-only changes open Review without position markers",
    "Script-only visual changes open Review without position markers",
    "a safe simple CSS selector creates one position-bound element change",
    "source Review preserves multi-host text evidence and hidden changes without visual confirmation",
    "accepting a Version shows static Active and unlocks editing before Runtime is granted",
    "two lost committed adoption replies stay pending and recover one decision through restart",
  ]);
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /if \(await processButton\.isVisible\(\)\) await processButton\.click\(\)/u,
      "process-board navigation must wait for its control instead of sampling visibility once",
    );
  }
});
