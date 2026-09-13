import type { BridgeClient } from "./bridge-client.js";
import type { CommentWorkflow } from "./comment-workflow.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { OpenTarget, ProjectContext, ProjectSession } from "./project-session.js";
import type { ProjectRulesWorkflow } from "./project-rules-workflow.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { ExternalFileOpenSnapshot } from "./external-file-open-session.js";
import type { ProjectApplicationSnapshot } from "./project-application-session.js";

export type ProjectWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Readonly<Record<string, unknown>> }>;

export type ProjectWorkflowProject = Readonly<{
  name: string;
  projectId?: string;
  documentId?: string;
  sourcePath: string | null;
  html: string;
  sha256?: string | null;
  lastModifiedAt?: string;
  path?: string;
}>;

export type ProjectHydrationSnapshot = Readonly<{
  phase: "idle" | "hydrating" | "failed";
  generation: number;
  epoch: number;
  sourcePath: string | null;
  error: string | null;
}>;

export type ProjectWorkflowSnapshot = Readonly<{
  hydration: ProjectHydrationSnapshot;
  supplemental: Readonly<{
    phase: "idle" | "loading" | "ready" | "failed";
    operationId: string | null;
    snapshotRevision: string | null;
    error: string | null;
  }>;
  switch: Readonly<{
    phase: "idle" | "preparing";
    operationId: string | null;
  }>;
  rename: Readonly<{
    phase: "idle" | "renaming";
    operationId: string | null;
  }>;
  open: Readonly<{
    phase: "idle" | "opening" | "deferred";
    operationId: string | null;
    pendingKind: string | null;
  }>;
  close: Readonly<{
    phase: "idle" | "preparing" | "ready";
    requestId: string | null;
  }>;
  openConfirmation: Readonly<{
    requestId: string;
    classification: "new-external" | "known-external" | string;
    sourceFileName?: string;
    visibleV1FileName?: string;
    projectsRootLabel?: string;
    projectName?: string;
    currentBasedOnOrdinal?: number;
    latestOfficialOrdinal?: number;
    currentDiffersFromBase?: boolean;
    sourceRelation?: "unchanged" | "changed";
    deleteOriginal?: boolean;
    busy?: boolean;
  }> | null;
  externalOpen: ExternalFileOpenSnapshot;
  projectApplication: ProjectApplicationSnapshot;
}>;

export type ProjectWorkflowEvent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type PreparedManagedSourceTransition = Readonly<{
  previousSourcePath: string;
  nextSourcePath: string;
  projectId: string;
  documentId: string;
  openTarget: Omit<OpenTarget, "sessionEpoch"> | null;
  updatesCurrentProject: boolean;
  activatedProject: ProjectWorkflowProject | null;
}>;

export type PreparedGeneratedSourceTransition = PreparedManagedSourceTransition;

export type ProjectWorkflowConstruction = Readonly<{
  getCatalogRevision?: () => number;
  bridgeClient: Pick<
    BridgeClient,
    "workspace" | "source" | "conflictCandidate"
  > & Partial<Pick<BridgeClient, "workspaceEnvelope">>;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  commentWorkflow: CommentWorkflow;
  runSession: RunSession;
  projectRulesWorkflow: ProjectRulesWorkflow;
  codecs: object;
  ports: Readonly<{
    hash: object;
    canvas: object;
    projectOpen: object;
    viewState: Readonly<{
      isTransitioning(): boolean;
    }>;
    recentRuns: Readonly<{
      hydrate(projects: unknown[], activeSourcePath: string | null): void | Promise<void>;
    }>;
    navigation?: Readonly<{
      authorizeProjectApplication(input: Readonly<Record<string, unknown>>): Readonly<{
        accepted: boolean;
        kind: string;
      }>;
      applyProject(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
      waitForTerminal?(transactionId: string): Promise<Readonly<Record<string, unknown>> | null>;
    }>;
  }>;
  policies: object;
  scheduler?: Readonly<{
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  }>;
}>;

export class ProjectWorkflow {
  constructor(options: Readonly<Record<string, unknown>>);
  getSnapshot(): ProjectWorkflowSnapshot;
  subscribe(listener: (snapshot: ProjectWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: ProjectWorkflowEvent) => void): () => void;
  readonly projectHydrating: boolean;
  readonly projectLoadError: string | null;
  reportLoadFailure(message: string): void;
  refreshWorkspace(input?: Record<string, unknown>): Promise<ProjectWorkflowOutcome>;
  retryHydration(): Promise<ProjectWorkflowOutcome>;
  prepareSwitch(input?: { fromDeferred?: boolean }): Promise<ProjectWorkflowOutcome>;
  openProject(input?: {
    kind?: "local" | "recent" | "registered" | "startup";
    sourcePath?: string | null;
    projectId?: string | null;
    fromDeferred?: boolean;
    switchPrepared?: boolean;
    transactionId?: string | null;
  }): Promise<ProjectWorkflowOutcome>;
  acceptProject(
    project: ProjectWorkflowProject,
    input?: { kind?: string; operationId?: string; sourcePath?: string | null; switchPrepared?: boolean; transactionId?: string | null },
  ): ProjectWorkflowOutcome;
  cancelProjectApplication(applicationId: string): boolean;
  acceptExternalProject(input: {
    requestId: string;
    sourcePath?: string;
    transactionId?: string;
  }): ProjectWorkflowOutcome;
  confirmExternalOpen(input?: {
    requestId?: string;
    action?: string;
    deleteOriginal?: boolean;
    transactionId?: string | null;
  }): Promise<ProjectWorkflowOutcome>;
  cancelExternalOpen(input?: { requestId?: string }): Promise<ProjectWorkflowOutcome>;
  setExternalOpenDeleteOriginal(input?: {
    requestId?: string;
    deleteOriginal?: boolean;
  }): ProjectWorkflowOutcome;
  retryExternalOpen(input?: { requestId?: string }): Promise<ProjectWorkflowOutcome>;
  resumeDeferredExternalProject(): ProjectWorkflowOutcome;
  resumeDeferredProjectApplication(): ProjectWorkflowOutcome;
  reconcileDeferred(): void;
  prepareClose(input: {
    requestId: string;
    deadlineAt: number;
  }): Promise<Readonly<{
    ready: boolean;
    reason?: string;
    presentation?: "in-app" | "native";
    retry?: boolean;
  }>>;
  abortClose(input: { requestId: string }): void;
  hasPending(boundary: string): boolean;
  inspectDrain(boundary: string): ReadonlyArray<Record<string, unknown>>;
  drain(boundary: string, input: { deadlineAt: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  drainCloseFallback(input?: { deadlineAt?: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  refreshRecents(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  restoreRegisteredWorkingCopy(projectId: string): Promise<ProjectWorkflowOutcome<{ restored: boolean }>>;
  refreshRegisteredProjects(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  loadRegisteredProjectVersionSummaries(projectId: string): Promise<ProjectWorkflowOutcome<{
    projectId: string;
    documentId: string;
    versions: unknown[];
  }>>;
  scheduleProjectListRefreshAfterSettlement(context: ProjectContext): void;
  captureManagedSourceTransitionAuthority(): unknown;
  restoreManagedSourceTransitionAuthority(authority: unknown): Readonly<{
    epoch: number;
    sourcePath: string;
  }> | null;
  renameSource(input: {
    stem: string;
    deadlineAt?: number;
  }): Promise<ProjectWorkflowOutcome<{
    context: ProjectContext;
    sourcePath: string;
    projectName?: string;
    lastModifiedAt?: string | null;
    unchanged?: boolean;
  }>>;
  reconcileExternalSourceLocator(input?: {
    reason?: "watch" | "rename" | "startup" | "safe-action";
    watcherGeneration?: number;
    previousSourcePath?: string | null;
    sourceMissing?: boolean;
  }): Promise<ProjectWorkflowOutcome<{
    context?: ProjectContext;
    sourcePath?: string;
    previousSourcePath?: string;
    status?: string;
    relocated?: boolean;
    contentChanged?: boolean;
    projectName?: string;
    ignored?: boolean;
    observed?: unknown;
  }>>;
  prepareManagedSourceTransition(input: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    nextProjectId: string;
    nextDocumentId: string;
    versionId: string;
    openTarget?: Omit<OpenTarget, "sessionEpoch"> | null;
    operationId?: string | null;
  }): Promise<PreparedManagedSourceTransition>;
  commitManagedSourceTransition(input: {
    prepared: PreparedManagedSourceTransition;
    html: string;
    sourceSha256: string;
    publishVersion?(): void;
    publishSessions?(context: ProjectContext): void;
  }): ProjectContext | null;
  prepareGeneratedSourceTransition(input: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    nextProjectId: string;
    nextDocumentId: string;
    versionId: string;
    openTarget?: Omit<OpenTarget, "sessionEpoch"> | null;
    operationId?: string | null;
  }): Promise<PreparedGeneratedSourceTransition>;
  commitGeneratedSourceTransition(input: {
    prepared: PreparedGeneratedSourceTransition;
    html: string;
    sourceSha256: string;
    publishVersion(): void;
  }): ProjectContext | null;
  dispose(): void;
}
