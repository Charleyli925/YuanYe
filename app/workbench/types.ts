import type {
  HtmlCanvasRuntimeVisualHint,
  HtmlCanvasSelection,
} from "../components/HtmlCanvasEditor";
import type { DraftSnapshot } from "../application/draft-session.js";
import type { SourceHistoryDirection, SourceHistoryEntry } from "../domain/source-history.js";
import type {
  CandidateAssessment,
  ValidationReview,
} from "../domain/run-lifecycle.js";

export type HtmlProject = {
  path?: string;
  sourcePath: string;
  name: string;
  html: string;
  sha256: string;
  lastModifiedAt?: string;
  projectId?: string;
  documentId?: string;
  openTarget?: Record<string, unknown>;
  openKind?: "project";
};

export type HtmlOpenConfirmation = {
  openKind: "confirmation";
  requestId: string;
  classification: "new-external" | "known-external" | string;
  sourceFileName?: string;
  visibleV1FileName?: string;
  projectsRootLabel?: string;
  projectName?: string;
  currentBasedOnVersionId?: string | null;
  currentBasedOnOrdinal?: number;
  latestOfficialVersionId?: string | null;
  latestOfficialOrdinal?: number;
  currentDiffersFromBase?: boolean;
  sourceRelation?: "unchanged" | "changed";
};

export type HtmlOpenResult = HtmlProject | HtmlOpenConfirmation;

export type RecentProject = {
  path: string;
  sourcePath: string;
  name: string;
  lastOpenedAt: number;
};

export type RegisteredProject = {
  projectId: string;
  documentId: string | null;
  projectName: string;
  registeredProjectRootPath: string;
  activeWorkingCopyId: string | null;
  activeSourcePath: string | null;
  currentBasedOnVersionId: string | null;
  latestOfficialVersionId: string | null;
  hasPendingCandidate: boolean;
  availability: "ready" | "unavailable" | "invalid";
  sourceStatus?: "unknown" | "ready" | "external-change" | "missing" | "duplicate" | "invalid";
  canRestoreWorkingCopy?: boolean;
  availabilityReason?: string | null;
  lastUpdatedAt: string | null;
  lastOpenedAt: number | null;
};

export type ProjectVersionSummary = {
  projectId: string;
  documentId: string;
  versionId: string;
  ordinal: number;
  basedOnVersionId: string | null;
  previousVersionId?: string | null;
  displayFileName: string;
  modifiedAt: string;
  isActiveWorkingCopy: boolean | null;
  isLatestOfficial: boolean | null;
};

/**
 * Structured-clone rejection exposed by the trusted project IPC adapter.
 * Main-process Error instances and transport metadata never cross the
 * contextBridge boundary.
 */
export type DesktopProjectOperationError = Readonly<{
  code: string;
  message: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

/**
 * Project API promises reject with DesktopProjectOperationError. The
 * Promise value type below describes only the successful result, as required
 * by TypeScript's standard Promise contract.
 */
export type DesktopProjectsApi = {
  getActiveProject: () => Promise<HtmlOpenResult | null>;
  openHtml: () => Promise<HtmlOpenResult | null>;
  showInFolder?: (sourcePath: string) => Promise<{ sourcePath: string }>;
  openProjectsRoot?: () => Promise<{ opened: true }>;
  openInDefaultBrowser?: (
    sourcePath: string,
  ) => Promise<{ sourcePath: string }>;
  renameHtml?: (payload: {
    operationId: string;
    sourcePath: string;
    stem: string;
    expectedSha256: string;
  }) => Promise<HtmlProject & {
    operationId: string;
    previousSourcePath: string;
    fileName: string;
    stem: string;
    extension: string;
    renamed: boolean;
    replayed: boolean;
    workspaceRelinked: boolean;
  }>;
  revealAiTask?: (payload: {
    sourcePath: string;
  }) => Promise<{
    sourcePath: string;
    aiTaskPath: string;
    requestId: string;
    candidateId: string;
  }>;
  revealVersionFile?: (payload: {
    sourcePath: string;
    versionId: string;
  }) => Promise<{ versionPath: string }>;
  activateGeneratedVersion?: (payload: {
    operationId?: string;
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    projectId: string;
    versionId: string;
  }) => Promise<HtmlProject & {
    previousSourcePath: string;
    versionId: string;
  }>;
  activateManagedWorkingCopy?: (payload: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    projectId: string;
    documentId: string;
    workingCopyId: string;
    versionId: string;
    projectRootPath: string;
    operationId?: string;
  }) => Promise<HtmlProject & {
    previousSourcePath: string;
  }>;
  reconcileActiveManagedSource?: (payload: {
    operationId?: string;
    previousSourcePath: string;
    expectedSourceSha256: string;
    projectId: string;
    documentId: string;
    workingCopyId: string;
    versionId: string;
    reason: "watch" | "rename" | "startup" | "safe-action";
    watcherGeneration?: number;
  }) => Promise<{
    operationId: string;
    status: "unchanged" | "relocated" | "content-changed";
    previousSourcePath: string;
    sourcePath: string;
    sourceSha256: string;
    openTarget: Record<string, unknown>;
    watcherGeneration?: number;
  }>;
  onSourceFileChanged?: (
    listener: (payload: {
      sourcePath: string;
      watcherGeneration: number;
      sourceMissing?: boolean;
    }) => void,
  ) => () => void;
  exportHtmlCopy?: (payload: {
    html: string;
    sourcePath?: string | null;
    suggestedName?: string;
  }) => Promise<{
    path: string;
    name: string;
    sha256: string;
    html: string;
  } | null>;
  commitRecoveryJournal?: (payload: DocumentRecoveryJournalCommit) => Promise<DocumentRecoveryJournalSummary>;
  readRecoveryJournal?: (payload: DocumentRecoveryJournalLocator & {
    expectedJournalSha256?: string | null;
  }) => Promise<(DocumentRecoveryJournalSummary & { html: string }) | null>;
  rebaseRecoveryJournal?: (payload: DocumentRecoveryJournalRebase) => Promise<DocumentRecoveryJournalSummary>;
  removeRecoveryJournal?: (payload: DocumentRecoveryJournalLocator & {
    expectedJournalSha256?: string | null;
  }) => Promise<{ removed: boolean }>;
  listRecoveryJournals?: (payload?: { cursor?: string | null }) => Promise<{
    entries: DocumentRecoveryJournalSummary[];
    invalidCount: number;
    scannedCount?: number;
    totalBytes?: number;
    truncated?: boolean;
    nextCursor?: string | null;
    unavailable?: boolean;
  }>;
  readHtml?: (sourcePath: string) => Promise<HtmlProject>;
  listRecentProjects: () => Promise<RecentProject[]>;
  listRegisteredProjects?: () => Promise<RegisteredProject[]>;
  restoreRegisteredWorkingCopy?: (projectId: string) => Promise<{ restored: boolean }>;
  listRegisteredProjectVersionSummaries?: (
    projectId: string,
  ) => Promise<{
    projectId: string;
    documentId: string;
    currentBasedOnVersionId: string | null;
    latestVersionId: string | null;
    versions: ProjectVersionSummary[];
  }>;
  readRegisteredProjectProjection?: (projectId: string) => Promise<HtmlProject>;
  openRegisteredProject?: (projectId: string) => Promise<HtmlProject>;
  openRecent: (sourcePath: string) => Promise<HtmlOpenResult>;
  forgetRecent?: (sourcePath: string) => Promise<{ sourcePath: string }>;
  acceptExternalOpen?: (requestId: string) => Promise<HtmlOpenResult>;
  acknowledgeExternalOpen?: (requestId: string) => Promise<{
    acknowledged: boolean;
    requestId: string;
  }>;
  commitPreparedHtmlOpen?: (payload: {
    requestId: string;
    action: "import-new" | "continue-current" | "open-managed";
    deleteOriginal?: boolean;
  }) => Promise<HtmlOpenResult>;
  cancelPreparedHtmlOpen?: (requestId: string) => Promise<{ canceled: boolean }>;
  finalizePreparedHtmlOpen?: (requestId: string) => Promise<{
    disposition: "kept" | "trashed" | "trash-failed";
  }>;
  rollbackPreparedHtmlOpen?: (requestId: string) => Promise<{
    rolledBack: boolean;
    project?: HtmlProject | null;
  }>;
};

export type DocumentRecoveryJournalLocator = {
  projectId: string;
  documentId: string;
};

export type DocumentRecoveryJournalCommit = DocumentRecoveryJournalLocator & {
  sourcePath: string;
  workingCopyId?: string | null;
  expectedSourceSha256?: string | null;
  expectedJournalSha256?: string | null;
  revision: number;
  html: string;
};

export type DocumentRecoveryJournalRebase = DocumentRecoveryJournalLocator & {
  previousSourcePath: string;
  sourcePath: string;
  workingCopyId: string;
  revision: number;
  recoveryHtmlSha256: string;
  expectedJournalSha256: string;
};

export type DocumentRecoveryJournalSummary = DocumentRecoveryJournalLocator & {
  schemaVersion: "1.0.0" | "2.0.0";
  sourcePath: string;
  workingCopyId: string;
  expectedSourceSha256: string | null;
  recoveryHtmlSha256: string;
  journalSha256: string;
  revision: number;
  updatedAt: string;
  byteLength: number;
};

export type DesktopWorkbenchTabsApi = {
  get: () => Promise<{
    version: 1;
    activeTabId: string | null;
    tabs: Array<{
      tabId: string;
      projectId: string;
      documentId: string;
    }>;
  } | null>;
  set: (state: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type QoderHandoffResult = {
  status: "copied";
  copied: boolean;
  opened: boolean;
  pasted: boolean;
  reason: string | null;
};

export type AgentHandoffUiStatus =
  | "copying"
  | "copied"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelling"
  | "cancelled";

export type ProjectAgentHandoffState = {
  sourcePath: string;
  requestId: string;
  attemptId: string;
  mode?: "clipboard" | "managed-agent";
  status: AgentHandoffUiStatus;
  phase?: string;
  agentName?: string | null;
  agentVersion?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  safeToRetry?: boolean;
  recoveryKind?: "retry" | "wait" | "reauthenticate" | "change-model" | "change-provider" | "repair-installation" | "end";
};

export type DesktopIntegrationsApi = {
  handoffToQoderWork: (payload: {
    message: string;
  }) => Promise<QoderHandoffResult>;
  openAgentLogin?: (payload: {
    providerId: string;
  }) => Promise<{ opened?: boolean }>;
  openVendorApiKeyPage?: (vendorId: string) => Promise<{ opened?: boolean }>;
  persistSessionCredential?: (payload: {
    apiKey: string;
    vendorId?: string;
    baseUrl?: string;
    modelId?: string;
  }) => Promise<{ ok?: boolean; code?: string; remembered?: boolean }>;
  clearSessionCredential?: () => Promise<{ ok?: boolean; remembered?: boolean }>;
  sessionCredentialStatus?: () => Promise<{
    available?: boolean;
    remembered?: boolean;
    vendorId?: string | null;
    unreadable?: boolean;
    reconnectRequired?: boolean;
    reason?: string;
    code?: string;
  }>;
  restoreSessionCredential?: () => Promise<{
    ok?: boolean;
    restored?: boolean;
    reconnectRequired?: boolean;
    reason?: string;
    code?: string;
  }>;
};

export type ApplicationUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "current"
  | "unsupported"
  | "unavailable";

export type ApplicationUpdateResult = {
  status: ApplicationUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  architecture: string;
  downloadPercent: number | null;
  publishedAt: string | null;
};

export type DesktopUpdatesApi = {
  getStatus: () => Promise<ApplicationUpdateResult | null>;
  checkNow: () => Promise<ApplicationUpdateResult>;
  downloadAvailable: () => Promise<ApplicationUpdateResult>;
  onStatus: (
    listener: (result: ApplicationUpdateResult | null) => void,
  ) => () => void;
  installDownloaded: () => Promise<{
    installing: boolean;
    reason: "not-ready" | "close-blocked" | null;
  }>;
  openLatestRelease: () => Promise<{ opened: boolean }>;
  openRepository: () => Promise<{ opened: boolean }>;
};

declare global {
  interface Window {
    htmlAIProjects?: DesktopProjectsApi;
    htmlAIWorkbenchTabs?: DesktopWorkbenchTabsApi;
    htmlAIIntegrations?: DesktopIntegrationsApi;
    htmlAIUpdates?: DesktopUpdatesApi;
    htmlAIEdit?: {
      onHistoryRequested: (
        listener: (direction: SourceHistoryDirection) => void,
      ) => () => void;
      runNativeHistory: (
        direction: SourceHistoryDirection,
      ) => Promise<{ applied: boolean }>;
    };
    htmlAIRuntime?: {
      bridgePort: string;
      bridgeAuthToken: string;
      appVersion: string;
      getBridgeConnection?: () => Readonly<{
        bridgePort: string;
        bridgeAuthToken: string;
        appVersion: string;
      }> | null;
      onBridgeReady?: (listener: (connection: Readonly<{
        bridgePort: string;
        bridgeAuthToken: string;
        appVersion: string;
      }>) => void) => () => void;
      getStartupTiming?: () => Readonly<{
        schemaVersion: 1;
        timeOriginUnixMs: number;
        marks: ReadonlyArray<Readonly<{
          stage: string;
          atUnixMs: number;
        }>>;
      }> | null;
      capabilities?: Readonly<{
        sourceEditing: "enabled";
        projectOpening: "desktop-dialog";
        attachmentPersistence: "bridge";
        closeCoordination: "electron-handshake";
        interactivePreview: "independent-url";
      }>;
      diagnostics?: Readonly<{
        startupTiming: Readonly<{
          schemaVersion: 1;
          timeOriginUnixMs: number;
          marks: ReadonlyArray<Readonly<{
            stage: string;
            atUnixMs: number;
          }>>;
        }> | null;
        e2eStaticCandidateFailure?: boolean;
        e2eRuntimeCommitHooks?: boolean;
      }>;
    };
    __PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__?: Array<() => void>;
    __PAGEROOT_E2E_FAIL_NEXT_RUNTIME_COMMIT__?: boolean;
    __PAGEROOT_HYDRATION_STAGE__?: string;
    __PAGEROOT_PERFORMANCE_TIMELINE__?: ReadonlyArray<Readonly<{
      stage: string;
      startTime: number;
      operationId: string | null;
      timing: Readonly<Record<string, number>>;
    }>>;
  }
}

export type CommentAttachment = {
  attachmentId: string;
  kind: "image" | "file";
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  relativePath: string;
  requestRelativePath?: string;
  source?: "clipboard" | "file-picker";
};

export type CommentItem = {
  commentId: string;
  createdAt: string;
  updatedAt: string;
  target: HtmlCanvasSelection;
  /** Exact source host used for persistence and cross-version resolution. */
  sourceAnchor?: HtmlCanvasSelection;
  /** Runtime-only visual context; it never grants source authority. */
  visualHint?: HtmlCanvasRuntimeVisualHint;
  text: string;
  attachments?: CommentAttachment[];
  basedOnVersionId: string | null;
  requestId?: string;
  attemptId?: string;
  resultVersionId?: string;
};

export type CommentEditSession = {
  commentId: string;
  baselineText: string;
  baselineAttachments: CommentAttachment[];
  draftText: string;
  draftAttachments: CommentAttachment[];
};

export type OtherTabCommentEntry =
  | {
      kind: "saved";
      key: string;
      target: HtmlCanvasSelection;
      comment: CommentItem;
      previewText: string;
    }
  | {
      kind: "draft";
      key: "__composer";
      target: HtmlCanvasSelection;
      previewText: string;
    };

export type DirectEditEvent = {
  eventId: string;
  createdAt: string;
  kind: "text" | "style" | "reorder" | "structure";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  basedOnVersionId: string | null;
  revision: number;
  inherited?: boolean;
  inheritedFromVersionId?: string;
};

export type Version = {
  id: string;
  ordinal: number;
  label: string;
  summary: string;
  generatedAt: string;
  source: "初始页面" | "内部 AI" | "历史创建";
  // What the user asked for in the round that produced this version, read from
  // that round's frozen request. Null for the initial import and for rounds
  // whose records are no longer readable.
  requirement: string | null;
  contentSha256: string;
  previousVersionId: string | null;
  basedOnVersionId: string | null;
  requestId: string | null;
  attemptId: string | null;
  committed: boolean;
  comments: CommentItem[];
  directEdits: DirectEditEvent[];
  supplements: UserSupplementRecord[];
  validationReview: ValidationReview | null;
  candidateAssessment: CandidateAssessment | null;
  workingCopyId?: string | null;
  displayFileName?: string;
  modifiedAt?: string;
  isActiveWorkingCopy?: boolean | null;
  isLatestOfficial?: boolean | null;
  differsFromBase?: boolean;
  saveState?: "saved" | "saving" | "failed" | null;
};

export type UserSupplementAttachment = {
  attachmentId: string;
  fileName: string;
  mediaType: string;
  relativePath?: string;
  sha256?: string;
};

export type UserSupplementRecord = {
  recordId: string;
  action: "add" | "amend" | "retract";
  text: string;
  createdAt: string;
  referenceId?: string;
  evidenceState: "text-only" | "original-file" | "description-only";
  evidenceDescription?: string;
  attachments: UserSupplementAttachment[];
};

export type PersistState = "idle" | "preview-dirty" | "queued" | "writing" | "failed" | "conflict";
export type ViewMode = "current" | "history";
export type CanvasMode = "edit" | "preview";
export type StartupIssue = {
  title: string;
  message: string;
};
export type WorkspaceIssue = {
  title: string;
  message: string;
  source?: "lifecycle" | "locator" | "integrity";
};
export type WorkspaceFileView = {
  path: string;
  content: string;
  savedContent: string;
  loading: boolean;
  error?: string;
};
export type PendingWrite = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string | null;
  expectedSourceSha256: string | null;
  html: string;
  revision: number;
  events: DirectEditEvent[];
  historyOperations: SourceHistoryEntry[];
  recoveryIdentity: RecoveryIdentity | null;
};
export type RecoveryIdentity = {
  schemaVersion: "1.0.0";
  projectId: string;
  documentId: string;
  sourcePath: string;
  basedOnVersionId: string;
  sourceSha256: string;
  editRevision: number;
  token: string;
};
export type ProjectContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};
export type PendingDraft = DraftSnapshot<CommentItem, DirectEditEvent>;
export type BackgroundProjectResult = {
  state: "processing" | "ready" | "no-change" | "error" | "conflict";
  label: string;
  updatedAt: number;
};
export type CloseReadiness =
  | { ready: true }
  | {
      ready: false;
      reason: string;
      presentation: "in-app" | "native";
      retry?: boolean;
    };
export type PrepareCloseDetail = {
  requestId: string;
  reason: string;
  deadlineAt: number;
  waitUntil: (readiness: Promise<CloseReadiness>) => void;
};
export type CloseAbortedDetail = {
  requestId: string;
  reason: string;
};
export type CloseLifecycle = {
  preparingRequestId: string | null;
  frozenRequestId: string | null;
  abortedRequestIds: Set<string>;
};
