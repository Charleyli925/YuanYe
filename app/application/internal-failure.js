/**
 * Owner-side diagnostic exit for recoverable internal reliability failures.
 * Must never create Notice, banners, cards, or other user-facing UI.
 */

import { productErrorMessage } from "../lib/notification-policy.js";

let telemetrySink = null;

export function setInternalFailureTelemetry(sink) {
  telemetrySink = typeof sink === "function" ? sink : null;
}

export function reportInternalFailure({
  area,
  operation,
  code,
  recovered = false,
  cause = null,
} = {}) {
  const record = Object.freeze({
    area: String(area || "unknown"),
    operation: String(operation || "unknown"),
    code: String(code || "unknown"),
    recovered: Boolean(recovered),
    at: Date.now(),
  });
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    const detail = cause instanceof Error
      ? cause.message
      : cause == null
        ? ""
        : cause && typeof cause === "object"
          ? productErrorMessage(cause, "内部错误")
          : String(cause);
    console.warn(
      "[pageroot:internal-failure]",
      record.area,
      record.operation,
      record.code,
      record.recovered ? "recovered" : "unrecovered",
      detail,
    );
  }
  try {
    telemetrySink?.(record);
  } catch {
    // Telemetry must never interrupt recovery or fail-closed edits.
  }
  return record;
}
