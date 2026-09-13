import { loadCatalogVersionSummaries } from "./project-catalog-query.js";
import { createRuntimeBridgeClient, isBridgeRequestError } from "./bridge-client.js";
import { CommentSession } from "./comment-session.js";
import { CommentWorkflow } from "./comment-workflow.js";
import { DocumentSession } from "./document-session.js";
import { DocumentWorkflow } from "./document-workflow.js";
import { DocumentSurfaceCacheSession } from "./document-surface-cache-session.js";
import { EditAuthorRuntimeSession } from "./edit-author-runtime-session.js";
import { DraftSession } from "./draft-session.js";
import { DrainCoordinator } from "./drain-coordinator.js";
import { ExternalFileOpenSession } from "./external-file-open-session.js";
import { ProjectApplicationSession } from "./project-application-session.js";
import { ProjectSession } from "./project-session.js";
import { ProjectRulesSession } from "./project-rules-session.js";
import { ProjectRulesWorkflow } from "./project-rules-workflow.js";
import { ProjectWorkflow } from "./project-workflow.js";
import { PROJECT_SESSION_COORDINATION } from "./project-session.js";
import { createRendererRecoveryStore } from "./recovery-store.js";
import { RunSession } from "./run-session.js";
import { RunWorkflow } from "./run-workflow.js";
import { RUN_SESSION_COORDINATION } from "./run-session.js";
import { verifyOpenTarget } from "./verified-project-context.js";
import { SourceHistorySession } from "./source-history-session.js";
import { ConversationSession } from "./conversation-session.js";
import { ConversationWorkflow } from "./conversation-workflow.js";
import { VersionSession } from "./version-session.js";
import { VersionWorkflow } from "./version-workflow.js";
import { createWorkspaceControllerCodecs, decodeWorkspaceResponse } from "./workspace-controller-codecs.js";
import {
  WorkbenchTabsSession,
} from "./workbench-tabs-session.js";
import { WorkbenchNavigationSession } from "./workbench-navigation-session.js";
import { WorkbenchTabsPersistenceCoordinator } from "./workbench-tabs-persistence-coordinator.js";
import {
  WorkbenchNavigationWorkflow,
  workbenchStartupPriority,
} from "./workbench-navigation-workflow.js";
import { reportInternalFailure } from "./internal-failure.js";

function copyLocator({
  operationId,
  epoch,
  sourcePath,
  expectedSourceSha256,
} = {}) {
  return Object.freeze({
    operationId: String(operationId || ""),
    epoch: Number.isSafeInteger(Number(epoch)) ? Number(epoch) : 0,
    sourcePath: String(sourcePath || ""),
    expectedSourceSha256: expectedSourceSha256
      ? String(expectedSourceSha256)
      : null,
  });
}

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function commentSourceTarget(comment) {
  return comment?.sourceAnchor || comment?.target || null;
}

function commentTargetForDisplay(sourceTarget, comment) {
  const visualHint = comment?.visualHint || comment?.target?.visualHint;
  return visualHint
    ? { ...sourceTarget, label: visualHint.label, visualHint }
    : sourceTarget;
}

function stale(identity) {
  return Object.freeze({ status: "stale", identity });
}

function registrationSnapshot({
  phase = "idle",
  operationId = null,
  identity = null,
  outcome = null,
} = {}) {
  return Object.freeze({
    registration: Object.freeze({
      phase,
      operationId: operationId ? String(operationId) : null,
      identity: identity ? copyLocator(identity) : null,
      outcome,
    }),
  });
}

function registrationErrorCode(cause) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return "PROJECT_REGISTRATION_REJECTED";
}

function projectCatalogSnapshot({ recent = [], registered = [], error = "", versionSummaries = {} } = {}) {
  return Object.freeze({
    versionSummaries: Object.freeze({ ...versionSummaries }),
    recent: Object.freeze(Array.isArray(recent) ? [...recent] : []),
    registered: Object.freeze(Array.isArray(registered) ? [...registered] : []),
    error: String(error || ""),
  });
}

export class WorkspaceRegistrationError extends Error {
  constructor(outcome) {
    super(outcome.reason);
    this.name = "WorkspaceRegistrationError";
    this.code = outcome.status === "unknown"
      ? "PROJECT_REGISTRATION_UNKNOWN"
      : outcome.code;
    if (outcome.status === "unknown") {
      this.operationId = outcome.operationId;
    }
  }
}

// Workbench presentation callbacks still consume a ProjectContext while the
// migration is in progress. The conversion remains a pure Outcome mapping: all
// registration IO, single-flight and Session publication live in the facade.
export function registrationContextFromOutcome(outcome) {
  if (outcome?.status === "succeeded") return outcome.value;
  if (outcome?.status === "blocked" || outcome?.status === "stale") return null;
  if (outcome?.status === "rejected" || outcome?.status === "unknown") {
    throw new WorkspaceRegistrationError(outcome);
  }
  throw new WorkspaceRegistrationError(rejected(
    "PROJECT_REGISTRATION_INVALID_OUTCOME",
    "项目资料初始化返回了无效结果。",
  ));
}

// Runtime composition belongs to the Application boundary. Workbench supplies
// only pure codecs and narrow desktop host ports; it never constructs
// mutable Session facts or a Bridge client.
export function createRuntimeWorkspaceController({
  initial = {},
  draftSession: draftSessionOptions = {},
  codecs,
  ports,
  documentWorkflow,
  commentWorkflow,
  projectRulesWorkflow,
  projectWorkflow,
  runWorkflow,
  versionWorkflow,
  clock,
  recoveryStore = createRendererRecoveryStore(),
} = {}) {
  if (
    !documentWorkflow
    || !commentWorkflow
    || !projectRulesWorkflow
    || !projectWorkflow
    || !runWorkflow
    || !versionWorkflow
  ) {
    throw new TypeError(
      "Runtime WorkspaceController requires every application workflow.",
    );
  }
  const bridgeClient = createRuntimeBridgeClient();
  const runSession = new RunSession({
    sourcePath: initial.runSourcePath || null,
  });
  return new WorkspaceController({
    bridgeClient,
    projectSession: new ProjectSession(),
    documentSession: new DocumentSession({
      html: typeof initial.documentHtml === "string" ? initial.documentHtml : "",
    }),
    commentSession: new CommentSession(),
    draftSession: new DraftSession({
      bridgeClient,
      encodeComment: draftSessionOptions.encodeComment,
      encodeChangeEvent: draftSessionOptions.encodeChangeEvent,
    }),
    versionSession: new VersionSession(),
    sourceHistorySession: new SourceHistorySession(),
    conversationSession: new ConversationSession(),
    workbenchTabsSession: new WorkbenchTabsSession(),
    documentSurfaceCacheSession: new DocumentSurfaceCacheSession(),
    workbenchNavigationSession: new WorkbenchNavigationSession(),
    workbenchTabsPersistenceCoordinator: new WorkbenchTabsPersistenceCoordinator({
      port: ports.workbenchTabs || null,
      clock,
    }),
    codecs,
    ports,
    documentWorkflow: {
      ...documentWorkflow,
    },
    commentWorkflow: {
      ...commentWorkflow,
      runSession,
      recoveryStore: commentWorkflow.recoveryStore || recoveryStore,
    },
    projectRulesWorkflow: {
      ...projectRulesWorkflow,
      runSession,
    },
    projectWorkflow: {
      ...projectWorkflow,
      runSession,
    },
    runWorkflow: {
      ...runWorkflow,
      runSession,
    },
    versionWorkflow: {
      ...versionWorkflow,
      runSession,
    },
    clock,
  });
}

export class WorkspaceController {
  #bridgeClient;
  #projectSession;
  #documentSession;
  #commentSession;
  #draftSession;
  #versionSession;
  #editRuntimeSession = null;
  #editRuntimeUnsubscribe = null;
  #sourceHistorySession;

  #conversationWorkflow = null;

  #conversationSession = null;

  #conversationSessionUnsubscribe = null;

  #conversationSnapshot = null;
  #runSession = null;
  #codecs;
  #hashPort;
  #recoveryPort;
  #canvasPort;
  #projectSourcePort;
  #clock;
  #drainCoordinator = new DrainCoordinator();
  #documentWorkflow = null;
  #documentWorkflowUnsubscribe = null;
  #commentWorkflow = null;
  #commentWorkflowUnsubscribe = null;
  #projectRulesWorkflow = null;
  #projectRulesWorkflowUnsubscribe = null;
  #projectWorkflow = null;
  #projectWorkflowUnsubscribe = null;
  #projectWorkflowEventsUnsubscribe = null;
  #runWorkflow = null;
  #runWorkflowUnsubscribe = null;
  #versionWorkflow = null;
  #versionWorkflowUnsubscribe = null;
  #workbenchTabsSession = null;
  #documentSurfaceCacheSession = null;
  #documentSurfaceCacheUnsubscribe = null;
  #documentSurfaceCacheSnapshot = null;
  #workbenchTabsPersistenceCoordinator = null;
  #workbenchTabsPersistenceUnsubscribe = null;
  #workbenchTabsPersistenceSnapshot = null;
  #workbenchNavigationSession = null;
  #workbenchNavigationWorkflow = null;
  #workbenchNavigationUnsubscribe = null;
  #workbenchNavigationSnapshot = null;
  #uiPreferencesPort = null;
  #agentCredentialStatusPort = null;
  #workbenchTabsUnsubscribe = null;
  #workbenchTabsSnapshot = null;
  #workbenchTabsReady = false;
  #externalOpenUnsubscribe = null;
  #navigationHostPort = null;
  #documentProjectionPort = null;
  #surfaceFramePort = null;
  #surfacePrewarmScheduler = null;
  #surfacePrewarmTimer = null;
  #surfacePrewarmGeneration = 0;
  #surfaceReadyWaiters = new Map();
  #readySurfaceKeys = new Set();
  #bufferedExternalOpens = [];
  #runSessionUnsubscribe = null;
  #sessionPublicationDepth = 0;
  #registration = registrationSnapshot().registration;
  #projectSessionSnapshot = null;
  #documentSessionSnapshot = null;
  #commentSessionSnapshot = null;
  #commentsCapabilitySnapshot = Object.freeze({
    workingCopy: null,
    persistence: null,
  });
  #commentsCapabilityListeners = new Set();
  #projectCatalogSnapshot = projectCatalogSnapshot();
  #projectCatalogListeners = new Set();
  #summaryGenerations = new Map();
  #catalogRevision = 0;
  #summarySaveReceipt = null;
  #runsCapabilitySnapshot = Object.freeze({
    session: null,
    workflow: null,
  });
  #runsCapabilityListeners = new Set();
  #navigationCapabilitySnapshot = Object.freeze({
    tabs: null,
    ready: false,
    workflow: null,
    persistence: null,
  });
  #navigationCapabilityListeners = new Set();
  #runSessionSnapshot = null;
  #versionSessionSnapshot = null;
  #editRuntimeSnapshot = null;
  #projectSnapshot = null;
  #projectRulesSnapshot = null;
  #runSnapshot = null;
  #versionSnapshot = null;
  #snapshot = Object.freeze({
    registration: this.#registration,
    projectSession: null,
    document: null,
    commentSession: null,
    runSession: null,
    versionSession: null,
    editRuntime: null,
    comment: null,
    projectRules: null,
    project: null,
    run: null,
    version: null,
    workbenchTabs: null,
    documentSurfaceCache: null,
    workbenchTabsReady: false,
    workbenchNavigation: null,
    workbenchTabsPersistence: null,
  });
  #listeners = new Set();
  #eventListeners = new Set();
  #registrationPromise = null;
  #registrationSequence = 0;
  #disposed = false;

  comments;

  projectCatalog;

  runs;

  navigation;

  constructor({
    bridgeClient,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    conversationSession = null,
    workbenchTabsSession = null,
    documentSurfaceCacheSession = null,
    workbenchNavigationSession = null,
    workbenchTabsPersistenceCoordinator = null,
    codecs,
    ports = {},
    documentWorkflow = null,
    commentWorkflow = null,
    projectRulesWorkflow = null,
    projectWorkflow = null,
    runWorkflow = null,
    versionWorkflow = null,
    clock,
  } = {}) {
    if (!bridgeClient || typeof bridgeClient.ensureProject !== "function") {
      throw new TypeError("WorkspaceController requires a Bridge client.");
    }
    if (!projectSession || typeof projectSession.register !== "function") {
      throw new TypeError("WorkspaceController requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.update !== "function") {
      throw new TypeError("WorkspaceController requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.setComments !== "function") {
      throw new TypeError("WorkspaceController requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.replaceAuthority !== "function") {
      throw new TypeError("WorkspaceController requires DraftSession injection.");
    }
    if (!versionSession || typeof versionSession.hydrate !== "function") {
      throw new TypeError("WorkspaceController requires VersionSession injection.");
    }
    if (!sourceHistorySession || typeof sourceHistorySession.activate !== "function") {
      throw new TypeError("WorkspaceController requires SourceHistorySession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("WorkspaceController requires a HashPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("WorkspaceController requires a ClockPort.");
    }
    const runSessions = [
      commentWorkflow?.runSession,
      projectRulesWorkflow?.runSession,
      projectWorkflow?.runSession,
      runWorkflow?.runSession,
      versionWorkflow?.runSession,
    ].filter(Boolean);
    if (new Set(runSessions).size > 1) {
      throw new TypeError(
        "WorkspaceController workflows require one RunSession.",
      );
    }

    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#versionSession = versionSession;
    this.#editRuntimeSession = new EditAuthorRuntimeSession({
      port: ports.editRuntime || null,
    });
    this.#sourceHistorySession = sourceHistorySession;
    this.#workbenchTabsSession = workbenchTabsSession;
    this.#workbenchTabsSnapshot = workbenchTabsSession?.snapshot || null;
    this.#documentSurfaceCacheSession = documentSurfaceCacheSession;
    this.#documentSurfaceCacheSnapshot = documentSurfaceCacheSession?.snapshot || null;
    this.#workbenchTabsPersistenceCoordinator = workbenchTabsPersistenceCoordinator;
    this.#workbenchTabsPersistenceSnapshot = workbenchTabsPersistenceCoordinator?.snapshot || null;
    this.#navigationHostPort = ports.navigation || null;
    this.#uiPreferencesPort = ports.uiPreferences || null;
    this.#agentCredentialStatusPort = ports.agentCredentialStatus || null;
    this.#documentProjectionPort = projectWorkflow?.ports?.projectOpen
      ?.readRegisteredProjection || null;
    this.#surfaceFramePort = projectWorkflow?.ports?.canvas?.requestFrame || null;
    this.#surfacePrewarmScheduler = projectWorkflow?.scheduler || {
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => globalThis.clearTimeout(handle),
    };
    this.#workbenchNavigationSession = workbenchNavigationSession;
    this.#workbenchNavigationSnapshot = workbenchNavigationSession?.snapshot || null;
    // The conversation projection is optional so an existing embedder that has
    // not opted in keeps working unchanged.
    if (conversationSession) {
      this.#conversationWorkflow = new ConversationWorkflow({
        bridgeClient,
        conversationSession,
      });
      this.#drainCoordinator.replace("conversation-draft", {
        label: "保存下一轮草稿",
        inspect: () => this.#conversationWorkflow?.hasPendingDraft
          ? { state: "pending", reason: "下一轮草稿尚未保存。" }
          : { state: "resolved" },
        drain: () => this.#conversationWorkflow?.flushDraft() ?? true,
      });
      this.#conversationSessionUnsubscribe = conversationSession.subscribe(
        (snapshot) => {
          this.#conversationSnapshot = snapshot;
          this.#publishAggregateSnapshot();
        },
      );
    }
    this.#runSession = runSessions[0] || null;
    this.#projectSessionSnapshot = projectSession.snapshot;
    this.#documentSessionSnapshot = documentSession.snapshot;
    this.#commentSessionSnapshot = commentSession.snapshot;
    this.#runSessionSnapshot = this.#runSession?.snapshot || null;
    this.#versionSessionSnapshot = versionSession.snapshot;
    this.#editRuntimeSnapshot = this.#editRuntimeSession.snapshot;
    this.#commentsCapabilitySnapshot = Object.freeze({
      workingCopy: this.#commentSessionSnapshot,
      persistence: null,
    });
    this.comments = Object.freeze({
      getSnapshot: () => this.#commentsCapabilitySnapshot,
      subscribe: (listener) => {
        if (typeof listener !== "function") {
          throw new TypeError("Comments capability listener must be a function.");
        }
        this.#commentsCapabilityListeners.add(listener);
        return () => this.#commentsCapabilityListeners.delete(listener);
      },
      commands: Object.freeze({
        beginComposer: (input) => this.beginCommentComposer(input),
        updateDraft: (draft) => this.updateCommentDraft(draft),
        rebindComposerTarget: (target) => this.rebindCommentComposer(target),
        cancelComposer: () => this.cancelCommentComposer(),
        beginEdit: (input) => this.beginCommentEdit(input),
        updateEditDraft: (draftText) => this.updateCommentEditDraft(draftText),
        clearEdit: () => this.clearCommentEdit(),
        rebindTarget: (input) => this.rebindCommentTarget(input),
        confirmEdit: (input) => this.confirmCommentEdit(input),
        flush: (input) => this.flushDraft(input),
        commit: (input) => this.commitComment(input),
        delete: (input) => this.deleteComment(input),
        deleteForElements: (input) => this.deleteCommentsForElementIds(input),
        discardComposer: () => this.discardCommentComposer(),
        cancelEdit: (input) => this.cancelCommentEdit(input),
        removeComposerAttachment: (input) => this.removeComposerAttachment(input),
        removeEditAttachment: (input) => this.removeCommentEditAttachment(input),
        uploadAttachments: (input) => this.uploadAttachments(input),
        readAttachment: (input) => this.readAttachment(input),
      }),
    });
    const projectCatalogCommands = Object.freeze({
      refreshRecents: () => this.refreshRecentProjects(),
      refreshRegistered: () => this.refreshRegisteredProjects(),
      restoreWorkingCopy: async (projectId) => {
        const outcome = await this.#requireProjectWorkflow().restoreRegisteredWorkingCopy(projectId);
        if (outcome.status === "succeeded") await this.loadRegisteredProjectVersionSummaries(projectId, { refresh: true });
        return outcome;
      },
      loadVersionSummaries: (projectId, options) => this.loadRegisteredProjectVersionSummaries(projectId, options),
    });
    this.projectCatalog = Object.freeze({
      getSnapshot: () => this.#projectCatalogSnapshot,
      subscribe: (listener) => {
        if (typeof listener !== "function") {
          throw new TypeError("Project catalog listener must be a function.");
        }
        this.#projectCatalogListeners.add(listener);
        return () => this.#projectCatalogListeners.delete(listener);
      },
      commands: projectCatalogCommands,
    });
    this.runs = Object.freeze({
      getSnapshot: () => this.#runsCapabilitySnapshot,
      subscribe: (listener) => {
        if (typeof listener !== "function") {
          throw new TypeError("Runs capability listener must be a function.");
        }
        this.#runsCapabilityListeners.add(listener);
        return () => this.#runsCapabilityListeners.delete(listener);
      },
      commands: Object.freeze({
        dismiss: () => this.dismissActiveRun(),
        reopenRecentOutcome: (sourcePath) => this.reopenRecentRunOutcome(sourcePath),
        copyHandoff: (input) => this.copyRunHandoff(input),
        startAgent: (input) => this.startRunAgent(input),
        cancel: (input) => this.cancelRun(input),
        resolveConflict: (input) => this.resolveRunConflict(input),
        prepareReview: (input) => this.prepareReviewCandidate(input),
        activateReadyVersion: (input) => this.activateReadyVersion(input),
      }),
    });
    this.navigation = Object.freeze({
      getSnapshot: () => this.#navigationCapabilitySnapshot,
      subscribe: (listener) => {
        if (typeof listener !== "function") {
          throw new TypeError("Navigation capability listener must be a function.");
        }
        this.#navigationCapabilityListeners.add(listener);
        return () => this.#navigationCapabilityListeners.delete(listener);
      },
      commands: Object.freeze({
        activateTab: (tabId, input) => this.activateWorkbenchTab(tabId, input),
        createStartTab: () => this.createWorkbenchStartTab(),
        createSettingsTab: () => this.createWorkbenchSettingsTab(),
        createProjectRulesTab: () => this.createWorkbenchProjectRulesTab(),
        closeTab: (tabId) => this.closeWorkbenchTab(tabId),
        openRegisteredProject: (input) => this.openRegisteredWorkbenchProject(input),
      }),
    });
    this.#codecs = createWorkspaceControllerCodecs(codecs);
    this.#hashPort = ports.hash;
    this.#recoveryPort = ports.recovery || { replace: () => {} };
    this.#canvasPort = ports.canvas || { invalidateRenderAcks: () => {} };
    this.#projectSourcePort = ports.projectSource || null;
    if (typeof this.#recoveryPort.replace !== "function") {
      throw new TypeError("WorkspaceController RecoveryPort must provide replace.");
    }
    if (typeof this.#canvasPort.invalidateRenderAcks !== "function") {
      throw new TypeError(
        "WorkspaceController CanvasAuthorityPort must provide invalidateRenderAcks.",
      );
    }
    if (
      this.#projectSourcePort
      && typeof this.#projectSourcePort.activateManagedWorkingCopy !== "function"
    ) {
      throw new TypeError(
        "WorkspaceController ProjectSourcePort must provide activateManagedWorkingCopy.",
      );
    }
    this.#clock = clock;
    if (documentWorkflow) {
      this.#documentWorkflow = new DocumentWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        versionSession,
        sourceHistorySession,
        codecs: documentWorkflow.codecs,
        ports: {
          hash: this.#hashPort,
          recoveryJournal: documentWorkflow.recoveryJournal || null,
          canvas: {
            invalidateRenderAcks: this.#canvasPort.invalidateRenderAcks,
            verifyRendered: documentWorkflow.canvas?.verifyRendered,
            freeze: documentWorkflow.canvas?.freeze,
            adoptHistorySource: documentWorkflow.canvas?.adoptHistorySource,
          },
        },
        scheduler: documentWorkflow.scheduler,
        clock,
      });
      this.#documentWorkflowUnsubscribe = this.#documentWorkflow.subscribeEvents(
        (event) => {
          if (
            event?.type === "document-open-target-rebound"
            && event.context
            && this.#projectSession.matches(event.context)
          ) {
            const authoritativeDraft = this.#codecs.isRecord(event.activeDraft)
              ? event.activeDraft
              : {};
            const revision = this.#codecs.authoritativeDraftRevision(
              authoritativeDraft,
            );
            if (typeof this.#draftSession.activate === "function") {
              this.#draftSession.activate(
                event.context,
                revision,
                authoritativeDraft,
              );
            } else {
              this.#draftSession.replaceAuthority(
                event.context,
                revision,
                authoritativeDraft,
              );
            }
            this.#commentWorkflow?.reconcileAuthority();
            this.#emitEvent({
              type: "draft-authority-rebound",
              context: event.context,
            });
          }
          if (
            event?.fatal
            && [
              "document-persistence-failed",
              "document-authority-reload-failed",
            ].includes(event.type)
          ) {
            this.#projectWorkflow?.reportLoadFailure(event.message);
          }
          if (event.type === "document-persisted" && this.#projectSession.matches(event.context)) this.#captureCurrentVersionSummary(event.lastSavedAt);
          this.#emitEvent(event);
        },
      );
    }
    if (commentWorkflow) {
      this.#commentWorkflow = new CommentWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        draftSession,
        versionSession,
        runSession: commentWorkflow.runSession,
        codecs: commentWorkflow.codecs,
        ports: {
          recoveryStore: commentWorkflow.recoveryStore,
          attachmentBinary: commentWorkflow.attachmentBinary,
        },
        clock,
      });
      this.#commentWorkflowUnsubscribe = this.#commentWorkflow.subscribe(
        () => this.#publishAggregateSnapshot(),
      );
      this.#commentWorkflow.subscribeEvents((event) => this.#emitEvent(event));
    }
    if (projectRulesWorkflow) {
      this.#projectRulesWorkflow = new ProjectRulesWorkflow({
        bridgeClient,
        projectSession,
        runSession: projectWorkflow?.runSession || projectRulesWorkflow.runSession,
        projectRulesSession: new ProjectRulesSession(),
        errorMessage: projectRulesWorkflow.errorMessage,
        scheduler: projectRulesWorkflow.scheduler,
        clock,
      });
      this.#projectRulesWorkflowUnsubscribe = this.#projectRulesWorkflow.subscribe(
        (snapshot) => {
          this.#projectRulesSnapshot = snapshot;
          this.#publishAggregateSnapshot();
        },
      );
    }
    if (projectWorkflow) {
      if (!this.#documentWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires DocumentWorkflow.");
      }
      if (!this.#commentWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires CommentWorkflow.");
      }
      if (!this.#projectRulesWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires ProjectRulesWorkflow.");
      }
      this.#projectWorkflow = new ProjectWorkflow({
        getCatalogRevision: () => this.#catalogRevision,
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        draftSession,
        versionSession,
        commentWorkflow: this.#commentWorkflow,
        runSession: projectWorkflow.runSession,
        projectRulesWorkflow: this.#projectRulesWorkflow,
        externalFileOpenSession: new ExternalFileOpenSession(),
        projectApplicationSession: new ProjectApplicationSession(),
        documentWorkflow: this.#documentWorkflow,
        drainCoordinator: this.#drainCoordinator,
        codecs: projectWorkflow.codecs,
        ports: {
          ...projectWorkflow.ports,
          publication: {
            begin: () => this.#beginSessionPublicationBatch(),
          },
          navigation: {
            authorizeProjectApplication: (input) => {
              if (!this.#workbenchNavigationWorkflow) {
                return Object.freeze({ accepted: false, kind: "stale" });
              }
              return this.#workbenchNavigationWorkflow.authorizeProjectApplication(input);
            },
            applyProject: (input) => {
              if (!this.#workbenchNavigationWorkflow) {
                throw new Error("Workbench navigation workflow is unavailable.");
              }
              const applicationReceipt = this.#workbenchNavigationWorkflow.applyProject(input);
              return applicationReceipt;
            },
            waitForTerminal: (transactionId) => (
              this.#workbenchNavigationWorkflow?.waitForTerminal(transactionId)
              || Promise.resolve(null)
            ),
          },
          recentRuns: {
            hydrate: (projects, activeSourcePath) => {
              if (!this.#runWorkflow) return undefined;
              return this.#runWorkflow.hydrateRecentRuns({
                projects,
                activeSourcePath,
              });
            },
          },
        },
        policies: projectWorkflow.policies,
        scheduler: projectWorkflow.scheduler,
        clock,
      });
      this.#projectWorkflowUnsubscribe = this.#projectWorkflow.subscribe(
        (snapshot) => {
          this.#projectSnapshot = snapshot;
          this.#refreshEditAuthorRuntime();
          this.#publishAggregateSnapshot();
        },
      );
      this.#projectWorkflowEventsUnsubscribe = this.#projectWorkflow.subscribeEvents(
        (event) => {
          if (event?.type === "project-open-confirmation-presented") {
            this.#workbenchNavigationWorkflow?.onConfirmationPresented(event);
          }
          if (event?.type === "project-navigation-terminal-failed") {
            this.#workbenchNavigationWorkflow?.onTerminalFailure(event);
          }
          if (event?.type === "project-catalog-loaded") {
            void this.#reconcileAndRestoreWorkbenchTabs(event.projects);
          }
          this.#updateProjectCatalogFromEvent(event);
          this.#emitEvent(event);
        },
      );
      if (this.#workbenchTabsSession && this.#workbenchNavigationSession) {
        this.#workbenchNavigationWorkflow = new WorkbenchNavigationWorkflow({
          session: this.#workbenchNavigationSession,
          tabs: this.#workbenchTabsSession,
          surfaceCache: this.#documentSurfaceCacheSession,
          projectWorkflow: this.#projectWorkflow,
          controller: this,
          tabsPersistence: this.#workbenchTabsPersistenceCoordinator,
          clock,
        });
        this.#workbenchNavigationUnsubscribe = this.#workbenchNavigationSession.subscribe(
          (snapshot) => {
            if (this.#disposed) return;
            this.#workbenchNavigationSnapshot = snapshot;
            this.#publishAggregateSnapshot();
          },
        );
        this.#workbenchTabsUnsubscribe = this.#workbenchTabsSession.subscribe((snapshot) => {
          if (this.#disposed) return;
          const priorActiveTabId = this.#workbenchTabsSnapshot?.activeTabId || null;
          if (snapshot.pendingTabId) this.#cancelSurfacePrewarm();
          this.#workbenchTabsSnapshot = snapshot;
          this.#documentSurfaceCacheSession?.reconcile(
            snapshot.tabs
              .filter((tab) => tab.kind === "document")
              .map((tab) => tab.tabId),
          );
          this.#refreshDocumentSurfaceCache();
          this.#publishAggregateSnapshot();
          if (
            !snapshot.pendingTabId
            && snapshot.activeTabId !== priorActiveTabId
            && snapshot.tabs.some((tab) => (
              tab.kind === "document" && tab.tabId === snapshot.activeTabId
            ))
          ) this.#scheduleInactiveSurfacePrewarm(snapshot.activeTabId);
        });
        this.#documentSurfaceCacheUnsubscribe =
          this.#documentSurfaceCacheSession?.subscribe((snapshot) => {
            if (this.#disposed) return;
            this.#documentSurfaceCacheSnapshot = snapshot;
            this.#publishAggregateSnapshot();
          }) || null;
        this.#workbenchTabsPersistenceUnsubscribe =
          this.#workbenchTabsPersistenceCoordinator?.subscribe((snapshot) => {
            if (this.#disposed) return;
            const wasFailed = this.#workbenchTabsPersistenceSnapshot?.phase === "failed";
            this.#workbenchTabsPersistenceSnapshot = snapshot;
            this.#publishAggregateSnapshot();
            if (snapshot.phase === "failed" && !wasFailed) {
              reportInternalFailure({
                area: "navigation",
                operation: "tabs-persist",
                code: "write-unrecovered",
                recovered: false,
                cause: snapshot.error,
              });
              this.#emitEvent({
                type: "workbench-tabs-persistence-failed",
                reason: snapshot.error || "标签页状态写入失败。",
              });
            }
          }) || null;
      }
    }
    if (runWorkflow) {
      if (!this.#documentWorkflow || !this.#projectWorkflow) {
        throw new TypeError(
          "WorkspaceController RunWorkflow requires DocumentWorkflow and ProjectWorkflow.",
        );
      }
      this.#runWorkflow = new RunWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        versionSession,
        runSession: runWorkflow.runSession,
        documentWorkflow: this.#documentWorkflow,
        drain: ({ boundary, deadlineAt }) => this.#projectWorkflow.drain(
          boundary,
          { deadlineAt },
        ),
        codecs: runWorkflow.codecs,
        ports: {
          canvas: runWorkflow.canvas,
          handoff: runWorkflow.handoff,
          uiPreferences: this.#uiPreferencesPort,
          agentCredentialStatus: this.#agentCredentialStatusPort,
          hash: this.#hashPort,
        },
        scheduler: runWorkflow.scheduler,
        clock,
      });
      this.#runWorkflowUnsubscribe = this.#runWorkflow.subscribe((snapshot) => {
        this.#runSnapshot = snapshot;
        this.#publishAggregateSnapshot();
      });
      this.#runWorkflow.subscribeEvents((event) => this.#emitEvent(event));
      this.#runSessionUnsubscribe = runWorkflow.runSession.subscribe(() => {
        this.#runWorkflow?.syncPolling();
        this.#publishAggregateSnapshot();
      });
      this.#runWorkflow.syncPolling();
    }
    if (versionWorkflow) {
      if (!this.#documentWorkflow || !this.#commentWorkflow || !this.#projectWorkflow) {
        throw new TypeError(
          "WorkspaceController VersionWorkflow requires Document, Comment and Project workflows.",
        );
      }
      this.#versionWorkflow = new VersionWorkflow({
        bridgeClient,
        projectSession,
        documentSession,
        versionSession,
        runSession: versionWorkflow.runSession,
        projectWorkflow: this.#projectWorkflow,
        documentWorkflow: this.#documentWorkflow,
        commentWorkflow: this.#commentWorkflow,
        commentSession,
        draftSession,
        codecs: versionWorkflow.codecs,
        ports: {
          hash: this.#hashPort,
          canvas: versionWorkflow.canvas,
        },
        clock,
      });
      this.#versionWorkflowUnsubscribe = this.#versionWorkflow.subscribe((snapshot) => {
        this.#versionSnapshot = snapshot;
        this.#publishAggregateSnapshot();
      });
      this.#versionWorkflow.subscribeEvents((event) => this.#emitEvent(event));
    }
    this.#observeSessionSnapshots();
    this.#editRuntimeUnsubscribe = this.#editRuntimeSession.subscribe((snapshot) => {
      if (this.#disposed) return;
      this.#editRuntimeSnapshot = snapshot;
      this.#publishAggregateSnapshot();
    });
    this.#refreshEditAuthorRuntime();
    this.#publishAggregateSnapshot();
    if (typeof ports.navigation?.subscribeExternalOpen === "function") {
      this.#externalOpenUnsubscribe = ports.navigation.subscribeExternalOpen((request) => {
        if (!this.#workbenchTabsReady) {
          this.#bufferedExternalOpens.push(request);
          return;
        }
        void this.acceptExternalProject(request);
      });
    }
    void this.#initializeWorkbenchTabs();
  }

  getSnapshot() {
    return this.#snapshot;
  }

  // Conversation commands. The view calls these; it never reaches the Bridge or
  // the conversation session directly.
  openConversation(context) {
    return this.#conversationWorkflow?.open(context) ?? Promise.resolve(null);
  }

  closeConversation() {
    this.#conversationWorkflow?.close();
  }

  updateConversationDraftText(text) {
    // Close phase is published before draining; React may not have disabled the input yet.
    if (["preparing", "ready"].includes(this.#projectSnapshot?.close?.phase)) return;
    this.#conversationWorkflow?.updateDraftText(text);
  }

  updateConversationDraftIntent(intent) {
    if (["preparing", "ready"].includes(this.#projectSnapshot?.close?.phase)) return;
    this.#conversationWorkflow?.updateDraftIntent(intent);
  }

  flushConversationDraft() {
    return this.#conversationWorkflow?.flushDraft() ?? Promise.resolve(true);
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("WorkspaceController listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("WorkspaceController event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  dispose() {
    this.#cancelSurfacePrewarm();
    for (const waiters of this.#surfaceReadyWaiters.values()) {
      for (const finish of waiters) finish(false);
    }
    this.#surfaceReadyWaiters.clear();
    this.#readySurfaceKeys.clear();
    this.#disposed = true;
    this.#projectSession.setObserver(null);
    this.#documentSession.setObserver(null);
    this.#commentSession.setObserver(null);
    this.#runSession?.setObserver(null);
    this.#versionSession.setObserver(null);
    this.#editRuntimeUnsubscribe?.();
    this.#editRuntimeUnsubscribe = null;
    this.#editRuntimeSession?.dispose();
    this.#editRuntimeSession = null;
    this.#versionWorkflowUnsubscribe?.();
    this.#versionWorkflowUnsubscribe = null;
    this.#versionWorkflow?.dispose();
    this.#versionWorkflow = null;
    this.#workbenchTabsUnsubscribe?.();
    this.#workbenchTabsUnsubscribe = null;
    this.#documentSurfaceCacheUnsubscribe?.();
    this.#documentSurfaceCacheUnsubscribe = null;
    this.#workbenchTabsPersistenceUnsubscribe?.();
    this.#workbenchTabsPersistenceUnsubscribe = null;
    this.#workbenchNavigationUnsubscribe?.();
    this.#workbenchNavigationUnsubscribe = null;
    this.#workbenchNavigationWorkflow?.dispose();
    this.#workbenchNavigationWorkflow = null;
    this.#workbenchNavigationSession = null;
    this.#workbenchTabsPersistenceCoordinator?.dispose();
    this.#workbenchTabsPersistenceCoordinator = null;
    this.#documentSurfaceCacheSession?.dispose();
    this.#documentSurfaceCacheSession = null;
    this.#externalOpenUnsubscribe?.();
    this.#externalOpenUnsubscribe = null;
    this.#workbenchTabsSession = null;
    this.#runSessionUnsubscribe?.();
    this.#runSessionUnsubscribe = null;
    this.#conversationSessionUnsubscribe?.();
    this.#conversationSessionUnsubscribe = null;
    this.#conversationWorkflow?.close();
    this.#conversationWorkflow = null;
    this.#runWorkflowUnsubscribe?.();
    this.#runWorkflowUnsubscribe = null;
    this.#runWorkflow?.dispose();
    this.#runWorkflow = null;
    this.#projectWorkflowUnsubscribe?.();
    this.#projectWorkflowUnsubscribe = null;
    this.#projectWorkflowEventsUnsubscribe?.();
    this.#projectWorkflowEventsUnsubscribe = null;
    this.#projectWorkflow?.dispose();
    this.#projectWorkflow = null;
    this.#projectRulesWorkflowUnsubscribe?.();
    this.#projectRulesWorkflowUnsubscribe = null;
    this.#projectRulesWorkflow?.dispose();
    this.#projectRulesWorkflow = null;
    this.#commentWorkflowUnsubscribe?.();
    this.#commentWorkflowUnsubscribe = null;
    this.#commentWorkflow?.dispose();
    this.#commentWorkflow = null;
    this.#documentWorkflowUnsubscribe?.();
    this.#documentWorkflowUnsubscribe = null;
    this.#documentWorkflow?.dispose();
    this.#documentWorkflow = null;
    this.#listeners.clear();
    this.#eventListeners.clear();
    this.#commentsCapabilityListeners.clear();
    this.#projectCatalogListeners.clear();
    this.#runsCapabilityListeners.clear();
    this.#navigationCapabilityListeners.clear();
  }

  get hasDocumentHistoryAction() {
    return Boolean(this.#documentWorkflow?.hasHistoryAction);
  }

  get projectHydrating() {
    return Boolean(this.#projectWorkflow?.projectHydrating);
  }

  get projectLoadError() {
    return this.#projectWorkflow?.projectLoadError || null;
  }

  startEditAuthorRuntimePreparation(input) {
    return this.#editRuntimeSession?.startPreparation(input) || false;
  }

  beginEditAuthorRuntime(input) {
    return this.#editRuntimeSession?.beginRuntime(input) || false;
  }

  settleEditAuthorRuntime(input) {
    return this.#editRuntimeSession?.settleRuntime(input) || false;
  }

  async retryEditAuthorRuntime() {
    if (!this.#editRuntimeSession?.snapshot.retryAvailable) return false;
    const requested = this.#currentEditAuthorRuntimeInput();
    // A failure may be displayed before the last autosave ACK arrives. Join
    // the existing save flight, then retry only the same document/canvas using
    // its latest authoritative bytes. Never queue a retry onto another file.
    const saved = await this.flushDocument();
    const current = this.#currentEditAuthorRuntimeInput();
    if (saved?.status !== "succeeded"
      || current.sourcePath !== requested.sourcePath
      || current.canvasGeneration !== requested.canvasGeneration) return false;
    return this.#editRuntimeSession?.retry(current) || false;
  }

  getCurrentProjectContext() {
    return this.#projectSession.context;
  }

  matchesCurrentProjectContext(context) {
    return this.#projectSession.matches(context);
  }

  reloadDocumentCanvas() {
    return this.#documentSession.reloadCanvas();
  }

  replaceCommentWorkingCopy(input) {
    return this.#requireCommentWorkflow().applyWorkingCopy(input);
  }

  clearCompletedRun() {
    if (this.#runSession?.activeRun?.status !== "complete") return false;
    this.#runSession.clearActiveRun();
    return true;
  }

  dismissActiveRun() {
    if (!this.#runSession) return null;
    const activeRun = this.#runSession.activeRun;
    if (activeRun?.sourcePath) {
      this.#runSession.rememberOutcome(activeRun);
      this.#runSession.clearHandoff(activeRun.sourcePath);
    }
    this.#runSession.clearActiveRun();
    this.#runSession.clearActiveHandoff();
    return activeRun;
  }

  reopenRecentRunOutcome(sourcePath) {
    if (!this.#runSession) return false;
    const outcome = this.#runSession.outcomeForSource(sourcePath);
    if (!outcome) return false;
    this.#runSession.setActiveRun(outcome);
    return true;
  }

  activateWorkbenchTab(tabId, input) {
    return this.#workbenchNavigationWorkflow?.activateTab(tabId, input)
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  createWorkbenchStartTab() {
    return this.#workbenchNavigationWorkflow?.createStart()
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  createWorkbenchSettingsTab() {
    return this.#workbenchNavigationWorkflow?.createSettings()
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  createWorkbenchProjectRulesTab() {
    return this.#workbenchNavigationWorkflow?.createProjectRules()
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  closeWorkbenchTab(tabId) {
    return this.#workbenchNavigationWorkflow?.closeTab(tabId)
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  openRegisteredWorkbenchProject(input) {
    return this.#workbenchNavigationWorkflow?.openRegisteredProject(input)
      || Promise.resolve(rejected("WORKBENCH_TABS_UNAVAILABLE", "标签页尚未完成初始化。"));
  }

  updateWorkbenchTabStatus(projectId, documentId, status) {
    return this.#workbenchTabsSession?.updateStatus(projectId, documentId, status) || null;
  }

  updateWorkbenchTabTitle(projectId, documentId, title) {
    return this.#workbenchTabsSession?.updateTitle(projectId, documentId, title) || null;
  }

  updateDocumentSurfacePresentation(tabId, presentation) {
    return this.#documentSurfaceCacheSession?.updatePresentation(tabId, presentation) || null;
  }

  confirmDocumentSurfaceReady(tabId, sourceSha256) {
    const key = `${String(tabId || "")}:${String(sourceSha256 || "")}`;
    const waiters = this.#surfaceReadyWaiters.get(key);
    if (!waiters?.size) {
      this.#readySurfaceKeys.add(key);
      if (this.#readySurfaceKeys.size > 64) {
        this.#readySurfaceKeys.delete(this.#readySurfaceKeys.values().next().value);
      }
      return true;
    }
    for (const finish of [...waiters]) finish(true);
    return true;
  }

  deferDocumentSurfacePrewarm(delayMs = 900) {
    const activeTabId = this.#workbenchTabsSession?.snapshot.activeTabId;
    if (!activeTabId) return false;
    this.#cancelSurfacePrewarm();
    this.#surfacePrewarmTimer = this.#surfacePrewarmScheduler?.setTimeout(() => {
      this.#scheduleInactiveSurfacePrewarm(activeTabId);
    }, Math.max(250, Number(delayMs) || 900));
    return true;
  }

  async #initializeWorkbenchTabs() {
    if (!this.#workbenchTabsSession || !this.#projectWorkflow) return;
    const initialExternalPromise = typeof this.#navigationHostPort?.readInitialExternalOpen === "function"
      ? Promise.resolve()
        .then(() => this.#navigationHostPort.readInitialExternalOpen())
        .catch(() => null)
      : Promise.resolve(null);
    const storedPromise = this.#workbenchTabsPersistenceCoordinator
      ? this.#workbenchTabsPersistenceCoordinator.load().catch(() => null)
      : Promise.resolve(null);
    const preferencesPromise = typeof this.#uiPreferencesPort?.get === "function"
      ? Promise.resolve(this.#uiPreferencesPort.get()).catch(() => null)
      : Promise.resolve(null);
    const initialExternal = await initialExternalPromise;
    const hasBufferedExternal = this.#bufferedExternalOpens.length > 0;
    if (initialExternal || hasBufferedExternal) {
      if (this.#disposed) return;
      // External files have absolute startup priority. Do not wait for
      // optional preferences or restore a stale tab snapshot before admitting
      // the file the user explicitly opened.
      this.#workbenchTabsReady = true;
      this.#publishAggregateSnapshot();
      const externalRequests = [];
      const seenExternalRequests = new Set();
      for (const request of [initialExternal, ...this.#bufferedExternalOpens]) {
        const requestId = String(request?.requestId || "");
        if (!requestId || seenExternalRequests.has(requestId)) continue;
        seenExternalRequests.add(requestId);
        externalRequests.push(request);
      }
      this.#bufferedExternalOpens = [];
      for (const request of externalRequests) void this.acceptExternalProject(request);
      // Both promises have rejection handlers and are intentionally allowed to
      // settle in the background so this path never delays the first HTML.
      void Promise.all([storedPromise, preferencesPromise]);
      return;
    }
    const [stored, preferences] = await Promise.all([storedPromise, preferencesPromise]);
    const restoreTabsOnLaunch = preferences?.workspace?.restoreTabsOnLaunch !== false;
    const storedStatePresent = Boolean(stored && restoreTabsOnLaunch);
    if (storedStatePresent) this.#workbenchTabsSession.hydrate(stored);
    if (this.#disposed) return;
    this.#workbenchTabsReady = true;
    this.#publishAggregateSnapshot();
    const externalRequests = [];
    const seenExternalRequests = new Set();
    for (const request of [initialExternal, ...this.#bufferedExternalOpens]) {
      const requestId = String(request?.requestId || "");
      if (!requestId || seenExternalRequests.has(requestId)) continue;
      seenExternalRequests.add(requestId);
      externalRequests.push(request);
    }
    this.#bufferedExternalOpens = [];
    const startupPriority = workbenchStartupPriority({
      externalRequestCount: externalRequests.length,
      persistedStatePresent: storedStatePresent,
      persistedActiveTabId: this.#workbenchTabsSession.snapshot.pendingTabId,
      restoreTabsOnLaunch,
    });
    if (startupPriority === "external") {
      const pending = this.#workbenchTabsSession.snapshot.pendingTabId;
      if (pending) this.#workbenchTabsSession.cancelSwitch(pending);
      for (const request of externalRequests) void this.acceptExternalProject(request);
      return;
    }
    if (startupPriority === "persisted-active-tab") {
      if (this.#workbenchTabsSession.snapshot.tabs.some((tab) => tab.kind === "document")) {
        await this.#projectWorkflow.refreshRegisteredProjects();
      }
      return;
    }
    if (startupPriority === "start") {
      // A persisted Start remains active, but its retained document tabs still
      // need Registry projection for real titles and missing-project cleanup.
      // Refreshing the catalog does not activate activePath compatibility.
      if (this.#workbenchTabsSession.snapshot.tabs.some((tab) => tab.kind === "document")) {
        await this.#projectWorkflow.refreshRegisteredProjects();
      }
      return;
    }
    await this.#workbenchNavigationWorkflow?.openProject({ kind: "startup" });
  }

  async #reconcileAndRestoreWorkbenchTabs(projects) {
    if (!this.#workbenchTabsReady || !this.#workbenchTabsSession) return;
    const priorRevision = this.#workbenchTabsSession.snapshot.revision;
    const reconciled = this.#workbenchTabsSession.reconcileRegisteredProjects(projects);
    if (reconciled.missing.length > 0) {
      this.#emitEvent({
        type: "workbench-tabs-restore-missing",
        missing: reconciled.missing,
      });
    }
    const pending = this.#workbenchTabsSession.snapshot.pendingTabId;
    if (!pending || !this.#workbenchNavigationWorkflow) {
      if (this.#workbenchTabsSession.snapshot.revision !== priorRevision) {
        this.#workbenchTabsPersistenceCoordinator?.commit(this.#workbenchTabsSession.serialize());
      }
      return;
    }
    const pendingTab = this.#workbenchTabsSession.resolveTab(pending);
    if (pendingTab?.kind === "document") {
      const prewarmed = await this.#prewarmDocumentSurface(pendingTab, { hot: true });
      if (prewarmed) {
        await this.#waitForSurfaceReady(prewarmed);
        await this.#waitForSurfaceFrame();
      }
    }
    const outcome = await this.#workbenchNavigationWorkflow.activateTab(pending, {
      intentKind: "startup-restore",
    });
    if (outcome.status === "succeeded") return;
    if (outcome.committed === true) {
      let hydration;
      try {
        hydration = await this.retryProjectHydration();
      } catch (cause) {
        hydration = { status: "rejected", reason: String(cause?.message || cause) };
      }
      if (hydration.status === "succeeded") {
        reportInternalFailure({
          area: "navigation",
          operation: "restore-settle",
          code: "hydration-retried",
          recovered: true,
          cause: outcome.reason,
        });
        return;
      }
      reportInternalFailure({
        area: "navigation",
        operation: "restore-settle",
        code: "hydration-unrecovered",
        recovered: false,
        cause: hydration.reason || outcome.reason,
      });
      const target = this.#workbenchTabsSession.resolveTab(pending);
      if (target?.kind === "document") {
        this.#workbenchTabsSession.updateStatus(
          target.projectId,
          target.documentId,
          "error",
        );
      }
    } else {
      this.#workbenchTabsSession.close(pending);
    }
    this.#emitEvent({
      type: "workbench-tabs-restore-failed",
      tabId: pending,
      committed: outcome.committed === true,
      reason: outcome.reason,
    });
  }

  async #prewarmDocumentSurface(tab, { hot = false } = {}) {
    if (
      this.#disposed
      || tab?.kind !== "document"
      || typeof this.#documentProjectionPort !== "function"
    ) return null;
    const existing = this.#documentSurfaceCacheSession?.snapshot.entries
      .find((entry) => entry.tabId === tab.tabId);
    if (existing) return existing;
    const projection = await this.#documentProjectionPort(tab.projectId).catch(() => null);
    const current = this.#workbenchTabsSession?.resolveTab(tab.tabId);
    if (
      this.#disposed
      || current?.kind !== "document"
      || current.projectId !== tab.projectId
      || current.documentId !== tab.documentId
      || projection?.projectId !== tab.projectId
      || projection?.documentId !== tab.documentId
    ) return null;
    const admitted = this.#documentSurfaceCacheSession?.captureProjection({
      tab: current,
      project: projection,
      hot,
    }) || null;
    if (admitted) {
      this.#emitEvent({
        type: "document-surface-prewarmed",
        tabId: admitted.tabId,
        sourceSha256: admitted.sourceSha256,
        hot: admitted.tier === "hot",
      });
    }
    return admitted;
  }

  #waitForSurfaceFrame() {
    return new Promise((resolve) => {
      if (typeof this.#surfaceFramePort === "function") {
        let remainingFrames = 2;
        const nextFrame = () => {
          remainingFrames -= 1;
          if (remainingFrames <= 0) resolve();
          else this.#surfaceFramePort(nextFrame);
        };
        this.#surfaceFramePort(nextFrame);
        return;
      }
      this.#surfacePrewarmScheduler?.setTimeout(resolve, 0);
    });
  }

  #waitForSurfaceReady(entry, timeoutMs = 1_000) {
    const key = `${entry.tabId}:${entry.sourceSha256}`;
    if (this.#readySurfaceKeys.delete(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer = null;
      const finish = (ready) => {
        if (timer !== null) this.#surfacePrewarmScheduler?.clearTimeout(timer);
        const waiters = this.#surfaceReadyWaiters.get(key);
        waiters?.delete(finish);
        if (!waiters?.size) this.#surfaceReadyWaiters.delete(key);
        resolve(ready);
      };
      const waiters = this.#surfaceReadyWaiters.get(key) || new Set();
      waiters.add(finish);
      this.#surfaceReadyWaiters.set(key, waiters);
      timer = this.#surfacePrewarmScheduler?.setTimeout(
        () => finish(false),
        Math.max(100, Number(timeoutMs) || 1_000),
      );
    });
  }

  #scheduleInactiveSurfacePrewarm(activeTabId) {
    this.#cancelSurfacePrewarm();
    const tabs = this.#workbenchTabsSession?.snapshot.tabs || [];
    const activeIndex = tabs.findIndex((tab) => tab.tabId === activeTabId);
    const queue = tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => tab.kind === "document" && tab.tabId !== activeTabId)
      .sort((left, right) => (
        Math.abs(left.index - activeIndex) - Math.abs(right.index - activeIndex)
        || left.index - right.index
      ));
    const generation = ++this.#surfacePrewarmGeneration;
    const runNext = async () => {
      if (
        this.#disposed
        || generation !== this.#surfacePrewarmGeneration
        || this.#workbenchTabsSession?.snapshot.pendingTabId
      ) return;
      if (this.projectHydrating) {
        this.#surfacePrewarmTimer = this.#surfacePrewarmScheduler?.setTimeout(
          runNext,
          240,
        );
        return;
      }
      const next = queue.shift();
      if (!next) {
        this.#surfacePrewarmTimer = null;
        return;
      }
      await this.#prewarmDocumentSurface(next.tab);
      if (generation !== this.#surfacePrewarmGeneration) return;
      this.#surfacePrewarmTimer = this.#surfacePrewarmScheduler?.setTimeout(
        runNext,
        180,
      );
    };
    this.#surfacePrewarmTimer = this.#surfacePrewarmScheduler?.setTimeout(runNext, 180);
  }

  #cancelSurfacePrewarm() {
    this.#surfacePrewarmGeneration += 1;
    if (this.#surfacePrewarmTimer !== null) {
      this.#surfacePrewarmScheduler?.clearTimeout(this.#surfacePrewarmTimer);
      this.#surfacePrewarmTimer = null;
    }
  }

  refreshProject(input) {
    return this.#requireProjectWorkflow().refreshWorkspace(input);
  }

  retryProjectHydration() {
    return this.#requireProjectWorkflow().retryHydration();
  }

  prepareProjectSwitch(input) {
    return this.#requireProjectWorkflow().prepareSwitch(input);
  }

  openProject(input) {
    return this.#requireWorkbenchNavigationWorkflow().openProject(input);
  }

  acceptProject(project, input) {
    return this.#requireProjectWorkflow().acceptProject(project, input);
  }

  acceptExternalProject(input) {
    return this.#requireWorkbenchNavigationWorkflow().acceptExternalProject(input);
  }

  confirmExternalOpen(input = {}) {
    if (input?.action === "view-initial") {
      return Promise.resolve(Object.freeze({
        status: "rejected",
        code: "EXTERNAL_OPEN_ACTION_UNSUPPORTED",
        reason: "这条打开确认不提供查看初始版本。",
      }));
    }
    return this.#requireWorkbenchNavigationWorkflow().confirmOpen(input);
  }

  cancelExternalOpen(input) {
    return this.#requireWorkbenchNavigationWorkflow().cancelOpen(input);
  }

  setExternalOpenDeleteOriginal(input) {
    return this.#requireProjectWorkflow().setExternalOpenDeleteOriginal(input);
  }

  retryExternalOpen(input) {
    return this.#requireWorkbenchNavigationWorkflow().retryOpen(input);
  }

  acknowledgeEditCanvas(input) {
    return this.#documentSession.confirmCanvas(input);
  }

  retryCanvasVerification(input) {
    this.#documentSession.reloadCanvas();
    return this.#requireDocumentWorkflow().ensureCurrentCanvas(input);
  }

  resumeDeferredExternalProject() {
    return this.#requireWorkbenchNavigationWorkflow().resumeDeferredExternalProject();
  }

  resumeDeferredProjectApplication() {
    return this.#requireWorkbenchNavigationWorkflow().resumeDeferredProjectApplication();
  }

  reconcileProjectTransitions() {
    return this.#requireProjectWorkflow().reconcileDeferred();
  }

  async prepareClose(input) {
    const navigation = this.#requireWorkbenchNavigationWorkflow();
    const project = this.#requireProjectWorkflow();
    const requestId = String(input?.requestId || "");
    const abortPreparation = () => {
      navigation.abortClose({ requestId });
      this.#workbenchTabsPersistenceCoordinator?.releaseCloseRevision();
    };
    if (!navigation.beginClose({ requestId })) {
      return Object.freeze({
        ready: false,
        reason: "另一个关闭核对正在进行。",
        presentation: "in-app",
        retry: true,
      });
    }
    try {
      const navigationReady = await navigation.prepareClose(input);
      if (!navigationReady) {
        abortPreparation();
        return Object.freeze({
          ready: false,
          reason: "HTML 导航尚未在关闭时限内完成。",
          presentation: "in-app",
          retry: true,
        });
      }
      // Open-tab layout is restart convenience metadata. Its coordinator keeps
      // writing best-effort, but failure must not veto a content-safe exit.
      const projectReady = await project.prepareClose(input);
      if (!projectReady?.ready) {
        abortPreparation();
        return projectReady;
      }
      if (!navigation.commitClose({ requestId })) {
        project.abortClose(input);
        abortPreparation();
        return Object.freeze({
          ready: false,
          reason: "桌面外壳已取消本次关闭。",
          presentation: "in-app",
          retry: true,
        });
      }
      return projectReady;
    } catch (cause) {
      abortPreparation();
      throw cause;
    }
  }

  abortClose(input) {
    this.#workbenchNavigationWorkflow?.abortClose(input);
    this.#workbenchTabsPersistenceCoordinator?.releaseCloseRevision();
    this.#workbenchTabsPersistenceCoordinator?.retry();
    return this.#requireProjectWorkflow().abortClose(input);
  }

  hasPendingDrain(boundary) {
    return this.#requireProjectWorkflow().hasPending(boundary);
  }

  inspectDrain(boundary) {
    return this.#requireProjectWorkflow().inspectDrain(boundary);
  }

  drainBoundary(boundary, input) {
    return this.#requireProjectWorkflow().drain(boundary, input);
  }

  drainCloseFallback(input) {
    return this.#requireProjectWorkflow().drainCloseFallback(input);
  }

  refreshRecentProjects() {
    return this.#requireProjectWorkflow().refreshRecents();
  }

  async refreshRegisteredProjects() {
    const outcome = await this.#requireProjectWorkflow().refreshRegisteredProjects();
    if (outcome.status === "succeeded") await Promise.all(Object.keys(this.#projectCatalogSnapshot.versionSummaries)
      .filter((id) => this.#projectCatalogSnapshot.registered.some((row) => row.projectId === id))
      .map((id) => this.loadRegisteredProjectVersionSummaries(id, { refresh: true })));
    return outcome;
  }

  async loadRegisteredProjectVersionSummaries(projectId, { refresh = false } = {}) {
    return loadCatalogVersionSummaries({ projectId, refresh,
      getSnapshot: () => this.#projectCatalogSnapshot,
      generations: this.#summaryGenerations,
      publish: (id, entry) => this.#publishVersionSummary(id, entry),
      read: (id) => this.#requireProjectWorkflow().loadRegisteredProjectVersionSummaries(id),
      decode: this.#codecs.projectVersionSummariesFromWorkspace,
      isDisposed: () => this.#disposed,
    });
  }

  #publishVersionSummary(projectId, entry) {
    this.#projectCatalogSnapshot = projectCatalogSnapshot({ ...this.#projectCatalogSnapshot,
      versionSummaries: { ...this.#projectCatalogSnapshot.versionSummaries, [projectId]: Object.freeze({ ...entry, versions: Object.freeze([...entry.versions]) }) },
    });
    for (const listener of this.#projectCatalogListeners) {
      try { listener(); } catch { /* A view cannot change catalog facts. */ }
    }
  }

  #captureCurrentVersionSummary(modifiedAt = null) {
    const { projectId, documentId, sourcePath } = this.#projectSession.snapshot;
    const snapshot = this.#versionSession.snapshot;
    if (!projectId || !documentId || !snapshot.versions.length
      || (snapshot.latestVersionId && !snapshot.versions.some((row) => row.id === snapshot.latestVersionId))
      || (snapshot.currentBasedOnVersionId && !snapshot.versions.some((row) => row.id === snapshot.currentBasedOnVersionId))) return;
    const activeVersion = snapshot.versions.find((row) => row.id === snapshot.currentBasedOnVersionId);
    // A save receipt belongs to this exact decoded Working Copy authority.
    // A newly decoded workspace must never inherit a historical cache timestamp.
    if (modifiedAt) this.#summarySaveReceipt = { projectId, documentId, activeVersion, modifiedAt };
    const receipt = this.#summarySaveReceipt;
    const activeModifiedAt = receipt?.projectId === projectId && receipt.documentId === documentId
      && receipt.activeVersion === activeVersion ? receipt.modifiedAt : null;
    const versions = this.#codecs.projectVersionSummariesFromVersions(snapshot.versions, projectId, documentId, sourcePath || "", {
      activeVersionId: snapshot.currentBasedOnVersionId, latestVersionId: snapshot.latestVersionId, activeModifiedAt,
    });
    this.#catalogRevision += 1;
    this.#summaryGenerations.set(projectId, (this.#summaryGenerations.get(projectId) || 0) + 1);
    this.#publishVersionSummary(projectId, { documentId, versions, status: "ready", reason: "" });
  }

  openProjectRules(input) {
    return this.#requireProjectRulesWorkflow().open(input);
  }

  updateProjectRules(input) {
    return this.#requireProjectRulesWorkflow().updateContent(input);
  }

  beginProjectRulesComposition(input) {
    return this.#requireProjectRulesWorkflow().beginComposition(input);
  }

  finishProjectRulesComposition(input) {
    return this.#requireProjectRulesWorkflow().finishComposition(input);
  }

  leaveProjectRulesEditor() {
    return this.#requireProjectRulesWorkflow().leaveEditor();
  }

  restoreProjectRules() {
    return this.#requireProjectRulesWorkflow().restore();
  }

  saveProjectRules() {
    return this.#requireProjectRulesWorkflow().save();
  }

  closeProjectRules() {
    return this.#requireProjectRulesWorkflow().close();
  }

  renameProjectSource(input) {
    return this.#requireProjectWorkflow().renameSource(input);
  }

  observeExternalSourceChange(input) {
    return this.#requireProjectWorkflow().reconcileExternalSourceLocator(input);
  }

  submitRequest(input) {
    return this.#requireRunWorkflow().submit(input);
  }

  planRunSubmission() {
    return this.#requireRunWorkflow().planSubmission();
  }

  selectAgent(selection) {
    return this.#requireRunWorkflow().selectAgent(selection);
  }

  queuePendingDefaultAgent(selection) {
    return this.#requireRunWorkflow().queuePendingDefaultAgent(selection);
  }

  pendingDefaultAgent() {
    return this.#requireRunWorkflow().pendingDefaultAgent();
  }

  readyPendingDefaultAgent() {
    return this.#requireRunWorkflow().readyPendingDefaultAgent();
  }

  clearPendingDefaultAgent(expectedIntentId) {
    return this.#requireRunWorkflow().clearPendingDefaultAgent(expectedIntentId);
  }

  commitPendingDefaultAgent(selection, options) {
    return this.#requireRunWorkflow().commitPendingDefaultAgent(selection, options);
  }

  beginAccessRepair(run, field) {
    return this.#requireRunWorkflow().beginAccessRepair(run, field);
  }

  clearAccessRepair() {
    return this.#requireRunWorkflow().clearAccessRepair();
  }

  resendAfterAccessRepair() {
    return this.#requireRunWorkflow().resendAfterAccessRepair();
  }

  selectAgentModel(modelId, expectedSelection) {
    return this.#requireRunWorkflow().selectAgentModel(modelId, expectedSelection);
  }

  selectAgentReasoning(reasoning, expectedSelection) {
    return this.#requireRunWorkflow().selectAgentReasoning(reasoning, expectedSelection);
  }

  applyDisabledAgentProviders(ids) {
    return this.#requireRunWorkflow().applyDisabledAgentProviders(ids);
  }

  connectAgentApiKey(selection, apiKey, extras) {
    return this.#requireRunWorkflow().connectAgentApiKey(selection, apiKey, extras);
  }

  disconnectAgentApiKey(selection) {
    return this.#requireRunWorkflow().disconnectAgentApiKey(selection);
  }

  holdAgentCredential(selection, payload) {
    return this.#requireRunWorkflow().holdAgentCredential(selection, payload);
  }

  noteAgentCredentialPersist(selection, result) {
    return this.#requireRunWorkflow().noteAgentCredentialPersist(selection, result);
  }

  retryAgentCredentialPersist(selection, persist) {
    return this.#requireRunWorkflow().retryAgentCredentialPersist(selection, persist);
  }

  stopRunsForProvider(providerId) {
    return this.#requireRunWorkflow().stopRunsForProvider(providerId);
  }

  manageAgentAccess(kind, selection, options) {
    return this.#requireRunWorkflow().manageAgentAccess(kind, selection, options);
  }

  refreshQoderAvailability() {
    return this.#requireRunWorkflow().refreshQoderAvailability();
  }

  checkQoderUsability() {
    return this.#requireRunWorkflow().checkQoderUsability();
  }

  copyQoderGuidance(input) {
    return this.#requireRunWorkflow().copyQoderGuidance(input);
  }

  startAgentLogin(selection) {
    return this.#requireRunWorkflow().startAgentLogin(selection);
  }

  reopenAgentLogin(selection) {
    return this.#requireRunWorkflow().reopenAgentLogin(selection);
  }

  startAgentLogout(selection) {
    return this.#requireRunWorkflow().startAgentLogout(selection);
  }

  installQoder() {
    return this.#requireRunWorkflow().installQoder();
  }

  installAgent(selection) {
    return this.#requireRunWorkflow().installAgent(selection);
  }

  cancelAgentInstall(selection) {
    return this.#requireRunWorkflow().cancelAgentInstall(selection);
  }

  refreshAgentAvailability() {
    return this.#requireRunWorkflow().refreshAgentAvailability();
  }

  checkAgentUsability(selection) {
    return this.#requireRunWorkflow().checkAgentUsability(selection);
  }

  copyAgentGuidance(input) {
    return this.#requireRunWorkflow().copyAgentGuidance(input);
  }

  reconcileRunSubmission(input) {
    return this.#requireRunWorkflow().reconcileSubmission(input);
  }

  pollRuns(input) {
    return this.#requireRunWorkflow().pollNow(input);
  }

  copyRunHandoff(input) {
    return this.#requireRunWorkflow().copyHandoff(input);
  }

  startRunAgent(input) {
    return this.#requireRunWorkflow().startAgent(input);
  }

  cancelRun(input) {
    return this.#requireRunWorkflow().cancel(input);
  }

  resolveRunConflict(input) {
    return this.#requireRunWorkflow().resolveConflict(input);
  }

  prepareReviewCandidate(input) {
    return this.#requireVersionWorkflow().prepareReviewCandidate(input);
  }

  activateReadyVersion(input) {
    return this.#requireVersionWorkflow().activateReadyVersion(input);
  }

  openCommittedVersion(input) {
    return this.#requireVersionWorkflow().openCommittedVersion(input);
  }

  viewHistory(input) {
    return this.#requireVersionWorkflow().viewHistory(input);
  }

  returnToCurrent(input) {
    return this.#requireVersionWorkflow().returnToCurrent(input);
  }

  createVersionFromHistory(input) {
    return this.#requireVersionWorkflow().createVersionFromHistory(input);
  }

  openCreatedHistoryVersion(input) {
    return this.#requireVersionWorkflow().openCreatedHistoryVersion(input);
  }

  queryHistoryCreation(input) {
    return this.#requireVersionWorkflow().queryHistoryCreation(input);
  }

  continueEditingHistoryVersion(input) {
    return this.#requireVersionWorkflow().continueEditingHistoryVersion(input);
  }

  enqueueDocumentEdit(input) {
    return this.#requireDocumentWorkflow().enqueueEdit(input);
  }

  flushDocument(input) {
    return this.#requireDocumentWorkflow().flush(input);
  }

  performDocumentHistoryAction(input) {
    return this.#requireDocumentWorkflow().performHistoryAction(input);
  }

  reloadDocumentAuthority(input) {
    return this.#requireDocumentWorkflow().reloadAuthority(input);
  }

  previewExternalDocumentSource(input) {
    return this.#requireDocumentWorkflow().previewExternalSource(input);
  }

  forceUnlockDocumentConflict(input) {
    return this.#requireDocumentWorkflow().forceUnlockConflict(input);
  }

  ensureDocumentCanvas(input) {
    return this.#requireDocumentWorkflow().ensureCurrentCanvas(input);
  }

  reconcileDocumentBoundary(input) {
    return this.#requireDocumentWorkflow().reconcileBoundary(input);
  }

  recoverDocumentAutosave(input) {
    return this.#requireDocumentWorkflow().recoverAutosave(input);
  }

  recordDocumentExportEvidence(input) {
    return this.#requireDocumentWorkflow().recordVerifiedExport(input);
  }

  adoptDocumentConflictCandidate(input) {
    return this.#requireDocumentWorkflow().adoptConflictCandidate(input);
  }

  resetDocumentWorkflow(input) {
    return this.#requireDocumentWorkflow().resetForProjectTransition(input);
  }

  clearDocumentRecovery(context) {
    return this.#requireDocumentWorkflow().clearRecovery(context);
  }

  clearDocumentAutosaveTimer() {
    return this.#requireDocumentWorkflow().clearAutosaveTimer();
  }

  clearDocumentAudit() {
    return this.#requireDocumentWorkflow().clearAudit();
  }

  replaceDocumentRecoveryIdentity(identity) {
    return this.#requireDocumentWorkflow().replaceRecoveryIdentity(identity);
  }

  activateDocumentSourceHistory(input) {
    return this.#requireDocumentWorkflow().activateSourceHistory(input);
  }

  waitForDocumentHistoryAction() {
    return this.#requireDocumentWorkflow().waitForHistoryAction();
  }

  queueDraft() {
    return this.#requireCommentWorkflow().queueDraft();
  }

  beginCommentComposer(input) {
    return this.#requireCommentWorkflow().beginComposer(input);
  }

  updateCommentDraft(draft) {
    return this.#requireCommentWorkflow().updateDraft(draft);
  }

  rebindCommentComposer(target) {
    return this.#requireCommentWorkflow().rebindComposerTarget(target);
  }

  cancelCommentComposer() {
    return this.#requireCommentWorkflow().clearComposer();
  }

  beginCommentEdit(input) {
    return this.#requireCommentWorkflow().beginEdit(input);
  }

  updateCommentEditDraft(draftText) {
    return this.#requireCommentWorkflow().updateEditDraft(draftText);
  }

  clearCommentEdit() {
    return this.#requireCommentWorkflow().clearEditSession();
  }

  rebindCommentTarget(input) {
    return this.#requireCommentWorkflow().rebindCommentTarget(input);
  }

  applyCommentItems(comments) {
    return this.#requireCommentWorkflow().applyCommentItems(comments);
  }

  confirmCommentEdit(input) {
    return this.#requireCommentWorkflow().confirmEdit(input);
  }

  flushDraft(input) {
    return this.#requireCommentWorkflow().flushDraft(input);
  }

  commitComment(input) {
    return this.#requireCommentWorkflow().commitComment(input);
  }

  editComment(input) {
    return this.#requireCommentWorkflow().editComment(input);
  }

  deleteComment(input) {
    return this.#requireCommentWorkflow().deleteComment(input);
  }

  deleteCommentsForElementIds(input) {
    return this.#requireCommentWorkflow().deleteCommentsForElementIds(input);
  }

  discardCommentComposer() {
    return this.#requireCommentWorkflow().discardComposer();
  }

  cancelCommentEdit(input) {
    return this.#requireCommentWorkflow().cancelCommentEdit(input);
  }

  removeComposerAttachment(input) {
    return this.#requireCommentWorkflow().removeComposerAttachment(input);
  }

  removeCommentEditAttachment(input) {
    return this.#requireCommentWorkflow().removeEditAttachment(input);
  }

  uploadAttachments(input) {
    return this.#requireCommentWorkflow().uploadAttachments(input);
  }

  readAttachment(input) {
    return this.#requireCommentWorkflow().readAttachment(input);
  }

  deleteAttachment(input) {
    return this.#requireCommentWorkflow().deleteAttachment(input);
  }

  resetCommentWorkflow() {
    return this.#requireCommentWorkflow().resetForProjectTransition();
  }

  #requireDocumentWorkflow() {
    if (!this.#documentWorkflow) {
      throw new Error("文档持久化工作流尚未完成组合。");
    }
    return this.#documentWorkflow;
  }

  #requireProjectWorkflow() {
    if (!this.#projectWorkflow) {
      throw new Error("项目切换工作流尚未完成组合。");
    }
    return this.#projectWorkflow;
  }

  #requireWorkbenchNavigationWorkflow() {
    if (!this.#workbenchNavigationWorkflow) {
      throw new Error("导航工作流尚未完成组合。");
    }
    return this.#workbenchNavigationWorkflow;
  }

  #requireProjectRulesWorkflow() {
    if (!this.#projectRulesWorkflow) {
      throw new Error("项目规则工作流尚未完成组合。");
    }
    return this.#projectRulesWorkflow;
  }

  #requireCommentWorkflow() {
    if (!this.#commentWorkflow) {
      throw new Error("评论工作流尚未完成组合。");
    }
    return this.#commentWorkflow;
  }

  #requireRunWorkflow() {
    if (!this.#runWorkflow) {
      throw new Error("任务运行工作流尚未完成组合。");
    }
    return this.#runWorkflow;
  }

  #requireVersionWorkflow() {
    if (!this.#versionWorkflow) {
      throw new Error("版本工作流尚未完成组合。");
    }
    return this.#versionWorkflow;
  }

  ensureRegistered({
    sourcePath,
    expectedSourceSha256,
    adoptCanonicalSource = true,
  } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "WORKSPACE_CONTROLLER_DISPOSED",
        "项目资料初始化已停止。",
      ));
    }
    const activeSource = sourcePath || this.#projectSession.sourcePath;
    const expectedHash = expectedSourceSha256 || this.#documentSession.persistedSourceSha256;
    if (!activeSource || !expectedHash) {
      return Promise.resolve(blocked(
        "PROJECT_REGISTRATION_PRECONDITION",
        "当前页面缺少可验证的源文件身份。",
      ));
    }
    if (this.#registrationPromise) {
      const inFlight = this.#snapshot.registration.identity;
      if (
        inFlight
        && inFlight.epoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(inFlight.sourcePath, activeSource)
      ) {
        return this.#registrationPromise;
      }
      // A source switch retires the older operation. Do not force the new
      // project to await a result that can only become stale.
      this.#registrationPromise = null;
    }

    const existingContext = this.#projectSession.context;
    if (existingContext && this.#draftSession.isActive(existingContext)) {
      return Promise.resolve(succeeded(existingContext));
    }

    const previousRegistration = this.#snapshot.registration;
    const reusableRegistration = previousRegistration?.outcome?.status === "unknown"
      && previousRegistration.identity
      && previousRegistration.identity.epoch === (existingContext?.epoch ?? this.#projectSession.epoch)
      && this.#codecs.sameSourcePath(previousRegistration.identity.sourcePath, activeSource)
      && previousRegistration.identity.expectedSourceSha256 === expectedHash
      ? previousRegistration.identity.operationId
      : null;
    const operationId = reusableRegistration || this.#nextOperationId();
    const identity = copyLocator({
      operationId,
      epoch: existingContext?.epoch ?? this.#projectSession.epoch,
      sourcePath: activeSource,
      expectedSourceSha256: expectedHash,
    });
    this.#publishSnapshot({
      phase: "registering",
      operationId,
      identity,
    });
    const registration = existingContext
      ? this.#restoreDraftAuthority({ existingContext, activeSource, identity })
        : this.#createRegistration({
          activeSource,
          expectedHash,
          adoptCanonicalSource,
          identity,
        });
    this.#registrationPromise = registration;
    registration.then(
      (outcome) => this.#settleRegistration(registration, outcome),
      (cause) => this.#settleRegistration(
        registration,
        rejected(registrationErrorCode(cause), String(cause?.message || cause)),
      ),
    );
    return registration;
  }

  #nextOperationId() {
    this.#registrationSequence += 1;
    return [
      "registration",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#registrationSequence.toString(36),
    ].join("_");
  }

  #publishSnapshot({ phase, operationId = null, identity = null, outcome = null }) {
    this.#registration = registrationSnapshot({
      phase,
      operationId,
      identity,
      outcome,
    }).registration;
    this.#publishAggregateSnapshot();
  }

  #beginSessionPublicationBatch() {
    this.#sessionPublicationDepth += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#sessionPublicationDepth = Math.max(0, this.#sessionPublicationDepth - 1);
      if (this.#sessionPublicationDepth > 0) return;
      // Keep the flush itself inside the fence: EditRuntime and surface-cache
      // refreshes are Session observers too and must not publish an
      // intermediate tuple before the final aggregate snapshot.
      this.#sessionPublicationDepth = 1;
      try {
        this.#projectSessionSnapshot = this.#projectSession.snapshot;
        this.#documentSessionSnapshot = this.#documentSession.snapshot;
        this.#commentSessionSnapshot = this.#commentSession.snapshot;
        this.#runSessionSnapshot = this.#runSession?.snapshot || null;
        this.#versionSessionSnapshot = this.#versionSession.snapshot;
        this.#captureCurrentVersionSummary();
        this.#refreshEditAuthorRuntime();
        this.#refreshDocumentSurfaceCache();
      } finally {
        this.#sessionPublicationDepth = 0;
      }
      this.#publishAggregateSnapshot();
    };
  }

  #publishAggregateSnapshot() {
    if (this.#sessionPublicationDepth > 0) return;
    this.#publishCommentsCapabilitySnapshot();
    this.#publishRunsCapabilitySnapshot();
    this.#publishNavigationCapabilitySnapshot();
    this.#snapshot = Object.freeze({
      registration: this.#registration,
      projectSession: this.#projectSessionSnapshot,
      document: this.#documentSessionSnapshot,
      commentSession: this.#commentSessionSnapshot,
      runSession: this.#runSessionSnapshot,
      versionSession: this.#versionSessionSnapshot,
      editRuntime: this.#editRuntimeSnapshot,
      comment: this.#commentWorkflow?.getSnapshot() || null,
      projectRules: this.#projectRulesSnapshot,
      project: this.#projectSnapshot,
      run: this.#runSnapshot,
      version: this.#versionSnapshot,
      conversation: this.#conversationSnapshot,
      workbenchTabs: this.#workbenchTabsSnapshot,
      documentSurfaceCache: this.#documentSurfaceCacheSnapshot,
      workbenchTabsReady: this.#workbenchTabsReady,
      workbenchNavigation: this.#workbenchNavigationSnapshot,
      workbenchTabsPersistence: this.#workbenchTabsPersistenceSnapshot,
    });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation listeners cannot affect application authority.
      }
    }
  }

  #publishCommentsCapabilitySnapshot() {
    const workingCopy = this.#commentSessionSnapshot;
    const persistence = this.#commentWorkflow?.getSnapshot() || null;
    if (
      this.#commentsCapabilitySnapshot.workingCopy === workingCopy
      && this.#commentsCapabilitySnapshot.persistence === persistence
    ) return;
    this.#commentsCapabilitySnapshot = Object.freeze({
      workingCopy,
      persistence,
    });
    for (const listener of this.#commentsCapabilityListeners) {
      try {
        listener();
      } catch {
        // Capability presentation cannot affect application authority.
      }
    }
  }

  #publishRunsCapabilitySnapshot() {
    const next = {
      session: this.#runSessionSnapshot,
      workflow: this.#runSnapshot,
    };
    if (
      this.#runsCapabilitySnapshot.session === next.session
      && this.#runsCapabilitySnapshot.workflow === next.workflow
    ) return;
    this.#runsCapabilitySnapshot = Object.freeze(next);
    for (const listener of this.#runsCapabilityListeners) {
      try {
        listener();
      } catch {
        // Run presentation cannot affect workflow authority.
      }
    }
  }

  #publishNavigationCapabilitySnapshot() {
    const next = {
      tabs: this.#workbenchTabsSnapshot,
      ready: this.#workbenchTabsReady,
      workflow: this.#workbenchNavigationSnapshot,
      persistence: this.#workbenchTabsPersistenceSnapshot,
    };
    if (
      this.#navigationCapabilitySnapshot.tabs === next.tabs
      && this.#navigationCapabilitySnapshot.ready === next.ready
      && this.#navigationCapabilitySnapshot.workflow === next.workflow
      && this.#navigationCapabilitySnapshot.persistence === next.persistence
    ) return;
    this.#navigationCapabilitySnapshot = Object.freeze(next);
    for (const listener of this.#navigationCapabilityListeners) {
      try {
        listener();
      } catch {
        // Navigation presentation cannot affect workflow authority.
      }
    }
  }

  #updateProjectCatalogFromEvent(event) {
    if (!event || typeof event !== "object") return;
    const current = this.#projectCatalogSnapshot;
    if (event.type === "project-hydrated" && event.historyCreation?.operationId) {
      void this.#versionWorkflow?.restoreHistoryCreation({ operationId: event.historyCreation.operationId, context: event.context });
    }
    if (["project-hydrated", "project-source-renamed", "project-source-relocated"].includes(event.type)) this.#captureCurrentVersionSummary();
    if (event.type === "project-recents-loaded") {
      this.#projectCatalogSnapshot = projectCatalogSnapshot({
        versionSummaries: current.versionSummaries,
        recent: event.projects,
        registered: current.registered,
      });
    } else if (event.type === "project-recents-failed") {
      this.#projectCatalogSnapshot = projectCatalogSnapshot({
        versionSummaries: current.versionSummaries,
        recent: current.recent,
        registered: current.registered,
        error: event.reason || "最近打开记录暂时无法读取。",
      });
    } else if (event.type === "project-catalog-loaded") {
      const versionSummaries = { ...current.versionSummaries };
      for (const [id, entry] of Object.entries(versionSummaries)) {
        const row = event.projects.find((row) => row.projectId === id);
        if (!row || (row.documentId && row.documentId !== entry.documentId)) {
          delete versionSummaries[id];
          this.#summaryGenerations.set(id, (this.#summaryGenerations.get(id) || 0) + 1);
        }
      }
      this.#projectCatalogSnapshot = projectCatalogSnapshot({
        versionSummaries,
        recent: current.recent,
        registered: event.projects,
        error: current.error,
      });
    } else if (event.type === "project-catalog-failed") {
      this.#projectCatalogSnapshot = projectCatalogSnapshot({
        versionSummaries: current.versionSummaries,
        recent: current.recent,
        registered: current.registered,
        error: event.reason || "项目目录暂时无法读取。",
      });
    } else {
      return;
    }
    for (const listener of this.#projectCatalogListeners) {
      try {
        listener();
      } catch {
        // Catalog presentation cannot affect project authority.
      }
    }
  }

  #emitEvent(event) {
    if (this.#disposed) return;
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation listeners cannot affect application authority.
      }
    }
  }

  #observeSessionSnapshots() {
    this.#projectSession.setObserver((snapshot) => {
      if (this.#disposed) return;
      this.#projectSessionSnapshot = snapshot;
      if (this.#sessionPublicationDepth > 0) return;
      this.#refreshEditAuthorRuntime();
      this.#refreshDocumentSurfaceCache();
      this.#publishAggregateSnapshot();
    });
    this.#documentSession.setObserver((snapshot) => {
      if (this.#disposed) return;
      this.#documentSessionSnapshot = snapshot;
      if (this.#sessionPublicationDepth > 0) return;
      this.#refreshEditAuthorRuntime();
      this.#refreshDocumentSurfaceCache();
      this.#publishAggregateSnapshot();
    });
    this.#commentSession.setObserver((snapshot) => {
      if (this.#disposed) return;
      this.#commentSessionSnapshot = snapshot;
      if (this.#sessionPublicationDepth > 0) return;
      this.#publishAggregateSnapshot();
    });
    this.#runSession?.setObserver((snapshot) => {
      if (this.#disposed) return;
      this.#runSessionSnapshot = snapshot;
      if (this.#sessionPublicationDepth > 0) return;
      this.#publishAggregateSnapshot();
    });
    this.#versionSession.setObserver((snapshot) => {
      if (this.#disposed) return;
      this.#versionSessionSnapshot = snapshot;
      if (this.#sessionPublicationDepth > 0) return;
      this.#captureCurrentVersionSummary();
      this.#publishAggregateSnapshot();
    });
  }

  #currentEditAuthorRuntimeInput() {
    const document = this.#documentSession.snapshot;
    const sourcePath = this.#projectSession.sourcePath;
    return {
      html: document.html,
      sourceSha256: document.persistedSourceSha256,
      canvasGeneration: document.canvasGeneration,
      sourcePath,
      sourceIsAuthoritative: Boolean(
        sourcePath
        // Hydration publishes a provisional Canvas before its final authority.
        // Preparing either one early can execute the same author program twice.
        && !this.projectHydrating
        && document.editRevision === document.lastPersistedRevision
        && document.persistState === "idle"
      ),
    };
  }

  #refreshEditAuthorRuntime() {
    if (!this.#editRuntimeSession) return;
    this.#editRuntimeSession.refresh(this.#currentEditAuthorRuntimeInput());
  }

  #refreshDocumentSurfaceCache() {
    const activeTab = this.#workbenchTabsSnapshot?.tabs.find((tab) => (
      tab.kind === "document"
      && tab.tabId === this.#workbenchTabsSnapshot.activeTabId
    ));
    if (!activeTab) return null;
    return this.#documentSurfaceCacheSession?.capture({
      tab: activeTab,
      project: {
        ...this.#projectSessionSnapshot,
        projectId: this.#projectSessionSnapshot?.projectId || activeTab.projectId,
        documentId: this.#projectSessionSnapshot?.documentId || activeTab.documentId,
      },
      document: this.#documentSessionSnapshot,
    }) || null;
  }

  #isCurrentLocator(identity) {
    return Boolean(
      !this.#disposed
      && this.#projectSession.epoch === identity.epoch
      && this.#codecs.sameSourcePath(
        this.#projectSession.sourcePath,
        identity.sourcePath,
      )
      && this.#documentSession.persistedSourceSha256 === identity.expectedSourceSha256,
    );
  }

  #outcomeFromCause(identity, cause) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(identity.operationId, String(cause.message || "项目资料初始化结果未知。"));
    }
    return rejected(
      registrationErrorCode(cause),
      String(cause?.message || "项目资料暂时无法建立。"),
    );
  }

  async #restoreDraftAuthority({ existingContext, activeSource, identity }) {
    try {
      const payload = await this.#bridgeClient.workspace(activeSource);
      if (
        !this.#isCurrentLocator(identity)
        || !this.#projectSession.matches(existingContext)
      ) return stale(identity);
      if (
        String(payload.projectId || "") !== existingContext.projectId
        || String(payload.documentId || "") !== existingContext.documentId
        || !this.#codecs.sameSourcePath(
          String(payload.sourcePath || activeSource),
          activeSource,
        )
      ) {
        return rejected(
          "PROJECT_REGISTRATION_IDENTITY_MISMATCH",
          "项目记录的身份与当前页面不一致，已停止恢复评论会话。",
        );
      }
      const authoritativeDraft = decodeWorkspaceResponse(payload, this.#codecs).draft;
      this.#draftSession.replaceAuthority(
        existingContext,
        this.#codecs.authoritativeDraftRevision(authoritativeDraft),
        authoritativeDraft,
      );
      this.#commentWorkflow?.reconcileAuthority();
      this.#emitEvent({
        type: "draft-authority-rebound",
        context: existingContext,
      });
      return succeeded(existingContext);
    } catch (cause) {
      return this.#outcomeFromCause(identity, cause);
    }
  }

  async #createRegistration({
    activeSource,
    expectedHash,
    adoptCanonicalSource,
    identity,
  }) {
    let managedHostCommitted = false;
    try {
      const payload = await this.#bridgeClient.ensureProject({
        sourcePath: activeSource,
        expectedSourceSha256: expectedHash,
        projectStorageVersion: "4.0.0",
      });
      if (payload.ok === false) {
        return rejected(
          "PROJECT_REGISTRATION_REJECTED",
          "无法建立项目记录。",
        );
      }
      if (!this.#isCurrentLocator(identity)) return stale(identity);
      let decodedWorkspace;
      try {
        decodedWorkspace = decodeWorkspaceResponse(payload, this.#codecs);
      } catch (cause) {
        return unknown(identity.operationId, cause.message || "项目操作结果待确认。");
      }

      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const nextSourceSha256 = String(
        payload.currentHtmlSha256 || payload.sourceSha256 || "",
      );
      const canonicalSource =
        typeof payload.content === "string" ? payload.content : "";
      const hasCanonicalSource = typeof payload.content === "string";
      if (
        !nextProjectId
        || !nextDocumentId
        || !/^sha256:[a-f0-9]{64}$/u.test(nextSourceSha256)
        || (
          hasCanonicalSource
          && await this.#hashPort.sha256(canonicalSource) !== nextSourceSha256
        )
      ) {
        return rejected(
          "PROJECT_REGISTRATION_PAYLOAD_INVALID",
          "项目记录已建立，但返回的身份或源文件校验不完整。",
        );
      }

      const currentDocument = this.#documentSession.snapshot;
      const currentHtmlSha256 = await this.#hashPort.sha256(currentDocument.html);
      if (!this.#isCurrentLocator(identity)) return stale(identity);
      const currentDocumentClean = Boolean(
        currentDocument.editRevision === currentDocument.lastPersistedRevision
        && !this.#documentSession.pendingWrite
        && !this.#documentSession.flushPromise,
      );
      const mustRepairCleanProjection = Boolean(
        currentDocumentClean && currentHtmlSha256 !== nextSourceSha256,
      );
      if (mustRepairCleanProjection && !hasCanonicalSource) {
        return rejected(
          "PROJECT_REGISTRATION_CANONICAL_SOURCE_MISSING",
          "项目记录与当前画布不一致，且缺少可自动恢复的完整源 HTML。",
        );
      }
      const shouldAdoptCanonicalSource = Boolean(
        hasCanonicalSource
        && currentDocumentClean
        && (adoptCanonicalSource || mustRepairCleanProjection),
      );
      const nextDocumentHtml = shouldAdoptCanonicalSource
        ? canonicalSource
        : currentDocument.html;
      const projectRecord = this.#codecs.isRecord(payload.project)
        ? payload.project
        : {};
      const rawOpenTarget = this.#codecs.isRecord(payload.openTarget)
        ? payload.openTarget
        : null;
      const rawTargetPath = String(rawOpenTarget?.exactSourcePath || "");
      const openTarget = rawOpenTarget
        ? verifyOpenTarget(rawOpenTarget, {
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: payload.sourcePath || activeSource,
          sourceSha256: nextSourceSha256,
          sameSourcePath: this.#codecs.sameSourcePath,
          targetKind: "working-copy",
        })
        : null;
      const openTargetInvalid = Boolean(
        (!openTarget && (
          rawOpenTarget
          || (
            payload.sourcePath
            && !this.#codecs.sameSourcePath(String(payload.sourcePath), activeSource)
          )
        ))
        || (
          rawOpenTarget
          && payload.sourcePath
          && !this.#codecs.sameSourcePath(String(payload.sourcePath), rawTargetPath)
        ),
      );
      if (openTargetInvalid) {
        return rejected(
          "PROJECT_REGISTRATION_OPEN_TARGET_INVALID",
          "新项目缺少与已核对源文件一致的完整工作文件身份，未保存修改仍保留在当前页面。",
        );
      }
      const registeredSourcePath = String(
        openTarget?.exactSourcePath || payload.sourcePath || activeSource,
      );
      const requiresManagedWorkingCopyActivation = Boolean(
        openTarget
        && !this.#codecs.sameSourcePath(registeredSourcePath, activeSource),
      );
      if (this.#projectSession.context) return stale(identity);
      let managedRunReservation = null;
      let managedProjectReservation = null;
      const runCoordination = this.#runSession?.[RUN_SESSION_COORDINATION] || null;
      const projectCoordination = this.#projectSession[PROJECT_SESSION_COORDINATION] || null;
      if (requiresManagedWorkingCopyActivation) {
        if (
          openTarget.targetKind !== "working-copy"
          || String(openTarget.projectId || "") !== nextProjectId
          || String(openTarget.documentId || "") !== nextDocumentId
          || !String(openTarget.workingCopyId || "")
          || !String(openTarget.versionId || "")
          || !String(openTarget.projectRootPath || "")
        ) {
          return rejected(
            "PROJECT_REGISTRATION_OPEN_TARGET_INVALID",
            "新项目缺少可验证的工作文件身份，未保存修改仍保留在当前页面。",
          );
        }
        if (!this.#projectSourcePort) {
          return rejected(
            "PROJECT_WORKING_COPY_ACTIVATION_UNAVAILABLE",
            "当前运行环境不能切换到新建立的工作文件；未保存修改仍保留在当前页面。",
          );
        }
        managedRunReservation = runCoordination?.prepareRebaseSource?.({
          previousSourcePath: activeSource,
          sourcePath: registeredSourcePath,
          projectId: nextProjectId,
          documentId: nextDocumentId,
        }) || null;
        managedProjectReservation = projectCoordination?.prepareTransitionSource?.({
          previousSourcePath: activeSource,
          sourcePath: registeredSourcePath,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          openTarget,
        });
        if (!managedProjectReservation || (this.#runSession && !managedRunReservation)) {
          return rejected(
            "PROJECT_RUN_LOCATOR_REBASE_REJECTED",
            "新项目的工作文件路径与现有 Request 状态无法形成一致身份，未发布项目会话。",
          );
        }
        managedHostCommitted = true;
        const activated = await this.#projectSourcePort.activateManagedWorkingCopy({
          operationId: identity.operationId,
          previousSourcePath: activeSource,
          nextSourcePath: registeredSourcePath,
          expectedSha256: nextSourceSha256,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          workingCopyId: String(openTarget.workingCopyId),
          versionId: String(openTarget.versionId),
          projectRootPath: String(openTarget.projectRootPath),
        });
        if (!this.#isCurrentLocator(identity)) {
          return unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但当前项目身份已经变化，请重新核对。",
          );
        }
        if (
          (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(managedRunReservation))
          || !projectCoordination?.transitionReservationCurrent?.(managedProjectReservation)
        ) {
          return unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但本地 reservation 已变化，请按同一操作核对结果。",
          );
        }
        const activatedHash = this.#codecs.isRecord(activated)
          && typeof activated.html === "string"
          ? await this.#hashPort.sha256(activated.html)
          : null;
        if (
          !this.#codecs.isRecord(activated)
          || String(activated.operationId || "") !== identity.operationId
          || !this.#codecs.sameSourcePath(
            String(activated.sourcePath || ""),
            registeredSourcePath,
          )
          || String(activated.sha256 || "") !== nextSourceSha256
          || typeof activated.html !== "string"
          || activatedHash !== nextSourceSha256
        ) {
          return unknown(
            identity.operationId,
            "托管工作文件已返回，但桌面结果的路径、身份或 Hash 无法核对，请重新打开。",
          );
        }
        if (!this.#isCurrentLocator(identity)) {
          return unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但当前源 Hash 已经变化，请重新核对。",
          );
        }
        if (
          (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(managedRunReservation))
          || !projectCoordination?.transitionReservationCurrent?.(managedProjectReservation)
        ) {
          return unknown(
            identity.operationId,
            "托管工作文件 Hash 返回时本地 reservation 已变化，请按同一操作核对结果。",
          );
        }
      }
      if (this.#projectSession.context) {
        return requiresManagedWorkingCopyActivation
          ? unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但本地项目身份已经变化，请重新核对。",
          )
          : stale(identity);
      }
      const endPublication = this.#beginSessionPublicationBatch();
      try {
        let registeredContext = null;
        let managedTransitionCommitted = false;
      if (requiresManagedWorkingCopyActivation) {
        if (
          !managedProjectReservation
          || (this.#runSession && (
            !managedRunReservation
            || !runCoordination?.commitRebaseSource?.(
              managedRunReservation,
              { publish: false },
            )
          ))
        ) {
          return unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但本地 Request Locator CAS 失败，请重新核对。",
          );
        }
        let committedContext = null;
        try {
          committedContext = projectCoordination?.commitTransitionSource?.(
            managedProjectReservation,
            { publish: false },
          );
        } catch {
          committedContext = null;
        }
        if (!committedContext) {
          const rolledBack = runCoordination
            ? runCoordination.rollbackRebaseSource?.(
              managedRunReservation,
              { publish: false },
            )
            : true;
          return unknown(
            identity.operationId,
            rolledBack
              ? "托管工作文件已完成桌面激活，但本地项目会话未能提交，请重新核对。"
              : "托管工作文件已完成桌面激活，但本地 Locator 状态未知，请重新核对。",
          );
        }
        projectCoordination?.publish?.();
        runCoordination?.publish?.();
        managedTransitionCommitted = true;
        registeredContext = committedContext;
      }
      if (requiresManagedWorkingCopyActivation && !managedTransitionCommitted) {
        return unknown(
          identity.operationId,
          "托管工作文件已完成桌面激活，但本地项目会话未提交，请重新核对。",
        );
      }
      if (!requiresManagedWorkingCopyActivation) {
        registeredContext = this.#projectSession.register({
          epoch: identity.epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: registeredSourcePath,
          ...(openTarget ? { openTarget } : {}),
        });
      }
      if (!registeredContext) {
        return requiresManagedWorkingCopyActivation
          ? unknown(
            identity.operationId,
            "托管工作文件已完成桌面激活，但本地项目身份未形成，请重新核对。",
          )
          : stale(identity);
      }
      const recoveryIdentity = this.#codecs.recoveryIdentityFromRecord(
        payload.recoveryIdentity,
      );
      this.#recoveryPort.replace(recoveryIdentity);
      this.#documentWorkflow?.replaceRecoveryIdentity(recoveryIdentity);
      const documentAlreadyMatchesCanonical = Boolean(
        currentDocument.html === nextDocumentHtml
        && currentDocument.persistedSourceSha256 === nextSourceSha256,
      );
      if (shouldAdoptCanonicalSource && !documentAlreadyMatchesCanonical) {
        if (currentDocument.html !== nextDocumentHtml) {
          this.#documentSession.publishAuthority({
            html: nextDocumentHtml,
            persistedSourceSha256: nextSourceSha256,
          });
          this.#canvasPort.invalidateRenderAcks();
        } else {
          // The renderer already holds the exact canonical bytes. Repair only
          // its source identity; recreating the disposable canvas would abort
          // an otherwise valid author-runtime page for no source-level reason.
          this.#documentSession.update({ persistedSourceSha256: nextSourceSha256 });
        }
      } else if (!documentAlreadyMatchesCanonical) {
        this.#documentSession.update({
          html: nextDocumentHtml,
          persistedSourceSha256: nextSourceSha256,
        });
      }
      this.#versionSession.hydrate({
        versions: decodedWorkspace.versions,
        latestVersionId: payload.latestVersionId,
        currentBasedOnVersionId: payload.currentBasedOnVersionId,
        currentExactVersionId: payload.currentExactVersionId,
      });
      if (shouldAdoptCanonicalSource) {
        const reboundTargets = this.#codecs.rebindTargetsPreservingGlobal(
          canonicalSource,
          [
            ...this.#commentSession.comments.map(commentSourceTarget),
            ...(
              this.#commentSession.composerTarget
                ? [this.#commentSession.composerTarget.commentAnchor
                  || this.#commentSession.composerTarget]
                : []
            ),
          ],
        );
        const reboundById = new Map(
          reboundTargets.map((target) => [target.id, target]),
        );
        this.#commentSession.setComments(
          this.#commentSession.comments.map((comment) => ({
            ...comment,
            target: commentTargetForDisplay(
              reboundById.get(commentSourceTarget(comment)?.id)
                || commentSourceTarget(comment),
              comment,
            ),
            sourceAnchor: reboundById.get(commentSourceTarget(comment)?.id)
              || commentSourceTarget(comment),
          })),
        );
        if (this.#commentSession.composerTarget) {
          const composerTarget = this.#commentSession.composerTarget;
          const sourceTarget = composerTarget.commentAnchor || composerTarget;
          this.#commentSession.setComposerTarget(
            commentTargetForDisplay(
              reboundById.get(sourceTarget.id) || sourceTarget,
              composerTarget,
            ),
          );
        }
      }
      const authoritativeDraft = decodedWorkspace.draft;
      this.#draftSession.replaceAuthority(
        registeredContext,
        this.#codecs.authoritativeDraftRevision(authoritativeDraft),
        authoritativeDraft,
      );
      this.#commentWorkflow?.reconcileAuthority();
      this.#sourceHistorySession.activate(
        registeredContext,
        nextSourceSha256,
        null,
        { preservePending: true },
      );
      this.#emitEvent({
        type: "registration-published",
        context: registeredContext,
        projectName: projectRecord.displayName
          ? String(projectRecord.displayName)
          : null,
        ...(payload.imported === true ? { imported: true } : {}),
        ...(payload.workingCopyRecovered === true ? { workingCopyRecovered: true } : {}),
        canonicalSourceAdopted: shouldAdoptCanonicalSource,
      });
      return succeeded(registeredContext);
      } finally {
        endPublication?.();
      }
    } catch (cause) {
      if (managedHostCommitted) {
        return unknown(
          identity.operationId,
          String(cause?.message || "托管工作文件已完成桌面激活，但本地状态待同一操作核对。"),
        );
      }
      return this.#outcomeFromCause(identity, cause);
    }
  }

  #settleRegistration(registration, outcome) {
    if (this.#registrationPromise !== registration) return;
    this.#registrationPromise = null;
    this.#publishSnapshot({
      phase: "idle",
      outcome,
      identity: outcome.status === "stale"
        ? outcome.identity
        : this.#snapshot.registration.identity,
    });
  }
}
