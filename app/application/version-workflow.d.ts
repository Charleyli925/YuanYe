import type { BridgeClient } from "./bridge-client.js";
import type { CommentWorkflow } from "./comment-workflow.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentWorkflow } from "./document-workflow.js";
import type { DocumentSession } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { ProjectWorkflow } from "./project-workflow.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { CandidateAssessment } from "../domain/run-lifecycle.js";

export type VersionWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Readonly<Record<string, unknown>> }>;

export type HistoryCreationResult = Readonly<{
  status: "not-created"; operationId: string; projectId: string; documentId: string;
  aborted?: boolean; code?: string; reason?: string;
}> | Readonly<{
  status: "created"; operationId: string; projectId: string; documentId: string;
  versionId: string; versionOrdinal: number; workingCopyId: string;
  basedOnVersionId: string; previousVersionId: string; contentSha256: string;
  sourcePath: string; openedAt: string | null;
  recoveryState: "pending" | "opened" | "superseded";
}>;

export type VersionNavigationPhase = "idle" | "activating" | "opening" | "history" | "current" | "creating";

export type VersionWorkflowSnapshot = Readonly<{
  creation?: Readonly<{ phase: "creating" | "created" | "opening" | "opened" | "superseded" | "open-failed" | "not-created" | "unknown"; operationId: string; context: ProjectContext; result?: HistoryCreationResult }>;
  navigation: Readonly<{
    phase: VersionNavigationPhase;
    operationId: string | null;
    generation: number;
  }>;
  review: Readonly<{
    phase: "idle" | "preparing";
    operationId: string | null;
  }>;
}>;

export type VersionWorkflowEvent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type VersionReviewCandidate = Readonly<{
  operationId: string;
  operationKey: string;
  projectId: string;
  documentId: string;
  requestId: string;
  attemptId: string;
  sourcePath: string;
  versionId: string;
  baseSnapshotSha256: string;
  content: string;
  sha256: string;
  candidateAssessment?: CandidateAssessment;
}>;

export type VersionReviewLease = Readonly<{
  operationKey: string;
  beforeHtml: string;
}>;

export type VersionWorkflowCodecs = Readonly<{
  versionsFromWorkspace(payload: Record<string, unknown>): unknown[];
  draftAuthorityFromWorkspace(payload: Record<string, unknown>): Record<string, unknown>;
  commentsFromRecords(value: unknown): unknown[];
  changesFromDraftRecords(value: unknown): unknown[];
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null | undefined, right: string | null | undefined): boolean;
  operationKey(run: Record<string, unknown>): string;
  errorMessage(cause: unknown, fallback: string): string;
}>;

export type VersionWorkflowCanvasPort = Readonly<{
  deferCommand?(
    kind: string,
    run: () => void,
    options?: Record<string, unknown>,
  ): boolean;
  freezeWorkingSource?(input: Record<string, unknown>): {
    ok: boolean;
    reason?: string;
  } | undefined;
  freeze(reason: string): Readonly<{ ok: boolean; html?: string; reason?: string }>;
  verifyRendered(
    html: string,
    sha256: string,
    context?: ProjectContext,
  ): Promise<void>;
  invalidateRenderAcks(): void;
  unlock(): void;
  requestFrame?(callback: () => void): unknown;
  onNavigationChange?(transitioning: boolean): void;
}>;

export type VersionWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    "workspace" | "createVersionFromHistory" | "queryHistoryCreation" | "confirmHistoryCreationOpened" | "versionFile"
      | "source"
      | "activateReadyVersion"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  versionSession: VersionSession;
  runSession: RunSession;
  projectWorkflow: ProjectWorkflow;
  documentWorkflow: DocumentWorkflow;
  commentWorkflow: CommentWorkflow;
  commentSession: CommentSession;
  draftSession: DraftSession;
  codecs: VersionWorkflowCodecs;
  ports: Readonly<{
    hash: Readonly<{ sha256(html: string): Promise<string> }>;
    canvas: VersionWorkflowCanvasPort;
  }>;
  clock: Readonly<{ now(): number }>;
}>;

export class VersionWorkflow {
  constructor(options: VersionWorkflowConstruction);
  getSnapshot(): VersionWorkflowSnapshot;
  subscribe(listener: (snapshot: VersionWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: Readonly<Record<string, unknown>>) => void): () => void;
  prepareReviewCandidate(input: {
    run?: Record<string, unknown> | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
  activateReadyVersion(input: {
    run?: Record<string, unknown> | null;
    reviewLease?: VersionReviewLease | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  openCommittedVersion(input: {
    run?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
    reviewLease?: VersionReviewLease | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  viewHistory(input: {
    version?: Record<string, unknown> | null;
    context?: ProjectContext | null;
    deadlineAt?: number;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  returnToCurrent(input?: {
    context?: ProjectContext | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  createVersionFromHistory(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome<HistoryCreationResult>>;
  restoreHistoryCreation(input: { operationId: string; context: ProjectContext }): Promise<void>;
  openCreatedHistoryVersion(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome<HistoryCreationResult>>;
  queryHistoryCreation(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome<HistoryCreationResult>>;
  dispose(): void;
}
