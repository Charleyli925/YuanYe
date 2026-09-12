import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_MESSAGE_KEYS,
  sidebarAgentLine,
  sidebarReasoningLine,
  conversationLoadedForView,
  sidebarConversationPresentation,
  conversationReadyForDocument,
  sidebarActionBar,
  sidebarFailureRetryable,
  sidebarActorInitial,
  sidebarMessageStream,
  sidebarConversationGroups,
  sidebarExecutionStatus,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarRunProgress,
  sidebarStateFromRun,
  sidebarTimestampLabel,
} from "../app/workbench/ai-conversation-model.js";

function factMessage(overrides = {}) {
  return {
    messageId: "message_fact12345678",
    actor: "pageroot",
    kind: "result-summary",
    status: "completed",
    text: "候选版本 5 已准备好",
    sequence: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

test("the message stream projects immutable facts and never an action", () => {
  const stream = sidebarMessageStream([
    factMessage({ actor: "user", text: "把这块结构再简化一些" }),
    factMessage({ messageId: "message_reply1234567", actor: "qoder", sequence: 2 }),
  ]);

  assert.equal(stream.length, 2);
  assert.deepEqual(stream.map((message) => message.actorLabel), ["我", "Qoder CLI"]);
  for (const message of stream) {
    for (const key of FORBIDDEN_MESSAGE_KEYS) {
      assert.ok(
        !(key in message),
        `a projected message must not expose ${key}`,
      );
    }
  }
});

test("a message carrying an interface member is dropped, not rendered", () => {
  for (const key of FORBIDDEN_MESSAGE_KEYS) {
    const stream = sidebarMessageStream([
      factMessage({ [key]: ["adopt"] }),
      factMessage({ messageId: "message_clean12345678", sequence: 2 }),
    ]);
    assert.equal(stream.length, 1, `a message with ${key} must be dropped`);
    assert.equal(stream[0].messageId, "message_clean12345678");
  }
});

test("the action bar is derived from product state, never from a message", () => {
  // The same message stream produces a different bar in each state, which is
  // only possible because the bar never reads the stream.
  const messages = [factMessage()];
  assert.equal(sidebarMessageStream(messages).length, 1);

  assert.equal(sidebarActionBar({ state: "preview-ready" }), null);
  assert.equal(sidebarActionBar({ state: "preparing-delivery" }), null);

  const pending = sidebarActionBar({
    state: "ready-to-open",
    candidateVersionLabel: "候选版本 5",
    candidateStatus: "ready",
  });
  assert.equal(pending.kind, "decision");
  assert.equal(pending.title, "修改已准备好，尚未采用");
  assert.equal(pending.detail, "查看本次修改，再决定是否采用。");
  assert.deepEqual(pending.actions.map((action) => action.id), ["review"]);

  const running = sidebarActionBar({ state: "processing" });
  assert.equal(running.kind, "progress");
  assert.deepEqual(running.actions.map((action) => action.id), ["cancel"]);
});

test("no pending decision means the action bar occupies no space", () => {
  for (const state of ["preview-ready", "preparing-delivery"]) {
    assert.equal(sidebarActionBar({ state }), null);
  }
});

test("an attention candidate is not offered for blind adoption", () => {
  // Before the user has looked, a large change offers only the comparison:
  // adopting it unseen is not a choice PageRoot should present.
  const unseen = sidebarActionBar({
    state: "ready-to-open",
    candidateVersionLabel: "候选版本 7",
    candidateStatus: "attention",
  });
  assert.deepEqual(unseen.actions.map((action) => action.id), ["review"]);
  assert.match(unseen.detail, /变化较大/u);

  // While comparing, the user is looking at it, so adopting is legitimate — and
  // pointing at 「查看修改」 would point at the screen they are already on.
  const comparing = sidebarActionBar({
    state: "review-view",
    candidateVersionLabel: "候选版本 7",
    candidateStatus: "attention",
  });
  assert.deepEqual(comparing.actions.map((action) => action.id), ["adopt", "discard"]);
  assert.match(comparing.detail, /变化较大/u);
});

test("a blocked candidate offers recovery instead of adoption", () => {
  const bar = sidebarActionBar({
    state: "ready-to-open",
    candidateStatus: "blocked",
    failureMessage: "本轮没有可用结果",
  });
  assert.equal(bar.kind, "blocked");
  assert.equal(bar.title, "本轮没有可用结果");
  assert.ok(!bar.actions.some((action) => action.id === "adopt"));
});

test("an adoption failure stays on the existing decision bar", () => {
  const bar = sidebarActionBar({
    state: "review-view",
    failureMessage: "最新版暂时无法打开。",
  });
  assert.equal(bar.kind, "decision");
  assert.match(bar.detail, /最新版暂时无法打开/u);
  assert.ok(bar.actions.some((action) => action.id === "adopt"));
});

test("the product state owns the single available modification intent", () => {
  assert.equal(sidebarResolvedIntent("preview-ready"), "modify");
  assert.equal(sidebarResolvedIntent("processing"), "modify");
  assert.equal(sidebarResolvedIntent("ready-to-open"), "continue");
  assert.equal(sidebarResolvedIntent("review-view"), "continue");
});

test("a reveal intent is only written directly where no load can follow it", () => {
  const readyFor = (projectId, documentId) => ({
    status: "ready",
    context: { projectId, documentId, sourcePath: "/tmp/page.html" },
  });
  // Loaded and ready for this very Document: no load ahead of it, so a direct
  // draft-intent write stands.
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p1", "d1"), true);
  // First open (never loaded) and mid-load both precede a load that restores the
  // stored draft, so the intent must be re-asserted after the load instead.
  assert.equal(conversationReadyForDocument(null, "p1", "d1"), false);
  assert.equal(
    conversationReadyForDocument({
      status: "loading",
      context: { projectId: "p1", documentId: "d1", sourcePath: "/tmp/page.html" },
    }, "p1", "d1"),
    false,
  );
  // A Document switch deactivates the conversation while leaving the sidebar
  // open, and a failed load leaves it closed: both are headed for the load that
  // would quietly drop a plain write.
  assert.equal(
    conversationReadyForDocument({ status: "idle", context: null }, "p1", "d1"),
    false,
  );
  assert.equal(
    conversationReadyForDocument({ status: "failed", context: null }, "p1", "d1"),
    false,
  );
  // Loaded, but for a Document the user is no longer on — the reopen's load
  // would drop the write exactly the same way.
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p2", "d2"), false);
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p1", "d2"), false);
});

test("the empty state only appears once a load has settled", () => {
  const context = { projectId: "p1", documentId: "d1", sourcePath: "/tmp/page.html" };
  // Settled loads: one that published a conversation, and one that settled
  // without a conversation while the Document it loaded for is still attached.
  assert.equal(conversationLoadedForView({ status: "ready", context }), true);
  assert.equal(conversationLoadedForView({ status: "idle", context }), true);
  // Not settled: a load in flight; the contextless idle the session publishes
  // on subscribe and on deactivate — a fresh open renders its first frame
  // against it; a failed load; and a null snapshot before the controller has
  // published anything.
  assert.equal(conversationLoadedForView({ status: "loading", context }), false);
  assert.equal(conversationLoadedForView({ status: "idle", context: null }), false);
  assert.equal(conversationLoadedForView({ status: "failed", context }), false);
  assert.equal(conversationLoadedForView(null), false);
  // Fail-safe: a status this version does not know must never unlock the
  // empty state by default, because the session drops draft writes until it
  // has published a conversation.
  assert.equal(conversationLoadedForView({ status: "archived", context }), false);
});

test("a disabled send button always says why", () => {
  const blocked = [
    { catalogStatus: "checking" },
    { catalogStatus: "auth-required" },
    { catalogStatus: "not-installed" },
    { catalogStatus: "unavailable" },
    { state: "preparing-delivery", pendingCommentCount: 1 },
    { state: "processing", hasText: true },
    { state: "promoting", hasText: true },
    { state: "preview-ready", queued: true, pendingCommentCount: 1 },
  ];
  for (const options of blocked) {
    const send = sidebarSendState({
      state: "preview-ready",
      catalogStatus: "ready",
      ...options,
    });
    assert.equal(send.canSend, false, `${JSON.stringify(options)} must block sending`);
    const explained = send.reason || send.label !== "发送";
    assert.ok(
      explained,
      `${JSON.stringify(options)} must explain why sending is unavailable`,
    );
  }
});

test("Agent connection recovery is an explicit sidebar action, not a send", () => {
  const checking = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "checking",
    hasText: true,
  });
  assert.deepEqual(checking, {
    kind: "open-agent-settings",
    canSend: false,
    label: "设置 Agent",
    reason: null,
  });

  const login = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    hasText: true,
  });
  assert.deepEqual(login, {
    kind: "open-agent-settings",
    canSend: false,
    label: "登录 Agent",
    reason: null,
  });

  const connect = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    credentialKind: "api-token",
    agentSettingsName: "源页 Agent",
  });
  assert.equal(connect.label, "连接 源页 Agent");

  const install = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "not-installed",
    hasText: true,
  });
  assert.equal(install.kind, "open-agent-settings");
  assert.equal(install.label, "设置 Agent");

  const unavailable = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    hasText: true,
  });
  assert.equal(unavailable.kind, "open-agent-settings");
  assert.equal(unavailable.label, "设置 Agent");

  const capacity = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    catalogReason: "account-capacity",
    hasText: true,
  });
  assert.equal(capacity.kind, "open-agent-settings");
  assert.equal(capacity.label, "额度已用完");

  const timeout = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    catalogReason: "timeout",
    hasText: true,
  });
  assert.equal(timeout.kind, "open-agent-settings");
  assert.equal(timeout.label, "设置 Agent");

  const codexLogin = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    hasText: true,
    agentName: "Codex",
    agentSettingsName: "Codex",
    agentSettingsSupported: true,
  });
  assert.deepEqual(codexLogin, {
    kind: "open-agent-settings",
    canSend: false,
    label: "登录 Codex",
    reason: null,
  });

  const codexModify = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 1,
    agentName: "Codex",
    agentSettingsName: "Codex",
    agentSettingsSupported: false,
  });
  assert.equal(codexModify.label, "交给 Codex 修改");
});

test("Candidate decisions and in-flight delivery win over Agent setup", () => {
  for (const catalogStatus of ["checking", "auth-required", "not-installed", "unavailable"]) {
    const decision = sidebarSendState({
      state: "ready-to-open",
      catalogStatus,
      intent: "continue",
      pendingCommentCount: 2,
    });
    assert.deepEqual(decision, {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    });

    const preparing = sidebarSendState({
      state: "preparing-delivery",
      catalogStatus,
      intent: "modify",
      pendingCommentCount: 2,
    });
    assert.equal(preparing.kind, "send");
    assert.equal(preparing.canSend, false);
    assert.equal(preparing.reason, "正在冻结本轮评论和页面内容");
  }
});

test("mode copy stays short and names only the current user-facing state", () => {
  assert.equal(sidebarModePresentation("preview-ready").label, "待发送");
  assert.equal(sidebarModePresentation("processing").label, "处理中");
  assert.equal(sidebarModePresentation("ready-to-open").label, "待决定");
  assert.equal(sidebarModePresentation("review-view").label, "审阅中");
  assert.equal(sidebarModePresentation("unknown-state").label, "待发送");
});

test("the Composer names the current model and opens only for a real choice", () => {
  assert.deepEqual(sidebarAgentLine({ catalogStatus: "checking" }), {
    kind: "checking", text: "正在连接…", choosable: false,
  });
  assert.deepEqual(sidebarAgentLine({
    catalogStatus: "checking",
    modelDisplayName: "PageRoot-E2E",
    modelChoiceCount: 2,
  }), {
    kind: "checking", text: "PageRoot-E2E", choosable: true,
  });

  assert.equal(sidebarAgentLine({ catalogStatus: "ready" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "ready", modelDisplayName: "   " }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "auth-required" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "not-installed" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "unavailable" }), null);

  const single = sidebarAgentLine({ modelDisplayName: "PageRoot-E2E", modelChoiceCount: 1 });
  assert.equal(single.text, "PageRoot-E2E");
  assert.equal(single.choosable, false);

  const many = sidebarAgentLine({ modelDisplayName: "gpt-5", modelChoiceCount: 3 });
  assert.equal(many.choosable, true);
});

test("the Composer names thinking depth only when the Agent actually offers it", () => {
  assert.equal(sidebarReasoningLine({}), null);
  assert.equal(sidebarReasoningLine({ choices: [] }), null);

  const defaults = sidebarReasoningLine({
    choices: [
      { id: "auto", label: "自动" },
      { id: "none", label: "关闭" },
      { id: "low", label: "低" },
      { id: "high", label: "高" },
      { id: "max", label: "最深" },
    ],
  });
  assert.equal(defaults.text, "思考 · 自动");
  assert.equal(defaults.selectedId, "auto");
  assert.equal(defaults.choosable, true);

  const explicit = sidebarReasoningLine({
    choices: [
      { id: "none", label: "关闭" },
      { id: "low", label: "低" },
      { id: "high", label: "高" },
    ],
    selectedId: "none",
  });
  assert.equal(explicit.text, "思考 · 关闭");
  assert.equal(explicit.selectedId, "none");
});

test("the header's mode is derived from Request authority, not guessed", () => {
  assert.equal(sidebarStateFromRun(), "preview-ready");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "editing" } }), "preview-ready");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "ready" } }), "preview-ready");

  // A durable execution run must stay bound to Request authority.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "processing" } }), "processing");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "validating" } }), "validating");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "processing" } }),
    ).label,
    "处理中",
  );

  assert.equal(sidebarStateFromRun({ activeRun: { status: "submitting" } }), "preparing-delivery");
  assert.equal(sidebarStateFromRun({ submissionPending: true }), "preparing-delivery");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "ready-to-open" } }), "ready-to-open");
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "awaiting-conflict-resolution" } }),
    "ready-to-open",
  );
  assert.equal(sidebarStateFromRun({ activeRun: { status: "committing" } }), "promoting");
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "recovering-transaction" } }),
    "promoting",
  );

  // A settled round with no effective change keeps its own state: falling back
  // to preview-ready would hide the no-change decision copy in the bar.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "no-change" } }), "no-change");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "no-change" } }),
    ).label,
    "无变化",
  );
  assert.equal(sidebarStateFromRun({ activeRun: { status: "error" } }), "run-error");

  // Reviewing wins: the review surface is read-only whatever the run says.
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "processing" }, reviewing: true }),
    "review-view",
  );
});

test("a matching failed handoff takes priority over a still-processing Request", () => {
  const activeRun = {
    requestId: "req_current",
    attemptId: "attempt_001",
    status: "processing",
  };
  assert.equal(
    sidebarStateFromRun({
      activeRun,
      activeHandoff: {
        requestId: "req_current",
        attemptId: "attempt_001",
        mode: "managed-agent",
        status: "failed",
        retryable: true,
      },
    }),
    "run-error",
  );
  assert.equal(
    sidebarStateFromRun({
      activeRun,
      activeHandoff: {
        requestId: "req_current",
        attemptId: "attempt_001",
        mode: "clipboard",
        status: "failed",
      },
    }),
    "processing",
  );
  assert.equal(
    sidebarStateFromRun({
      activeRun,
      activeHandoff: {
        requestId: "req_old",
        attemptId: "attempt_001",
        status: "failed",
      },
    }),
    "processing",
  );
  assert.equal(
    sidebarStateFromRun({
      activeRun: { ...activeRun, completionObserved: true },
      activeHandoff: {
        requestId: "req_current",
        attemptId: "attempt_001",
        status: "failed",
      },
    }),
    "processing",
  );
});

test("execution status derives elapsed time and received bytes from the public projection", () => {
  const startedAt = Date.parse("2026-08-26T12:00:00.000Z");
  const status = sidebarExecutionStatus({
    state: "processing",
    providerName: "Codex",
    startedAt: new Date(startedAt).toISOString(),
    receivedBytes: 2_048,
    now: startedAt + 125_000,
  });
  assert.equal(status.title, "Codex 正在生成");
  assert.equal(status.detail, "正在接收结果 · 已用时 02:05");
  assert.equal(
    sidebarExecutionStatus({
      state: "processing",
      providerName: "Qoder",
      startedAt: null,
      receivedBytes: 0,
      now: startedAt,
    }).detail,
    "正在等待响应 · 已用时 00:00",
  );
  assert.equal(sidebarExecutionStatus({ state: "validating" }), null);
});

test("conflict and failed results keep their recovery decisions in the conversation", () => {
  const conflict = sidebarActionBar({
    state: "ready-to-open",
    runStatus: "awaiting-conflict-resolution",
  });
  assert.deepEqual(
    conflict.actions.map((action) => action.id),
    ["adopt-ai", "keep-external"],
  );

  const failure = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureMessage: "Candidate validation failed",
  });
  assert.equal(failure.title, "生成中断");
  assert.equal(failure.detail, "Candidate validation failed 页面未修改");
  assert.deepEqual(failure.actions.map((action) => action.id), [
    "resend-agent", "dismiss",
  ]);

  const nonRetryable = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureCode: "AGENT_RESTART_RECOVERY_REQUIRED",
    failureRetryable: false,
  });
  assert.equal(nonRetryable.title, "生成失败");
  assert.match(nonRetryable.detail, /本轮没有收到可用的完成结果。 页面未修改/u);
  assert.deepEqual(nonRetryable.actions.map((action) => action.id), ["dismiss"]);
  assert.ok(nonRetryable.actions.length <= 2);

  const expiredKey = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureMessage: "DeepSeek 的 API Key 已失效",
    failureRecoveryKind: "reauthenticate",
    credentialKind: "api-token",
  });
  assert.equal(expiredKey.title, "API Key 已失效");
  assert.match(expiredKey.detail, /页面和本轮要求已保留/u);
  assert.deepEqual(expiredKey.actions.map((action) => action.id), [
    "replace-api-key", "dismiss",
  ]);
});

test("structured recovery kinds expose only actions that can resolve the failure", () => {
  const matrix = [
    ["retry", ["resend-agent", "dismiss"]],
    ["wait", ["retry-later", "dismiss"]],
    ["reauthenticate", ["reauthenticate-agent", "dismiss"]],
    ["change-model", ["change-agent-model", "dismiss"]],
    ["change-provider", ["change-agent-provider", "copy-task"]],
    ["repair-installation", ["repair-agent-installation", "dismiss"]],
    ["end", ["dismiss"]],
  ];
  for (const [failureRecoveryKind, actions] of matrix) {
    const result = sidebarActionBar({
      state: "run-error",
      failureMessage: "结构化失败原因。",
      failureRecoveryKind,
      failureRetryable: failureRecoveryKind !== "end",
    });
    assert.deepEqual(result.actions.map((action) => action.id), actions);
    assert.match(result.detail, /结构化失败原因。 页面未修改/u);
    assert.ok(result.actions.length <= 2);
  }
});

test("history groups use exact Request identity and leave legacy messages historical", () => {
  const turns = [
    {
      turnId: "turn_old",
      requestId: "req_old",
      attemptId: "attempt_001",
      startedAt: "2026-08-25T10:30:00.000",
    },
    {
      turnId: "turn_current",
      requestId: "req_current",
      attemptId: "attempt_001",
      startedAt: "2026-08-26T10:51:00.000",
    },
    {
      turnId: "turn_old_same_day",
      requestId: "req_old_same_day",
      attemptId: "attempt_002",
      startedAt: "2026-08-25T14:30:00.000",
    },
  ];
  const messages = [
    factMessage({
      messageId: "message_old",
      turnId: "turn_old",
      createdAt: "2026-08-25T10:31:00.000",
      requestId: "req_old",
      attemptId: "attempt_001",
    }),
    factMessage({
      messageId: "message_old_same_day",
      turnId: "turn_old_same_day",
      createdAt: "2026-08-25T14:31:00.000",
      requestId: "req_old_same_day",
      attemptId: "attempt_002",
    }),
    factMessage({
      messageId: "message_legacy",
      turnId: "turn_legacy",
      createdAt: "2026-08-26T11:00:00.000",
      requestId: null,
      attemptId: null,
    }),
    factMessage({
      messageId: "message_current",
      turnId: "turn_current",
      createdAt: "2026-08-26T10:52:00.000",
    }),
  ];
  const groups = sidebarConversationGroups({
    messages,
    turns,
    activeRun: { requestId: "req_current", attemptId: "attempt_001" },
    now: Date.parse("2026-08-26T12:00:00.000"),
  });
  assert.deepEqual(groups.map((group) => [group.kind, group.label, group.messageIds]), [
    ["history", "8月25日 · 历史对话", ["message_old"]],
    ["history", "8月25日 · 历史对话", ["message_old_same_day"]],
    ["history", "8月26日 · 历史对话", ["message_legacy"]],
    ["current", "今天 10:51 · 本轮修改", ["message_current"]],
  ]);
  assert.equal(groups.some((group) => group.kind === "current" && group.messageIds.includes("message_legacy")), false);
});

test("a pending submission error without a handoff cannot offer a dead resend", () => {
  assert.equal(sidebarFailureRetryable({ requestId: "pending" }, null), false);
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "request_001", attemptId: "attempt_001" },
      { requestId: "request_001", attemptId: "attempt_001", retryable: true },
    ),
    true,
  );
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "request_001", attemptId: "attempt_001" },
      { requestId: "request_001", attemptId: "attempt_001", retryable: false },
    ),
    false,
  );
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "request_001", attemptId: "attempt_001" },
      {
        requestId: "request_001",
        attemptId: "attempt_001",
        retryable: true,
        safeToRetry: false,
      },
    ),
    false,
  );
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "pending", attemptId: "attempt_002" },
      { requestId: "request_old", attemptId: "attempt_001", retryable: true },
    ),
    false,
  );
  const actionBar = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureRetryable: sidebarFailureRetryable({ requestId: "pending" }, null),
  });
  assert.equal(actionBar.actions.some((action) => action.id === "resend-agent"), false);
});

test("the Composer sends only the page-comment modification", () => {
  // Modify is driven by the comments already on the page, not by the Composer,
  // so it sends without a typed sentence and nothing can be silently dropped.
  const modify = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    hasText: false,
    intent: "modify",
    pendingCommentCount: 2,
  });
  assert.equal(modify.canSend, true);
  assert.equal(modify.label, "交给 Agent 修改");
  assert.equal(modify.reason, null);

  // With nothing written there is nothing for the Agent to act on, and the
  // button says where to write it rather than only greying out.
  const empty = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 0,
  });
  assert.equal(empty.canSend, false);
  assert.equal(empty.reason, "先在编辑模式写下评论，AI 会按评论改");

  const continued = sidebarSendState({
    state: "ready-to-open",
    catalogStatus: "ready",
    hasText: true,
    intent: "continue",
  });
  assert.equal(continued.canSend, false);
  assert.equal(continued.kind, "status");
  assert.equal(continued.label, "");
  assert.equal(continued.reason, null);
});

test("copying the task stays available when the model catalog is not", () => {
  // The send button needs Qoder; the clipboard beside it does not. A host
  // without the CLI is the common case, and PRD §10.2 keeps the copy path
  // open through every catalog status rather than greying out both buttons.
  for (const catalogStatus of ["checking", "auth-required", "not-installed", "unavailable"]) {
    const send = sidebarSendState({
      state: "preview-ready",
      catalogStatus,
      intent: "modify",
      pendingCommentCount: 1,
    });
    assert.equal(send.canSend, false, `${catalogStatus} must still block the send button`);
    const copy = sidebarCopyTaskState({
      state: "preview-ready",
      pendingCommentCount: 1,
    });
    assert.deepEqual(
      copy,
      { canCopy: true, reason: null },
      `${catalogStatus} must not take the clipboard path down with the catalog`,
    );
  }
});

test("copying still needs a quiet round with comments to freeze", () => {
  // With nothing written there is nothing to hand to any Agent.
  const empty = sidebarCopyTaskState({ state: "preview-ready", pendingCommentCount: 0 });
  assert.equal(empty.canCopy, false);
  assert.equal(empty.reason, "先在编辑模式写下评论，AI 会按评论改");

  // A round already in flight owns the comments; a second delivery of the
  // same round must wait for it.
  const queued = sidebarCopyTaskState({ state: "preview-ready", queued: true, pendingCommentCount: 2 });
  assert.equal(queued.canCopy, false);
  assert.equal(queued.reason, "正在等待上一个任务完成");
  for (const state of ["preparing-delivery", "processing", "validating", "promoting"]) {
    const running = sidebarCopyTaskState({ state, pendingCommentCount: 2 });
    assert.equal(running.canCopy, false, `${state} must block copying`);
    assert.ok(running.reason, `${state} must say why copying is unavailable`);
  }
  assert.deepEqual(
    sidebarCopyTaskState({ state: "ready-to-open", pendingCommentCount: 2 }),
    { canCopy: false, reason: null },
  );

  // Review is read-only: the decision bar owns the next step there.
  const reviewing = sidebarCopyTaskState({ state: "review-view", pendingCommentCount: 2 });
  assert.equal(reviewing.canCopy, false);
  assert.equal(reviewing.reason, null);

  // Settled without a change keeps the comments, so the user may re-send.
  const settled = sidebarCopyTaskState({ state: "no-change", pendingCommentCount: 2 });
  assert.equal(settled.canCopy, true);
});

test("the review Canvas keeps the thread on screen but refuses a new round", () => {
  // The candidate on screen is not a new modification source. State is the
  // single owner of that fact, so a reviewing run and an explicit review state agree.
  assert.equal(sidebarStateFromRun({ reviewing: true }), "review-view");

  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "ready",
    hasText: true,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, null);

  const mode = sidebarModePresentation("review-view");
  assert.equal(mode.label, "审阅中");
});

test("review refuses a round even when the model catalog is still checking", () => {
  // Reviewing outranks every other disabled reason, so the user never sees the
  // Composer blame the model catalog for something the Canvas decided.
  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "checking",
    hasText: true,
  });
  assert.equal(send.reason, null);
});

test("a queued round blocks the modify intent instead of stacking a second Request", () => {
  const send = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 3,
    queued: true,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, "正在等待上一个任务完成");
});

test("a round in flight reads inside the thread instead of only in the drawer", () => {
  const steps = [
    { key: "handoff", label: "启动 Qoder CLI", detail: "已建立会话", state: "done" },
    { key: "agent", label: "AI 正在修改", detail: "正在写入候选", state: "current" },
    { key: "verify", label: "核对结果", detail: "尚未开始", state: "pending" },
  ];
  const progress = sidebarRunProgress({ state: "processing", steps });

  // The list already shows which step is live, so no headline repeats its label and
  // the detail rides on the stage it belongs to.
  assert.equal(progress.headline, null);
  assert.equal(progress.steps[1].detail, "正在写入候选");
  assert.equal(progress.tone, "quiet");
  assert.equal(progress.steps.length, 3);

  // Details ride along only for the live step; otherwise a short status turns
  // into a wall of text.
  assert.equal(progress.steps[0].detail, null);
  assert.equal(progress.steps[2].detail, null);
});

test("a failed step is what the progress entry leads with", () => {
  const progress = sidebarRunProgress({
    state: "processing",
    steps: [
      { key: "handoff", label: "启动 Qoder CLI", state: "done" },
      { key: "agent", label: "AI 正在修改", detail: "仍在进行", state: "current" },
      { key: "verify", label: "核对失败", state: "failed" },
    ],
  });
  assert.equal(progress.headline, "核对失败");
  assert.equal(progress.tone, "attention");
});

test("progress belongs to a moving round only", () => {
  const steps = [{ key: "handoff", label: "启动 Qoder CLI", state: "done" }];
  // The result states keep the record: with the process drawer gone, the thread is
  // the only place the round's stages exist while the user decides.
  assert.ok(sidebarRunProgress({ state: "ready-to-open", steps }));
  assert.ok(sidebarRunProgress({ state: "review-view", steps }));
  // A surface with no round at all still says nothing.
  assert.equal(sidebarRunProgress({ state: "preview-ready", steps }), null);
  // No steps means nothing to say.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [] }), null);
  // Malformed entries are dropped rather than rendered as blanks.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [{ label: "无 key" }] }), null);
});

test("the idle mode describes the only available modification action", () => {
  const pending = sidebarModePresentation("preview-ready");
  assert.equal(pending.label, "待发送");

  // Once a round exists, its durable status wins again — the intent cannot dress
  // a running execution up as something pending.
  assert.equal(sidebarModePresentation("processing").label, "处理中");
  assert.equal(sidebarModePresentation("review-view").label, "审阅中");
});

test("the clipboard round says what is actually happening and keeps the task reachable", () => {
  // Nothing is being processed by Qoder here: the user pasted the task into an
  // Agent of their own. Claiming otherwise would describe something that is not
  // happening, and re-copying is the one action a failed paste needs.
  const clipboard = sidebarActionBar({ state: "processing", deliveryMode: "clipboard" });
  assert.equal(clipboard.title, "任务已复制，等你的 AI 改完");
  assert.deepEqual(clipboard.actions.map((action) => action.id), ["recopy", "cancel"]);
  // Nothing here advances the round, so nothing takes the accent.
  assert.deepEqual(clipboard.actions.map((action) => action.tone), ["quiet", "quiet"]);

  // The clipboard instruction is not narration: the timeline cannot say "now go
  // paste it". The managed path has nothing of that kind to add, so it says nothing
  // and leaves the narration to the timeline above it.
  const managed = sidebarActionBar({ state: "processing", deliveryMode: "managed-agent" });
  assert.equal(managed.title, null);
  assert.equal(managed.detail, null);
  assert.deepEqual(managed.actions.map((action) => action.id), ["cancel"]);

  // And the clipboard detail no longer repeats the header sentence either.
  assert.equal(clipboard.detail, "粘贴给任意能读写本机文件的 AI。");

  const copyFailure = sidebarActionBar({
    state: "processing",
    deliveryMode: "clipboard",
    handoffStatus: "failed",
  });
  assert.equal(copyFailure.title, "任务还没复制成功");
  assert.equal(copyFailure.detail, "本轮要求已保留，可以重新复制。");
  assert.deepEqual(copyFailure.actions.map((action) => action.id), ["recopy", "cancel"]);

  // The decision is the same for both destinations: a candidate is a candidate.
  for (const mode of ["clipboard", "managed-agent"]) {
    const decision = sidebarActionBar({
      state: "ready-to-open",
      deliveryMode: mode,
      candidateVersionLabel: "版本 2",
    });
    assert.equal(decision.title, "修改已准备好，尚未采用");
    assert.deepEqual(decision.actions.map((action) => action.id), ["review"]);
  }
});

test("the selected Agent narrates the round while PageRoot states the stage", () => {
  const steps = [
    { key: "handoff", label: "Qoder CLI 已启动", state: "done" },
    { key: "agent", label: "等待 AI 完成", detail: "正在执行本轮要求", state: "current" },
  ];
  const progress = sidebarRunProgress({
    state: "processing",
    steps,
    agentText: "  正在把标题换成 2026 Q2 产品健康度回顾  ",
  });

  // ADR 0037 §4: the Agent's words are an annotation, and the stage still comes from
  // the run's own status — the prose cannot claim a stage is finished.
  assert.equal(progress.narration, "正在把标题换成 2026 Q2 产品健康度回顾");
  assert.equal(progress.liveLabel, "等待 AI 完成");
  assert.equal(progress.steps[1].state, "current");

  // Nothing said means no narration block, so the view never renders an empty shell
  // with a toggle that opens onto nothing.
  assert.equal(sidebarRunProgress({ state: "processing", steps }).narration, null);
  assert.equal(
    sidebarRunProgress({ state: "processing", steps, agentText: "   " }).narration,
    null,
  );
});

test("live Agent narration carries its bounded-text fact and local timestamp", () => {
  const progress = sidebarRunProgress({
    state: "processing",
    steps: [{ key: "agent", label: "Codex 正在修改", state: "current" }],
    agentText: "已读取冻结的任务。",
    agentTextTruncated: true,
  });
  assert.equal(progress.narrationTruncated, true);
  assert.equal(progress.liveLabel, "Codex 正在修改");
  const eventTimestamp = "2026-08-26T12:04:00.000Z";
  const now = Date.parse("2026-08-26T12:14:00.000Z");
  const localEvent = new Date(eventTimestamp);
  const expectedLocalTime = `${String(localEvent.getHours()).padStart(2, "0")}:${String(localEvent.getMinutes()).padStart(2, "0")}`;
  assert.equal(
    sidebarTimestampLabel(eventTimestamp, { now }),
    expectedLocalTime,
  );
  assert.equal(sidebarTimestampLabel("not-a-date"), null);
});

test("public Agent narration remains available with the completed Candidate decision", () => {
  const progress = sidebarRunProgress({
    state: "ready-to-open",
    steps: [
      { key: "agent", label: "Codex 已完成", state: "done" },
      { key: "result", label: "AI 修改已完成，可以审阅", state: "current" },
    ],
    agentText: "Candidate 已交给 PageRoot 校验。",
  });
  assert.equal(progress.narration, "Candidate 已交给 PageRoot 校验。");
  assert.equal(progress.liveLabel, null);
});

test("canonical Agent updates render as stable rows under one Agent identity", () => {
  const steps = [{ key: "agent", label: "等待 AI 完成", state: "current" }];
  const progress = sidebarRunProgress({
    state: "processing",
    steps,
    agentText: "先读清单和依赖文件。再写候选 HTML。",
    agentUpdates: [
      { id: "update-1", sequence: 1, text: "先读清单和依赖文件。" },
      { id: "update-2", sequence: 2, text: "再写候选 HTML。" },
    ],
  });

  assert.deepEqual(progress.narrationUpdates, [
    { id: "update-1", text: "先读清单和依赖文件。" },
    { id: "update-2", text: "再写候选 HTML。" },
  ]);

  assert.deepEqual(
    sidebarRunProgress({ state: "processing", steps, agentText: "只有一句。" }).narrationUpdates,
    [{ id: "legacy:0", text: "只有一句。" }],
  );
  assert.equal(sidebarRunProgress({ state: "processing", steps }).narrationUpdates, null);
});

test("every speaker has an avatar mark, so the thread reads as a chat", () => {
  // The thread had no avatars at all, which is why the run activity looked like a
  // panel parked in the sidebar instead of someone speaking in it.
  assert.equal(sidebarActorInitial("user"), "你");
  assert.equal(sidebarActorInitial("qoder"), "Q");
  assert.equal(sidebarActorInitial("pageroot"), "P");
  // An unknown actor still gets a mark rather than an empty square.
  assert.equal(sidebarActorInitial("someone-else"), "P");
});

test("the conversation sidebar routes access repair to Settings", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/workbench/AiConversationSidebar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<BoundAgentSetupPanel|ai-conversation-setup-panel/u);
  assert.match(source, /onOpenAgentSettings/u);
  assert.doesNotMatch(source, /ai-conversation-service-choices/u);
  assert.match(source, /replace-api-key/u);
  assert.match(source, /不会对当前文件发送/u);
  assert.match(source, /onQueueDefault/u);
  assert.match(source, /onBeginAccessRepair/u);
  assert.doesNotMatch(source, /useState<null \| Readonly<\{\s*documentId: string;/u);
});

test("adoption uncertainty takes precedence over Review and exposes no opposite decision", () => {
  for (const adoptionPhase of ["applying", "unknown"]) {
    const state = sidebarStateFromRun({ activeRun: { status: "ready-to-open", adoptionPhase }, reviewing: true });
    assert.equal(state, adoptionPhase === "unknown" ? "adoption-unknown" : "promoting");
    const bar = sidebarActionBar({ state });
    assert.deepEqual(bar.actions, []);
    assert.equal(sidebarSendState({ state }).canSend, false);
    if (adoptionPhase === "unknown") assert.equal(bar.title, "采用结果待确认");
  }
});

test("turn presentation preserves Conversation sequence across Agent and Stemmio facts", async () => {
  const { sidebarTurnPresentation } = await import("../app/workbench/ai-conversation-model.js");
  const requirements = factMessage({ actor: "user", text: "调整标题" });
  const progress = factMessage({ kind: "progress", text: "正在生成修改。" });
  const summary = factMessage({ actor: "agent", kind: "result-summary", text: "标题已缩短。" });
  const result = factMessage({ kind: "result-summary", text: "修改已准备好，尚未采用。" });
  const ended = factMessage({ actor: "agent", kind: "progress", text: "本轮执行已结束。" });
  const decision = factMessage({ kind: "decision-outcome", text: "已采用本次修改。" });
  const presentation = sidebarTurnPresentation([requirements, progress, summary, result, ended, decision]);
  assert.deepEqual(presentation.primary, [requirements, summary, result, decision]);
  assert.deepEqual(presentation.process, [progress, ended]);
  assert.deepEqual(presentation.timeline.map((block) => block.messages), [
    [requirements], [progress], [summary], [result], [ended], [decision],
  ]);
});


test("stored provider identities keep their names instead of becoming a generic AI Agent", () => {
  assert.deepEqual(sidebarMessageStream(["qoder", "codex", "pageroot"].map((providerId) => factMessage({ actor: "agent", providerId }))).map((message) => message.actorLabel), ["Qoder", "Codex", "Stemmio AI"]);
});

test("process blocks preserve executor boundaries and narration sentences survive display", async () => {
  const { sidebarTurnPresentation, sidebarNarrationParagraphs } = await import('../app/workbench/ai-conversation-model.js');
  const messages = [
    { messageId: 'a', actor: 'pageroot', actorLabel: 'Stemmio', kind: 'progress', text: '交付任务' },
    { messageId: 'b', actor: 'agent', actorLabel: 'Codex', kind: 'progress', text: '读取资料' },
    { messageId: 'c', actor: 'pageroot', actorLabel: 'Stemmio', kind: 'progress', text: '准备审阅' },
  ];
  assert.deepEqual(sidebarTurnPresentation(messages).timeline.map(block => block.messages[0].actor), ['pageroot', 'agent', 'pageroot']);
  assert.deepEqual(sidebarNarrationParagraphs('读取资料。生成结果。\n\n版本 1.2 保持原样。'), ['读取资料。', '生成结果。', '版本 1.2 保持原样。']);
});


test("sidebar local facts reject the previous Document before a new load and preserve close draft lock", () => {
  const context = { projectId: "project_one", documentId: "doc_one", draftReadOnly: false };
  const messages = [{ text: "private document one history" }];
  const snapshot = { status: "ready", context, title: "One", messages, draftText: "unsent one", conversation: { turns: [] } };
  const ready = sidebarConversationPresentation(snapshot, context);
  assert.equal(ready.messages, messages);
  assert.equal(ready.draftText, "unsent one");
  assert.equal(ready.draftAvailable, true);
  assert.equal(ready.loading, false);
  for (const changed of [{ ...context, documentId: "doc_two" }, { ...context, projectId: "project_two" }]) {
    const pending = sidebarConversationPresentation(snapshot, changed);
    assert.deepEqual(pending.messages, []);
    assert.equal(pending.draftText, "");
    assert.equal(pending.draftAvailable, false);
    assert.equal(pending.loading, true);
  }
  const closing = sidebarConversationPresentation(snapshot, { ...context, draftReadOnly: true });
  assert.equal(closing.draftAvailable, false);
  assert.equal(closing.messages, messages);
  assert.equal(closing.draftText, "unsent one");
  assert.equal(sidebarConversationPresentation(snapshot, context).draftAvailable, true);
  assert.equal(sidebarConversationPresentation({ ...snapshot, status: "failed" }, context).draftAvailable, false);
});
