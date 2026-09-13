import {
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";

export const CANONICAL_LIFECYCLE_STATES = Object.freeze([
  "editing",
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "ready",
  "no-change",
  "complete",
  "cancelled",
  "error",
]);

const CANONICAL = new Set(CANONICAL_LIFECYCLE_STATES);
const LOCKED = new Set([
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
]);
const COMPLETION_OBSERVED = new Set([
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "no-change",
  "complete",
]);

export function canonicalLifecycleState(
  value,
  { readyVersion = false, fallback = "error" } = {},
) {
  const raw = String(value || "");
  if (readyVersion && raw === "ready") {
    return "ready-to-open";
  }
  if (CANONICAL.has(raw)) return raw;
  return CANONICAL.has(fallback) ? fallback : "error";
}

export function isLockedLifecycleState(value) {
  return LOCKED.has(value);
}

export function hasObservedCompletion(run) {
  return run?.completionObserved === true
    || COMPLETION_OBSERVED.has(run?.status);
}

function progressStep(key, label, detail, state) {
  return { key, label, detail, state };
}

function progressContext(run, handoffValue) {
  const completionObserved = hasObservedCompletion(run);
  const handoff = handoffValue && typeof handoffValue === "object"
    ? handoffValue
    : { status: handoffValue };
  const handoffStatus = String(handoff.status || "idle");
  const agentMode = handoff.mode === "managed-agent";
  const agentName = String(handoff.agentName || "Agent").trim().slice(0, 80) || "Agent";
  return {
    run,
    handoff,
    handoffStatus,
    agentMode,
    agentName,
    status: canonicalLifecycleState(run.status),
    completionObserved,
    copyFailed: !agentMode && handoffStatus === "failed" && !completionObserved,
    copyConfirmed: handoffStatus === "copied" || completionObserved,
    agentFailed: agentMode
      && ["failed", "interrupted"].includes(handoffStatus)
      && !completionObserved,
    agentRunning: agentMode
      && ["starting", "running", "cancelling"].includes(handoffStatus),
    agentCompleted: agentMode
      && (handoffStatus === "completed" || completionObserved),
  };
}

function progressPresentationCopy(
  eyebrow,
  title,
  statusLabel,
  summaryTitle,
  summaryDetail,
) {
  return {
    header: { eyebrow, title },
    statusLabel,
    summaryTitle,
    summaryDetail,
  };
}

function deriveRunProgressCopy({
  run,
  handoffStatus,
  status,
  copyFailed,
  copyConfirmed,
  agentMode,
  agentFailed,
  agentRunning,
  agentCompleted,
  handoff,
  agentName,
}) {
  if (run.requestId === "pending") {
    return progressPresentationCopy(
      "正在准备本轮修改",
      "正在冻结本轮页面和评论…",
      "正在冻结本轮内容",
      "正在确认本轮任务是否已创建",
      "当前 HTML、评论和项目规则会以同一份冻结快照交给 Agent。",
    );
  }
  if (copyFailed) {
    return progressPresentationCopy(
      "交接失败",
      "AI任务复制失败，请重新复制",
      "复制失败",
      "AI任务尚未复制",
      "请重新复制本轮要求，当前 HTML 未被修改。",
    );
  }
  if (agentFailed) {
    const recoveryRequired = handoff.retryable === false;
    return progressPresentationCopy(
      recoveryRequired ? "生成失败" : "生成中断",
      recoveryRequired ? "生成失败" : "生成中断",
      recoveryRequired
        ? "生成失败"
        : "未生成新版本，页面未修改",
      recoveryRequired
        ? handoff.errorMessage || "本轮没有收到可用的完成结果。"
        : "未生成新版本，页面未修改",
      "未生成新版本，页面未修改",
    );
  }
  if (status === "awaiting-conflict-resolution") {
    return progressPresentationCopy(
      "需要处理",
      "请选择当前 HTML",
      "需要选择当前 HTML",
      "外部文件与 AI 结果发生冲突",
      "请选择采用 AI 版本，或保留外部版本；两边都不会被静默覆盖。",
    );
  }
  if (status === "error") {
    return progressPresentationCopy(
      "处理失败",
      "返回的 HTML 无法使用",
      "需要处理",
      "源 HTML 没有被覆盖",
      "当前 HTML 没有被覆盖；返回编辑后仍可查看上轮处理",
    );
  }
  if (status === "no-change") {
    return progressPresentationCopy(
      "处理结果",
      "未识别到明确的页面变化",
      "没有新版本",
      "页面与评论可以继续编辑",
      "原评论和附件都已保留，调整要求后可以重新发送",
    );
  }
  if (status === "ready-to-open") {
    const continuityNeedsReview = run.candidateAssessment?.status === "attention";
    return progressPresentationCopy(
      "AI返回结果",
      "AI 修改已完成，可以审阅",
      continuityNeedsReview ? "请先审阅" : "等待决定",
      "审阅后决定是否采用",
      continuityNeedsReview
        ? "HTML 可以打开，但与上一版的共同特征较少，不会直接替换当前页面"
        : "不会直接替换当前页面。",
    );
  }
  if (status === "complete") {
    return progressPresentationCopy(
      "AI返回结果",
      "最新版已打开",
      "已打开新版本",
      "最新版已经打开",
      "当前画布已经切换到新版本。",
    );
  }
  if (["validating", "committing", "recovering-transaction"].includes(status)) {
    return progressPresentationCopy(
      "AI返回结果",
      "AI 已返回，正在校验并保存",
      "正在校验并保存",
      "正在校验并保存 AI 返回结果",
      "完成前不会替换当前页面，原评论和当前 HTML 都已保留。",
    );
  }
  if (status === "processing" && agentMode && agentCompleted) {
    return progressPresentationCopy(
      "正在确认结果",
      `${agentName} 已返回，PageRoot 正在检查修改结果`,
      "正在确认结果",
      "当前 HTML 仍未被替换",
      "检查通过后才会进入审阅。",
    );
  }
  if (status === "processing" && agentMode && agentRunning) {
    const phaseCopy = {
      launching: [`正在启动 ${agentName}…`, "正在冻结本轮 HTML、评论和项目规则"],
      "starting-session": [`正在连接 ${agentName}…`, "正在建立本轮受管会话"],
      "reading-task": [`${agentName} 正在读取本轮任务…`, "只读冻结 HTML、评论、附件与项目规则"],
      "writing-candidate": [`${agentName} 正在修改页面…`, "当前 HTML 不会被直接覆盖"],
      finalizing: [`${agentName} 正在整理修改结果…`, "PageRoot 将独立检查返回的页面"],
      "awaiting-validation": ["Agent 已返回，正在校验并保存…", "当前 HTML 不会被直接覆盖"],
      "preparing-review": ["PageRoot 正在准备审阅…", "检查通过后才会进入审阅"],
      cancelling: [`正在停止 ${agentName}…`, "停止完成前本轮仍保持锁定"],
    }[handoff.phase] || [`${agentName} 正在处理…`, "PageRoot 正在接收受管 Agent 进度"];
    return progressPresentationCopy(
      agentName,
      phaseCopy[0],
      handoffStatus === "starting" ? "正在启动" : "正在处理",
      "修改要求已发送",
      phaseCopy[1],
    );
  }
  if (status === "processing" && copyConfirmed) {
    return progressPresentationCopy(
      "等待AI返回结果",
      "AI任务已经复制，直接粘贴给 AI Agent",
      "等待 AI 返回",
      "页面暂时只能看",
      "你的评论还在，AI 改完也不会直接覆盖。",
    );
  }
  return progressPresentationCopy(
    "等待AI返回结果",
    "正在准备并复制 AI 任务",
    handoffStatus === "copying" ? "正在复制 AI 任务" : "正在准备 AI 任务",
    "页面暂时只能看",
    "你的评论还在，AI 改完也不会直接覆盖。",
  );
}

function deriveRunProgressStepsFromContext({
  run,
  handoffStatus,
  status,
  completionObserved,
  copyFailed,
  copyConfirmed,
  agentMode,
  agentFailed,
  agentRunning,
  agentCompleted,
  handoff,
  agentName,
}) {
  const agentDelivery = agentMode;
  const steps = [
    progressStep(
      "handoff",
      agentDelivery ? `正在把修改要求交给 ${agentName}` : "正在准备本轮资料",
      agentDelivery
        ? handoffStatus === "starting"
          ? `正在连接 ${agentName}`
          : `本轮要求已冻结，等待 ${agentName}`
        : handoffStatus === "copying"
        ? "正在写入并核对剪贴板"
        : run.requestId === "pending" || status === "submitting"
          ? "正在冻结本轮要求"
          : "本轮要求已冻结，等待复制交接内容",
      "current",
    ),
    progressStep(
      "ai",
      agentDelivery ? `${agentName} 正在修改页面` : "等待你的 AI 完成修改",
      agentDelivery
        ? agentRunning
          ? `${agentName} 正在执行本轮要求`
          : agentCompleted
            ? "已收到 Agent 完成信号"
            : "Agent 启动后开始"
        : copyConfirmed ? "等待 AI 写回完成记录" : "交接完成后开始",
      agentDelivery
        ? agentRunning ? "current" : agentCompleted ? "done" : "pending"
        : copyConfirmed ? "current" : "pending",
    ),
    progressStep(
      "validation",
      "正在检查 AI 修改结果",
      "检查通过后才可以审阅和采用",
      "pending",
    ),
    progressStep("result", "等待 AI 修改完成", "等待前面的处理完成", "pending"),
  ];
  const [handoffStep, aiStep, validationStep, resultStep] = steps;

  if (agentFailed) {
    const recoveryRequired = handoff.retryable === false;
    Object.assign(
      handoffStep,
      progressStep(
        "handoff",
        recoveryRequired ? "生成失败" : "生成中断",
        recoveryRequired
          ? handoff.errorMessage || "本轮没有收到可用的完成结果。"
          : "未生成新版本，页面未修改",
        "error",
      ),
    );
    aiStep.detail = recoveryRequired
      ? "本轮没有生成新版本"
      : "未生成新版本，页面未修改";
    aiStep.state = "pending";
    validationStep.detail = "尚未收到可验证完成记录";
    resultStep.detail = "当前 HTML 保持不变";
    return steps;
  }

  if (copyFailed) {
    Object.assign(
      handoffStep,
      progressStep(
        "handoff",
        "交接内容尚未复制",
        "剪贴板写入失败；本轮要求已安全保留",
        "error",
      ),
    );
    aiStep.detail = "尚未开始";
    validationStep.detail = "尚未开始";
    resultStep.detail = "没有生成新版本";
    return steps;
  }

  if (copyConfirmed) {
    Object.assign(
      handoffStep,
      progressStep("handoff", "已准备并复制", "交接内容已确认", "done"),
    );
  }
  if (agentDelivery && (agentRunning || agentCompleted)) {
    Object.assign(
      handoffStep,
      progressStep("handoff", `已将修改要求交给 ${agentName}`, "发送内容已固定", "done"),
    );
  }
  if (completionObserved) {
    Object.assign(
      aiStep,
      progressStep("ai", `${agentName} 已完成修改`, "已收到修改结果", "done"),
    );
  } else if (status === "error") {
    aiStep.detail = "未收到完成记录，本轮已停止";
    aiStep.state = "error";
  }

  if (status === "awaiting-conflict-resolution") {
    validationStep.detail = "检测到外部修改与 AI 结果冲突";
    validationStep.state = "error";
    resultStep.label = "请选择当前 HTML";
    resultStep.detail = "两份内容均未被覆盖";
    resultStep.state = "current";
  } else if (status === "error") {
    const validationDetail = run.errorDetail || run.error || "返回的 HTML 无法使用";
    validationStep.detail = completionObserved
      ? validationDetail
      : "尚未开始";
    validationStep.state = completionObserved ? "error" : "pending";
    resultStep.label = "本轮未生成新版本";
    resultStep.detail = run.recoveryHint || "当前 HTML 保持不变";
    resultStep.state = "error";
  } else if (status === "no-change") {
    validationStep.detail = "校验完成，未发现有效差异";
    validationStep.state = "done";
    resultStep.label = "本轮没有产生变化";
    resultStep.detail = "当前 HTML 保持不变";
    resultStep.state = "neutral";
  } else if (status === "ready-to-open") {
    const continuityNeedsReview = run.candidateAssessment?.status === "attention";
    validationStep.detail = continuityNeedsReview
      ? "HTML 可以打开，但与上一版的连续性需要确认"
      : "HTML 健康检查与版本连续性检查完成";
    validationStep.state = continuityNeedsReview ? "attention" : "done";
    resultStep.label = continuityNeedsReview
      ? "AI 修改已保留，请先审阅"
      : "AI 修改已完成，可以审阅";
    resultStep.detail = continuityNeedsReview
      ? "页面变化较大，请先对比审阅再决定是否采用"
      : "审阅后决定是否采用";
    resultStep.state = "current";
  } else if (status === "complete") {
    validationStep.detail = "HTML 健康检查与版本连续性检查完成";
    validationStep.state = "done";
    resultStep.label = "已采用 AI 修改";
    resultStep.detail = "当前画布已切换到采用后的页面";
    resultStep.state = "done";
  } else if (status === "validating") {
    validationStep.detail = "正在检查 HTML 是否可用并核对上一版连续性";
    validationStep.state = "current";
  } else if (status === "committing") {
    validationStep.detail = "检查已通过，正在安全保存新版本";
    validationStep.state = "current";
  } else if (status === "recovering-transaction") {
    validationStep.detail = "正在恢复并核对保存结果";
    validationStep.state = "current";
  }

  return steps;
}

export function deriveRunProgressPresentation(run, handoffStatus = "idle") {
  if (!run) {
    return {
      header: null,
      statusLabel: "",
      summaryTitle: "",
      summaryDetail: "",
      steps: [],
    };
  }

  const context = progressContext(run, handoffStatus);
  return {
    ...deriveRunProgressCopy(context),
    steps: deriveRunProgressStepsFromContext(context),
  };
}

export function deriveRunProgressSteps(run, handoffStatus = "idle") {
  return deriveRunProgressPresentation(run, handoffStatus).steps;
}

export function validationReviewFromRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawStatus = String(value.status || "");
  if (
    rawStatus !== "observed"
    && rawStatus !== "pending"
    && rawStatus !== "waived"
  ) {
    return null;
  }
  return {
    // Compatibility belongs at the domain decoder boundary. The renderer only
    // sees the current model and cannot accidentally restore a retired choice.
    status: rawStatus === "pending" ? "pending" : "observed",
    hardViolationCodes: Array.isArray(value.hardViolationCodes)
      ? value.hardViolationCodes.map(String)
      : [],
    softViolationCodes: Array.isArray(value.softViolationCodes)
      ? value.softViolationCodes.map(String)
      : [],
  };
}

export function candidateAssessmentFromRecord(value) {
  if (!isRecord(value)) return null;
  const status = String(value.status || "");
  if (!["ready", "attention", "blocked"].includes(status)) return null;
  const health = isRecord(value.health) ? value.health : {};
  const continuity = isRecord(value.continuity) ? value.continuity : {};
  const assessment = {
    status,
    issueCodes: Array.isArray(value.issueCodes)
      ? value.issueCodes.map(String).filter(Boolean)
      : [],
    health: {
      completeDocument: health.completeDocument === true,
      bodyHasContent: health.bodyHasContent === true,
    },
    continuity: {
      status: continuity.status === "related" ? "related" : "uncertain",
    },
  };
  const impact = canonicalImpactFromRecord(value);
  if (impact) Object.assign(assessment, impact);
  return assessment;
}

const IMPACT_SAMPLE_LIMIT = 100;
const BOUNDED_IMPACT_FIELDS = [
  "changedElementCount",
  "requestedTargetCount",
  "outsideTargetCount",
  "changedElementIdSample",
  "outsideTargetElementIdSample",
  "truncated",
];
const LEGACY_IMPACT_ARRAY_FIELDS = [
  "changedStableElementIds",
  "requestedTargetElementIds",
  "outsideRequestedTargetElementIds",
];

function validImpactIdList(ids, { bounded } = {}) {
  return Array.isArray(ids)
    && (!bounded || ids.length <= IMPACT_SAMPLE_LIMIT)
    && ids.every((id) => isValidPagerootElementId(id))
    && new Set(ids).size === ids.length;
}

function canonicalImpactFromRecord(value) {
  const hasBoundedImpact = BOUNDED_IMPACT_FIELDS.every(
    (field) => Object.hasOwn(value, field),
  );
  const hasLegacyImpact = LEGACY_IMPACT_ARRAY_FIELDS.every(
    (field) => Object.hasOwn(value, field),
  );
  if (hasBoundedImpact && hasLegacyImpact) return null;
  if (hasBoundedImpact) {
    const changed = Array.isArray(value.changedElementIdSample)
      ? value.changedElementIdSample.map(String)
      : [];
    const outside = Array.isArray(value.outsideTargetElementIdSample)
      ? value.outsideTargetElementIdSample.map(String)
      : [];
    if (
      Number.isSafeInteger(value.changedElementCount)
      && value.changedElementCount >= 0
      && Number.isSafeInteger(value.requestedTargetCount)
      && value.requestedTargetCount >= 0
      && Number.isSafeInteger(value.outsideTargetCount)
      && value.outsideTargetCount >= 0
      && value.outsideTargetCount <= value.changedElementCount
      && typeof value.truncated === "boolean"
      && value.truncated === (
        value.changedElementCount > changed.length
        || value.outsideTargetCount > outside.length
      )
      && validImpactIdList(changed, { bounded: true })
      && validImpactIdList(outside, { bounded: true })
    ) {
      return {
        changedElementCount: value.changedElementCount,
        requestedTargetCount: value.requestedTargetCount,
        outsideTargetCount: value.outsideTargetCount,
        changedElementIdSample: changed,
        outsideTargetElementIdSample: outside,
        truncated: value.truncated,
      };
    }
    return null;
  }
  if (!hasLegacyImpact) return null;
  const changed = Array.isArray(value.changedStableElementIds)
    ? value.changedStableElementIds.map(String)
    : [];
  const requested = Array.isArray(value.requestedTargetElementIds)
    ? value.requestedTargetElementIds.map(String)
    : [];
  const outside = Array.isArray(value.outsideRequestedTargetElementIds)
    ? value.outsideRequestedTargetElementIds.map(String)
    : [];
  const requestedTargetCount = Number.isSafeInteger(value.requestedTargetCount)
    && value.requestedTargetCount >= 0
    ? value.requestedTargetCount
    : requested.length;
  if (
    !validImpactIdList(changed)
    || !validImpactIdList(requested)
    || !validImpactIdList(outside)
    || outside.some((id) => !changed.includes(id))
  ) {
    return null;
  }
  return {
    changedElementCount: changed.length,
    requestedTargetCount,
    outsideTargetCount: outside.length,
    changedElementIdSample: changed.slice(0, IMPACT_SAMPLE_LIMIT),
    outsideTargetElementIdSample: outside.slice(0, IMPACT_SAMPLE_LIMIT),
    truncated: changed.length > IMPACT_SAMPLE_LIMIT
      || outside.length > IMPACT_SAMPLE_LIMIT,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayVersionLabel(ordinal) {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

function safeVersionLabel(versionId) {
  const match = String(versionId || "").match(/(\d+)$/);
  return match ? `版本 ${Number(match[1])}` : String(versionId || "");
}

const ERROR_COPY_BY_CODE = new Map([
  ["INCOMPLETE_HTML", "返回的 HTML 不完整，当前页面没有被覆盖。"],
  ["HTML_DOCUMENT_INCOMPLETE", "返回的 HTML 不完整，无法打开。"],
  ["HTML_BODY_EMPTY", "返回的 HTML 没有可显示的页面内容。"],
  ["OUTPUT_HASH_MISMATCH", "返回文件在完成后发生了变化，当前 HTML 没有被覆盖。"],
  ["BASE_SNAPSHOT_HASH_MISMATCH", "本轮基准 HTML 与提交时不一致，当前 HTML 没有被覆盖。"],
  ["COMPARISON_HASH_MISMATCH", "返回结果与完成记录不一致，当前 HTML 没有被覆盖。"],
  ["COMPLETION_IDENTITY_MISMATCH", "返回结果不属于当前这一轮，当前 HTML 没有被覆盖。"],
  ["OUTPUT_MANAGED_META_MISMATCH", "返回结果的页面身份与当前项目不一致，当前 HTML 没有被覆盖。"],
  ["OUTPUT_PROTOCOL_VIOLATION", "返回文件不符合本轮约定，当前 HTML 没有被覆盖。"],
  ["UNEXPECTED_ATTEMPT_OUTPUT", "本轮返回了约定之外的文件，当前 HTML 没有被覆盖。"],
  ["UNEXPECTED_OUTPUT_FILE", "本轮返回了约定之外的文件，当前 HTML 没有被覆盖。"],
  ["HASH_MISMATCH", "返回内容与校验记录不一致，当前页面没有被覆盖。"],
  ["PROTOCOL_FIELD_MISSING", "返回结果缺少必要字段，当前页面没有被覆盖。"],
  ["CANDIDATE_UNUSABLE", "返回的 HTML 无法作为完整页面使用，当前页面没有被覆盖。"],
  ["CANDIDATE_HASH_MISMATCH", "返回内容与校验记录不一致，当前页面没有被覆盖。"],
  ["CANDIDATE_IDENTITY_INVALID", "返回的 HTML 没有保留可信的源码元素身份，当前页面没有被覆盖。"],
]);

const ERROR_CODE_ALIAS = new Map([
  ["CANDIDATE_UNUSABLE", "PROTOCOL_FIELD_MISSING"],
  ["CANDIDATE_HASH_MISMATCH", "HASH_MISMATCH"],
  ["FROZEN_INPUT_HASH_MISMATCH", "HASH_MISMATCH"],
  ["REQUEST_OUTPUT_CHANGED", "HASH_MISMATCH"],
]);

function localizedRunError(rawError, completionObserved) {
  const error = isRecord(rawError) ? rawError : {};
  const rawCode = isRecord(rawError) ? String(error.code || error.errorCode || "") : "";
  const code = rawCode.startsWith("CANDIDATE_SOURCE_IDENTITY_")
    ? "CANDIDATE_IDENTITY_INVALID"
    : ERROR_CODE_ALIAS.get(rawCode) || rawCode;
  const rawMessage = isRecord(rawError)
    ? String(error.message || "")
    : String(rawError || "");
  const mapped = ERROR_COPY_BY_CODE.get(code) || ERROR_COPY_BY_CODE.get(rawCode);
  const detail = String(error.errorDetail || error.detail || "");
  const recoveryHint = String(error.recoveryHint || "");
  const errorPreview = String(error.errorPreview || "").slice(0, 500);
  if (mapped) {
    return {
      message: mapped,
      code,
      ...(detail ? { errorDetail: detail } : {}),
      ...(recoveryHint ? { recoveryHint } : {}),
      ...(errorPreview ? { errorPreview } : {}),
    };
  }
  if (/^[\s\S]*[\u3400-\u9fff][\s\S]*$/u.test(rawMessage)) {
    return {
      message: rawMessage,
      code,
      ...(detail ? { errorDetail: detail } : {}),
      ...(recoveryHint ? { recoveryHint } : {}),
      ...(errorPreview ? { errorPreview } : {}),
    };
  }
  return {
    message: completionObserved
      ? "返回的 HTML 无法安全采用，当前页面没有被覆盖。"
      : "本轮没有收到可用的完成结果，页面和评论仍然保留。",
    code,
    ...(detail ? { errorDetail: detail } : {}),
    ...(recoveryHint ? { recoveryHint } : {}),
    ...(errorPreview ? { errorPreview } : {}),
  };
}

export function activeRunFromRecord(raw) {
  if (!isRecord(raw)) return null;
  const conflict = isRecord(raw.conflict) ? raw.conflict : raw;
  const requestId = String(raw.requestId || "");
  if (!requestId) return null;
  const candidateVersionId = String(raw.candidateVersionId || "");
  const candidateVersionOrdinal = Number(raw.candidateVersionOrdinal);
  const status = canonicalLifecycleState(raw.status || "processing");
  const completionObserved = raw.completionObserved === true
    || COMPLETION_OBSERVED.has(status);
  const localizedError = raw.error
    ? localizedRunError(raw.error, completionObserved)
    : null;
  const candidateAssessment = candidateAssessmentFromRecord(
    raw.candidateAssessment,
  );
  let agentDelivery = null;
  try {
    agentDelivery = raw.agentDelivery
      ? normalizeAgentDelivery(raw.agentDelivery)
      : null;
  } catch {
    agentDelivery = null;
  }
  return {
    projectId: String(raw.projectId || ""),
    documentId: String(raw.documentId || ""),
    // Legacy records have no origin Working Copy. The current screen, path
    // and based-on Version cannot supply that missing Request identity.
    sourceWorkingCopyId: typeof raw.sourceWorkingCopyId === "string"
      && raw.sourceWorkingCopyId.length > 0 ? raw.sourceWorkingCopyId : null,
    requestId,
    attemptId: String(raw.attemptId || "attempt_001"),
    requestPath: String(raw.requestPath || ""),
    attemptPath: String(raw.attemptPath || ""),
    handoffMessage: String(raw.handoffMessage || ""),
    ...(agentDelivery ? { agentDelivery } : {}),
    status,
    sourcePath: String(raw.sourcePath || ""),
    baseSnapshotSha256: String(raw.baseSnapshotSha256 || ""),
    previousVersionId: raw.previousVersionId
      ? String(raw.previousVersionId)
      : null,
    basedOnVersionId: raw.basedOnVersionId
      ? String(raw.basedOnVersionId)
      : null,
    freezeCutoffRevision: Number(raw.freezeCutoffRevision || 0),
    candidateVersionId,
    candidateVersionLabel: String(
      raw.candidateDisplayVersionLabel
      || (
        Number.isSafeInteger(candidateVersionOrdinal)
        && candidateVersionOrdinal > 0
          ? displayVersionLabel(candidateVersionOrdinal)
          : null
      )
      || raw.candidateVersionLabel
      || (candidateVersionId ? safeVersionLabel(candidateVersionId) : "下一版"),
    ),
    submittedAt: String(raw.submittedAt || ""),
    ...(raw.summary ? { summary: String(raw.summary) } : {}),
    ...(Number.isFinite(Number(raw.commentCount))
      ? { commentCount: Number(raw.commentCount) }
      : {}),
    ...(Number.isFinite(Number(raw.changeEventCount))
      ? { changeEventCount: Number(raw.changeEventCount) }
      : {}),
    ...(localizedError?.message ? { error: localizedError.message } : {}),
    ...(localizedError?.code ? { errorCode: localizedError.code } : {}),
    ...(localizedError?.errorDetail ? { errorDetail: localizedError.errorDetail } : {}),
    ...(localizedError?.recoveryHint ? { recoveryHint: localizedError.recoveryHint } : {}),
    ...(localizedError?.errorPreview ? { errorPreview: localizedError.errorPreview } : {}),
    ...(completionObserved ? { completionObserved: true } : {}),
    ...(raw.conflictId || conflict.conflictId
      ? { conflictId: String(raw.conflictId || conflict.conflictId) }
      : {}),
    ...(conflict.externalSourceSha256
      ? { externalSourceSha256: String(conflict.externalSourceSha256) }
      : {}),
    ...(conflict.candidateOutputSha256 || conflict.candidateSha256
      ? {
          candidateOutputSha256: String(
            conflict.candidateOutputSha256 || conflict.candidateSha256,
          ),
        }
      : {}),
    ...(conflict.detectedAt
      ? { conflictDetectedAt: String(conflict.detectedAt) }
      : {}),
    ...(isRecord(raw.readyPayload) ? { readyPayload: raw.readyPayload } : {}),
    ...(validationReviewFromRecord(raw.validationReview)
      ? { validationReview: validationReviewFromRecord(raw.validationReview) }
      : {}),
    ...(isRecord(raw.scopeReport) ? { scopeReport: raw.scopeReport } : {}),
    ...(candidateAssessment ? { candidateAssessment } : {}),
  };
}
import { normalizeAgentDelivery } from "../../shared/agent-delivery.mjs";
