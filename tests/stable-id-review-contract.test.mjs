import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(productRoot, relativePath), "utf8");

test("ADR 0066/0068 and the architecture contract keep source Review authoritative", () => {
  const adr = read("docs/decisions/0066-stable-id-source-review.md");
  const visualAdr = read("docs/decisions/0068-review-visual-verdict-gate.md");
  const architecture = read("docs/ARCHITECTURE_CONTRACT.md");
  const normalizedAdr = adr.replace(/\s+/gu, " ");
  const normalizedVisualAdr = visualAdr.replace(/\s+/gu, " ");
  const normalizedArchitecture = architecture.replace(/\s+/gu, " ");

  for (const required of [
    "valid, unique `data-pageroot-id`",
    "same-parent reorder or cross-parent move",
    "Any element that carries `data-pageroot-id` claims persistent identity",
    "exact-subtree, relocation, singleton, weighted or fuzzy pairing",
    "appears as element removal plus addition even when its content or markup is unchanged",
    "globally ambiguous across the whole document pair",
    "semantic source matcher remains",
    "same persistent ID remains paired when the authored element tag changes",
    "groups common IDs by parent in one pass",
    "sibling indexes are likewise built once per parent",
    "compares stable descendants through their individual IDs",
    "Moving text between different stable descendants",
    "Candidate regions and their pairing are frozen from the authored DOM",
    "distinct semantic and geometry owner namespaces",
    "suppresses only that root's false presence fact",
    "images, modules and other non-text elements",
    "ambiguous reorder attaches `元素顺序调整` to the shared stable parent",
    "`added`, `removed`, `moved`, `reordered`, `attribute` and `style`",
    "CSS/Script source-only changes cannot fan out",
  ]) {
    assert.ok(normalizedAdr.includes(required), `ADR 0066 lost required contract: ${required}`);
  }
  for (const required of [
    "Review is a position-bound page comparison",
    "private `ReviewDiagnostic` records",
    "never create a `ReviewChange`, `<html>` marker, mask hole",
    "Candidate with diagnostics but no position-bound change",
    "side-specific `ReviewPresentation`",
    "panel key and a Stable-ID-bound `<details>` disclosure",
    "actual marker/evidence host, not the coarse section pair",
    "Entry starts in overview with null focus",
    "Element changes retain quiet page-edge revision bars",
    "Same-parent topology names a concrete moved element only",
    "attaches `元素顺序调整` to the shared Stable-ID parent",
    "Review is a no-floating-notice surface",
    "opens the existing AI conversation decision panel",
    "fixed to the right edge of the Before pane",
    "aggregate to `评2`/`评3`",
  ]) {
    assert.ok(normalizedVisualAdr.includes(required), `ADR 0068 lost required contract: ${required}`);
  }
  for (const required of [
    "user-visible `ReviewChange` is position-bound",
    "private `ReviewDiagnostic` records",
    "cannot create `<html>` markers, mask holes, outline entries",
    "Equal bounded summaries cannot prove arbitrary CSS/Script behavior",
    "Candidate with diagnostics but no position-bound change opens the same Review",
    "All text facts and only the active element change cut mask holes",
    "side-specific `ReviewPresentation`",
    "actual marker/evidence host",
    "renders no non-blocking visual status, scope card, candidate-attention notice or global Toast",
    "opens the existing AI conversation decision panel",
  ]) {
    assert.ok(normalizedArchitecture.includes(required), `Architecture Contract lost boundary: ${required}`);
  }
});
