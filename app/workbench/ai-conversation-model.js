// Presentation rules for the AI conversation sidebar.
//
// Pure and DOM-free so the two load-bearing structure rules can be pinned by a
// Node test instead of only by review:
//
//   - The message stream carries immutable facts only. Nothing here can attach
//     an action to a message, and a stored message that somehow carries an
//     interface member is refused rather than rendered.
//   - The action bar is derived from current product state, never read from a
//     message. Scrolling back through history therefore cannot surface a stale
//     button, and a pending decision cannot scroll out of view.

/**
 * The product state the sidebar reflects. It mirrors the run lifecycle rather
 * than inventing a second one.
 */
const SIDEBAR_STATES = new Set([
  "preview-ready",
  "preparing-delivery",
  "processing",
  "validating",
  "ready-to-open",
  "review-view",
  "promoting",
  "adoption-unknown",
  "run-error",
]);

const INTENT_MODIFY = "modify";
const INTENT_CONTINUE = "continue";

// A message must never grow interface state. The repository refuses these on
// write; the view refuses them again on read so a record written by some other
// build can never turn the fact stream into a card surface.
const FORBIDDEN_MESSAGE_KEYS = [
  "actions",
  "buttons",
  "cardState",
  "disabled",
  "pending",
  "controls",
];

const ACTOR_LABELS = Object.freeze({
  user: "我",
  agent: "AI Agent",
  qoder: "Qoder CLI",
  pageroot: "Stemmio",
});

const MODE_PRESENTATION = Object.freeze({
  "preview-ready": {
    label: "待发送",
  },
  "preparing-delivery": {
    label: "准备中",
  },
  processing: {
    label: "处理中",
  },
  validating: {
    label: "检查结果",
  },
  "ready-to-open": {
    label: "待决定",
  },
  "review-view": {
    label: "审阅中",
  },
  "adoption-unknown": { label: "采用结果待确认" },
  promoting: {
    label: "采用中",
  },
  "run-error": {
    label: "需要处理",
  },
  // A round that produced nothing new: the round is over, but it is still this
  // thread's fact to state, not a return to the idle preview.
  "no-change": {
    label: "无变化",
  },
});

export function sidebarModePresentation(state) {
  return MODE_PRESENTATION[state] ?? MODE_PRESENTATION["preview-ready"];
}

// The header's mode comes from the run's own durable status, never from a local
// guess. Any second
// lifecycle kept in the view would eventually drift from the Request record.
const RUN_STATUS_TO_SIDEBAR_STATE = Object.freeze({
  submitting: "preparing-delivery",
  processing: "processing",
  validating: "validating",
  "ready-to-open": "ready-to-open",
  "awaiting-conflict-resolution": "ready-to-open",
  committing: "promoting",
  "recovering-transaction": "promoting",
  // A settled-without-change round still needs its decision said in the thread:
  // without this row the sidebar falls back to preview-ready and the
  // no-change action bar below becomes unreachable dead copy.
  "no-change": "no-change",
  error: "run-error",
});

export function sidebarStateFromRun({
  activeRun = null,
  activeHandoff = null,
  submissionPending = false,
  reviewing = false,
} = {}) {
  if (activeRun?.adoptionPhase === "unknown") return "adoption-unknown";
  if (activeRun?.adoptionPhase === "applying") return "promoting";
  if (reviewing) return "review-view";
  const mapped = RUN_STATUS_TO_SIDEBAR_STATE[String(activeRun?.status || "")];
  const handoffMatchesRun = Boolean(
    activeRun
    && activeHandoff
    && activeRun.requestId
    && activeRun.attemptId
    && activeHandoff.requestId === activeRun.requestId
    && activeHandoff.attemptId === activeRun.attemptId
  );
  const completionObserved = Boolean(
    activeRun?.completionObserved === true
    || [
      "validating",
      "committing",
      "ready-to-open",
      "awaiting-conflict-resolution",
      "recovering-transaction",
      "no-change",
      "complete",
    ].includes(String(activeRun?.status || ""))
    || activeRun?.readyPayload
    || activeRun?.candidateAssessment,
  );
  // A durable Request may still say processing after its managed handoff has
  // failed. The matching identity is required so a stale handoff from another
  // attempt can never turn the current round into an error. A real completion
  // or Candidate observation retains the existing completion authority.
  if (
    mapped === "processing"
    && handoffMatchesRun
    && activeHandoff.mode === "managed-agent"
    && ["failed", "interrupted"].includes(String(activeHandoff.status || ""))
    && completionObserved === false
  ) return "run-error";
  if (mapped) return mapped;
  // A submission being prepared is authority in flight, not yet a run.
  if (submissionPending) return "preparing-delivery";
  return "preview-ready";
}

/**
 * The run's own progress, projected for the conversation. The process drawer used
 * to be the only place this existed, which made a round feel like it left the
 * workbench; here it reads as the turn currently in flight.
 *
 * Only the states where a round is actually moving return an entry. A settled
 * round is represented by its result, not by a frozen checklist.
 */
const MAX_NARRATION_BLOCKS = 80;

const RUN_PROGRESS_STATES = Object.freeze([
  "preparing-delivery",
  "processing",
  "validating",
  "promoting",
  "adoption-unknown",
  // The result states keep the record on screen. The process drawer used to be the
  // only place the round's stages existed, so once it is gone the thread has to
  // hold them — a user deciding whether to adopt still wants to see what happened.
  "ready-to-open",
  "review-view",
]);

export function sidebarRunProgress({
  state,
  steps = [],
  agentText = "",
  agentUpdates = [],
  agentTextTruncated = false,
} = {}) {
  if (!RUN_PROGRESS_STATES.includes(String(state))) return null;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const projected = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const key = typeof step.key === "string" ? step.key : "";
    const label = typeof step.label === "string" ? step.label.trim() : "";
    if (!key || !label) continue;
    projected.push(Object.freeze({
      key,
      label,
      // The detail only rides along for the step being worked on. Showing every
      // detail at once turns a short status into a wall of text.
      detail: step.state === "current" && typeof step.detail === "string"
        ? step.detail.trim() || null
        : null,
      state: typeof step.state === "string" ? step.state : "pending",
    }));
  }
  if (projected.length === 0) return null;
  const failedStep = projected.find((step) => step.state === "failed") || null;
  const liveStep = projected.find((step) => step.state === "current") || null;
  // ADR 0037: the Agent narrates, PageRoot states the stage. The prose is an
  // annotation on the stage actually running and never claims a stage is done.
  // Canonical visible-text events preserve the Agent's public message boundaries.
  // A blank-line split remains only for sessions recovered from the older cumulative
  // text contract; the count matches the Bridge projection's bounded DOM budget.
  const narration = typeof agentText === "string" ? agentText.trim() : "";
  const projectedUpdates = [];
  const seenUpdateIds = new Set();
  for (const update of Array.isArray(agentUpdates) ? agentUpdates.slice(0, MAX_NARRATION_BLOCKS) : []) {
    if (!update || typeof update !== "object") continue;
    const id = String(update.id || "").trim().slice(0, 200);
    const text = String(update.text || "").trim();
    if (!id || !text || seenUpdateIds.has(id)) continue;
    seenUpdateIds.add(id);
    projectedUpdates.push(Object.freeze({ id, text }));
  }
  const fallbackBlocks = narration
    ? narration
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean)
      .slice(0, MAX_NARRATION_BLOCKS)
      .map((text, index) => Object.freeze({ id: `legacy:${index}`, text }))
    : [];
  const narrationUpdates = projectedUpdates.length > 0 ? projectedUpdates : fallbackBlocks;
  const narrationText = narration || projectedUpdates.map((update) => update.text).join("");
  const decisionOwnsSettledStatus = state === "ready-to-open" || state === "review-view";
  return Object.freeze({
    steps: Object.freeze(projected),
    // Only a failure gets its own line. The list already shows which step is live at
    // full strength, and each stage carries its own detail, so nothing is repeated
    // above it.
    headline: failedStep?.label ?? null,
    // Public Agent narration is projected separately from PageRoot's lifecycle
    // facts. It never grants Candidate authority.
    narration: narrationText || null,
    narrationUpdates: narrationUpdates.length > 0 ? Object.freeze(narrationUpdates) : null,
    narrationTruncated: agentTextTruncated === true,
    // Once a Candidate decision exists, its signed PageRoot message is the sole
    // settled-status line. Keeping the completed progress step beside it repeated
    // the same fact and recreated the PageRoot message pile this UI removes.
    liveLabel: decisionOwnsSettledStatus ? null : liveStep?.label ?? null,
    tone: failedStep ? "attention" : "quiet",
  });
}

const ACTOR_INITIALS = Object.freeze({
  user: "你",
  agent: "A",
  qoder: "Q",
  pageroot: "P",
});

/**
 * The mark shown in a message avatar. Short by design: a chat is scanned by who is
 * speaking, and a full name in that square would only shrink the words beside it.
 */
export function sidebarActorInitial(actor) {
  return ACTOR_INITIALS[actor] ?? ACTOR_INITIALS.pageroot;
}

export function sidebarActorLabel(actor) {
  return ACTOR_LABELS[actor] ?? ACTOR_LABELS.pageroot;
}

export function sidebarTimestampLabel(value, { now = Date.now() } = {}) {
  const timestamp = Date.parse(String(value || ""));
  const reference = Number(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(reference)) return null;
  const date = new Date(timestamp);
  const current = new Date(reference);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (
    date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate()
  ) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/**
 * Projects stored messages for display. A message that carries an interface
 * member is dropped: the fact stream is immutable by contract, and silently
 * rendering such a record would reintroduce the stale-button problem the
 * contract exists to prevent.
 */
export function sidebarMessageStream(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => (
      message
      && typeof message === "object"
      && !FORBIDDEN_MESSAGE_KEYS.some((key) => key in message)
    ))
    .map((message) => ({
      messageId: String(message.messageId || ""),
      actor: String(message.actor || "pageroot"),
      actorLabel: message.actor === "agent"
        ? ({ qoder: "Qoder", codex: "Codex", pageroot: "Stemmio AI" }[message.providerId] || sidebarActorLabel(message.actor))
        : sidebarActorLabel(message.actor),
      kind: String(message.kind || "text"),
      status: String(message.status || "completed"),
      text: message.actor === "pageroot" && message.text === "修改已准备好，尚未采用。"
        ? "修改已准备好。" : String(message.text || ""),
      truncated: message.truncated === true,
      sequence: Number(message.sequence) || 0,
      createdAt: String(message.createdAt || ""),
      modelDisplayName: message.modelDisplayName || null,
      turnId: String(message.turnId || "") || null,
      requestId: String(message.requestId || "") || null,
      attemptId: String(message.attemptId || "") || null,
    }));
}

// Older receipts used text for fixed stage facts. Preserve those records while
// presenting them with the same disclosure as newly typed progress messages.
const LEGACY_EXECUTION_PROGRESS = new Set([
  "已开始执行本轮修改。", "正在建立执行会话。", "已发出本轮修改要求。",
  "已收到服务响应。", "正在生成修改。", "本轮结果接收结束。",
  "正在读取本轮资料。", "正在写入修改结果。", "正在核对修改结果。",
  "正在校验修改结果。", "正在准备审阅。", "已请求停止，正在等待确认。",
  "执行已结束，结果仍需校验。",
]);

export function sidebarTurnPresentation(messages = []) {
  const process = [];
  const primary = [];
  for (const message of messages) {
    if (message.kind === "progress" || (message.actor === "pageroot" && LEGACY_EXECUTION_PROGRESS.has(message.text))) process.push(message);
    else primary.push(message);
  }
  const timeline = [];
  // Conversation messages already carry a strictly increasing sequence from
  // the single Repository writer. Preserve that chronology across speakers:
  // regrouping by actor made older Agent narration jump below newer Stemmio
  // facts and left the live status detached at the bottom.
  for (const message of messages) {
    const isProcess = process.includes(message);
    const previous = timeline.at(-1);
    if (isProcess && previous?.process && previous.messages[0].actor === message.actor
      && previous.messages[0].actorLabel === message.actorLabel) previous.messages.push(message);
    else timeline.push({ process: isProcess, messages: [message] });
  }
  return { primary, process, timeline };
}

function historyIdentity(value) {
  const text = String(value ?? "").trim();
  return text && text !== "null" && text !== "undefined" ? text : null;
}

function historyTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function historyTimeLabel(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function historyDateKey(timestamp) {
  if (!Number.isFinite(timestamp)) return "unknown";
  const date = new Date(timestamp);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function historyDateLabel(timestamp) {
  if (!Number.isFinite(timestamp)) return "历史对话";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 · 历史对话`;
}

function currentTurnLabel(timestamp, now) {
  const effectiveTimestamp = Number.isFinite(timestamp) ? timestamp : Number(now);
  if (!Number.isFinite(effectiveTimestamp)) return "本轮修改";
  const date = new Date(effectiveTimestamp);
  const currentDate = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now());
  const sameDay = date.getFullYear() === currentDate.getFullYear()
    && date.getMonth() === currentDate.getMonth()
    && date.getDate() === currentDate.getDate();
  const prefix = sameDay ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${historyTimeLabel(effectiveTimestamp) || "00:00"} · 本轮修改`;
}

/**
 * Derives compact turn/date boundaries for the fact stream. The grouping never
 * mutates or migrates the stored conversation: request and attempt identity are
 * read from the message/turn projection, and records without both identities
 * remain historical even when they share today's date.
 */
export function sidebarConversationGroups({
  messages = [],
  turns = [],
  activeRun = null,
  activeRequestId = null,
  activeAttemptId = null,
  now = Date.now(),
} = {}) {
  // Use the same immutable fact projection as the renderer. A malformed record
  // rejected by sidebarMessageStream must not shift boundary indexes and label
  // a later visible message with the wrong turn.
  const sourceMessages = sidebarMessageStream(messages);
  const turnById = new Map(
    (Array.isArray(turns) ? turns : [])
      .filter((turn) => turn && typeof turn === "object")
      .map((turn) => [historyIdentity(turn.turnId), turn])
      .filter(([turnId]) => turnId),
  );
  const currentRequestId = historyIdentity(activeRequestId ?? activeRun?.requestId);
  const currentAttemptId = historyIdentity(activeAttemptId ?? activeRun?.attemptId);
  const groups = [];

  sourceMessages.forEach((message, messageIndex) => {
    if (!message || typeof message !== "object") return;
    const turn = turnById.get(historyIdentity(message.turnId));
    const requestId = historyIdentity(message.requestId) || historyIdentity(turn?.requestId);
    const attemptId = historyIdentity(message.attemptId) || historyIdentity(turn?.attemptId);
    const current = Boolean(
      currentRequestId
      && currentAttemptId
      && requestId === currentRequestId
      && attemptId === currentAttemptId,
    );
    const timestamp = historyTimestamp(turn?.startedAt) ?? historyTimestamp(message.createdAt);
    const dateKey = historyDateKey(timestamp);
    const historicalTurnKey = historyIdentity(message.turnId)
      || (requestId && attemptId ? `${requestId}:${attemptId}` : "legacy");
    const key = historicalTurnKey !== "legacy" ? `turn:${historicalTurnKey}` : `history:${dateKey}:legacy`;
    const previous = groups[groups.length - 1];
    if (previous?.key === key) {
      previous.messageIndices.push(messageIndex);
      const messageId = historyIdentity(message.messageId);
      if (messageId) previous.messageIds.push(messageId);
      return;
    }
    const messageId = historyIdentity(message.messageId);
    groups.push({
      key,
      label: `${current ? currentTurnLabel(timestamp, now) : historyDateLabel(timestamp)}${turn?.providerSelection?.providerId ? ` · ${{ qoder: "Qoder", codex: "Codex", pageroot: "HTTP 服务" }[turn.providerSelection.providerId] || "AI"}` : ""}`,
      kind: current ? "current" : "history",
      messageIndices: [messageIndex],
      messageIds: messageId ? [messageId] : [],
    });
  });

  return Object.freeze(groups.map((group) => Object.freeze({
    ...group,
    messageIndices: Object.freeze(group.messageIndices),
    messageIds: Object.freeze(group.messageIds),
  })));
}

export function sidebarResolvedIntent(state) {
  return state === "ready-to-open" || state === "review-view"
    ? INTENT_CONTINUE
    : INTENT_MODIFY;
}

/**
 * Whether a draft-intent write can be made directly. A conversation that is
 * loaded and ready for this very Document has no load ahead of it that would
 * restore a stored draft over the write. Every other state does: a sidebar
 * opened for the first time loads on becoming visible, and a Document switch
 * closes the conversation while leaving the sidebar itself open, so the reopen
 * that follows is headed for a load that discards a plain write.
 */
export function conversationReadyForDocument(conversation, projectId, documentId) {
  return Boolean(
    conversation
    && conversation.status === "ready"
    && conversation.context?.projectId === projectId
    && conversation.context?.documentId === documentId,
  );
}

/** Only the requested Document may supply the sidebar's local draft and history. */
export function sidebarConversationPresentation(snapshot, context) {
  const conversation = snapshot?.context?.projectId === context?.projectId
    && snapshot?.context?.documentId === context?.documentId
    && context?.projectId && context?.documentId ? snapshot : null;
  return {
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    draftText: conversation?.draftText ?? "",
    draftAvailable: context?.draftReadOnly !== true
      && conversationReadyForDocument(conversation, context?.projectId, context?.documentId),
    loading: !conversationLoadedForView(conversation),
    turns: conversation?.conversation?.turns ?? [],
  };
}

/**
 * Whether the conversation stream has settled, so the sidebar may show its
 * loaded content — including the empty state. Loaded is an explicit allowlist:
 * a load that settled with a conversation ("ready"), or one that settled
 * without a conversation while the Document context it loaded for is still
 * attached ("idle" with a context). Everything else reads as not loaded: a
 * null snapshot, a load in flight, the contextless idle the session publishes
 * on subscribe and on deactivate, a failed load, or a status a future version
 * adds. Fail-safe on purpose — the session drops draft writes until it has
 * published a conversation, so the empty-state copy must never invite typing
 * before the load settles: that text is silently lost to the load that
 * follows.
 */
export function conversationLoadedForView(conversation) {
  if (!conversation) return false;
  if (conversation.status === "ready") return true;
  return conversation.status === "idle" && conversation.context != null;
}

export function sidebarFailureRetryable(activeRun, activeHandoff) {
  if (
    activeRun
    && activeHandoff
    && activeHandoff.requestId === activeRun.requestId
    && activeHandoff.attemptId === activeRun.attemptId
  ) return typeof activeHandoff.safeToRetry === "boolean"
    ? activeHandoff.safeToRetry
    : activeHandoff.retryable === true;
  return activeRun?.requestId !== "pending";
}

function boundedAgentName(value) {
  return String(value || "Agent").trim().slice(0, 80) || "Agent";
}

function formatElapsedDuration(elapsedMs) {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function sidebarExecutionStatus({
  state,
  providerName = "Agent",
  startedAt = null,
  receivedBytes = 0,
  now = Date.now(),
} = {}) {
  if (state !== "processing") return null;
  const started = Date.parse(String(startedAt || ""));
  const current = Number(now);
  const elapsedMs = Number.isFinite(started) && Number.isFinite(current)
    ? Math.max(0, current - started)
    : 0;
  const bytes = Number.isSafeInteger(receivedBytes) && receivedBytes > 0
    ? receivedBytes
    : 0;
  return Object.freeze({
    title: `${boundedAgentName(providerName)} 正在生成`,
    detail: `${bytes > 0 ? "正在接收结果" : "正在等待响应"} · 已用时 ${formatElapsedDuration(elapsedMs)}`,
    elapsedMs,
    receivedBytes: bytes,
  });
}

function boundedFailureReason(value) {
  const reason = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
  return reason || "本轮没有收到可用的完成结果。";
}

/**
 * The action bar. Derived entirely from current product state — never from a
 * message — so a decision stays visible at any scroll position and history
 * never renders a live button.
 *
 * Returns null when there is nothing to decide; the bar then occupies no space.
 */
export function sidebarActionBar({
  state,
  runStatus = null,
  candidateVersionLabel = null,
  candidateStatus = null,
  failureMessage = null,
  failureRetryable = true,
  failureRecoveryKind = null,
  deliveryMode = "managed-agent",
  handoffStatus = null,
  credentialKind = null,
} = {}) {
  if (runStatus === "awaiting-conflict-resolution") {
    return {
      kind: "decision",
      title: "源文件在 AI 处理期间发生了外部修改",
      detail: "请选择采用 AI 候选，或保留磁盘上的外部 HTML。",
      actions: [
        { id: "adopt-ai", label: "采用 AI 结果", tone: "primary" },
        { id: "keep-external", label: "保留外部 HTML", tone: "quiet" },
      ],
    };
  }
  if (state === "run-error") {
    const recoveryKind = [
      "retry",
      "wait",
      "reauthenticate",
      "change-model",
      "change-provider",
      "repair-installation",
      "end",
    ].includes(failureRecoveryKind)
      ? failureRecoveryKind
      : failureRetryable !== false ? "retry" : "end";
    const reason = boundedFailureReason(failureMessage);
    const retained = credentialKind === "api-token" && recoveryKind === "reauthenticate"
      ? `${reason} 页面和本轮要求已保留。`
      : `${reason} 页面未修改`;
    const recoveryActions = {
      retry: [
        { id: "resend-agent", label: "重新发送", tone: "primary" },
        { id: "dismiss", label: "结束本轮", tone: "quiet" },
      ],
      wait: [
        { id: "retry-later", label: "稍后重试", tone: "primary" },
        { id: "dismiss", label: "结束本轮", tone: "quiet" },
      ],
      reauthenticate: credentialKind === "api-token"
        ? [
          { id: "replace-api-key", label: "更换 API Key", tone: "primary" },
          { id: "dismiss", label: "结束本轮", tone: "quiet" },
        ]
        : [
          { id: "reauthenticate-agent", label: "重新登录", tone: "primary" },
          { id: "dismiss", label: "结束本轮", tone: "quiet" },
        ],
      "change-model": [
        { id: "change-agent-model", label: "更换模型", tone: "primary" },
        { id: "dismiss", label: "结束本轮", tone: "quiet" },
      ],
      "change-provider": [
        { id: "change-agent-provider", label: "切换 Agent", tone: "primary" },
        { id: "copy-task", label: "复制任务", tone: "quiet" },
      ],
      "repair-installation": [
        { id: "repair-agent-installation", label: "修复安装", tone: "primary" },
        { id: "dismiss", label: "结束本轮", tone: "quiet" },
      ],
      end: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
    };
    return {
      kind: "blocked",
      title: credentialKind === "api-token" && recoveryKind === "reauthenticate"
        ? "API Key 已失效"
        : ["retry", "wait"].includes(recoveryKind) ? "生成中断" : "生成失败",
      detail: retained,
      actions: recoveryActions[recoveryKind],
    };
  }
  if (state === "ready-to-open" || state === "review-view") {
    if (candidateStatus === "blocked") {
      return {
        kind: "blocked",
        title: failureMessage || "本轮没有可采用的结果",
        detail: "这次修改没有通过检查。",
        actions: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
      };
    }
    const title = "修改已准备好，尚未采用";
    const detail = failureMessage || (candidateStatus === "attention"
      ? "这次变化较大，核对后再决定。" : "查看本次修改，再决定是否采用。");
    return {
      kind: "decision", title, detail,
      actions: state === "review-view"
        ? [{ id: "adopt", label: "采用修改", tone: "primary" },
          { id: "discard", label: "不用这次", tone: "quiet" }]
        : [{ id: "review", label: "查看修改", tone: "primary" }],
    };
  }

  if (state === "processing" || state === "validating") {
    // The clipboard round is not being processed by the selected Agent at all: the user pasted
    // the task into an Agent of their own and PageRoot is waiting for the file to
    // come back. Claiming an Agent is processing there would describe something that is not
    // happening, and the user would lose the one action they actually need — the
    // task back on the clipboard if the paste went wrong.
    if (deliveryMode === "clipboard") {
      if (handoffStatus === "failed") {
        return {
          kind: "blocked",
          title: "任务还没复制成功",
          detail: "本轮要求已保留，可以重新复制。",
          actions: [
            { id: "recopy", label: "再次复制", tone: "quiet" },
            { id: "cancel", label: "结束本轮", tone: "quiet" },
          ],
        };
      }
      return {
        kind: "progress",
        title: "任务已复制，等你的 AI 改完",
        detail: "粘贴给任意能读写本机文件的 AI。",
        // Nothing here advances the round — PageRoot is waiting on an Agent it does
        // not drive — so neither action takes the accent. Re-copying is a remedy,
        // not the next step.
        actions: [
          { id: "recopy", label: "再次复制", tone: "quiet" },
          { id: "cancel", label: "结束本轮", tone: "quiet" },
        ],
      };
    }
    if (handoffStatus === "cancelling") {
      return {
        kind: "progress",
        title: null,
        detail: null,
        actions: [{ id: "cancel", label: "正在结束…", tone: "quiet", disabled: true }],
      };
    }
    // The timeline above already narrates the round, and the header already says the
    // page is not being overwritten. Repeating either here would make the user read
    // the same fact twice, so this carries the action alone.
    return {
      kind: "progress",
      title: null,
      detail: null,
      actions: [{ id: "cancel", label: "结束本轮", tone: "quiet" }],
    };
  }
  /*
   * A round can finish without changing anything, which is not a stage the timeline can
   * express. It used to be stated only in the process panel, and that panel is out of
   * the flow, so the conversation says it.
   */
  if (state === "no-change") {
    return {
      kind: "decision",
      title: "未识别到明确的页面变化",
      detail: "原评论和附件都已保留，调整要求后可以重新发送。",
      actions: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
    };
  }
  if (state === "promoting" || state === "adoption-unknown") {
    return {
      kind: "progress",
      title: state === "adoption-unknown" ? "采用结果待确认" : "正在采用候选版本",
      detail: state === "adoption-unknown" ? "正在自动核对已提交的采用决定，确认后会切换到新页面。" : "采用完成后会切换到新页面。",
      actions: [],
    };
  }
  return null;
}

/**
 * Whether the Composer can send, and the reason when it cannot. A disabled send
 * button must always say why: greying it out without an explanation leaves the
 * user with no next step.
 */
/**
 * The disclosure that used to live in the delivery dialog. It belongs beside the
 * button that acts on it, so the user reads it without being interrupted by a
 * modal first.
 */
export function sidebarSendState({
  state,
  catalogStatus = "ready",
  catalogReason = null,
  queued = false,
  intent = INTENT_MODIFY,
  pendingCommentCount = 0,
  agentName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  credentialKind = null,
} = {}) {
  const boundedAgentName = String(agentName || "Agent").trim().slice(0, 80) || "Agent";
  const boundedAgentSettingsName = String(agentSettingsName || boundedAgentName)
    .trim()
    .slice(0, 80) || boundedAgentName;
  // The review Canvas wins over every other reason. It is showing a candidate,
  // so no round may start from here. The
  // thread stays on screen so the user keeps the context that produced the
  // candidate; it is simply not a place to type right now. State is the single
  // owner of this fact — sidebarStateFromRun already maps reviewing to it.
  if (state === "review-view") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  // Lifecycle authority wins over provider availability. While a Request is
  // being frozen there is no second action to take, and once a Candidate is
  // ready the decision bar — not the Composer — owns review/adoption.
  if (state === "preparing-delivery") {
    return {
      kind: "send",
      canSend: false,
      label: "正在准备修改…",
      reason: "正在冻结本轮评论和页面内容",
    };
  }
  if (state === "ready-to-open") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  if (state === "run-error") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  if (state === "processing" || state === "validating") {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: `${boundedAgentName} 完成本轮后可发送`,
    };
  }
  if (state === "promoting" || state === "adoption-unknown") {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: "正在采用候选版本",
    };
  }
  if (catalogStatus === "checking") {
    if (agentSettingsSupported) {
      return {
        kind: "open-agent-settings",
        canSend: false,
        label: `设置 ${boundedAgentSettingsName}`,
        reason: null,
      };
    }
    return {
      kind: "status",
      canSend: false,
      label: "正在连接 Agent…",
      reason: null,
    };
  }
  if (catalogStatus === "auth-required") {
    if (!agentSettingsSupported) {
      return {
        kind: "status",
        canSend: false,
        label: credentialKind === "api-token"
          ? `请先连接 ${boundedAgentName}`
          : `请先登录 ${boundedAgentName}`,
        reason: `在设置中接通 ${boundedAgentName} 后即可发送`,
      };
    }
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: credentialKind === "api-token"
        ? `连接 ${boundedAgentSettingsName}`
        : `登录 ${boundedAgentSettingsName}`,
      reason: null,
    };
  }
  if (catalogStatus === "not-installed") {
    if (!agentSettingsSupported) {
      return {
        kind: "status",
        canSend: false,
        label: `${boundedAgentName} runtime 不可用`,
        reason: "请重新安装当前版本的源页",
      };
    }
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: `设置 ${boundedAgentSettingsName}`,
      reason: null,
    };
  }
  if (catalogStatus === "unavailable") {
    if (catalogReason === "account-capacity") {
      return {
        kind: "open-agent-settings",
        canSend: false,
        label: "额度已用完",
        reason: null,
      };
    }
    if (agentSettingsSupported) {
      return {
        kind: "open-agent-settings",
        canSend: false,
        label: `设置 ${boundedAgentSettingsName}`,
        reason: null,
      };
    }
    return {
      kind: "status",
      canSend: false,
      label: "Agent 暂不可用",
      reason: `${boundedAgentName} 暂时无法确认`,
    };
  }
  // Modifying is a Request, and a Request is frozen from the edit surface's
  // comments rather than from this text box. Pointing there beats a send button
  // that would quietly drop what the user typed.
  if (intent === INTENT_MODIFY) {
    // A modification is driven by the comments already written on the page, not by
    // the Composer. That is why this intent shows no text box: there is no typed
    // sentence that could be silently dropped on the way to the Agent.
    if (queued) {
      return {
        kind: "send",
        canSend: false,
        label: `交给 ${boundedAgentName} 修改`,
        reason: "正在等待上一个任务完成",
      };
    }
    if (pendingCommentCount <= 0) {
      return {
        kind: "send",
        canSend: false,
        label: `交给 ${boundedAgentName} 修改`,
        reason: "先在编辑模式写下评论，AI 会按评论改",
      };
    }
    return {
      kind: "send",
      canSend: true,
      label: `交给 ${boundedAgentName} 修改`,
      reason: null,
    };
  }
  if (intent === INTENT_CONTINUE) {
    return {
      kind: "send",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  return { kind: "send", canSend: false, label: "发送", reason: null };
}

/**
 * Whether the clipboard delivery beside the send button can run, and the reason
 * when it cannot.
 *
 * Copying is the other branch of the same modification round (PRD §11.4): it
 * freezes the page's comments into a Request and writes the clipboard, and
   * neither step consults the selected Agent. The send button guards on the model catalog
 * because the Agent path needs it; applying that guard here would take the
 * clipboard down with an unreadable catalog — PRD §10.2 keeps 复制任务 available
 * through every catalog status, and the old delivery dialog's copy option never
 * required the CLI either. What copying does need is the round itself: no round
 * in flight, and comments to freeze.
 */
export function sidebarCopyTaskState({
  state = "preview-ready",
  queued = false,
  pendingCommentCount = 0,
  agentName = "Agent",
} = {}) {
  const boundedAgentName = String(agentName || "Agent").trim().slice(0, 80) || "Agent";
  if (state === "review-view") {
    return {
      canCopy: false,
      reason: null,
    };
  }
  if (state === "preparing-delivery") {
    return { canCopy: false, reason: "正在冻结本轮评论和页面内容" };
  }
  if (state === "ready-to-open") {
    return { canCopy: false, reason: null };
  }
  if (state === "processing" || state === "validating") {
    return { canCopy: false, reason: `${boundedAgentName} 完成本轮后可发送` };
  }
  if (state === "promoting" || state === "adoption-unknown") {
    return { canCopy: false, reason: "正在采用候选版本" };
  }
  if (queued) {
    return { canCopy: false, reason: "正在等待上一个任务完成" };
  }
  if (pendingCommentCount <= 0) {
    return {
      canCopy: false,
      reason: "先在编辑模式写下评论，AI 会按评论改",
    };
  }
  return { canCopy: true, reason: null };
}

/**
 * The Composer's model line.
 *
 * PageRoot only names a model when it actually knows one. Saying "no models
 * available" while nothing has been read would assert a fact about the user's
 * account that PageRoot has not established, and the unavailable cases already
 * explain themselves on the send button (PRD §10.2) — a second line there would
 * be noise. So the honest default is silence. The Agent name is a read-only
 * identity that opens Settings; this line is only the model.
 *
 * Returns null when the line should not render at all.
 */
export function sidebarAgentLine({
  catalogStatus = "ready",
  modelDisplayName = null,
  modelChoiceCount = 0,
} = {}) {
  const name = typeof modelDisplayName === "string" ? modelDisplayName.trim() : "";
  if (catalogStatus === "checking" && !name) {
    return Object.freeze({ kind: "checking", text: "正在连接…", choosable: false });
  }
  if (!name) return null;
  return Object.freeze({
    kind: catalogStatus === "checking" ? "checking" : "name",
    text: name,
    // A picker is offered only when there is a real choice to make. PRD §10.1
    // forbids a dropdown that opens onto a single item.
    choosable: Number(modelChoiceCount) > 1,
  });
}

/**
 * The Composer's thinking-depth line.
 *
 * Only PageRoot's native HTTP Agent exposes a real choice. Qoder and Codex stay
 * on provider-default reasoning, so this line is absent there.
 */
export function sidebarReasoningLine({
  choices = [],
  selectedId = null,
  defaultId = "auto",
} = {}) {
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const selected = choices.find((choice) => choice.id === selectedId)
    || choices.find((choice) => choice.id === defaultId)
    || choices[0];
  return Object.freeze({
    text: `思考 · ${String(selected?.label || selected?.id || "").trim()}`,
    selectedId: selected?.id || null,
    choosable: choices.length > 1,
  });
}

export {
  SIDEBAR_STATES,
  INTENT_MODIFY,
  INTENT_CONTINUE,
  FORBIDDEN_MESSAGE_KEYS,
};

/** A display-only sentence boundary; preserve original text for copy and storage. */
export function sidebarNarrationParagraphs(text) {
  return String(text || "").split(/\n\s*\n/u).flatMap((paragraph) =>
    paragraph.split(/(?<=[。！？])\s*|(?<=[.!?])\s+(?=[A-Z])/u)
  ).map((part) => part.trim()).filter(Boolean);
}

export function sidebarProcessRows(messages = []) {
  const rows = [];
  for (const message of messages) {
    const previous = rows.at(-1);
    if (previous && previous.message.text === message.text) previous.count += 1;
    else rows.push({ message, count: 1 });
  }
  return rows;
}
