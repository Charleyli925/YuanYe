import type { BridgeClient } from "./bridge-client.js";
import type {
  AttachmentBinaryPort,
  CommentWorkflowOutcome,
} from "./comment-workflow.js";
import type { CommentWorkflowCodecs } from "./comment-workflow-codecs.js";
import type {
  DocumentWorkflowCanvasPort,
  DocumentWorkflowOutcome,
  DocumentWorkflowRecoveryJournal,
} from "./document-workflow.js";
import type { DocumentWorkflowCodecs } from "./document-workflow-codecs.js";
import type { CommentSession } from "./comment-session.js";
import type { ConversationSession } from "./conversation-session.js";
import type {
  DocumentSession,
  PersistedBoundaryResult,
} from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { EditAuthorRuntimePort } from "./edit-author-runtime-session.js";
import type { WorkspacePreferencesPort } from "./workspace-preferences-session.js";
import type {
  ProjectContext,
  ProjectSession,
} from "./project-session.js";
import type {
  ProjectRulesScheduler,
  ProjectRulesWorkflowOutcome,
} from "./project-rules-workflow.js";
import type { RecoveryStore } from "./recovery-store.js";
import type { SourceHistorySession } from "./source-history-session.js";
import type { VersionSession } from "./version-session.js";
import type {
  ProjectWorkflowConstruction,
  ProjectWorkflowEvent,
  ProjectWorkflowOutcome,
  ProjectWorkflowProject,
} from "./project-workflow.js";
import type {
  RunWorkflowCodecs,
  RunWorkflowEvent,
  RunWorkflowOutcome,
} from "./run-workflow.js";
import type {
  VersionWorkflowCanvasPort,
  VersionWorkflowCodecs,
  VersionWorkflowEvent,
  VersionWorkflowOutcome,
} from "./version-workflow.js";
import type {
  WorkbenchTabStatus,
  WorkbenchTabsSession,
  WorkbenchTabsSnapshot,
} from "./workbench-tabs-session.js";
import type { WorkbenchNavigationSession } from "./workbench-navigation-session.js";
import type { WorkbenchNavigationOutcome } from "./workbench-navigation-workflow.js";
import type { DocumentSurfaceCacheSession } from "./document-surface-cache-session.js";
import type { WorkbenchTabsPersistenceCoordinator } from "./workbench-tabs-persistence-coordinator.js";
import type {
  CommandOutcome,
} from "./workspace-controller-capabilities.js";

export type {
  AgentSelectionControllerCapability,
  AiConversationControllerCapability,
  CapabilityFacet,
  CommentAttachmentTarget,
  CommentControllerCapability,
  CommentControllerCapabilitySnapshot,
  CommentControllerCommands,
  ProjectCatalogCapabilitySnapshot,
  ProjectCatalogControllerCapability,
  ProjectCatalogControllerCommands,
  RunControllerCapability,
  RunControllerCapabilitySnapshot,
  RunControllerCommands,
  NavigationControllerCapability,
  NavigationControllerCapabilitySnapshot,
  NavigationControllerCommands,
  ConversationControllerCapability,
  CommandOutcome,
  DocumentSurfaceControllerCapability,
  NavigationWorkflowControllerCapability,
  OperationIdentity,
  RecoveryIntent,
  ReviewPreparationControllerCapability,
  RunSubmissionControllerCapability,
  WorkspaceControllerSnapshot,
  WorkspaceSnapshotReader,
} from "./workspace-controller-capabilities.js";

export type WorkspaceEvent =
  | Readonly<{
      type: "registration-published";
      context: ProjectContext;
      projectName: string | null;
      imported?: boolean;
      canonicalSourceAdopted: boolean;
    }>
  | Readonly<{
      type: "draft-authority-rebound";
      context: ProjectContext;
    }>
  | Readonly<{
      type: "workbench-tabs-persistence-failed";
      reason: string;
    }>
  | Readonly<{
      type: "workbench-tabs-restore-missing";
      missing: ReadonlyArray<Record<string, unknown>>;
    }>
  | Readonly<{
      type: "workbench-tabs-restore-failed";
      tabId: string;
      committed: boolean;
      reason: string;
    }>
  | Readonly<{
      type:
        | "document-direct-edit-recorded"
        | "document-edit-queued"
        | "document-persisted"
        | "document-open-target-rebound"
        | "document-persistence-failed"
        | "document-authority-reloaded"
        | "document-authority-reload-failed"
        | "document-authority-repaired"
        | "document-boundary-reconciled"
        | "document-recovery-queued"
        | "document-history-failed"
        | "document-history-applied";
      context?: ProjectContext;
      [key: string]: unknown;
    }>
  | Readonly<{
      type:
        | "comment-draft-persistence-failed"
        | "comment-draft-persisted"
        | "attachment-uploaded"
        | "attachment-cleanup-failed";
      context?: ProjectContext | null;
      [key: string]: unknown;
    }>
  | ProjectWorkflowEvent
  | RunWorkflowEvent
  | VersionWorkflowEvent;

export type RegistrationInput = Readonly<{
  sourcePath?: string;
  expectedSourceSha256?: string | null;
  adoptCanonicalSource?: boolean;
}>;

export type HashPort = Readonly<{
  sha256(html: string): Promise<string>;
}>;

export type RecoveryPort = Readonly<{
  replace(identity: unknown): void;
}>;

export type CanvasAuthorityPort = Readonly<{
  invalidateRenderAcks(): void;
}>;

export type ProjectSourceActivationPort = Readonly<{
  activateManagedWorkingCopy(input: Readonly<{
    operationId?: string | null;
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    projectId: string;
    documentId: string;
    workingCopyId: string;
    versionId: string;
    projectRootPath: string;
  }>): Promise<Readonly<{
    sourcePath: string;
    sha256: string;
    html: string;
  }>>;
}>;

export type ClockPort = Readonly<{
  now(): number;
}>;

export type WorkspaceControllerCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null, right: string | null): boolean;
  draftAuthorityFromWorkspace(
    payload: Record<string, unknown>,
  ): Record<string, unknown>;
  authoritativeDraftRevision(draft: Record<string, unknown>): number;
  recoveryIdentityFromRecord(value: unknown): unknown;
  versionsFromWorkspace(payload: Record<string, unknown>): unknown[];
  projectVersionSummariesFromWorkspace(payload: Record<string, unknown>): unknown[];
  projectVersionSummariesFromVersions(versions: readonly { id: string; ordinal: number; generatedAt: string; displayFileName?: string; modifiedAt?: string; basedOnVersionId: string | null; previousVersionId: string | null }[], projectId: string, documentId: string, fileName: string, options: { activeVersionId?: string | null; latestVersionId?: string | null; activeModifiedAt?: string | null }): unknown[];
  commentsFromRecords(value: unknown): unknown[];
  changesFromDraftRecords(value: unknown): unknown[];
  rebindTargetsPreservingGlobal(
    html: string,
    targets: unknown[],
  ): unknown[];
}>;

export type WorkspaceControllerConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    | "ensureProject"
    | "workspace"
    | "autosave"
    | "source"
    | "resolveConflict"
    | "conflictCandidate"
    | "sourcePreview"
    | "sourceStat"
    | "projectFile"
    | "attachment"
    | "saveAttachment"
    | "deleteAttachment"
    | "createRequest"
    | "status"
    | "cancelActiveRun"
    | "versionFile"
    | "activateReadyVersion"
    | "updateProjectFile"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  sourceHistorySession: SourceHistorySession;
  conversationSession?: ConversationSession | null;
  workbenchTabsSession?: WorkbenchTabsSession | null;
  documentSurfaceCacheSession?: DocumentSurfaceCacheSession | null;
  workbenchNavigationSession?: WorkbenchNavigationSession | null;
  workbenchTabsPersistenceCoordinator?: WorkbenchTabsPersistenceCoordinator | null;
  codecs: WorkspaceControllerCodecs;
  ports: Readonly<{
    hash: HashPort;
    recovery?: RecoveryPort;
    canvas?: CanvasAuthorityPort;
    projectSource?: ProjectSourceActivationPort;
    editRuntime?: EditAuthorRuntimePort;
    uiPreferences?: WorkspacePreferencesPort;
    agentCredentialStatus?: () => Promise<{ remembered?: boolean }>;
    workbenchTabs?: Readonly<{
      get(): Promise<unknown>;
      set(value: Readonly<Record<string, unknown>>): Promise<unknown>;
    }>;
    navigation?: Readonly<{
      subscribeExternalOpen(listener: (request: {
        requestId: string;
        sourcePath?: string;
      }) => void): (() => void) | void;
      readInitialExternalOpen?(): Promise<{
        requestId: string;
        sourcePath?: string;
      } | null>;
    }>;
  }>;
  documentWorkflow?: Readonly<{
    codecs: DocumentWorkflowCodecs;
    recoveryJournal?: DocumentWorkflowRecoveryJournal | null;
    canvas?: Omit<DocumentWorkflowCanvasPort, "invalidateRenderAcks">;
    scheduler?: Readonly<{
      setTimeout(callback: () => void, delayMs: number): unknown;
      clearTimeout(handle: unknown): void;
    }>;
  }>;
  commentWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: CommentWorkflowCodecs;
    recoveryStore: import("./recovery-store.js").RecoveryStore;
    attachmentBinary: AttachmentBinaryPort;
  }>;
  projectRulesWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    errorMessage?: (cause: unknown, fallback: string) => string;
    scheduler?: ProjectRulesScheduler;
  }>;
  projectWorkflow?: Pick<
    ProjectWorkflowConstruction,
    | "runSession"
    | "codecs"
    | "ports"
    | "policies"
    | "scheduler"
  >;
  runWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: RunWorkflowCodecs;
    canvas: Readonly<{
      checkpointNativeTextIntent(input: Record<string, unknown>): {
        ok: boolean;
        reason?: string;
      } | undefined;
      freeze(reason: string): Record<string, unknown>;
      unlock(): void;
      normalizeComments?(): unknown[];
    }>;
    handoff: Readonly<{
      copy(input: {
        message: string;
        run: import("../domain/run-lifecycle.js").ActiveRun | null;
        purpose?: string;
      }): Promise<{ status: string; copied: boolean }>;
      openLogin?(input: { providerId: string }): Promise<{ opened?: boolean } | null>;
    }>;
    scheduler?: Readonly<{
      setTimeout(callback: () => void, delayMs: number): unknown;
      clearTimeout(handle: unknown): void;
    }>;
  }>;
  versionWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: VersionWorkflowCodecs;
    canvas: VersionWorkflowCanvasPort;
  }>;
  clock: ClockPort;
}>;

export type RuntimeWorkspaceControllerConstruction = Readonly<{
  initial?: Readonly<{
    documentHtml?: string;
    runSourcePath?: string | null;
  }>;
  draftSession?: Readonly<{
    encodeComment?: (value: never) => unknown;
    encodeChangeEvent?: (value: never) => unknown;
  }>;
  codecs: WorkspaceControllerCodecs;
  ports: WorkspaceControllerConstruction["ports"];
  recoveryStore?: RecoveryStore;
  documentWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["documentWorkflow"]>,
    "recoveryJournal"
  > & Partial<Pick<
    NonNullable<WorkspaceControllerConstruction["documentWorkflow"]>,
    "recoveryJournal"
  >>;
  commentWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["commentWorkflow"]>,
    "runSession" | "recoveryStore"
  > & Partial<Pick<
    NonNullable<WorkspaceControllerConstruction["commentWorkflow"]>,
    "recoveryStore"
  >>;
  projectRulesWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["projectRulesWorkflow"]>,
    "runSession"
  >;
  projectWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["projectWorkflow"]>,
    "runSession" | "ports"
  > & Readonly<{
    ports: Omit<ProjectWorkflowConstruction["ports"], "recentRuns">;
  }>;
  runWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["runWorkflow"]>,
    "runSession"
  >;
  versionWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["versionWorkflow"]>,
    "runSession"
  >;
  clock: ClockPort;
}>;

export class WorkspaceRegistrationError extends Error {
  readonly code: string;
  readonly operationId?: string;
}

export function registrationContextFromOutcome(
  outcome: CommandOutcome<ProjectContext>,
): ProjectContext | null;

export function createRuntimeWorkspaceController(
  options: RuntimeWorkspaceControllerConstruction,
): WorkspaceController;

// The class retains injected construction for isolated Application tests. The
// production renderer must use createRuntimeWorkspaceController instead.
export class WorkspaceController {
  constructor(options: WorkspaceControllerConstruction);
  readonly comments: import("./workspace-controller-capabilities.js").CommentControllerCapability;
  readonly projectCatalog: import("./workspace-controller-capabilities.js").ProjectCatalogControllerCapability;
  readonly runs: import("./workspace-controller-capabilities.js").RunControllerCapability;
  readonly navigation: import("./workspace-controller-capabilities.js").NavigationControllerCapability;
  getSnapshot(): import("./workspace-controller-capabilities.js").WorkspaceControllerSnapshot;
  openConversation(
    context: import("./conversation-session.js").ConversationContext | null,
  ): Promise<unknown>;
  closeConversation(): void;
  updateConversationDraftText(text: string): void;
  updateConversationDraftIntent(intent: string): void;
  flushConversationDraft(): Promise<boolean>;
  activateWorkbenchTab(tabId: string, input?: { deadlineMs?: number }): Promise<WorkbenchNavigationOutcome>;
  createWorkbenchStartTab(): Promise<WorkbenchNavigationOutcome>;
  createWorkbenchSettingsTab(): Promise<WorkbenchNavigationOutcome>;
  createWorkbenchProjectRulesTab(): Promise<WorkbenchNavigationOutcome>;
  closeWorkbenchTab(tabId: string): Promise<WorkbenchNavigationOutcome>;
  openRegisteredWorkbenchProject(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
  }): Promise<WorkbenchNavigationOutcome>;
  updateWorkbenchTabStatus(
    projectId: string,
    documentId: string,
    status: WorkbenchTabStatus,
  ): WorkbenchTabsSnapshot | null;
  updateWorkbenchTabTitle(
    projectId: string,
    documentId: string,
    title: string,
  ): WorkbenchTabsSnapshot | null;
  updateDocumentSurfacePresentation(
    tabId: string,
    presentation?: Readonly<Record<string, unknown>>,
  ): import("./document-surface-cache-session.js").DocumentSurfaceCacheEntry | null;
  confirmDocumentSurfaceReady(tabId: string, sourceSha256: string): boolean;
  deferDocumentSurfacePrewarm(delayMs?: number): boolean;
  subscribe(
    listener: (
      snapshot: import("./workspace-controller-capabilities.js").WorkspaceControllerSnapshot,
    ) => void,
  ): () => void;
  subscribeEvents(listener: (event: WorkspaceEvent) => void): () => void;
  readonly projectHydrating: boolean;
  readonly projectLoadError: string | null;
  startEditAuthorRuntimePreparation(input: {
    sourceSha256: string;
    canvasGeneration: number;
  }): boolean;
  beginEditAuthorRuntime(input: {
    sessionId: string;
    sourceSha256: string;
    canvasGeneration: number;
    candidateId: string;
    candidateGeneration: number;
    candidateSourceRevision: string;
  }): boolean;
  settleEditAuthorRuntime(input: {
    sessionId: string;
    sourceSha256: string;
    canvasGeneration: number;
    candidateId: string;
    candidateGeneration: number;
    candidateSourceRevision: string;
    outcome: "ready" | "rejected" | "failed" | "superseded";
    preserveLastKnownGood: boolean;
    runtimePartial: boolean;
  }): boolean;
  retryEditAuthorRuntime(): Promise<boolean>;
  getCurrentProjectContext(): ProjectContext | null;
  matchesCurrentProjectContext(context: ProjectContext): boolean;
  reloadDocumentCanvas(): DocumentSessionSnapshot;
  replaceCommentWorkingCopy(
    input: Record<string, unknown>,
  ): CommentWorkflowOutcome;
  clearCompletedRun(): boolean;
  dismissActiveRun(): import("../domain/run-lifecycle.js").ActiveRun | null;
  reopenRecentRunOutcome(sourcePath: string | null | undefined): boolean;
  refreshProject(input?: Record<string, unknown>): Promise<ProjectWorkflowOutcome>;
  retryProjectHydration(): Promise<ProjectWorkflowOutcome>;
  prepareProjectSwitch(input?: {
    fromDeferred?: boolean;
  }): Promise<WorkbenchNavigationOutcome>;
  openProject(input?: {
    kind?: "local" | "recent" | "registered" | "startup";
    sourcePath?: string | null;
    projectId?: string | null;
    fromDeferred?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  acceptProject(
    project: ProjectWorkflowProject,
    input?: { kind?: string; operationId?: string; sourcePath?: string | null },
  ): ProjectWorkflowOutcome;
  acceptExternalProject(input: {
    requestId: string;
    sourcePath?: string;
  }): Promise<WorkbenchNavigationOutcome>;
  confirmExternalOpen(input?: {
    requestId?: string;
    action?: string;
    deleteOriginal?: boolean;
  }): Promise<WorkbenchNavigationOutcome>;
  cancelExternalOpen(input?: { requestId?: string }): Promise<WorkbenchNavigationOutcome>;
  setExternalOpenDeleteOriginal(input?: {
    requestId?: string;
    deleteOriginal?: boolean;
  }): ProjectWorkflowOutcome;
  retryExternalOpen(input?: { requestId?: string }): Promise<WorkbenchNavigationOutcome>;
  acknowledgeEditCanvas(input?: {
    generation?: number;
    renderedSha256?: string | null;
  }): boolean;
  retryCanvasVerification(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome>;
  resumeDeferredExternalProject(): ProjectWorkflowOutcome;
  resumeDeferredProjectApplication(): ProjectWorkflowOutcome;
  reconcileProjectTransitions(): void;
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
  hasPendingDrain(boundary: string): boolean;
  inspectDrain(boundary: string): ReadonlyArray<Record<string, unknown>>;
  drainBoundary(boundary: string, input: { deadlineAt: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  drainCloseFallback(input?: { deadlineAt?: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  refreshRecentProjects(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  refreshRegisteredProjects(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  openProjectRules(input: {
    context: ProjectContext;
  }): Promise<ProjectRulesWorkflowOutcome<{
    opened: boolean;
    reused?: boolean;
  }>>;
  updateProjectRules(input: { content: string }): ProjectRulesWorkflowOutcome<{
    updated: boolean;
  }>;
  beginProjectRulesComposition(input: {
    target: unknown;
    baselineValue: string;
  }): number | null;
  finishProjectRulesComposition(input: { target: unknown }): boolean;
  leaveProjectRulesEditor(): boolean;
  restoreProjectRules(): ProjectRulesWorkflowOutcome<{
    restored: boolean;
    editorGeneration: number;
  }>;
  saveProjectRules(): Promise<ProjectRulesWorkflowOutcome<{
    saved: boolean;
    reconciled?: boolean;
  }>>;
  closeProjectRules(): Promise<ProjectRulesWorkflowOutcome<{ closed: boolean }>>;
  renameProjectSource(input: {
    stem: string;
    deadlineAt?: number;
  }): Promise<ProjectWorkflowOutcome<{
    context: ProjectContext;
    sourcePath: string;
    projectName?: string;
    lastModifiedAt?: string | null;
    unchanged?: boolean;
  }>>;
  observeExternalSourceChange(input?: {
    reason?: "watch" | "rename" | "startup" | "safe-action";
    watcherGeneration?: number;
    previousSourcePath?: string | null;
    sourceMissing?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  submitRequest(input?: {
    projectName?: string;
    previousVersionId?: string | null;
    basedOnVersionId?: string | null;
    deadlineAt?: number;
    deliveryMode?: "clipboard" | "managed-agent" | string;
  }): Promise<RunWorkflowOutcome>;
  planRunSubmission(): import("./run/submit-plan.js").RunSubmitPlan;
  selectAgent(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
  ): import("../domain/agent-provider-state.js").AgentSelection;
  queuePendingDefaultAgent(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
  ): import("../domain/agent-provider-state.js").AgentSelection;
  pendingDefaultAgent(): import("../domain/agent-provider-state.js").AgentSelection | null;
  readyPendingDefaultAgent(): import("../domain/agent-provider-state.js").AgentSelection | null;
  clearPendingDefaultAgent(expectedIntentId?: string): import("../domain/agent-provider-state.js").AgentSelection | null;
  commitPendingDefaultAgent(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
    options?: Readonly<{ saveDefault?(providerId: string): Promise<unknown> }>,
  ): Promise<RunWorkflowOutcome>;
  beginAccessRepair(
    run?: import("../domain/run-lifecycle.js").ActiveRun | null,
    field?: "apiKey" | "login" | "install" | "model" | "provider",
  ): import("./run-workflow.js").RunWorkflowSnapshot["accessRepair"];
  clearAccessRepair(expectedIntentId?: string): import("./run-workflow.js").RunWorkflowSnapshot["accessRepair"];
  resendAfterAccessRepair(): Promise<RunWorkflowOutcome>;
  selectAgentModel(modelId: string | null, expectedSelection?: import("../domain/agent-provider-state.js").AgentSelection | null): Promise<import("../domain/agent-provider-state.js").AgentSelection | null>;
  selectAgentReasoning(reasoning: string | null, expectedSelection?: import("../domain/agent-provider-state.js").AgentSelection | null): Promise<import("../domain/agent-provider-state.js").AgentSelection | null>;
  applyDisabledAgentProviders(ids?: readonly string[]): void;
  connectAgentApiKey(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    apiKey: string,
    extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>,
  ): Promise<RunWorkflowOutcome>;
  disconnectAgentApiKey(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
  ): Promise<RunWorkflowOutcome>;
  holdAgentCredential(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    payload: Readonly<{
      apiKey: string;
      vendorId?: string | null;
      baseUrl?: string | null;
      modelId?: string | null;
    }>,
  ): unknown;
  noteAgentCredentialPersist(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    result: Readonly<{ status: string; reason?: string | null }>,
  ): unknown;
  retryAgentCredentialPersist(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    persist: (held: Readonly<{
      apiKey: string;
      vendorId: string | null;
      baseUrl: string | null;
      modelId: string | null;
    }>) => Promise<{ ok?: boolean; code?: string }>,
  ): Promise<RunWorkflowOutcome>;
  stopRunsForProvider(providerId: string): Promise<readonly RunWorkflowOutcome[]>;
  manageAgentAccess(
    kind: "disconnect" | "remove-key" | "reconnect" | "logout",
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    options?: Readonly<{
      stopRelatedRuns?: boolean;
      credentials?: Readonly<{
        clear?(): Promise<{ ok?: boolean }>;
        restore?(): Promise<unknown>;
      }>;
    }>,
  ): Promise<RunWorkflowOutcome>;
  refreshQoderAvailability(): Promise<RunWorkflowOutcome>;
  checkQoderUsability(): Promise<RunWorkflowOutcome>;
  copyQoderGuidance(input: {
    kind: import("../domain/agent-provider-state.js").AgentProviderGuidanceKind;
  }): Promise<RunWorkflowOutcome>;
  startAgentLogin(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
  ): Promise<RunWorkflowOutcome>;
  reopenAgentLogin(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
  ): Promise<RunWorkflowOutcome>;
  startAgentLogout(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
  ): Promise<RunWorkflowOutcome>;
  installQoder(): Promise<RunWorkflowOutcome>;
  installAgent(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
  ): Promise<RunWorkflowOutcome>;
  cancelAgentInstall(
    selection?: import("../domain/agent-provider-state.js").AgentSelection | null,
  ): Promise<RunWorkflowOutcome>;
  refreshAgentAvailability(): Promise<RunWorkflowOutcome>;
  checkAgentUsability(
    selection?: import("../domain/agent-provider-state.js").AgentSelection,
  ): Promise<RunWorkflowOutcome>;
  copyAgentGuidance(input: {
    kind: import("../domain/agent-provider-state.js").AgentProviderGuidanceKind;
    selection?: import("../domain/agent-provider-state.js").AgentSelection;
  }): Promise<RunWorkflowOutcome>;
  reconcileRunSubmission(input?: {
    sourcePath?: string | null;
    generation?: number;
  }): Promise<RunWorkflowOutcome>;
  pollRuns(input?: { generation?: number }): Promise<RunWorkflowOutcome>;
  copyRunHandoff(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
  }): Promise<RunWorkflowOutcome>;
  startRunAgent(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    preflightId?: string | null;
  }): Promise<RunWorkflowOutcome>;
  cancelRun(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    agentMayBeRunning?: boolean;
    reason?: string;
  }): Promise<RunWorkflowOutcome>;
  resolveRunConflict(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    action: "adopt-ai" | "keep-external";
  }): Promise<RunWorkflowOutcome>;
  prepareReviewCandidate(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
  }): Promise<VersionWorkflowOutcome<
    import("./version-workflow.js").VersionReviewCandidate
  >>;
  activateReadyVersion(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    reviewLease?: Readonly<{ operationKey: string; beforeHtml: string }> | null;
  }): Promise<VersionWorkflowOutcome>;
  openCommittedVersion(input: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  viewHistory(input: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  returnToCurrent(input?: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  createVersionFromHistory(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome>;
  openCreatedHistoryVersion(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome>;
  queryHistoryCreation(input: { operationId: string; context?: ProjectContext | null }): Promise<VersionWorkflowOutcome>;
  /** @deprecated Legacy activation protocol only; no product UI callers. */
  continueEditingHistoryVersion(input?: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  ensureRegistered(
    input?: RegistrationInput,
  ): Promise<CommandOutcome<ProjectContext>>;
  readonly hasDocumentHistoryAction: boolean;
  enqueueDocumentEdit(input: Record<string, unknown>): DocumentWorkflowOutcome<{
    revision: number;
    queued: boolean;
  }>;
  flushDocument(input?: { throughRevision?: number }): Promise<DocumentWorkflowOutcome<{
    revision: number;
    idle?: boolean;
  }>>;
  performDocumentHistoryAction(input: {
    direction: "undo" | "redo";
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reloadDocumentAuthority(input?: {
    context?: ProjectContext;
    acceptExternalConflict?: boolean;
    externalAuthorityAccepted?: boolean;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  previewExternalDocumentSource(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  forceUnlockDocumentConflict(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  ensureDocumentCanvas(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reconcileDocumentBoundary(input: Record<string, unknown>): Promise<DocumentWorkflowOutcome<PersistedBoundaryResult>>;
  recoverDocumentAutosave(input: Record<string, unknown>): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  recordDocumentExportEvidence(input: {
    context?: ProjectContext | null;
    html: string;
    revision: number;
    exported: { path: string; sha256: string };
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  adoptDocumentConflictCandidate(input: Record<string, unknown>): DocumentWorkflowOutcome<Record<string, unknown>>;
  resetDocumentWorkflow(input?: Record<string, unknown>): void;
  clearDocumentRecovery(context?: Partial<ProjectContext>): void;
  clearDocumentAutosaveTimer(): void;
  clearDocumentAudit(): void;
  replaceDocumentRecoveryIdentity(identity: unknown): unknown;
  activateDocumentSourceHistory(input: {
    context: ProjectContext;
    sourceSha256: string;
    history: unknown;
    preservePending?: boolean;
  }): DocumentWorkflowOutcome<{ active: boolean }>;
  waitForDocumentHistoryAction(): Promise<DocumentWorkflowOutcome<{ idle: boolean }>>;
  queueDraft(): CommentWorkflowOutcome;
  beginCommentComposer(input?: Record<string, unknown>): CommentWorkflowOutcome;
  updateCommentDraft(draft: string): CommentWorkflowOutcome;
  rebindCommentComposer(target: unknown): CommentWorkflowOutcome;
  cancelCommentComposer(): CommentWorkflowOutcome;
  beginCommentEdit(input: { commentId: string }): CommentWorkflowOutcome;
  updateCommentEditDraft(draftText: string): CommentWorkflowOutcome;
  clearCommentEdit(): CommentWorkflowOutcome;
  rebindCommentTarget(input: {
    commentId: string;
    target: unknown;
  }): CommentWorkflowOutcome;
  applyCommentItems(comments: unknown[]): CommentWorkflowOutcome;
  confirmCommentEdit(input: { commentId: string }): CommentWorkflowOutcome;
  flushDraft(input?: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  commitComment(input?: { commentId?: string }): Promise<CommentWorkflowOutcome>;
  editComment(input: { commentId: string }): CommentWorkflowOutcome;
  deleteComment(input: { commentId: string }): CommentWorkflowOutcome;
  deleteCommentsForElementIds(input: {
    elementIds: string[];
  }): CommentWorkflowOutcome;
  discardCommentComposer(): CommentWorkflowOutcome;
  cancelCommentEdit(input?: { commentId?: string }): CommentWorkflowOutcome;
  removeComposerAttachment(input: { attachmentId: string }): CommentWorkflowOutcome;
  removeCommentEditAttachment(input: {
    commentId: string;
    attachmentId: string;
  }): CommentWorkflowOutcome;
  uploadAttachments(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  readAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome<Blob>>;
  deleteAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  resetCommentWorkflow(): void;
  dispose(): void;
}
