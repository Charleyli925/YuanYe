#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  callExpressions,
  callNames,
  countReactHooks,
  hasFilesystemWrite,
  hasIdentifier,
  hasLiteralComparison,
  memberAccesses,
  moduleSpecifiers,
  newExpressionNames,
  parseModule,
  persistentFileIdentityComparisons,
  stringLiterals,
} from "./architecture-ast-query.mjs";
import {
  loadNoticeLedger,
  noticeInventoryViolations,
  noticePolicyViolations,
} from "./notice-policy.mjs";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const COMPOSITION_ROOT = "app/application/workspace-controller.js";
const LOCAL_PRESENTATION_RUNTIME_OWNERS = new Set([
  "ReviewAnalysisSession",
  "CanvasSnapshotSession",
  "RuntimeCanvasResidencySession",
  "WorkspacePreferencesSession",
]);
const RUNTIME_OWNERS = new Set([
  "ProjectSession",
  "DocumentSession",
  "CommentSession",
  "DraftSession",
  "VersionSession",
  "SourceHistorySession",
  "RunSession",
  "ProjectRulesSession",
  "ExternalFileOpenSession",
  "ProjectApplicationSession",
  "EditAuthorRuntimeSession",
  "WorkbenchTabsSession",
  "WorkbenchNavigationSession",
  "WorkbenchTabsPersistenceCoordinator",
  "ConversationSession",
  "DocumentSurfaceCacheSession",
  "ProjectWorkflow",
  "DocumentWorkflow",
  "CommentWorkflow",
  "ProjectRulesWorkflow",
  "RunWorkflow",
  "VersionWorkflow",
  "ConversationWorkflow",
  "WorkbenchNavigationWorkflow",
]);
const RETIRED_MODULES = new Set([
  "app/components/NativeEditingController.ts",
  "app/lib/format-skeleton.js",
  "app/lib/native-block-edit-draft.js",
  "app/lib/native-edit-transaction.js",
  "app/lib/native-input-intent.js",
  "app/lib/native-structural-edit-planner.js",
  "app/application/browser-document-session.js",
  "app/application/browser-file-tab-identity.js",
  "app/application/runtime-capabilities.js",
  "app/workbench/ReviewAnalysisPrewarm.tsx",
  "app/workbench/WorkbenchDocumentCanvasPool.tsx",
  "app/workbench/use-runtime-canvas-residency.ts",
  "app/lib/version-audit-records.js",
]);
const RETIRED_IMPORT_NAMES = new Set([
  "NativeEditingController",
  "format-skeleton",
  "native-block-edit-draft",
  "native-edit-transaction",
  "native-input-intent",
  "native-structural-edit-planner",
  "browser-document-session",
  "browser-file-tab-identity",
  "runtime-capabilities",
  "ReviewAnalysisPrewarm",
  "WorkbenchDocumentCanvasPool",
  "use-runtime-canvas-residency",
  "version-audit-records",
]);
const RETIRED_PRODUCTION_LITERALS = new Set([
  ["", "source-history", "action"].join("/"),
  ["source-history", "v1"].join("."),
  ["source-history", "v1", "schema", "json"].join("."),
]);
const RETIRED_COMPAT_IDENTIFIERS = new Set([
  "commitPendingEdit",
  "fencePendingEdit",
  "checkpointPendingEdit",
  "baseVersionId",
  "capturedRevision",
  "editEvents",
  "editEventIds",
]);
const SOURCE_NODE_ID_LITERAL = ["data", "html", "ai", "source", "node", "id"].join("-");
const SOURCE_NODE_ID_ALLOWED_FILES = new Set([
  ["app", "lib", "source-index.js"].join("/"),
  ["app", "components", "IslandEditingController.ts"].join("/"),
  ["shared", "editable-island.mjs"].join("/"),
]);
const REVIEW_SOURCE_NODE_ID_LITERAL = ["data", "pageroot", "review", "source", "node", "id"].join("-");
const PARSE_KEY_PATTERN_SOURCE = ["element", ":\\d+", ":\\d+", ":"].join("");
const PARSE_KEY_ALLOWED_FILES = new Set([
  ["app", "lib", "source-index.js"].join("/"),
  ["app", "lib", "source-patch-core.js"].join("/"),
  ["app", "lib", "source-patch-engine.js"].join("/"),
  ["app", "lib", "target-resolver.js"].join("/"),
]);
const PAGE_VIEW_CONTEXT_FILE = ["app", "lib", "page-view-context.js"].join("/");
const DOCUMENT_WORKFLOW_FILE = ["app", "application", "document-workflow.js"].join("/");
const WORKBENCH_FILE = ["app", "workbench.tsx"].join("/");
const ACTIVE_DOCUMENT_CANVAS_FILE = [
  "app",
  "workbench",
  "WorkbenchActiveDocumentCanvas.tsx",
].join("/");
const TEXT_FRAGMENT_HOST_LITERAL = ["pageroot", "text", "fragment"].join("-");
const PAGE_VIEW_CONTEXT_RETIRED_ADAPTERS =
  /\bdata-p\b|\bdata-tab\b|resolveDataLinkedTabAction|resolveIndexedHandlerTabAction|SIMPLE_INDEXED_TAB_HANDLER|LEGACY_TAB_/u;
const PROVIDER_LITERALS = ["qoder", "codex", "qoder-acp", "codex-acp"];
const RAW_ENDPOINTS = new Set([
  "/workspace",
  "/source",
  "/source-preview",
  "/source-stat",
  "/autosave",
  "/draft",
  "/request",
  "/attachment",
  "/status",
  "/version-file",
  "/project-file",
]);
const ALLOWED_SHOW_ERROR_BOX_TITLES = new Set([
  "源页启动失败",
]);
const ALLOWED_WINDOW_CONFIRM_PREFIXES = Object.freeze([
  "确定删除",
  "确定要用磁盘上的版本继续吗",
  "确定要用外部版本覆盖当前编辑吗",
  "重新载入会舍弃尚未写回的当前编辑内容",
  "成功导入后会将原文件移至废纸篓",
]);

const APPROVED_PERSISTENCE_OWNERS = new Set([
  "bridge/agent/agent-lease-store.mjs",
  "bridge/agent/catalog/agent-installer.mjs",
  "bridge/agent/hosts/execution-host.mjs",
  "bridge/agent/runtimes/http-runtime.mjs",
  "bridge/ai-task-projection.mjs",
  "bridge/lifecycle-core.mjs",
  "bridge/project-file-repository.mjs",
  "bridge/project-file-repository/request-attachments.mjs",
  "bridge/project-file-repository/path-safety.mjs",
  "bridge/project-file-repository/source-binding.mjs",
  "bridge/project-file-repository/save-retirement.mjs",
  "bridge/project-file-repository/registry.mjs",
  "bridge/project-file-repository/working-copy.mjs",
  "bridge/workspace-bridge.mjs",
  "desktop/after-pack.mjs",
  "desktop/device-identity.mjs",
  "desktop/edit-runtime-library-store.mjs",
  "desktop/external-file-open.mjs",
  "desktop/main.mjs",
  "desktop/project-files.mjs",
  "desktop/recovery-journal-store.mjs",
  "desktop/agent-session-credential-store.mjs",
  "desktop/ui-preferences.mjs",
  "desktop/usage-telemetry.mjs",
  "desktop/workbench-tabs-state.mjs",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  }));
  return nested.flat();
}

function relative(filePath) {
  return path.relative(PRODUCT_ROOT, filePath).split(path.sep).join("/");
}

function isApplication(file) {
  return file.startsWith("app/application/");
}

function isRenderer(file) {
  return file === "app/workbench.tsx"
    || file.startsWith("app/workbench/")
    || file.startsWith("app/components/")
    || file === "app/page.tsx"
    || file === "app/layout.tsx";
}

function isBridgeClient(file) {
  return file === "app/application/bridge-client.js";
}

function isProviderWorkflow(file) {
  return /^app\/application\/(?:run|review|version)[^/]*\.(?:js|ts)$/u.test(file);
}

function presentationImport(specifier) {
  return /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/u.test(specifier);
}

function bridgeImport(specifier) {
  return /(?:^|\/)(?:bridge-client|bridge)(?:\.[^/]+)?(?:\/|$)/u.test(specifier);
}

function hasProviderImplementationImport(imports) {
  return imports.some((specifier) => /(?:^|\/)(?:qoder-availability|QoderAvailabilityCard|qoder-provider)(?:\.[^/]*)?$/u.test(specifier));
}

export function layerBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const imports = moduleSpecifiers(handle);
  const violations = [];
  if (file.startsWith("app/domain/")) {
    for (const specifier of imports) {
      if (specifier === "react" || /(?:^|\/)(?:application|components|desktop)(?:\/|$)/u.test(specifier)) {
        violations.push(`${file}: domain code cannot import ${specifier}`);
      }
    }
  }
  if (isApplication(file)) {
    for (const specifier of imports) {
      if (specifier === "react" || presentationImport(specifier)) {
        violations.push(`${file}: application code cannot import ${specifier}`);
      }
    }
  }
  if (isRenderer(file) && imports.some(bridgeImport)) {
    violations.push(`${file}: views cannot import the Bridge client`);
  }
  if (file.startsWith("bridge/") || file.startsWith("scripts/")) {
    for (const specifier of imports) {
      if (/(?:^|\/)app\/(?:application|components|workbench)(?:\/|\.|$)/u.test(specifier)) {
        violations.push(`${file}: Bridge and build scripts cannot import renderer code`);
      }
    }
  }
  return violations;
}

export function ownershipBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  const constructions = newExpressionNames(handle).filter((name) => (
    (RUNTIME_OWNERS.has(name) || /(?:Session|Workflow)$/u.test(name))
    && !LOCAL_PRESENTATION_RUNTIME_OWNERS.has(name)
  ));
  if (constructions.length > 0 && file !== COMPOSITION_ROOT) {
    violations.push(`${file}: runtime Sessions and Workflows may only be constructed by the composition root`);
  }
  if (
    /^(?:app|bridge|desktop)\//u.test(file)
    && hasFilesystemWrite(handle)
    && !APPROVED_PERSISTENCE_OWNERS.has(file)
  ) {
    violations.push(`${file}: persistence writes belong to an approved repository or service owner`);
  }
  return violations;
}

export function escapeBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  const calls = callNames(handle);
  const imports = moduleSpecifiers(handle);
  if (isApplication(file) && !isBridgeClient(file) && calls.includes("fetch")) {
    violations.push(`${file}: raw fetch belongs to the typed Bridge client`);
  }
  if (
    isApplication(file)
    && file !== "app/application/recovery-store.js"
    && file !== "app/lib/opaque-sandbox-storage.js"
    && (hasIdentifier(handle, "localStorage") || hasIdentifier(handle, "sessionStorage"))
  ) {
    violations.push(`${file}: browser persistence belongs to an approved recovery owner`);
  }
  if (isApplication(file) && !isBridgeClient(file)
    && stringLiterals(handle).some((value) => RAW_ENDPOINTS.has(value))) {
    violations.push(`${file}: Bridge endpoint knowledge belongs to the typed Bridge client`);
  }
  if (isApplication(file) && !isBridgeClient(file)
    && (calls.includes("executeCommand") || calls.includes("executeBridge"))) {
    violations.push(`${file}: generic Bridge command escapes are forbidden`);
  }
  if (isRenderer(file)
    && (calls.includes("createRuntimeBridgeClient")
      || memberAccesses(handle).some((value) => value.startsWith("bridgeClient.")))) {
    violations.push(`${file}: views cannot call the Bridge client`);
  }
  if (isProviderWorkflow(file)
    && (hasLiteralComparison(handle, { literals: PROVIDER_LITERALS, propertyNames: ["providerId", "mode"] })
      || hasProviderImplementationImport(imports))) {
    violations.push(`${file}: provider selection must use canonical delivery and descriptor data`);
  }
  return violations;
}

function callPathKind(pathName) {
  if (!pathName) return null;
  if (pathName === "window.confirm") {
    return "window.confirm";
  }
  if (pathName === "dialog.showErrorBox" || pathName.endsWith(".showErrorBox")) {
    return "showErrorBox";
  }
  if (pathName === "dialog.showMessageBox" || pathName.endsWith(".showMessageBox")) {
    return "showMessageBox";
  }
  return null;
}

export function dialogPolicyViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  if (
    file.startsWith("tests/")
    || file.startsWith("scripts/")
    || file.startsWith(".codex-worktrees/")
  ) {
    return violations;
  }
  for (const call of callExpressions(handle)) {
    const kind = callPathKind(call.path);
    if (!kind) continue;
    if (kind === "showMessageBox") {
      violations.push(`${file}: ordinary showMessageBox is forbidden; keep only registered content-loss confirms`);
      continue;
    }
    if (kind === "showErrorBox") {
      const title = call.args[0];
      if (!title || !ALLOWED_SHOW_ERROR_BOX_TITLES.has(title)) {
        violations.push(`${file}: showErrorBox is forbidden except the registered startup failure`);
      }
      continue;
    }
    const prefix = call.args[0];
    if (
      typeof prefix !== "string"
      || !ALLOWED_WINDOW_CONFIRM_PREFIXES.some((allowed) => prefix.startsWith(allowed))
    ) {
      violations.push(`${file}: window.confirm is forbidden unless the copy is a registered delete/overwrite/abandon confirm`);
    }
  }
  return violations;
}

export { noticePolicyViolations, noticeInventoryViolations } from "./notice-policy.mjs";

export function retiredArtifactViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  if (RETIRED_MODULES.has(file)) {
    violations.push(`${file}: retired production modules cannot return`);
  }
  for (const name of RETIRED_COMPAT_IDENTIFIERS) {
    if (hasIdentifier(handle, name)) {
      violations.push(
        `${file}: retired compatibility identifier ${name} cannot return`,
      );
    }
  }
  for (const specifier of moduleSpecifiers(handle)) {
    const basename = path.posix.basename(specifier).replace(/\.[^.]+$/u, "");
    if (RETIRED_IMPORT_NAMES.has(basename)) {
      violations.push(`${file}: production code cannot import retired module ${specifier}`);
    }
  }
  for (const literal of stringLiterals(handle)) {
    if (RETIRED_PRODUCTION_LITERALS.has(literal)) {
      violations.push(`${file}: retired source-history compatibility literal cannot return`);
    }
    if (literal === SOURCE_NODE_ID_LITERAL && !SOURCE_NODE_ID_ALLOWED_FILES.has(file)) {
      violations.push(
        `${file}: Source Node ID cannot leave source-index internals or Runtime DOM`,
      );
    }
    if (literal === REVIEW_SOURCE_NODE_ID_LITERAL) {
      violations.push(
        `${file}: Review cannot write parseKey identity onto source HTML`,
      );
    }
  }
  if (hasIdentifier(handle, "instrumentPreviewHtml")) {
    violations.push(
      `${file}: instrumentPreviewHtml cannot return; parseKey must not be written onto DOM`,
    );
  }
  if (hasIdentifier(handle, "resolveFromPreview")) {
    violations.push(
      `${file}: resolveFromPreview cannot return; preview parseKey is not an edit authority`,
    );
  }
  if (hasIdentifier(handle, "liveExactCommandTarget")) {
    violations.push(
      `${file}: liveExactCommandTarget cannot return; SourcePatch authorizes only by Stable ID`,
    );
  }
  if (hasIdentifier(handle, "planDirectTextNodePatch")) {
    violations.push(
      `${file}: planDirectTextNodePatch cannot return; text edits use replace-editable-island`,
    );
  }
  if (hasIdentifier(handle, "mountNativeTextFragmentHost")) {
    violations.push(
      `${file}: disposable text-fragment hosts cannot return`,
    );
  }
  if (source.includes(TEXT_FRAGMENT_HOST_LITERAL)) {
    violations.push(
      `${file}: disposable text-fragment hosts cannot return`,
    );
  }
  if (file === WORKBENCH_FILE && hasIdentifier(handle, "HtmlDisplaySurface")) {
    violations.push(
      `${file}: Workbench cannot replace the live editor with HtmlDisplaySurface`,
    );
  }
  if (file === ACTIVE_DOCUMENT_CANVAS_FILE && hasIdentifier(handle, "cloneElement")) {
    violations.push(
      `${file}: cloneElement canvas host cannot return`,
    );
  }
  if (
    file === DOCUMENT_WORKFLOW_FILE
    && (
      hasIdentifier(handle, "recoveryStore")
      || source.includes("html-ai-recovery")
    )
  ) {
    violations.push(
      `${file}: document HTML recovery is Main journal only`,
    );
  }
  if (
    !PARSE_KEY_ALLOWED_FILES.has(file)
    && source.includes(PARSE_KEY_PATTERN_SOURCE)
  ) {
    violations.push(
      `${file}: parseKey cannot leave source-index/source-patch`,
    );
  }
  if (
    file === PAGE_VIEW_CONTEXT_FILE
    && PAGE_VIEW_CONTEXT_RETIRED_ADAPTERS.test(source)
  ) {
    violations.push(`${file}: retired page-view tab adapters cannot return`);
  }
  return violations;
}

export function providerNeutralRendererViolations(input = {}) {
  return escapeBoundaryViolations(input);
}

// Compatibility wrapper for focused callers. It delegates to the four
// responsibility checks and intentionally does not inspect implementation
// member names or ordered call text.
export function compositionBoundaryViolations({
  workbench = "",
  workspaceController = "",
  applicationSources = [],
} = {}) {
  return [
    ...layerBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...ownershipBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...escapeBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...layerBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...ownershipBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...escapeBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...applicationSources.flatMap(({ file, source }) => [
      ...layerBoundaryViolations({ file, source }),
      ...ownershipBoundaryViolations({ file, source }),
      ...escapeBoundaryViolations({ file, source }),
    ]),
  ];
}

export async function architectureViolations() {
  const files = [
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "app"))),
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "bridge"))),
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "scripts"))),
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "desktop"))),
  ];
  const ledger = await loadNoticeLedger();
  const scanned = [];
  const violations = [];
  for (const filePath of files) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    const ast = parseModule(filePath, source);
    scanned.push({ file, source, module: ast });
    if (file.startsWith("bridge/project-file-repository")) {
      violations.push(...persistentFileIdentityComparisons(ast).map((reason) => `${file}: ${reason}`));
    }
    violations.push(...layerBoundaryViolations({ file, source, module: ast }));
    violations.push(...ownershipBoundaryViolations({ file, source, module: ast }));
    violations.push(...escapeBoundaryViolations({ file, source, module: ast }));
    violations.push(...retiredArtifactViolations({ file, source, module: ast }));
    violations.push(...dialogPolicyViolations({ file, source, module: ast }));
    violations.push(...noticePolicyViolations({ file, source, module: ast, ledger }));
  }
  violations.push(...await noticeInventoryViolations(scanned, ledger));
  return [...new Set(violations)].sort();
}

export async function budgetFindings() {
  const budgetPath = path.join(PRODUCT_ROOT, "scripts", "architecture-budget.json");
  let budget;
  try {
    budget = JSON.parse(await readFile(budgetPath, "utf8"));
  } catch {
    return { violations: ["scripts/architecture-budget.json: missing or invalid JSON"], hints: [] };
  }
  const violations = [];
  const hints = [];
  for (const [relPath, limits] of Object.entries(budget.files ?? {})) {
    const source = await readFile(path.join(PRODUCT_ROOT, relPath), "utf8");
    const handle = parseModule(path.join(PRODUCT_ROOT, relPath), source);
    for (const [metric, ceiling] of Object.entries(limits)) {
      const actual = metric === "maxLines"
        ? source.split("\n").length
        : metric === "maxHooks"
          ? countReactHooks(handle)
          : null;
      if (actual === null) {
        violations.push(`scripts/architecture-budget.json: unknown metric "${metric}" for ${relPath}`);
      } else if (actual > ceiling) {
        violations.push(`${relPath}: ${metric} ${actual} exceeds budget ${ceiling} (+${actual - ceiling})`);
      } else if (actual < ceiling) {
        hints.push(`${relPath}: ${metric} is ${actual}, under budget ${ceiling}; lower it to ${actual} to keep the ratchet tight.`);
      }
    }
  }
  return { violations, hints };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await architectureViolations();
  if (violations.length > 0) {
    process.stderr.write(`Architecture contract failed:\n- ${violations.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Architecture contract passed.\n");
  }
  const { violations: budgetViolations, hints } = await budgetFindings();
  const notices = [...budgetViolations, ...hints];
  if (notices.length > 0) process.stdout.write(`Budget advisory:\n- ${notices.join("\n- ")}\n`);
}
