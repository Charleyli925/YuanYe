import { CAPABILITY_STABLE_ID_PATTERN } from "./capability-manifest.mjs";

const PUBLIC_STRING_KEYS = new Set([
  "code", "causeCode", "exactReason", "phase", "reasonCode", "expectedId",
  "observedId", "observedTag", "observedParentId", "selectedTag", "hitKind",
  "activeGeneration",
  "hintTargetKey", "hintTargetDomGeneration", "hintCurrentDomGeneration",
  "hintActiveFrameGeneration", "sourceId", "policy",
]);

const STABLE_ID_KEYS = new Set([
  "selectedId",
  "stableId",
  "expectedStableId",
  "hintTargetId",
  "probeStableId",
  "expectedOperationStableId",
  "operationStableId",
  "probeStableIds",
]);

const PRIVATE_KEYS = new Set([
  "afterSnippet", "beforeSnippet", "html", "raw", "text", "value", "message",
  "stack", "filename", "path", "selector",
]);

export function publicDiagnosticValue(value, key = "") {
  if (typeof value === "boolean" || typeof value === "number" || value == null) return value;
  if (typeof value === "string") {
    if (STABLE_ID_KEYS.has(key)) {
      return CAPABILITY_STABLE_ID_PATTERN.test(value) ? value : undefined;
    }
    return PUBLIC_STRING_KEYS.has(key) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => publicDiagnosticValue(entry, key))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const output = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(nestedKey) || nestedKey === "oracle") continue;
    const publicValue = publicDiagnosticValue(nestedValue, nestedKey);
    if (publicValue !== undefined) output[nestedKey] = publicValue;
  }
  return output;
}
