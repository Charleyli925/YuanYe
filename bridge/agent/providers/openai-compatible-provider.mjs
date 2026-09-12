import { sha256 } from "../../lifecycle-core.mjs";
import { completeOpenAiCompatibleChat } from "../runtimes/http-runtime.mjs";
import { agentProviderError, defineAgentProvider } from "./agent-provider-contract.mjs";
import { openAiCompatibleVendorAdapter } from "./openai-compatible-vendor-adapters.mjs";
import { loadExecutionPolicy } from "../policies/execution-policy.mjs";
import {
  PAGEROOT_PROVIDER_ID,
  PAGEROOT_RUNTIME_ID,
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  httpAgentTestOverrideEnabled,
  normalizeOpenAiCompatibleReasoning,
  openAiCompatibleModelCapability,
  publicModelsForVendor,
  resolveOpenAiCompatibleVendor,
  testOpenAiCompatibleBaseUrl,
} from "../../../shared/openai-compatible-vendors.mjs";
import { SUPPORTED_AGENT_MODELS_REVISION } from "../../../shared/supported-agent-models.mjs";
import { HTTP_AGENT_INPUT_POLICY_REVISION } from "../../../shared/agent-input-policy.mjs";

const HTTP_AGENT_CAPABILITY_REVISION = `${SUPPORTED_AGENT_MODELS_REVISION}:${HTTP_AGENT_INPUT_POLICY_REVISION}`;

const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,159}$/u;
const PREFLIGHT_HTML = "<!DOCTYPE html><html><head><title>PageRoot preflight</title></head><body><p data-pageroot-id=\"preflight\">ready</p></body></html>";

function fail(code, message, options) { throw agentProviderError(code, message, options); }
function cleanText(value, maxLength = 160) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, maxLength);
}
function localModelId(modelId) {
  const value = String(modelId || "");
  return value.startsWith(`${PAGEROOT_PROVIDER_ID}:`)
    ? value.slice(`${PAGEROOT_PROVIDER_ID}:`.length)
    : value;
}

function credentialFromEnvironment(environment = {}) {
  const apiKey = cleanText(environment.PAGEROOT_API_KEY, 512);
  const resolved = resolveOpenAiCompatibleVendor(
    environment.PAGEROOT_API_VENDOR,
    environment.PAGEROOT_API_BASE_URL,
  );
  if (!apiKey || !resolved) return null;
  const fenced = httpAgentTestOverrideEnabled(environment);
  const testUrl = testOpenAiCompatibleBaseUrl(environment);
  if (fenced && !testUrl) return null;
  return Object.freeze({
    apiKey,
    vendorId: resolved.id,
    baseUrl: testUrl || resolved.baseUrl,
    credentialGeneration: Number(environment.PAGEROOT_API_CREDENTIAL_GENERATION || 0),
  });
}

function publicCustomModel(modelId) {
  const id = localModelId(modelId);
  if (!SAFE_MODEL_ID.test(id)) return null;
  return Object.freeze({
    id: `${PAGEROOT_PROVIDER_ID}:${id}`,
    providerModelId: id,
    displayName: id,
    isDefault: true,
    releaseChannel: "compatibility",
    reasoningChoices: openAiCompatibleModelCapability("custom", id).reasoningChoices,
  });
}

function modelsForCredential(credential, environment, selection) {
  if (credential.vendorId === "custom") {
    const manual = publicCustomModel(selection?.requestedModelId);
    if (!manual) fail("AGENT_MODEL_ID_REQUIRED", "兼容接口必须手动填写 Model ID。", { status: 422 });
    return Object.freeze([manual]);
  }
  const models = publicModelsForVendor(credential.vendorId, environment);
  if (!models.length) {
    fail(
      "AGENT_MODEL_NOT_RELEASED",
      "该厂商尚无通过真实 smoke 的正式模型。可在开发版本中启用 Beta 模型。",
      { status: 409 },
    );
  }
  return models;
}

function resolvedPagerootReasoning(selection, model) {
  const requested = normalizeOpenAiCompatibleReasoning(selection?.reasoning?.requested);
  if (requested && requested !== "auto") {
    if (!(model?.reasoningChoices || []).some((choice) => choice.id === requested)) {
      fail("AGENT_SELECTION_UNSUPPORTED", "当前模型不支持这个思考档位。", { status: 409 });
    }
    return Object.freeze({ requested, applied: requested, resolution: "exact" });
  }
  return Object.freeze({ requested: null, applied: null, resolution: "provider-default" });
}

function resolvedPagerootSelection(selection, { evidence } = {}) {
  const models = evidence?.models || [];
  const requestedId = selection?.requestedModelId || null;
  const selected = requestedId
    ? models.find((model) => model.id === requestedId)
    : models.find((model) => model.isDefault) || models[0];
  if (!selected) {
    fail(requestedId ? "AGENT_SELECTION_UNSUPPORTED" : "AGENT_MODEL_ID_REQUIRED",
      requestedId ? "当前配置不能使用这个模型。" : "请选择一个 PageRoot 支持的模型。", { status: 409 });
  }
  return Object.freeze({
    providerId: PAGEROOT_PROVIDER_ID,
    runtimeId: PAGEROOT_RUNTIME_ID,
    requestedModelId: requestedId,
    resolvedModelId: selected.id,
    reasoning: resolvedPagerootReasoning(selection, selected),
  });
}

function classifyHttpFailure(cause) {
  if (["AbortError", "TimeoutError"].includes(cause?.name) || cause?.code === "ABORT_ERR") {
    return "AGENT_PREFLIGHT_TIMEOUT";
  }
  const code = String(cause?.code || "");
  if (code === "AGENT_PROTOCOL_INVALID") return "AGENT_NETWORK_INTERRUPTED";
  return code.startsWith("AGENT_") ? code : "AGENT_PROVIDER_UNAVAILABLE";
}

function wrapProviderError(cause, fallbackMessage) {
  const code = classifyHttpFailure(cause);
  const safeMessages = {
    AGENT_AUTH_REQUIRED: "Token 无效，请重新填写。",
    AGENT_MODEL_ACCESS_DENIED: "当前 Token 无权使用这个模型。",
    AGENT_SELECTION_UNSUPPORTED: "当前模型不可用，请选择其他受支持模型。",
    AGENT_RATE_LIMITED: "请求过于频繁，请稍后重试。",
    AGENT_BALANCE_INSUFFICIENT: "账号余额不足，请充值或更换厂商。",
    AGENT_PLAN_LIMIT: "当前套餐额度已用完，请更换厂商。",
    AGENT_PROVIDER_OVERLOADED: "模型当前过载，请重试或更换模型。",
    AGENT_ENDPOINT_REGION_MISMATCH: "接口地区不匹配，请修改地区或接口。",
    AGENT_PREFLIGHT_TIMEOUT: "连接超时，请重试。",
    AGENT_TURN_TIMEOUT: "连接超时，请重试。",
    AGENT_NETWORK_INTERRUPTED: "网络连接中断，请重试。",
    AGENT_PROMPT_TOO_LARGE: "验证请求超过当前模型限制。",
  };
  return agentProviderError(code, safeMessages[code] || fallbackMessage, {
    status: Number.isSafeInteger(cause?.status) ? cause.status : 502,
  });
}

async function diagnoseOpenAiCompatibleConnection({
  fetchImpl,
  installation,
  environment,
} = {}) {
  const credential = credentialFromEnvironment(environment);
  if (!credential
    || credential.vendorId !== installation?.vendorId
    || credential.baseUrl !== installation?.baseUrl
    || credential.credentialGeneration !== installation?.credentialGeneration
    || sha256(Buffer.from(credential.apiKey, "utf8")) !== installation?.credentialDigest) {
    fail("AGENT_AUTH_REQUIRED", "连接配置已变化，请重新连接。", { status: 401 });
  }
  if (credential.vendorId === "custom") {
    // A Custom endpoint is intentionally manual: Settings validates only the
    // saved configuration. The exact Model ID and service are proven by the
    // bounded execution preflight, never by an optional /models catalog.
    return Object.freeze({
      readiness: "ready",
      cause: null,
      activeInstallation: null,
      facts: Object.freeze({
        installation: "configured",
        authentication: "configured",
        protocol: "unknown",
        service: "unknown",
      }),
    });
  }
  let response;
  try {
    response = await fetchImpl(`${String(installation.baseUrl).replace(/\/+$/u, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("AGENT_NETWORK_INTERRUPTED", "模型接口没有接通。", { status: 502 });
  }
  if (!response?.ok) {
    let payload = null;
    try { payload = JSON.parse(await response.text()); } catch { payload = null; }
    const adapter = openAiCompatibleVendorAdapter(installation.vendorId);
    const code = adapter.normalizeError({ status: response?.status, payload });
    fail(code, "模型接口没有接通。", {
      status: response?.status === 401 || response?.status === 403 ? 401 : 502,
    });
  }
  return Object.freeze({
    readiness: "ready",
    cause: null,
    activeInstallation: null,
    facts: Object.freeze({
      installation: "configured",
      authentication: "ready",
      protocol: "ready",
      service: "unknown",
    }),
  });
}

export function createOpenAiCompatibleProvider({
  fetchImpl = fetch,
  completeChat = completeOpenAiCompatibleChat,
  policyLoader = loadExecutionPolicy,
} = {}) {
  return defineAgentProvider({
    providerId: PAGEROOT_PROVIDER_ID,
    runtimeId: PAGEROOT_RUNTIME_ID,
    displayName: "源页 Agent",
    securityProfile: "client-mediated",
    capabilityRevision: HTTP_AGENT_CAPABILITY_REVISION,
    capabilities: {
      availability: true,
      preflight: true,
      execution: true,
      modelCatalog: true,
      sessionCredential: true,
      disconnect: true,
    },
    resolveInstallation({ environment } = {}) {
      const credential = credentialFromEnvironment(environment);
      if (!credential) fail("AGENT_AUTH_REQUIRED", "还没有接通 API Token。", { status: 401 });
      return Object.freeze({
        source: "session-credential",
        vendorId: credential.vendorId,
        baseUrl: credential.baseUrl,
        version: "2.0.0",
        capabilityRevision: HTTP_AGENT_CAPABILITY_REVISION,
        credentialGeneration: credential.credentialGeneration,
        credentialDigest: sha256(Buffer.from(credential.apiKey, "utf8")),
      });
    },
    diagnose: (installation, { environment } = {}) => diagnoseOpenAiCompatibleConnection({
      fetchImpl,
      installation,
      environment,
    }),
    async preflight(installation, { environment, selection } = {}) {
      const credential = credentialFromEnvironment(environment);
      if (!credential || credential.vendorId !== installation.vendorId
        || credential.baseUrl !== installation.baseUrl
        || credential.credentialGeneration !== installation.credentialGeneration
        || sha256(Buffer.from(credential.apiKey, "utf8")) !== installation.credentialDigest) {
        fail("AGENT_CONFIGURATION_CHANGED", "连接配置已变化，请重新预检。", { status: 409 });
      }
      const models = modelsForCredential(credential, environment, selection);
      const evidence = Object.freeze({
        version: "2.0.0",
        capabilityRevision: HTTP_AGENT_CAPABILITY_REVISION,
        modelCount: models.length,
        models,
        vendorId: credential.vendorId,
      });
      const resolved = resolvedPagerootSelection(selection || {}, { evidence });
      try {
        await completeChat({
          fetchImpl,
          baseUrl: credential.baseUrl,
          apiKey: credential.apiKey,
          modelId: localModelId(resolved.resolvedModelId),
          vendorId: credential.vendorId,
          reasoning: resolved.reasoning.applied || DEFAULT_OPENAI_COMPATIBLE_REASONING,
          signal: AbortSignal.timeout(15_000),
          maxOutputTokens: 256,
          messages: Object.freeze([
            Object.freeze({ role: "system", content: "Return exactly one complete HTML document." }),
            Object.freeze({ role: "user", content: `Return this document unchanged:\n${PREFLIGHT_HTML}` }),
          ]),
        });
      } catch (cause) {
        throw wrapProviderError(cause, "当前 Token 和模型没有完成真实协议验证。");
      }
      return evidence;
    },
    assertInstallationUnchanged(installation, { environment } = {}) {
      if (installation?.source !== "session-credential" || !installation.credentialDigest) {
        fail("AGENT_INSTALLATION_CHANGED", "API Token 已变化，请重新连接。", { status: 409 });
      }
      if (environment) {
        const current = credentialFromEnvironment(environment);
        if (!current || current.vendorId !== installation.vendorId
          || current.baseUrl !== installation.baseUrl
          || current.credentialGeneration !== installation.credentialGeneration
          || sha256(Buffer.from(current.apiKey, "utf8")) !== installation.credentialDigest) {
          fail("AGENT_CONFIGURATION_CHANGED", "连接配置已变化，请重新预检。", { status: 409 });
        }
      }
    },
    installationDigest(installation) {
      return sha256(Buffer.from([
        installation.vendorId,
        installation.baseUrl,
        installation.credentialGeneration,
        installation.credentialDigest,
        SUPPORTED_AGENT_MODELS_REVISION,
      ].join("\0"), "utf8"));
    },
    availabilityFailure(cause) {
      const code = classifyHttpFailure(cause);
      if (code === "AGENT_AUTH_REQUIRED") return Object.freeze({ status: "auth-required" });
      if (["AGENT_PREFLIGHT_TIMEOUT", "AGENT_TURN_TIMEOUT"].includes(code)) {
        return Object.freeze({ status: "unavailable", reason: "timeout" });
      }
      if (["AGENT_MODEL_ID_REQUIRED", "AGENT_MODEL_NOT_RELEASED", "AGENT_SELECTION_UNSUPPORTED"].includes(code)) {
        return Object.freeze({ status: "unavailable", reason: "model-unavailable" });
      }
      return Object.freeze({ status: "unavailable", reason: "check-failed" });
    },
    normalizePreflightError(cause) { return wrapProviderError(cause, "源页 Agent 预检没有完成。"); },
    normalizeRuntimeError(cause) { return wrapProviderError(cause, "源页 Agent 没有完成这一轮。"); },
    preflightFailureMessage(code) {
      const messages = {
        AGENT_AUTH_REQUIRED: "Token 无效，请重新连接。",
        AGENT_CONFIGURATION_CHANGED: "连接配置已变化，请重新预检。",
        AGENT_PREFLIGHT_TIMEOUT: "连接超时，请重试。",
        AGENT_MODEL_ID_REQUIRED: "请填写 Model ID。",
        AGENT_MODEL_NOT_RELEASED: "该厂商尚无通过真实 smoke 的正式模型。",
        AGENT_MODEL_ACCESS_DENIED: "当前 Token 无权使用这个模型。",
      };
      return messages[code] || "暂时无法接通。";
    },
    loadExecutionPolicy: policyLoader,
    createRuntimeLaunch({
      ticket,
      policy,
      baseEnvironment,
      cancellationSignal,
      onEvent,
      turnTimeoutMs,
      inactivityTimeoutMs,
    }) {
      const credential = credentialFromEnvironment(baseEnvironment);
      const localId = localModelId(ticket.selection?.resolvedModelId);
      const model = credential?.vendorId === "custom"
        ? null
        : ticket.evidence?.models?.find((entry) => entry.id === ticket.selection?.resolvedModelId);
      if (credential?.vendorId !== "custom" && !model) {
        fail("AGENT_CONFIGURATION_CHANGED", "预检模型能力尚未确认，请重新预检。", { status: 409 });
      }
      return Object.freeze({
        securityProfile: "client-mediated",
        modelId: localId,
        reasoning: normalizeOpenAiCompatibleReasoning(ticket.selection?.reasoning?.applied)
          || DEFAULT_OPENAI_COMPATIBLE_REASONING,
        modelBudget: model ? Object.freeze({ ...model }) : null,
        policy,
        environment: Object.freeze({
          PAGEROOT_API_KEY: String(credential?.apiKey || ""),
          PAGEROOT_API_BASE_URL: String(credential?.baseUrl || ""),
          PAGEROOT_API_VENDOR: String(credential?.vendorId || ""),
          PAGEROOT_API_CREDENTIAL_GENERATION: String(credential?.credentialGeneration || 0),
        }),
        cancellationSignal,
        onEvent,
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
        ...(inactivityTimeoutMs ? { inactivityTimeoutMs } : {}),
      });
    },
    classifyRunFailure: classifyHttpFailure,
    failureMessage(code) {
      const messages = {
        AGENT_AUTH_REQUIRED: "Token 无效或已过期。本轮已保留。",
        AGENT_MODEL_ACCESS_DENIED: "当前 Token 无权使用这个模型。本轮已保留。",
        AGENT_SELECTION_UNSUPPORTED: "当前模型不可用。本轮已保留。",
        AGENT_RATE_LIMITED: "请求过于频繁，可稍后重新发送。",
        AGENT_BALANCE_INSUFFICIENT: "账号余额不足，可充值或更换厂商。",
        AGENT_PLAN_LIMIT: "当前套餐额度已用完，可更换厂商。",
        AGENT_PROVIDER_OVERLOADED: "模型当前过载，可重试或更换模型。",
        AGENT_ENDPOINT_REGION_MISMATCH: "接口地区不匹配，请重新连接正确地区。",
        AGENT_OUTPUT_INVALID: "返回内容不是完整 HTML。本轮已保留。",
        AGENT_OUTPUT_TRUNCATED: "模型输出被截断。本轮 Request 已保留。",
        AGENT_PROMPT_TOO_LARGE: "当前页面可能超过模型完整输出能力，请更换模型或使用 Qoder/Codex。",
        AGENT_TURN_TIMEOUT: "网络或模型超时。本轮 Request 已保留。",
        AGENT_NETWORK_INTERRUPTED: "网络连接中断。本轮 Request 已保留。",
        AGENT_ATTACHMENT_UNSUPPORTED: "源页 Agent 暂不支持此附件，可改用 Qoder、Codex 或复制给其他 AI。",
        AGENT_CANCELLED: "已停止。",
      };
      return messages[code] || "模型接口错误。本轮 Request 已保留。";
    },
    resolveSelection: resolvedPagerootSelection,
  });
}

export const openAiCompatibleProvider = createOpenAiCompatibleProvider();
