import assert from "node:assert/strict";
import test from "node:test";

import { productErrorMessage } from "../app/lib/notification-policy.js";

test("technical Electron IPC prefixes never reach the visible error copy", () => {
  const message = productErrorMessage(
    new Error(
      "Error invoking remote method 'html-projects:export-copy': "
      + "ProjectFileError: 导出 HTML 副本不能覆盖当前源 HTML，请选择另一个位置。",
    ),
    "导出没有完成。",
  );
  assert.equal(
    message,
    "导出 HTML 副本不能覆盖当前源 HTML，请选择另一个位置。",
  );
  assert.doesNotMatch(message, /Error invoking|html-projects|ProjectFileError/);
});

test("structured-clone project errors keep their safe message and code", () => {
  assert.equal(
    productErrorMessage({
      code: "PERMISSION_DENIED",
      message: "没有访问该位置的权限，请选择其他位置。",
      details: { operationId: "operation_0001" },
    }, "项目操作没有完成。"),
    "没有访问该位置的权限，请选择其他位置。",
  );
});

test("internal state vocabulary is translated before display", () => {
  assert.equal(
    productErrorMessage(
      "runtime-state revision Hash 核对失败。",
      "项目状态核对失败。",
    ),
    "项目运行状态 编辑状态 内容校验 核对失败。",
  );
});

test("network timeouts use the product-safe contextual fallback", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.equal(
    productErrorMessage(
      timeout,
      "项目状态读取超时，请重试；源文件没有被改动。",
    ),
    "项目状态读取超时，请重试；源文件没有被改动。",
  );
});

test("structured project identity errors use one safe product message", () => {
  const error = new Error(
    "projectId does not match sourcePath /Users/example/private-report.html",
  );
  error.code = "PROJECT_ID_MISMATCH";
  assert.equal(
    productErrorMessage(error, "项目操作没有完成。"),
    "项目身份暂时无法核对。当前内容仍保留，请重新打开源页后再试。",
  );
});

test("managed locator failures stay user-facing and do not leak paths", () => {
  const mismatch = new Error("inode 12345 at /Users/secret/report.html");
  mismatch.code = "MANAGED_SOURCE_IDENTITY_MISMATCH";
  assert.equal(
    productErrorMessage(mismatch, "项目操作没有完成。"),
    "当前工作文件身份无法核对，PageRoot 没有切换路径。",
  );
  const ambiguous = new Error("device 1 inode 2");
  ambiguous.code = "MANAGED_PATH_AMBIGUOUS";
  assert.equal(
    productErrorMessage(ambiguous, "项目操作没有完成。"),
    "当前文件无法唯一对应到工作文件。PageRoot 没有写入，请先恢复唯一位置。",
  );
  const missing = new Error("ENOENT /Users/secret/report.html");
  missing.code = "WORKING_COPY_UNAVAILABLE";
  assert.equal(
    productErrorMessage(missing, "项目操作没有完成。"),
    "文件暂不可用，修改仍保留。",
  );
});

test("candidate assessment failures use accurate localized project copy", () => {
  const error = new Error(
    "candidate-assessment.json is structurally invalid.",
  );
  error.code = "CANDIDATE_ASSESSMENT_INVALID";
  assert.equal(
    productErrorMessage(error, "项目状态暂时无法读取。"),
    "某次 AI 结果的校验记录无法核对。当前 HTML 没有被改动，请重试读取。",
  );
});

test("unknown internal fields and local paths never reach product copy", () => {
  assert.equal(
    productErrorMessage(
      new Error(
        "documentId doc_secret does not match sourcePath /Users/example/report.html",
      ),
      "项目操作没有完成。",
    ),
    "项目操作没有完成。",
  );
  assert.equal(
    productErrorMessage(
      new Error("Unexpected lifecycle invariant violation"),
      "项目操作没有完成。",
    ),
    "项目操作没有完成。",
  );
});
