#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { extractFile, listPackage, statFile } from "@electron/asar";
import {
  APPLICATION_UPDATE_CONFIG_FILE,
  APPLICATION_UPDATE_CONFIG_SOURCE,
  parseApplicationUpdateConfig,
} from "./application-update-config.mjs";
import {
  DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  developerPreviewPackageJson,
  developerPreviewReleaseDirectory,
  resolveDeveloperPreviewIdentity,
} from "./developer-preview.mjs";
import {
  candidateAppReleaseDirectory,
  releaseDryRunAppReleaseDirectory,
} from "./release-app-stage.mjs";
import {
  expectedPackagedAppIdentity,
  readPackagedPlistIdentity,
} from "./packaged-app-identity.mjs";
import { assertBuildInfo, expectedBuildInfo } from "./release-provenance.mjs";
import { AGENT_FEATURE_GATES } from "../shared/agent-feature-gates.mjs";
import { parseRuntimeEnvironmentMarker } from "../desktop/runtime-environment.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PRODUCT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const REQUIRED_BRIDGE_FILES = [
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
const REQUIRED_BASE_PACKAGED_MODULES = [
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

function requiredPackagedModules() {
  return [...REQUIRED_BASE_PACKAGED_MODULES].sort();
}
export const REQUIRED_SHARED_FILES = [
  "direct-edit-compatibility.mjs",
  "draft-aggregate.mjs",
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
const REQUIRED_LEGAL_RESOURCES = [
  "PageRoot 用户声明与免责声明.txt",
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md",
];
const EXPECTED_MAC_TEAM_ID = "RNK9RB969G";
export const REQUIRED_APP_SOURCE_FILES = [
  "desktop/main.mjs",
  "desktop/preload.mjs",
  "desktop/external-file-open.mjs",
  "desktop/workbench-tabs-state.mjs",
  "desktop/prepared-html-open.mjs",
  "desktop/project-open-queue.mjs",
  "desktop/project-files.mjs",
  "desktop/recovery-journal-store.mjs",
  "desktop/source-file-watch.mjs",
  "desktop/source-rename.mjs",
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
];
const RETIRED_EDITOR_ARTIFACTS = [
  { name: "Edit runtime probe owner", pattern: /edit-runtime-probe-owner/iu },
  { name: "Edit runtime capture owner", pattern: /edit-runtime-capture-owner/iu },
  {
    name: "Lexical",
    pattern: /(?:@lexical\/|\bnode_modules[/\\]lexical(?:[/\\"']|$)|["']lexical["']\s*:|["'][^"']+["']\s*:\s*["']npm:lexical@|\b(?:from|import)\s*["']lexical["']|\b(?:import|require)\s*\(\s*["']lexical["']\s*\)|\bMinified Lexical error\b)/iu,
  },
  {
    name: "TextFlow",
    pattern: /(?:\b(?:TextFlow(?:Editor|Session|Surface)?|textFlow(?:Editor|Session|Surface)|startTextFlowEditing)\b|"(?:node_modules\/)?(?:@[^"/]+\/)?text-?flow"\s*:|"[^"]+"\s*:\s*"npm:(?:@[^"/]+\/)?text-?flow@)/iu,
  },
  {
    name: "legacy editing surface",
    pattern: /pageroot-text-(?:editor|ghost)|data-(?:html-canvas|pageroot)-text-flow/iu,
  },
];
const RUNTIME_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
]);

function parseArguments(argv) {
  const options = {
    arch: "arm64",
    appPath: undefined,
    profile: "release",
    releaseDirectory: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--arch") {
      options.arch = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--release-directory") {
      options.releaseDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--profile") {
      options.profile = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--app-path") {
      options.appPath = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  assert.match(options.arch ?? "", /^(arm64|x64)$/, "--arch must be arm64 or x64");
  assert.match(
    options.profile ?? "",
    /^(release|developer|candidate-app|candidate-app-signed|release-dry-run)$/,
    "--profile must be release, developer, candidate-app, candidate-app-signed or release-dry-run",
  );
  if (options.appPath !== undefined) {
    assert.equal(path.isAbsolute(options.appPath), true, "--app-path must be absolute");
    assert.equal(path.extname(options.appPath), ".app", "--app-path must name an app");
  }
  return options;
}

export function expectedArtifactLayout({
  productRoot = DEFAULT_PRODUCT_ROOT,
  packageJson,
  arch = "arm64",
  releaseDirectory,
  artifactName: artifactNameOverride,
}) {
  const resolvedReleaseDirectory = path.resolve(
    releaseDirectory ?? path.join(productRoot, packageJson.build?.directories?.output ?? "release"),
  );
  const productName = packageJson.build?.productName;
  const artifactName = artifactNameOverride ?? packageJson.build?.artifactName;
  assert.equal(typeof productName, "string", "build.productName must be configured");
  assert.equal(typeof artifactName, "string", "build.artifactName must be configured");
  assert.equal(typeof packageJson.version, "string", "package version must be configured");
  const architectureDirectory = arch === "arm64" ? "mac-arm64" : "mac";
  const dmgName = artifactName
    .replaceAll("${version}", packageJson.version)
    .replaceAll("${arch}", arch)
    .replaceAll("${ext}", "dmg");
  const zipName = artifactName
    .replaceAll("${version}", packageJson.version)
    .replaceAll("${arch}", arch)
    .replaceAll("${ext}", "zip");
  assert.doesNotMatch(dmgName, /\$\{[^}]+\}/, "build.artifactName contains an unsupported macro");
  assert.doesNotMatch(zipName, /\$\{[^}]+\}/, "build.artifactName contains an unsupported macro");
  return {
    releaseDirectory: resolvedReleaseDirectory,
    appPath: path.join(resolvedReleaseDirectory, architectureDirectory, `${productName}.app`),
    dmgPath: path.join(resolvedReleaseDirectory, dmgName),
    zipPath: path.join(resolvedReleaseDirectory, zipName),
    blockmapPath: path.join(resolvedReleaseDirectory, `${zipName}.blockmap`),
    updateInfoPath: path.join(resolvedReleaseDirectory, "latest-mac.yml"),
    productName,
    version: packageJson.version,
  };
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

async function listFiles(root, predicate = () => true) {
  const output = [];
  const rootInformation = await lstat(root);
  assert.equal(
    rootInformation.isDirectory() && !rootInformation.isSymbolicLink(),
    true,
    `runtime tree root must be a real directory: ${root}`,
  );
  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && predicate(relativePath)) {
        output.push(normalizeRelativePath(relativePath));
      } else if (!entry.isFile()) {
        const kind = entry.isSymbolicLink()
          ? "symlink"
          : entry.isFIFO()
            ? "FIFO"
            : entry.isSocket()
              ? "socket"
              : entry.isCharacterDevice()
                ? "character device"
                : entry.isBlockDevice()
                  ? "block device"
                  : "non-regular entry";
        assert.fail(`packaged runtime tree contains unsupported ${kind}: ${absolutePath}`);
      }
    }
  }
  await visit(root);
  return output;
}

async function listPackagedModuleNames(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      output.push(`${entry.name}:not-directory`);
      continue;
    }
    if (!entry.name.startsWith("@")) {
      output.push(entry.name);
      continue;
    }
    const scopedEntries = await readdir(path.join(root, entry.name), { withFileTypes: true });
    if (scopedEntries.length === 0) output.push(`${entry.name}/:empty-scope`);
    for (const scopedEntry of scopedEntries) {
      const packageName = `${entry.name}/${scopedEntry.name}`;
      output.push(scopedEntry.isDirectory() ? packageName : `${packageName}:not-directory`);
    }
  }
  return output.sort();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertNoRetiredEditorArtifacts(contents, label = "runtime artifact") {
  const text = Buffer.isBuffer(contents) ? contents.toString("utf8") : String(contents);
  for (const artifact of RETIRED_EDITOR_ARTIFACTS) {
    assert.doesNotMatch(
      text,
      artifact.pattern,
      `${label} still contains retired ${artifact.name} code`,
    );
  }
}

function isRuntimeTextArtifact(relativePath) {
  return RUNTIME_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

async function assertSourceDependencyClosureIsClean(productRoot, packageJson) {
  const [manifestText, lockText] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "package-lock.json"), "utf8"),
  ]);
  const sourceManifest = JSON.parse(manifestText);
  assert.equal(sourceManifest.name, packageJson.name, "source package name drifted");
  assert.equal(sourceManifest.version, packageJson.version, "source package version drifted");
  assertNoRetiredEditorArtifacts(manifestText, "source package.json");
  assertNoRetiredEditorArtifacts(lockText, "source package-lock.json");
}

async function assertFilesEqual(sourcePath, packagedPath, label) {
  const [source, packaged] = await Promise.all([
    readFile(sourcePath),
    readFile(packagedPath),
  ]);
  assert.equal(
    sha256(packaged),
    sha256(source),
    `${label} does not match source: ${packagedPath}`,
  );
}

export async function assertSignedMachOContentEqual({
  sourcePath,
  packagedPath,
  entitlementsPath,
  label,
}) {
  runCommand(
    "codesign",
    ["--verify", "--strict", "--verbose=4", packagedPath],
    `${label} signature verification`,
  );
  const comparisonRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-macho-compare-"));
  const sourceCopy = path.join(comparisonRoot, "source");
  const packagedCopy = path.join(comparisonRoot, "packaged");
  try {
    await Promise.all([
      copyFile(sourcePath, sourceCopy),
      copyFile(packagedPath, packagedCopy),
    ]);
    for (const filePath of [sourceCopy, packagedCopy]) {
      runCommand(
        "codesign",
        ["--remove-signature", filePath],
        `${label} signature normalization`,
      );
      runCommand(
        "codesign",
        [
          "--force",
          "--sign",
          "-",
          "--identifier",
          "app.pageroot.packaged-codex-verifier",
          "--entitlements",
          entitlementsPath,
          filePath,
        ],
        `${label} deterministic signature normalization`,
      );
    }
    await assertFilesEqual(sourceCopy, packagedCopy, `${label} executable content`);
  } finally {
    await rm(comparisonRoot, { recursive: true, force: true });
  }
}

function asarFilePaths(asarPath) {
  const output = [];
  for (const entry of listPackage(asarPath).map((value) => value.replace(/^\//, ""))) {
    const information = statFile(asarPath, entry, false);
    assert.equal(
      "link" in information,
      false,
      `app.asar contains unsupported link entry: ${entry}`,
    );
    if ("files" in information) continue;
    assert.equal(
      Number.isSafeInteger(information.size) && information.size >= 0,
      true,
      `app.asar contains an invalid non-regular entry: ${entry}`,
    );
    output.push(entry);
  }
  return output.sort();
}

async function assertDirectoryMatches({
  sourceRoot,
  packagedRoot,
  predicate,
  label,
  compareFile = assertFilesEqual,
}) {
  const [sourceFiles, packagedFiles] = await Promise.all([
    listFiles(sourceRoot, predicate),
    listFiles(packagedRoot, predicate),
  ]);
  assert.deepEqual(packagedFiles, sourceFiles, `${label} file list does not match source`);
  for (const relativePath of sourceFiles) {
    await compareFile(
      path.join(sourceRoot, relativePath),
      path.join(packagedRoot, relativePath),
      `${label}/${relativePath}`,
      relativePath,
    );
  }
  return sourceFiles;
}

async function assertSchemaBundleMatches({
  productRoot,
  resourcesPath,
  packageJson,
}) {
  const schemaResource = packageJson.build?.extraResources?.find(
    (entry) => entry?.to === "schemas",
  );
  const expectedFiles = [...(schemaResource?.filter ?? [])].sort();
  assert.ok(expectedFiles.length > 0, "the active Schema allowlist is empty");
  assert.ok(
    expectedFiles.every((fileName) => /^[a-z0-9.-]+\.schema\.json$/.test(fileName)),
    "the active Schema allowlist must contain explicit schema filenames",
  );
  const packagedRoot = path.join(resourcesPath, "schemas");
  const packagedFiles = await listFiles(packagedRoot);
  assert.deepEqual(
    packagedFiles,
    expectedFiles,
    "packaged schemas must exactly match the active clean-workspace allowlist",
  );
  for (const fileName of expectedFiles) {
    await assertFilesEqual(
      path.resolve(productRoot, "schemas", fileName),
      path.join(packagedRoot, fileName),
      `schemas/${fileName}`,
    );
  }
  return packagedFiles;
}

async function assertUsageTelemetryConfig({
  productRoot,
  resourcesPath,
  packageJson,
}) {
  const telemetryResource = packageJson.build?.extraResources?.find(
    (entry) => entry?.to === "usage-telemetry-config.json",
  );
  assert.equal(
    telemetryResource?.from,
    "output/release-metadata/usage-telemetry-config.json",
    "the packaged telemetry config must come from release metadata",
  );
  const sourcePath = path.resolve(productRoot, telemetryResource.from);
  const packagedPath = path.join(resourcesPath, "usage-telemetry-config.json");
  await assertFilesEqual(sourcePath, packagedPath, "usage-telemetry-config.json");
  const config = JSON.parse(await readFile(packagedPath, "utf8"));
  assert.equal(config.version, 1, "telemetry config schema is unsupported");
  assert.equal(typeof config.enabled, "boolean", "telemetry enabled must be boolean");
  assert.match(config.host ?? "", /^https:\/\/[^/]+$/u, "telemetry host is not an HTTPS origin");
  if (config.enabled) {
    assert.match(
      config.projectToken ?? "",
      /^phc_[A-Za-z0-9_-]{12,256}$/u,
      "telemetry config does not contain a public PostHog Project token",
    );
  } else {
    assert.equal(config.projectToken, "", "disabled telemetry must not carry a token");
  }
  if (process.env.PAGEROOT_REQUIRE_TELEMETRY_CONFIG === "1") {
    assert.equal(config.enabled, true, "release telemetry configuration is disabled");
  }
  return config;
}

async function assertRuntimeEnvironmentMarker({
  productRoot,
  resourcesPath,
  packageJson,
}) {
  const runtimeResource = packageJson.build?.extraResources?.find(
    (entry) => entry?.to === "runtime-environment.json",
  );
  assert.equal(
    runtimeResource?.from,
    "output/release-metadata/runtime-environment.json",
    "the packaged runtime marker must come from release metadata",
  );
  const sourcePath = path.resolve(productRoot, runtimeResource.from);
  const packagedPath = path.join(resourcesPath, "runtime-environment.json");
  await assertFilesEqual(sourcePath, packagedPath, "runtime-environment.json");
  const marker = parseRuntimeEnvironmentMarker(
    JSON.parse(await readFile(packagedPath, "utf8")),
  );
  const expectedChannel = packageJson.build?.appId?.endsWith(".developer-preview")
    ? "preview"
    : "stable";
  assert.equal(marker.channel, expectedChannel, "packaged runtime channel does not match the app identity");
  return marker;
}

async function assertApplicationUpdateConfig({
  productRoot,
  resourcesPath,
  packageJson,
}) {
  const updateResource = packageJson.build?.extraResources?.find(
    (entry) => entry?.to === APPLICATION_UPDATE_CONFIG_FILE,
  );
  assert.equal(
    updateResource?.from,
    APPLICATION_UPDATE_CONFIG_SOURCE,
    "the packaged application update config must come from release metadata",
  );
  const [sourceConfig, packagedConfig] = await Promise.all([
    readFile(path.resolve(productRoot, APPLICATION_UPDATE_CONFIG_SOURCE), "utf8"),
    readFile(path.join(resourcesPath, APPLICATION_UPDATE_CONFIG_FILE), "utf8"),
  ]);
  parseApplicationUpdateConfig(sourceConfig, packageJson);
  return parseApplicationUpdateConfig(packagedConfig, packageJson);
}

function commandExists(commandPath) {
  return existsSync(commandPath);
}

function runCommand(command, arguments_, label, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    env: options.env,
    maxBuffer: 16 * 1024 * 1024,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

export function assertPackagedAgentFeatureGates(
  packagedFeatureGates,
  sourceFeatureGates = AGENT_FEATURE_GATES,
) {
  assert.deepEqual(
    Object.keys(sourceFeatureGates).sort(),
    ["codexDiscussion"],
    "source Agent feature gates changed shape",
  );
  assert.equal(
    sourceFeatureGates.codexDiscussion,
    false,
    "source Agent feature gates must keep pure Codex Discussion disabled",
  );
  assert.deepEqual(
    packagedFeatureGates,
    sourceFeatureGates,
    "packaged Agent feature gates do not match the source-owned rollback state",
  );
}

export async function assertNoBundledCodexArtifacts(resourcesPath) {
  assert.equal(path.isAbsolute(resourcesPath), true, "Codex resourcesPath must be absolute");
  for (const relativePath of [
    "bridge/agent/providers/codex-provider.mjs",
    "node_modules/@openai/codex",
  ]) {
    assert.equal(
      existsSync(path.join(resourcesPath, relativePath)),
      false,
      `retired bundled Codex artifact must be absent: ${relativePath}`,
    );
  }
  const runtimeRoot = path.join(resourcesPath, "bridge", "agent", "runtimes");
  const runtimeEntries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of runtimeEntries) {
    assert.equal(
      entry.name.startsWith("codex-app-server-"),
      false,
      `retired bundled Codex runtime must be absent: ${entry.name}`,
    );
  }
  const openaiRoot = path.join(resourcesPath, "node_modules", "@openai");
  const openaiEntries = await readdir(openaiRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of openaiEntries) {
    assert.equal(
      entry.name === "codex" || entry.name.startsWith("codex-darwin-"),
      false,
      `retired bundled Codex package must be absent: @openai/${entry.name}`,
    );
  }
}

export async function verifyAppBundle({
  productRoot = DEFAULT_PRODUCT_ROOT,
  appPath,
  packageJson,
  sourcePackageJson = packageJson,
  verifySignature = true,
  signaturePolicy,
  expectedProvenance,
  requirePackagedAgentBridgeSmoke = true,
}) {
  const effectiveSignaturePolicy = signaturePolicy
    ?? (verifySignature ? "developer-id" : "none");
  assert.match(
    effectiveSignaturePolicy,
    /^(?:developer-id|adhoc|none)$/u,
    "signaturePolicy must be developer-id, adhoc or none",
  );
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const asarPath = path.join(resourcesPath, "app.asar");
  await Promise.all([
    access(appPath),
    access(asarPath),
    assertSourceDependencyClosureIsClean(productRoot, sourcePackageJson),
  ]);
  await listFiles(resourcesPath);

  const expectedIdentity = expectedPackagedAppIdentity({
    packageJson,
    environment: {},
  });
  const plistIdentity = await readPackagedPlistIdentity(appPath);
  assert.equal(
    plistIdentity.version,
    expectedIdentity.version,
    "CFBundleShortVersionString is stale",
  );
  assert.equal(
    plistIdentity.bundleVersion,
    expectedIdentity.version,
    "CFBundleVersion is stale",
  );
  assert.equal(
    plistIdentity.bundleId,
    expectedIdentity.bundleId,
    "CFBundleIdentifier is incorrect",
  );

  const expectedAsarFiles = ["package.json", ...REQUIRED_APP_SOURCE_FILES];
  const rendererSourceRoot = path.join(productRoot, "dist-desktop");
  const rendererFiles = await listFiles(rendererSourceRoot);
  expectedAsarFiles.push(...rendererFiles.map((entry) => `dist-desktop/${entry}`));
  expectedAsarFiles.sort();
  const packagedAsarFiles = asarFilePaths(asarPath);
  for (const relativePath of packagedAsarFiles) {
    assertNoRetiredEditorArtifacts(relativePath, "app.asar path list");
  }
  assert.deepEqual(
    packagedAsarFiles,
    expectedAsarFiles,
    "app.asar contains missing, stale, or unexpected runtime files",
  );

  for (const relativePath of REQUIRED_APP_SOURCE_FILES) {
    const source = await readFile(path.join(productRoot, relativePath));
    const packaged = extractFile(asarPath, relativePath);
    assertNoRetiredEditorArtifacts(source, `source ${relativePath}`);
    assertNoRetiredEditorArtifacts(packaged, `app.asar ${relativePath}`);
    assert.equal(
      sha256(packaged),
      sha256(source),
      `${relativePath} in app.asar does not match source`,
    );
  }
  for (const relativePath of rendererFiles) {
    const source = await readFile(path.join(rendererSourceRoot, relativePath));
    const packaged = extractFile(asarPath, `dist-desktop/${relativePath}`);
    if (isRuntimeTextArtifact(relativePath)) {
      assertNoRetiredEditorArtifacts(source, `renderer ${relativePath}`);
      assertNoRetiredEditorArtifacts(packaged, `app.asar renderer ${relativePath}`);
    }
    assert.equal(
      sha256(packaged),
      sha256(source),
      `dist-desktop/${relativePath} in app.asar does not match the latest renderer build`,
    );
  }
  const packagedManifestText = extractFile(asarPath, "package.json").toString("utf8");
  assertNoRetiredEditorArtifacts(packagedManifestText, "app.asar package.json");
  const packagedManifest = JSON.parse(packagedManifestText);
  assert.equal(packagedManifest.name, packageJson.name, "packaged package name is incorrect");
  assert.equal(packagedManifest.version, packageJson.version, "packaged package version is stale");
  assert.equal(packagedManifest.main, packageJson.main, "packaged main entry is incorrect");

  const bridgePackagedRoot = path.join(resourcesPath, "bridge");
  const packagedBridgeFiles = await listFiles(bridgePackagedRoot);
  assert.deepEqual(
    [...packagedBridgeFiles].sort((left, right) => left.localeCompare(right)),
    [...REQUIRED_BRIDGE_FILES].sort((left, right) => left.localeCompare(right)),
    "packaged Bridge resources are incomplete or contain stale files",
  );
  for (const fileName of REQUIRED_BRIDGE_FILES) {
    const sourcePath = fileName === "product-contract.mjs"
      ? path.join(productRoot, "desktop", fileName)
      : path.join(productRoot, "bridge", fileName);
    await assertFilesEqual(
      sourcePath,
      path.join(bridgePackagedRoot, fileName),
      `bridge/${fileName}`,
    );
  }
  await assertNoBundledCodexArtifacts(resourcesPath);
  const sharedPackagedRoot = path.join(resourcesPath, "shared");
  const packagedSharedFiles = await listFiles(sharedPackagedRoot);
  assert.deepEqual(
    packagedSharedFiles,
    [...REQUIRED_SHARED_FILES].sort(),
    "packaged shared resources are incomplete or contain stale files",
  );
  for (const fileName of REQUIRED_SHARED_FILES) {
    await assertFilesEqual(
      path.join(productRoot, "shared", fileName),
      path.join(sharedPackagedRoot, fileName),
      `shared/${fileName}`,
    );
  }
  const gatePath = path.join(sharedPackagedRoot, "agent-feature-gates.mjs");
  const gateBytes = await readFile(gatePath);
  const gateModule = await import(
    `${pathToFileURL(gatePath).href}?verify=${sha256(gateBytes)}`
  );
  assertPackagedAgentFeatureGates(gateModule.AGENT_FEATURE_GATES);
  const packagedModuleDirectories = await listPackagedModuleNames(
    path.join(resourcesPath, "node_modules"),
  );
  const requiredModules = requiredPackagedModules();
  assert.deepEqual(
    packagedModuleDirectories,
    requiredModules,
    "packaged runtime modules must exactly match the reviewed allowlist",
  );
  for (const moduleName of requiredModules) {
    await assertDirectoryMatches({
      sourceRoot: path.join(productRoot, "node_modules", moduleName),
      packagedRoot: path.join(resourcesPath, "node_modules", moduleName),
      label: `node_modules/${moduleName}`,
      compareFile: assertFilesEqual,
    });
  }

  const helperExecutable = path.join(
    appPath,
    "Contents",
    "Frameworks",
    `${packageJson.build.productName} Helper.app`,
    "Contents",
    "MacOS",
    `${packageJson.build.productName} Helper`,
  );
  if (await existsSync(helperExecutable)) {
    const helperInformation = await lstat(helperExecutable);
    assert.equal(
      helperInformation.isFile() && !helperInformation.isSymbolicLink(),
      true,
      `packaged Electron Helper must be a regular executable: ${helperExecutable}`,
    );
    await access(helperExecutable, fsConstants.X_OK);
    const lifecycleCoreUrl = pathToFileURL(
      path.join(resourcesPath, "bridge", "lifecycle-core.mjs"),
    ).href;
    const candidateAssessmentUrl = pathToFileURL(
      path.join(resourcesPath, "bridge", "candidate-assessment.mjs"),
    ).href;
    const candidateAssessmentDecoderUrl = pathToFileURL(
      path.join(resourcesPath, "bridge", "candidate-assessment-decoder.mjs"),
    ).href;
    const draftServiceUrl = pathToFileURL(
      path.join(resourcesPath, "bridge", "draft-service.mjs"),
    ).href;
    const draftCommandDecoderUrl = pathToFileURL(
      path.join(resourcesPath, "bridge", "draft-command-decoder.mjs"),
    ).href;
    runCommand(
      helperExecutable,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(lifecycleCoreUrl)}); await import(${JSON.stringify(candidateAssessmentUrl)}); await import(${JSON.stringify(candidateAssessmentDecoderUrl)}); await import(${JSON.stringify(draftServiceUrl)}); await import(${JSON.stringify(draftCommandDecoderUrl)})`,
      ],
      "packaged Bridge dependency smoke",
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    );
    const packagedAgentBridgeRunner = path.join(
      productRoot,
      "tests",
      "fixtures",
      "packaged-agent-bridge-runner.mjs",
    );
    await access(packagedAgentBridgeRunner);
    runCommand(
      helperExecutable,
      [packagedAgentBridgeRunner, resourcesPath, productRoot, helperExecutable],
      "packaged Qoder ACP closed-loop smoke",
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
        },
        timeoutMs: 60_000,
      },
    );
  } else if (requirePackagedAgentBridgeSmoke) {
    assert.fail(`packaged Electron Helper is missing: ${helperExecutable}`);
  }

  const schemas = await assertSchemaBundleMatches({
    productRoot,
    resourcesPath,
    packageJson,
  });
  assert.ok(schemas.length > 0, "no schemas were packaged");
  const provenance = assertBuildInfo(
    JSON.parse(await readFile(path.join(resourcesPath, "build-info.json"), "utf8")),
    {
      schemaVersion: 1,
      name: packageJson.name,
      version: packageJson.version,
      ...(expectedProvenance || {}),
    },
  );
  const telemetry = await assertUsageTelemetryConfig({
    productRoot,
    resourcesPath,
    packageJson,
  });
  const runtimeEnvironment = await assertRuntimeEnvironmentMarker({
    productRoot,
    resourcesPath,
    packageJson,
  });
  const applicationUpdate = await assertApplicationUpdateConfig({
    productRoot,
    resourcesPath,
    packageJson,
  });
  for (const fileName of REQUIRED_LEGAL_RESOURCES) {
    await assertFilesEqual(
      path.join(productRoot, fileName),
      path.join(resourcesPath, fileName),
      fileName,
    );
  }
  for (const { packageName, version } of [
    { packageName: "echarts-5-4-3", version: "5.4.3" },
    { packageName: "echarts", version: "5.6.0" },
  ]) {
    for (const fileName of ["echarts.min.js", "LICENSE", "NOTICE"]) {
      await assertFilesEqual(
        path.join(
          productRoot,
          "node_modules",
          packageName,
          fileName === "echarts.min.js" ? "dist/echarts.min.js" : fileName,
        ),
        path.join(resourcesPath, "edit-runtime-libraries", "echarts", version, fileName),
        `bundled ECharts ${version} ${fileName}`,
      );
    }
  }

  if (
    effectiveSignaturePolicy !== "none"
    && process.platform === "darwin"
    && commandExists("/usr/bin/codesign")
  ) {
    runCommand(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      "codesign verification",
    );
    const signatureDetails = runCommand(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", appPath],
      "Developer ID signature inspection",
    );
    if (effectiveSignaturePolicy === "developer-id") {
      assert.match(
        signatureDetails,
        /Authority=Developer ID Application:/u,
        "packaged app is not signed with a Developer ID Application certificate",
      );
      assert.match(
        signatureDetails,
        new RegExp(`TeamIdentifier=${EXPECTED_MAC_TEAM_ID}`),
        "packaged app was signed by an unexpected Apple team",
      );
      assert.doesNotMatch(
        signatureDetails,
        /Signature=adhoc/u,
        "packaged app must not use an ad-hoc signature",
      );
    } else {
      assert.match(
        signatureDetails,
        /Signature=adhoc/u,
        "the app must use the explicitly requested ad-hoc signature",
      );
    }
    if (
      effectiveSignaturePolicy === "developer-id"
      && process.env.PAGEROOT_REQUIRE_NOTARIZATION === "1"
    ) {
      runCommand(
        "/usr/bin/xcrun",
        ["stapler", "validate", appPath],
        "notarization ticket validation",
      );
      const assessment = runCommand(
        "/usr/sbin/spctl",
        ["--assess", "--type", "execute", "--verbose=4", appPath],
        "Gatekeeper assessment",
      );
      assert.match(
        assessment,
        /source=Notarized Developer ID/u,
        "Gatekeeper did not identify a notarized Developer ID build",
      );
    }
  }

  return {
    appPath,
    version: plistIdentity.version,
    asarFileCount: expectedAsarFiles.length,
    schemaFileCount: schemas.length,
    legalResourceCount: REQUIRED_LEGAL_RESOURCES.length,
    applicationUpdate,
    provenance,
    runtimeEnvironment,
    telemetry,
  };
}

async function verifyDmg({
  dmgPath,
  productName,
  productRoot,
  packageJson,
  sourcePackageJson = packageJson,
  expectedProvenance,
  signaturePolicy = "developer-id",
  arch = process.arch,
}) {
  const dmgInfo = await stat(dmgPath);
  assert.ok(dmgInfo.isFile(), `DMG is not a file: ${dmgPath}`);
  assert.ok(dmgInfo.size > 1_000_000, `DMG is unexpectedly small: ${dmgPath}`);

  if (process.platform !== "darwin" || !commandExists("/usr/bin/hdiutil")) {
    return { mounted: false, reason: "hdiutil is unavailable on this platform" };
  }

  runCommand("/usr/bin/hdiutil", ["verify", dmgPath], "DMG verification");
  if (
    process.env.PAGEROOT_REQUIRE_NOTARIZATION === "1"
    && commandExists("/usr/bin/xcrun")
  ) {
    runCommand(
      "/usr/bin/xcrun",
      ["stapler", "validate", dmgPath],
      "DMG notarization ticket validation",
    );
  }
  const mountPoint = await mkdtemp(path.join(os.tmpdir(), "html-ai-workbench-dmg-"));
  let mounted = false;
  try {
    runCommand(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPoint, dmgPath],
      "DMG mount",
    );
    mounted = true;
    const mountedAppPath = path.join(mountPoint, `${productName}.app`);
    await verifyAppBundle({
      productRoot,
      appPath: mountedAppPath,
      packageJson,
      sourcePackageJson,
      signaturePolicy,
      expectedProvenance,
      arch,
    });
    return { mounted: true, mountedAppPath };
  } finally {
    if (mounted) {
      runCommand("/usr/bin/hdiutil", ["detach", mountPoint], "DMG detach");
    }
    await rm(mountPoint, { recursive: true, force: true });
  }
}

async function verifyUpdateAssets({
  dmgPath,
  zipPath,
  blockmapPath,
  updateInfoPath,
  productName,
  productRoot,
  packageJson,
  expectedProvenance,
  arch = process.arch,
}) {
  const [zipInfo, zipBytes, blockmap, updateInfo] = await Promise.all([
    stat(zipPath),
    readFile(zipPath),
    readFile(blockmapPath),
    readFile(updateInfoPath, "utf8"),
  ]);
  assert.ok(zipInfo.isFile(), `update ZIP is not a file: ${zipPath}`);
  assert.ok(zipInfo.size > 1_000_000, `update ZIP is unexpectedly small: ${zipPath}`);
  assert.ok(blockmap.byteLength > 100, `update blockmap is unexpectedly small: ${blockmapPath}`);
  const blockmapValue = JSON.parse(gunzipSync(blockmap).toString("utf8"));
  assert.ok(
    Array.isArray(blockmapValue?.files) && blockmapValue.files.length > 0,
    "update blockmap does not contain any files",
  );
  assert.match(
    updateInfo,
    new RegExp(`^version:\\s*${packageJson.version.replaceAll(".", "\\.")}\\s*$`, "mu"),
    "latest-mac.yml version does not match package.json",
  );
  const zipName = path.basename(zipPath);
  const escapedZipName = zipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const zipSha512 = createHash("sha512").update(zipBytes).digest("base64");
  const escapedZipSha512 = zipSha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    updateInfo,
    new RegExp(
      `^\\s{2}- url:\\s*${escapedZipName}\\s*\\n`
        + `\\s{4}sha512:\\s*${escapedZipSha512}\\s*\\n`
        + `\\s{4}size:\\s*${zipInfo.size}\\s*$`,
      "mu",
    ),
    "latest-mac.yml does not describe the exact frozen update ZIP",
  );
  assert.match(
    updateInfo,
    new RegExp(`^path:\\s*${escapedZipName}\\s*$`, "mu"),
    "latest-mac.yml does not select the update ZIP as its compatibility path",
  );
  assert.match(
    updateInfo,
    new RegExp(`^sha512:\\s*${escapedZipSha512}\\s*$`, "mu"),
    "latest-mac.yml compatibility digest does not match the update ZIP",
  );
  const dmgName = path.basename(dmgPath);
  const escapedDmgName = dmgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s{2}- url:\\s*${escapedDmgName}\\s*$`, "mu").test(updateInfo)) {
    const [dmgInfo, dmgBytes] = await Promise.all([
      stat(dmgPath),
      readFile(dmgPath),
    ]);
    const dmgSha512 = createHash("sha512").update(dmgBytes).digest("base64");
    const escapedDmgSha512 = dmgSha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      updateInfo,
      new RegExp(
        `^\\s{2}- url:\\s*${escapedDmgName}\\s*\\n`
          + `\\s{4}sha512:\\s*${escapedDmgSha512}\\s*\\n`
          + `\\s{4}size:\\s*${dmgInfo.size}\\s*$`,
        "mu",
      ),
      "latest-mac.yml does not describe the exact final DMG bytes",
    );
  }

  if (process.platform !== "darwin" || !commandExists("/usr/bin/ditto")) {
    return { extracted: false, reason: "ditto is unavailable" };
  }
  const extractionRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-update-zip-"));
  try {
    runCommand(
      "/usr/bin/ditto",
      ["-x", "-k", zipPath, extractionRoot],
      "update ZIP extraction",
    );
    const app = await verifyAppBundle({
      productRoot,
      appPath: path.join(extractionRoot, `${productName}.app`),
      packageJson,
      verifySignature: true,
      expectedProvenance,
      arch,
    });
    return { extracted: true, app };
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

export function appBundleSignaturePolicyForProfile(profile) {
  assert.match(
    profile,
    /^(?:candidate-app|candidate-app-signed|release-dry-run)$/u,
    "app-only profile must be candidate-app, candidate-app-signed or release-dry-run",
  );
  if (profile === "candidate-app-signed") return "developer-id";
  if (profile === "release-dry-run") return "none";
  return "adhoc";
}

export async function verifyPackagedArtifact({
  productRoot = DEFAULT_PRODUCT_ROOT,
  arch = "arm64",
  appPath,
  profile = "release",
  releaseDirectory,
} = {}) {
  assert.match(
    profile,
    /^(?:release|developer|candidate-app|candidate-app-signed|release-dry-run)$/u,
    "profile must be release, developer, candidate-app, candidate-app-signed or release-dry-run",
  );
  const sourcePackageJson = JSON.parse(
    await readFile(path.join(productRoot, "package.json"), "utf8"),
  );
  const isDeveloperPreview = profile === "developer";
  const isCandidateApp = profile === "candidate-app" || profile === "candidate-app-signed";
  const isReleaseDryRun = profile === "release-dry-run";
  const developerPreviewIdentity = isDeveloperPreview
    ? resolveDeveloperPreviewIdentity({ productRoot, packageJson: sourcePackageJson })
    : null;
  const packageJson = isDeveloperPreview
    ? developerPreviewPackageJson(sourcePackageJson, developerPreviewIdentity)
    : sourcePackageJson;
  const expectedLayout = expectedArtifactLayout({
    productRoot,
    packageJson,
    arch,
    releaseDirectory: releaseDirectory
      ?? (isDeveloperPreview
        ? developerPreviewReleaseDirectory(productRoot)
        : isCandidateApp
          ? candidateAppReleaseDirectory(productRoot)
          : isReleaseDryRun
            ? releaseDryRunAppReleaseDirectory(productRoot)
            : undefined),
    artifactName: isDeveloperPreview
      ? DEVELOPER_PREVIEW_ARTIFACT_PATTERN
      : undefined,
  });
  if (appPath !== undefined) {
    assert.equal(path.isAbsolute(appPath), true, "appPath must be absolute");
    assert.equal(path.extname(appPath), ".app", "appPath must name an app");
  }
  const layout = {
    ...expectedLayout,
    appPath: appPath ?? expectedLayout.appPath,
  };
  const provenance = await expectedBuildInfo({
    productRoot,
    architecture: arch,
    requireClean: true,
    version: packageJson.version,
  });
  if (isDeveloperPreview) {
    const [app, dmg] = await Promise.all([
      verifyAppBundle({
        productRoot,
        appPath: layout.appPath,
        packageJson,
        sourcePackageJson,
        signaturePolicy: "developer-id",
        expectedProvenance: provenance,
        arch,
      }),
      verifyDmg({
        dmgPath: layout.dmgPath,
        productName: layout.productName,
        productRoot,
        packageJson,
        sourcePackageJson,
        expectedProvenance: provenance,
        signaturePolicy: "developer-id",
        arch,
      }),
    ]);
    return {
      ...layout,
      profile,
      app,
      dmg,
      update: null,
    };
  }
  if (isCandidateApp || isReleaseDryRun) {
    const app = await verifyAppBundle({
      productRoot,
      appPath: layout.appPath,
      packageJson,
      signaturePolicy: appBundleSignaturePolicyForProfile(profile),
      expectedProvenance: provenance,
      arch,
    });
    return {
      ...layout,
      profile,
      app,
      dmg: null,
      update: null,
    };
  }
  const [app, dmg, update] = await Promise.all([
    verifyAppBundle({
      productRoot,
      appPath: layout.appPath,
      packageJson,
      verifySignature: true,
      expectedProvenance: provenance,
      arch,
    }),
    verifyDmg({
      dmgPath: layout.dmgPath,
      productName: layout.productName,
      productRoot,
      packageJson,
      expectedProvenance: provenance,
      arch,
    }),
    verifyUpdateAssets({
      dmgPath: layout.dmgPath,
      zipPath: layout.zipPath,
      blockmapPath: layout.blockmapPath,
      updateInfoPath: layout.updateInfoPath,
      productName: layout.productName,
      productRoot,
      packageJson,
      expectedProvenance: provenance,
      arch,
    }),
  ]);
  return { ...layout, profile, app, dmg, update };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await verifyPackagedArtifact({
    arch: options.arch,
    appPath: options.appPath,
    profile: options.profile,
    releaseDirectory: options.releaseDirectory,
  });
  if (result.dmg) console.log(`Packaged artifact verified: ${result.dmgPath}`);
  else if (result.profile === "release-dry-run") {
    console.log(`Release dry-run app verified: ${result.appPath}`);
  } else console.log(`Candidate app verified: ${result.appPath}`);
  if (result.update) console.log(`Updater ZIP verified: ${result.zipPath}`);
  else if (result.profile === "developer") {
    console.log("Developer preview skips updater ZIP and release metadata verification.");
  }
  console.log(
    `App ${result.version}: ${result.app.asarFileCount} app.asar files, ${result.app.schemaFileCount} schemas`,
  );
  if (result.dmg && !result.dmg.mounted) {
    console.log(`DMG mount skipped: ${result.dmg.reason}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
