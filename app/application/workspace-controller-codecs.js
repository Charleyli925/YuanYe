import { validateVersionSessionVersions } from "./version-session.js";

function requiredFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`WorkspaceController codec ${name} must be a function.`);
  }
  return value;
}

// Decode the complete response before any Session publishes it. DraftSession
// retains persisted records; CommentSession receives their display models.
export function decodeWorkspaceResponse(payload, codecs) {
  const versions = validateVersionSessionVersions(
    codecs.versionsFromWorkspace(payload),
  );
  const source = codecs.draftAuthorityFromWorkspace(payload);
  const revision = Number(source.draftRevision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("工作区草稿序号无效。");
  }
  const draft = { ...source, draftRevision: revision };
  for (const key of ["comments", "changeEvents", "deletedCommentIds", "appliedOperationIds"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) {
      throw new TypeError(`工作区草稿 ${key} 无效。`);
    }
    draft[key] = source[key] ?? [];
  }
  const comments = codecs.commentsFromRecords(draft.comments);
  const changeEvents = codecs.changesFromDraftRecords(draft.changeEvents);
  if (comments.length !== draft.comments.length || changeEvents.length !== draft.changeEvents.length) {
    throw new TypeError("工作区草稿包含无法解码的记录，已保留原会话。");
  }
  return Object.freeze({ versions, draft: Object.freeze(draft), comments, changeEvents });
}

// The controller deliberately receives these pure codecs from its composition
// root. The existing renderer codecs remain their single decoder source during
// the staged migration; importing app/workbench from application code would
// reverse the architecture boundary.
export function createWorkspaceControllerCodecs({
  isRecord,
  sameSourcePath,
  draftAuthorityFromWorkspace,
  authoritativeDraftRevision,
  recoveryIdentityFromRecord,
  versionsFromWorkspace,
  commentsFromRecords,
  changesFromDraftRecords,
  projectVersionSummariesFromVersions,
  projectVersionSummariesFromWorkspace,
  rebindTargetsPreservingGlobal,
} = {}) {
  return Object.freeze({
    isRecord: requiredFunction(isRecord, "isRecord"),
    sameSourcePath: requiredFunction(sameSourcePath, "sameSourcePath"),
    draftAuthorityFromWorkspace: requiredFunction(
      draftAuthorityFromWorkspace,
      "draftAuthorityFromWorkspace",
    ),
    authoritativeDraftRevision: requiredFunction(
      authoritativeDraftRevision,
      "authoritativeDraftRevision",
    ),
    recoveryIdentityFromRecord: requiredFunction(
      recoveryIdentityFromRecord,
      "recoveryIdentityFromRecord",
    ),
    versionsFromWorkspace: requiredFunction(
      versionsFromWorkspace,
      "versionsFromWorkspace",
    ),
    commentsFromRecords: requiredFunction(commentsFromRecords, "commentsFromRecords"),
    changesFromDraftRecords: requiredFunction(changesFromDraftRecords, "changesFromDraftRecords"),
    projectVersionSummariesFromVersions: requiredFunction(projectVersionSummariesFromVersions, "projectVersionSummariesFromVersions"),
    projectVersionSummariesFromWorkspace: requiredFunction(projectVersionSummariesFromWorkspace, "projectVersionSummariesFromWorkspace"),
    rebindTargetsPreservingGlobal: requiredFunction(
      rebindTargetsPreservingGlobal,
      "rebindTargetsPreservingGlobal",
    ),
  });
}
