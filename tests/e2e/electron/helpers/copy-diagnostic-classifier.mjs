export const COPY_DIAGNOSTIC_CLASSIFICATIONS = Object.freeze({
  "wrong element selected": "选错元素",
  "stale UI capability cache": "UI 能力缓存过期",
  "live capability judgement wrong": "实时能力判断错误",
  "prior edit not settled": "前一轮编辑未收尾",
});

export function classifyCopyDiagnostic(snapshot) {
  const planned = snapshot.planned;
  const relocated = snapshot.relocated;
  if (
    !planned.sourceTarget.unique
    || planned.sourceTarget.stableId !== planned.stableId
    || planned.sourceTarget.tag !== planned.tag
    || !planned.sourceTarget.codeUnitRange
    || !planned.sourceTarget.utf8ByteRange
    || !relocated?.sameAsPlanned
    || snapshot.commandBoundary.targetStableId !== planned.stableId
  ) return "wrong element selected";

  if (
    !snapshot.nativeTextSession.ended
    || !snapshot.nativeTextSession.probeEnded
    || snapshot.runtime.candidateCount !== 0
    || snapshot.runtime.handoff !== null
    || snapshot.runtime.renderVerified !== "true"
    || snapshot.source.renderedProjectionStale !== "false"
    || !snapshot.source.workingEqualsDisplayed
  ) return "prior edit not settled";

  if (!relocated.selectedMarker) return "wrong element selected";

  const executedAvailability = snapshot.commandBoundary.executedAvailability
    ?? snapshot.commandBoundary.availability;
  if (
    snapshot.uiProjection.availability !== snapshot.commandBoundary.availability
    || snapshot.uiProjection.availability !== executedAvailability
  ) return "stale UI capability cache";

  return "live capability judgement wrong";
}
