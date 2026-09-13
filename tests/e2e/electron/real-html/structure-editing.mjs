import { FIXED_STRUCTURE_SAMPLES } from "./plan.mjs";

export const FIXED_STRUCTURE_REASON_CODES = Object.freeze({
  SAMPLE_NOT_FOUND: "FIXED_SAMPLE_NOT_FOUND",
  SAMPLE_CARDINALITY_INVALID: "FIXED_SAMPLE_CARDINALITY_INVALID",
  EXPECTED_COPYABILITY_MISMATCH: "EXPECTED_COPYABILITY_MISMATCH",
  EXPECTED_NATIVE_MODE_MISMATCH: "EXPECTED_NATIVE_MODE_MISMATCH",
});

export class FixedStructureSampleError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "FixedStructureSampleError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Resolve one declared selector.  There is intentionally no candidate loop:
 * a missing or invalid sample is evidence, not an invitation to find another.
 */
export async function resolveFixedStructureSample(frame, sample) {
  const matches = frame.locator(sample.selector);
  const count = await matches.count();
  if (count === 0) {
    throw new FixedStructureSampleError(
      `Fixed ${sample.id} sample was not found: ${sample.selector}`,
      FIXED_STRUCTURE_REASON_CODES.SAMPLE_NOT_FOUND,
      { sampleId: sample.id, selector: sample.selector },
    );
  }
  if (count !== 1) {
    throw new FixedStructureSampleError(
      `Fixed ${sample.id} must match exactly once; observed ${count}.`,
      FIXED_STRUCTURE_REASON_CODES.SAMPLE_CARDINALITY_INVALID,
      { sampleId: sample.id, selector: sample.selector, count },
    );
  }
  const target = matches.first();
  const sourceId = await target.getAttribute("data-pageroot-id");
  if (!sourceId) {
    throw new FixedStructureSampleError(
      `Fixed ${sample.id} sample has no source identity.`,
      FIXED_STRUCTURE_REASON_CODES.EXPECTED_COPYABILITY_MISMATCH,
      { sampleId: sample.id, selector: sample.selector },
    );
  }
  return {
    sample,
    target,
    count,
    sourceId,
    tagName: await target.evaluate((element) => element.localName),
    observedNativeMode: await target.getAttribute("data-native-mode"),
  };
}

export async function assertFixedNativeMode(resolved) {
  const { sample, target } = resolved;
  const actualMode = await target.getAttribute("data-native-mode");
  // Real user HTML need not carry synthetic fixture mode markers.  When a
  // marker exists, it is an explicit expectation and must agree.
  if (actualMode && sample.expectedNativeMode && actualMode !== sample.expectedNativeMode) {
    throw new FixedStructureSampleError(
      `Fixed ${sample.id} mode ${actualMode} disagrees with ${sample.expectedNativeMode}.`,
      FIXED_STRUCTURE_REASON_CODES.EXPECTED_NATIVE_MODE_MISMATCH,
      { sampleId: sample.id, expected: sample.expectedNativeMode, actual: actualMode },
    );
  }
  return resolved;
}

export async function inspectFixedStructureSamples(frame) {
  const result = {};
  for (const [name, sample] of Object.entries(FIXED_STRUCTURE_SAMPLES)) {
    try {
      const resolved = await assertFixedNativeMode(
        await resolveFixedStructureSample(frame, sample),
      );
      result[name] = {
        status: "found",
        sampleId: sample.id,
        selector: sample.selector,
        expectedCopyable: sample.expectedCopyable,
        sourceId: resolved.sourceId,
        tagName: resolved.tagName,
        count: resolved.count,
      };
    } catch (error) {
      if (!(error instanceof FixedStructureSampleError)) throw error;
      result[name] = {
        status: error.code === FIXED_STRUCTURE_REASON_CODES.SAMPLE_NOT_FOUND
          ? "missing"
          : "invalid",
        sampleId: sample.id,
        selector: sample.selector,
        expectedCopyable: sample.expectedCopyable,
        reason: error.code,
      };
    }
  }
  return result;
}
