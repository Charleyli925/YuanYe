import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import semver from "semver";

import {
  REQUIRED_APP_SOURCE_FILES,
  REQUIRED_SHARED_FILES,
} from "../scripts/verify-packaged-artifact.mjs";
import { APP_SOURCE_FILES } from "./helpers/release-evidence-fixtures.mjs";

const APP_FILE_ALLOWLIST = [
  "desktop/main.mjs",
  "desktop/preload.mjs",
  "desktop/external-file-open.mjs",
  "desktop/workbench-tabs-state.mjs",
  "desktop/prepared-html-open.mjs",
  "desktop/project-open-queue.mjs",
  "desktop/project-files.mjs",
  "desktop/source-rename.mjs",
  "desktop/source-file-watch.mjs",
  "desktop/active-managed-locator.mjs",
  "desktop/project-path-policy.mjs",
  "desktop/welcome-project-content.mjs",
  "desktop/export-copy.mjs",
  "desktop/open-in-default-browser.mjs",
  "desktop/project-ipc-security.mjs",
  "desktop/ipc/trusted-ipc.mjs",
  "desktop/ipc/project-ipc.mjs",
  "desktop/ipc/window-ipc.mjs",
  "desktop/ipc/agent-ipc.mjs",
  "desktop/ipc/update-ipc.mjs",
  "desktop/app-lifecycle.mjs",
  "desktop/startup-performance-timeline.mjs",
  "desktop/bridge-startup.mjs",
  "desktop/bridge-shutdown.mjs",
  "desktop/close-recovery.mjs",
  "desktop/product-contract.mjs",
  "desktop/qoder-handoff.mjs",
  "desktop/recovery-journal-store.mjs",
  "desktop/product-links.mjs",
  "desktop/application-update.mjs",
  "desktop/usage-telemetry.mjs",
  "desktop/ui-preferences.mjs",
  "desktop/agent-session-credential-store.mjs",
  "desktop/runtime-environment.mjs",
  "desktop/device-identity.mjs",
  "desktop/preview-protocol.mjs",
  "desktop/imported-asset-root.mjs",
  "desktop/edit-runtime-bootstrap.mjs",
  "desktop/edit-runtime-library-store.mjs",
  "desktop/edit-runtime-protocol.mjs",
  "desktop/edit-runtime-preparation-fence.mjs",
  "desktop/agent-login-url.mjs",
  "shared/agent-vendor-key-url.mjs",
  "shared/agent-configuration-preferences.mjs",
  "app/domain/edit-runtime-contract.js",
  "public/brand-logo.png",
  "dist-desktop/renderer/**/*",
  "package.json",
  "!node_modules/**/*",
];

const BRIDGE_FILES = [
  "workspace-bridge.mjs",
  "workspace-bridge-shutdown.mjs",
  "agent-bridge-service.mjs",
  "agent/agent-runtime-coordinator.mjs",
  "agent/agent-configuration-snapshot.mjs",
  "agent/agent-session-projector.mjs",
  "agent/agent-lease-store.mjs",
  "agent/agent-events.mjs",
  "agent/agent-errors.mjs",
  "agent/providers/agent-provider-contract.mjs",
  "agent/providers/provider-registry.mjs",
  "agent/providers/qoder-provider.mjs",
  "agent/providers/codex-acp-provider.mjs",
  "agent/providers/openai-compatible-provider.mjs",
  "agent/providers/openai-compatible-vendor-adapters.mjs",
  "agent/catalog/agent-catalog.mjs",
  "agent/catalog/agent-installer.mjs",
  "agent/catalog/agent-access-auth.mjs",
  "agent/catalog/agent-login-command.mjs",
  "agent/catalog/qoder-managed-release.mjs",
  "agent/runtimes/agent-runtime-contract.mjs",
  "agent/runtimes/runtime-registry.mjs",
  "agent/runtimes/acp-runtime.mjs",
  "agent/runtimes/acp-protocol.mjs",
  "agent/runtimes/acp-process.mjs",
  "agent/runtimes/codex-client-tools.mjs",
  "agent/runtimes/acp-verified-javascript.mjs",
  "agent/runtimes/http-runtime.mjs",
  "agent/policies/execution-policy.mjs",
  "agent/hosts/execution-host.mjs",
  "qoder-acp-client.mjs",
  "finalize-attempt.mjs",
  "lifecycle-core.mjs",
  "project-file-repository.mjs",
  "project-file-repository/constants.mjs",
  "project-file-repository/errors.mjs",
  "project-file-repository/identity.mjs",
  "project-file-repository/path-safety.mjs",
  "project-file-repository/source-binding.mjs",
  "project-file-repository/submission.mjs",
  "project-file-repository/registry.mjs",
  "project-file-repository/request-draft.mjs",
  "project-file-repository/request-attachments.mjs",
  "project-file-repository/version-candidate.mjs",
  "project-file-repository/candidate-identity.mjs",
  "project-file-repository/working-copy.mjs",
  "project-file-repository/semantic-text-materialization.mjs",
  "project-file-repository/semantic-structure-materialization.mjs",
  "project-file-repository/workspace-performance-timing.mjs",
  "ai-task-projection.mjs",
  "project-file-finalizer.mjs",
  "user-supplement-core.mjs",
  "record-user-supplement.mjs",
  "html-source-parser.mjs",
  "candidate-assessment.mjs",
  "candidate-assessment-decoder.mjs",
  "target-identity.mjs",
  "product-contract.mjs",
  "attachment-storage.mjs",
  "draft-aggregate.mjs",
  "draft-service.mjs",
  "draft-command-decoder.mjs",
  "conversation-repository.mjs",
];

const PACKAGED_MODULES = [
  "@agentclientprotocol/sdk",
  "parse5",
  "entities",
  "electron-updater",
  "builder-util-runtime",
  "fs-extra",
  "js-yaml",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "semver",
  "tiny-typed-emitter",
  "debug",
  "sax",
  "ms",
  "argparse",
  "graceful-fs",
  "jsonfile",
  "universalify",
  "zod",
];

const SHARED_FILES = [
  "draft-aggregate.mjs",
  "direct-edit-compatibility.mjs",
  "editable-island.mjs",
  "native-edit-capability.mjs",
  "pageroot-element-identity.mjs",
  "provenance.mjs",
  "semantic-identity-delta.mjs",
  "semantic-structure-plan.mjs",
  "source-history.mjs",
  "source-style-value.mjs",
  "conversation.mjs",
  "agent-delivery.mjs",
  "agent-access-operation.mjs",
  "agent-login-url.mjs",
  "agent-auth-source.mjs",
  "agent-input-policy.mjs",
  "openai-compatible-vendors.mjs",
  "supported-agent-models.mjs",
  "agent-feature-gates.mjs",
  "task-spec.mjs",
];

const SCHEMA_FILES = [
  "annotation-records.v3.schema.json",
  "attempt-outcome.v1.schema.json",
  "candidate-assessment.v1.schema.json",
  "candidate.v4.schema.json",
  "change-request.v3.schema.json",
  "committed-marker.v1.schema.json",
  "completion.v1.schema.json",
  "conversation.v1.schema.json",
  "conversation.v2.schema.json",
  "conversation-index.v1.schema.json",
  "conversation-draft.v1.schema.json",
  "conversation-draft.v2.schema.json",
  "input-manifest.v1.schema.json",
  "pageroot-element-identity.v1.schema.json",
  "project-state.v3.schema.json",
  "project-identity.v4.schema.json",
  "project-registry.v4.schema.json",
  "project-manifest.v4.schema.json",
  "project-runtime-state.v4.schema.json",
  "promotion-transaction.v4.schema.json",
  "runtime-state.v3.schema.json",
  "scope-report.v1.schema.json",
  "source-element-identity-migration.v1.schema.json",
  "submission-receipt.v1.schema.json",
  "task-spec.v1.schema.json",
  "user-supplement.v1.schema.json",
  "version-manifest.v3.schema.json",
  "version-transaction.v1.schema.json",
  "working-copy-state.v4.schema.json",
];

const LEGAL_RESOURCE_FILES = [
  "PageRoot 用户声明与免责声明.txt",
  "LICENSE",
  "PRIVACY.md",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
];

function sorted(values) {
  return [...values].sort();
}

function readPackage(text) {
  return JSON.parse(text);
}

test("desktop package manifest owns the exact application and Bridge resource closure", async () => {
  const [packageText, mainProcess] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
  ]);
  const packageJson = readPackage(packageText);
  assert.deepEqual(sorted(packageJson.build.files), sorted(APP_FILE_ALLOWLIST));

  // Package owner: this source-side import closure catches a new main-process
  // dependency before an artifact exists; the imported module's behavior stays
  // with its own direct test owner.
  const mainLocalImports = [...mainProcess.matchAll(
    /from\s+"\.\/([^"]+)";/gu,
  )].map((match) => "desktop/" + match[1]);
  for (const runtimeModule of mainLocalImports) {
    assert.ok(
      packageJson.build.files.includes(runtimeModule),
      "Electron main-process dependency must be packaged: " + runtimeModule,
    );
  }

  const resourceTargets = packageJson.build.extraResources.map((entry) => entry.to);
  assert.deepEqual(
    sorted(resourceTargets),
    sorted([
      ...BRIDGE_FILES.map((fileName) => "bridge/" + fileName),
      ...SHARED_FILES.map((fileName) => "shared/" + fileName),
      ...PACKAGED_MODULES.map((moduleName) => "node_modules/" + moduleName),
      "edit-runtime-libraries/echarts/5.4.3/echarts.min.js",
      "edit-runtime-libraries/echarts/5.4.3/LICENSE",
      "edit-runtime-libraries/echarts/5.4.3/NOTICE",
      "edit-runtime-libraries/echarts/5.6.0/echarts.min.js",
      "edit-runtime-libraries/echarts/5.6.0/LICENSE",
      "edit-runtime-libraries/echarts/5.6.0/NOTICE",
      "schemas",
      "app-update.yml",
      "build-info.json",
      "usage-telemetry-config.json",
      "runtime-environment.json",
      ...LEGAL_RESOURCE_FILES,
    ]),
  );
  const exactPackagedAppTargets = packageJson.build.files.filter((entry) => (
    typeof entry === "string"
    && !entry.startsWith("!")
    && !/[?*{}[\]]/u.test(entry)
  ));
  assert.deepEqual(
    exactPackagedAppTargets.filter((entry) => resourceTargets.includes(entry)),
    [],
    "a path listed in both build.files and extraResources is copied only as a resource and never reaches app.asar",
  );
  const packagedRuntimeTargets = new Set([
    ...resourceTargets,
    ...exactPackagedAppTargets,
  ]);
  for (const entry of packageJson.build.extraResources.filter((candidate) => (
    typeof candidate.from === "string"
    && typeof candidate.to === "string"
    && candidate.from.endsWith(".mjs")
    && (candidate.to.startsWith("bridge/") || candidate.to.startsWith("shared/"))
  ))) {
    const source = await readFile(new URL(`../${entry.from}`, import.meta.url), "utf8");
    const relativeImports = [...source.matchAll(
      /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/gu,
    )].map((match) => match[1]);
    for (const specifier of relativeImports) {
      const dependency = path.posix.normalize(path.posix.join(
        path.posix.dirname(entry.to),
        specifier,
      ));
      assert.ok(
        packagedRuntimeTargets.has(dependency),
        `${entry.to} imports an unpackaged runtime resource: ${dependency}`,
      );
    }
  }
  const schemaResource = packageJson.build.extraResources.find(
    (entry) => entry.to === "schemas",
  );
  assert.deepEqual(sorted(schemaResource?.filter ?? []), sorted(SCHEMA_FILES));

  for (const retiredFile of [
    "desktop/manual-update.mjs",
    "desktop/legacy-editor.mjs",
    "desktop/edit-runtime-probe-owner.mjs",
  ]) {
    assert.equal(
      packageJson.build.files.includes(retiredFile),
      false,
      retiredFile + " must not re-enter the package allowlist",
    );
  }
});

test("desktop package identity and artifact profile stay fixed", async () => {
  const packageJson = readPackage(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.name, "pageroot");
  assert.match(packageJson.description, /源页（PageRoot）— Editable islands/u);
  assert.equal(semver.valid(packageJson.version), packageJson.version);
  assert.equal(packageJson.build.appId, "com.htmlai.workbench");
  assert.equal(packageJson.build.productName, "PageRoot");
  assert.equal(packageJson.build.artifactName, "PageRoot-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.afterPack, "desktop/after-pack.mjs");
  assert.deepEqual(packageJson.build.publish, [
    {
      provider: "github",
      owner: "Charleyli925",
      repo: "PageRoot",
      releaseType: "release",
    },
  ]);
  assert.equal(packageJson.build.forceCodeSigning, true);
  assert.deepEqual(packageJson.build.fileAssociations, [{
    ext: ["html", "htm"],
    name: "HTML Document",
    role: "Editor",
    rank: "Alternate",
  }]);
  assert.equal(packageJson.build.mac.identity, undefined);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(
    packageJson.build.mac.entitlements,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.deepEqual(packageJson.build.mac.target, ["dmg", "zip"]);
  assert.deepEqual(packageJson.build.publish, [{
    provider: "github",
    owner: "Charleyli925",
    repo: "PageRoot",
    releaseType: "release",
  }]);
  assert.equal(packageJson.dependencies["@openai/codex"], undefined);
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
});

test("package security boundaries retain CSP, entitlements and final plist cleanup", async () => {
  const [rendererHtml, entitlements, afterPack] = await Promise.all([
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/resources/entitlements.mac.plist", import.meta.url), "utf8"),
    readFile(new URL("../desktop/after-pack.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(rendererHtml, /Content-Security-Policy/u);
  assert.match(rendererHtml, /default-src 'none'/u);
  assert.match(rendererHtml, /script-src 'self'/u);
  const scriptSrc = rendererHtml.match(/script-src [^;]+/u)?.[0] || "";
  assert.equal(scriptSrc, "script-src 'self' pageroot-edit-runtime:");
  assert.doesNotMatch(scriptSrc, /pageroot-preview:/u);
  assert.match(rendererHtml, /style-src 'self' 'unsafe-inline' file: http: https: pageroot-edit-runtime: pageroot-preview:/u);
  assert.match(rendererHtml, /img-src 'self' file: data: blob: http: https: pageroot-edit-runtime: pageroot-preview:/u);
  assert.match(rendererHtml, /font-src 'self' file: data: http: https: pageroot-edit-runtime: pageroot-preview:/u);
  assert.match(rendererHtml, /media-src 'self' file: data: blob: http: https: pageroot-edit-runtime: pageroot-preview:/u);
  assert.match(rendererHtml, /connect-src http:\/\/127\.0\.0\.1:\*/u);
  assert.match(rendererHtml, /frame-src 'self' data: blob: pageroot-preview: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /object-src 'none'/u);
  assert.match(rendererHtml, /base-uri 'self' file: pageroot-edit-runtime: pageroot-preview:/u);
  assert.doesNotMatch(rendererHtml, /frame-ancestors/u);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/u);
  assert.doesNotMatch(entitlements, /disable-library-validation/u);

  // Package owner: afterPack changes the final Info.plist before release
  // verification, so this is the low-cost pre-build oracle for privacy scope.
  assert.match(afterPack, /NSMicrophoneUsageDescription/u);
  assert.match(afterPack, /NSAudioCaptureUsageDescription/u);
  assert.match(afterPack, /Delete/u);
});

test("packaged legal notice and icon remain available as reviewed resources", async () => {
  const [notice, privacy, iconInfo] = await Promise.all([
    readFile(new URL("../PageRoot 用户声明与免责声明.txt", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    stat(new URL("../desktop/resources/icon.icns", import.meta.url)),
  ]);
  assert.match(notice, /AI Agent 生成或修改的内容可能不准确/u);
  assert.match(notice, /选择“源页 Agent”“Qoder CLI”“Codex”或“复制任务”/u);
  assert.match(notice, /Codex 修改时可能以当前用户的读取权限访问/u);
  assert.match(notice, /不构成对本机读取权限的完整操作系统隔离/u);
  assert.match(notice, /只有用户明确采纳后才成为正式版本/u);
  assert.match(privacy, /用户主动选择源页 Agent、Qoder CLI 或 Codex/u);
  assert.match(privacy, /将完成任务所需的内容发送至 Codex 服务/u);
  assert.match(notice, /Apache License 2\.0/u);
  assert.ok(iconInfo.size > 100_000);
});

// The packaged runtime file set is restated in four places: the electron-builder
// manifest, the expectation in this test, the packaged-artifact verifier and the
// release-evidence fixture. Only the first two are compared above, so a file
// added to the manifest but missing from the verifier used to pass every local
// gate and fail in the release dry run, where the asar contents are checked for
// real. Pinning all four here turns that into a local failure.
test("every packaged runtime file list agrees with the others", () => {
  const desktopOnly = (entries) => entries
    .filter((entry) => entry.startsWith("desktop/"))
    .slice()
    .sort();

  assert.deepEqual(
    desktopOnly(REQUIRED_APP_SOURCE_FILES),
    desktopOnly(APP_FILE_ALLOWLIST),
    "scripts/verify-packaged-artifact.mjs disagrees with this test's allowlist",
  );
  assert.deepEqual(
    desktopOnly(APP_SOURCE_FILES),
    desktopOnly(APP_FILE_ALLOWLIST),
    "tests/helpers/release-evidence-fixtures.mjs disagrees with this test's allowlist",
  );
  assert.deepEqual(
    REQUIRED_SHARED_FILES.slice().sort(),
    SHARED_FILES.slice().sort(),
    "the shared resource lists disagree",
  );
});
