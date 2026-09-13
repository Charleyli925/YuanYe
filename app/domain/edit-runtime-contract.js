import { parse as parseJavaScript } from "acorn";
import { parse as parseHtmlDocument } from "parse5";

/**
 * Pure syntax and identity rules for the bounded Edit author-runtime path.
 * This contract describes a disposable direct-frame grant only: source HTML
 * remains the persistence authority at every point. The grant never carries
 * screenshots, PNG bytes or a second visual representation.
 */

export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION = 2;

export const EDIT_AUTHOR_RUNTIME_BUDGET = Object.freeze({
  htmlBytes: 20 * 1024 * 1024,
  scriptCount: 24,
  scriptBytes: 3 * 1024 * 1024,
  aggregateScriptBytes: 12 * 1024 * 1024,
  declaredAssetCount: 64,
  declaredAssetReferenceCount: 128,
  declaredAssetBytes: 2 * 1024 * 1024,
  remoteLibraryDeadlineMs: 60_000,
  runtimeDeadlineMs: 4_000,
  runtimeSurfaceDeadlineMs: 12_000,
  orphanSessionTtlMs: 60_000,
});

// Main first bounds immutable resource preparation. The visible Edit iframe
// acknowledges its ordinary load directly; runtimeDeadlineMs is only a
// fail-safe for hostile or broken author code and never a minimum wait.
export const EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS = (
  EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs
  + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
  + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs
) + 1_000;

export const EDIT_RUNTIME_PROTOCOL_SCHEME = "pageroot-edit-runtime";
export const EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE =
  "data-pageroot-edit-runtime-source";
export const EDIT_RUNTIME_OWNED_ATTRIBUTE =
  "data-pageroot-edit-runtime-owned";
export const EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE =
  "data-pageroot-edit-runtime-script";
export const EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE =
  "data-pageroot-edit-runtime-bootstrap";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const EXECUTION_ID_PATTERN = /^[a-f0-9]{24}$/u;
const REQUEST_ID_PATTERN = /^edit-runtime-[a-z0-9][a-z0-9_-]{7,127}$/u;
const SOURCE_SHA_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FRAME_TOKEN_PATTERN = /^edit-runtime-frame-[a-f0-9]{24}$/u;
const CLASSIC_SCRIPT_TYPES = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function frozenArray(value) {
  return Object.freeze([...value]);
}

function asciiLower(value) {
  return String(value || "").toLowerCase();
}

function attributesFromOpeningTag(openingTag) {
  const attributes = [];
  let cursor = 0;
  while (cursor < openingTag.length && openingTag[cursor] !== "<") cursor += 1;
  cursor += 1;
  while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
  while (
    cursor < openingTag.length
    && !/[\t\n\f\r />]/u.test(openingTag[cursor])
  ) cursor += 1;
  while (cursor < openingTag.length) {
    while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
    if (cursor >= openingTag.length || openingTag[cursor] === ">") break;
    if (openingTag[cursor] === "/" && openingTag[cursor + 1] === ">") break;
    const nameStart = cursor;
    while (
      cursor < openingTag.length
      && !/[\t\n\f\r =>/]/u.test(openingTag[cursor])
    ) cursor += 1;
    const rawName = openingTag.slice(nameStart, cursor);
    if (!rawName) {
      cursor += 1;
      continue;
    }
    while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
    let value = null;
    if (openingTag[cursor] === "=") {
      cursor += 1;
      while (cursor < openingTag.length && /[\t\n\f\r ]/u.test(openingTag[cursor])) cursor += 1;
      const quote = openingTag[cursor] === "\"" || openingTag[cursor] === "'"
        ? openingTag[cursor]
        : "";
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < openingTag.length && openingTag[cursor] !== quote) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
        if (openingTag[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < openingTag.length
          && !/[\t\n\f\r >]/u.test(openingTag[cursor])
        ) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
      }
    }
    attributes.push(Object.freeze({ name: asciiLower(rawName), value }));
  }
  return frozenArray(attributes);
}

function attributeValue(attributes, name) {
  const normalized = asciiLower(name);
  const matches = attributes.filter((attribute) => attribute.name === normalized);
  return matches.length === 1 ? matches[0].value ?? "" : null;
}

function scriptPolicy(attributes) {
  const rawType = attributeValue(attributes, "type");
  const type = asciiLower(rawType || "").trim();
  if (type === "module") return Object.freeze({ executable: true, reason: null });
  if (!CLASSIC_SCRIPT_TYPES.has(type)) {
    return Object.freeze({ executable: false, reason: null });
  }
  return Object.freeze({ executable: true, reason: null });
}

/**
 * Parses one exact HTML revision once and derives every authored-program fact
 * consumed by the Edit Runtime. Template descendants and scripting-enabled
 * noscript text are deliberately excluded from the live document tree.
 */
export function analyzeEditRuntimeDocument(html) {
  const source = String(html ?? "");
  const scripts = [];
  let unsupportedReason = null;
  let activeIndex = 0;
  let documentBase = null;
  let document;
  try {
    document = parseHtmlDocument(source, {
      scriptingEnabled: true,
      sourceCodeLocationInfo: true,
    });
  } catch {
    return Object.freeze({
      source,
      scripts: frozenArray(scripts),
      executableScripts: frozenArray([]),
      unsupportedReason: "invalid-html",
      documentBase: null,
      programIdentity: null,
    });
  }
  const visit = (node) => {
    if (
      !documentBase
      && node?.namespaceURI === HTML_NAMESPACE
      && String(node?.tagName || "").toLowerCase() === "base"
    ) {
      const hrefAttribute = (node.attrs || []).find((attribute) => (
        String(attribute.name || "").toLowerCase() === "href"
      ));
      const startTag = node.sourceCodeLocation?.startTag;
      if (hrefAttribute && startTag) {
        documentBase = Object.freeze({
          href: String(hrefAttribute.value || ""),
          openingTag: source.slice(startTag.startOffset, startTag.endOffset),
        });
      }
    }
    if (
      String(node?.tagName || "").toLowerCase() === "script"
      && node.sourceCodeLocation?.startTag
    ) {
      const location = node.sourceCodeLocation;
      if (!location.endTag) {
        unsupportedReason ||= "unterminated-script";
        return;
      }
      const openingTag = source.slice(
        location.startTag.startOffset,
        location.startTag.endOffset,
      );
      const body = source.slice(
        location.startTag.endOffset,
        location.endTag.startOffset,
      );
      const attributes = attributesFromOpeningTag(openingTag);
      const policy = scriptPolicy(attributes);
      const src = attributeValue(attributes, "src");
      const entry = Object.freeze({
        startOffset: location.startTag.startOffset,
        endOffset: location.endTag.endOffset,
        openingTag,
        attributes,
        type: asciiLower(attributeValue(attributes, "type") || "").trim(),
        src: src === null ? null : src,
        inline: body,
        executable: policy.executable,
        index: policy.executable ? activeIndex : null,
        reason: policy.reason,
      });
      scripts.push(entry);
      if (policy.reason) unsupportedReason ||= policy.reason;
      if (policy.executable) activeIndex += 1;
    }
    // Template descendants live under node.content and are deliberately not
    // visited. Raw-text containers expose their apparent markup only as text.
    for (const child of node?.childNodes || []) visit(child);
  };
  visit(document);
  const frozenScripts = frozenArray(scripts);
  const executableScripts = frozenArray(
    frozenScripts.filter((script) => script.executable),
  );
  const programIdentity = unsupportedReason || executableScripts.length < 1
    ? null
    : JSON.stringify({
        documentBase: documentBase?.openingTag || null,
        scripts: executableScripts.map((script) => ({
          openingTag: script.openingTag,
          inline: script.inline,
        })),
      });
  return Object.freeze({
    source,
    scripts: frozenScripts,
    executableScripts,
    unsupportedReason,
    documentBase,
    programIdentity,
  });
}

/**
 * Returns the first authored, live-document <base href> using HTML parser tree
 * order. A base without href does not win, and inert template contents never
 * participate in the document base URL.
 */
export function authoredDocumentBase(html) {
  return analyzeEditRuntimeDocument(html).documentBase;
}

/**
 * Collects authored Script elements from the live parsed document tree. Exact
 * source locations preserve author bytes while naturally excluding comments,
 * raw-text element content and inert template.content from execution identity.
 */
export function collectEditRuntimeScripts(html) {
  const analysis = analyzeEditRuntimeDocument(html);
  return Object.freeze({
    scripts: analysis.scripts,
    executableScripts: analysis.executableScripts,
    unsupportedReason: analysis.unsupportedReason,
  });
}

/**
 * Exact authored-script identity used to decide whether one disposable Edit
 * resource session can render a later semantic HTML revision. Ordinary text,
 * style and structure edits leave this value unchanged; script edits require a
 * new Canvas generation and a new Main-authorized resource closure.
 */
export function editRuntimeProgramIdentity(html) {
  return analyzeEditRuntimeDocument(html).programIdentity;
}

function containsImportInAst(root) {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (
      node.type === "ImportDeclaration"
      || node.type === "ImportExpression"
      || (
        (node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration")
        && node.source
      )
    ) return true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === "object") pending.push(value);
    }
  }
  return false;
}

function containsJavaScriptImportSyntax(source) {
  const options = {
    ecmaVersion: "latest",
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
  };
  try {
    return containsImportInAst(parseJavaScript(source, {
      ...options,
      sourceType: "script",
    }));
  } catch {
    try {
      // Module-only grammar such as top-level using declarations is valid in
      // supported import-free module scripts. A second maintained-parser goal
      // prevents a real dependency later in that program from failing open.
      return containsImportInAst(parseJavaScript(source, {
        ...options,
        sourceType: "module",
      }));
    } catch {
      // Syntax errors are Runtime Script failures, not proof of an unsupported
      // loading dependency. Acorn owns syntax distinctions such as Annex-B
      // HTML comments, regexps, strings, property names and import.meta.
    }
  }
  return false;
}

/**
 * Relative module imports still need a native module graph rooted in the
 * authored file. Until that graph is served by the scoped protocol, reject
 * only import syntax and let CSP remain the boundary for ordinary APIs.
 */
export function unsupportedEditRuntimeProgramReason(source) {
  const program = String(source || "");
  if (containsJavaScriptImportSyntax(program)) {
    return "dynamic-or-module-import";
  }
  return null;
}

export function editRuntimeSourceMarker(path) {
  if (!Array.isArray(path) || path.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    return null;
  }
  return path.length === 0 ? "root" : path.join(".");
}

export function isEditRuntimeSessionId(value) {
  return SESSION_ID_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeExecutionId(value) {
  return EXECUTION_ID_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ""));
}

export function isEditRuntimeSourceSha256(value) {
  return SOURCE_SHA_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeFrameToken(value) {
  return FRAME_TOKEN_PATTERN.test(String(value || "").toLowerCase());
}

export function isEditRuntimeDocumentBasePath(value) {
  const pathname = String(value || "");
  if (
    !pathname.startsWith("/")
    || pathname.length > 4_096
    || /[?#\\\0]/u.test(pathname)
  ) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return !decoded.split("/").some((segment) => (
    segment === ".." || segment.startsWith(".")
  ));
}

export function editRuntimeRegistrationProperty(executionId) {
  const normalized = String(executionId || "").toLowerCase();
  return isEditRuntimeExecutionId(normalized)
    ? `__pageroot_edit_register_${normalized}`
    : null;
}

export function editRuntimeProtocolUrl(sessionId, path) {
  if (!isEditRuntimeSessionId(sessionId)) return null;
  const pathname = String(path || "");
  if (!pathname.startsWith("/")) return null;
  return EDIT_RUNTIME_PROTOCOL_SCHEME + "://" + String(sessionId).toLowerCase() + pathname;
}

export function isEditRuntimeProtocolUrl(value, sessionId = null) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === EDIT_RUNTIME_PROTOCOL_SCHEME + ":"
      && isEditRuntimeSessionId(url.hostname)
      && (!sessionId || url.hostname === String(sessionId).toLowerCase());
  } catch {
    return false;
  }
}
