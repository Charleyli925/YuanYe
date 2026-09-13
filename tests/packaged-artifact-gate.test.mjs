import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPackage } from "@electron/asar";

import {
  notarizeAndStapleDmg,
  refreshDmgUpdateMetadata,
} from "../scripts/build-package.mjs";
import {
  appBundleSignaturePolicyForProfile,
  assertNoRetiredEditorArtifacts,
  assertNoBundledCodexArtifacts,
  assertPackagedAgentFeatureGates,
  assertSignedMachOContentEqual,
  expectedArtifactLayout,
  verifyAppBundle,
} from "../scripts/verify-packaged-artifact.mjs";
import { createSyntheticAppBundle } from "./helpers/release-evidence-fixtures.mjs";

const productRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);

test("a packaged Mach-O may be re-signed but not replaced", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("Mach-O signing is macOS-only");
    return;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-macho-contract-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "source-true");
  const packagedPath = path.join(temporaryRoot, "packaged-true");
  const entitlementsPath = path.join(productRoot, "desktop/resources/entitlements.mac.plist");
  await Promise.all([
    copyFile("/usr/bin/true", sourcePath),
    copyFile("/usr/bin/true", packagedPath),
  ]);
  await execFileAsync("codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    "app.pageroot.synthetic-packaged-runtime",
    "--entitlements",
    entitlementsPath,
    packagedPath,
  ]);
  await assertSignedMachOContentEqual({
    sourcePath,
    packagedPath,
    entitlementsPath,
    label: "synthetic native runtime",
  });

  const replacementPath = path.join(temporaryRoot, "replacement-runtime");
  await copyFile("/bin/echo", replacementPath);
  await execFileAsync("codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    "app.pageroot.synthetic-packaged-runtime",
    "--entitlements",
    entitlementsPath,
    replacementPath,
  ]);
  await assert.rejects(
    assertSignedMachOContentEqual({
      sourcePath,
      packagedPath: replacementPath,
      entitlementsPath,
      label: "replaced native runtime",
    }),
    /executable content does not match source/u,
  );
});

async function verifySyntheticAppBundle(fixture, { allowUnsigned = true } = {}) {
  return verifyAppBundle({
    productRoot: fixture.productRoot,
    appPath: fixture.appPath,
    packageJson: fixture.packageJson,
    verifySignature: !allowUnsigned,
    requirePackagedAgentBridgeSmoke: false,
  });
}

test("release commands use one automated artifact lane with full tests and packaged runtime verification", async () => {
  const [packageText, verifier, impactMapText, gateRunner, packageBuilder] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "scripts/verify-packaged-artifact.mjs"), "utf8"),
    readFile(path.join(productRoot, "tests/test-impact-map.json"), "utf8"),
    readFile(path.join(productRoot, "scripts/test-gate.mjs"), "utf8"),
    readFile(path.join(productRoot, "scripts/build-package.mjs"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const impactMap = JSON.parse(impactMapText);
  assert.equal(
    packageJson.scripts.typecheck,
    "npm run architecture:check && tsc --noEmit",
  );
  assert.equal(packageJson.scripts.verify, "npm run gate:task");
  assert.equal(packageJson.scripts["release:mac"], "npm run gate:artifact:auto");
  assert.equal(packageJson.scripts["release:mac:x64"], undefined);
  assert.equal(packageJson.scripts["gate:artifact-only:auto"], undefined);
  assert.deepEqual(impactMap.lanes.artifact.fullSuites, [
    "typecheck",
    "lint",
    "dependency-audit",
    "node-full",
    "browser-full",
    "electron-full",
    "ai-closed-loop",
    "dom-editing-compatibility",
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
  assert.equal(impactMap.lanes["artifact-only"], undefined);
  assert.match(gateRunner, /output\/test-runs/);
  assert.match(gateRunner, /changeSetSha256/);
  assert.match(packageJson.scripts["audit:dependencies"], /check-dependency-audit\.mjs/);
  assert.match(gateRunner, /require a clean Git worktree/);
  assert.match(gateRunner, /Clean source changed while the gate was running/);
  assert.match(gateRunner, /requires a trusted source-gate decision from CI/);
  assert.match(gateRunner, /PAGEROOT_SOURCE_GATE_TREE/);
  assert.match(packageJson.scripts["desktop:pack"], /build-package\.mjs --arch arm64/);
  assert.match(
    packageBuilder,
    /--\$\{architecture\}/u,
    "electron-builder must never publish before PageRoot verifies the complete release asset set",
  );
  assert.ok(packageJson.build.extraResources.some((entry) => entry.to === "build-info.json"));
  assert.ok(packageJson.build.extraResources.some((entry) => entry.to === "app-update.yml"));
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.to === "usage-telemetry-config.json",
    ),
  );
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.to === "runtime-environment.json",
    ),
  );
  assert.match(packageJson.scripts["verify:packaged"], /verify-packaged-artifact\.mjs/);
  assert.match(verifier, /codesign/);
  assert.match(verifier, /hdiutil/);
  assert.match(verifier, /app\.asar/);
  assert.match(verifier, /finalize-attempt\.mjs/);
  assert.match(verifier, /lifecycle-core\.mjs/);
  assert.match(verifier, /project-file-repository\.mjs/);
  assert.match(verifier, /project-file-finalizer\.mjs/);
  assert.match(verifier, /html-source-parser\.mjs/);
  assert.doesNotMatch(verifier, /scope-validator\.mjs/);
  assert.match(verifier, /packaged Bridge dependency smoke/);
  assert.match(verifier, /packaged Qoder ACP closed-loop smoke/);
  const packagedAgentRunner = await readFile(
    new URL("./fixtures/packaged-agent-bridge-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.match(packagedAgentRunner, /configuration: preflight\.body\.configuration/u);
  assert.match(
    packagedAgentRunner,
    /configurationDigest: preflight\.body\.configuration\.configurationDigest/u,
  );

  const layout = expectedArtifactLayout({ productRoot, packageJson, arch: "arm64" });
  assert.match(layout.appPath, /release\/mac-arm64\/PageRoot\.app$/);
  assert.equal(
    path.basename(layout.dmgPath),
    "PageRoot-" + packageJson.version + "-arm64.dmg",
  );
  assert.equal(
    path.basename(layout.zipPath),
    "PageRoot-" + packageJson.version + "-arm64.zip",
  );
  assert.equal(
    path.basename(layout.blockmapPath),
    "PageRoot-" + packageJson.version + "-arm64.zip.blockmap",
  );
  assert.equal(path.basename(layout.updateInfoPath), "latest-mac.yml");
});

test("the packaged verifier rejects retired Codex App Server resources", async (t) => {
  const resourcesPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-codex-package-"));
  t.after(() => rm(resourcesPath, { recursive: true, force: true }));
  await mkdir(path.join(resourcesPath, "bridge/agent/providers"), { recursive: true });
  await mkdir(path.join(resourcesPath, "bridge/agent/runtimes"), { recursive: true });
  await mkdir(path.join(resourcesPath, "node_modules/@openai/codex"), { recursive: true });
  await writeFile(
    path.join(resourcesPath, "bridge/agent/providers/codex-provider.mjs"),
    "retired\n",
  );
  await writeFile(
    path.join(resourcesPath, "bridge/agent/runtimes/codex-app-server-runtime.mjs"),
    "retired\n",
  );
  await assert.rejects(
    assertNoBundledCodexArtifacts(resourcesPath),
    /retired bundled Codex artifact must be absent/u,
  );
  await rm(path.join(resourcesPath, "bridge/agent/providers/codex-provider.mjs"));
  await rm(path.join(resourcesPath, "bridge/agent/runtimes/codex-app-server-runtime.mjs"));
  await rm(path.join(resourcesPath, "node_modules/@openai/codex"), { recursive: true, force: true });
  await assert.doesNotReject(assertNoBundledCodexArtifacts(resourcesPath));
});

test("the packaged verifier accepts only the source-owned pure-discussion gate", () => {
  const source = Object.freeze({ codexDiscussion: false });
  assert.doesNotThrow(() => assertPackagedAgentFeatureGates({ ...source }, source));
  assert.throws(
    () => assertPackagedAgentFeatureGates(
      { codexDiscussion: true },
      source,
    ),
    /do not match the source-owned rollback state/u,
  );
});

test("app-only profiles keep dry-run unsigned without weakening Candidate signature gates", () => {
  assert.equal(appBundleSignaturePolicyForProfile("release-dry-run"), "none");
  assert.equal(appBundleSignaturePolicyForProfile("candidate-app"), "adhoc");
  assert.equal(
    appBundleSignaturePolicyForProfile("candidate-app-signed"),
    "developer-id",
  );
});

test("release packaging notarizes, staples and validates the final DMG", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-dmg-notarize-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const dmgPath = path.join(temporaryRoot, "PageRoot-0.9.1-arm64.dmg");
  await writeFile(dmgPath, "final dmg bytes");
  const environment = {
    PAGEROOT_REQUIRE_NOTARIZATION: "1",
    APPLE_ID: "release@example.invalid",
    APPLE_APP_SPECIFIC_PASSWORD: "fixture-password",
    APPLE_TEAM_ID: "TEAM123456",
  };
  const calls = [];
  await notarizeAndStapleDmg({
    dmgPath,
    environment,
    commandRunner: async (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
    },
  });
  assert.deepEqual(
    calls.map(({ command, arguments_ }) => [command, arguments_]),
    [
      [
        "/usr/bin/xcrun",
        [
          "notarytool",
          "submit",
          dmgPath,
          "--apple-id",
          environment.APPLE_ID,
          "--password",
          environment.APPLE_APP_SPECIFIC_PASSWORD,
          "--team-id",
          environment.APPLE_TEAM_ID,
          "--wait",
        ],
      ],
      ["/usr/bin/xcrun", ["stapler", "staple", dmgPath]],
      ["/usr/bin/xcrun", ["stapler", "validate", dmgPath]],
    ],
  );
  assert.ok(calls.every(({ options }) => options.environment === environment));

  await assert.rejects(
    notarizeAndStapleDmg({
      dmgPath,
      environment: { PAGEROOT_REQUIRE_NOTARIZATION: "1" },
      commandRunner: async () => assert.fail("must fail before invoking xcrun"),
    }),
    /DMG notarization credentials are missing/u,
  );
  assert.deepEqual(
    await notarizeAndStapleDmg({
      dmgPath,
      environment: {},
      commandRunner: async () => assert.fail("local unsigned packaging must skip this stage"),
    }),
    { skipped: true },
  );
});

test("DMG stapling refreshes only its final latest-mac metadata entry", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-dmg-metadata-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const dmgPath = path.join(temporaryRoot, "PageRoot-0.9.1-arm64.dmg");
  await writeFile(dmgPath, "stapled-final-dmg");
  const updateInfoPath = path.join(temporaryRoot, "latest-mac.yml");
  await writeFile(
    updateInfoPath,
    [
      "version: 0.9.1",
      "files:",
      "  - url: PageRoot-0.9.1-arm64.zip",
      "    sha512: exact-zip-digest",
      "    size: 1234",
      "  - url: PageRoot-0.9.1-arm64.dmg",
      "    sha512: stale-dmg-digest",
      "    size: 42",
      "path: PageRoot-0.9.1-arm64.zip",
      "sha512: exact-zip-digest",
      "",
    ].join("\n"),
  );
  const result = await refreshDmgUpdateMetadata({ dmgPath, updateInfoPath });
  const updated = await readFile(updateInfoPath, "utf8");
  assert.equal(result.updated, true);
  assert.match(
    updated,
    new RegExp("    sha512: " + result.sha512 + "\\n    size: " + result.size + "\\n", "u"),
  );
  assert.match(updated, /PageRoot-0\.9\.1-arm64\.zip\n    sha512: exact-zip-digest\n    size: 1234/u);
  assert.doesNotMatch(updated, /stale-dmg-digest/u);
});

test("retired editor guard rejects dependencies, bundled code, and legacy editing surfaces", () => {
  for (const contents of [
    "const nativeEditing = true; data-pageroot-runtime-node",
    "replace-editable-island",
    "planEditableIslandPatch()",
    "plainTextFlow",
    "scope.lexical.indexOf(name)",
    "const scope = { lexical: [] }",
    "Acorn tracks lexical declarations while parsing modules",
  ]) {
    assert.doesNotThrow(() => assertNoRetiredEditorArtifacts(
      contents,
      "clean native runtime",
    ));
  }
  for (const [label, contents] of [
    ["source package.json", '{"dependencies":{"lexical":"0.48.0"}}'],
    ["source package-lock.json", '{"packages":{"node_modules/@lexical/history":{}}}'],
    ["source package-lock.json", '{"packages":{"node_modules/lexical":{}}}'],
    ["source package alias", '{"dependencies":{"legacy-editor":"npm:lexical@0.48.0"}}'],
    ["source module", 'import { createEditor } from "lexical"'],
    ["source commonjs module", 'const editor = require("lexical")'],
    ["source dynamic import", 'const editor = await import("lexical")'],
    ["renderer bundle", "Minified Lexical error"],
    ["renderer bundle", "new TextFlowSession()"],
    ["renderer bundle", "startTextFlowEditing()"],
    ["source package.json", '{"dependencies":{"text-flow":"1.0.0"}}'],
    ["source package-lock.json", '{"packages":{"node_modules/textflow":{}}}'],
    ["source package alias", '{"dependencies":{"legacy-editor":"npm:text-flow@1.0.0"}}'],
    ["app.asar renderer", "<pageroot-text-editor>"],
    ["app.asar renderer", "data-html-canvas-text-flow"],
  ]) {
    assert.throws(
      () => assertNoRetiredEditorArtifacts(contents, label),
      /still contains retired/u,
      label,
    );
  }
});

test("source package manifest and lock contain no retired editor dependency closure", async () => {
  const [manifest, lock] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "package-lock.json"), "utf8"),
  ]);
  assertNoRetiredEditorArtifacts(manifest, "source package.json");
  assertNoRetiredEditorArtifacts(lock, "source package-lock.json");
});

test("the app-bundle gate validates app.asar, Bridge scripts, schemas and plist version", async (t) => {
  const fixture = await createSyntheticAppBundle(t, {
    profile: "release",
    version: "0.7.0",
    buildInfo: { builtAt: "2026-07-23T00:00:00.000Z" },
  });
  const result = await verifySyntheticAppBundle(fixture);
  assert.equal(result.version, "0.7.0");
  assert.equal(result.asarFileCount, 48);
  assert.equal(result.schemaFileCount, 5);
  assert.equal(result.legalResourceCount, 5);
  assert.deepEqual(result.applicationUpdate, {
    owner: "Charleyli925",
    repo: "PageRoot",
    provider: "github",
    releaseType: "release",
    updaterCacheDirName: "pageroot-updater",
  });
  assert.equal(result.telemetry.enabled, true);
  assert.equal(result.provenance.commitSha, "a".repeat(40));
});

test("real app verification requires the Electron Helper ACP smoke even when unsigned", async (t) => {
  const fixture = await createSyntheticAppBundle(t, {
    profile: "dry-run",
    version: "0.7.0",
    buildInfo: { builtAt: "2026-07-23T00:00:00.000Z" },
  });
  await assert.rejects(
    verifyAppBundle({
      productRoot: fixture.productRoot,
      appPath: fixture.appPath,
      packageJson: fixture.packageJson,
      verifySignature: false,
    }),
    /packaged Electron Helper is missing/u,
  );
});

test("the app-bundle gate reports each mutated closure boundary", async (t) => {
  const cases = [
    {
      name: "stale Bridge source",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => writeFile(
        path.join(resourcesPath, "bridge/lifecycle-core.mjs"),
        "stale packaged lifecycle core\n",
      ),
      expected: /bridge\/lifecycle-core\.mjs does not match source/u,
    },
    {
      name: "unreviewed scoped runtime package",
      profile: "candidate",
      allowUnsigned: true,
      mutate: async ({ resourcesPath }) => {
        const packageRoot = path.join(resourcesPath, "node_modules/@agentclientprotocol/extra");
        await mkdir(packageRoot, { recursive: true });
        await writeFile(path.join(packageRoot, "package.json"), "{}\n");
      },
      expected: /packaged runtime modules must exactly match the reviewed allowlist/u,
    },
    {
      name: "nested runtime package symlink",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => symlink(
        "/etc/passwd",
        path.join(resourcesPath, "node_modules/parse5/dist/extra-secret.js"),
      ),
      expected: /unsupported symlink:.*extra-secret\.js/u,
    },
    {
      name: "runtime resource FIFO",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => execFileAsync(
        "/usr/bin/mkfifo",
        [path.join(resourcesPath, "rogue-runtime-pipe")],
      ),
      expected: /unsupported FIFO:.*rogue-runtime-pipe/u,
    },
    {
      name: "app asar link entry",
      profile: "candidate",
      allowUnsigned: true,
      mutate: async ({ resourcesPath, temporaryRoot }) => {
        const asarSource = path.join(temporaryRoot, "asar-source");
        await symlink(
          "desktop/main.mjs",
          path.join(asarSource, "rogue-link.mjs"),
        );
        const asarPath = path.join(resourcesPath, "app.asar");
        await rm(asarPath);
        await createPackage(asarSource, asarPath);
      },
      expected: /app\.asar contains unsupported link entry: rogue-link\.mjs/u,
    },
    {
      name: "build-info version drift",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath, buildInfo }) => writeFile(
        path.join(resourcesPath, "build-info.json"),
        JSON.stringify({ ...buildInfo, version: "9.9.9" }) + "\n",
      ),
      expected: /build provenance mismatch for version/u,
    },
    {
      name: "ECharts 5.4.3 packaged byte drift",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => writeFile(
        path.join(
          resourcesPath,
          "edit-runtime-libraries/echarts/5.4.3/echarts.min.js",
        ),
        "stale ECharts 5.4.3 bytes\n",
      ),
      expected: /bundled ECharts 5\.4\.3 echarts\.min\.js does not match source/u,
    },
    {
      name: "missing fresh renderer oracle",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ productRoot: fixtureProductRoot }) => rm(
        path.join(fixtureProductRoot, "dist-desktop"),
        { recursive: true, force: true },
      ),
      expected: /dist-desktop/u,
    },
    {
      name: "missing telemetry metadata",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ productRoot: fixtureProductRoot }) => rm(
        path.join(
          fixtureProductRoot,
          "output/release-metadata/usage-telemetry-config.json",
        ),
      ),
      expected: /usage-telemetry-config\.json/u,
    },
    {
      name: "missing packaged application update config",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => rm(
        path.join(resourcesPath, "app-update.yml"),
      ),
      expected: /app-update\.yml/u,
    },
    {
      name: "application update channel drift",
      profile: "candidate",
      allowUnsigned: true,
      mutate: ({ resourcesPath }) => writeFile(
        path.join(resourcesPath, "app-update.yml"),
        [
          "owner: attacker",
          "repo: PageRoot",
          "provider: github",
          "releaseType: release",
          "updaterCacheDirName: pageroot-updater",
          "",
        ].join("\n"),
      ),
      expected: /does not match the stable GitHub channel/u,
    },
  ];
  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (t) => {
      const fixture = await createSyntheticAppBundle(t, {
        profile: fixtureCase.profile,
        version: "0.7.0",
        buildInfo: { builtAt: "2026-07-23T00:00:00.000Z" },
      });
      await fixtureCase.mutate(fixture);
      await assert.rejects(
        verifySyntheticAppBundle(fixture, fixtureCase),
        fixtureCase.expected,
      );
    });
  }
});
