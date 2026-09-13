import type {
  ReviewChange,
  ReviewFocusGroup,
  ReviewSide,
} from "./review-document";
import type { ReviewFocusRegionSelection } from "./review-state";
import type { ReviewVisualVerdict } from "./review/review-visual-model.js";
import type { SourceEvidence } from "./review/review-visual-model.js";

export type ReviewPaintPlanSide = Readonly<{
  evidenceMarks: "all-source-facts";
  navigationCues: "all-regions";
  contextMask: Readonly<{ regionId: string }> | null;
  focusOutline: Readonly<{ regionId: string }> | null;
}>;

export type ReviewPaintPlan = Readonly<Record<ReviewSide, ReviewPaintPlanSide>>;

const EMPTY_SIDE: ReviewPaintPlanSide = Object.freeze({
  evidenceMarks: "all-source-facts",
  navigationCues: "all-regions",
  contextMask: null,
  focusOutline: null,
});

export const EMPTY_REVIEW_PAINT_PLAN: ReviewPaintPlan = Object.freeze({
  before: EMPTY_SIDE,
  after: EMPTY_SIDE,
});

function isPureStyleEvidence(evidence: SourceEvidence) {
  return evidence.kinds.length > 0 && evidence.kinds.every((kind) => kind === "style");
}

/** Only region-local evidence that can affect an optional outline needs observing. */
export function eligibleReviewVisualEvidence({
  focusGroups,
  changes,
  visualEvidence,
}: Readonly<{
  focusGroups: readonly ReviewFocusGroup[];
  changes: readonly ReviewChange[];
  visualEvidence: readonly SourceEvidence[];
}>): SourceEvidence[] {
  const visualGroups = focusGroups.filter((group) => group.focusOutlinePolicy === "visual-change");
  if (!visualGroups.length) return [];
  const pureStyleEvidence = visualEvidence.filter(isPureStyleEvidence);
  if (!pureStyleEvidence.length) return [];
  const changesById = new Map(changes.map((change) => [change.id, change]));
  const referencedIds = new Set<string>();
  for (const group of visualGroups) {
    for (const region of [...group.regions.before, ...group.regions.after]) {
      const changeEvidence = new Set(region.changeIds.flatMap((id) => (
        changesById.get(id)?.evidenceStableIds || []
      )));
      for (const stableId of region.visualEvidenceStableIds) {
        if (changeEvidence.has(stableId)) referencedIds.add(stableId);
      }
    }
  }
  return pureStyleEvidence.filter((evidence) => referencedIds.has(evidence.stableId));
}

function regionHasConfirmedVisualChange(
  region: ReviewFocusGroup["regions"][ReviewSide][number],
  changes: readonly ReviewChange[],
  visualEvidence: readonly SourceEvidence[],
  verdicts: Readonly<Record<string, ReviewVisualVerdict>>,
) {
  return region.visualEvidenceStableIds.some((stableId) => {
    if (verdicts[stableId] !== "changed") return false;
    const sourceCandidate = visualEvidence.find((evidence) => evidence.stableId === stableId);
    // A mixed text/attribute candidate cannot prove that this locality's style
    // changed. Failing closed may omit a box, but never borrows unrelated proof.
    if (!sourceCandidate || !isPureStyleEvidence(sourceCandidate)) return false;
    return changes.some((change) => (
      region.changeIds.includes(change.id)
      && (change.evidenceStableIds || []).includes(stableId)
    ));
  });
}

export function buildReviewPaintPlan({
  focusGroups,
  changes,
  visualEvidence,
  visualVerdicts,
  activeFocusGroupId,
  activeFocusRegionIds,
}: Readonly<{
  focusGroups: readonly ReviewFocusGroup[];
  changes: readonly ReviewChange[];
  visualEvidence: readonly SourceEvidence[];
  visualVerdicts: Readonly<Record<string, ReviewVisualVerdict>>;
  activeFocusGroupId: string | null;
  activeFocusRegionIds: ReviewFocusRegionSelection;
}>): ReviewPaintPlan {
  if (!activeFocusGroupId) return EMPTY_REVIEW_PAINT_PLAN;
  const group = focusGroups.find((candidate) => candidate.id === activeFocusGroupId);
  if (!group) return EMPTY_REVIEW_PAINT_PLAN;

  const sidePlan = (side: ReviewSide): ReviewPaintPlanSide => {
    const regionId = activeFocusRegionIds[side];
    const region = group.regions[side].find((candidate) => candidate.id === regionId);
    if (!regionId || !region) {
      return EMPTY_SIDE;
    }
    const outlineAllowed = group.focusOutlinePolicy === "source-change"
      || (group.focusOutlinePolicy === "visual-change"
        && regionHasConfirmedVisualChange(region, changes, visualEvidence, visualVerdicts));
    const target = Object.freeze({ regionId });
    return Object.freeze({
      evidenceMarks: "all-source-facts",
      navigationCues: "all-regions",
      contextMask: target,
      focusOutline: outlineAllowed ? target : null,
    });
  };

  return Object.freeze({
    before: sidePlan("before"),
    after: sidePlan("after"),
  });
}
