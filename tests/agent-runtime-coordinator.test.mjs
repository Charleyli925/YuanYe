import assert from "node:assert/strict";
import test from "node:test";

import { createAgentEventReducer } from "../bridge/agent/agent-events.mjs";
import {
  executionPhaseForEvent,
  createPublicAgentTextAccumulator,
  safePublicAgentText,
} from "../bridge/agent/agent-session-projector.mjs";
import {
  AgentRuntimeCoordinator,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../bridge/agent/agent-runtime-coordinator.mjs";

function projectPublicText(events) {
  const accumulator = createPublicAgentTextAccumulator();
  for (const event of events) accumulator.append(event);
  return accumulator.snapshot().visibleTextUpdates;
}

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_runtime_contract",
  attemptId: "attempt_001",
  sourcePath: "/tmp/runtime-contract.html",
});
const CONFIGURATION = Object.freeze({
  schemaVersion: "1.0.0",
  providerId: "synthetic-provider",
  runtimeId: "synthetic-runtime",
  vendorId: null,
  baseUrlOrigin: null,
  modelId: null,
  reasoning: "auto",
  capabilityRevision: "1.0.0",
  credentialGeneration: 0,
  configurationDigest: `sha256:${"c".repeat(64)}`,
});

test("unknown and late phases preserve the latest trusted monotonic stage", () => {
  assert.equal(executionPhaseForEvent({ kind: "vendor-private-event" }, "generating-modification"), "generating-modification");
  assert.equal(executionPhaseForEvent({ kind: "initialized" }, "validating-html"), "validating-html");
  assert.equal(executionPhaseForEvent({ kind: "review-preparation-started" }, "validating-html"), "preparing-review");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function registry({ run, verifyTicket, preflight } = {}) {
  const capabilities = Object.freeze({
    availability: true,
    preflight: true,
    execution: true,
    modelCatalog: true,
  });
  const selection = Object.freeze({
    providerId: "synthetic-provider",
    runtimeId: "synthetic-runtime",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
  const prepared = () => Object.freeze({
    providerId: "synthetic-provider",
    runtimeId: "synthetic-runtime",
    securityProfile: "client-mediated",
    installation: Object.freeze({ generation: 1 }),
    installationDigest: `sha256:${"a".repeat(64)}`,
    capabilities,
    evidence: Object.freeze({ version: "1.0.0", modelCount: 1, models: [] }),
    selection,
    configuration: CONFIGURATION,
  });
  return {
    resolveSelection(received) {
      if (received?.providerId !== selection.providerId
        || received?.runtimeId !== selection.runtimeId) {
        throw Object.assign(new Error("unsupported"), { code: "AGENT_PROVIDER_UNSUPPORTED" });
      }
      return {};
    },
    assertCapabilityForSelection(received) {
      this.resolveSelection(received);
      return true;
    },
    availabilityForSelection: async () => ({ status: "ready" }),
    preflightForSelection: preflight || (async (received) => {
      if (received?.providerId !== selection.providerId) throw new Error("selection mismatch");
      return prepared();
    }),
    verifyTicket: verifyTicket || (async (ticket) => ticket),
    loadExecutionPolicy: async (_ticket, input) => ({
      ...input,
      manifestPath: "/tmp/manifest.json",
      finalizer: { command: "/bin/false", args: [], cwd: "/tmp", env: {} },
    }),
    run: run || (async () => {}),
    classifyRunFailure: (_ticket, cause) => cause?.code || "AGENT_RUN_FAILED",
    failureMessage: (_ticket, code) => `failure:${code}`,
    failureMessageForSelection(received, code) {
      this.resolveSelection(received);
      return `failure:${code}`;
    },
    preflightFailureMessageForSelection(received, code) {
      this.resolveSelection(received);
      return `preflight:${code}`;
    },
    createTurnRunner: () => async () => ({ stopReason: "end_turn" }),
  };
}

function executionAuthority(configuration = CONFIGURATION) {
  return {
    run: {
      ...IDENTITY,
      status: "processing",
      requestPath: `/tmp/project/.pageroot/requests/${IDENTITY.requestId}`,
      promptPath: "/tmp/prompt.md",
      outputPath: "/tmp/output.html",
      completionPath: "/tmp/completion.json",
    },
    request: {
      request: {
        agentDelivery: {
          mode: "managed-agent",
          selection: {
            providerId: "synthetic-provider",
            runtimeId: "synthetic-runtime",
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: {
              requested: null,
              applied: null,
              resolution: "provider-default",
            },
          },
          trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
          configuration,
        },
      },
    },
  };
}

test("Frozen Requests cannot alter configuration audit fields behind a valid digest", async () => {
  for (const [field, value] of [
    ["vendorId", "tampered-vendor"],
    ["baseUrlOrigin", "https://tampered.example"],
    ["reasoning", "high"],
    ["capabilityRevision", "tampered-revision"],
    ["credentialGeneration", 99],
  ]) {
    const tampered = Object.freeze({ ...CONFIGURATION, [field]: value });
    const coordinator = new AgentRuntimeCoordinator({
      providerRegistry: registry(),
      resolveTask: async () => executionAuthority(tampered),
      leaseStore: {
        acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
        release: async () => true,
      },
    });
    const ticket = await ready(coordinator);
    await assert.rejects(
      coordinator.submit({
        ...IDENTITY,
        selection: ticket.selection,
        trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        preflightId: ticket.preflightId,
        configurationDigest: ticket.configuration.configurationDigest,
      }),
      (error) => error?.code === "AGENT_DELIVERY_NOT_AUTHORIZED",
      field,
    );
    await coordinator.shutdown();
  }
});

async function ready(coordinator, purpose = "execution") {
  return coordinator.preflight({
    selection: Object.freeze({
      providerId: "synthetic-provider",
      runtimeId: "synthetic-runtime",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    }),
    purpose,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

async function waitForExecutionError(coordinator, expectedCode) {
  // Residue checks in the run-failure path are real lstat I/O. setImmediate
  // can drain before those callbacks, so poll across timer turns instead.
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const session = coordinator.executionStatus(IDENTITY);
    if (session?.errorCode === expectedCode) return session;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return coordinator.executionStatus(IDENTITY);
}

test("preflight rejects removed purposes and execution tickets are one-use, TTL-bound, and reverified", async () => {
  let now = 1_000;
  let drifted = false;
  const coordinator = new AgentRuntimeCoordinator({
    clock: { now: () => now },
    providerRegistry: registry({
      verifyTicket: async (ticket) => {
        if (drifted) throw Object.assign(new Error("installation drift"), {
          code: "AGENT_COMMAND_CHANGED",
        });
        return ticket;
      },
    }),
  });
  await assert.rejects(
    ready(coordinator, "discussion"),
    (error) => error?.code === "AGENT_TICKET_PURPOSE_INVALID",
  );
  const singleUse = await ready(coordinator);
  await coordinator.redeemCommandTicket(singleUse.preflightId, {
    purpose: "execution",
  });
  await assert.rejects(
    coordinator.redeemCommandTicket(singleUse.preflightId, { purpose: "execution" }),
    (error) => error?.code === "AGENT_PREFLIGHT_EXPIRED",
  );

  const expired = await ready(coordinator);
  now += 2 * 60_000;
  await assert.rejects(
    coordinator.redeemCommandTicket(expired.preflightId),
    (error) => error?.code === "AGENT_PREFLIGHT_EXPIRED",
  );

  const changed = await ready(coordinator);
  drifted = true;
  await assert.rejects(
    coordinator.redeemCommandTicket(changed.preflightId),
    (error) => error?.code === "AGENT_COMMAND_CHANGED",
  );
  await coordinator.shutdown();
});

test("HTTP launch cannot mix an old ticket with a configuration committed during final verification", async () => {
  const pagerootSelection = Object.freeze({
    providerId: "pageroot",
    runtimeId: "http",
    requestedModelId: "pageroot:deepseek-v4-pro",
    resolvedModelId: "pageroot:deepseek-v4-pro",
    reasoning: Object.freeze({ requested: null, applied: null, resolution: "provider-default" }),
  });
  const configurationFor = (environment) => {
    const generation = Number(environment?.PAGEROOT_API_CREDENTIAL_GENERATION || 0);
    return Object.freeze({
      schemaVersion: "1.0.0",
      providerId: "pageroot",
      runtimeId: "http",
      vendorId: String(environment?.PAGEROOT_API_VENDOR || "deepseek"),
      baseUrlOrigin: "https://api.deepseek.com",
      modelId: pagerootSelection.resolvedModelId,
      reasoning: "auto",
      capabilityRevision: "test-revision",
      credentialGeneration: generation,
      configurationDigest: `sha256:${String(Math.max(1, generation)).slice(-1).repeat(64)}`,
    });
  };
  let coordinator;
  let verifyCount = 0;
  let runtimeCalls = 0;
  let frozenConfiguration = null;
  const pagerootRegistry = {
    resolveSelection: () => ({}),
    assertCapabilityForSelection: () => true,
    preflightForSelection: async (_selection, purpose, { environment }) => ({
      purpose,
      providerId: "pageroot",
      runtimeId: "http",
      securityProfile: "client-mediated",
      installation: Object.freeze({ generation: Number(environment.PAGEROOT_API_CREDENTIAL_GENERATION) }),
      installationDigest: `sha256:${"a".repeat(64)}`,
      configuration: configurationFor(environment),
      capabilities: Object.freeze({ availability: true, preflight: true, execution: true }),
      evidence: Object.freeze({ version: "1.0.0", modelCount: 1, models: [] }),
      selection: pagerootSelection,
    }),
    verifyTicket: async (ticket) => {
      verifyCount += 1;
      if (verifyCount === 2) {
        await coordinator.updateAgentConfiguration("pageroot", {
          apiKey: "sk-new",
          vendorId: "deepseek",
          selection: pagerootSelection,
        });
      }
      return ticket;
    },
    loadExecutionPolicy: async (_ticket, input) => ({
      ...input,
      manifestPath: "/tmp/manifest.json",
      finalizer: { command: "/bin/false", args: [], cwd: "/tmp", env: {} },
    }),
    run: async () => { runtimeCalls += 1; },
    classifyRunFailure: (_ticket, cause) => cause?.code || "AGENT_RUN_FAILED",
    failureMessage: (_ticket, code) => `failure:${code}`,
    failureMessageForSelection: (_selection, code) => `failure:${code}`,
    preflightFailureMessageForSelection: (_selection, code) => `preflight:${code}`,
  };
  coordinator = new AgentRuntimeCoordinator({
    providerRegistry: pagerootRegistry,
    resolveTask: async () => ({
      ...executionAuthority(),
      request: { request: { agentDelivery: {
        mode: "managed-agent",
        selection: pagerootSelection,
        configuration: frozenConfiguration,
        trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      } } },
    }),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => true,
    },
  });
  const connected = await coordinator.updateAgentConfiguration("pageroot", {
    apiKey: "sk-old",
    vendorId: "deepseek",
    selection: pagerootSelection,
  });
  const ticket = await coordinator.preflight({
    selection: connected.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  frozenConfiguration = ticket.configuration;

  await assert.rejects(() => coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  }), (error) => error?.code === "AGENT_CONFIGURATION_CHANGED");
  assert.equal(runtimeCalls, 0);
  await coordinator.shutdown();
});

test("release false keeps the lease fence and blocks shutdown", async () => {
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry(),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => false,
    },
    cancelTimeoutMs: 50,
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.executionStatus(IDENTITY).errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(coordinator.executionStatus(IDENTITY).safeToRetry, false);
  assert.equal(coordinator.executionStatus(IDENTITY).recoveryKind, "end");
  await assert.rejects(
    coordinator.shutdown(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("runtime failure keeps retry safety separate from the recovery action", async () => {
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      run: async () => {
        throw Object.assign(new Error("balance"), { code: "AGENT_BALANCE_INSUFFICIENT" });
      },
    }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => true,
    },
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  const session = await waitForExecutionError(coordinator, "AGENT_BALANCE_INSUFFICIENT");
  assert.equal(session.errorCode, "AGENT_BALANCE_INSUFFICIENT");
  assert.equal(session.safeToRetry, true);
  assert.equal(session.retryable, true);
  assert.equal(session.recoveryKind, "change-provider");
  await coordinator.shutdown();
});

test("durable cancellation is never written after cleanup or lease release fails", async () => {
  let durableWrites = 0;
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      run: async ({ cancellationSignal }) => new Promise((_resolve, reject) => {
        cancellationSignal.addEventListener("abort", () => reject(Object.assign(
          new Error("cancelled"),
          { code: "AGENT_CANCELLED" },
        )), { once: true });
      }),
    }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => false,
    },
    cancelTimeoutMs: 50,
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await assert.rejects(
    coordinator.cancelDurableExecution({
      identity: IDENTITY,
      cancelRequest: async () => { durableWrites += 1; },
    }),
    (error) => error?.code === "AGENT_CANCEL_UNCONFIRMED",
  );
  assert.equal(durableWrites, 0);
});

test("canonical events reject reorder and duplicates while preserving bounded terminal evidence", () => {
  const reducer = createAgentEventReducer({ maxEvents: 2, maxTextLength: 5 });
  const accept = (eventId, sequence, kind, text, timestamp = sequence) => reducer.accept({
    eventId,
    turnId: "turn_contract",
    sequence,
    timestamp,
    kind,
    ...(text ? { text } : {}),
  });
  assert.equal(accept("one", 1, "visible-text", "abcdef").accepted, true);
  assert.equal(accept("one", 2, "completion").reason, "duplicate");
  assert.equal(accept("late", 0, "session-update").reason, "late");
  accept("two", 2, "session-update");
  const completed = accept("three", 3, "completion");
  assert.equal(completed.projection.visibleText, "abcde");
  assert.equal(completed.projection.textTruncated, true);
  assert.ok(completed.projection.retainedEvents.some((event) => event.kind === "completion"));
});

test("canonical visible-text truncation facts survive a byte-limited runtime", () => {
  const reducer = createAgentEventReducer();
  reducer.accept({
    eventId: "text_before_limit",
    turnId: "turn_runtime_text",
    sequence: 1,
    timestamp: 1,
    kind: "visible-text",
    text: "公开的执行进展。",
  });
  const result = reducer.accept({
    eventId: "text_limit_reached",
    turnId: "turn_runtime_text",
    sequence: 2,
    timestamp: 2,
    kind: "visible-text-truncated",
  });
  assert.equal(result.projection.visibleText, "公开的执行进展。");
  assert.equal(result.projection.textTruncated, true);
});

test("public Agent text keeps message boundaries without exposing non-text events", () => {
  const updates = projectPublicText([
    { eventId: "one", sequence: 1, kind: "visible-text", messageId: "message-a", text: "正在" },
    { eventId: "two", sequence: 2, kind: "visible-text", messageId: "message-a", text: "读取页面。" },
    { eventId: "hidden", sequence: 3, kind: "reasoning", text: "隐藏推理" },
    { eventId: "three", sequence: 4, kind: "visible-text", text: "正在修改标题。" },
    { eventId: "four", sequence: 5, kind: "visible-text", text: "正在检查布局。" },
  ]);
  assert.deepEqual(updates, [
    { id: "message:message-a:0", sequence: 2, text: "正在读取页面。" },
    { id: "three:0", sequence: 4, text: "正在修改标题。" },
    { id: "four:0", sequence: 5, text: "正在检查布局。" },
  ]);
  assert.equal(updates.some((update) => update.text.includes("隐藏推理")), false);
});

test("explicit public paragraphs remain separate without terminal punctuation", () => {
  assert.deepEqual(projectPublicText([
    {
      kind: "visible-text",
      eventId: "visible-paragraphs",
      sequence: 1,
      text: "第一段标题\n\n第二段内容",
    },
  ]), [
    { id: "visible-paragraphs:0", sequence: 1, text: "第一段标题" },
    { id: "visible-paragraphs:1", sequence: 1, text: "第二段内容" },
  ]);
});

test("repeated tool activity persists phase transitions and keeps a return to an earlier phase", async () => {
  const finish = deferred();
  const facts = [];
  const coordinator = new AgentRuntimeCoordinator({
    recordExecutionFact: async (_identity, event) => facts.push(event),
    providerRegistry: registry({ run: async (_ticket, { onEvent }) => {
      for (const kind of ["file-read", "file-written", "file-read"]) {
        for (let i = 0; i < 1000; i += 1) onEvent({ kind });
      }
      onEvent({ kind: "visible-text", text: "Finished the requested work." });
      await finish.promise;
    } }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => true,
    },
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({ ...IDENTITY, selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId, configurationDigest: ticket.configuration.configurationDigest });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(facts.filter((event) => ["reading-task", "writing-candidate"].includes(event.kind))
    .map((event) => event.kind), ["reading-task", "writing-candidate", "reading-task"]);
  assert.equal(new Set(facts.map((event) => event.eventId)).size, facts.length);
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.executionStatus(IDENTITY).state, "completed");
  for (const kind of ["started", "public-summary", "execution-ended"]) {
    assert.equal(facts.filter((event) => event.kind === kind).length, 1, kind);
  }
});

test("execution status projects only public Agent text with frozen provider identity", async () => {
  const finish = deferred();
  const persistedFacts = [];
  const coordinator = new AgentRuntimeCoordinator({
    recordExecutionFact: async (_identity, event) => persistedFacts.push(event),
    providerRegistry: registry({
      run: async (_ticket, { onEvent }) => {
        onEvent({ kind: "initialized", agentName: "Synthetic Agent", agentVersion: "1.0.0" });
        onEvent({ turnId: "stale_turn", kind: "visible-text", text: "迟到事件不能污染本轮。" });
        onEvent({ kind: "reasoning", text: "这段隐藏推理绝不能进入侧栏。" });
        onEvent({ kind: "activity", channel: "html", byteDelta: 12 });
        onEvent({ kind: "activity", channel: "reasoning", byteDelta: 999 });
        onEvent({ kind: "visible-text", text: "正在读取冻结任务。" });
        onEvent({ kind: "visible-text", text: "正在写入 Candidate。" });
        onEvent({ kind: "visible-text-truncated" });
        await finish.promise;
      },
    }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => true,
    },
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const running = coordinator.executionStatus(IDENTITY);
  assert.equal(running.providerId, "synthetic-provider");
  assert.equal(running.runtimeId, "synthetic-runtime");
  assert.equal(running.agentName, "Synthetic Agent");
  assert.equal(running.state, "running");
  assert.equal(running.visibleText, "正在读取冻结任务。\n\n正在写入 Candidate。");
  assert.deepEqual(running.visibleTextUpdates.map((update) => update.text), [
    "正在读取冻结任务。",
    "正在写入 Candidate。",
  ]);
  assert.equal(running.textTruncated, true);
  assert.equal(running.visibleText.includes("隐藏推理"), false);
  assert.equal(running.eventCount, 7);
  assert.equal(running.receivedBytes, 12);
  assert.equal(typeof running.lastActivityAt, "string");
  assert.equal(Object.hasOwn(running, "command"), false);
  assert.equal(running.visibleText.includes("迟到事件"), false);

  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.executionStatus(IDENTITY).state, "completed");
  const summaries = persistedFacts.filter((event) => event.kind === "public-summary");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].publicSummary, "正在读取冻结任务。\n\n正在写入 Candidate。");
  assert.equal(JSON.stringify(persistedFacts).includes("隐藏推理"), false);
  await coordinator.shutdown();
});

test("cancellation keeps late Agent narration out of the public session", async () => {
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      run: async (_ticket, { cancellationSignal, onEvent }) => {
        onEvent({ kind: "initialized", agentName: "Synthetic Agent" });
        onEvent({ kind: "visible-text", text: "正在修改候选。" });
        await new Promise((resolve) => {
          cancellationSignal.addEventListener("abort", () => {
            onEvent({ kind: "visible-text", text: "这段取消后的文本不能显示。" });
            resolve();
          }, { once: true });
        });
      },
    }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => true,
    },
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await coordinator.cancelExecution(IDENTITY);
  const cancelled = coordinator.executionStatus(IDENTITY);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.visibleText, "正在修改候选。");
  assert.equal(cancelled.visibleText.includes("取消后的文本"), false);
  await coordinator.shutdown();
});

test("shutdown drains an in-flight provider preflight before confirming exit", async () => {
  let releasePreflight;
  let markPreflightStarted;
  const preflightGate = new Promise((resolve) => { releasePreflight = resolve; });
  const preflightStarted = new Promise((resolve) => { markPreflightStarted = resolve; });
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      preflight: async (selection) => {
        markPreflightStarted();
        await preflightGate;
        return {
          providerId: selection.providerId,
          runtimeId: selection.runtimeId,
          securityProfile: "client-mediated",
          installation: Object.freeze({ generation: 1 }),
          installationDigest: `sha256:${"a".repeat(64)}`,
          capabilities: Object.freeze({ execution: true }),
          evidence: Object.freeze({ version: "1.0.0", modelCount: 1, models: [] }),
          selection,
        };
      },
    }),
    cancelTimeoutMs: 500,
  });
  const preflight = ready(coordinator);
  await preflightStarted;
  const shutdown = coordinator.shutdown();
  releasePreflight();
  await assert.rejects(preflight, (error) => error?.code === "AGENT_BRIDGE_DISPOSED");
  await shutdown;
});

test("an unknown historical provider stays readable but cannot become start authority", () => {
  const coordinator = new AgentRuntimeCoordinator({ providerRegistry: registry() });
  const selection = {
    providerId: "future-provider",
    runtimeId: "future-runtime",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };
  const interrupted = coordinator.interrupted(IDENTITY, { selection });
  assert.equal(interrupted.providerId, "future-provider");
  assert.equal(interrupted.runtimeId, "future-runtime");
  assert.equal("driver" in interrupted, false);
  assert.equal(interrupted.state, "interrupted");
  assert.equal(interrupted.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(interrupted.safeToRetry, false);
  assert.equal(interrupted.recoveryKind, "end");
  assert.match(interrupted.errorMessage, /无法恢复此 Agent 会话/u);
  assert.throws(
    () => coordinator.assertSelection(selection, "execution"),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
});

test("current execution binds by selection and rejects a leftover driver-only start", async () => {
  const coordinator = new AgentRuntimeCoordinator({ providerRegistry: registry() });
  const selection = Object.freeze({
    providerId: "synthetic-provider",
    runtimeId: "synthetic-runtime",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
  await assert.rejects(
    coordinator.preflight({
      driver: "synthetic-driver",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    }),
    (error) => error?.code === "AGENT_SELECTION_UNSUPPORTED",
  );
  await assert.rejects(
    coordinator.preflight({
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    }),
    (error) => error?.code === "AGENT_SELECTION_UNSUPPORTED",
  );

  const fromSelection = await coordinator.preflight({
    selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal("driver" in fromSelection, false);
  const redeemed = await coordinator.redeemCommandTicket(fromSelection.preflightId, {
    purpose: "execution",
  });
  assert.equal("driver" in redeemed, false);
  assert.equal(redeemed.selection.providerId, "synthetic-provider");
  await coordinator.shutdown();
});

test("execution persistence failure before launch never invokes the provider", async () => {
  let starts = 0;
  let releases = 0;
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({ run: async () => { starts += 1; } }),
    resolveTask: async () => executionAuthority(CONFIGURATION),
    recordExecutionFact: async () => { throw new Error("synthetic history write failure"); },
    leaseStore: { acquire: async () => ({ key: "synthetic" }), release: async () => { releases += 1; return true; } },
  });
  const ticket = await ready(coordinator);
  await assert.rejects(coordinator.submit({ ...IDENTITY, selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION, preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest }), /synthetic history write failure/);
  assert.equal(starts, 0);
  assert.equal(releases, 1);
  await coordinator.shutdown();
});


test("public text redacts assembled credentials, paths and generated markup", () => {
  const updates = projectPublicText([
    { kind: "visible-text", eventId: "event_1", sequence: 1, messageId: "msg_1", text: "Bearer sk-" },
    { kind: "visible-text", eventId: "event_2", sequence: 2, messageId: "msg_1", text: "synthetic-secret /Users/测试/secret.txt" },
    { kind: "tool-call", arguments: "password=private", text: "raw prompt" },
  ]);
  assert.equal(updates.length, 1);
  assert.doesNotMatch(updates[0].text, /synthetic-secret|Users|secret.txt|password|raw prompt/);
  assert.doesNotMatch(safePublicAgentText("<h1>unvalidated output</h1>"), /<h1>|unvalidated/);
  assert.doesNotMatch(safePublicAgentText("https://service.invalid?api_key=private"), /private|service.invalid/);
  assert.ok(projectPublicText([{ kind: "visible-text", text: "a".repeat(100000) }])[0].text.length <= 65536);
});

test("stop during unpublished startup waits and prevents a late provider launch", async () => {
  const entered = deferred();
  const release = deferred();
  let starts = 0;
  let durableCancelled = false;
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({ run: async () => { starts += 1; } }),
    resolveTask: async () => executionAuthority(CONFIGURATION),
    recordExecutionFact: async () => { entered.resolve(); await release.promise; },
    leaseStore: { acquire: async () => ({ key: "synthetic" }), release: async () => true },
  });
  const ticket = await ready(coordinator);
  const started = coordinator.submit({ ...IDENTITY, selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION, preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest });
  const rejected = assert.rejects(started, { code: "AGENT_CANCELLED" });
  await entered.promise;
  const stopped = coordinator.cancelDurableExecution({ identity: IDENTITY, cancelRequest: async () => { durableCancelled = true; } });
  await Promise.resolve();
  assert.equal(durableCancelled, false);
  release.resolve();
  await stopped;
  await rejected;
  assert.equal(durableCancelled, true);
  assert.equal(starts, 0);
  await coordinator.shutdown();
});

test("unconfirmed startup lease cleanup never authorizes durable cancellation", async () => {
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry(), resolveTask: async () => executionAuthority(CONFIGURATION),
    recordExecutionFact: async () => { throw new Error("synthetic write failure"); },
    leaseStore: { acquire: async () => ({ key: "synthetic" }), release: async () => false },
  });
  const ticket = await ready(coordinator);
  await assert.rejects(coordinator.submit({ ...IDENTITY, selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION, preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest }), { code: "AGENT_CANCEL_UNCONFIRMED" });
  let cancellations = 0;
  await assert.rejects(coordinator.cancelDurableExecution({ identity: IDENTITY,
    cancelRequest: async () => { cancellations += 1; } }), { code: "AGENT_CANCEL_UNCONFIRMED" });
  assert.equal(cancellations, 0);
});

test("public narration survives the diagnostic event cap through sealed summary", async () => {
  const finish = deferred();
  const persistedFacts = [];
  const coordinator = new AgentRuntimeCoordinator({
    recordExecutionFact: async (_identity, event) => persistedFacts.push(event),
    providerRegistry: registry({ run: async (_ticket, { onEvent }) => {
      onEvent({ kind: "visible-text", messageId: "opening", text: "开始读取。" });
      for (let index = 0; index < 2048; index += 1) onEvent({ kind: "tool-call", text: "private-tool-output" });
      onEvent({ kind: "visible-text", messageId: "closing", text: "最后一段确已保留。" });
      await finish.promise;
    } }),
    resolveTask: async () => executionAuthority(),
    leaseStore: { acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }), release: async () => true },
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({ ...IDENTITY, selection: ticket.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION, preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest });
  await new Promise((resolve) => setImmediate(resolve));
  const running = coordinator.executionStatus(IDENTITY);
  assert.ok(running.eventCount > 2048);
  assert.equal(running.visibleText, "开始读取。\n\n最后一段确已保留。");
  assert.equal(running.visibleText, running.visibleTextUpdates.map((update) => update.text).join("\n\n"));
  assert.equal(running.textTruncated, false);
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persistedFacts.find((event) => event.kind === "public-summary").publicSummary, running.visibleText);
  assert.doesNotMatch(JSON.stringify(persistedFacts), /private-tool-output/);
  await coordinator.shutdown();
});

test("public messages preserve whitespace, assembled redaction and first appearance", () => {
  const accumulator = createPublicAgentTextAccumulator();
  let sequence = 0;
  const append = (messageId, text) => accumulator.append({ kind: "visible-text", messageId,
    eventId: `fragment-${++sequence}`, sequence, text });
  append("a", "一"); append("a", " "); append("a", "二"); append("a", "\n\n");
  append("b", "第二条消息。");
  append("a", "三 api_"); append("a", "key=synthetic-secret");
  const value = accumulator.snapshot();
  assert.deepEqual(value.visibleTextUpdates.map(({ id }) => id), ["message:a:0", "message:b:0"]);
  assert.equal(value.visibleTextUpdates[0].sequence, 7);
  assert.equal(value.visibleTextUpdates[0].text, "一 二\n\n三 api_key=[已隐藏]");
  assert.equal(value.visibleText, value.visibleTextUpdates.map((update) => update.text).join("\n\n"));
  assert.doesNotMatch(value.visibleText, /synthetic-secret/);
  assert.equal(accumulator.snapshot(), value);
  for (const raw of ["前\n\n后", "前\n\n\n\n后", "\n\n前\n\n", "前 \n后"]) {
    const ungrouped = createPublicAgentTextAccumulator();
    ungrouped.append({ kind: "visible-text", eventId: "paragraphs", text: raw });
    assert.equal(ungrouped.snapshot().visibleText, raw);
  }
});

test("80 public updates is a lossless presentation budget with stable earlier identity", () => {
  const accumulator = createPublicAgentTextAccumulator();
  const append = (index, text = `第${index}条。`) => accumulator.append({ kind: "visible-text",
    messageId: `message-${index}`, sequence: index, eventId: `event-${index}`, text });
  for (let index = 1; index <= 81; index += 1) append(index);
  const first = accumulator.snapshot();
  assert.equal(first.visibleTextUpdates.length, 80);
  for (let index = 82; index <= 100; index += 1) append(index);
  append(1, "补充。");
  const value = accumulator.snapshot();
  assert.equal(value.visibleTextUpdates.length, 80);
  assert.equal(value.visibleTextUpdates[0].id, first.visibleTextUpdates[0].id);
  assert.equal(value.visibleText, Array.from({ length: 100 }, (_, index) => `第${index + 1}条。${index ? "" : "补充。"}`).join("\n\n"));
  assert.equal(value.textTruncated, false);
});

test("one text budget includes separators and redaction expansion without partial surrogates", () => {
  for (const { limit, messages, expected, truncated } of [
    { limit: 5, messages: ["abcde"], expected: "abcde", truncated: false },
    { limit: 5, messages: ["abcdef"], expected: "abcde", truncated: true },
    { limit: 5, messages: ["ab", "cd"], expected: "ab\n\nc", truncated: true },
    { limit: 5, messages: ["abc😀"], expected: "abc😀", truncated: false },
    { limit: 4, messages: ["abc😀"], expected: "abc", truncated: true },
    { limit: 5, messages: ["sk-x"], expected: "[凭据已隐", truncated: true },
  ]) {
    const accumulator = createPublicAgentTextAccumulator({ maxTextLength: limit });
    messages.forEach((text, index) => accumulator.append({ kind: "visible-text", text,
      eventId: `event-${index}`, messageId: `message-${index}`, sequence: index }));
    const value = accumulator.snapshot();
    assert.equal(value.visibleText, expected);
    assert.equal(value.visibleText, value.visibleTextUpdates.map((update) => update.text).join("\n\n"));
    assert.equal(value.textTruncated, truncated);
    assert.ok(value.visibleText.length <= limit);
  }
});


test("ungrouped provider chunks keep their existing whitespace separators", () => {
  for (const chunks of [["第一句。\n\n", "第二句。\n\n"], ["第一句。", "\n", "第二句。"],
    ["First.", " ", "Second."], ["第一句。", "\n\n第二句。"]]) {
    const accumulator = createPublicAgentTextAccumulator();
    chunks.forEach((text, sequence) => accumulator.append({ kind: "visible-text", text,
      sequence, eventId: `whitespace-${sequence}` }));
    const value = accumulator.snapshot();
    assert.equal(value.visibleText, chunks.join(""));
    assert.equal(value.visibleText, value.visibleTextUpdates.map(({ text }) => text).join("\n\n"));
    assert.equal(value.textTruncated, false);
  }
});
