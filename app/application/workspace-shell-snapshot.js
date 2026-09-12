function stableFields(previous, next) {
  if (previous && Object.keys(previous).length === Object.keys(next).length
    && Object.keys(next).every((key) => Object.is(previous[key], next[key]))) return previous;
  return Object.freeze(next);
}

function select(previous, source, keys) {
  if (!source) return null;
  return stableFields(previous, Object.fromEntries(keys.map((key) => [key, source[key]])));
}

/** One disposable presentation projection; omitted local facts are never retained here. */
export function workspaceShellSnapshot(source, previous = null) {
  const comments = source.commentSession;
  const edit = comments?.editSession;
  const commentSession = comments ? stableFields(previous?.commentSession, {
    comments: comments.comments,
    changeEvents: comments.changeEvents,
    deletedCommentIds: comments.deletedCommentIds,
    composerTarget: comments.composerTarget,
    composerCommentId: comments.composerCommentId,
    composerAttachments: comments.composerAttachments,
    composerHasText: Boolean(comments.composerDraft?.trim()),
    editSession: select(previous?.commentSession?.editSession, edit, [
      "commentId", "baselineText", "baselineAttachments", "draftAttachments",
    ]),
  }) : null;
  const run = source.runSession;
  const runSession = run ? stableFields(previous?.runSession, {
    activeRun: run.activeRun,
    recentOutcome: run.recentOutcome,
    activeLocked: run.activeLocked,
    activeSubmission: run.activeSubmission,
    submissionPending: run.submissionPending,
    activeHandoffMayBeRunning: run.activeHandoffMayBeRunning,
    activeHandoffManaged: run.activeHandoffManaged,
    activeHandoff: select(previous?.runSession?.activeHandoff, run.activeHandoff, [
      "sourcePath", "requestId", "attemptId", "mode", "status", "phase",
      "providerId", "runtimeId", "agentName", "agentVersion", "errorCode", "errorMessage",
      "retryable", "safeToRetry", "recoveryKind",
    ]),
  }) : null;
  return stableFields(previous, {
    projectSession: source.projectSession,
    document: source.document,
    commentSession,
    comment: source.comment ? stableFields(previous?.comment, {
      attachmentUploadCount: source.comment.attachmentUploadCount,
      draftError: source.comment.draft?.error || "",
    }) : null,
    runSession,
    run: source.run,
    versionSession: source.versionSession,
    version: source.version,
    project: source.project,
    projectRules: select(previous?.projectRules, source.projectRules, [
      "open", "loading", "error", "saving", "saveError", "compositionActive", "editorGeneration",
    ]),
    editRuntime: source.editRuntime,
    workbenchTabs: source.workbenchTabs,
    documentSurfaceCache: source.documentSurfaceCache,
  });
}
