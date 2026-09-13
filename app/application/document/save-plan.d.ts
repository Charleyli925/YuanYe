export type DocumentPlan =
  | Readonly<{ kind: "ready"; action?: "idle" | "write"; revision?: number }>
  | Readonly<{ kind: "wait" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planDocumentEnqueue(input?: {
  disposed?: boolean;
  persistState?: string;
}): DocumentPlan;

export function planDocumentSave(input?: {
  disposed?: boolean;
  flushInFlight?: boolean;
  pendingWrite?: { sourcePath?: string } | null;
  editRevision?: number;
  lastPersistedRevision?: number;
}): DocumentPlan;

export function planDocumentLeaveReadiness(input?: {
  obligationsResolved?: boolean;
  hasPendingNativeEdit?: boolean;
  hasHistoryAction?: boolean;
  persistState?: string;
  pendingWrite?: boolean;
  flushInFlight?: boolean;
  editRevision?: number;
  lastPersistedRevision?: number;
  sourcePath?: string;
  persistedSourceSha256?: string;
  workingHtmlSha256?: string;
  canvasStatus?: string;
  renderedSha256?: string;
  canvasRenderedSha256?: string;
}): Readonly<{ kind: "ready"; action: "reuse-verified" | "full-check" }>;

export function planDocumentLeaveAfterDrain(input?: {
  editRevision?: number;
  cutoffRevision?: number;
  pendingWrite?: boolean;
  flushInFlight?: boolean;
  hasHistoryAction?: boolean;
  recoveryProtected?: boolean;
}): DocumentPlan;

export function planDocumentLeaveProtection(input?: {
  needsSourceProtection?: boolean;
  sourcePath?: string;
  lastPersistedRevision?: number;
  cutoffRevision?: number;
  committedSourceSha256?: string;
  persistedSourceSha256?: string;
  workingHtmlSha256?: string;
  protectionHtmlSha256?: string;
  recoveryProtected?: boolean;
}): DocumentPlan;
