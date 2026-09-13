import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRunFromRecord,
  candidateAssessmentFromRecord,
  canonicalLifecycleState,
  deriveRunProgressPresentation,
  deriveRunProgressSteps,
  hasObservedCompletion,
  isLockedLifecycleState,
  validationReviewFromRecord,
} from "../app/domain/run-lifecycle.js";

test("unknown lifecycle names fail closed instead of becoming a current state", () => {
  assert.equal(canonicalLifecycleState("waiting"), "error");
  assert.equal(canonicalLifecycleState("result-ready"), "error");
  assert.equal(canonicalLifecycleState("canceled"), "error");
  assert.equal(canonicalLifecycleState("unknown"), "error");
  assert.equal(canonicalLifecycleState("processing"), "processing");
  assert.equal(canonicalLifecycleState("cancelled"), "cancelled");
});

test("a ready Version still maps the current ready status to ready-to-open", () => {
  assert.equal(
    canonicalLifecycleState("ready", { readyVersion: true }),
    "ready-to-open",
  );
  assert.equal(
    canonicalLifecycleState("complete", { readyVersion: true }),
    "complete",
  );
});

test("one canonical lock policy owns lifecycle interaction state", () => {
  assert.equal(isLockedLifecycleState("processing"), true);
  assert.equal(isLockedLifecycleState("ready-to-open"), true);
  assert.equal(isLockedLifecycleState("complete"), false);
  assert.equal(isLockedLifecycleState("cancelled"), false);
});

test("AI completion progress uses explicit evidence instead of generic errors", () => {
  assert.equal(hasObservedCompletion({ status: "processing" }), false);
  assert.equal(hasObservedCompletion({ status: "error" }), false);
  assert.equal(hasObservedCompletion({
    status: "error",
    completionObserved: true,
  }), true);
  assert.equal(hasObservedCompletion({
    status: "awaiting-conflict-resolution",
  }), true);
  assert.equal(hasObservedCompletion({
    status: "recovering-transaction",
  }), true);
});

test("run progress exposes four user stages instead of internal validation steps", () => {
  const processing = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "processing",
  }, "copied");
  assert.deepEqual(
    processing.map(({ label, state }) => ({ label, state })),
    [
      { label: "已准备并复制", state: "done" },
      { label: "等待你的 AI 完成修改", state: "current" },
      { label: "正在检查 AI 修改结果", state: "pending" },
      { label: "等待 AI 修改完成", state: "pending" },
    ],
  );
  assert.equal(
    processing[2].detail,
    "检查通过后才可以审阅和采用",
  );

  const copyFailure = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "processing",
  }, "failed");
  assert.equal(copyFailure.length, 4);
  assert.deepEqual(
    copyFailure.map(({ state }) => state),
    ["error", "pending", "pending", "pending"],
  );
  assert.equal(
    copyFailure[0].detail,
    "剪贴板写入失败；本轮要求已安全保留",
  );
});

test("run progress keeps completion, validation, and result facts separate", () => {
  const preCompletionError = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "error",
    error: "Attempt contains an unauthorized entry.",
  }, "copied");
  assert.deepEqual(
    preCompletionError.map(({ state }) => state),
    ["done", "error", "pending", "error"],
  );

  const validationError = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "error",
    completionObserved: true,
    error: "结果 Hash 不一致",
  }, "copied");
  assert.deepEqual(
    validationError.map(({ state }) => state),
    ["done", "done", "error", "error"],
  );
  assert.equal(validationError[2].detail, "结果 Hash 不一致");

  const ready = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "ready-to-open",
  });
  assert.deepEqual(
    ready.map(({ state }) => state),
    ["done", "done", "done", "current"],
  );
  assert.equal(ready[3].label, "AI 修改已完成，可以审阅");
  assert.equal(ready[3].detail, "审阅后决定是否采用");

  const continuityAttention = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "ready-to-open",
    candidateAssessment: {
      status: "attention",
    },
  });
  assert.deepEqual(
    continuityAttention.map(({ state }) => state),
    ["done", "done", "attention", "current"],
  );
  assert.equal(
    continuityAttention[3].detail,
    "页面变化较大，请先对比审阅再决定是否采用",
  );

  const noChange = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "no-change",
  });
  assert.deepEqual(
    noChange.map(({ state }) => state),
    ["done", "done", "done", "neutral"],
  );

  const conflict = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "awaiting-conflict-resolution",
  });
  assert.deepEqual(
    conflict.map(({ state }) => state),
    ["done", "done", "error", "current"],
  );
  assert.equal(conflict[3].label, "请选择当前 HTML");
});

test("run presentation copy follows the four stages and keeps exception actions distinct", () => {
  const copyOf = (run, handoffStatus = "idle") => {
    const presentation = deriveRunProgressPresentation(run, handoffStatus);
    return {
      header: presentation.header,
      statusLabel: presentation.statusLabel,
      summaryTitle: presentation.summaryTitle,
      summaryDetail: presentation.summaryDetail,
    };
  };

  assert.deepEqual(
    copyOf({
      requestId: "pending",
      status: "submitting",
    }),
    {
      header: {
        eyebrow: "正在准备本轮修改",
        title: "正在冻结本轮页面和评论…",
      },
      statusLabel: "正在冻结本轮内容",
      summaryTitle: "正在确认本轮任务是否已创建",
      summaryDetail: "当前 HTML、评论和项目规则会以同一份冻结快照交给 Agent。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "submitting",
    }, "copying"),
    {
      header: {
        eyebrow: "等待AI返回结果",
        title: "正在准备并复制 AI 任务",
      },
      statusLabel: "正在复制 AI 任务",
      summaryTitle: "页面暂时只能看",
      summaryDetail: "你的评论还在，AI 改完也不会直接覆盖。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "processing",
    }, "copied"),
    {
      header: {
        eyebrow: "等待AI返回结果",
        title: "AI任务已经复制，直接粘贴给 AI Agent",
      },
      statusLabel: "等待 AI 返回",
      summaryTitle: "页面暂时只能看",
      summaryDetail: "你的评论还在，AI 改完也不会直接覆盖。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "validating",
    }),
    {
      header: {
        eyebrow: "AI返回结果",
        title: "AI 已返回，正在校验并保存",
      },
      statusLabel: "正在校验并保存",
      summaryTitle: "正在校验并保存 AI 返回结果",
      summaryDetail: "完成前不会替换当前页面，原评论和当前 HTML 都已保留。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "ready-to-open",
    }),
    {
      header: {
        eyebrow: "AI返回结果",
        title: "AI 修改已完成，可以审阅",
      },
      statusLabel: "等待决定",
      summaryTitle: "审阅后决定是否采用",
      summaryDetail: "不会直接替换当前页面。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "ready-to-open",
      candidateAssessment: { status: "attention" },
    }),
    {
      header: {
        eyebrow: "AI返回结果",
        title: "AI 修改已完成，可以审阅",
      },
      statusLabel: "请先审阅",
      summaryTitle: "审阅后决定是否采用",
      summaryDetail: "HTML 可以打开，但与上一版的共同特征较少，不会直接替换当前页面",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "processing",
    }, "failed"),
    {
      header: {
        eyebrow: "交接失败",
        title: "AI任务复制失败，请重新复制",
      },
      statusLabel: "复制失败",
      summaryTitle: "AI任务尚未复制",
      summaryDetail: "请重新复制本轮要求，当前 HTML 未被修改。",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "error",
      completionObserved: true,
    }, "copied"),
    {
      header: {
        eyebrow: "处理失败",
        title: "返回的 HTML 无法使用",
      },
      statusLabel: "需要处理",
      summaryTitle: "源 HTML 没有被覆盖",
      summaryDetail: "当前 HTML 没有被覆盖；返回编辑后仍可查看上轮处理",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "no-change",
    }),
    {
      header: {
        eyebrow: "处理结果",
        title: "未识别到明确的页面变化",
      },
      statusLabel: "没有新版本",
      summaryTitle: "页面与评论可以继续编辑",
      summaryDetail: "原评论和附件都已保留，调整要求后可以重新发送",
    },
  );
  assert.deepEqual(
    copyOf({
      requestId: "req_0001",
      status: "awaiting-conflict-resolution",
    }),
    {
      header: {
        eyebrow: "需要处理",
        title: "请选择当前 HTML",
      },
      statusLabel: "需要选择当前 HTML",
      summaryTitle: "外部文件与 AI 结果发生冲突",
      summaryDetail: "请选择采用 AI 版本，或保留外部版本；两边都不会被静默覆盖。",
    },
  );
});

test("managed Agent progress is provider-neutral and never claims Candidate readiness", () => {
  const run = {
    requestId: "req_qoder",
    status: "processing",
    completionObserved: false,
  };
  const running = deriveRunProgressPresentation(run, {
    mode: "managed-agent",
    agentName: "Codex",
    status: "running",
    phase: "reading-task",
  });
  assert.equal(running.header.title, "Codex 正在读取本轮任务…");
  assert.equal(running.statusLabel, "正在处理");
  assert.equal(running.steps[0].label, "已将修改要求交给 Codex");
  assert.equal(running.steps[1].state, "current");
  assert.equal(running.steps[3].state, "pending");

  const interrupted = deriveRunProgressPresentation(run, {
    mode: "managed-agent",
    agentName: "Codex",
    status: "interrupted",
    phase: "interrupted",
    errorMessage: "会话已停止，但 Request 仍然保留。",
    retryable: false,
  });
  assert.equal(interrupted.statusLabel, "生成失败");
  assert.equal(interrupted.steps[0].state, "error");
  assert.equal(interrupted.steps[1].detail, "本轮没有生成新版本");
  assert.match(interrupted.summaryDetail, /未生成新版本/u);
});

test("legacy validation review choices are decoded at the domain boundary", () => {
  assert.deepEqual(validationReviewFromRecord({
    status: "waived",
    hardViolationCodes: ["scope"],
    softViolationCodes: ["copy"],
  }), {
    status: "observed",
    hardViolationCodes: ["scope"],
    softViolationCodes: ["copy"],
  });
  assert.equal(validationReviewFromRecord({ status: "unknown" }), null);
});

test("candidate assessment exposes only the renderer fields needed for review", () => {
  assert.deepEqual(candidateAssessmentFromRecord({
    status: "attention",
    issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    health: {
      completeDocument: true,
      bodyHasContent: true,
      // Legacy records can still carry this retired field; the renderer
      // decoder intentionally ignores it.
      executableSurfaceUnchanged: true,
    },
    continuity: { status: "uncertain", evidencePoints: 0 },
  }), {
    status: "attention",
    issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    health: {
      completeDocument: true,
      bodyHasContent: true,
    },
    continuity: { status: "uncertain" },
  });
  assert.equal(candidateAssessmentFromRecord({ status: "unknown" }), null);
});

test("candidate assessment projects retired full-array impact into bounded Review facts", () => {
  const changedId = "pr1_00000000000040008000000000000000";
  const outsideId = "pr1_11111111111141118000000000000000";
  const assessment = candidateAssessmentFromRecord({
    status: "ready",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedStableElementIds: [changedId, outsideId],
    requestedTargetElementIds: [changedId],
    outsideRequestedTargetElementIds: [outsideId],
    requestedTargetCount: 1,
  });
  assert.deepEqual(assessment, {
    status: "ready",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedElementCount: 2,
    requestedTargetCount: 1,
    outsideTargetCount: 1,
    changedElementIdSample: [changedId, outsideId],
    outsideTargetElementIdSample: [outsideId],
    truncated: false,
  });
  assert.equal("changedStableElementIds" in assessment, false);
  assert.equal("requestedTargetElementIds" in assessment, false);
  assert.equal("outsideRequestedTargetElementIds" in assessment, false);
});

test("candidate assessment truncates historical full-array impact at the sample limit", () => {
  const changed = Array.from({ length: 101 }, (_item, index) => (
    `pr1_${index.toString(16).padStart(12, "0")}40008${"0".repeat(15)}`
  ));
  const assessment = candidateAssessmentFromRecord({
    status: "attention",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedStableElementIds: changed,
    requestedTargetElementIds: [changed[0]],
    outsideRequestedTargetElementIds: [changed[100]],
    requestedTargetCount: 1,
  });
  assert.equal(assessment.changedElementCount, 101);
  assert.equal(assessment.outsideTargetCount, 1);
  assert.equal(assessment.changedElementIdSample.length, 100);
  assert.deepEqual(assessment.changedElementIdSample, changed.slice(0, 100));
  assert.deepEqual(assessment.outsideTargetElementIdSample, [changed[100]]);
  assert.equal(assessment.truncated, true);
  assert.equal("changedStableElementIds" in assessment, false);
});

test("candidate assessment ignores mixed legacy and bounded impact facts", () => {
  const changedId = "pr1_00000000000040008000000000000000";
  const assessment = candidateAssessmentFromRecord({
    status: "ready",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedStableElementIds: [changedId],
    requestedTargetElementIds: [changedId],
    outsideRequestedTargetElementIds: [],
    requestedTargetCount: 1,
    changedElementCount: 1,
    outsideTargetCount: 0,
    changedElementIdSample: [changedId],
    outsideTargetElementIdSample: [],
    truncated: false,
  });
  assert.deepEqual(assessment, {
    status: "ready",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
  });
});

test("bounded Candidate impact facts reach Review without expanding the renderer payload", () => {
  const changedId = "pr1_00000000000040008000000000000000";
  const outsideId = "pr1_11111111111141118000000000000000";
  assert.deepEqual(candidateAssessmentFromRecord({
    status: "attention",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedElementCount: 1200,
    requestedTargetCount: 2,
    outsideTargetCount: 400,
    changedElementIdSample: [changedId],
    outsideTargetElementIdSample: [outsideId],
    truncated: true,
  }), {
    status: "attention",
    issueCodes: [],
    health: { completeDocument: true, bodyHasContent: true },
    continuity: { status: "related" },
    changedElementCount: 1200,
    requestedTargetCount: 2,
    outsideTargetCount: 400,
    changedElementIdSample: [changedId],
    outsideTargetElementIdSample: [outsideId],
    truncated: true,
  });
});

test("active run records require the current status field", () => {
  assert.deepEqual(activeRunFromRecord({
    projectId: "project_1",
    documentId: "document_1",
    requestId: "req_0001",
    status: "processing",
    candidateVersionOrdinal: 3,
    error: { message: "later" },
    conflict: {
      conflictId: "conflict_1",
      candidateSha256: "sha256:candidate",
    },
    validationReview: { status: "waived" },
  }), {
    projectId: "project_1",
    documentId: "document_1",
    sourceWorkingCopyId: null,
    requestId: "req_0001",
    attemptId: "attempt_001",
    requestPath: "",
    attemptPath: "",
    handoffMessage: "",
    status: "processing",
    sourcePath: "",
    baseSnapshotSha256: "",
    previousVersionId: null,
    basedOnVersionId: null,
    freezeCutoffRevision: 0,
    candidateVersionId: "",
    candidateVersionLabel: "版本 3",
    submittedAt: "",
    error: "本轮没有收到可用的完成结果，页面和评论仍然保留。",
    conflictId: "conflict_1",
    candidateOutputSha256: "sha256:candidate",
    validationReview: {
      status: "observed",
      hardViolationCodes: [],
      softViolationCodes: [],
    },
  });
});

test("run decoding preserves Request origin and never guesses a legacy Working Copy", () => {
  const record = {
    projectId: "project_1", documentId: "document_1", requestId: "req_0001",
    sourceWorkingCopyId: "work_ver_0001", sourcePath: "/synthetic/page-V2.html",
    basedOnVersionId: "ver_0002",
    readyPayload: { openTarget: { workingCopyId: "work_ver_0002" } },
  };
  assert.equal(activeRunFromRecord(record).sourceWorkingCopyId, "work_ver_0001");
  for (const unknown of [undefined, null, "", 123]) {
    assert.equal(activeRunFromRecord({ ...record, sourceWorkingCopyId: unknown }).sourceWorkingCopyId, null);
  }
});

test("active run errors are localized without exposing internal messages or codes", () => {
  const legacyExecutableFailure = activeRunFromRecord({
    requestId: "req_0002",
    status: "error",
    completionObserved: true,
    error: {
      code: "EXECUTABLE_CONTENT_CHANGED",
      message: "The candidate HTML could not be safely adopted.",
    },
  });
  assert.equal(
    legacyExecutableFailure.error,
    "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
  );
  assert.equal(
    legacyExecutableFailure.errorCode,
    "EXECUTABLE_CONTENT_CHANGED",
  );
  assert.doesNotMatch(
    legacyExecutableFailure.error,
    /EXECUTABLE|candidate|脚本/iu,
  );

  const legacyScopeFailure = activeRunFromRecord({
    requestId: "req_0003",
    status: "error",
    completionObserved: true,
    error: {
      code: "HARD_VALIDATION_FAILED",
      message: "AI output failed: TARGET_AMBIGUOUS, TARGET_OUTSIDE_STRUCTURE",
    },
  });
  assert.equal(
    legacyScopeFailure.error,
    "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
  );
  assert.doesNotMatch(legacyScopeFailure.error, /TARGET_|HARD_/u);

  const identityFailure = activeRunFromRecord({
    requestId: "req_identity",
    status: "error",
    completionObserved: true,
    error: {
      code: "CANDIDATE_SOURCE_IDENTITY_LOST",
      errorCode: "CANDIDATE_IDENTITY_INVALID",
      message: "The Candidate omitted an existing identity.",
    },
  });
  assert.equal(
    identityFailure.error,
    "返回的 HTML 没有保留可信的源码元素身份，当前页面没有被覆盖。",
  );
  assert.equal(identityFailure.errorCode, "CANDIDATE_IDENTITY_INVALID");
  assert.doesNotMatch(identityFailure.error, /CANDIDATE_|Stable ID/iu);
});
