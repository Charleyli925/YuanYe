import type { BridgeClient } from "./bridge-client.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession, PersistedBoundaryResult } from "./document-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type {
  OpenDocumentMemoryHistory,
  SourceHistorySession,
} from "./source-history-session.js";
import type { VersionSession } from "./version-session.js";
import type { DocumentWorkflowCodecs } from "./document-workflow-codecs.js";
import type { SourceHistoryEntry } from "../domain/source-history.js";

export type DocumentWorkflowOutcome<T> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; context: ProjectContext }>;

export type DocumentWorkflowRecoveryJournal = Readonly<{
  commit(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  readVerified(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>> | null>;
  rebase?(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  remove(input: Readonly<Record<string, unknown>>): Promise<Readonly<{ removed: boolean }>>;
}>;

export type DocumentWorkflowTransitionAuthority = Readonly<{
  recoveryIdentity: unknown;
  sourceHistory: OpenDocumentMemoryHistory | null;
  sourceHistoryOperations: SourceHistoryEntry[];
}>;

export type DocumentWorkflowCanvasPort = Readonly<{
  invalidateRenderAcks(): void;
  verifyRendered?(
    html: string,
    sourceSha256: string,
    context?: ProjectContext,
  ): Promise<void>;
  freeze?(reason: string): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  adoptHistorySource?(html: string, target: unknown, selection: unknown): void;
}>;

export type DocumentWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    "autosave" | "source" | "workspace" | "resolveConflict"
  > & Partial<Pick<BridgeClient, "sourcePreview" | "sourceStat">>;
  ensureRegistered(input: {
    sourcePath?: string;
    expectedSourceSha256?: string | null;
    adoptCanonicalSource?: boolean;
  }): Promise<DocumentWorkflowOutcome<ProjectContext>>;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  versionSession: VersionSession;
  sourceHistorySession: SourceHistorySession;
  codecs: DocumentWorkflowCodecs;
  ports: Readonly<{
    hash: Readonly<{ sha256(html: string): Promise<string> }>;
    recoveryJournal?: DocumentWorkflowRecoveryJournal | null;
    canvas: DocumentWorkflowCanvasPort;
  }>;
  scheduler?: Readonly<{
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  }>;
  clock: Readonly<{ now(): number }>;
}>;

export type DocumentLeaveBoundary = Readonly<{
  context: ProjectContext | null;
  epoch: number;
  revision: number;
  html: string;
}>;

export class DocumentWorkflow {
  constructor(options: DocumentWorkflowConstruction);
  subscribeEvents(listener: (event: Readonly<Record<string, unknown>>) => void): () => void;
  dispose(): void;
  readonly hasHistoryAction: boolean;
  readonly recoveryIdentity: unknown;
  readonly recoveryCheckpoint: Readonly<Record<string, unknown>> | null;
  readonly pendingAuditEvents: unknown[];
  replaceRecoveryIdentity(identity: unknown): unknown;
  inspectLeaveReadiness(input?: { hasPendingNativeEdit?: boolean }): Readonly<{
    kind: "ready";
    action: "reuse-verified" | "full-check";
    sourceSha256: string;
  }>;
  captureLeaveBoundary(): DocumentLeaveBoundary;
  verifyLeaveBoundary(boundary: DocumentLeaveBoundary, input?: {
    needsSourceProtection?: boolean;
    committedSourceSha256?: string;
  }): import("./document/save-plan.js").DocumentPlan;
  canProtectForDetach(context?: ProjectContext | null): boolean;
  hasVerifiedRecoveryCheckpoint(input?: {
    context?: ProjectContext | null;
    revision?: number;
  }): boolean;
  hasVerifiedProtectionEvidence(input?: {
    context?: ProjectContext | null;
    revision?: number;
  }): boolean;
  verifiedProtectionEvidence(input?: {
    context?: ProjectContext | null;
    revision?: number;
  }): Readonly<{
    kind: "recoveryVerified" | "exportVerified";
    revision: number;
    htmlSha256: string;
    journalSha256?: string;
    path?: string;
  }> | null;
  recordVerifiedExport(input: {
    context?: ProjectContext | null;
    html: string;
    revision: number;
    exported: { path: string; sha256: string };
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  protectForDetach(input?: {
    context?: ProjectContext | null;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  captureProjectTransitionAuthority(): DocumentWorkflowTransitionAuthority;
  restoreProjectTransitionAuthority(input?: {
    authority?: DocumentWorkflowTransitionAuthority | null;
    context?: ProjectContext;
    sourceSha256?: string | null;
  }): boolean;
  resetForProjectTransition(options?: { clearRecovery?: boolean; context?: Partial<ProjectContext> }): void;
  clearRecovery(context?: Partial<ProjectContext>): void;
  rebaseRecoveryJournal(input: {
    previousContext: Partial<ProjectContext>;
    context: Partial<ProjectContext>;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  clearAutosaveTimer(): void;
  clearAudit(): void;
  activateSourceHistory(input: {
    context: ProjectContext;
    sourceSha256: string;
    history: unknown;
    preservePending?: boolean;
  }): DocumentWorkflowOutcome<{ active: boolean }>;
  waitForHistoryAction(): Promise<DocumentWorkflowOutcome<{ idle: boolean }>>;
  enqueueEdit(input: {
    html: string;
    mutation?: unknown;
    sourceTransaction?: unknown;
    context?: Partial<ProjectContext>;
  }): DocumentWorkflowOutcome<{ revision: number; queued: boolean }>;
  flush(input?: { throughRevision?: number }): Promise<DocumentWorkflowOutcome<{ revision: number; idle?: boolean }>>;
  performHistoryAction(input: {
    direction: "undo" | "redo";
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reloadAuthority(input?: {
    context?: ProjectContext;
    acceptExternalConflict?: boolean;
    externalAuthorityAccepted?: boolean;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  previewExternalSource(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  observeExternalSourceChange(input?: {
    sourcePath?: string | null;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  forceUnlockConflict(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  ensureCurrentCanvas(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reconcileBoundary(input: {
    frozenHtml: string;
    reportedSourceSha256?: string | null;
    cutoffRevision: number;
    identity?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<DocumentWorkflowOutcome<PersistedBoundaryResult>>;
  recoverAutosave(input: {
    context: ProjectContext;
    currentSourceSha256: string;
    serverRevision?: number;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  adoptConflictCandidate(input: Record<string, unknown>): DocumentWorkflowOutcome<Record<string, unknown>>;
}
