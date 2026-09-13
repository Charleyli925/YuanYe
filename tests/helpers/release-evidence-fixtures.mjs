import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";

import {
  expectedApplicationUpdateConfig,
  serializeApplicationUpdateConfig,
} from "../../scripts/application-update-config.mjs";
import { runtimeEnvironmentMarker } from "../../desktop/runtime-environment.mjs";

const FIXTURE_COMMIT_SHA = "a".repeat(40);
const FIXTURE_TREE_SHA = "b".repeat(40);
const FIXTURE_HEAD_SHA = "c".repeat(40);
const FIXTURE_VERSION = "0.9.4";
const FIXTURE_ARCHITECTURE = "arm64";
const FIXTURE_BUILT_AT = "2026-07-29T00:00:00.000Z";
const FIXTURE_REPOSITORY = "https://github.com/Charleyli925/PageRoot";

export const APP_SOURCE_FILES = [
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
  "dist-desktop/renderer/index.html",
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
  "argparse",
  "builder-util-runtime",
  "debug",
  "electron-updater",
  "entities",
  "fs-extra",
  "graceful-fs",
  "js-yaml",
  "jsonfile",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "ms",
  "parse5",
  "sax",
  "semver",
  "tiny-typed-emitter",
  "universalify",
  "zod",
];

const SCHEMA_FILES = [
  "candidate-assessment.v1.schema.json",
  "runtime-state.v3.schema.json",
  "scope-report.v1.schema.json",
  "task-spec.v1.schema.json",
  "user-supplement.v1.schema.json",
];

const LEGAL_RESOURCE_FILES = [
  "PageRoot 用户声明与免责声明.txt",
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md",
];

function assertProfile(profile) {
  assert.match(
    profile ?? "",
    /^(?:developer|dry-run|candidate|release)$/u,
    "fixture profile must be developer, dry-run, candidate, or release",
  );
}

function mergePackageJson(base, overrides) {
  const {
    build: buildOverrides = {},
    devDependencies: developmentOverrides = {},
    ...topLevelOverrides
  } = overrides;
  return {
    ...base,
    ...topLevelOverrides,
    devDependencies: {
      ...base.devDependencies,
      ...developmentOverrides,
    },
    build: {
      ...base.build,
      ...buildOverrides,
    },
  };
}

function fixtureExtraResources() {
  return [
    {
      from: "schemas",
      to: "schemas",
      filter: [...SCHEMA_FILES],
    },
    {
      from: "node_modules/echarts/dist/echarts.min.js",
      to: "edit-runtime-libraries/echarts/5.6.0/echarts.min.js",
    },
    {
      from: "node_modules/echarts/LICENSE",
      to: "edit-runtime-libraries/echarts/5.6.0/LICENSE",
    },
    {
      from: "node_modules/echarts/NOTICE",
      to: "edit-runtime-libraries/echarts/5.6.0/NOTICE",
    },
    {
      from: "node_modules/echarts-5-4-3/dist/echarts.min.js",
      to: "edit-runtime-libraries/echarts/5.4.3/echarts.min.js",
    },
    {
      from: "node_modules/echarts-5-4-3/LICENSE",
      to: "edit-runtime-libraries/echarts/5.4.3/LICENSE",
    },
    {
      from: "node_modules/echarts-5-4-3/NOTICE",
      to: "edit-runtime-libraries/echarts/5.4.3/NOTICE",
    },
    {
      from: "output/release-metadata/build-info.json",
      to: "build-info.json",
    },
    {
      from: "output/release-metadata/app-update.yml",
      to: "app-update.yml",
    },
    {
      from: "PageRoot 用户声明与免责声明.txt",
      to: "PageRoot 用户声明与免责声明.txt",
    },
    {
      from: "output/release-metadata/usage-telemetry-config.json",
      to: "usage-telemetry-config.json",
    },
    {
      from: "output/release-metadata/runtime-environment.json",
      to: "runtime-environment.json",
    },
    { from: "LICENSE", to: "LICENSE" },
    { from: "NOTICE", to: "NOTICE" },
    { from: "PRIVACY.md", to: "PRIVACY.md" },
    { from: "THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" },
  ];
}

export function fixturePackageJson(profile, overrides = {}) {
  assertProfile(profile);
  const isDeveloper = profile === "developer";
  return mergePackageJson({
    name: "pageroot",
    version: FIXTURE_VERSION,
    main: "desktop/main.mjs",
    devDependencies: { electron: "43.2.0" },
    build: {
      appId: isDeveloper
        ? "com.htmlai.workbench.developer-preview"
        : "com.htmlai.workbench",
      productName: isDeveloper ? "PageRoot Developer Preview" : "PageRoot",
      artifactName: isDeveloper
        ? "PageRoot-Developer-Preview-${version}-${arch}.${ext}"
        : "PageRoot-${version}-${arch}.${ext}",
      directories: { output: "release" },
      extraResources: fixtureExtraResources(),
      publish: [
        {
          provider: "github",
          owner: "Charleyli925",
          repo: "PageRoot",
          releaseType: "release",
        },
      ],
      mac: {
        entitlements: "desktop/resources/entitlements.mac.plist",
        entitlementsInherit: "desktop/resources/entitlements.mac.plist",
      },
    },
  }, overrides);
}

export function fixtureBuildInfo(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "pageroot",
    version: FIXTURE_VERSION,
    architecture: FIXTURE_ARCHITECTURE,
    sourceRepository: FIXTURE_REPOSITORY,
    commitSha: FIXTURE_COMMIT_SHA,
    treeSha: FIXTURE_TREE_SHA,
    builtAt: FIXTURE_BUILT_AT,
    ...overrides,
  };
}

export function fixtureTelemetryConfig(profile, overrides = {}) {
  assertProfile(profile);
  const enabled = profile !== "developer";
  return {
    version: 1,
    enabled,
    host: "https://us.i.posthog.com",
    projectToken: enabled ? "phc_syntheticpageroot" : "",
    ...overrides,
  };
}

export function fixtureSourceGateIdentity(overrides = {}) {
  return {
    currentCommitSha: FIXTURE_COMMIT_SHA,
    currentTreeSha: FIXTURE_TREE_SHA,
    packageVersion: "0.8.4",
    headSha: FIXTURE_HEAD_SHA,
    now: new Date("2026-07-23T12:00:00.000Z"),
    maxAgeHours: 168,
    ...overrides,
  };
}

export function fixtureCandidateIdentity(overrides = {}) {
  const {
    packageJson: suppliedPackageJson,
    packageVersion = "0.8.9",
    lockVersion = packageVersion,
    ...identityOverrides
  } = overrides;
  return {
    commitSha: FIXTURE_COMMIT_SHA,
    treeSha: FIXTURE_TREE_SHA,
    packageVersion,
    lockVersion,
    packageJson: suppliedPackageJson
      ? structuredClone(suppliedPackageJson)
      : fixturePackageJson("candidate", { version: packageVersion }),
    ...identityOverrides,
  };
}

async function writeFixtureFile(root, relativePath, contents) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
  return destination;
}

async function copyFixtureFile(sourceRoot, destinationRoot, relativePath) {
  const destination = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(sourceRoot, relativePath), destination);
  return destination;
}

function syntheticAppRelativePath(packageJson, architecture, relativePath) {
  if (relativePath) {
    assert.equal(path.isAbsolute(relativePath), false, "synthetic app path must be relative");
    assert.equal(relativePath.split(path.sep).includes(".."), false, "synthetic app path cannot escape its product root");
    return relativePath;
  }
  const architectureDirectory = architecture === "arm64" ? "mac-arm64" : "mac";
  return path.join(
    "release",
    architectureDirectory,
    packageJson.build.productName + ".app",
  );
}

export async function createSyntheticAppBundle(t, {
  profile,
  version,
  architecture = FIXTURE_ARCHITECTURE,
  appRelativePath,
  packageJson: packageJsonOverrides = {},
  buildInfo: buildInfoOverrides = {},
  telemetry: telemetryOverrides = {},
} = {}) {
  assertProfile(profile);
  assert.equal(typeof t?.after, "function", "a Node test context with t.after is required");
  assert.match(architecture, /^(?:arm64|x64)$/u, "synthetic architecture must be arm64 or x64");

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-release-evidence-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const productRoot = path.join(temporaryRoot, "product");
  const packageJson = fixturePackageJson(profile, {
    ...packageJsonOverrides,
    ...(version ? { version } : {}),
  });
  const effectiveVersion = packageJson.version;
  const effectiveBuildInfo = fixtureBuildInfo({
    version: effectiveVersion,
    architecture,
    ...buildInfoOverrides,
  });
  const telemetry = fixtureTelemetryConfig(profile, telemetryOverrides);
  const applicationUpdate = expectedApplicationUpdateConfig(packageJson);
  const applicationUpdateContents = serializeApplicationUpdateConfig(packageJson);
  const runtimeEnvironment = runtimeEnvironmentMarker(
    profile === "developer" ? "preview" : "stable",
  );

  await writeFixtureFile(
    productRoot,
    "package.json",
    JSON.stringify(packageJson, null, 2) + "\n",
  );
  await writeFixtureFile(
    productRoot,
    "package-lock.json",
    JSON.stringify({
      name: packageJson.name,
      version: effectiveVersion,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: packageJson.name,
          version: effectiveVersion,
        },
      },
    }, null, 2) + "\n",
  );
  await Promise.all(APP_SOURCE_FILES.map((relativePath) => writeFixtureFile(
    productRoot,
    relativePath,
    "fixture:" + relativePath + "\n",
  )));
  await Promise.all(BRIDGE_FILES.map((fileName) => writeFixtureFile(
    productRoot,
    "bridge/" + fileName,
    "fixture:bridge/" + fileName + "\n",
  )));
  await Promise.all([
    writeFixtureFile(
      productRoot,
      "shared/draft-aggregate.mjs",
      "export const fixtureDraftAggregate = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/direct-edit-compatibility.mjs",
      "export const fixtureDirectEditCompatibility = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/editable-island.mjs",
      "export const fixtureEditableIsland = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/native-edit-capability.mjs",
      "export const fixtureNativeEditCapability = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/source-history.mjs",
      "export const fixtureSourceHistory = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/source-style-value.mjs",
      "export const fixtureSourceStyleValue = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/semantic-identity-delta.mjs",
      "export const fixtureSemanticIdentityDelta = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/semantic-structure-plan.mjs",
      "export const fixtureSemanticStructurePlan = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/conversation.mjs",
      "export const fixtureConversation = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-delivery.mjs",
      "export const fixtureAgentDelivery = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-access-operation.mjs",
      "export const fixtureAgentAccessOperation = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-login-url.mjs",
      "export const fixtureAgentLoginUrl = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-auth-source.mjs",
      "export const fixtureAgentAuthSource = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-input-policy.mjs",
      "export const HTTP_AGENT_INPUT_POLICY_REVISION = 'fixture';\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-vendor-key-url.mjs",
      "export const AGENT_VENDOR_KEY_VENDOR_IDS = Object.freeze([]);\nexport const publicAgentVendorKeyUrl = () => null;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-configuration-preferences.mjs",
      "export const fixtureAgentConfigurationPreferences = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/openai-compatible-vendors.mjs",
      "export const PAGEROOT_PROVIDER_ID = 'pageroot';\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/supported-agent-models.mjs",
      "export const SUPPORTED_AGENT_MODELS = Object.freeze([]);\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/agent-feature-gates.mjs",
      "export const AGENT_FEATURE_GATES = Object.freeze({ codexDiscussion: false });\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/task-spec.mjs",
      "export const TASK_SPEC_SCHEMA_VERSION = '1.0.0';\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/provenance.mjs",
      "export const fixtureProvenance = true;\n",
    ),
    writeFixtureFile(
      productRoot,
      "shared/pageroot-element-identity.mjs",
      "export const PAGEROOT_ELEMENT_ID_SCHEMA_VERSION = 1;\n",
    ),
    ...SCHEMA_FILES.map((fileName) => writeFixtureFile(
      productRoot,
      "schemas/" + fileName,
      "{\"type\":\"object\"}\n",
    )),
    ...LEGAL_RESOURCE_FILES.map((fileName) => writeFixtureFile(
      productRoot,
      fileName,
      "fixture:" + fileName + "\n",
    )),
    ...PACKAGED_MODULES.flatMap((moduleName) => [
      writeFixtureFile(
        productRoot,
        "node_modules/" + moduleName + "/package.json",
        JSON.stringify({ name: moduleName, version: "fixture" }) + "\n",
      ),
      writeFixtureFile(
        productRoot,
        "node_modules/" + moduleName + "/dist/index.js",
        "export const fixture = " + JSON.stringify(moduleName) + ";\n",
      ),
    ]),
  ]);

  const relativeAppPath = syntheticAppRelativePath(
    packageJson,
    architecture,
    appRelativePath,
  );
  const appPath = path.join(productRoot, relativeAppPath);
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  await mkdir(resourcesPath, { recursive: true });
  await writeFixtureFile(
    appPath,
    "Contents/Info.plist",
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
      + "<plist version=\"1.0\"><dict>\n"
      + "  <key>CFBundleShortVersionString</key><string>" + effectiveVersion + "</string>\n"
      + "  <key>CFBundleVersion</key><string>" + effectiveVersion + "</string>\n"
      + "  <key>CFBundleIdentifier</key><string>" + packageJson.build.appId + "</string>\n"
      + "</dict></plist>\n",
  );

  const asarSource = path.join(temporaryRoot, "asar-source");
  await Promise.all([
    copyFixtureFile(productRoot, asarSource, "package.json"),
    ...APP_SOURCE_FILES.map((relativePath) => copyFixtureFile(
      productRoot,
      asarSource,
      relativePath,
    )),
  ]);
  await createPackage(asarSource, path.join(resourcesPath, "app.asar"));

  await Promise.all([
    ...BRIDGE_FILES.map(async (fileName) => {
      const sourcePath = fileName === "product-contract.mjs"
        ? "desktop/" + fileName
        : "bridge/" + fileName;
      const destination = path.join(resourcesPath, "bridge", fileName);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(productRoot, sourcePath), destination);
    }),
    ...[
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
    ].map((fileName) => copyFixtureFile(
      productRoot,
      resourcesPath,
      "shared/" + fileName,
    )),
    ...PACKAGED_MODULES.flatMap((moduleName) => [
      copyFixtureFile(
        productRoot,
        resourcesPath,
        "node_modules/" + moduleName + "/package.json",
      ),
      copyFixtureFile(
        productRoot,
        resourcesPath,
        "node_modules/" + moduleName + "/dist/index.js",
      ),
    ]),
    ...SCHEMA_FILES.map((fileName) => copyFixtureFile(
      productRoot,
      resourcesPath,
      "schemas/" + fileName,
    )),
    ...LEGAL_RESOURCE_FILES.map((fileName) => copyFixtureFile(
      productRoot,
      resourcesPath,
      fileName,
    )),
    writeFixtureFile(productRoot, "node_modules/echarts/dist/echarts.min.js", "globalThis.echarts = Object.freeze({});\n"),
    writeFixtureFile(productRoot, "node_modules/echarts/LICENSE", "Apache License 2.0 fixture\n"),
    writeFixtureFile(productRoot, "node_modules/echarts/NOTICE", "Apache ECharts fixture notice\n"),
    writeFixtureFile(productRoot, "node_modules/echarts-5-4-3/dist/echarts.min.js", "globalThis.echarts = Object.freeze({});\n"),
    writeFixtureFile(productRoot, "node_modules/echarts-5-4-3/LICENSE", "Apache License 2.0 fixture\n"),
    writeFixtureFile(productRoot, "node_modules/echarts-5-4-3/NOTICE", "Apache ECharts fixture notice\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.4.3/echarts.min.js", "globalThis.echarts = Object.freeze({});\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.4.3/LICENSE", "Apache License 2.0 fixture\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.4.3/NOTICE", "Apache ECharts fixture notice\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.6.0/echarts.min.js", "globalThis.echarts = Object.freeze({});\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.6.0/LICENSE", "Apache License 2.0 fixture\n"),
    writeFixtureFile(resourcesPath, "edit-runtime-libraries/echarts/5.6.0/NOTICE", "Apache ECharts fixture notice\n"),
    writeFixtureFile(
      productRoot,
      "output/release-metadata/build-info.json",
      JSON.stringify(effectiveBuildInfo, null, 2) + "\n",
    ),
    writeFixtureFile(
      productRoot,
      "output/release-metadata/usage-telemetry-config.json",
      JSON.stringify(telemetry, null, 2) + "\n",
    ),
    writeFixtureFile(
      productRoot,
      "output/release-metadata/app-update.yml",
      applicationUpdateContents,
    ),
    writeFixtureFile(
      productRoot,
      "output/release-metadata/runtime-environment.json",
      JSON.stringify(runtimeEnvironment, null, 2) + "\n",
    ),
    writeFixtureFile(
      resourcesPath,
      "build-info.json",
      JSON.stringify(effectiveBuildInfo, null, 2) + "\n",
    ),
    writeFixtureFile(
      resourcesPath,
      "usage-telemetry-config.json",
      JSON.stringify(telemetry, null, 2) + "\n",
    ),
    writeFixtureFile(
      resourcesPath,
      "app-update.yml",
      applicationUpdateContents,
    ),
    writeFixtureFile(
      resourcesPath,
      "runtime-environment.json",
      JSON.stringify(runtimeEnvironment, null, 2) + "\n",
    ),
  ]);

  return {
    appPath,
    applicationUpdate: structuredClone(applicationUpdate),
    buildInfo: structuredClone(effectiveBuildInfo),
    packageJson: structuredClone(packageJson),
    productRoot,
    resourcesPath,
    telemetry: structuredClone(telemetry),
    temporaryRoot,
  };
}
