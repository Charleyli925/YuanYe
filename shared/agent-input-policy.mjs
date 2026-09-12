// Native HTTP Agent policy shared by submission estimates and frozen execution.
// Callers own bytes, identity, configuration snapshots and error presentation.
export const HTTP_AGENT_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const HTTP_AGENT_PREFLIGHT_RESERVE_BYTES = 256 * 1024;
export const HTTP_AGENT_INPUT_POLICY_REVISION = "2026-09-12.1";

export function httpAgentSupportsTextAttachment({ mediaType, fileName } = {}) {
  const type = String(mediaType || "").toLowerCase();
  if (type.startsWith("text/")
    || ["application/json", "application/xml", "application/javascript"].includes(type)
    || type.endsWith("+json") || type.endsWith("+xml")) return true;
  if (type && type !== "application/octet-stream") return false;
  return /\.(?:txt|md|markdown|json|jsonl|csv|tsv|xml|html?|css|js|jsx|ts|tsx|yml|yaml|toml|ini|log|sql|py|rb|go|rs|java|c|h|cpp|hpp|sh|zsh|fish)$/iu
    .test(String(fileName || ""));
}

export function decodeHttpAgentText(bytes, { allowEmpty = true } = {}) {
  if (!(bytes instanceof Uint8Array) || (!allowEmpty && !bytes.byteLength) || bytes.includes(0)) return null;
  try {
    // Preserve a literal BOM rather than silently changing frozen source text.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function httpAgentInputBudget({ inputBytes, baseHtmlBytes, model }) {
  if (![inputBytes, baseHtmlBytes].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError("HTTP Agent budgets require verified nonnegative byte counts.");
  }
  const inputTokens = Math.ceil(inputBytes / 3) + 1_200;
  const outputTokens = Math.ceil(Math.ceil(baseHtmlBytes / 3) * 1.15);
  const known = model?.supportsCompleteHtml === true
    && [model.contextWindow, model.recommendedMaxInputTokens, model.maxOutputTokens]
      .every((value) => Number.isSafeInteger(value) && value > 0);
  const exceeded = inputBytes > HTTP_AGENT_MAX_INPUT_BYTES
    || model?.supportsCompleteHtml === false
    || (known && (inputTokens > model.recommendedMaxInputTokens
      || outputTokens > model.maxOutputTokens
      || inputTokens + outputTokens > model.contextWindow));
  return Object.freeze({
    status: exceeded ? "exceeded" : known ? "estimated-fit" : "unknown",
    inputTokens,
    outputTokens,
    // Optional headroom cannot exceed the context remaining after this input.
    maxOutputTokens: known && !exceeded ? Math.min(model.maxOutputTokens,
      model.contextWindow - inputTokens, Math.max(4_096, Math.ceil(outputTokens * 1.5))) : null,
  });
}
