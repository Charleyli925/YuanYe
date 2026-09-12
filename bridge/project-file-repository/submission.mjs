// Preflight submission receipts are not Requests and grant no execution authority.
// ProjectFileRepository invokes these helpers under its existing serial writer.
import path from "node:path";
import { safePublicAgentSummary } from "../agent/agent-session-projector.mjs";
import { readFile } from "node:fs/promises";
import { ensureCurrentConversation, rotateConversationAtLimit, readConversation, mutateConversation } from "../conversation-repository.mjs";
import { appendConversationContext, startConversationTurn, appendConversationTurnMessage, sealConversationTurn } from "../../shared/conversation.mjs";
import { sha256 } from "../lifecycle-core.mjs";
import { normalizeAgentDelivery } from "../../shared/agent-delivery.mjs";
import { compileTaskSpec } from "../../shared/task-spec.mjs";
import { atomicWriteProjectJson, readJsonFile } from "./path-safety.mjs";
import { ProjectFileRepositoryError } from "./errors.mjs";

function submissionRequirementText(snapshot) {
  return snapshot.comments.map((comment) => String(comment.text || comment.content || "")).join("\n\n")
    || snapshot.taskSpec.objective;
}

function receiptPath(loaded, operationId) {
  if (!/^submission_[a-f0-9]{32}$/u.test(String(operationId || ""))) {
    throw new ProjectFileRepositoryError("SUBMISSION_ID_INVALID", "Submission identity is invalid.");
  }
  return path.join(loaded.paths.projectRootPath, ".pageroot", "submissions", `${operationId}.json`);
}

export async function readSubmissionReceipt(loaded, operationId) {
  const value = await readJsonFile(receiptPath(loaded, operationId), "submission", { projectRootPath: loaded.paths.projectRootPath });
  if (value && (value.operationId !== operationId || value.projectId !== loaded.project.projectId
    || value.documentId !== loaded.project.documentId || value.workingCopyId !== loaded.workingCopy.workingCopyId)) {
    throw new ProjectFileRepositoryError("SUBMISSION_IDENTITY_MISMATCH", "Submission belongs to another document.");
  }
  if (value && (value.schemaVersion !== "1.0.0"
    || !["accepted", "not-started", "request-created"].includes(value.status)
    || value.snapshotSha256 !== sha256(JSON.stringify(value.snapshot))
    || value.requestId !== `req_${operationId.slice(11)}` || value.turnId !== `turn_${operationId.slice(11)}`)) {
    throw new ProjectFileRepositoryError("SUBMISSION_RECORD_INVALID", "Submission receipt failed integrity checks.");
  }
  return value;
}

export async function saveSubmissionReceipt(loaded, { operationId, input, projectRulesPath }, now) {
  const filePath = receiptPath(loaded, operationId);
  const comments = Array.isArray(input.comments) ? input.comments : [];
  const taskSpec = compileTaskSpec({ comments, targets: Array.isArray(input.targets) ? input.targets : [] });
  const snapshot = {
    sourceSha256: input.expectedSourceSha256,
    comments,
    changeEvents: Array.isArray(input.changeEvents) ? input.changeEvents : [],
    taskSpec,
    agentDelivery: normalizeAgentDelivery(input.agentDelivery, { allowLegacy: false }),
    projectRulesSha256: sha256(await readFile(projectRulesPath)),
  };
  if (snapshot.sourceSha256 !== loaded.source.sha256) {
    throw new ProjectFileRepositoryError("SOURCE_HASH_CONFLICT", "Source changed before submission was recorded.");
  }
  // Reject oversized requirements before accepting a durable Turn. The draft
  // remains editable; no provider has been contacted and nothing is truncated.
  if (Buffer.byteLength(JSON.stringify(submissionRequirementText(snapshot)), "utf8") > 1024 * 1024) {
    throw new ProjectFileRepositoryError("SUBMISSION_REQUIREMENTS_TOO_LARGE", "本轮要求过长，请拆分后提交；尚未发送。");
  }
  const snapshotSha256 = sha256(JSON.stringify(snapshot));
  const existing = await readSubmissionReceipt(loaded, operationId);
  if (existing) {
    if (existing.snapshotSha256 !== snapshotSha256) {
      throw new ProjectFileRepositoryError("SUBMISSION_COLLISION", "Submission identity cannot be reused with different requirements.");
    }
    await projectSubmissionReceipt(loaded, existing);
    return existing;
  }
  const suffix = operationId.slice("submission_".length);
  const conversationContext = { projectRoot: path.join(loaded.paths.projectRootPath, ".pageroot"),
    projectId: loaded.project.projectId, documentId: loaded.project.documentId };
  const conversation = await rotateConversationAtLimit(conversationContext,
    await ensureCurrentConversation(conversationContext),
    { reserve: { messages: 128, contexts: 2, turns: 1, bytes: 2 * 1024 * 1024 } });
  const receipt = {
    schemaVersion: "1.0.0", operationId,
    conversationId: conversation.conversationId,
    projectId: loaded.project.projectId, documentId: loaded.project.documentId,
    workingCopyId: loaded.workingCopy.workingCopyId,
    turnId: `turn_${suffix}`, requestId: `req_${suffix}`, attemptId: "attempt_001",
    createdAt: now, status: "accepted", snapshotSha256, snapshot,
  };
  await atomicWriteProjectJson(loaded.paths.projectRootPath, filePath, receipt, "submission");
  await projectSubmissionReceipt(loaded, receipt);
  return receipt;
}

export async function finishSubmissionReceipt(loaded, { operationId, status, errorCode = null }, now) {
  const current = await readSubmissionReceipt(loaded, operationId);
  if (!current) throw new ProjectFileRepositoryError("SUBMISSION_MISSING", "Submission receipt is missing.");
  if (!["not-started", "request-created"].includes(status)) throw new ProjectFileRepositoryError("SUBMISSION_STATE_INVALID", "Invalid submission state.");
  if (current.status === "request-created" || current.status === status) {
    await projectSubmissionReceipt(loaded, current);
    return current;
  }
  if (current.status !== "accepted") throw new ProjectFileRepositoryError("SUBMISSION_ALREADY_ENDED", "Create a new submission to retry.");
  const receipt = { ...current, status, completedAt: now,
    errorCode: /^[A-Za-z0-9_-]{1,80}$/u.test(String(errorCode || "")) ? errorCode : null };
  await atomicWriteProjectJson(loaded.paths.projectRootPath, receiptPath(loaded, operationId), receipt, "submission");
  await projectSubmissionReceipt(loaded, receipt);
  return receipt;
}

// The receipt is the recovery record. If projection fails, replay this same
// record; never infer that the Agent should run again.
export async function projectSubmissionReceipt(loaded, receipt) {
  const context = { projectRoot: path.join(loaded.paths.projectRootPath, ".pageroot"),
    projectId: receipt.projectId, documentId: receipt.documentId };
  const conversation = await readConversation(context, receipt.conversationId);
  if (!conversation) throw new ProjectFileRepositoryError("SUBMISSION_CONVERSATION_MISSING", "Submission history requires recovery.");
  const suffix = receipt.operationId.slice(11);
  const contextId = `context_${suffix}`;
  const now = () => receipt.createdAt;
  await mutateConversation(context, conversation.conversationId, (current) => {
    let next = current;
    if (!next.contexts.some((entry) => entry.contextId === contextId)) {
      next = appendConversationContext(next, { contextId, sourceSha256: receipt.snapshot.sourceSha256,
        side: "working-copy", createdAt: receipt.createdAt }, { now });
    }
    if (!next.turns.some((entry) => entry.turnId === receipt.turnId)) {
      const selection = receipt.snapshot.agentDelivery.selection || null;
      next = startConversationTurn(next, { turnId: receipt.turnId, contextId, mode: "execution", status: "queued",
        providerSelection: selection, providerBinding: selection ? { providerId: selection.providerId, runtimeId: selection.runtimeId } : null,
        startedAt: receipt.createdAt, submissionOperationId: receipt.operationId,
      }, { now });
    }
    const requirement = submissionRequirementText(receipt.snapshot);
    for (let offset = 0; offset < requirement.length; offset += 100000) {
      next = appendConversationTurnMessage(next, { turnId: receipt.turnId, message: {
        messageId: `message_${suffix}_submitted${offset ? `_${offset}` : ""}`,
        actor: "user", kind: "text", status: "completed",
        text: requirement.slice(offset, offset + 100000),
      } }, { now });
    }
    const turn = next.turns.find((entry) => entry.turnId === receipt.turnId);
    if (receipt.status === "not-started" && ["queued", "running"].includes(turn.status)) {
      next = sealConversationTurn(next, { turnId: receipt.turnId, status: "failed", messages: [{
        messageId: `message_${suffix}_not_started`, actor: "pageroot", kind: "error", status: "completed",
        text: "本次未开始，修改要求已保留。请修复服务后重新尝试。", errorCode: receipt.errorCode,
      }] }, { now: () => receipt.completedAt });
    }
    if (receipt.eventsTruncated) {
      next = appendConversationTurnMessage(next, { turnId: receipt.turnId, message: {
        messageId: `message_${suffix}_truncated`, actor: "pageroot", kind: "text", status: "completed",
        text: "部分早期过程已省略；修改要求与最终结果仍保留。",
      } }, { now });
    }
    for (const input of receipt.events || []) {
      const event = submissionExecutionFact(input);
      const messageId = `message_${event.eventId}`;
      const messageKind = event.kind === "public-summary" ? "result-summary"
        : ["promoted", "rejected"].includes(event.kind) ? "decision-outcome"
        : ["candidate-ready", "no-change", "cancelled", "error", "failed", "interrupted", "stop-confirmed"].includes(event.kind) ? "result-summary" : "progress";
      const agentOwned = ["public-summary", "reading-task", "writing-candidate", "finalizing",
        "receiving-response", "generating-modification", "response-received", "execution-ended"].includes(event.kind);
      next = appendConversationTurnMessage(next, { turnId: receipt.turnId, message: {
        messageId, actor: agentOwned && receipt.snapshot.agentDelivery.selection?.providerId ? "agent" : "pageroot",
        ...(agentOwned && receipt.snapshot.agentDelivery.selection?.providerId
          ? { providerId: receipt.snapshot.agentDelivery.selection.providerId } : {}),
        kind: next.messages.find((message) => message.messageId === messageId)?.kind || messageKind, status: "completed",
        text: event.kind === "public-summary" ? event.publicSummary : EXECUTION_FACTS[event.kind], createdAt: event.timestamp, completedAt: event.timestamp,
        requestId: receipt.requestId, attemptId: receipt.attemptId, candidateId: event.candidateId,
      } }, { now: () => event.timestamp });
      const currentTurn = next.turns.find((value) => value.turnId === receipt.turnId);
      const terminal = { "candidate-ready": "completed", "no-change": "completed", cancelled: "cancelled", error: "failed", interrupted: "interrupted" }[event.kind];
      if (terminal && ["queued", "running"].includes(currentTurn.status)) {
        next = sealConversationTurn(next, { turnId: receipt.turnId, status: terminal,
          requestId: receipt.requestId, attemptId: receipt.attemptId, candidateId: event.candidateId,
        }, { now: () => event.timestamp });
      }
    }
    return next;
  });
}

const EXECUTION_FACTS = Object.freeze({
  "public-summary": "",
  started: "已开始执行本轮修改。",
  "starting-session": "正在建立执行会话。",
  "sending-task": "已发出本轮修改要求。",
  "receiving-response": "已收到服务响应。",
  "generating-modification": "正在生成修改。",
  "response-received": "本轮结果接收结束。",
  "reading-task": "正在读取本轮资料。",
  "writing-candidate": "正在写入修改结果。",
  finalizing: "正在核对修改结果。",
  "validating-html": "正在校验修改结果。",
  "preparing-review": "正在准备审阅。",
  "stop-requested": "已请求停止，正在等待确认。",
  "stop-confirmed": "执行已停止，修改要求已保留。",
  failed: "执行未能完成，修改要求已保留。",
  "execution-ended": "执行已结束，结果仍需校验。",
  interrupted: "执行连接已中断，结果需要核对；部分过程可能未保存。",
  "candidate-ready": "修改已准备好，尚未采用。",
  "no-change": "本轮没有产生修改，修改要求已保留。",
  cancelled: "本轮已停止，修改要求已保留。",
  error: "修改结果未通过校验，页面尚未修改。",
  rejected: "未采用本次修改，修改要求与历史已保留。",
  promoted: "已采用本次修改。",
});

export function submissionExecutionFact({ eventId, kind, timestamp, candidateId = null, publicSummary = null }) {
  if (!Object.hasOwn(EXECUTION_FACTS, kind) || !/^[A-Za-z0-9_-]{1,180}$/u.test(eventId)
    || !Number.isFinite(Date.parse(timestamp))) {
    throw new ProjectFileRepositoryError("SUBMISSION_EVENT_INVALID", "Execution fact is invalid.");
  }
  return { eventId, kind, timestamp,
    ...(kind === "public-summary" ? { publicSummary: safePublicAgentSummary(publicSummary) } : {}),
    ...(candidateId && /^candidate_[A-Za-z0-9_-]{1,160}$/u.test(candidateId) ? { candidateId } : {}) };
}

export async function appendSubmissionExecutionFact(loaded, operationId, input) {
  const current = await readSubmissionReceipt(loaded, operationId);
  if (!current) throw new ProjectFileRepositoryError("SUBMISSION_MISSING", "Submission receipt is missing.");
  const event = submissionExecutionFact(input);
  const events = current.events || [];
  const existing = events.find((value) => value.eventId === event.eventId);
  if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
    throw new ProjectFileRepositoryError("SUBMISSION_EVENT_COLLISION", "Execution fact cannot be replaced.");
  }
  let receipt = current;
  if (!existing) {
    // Cap progress before projection too, reserving room for terminal facts.
    // Keeping the retained IDs stable avoids replaying evicted activity.
    const progressKinds = new Set(["starting-session", "sending-task", "reading-task",
      "writing-candidate", "generating-modification", "receiving-response",
      "response-received", "finalizing", "validating-html", "preparing-review"]);
    const omitProgress = progressKinds.has(event.kind)
      && events.filter((value) => progressKinds.has(value.kind)).length >= 64;
    if (!omitProgress || current.eventsTruncated !== true) {
      receipt = { ...current, events: omitProgress ? events : [...events, event],
        eventsTruncated: current.eventsTruncated === true || omitProgress };
      await atomicWriteProjectJson(loaded.paths.projectRootPath, receiptPath(loaded, operationId), receipt, "submission");
    }
  }
  await projectSubmissionReceipt(loaded, receipt);
  return receipt;
}


export function submissionRequestMatches(snapshot, body, taskSpec) {
  const frozen = snapshot.agentDelivery.selection;
  const requested = body.agentDelivery?.selection;
  return snapshot.sourceSha256 === body.expectedSourceSha256
    && JSON.stringify(snapshot.comments) === JSON.stringify(body.comments || [])
    && JSON.stringify(snapshot.changeEvents) === JSON.stringify(body.changeEvents || [])
    && JSON.stringify(snapshot.taskSpec) === JSON.stringify(taskSpec)
    && snapshot.agentDelivery.mode === body.agentDelivery?.mode
    && frozen?.providerId === requested?.providerId
    && frozen?.runtimeId === requested?.runtimeId
    && frozen?.requestedModelId === requested?.requestedModelId
    && frozen?.reasoning?.requested === requested?.reasoning?.requested;
}
