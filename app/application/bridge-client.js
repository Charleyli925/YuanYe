const DEFAULT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_WRITE_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_ATTACHMENT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 180;
const PROJECT_FILE_STORAGE_VERSION = "4.0.0";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function waitFor(delayMs) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function normalizedPath(pathname) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function queryUrl(baseUrl, pathname, search = {}) {
  const url = new URL(`${baseUrl}${normalizedPath(pathname)}`);
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  return isRecord(payload) ? payload : {};
}

function bridgeError(response, payload, fallback, outcome = "rejected") {
  const raw = isRecord(payload.error) ? payload.error : {};
  const details = isRecord(raw.details)
    ? raw.details
    : isRecord(payload.details)
      ? payload.details
      : {};
  return new BridgeRequestError(
    String(raw.message || payload.message || fallback),
    {
      status: response.status,
      code: String(raw.code || payload.code || ""),
      details,
      outcome,
    },
  );
}

export class BridgeRequestError extends Error {
  constructor(message, {
    status = 0,
    code = "",
    details = {},
    outcome = "rejected",
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BridgeRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.outcome = outcome;
  }
}

export function isBridgeRequestError(value) {
  return value instanceof BridgeRequestError;
}

export function createBridgeClient({
  baseUrl,
  authToken = "",
  fetchImpl = globalThis.fetch,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  if (!baseUrl) throw new TypeError("Bridge baseUrl is required.");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Bridge fetch implementation is required.");
  }

  const fetchResponse = async (
    input,
    init = {},
    {
      timeoutMs = DEFAULT_READ_TIMEOUT_MS,
      fallback = "本地项目资料暂时没有响应。",
    } = {},
  ) => {
    const method = String(init.method || "GET").toUpperCase();
    const readOnly = method === "GET" || method === "HEAD";
    const attemptCount = readOnly ? 2 : 1;
    let lastError = null;
    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const headers = new Headers(init.headers);
      if (authToken) headers.set("x-html-ai-bridge-token", authToken);
      const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
      const signal = timeoutSignal && init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal || init.signal;
      try {
        const response = await fetchImpl(input, { ...init, headers, signal });
        const transientStatus = response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500;
        if (!readOnly || !transientStatus || attempt + 1 >= attemptCount) {
          return response;
        }
      } catch (cause) {
        lastError = cause;
        if (init.signal?.aborted || attempt + 1 >= attemptCount) {
          throw new BridgeRequestError(fallback, {
            outcome: readOnly ? "rejected" : "unknown",
            cause,
          });
        }
      }
      await waitFor(retryDelayMs * (attempt + 1));
    }
    throw new BridgeRequestError(fallback, {
      outcome: readOnly ? "rejected" : "unknown",
      cause: lastError,
    });
  };

  const jsonRequest = async (
    input,
    init = {},
    {
      timeoutMs = DEFAULT_READ_TIMEOUT_MS,
      fallback = "本地项目资料暂时没有响应。",
    } = {},
  ) => {
    const response = await fetchResponse(input, init, { timeoutMs, fallback });
    const payload = await readJson(response);
    if (!response.ok) {
      const method = String(init.method || "GET").toUpperCase();
      const mutationMayHaveCommitted =
        method !== "GET"
        && method !== "HEAD"
        && (response.status === 408 || response.status >= 500);
      throw bridgeError(
        response,
        payload,
        fallback,
        mutationMayHaveCommitted ? "unknown" : "rejected",
      );
    }
    return payload;
  };

  const query = (
    pathname,
    search,
    fallback,
    timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  ) => jsonRequest(
    queryUrl(baseUrl, pathname, search),
    { cache: "no-store" },
    { fallback, timeoutMs },
  );

  const command = (
    pathname,
    body,
    fallback,
    timeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
  ) => jsonRequest(
    `${baseUrl}${normalizedPath(pathname)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { fallback, timeoutMs },
  );

  return Object.freeze({
    workspace: (sourcePath, { operationId } = {}) => query(
      "/workspace",
      {
        sourcePath,
        projectStorageVersion: PROJECT_FILE_STORAGE_VERSION,
        operationId,
      },
      "本地项目记录不可用。",
    ),
    workspaceEnvelope: (sourcePath, { operationId } = {}) => query(
      "/workspace",
      {
        sourcePath,
        projectStorageVersion: PROJECT_FILE_STORAGE_VERSION,
        operationId,
        shape: "core-supplemental",
      },
      "本地项目记录不可用。",
    ),
    source: (sourcePath, { timeoutMs = DEFAULT_READ_TIMEOUT_MS } = {}) => query(
      "/source",
      { sourcePath, projectStorageVersion: PROJECT_FILE_STORAGE_VERSION },
      "无法读取当前源 HTML。",
      timeoutMs,
    ),
    sourcePreview: (sourcePath) => query(
      "/source-preview",
      { sourcePath },
      "无法预览磁盘上的源 HTML。",
    ),
    sourceStat: (sourcePath) => query(
      "/source-stat",
      { sourcePath },
      "无法检查磁盘上的源 HTML。",
    ),
    conflictCandidate: (sourcePath) => query(
      "/conflict-candidate",
      { sourcePath },
      "无法读取源文件冲突候选。",
    ),
    conversation: (sourcePath) => query(
      "/conversation",
      { sourcePath },
      "暂时无法读取这份文档的对话。",
    ),
    conversationList: (sourcePath) => query(
      "/conversation/list",
      { sourcePath },
      "暂时无法读取对话历史。",
    ),
    status: (sourcePath, requestId, attemptId) => query(
      "/status",
      { sourcePath, requestId, attemptId },
      "暂时无法核对本轮任务状态。",
    ),
    versionFile: (sourcePath, versionId) => query(
      "/version-file",
      { sourcePath, versionId },
      "无法读取这份不可变版本。",
    ),
    projectFile: (sourcePath, path) => query(
      "/file",
      { sourcePath, path },
      "无法读取长期规则。",
    ),
    ensureProject: (body) => command(
      "/project/ensure",
      body,
      "无法建立项目记录。",
    ),
    reconcileManagedWorkingCopy: (body) => command(
      "/managed-working-copy/reconcile",
      body,
      "无法核对当前工作文件的位置。",
    ),
    autosave: (body) => command(
      "/autosave",
      body,
      "无法把修改更新到源 HTML。",
    ),
    saveConversationDraft: (body) => command(
      "/conversation/draft",
      body,
      "对话草稿暂时无法保存。",
    ),
    saveDraft: (body) => command(
      "/draft",
      body,
      "本轮评论暂时无法记录。",
    ),
    saveAttachment: (body) => command(
      "/attachment",
      body,
      "无法添加评论附件。",
      DEFAULT_ATTACHMENT_TIMEOUT_MS,
    ),
    deleteAttachment: (body) => command(
      "/attachment/delete",
      body,
      "无法删除评论附件。",
      DEFAULT_ATTACHMENT_TIMEOUT_MS,
    ),
    recordSubmission: (body) => command("/submission", body, "本轮要求未保存，没有发送。"),
    finishSubmission: (body) => command("/submission/finish", body, "提交结果暂时无法记录。"),
    createRequest: (body) => command(
      "/request",
      body,
      "无法建立本轮内部 AI 任务。",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    agentAvailability: ({ selection } = {}) => query(
      "/agent/availability",
      { selection: selection ? JSON.stringify(selection) : null },
      "暂时无法检查 Agent。",
    ),
    agentDiagnose: ({ selection } = {}) => query(
      "/agent/diagnose",
      { selection: selection ? JSON.stringify(selection) : null },
      "暂时无法诊断 Agent。",
    ),
    qoderAvailability: ({ selection } = {}) => query(
      "/agent/availability",
      { selection: selection ? JSON.stringify(selection) : null },
      "暂时无法检查 Qoder CLI。",
    ),
    agentProviders: () => query(
      "/agent/providers",
      {},
      "暂时无法读取 Agent Provider 列表。",
    ),
    preflightAgent: (body) => command(
      "/agent/preflight",
      body,
      "Qoder CLI 预检没有完成。",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    installAgent: (body) => command(
      "/agent/install",
      body,
      "Agent 安装没有完成。",
      180_000,
    ),
    cancelAgentInstall: (body) => command(
      "/agent/install/cancel",
      body,
      "Agent 安装停止结果暂时无法确认。",
    ),
    loginAgent: (body) => command(
      "/agent/login",
      body,
      "官方登录没有启动。",
    ),
    cancelAgentLogin: (body) => command(
      "/agent/login/cancel",
      body,
      "官方登录停止结果暂时无法确认。",
    ),
    logoutAgent: (body) => command(
      "/agent/logout",
      body,
      "官方账号没有退出。",
    ),
    setAgentSessionCredential: (body) => command(
      "/agent/session-credential",
      body,
      "API Token 没有接通。",
    ),
    updateAgentConfiguration: (body) => command(
      "/agent/configuration",
      body,
      "Agent 配置没有更新。",
    ),
    cancelAgentConfiguration: (body) => command(
      "/agent/configuration/cancel",
      body,
      "连接验证没有取消。",
    ),
    startAgent: (body) => command(
      "/agent/start",
      body,
      "Qoder CLI 启动结果暂时无法确认。",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    agentStatus: (sourcePath, requestId, attemptId) => query(
      "/agent/status",
      { sourcePath, requestId, attemptId },
      "暂时无法读取 Agent 任务状态。",
    ),
    cancelAgent: (body) => command(
      "/agent/cancel",
      body,
      "Agent 的停止结果暂时无法确认。",
    ),
    resolveConflict: (body) => command(
      "/conflict/resolve",
      body,
      "无法处理外部文件冲突。",
    ),
    activateReadyVersion: (body) => command(
      "/ready-version/activate",
      body,
      "最新版暂时无法打开。",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    createVersionFromHistory: (body) => command("/history-version/create", body, "新版本的创建结果暂时无法确认。", DEFAULT_REQUEST_TIMEOUT_MS),
    queryHistoryCreation: (body) => command("/history-version/result", body, "暂时无法确认新版本的创建结果。"),
    confirmHistoryCreationOpened: (body) => command("/history-version/opened", body, "新版本打开确认暂时没有响应。"),
    cancelActiveRun: (body) => command(
      "/active-run/cancel",
      body,
      "无法取消本轮。",
    ),
    updateProjectFile: (body) => command(
      "/project-file",
      body,
      "无法更新长期规则。",
    ),
    openFolder: (body) => command(
      "/open-folder",
      body,
      "无法打开项目记录。",
    ),
    attachment: async (sourcePath, relativePath) => {
      const url = queryUrl(baseUrl, "/attachment", {
        sourcePath,
        relativePath,
      });
      const response = await fetchResponse(
        url,
        { cache: "no-store" },
        {
          timeoutMs: DEFAULT_ATTACHMENT_TIMEOUT_MS,
          fallback: "无法读取评论附件。",
        },
      );
      if (!response.ok) {
        throw bridgeError(
          response,
          await readJson(response),
          "无法读取评论附件。",
        );
      }
      return response.blob();
    },
  });
}

export function createRuntimeBridgeClient() {
  const runtime = typeof window === "undefined" ? null : window.htmlAIRuntime;
  const connection = runtime?.getBridgeConnection?.() || null;
  const port = typeof window === "undefined"
    ? "4317"
    : connection?.bridgePort
      || runtime?.bridgePort
      || new URLSearchParams(window.location.search).get("bridgePort")
      || "4317";
  const authToken = typeof window === "undefined"
    ? ""
    : connection?.bridgeAuthToken
      || runtime?.bridgeAuthToken
      || new URLSearchParams(window.location.search).get("bridgeAuthToken")
      || "";
  return createBridgeClient({
    baseUrl: `http://127.0.0.1:${port}`,
    authToken,
  });
}
