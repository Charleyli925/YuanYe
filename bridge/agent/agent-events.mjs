import { randomUUID } from "node:crypto";
import { createPublicAgentTextAccumulator } from "./agent-session-projector.mjs";

const DEFAULT_TEXT_LIMIT = 64 * 1024;
const DEFAULT_EVENT_LIMIT = 2_048;
const NON_DROPPABLE_KINDS = new Set([
  "artifact",
  "completion",
  "completion-verified",
  "permission",
  "permission-requested",
  "cancel-requested",
  "cancel-acknowledged",
  "termination-confirmed",
  "durable-cancelled",
]);

function boundedInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function canonicalAgentEvent(input, {
  turnId,
  sequence,
  timestamp = Date.now(),
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const canonicalTurnId = String(input.turnId || turnId || "");
  const canonicalSequence = Number.isSafeInteger(input.sequence) ? input.sequence : sequence;
  const canonicalTimestamp = Number.isFinite(Number(input.timestamp))
    ? Number(input.timestamp)
    : Number(timestamp);
  if (!canonicalTurnId || !Number.isSafeInteger(canonicalSequence) || canonicalSequence < 0
    || !Number.isFinite(canonicalTimestamp) || canonicalTimestamp < 0) return null;
  return Object.freeze({
    ...input,
    eventId: String(input.eventId || `event_${randomUUID().replaceAll("-", "")}`),
    turnId: canonicalTurnId,
    sequence: canonicalSequence,
    timestamp: canonicalTimestamp,
    kind: String(input.kind || "unknown"),
  });
}

export function createAgentEventReducer({
  maxEvents = DEFAULT_EVENT_LIMIT,
  maxTextLength = DEFAULT_TEXT_LIMIT,
} = {}) {
  const eventLimit = boundedInteger(maxEvents, DEFAULT_EVENT_LIMIT);
  const textLimit = boundedInteger(maxTextLength, DEFAULT_TEXT_LIMIT);
  const turns = new Map();

  const stateFor = (turnId) => {
    let state = turns.get(turnId);
    if (!state) {
      state = {
        turnId,
        lastSequence: -1,
        lastTimestamp: -1,
        eventIds: new Set(),
        eventCount: 0,
        retainedEvents: [],
        publicText: createPublicAgentTextAccumulator({ maxTextLength: textLimit }),
      };
      turns.set(turnId, state);
    }
    return state;
  };

  const project = (state) => Object.freeze({
    turnId: state.turnId,
    lastSequence: state.lastSequence,
    lastTimestamp: state.lastTimestamp,
    eventCount: state.eventCount,
    retainedEvents: Object.freeze([...state.retainedEvents]),
    ...state.publicText.snapshot(),
  });

  return Object.freeze({
    accept(eventInput) {
      const event = canonicalAgentEvent(eventInput, eventInput || {});
      if (!event) return Object.freeze({ accepted: false, reason: "invalid", projection: null });
      const state = stateFor(event.turnId);
      if (state.eventIds.has(event.eventId)) {
        return Object.freeze({ accepted: false, reason: "duplicate", projection: project(state) });
      }
      if (event.sequence <= state.lastSequence || event.timestamp < state.lastTimestamp) {
        return Object.freeze({ accepted: false, reason: "late", projection: project(state) });
      }
      state.eventIds.add(event.eventId);
      while (state.eventIds.size > eventLimit * 2) {
        state.eventIds.delete(state.eventIds.values().next().value);
      }
      state.lastSequence = event.sequence;
      state.lastTimestamp = event.timestamp;
      state.eventCount = Math.min(Number.MAX_SAFE_INTEGER, state.eventCount + 1);
      if (event.kind === "visible-text") {
        state.publicText.append(event);
      }
      if (event.kind === "visible-text-truncated") {
        // A runtime can hit its byte-based public-text boundary before this
        // character-based reducer reaches its own cap.
        state.publicText.markTruncated();
      }
      if (state.retainedEvents.length < eventLimit) {
        state.retainedEvents.push(event);
      } else if (NON_DROPPABLE_KINDS.has(event.kind)) {
        const replaceable = state.retainedEvents.findIndex(
          (candidate) => !NON_DROPPABLE_KINDS.has(candidate.kind),
        );
        if (replaceable >= 0) state.retainedEvents.splice(replaceable, 1, event);
        else {
          const sameKind = state.retainedEvents.findIndex(
            (candidate) => candidate.kind === event.kind,
          );
          if (sameKind >= 0) state.retainedEvents.splice(sameKind, 1, event);
          else if (state.retainedEvents.length < eventLimit + NON_DROPPABLE_KINDS.size) {
            state.retainedEvents.push(event);
          }
        }
      }
      return Object.freeze({ accepted: true, reason: null, event, projection: project(state) });
    },
    projection(turnId) {
      const state = turns.get(String(turnId || ""));
      return state ? project(state) : null;
    },
    clear(turnId) {
      return turns.delete(String(turnId || ""));
    },
  });
}
