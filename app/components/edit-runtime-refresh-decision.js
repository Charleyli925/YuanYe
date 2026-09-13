/**
 * Pure product policy for projecting an accepted Working HTML edit.
 * Saving has already succeeded when this decision is consumed; this policy
 * only decides whether the disposable Canvas projection may stay mounted.
 */
export function decideEditRuntimeRefresh({
  hasRuntime = false,
  mutationKind,
  programIdentityChanged = false,
} = {}) {
  if (programIdentityChanged) {
    return Object.freeze({
      action: "candidate-now",
      reason: "program-identity-changed",
      synchronizeCurrentFrame: false,
    });
  }

  const safeInPlaceMutation = mutationKind === "text"
    || mutationKind === "style"
    || mutationKind === "reorder";

  if (!hasRuntime) {
    const synchronizeCurrentFrame = safeInPlaceMutation;
    return Object.freeze({
      action: synchronizeCurrentFrame ? "in-place" : "candidate-now",
      reason: synchronizeCurrentFrame
        ? `static-${mutationKind || "source"}`
        : "static-structural-change",
      synchronizeCurrentFrame,
    });
  }

  if (
    mutationKind === "text"
    || mutationKind === "style"
    || mutationKind === "reorder"
  ) {
    return Object.freeze({
      action: "in-place",
      reason: `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
    });
  }

  return Object.freeze({
    action: "candidate-now",
    reason: `runtime-${mutationKind || "structural"}`,
    synchronizeCurrentFrame: false,
  });
}
