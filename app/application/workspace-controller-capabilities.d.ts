import type { ConversationContext, ConversationSessionSnapshot } from "./conversation-session.js";
import type {
  DocumentSessionSnapshot,
} from "./document-session.js";
import type {
  DocumentSurfaceCacheEntry,
  DocumentSurfaceCacheSnapshot,
} from "./document-surface-cache-session.js";
import type { CommentSessionSnapshot } from "./comment-session.js";
import type {
  CommentWorkflowOutcome,
  CommentWorkflowSnapshot,
} from "./comment-workflow.js";
import type { EditAuthorRuntimeSnapshot } from "./edit-author-runtime-session.js";
import type { ProjectRulesSnapshot } from "./project-rules-session.js";
import type { ProjectContext, ProjectSessionSnapshot } from "./project-session.js";
import type { ProjectWorkflowSnapshot } from "./project-workflow.js";
import type { RunSessionSnapshot } from "./run-session.js";
import type { RunWorkflowOutcome, RunWorkflowSnapshot } from "./run-workflow.js";
import type { RunSubmitPlan } from "./run/submit-plan.js";
import type { VersionSessionSnapshot } from "./version-session.js";
import type {
  VersionReviewCandidate,
  VersionWorkflowOutcome,
  VersionWorkflowSnapshot,
} from "./version-workflow.js";
import type { WorkbenchNavigationSnapshot } from "./workbench-navigation-session.js";
import type { WorkbenchTabsPersistenceSnapshot } from "./workbench-tabs-persistence-coordinator.js";
import type { WorkbenchTabsSnapshot } from "./workbench-tabs-session.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";

export type OperationIdentity = Readonly<{
  operationId: string;
  epoch: number;
  sourcePath: string;
  expectedSourceSha256: string | null;
}>;

export type RecoveryIntent = Readonly<{
  kind: string;
  operationId?: string;
}>;

export type CommandOutcome<T> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{
      status: "blocked";
      code: string;
      reason: string;
      recovery?: RecoveryIntent;
    }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: OperationIdentity }>;

export type WorkspaceControllerSnapshot = Readonly<{
  registration: Readonly<{
    phase: "idle" | "registering";
    operationId: string | null;
    identity: OperationIdentity | null;
    outcome: CommandOutcome<ProjectContext> | null;
  }>;
  projectSession: ProjectSessionSnapshot | null;
  document: DocumentSessionSnapshot | null;
  commentSession: CommentSessionSnapshot | null;
  runSession: RunSessionSnapshot | null;
  versionSession: VersionSessionSnapshot | null;
  editRuntime: EditAuthorRuntimeSnapshot | null;
  comment: CommentWorkflowSnapshot | null;
  projectRules: ProjectRulesSnapshot | null;
  project: ProjectWorkflowSnapshot | null;
  run: RunWorkflowSnapshot | null;
  version: VersionWorkflowSnapshot | null;
  conversation: ConversationSessionSnapshot | null;
  workbenchTabs: WorkbenchTabsSnapshot | null;
  documentSurfaceCache: DocumentSurfaceCacheSnapshot | null;
  workbenchTabsReady: boolean;
  workbenchNavigation: WorkbenchNavigationSnapshot | null;
  workbenchTabsPersistence: WorkbenchTabsPersistenceSnapshot | null;
}>;

/** Render-only shell projection. Local text and full capability snapshots are absent. */
export type WorkspaceShellCommentSnapshot<TComment = unknown, TEvent = unknown, TAttachment = unknown, TTarget = unknown> = Readonly<{
  comments: TComment[];
  changeEvents: TEvent[];
  deletedCommentIds: string[];
  composerTarget: TTarget | null;
  composerCommentId: string | null;
  composerAttachments: TAttachment[];
  composerHasText: boolean;
  editSession: Readonly<{ commentId: string; baselineText: string; baselineAttachments: TAttachment[]; draftAttachments: TAttachment[] }> | null;
}>;
export type WorkspaceShellSnapshot = Readonly<Pick<WorkspaceControllerSnapshot,
  "projectSession" | "document" | "run" | "versionSession" | "version" | "project" |
  "editRuntime" | "workbenchTabs" | "documentSurfaceCache"
> & {
  commentSession: WorkspaceShellCommentSnapshot | null;
  comment: Readonly<{ attachmentUploadCount: number; draftError: string }> | null;
  projectRules: Omit<ProjectRulesSnapshot, "content" | "savedContent" | "path"> | null;
  runSession: (Pick<RunSessionSnapshot,
    "activeRun" | "recentOutcome" | "activeLocked" | "activeSubmission" | "submissionPending" |
    "activeHandoffMayBeRunning" | "activeHandoffManaged"
  > & { activeHandoff: Omit<NonNullable<RunSessionSnapshot["activeHandoff"]>,
    "visibleText" | "visibleTextUpdates" | "textTruncated" | "startedAt" | "lastActivityAt" | "receivedBytes" | "updatedAt"
  > | null }) | null;
}>;
export type WorkspaceShellCapability = Readonly<{
  getSnapshot(): WorkspaceShellSnapshot;
  subscribe(listener: () => void): () => void;
}>;
export type ConversationReaderCapability = Readonly<{
  getSnapshot(): ConversationSessionSnapshot | null;
  subscribe(listener: () => void): () => void;
}>;
export type ProjectRulesReaderCapability = Readonly<{
  getSnapshot(): ProjectRulesSnapshot | null;
  subscribe(listener: () => void): () => void;
}>;

export interface WorkspaceSnapshotReader {
  getSnapshot(): WorkspaceControllerSnapshot;
}

export type CapabilityFacet<TSnapshot, TCommands> = Readonly<{
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
  commands: Readonly<TCommands>;
}>;

export type CommentControllerCapabilitySnapshot<
  TComment = unknown,
  TEvent = unknown,
  TAttachment = unknown,
  TTarget = unknown,
  TEditSession = unknown,
> = Readonly<{
  workingCopy: CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  > | null;
  persistence: CommentWorkflowSnapshot | null;
}>;

export type CommentAttachmentTarget = Readonly<{
  kind: "composer" | "comment";
  commentId: string;
}>;

export interface CommentControllerCommands {
  beginComposer(input: Readonly<{
    target: unknown;
    commentId?: string;
    resume?: boolean;
  }>): CommentWorkflowOutcome;
  updateDraft(draft: string): CommentWorkflowOutcome;
  rebindComposerTarget(target: unknown): CommentWorkflowOutcome;
  cancelComposer(): CommentWorkflowOutcome;
  beginEdit(input: Readonly<{ commentId: string }>): CommentWorkflowOutcome;
  updateEditDraft(draftText: string): CommentWorkflowOutcome;
  clearEdit(): CommentWorkflowOutcome;
  rebindTarget(input: Readonly<{
    commentId: string;
    target: unknown;
  }>): CommentWorkflowOutcome;
  confirmEdit(input: Readonly<{ commentId: string }>): CommentWorkflowOutcome;
  flush(input?: Readonly<Record<string, unknown>>): Promise<CommentWorkflowOutcome>;
  commit(input?: Readonly<{ commentId?: string }>): Promise<CommentWorkflowOutcome>;
  delete(input: Readonly<{ commentId: string }>): CommentWorkflowOutcome;
  deleteForElements(input: Readonly<{
    elementIds: readonly string[];
  }>): CommentWorkflowOutcome;
  discardComposer(): CommentWorkflowOutcome;
  cancelEdit(input?: Readonly<{ commentId?: string }>): CommentWorkflowOutcome;
  removeComposerAttachment(
    input: Readonly<{ attachmentId: string }>,
  ): CommentWorkflowOutcome;
  removeEditAttachment(input: Readonly<{
    commentId: string;
    attachmentId: string;
  }>): CommentWorkflowOutcome;
  uploadAttachments(input: Readonly<{
    files: readonly unknown[];
    target: CommentAttachmentTarget;
    source: "clipboard" | "file-picker";
  }>): Promise<CommentWorkflowOutcome>;
  readAttachment(input: Readonly<{ attachment: unknown }>): Promise<
    CommentWorkflowOutcome<Blob>
  >;
}

export type CommentControllerCapability<
  TComment = unknown,
  TEvent = unknown,
  TAttachment = unknown,
  TTarget = unknown,
  TEditSession = unknown,
> = CapabilityFacet<
  CommentControllerCapabilitySnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >,
  CommentControllerCommands
>;

export type ProjectCatalogCapabilitySnapshot<
  TRecent = unknown,
  TRegistered = unknown,
> = Readonly<{
  versionSummaries: Readonly<Record<string, Readonly<{ documentId: string | null; versions: readonly unknown[]; status: "loading" | "ready" | "error"; reason?: string }>>>;
  recent: ReadonlyArray<TRecent>;
  registered: ReadonlyArray<TRegistered>;
  error: string;
}>;

export interface ProjectCatalogControllerCommands {
  restoreWorkingCopy(projectId: string): Promise<import("./project-workflow.js").ProjectWorkflowOutcome<{ restored: boolean }>>;
  refreshRecents(): Promise<import("./project-workflow.js").ProjectWorkflowOutcome<{
    projects: unknown[];
  }>>;
  refreshRegistered(): Promise<import("./project-workflow.js").ProjectWorkflowOutcome<{
    projects: unknown[];
  }>>;
  loadVersionSummaries(projectId: string, options?: { refresh?: boolean }): Promise<import("./project-workflow.js").ProjectWorkflowOutcome<{
    projectId: string;
    documentId: string;
    versions: unknown[];
  }>>;
}

export type ProjectCatalogControllerCapability<
  TRecent = unknown,
  TRegistered = unknown,
> = CapabilityFacet<
  ProjectCatalogCapabilitySnapshot<TRecent, TRegistered>,
  ProjectCatalogControllerCommands
>;

export type RunControllerCapabilitySnapshot = Readonly<{
  session: RunSessionSnapshot | null;
  workflow: RunWorkflowSnapshot | null;
}>;

export interface RunControllerCommands {
  dismiss(): ActiveRun | null;
  reopenRecentOutcome(sourcePath: string | null | undefined): boolean;
  copyHandoff(input?: { run?: ActiveRun | null }): Promise<RunWorkflowOutcome>;
  startAgent(input?: { run?: ActiveRun | null }): Promise<RunWorkflowOutcome>;
  cancel(input?: {
    run?: ActiveRun | null;
    agentMayBeRunning?: boolean;
    reason?: string;
  }): Promise<RunWorkflowOutcome>;
  resolveConflict(input: {
    run?: ActiveRun | null;
    action: "adopt-ai" | "keep-external";
  }): Promise<RunWorkflowOutcome>;
  prepareReview(input: {
    run?: ActiveRun | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
  activateReadyVersion(input: {
    run?: ActiveRun | null;
    reviewLease?: Readonly<{
      operationKey: string;
      beforeHtml: string;
    }> | null;
  }): Promise<VersionWorkflowOutcome>;
}

export type RunControllerCapability = CapabilityFacet<
  RunControllerCapabilitySnapshot,
  RunControllerCommands
>;

export type NavigationControllerCapabilitySnapshot = Readonly<{
  tabs: WorkbenchTabsSnapshot | null;
  ready: boolean;
  workflow: WorkbenchNavigationSnapshot | null;
  persistence: WorkbenchTabsPersistenceSnapshot | null;
}>;

export interface NavigationControllerCommands {
  activateTab(
    tabId: string,
    input?: { deadlineMs?: number },
  ): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
  createStartTab(): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
  createSettingsTab(): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
  createProjectRulesTab(): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
  closeTab(tabId: string): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
  openRegisteredProject(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: import("./workbench-tabs-session.js").WorkbenchTabStatus;
  }): Promise<import("./workbench-navigation-workflow.js").WorkbenchNavigationOutcome>;
}

export type NavigationControllerCapability = CapabilityFacet<
  NavigationControllerCapabilitySnapshot,
  NavigationControllerCommands
>;
export interface ConversationControllerCapability {
  updateConversationDraftText(text: string): void;
  openConversation(context: ConversationContext | null): Promise<unknown>;
  closeConversation(): void;
}

export interface AgentSelectionControllerCapability {
  selectAgent(selection: AgentSelection): AgentSelection;
  queuePendingDefaultAgent(selection: AgentSelection): AgentSelection;
  pendingDefaultAgent(): AgentSelection | null;
  readyPendingDefaultAgent(): AgentSelection | null;
  clearPendingDefaultAgent(expectedIntentId?: string): AgentSelection | null;
  commitPendingDefaultAgent(
    selection: AgentSelection | null | undefined,
    options?: Readonly<{ saveDefault?(providerId: string): Promise<unknown> }>,
  ): Promise<RunWorkflowOutcome>;
  beginAccessRepair(run?: ActiveRun | null, field?: "apiKey" | "login" | "install" | "model" | "provider"): unknown;
  clearAccessRepair(expectedIntentId?: string): unknown;
  resendAfterAccessRepair(): Promise<RunWorkflowOutcome>;
  selectAgentModel(modelId: string | null, expectedSelection?: AgentSelection | null): Promise<AgentSelection | null>;
  selectAgentReasoning(reasoning: string | null, expectedSelection?: AgentSelection | null): Promise<AgentSelection | null>;
  applyDisabledAgentProviders(ids?: readonly string[]): void;
  connectAgentApiKey(selection: AgentSelection, apiKey: string, extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>): Promise<RunWorkflowOutcome>;
  disconnectAgentApiKey(selection: AgentSelection): Promise<RunWorkflowOutcome>;
  stopRunsForProvider(providerId: string): Promise<readonly RunWorkflowOutcome[]>;
  manageAgentAccess(
    kind: "disconnect" | "remove-key" | "reconnect" | "logout",
    selection: AgentSelection,
    options?: Readonly<{
      stopRelatedRuns?: boolean;
      credentials?: Readonly<{
        clear?(): Promise<{ ok?: boolean }>;
        restore?(): Promise<unknown>;
      }>;
    }>,
  ): Promise<RunWorkflowOutcome>;
  checkAgentUsability(selection?: AgentSelection): Promise<RunWorkflowOutcome>;
  cancelAgentInstall(selection?: AgentSelection | null): Promise<RunWorkflowOutcome>;
}

export interface ReviewPreparationControllerCapability extends WorkspaceSnapshotReader {
  prepareReviewCandidate(input: {
    run?: ActiveRun | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
}

export interface RunSubmissionControllerCapability {
  planRunSubmission(): RunSubmitPlan;
}

export interface DocumentSurfaceControllerCapability extends WorkspaceSnapshotReader {
  updateDocumentSurfacePresentation(
    tabId: string,
    presentation?: Readonly<Record<string, unknown>>,
  ): DocumentSurfaceCacheEntry | null;
  confirmDocumentSurfaceReady(tabId: string, sourceSha256: string): boolean;
  deferDocumentSurfacePrewarm(delayMs?: number): boolean;
}

export interface NavigationWorkflowControllerCapability extends WorkspaceSnapshotReader {
  subscribe(
    listener: (snapshot: WorkspaceControllerSnapshot) => void,
  ): () => void;
}

export interface AiConversationControllerCapability
  extends ConversationControllerCapability, AgentSelectionControllerCapability {}
