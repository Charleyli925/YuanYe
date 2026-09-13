import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../lifecycle-core.mjs";
import { createAgentEventReducer, canonicalAgentEvent } from "./agent-events.mjs";
import { cleanAgentText, cleanSessionApiKey, failAgentRuntime, sessionCredentialEnvironment, AgentRuntimeError } from "./agent-errors.mjs";
import { defaultAgentLeaseStore } from "./agent-lease-store.mjs";
import {
  executionPhaseForEvent,
  publicExecutionSession,
  safePublicAgentSummary,
} from "./agent-session-projector.mjs";
import { createDefaultProviderRegistry } from "./providers/provider-registry.mjs";
import {
  agentRecoveryKindForError,
  normalizeAgentDelivery,
} from "../../shared/agent-delivery.mjs";
import {
  PAGEROOT_PROVIDER_ID,
  httpAgentLaunchBaseUrl,
  resolveOpenAiCompatibleVendor,
} from "../../shared/openai-compatible-vendors.mjs";
import {
  createAgentConfigurationSnapshot,
  publicAgentConfigurationSnapshot,
  sameAgentConfiguration,
} from "./agent-configuration-snapshot.mjs";

export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";

const PREFLIGHT_TTL_MS = 2 * 60_000;
const TERMINAL_SESSION_TTL_MS = 30 * 60_000;
const MAX_RETAINED_SESSIONS = 100;
const MAX_PREFLIGHT_TICKETS = 20;
const CANCEL_TIMEOUT_MS = 12_000;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const LIVE_STATES = new Set(["starting", "running", "cancelling"]);
const PURPOSES = new Set(["execution"]);

function validatePurpose(value, fallback = "execution") {
  const purpose = value || fallback;
  if (!PURPOSES.has(purpose)) {
    failAgentRuntime("AGENT_TICKET_PURPOSE_INVALID", "Agent 预检用途无效。", { status: 409 });
  }
  return purpose;
}

function validateTrustPolicy(value, status = 409) {
  if (value !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
    failAgentRuntime("AGENT_TRUST_POLICY_REQUIRED", "启动本机 Agent 前必须确认可信策略。", {
      status,
    });
  }
}

function canonicalSelection(value, trustPolicyVersion) {
  return normalizeAgentDelivery({
    mode: "managed-agent",
    selection: value,
    trustPolicyVersion,
  }).selection;
}

function selectionFingerprint(selection) {
  return `sha256:${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
}

function sameSelection(left, right) {
  return selectionFingerprint(left) === selectionFingerprint(right);
}

function selectionMatchesTicket(ticketSelection, submittedSelection) {
  if (!submittedSelection) return true;
  if (sameSelection(ticketSelection, submittedSelection)) return true;
  if (
    ticketSelection.providerId !== submittedSelection.providerId
    || ticketSelection.runtimeId !== submittedSelection.runtimeId
  ) return false;
  if ((submittedSelection.requestedModelId || null) !== (ticketSelection.requestedModelId || null)) {
    return false;
  }
  if (
    submittedSelection.resolvedModelId
    && submittedSelection.resolvedModelId !== ticketSelection.resolvedModelId
  ) return false;
  return (submittedSelection.reasoning?.requested || null)
    === (ticketSelection.reasoning?.requested || null);
}

function validateExecutionIdentity(value) {
  const identity = {
    projectId: cleanAgentText(value?.projectId),
    documentId: cleanAgentText(value?.documentId),
    requestId: cleanAgentText(value?.requestId),
    attemptId: cleanAgentText(value?.attemptId),
    sourcePath: typeof value?.sourcePath === "string" ? value.sourcePath : "",
  };
  if (!PROJECT_ID.test(identity.projectId) || !DOCUMENT_ID.test(identity.documentId)
    || !SAFE_ID.test(identity.requestId) || !SAFE_ID.test(identity.attemptId)
    || !path.isAbsolute(identity.sourcePath) || identity.sourcePath.includes("\0")) {
    failAgentRuntime("AGENT_TASK_IDENTITY_INVALID", "Agent 任务身份无效。", { status: 400 });
  }
  return Object.freeze(identity);
}

function executionKey(identity) {
  return [identity.projectId, identity.documentId, identity.requestId, identity.attemptId].join(":");
}

function finalizerPrompt(policy) {
  const terminalRequest = {
    command: policy.finalizer.command,
    args: [...policy.finalizer.args],
    cwd: policy.finalizer.cwd,
    env: Object.entries(policy.finalizer.env).map(([name, value]) => ({ name, value })),
  };
  return [
    "Complete this single frozen PageRoot task.",
    `Read ${policy.manifestPath} and then every file in its exact readOrder.`,
    `Follow ${policy.promptPath}.`,
    `Write one complete HTML document only to ${policy.outputPath}.`,
    "Then invoke ACP terminal/create exactly once with this JSON request:",
    JSON.stringify(terminalRequest),
    "Do not use a shell wrapper or write any other path.",
    "The result remains a Candidate pending PageRoot review and must not replace the Working Copy.",
  ].join("\n");
}

async function taskHasResidue(policy) {
  const exists = async (filePath) => lstat(filePath).then(
    () => true,
    (cause) => cause?.code !== "ENOENT",
  );
  const [output, completion] = await Promise.all([
    exists(policy.outputPath),
    exists(policy.completionPath),
  ]);
  return output || completion;
}

function timeoutAfter(milliseconds, code, message) {
  let handle;
  const promise = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(new AgentRuntimeError(code, message, { status: 503 })), milliseconds);
  });
  return { promise, clear: () => clearTimeout(handle) };
}

export class AgentRuntimeCoordinator {
  #resolveTask;
  #recordExecutionFact;
  #environment;
  #clock;
  #providerRegistry;
  #leaseStore;
  #cancelTimeoutMs;
  #terminalSessionTtlMs;
  #maxRetainedSessions;
  #tickets = new Map();
  #executionSessions = new Map();
  #pendingStarts = new Set();
  #executionStarts = new Map();
  #eventReducer;
  #ownerToken = `agent_owner_${randomUUID().replaceAll("-", "")}`;
  #acceptingStarts = true;
  #shutdownPromise = null;
  #shutdownConfirmed = false;
  #preflightCleanupUnconfirmed = false;
  #externalRedeemTicket = null;
  #sessionCredentials = new Map();
  #sessionCredentialGeneration = new Map();
  #pendingConfigurationGeneration = new Map();

  constructor({
    resolveTask,
    recordExecutionFact,
    environment = process.env,
    clock = Date,
    commandResolver,
    diagnoseRunner,
    policyLoader,
    runTask,
    preflightRunner,
    codexCommandResolver,
    codexDiagnoseRunner,
    codexPreflightRunner,
    providerRegistry,
    leaseStore = defaultAgentLeaseStore,
    cancelTimeoutMs = CANCEL_TIMEOUT_MS,
    terminalSessionTtlMs = TERMINAL_SESSION_TTL_MS,
    maxRetainedSessions = MAX_RETAINED_SESSIONS,
    redeemCommandTicket,
    agentCatalog,
    agentsRoot,
    installerOptions,
  } = {}) {
    if (resolveTask !== undefined && typeof resolveTask !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires a task authority resolver.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires a ClockPort.");
    }
    if (!leaseStore || typeof leaseStore.acquire !== "function"
      || typeof leaseStore.release !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires an AgentLeaseStore.");
    }
    for (const [value, label] of [
      [cancelTimeoutMs, "cancel timeout"],
      [terminalSessionTtlMs, "terminal-session TTL"],
      [maxRetainedSessions, "retained-session limit"],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`AgentRuntimeCoordinator ${label} must be a positive integer.`);
      }
    }
    this.#resolveTask = resolveTask || null;
    this.#recordExecutionFact = recordExecutionFact || null;
    this.#environment = environment;
    this.#clock = clock;
    this.#providerRegistry = providerRegistry || createDefaultProviderRegistry({
      commandResolver,
      ...(diagnoseRunner ? { diagnoseRunner } : {}),
      ...(policyLoader ? { policyLoader } : {}),
      ...(runTask ? { runTask } : {}),
      ...(preflightRunner ? { preflightRunner } : {}),
      ...(codexCommandResolver ? { codexCommandResolver } : {}),
      ...(codexDiagnoseRunner ? { codexDiagnoseRunner } : {}),
      ...(codexPreflightRunner ? { codexPreflightRunner } : {}),
      ...(agentCatalog ? { agentCatalog } : {}),
      ...(agentsRoot ? { agentsRoot } : {}),
      ...(installerOptions ? { installerOptions } : {}),
    });
    this.#leaseStore = leaseStore;
    this.#cancelTimeoutMs = cancelTimeoutMs;
    this.#terminalSessionTtlMs = terminalSessionTtlMs;
    this.#maxRetainedSessions = maxRetainedSessions;
    this.#eventReducer = createAgentEventReducer();
    this.#externalRedeemTicket = typeof redeemCommandTicket === "function"
      ? redeemCommandTicket
      : null;
  }

  get disposed() {
    return !this.#acceptingStarts;
  }

  providerCatalog() {
    return this.#providerRegistry.catalog();
  }

  publicProviderCatalog(options) {
    if (typeof this.#providerRegistry.publicCatalog === "function") {
      return this.#providerRegistry.publicCatalog(options);
    }
    return this.#providerRegistry.catalog();
  }

  get agentCatalog() {
    return this.#providerRegistry.agentCatalog || null;
  }

  assertSelection(selection, purpose) {
    return this.#providerRegistry.assertCapabilityForSelection(selection, validatePurpose(purpose));
  }

  #selectionForInput({ selection, trustPolicyAccepted } = {}) {
    // Current execution binds only by canonical selection. Historical
    // `mode: "qoder-acp"` records are converted at the delivery codec, not here.
    if (!selection) {
      failAgentRuntime(
        "AGENT_SELECTION_UNSUPPORTED",
        "The requested Agent provider selection is unsupported.",
        { status: 400 },
      );
    }
    return trustPolicyAccepted === undefined
      ? selection
      : canonicalSelection(selection, trustPolicyAccepted);
  }

  #assertAcceptingStarts() {
    if (!this.#acceptingStarts) {
      failAgentRuntime("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    }
  }

  #trackStart(operation) {
    this.#assertAcceptingStarts();
    const pending = Promise.resolve().then(operation);
    this.#pendingStarts.add(pending);
    void pending.finally(() => {
      this.#pendingStarts.delete(pending);
    }).catch(() => {});
    return pending;
  }

  #queueExecutionFact(entry, kind, publicSummary = null) {
    if (!this.#recordExecutionFact) return Promise.resolve();
    const event = { eventId: `event_${randomUUID().replaceAll("-", "")}`, kind,
      timestamp: nowIso(this.#clock),
      ...(kind === "public-summary" ? { publicSummary: safePublicAgentSummary(publicSummary) } : {}) };
    entry.factWrites = (entry.factWrites || Promise.resolve()).then(async () => {
      if (entry.historyFailure) return;
      try { await this.#recordExecutionFact(entry.identity, event); }
      catch (cause) {
        entry.historyFailure = cause;
        entry.controller.abort(new AgentRuntimeError("AGENT_HISTORY_WRITE_FAILED", "Execution history could not be saved."));
      }
    });
    return entry.factWrites;
  }

  #touch(entry) {
    entry.updatedAtMs = this.#clock.now();
    entry.updatedAt = nowIso(this.#clock);
  }

  #prune() {
    const now = this.#clock.now();
    for (const [ticketId, ticket] of this.#tickets) {
      if (ticket.expiresAt <= now) this.#tickets.delete(ticketId);
    }
    const terminal = [...this.#executionSessions.entries()]
      .filter(([, entry]) => !LIVE_STATES.has(entry.state) && entry.keepLease !== true)
      .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs);
    for (const [key, entry] of terminal) {
      if (this.#executionSessions.size <= this.#maxRetainedSessions
        && entry.updatedAtMs + this.#terminalSessionTtlMs > now) break;
      this.#executionSessions.delete(key);
      this.#eventReducer.clear(entry.turnId);
    }
  }

  #environmentForProvider(providerId) {
    if (providerId !== PAGEROOT_PROVIDER_ID) return this.#environment;
    const credential = this.#sessionCredentials.get(PAGEROOT_PROVIDER_ID);
    if (!credential) return this.#environment;
    return Object.freeze({
      ...this.#environment,
      ...sessionCredentialEnvironment({
        ...credential,
        baseUrl: httpAgentLaunchBaseUrl(this.#environment, credential.baseUrl),
      }),
    });
  }

  async updateAgentConfiguration(providerId, candidate = {}) {
    const id = cleanAgentText(providerId, 32);
    if (id !== PAGEROOT_PROVIDER_ID) {
      failAgentRuntime(
        "AGENT_SESSION_CREDENTIAL_UNSUPPORTED",
        "当前 Agent 不支持 API Token。",
        { status: 409 },
      );
    }
    const currentCredential = this.#sessionCredentials.get(id) || null;
    const key = cleanSessionApiKey(candidate.apiKey || currentCredential?.apiKey);
    const vendor = resolveOpenAiCompatibleVendor(
      candidate?.vendorId || currentCredential?.vendorId,
      candidate?.baseUrl || currentCredential?.baseUrl,
    );
    if (!key || !vendor) {
      failAgentRuntime(
        "AGENT_SESSION_CREDENTIAL_INVALID",
        "API Token 无效。",
        { status: 400 },
      );
    }
    const generation = (this.#sessionCredentialGeneration.get(id) || 0) + 1;
    this.#sessionCredentialGeneration.set(id, generation);
    this.#pendingConfigurationGeneration.set(id, generation);
    try {
      if (currentCredential) {
        // Preserve the last usable Token/vendor while rebasing its generation.
        // This invalidates every already-issued configuration snapshot even when
        // the candidate validation below fails.
        this.#sessionCredentials.set(id, Object.freeze({
          ...currentCredential,
          credentialGeneration: generation,
        }));
      }
      for (const [ticketId, ticket] of this.#tickets) {
        if (ticket.providerId === id) this.#tickets.delete(ticketId);
      }
      const nextCredential = Object.freeze({
        apiKey: key,
        vendorId: vendor.id,
        baseUrl: vendor.baseUrl,
        credentialGeneration: generation,
      });
      const requestedSelection = canonicalSelection(candidate.selection || {
        providerId: PAGEROOT_PROVIDER_ID,
        runtimeId: "http",
        requestedModelId: null,
        resolvedModelId: null,
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      }, TRUSTED_LOCAL_AGENT_POLICY_VERSION);
      if (requestedSelection.providerId !== id || requestedSelection.runtimeId !== "http") {
        failAgentRuntime("AGENT_SELECTION_UNSUPPORTED", "Token 与当前 Agent 选择不匹配。", { status: 409 });
      }
      const candidateEnvironment = Object.freeze({
        ...this.#environment,
        ...sessionCredentialEnvironment({
          ...nextCredential,
          baseUrl: httpAgentLaunchBaseUrl(this.#environment, nextCredential.baseUrl),
        }),
      });
      // Validate against a candidate environment before replacing the current
      // in-memory credential. A failed Token/vendor switch leaves the old usable
      // connection intact; its old one-use tickets stay invalidated and require
      // a fresh preflight before the next Request.
      const prepared = await this.#providerRegistry.preflightForSelection(
        requestedSelection,
        "execution",
        { environment: candidateEnvironment },
      );
      this.#assertAcceptingStarts();
      if (this.#pendingConfigurationGeneration.get(id) !== generation
        || this.#sessionCredentialGeneration.get(id) !== generation) {
        failAgentRuntime(
          "AGENT_SESSION_CREDENTIAL_STALE",
          "更新的连接操作已取代本次结果。",
          { status: 409 },
        );
      }
      this.#sessionCredentials.set(id, nextCredential);
      this.#pendingConfigurationGeneration.delete(id);
      for (const [ticketId, ticket] of this.#tickets) {
        if (ticket.providerId === id) this.#tickets.delete(ticketId);
      }
      return Object.freeze({
        ok: true,
        status: "ready",
        providerId: id,
        vendorId: vendor.id,
        vendorDisplayName: vendor.displayName,
        baseUrl: vendor.baseUrl,
        configured: true,
        modelCount: prepared.evidence.modelCount,
        models: prepared.evidence.models ?? [],
        selection: prepared.selection,
        configuration: publicAgentConfigurationSnapshot(prepared.configuration),
      });
    } catch (cause) {
      if (this.#pendingConfigurationGeneration.get(id) === generation) {
        this.#pendingConfigurationGeneration.delete(id);
      }
      throw cause;
    }
  }

  cancelAgentConfiguration(providerId, generation) {
    const id = cleanAgentText(providerId, 32);
    const expected = Number(generation);
    if (!Number.isSafeInteger(expected) || expected < 1
      || this.#pendingConfigurationGeneration.get(id) !== expected) {
      return Object.freeze({
        ok: true,
        cancelled: false,
        configured: this.#sessionCredentials.has(id),
      });
    }
    this.#pendingConfigurationGeneration.delete(id);
    this.#sessionCredentialGeneration.set(id, expected + 1);
    return Object.freeze({
      ok: true,
      cancelled: true,
      configured: this.#sessionCredentials.has(id),
    });
  }

  setSessionCredential(providerId, apiKey, extras = {}) {
    return this.updateAgentConfiguration(providerId, { ...extras, apiKey });
  }

  clearSessionCredential(providerId) {
    const id = cleanAgentText(providerId, 32);
    this.#sessionCredentialGeneration.set(
      id,
      (this.#sessionCredentialGeneration.get(id) || 0) + 1,
    );
    this.#sessionCredentials.delete(id);
    for (const [ticketId, ticket] of this.#tickets) {
      if (ticket.providerId === id) this.#tickets.delete(ticketId);
    }
    return Object.freeze({
      ok: true,
      providerId: id,
      configured: false,
    });
  }

  sessionCredentialConfigured(providerId) {
    return this.#sessionCredentials.has(cleanAgentText(providerId, 32));
  }

  async availability({ selection } = {}) {
    const requestedSelection = this.#selectionForInput({ selection });
    if (!this.#acceptingStarts) {
      return Object.freeze({
        ok: true,
        status: "unavailable",
        reason: "check-failed",
      });
    }
    const result = await this.#providerRegistry.availabilityForSelection(requestedSelection, {
      environment: this.#environmentForProvider(requestedSelection.providerId),
    });
    return Object.freeze({
      ok: true,
      ...result,
    });
  }

  async diagnose({ selection } = {}) {
    const diagnosticId = `diagnostic_${randomUUID()}`;
    const requestedSelection = this.#selectionForInput({ selection });
    const checkedAt = nowIso(this.#clock);
    if (!this.#acceptingStarts) {
      return Object.freeze({
        ok: true,
        diagnostic: Object.freeze({
          readiness: "connection-failed",
          cause: "AGENT_BRIDGE_DISPOSED",
          operation: "diagnose",
          checkedAt,
          activeInstallation: null,
        }),
      });
    }
    const result = typeof this.#providerRegistry.diagnoseForSelection === "function"
      ? await this.#providerRegistry.diagnoseForSelection(requestedSelection, {
        environment: this.#environmentForProvider(requestedSelection.providerId),
        checkedAt,
      })
      : await this.#providerRegistry.availabilityForSelection(requestedSelection, {
        environment: this.#environmentForProvider(requestedSelection.providerId),
      });
    const diagnostic = result.diagnostic || Object.freeze({
      readiness: result.status === "ready" ? "ready" : "connection-failed",
      cause: result.reason || (result.status === "ready" ? null : "connection-failed"),
      operation: "diagnose",
      checkedAt,
      activeInstallation: null,
    });
    return Object.freeze({
      ok: true,
      ...result,
      diagnostic: Object.freeze({ ...diagnostic, diagnosticId, checkedAt, operation: "diagnose" }),
    });
  }

  preflight(input = {}) {
    return this.#trackStart(() => this.#performPreflight(input));
  }

  async #performPreflight({ selection, trustPolicyAccepted, purpose = "execution" } = {}) {
    const ticketPurpose = validatePurpose(purpose);
    const requestedSelection = this.#selectionForInput({
      selection,
      trustPolicyAccepted,
    });
    if (this.#preflightCleanupUnconfirmed) {
      failAgentRuntime(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        this.#providerRegistry.preflightFailureMessageForSelection(
          requestedSelection,
          "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        ),
        { status: 503 },
      );
    }
    this.#providerRegistry.resolveSelection(requestedSelection);
    validateTrustPolicy(trustPolicyAccepted);
    this.#prune();
    let prepared;
    try {
      prepared = await this.#providerRegistry.preflightForSelection(
        requestedSelection,
        ticketPurpose,
        { environment: this.#environmentForProvider(requestedSelection.providerId) },
      );
    } catch (cause) {
      if (cause?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED") {
        this.#preflightCleanupUnconfirmed = true;
      }
      throw cause;
    }
    this.#assertAcceptingStarts();
    if (requestedSelection.providerId !== prepared.providerId
      || requestedSelection.runtimeId !== prepared.runtimeId) {
      failAgentRuntime(
        "AGENT_SELECTION_UNSUPPORTED",
        "The selected Agent provider is unsupported.",
        { status: 409 },
      );
    }
    const resolvedSelection = prepared.selection;
    const configuration = prepared.configuration || createAgentConfigurationSnapshot({
      providerId: prepared.providerId,
      runtimeId: prepared.runtimeId,
      installation: prepared.installation,
      installationDigest: prepared.installationDigest,
      selection: resolvedSelection,
      capabilityRevision: prepared.evidence?.capabilityRevision || prepared.evidence?.version,
    });
    const fingerprint = selectionFingerprint(resolvedSelection);
    const preflightId = `preflight_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.#clock.now();
    while (this.#tickets.size >= MAX_PREFLIGHT_TICKETS) {
      this.#tickets.delete(this.#tickets.keys().next().value);
    }
    this.#tickets.set(preflightId, Object.freeze({
      preflightId,
      purpose: ticketPurpose,
      providerId: prepared.providerId,
      runtimeId: prepared.runtimeId,
      securityProfile: prepared.securityProfile,
      installation: prepared.installation,
      installationDigest: prepared.installationDigest,
      configuration,
      capabilities: prepared.capabilities,
      evidence: prepared.evidence,
      selection: resolvedSelection,
      selectionFingerprint: fingerprint,
      createdAt,
      expiresAt: createdAt + PREFLIGHT_TTL_MS,
    }));
    return Object.freeze({
      ok: true,
      status: "ready",
      preflightId,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      agentVersion: prepared.evidence.version,
      modelCount: prepared.evidence.modelCount,
      models: prepared.evidence.models ?? [],
      selection: resolvedSelection,
      configuration: publicAgentConfigurationSnapshot(configuration),
      selectionFingerprint: fingerprint,
      expiresAt: new Date(createdAt + PREFLIGHT_TTL_MS).toISOString(),
    });
  }

  async redeemCommandTicket(preflightId, { purpose = "execution", selection } = {}) {
    this.#assertAcceptingStarts();
    const expectedPurpose = validatePurpose(purpose);
    if (this.#externalRedeemTicket && this.#tickets.size === 0) {
      const ticket = await this.#externalRedeemTicket(preflightId, {
        purpose: expectedPurpose,
        selection,
      });
      return Object.freeze({ ...ticket, purpose: ticket.purpose || expectedPurpose });
    }
    const ticket = this.#tickets.get(preflightId);
    if (!ticket || ticket.expiresAt <= this.#clock.now()) {
      this.#tickets.delete(preflightId);
      failAgentRuntime("AGENT_PREFLIGHT_EXPIRED", "Agent 预检已过期，请重新确认后启动。", { status: 409 });
    }
    // Consume before every verification. A drifted, cross-provider or
    // cross-purpose ticket is never replayable after the failed attempt.
    this.#tickets.delete(preflightId);
    const requestedSelection = selection
      ? this.#selectionForInput({ selection })
      : null;
    if (ticket.purpose !== expectedPurpose) {
      failAgentRuntime("AGENT_PREFLIGHT_PURPOSE_MISMATCH", "Agent 预检与本次操作不匹配，请重新检查。", {
        status: 409,
      });
    }
    if (requestedSelection && !selectionMatchesTicket(ticket.selection, requestedSelection)) {
      failAgentRuntime(
        "AGENT_PROVIDER_TICKET_INVALID",
        "Agent selection does not match its preflight ticket.",
        { status: 409 },
      );
    }
    const verified = await this.#providerRegistry.verifyTicket(ticket, {
      purpose: expectedPurpose,
      environment: this.#environmentForProvider(ticket.providerId),
    });
    if (verified.providerId !== ticket.providerId || verified.runtimeId !== ticket.runtimeId
      || verified.securityProfile !== ticket.securityProfile) {
      failAgentRuntime("AGENT_PROVIDER_TICKET_INVALID", "Agent provider ticket binding is invalid.", {
        status: 409,
      });
    }
    return verified;
  }

  #observe(entry, rawEvent, phaseForEvent, textField) {
    if (
      rawEvent?.turnId
      && String(rawEvent.turnId) !== entry.turnId
    ) return;
    const nextSequence = entry.nextSequence + 1;
    const canonical = canonicalAgentEvent({
      ...rawEvent,
      turnId: entry.turnId,
      sequence: nextSequence,
      timestamp: this.#clock.now(),
    }, {
      turnId: entry.turnId,
      sequence: nextSequence,
      timestamp: this.#clock.now(),
    });
    // Runtime callbacks can outlive their turn. A late event must not advance
    // the entry sequence or mutate this Request's public session projection.
    if (!canonical || canonical.turnId !== entry.turnId) return;
    entry.nextSequence = nextSequence;
    // A Provider can flush buffered narration while cancellation is in flight.
    // It must never make a cancelled Request look active again.
    if (
      canonical?.kind === "visible-text"
      && (entry.cancelState || ["cancelling", "cancelled"].includes(entry.state))
    ) return;
    if (
      canonical?.kind === "activity"
      && (entry.cancelState || ["cancelling", "cancelled"].includes(entry.state))
    ) return;
    const reduced = this.#eventReducer.accept(canonical);
    if (!reduced.accepted) return;
    entry.eventCount = reduced.projection.eventCount;
    if (LIVE_STATES.has(entry.state)) {
      const previousPhase = entry.phase;
      entry.phase = phaseForEvent(reduced.event, entry.phase);
      if (entry.phase !== "cancelling" && entry.phase !== previousPhase) {
        void this.#queueExecutionFact(entry, entry.phase);
      }
    }
    if (textField) {
      entry[textField] = reduced.projection.visibleText;
      if (textField === "replyText") entry.replyTruncated = reduced.projection.textTruncated;
      if (textField === "visibleText") {
        entry.visibleTextUpdates = reduced.projection.visibleTextUpdates;
        entry.textTruncated = reduced.projection.textTruncated;
      }
    }
    if (reduced.event.kind === "initialized") {
      if (["starting", "running"].includes(entry.state)) entry.state = "running";
      entry.agentName = cleanAgentText(reduced.event.agentName) || "Local Agent";
      entry.agentVersion = cleanAgentText(reduced.event.agentVersion) || entry.agentVersion;
    }
    if (reduced.event.kind === "completion-verified") {
      // This fact is emitted only after the restricted Host has re-read the
      // Candidate and completion record and verified their task identity and
      // output hash. A later transport teardown error cannot revoke that
      // already-established Candidate authority.
      entry.completionVerified = true;
    }
    if (reduced.event.kind === "activity") {
      entry.lastActivityAt = nowIso(this.#clock);
      if (reduced.event.channel === "html"
        && Number.isSafeInteger(reduced.event.byteDelta)
        && reduced.event.byteDelta > 0) {
        entry.receivedBytes = Math.min(
          Number.MAX_SAFE_INTEGER,
          entry.receivedBytes + reduced.event.byteDelta,
        );
      }
    }
    this.#touch(entry);
  }

  async #releaseLease(entry) {
    if (!entry.lease || entry.keepLease) return !entry.keepLease;
    let released = false;
    try {
      released = await this.#leaseStore.release(entry.lease);
    } catch {
      released = false;
    }
    if (released !== true) {
      entry.keepLease = true;
      entry.retryable = false;
      entry.safeToRetry = false;
      entry.recoveryKind = "end";
      entry.errorCode = "AGENT_RESTART_RECOVERY_REQUIRED";
      entry.errorMessage = this.#providerRegistry.failureMessageForSelection(
        entry.selection,
        "AGENT_RESTART_RECOVERY_REQUIRED",
      );
      this.#touch(entry);
      return false;
    }
    entry.lease = null;
    entry.cancelState = entry.cancelState === "provider-acknowledged"
      ? "termination-confirmed"
      : entry.cancelState;
    return true;
  }

  submit(input = {}) {
    const key = executionKey(validateExecutionIdentity(input));
    const existing = this.#executionStarts.get(key);
    if (existing) return existing.promise;
    const pending = { cancelRequested: false, promise: null };
    pending.promise = this.#trackStart(() => this.#performSubmit(input, pending));
    this.#executionStarts.set(key, pending);
    void pending.promise.finally(() => {
      if (!pending.cleanupUnconfirmed && this.#executionStarts.get(key) === pending) this.#executionStarts.delete(key);
    }).catch(() => {});
    return pending.promise;
  }

  async #performSubmit({
    selection,
    trustPolicyAccepted,
    preflightId,
    configurationDigest,
    ...identityInput
  } = {}, pending) {
    this.#assertAcceptingStarts();
    validateTrustPolicy(trustPolicyAccepted);
    const requestedSelection = this.#selectionForInput({
      selection,
      trustPolicyAccepted,
    });
    this.#providerRegistry.resolveSelection(requestedSelection);
    const identity = validateExecutionIdentity(identityInput);
    this.#prune();
    const key = executionKey(identity);
    const existing = this.#executionSessions.get(key);
    if (existing && ["starting", "running", "cancelling", "completed"].includes(existing.state)) {
      return {
        ok: true,
        accepted: false,
        idempotent: true,
        session: publicExecutionSession(existing),
      };
    }
    if (existing && existing.retryable !== true) {
      failAgentRuntime(
        existing.errorCode || "AGENT_RETRY_BLOCKED",
        existing.errorMessage || "本轮 Agent 会话不能安全重试。请结束本轮后重新发送。",
        { status: 409 },
      );
    }
    const ticket = await this.redeemCommandTicket(preflightId, {
      purpose: "execution",
      selection: requestedSelection,
    });
    if (ticket.configuration?.configurationDigest !== String(configurationDigest || "")) {
      failAgentRuntime(
        "AGENT_CONFIGURATION_CHANGED",
        "Agent configuration does not match its preflight ticket.",
        { status: 409 },
      );
    }
    if (!this.#resolveTask) throw new TypeError("Execution authority is not configured.");
    const task = await this.#resolveTask(identity);
    this.#assertAcceptingStarts();
    if (!task?.run || task.run.status !== "processing") {
      failAgentRuntime("AGENT_TASK_NOT_PROCESSING", "当前 Request 已不再等待 Agent 处理。", { status: 409 });
    }
    if (task.run.projectId !== identity.projectId || task.run.documentId !== identity.documentId
      || task.run.requestId !== identity.requestId || task.run.attemptId !== identity.attemptId
      || task.run.sourcePath !== identity.sourcePath) {
      failAgentRuntime("AGENT_TASK_IDENTITY_MISMATCH", "Request authority 与 Agent 任务身份不一致。", {
        status: 409,
      });
    }
    let delivery;
    try {
      delivery = normalizeAgentDelivery(task.request?.request?.agentDelivery);
    } catch {
      delivery = null;
    }
    if (delivery?.mode !== "managed-agent"
      || delivery.selection.providerId !== ticket.providerId
      || delivery.selection.runtimeId !== ticket.runtimeId
      || !selectionMatchesTicket(ticket.selection, delivery.selection)
      || !sameAgentConfiguration(delivery.configuration, ticket.configuration)
      || delivery.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
      failAgentRuntime("AGENT_DELIVERY_NOT_AUTHORIZED", "本轮 Request 没有授权所选 Agent 自动执行。", {
        status: 409,
      });
    }
    let policy;
    try {
      policy = await this.#providerRegistry.loadExecutionPolicy(ticket, {
        requestPath: task.run.requestPath,
        promptPath: task.run.promptPath,
        outputPath: task.run.outputPath,
        completionPath: task.run.completionPath,
      });
    } catch (cause) {
      const code = cleanAgentText(cause?.code, 120) || "AGENT_TASK_POLICY_INVALID";
      if (code === "AGENT_OUTPUT_PREEXISTS" || code === "AGENT_COMPLETION_PREEXISTS") {
        failAgentRuntime("AGENT_RETRY_OUTPUT_PRESENT", this.#providerRegistry.failureMessage(
          ticket,
          "AGENT_RETRY_OUTPUT_PRESENT",
        ), { status: 409 });
      }
      failAgentRuntime("AGENT_TASK_POLICY_INVALID", "本轮冻结资料或运行权限不再满足 Agent 启动条件。", {
        status: 409,
        details: { reasonCode: code },
      });
    }
    this.#assertAcceptingStarts();
    const lease = existing?.lease || await this.#leaseStore.acquire({
      providerId: ticket.providerId,
      runtimeId: ticket.runtimeId,
      purpose: "execution",
      projectId: identity.projectId,
      documentId: identity.documentId,
      requestId: identity.requestId,
      attemptId: identity.attemptId,
      requestPath: task.run.requestPath,
      ownerToken: this.#ownerToken,
      clock: this.#clock,
    });
    const executionEnvironment = this.#environmentForProvider(ticket.providerId);
    try {
      await this.#providerRegistry.verifyTicket(ticket, {
        purpose: "execution",
        environment: executionEnvironment,
      });
      if (ticket.providerId === PAGEROOT_PROVIDER_ID) {
        const currentGeneration = Number(
          this.#environmentForProvider(ticket.providerId).PAGEROOT_API_CREDENTIAL_GENERATION || 0,
        );
        if (currentGeneration !== ticket.configuration?.credentialGeneration) {
          failAgentRuntime(
            "AGENT_CONFIGURATION_CHANGED",
            "Agent configuration changed before runtime launch.",
            { status: 409 },
          );
        }
      }
    } catch (cause) {
      if (!existing?.lease && await this.#leaseStore.release(lease).catch(() => false) !== true) {
        pending.cleanupUnconfirmed = true;
        this.#preflightCleanupUnconfirmed = true;
        failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "启动失败后清理未确认。", { status: 503 });
      }
      throw cause;
    }
    if (!this.#acceptingStarts) {
      const released = await this.#leaseStore.release(lease).catch(() => false);
      if (released !== true) this.#preflightCleanupUnconfirmed = true;
      this.#assertAcceptingStarts();
    }
    const controller = new AbortController();
    const entry = {
      purpose: "execution",
      selection: ticket.selection,
      providerId: ticket.providerId,
      runtimeId: ticket.runtimeId,
      turnId: identity.requestId,
      nextSequence: -1,
      identity,
      state: "starting",
      phase: "launching",
      startedAt: nowIso(this.#clock),
      lastActivityAt: nowIso(this.#clock),
      updatedAt: nowIso(this.#clock),
      updatedAtMs: this.#clock.now(),
      agentName: null,
      agentVersion: ticket.evidence.version,
      eventCount: 0,
      receivedBytes: 0,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      safeToRetry: false,
      recoveryKind: "end",
      lease,
      keepLease: false,
      cancelState: null,
      controller,
      promise: null,
      visibleText: "",
      visibleTextUpdates: [],
      textTruncated: false,
      completionVerified: false,
    };
    try {
      await this.#recordExecutionFact?.(identity, {
        eventId: `event_${randomUUID().replaceAll("-", "")}`, kind: "started", timestamp: entry.startedAt,
      });
    } catch (cause) {
      if (await this.#leaseStore.release(lease).catch(() => false) !== true) {
        pending.cleanupUnconfirmed = true;
        this.#preflightCleanupUnconfirmed = true;
        failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "启动失败后清理未确认。", { status: 503 });
      }
      throw cause;
    }
    if (pending.cancelRequested) {
      const released = await this.#leaseStore.release(lease).catch(() => false);
      if (released !== true) {
        pending.cleanupUnconfirmed = true;
        this.#preflightCleanupUnconfirmed = true;
        failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "启动取消后清理未确认。", { status: 503 });
      }
      failAgentRuntime("AGENT_CANCELLED", "Agent 启动已取消。", { status: 409 });
    }
    this.#executionSessions.set(key, entry);
    const pendingEvents = [];
    let projectionActive = false;
    const publishEvent = (event) => {
      if (this.#executionSessions.get(key) === entry) {
        this.#observe(entry, event, executionPhaseForEvent, "visibleText");
      }
    };
    const observe = (event) => {
      if (projectionActive) publishEvent(event);
      else pendingEvents.push(event);
    };
    // Invoke the runtime before returning from submit so its cancellation
    // listener is installed before shutdown can win the next microtask.
    const runtimePromise = this.#providerRegistry.run(ticket, {
      policy,
      prompt: finalizerPrompt(policy),
      baseEnvironment: executionEnvironment,
      cancellationSignal: controller.signal,
      onEvent: observe,
    });
    setImmediate(() => {
      projectionActive = true;
      for (const event of pendingEvents.splice(0)) publishEvent(event);
    });
    entry.promise = Promise.resolve(runtimePromise).then(async () => {
      if (this.#executionSessions.get(key) !== entry) return;
      // Flush events emitted synchronously by a short-lived runtime before its
      // terminal fact. The scheduled flush sees the same emptied queue.
      projectionActive = true;
      for (const event of pendingEvents.splice(0)) publishEvent(event);
      await entry.factWrites;
      if (entry.historyFailure) throw entry.historyFailure;
      if (controller.signal.aborted) {
        entry.state = "cancelled";
        entry.phase = "cancelled";
      } else {
        entry.state = "completed";
        entry.phase = "preparing-review";
      }
      entry.retryable = false;
      entry.safeToRetry = false;
      entry.recoveryKind = "end";
      if (entry.cancelState === "requested") entry.cancelState = "provider-acknowledged";
      this.#touch(entry);
    }).catch(async (cause) => {
      if (this.#executionSessions.get(key) !== entry) return;
      // A short-lived runtime can emit its verified terminal fact and reject
      // during teardown before the scheduled projection flush runs. Classify
      // only after those already-emitted facts are visible to the coordinator.
      projectionActive = true;
      for (const event of pendingEvents.splice(0)) publishEvent(event);
      await entry.factWrites;
      const cleanupUnconfirmed = cause?.code === "AGENT_PROCESS_CLEANUP_UNCONFIRMED";
      const completedBeforeTeardownFailure = entry.completionVerified === true
        && !controller.signal.aborted
        && !entry.historyFailure;
      if (completedBeforeTeardownFailure) {
        entry.state = "completed";
        entry.phase = "preparing-review";
        entry.errorCode = null;
        entry.errorMessage = null;
        entry.safeToRetry = false;
        entry.retryable = false;
        entry.recoveryKind = "end";
        // Keep the global process fence when ACP teardown is uncertain, while
        // preserving the independently verified Candidate as a successful
        // result for Review.
        entry.keepLease = cleanupUnconfirmed;
      } else {
        const residue = await taskHasResidue(policy);
        // Process ownership outranks output residue. The latter is expected
        // after a finalizer attempt and must not hide an uncertain teardown.
        const code = cleanupUnconfirmed
          ? "AGENT_RESTART_RECOVERY_REQUIRED"
          : residue
            ? "AGENT_RETRY_OUTPUT_PRESENT"
            : this.#providerRegistry.classifyRunFailure(ticket, cause);
        entry.state = controller.signal.aborted ? "cancelled" : "failed";
        entry.phase = controller.signal.aborted ? "cancelled" : "failed";
        entry.errorCode = code;
        entry.errorMessage = this.#providerRegistry.failureMessage(ticket, code);
        entry.safeToRetry = !controller.signal.aborted && !residue && !cleanupUnconfirmed;
        entry.retryable = entry.safeToRetry;
        entry.recoveryKind = agentRecoveryKindForError(code, {
          safeToRetry: entry.safeToRetry,
        });
        entry.keepLease = cleanupUnconfirmed;
      }
      if (entry.cancelState === "requested") entry.cancelState = "provider-acknowledged";
      this.#touch(entry);
    }).finally(async () => {
      const summary = safePublicAgentSummary(entry.visibleText);
      if (summary) await this.#queueExecutionFact(entry, "public-summary", summary);
      await this.#queueExecutionFact(entry, entry.state === "failed" ? "failed" : "execution-ended");
      if (entry.historyFailure) {
        entry.state = "interrupted";
        entry.phase = "interrupted";
        entry.errorCode = "AGENT_HISTORY_WRITE_FAILED";
        entry.errorMessage = "执行记录未能完整保存，请核对本轮结果。";
        entry.retryable = false;
        entry.safeToRetry = false;
      }
      await this.#releaseLease(entry);
    });
    void entry.promise.catch(() => {});
    return { ok: true, accepted: true, idempotent: false, session: publicExecutionSession(entry) };
  }

  executionStatus(identityInput) {
    const identity = validateExecutionIdentity(identityInput);
    this.#prune();
    const entry = this.#executionSessions.get(executionKey(identity));
    return publicExecutionSession(entry);
  }

  interrupted(identityInput, { selection } = {}) {
    validateExecutionIdentity(identityInput);
    const requestedSelection = this.#selectionForInput({ selection });
    let errorMessage;
    try {
      errorMessage = this.#providerRegistry.failureMessageForSelection(
        requestedSelection,
        "AGENT_RESTART_RECOVERY_REQUIRED",
      );
    } catch (cause) {
      if (!["AGENT_PROVIDER_UNSUPPORTED", "AGENT_SELECTION_UNSUPPORTED"].includes(cause?.code)) {
        throw cause;
      }
      errorMessage = "当前版本无法恢复此 Agent 会话。请结束本轮后重新发送。";
    }
    const timestamp = nowIso(this.#clock);
    return Object.freeze({
      providerId: requestedSelection.providerId,
      runtimeId: requestedSelection.runtimeId,
      state: "interrupted",
      phase: "interrupted",
      startedAt: null,
      lastActivityAt: null,
      updatedAt: timestamp,
      agentName: null,
      agentVersion: null,
      eventCount: 0,
      receivedBytes: 0,
      visibleText: "",
      visibleTextUpdates: [],
      textTruncated: false,
      retryable: false,
      safeToRetry: false,
      recoveryKind: "end",
      errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
      errorMessage,
    });
  }

  async cancelExecution(identityInput) {
    const identity = validateExecutionIdentity(identityInput);
    const pending = this.#executionStarts.get(executionKey(identity));
    if (pending) {
      pending.cancelRequested = true;
      const timeout = timeoutAfter(this.#cancelTimeoutMs, "AGENT_CANCEL_UNCONFIRMED", "Agent 启动尚未确认停止。");
      try {
        await Promise.race([pending.promise.catch((cause) => {
          if (cause?.code === "AGENT_CANCEL_UNCONFIRMED") throw cause;
        }), timeout.promise]);
      } finally { timeout.clear(); }
    }
    const entry = this.#executionSessions.get(executionKey(identity));
    if (!entry || !LIVE_STATES.has(entry.state)) {
      return { ok: true, stopped: false, session: publicExecutionSession(entry) };
    }
    entry.cancelState = "requested";
    entry.state = "cancelling";
    entry.phase = "cancelling";
    this.#touch(entry);
    await this.#queueExecutionFact(entry, "stop-requested");
    entry.controller.abort(new AgentRuntimeError("AGENT_CANCELLED", "Cancelled by PageRoot."));
    const timeout = timeoutAfter(
      this.#cancelTimeoutMs,
      "AGENT_CANCEL_UNCONFIRMED",
      "Agent 进程没有在限定时间内确认停止。",
    );
    try {
      await Promise.race([entry.promise, timeout.promise]);
    } finally {
      timeout.clear();
    }
    if (entry.keepLease === true || entry.lease) {
      failAgentRuntime(
        "AGENT_CANCEL_UNCONFIRMED",
        "Agent 进程停止未被确认。本轮 Request 仍保持处理中，不会解锁或覆盖它。",
        { status: 503 },
      );
    }
    entry.cancelState = "termination-confirmed";
    await this.#queueExecutionFact(entry, "stop-confirmed");
    return { ok: true, stopped: true, session: publicExecutionSession(entry) };
  }

  async cancelDurableExecution({ identity, cancelRequest } = {}) {
    if (typeof cancelRequest !== "function") {
      throw new TypeError("AgentRuntimeCoordinator durable cancellation dependency is invalid.");
    }
    await this.cancelExecution(identity);
    const entry = this.#executionSessions.get(executionKey(validateExecutionIdentity(identity)));
    if (entry?.keepLease || entry?.lease) {
      failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "Agent 清理未确认，不能持久化取消。", { status: 503 });
    }
    const cancelled = await cancelRequest();
    if (entry) entry.cancelState = "durable-cancelled";
    return cancelled;
  }

  async shutdown() {
    if (this.#shutdownConfirmed) return;
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#acceptingStarts = false;
    this.#tickets.clear();
    this.#sessionCredentials.clear();
    this.#sessionCredentialGeneration.clear();
    this.#pendingConfigurationGeneration.clear();
    this.#shutdownPromise = (async () => {
      const startTimeout = timeoutAfter(
        this.#cancelTimeoutMs,
        "AGENT_SHUTDOWN_UNCONFIRMED",
        "无法确认 Agent 启动操作已停止；为避免失去控制，本次退出已取消。",
      );
      try {
        await Promise.race([
          Promise.allSettled([...this.#pendingStarts]),
          startTimeout.promise,
        ]);
      } catch {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 启动操作已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      } finally {
        startTimeout.clear();
      }
      const entries = [...this.#executionSessions.values()];
      for (const entry of entries) {
        if (LIVE_STATES.has(entry.state)) {
          entry.cancelState = "requested";
          entry.controller.abort(new AgentRuntimeError("AGENT_CANCELLED", "Bridge shutdown."));
        }
      }
      const timeout = timeoutAfter(
        this.#cancelTimeoutMs,
        "AGENT_SHUTDOWN_UNCONFIRMED",
        "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
      );
      try {
        await Promise.race([
          Promise.allSettled(entries.map((entry) => entry.promise).filter(Boolean)),
          timeout.promise,
        ]);
      } catch {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      } finally {
        timeout.clear();
      }
      const unconfirmed = entries.some((entry) => LIVE_STATES.has(entry.state)
        || entry.keepLease === true || entry.lease) || this.#preflightCleanupUnconfirmed;
      if (unconfirmed) {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      }
      const catalog = this.#providerRegistry.agentCatalog;
      if (catalog && typeof catalog.drain === "function") {
        const drained = await catalog.drain({ timeoutMs: this.#cancelTimeoutMs }).catch(() => false);
        if (drained !== true) {
          failAgentRuntime(
            "AGENT_INSTALL_DRAIN_UNCONFIRMED",
            "无法确认 Agent 安装或登录已停止；为避免失去控制，本次退出已取消。",
            { status: 503 },
          );
        }
      }
      this.#shutdownConfirmed = true;
    })();
    try {
      await this.#shutdownPromise;
    } finally {
      this.#shutdownPromise = null;
    }
  }

  dispose() {
    return this.shutdown();
  }
}
