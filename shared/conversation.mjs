// Conversation domain rules. Pure functions only: no filesystem, no Bridge and
// no clock. The service layer supplies `now` and performs every read and write.
//
// Product invariants encoded here:
//   - A Conversation belongs to exactly one Document. Nothing in this module can
//     move a message between Documents or read across them.
//   - A persisted message is always terminal. A streaming fragment stays in
//     memory and is written once, when the Turn seals, so every stored message
//     is already final and crash recovery never has to repair a half record.
//   - A message carries no interface or interaction member. The action bar
//     derives what the user can do from current product state, never from a
//     stored message, so scrolling back through history cannot surface a stale
//     button.
//   - `sequence` is assigned here from the record's own `lastSequence`. The
//     Repository is the only writer, so strict increase needs no coordination.

import { defaultManagedAgentDelivery, normalizeAgentDelivery } from "./agent-delivery.mjs";

const CONVERSATION_SCHEMA_VERSION = "2.0.0";
const LEGACY_CONVERSATION_SCHEMA_VERSION = "1.0.0";
const CONVERSATION_INDEX_SCHEMA_VERSION = "1.0.0";
const CONVERSATION_DRAFT_SCHEMA_VERSION = "2.0.0";
const LEGACY_CONVERSATION_DRAFT_SCHEMA_VERSION = "1.0.0";

const CONVERSATION_MESSAGE_LIMIT = 500;
const CONVERSATION_TURN_LIMIT = 500;
const CONVERSATION_CONTEXT_LIMIT = 200;
const CONVERSATION_TEXT_LIMIT = 128 * 1024;
const CONVERSATION_TITLE_LIMIT = 200;
const CONVERSATION_RECORD_BYTE_LIMIT = 8 * 1024 * 1024;
const DOCUMENT_CONVERSATION_LIMIT = 200;
const INDEX_DOCUMENT_LIMIT = 500;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CONVERSATION_ID_PATTERN = /^conversation_[A-Za-z0-9_-]{12,180}$/;
const CONTEXT_ID_PATTERN = /^context_[A-Za-z0-9_-]{12,180}$/;
const TURN_ID_PATTERN = /^turn_[A-Za-z0-9_-]{12,180}$/;
const MESSAGE_ID_PATTERN = /^message_[A-Za-z0-9_-]{12,180}$/;

const CONVERSATION_STATUSES = new Set(["active", "archived"]);
const CONTEXT_SIDES = new Set([
  "working-copy",
  "frozen-base",
  "candidate",
  "review-pair",
]);
const TURN_MODES = new Set(["discussion", "execution", "review-discussion"]);
const TURN_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);
const MESSAGE_ACTORS = new Set(["user", "agent", "pageroot"]);
const MESSAGE_KINDS = new Set([
  "text",
  "progress",
  "decision-outcome",
  "error",
  "context-boundary",
  "permission-boundary",
  "result-summary",
]);
// draft, queued and streaming are in-memory only. Writing one would break the
// guarantee that every stored message is terminal.
const MESSAGE_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);
const DRAFT_INTENTS = new Set(["discuss", "modify", "continue"]);
const DELIVERY_MODES = new Set(["managed-agent", "clipboard"]);
const ARCHIVED_REASONS = new Set(["message-limit", "user"]);

// A stored message must never grow interface state. These names are refused so
// a future change cannot quietly turn the immutable fact stream into a
// re-rendering card surface.
const FORBIDDEN_MESSAGE_KEYS = new Set([
  "actions",
  "buttons",
  "cardState",
  "disabled",
  "pending",
  "controls",
]);

function conversationError(code, message, details) {
  const error = new Error(message);
  error.name = "ConversationError";
  error.code = code;
  error.details = details;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function requiredIdentity(value, label) {
  const identity = String(value || "");
  if (!identity || identity.length > 200) {
    throw conversationError(
      "INVALID_CONVERSATION_IDENTITY",
      `${label} must be a non-empty identity.`,
    );
  }
  return identity;
}

function requiredPattern(value, pattern, code, label) {
  const text = String(value || "");
  if (!pattern.test(text)) {
    throw conversationError(code, `${label} is not a valid identity.`);
  }
  return text;
}

function optionalPattern(value, pattern, code, label) {
  if (value === null || value === undefined) return null;
  return requiredPattern(value, pattern, code, label);
}

function requiredTimestamp(value, label) {
  const timestamp = String(value || "");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw conversationError(
      "INVALID_CONVERSATION_TIMESTAMP",
      `${label} must be an ISO timestamp.`,
    );
  }
  return timestamp;
}

function optionalTimestamp(value, label) {
  if (value === null || value === undefined) return null;
  return requiredTimestamp(value, label);
}

function requiredSha256(value, label) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) {
    throw conversationError(
      "INVALID_CONVERSATION_HASH",
      `${label} must be a sha256: hash.`,
    );
  }
  return hash;
}

function optionalReference(value, label) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text || text.length > 200) {
    throw conversationError(
      "INVALID_CONVERSATION_REFERENCE",
      `${label} must be a bounded identity or null.`,
    );
  }
  return text;
}

function boundedText(value, limit, label) {
  const text = typeof value === "string" ? value : "";
  if (text.length > limit) {
    throw conversationError(
      "CONVERSATION_TEXT_TOO_LARGE",
      `${label} exceeds its byte budget.`,
    );
  }
  return text;
}

function enumValue(value, allowed, code, label) {
  const text = String(value || "");
  if (!allowed.has(text)) {
    throw conversationError(code, `${label} is not a supported value.`);
  }
  return text;
}

function optionalEnum(value, allowed, code, label) {
  if (value === null || value === undefined) return undefined;
  return enumValue(value, allowed, code, label);
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw conversationError(
      "INVALID_CONVERSATION_COUNTER",
      `${label} must be a non-negative integer.`,
    );
  }
  return number;
}

// Forward compatibility. A newer PageRoot may add members to any of these
// records. Every known member stays strictly validated, and every unknown
// member is carried through read -> modify -> write unchanged so an older build
// never silently deletes a newer build's data. Preserved members take no part
// in validation and still count against the record byte budget.
const KNOWN_CONTEXT_KEYS = new Set([
  "contextId",
  "projectId",
  "documentId",
  "workingCopyId",
  "sourceSha256",
  "basedOnVersionId",
  "exactVersionId",
  "requestId",
  "attemptId",
  "candidateId",
  "side",
  "createdAt",
]);
const KNOWN_TURN_KEYS = new Set([
  "turnId",
  "contextId",
  "mode",
  "status",
  "startedMessageId",
  "providerSelection",
  "providerBinding",
  "capabilitySnapshotFingerprint",
  "startedAt",
  "completedAt",
  "interruptedAt",
  "requestId",
  "attemptId",
  "candidateId",
]);
const KNOWN_MESSAGE_KEYS = new Set([
  "messageId",
  "turnId",
  "sequence",
  "actor",
  "kind",
  "status",
  "text",
  "truncated",
  "contextId",
  "createdAt",
  "completedAt",
  "parentMessageId",
  "providerId",
  "actualModelId",
  "modelDisplayName",
  "requestId",
  "attemptId",
  "candidateId",
]);
const KNOWN_CONVERSATION_KEYS = new Set([
  "schemaVersion",
  "conversationId",
  "projectId",
  "documentId",
  "title",
  "status",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "archivedReason",
  "supersededByConversationId",
  "supersedesConversationId",
  "activeContextId",
  "lastSequence",
  "revision",
  "contexts",
  "turns",
  "messages",
]);
const KNOWN_SUMMARY_KEYS = new Set([
  "conversationId",
  "title",
  "status",
  "createdAt",
  "updatedAt",
  "messageCount",
  "lastModelDisplayName",
]);
const KNOWN_DOCUMENT_ENTRY_KEYS = new Set([
  "documentId",
  "currentConversationId",
  "conversations",
]);
const KNOWN_INDEX_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "revision",
  "updatedAt",
  "documents",
]);
const KNOWN_DRAFT_KEYS = new Set([
  "schemaVersion",
  "conversationId",
  "revision",
  "updatedAt",
  "text",
  "intent",
  "providerSelection",
  "modelDisplayName",
  "deliveryMode",
]);

function preserveUnknown(validated, raw, knownKeys) {
  if (!isRecord(raw)) return validated;
  let preserved = null;
  for (const key of Object.keys(raw)) {
    if (knownKeys.has(key)) continue;
    preserved ??= {};
    preserved[key] = raw[key];
  }
  return preserved ? { ...validated, ...preserved } : validated;
}

function withOptional(record, members) {
  const result = { ...record };
  for (const [key, value] of Object.entries(members)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function cleanContext(raw, label) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_CONTEXT",
      `${label} must be an object.`,
    );
  }
  return preserveUnknown(
    {
      contextId: requiredPattern(
        raw.contextId,
        CONTEXT_ID_PATTERN,
        "INVALID_CONVERSATION_CONTEXT",
        `${label} contextId`,
      ),
      projectId: requiredIdentity(raw.projectId, `${label} projectId`),
      documentId: requiredIdentity(raw.documentId, `${label} documentId`),
      workingCopyId: optionalReference(
        raw.workingCopyId,
        `${label} workingCopyId`,
      ),
      sourceSha256: requiredSha256(raw.sourceSha256, `${label} sourceSha256`),
      basedOnVersionId: optionalReference(
        raw.basedOnVersionId,
        `${label} basedOnVersionId`,
      ),
      exactVersionId: optionalReference(
        raw.exactVersionId,
        `${label} exactVersionId`,
      ),
      requestId: optionalReference(raw.requestId, `${label} requestId`),
      attemptId: optionalReference(raw.attemptId, `${label} attemptId`),
      candidateId: optionalReference(raw.candidateId, `${label} candidateId`),
      side: enumValue(
        raw.side,
        CONTEXT_SIDES,
        "INVALID_CONVERSATION_CONTEXT",
        `${label} side`,
      ),
      createdAt: requiredTimestamp(raw.createdAt, `${label} createdAt`),
    },
    raw,
    KNOWN_CONTEXT_KEYS,
  );
}

function cleanProviderSelection(value, label) {
  if (value === null || value === undefined) return null;
  try {
    return normalizeAgentDelivery({
      mode: "managed-agent",
      selection: value,
      trustPolicyVersion: "trusted-local-agent-v1",
    }).selection;
  } catch (cause) {
    throw conversationError(
      "INVALID_CONVERSATION_PROVIDER_SELECTION",
      `${label} is invalid.`,
      { reasonCode: cause?.code || "AGENT_DELIVERY_INVALID" },
    );
  }
}

function cleanProviderBinding(value, label) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw conversationError("INVALID_CONVERSATION_PROVIDER_BINDING", `${label} is invalid.`);
  }
  return {
    providerId: requiredIdentity(value.providerId, `${label} providerId`),
    runtimeId: requiredIdentity(value.runtimeId, `${label} runtimeId`),
  };
}

function legacyConversationProjection(raw) {
  const selection = defaultManagedAgentDelivery().selection;
  return {
    ...raw,
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    turns: Array.isArray(raw.turns) ? raw.turns.map((turn) => {
      const {
        modelId,
        reasoningEffort,
        ...rest
      } = isRecord(turn) ? turn : {};
      return {
        ...rest,
        providerSelection: {
          ...selection,
          requestedModelId: modelId ? `qoder:${modelId}` : null,
          resolvedModelId: modelId ? `qoder:${modelId}` : null,
          reasoning: reasoningEffort === "qoder-default"
            ? { requested: null, applied: null, resolution: "provider-default" }
            : selection.reasoning,
        },
        providerBinding: { providerId: "qoder", runtimeId: "acp" },
        capabilitySnapshotFingerprint: null,
      };
    }) : raw.turns,
    messages: Array.isArray(raw.messages) ? raw.messages.map((message) => {
      if (!isRecord(message)) return message;
      const { modelId, reasoningEffort: _reasoningEffort, ...rest } = message;
      return {
        ...rest,
        actor: message.actor === "qoder" ? "agent" : message.actor,
        ...(message.actor === "qoder" ? { providerId: "qoder" } : {}),
        ...(modelId ? { actualModelId: `qoder:${modelId}` } : {}),
      };
    }) : raw.messages,
  };
}

function legacyDraftProjection(raw) {
  const { modelId, ...rest } = raw;
  return {
    ...rest,
    schemaVersion: CONVERSATION_DRAFT_SCHEMA_VERSION,
    ...(modelId
      ? {
          providerSelection: {
            ...defaultManagedAgentDelivery().selection,
            requestedModelId: `qoder:${modelId}`,
            resolvedModelId: `qoder:${modelId}`,
          },
        }
      : {}),
    deliveryMode: raw.deliveryMode === "qoder-acp" ? "managed-agent" : raw.deliveryMode,
  };
}

function cleanTurn(raw, label) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_TURN",
      `${label} must be an object.`,
    );
  }
  const base = {
    turnId: requiredPattern(
      raw.turnId,
      TURN_ID_PATTERN,
      "INVALID_CONVERSATION_TURN",
      `${label} turnId`,
    ),
    contextId: requiredPattern(
      raw.contextId,
      CONTEXT_ID_PATTERN,
      "INVALID_CONVERSATION_TURN",
      `${label} contextId`,
    ),
    mode: enumValue(
      raw.mode,
      TURN_MODES,
      "INVALID_CONVERSATION_TURN",
      `${label} mode`,
    ),
    status: enumValue(
      raw.status,
      TURN_STATUSES,
      "INVALID_CONVERSATION_TURN",
      `${label} status`,
    ),
    startedMessageId: optionalPattern(
      raw.startedMessageId,
      MESSAGE_ID_PATTERN,
      "INVALID_CONVERSATION_TURN",
      `${label} startedMessageId`,
    ),
    providerSelection: cleanProviderSelection(
      raw.providerSelection,
      `${label} providerSelection`,
    ),
    providerBinding: cleanProviderBinding(raw.providerBinding, `${label} providerBinding`),
    capabilitySnapshotFingerprint: raw.capabilitySnapshotFingerprint === null
      || raw.capabilitySnapshotFingerprint === undefined
      ? null
      : requiredSha256(
          raw.capabilitySnapshotFingerprint,
          `${label} capabilitySnapshotFingerprint`,
        ),
    startedAt: requiredTimestamp(raw.startedAt, `${label} startedAt`),
    completedAt: optionalTimestamp(raw.completedAt, `${label} completedAt`),
    interruptedAt: optionalTimestamp(
      raw.interruptedAt,
      `${label} interruptedAt`,
    ),
    requestId: optionalReference(raw.requestId, `${label} requestId`),
    attemptId: optionalReference(raw.attemptId, `${label} attemptId`),
    candidateId: optionalReference(raw.candidateId, `${label} candidateId`),
  };
  if (base.providerBinding && base.providerSelection
    && (base.providerBinding.providerId !== base.providerSelection.providerId
      || base.providerBinding.runtimeId !== base.providerSelection.runtimeId)) {
    throw conversationError(
      "INVALID_CONVERSATION_PROVIDER_BINDING",
      `${label} provider binding does not match its selection.`,
    );
  }
  return preserveUnknown(base, raw, KNOWN_TURN_KEYS);
}

function cleanMessage(raw, label) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      `${label} must be an object.`,
    );
  }
  if (raw.actor === "qoder") {
    const { modelId, reasoningEffort: _reasoningEffort, ...rest } = raw;
    raw = {
      ...rest,
      actor: "agent",
      providerId: "qoder",
      ...(modelId ? { actualModelId: `qoder:${modelId}` } : {}),
    };
  }
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_MESSAGE_KEYS.has(key)) {
      throw conversationError(
        "CONVERSATION_MESSAGE_CARRIES_INTERACTION",
        `${label} must not carry the interface member ${JSON.stringify(key)}. `
        + "An executable action belongs to the action bar, not to a stored fact.",
      );
    }
  }
  const sequence = Number(raw.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      `${label} sequence must be a positive integer.`,
    );
  }
  const base = {
    messageId: requiredPattern(
      raw.messageId,
      MESSAGE_ID_PATTERN,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} messageId`,
    ),
    turnId: requiredPattern(
      raw.turnId,
      TURN_ID_PATTERN,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} turnId`,
    ),
    sequence,
    actor: enumValue(
      raw.actor,
      MESSAGE_ACTORS,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} actor`,
    ),
    kind: enumValue(
      raw.kind,
      MESSAGE_KINDS,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} kind`,
    ),
    status: enumValue(
      raw.status,
      MESSAGE_STATUSES,
      "CONVERSATION_MESSAGE_NOT_TERMINAL",
      `${label} status`,
    ),
    text: boundedText(raw.text, CONVERSATION_TEXT_LIMIT, `${label} text`),
    contextId: requiredPattern(
      raw.contextId,
      CONTEXT_ID_PATTERN,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} contextId`,
    ),
    createdAt: requiredTimestamp(raw.createdAt, `${label} createdAt`),
    completedAt: optionalTimestamp(raw.completedAt, `${label} completedAt`),
    parentMessageId: optionalPattern(
      raw.parentMessageId,
      MESSAGE_ID_PATTERN,
      "INVALID_CONVERSATION_MESSAGE",
      `${label} parentMessageId`,
    ),
    providerId: optionalReference(raw.providerId, `${label} providerId`),
    actualModelId: optionalReference(raw.actualModelId, `${label} actualModelId`),
    modelDisplayName: optionalReference(
      raw.modelDisplayName,
      `${label} modelDisplayName`,
    ),
    requestId: optionalReference(raw.requestId, `${label} requestId`),
    attemptId: optionalReference(raw.attemptId, `${label} attemptId`),
    candidateId: optionalReference(raw.candidateId, `${label} candidateId`),
  };
  if (base.actor === "agent" && !base.providerId) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      `${label} Agent actor requires providerId.`,
    );
  }
  if (base.actor !== "agent" && base.providerId) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      `${label} non-Agent actor cannot claim providerId.`,
    );
  }
  if (base.actualModelId && base.providerId
    && !base.actualModelId.startsWith(`${base.providerId}:`)) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      `${label} actualModelId uses another provider namespace.`,
    );
  }
  if (raw.truncated === true) base.truncated = true;
  return preserveUnknown(base, raw, KNOWN_MESSAGE_KEYS);
}

function boundedList(value, limit, code, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw conversationError(code, `${label} must be an array.`);
  }
  if (value.length > limit) {
    throw conversationError(code, `${label} exceeds its bounded size.`);
  }
  return value;
}

export function normalizeConversation(raw, { projectId, documentId } = {}) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION",
      "A conversation record must be an object.",
    );
  }
  if (raw.schemaVersion === LEGACY_CONVERSATION_SCHEMA_VERSION) {
    raw = legacyConversationProjection(raw);
  }
  if (raw.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
    throw conversationError(
      "UNSUPPORTED_CONVERSATION_SCHEMA",
      "The conversation record uses an unsupported schema version.",
    );
  }
  const recordProjectId = requiredIdentity(raw.projectId, "conversation projectId");
  const recordDocumentId = requiredIdentity(
    raw.documentId,
    "conversation documentId",
  );
  // A Conversation belongs to exactly one Document. Reading it under a
  // different Document identity is a cross-Document read and fails closed.
  if (projectId !== undefined && recordProjectId !== requiredIdentity(projectId, "projectId")) {
    throw conversationError(
      "CONVERSATION_IDENTITY_MISMATCH",
      "The conversation record belongs to another project.",
    );
  }
  if (
    documentId !== undefined
    && recordDocumentId !== requiredIdentity(documentId, "documentId")
  ) {
    throw conversationError(
      "CONVERSATION_IDENTITY_MISMATCH",
      "The conversation record belongs to another document.",
    );
  }

  const contexts = boundedList(
    raw.contexts,
    CONVERSATION_CONTEXT_LIMIT,
    "INVALID_CONVERSATION_CONTEXT",
    "conversation contexts",
  ).map((value, index) => cleanContext(value, `context ${index}`));
  const turns = boundedList(
    raw.turns,
    CONVERSATION_TURN_LIMIT,
    "INVALID_CONVERSATION_TURN",
    "conversation turns",
  ).map((value, index) => cleanTurn(value, `turn ${index}`));
  const messages = boundedList(
    raw.messages,
    CONVERSATION_MESSAGE_LIMIT,
    "INVALID_CONVERSATION_MESSAGE",
    "conversation messages",
  ).map((value, index) => cleanMessage(value, `message ${index}`));

  const contextIds = new Set(contexts.map((context) => context.contextId));
  const turnIds = new Set(turns.map((turn) => turn.turnId));
  for (const context of contexts) {
    if (context.projectId !== recordProjectId
      || context.documentId !== recordDocumentId) {
      throw conversationError(
        "CONVERSATION_IDENTITY_MISMATCH",
        "A context belongs to another project or document.",
      );
    }
  }
  for (const turn of turns) {
    if (!contextIds.has(turn.contextId)) {
      throw conversationError(
        "CONVERSATION_TURN_CONTEXT_MISSING",
        "A turn references a context that is not in this conversation.",
      );
    }
  }
  let previousSequence = 0;
  for (const message of messages) {
    if (!turnIds.has(message.turnId)) {
      throw conversationError(
        "CONVERSATION_MESSAGE_TURN_MISSING",
        "A message references a turn that is not in this conversation.",
      );
    }
    if (!contextIds.has(message.contextId)) {
      throw conversationError(
        "CONVERSATION_MESSAGE_CONTEXT_MISSING",
        "A message references a context that is not in this conversation.",
      );
    }
    if (message.sequence <= previousSequence) {
      throw conversationError(
        "CONVERSATION_SEQUENCE_NOT_INCREASING",
        "Conversation messages must use a strictly increasing sequence.",
      );
    }
    previousSequence = message.sequence;
  }

  const lastSequence = nonNegativeInteger(
    raw.lastSequence,
    "conversation lastSequence",
  );
  if (lastSequence < previousSequence) {
    throw conversationError(
      "CONVERSATION_SEQUENCE_NOT_INCREASING",
      "Conversation lastSequence is behind its stored messages.",
    );
  }
  const activeContextId = optionalPattern(
    raw.activeContextId,
    CONTEXT_ID_PATTERN,
    "INVALID_CONVERSATION_CONTEXT",
    "conversation activeContextId",
  );
  if (activeContextId && !contextIds.has(activeContextId)) {
    throw conversationError(
      "CONVERSATION_ACTIVE_CONTEXT_MISSING",
      "The active context is not in this conversation.",
    );
  }

  const normalized = preserveUnknown(
    withOptional(
      {
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        conversationId: requiredPattern(
          raw.conversationId,
          CONVERSATION_ID_PATTERN,
          "INVALID_CONVERSATION",
          "conversationId",
        ),
        projectId: recordProjectId,
        documentId: recordDocumentId,
        title: boundedText(raw.title, CONVERSATION_TITLE_LIMIT, "conversation title"),
        status: enumValue(
          raw.status,
          CONVERSATION_STATUSES,
          "INVALID_CONVERSATION",
          "conversation status",
        ),
        createdAt: requiredTimestamp(raw.createdAt, "conversation createdAt"),
        updatedAt: requiredTimestamp(raw.updatedAt, "conversation updatedAt"),
        archivedAt: optionalTimestamp(raw.archivedAt, "conversation archivedAt"),
        activeContextId,
        lastSequence,
        revision: nonNegativeInteger(raw.revision, "conversation revision"),
        contexts,
        turns,
        messages,
      },
      {
        archivedReason: optionalEnum(
          raw.archivedReason,
          ARCHIVED_REASONS,
          "INVALID_CONVERSATION",
          "conversation archivedReason",
        ),
        supersededByConversationId: optionalPattern(
          raw.supersededByConversationId,
          CONVERSATION_ID_PATTERN,
          "INVALID_CONVERSATION",
          "conversation supersededByConversationId",
        ) ?? undefined,
        supersedesConversationId: optionalPattern(
          raw.supersedesConversationId,
          CONVERSATION_ID_PATTERN,
          "INVALID_CONVERSATION",
          "conversation supersedesConversationId",
        ) ?? undefined,
      },
    ),
    raw,
    KNOWN_CONVERSATION_KEYS,
  );

  if (jsonByteLength(normalized) > CONVERSATION_RECORD_BYTE_LIMIT) {
    throw conversationError(
      "CONVERSATION_RECORD_TOO_LARGE",
      "The conversation record exceeds its byte budget.",
    );
  }
  return normalized;
}

export function createEmptyConversation({
  conversationId,
  projectId,
  documentId,
  title = "",
  now,
  supersedesConversationId = null,
}) {
  const createdAt = requiredTimestamp(now?.(), "conversation createdAt");
  return normalizeConversation(
    withOptional(
      {
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        conversationId,
        projectId,
        documentId,
        title,
        status: "active",
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        activeContextId: null,
        lastSequence: 0,
        revision: 0,
        contexts: [],
        turns: [],
        messages: [],
      },
      { supersedesConversationId: supersedesConversationId ?? undefined },
    ),
    { projectId, documentId },
  );
}


export function conversationContextById(conversation, contextId) {
  return conversation.contexts.find(
    (context) => context.contextId === contextId,
  ) ?? null;
}

export function conversationTurnById(conversation, turnId) {
  return conversation.turns.find((turn) => turn.turnId === turnId) ?? null;
}

export function activeConversationTurn(conversation) {
  return conversation.turns.find(
    (turn) => turn.status === "queued" || turn.status === "running",
  ) ?? null;
}

// One Conversation carries at most one in-flight Turn. Every caller checks this
// before starting work so a second Turn can never interleave its messages.
export function conversationHasInFlightTurn(conversation) {
  return activeConversationTurn(conversation) !== null;
}

// Capacity is checked before accepting a new execution; its bounded facts,
// result and decision fit without rotating an in-flight Turn.
export function conversationHasCapacity(conversation, { messages = 1, contexts = 0, turns = 0, bytes = 0 } = {}) {
  return conversation.messages.length + messages <= CONVERSATION_MESSAGE_LIMIT
    && conversation.contexts.length + contexts <= CONVERSATION_CONTEXT_LIMIT
    && conversation.turns.length + turns <= CONVERSATION_TURN_LIMIT
    && jsonByteLength(conversation) + bytes <= CONVERSATION_RECORD_BYTE_LIMIT;
}

export function conversationAtMessageLimit(conversation) {
  return conversation.messages.length >= CONVERSATION_MESSAGE_LIMIT;
}

function bumped(conversation, now, changes) {
  return normalizeConversation(
    {
      ...conversation,
      ...changes,
      revision: conversation.revision + 1,
      updatedAt: requiredTimestamp(now?.(), "conversation updatedAt"),
    },
    {
      projectId: conversation.projectId,
      documentId: conversation.documentId,
    },
  );
}

export function appendConversationContext(conversation, context, { now } = {}) {
  if (conversation.status !== "active") {
    throw conversationError(
      "CONVERSATION_ARCHIVED",
      "An archived conversation does not accept a new context.",
    );
  }
  const candidate = cleanContext(
    {
      ...context,
      projectId: context?.projectId ?? conversation.projectId,
      documentId: context?.documentId ?? conversation.documentId,
      createdAt: context?.createdAt ?? now?.(),
    },
    "context",
  );
  if (conversationContextById(conversation, candidate.contextId)) {
    throw conversationError(
      "CONVERSATION_CONTEXT_REUSED",
      "That context identity already exists in this conversation.",
    );
  }
  if (conversation.contexts.length >= CONVERSATION_CONTEXT_LIMIT) {
    throw conversationError(
      "CONVERSATION_CONTEXT_LIMIT",
      "This conversation cannot hold another context.",
    );
  }
  return bumped(conversation, now, {
    contexts: [...conversation.contexts, candidate],
    activeContextId: candidate.contextId,
  });
}

export function startConversationTurn(conversation, turn, { now } = {}) {
  if (conversation.status !== "active") {
    throw conversationError(
      "CONVERSATION_ARCHIVED",
      "An archived conversation does not accept a new turn.",
    );
  }
  if (conversationHasInFlightTurn(conversation)) {
    throw conversationError(
      "CONVERSATION_TURN_IN_FLIGHT",
      "This conversation already has an in-flight turn.",
    );
  }
  if (conversation.turns.length >= CONVERSATION_TURN_LIMIT) {
    throw conversationError(
      "CONVERSATION_TURN_LIMIT",
      "This conversation cannot hold another turn.",
    );
  }
  const candidate = cleanTurn(
    {
      status: "queued",
      providerSelection: null,
      providerBinding: null,
      capabilitySnapshotFingerprint: null,
      ...turn,
      startedAt: turn?.startedAt ?? now?.(),
    },
    "turn",
  );
  if (candidate.status !== "queued" && candidate.status !== "running") {
    throw conversationError(
      "INVALID_CONVERSATION_TURN",
      "A new turn starts queued or running.",
    );
  }
  if (conversationTurnById(conversation, candidate.turnId)) {
    throw conversationError(
      "CONVERSATION_TURN_REUSED",
      "That turn identity already exists in this conversation.",
    );
  }
  if (!conversationContextById(conversation, candidate.contextId)) {
    throw conversationError(
      "CONVERSATION_TURN_CONTEXT_MISSING",
      "A turn must reference a context in this conversation.",
    );
  }
  return bumped(conversation, now, {
    turns: [...conversation.turns, candidate],
  });
}

// A completed submission fact may be appended while its execution Turn is
// queued. Stable message identities make replay idempotent; no streaming state
// or UI controls are writable here.
export function appendConversationTurnMessage(conversation, { turnId, message }, { now } = {}) {
  const existing = conversationTurnById(conversation, turnId);
  if (!existing) throw conversationError("CONVERSATION_TURN_MISSING", "Turn is missing.");
  const previous = conversation.messages.find((entry) => entry.messageId === message.messageId);
  if (previous) {
    if (previous.turnId !== turnId || previous.text !== message.text || previous.kind !== message.kind) {
      throw conversationError("CONVERSATION_MESSAGE_REUSED", "Message identity cannot replace a fact.");
    }
    return conversation;
  }
  if (conversation.messages.length >= CONVERSATION_MESSAGE_LIMIT) {
    throw conversationError("CONVERSATION_MESSAGE_LIMIT", "Conversation is full.");
  }
  const at = now?.();
  const next = cleanMessage({ ...message, turnId, sequence: conversation.lastSequence + 1,
    contextId: existing.contextId, createdAt: message.createdAt || at, completedAt: message.completedAt || at,
  }, "fact message");
  return bumped(conversation, now, { messages: [...conversation.messages, next], lastSequence: next.sequence });
}

// Sealing writes the final execution messages. A streaming fragment lives in
// Bridge memory until its Turn reaches a terminal status, so the stored record
// never contains a half message and crash recovery never repairs one.
export function sealConversationTurn(
  conversation,
  { turnId, status, messages = [], candidateId, requestId, attemptId },
  { now } = {},
) {
  const existing = conversationTurnById(conversation, turnId);
  if (!existing) {
    throw conversationError(
      "CONVERSATION_TURN_MISSING",
      "That turn is not in this conversation.",
    );
  }
  if (existing.status !== "queued" && existing.status !== "running") {
    throw conversationError(
      "CONVERSATION_TURN_ALREADY_SEALED",
      "That turn has already reached a terminal status.",
    );
  }
  const sealedAt = requiredTimestamp(now?.(), "turn sealedAt");
  const terminalStatus = enumValue(
    status,
    new Set(["completed", "interrupted", "failed", "cancelled"]),
    "INVALID_CONVERSATION_TURN",
    "turn status",
  );
  if (!Array.isArray(messages)) {
    throw conversationError(
      "INVALID_CONVERSATION_MESSAGE",
      "Sealing a turn requires an array of terminal messages.",
    );
  }
  if (conversation.messages.length + messages.length > CONVERSATION_MESSAGE_LIMIT) {
    throw conversationError(
      "CONVERSATION_MESSAGE_LIMIT",
      "This conversation cannot hold the sealed messages. Archive it first.",
    );
  }

  let sequence = conversation.lastSequence;
  const appended = messages.map((message, index) => {
    sequence += 1;
    return cleanMessage(
      {
        ...(message?.actor === "agent" && existing.providerBinding
          ? { providerId: existing.providerBinding.providerId }
          : {}),
        ...(existing.providerSelection?.resolvedModelId
          ? { actualModelId: existing.providerSelection.resolvedModelId }
          : {}),
        ...(existing.modelDisplayName
          ? { modelDisplayName: existing.modelDisplayName }
          : {}),
        ...message,
        turnId,
        sequence,
        contextId: message?.contextId ?? existing.contextId,
        createdAt: message?.createdAt ?? sealedAt,
        completedAt: message?.completedAt ?? sealedAt,
      },
      `sealed message ${index}`,
    );
  });

  const turns = conversation.turns.map((turn) => (
    turn.turnId === turnId
      ? cleanTurn(
        {
          ...turn,
          status: terminalStatus,
          completedAt: terminalStatus === "completed" ? sealedAt : turn.completedAt,
          interruptedAt: terminalStatus === "interrupted"
            ? sealedAt
            : turn.interruptedAt,
          requestId: requestId ?? turn.requestId,
          attemptId: attemptId ?? turn.attemptId,
          candidateId: candidateId ?? turn.candidateId,
        },
        "turn",
      )
      : turn
  ));

  return bumped(conversation, now, {
    turns,
    messages: [...conversation.messages, ...appended],
    lastSequence: sequence,
  });
}

// PageRoot's own facts do not belong to an Agent round trip, so they seal
// immediately through their own single-message turn. The caller supplies both
// identities because this module stays pure and never generates one.
export function appendConversationFact(
  conversation,
  { turnId, messageId, contextId, kind, text, ...rest },
  { now } = {},
) {
  const factAt = requiredTimestamp(now?.(), "fact createdAt");
  const factContextId = contextId ?? conversation.activeContextId;
  const started = startConversationTurn(
    conversation,
    {
      turnId,
      contextId: factContextId,
      mode: "discussion",
      status: "running",
      startedAt: factAt,
    },
    { now: () => factAt },
  );
  return sealConversationTurn(
    started,
    {
      turnId,
      status: "completed",
      messages: [{
        ...rest,
        messageId,
        actor: "pageroot",
        kind,
        status: "completed",
        text,
        contextId: factContextId,
        createdAt: factAt,
        completedAt: factAt,
      }],
    },
    { now: () => factAt },
  );
}

export function archiveConversation(
  conversation,
  { reason = "user", supersededByConversationId = null } = {},
  { now } = {},
) {
  if (conversation.status === "archived") return conversation;
  const archivedAt = requiredTimestamp(now?.(), "conversation archivedAt");
  return bumped(conversation, () => archivedAt, withOptional(
    {
      status: "archived",
      archivedAt,
      archivedReason: enumValue(
        reason,
        ARCHIVED_REASONS,
        "INVALID_CONVERSATION",
        "conversation archivedReason",
      ),
    },
    {
      supersededByConversationId: supersededByConversationId ?? undefined,
    },
  ));
}

export function conversationSummary(conversation) {
  const lastModelMessage = [...conversation.messages]
    .reverse()
    .find((message) => Boolean(message.modelDisplayName));
  return preserveUnknown(
    {
      conversationId: conversation.conversationId,
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      lastModelDisplayName: lastModelMessage?.modelDisplayName ?? null,
    },
    {},
    KNOWN_SUMMARY_KEYS,
  );
}

// A conversation title is a bounded, safe summary of the first user message. It
// never comes from a path, a file name or an Agent reply.
export function conversationTitleFromMessage(text, limit = 24) {
  const collapsed = String(text || "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!collapsed) return "";
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit)}…`;
}

function cleanSummary(raw, label) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_INDEX",
      `${label} must be an object.`,
    );
  }
  return preserveUnknown(
    {
      conversationId: requiredPattern(
        raw.conversationId,
        CONVERSATION_ID_PATTERN,
        "INVALID_CONVERSATION_INDEX",
        `${label} conversationId`,
      ),
      title: boundedText(raw.title, CONVERSATION_TITLE_LIMIT, `${label} title`),
      status: enumValue(
        raw.status,
        CONVERSATION_STATUSES,
        "INVALID_CONVERSATION_INDEX",
        `${label} status`,
      ),
      createdAt: requiredTimestamp(raw.createdAt, `${label} createdAt`),
      updatedAt: requiredTimestamp(raw.updatedAt, `${label} updatedAt`),
      messageCount: nonNegativeInteger(raw.messageCount, `${label} messageCount`),
      lastModelDisplayName: optionalReference(
        raw.lastModelDisplayName,
        `${label} lastModelDisplayName`,
      ),
    },
    raw,
    KNOWN_SUMMARY_KEYS,
  );
}

function cleanDocumentEntry(raw, label) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_INDEX",
      `${label} must be an object.`,
    );
  }
  const conversations = boundedList(
    raw.conversations,
    DOCUMENT_CONVERSATION_LIMIT,
    "INVALID_CONVERSATION_INDEX",
    `${label} conversations`,
  ).map((value, index) => cleanSummary(value, `${label} conversation ${index}`));
  const currentConversationId = optionalPattern(
    raw.currentConversationId,
    CONVERSATION_ID_PATTERN,
    "INVALID_CONVERSATION_INDEX",
    `${label} currentConversationId`,
  );
  if (
    currentConversationId
    && !conversations.some(
      (summary) => summary.conversationId === currentConversationId,
    )
  ) {
    throw conversationError(
      "CONVERSATION_INDEX_CURRENT_MISSING",
      `${label} points at a conversation it does not list.`,
    );
  }
  return preserveUnknown(
    {
      documentId: requiredIdentity(raw.documentId, `${label} documentId`),
      currentConversationId,
      conversations,
    },
    raw,
    KNOWN_DOCUMENT_ENTRY_KEYS,
  );
}

export function normalizeConversationIndex(raw, { projectId } = {}) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_INDEX",
      "A conversation index must be an object.",
    );
  }
  if (raw.schemaVersion !== CONVERSATION_INDEX_SCHEMA_VERSION) {
    throw conversationError(
      "UNSUPPORTED_CONVERSATION_SCHEMA",
      "The conversation index uses an unsupported schema version.",
    );
  }
  const recordProjectId = requiredIdentity(raw.projectId, "index projectId");
  if (
    projectId !== undefined
    && recordProjectId !== requiredIdentity(projectId, "projectId")
  ) {
    throw conversationError(
      "CONVERSATION_IDENTITY_MISMATCH",
      "The conversation index belongs to another project.",
    );
  }
  const documents = boundedList(
    raw.documents,
    INDEX_DOCUMENT_LIMIT,
    "INVALID_CONVERSATION_INDEX",
    "index documents",
  ).map((value, index) => cleanDocumentEntry(value, `document ${index}`));
  const seen = new Set();
  for (const entry of documents) {
    if (seen.has(entry.documentId)) {
      throw conversationError(
        "CONVERSATION_INDEX_DOCUMENT_REUSED",
        "A document appears twice in the conversation index.",
      );
    }
    seen.add(entry.documentId);
  }
  return preserveUnknown(
    {
      schemaVersion: CONVERSATION_INDEX_SCHEMA_VERSION,
      projectId: recordProjectId,
      revision: nonNegativeInteger(raw.revision, "index revision"),
      updatedAt: requiredTimestamp(raw.updatedAt, "index updatedAt"),
      documents,
    },
    raw,
    KNOWN_INDEX_KEYS,
  );
}

export function createEmptyConversationIndex({ projectId, now }) {
  return normalizeConversationIndex(
    {
      schemaVersion: CONVERSATION_INDEX_SCHEMA_VERSION,
      projectId,
      revision: 0,
      updatedAt: requiredTimestamp(now?.(), "index updatedAt"),
      documents: [],
    },
    { projectId },
  );
}

// Reading a Document's conversations never touches another Document's entry, so
// Document A can never surface Document B's history.
export function conversationsForDocument(index, documentId) {
  const wanted = requiredIdentity(documentId, "documentId");
  const entry = index.documents.find((value) => value.documentId === wanted);
  return entry ? entry.conversations : [];
}

export function currentConversationIdForDocument(index, documentId) {
  const wanted = requiredIdentity(documentId, "documentId");
  const entry = index.documents.find((value) => value.documentId === wanted);
  return entry?.currentConversationId ?? null;
}

export function recordConversationInIndex(
  index,
  conversation,
  { current = true, now } = {},
) {
  const documentId = conversation.documentId;
  const existing = index.documents.find(
    (value) => value.documentId === documentId,
  );
  const previousSummary = existing?.conversations.find(
    (value) => value.conversationId === conversation.conversationId,
  );
  const summary = { ...previousSummary, ...conversationSummary(conversation) };
  const conversations = existing
    ? [
      ...existing.conversations.filter(
        (value) => value.conversationId !== summary.conversationId,
      ),
      summary,
    ]
    : [summary];
  if (conversations.length > DOCUMENT_CONVERSATION_LIMIT) {
    throw conversationError(
      "CONVERSATION_INDEX_DOCUMENT_LIMIT",
      "This document cannot hold another conversation.",
    );
  }
  const nextCurrent = current
    ? summary.conversationId
    : existing?.currentConversationId
      && conversations.some(
        (value) => value.conversationId === existing.currentConversationId,
      )
      ? existing.currentConversationId
      : null;
  if (previousSummary && nextCurrent === existing.currentConversationId
    && JSON.stringify(previousSummary) === JSON.stringify(summary)) return index;
  const entry = existing
    ? { ...existing, currentConversationId: nextCurrent, conversations }
    : { documentId, currentConversationId: nextCurrent, conversations };
  const documents = existing
    ? index.documents.map(
      (value) => (value.documentId === documentId ? entry : value),
    )
    : [...index.documents, entry];
  if (documents.length > INDEX_DOCUMENT_LIMIT) {
    throw conversationError(
      "CONVERSATION_INDEX_DOCUMENT_LIMIT",
      "This project cannot hold another document in the conversation index.",
    );
  }
  return normalizeConversationIndex(
    {
      ...index,
      documents,
      revision: index.revision + 1,
      updatedAt: requiredTimestamp(now?.(), "index updatedAt"),
    },
    { projectId: index.projectId },
  );
}

export function normalizeConversationDraft(raw, { conversationId } = {}) {
  if (!isRecord(raw)) {
    throw conversationError(
      "INVALID_CONVERSATION_DRAFT",
      "A conversation draft must be an object.",
    );
  }
  if (raw.schemaVersion === LEGACY_CONVERSATION_DRAFT_SCHEMA_VERSION) {
    raw = legacyDraftProjection(raw);
  }
  if (raw.schemaVersion !== CONVERSATION_DRAFT_SCHEMA_VERSION) {
    throw conversationError(
      "UNSUPPORTED_CONVERSATION_SCHEMA",
      "The conversation draft uses an unsupported schema version.",
    );
  }
  const recordConversationId = requiredPattern(
    raw.conversationId,
    CONVERSATION_ID_PATTERN,
    "INVALID_CONVERSATION_DRAFT",
    "draft conversationId",
  );
  if (conversationId !== undefined && recordConversationId !== conversationId) {
    throw conversationError(
      "CONVERSATION_IDENTITY_MISMATCH",
      "The draft belongs to another conversation.",
    );
  }
  return preserveUnknown(
    withOptional(
      {
        schemaVersion: CONVERSATION_DRAFT_SCHEMA_VERSION,
        conversationId: recordConversationId,
        revision: nonNegativeInteger(raw.revision, "draft revision"),
        updatedAt: requiredTimestamp(raw.updatedAt, "draft updatedAt"),
        text: boundedText(raw.text, CONVERSATION_TEXT_LIMIT, "draft text"),
        intent: enumValue(
          raw.intent,
          DRAFT_INTENTS,
          "INVALID_CONVERSATION_DRAFT",
          "draft intent",
        ),
      },
      {
        providerSelection: raw.providerSelection === undefined
          ? undefined
          : cleanProviderSelection(raw.providerSelection, "draft providerSelection"),
        modelDisplayName: optionalReference(
          raw.modelDisplayName,
          "draft modelDisplayName",
        ) ?? undefined,
        deliveryMode: optionalEnum(
          raw.deliveryMode,
          DELIVERY_MODES,
          "INVALID_CONVERSATION_DRAFT",
          "draft deliveryMode",
        ),
      },
    ),
    raw,
    KNOWN_DRAFT_KEYS,
  );
}

export function createEmptyConversationDraft({ conversationId, now }) {
  return normalizeConversationDraft(
    {
      schemaVersion: CONVERSATION_DRAFT_SCHEMA_VERSION,
      conversationId,
      revision: 0,
      updatedAt: requiredTimestamp(now?.(), "draft updatedAt"),
      text: "",
      intent: "modify",
    },
    { conversationId },
  );
}

export function updateConversationDraft(draft, changes, { now } = {}) {
  return normalizeConversationDraft(
    {
      ...draft,
      ...changes,
      conversationId: draft.conversationId,
      revision: draft.revision + 1,
      updatedAt: requiredTimestamp(now?.(), "draft updatedAt"),
    },
    { conversationId: draft.conversationId },
  );
}

export {
  CONVERSATION_SCHEMA_VERSION,
  CONVERSATION_INDEX_SCHEMA_VERSION,
  CONVERSATION_DRAFT_SCHEMA_VERSION,
  CONVERSATION_MESSAGE_LIMIT,
  CONVERSATION_TURN_LIMIT,
  CONVERSATION_CONTEXT_LIMIT,
  CONVERSATION_TEXT_LIMIT,
  CONVERSATION_RECORD_BYTE_LIMIT,
};
