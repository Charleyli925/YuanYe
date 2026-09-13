export function executionPhaseForEvent(event, current) {
  let next;
  switch (event?.kind) {
    case "initialized": next = "starting-session"; break;
    case "request-sent": next = "sending-task"; break;
    case "response-started": next = "receiving-response"; break;
    case "generation-started": next = "generating-modification"; break;
    case "response-ended": next = "response-received"; break;
    case "html-validation-completed": next = "validating-html"; break;
    case "review-preparation-started": next = "preparing-review"; break;
    case "file-read": next = "reading-task"; break;
    case "file-written": next = "writing-candidate"; break;
    case "terminal-created": next = "finalizing"; break;
    case "completion":
    case "completion-verified":
    case "turn-stopping":
    case "turn-stopped": next = "preparing-review"; break;
    case "cancel-requested":
    case "host-cancelling": return "cancelling";
    default: return current;
  }
  const publicOrder = [
    "starting-session",
    "sending-task",
    "receiving-response",
    "generating-modification",
    "response-received",
    "validating-html",
    "preparing-review",
  ];
  const currentRank = publicOrder.indexOf(current);
  const nextRank = publicOrder.indexOf(next);
  return currentRank >= 0 && nextRank >= 0 && nextRank < currentRank ? current : next;
}

// Apply to assembled text, never token fragments, so split credentials cannot
// bypass the public boundary. Renderer still renders this as plain text.
export function safePublicAgentText(value) {
  const text = String(value || "").slice(0, 65536)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  if (/<(?:!doctype|\/?[a-z][a-z0-9:-]*(?:\s|>|\/))/iu.test(text)) return "生成内容已隐藏，校验通过后可查看修改。";
  return text
    .replace(/https?:\/\/[^\s]+/giu, "[链接已隐藏]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+/gu, "[凭据已隐藏]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/giu, "[凭据已隐藏]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/giu, "$1[已隐藏]")
    .replace(/\/(?:Users|home|tmp|private|var|Volumes|Applications|etc|root)\/[^\s<>"']+/gu, "[路径已隐藏]")
    .replace(/(?:\/[A-Za-z0-9._~-]+){2,}(?:\/[A-Za-z0-9._~%+ -]*)?/gu, "[路径已隐藏]")
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s]*/gu, "[路径已隐藏]")
    .replace(/https?:\/\/[^\s]+/giu, "[链接已隐藏]");
}

// Sealed public narration only; callers must never supply reasoning or tool output.
export function safePublicAgentSummary(value) {
  const text = safePublicAgentText(value).trim();
  return text.length > 4096 ? `${text.slice(0, 4080)}\n（摘要已截断）` : text;
}

const MAX_VISIBLE_TEXT_UPDATES = 80;
const SENTENCE_END = /[。！？.!?]\s*$/u;

function cleanPublicId(value, fallback) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 160);
  return /^[A-Za-z0-9_:-]{1,160}$/u.test(normalized) ? normalized : fallback;
}

function slicePublicText(text, limit) {
  let end = Math.min(text.length, Math.max(0, limit));
  // Do not expose half of a UTF-16 surrogate pair at the budget boundary.
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] || "")) end -= 1;
  return text.slice(0, end);
}

function publicParagraphs(message) {
  if (message.groupId) return [{ ...message }];
  const result = [];
  let leading = "";
  for (const [index, text] of message.text.split("\n\n").entries()) {
    if (!text) {
      if (result.length) result.at(-1).text += "\n\n";
      else leading += "\n\n";
      continue;
    }
    result.push({ id: `${message.id}:${index}`, sequence: message.sequence, text: leading + text });
    leading = "";
  }
  if (!result.length && message.text) {
    result.push({ id: `${message.id}:0`, sequence: message.sequence, text: message.text });
  }
  return result;
}

/**
 * One bounded, process-private source for execution narration. Raw message
 * fragments are assembled before redaction; diagnostic event retention does
 * not determine which public words survive. Snapshot fields share one budget.
 */
export function createPublicAgentTextAccumulator({ maxTextLength = 65536 } = {}) {
  const messages = [];
  const byGroup = new Map();
  let rawLength = 0;
  let truncated = false;
  let exhausted = false;
  let cached = null;
  return Object.freeze({
    append(event) {
      if (event?.kind !== "visible-text" || typeof event.text !== "string" || !event.text) return;
      if (exhausted) { truncated = true; cached = null; return; }
      const raw = event.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
      if (!raw) return;
      const groupId = cleanPublicId(event.messageId || event.segmentId, "");
      const previous = messages.at(-1);
      let message = groupId ? byGroup.get(groupId) :
        previous && !previous.groupId && (/\s$/u.test(previous.text) || /^\s/u.test(raw) || !SENTENCE_END.test(previous.text))
          ? previous : null;
      const separatorLength = !message && messages.length ? 2 : 0;
      const text = slicePublicText(raw, maxTextLength - rawLength - separatorLength);
      if (text.length < raw.length) { truncated = true; exhausted = true; }
      if (text) {
        if (!message) {
          const eventId = cleanPublicId(event.eventId, `visible-${Number(event.sequence) || 0}`);
          message = { id: groupId ? `message:${groupId}:0` : eventId,
            groupId, sequence: 0, text: "" };
          messages.push(message);
          if (groupId) byGroup.set(groupId, message);
          rawLength += separatorLength;
        }
        message.text += text;
        message.sequence = Number.isSafeInteger(event.sequence) ? event.sequence : 0;
        rawLength += text.length;
      }
      cached = null;
    },
    markTruncated() { truncated = true; cached = null; },
    snapshot() {
      if (cached) return cached;
      // Redact whole messages before splitting display paragraphs. A credential
      // or markup split over fragments must never be reassembled from redacted text.
      const updates = messages.flatMap((message) => publicParagraphs({
        ...message, text: safePublicAgentText(message.text),
      }));
      let remaining = maxTextLength;
      let publicTruncated = truncated;
      const bounded = [];
      for (const update of updates) {
        const separatorLength = bounded.length ? 2 : 0;
        const text = slicePublicText(update.text, remaining - separatorLength);
        if (text) {
          bounded.push({ id: update.id, sequence: update.sequence, text });
          remaining -= text.length + separatorLength;
        }
        if (text.length < update.text.length) { publicTruncated = true; break; }
      }
      if (bounded.length > MAX_VISIBLE_TEXT_UPDATES) {
        const collapsed = bounded.splice(0, bounded.length - MAX_VISIBLE_TEXT_UPDATES + 1);
        bounded.unshift({ id: `earlier:${collapsed[0].id}`,
          sequence: collapsed.at(-1).sequence,
          text: collapsed.map((update) => update.text).join("\n\n") });
      }
      const visibleTextUpdates = Object.freeze(bounded.map(Object.freeze));
      cached = Object.freeze({
        visibleText: visibleTextUpdates.map((update) => update.text).join("\n\n"),
        visibleTextUpdates,
        textTruncated: publicTruncated,
      });
      return cached;
    },
  });
}

export function publicExecutionSession(entry) {
  if (!entry) return null;
  return Object.freeze({
    providerId: entry.providerId || null,
    runtimeId: entry.runtimeId || null,
    // Retain this only for legacy in-memory sessions. Renderer identity is
    // provider/runtime based and must not infer a provider from a transport alias.
    ...(entry.driver ? { driver: entry.driver } : {}),
    state: entry.state,
    phase: entry.phase,
    startedAt: entry.startedAt,
    lastActivityAt: entry.lastActivityAt || null,
    receivedBytes: Number.isSafeInteger(entry.receivedBytes) && entry.receivedBytes >= 0
      ? entry.receivedBytes
      : 0,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName ? safePublicAgentText(entry.agentName).slice(0, 160) : null,
    agentVersion: entry.agentVersion ? safePublicAgentText(entry.agentVersion).slice(0, 80) : null,
    eventCount: entry.eventCount || 0,
    visibleText: safePublicAgentText(entry.visibleText),
    visibleTextUpdates: Object.freeze((entry.visibleTextUpdates || []).map((update, index) => Object.freeze({
      id: cleanPublicId(update.id, `public-${index}`), sequence: update.sequence,
      text: safePublicAgentText(update.text),
    }))),
    textTruncated: entry.textTruncated === true,
    retryable: entry.retryable === true,
    safeToRetry: typeof entry.safeToRetry === "boolean"
      ? entry.safeToRetry
      : entry.retryable === true,
    recoveryKind: entry.recoveryKind || "end",
    errorCode: entry.errorCode || null,
    errorMessage: entry.errorMessage ? safePublicAgentText(entry.errorMessage).slice(0, 1000) : null,
  });
}
