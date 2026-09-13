import { isBridgeRequestError } from "./bridge-client.js";
import { RUN_SESSION_COORDINATION } from "./run-session.js";
import { planRunSubmit, planRunSubmitEntry } from "./run/submit-plan.js";
import { revalidateCommentTextLocators } from "./run/text-locator-validation.js";
import { createRunWorkflowCodecs } from "./run-workflow-codecs.js";
import { verifyOpenTarget, verifyProjectContext } from "./verified-project-context.js";
import { AgentCatalogState } from "./agent-provider-catalog.js";
import { credentialErrorField } from "../../shared/agent-access-operation.mjs";
import {
  decodeHttpAgentText,
  httpAgentSupportsTextAttachment,
  httpAgentInputBudget,
  HTTP_AGENT_PREFLIGHT_RESERVE_BYTES,
} from "../../shared/agent-input-policy.mjs";
import {
  agentRecoveryKindForError,
  CLIPBOARD_DELIVERY_MODE,
  MANAGED_AGENT_MODE,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  normalizeAgentDelivery,
} from "../../shared/agent-delivery.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const POLL_DELAYS_MS = Object.freeze({
  reconcile: 500,
  starting: 500,
  active: 350,
  streaming: 250,
  cancelling: 500,
  hidden: 1_400,
});
const NON_RETRYABLE_AGENT_ERRORS = new Set([
  "ACP_PROCESS_CLEANUP_UNCONFIRMED",
  "AGENT_DELIVERY_NOT_AUTHORIZED",
  "AGENT_CONFIGURATION_CHANGED",
  "AGENT_RESTART_RECOVERY_REQUIRED",
  "AGENT_RETRY_BLOCKED",
  "AGENT_RETRY_OUTPUT_PRESENT",
  "AGENT_TASK_NOT_PROCESSING",
  "AGENT_TASK_POLICY_INVALID",
]);

function unsupportedSourceAgentAttachment(comments) {
  for (const comment of Array.isArray(comments) ? comments : []) {
    const unsupported = (comment?.attachments || []).find(
      (attachment) => !httpAgentSupportsTextAttachment(attachment),
    );
    if (unsupported) return unsupported;
  }
  return null;
}

async function verifiedSourceAgentAttachmentBytes(bridgeClient, sourcePath, comments) {
  let total = 0;
  for (const comment of Array.isArray(comments) ? comments : []) {
    for (const attachment of comment?.attachments || []) {
      if (!httpAgentSupportsTextAttachment(attachment) || !attachment?.relativePath) {
        throw responseError(
          "RUN_AGENT_ATTACHMENT_UNSUPPORTED",
          "源页 Agent 暂不支持此附件，可改用 Qoder、Codex 或复制给其他 AI。",
        );
      }
      if (typeof bridgeClient?.attachment !== "function") {
        throw responseError(
          "RUN_AGENT_ATTACHMENT_UNVERIFIED",
          "附件内容尚无法校验，本轮 Request 不会创建。",
        );
      }
      const blob = await bridgeClient.attachment(sourcePath, attachment.relativePath);
      if (!blob || typeof blob.arrayBuffer !== "function") {
        throw responseError(
          "RUN_AGENT_ATTACHMENT_UNVERIFIED",
          "附件内容尚无法校验，本轮 Request 不会创建。",
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (decodeHttpAgentText(bytes, { allowEmpty: false }) === null) {
        throw responseError(
          "RUN_AGENT_ATTACHMENT_UNSUPPORTED",
          "源页 Agent 只能发送可验证的 UTF-8 文本附件。",
        );
      }
      total += bytes.byteLength;
    }
  }
  return total;
}

function sourceAgentBudgetExceeded(delivery, preflight, html, comments, attachmentBytes = 0) {
  if (delivery?.selection?.providerId !== "pageroot") return false;
  const modelId = delivery.selection.resolvedModelId || delivery.selection.requestedModelId;
  const model = (preflight?.models || []).find((entry) => entry?.id === modelId);
  const htmlBytes = new TextEncoder().encode(String(html || "")).byteLength;
  let taskBytes = HTTP_AGENT_PREFLIGHT_RESERVE_BYTES + htmlBytes + attachmentBytes;
  for (const comment of Array.isArray(comments) ? comments : []) {
    taskBytes += new TextEncoder().encode(String(comment?.text || "")).byteLength;
  }
  return httpAgentInputBudget({ inputBytes: taskBytes, baseHtmlBytes: htmlBytes, model }).status === "exceeded";
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

function rejected(code, reason, extras = {}) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
    ...extras,
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function stale(identity) {
  return Object.freeze({ status: "stale", identity: Object.freeze({ ...identity }) });
}

function responseError(code, reason) {
  const error = new Error(reason);
  error.code = code;
  error.runWorkflowResponseError = true;
  return error;
}

function errorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return fallback;
}

function responseMayBeUnknown(cause) {
  return Boolean(
    cause?.runWorkflowResponseError
    || !isBridgeRequestError(cause)
    || cause.outcome === "unknown",
  );
}

function validDate(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

function frozenArray(values) {
  return Object.freeze([...values]);
}

function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || context.sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? context.epoch),
    }
    : {};
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
    ...target,
  });
}

function isPollable(run) {
  return Boolean(
    run?.requestId
    && run.requestId !== "pending"
    && !["cancelled", "complete", "no-change", "error"].includes(run.status),
  );
}

function hydrationAuthorityContext(payload, sourcePath, sameSourcePath) {
  if (!payload || typeof payload !== "object" || !sameSourcePath) return null;
  const projectId = String(payload.projectId || "");
  const documentId = String(payload.documentId || "");
  const workspaceSourcePath = String(payload.sourcePath || "");
  const target = verifyOpenTarget(payload.openTarget, {
    projectId,
    documentId,
    sourcePath,
    sourceSha256: payload.sourceSha256 || payload.currentHtmlSha256 || null,
    sameSourcePath,
  });
  if (
    !projectId
    || !documentId
    || !workspaceSourcePath
    || !sameSourcePath(workspaceSourcePath, sourcePath)
    || !target
  ) return null;
  return Object.freeze({
    projectId,
    documentId,
    sourcePath,
    openTarget: Object.freeze({ ...target }),
  });
}

function hydrationRecord(record, context, sourcePath, conflict = null) {
  if (!record || typeof record !== "object") return null;
  return {
    ...record,
    sourcePath: record.sourcePath || sourcePath,
    projectId: record.projectId || context.projectId,
    documentId: record.documentId || context.documentId,
    ...(conflict ? { conflict } : {}),
  };
}

function hydrationAttempt(value) {
  if (!value || typeof value !== "object") return null;
  return Object.freeze({
    requestId: String(value.requestId || ""),
    attemptId: String(value.attemptId || ""),
    projectId: String(value.projectId || ""),
    documentId: String(value.documentId || ""),
    sourceWorkingCopyId: String(value.sourceWorkingCopyId || value.workingCopyId || ""),
    submissionToken: Number.isSafeInteger(Number(value.submissionToken))
      ? Number(value.submissionToken)
      : null,
  });
}

function sameHydrationAttempt(left, right) {
  if (!left || !right) return left === right;
  return [
    "requestId",
    "attemptId",
    "projectId",
    "documentId",
    "sourceWorkingCopyId",
    "submissionToken",
  ].every((field) => {
    const leftValue = left[field];
    const rightValue = right[field];
    return (
      (leftValue === null || leftValue === "")
      && (rightValue === null || rightValue === "")
    ) || leftValue === rightValue;
  });
}

function hydrationContextMatches(value, context) {
  if (!value || !context || !context.projectId || !context.documentId) return false;
  return [
    ["projectId", context.projectId],
    ["documentId", context.documentId],
  ].every(([field, expected]) => String(value[field] || "") === expected);
}

function agentHandoffState(run, session) {
  const state = String(session?.state || "");
  if (![
    "starting",
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelling",
    "cancelled",
  ].includes(state)) return null;
  const selection = deliveryForRun(run)?.selection || null;
  const safeToRetry = typeof session.safeToRetry === "boolean"
    ? session.safeToRetry
    : session.retryable === true;
  const visibleTextUpdates = [];
  let visibleTextLength = 0;
  for (const update of Array.isArray(session?.visibleTextUpdates)
    ? session.visibleTextUpdates.slice(0, 80)
    : []) {
    if (!update || typeof update !== "object") continue;
    const id = String(update.id || "").trim().slice(0, 200);
    const text = String(update.text || "");
    const sequence = Number(update.sequence);
    if (!id || !text || !Number.isSafeInteger(sequence) || sequence < 0) continue;
    const remaining = (64 * 1024) - visibleTextLength;
    if (remaining <= 0) break;
    const boundedText = text.slice(0, remaining);
    visibleTextLength += boundedText.length;
    visibleTextUpdates.push(Object.freeze({ id, sequence, text: boundedText }));
  }
  return {
    sourcePath: run.sourcePath,
    requestId: run.requestId,
    attemptId: run.attemptId,
    mode: MANAGED_AGENT_MODE,
    status: state,
    phase: String(session.phase || state),
    providerId: typeof session.providerId === "string"
      ? session.providerId
      : selection?.providerId || null,
    runtimeId: typeof session.runtimeId === "string"
      ? session.runtimeId
      : selection?.runtimeId || null,
    agentName: session.agentName ? String(session.agentName) : null,
    agentVersion: session.agentVersion ? String(session.agentVersion) : null,
    // ADR 0037: narration only. It reaches the view so the user can see what the
    // Agent is doing, and it carries no authority over the Candidate.
    visibleText: typeof session.visibleText === "string" ? session.visibleText : "",
    visibleTextUpdates: Object.freeze(visibleTextUpdates),
    textTruncated: session.textTruncated === true,
    startedAt: typeof session.startedAt === "string" ? session.startedAt : null,
    lastActivityAt: typeof session.lastActivityAt === "string" ? session.lastActivityAt : null,
    receivedBytes: Number.isSafeInteger(session.receivedBytes) && session.receivedBytes >= 0
      ? session.receivedBytes
      : 0,
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : null,
    errorCode: session.errorCode ? String(session.errorCode) : null,
    errorMessage: session.errorMessage ? String(session.errorMessage) : null,
    retryable: session.retryable === true,
    safeToRetry,
    recoveryKind: session.recoveryKind || agentRecoveryKindForError(session.errorCode, {
      safeToRetry,
    }),
  };
}

function agentRecoveryRequired(run, handoff) {
  const delivery = deliveryForRun(run);
  return Boolean(
    delivery?.mode === MANAGED_AGENT_MODE
    && Boolean(handoff)
    && handoff.mode !== CLIPBOARD_DELIVERY_MODE
    && handoff.requestId === run.requestId
    && handoff.attemptId === run.attemptId
    && ["failed", "interrupted"].includes(handoff.status)
    && handoff.retryable === false,
  );
}

function frozenDeliveryForMode(deliveryMode, selection, provider) {
  if (deliveryMode === CLIPBOARD_DELIVERY_MODE) {
    return Object.freeze({ mode: CLIPBOARD_DELIVERY_MODE });
  }
  if (deliveryMode === MANAGED_AGENT_MODE) {
    if (!selection || !provider) {
      throw responseError("AGENT_SELECTION_UNAVAILABLE", "当前没有可用的 Agent 选择。");
    }
    return Object.freeze({
      mode: MANAGED_AGENT_MODE,
      selection,
      trustPolicyVersion: provider.trustPolicyVersion,
    });
  }
  return normalizeAgentDelivery({
    mode: deliveryMode,
    trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

function deliveryForRun(run) {
  try {
    return normalizeAgentDelivery(run?.agentDelivery);
  } catch {
    try {
      return normalizeAgentDelivery({
        ...run?.agentDelivery,
        trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      });
    } catch {
      return null;
    }
  }
}

// RunWorkflow is the PR-5 application boundary. It owns Request submission,
// authority reconciliation, polling, cancellation and conflict commands. It
// deliberately receives renderer conversion helpers and narrow Canvas/Handoff
// ports so that Workbench remains a presentation adapter.
export class RunWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #versionSession;
  #runSession;
  #documentWorkflow;
  #drain;
  #codecs;
  #canvasPort;
  #handoffPort;
  #hashPort;
  #scheduler;
  #clock;
  #agentCatalog;
  #ownsAgentCatalog = false;
  #unsubscribeAgentCatalog = null;
  #listeners = new Set();
  #eventListeners = new Set();
  #timer = null;
  #pollLoopActive = false;
  #pollPromise = null;
  #pollGeneration = 0;
  #hydrationSequence = 0;
  #hydrationQueries = new Map();
  #lastNarrationAt = 0;
  #visibility = null;
  #visibilityListener = null;
  #uncertainSubmissions = new Map();
  #agentStartsPending = new Set();
  #accessRepair = null;
  #repairIntentSeq = 0;
  #defaultCommitSeq = 0;
  #disposed = false;

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    runSession,
    documentWorkflow,
    drain,
    codecs,
    ports = {},
    scheduler = globalThis,
    visibility = typeof globalThis.document === "object" ? globalThis.document : null,
    clock,
    agentCatalog = null,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.createRequest !== "function"
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.status !== "function"
      || (
        typeof bridgeClient.agentAvailability !== "function"
        && typeof bridgeClient.qoderAvailability !== "function"
      )
      || typeof bridgeClient.preflightAgent !== "function"
      || typeof bridgeClient.startAgent !== "function"
      || typeof bridgeClient.cancelActiveRun !== "function"
      || typeof bridgeClient.resolveConflict !== "function"
    ) {
      throw new TypeError("RunWorkflow requires its run Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("RunWorkflow requires registration authority.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("RunWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.update !== "function") {
      throw new TypeError("RunWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.setComments !== "function") {
      throw new TypeError("RunWorkflow requires CommentSession injection.");
    }
    if (!versionSession || !versionSession.snapshot) {
      throw new TypeError("RunWorkflow requires VersionSession injection.");
    }
    if (
      !runSession
      || typeof runSession.trackRun !== "function"
      || typeof runSession.isOperationBusy !== "function"
    ) {
      throw new TypeError("RunWorkflow requires RunSession injection.");
    }
    if (!documentWorkflow || typeof documentWorkflow.enqueueEdit !== "function") {
      throw new TypeError("RunWorkflow requires DocumentWorkflow composition.");
    }
    if (typeof drain !== "function") {
      throw new TypeError("RunWorkflow requires Controller drain authority.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("RunWorkflow requires a Canvas freeze port.");
    }
    if (typeof ports.canvas.checkpointNativeTextIntent !== "function") {
      throw new TypeError("RunWorkflow CanvasPort must provide a soft checkpoint.");
    }
    if (typeof ports.canvas.unlock !== "function") {
      throw new TypeError("RunWorkflow CanvasPort must provide unlock.");
    }
    if (!ports.handoff || typeof ports.handoff.copy !== "function") {
      throw new TypeError("RunWorkflow requires a Handoff copy port.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("RunWorkflow requires a HashPort.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("RunWorkflow requires a timeout Scheduler.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("RunWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#documentWorkflow = documentWorkflow;
    this.#drain = drain;
    this.#codecs = createRunWorkflowCodecs(codecs);
    this.#canvasPort = {
      checkpointNativeTextIntent: ports.canvas.checkpointNativeTextIntent,
      freeze: ports.canvas.freeze,
      unlock: ports.canvas.unlock,
      normalizeComments: ports.canvas.normalizeComments || (() => (
        this.#commentSession.comments.filter(this.#codecs.commentHasContent)
      )),
    };
    this.#handoffPort = ports.handoff;
    this.#hashPort = ports.hash;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#visibility = visibility;
    if (typeof visibility?.addEventListener === "function") {
      this.#visibilityListener = () => this.#rescheduleForVisibility();
      visibility.addEventListener("visibilitychange", this.#visibilityListener);
    }
    this.#agentCatalog = agentCatalog || new AgentCatalogState({
      bridgeClient,
      handoffPort: this.#handoffPort,
      preferencesPort: ports.uiPreferences || null,
      credentialStatusPort: ports.agentCredentialStatus || null,
      clock,
    });
    this.#ownsAgentCatalog = !agentCatalog;
    this.#unsubscribeAgentCatalog = this.#agentCatalog.subscribe(() => {
      this.#publishSnapshot();
    });
  }

  getSnapshot() {
    return Object.freeze({
      polling: this.#pollLoopActive,
      pendingReconciliations: frozenArray(this.#uncertainSubmissions.keys()),
      agentCatalog: this.#agentCatalog.getSnapshot(),
      agentPresentation: this.#agentCatalog.presentation(),
      qoderAvailability: this.#agentCatalog.displayAvailability(),
      accessRepair: this.#accessRepair,
      providerAccessImpact: this.#providerAccessImpact(),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("RunWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("RunWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.stopPolling();
    if (this.#visibilityListener && typeof this.#visibility?.removeEventListener === "function") {
      this.#visibility.removeEventListener("visibilitychange", this.#visibilityListener);
    }
    this.#visibilityListener = null;
    this.#visibility = null;
    this.#uncertainSubmissions.clear();
    this.#agentStartsPending.clear();
    this.#unsubscribeAgentCatalog?.();
    this.#unsubscribeAgentCatalog = null;
    if (this.#ownsAgentCatalog) this.#agentCatalog.dispose();
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  syncPolling() {
    if (this.#disposed) return;
    if (this.#hasPollingWork()) this.startPolling();
    else this.stopPolling();
  }

  startPolling() {
    if (this.#disposed || this.#pollLoopActive || !this.#hasPollingWork()) return;
    this.#pollLoopActive = true;
    this.#scheduleNextPoll(this.#pollGeneration, 0);
    this.#publishSnapshot();
  }

  stopPolling() {
    const active = this.#pollLoopActive || this.#timer !== null || this.#pollPromise !== null;
    if (!active) return;
    this.#pollGeneration += 1;
    this.#pollLoopActive = false;
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#publishSnapshot();
  }

  pollNow({ generation = this.#pollGeneration } = {}) {
    if (!this.#isPollCurrent(generation)) return Promise.resolve(stale({ generation }));
    if (this.#pollPromise) return this.#pollPromise;
    const polling = this.#pollOnce({ generation });
    this.#pollPromise = polling;
    void polling.finally(() => {
      if (this.#pollPromise === polling) this.#pollPromise = null;
    }).catch(() => {});
    return polling;
  }

  async #pollOnce({ generation }) {
    const runs = this.#runSession.runs.filter((run) => (
      isPollable(run)
      && !this.#agentStartsPending.has(this.#codecs.operationKey(run))
    ));
    const polls = runs.map((run) => this.#pollRun(run, generation));
    const reconciliations = [...this.#uncertainSubmissions.keys()].map(
      (sourcePath) => this.reconcileSubmission({ sourcePath, generation }),
    );
    await Promise.allSettled([...polls, ...reconciliations]);
    if (!this.#isPollCurrent(generation)) return stale({ generation });
    this.syncPolling();
    return succeeded({ runs: runs.length, reconciliations: reconciliations.length });
  }

  async refreshAgentAvailability() {
    const displayName = this.#agentCatalog.presentation().displayName || "Agent";
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 状态检查已经停止。`);
    }
    try {
      const refreshed = await this.#agentCatalog.refreshAvailability();
      if (this.#disposed) return stale({ kind: "agent-availability" });
      if (String(refreshed?.result?.status || "") === "ready") {
        return succeeded({ availability: this.#agentCatalog.availability() });
      }
      return succeeded({ availability: this.#agentCatalog.availability() });
    } catch (cause) {
      if (this.#disposed) return stale({ kind: "agent-availability" });
      const code = errorCode(cause, "AGENT_AVAILABILITY_FAILED");
      return rejected(
        code,
        this.#codecs.errorMessage(cause, `暂时无法检查 ${displayName}。`),
      );
    }
  }

  async checkAgentUsability(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 状态检查已经停止。`);
    }
    try {
      const checked = await this.#agentCatalog.diagnose(frozen);
      if (this.#disposed || !checked) return stale({ kind: "agent-diagnosis" });
      if (checked.diagnostic?.readiness !== "ready") {
        const diagnostic = checked.diagnostic;
        const reason = diagnostic?.readiness === "auth-required"
          ? "刚刚检查：请先登录账号。"
          : diagnostic?.readiness === "not-installed"
            ? "刚刚检查：请先安装此服务。"
            : diagnostic?.facts?.authentication?.status === "ready"
              ? "刚刚检查：账号已登录，但仍无法建立连接。"
              : "刚刚检查：服务暂时无法使用，请重新检查或使用其他 AI。";
        return rejected(diagnostic?.cause || "AGENT_CONNECTION_FAILED", reason);
      }
      return succeeded({ availability: this.#agentCatalog.availability(frozen), diagnostic: checked.diagnostic });
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_PREFLIGHT_FAILED"),
        this.#codecs.errorMessage(cause, `暂时无法检查 ${displayName}。`),
      );
    }
  }

  async copyAgentGuidance({ kind, selection } = {}) {
    if (kind !== "install" && kind !== "login") {
      return rejected("AGENT_GUIDANCE_INVALID", "选择的 Agent 引导无效。");
    }
    try {
      const result = await this.#agentCatalog.copyGuidance(
        kind,
        selection || this.#agentCatalog.freezeSelected(),
      );
      return succeeded(result);
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_GUIDANCE_COPY_FAILED"),
        this.#codecs.errorMessage(cause, "引导指令暂时无法复制，请重试。"),
      );
    }
  }

  #qoderSelection() {
    return this.#agentCatalog.freezeProviderSelection("qoder");
  }

  refreshQoderAvailability() {
    const selection = this.#qoderSelection();
    if (!selection) {
      return Promise.resolve(rejected("AGENT_PROVIDER_UNSUPPORTED", "Qoder CLI 不可用。"));
    }
    if (this.#disposed) {
      return Promise.resolve(blocked("RUN_WORKFLOW_DISPOSED", "Qoder CLI 状态检查已经停止。"));
    }
    return this.#agentCatalog.refreshAvailability(selection)
      .then((refreshed) => {
        if (this.#disposed) return stale({ kind: "agent-availability" });
        if (String(refreshed?.result?.status || "") === "ready") {
          return succeeded({ availability: this.#agentCatalog.availability(selection) });
        }
        return succeeded({ availability: this.#agentCatalog.availability(selection) });
      })
      .catch((cause) => rejected(
        errorCode(cause, "AGENT_AVAILABILITY_FAILED"),
        this.#codecs.errorMessage(cause, "暂时无法检查 Qoder CLI。"),
      ));
  }

  async checkQoderUsability() {
    const selection = this.#qoderSelection();
    return this.checkAgentUsability(selection);
  }

  async copyQoderGuidance({ kind } = {}) {
    if (kind !== "install" && kind !== "login") {
      return rejected("AGENT_GUIDANCE_INVALID", "选择的 Qoder 引导无效。");
    }
    const selection = this.#qoderSelection();
    if (!selection) return rejected("AGENT_PROVIDER_UNSUPPORTED", "Qoder CLI 不可用。");
    try {
      const result = await this.#agentCatalog.copyGuidance(kind, selection);
      return succeeded(result);
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_GUIDANCE_COPY_FAILED"),
        this.#codecs.errorMessage(cause, "Qoder 引导指令暂时无法复制，请重试。"),
      );
    }
  }

  async startAgentLogin(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 登录已经停止。`);
    }
    try {
      await this.#agentCatalog.startLogin(frozen);
      if (this.#disposed) return stale({ kind: "agent-login" });
      return succeeded({ availability: this.#agentCatalog.availability(frozen) });
    } catch (cause) {
      const cancelled = cause?.code === "AGENT_LOGIN_CANCELLED";
      if (cancelled) {
        return succeeded({ cancelled: true, availability: this.#agentCatalog.availability(frozen) });
      }
      if (cause?.code === "AGENT_LOGIN_CANCEL_FAILED") {
        return rejected(
          "AGENT_LOGIN_CANCEL_FAILED",
          this.#codecs.errorMessage(cause, "无法确认登录进程已退出。"),
        );
      }
      return rejected(
        errorCode(cause, "AGENT_LOGIN_FAILED"),
        this.#codecs.errorMessage(cause, `暂时无法完成 ${displayName} 登录。`),
      );
    }
  }

  async reopenAgentLogin(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 登录已经停止。`);
    }
    try {
      const result = await this.#agentCatalog.reopenOfficialLogin(frozen);
      return succeeded(result);
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_LOGIN_URL_UNAVAILABLE"),
        this.#codecs.errorMessage(cause, "官方登录页暂时无法打开。"),
      );
    }
  }

  async startAgentLogout(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 退出已经停止。`);
    }
    try {
      await this.#agentCatalog.startLogout(frozen);
      if (this.#disposed) return stale({ kind: "agent-logout" });
      return succeeded({ availability: this.#agentCatalog.availability(frozen) });
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_LOGOUT_FAILED"),
        this.#codecs.errorMessage(cause, `暂时无法退出 ${displayName}。`),
      );
    }
  }

  async installAgent(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 安装已经停止。`);
    }
    try {
      await this.#agentCatalog.install(frozen);
      if (this.#disposed) return stale({ kind: "agent-install" });
      return succeeded({ availability: this.#agentCatalog.availability(frozen) });
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_INSTALL_FAILED"),
        this.#codecs.errorMessage(cause, `暂时无法安装 ${displayName}。`),
      );
    }
  }

  async installQoder() {
    const selection = this.#qoderSelection();
    if (!selection) return rejected("AGENT_PROVIDER_UNSUPPORTED", "Qoder CLI 不可用。");
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", "Qoder CLI 安装已经停止。");
    }
    try {
      await this.#agentCatalog.install(selection);
      if (this.#disposed) return stale({ kind: "agent-install" });
      return succeeded({ availability: this.#agentCatalog.availability(selection) });
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_INSTALL_FAILED"),
        this.#codecs.errorMessage(cause, "暂时无法安装 Qoder CLI。"),
      );
    }
  }

  async cancelAgentInstall(selection = this.#agentCatalog.freezeSelected()) {
    const frozen = selection || this.#agentCatalog.freezeSelected();
    const displayName = this.#agentCatalog.presentation(frozen).displayName || "Agent";
    if (!frozen) return rejected("AGENT_PROVIDER_UNSUPPORTED", `${displayName} 不可用。`);
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", `${displayName} 安装已经停止。`);
    }
    try {
      const result = await this.#agentCatalog.cancelAccessOperation(frozen);
      return succeeded({ result, availability: this.#agentCatalog.availability(frozen) });
    } catch (cause) {
      return rejected(
        errorCode(cause, "AGENT_INSTALL_CANCEL_FAILED"),
        this.#codecs.errorMessage(
          cause,
          cause?.code === "AGENT_LOGIN_CANCEL_FAILED"
            ? "无法确认操作已停止。"
            : `暂时无法取消 ${displayName} 安装。`,
        ),
      );
    }
  }

  planSubmission() {
    return this.#captureSubmissionPlan().plan;
  }

  async submit({
    projectName = "未命名页面",
    previousVersionId = this.#versionSession.snapshot.latestVersionId,
    basedOnVersionId = this.#versionSession.snapshot.currentBasedOnVersionId,
    deadlineAt = this.#clock.now() + 60_000,
    deliveryMode = "clipboard",
  } = {}) {
    const entryPlan = planRunSubmitEntry({ disposed: this.#disposed });
    if (entryPlan.kind === "reject") {
      return blocked(entryPlan.code, entryPlan.reason);
    }
    let frozenAgentDelivery;
    try {
      const selected = this.#agentCatalog.freezeSelected();
      frozenAgentDelivery = frozenDeliveryForMode(
        deliveryMode,
        selected,
        this.#agentCatalog.provider(selected),
      );
    } catch {
      return rejected("RUN_DELIVERY_MODE_INVALID", "选择的 Agent 交接方式无效。");
    }
    const { context: entryContext, plan: submitPlan } = this.#captureSubmissionPlan();
    let context = entryContext;
    if (submitPlan.kind === "reject") {
      return blocked(submitPlan.code, submitPlan.reason);
    }
    const sourcePath = context.sourcePath;
    const committed = this.#canvasPort.checkpointNativeTextIntent({
      trigger: "ai",
    });
    if (!committed?.ok) {
      return blocked(
        "RUN_SUBMISSION_NATIVE_EDIT",
        committed?.reason || "请先完成当前文字输入，再发送本轮要求。",
      );
    }

    let comments = this.#commentsForSubmission();
    const commentOutcome = this.#validateComments(comments);
    if (commentOutcome) return commentOutcome;
    if (
      frozenAgentDelivery.mode === MANAGED_AGENT_MODE
      && frozenAgentDelivery.selection?.providerId === "pageroot"
      && unsupportedSourceAgentAttachment(comments)
    ) {
      return blocked(
        "RUN_AGENT_ATTACHMENT_UNSUPPORTED",
        "源页 Agent 暂不支持此附件，可改用 Qoder、Codex 或复制给其他 AI。",
      );
    }

    const submission = this.#runSession.beginSubmission({ sourcePath });
    if (!submission) {
      return blocked("RUN_SUBMISSION_BUSY", "当前项目正在准备本轮要求。");
    }
    let pendingRun = null;
    let submissionUncertain = false;
    let durableRun = null;
    let agentPreflight = null;
    let reservedAgentStartKey = null;
    let submissionEndCode = "SUBMISSION_NOT_STARTED";
    let submissionRequest = null;
    try {
      const registered = await this.#ensureRegistered({
        sourcePath: context.sourcePath,
        expectedSourceSha256: this.#documentSession.persistedSourceSha256,
      });
      if (!this.#isCurrentContext(context)) return stale(context);
      if (registered?.status !== "succeeded") return registered || rejected(
        "RUN_SUBMISSION_REGISTRATION_INVALID",
        "项目资料初始化没有返回可验证结果。",
      );
      comments = this.#commentsForSubmission();
      const registeredCommentOutcome = this.#validateComments(comments);
      if (registeredCommentOutcome) return registeredCommentOutcome;
      const sourceAgentAttachmentBytes = frozenAgentDelivery.selection?.providerId === "pageroot"
        ? await verifiedSourceAgentAttachmentBytes(this.#bridgeClient, context.sourcePath, comments)
        : 0;
      if (!this.#isCurrentContext(context)) return stale(context);

      // No await precedes this source-authority fence. It captures the exact
      // HTML bytes and retires native editing before the Request is prepared.
      const frozen = this.#canvasPort.freeze(
        "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
      );
      const frozenWorkingSourceSha256 = String(
        frozen?.workingSourceSha256 || "",
      );
      if (!frozen?.ok || !SHA256.test(frozenWorkingSourceSha256)) {
        if (frozen?.ok) this.#canvasPort.unlock();
        return blocked(
          "RUN_SUBMISSION_FREEZE",
          frozen?.reason || "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
        );
      }
      if (!this.#runSession.freezeSubmission(submission)) {
        this.#canvasPort.unlock();
        return stale(context);
      }
      const frozenHash = await this.#hashPort.sha256(String(frozen.html || ""));
      const hashContextCurrent = this.#isCurrentContext(context);
      if (frozenHash !== frozenWorkingSourceSha256 || !hashContextCurrent) {
        this.#canvasPort.unlock();
        return rejected(
          "RUN_SUBMISSION_FREEZE_HASH_MISMATCH",
          "冻结 HTML 的内容或项目身份已经变化，本轮不会发送。",
        );
      }
      if (sourceAgentBudgetExceeded(
        frozenAgentDelivery,
        agentPreflight,
        frozen.html,
        comments,
        sourceAgentAttachmentBytes,
      )) {
        this.#canvasPort.unlock();
        return blocked(
          "RUN_AGENT_PROMPT_TOO_LARGE",
          "当前页面可能超过所选模型的完整输出能力，请更换模型或使用 Qoder/Codex。",
        );
      }
      if (frozen.html !== this.#documentSession.html) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: frozen.html,
          mutation: frozen.pendingMutation || undefined,
          context,
        });
        if (enqueued?.status !== "succeeded") {
          this.#canvasPort.unlock();
          return enqueued || rejected(
            "RUN_SUBMISSION_DOCUMENT_EDIT",
            "当前编辑没有进入可验证的源码历史。",
          );
        }
      }
      const freezeCutoffRevision = this.#documentSession.editRevision;
      const submissionContext = Object.freeze({
        ...context,
        projectName: String(projectName || "未命名页面"),
        comments: comments.map((comment) => ({ ...comment })),
        changeEvents: this.#commentSession.changeEvents.map((event) => ({ ...event })),
        frozenSourceSha256: frozenWorkingSourceSha256,
        freezeCutoffRevision,
      });
      pendingRun = this.#pendingRun({
        context: submissionContext,
        submission,
        previousVersionId,
        basedOnVersionId,
        agentDelivery: frozenAgentDelivery,
      });
      this.#runSession.forgetOutcome(submissionContext.sourcePath);
      this.#runSession.trackRun(pendingRun, { activate: "always" });
      this.#emitEvent({
        type: "run-submission-started",
        run: pendingRun,
        context: submissionContext,
        current: true,
      });

      const drained = await this.#drain({ boundary: "submit", deadlineAt });
      // The drain may acknowledge the very Working Copy bytes frozen above.
      // Revalidate every captured identity field, allowing only that proven
      // Hash transition; a new epoch, path, Version or Working Copy stays stale.
      if (
        !this.#isCurrentContext(context)
        && context.targetKind === "working-copy"
        && drained?.ok
        && this.#documentSession.lastPersistedRevision === freezeCutoffRevision
        && this.#documentSession.editRevision === freezeCutoffRevision
        && this.#documentSession.persistedSourceSha256 === frozenWorkingSourceSha256
      ) {
        const acknowledgedContext = Object.freeze({
          ...context,
          sourceSha256: frozenWorkingSourceSha256,
        });
        if (this.#isCurrentContext(acknowledgedContext)) context = acknowledgedContext;
      }
      if (!this.#isCurrentContext(context)) {
        throw responseError(
          "RUN_SUBMISSION_CONTEXT_STALE",
          "冻结边界内的项目身份已经变化，本轮不会发送。",
        );
      }
      if (
        !drained?.ok
        || this.#documentSession.lastPersistedRevision !== freezeCutoffRevision
        || this.#documentSession.editRevision !== freezeCutoffRevision
      ) {
        throw responseError(
          "RUN_SUBMISSION_DRAIN_FAILED",
          drained?.ok
            ? "冻结前的最后一次修改尚未安全写入源 HTML。"
            : String(drained?.reason || "冻结边界尚未完成。"),
        );
      }
      const persistedSourceSha256 = this.#documentSession.persistedSourceSha256;
      if (
        persistedSourceSha256 !== frozenWorkingSourceSha256
        || !this.#isCurrentContext(context)
      ) {
        throw responseError(
          "RUN_SUBMISSION_SOURCE_MISMATCH",
          "冻结 HTML 的 Hash 与已写回源文件不一致。",
        );
      }
      let persistedComments = this.#commentsForSubmission();
      const persistedCommentOutcome = this.#validateComments(
        persistedComments,
        persistedSourceSha256,
        submissionContext.comments.length,
      );
      if (persistedCommentOutcome) {
        throw responseError(
          persistedCommentOutcome.code,
          persistedCommentOutcome.reason,
        );
      }
      if (
        frozenAgentDelivery.selection?.providerId === "pageroot"
        && unsupportedSourceAgentAttachment(persistedComments)
      ) {
        throw responseError(
          "RUN_AGENT_ATTACHMENT_UNSUPPORTED",
          "源页 Agent 暂不支持此附件，可改用 Qoder、Codex 或复制给其他 AI。",
        );
      }
      const persistedCommentSnapshot = JSON.stringify(
        persistedComments.map(this.#codecs.persistedComment),
      );
      const textLocatorValidation = revalidateCommentTextLocators(
        persistedComments,
        this.#documentSession.html,
      );
      if (!textLocatorValidation.ok) {
        throw responseError(
          textLocatorValidation.code,
          textLocatorValidation.reason,
        );
      }
      persistedComments = textLocatorValidation.comments;
      const finalAttachmentBytes = frozenAgentDelivery.selection?.providerId === "pageroot"
        ? await verifiedSourceAgentAttachmentBytes(
            this.#bridgeClient,
            context.sourcePath,
            persistedComments,
          )
        : 0;
      const currentCommentSnapshot = JSON.stringify(
        this.#commentsForSubmission().map(this.#codecs.persistedComment),
      );
      if (currentCommentSnapshot !== persistedCommentSnapshot) {
        throw responseError(
          "RUN_SUBMISSION_COMMENTS_CHANGED",
          "最新评论在冻结边界内发生变化，请重新确认后再发送。",
        );
      }
      if (sourceAgentBudgetExceeded(
        frozenAgentDelivery,
        agentPreflight,
        frozen.html,
        persistedComments,
        finalAttachmentBytes,
      )) {
        throw responseError(
          "RUN_AGENT_PROMPT_TOO_LARGE",
          "当前页面可能超过所选模型的完整输出能力，请更换模型或使用 Qoder/Codex。",
        );
      }
      const persistedEvents = this.#commentSession.changeEvents.map(
        (event) => ({ ...event }),
      );
      if (!this.#isCurrentContext(context)) {
        throw responseError(
          "RUN_SUBMISSION_CONTEXT_STALE",
          "冻结边界内的最新评论与修改审计尚未安全记录。",
        );
      }
      const request = {
        ...context,
        projectName: this.#codecs.fileStem(submissionContext.projectName),
        sourcePath: context.sourcePath,
        expectedSourceSha256: persistedSourceSha256,
        freezeCutoffRevision,
        lastPersistedRevision: this.#documentSession.lastPersistedRevision,
        summary: this.#summary(persistedComments),
        targets: this.#codecs.uniqueTargets(persistedComments)
          .map(this.#codecs.persistedTargetRef),
        comments: persistedComments.map(this.#codecs.persistedComment),
        changeEvents: persistedEvents.map(this.#codecs.persistedChangeEvent),
        agentDelivery: frozenAgentDelivery,
      };
      const submissionOperationId = `submission_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
      request.submissionOperationId = submissionOperationId;
      submissionRequest = request;
      let receipt;
      try {
        receipt = await this.#bridgeClient.recordSubmission(request);
      } catch (cause) {
        if (!responseMayBeUnknown(cause)) throw cause;
        // This receipt command cannot launch a provider. Reusing the exact
        // operation and frozen bytes reconciles a lost response idempotently.
        receipt = await this.#bridgeClient.recordSubmission(request);
      }
      if (receipt?.operationId !== submissionOperationId || receipt?.status !== "accepted") {
        throw responseError("SUBMISSION_RECEIPT_INVALID", "本轮要求的保存结果尚未确认，没有发送。");
      }
      if (!this.#isCurrentContext(context)) return stale(context);
      if (frozenAgentDelivery.mode === MANAGED_AGENT_MODE) {
        agentPreflight = await this.#agentCatalog.spendTicket(
          frozenAgentDelivery.selection,
          {
            purpose: "execution",
            trustPolicyVersion: frozenAgentDelivery.trustPolicyVersion,
          },
        );
        if (!this.#isCurrentContext(context)) return stale(context);
        frozenAgentDelivery = Object.freeze({
          ...frozenAgentDelivery,
          selection: agentPreflight.selection,
          ...(agentPreflight.configuration
            ? { configuration: agentPreflight.configuration }
            : {}),
        });
      }
      request.agentDelivery = frozenAgentDelivery;
      if (sourceAgentBudgetExceeded(frozenAgentDelivery, agentPreflight, frozen.html, persistedComments, finalAttachmentBytes)) {
        throw responseError("RUN_AGENT_PROMPT_TOO_LARGE", "当前页面超过所选模型输出能力，请更换模型。");
      }
      const operationId = this.#codecs.operationKey(pendingRun);
      let dispatched = false;
      try {
        if (!this.#isCurrentContext(context)) {
          throw responseError(
            "RUN_SUBMISSION_CONTEXT_STALE",
            "建立 Request 前项目身份已经变化，本轮不会发送。",
          );
        }
        dispatched = true;
        const payload = await this.#bridgeClient.createRequest(request);
        if (!this.#isCurrentContext(context)) {
          throw responseError(
            "RUN_SUBMISSION_CONTEXT_STALE",
            "Request 返回时项目身份已经变化，正在只读核对结果。",
          );
        }
        const run = this.#runFromRequestPayload(payload);
        if (!run || !this.#runMatchesContext(run, context)) {
          throw responseError(
            "RUN_REQUEST_IDENTITY_INVALID",
            "任务已创建，但返回的 Request 身份无法核验。",
          );
        }
        durableRun = run;
      } catch (cause) {
        if (!dispatched || !responseMayBeUnknown(cause)) throw cause;
        const uncertainRun = {
          ...pendingRun,
          status: "error",
          error: "本轮任务状态暂时无法确认。当前项目保持只读，避免重复建立任务。",
        };
        this.#runSession.trackRun(uncertainRun, { activate: "always" });
        if (!this.#runSession.markSubmissionUncertain(submission)) throw cause;
        submissionUncertain = true;
        this.#uncertainSubmissions.set(context.sourcePath, {
          context,
          submission,
          pendingRun: uncertainRun,
          operationId,
        });
        this.#publishSnapshot();
        this.#emitEvent({
          type: "run-submission-uncertain",
          run: uncertainRun,
          context,
          current: this.#isCurrentRun(uncertainRun),
          cause,
        });
        const reconciled = await this.reconcileSubmission({
          sourcePath: context.sourcePath,
          reserveRecoveredAgentStart: frozenAgentDelivery.mode === MANAGED_AGENT_MODE,
        });
        if (!this.#isCurrentContext(context)) return stale(context);
        if (reconciled.status === "succeeded") {
          durableRun = reconciled.value.run || null;
          reservedAgentStartKey = reconciled.value.reservedAgentStartKey || null;
          submissionUncertain = this.#uncertainSubmissions.has(context.sourcePath);
          if (durableRun) {
            // Reconciliation found the durable Request. Continue through the
            // ordinary handoff path without ever replaying the POST.
          } else {
            return unknown(
              operationId,
              "Request 的提交结果暂时无法确认，系统正在只读核对项目记录。",
            );
          }
        } else {
          return unknown(
            operationId,
            "Request 的提交结果暂时无法确认，系统正在只读核对项目记录。",
          );
        }
      }
      if (frozenAgentDelivery.mode === MANAGED_AGENT_MODE) {
        reservedAgentStartKey ||= this.#codecs.operationKey(durableRun);
        this.#agentStartsPending.add(reservedAgentStartKey);
      }
      this.#runSession.trackRun(durableRun, {
        activate: this.#isCurrentRun(durableRun) ? "always" : "never",
      });
      this.#emitEvent({
        type: "run-submitted",
        run: durableRun,
        context,
        current: this.#isCurrentRun(durableRun),
      });
      if (frozenAgentDelivery.mode === MANAGED_AGENT_MODE) {
        await this.startAgent({
          run: durableRun,
          preflightId: agentPreflight.preflightId,
          agentStartReserved: true,
        });
        if (!this.#isCurrentContext(context)) return stale(context);
      } else if (durableRun.handoffMessage) {
        await this.copyHandoff({ run: durableRun });
        if (!this.#isCurrentContext(context)) return stale(context);
      }
      return succeeded({ run: durableRun });
    } catch (cause) {
      submissionEndCode = errorCode(cause, "SUBMISSION_NOT_STARTED");
      const message = this.#codecs.errorMessage(
        cause,
        "这次发送没有成功。页面和评论仍然保留。",
      );
      if (pendingRun && this.#runSession.hasRun(pendingRun)) {
        this.#runSession.removeRun(pendingRun);
      }
      if (pendingRun && this.#isCurrentContext(context)) {
        this.#canvasPort.unlock();
        this.#runSession.setActiveRun({
          ...pendingRun,
          status: "error",
          error: message,
        });
      }
      this.#emitEvent({
        type: "run-submission-failed",
        run: pendingRun,
        context,
        current: this.#isCurrentContext(context),
        cause,
        message,
      });
      return rejected(errorCode(cause, "RUN_SUBMISSION_REJECTED"), message);
    } finally {
      // Every pre-Request exit settles the original durable submission, even
      // after navigation. Unknown dispatched Requests retain their own recovery.
      if (submissionRequest && !durableRun && !submissionUncertain) {
        const ending = { ...submissionRequest, errorCode: submissionEndCode };
        try { await this.#bridgeClient.finishSubmission(ending); }
        catch { await this.#bridgeClient.finishSubmission(ending).catch(() => null); }
        if (pendingRun && this.#runSession.hasRun(pendingRun)) this.#runSession.removeRun(pendingRun);
      }
      if (reservedAgentStartKey) {
        this.#agentStartsPending.delete(reservedAgentStartKey);
      }
      if (!submissionUncertain) this.#runSession.releaseSubmission(submission);
      this.syncPolling();
    }
  }

  async reconcileSubmission({
    sourcePath = null,
    generation = this.#pollGeneration,
    reserveRecoveredAgentStart = false,
  } = {}) {
    const entries = sourcePath
      ? [[sourcePath, this.#uncertainSubmissions.get(sourcePath)]]
      : [...this.#uncertainSubmissions.entries()];
    const outcomes = [];
    for (const [key, entry] of entries) {
      if (!entry || !this.#isPollCurrent(generation)) continue;
      const operationKey = this.#codecs.operationKey(entry.pendingRun);
      if (!this.#runSession.beginOperation("poll", operationKey)) continue;
      try {
        const payload = await this.#bridgeClient.workspace(entry.context.sourcePath);
        if (
          !this.#isPollCurrent(generation)
          || this.#uncertainSubmissions.get(key)?.submission?.token !== entry.submission.token
        ) {
          outcomes.push(stale(entry.context));
          continue;
        }
        const runtime = this.#codecs.isRecord(payload.runtimeState)
          ? payload.runtimeState
          : {};
        const conflict = this.#codecs.isRecord(runtime.conflict) ? runtime.conflict : null;
        const activeRecord = this.#codecs.isRecord(runtime.activeRun)
          ? runtime.activeRun
          : this.#codecs.isRecord(payload.activeRun)
            ? payload.activeRun
            : null;
        const recoveredRun = this.#codecs.activeRunFromRecord(
          activeRecord ? { ...activeRecord, ...(conflict ? { conflict } : {}) } : null,
        );
        if (recoveredRun && !this.#runMatchesContext(recoveredRun, entry.context)) {
          throw responseError(
            "RUN_RECONCILIATION_IDENTITY_INVALID",
            "项目记录返回的运行身份与冻结的 Request 不一致。",
          );
        }
        if (recoveredRun) {
          const reservedAgentStartKey = reserveRecoveredAgentStart
            ? this.#codecs.operationKey(recoveredRun)
            : null;
          if (reservedAgentStartKey) {
            // Reserve before RunSession publication. Subscribers may
            // synchronously request polling as soon as the durable run is
            // visible, and /status must never race ahead of /agent/start.
            this.#agentStartsPending.add(reservedAgentStartKey);
          }
          try {
            this.#runSession.trackRun(recoveredRun, {
              activate: this.#isCurrentRun(recoveredRun) ? "always" : "never",
              // A Request recovered from this still-active POST submission has
              // not survived a Bridge/app restart; it still owns the one
              // authorized Agent start below. Background reconciliation keeps
              // the ordinary interrupted-session projection.
              recovered: !reserveRecoveredAgentStart,
            });
          } catch (cause) {
            if (reservedAgentStartKey) {
              this.#agentStartsPending.delete(reservedAgentStartKey);
            }
            throw cause;
          }
          this.#settleUncertainSubmission(key, entry);
          this.#emitEvent({
            type: "run-submission-reconciled",
            run: recoveredRun,
            context: entry.context,
            current: this.#isCurrentRun(recoveredRun),
          });
          outcomes.push(succeeded({ run: recoveredRun, reservedAgentStartKey }));
          continue;
        }
        const outcome = this.#codecs.activeRunFromRecord(payload.recentRunOutcome);
        if (outcome && !this.#runMatchesContext(outcome, entry.context)) {
          throw responseError(
            "RUN_RECONCILIATION_OUTCOME_INVALID",
            "项目记录返回的完成结果与冻结的 Request 不一致。",
          );
        }
        if (outcome) {
          this.#runSession.removeRun(entry.pendingRun);
          this.#runSession.rememberOutcome(outcome);
          if (this.#isCurrentRun(outcome)) {
            this.#runSession.setActiveRun(outcome);
            this.#canvasPort.unlock();
          }
          this.#settleUncertainSubmission(key, entry);
          this.#emitEvent({
            type: "run-submission-reconciled",
            run: outcome,
            context: entry.context,
            current: this.#isCurrentRun(outcome),
          });
          outcomes.push(succeeded({ run: outcome }));
          continue;
        }
        this.#runSession.removeRun(entry.pendingRun);
        if (this.#isCurrentContext(entry.context)) {
          this.#runSession.clearActiveRun();
          this.#canvasPort.unlock();
        }
        this.#settleUncertainSubmission(key, entry);
        this.#emitEvent({
          type: "run-submission-reconciled",
          run: null,
          context: entry.context,
          current: this.#isCurrentContext(entry.context),
        });
        outcomes.push(succeeded({ run: null }));
      } catch (cause) {
        if (this.#isPollCurrent(generation)) {
          this.#emitEvent({
            type: "run-submission-reconcile-failed",
            run: entry.pendingRun,
            context: entry.context,
            current: this.#isCurrentContext(entry.context),
            cause,
          });
        }
        outcomes.push(unknown(entry.operationId, this.#codecs.errorMessage(
          cause,
          "项目记录暂时无法读取，仍将只读核对。",
        )));
      } finally {
        this.#runSession.endOperation("poll", operationKey);
      }
    }
    this.syncPolling();
    return outcomes[0] || succeeded({ run: null });
  }

  async copyHandoff({ run = this.#runSession.activeRun } = {}) {
    if (!run?.handoffMessage || !run.sourcePath || !run.requestId || run.requestId === "pending") {
      return blocked("RUN_HANDOFF_UNAVAILABLE", "当前 Request 没有可复制的交接内容。");
    }
    const delivery = deliveryForRun(run);
    if (
      delivery?.mode === MANAGED_AGENT_MODE
      && !this.#agentCatalog.provider(delivery.selection)
    ) {
      return blocked(
        "RUN_AGENT_PROVIDER_UNAVAILABLE",
        "这一 Request 的 Agent Provider 未安装，可继续审阅或结束本轮。",
      );
    }
    if (agentRecoveryRequired(run, this.#runSession.handoffForSource(run.sourcePath))) {
      return blocked(
        "RUN_AGENT_RECOVERY_REQUIRED",
        "这轮不能安全改为复制任务。请结束本轮，再重新发送为新的 Request。",
      );
    }
    this.#runSession.publishHandoff({
      sourcePath: run.sourcePath,
      requestId: run.requestId,
      attemptId: run.attemptId,
      mode: "clipboard",
      status: "copying",
    });
    try {
      const result = await this.#handoffPort.copy({ message: run.handoffMessage, run });
      if (result?.status !== "copied" || result.copied !== true) {
        throw responseError("RUN_HANDOFF_COPY_UNCONFIRMED", "剪贴板没有确认读回成功。");
      }
      if (!this.#runSession.hasRun(run)) return stale(run);
      this.#runSession.publishHandoff({
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        mode: "clipboard",
        status: "copied",
      });
      this.#emitEvent({
        type: "run-handoff-copied",
        run,
        current: this.#isCurrentRun(run),
      });
      return succeeded({ run });
    } catch (cause) {
      if (this.#runSession.hasRun(run)) {
        this.#runSession.publishHandoff({
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          mode: "clipboard",
          status: "failed",
        });
      }
      this.#emitEvent({
        type: "run-handoff-failed",
        run,
        current: this.#isCurrentRun(run),
        cause,
        message: this.#codecs.errorMessage(
          cause,
          "这次任务还在，打开本轮后可以重新复制",
        ),
      });
      return rejected(errorCode(cause, "RUN_HANDOFF_COPY_FAILED"), this.#codecs.errorMessage(
        cause,
        "这次任务还在，打开本轮后可以重新复制",
      ));
    }
  }

  async startAgent({
    run = this.#runSession.activeRun,
    preflightId = null,
    agentStartReserved = false,
  } = {}) {
    const delivery = deliveryForRun(run);
    const presentation = this.#agentCatalog.presentation(delivery?.selection);
    if (!run?.sourcePath || !run.requestId || run.requestId === "pending") {
      return blocked(
        "RUN_AGENT_UNAVAILABLE",
        presentation.startUnavailable || "当前 Request 还不能启动 Agent。",
      );
    }
    if (!delivery || delivery.mode !== MANAGED_AGENT_MODE) {
      return blocked("RUN_AGENT_UNAVAILABLE", "当前 Request 不是受管 Agent 交接。");
    }
    if (agentRecoveryRequired(run, this.#runSession.handoffForSource(run.sourcePath))) {
      return blocked(
        "RUN_AGENT_RECOVERY_REQUIRED",
        `Bridge 无法证明旧 ${presentation.agentName || "Agent"} 会话已经停止。请结束本轮，再重新发送。`,
      );
    }
    const operationKey = this.#codecs.operationKey(run);
    if (!agentStartReserved && this.#agentStartsPending.has(operationKey)) {
      return blocked(
        "RUN_AGENT_START_BUSY",
        presentation.startBusy || "Agent 正在启动，请等待当前操作完成。",
      );
    }
    this.#agentStartsPending.add(operationKey);
    let preflight = preflightId ? { preflightId, status: "ready" } : null;
    try {
      if (!preflight) {
        preflight = await this.#agentCatalog.spendTicket(delivery.selection, {
          purpose: "execution",
          trustPolicyVersion: delivery.trustPolicyVersion,
        });
      }
      // Ending this exact Run while retry preflight waits must fence the
      // eventual launch, including cancellation whose receipt is still pending.
      if (!this.#runSession.hasRun(run)
        || this.#runSession.isOperationBusy("cancel", operationKey)) return stale(run);
      if (preflight?.status !== "ready" || !preflight.preflightId) {
        throw responseError(
          "RUN_AGENT_PREFLIGHT_INVALID",
          "Agent 预检没有返回可验证结果。",
        );
      }
      this.#runSession.publishHandoff({
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        mode: MANAGED_AGENT_MODE,
        status: "starting",
        phase: "launching",
        providerId: delivery.selection.providerId,
        runtimeId: delivery.selection.runtimeId,
        agentName: presentation.agentName || presentation.displayName || "Agent",
        agentVersion: null,
        visibleText: "",
        visibleTextUpdates: [],
        textTruncated: false,
        startedAt: null,
        updatedAt: null,
      });
      const result = await this.#bridgeClient.startAgent({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        selection: delivery.selection,
        trustPolicyAccepted: delivery.trustPolicyVersion,
        preflightId: preflight.preflightId,
        configurationDigest: delivery.configuration?.configurationDigest,
      });
      if (!this.#runSession.hasRun(run)) return stale(run);
      const next = agentHandoffState(run, result?.session);
      if (!next || !["starting", "running", "completed"].includes(next.status)) {
        throw responseError("RUN_AGENT_START_UNCONFIRMED", "Agent 没有确认启动。");
      }
      const previous = this.#runSession.handoffForSource(run.sourcePath);
      this.#runSession.publishHandoff({
        ...previous,
        ...next,
        // The provider runtime may identify itself with a technical process
        // name. The execution surface always speaks with the Request-frozen
        // provider presentation instead.
        agentName: previous?.agentName || presentation.agentName || presentation.displayName
          || next.agentName || "Agent",
        providerId: next.providerId || previous?.providerId || delivery.selection.providerId,
        runtimeId: next.runtimeId || previous?.runtimeId || delivery.selection.runtimeId,
      });
      this.#emitEvent({
        type: "run-agent-started",
        run,
        agentSession: result.session,
        current: this.#isCurrentRun(run),
      });
      return succeeded({ run, agentSession: result.session });
    } catch (cause) {
      const code = errorCode(cause, "RUN_AGENT_START_FAILED");
      const message = this.#codecs.errorMessage(
        cause,
        presentation.startFailure
          || "Agent 没有启动。本轮 Request 已保留，可重试或复制任务。",
      );
      if (this.#runSession.hasRun(run)) {
        this.#runSession.publishHandoff({
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          mode: MANAGED_AGENT_MODE,
          status: "failed",
          phase: "failed",
          errorCode: code,
          errorMessage: message,
          retryable: !NON_RETRYABLE_AGENT_ERRORS.has(code),
          safeToRetry: !NON_RETRYABLE_AGENT_ERRORS.has(code),
          recoveryKind: agentRecoveryKindForError(code, {
            safeToRetry: !NON_RETRYABLE_AGENT_ERRORS.has(code),
          }),
        });
      }
      this.#agentCatalog.noteRunFailure(deliveryForRun(run)?.selection, code);
      this.#emitEvent({
        type: "run-agent-failed",
        run,
        current: this.#isCurrentRun(run),
        cause,
        message,
      });
      return rejected(code, message);
    } finally {
      this.#agentStartsPending.delete(operationKey);
      this.syncPolling();
    }
  }

  async cancel({
    run = this.#runSession.activeRun,
    agentMayBeRunning = false,
    reason,
  } = {}) {
    if (!run?.requestId || run.requestId === "pending") {
      return blocked("RUN_CANCEL_UNAVAILABLE", "当前 Request 尚未形成可取消的身份。");
    }
    const operationKey = this.#codecs.operationKey(run);
    if (this.#runSession.isOperationBusy("activate", operationKey) || run.adoptionPhase) {
      return blocked("RUN_ADOPTION_PENDING", "采用结果正在确认，暂时不能结束本轮。");
    }
    if (!this.#runSession.beginOperation("cancel", operationKey)) {
      return blocked("RUN_CANCEL_BUSY", "本轮结束操作正在进行。");
    }
    const handoffBeforeCancel = this.#runSession.handoffForSource(run.sourcePath);
    const publishesCancelling = Boolean(
      handoffBeforeCancel?.mode === MANAGED_AGENT_MODE
      && handoffBeforeCancel.requestId === run.requestId
      && handoffBeforeCancel.attemptId === run.attemptId
      && ["starting", "running"].includes(handoffBeforeCancel.status),
    );
    if (publishesCancelling) {
      this.#runSession.publishHandoff({
        ...handoffBeforeCancel,
        status: "cancelling",
        phase: "cancelling",
      });
    }
    // Cancellation may outlive a switch away and reopen of the same project.
    // Stable project IDs alone must not let a late response mutate the newer
    // editor generation or its active run.
    const context = this.#isCurrentRun(run)
      ? copyContext(this.#projectSession.context)
      : null;
    try {
      if (run.sourcePath !== "preview://welcome") {
        const cancellation = await this.#bridgeClient.cancelActiveRun({
          intent: run.status === "ready-to-open" ? "discard" : "stop",
          projectId: run.projectId,
          documentId: run.documentId,
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          reason: reason || (agentMayBeRunning
            ? "cancelled-by-user-after-agent-handoff"
            : "cancelled-by-user"),
        });
        if (cancellation?.status === "result-ready") {
          if (!this.#runSession.hasRun(run)) return stale(run);
          const payload = await this.#bridgeClient.status(run.sourcePath, run.requestId, run.attemptId);
          if (!this.#runSession.hasRun(run)) return stale(run);
          if (!context || !this.#isCurrentContext(context)) return stale(run);
          if (!this.#runSession.hasRun(run)) return stale(run);
          this.#processStatus(run, payload);
          return succeeded({ run, resultReady: true });
        }
      }
      const tracked = this.#runSession.hasRun(run);
      const current = Boolean(tracked && context && this.#isCurrentContext(context));
      if (tracked) {
        this.#runSession.removeRun(run);
        const handoff = this.#runSession.handoffForSource(run.sourcePath);
        if (
          handoff?.requestId === run.requestId
          && handoff?.attemptId === run.attemptId
        ) this.#runSession.clearHandoff(run.sourcePath);
      }
      if (current) {
        this.#runSession.clearActiveRun();
        this.#canvasPort.unlock();
      }
      this.#emitEvent({
        type: "run-cancelled",
        run,
        current,
        agentMayBeRunning,
      });
      this.syncPolling();
      return succeeded({ run, current });
    } catch (cause) {
      const tracked = this.#runSession.hasRun(run);
      const current = Boolean(tracked && context && this.#isCurrentContext(context));
      const currentHandoff = this.#runSession.handoffForSource(run.sourcePath);
      if (
        publishesCancelling
        && currentHandoff?.requestId === run.requestId
        && currentHandoff?.attemptId === run.attemptId
        && currentHandoff.status === "cancelling"
      ) this.#runSession.publishHandoff(handoffBeforeCancel);
      if (tracked) {
        this.#runSession.trackRun({
          ...run,
          error: this.#codecs.errorMessage(
            cause,
            "取消结果暂时无法确认。源页会继续在后台核对。",
          ),
        }, { activate: current ? "always" : "never" });
      }
      this.#emitEvent({
        type: "run-cancel-failed",
        run,
        current,
        cause,
      });
      return rejected(errorCode(cause, "RUN_CANCEL_REJECTED"), this.#codecs.errorMessage(
        cause,
        "取消结果暂时无法确认。源页会继续在后台核对。",
      ));
    } finally {
      this.#runSession.endOperation("cancel", operationKey);
    }
  }

  async resolveConflict({
    run = this.#runSession.activeRun,
    action,
  } = {}) {
    if (!run || run.status !== "awaiting-conflict-resolution") {
      return blocked("RUN_CONFLICT_UNAVAILABLE", "当前没有需要处理的 AI 冲突。");
    }
    if (action !== "adopt-ai" && action !== "keep-external") {
      return rejected("RUN_CONFLICT_ACTION_INVALID", "冲突处理方式无效。");
    }
    const operationKey = this.#codecs.operationKey(run);
    if (!this.#runSession.beginOperation("resolve", operationKey)) {
      return blocked("RUN_CONFLICT_BUSY", "冲突处理正在进行。");
    }
    // Conflict resolution may outlive a switch away and reopen of the same
    // project. The stable project IDs alone are not enough to authorize a
    // late result to unlock or reload the newer editor generation.
    const context = this.#isCurrentRun(run)
      ? copyContext(this.#projectSession.context)
      : null;
    try {
      const payload = await this.#bridgeClient.resolveConflict({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        conflictId: run.conflictId,
        action,
      });
      const current = Boolean(context && this.#isCurrentContext(context));
      if (!this.#runSession.hasRun(run)) return stale(run);
      if (action === "keep-external") {
        this.#runSession.removeRun(run);
        this.#runSession.clearHandoff(run.sourcePath);
        if (current) {
          this.#runSession.clearActiveRun();
          this.#canvasPort.unlock();
        }
        this.#emitEvent({
          type: "run-conflict-resolved",
          run,
          action,
          current,
          reloadCurrentSource: current,
        });
        this.syncPolling();
        return succeeded({ run, action, current, reloadCurrentSource: current });
      }
      const conflict = this.#codecs.isRecord(payload.conflict) ? payload.conflict : null;
      const nextRun = this.#codecs.activeRunFromRecord(
        this.#codecs.isRecord(payload.activeRun)
          ? { ...payload.activeRun, ...(conflict ? { conflict } : {}) }
          : payload,
      ) || { ...run, status: "committing" };
      this.#runSession.trackRun(nextRun, {
        activate: current ? "always" : "never",
      });
      this.#emitEvent({
        type: "run-conflict-resolved",
        run: nextRun,
        action,
        current,
        reloadCurrentSource: false,
      });
      this.syncPolling();
      return succeeded({ run: nextRun, action, current, reloadCurrentSource: false });
    } catch (cause) {
      const current = Boolean(context && this.#isCurrentContext(context));
      if (this.#runSession.hasRun(run)) {
        this.#runSession.trackRun({
          ...run,
          error: this.#codecs.errorMessage(
            cause,
            "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
          ),
        }, { activate: current ? "always" : "never" });
      }
      this.#emitEvent({
        type: "run-conflict-failed",
        run,
        action,
        current,
        cause,
      });
      return rejected(errorCode(cause, "RUN_CONFLICT_REJECTED"), this.#codecs.errorMessage(
        cause,
        "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
      ));
    } finally {
      this.#runSession.endOperation("resolve", operationKey);
    }
  }

  async hydrateRecentRuns({ projects = [], activeSourcePath = null } = {}) {
    const effectiveActiveSourcePath = activeSourcePath
      || this.#runSession.snapshot.activeSourcePath;
    const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
    const hydrationTargets = [];
    for (const project of Array.isArray(projects) ? projects : []) {
      const sourcePath = project?.sourcePath;
      if (
        !sourcePath
        || this.#codecs.sameSourcePath(sourcePath, effectiveActiveSourcePath)
        || hydrationTargets.some((target) => this.#codecs.sameSourcePath(
          target.sourcePath,
          sourcePath,
        ))
      ) continue;
      const locatorKey = typeof runCoordination?.locatorKey === "function"
        ? runCoordination.locatorKey(sourcePath)
        : sourcePath;
      const querySequence = ++this.#hydrationSequence;
      this.#hydrationQueries.set(locatorKey, querySequence);
      hydrationTargets.push(Object.freeze({
        sourcePath,
        locatorKey,
        projectEpoch: Number.isSafeInteger(Number(this.#projectSession.epoch))
          ? Number(this.#projectSession.epoch)
          : null,
        querySequence,
        revision: typeof runCoordination?.locatorRevision === "function"
          ? runCoordination.locatorRevision(sourcePath)
          : null,
        expected: Object.freeze({
          run: hydrationAttempt(this.#runSession.runForSource(sourcePath)),
          handoff: hydrationAttempt(this.#runSession.handoffForSource(sourcePath)),
          outcome: hydrationAttempt(this.#runSession.outcomeForSource(sourcePath)),
          result: this.#runSession.resultForSource(sourcePath),
        }),
      }));
    }
    const sourcePaths = hydrationTargets.map((target) => target.sourcePath);
    const isCurrentTarget = (target) => {
      const { sourcePath, expected } = target;
      if (
        target.revision === null
        || typeof runCoordination?.locatorRevision !== "function"
        || this.#hydrationQueries.get(target.locatorKey) !== target.querySequence
        || runCoordination.locatorRevision(sourcePath) !== target.revision
        || (
          target.projectEpoch !== null
          && this.#projectSession.epoch !== target.projectEpoch
        )
      ) return false;
      const snapshot = this.#runSession.snapshot;
      if (
        this.#codecs.sameSourcePath(snapshot.activeSourcePath, sourcePath)
        || this.#codecs.sameSourcePath(this.#projectSession.context?.sourcePath, sourcePath)
      ) return false;
      return sameHydrationAttempt(
        hydrationAttempt(this.#runSession.runForSource(sourcePath)),
        expected.run,
      )
        && sameHydrationAttempt(
          hydrationAttempt(this.#runSession.handoffForSource(sourcePath)),
          expected.handoff,
        )
        && sameHydrationAttempt(
          hydrationAttempt(this.#runSession.outcomeForSource(sourcePath)),
          expected.outcome,
        )
        && this.#runSession.resultForSource(sourcePath) === expected.result;
    };
    const recovered = await Promise.allSettled(hydrationTargets.map(async (target) => {
      const { sourcePath } = target;
      try {
        const payload = await this.#bridgeClient.workspace(sourcePath);
        if (!isCurrentTarget(target)) return null;
        const runtime = this.#codecs.isRecord(payload.runtimeState)
          ? payload.runtimeState
          : {};
        const conflict = this.#codecs.isRecord(runtime.conflict)
          ? runtime.conflict
          : null;
        const rawRun = this.#codecs.isRecord(runtime.activeRun)
          ? runtime.activeRun
          : this.#codecs.isRecord(payload.activeRun)
            ? payload.activeRun
            : null;
        const rawOutcome = this.#codecs.isRecord(payload.recentRunOutcome)
          ? payload.recentRunOutcome
          : null;
        const authority = hydrationAuthorityContext(
          payload,
          sourcePath,
          this.#codecs.sameSourcePath,
        );
        if (!authority) return null;
        const run = this.#codecs.activeRunFromRecord(
          hydrationRecord(rawRun, authority, sourcePath, conflict),
        );
        const outcome = this.#codecs.activeRunFromRecord(
          hydrationRecord(rawOutcome, authority, sourcePath),
        );
        if (
          (run && (
            !this.#codecs.sameSourcePath(run.sourcePath, sourcePath)
            || !hydrationContextMatches(run, authority)
          ))
          || (outcome && (
            !this.#codecs.sameSourcePath(outcome.sourcePath, sourcePath)
            || !hydrationContextMatches(outcome, authority)
          ))
          || !isCurrentTarget(target)
        ) return null;
        if (outcome && !this.#runSession.rememberOutcome(outcome)) return null;
        if (run && isPollable(run)) {
          this.#runSession.trackRun(run, { activate: "never", recovered: true });
          return run;
        }
        return null;
      } finally {
        if (this.#hydrationQueries.get(target.locatorKey) === target.querySequence) {
          this.#hydrationQueries.delete(target.locatorKey);
        }
      }
    }));
    this.syncPolling();
    return succeeded({
      recovered: recovered.filter((result) => result.status === "fulfilled" && result.value).length,
      attempted: sourcePaths.length,
    });
  }

  async #pollRun(run, generation) {
    if (!this.#isPollCurrent(generation) || !this.#runSession.hasRun(run)) {
      return stale(run);
    }
    const operationKey = this.#codecs.operationKey(run);
    if (this.#runSession.isOperationBusy("activate", operationKey)) {
      return blocked(
        "RUN_POLL_ACTIVATION_BUSY",
        "当前候选版本正在打开，状态核对已延后。",
      );
    }
    if (!this.#runSession.beginOperation("poll", operationKey)) {
      return blocked("RUN_POLL_BUSY", "本轮状态正在核对。");
    }
    try {
      const payload = await this.#bridgeClient.status(
        run.sourcePath,
        run.requestId,
        run.attemptId,
      );
      if (
        !this.#isPollCurrent(generation)
        || !this.#runSession.hasRun(run)
        || this.#runSession.isOperationBusy("activate", operationKey)
      ) {
        return stale(run);
      }
      return this.#processStatus(run, payload);
    } catch (cause) {
      // A transient status read is intentionally non-terminal. The next owned
      // polling pass is the only retry path and never replays Request creation.
      return rejected(errorCode(cause, "RUN_POLL_REJECTED"), this.#codecs.errorMessage(
        cause,
        "任务状态暂时无法读取。",
      ));
    } finally {
      this.#runSession.endOperation("poll", operationKey);
    }
  }

  #processStatus(run, payload) {
    const previousHandoff = this.#runSession.handoffForSource(run.sourcePath);
    const agentState = agentHandoffState(run, payload.agentSession);
    const frozenPresentation = this.#agentCatalog.presentation(deliveryForRun(run)?.selection);
    const clipboardFallbackActive = previousHandoff?.mode === "clipboard"
      && ["copying", "copied"].includes(previousHandoff.status);
    if (agentState && !clipboardFallbackActive) {
      const nextHandoff = {
        ...previousHandoff,
        ...agentState,
        // Runtime-native names are evidence, not display identity. A current
        // run keeps the Provider presentation frozen at Request creation.
        agentName: previousHandoff?.agentName || frozenPresentation.agentName
          || frozenPresentation.displayName || agentState.agentName || null,
        providerId: agentState.providerId || previousHandoff?.providerId || null,
        runtimeId: agentState.runtimeId || previousHandoff?.runtimeId || null,
        startedAt: agentState.startedAt || previousHandoff?.startedAt || null,
        updatedAt: agentState.updatedAt || previousHandoff?.updatedAt || null,
      };
      if (
        agentState.visibleText
        && agentState.visibleText !== previousHandoff?.visibleText
      ) {
        this.#lastNarrationAt = this.#clock.now();
      }
      this.#runSession.publishHandoff(nextHandoff);
      if (
        ["failed", "interrupted"].includes(agentState.status)
        && previousHandoff?.status !== agentState.status
      ) {
        this.#agentCatalog.noteRunFailure(deliveryForRun(run)?.selection, agentState.errorCode);
        this.#emitEvent({
          type: "run-agent-failed",
          run,
          agentSession: payload.agentSession,
          current: this.#isCurrentRun(run),
          message: agentState.errorMessage,
        });
      }
    }
    const rawState = String(payload.status || payload.lifecycleState || "processing");
    const state = this.#codecs.canonicalLifecycleState(rawState, {
      readyVersion: Boolean(payload.versionId),
    });
    const current = this.#isCurrentRun(run);
    const previousState = this.#runSession.runForSource(run.sourcePath)?.status;
    if (state === "ready-to-open") {
      const nextRun = this.#codecs.activeRunFromRecord({
        ...run,
        ...payload,
        status: "ready-to-open",
        readyPayload: payload,
        completionObserved: true,
      }) || { ...run, status: "ready-to-open", readyPayload: payload, completionObserved: true };
      this.#runSession.trackRun(nextRun, { activate: current ? "always" : "never" });
      if (current) this.#runSession.clearResult(run.sourcePath);
      else if (previousState !== "ready-to-open") {
        this.#runSession.markResult(run.sourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: this.#clock.now(),
        });
      }
      this.#emitEvent({ type: "run-status", run: nextRun, state, current, previousState });
      return succeeded({ run: nextRun, state, current, previousState });
    }
    if (state === "no-change" || state === "error") {
      this.#runSession.removeRun(run);
      const fallback = state === "no-change"
        ? { ...run, status: state, completionObserved: true }
        : {
            ...run,
            status: state,
            error: "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
            completionObserved: payload.completionObserved === true,
          };
      const terminalRun = this.#codecs.activeRunFromRecord({
        ...run,
        ...payload,
        status: state,
      })
        || fallback;
      this.#runSession.rememberOutcome(terminalRun);
      if (current) {
        this.#runSession.clearResult(run.sourcePath);
        this.#runSession.setActiveRun(terminalRun);
        this.#canvasPort.unlock();
      } else {
        this.#runSession.markResult(run.sourcePath, {
          state: state === "no-change" ? "no-change" : "error",
          label: state === "no-change" ? "已完成 · 无变化" : "需要处理",
          updatedAt: this.#clock.now(),
        });
      }
      this.#emitEvent({ type: "run-status", run: terminalRun, state, current, previousState });
      return succeeded({ run: terminalRun, state, current, previousState });
    }
    if (state === "cancelled") {
      this.#runSession.removeRun(run);
      this.#runSession.clearHandoff(run.sourcePath);
      if (current) {
        this.#runSession.clearResult(run.sourcePath);
        this.#runSession.clearActiveRun();
        this.#canvasPort.unlock();
      }
      this.#emitEvent({ type: "run-status", run, state, current, previousState });
      return succeeded({ run, state, current, previousState });
    }
    const conflict = this.#codecs.isRecord(payload.conflict) ? payload.conflict : null;
    const nextRun = this.#codecs.activeRunFromRecord(
      this.#codecs.isRecord(payload.activeRun)
        ? { ...payload.activeRun, ...(conflict ? { conflict } : {}) }
        : { ...run, ...payload, status: state },
    ) || { ...run, status: state };
    this.#runSession.trackRun(nextRun, { activate: current ? "always" : "never" });
    if (current) this.#runSession.clearResult(run.sourcePath);
    else if (nextRun.status === "awaiting-conflict-resolution") {
      this.#runSession.markResult(run.sourcePath, {
        state: "conflict",
        label: "需要处理",
        updatedAt: this.#clock.now(),
      });
    } else {
      this.#runSession.markResult(run.sourcePath, {
        state: "processing",
        label: "正在处理",
        updatedAt: this.#clock.now(),
      });
    }
    this.#emitEvent({ type: "run-status", run: nextRun, state, current, previousState });
    return succeeded({ run: nextRun, state, current, previousState });
  }

  #commentsForSubmission() {
    const comments = this.#canvasPort.normalizeComments();
    return Array.isArray(comments)
      ? comments.filter(this.#codecs.commentHasContent)
      : [];
  }

  #validateComments(comments, sourceSha256 = null, expectedCount = null) {
    if (comments.length === 0) {
      return blocked("RUN_SUBMISSION_COMMENTS_EMPTY", "请先添加至少一条已保存的评论。");
    }
    if (
      expectedCount !== null
      && comments.length !== expectedCount
    ) {
      return blocked(
        "RUN_SUBMISSION_COMMENTS_CHANGED",
        "最新评论在冻结边界内发生变化，请重新确认后再发送。",
      );
    }
    const unsafe = comments.find((comment) => {
      const sourceTarget = comment?.sourceAnchor || comment?.target;
      return (
        !this.#codecs.canLocateTarget(sourceTarget)
        || (
          sourceSha256
          && sourceTarget?.sourceAnchor?.sourceSha256
          && !sourceTarget?.textLocator
          && sourceTarget.sourceAnchor.sourceSha256 !== sourceSha256
        )
      );
    });
    if (unsafe) {
      return blocked(
        "RUN_SUBMISSION_TARGET_UNSAFE",
        "有评论目标未能与当前源 HTML 对齐，请重新选择后再发送。",
      );
    }
    return null;
  }

  #summary(comments) {
    return comments.map((comment) => (
      String(comment.text || "").trim()
      || `参考附件：${(comment.attachments || []).map((item) => item.fileName).join("、")}`
    )).join("；").slice(0, 5_000);
  }

  #pendingRun({ context, submission, previousVersionId, basedOnVersionId, agentDelivery }) {
    return {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceWorkingCopyId: context.targetKind === "working-copy"
        ? context.workingCopyId : null,
      submissionToken: submission.token,
      requestId: "pending",
      attemptId: "attempt_001",
      requestPath: "",
      attemptPath: "",
      handoffMessage: "",
      agentDelivery,
      status: "submitting",
      sourcePath: context.sourcePath,
      baseSnapshotSha256: context.frozenSourceSha256,
      previousVersionId: previousVersionId || null,
      basedOnVersionId: basedOnVersionId || null,
      freezeCutoffRevision: context.freezeCutoffRevision,
      candidateVersionId: "",
      candidateVersionLabel: "下一版",
      submittedAt: validDate(this.#clock),
      summary: this.#summary(context.comments),
      commentCount: context.comments.length,
      changeEventCount: context.changeEvents.length,
    };
  }

  #runFromRequestPayload(payload) {
    if (!this.#codecs.isRecord(payload)) return null;
    return this.#codecs.activeRunFromRecord(
      this.#codecs.isRecord(payload.activeRun)
        ? {
            ...payload.activeRun,
            candidateDisplayVersionLabel: payload.candidateDisplayVersionLabel,
          }
        : payload,
    );
  }

  #runMatchesContext(run, context) {
    return Boolean(
      run
      && context
      && this.#codecs.sameSourcePath(run.sourcePath, context.sourcePath)
      && run.projectId === context.projectId
      && run.documentId === context.documentId
      && (!run.sourceWorkingCopyId || context.targetKind !== "working-copy"
        || run.sourceWorkingCopyId === context.workingCopyId),
    );
  }

  #captureSubmissionPlan() {
    const entryPlan = planRunSubmitEntry({ disposed: this.#disposed });
    if (entryPlan.kind === "reject") {
      return Object.freeze({ context: null, plan: entryPlan });
    }
    const context = verifyProjectContext(
      this.#projectSession.context,
      this.#projectSession,
      {
        disposed: this.#disposed,
        sameSourcePath: this.#codecs.sameSourcePath,
      },
    );
    const plan = planRunSubmit({
      sourcePath: this.#projectSession.sourcePath,
      context,
      submissionPending: this.#runSession.submissionPending,
      activeLocked: this.#runSession.activeLocked,
      hasComposerDraft: Boolean(
        this.#commentSession.composerTarget
        && (
          this.#commentSession.composerDraft.trim()
          || this.#commentSession.composerAttachments.length > 0
        )
      ),
      hasDirtyEdit: Boolean(
        this.#commentSession.editSession
        && this.#codecs.commentEditSessionHasChanges(this.#commentSession.editSession)
      ),
    });
    return Object.freeze({ context, plan });
  }

  #isCurrentContext(context) {
    return Boolean(verifyProjectContext(context, this.#projectSession, {
      disposed: this.#disposed,
      sameSourcePath: this.#codecs.sameSourcePath,
    }));
  }

  #isCurrentRun(run) {
    if (!run) return false;
    const context = this.#projectSession.context;
    return Boolean(
      context
      && this.#codecs.sameSourcePath(run.sourcePath, context.sourcePath)
      && (!run.projectId || run.projectId === context.projectId)
      && (!run.documentId || run.documentId === context.documentId),
    );
  }

  #settleUncertainSubmission(key, entry) {
    if (this.#uncertainSubmissions.get(key)?.submission?.token !== entry.submission.token) {
      return false;
    }
    this.#uncertainSubmissions.delete(key);
    this.#runSession.releaseSubmission(entry.submission);
    this.#publishSnapshot();
    return true;
  }

  #hasPollingWork() {
    return this.#uncertainSubmissions.size > 0
      || this.#runSession.runs.some((run) => (
        isPollable(run)
        && !this.#agentStartsPending.has(this.#codecs.operationKey(run))
      ));
  }

  #pollDelayMs() {
    if (String(this.#visibility?.visibilityState || "visible") === "hidden") {
      return POLL_DELAYS_MS.hidden;
    }
    if (this.#uncertainSubmissions.size > 0) return POLL_DELAYS_MS.reconcile;
    const handoffs = this.#runSession.runs.map((run) => (
      this.#runSession.handoffForSource(run.sourcePath)
    )).filter(Boolean);
    if (handoffs.some((handoff) => handoff.status === "cancelling")) {
      return POLL_DELAYS_MS.cancelling;
    }
    if (this.#clock.now() - this.#lastNarrationAt < 1_000) {
      return POLL_DELAYS_MS.streaming;
    }
    if (handoffs.some((handoff) => ["starting", "launching", "starting-session"].includes(
      handoff.status === "starting" ? handoff.phase || handoff.status : handoff.status,
    ))) {
      return POLL_DELAYS_MS.starting;
    }
    if (handoffs.some((handoff) => ["reading-task", "writing-candidate", "finalizing"].includes(
      handoff.phase,
    ))) {
      return POLL_DELAYS_MS.active;
    }
    return POLL_DELAYS_MS.reconcile;
  }

  #scheduleNextPoll(generation, delayMs) {
    if (
      !this.#isPollCurrent(generation)
      || !this.#pollLoopActive
      || !this.#hasPollingWork()
      || this.#timer !== null
    ) return;
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      void this.pollNow({ generation }).finally(() => {
        if (
          this.#isPollCurrent(generation)
          && this.#pollLoopActive
          && this.#hasPollingWork()
        ) {
          this.#scheduleNextPoll(generation, this.#pollDelayMs());
        } else if (this.#pollGeneration === generation && this.#pollLoopActive) {
          this.#pollLoopActive = false;
          this.#publishSnapshot();
        }
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  #rescheduleForVisibility() {
    if (this.#disposed || !this.#pollLoopActive || this.#timer === null) return;
    const generation = this.#pollGeneration;
    this.#scheduler.clearTimeout(this.#timer);
    this.#timer = null;
    this.#scheduleNextPoll(generation, this.#pollDelayMs());
  }

  #isPollCurrent(generation) {
    return !this.#disposed && generation === this.#pollGeneration;
  }

  freezeAgentSelection() {
    return this.#agentCatalog.freezeSelected();
  }

  selectAgent(selection) {
    this.#defaultCommitSeq += 1;
    return this.#agentCatalog.select(selection);
  }

  queuePendingDefaultAgent(selection) {
    this.#defaultCommitSeq += 1;
    return this.#agentCatalog.queuePendingDefault(selection);
  }

  pendingDefaultAgent() {
    return this.#agentCatalog.pendingDefault();
  }

  readyPendingDefaultAgent() {
    return this.#agentCatalog.readyPendingDefault();
  }

  clearPendingDefaultAgent(expectedIntentId) {
    this.#defaultCommitSeq += 1;
    return this.#agentCatalog.clearPendingDefault(expectedIntentId);
  }

  async commitPendingDefaultAgent(selection, { saveDefault } = {}) {
    const pending = this.#agentCatalog.peekPendingDefaultIntent();
    if (!pending) return succeeded({ committed: false });
    const queued = pending.validatedSelection || pending.queuedSelection;
    if (selection && queued.providerId !== selection.providerId) {
      return succeeded({ committed: false });
    }
    const ready = this.#agentCatalog.readyPendingDefault();
    if (!ready) return succeeded({ committed: false });
    const intentId = pending.intentId;
    const generation = this.#defaultCommitSeq;
    if (typeof saveDefault === "function") {
      await saveDefault(ready.providerId);
    }
    if (generation !== this.#defaultCommitSeq
      || this.#agentCatalog.peekPendingDefaultIntent()?.intentId !== intentId) {
      const current = this.#agentCatalog.freezeSelected();
      if (
        current
        && current.providerId !== ready.providerId
        && typeof saveDefault === "function"
      ) {
        await saveDefault(current.providerId);
      }
      return succeeded({ committed: false, superseded: true });
    }
    const committed = this.#agentCatalog.commitPendingDefault(intentId);
    return succeeded({
      committed: Boolean(committed),
      selection: committed,
    });
  }

  beginAccessRepair(run, field = "apiKey") {
    const target = run;
    if (!target?.requestId || target.requestId === "pending") return null;
    const context = this.#projectSession.context;
    const delivery = deliveryForRun(target);
    const allowed = ["apiKey", "login", "install", "model", "provider"];
    this.#repairIntentSeq += 1;
    this.#accessRepair = Object.freeze({
      repairIntentId: `repair-${this.#repairIntentSeq}`,
      projectId: target.projectId,
      documentId: target.documentId,
      sourcePath: target.sourcePath,
      requestId: target.requestId,
      attemptId: target.attemptId,
      sessionEpoch: Number.isSafeInteger(Number(context?.epoch)) ? Number(context.epoch) : null,
      providerId: delivery?.selection?.providerId || null,
      configurationDigest: delivery?.configuration?.configurationDigest || null,
      credentialGeneration: delivery?.configuration?.credentialGeneration ?? null,
      field: allowed.includes(field) ? field : "apiKey",
      lastOutcome: null,
    });
    this.#publishSnapshot();
    return this.#accessRepair;
  }

  clearAccessRepair(expectedIntentId) {
    if (!this.#accessRepair) return null;
    if (expectedIntentId && this.#accessRepair.repairIntentId !== expectedIntentId) {
      return this.#accessRepair;
    }
    this.#accessRepair = null;
    this.#publishSnapshot();
    return null;
  }

  async resendAfterAccessRepair() {
    const repair = this.#accessRepair;
    if (!repair) {
      return this.startAgent({ run: this.#runSession.activeRun });
    }
    const intentId = repair.repairIntentId;
    const noteOutcome = (outcome) => {
      if (this.#accessRepair?.repairIntentId !== intentId) return outcome;
      this.#accessRepair = Object.freeze({
        ...this.#accessRepair,
        lastOutcome: Object.freeze({
          status: outcome.status,
          code: outcome.code || null,
          reason: outcome.reason || "",
        }),
      });
      this.#publishSnapshot();
      return outcome;
    };
    const matchesRepairContext = () => {
      const context = this.#projectSession.context;
      return Boolean(
        context
        && repair.projectId === context.projectId
        && repair.documentId === context.documentId
        && this.#codecs.sameSourcePath(repair.sourcePath, context.sourcePath)
        && (repair.sessionEpoch == null || repair.sessionEpoch === context.epoch)
      );
    };
    if (!matchesRepairContext()) {
      return noteOutcome(rejected(
        "AGENT_REPAIR_DOCUMENT_CHANGED",
        "当前文件已变化，不会重新发送。",
      ));
    }
    const tracked = this.#runSession.runForSource(repair.sourcePath);
    if (
      tracked
      && (tracked.requestId !== repair.requestId || tracked.attemptId !== repair.attemptId)
    ) {
      this.#accessRepair = null;
      this.#publishSnapshot();
      return rejected(
        "AGENT_REPAIR_ATTEMPT_CHANGED",
        "原任务已结束，当前文件已开始新的一轮。",
      );
    }
    if (tracked && this.#runSession.hasRun(tracked)) {
      const cancelled = await this.cancel({ run: tracked, agentMayBeRunning: true });
      if (this.#accessRepair?.repairIntentId !== intentId) {
        return rejected("AGENT_REPAIR_STALE", "修复意图已被更新。");
      }
      if (!matchesRepairContext()) {
        return noteOutcome(rejected(
          "AGENT_REPAIR_DOCUMENT_CHANGED",
          "当前文件已变化，不会重新发送。",
        ));
      }
      if (cancelled.status !== "succeeded" && cancelled.status !== "stale") {
        return noteOutcome(cancelled);
      }
    }
    if (this.#accessRepair?.repairIntentId !== intentId) {
      return rejected("AGENT_REPAIR_STALE", "修复意图已被更新。");
    }
    if (!matchesRepairContext()) {
      return noteOutcome(rejected(
        "AGENT_REPAIR_DOCUMENT_CHANGED",
        "当前文件已变化，不会重新发送。",
      ));
    }
    const delivery = deliveryForRun(tracked);
    const outcome = await this.submit({
      deliveryMode: delivery?.mode || MANAGED_AGENT_MODE,
    });
    if (this.#accessRepair?.repairIntentId !== intentId) return outcome;
    if (outcome.status === "succeeded") {
      this.#accessRepair = null;
      this.#publishSnapshot();
      return outcome;
    }
    return noteOutcome(outcome);
  }

  async selectAgentModel(modelId, expectedSelection) {
    const selection = this.#agentCatalog.selectModel(modelId, expectedSelection);
    if (selection) await this.#agentCatalog.saveConfiguration();
    return selection;
  }

  async selectAgentReasoning(reasoning, expectedSelection) {
    const selection = this.#agentCatalog.selectReasoning(reasoning, expectedSelection);
    if (selection) await this.#agentCatalog.saveConfiguration();
    return selection;
  }

  applyDisabledAgentProviders(ids) {
    this.#agentCatalog.applyDisabledProviderIds(ids);
  }

  connectAgentApiKey(selection, apiKey, extras) {
    return this.#agentCatalog.connectWithApiKey(selection, apiKey, extras)
      .then((connection) => succeeded({
        availability: this.#agentCatalog.availability(selection),
        models: this.#agentCatalog.provider(selection)?.models || [],
        connection: this.#agentCatalog.provider(selection)?.connection || null,
        selection: connection?.selection || null,
        credentialPersist: this.#agentCatalog.credentialPersist(selection.providerId),
      }))
      .catch((cause) => {
        const code = errorCode(cause, "AGENT_SESSION_CREDENTIAL_INVALID");
        return rejected(
          code,
          this.#codecs.errorMessage(cause, "API Key 无效或已失效。"),
          { field: credentialErrorField(code) || "form" },
        );
      });
  }

  disconnectAgentApiKey(selection) {
    return this.#agentCatalog.disconnectApiKey(selection)
      .then(() => succeeded({
        availability: this.#agentCatalog.availability(selection),
        models: [],
      }))
      .catch((cause) => rejected(
        errorCode(cause, "AGENT_SESSION_CREDENTIAL_CLEAR_FAILED"),
        this.#codecs.errorMessage(cause, "断开连接没有完成。"),
      ));
  }

  holdAgentCredential(selection, payload) {
    return this.#agentCatalog.holdRememberedCredential(selection?.providerId, payload);
  }

  noteAgentCredentialPersist(selection, result) {
    return this.#agentCatalog.noteCredentialPersist(selection?.providerId, result);
  }

  retryAgentCredentialPersist(selection, persist) {
    return this.#agentCatalog.retryRememberedCredential(selection?.providerId, persist)
      .then((credentialPersist) => (
        credentialPersist?.status === "failed"
          ? Object.freeze({
            status: "succeeded",
            persistFailed: true,
            reason: credentialPersist.reason || "已连接，但新的 API Key 未保存。",
            value: { credentialPersist },
          })
          : succeeded({ credentialPersist })
      ))
      .catch((cause) => rejected(
        errorCode(cause, "AGENT_CREDENTIAL_RETRY_UNAVAILABLE"),
        this.#codecs.errorMessage(cause, "没有可重试保存的 API Key。"),
      ));
  }

  async stopRunsForProvider(providerId) {
    const id = String(providerId || "");
    const outcomes = [];
    for (const run of this.#runSession.runs) {
      const delivery = deliveryForRun(run);
      if (delivery?.selection?.providerId !== id) continue;
      const handoff = this.#runSession.handoffForSource(run.sourcePath);
      const running = run.status === "processing"
        || ["starting", "running", "cancelling"].includes(String(handoff?.status || ""));
      if (!running) continue;
      outcomes.push(await this.cancel({ run, agentMayBeRunning: true }));
    }
    return Object.freeze(outcomes);
  }

  async manageAgentAccess(kind, selection, {
    credentials = null,
    stopRelatedRuns = true,
  } = {}) {
    const frozen = selection;
    if (kind !== "reconnect" && stopRelatedRuns) {
      const stopped = await this.stopRunsForProvider(frozen.providerId);
      const stopFailed = stopped.find((outcome) => (
        outcome?.status === "rejected" || outcome?.status === "blocked"
      ));
      if (stopFailed) {
        return rejected(
          stopFailed.code || "RUN_CANCEL_FAILED",
          stopFailed.reason || "相关任务没有全部停止。",
          { stage: "stop-runs" },
        );
      }
    }
    if (kind === "reconnect") {
      if (typeof credentials?.restore === "function" && frozen.providerId === "pageroot") {
        await credentials.restore().catch(() => null);
      }
      return this.checkAgentUsability(frozen);
    }
    if (kind === "logout") {
      return this.startAgentLogout(frozen);
    }
    let disconnect = succeeded({ kind });
    if (frozen.providerId === "pageroot" && (kind === "disconnect" || kind === "remove-key")) {
      disconnect = await this.disconnectAgentApiKey(frozen);
      if (!["succeeded", "stale"].includes(disconnect.status)) return disconnect;
    }
    if (kind === "remove-key") {
      if (typeof credentials?.clear !== "function") {
        return rejected(
          "AGENT_CREDENTIAL_CLEAR_FAILED",
          "当前连接已处理，但未能移除已记住的 API Key。",
          { stage: "clear-credential" },
        );
      }
      try {
        const cleared = await credentials.clear();
        if (cleared?.ok === false) {
          return rejected(
            "AGENT_CREDENTIAL_CLEAR_FAILED",
            "当前连接已处理，但未能移除已记住的 API Key。",
            { stage: "clear-credential" },
          );
        }
      } catch {
        return rejected(
          "AGENT_CREDENTIAL_CLEAR_FAILED",
          "当前连接已处理，但未能移除已记住的 API Key。",
          { stage: "clear-credential" },
        );
      }
    }
    return succeeded({ kind });
  }

  #providerAccessImpact() {
    const impact = new Map();
    for (const run of this.#runSession.runs) {
      const delivery = deliveryForRun(run);
      const providerId = delivery?.selection?.providerId;
      if (!providerId) continue;
      const handoff = this.#runSession.handoffForSource(run.sourcePath);
      const running = run.status === "processing"
        || ["starting", "running", "cancelling"].includes(String(handoff?.status || ""));
      if (!running) continue;
      const current = impact.get(providerId) || { runningCount: 0, documentIds: new Set() };
      current.runningCount += 1;
      current.documentIds.add(run.documentId);
      impact.set(providerId, current);
    }
    return Object.freeze(Object.fromEntries([...impact].map(([providerId, value]) => [
      providerId,
      Object.freeze({
        runningCount: value.runningCount,
        documentCount: value.documentIds.size,
      }),
    ])));
  }

  #publishSnapshot() {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Presentation observation cannot affect run authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation observation cannot affect run authority.
      }
    }
  }
}
