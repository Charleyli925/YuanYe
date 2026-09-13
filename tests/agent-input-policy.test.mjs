import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHttpAgentText, httpAgentSupportsTextAttachment, httpAgentInputBudget,
  HTTP_AGENT_MAX_INPUT_BYTES,
} from "../shared/agent-input-policy.mjs";
import { assertCompleteHtmlBudget } from "../bridge/agent/runtimes/http-runtime.mjs";

const model = Object.freeze({ supportsCompleteHtml: true, contextWindow: 400_000,
  recommendedMaxInputTokens: 350_000, maxOutputTokens: 5_000 });

test("large text attachments spend input capacity, not complete-HTML output capacity", () => {
  const input = "a".repeat(900_000);
  const result = httpAgentInputBudget({ inputBytes: Buffer.byteLength(input), baseHtmlBytes: 3_000, model });
  assert.equal(result.status, "estimated-fit");
  assert.equal(result.outputTokens, 1_150);
  assert.equal(result.maxOutputTokens, 4_096);
  assert.deepEqual(assertCompleteHtmlBudget(input, model, 3_000), result);
  assert.throws(() => assertCompleteHtmlBudget(input, model, 30_000), { code: "AGENT_PROMPT_TOO_LARGE" });
});

test("unknown model capability is explicit and still obeys the HTTP byte cap", () => {
  for (const unknown of [null, {}, { supportsCompleteHtml: true }]) {
    const budget = httpAgentInputBudget({ inputBytes: HTTP_AGENT_MAX_INPUT_BYTES, baseHtmlBytes: 100, model: unknown });
    assert.equal(budget.status, "unknown");
    assert.equal(budget.maxOutputTokens, null);
    assert.equal(httpAgentInputBudget({ inputBytes: HTTP_AGENT_MAX_INPUT_BYTES + 1, baseHtmlBytes: 100, model: unknown }).status, "exceeded");
  }
  assert.equal(httpAgentInputBudget({ inputBytes: 1, baseHtmlBytes: 1, model: { supportsCompleteHtml: false } }).status, "exceeded");
});

test("request output headroom fits the same input and context used for admission", () => {
  const budget = httpAgentInputBudget({ inputBytes: 2_400, baseHtmlBytes: 1_200,
    model: { supportsCompleteHtml: true, contextWindow: 3_000, recommendedMaxInputTokens: 2_000, maxOutputTokens: 5_000 } });
  assert.equal(budget.status, "estimated-fit");
  assert.equal(budget.inputTokens, 2_000);
  assert.equal(budget.maxOutputTokens, 1_000);
  assert.equal(budget.inputTokens + budget.maxOutputTokens, 3_000);
});

test("UTF-8 decoding preserves BOM and distinguishes empty rules from empty attachments", () => {
  const text = "\ufeff中文😀";
  assert.equal(decodeHttpAgentText(new TextEncoder().encode(text)), text);
  assert.equal(decodeHttpAgentText(new Uint8Array()), "");
  assert.equal(decodeHttpAgentText(new Uint8Array(), { allowEmpty: false }), null);
  assert.equal(decodeHttpAgentText(new Uint8Array([0xc3, 0x28])), null);
  assert.equal(decodeHttpAgentText(new Uint8Array([65, 0, 66])), null);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "text/plain", fileName: "data.bin" }), true);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "image/png", fileName: "data.txt" }), false);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "application/octet-stream", fileName: "data.md" }), true);
});
