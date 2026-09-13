import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdir, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  annotateGatePlan,
  assertFullyAutomatedPlan,
  assertGateWidthPolicy,
  compactGatePlan,
  draftCiOutputs,
  filterPlanByRuntimes,
  normalizeRepositoryPath,
  omitMissingNodeTests,
  selectGatePlan,
  validateImpactMap,
} from "./test-gate-core.mjs";
import {
  loadCapabilityContextMap,
  selectCapabilityContext,
} from "./capability-context.mjs";
import {
  CAPABILITY_SMOKE_SUITES,
  CHANGED_SPEC_SUITES,
  RUNTIME_SELECTION_CONFIGS,
  countTagOccurrences,
  isRuntimeCanarySuite,
  runtimeOfSuite,
} from "./gate-smoke-suites.mjs";
import {
  assertResumeCompatible,
  assertReusableBuildArtifacts,
  BUILD_OUTPUTS,
  buildGateFingerprint,
  collectBuildArtifactHashes,
  hashFile,
  suitesForResume,
  resumeEnvSubset,
} from "./test-gate-resume.mjs";
import {
  DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  developerPreviewPackageJson,
  developerPreviewReleaseDirectory,
  resolveDeveloperPreviewIdentity,
  writeDeveloperPreviewAttestation,
} from "./developer-preview.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const mapPath = path.join(productRoot, "tests/test-impact-map.json");

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function assembleGateCapabilityPlan({
  changedFiles = [],
  contextDomains = [],
  contextFiles = [],
  impactMap,
  capabilityMap,
  productRoot,
  lane = "task",
}) {
  if (!impactMap) throw new Error("assembleGateCapabilityPlan requires an impact map.");
  if (!capabilityMap) throw new Error("assembleGateCapabilityPlan requires a capability-context map.");
  const contextQuery = contextDomains.length > 0 || contextFiles.length > 0;
  return {
    contextQuery,
    testPlan: selectGatePlan({ map: impactMap, lane, changedFiles }),
    capabilityContext: selectCapabilityContext({
      changedFiles: contextQuery ? [] : changedFiles,
      domainIds: contextDomains,
      queryFiles: contextFiles,
      map: capabilityMap,
      productRoot,
    }),
  };
}

export function parseArguments(argv) {
  const options = {
    lane: "task",
    arch: "arm64",
    base: null,
    dryRun: false,
    realHtmlPath: null,
    resume: null,
    forLane: null,
    runtimes: [],
    githubOutput: null,
    plannedSelection: null,
    contextDomains: [],
    contextFiles: [],
  };
  if (argv[0] && !argv[0].startsWith("--")) options.lane = argv.shift();
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--base") options.base = argv.shift() || null;
    else if (argument === "--arch") options.arch = argv.shift() || "";
    else if (argument === "--real-html") options.realHtmlPath = argv.shift() || null;
    else if (argument === "--resume") options.resume = argv.shift() || null;
    else if (argument === "--for") options.forLane = argv.shift() || null;
    else if (argument === "--runtime") {
      options.runtimes = String(argv.shift() || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    else if (argument === "--github-output") options.githubOutput = argv.shift() || null;
    else if (argument === "--planned-selection") options.plannedSelection = argv.shift() || null;
    else if (argument === "--context-domain") options.contextDomains.push(...splitCsv(argv.shift() || ""));
    else if (argument === "--context-file") options.contextFiles.push(...splitCsv(argv.shift() || ""));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^(?:edit|task|draft|plan|main|release|developer-package|candidate-app|artifact)$/u.test(options.lane)) {
    throw new Error(
      "Lane must be edit, task, draft, plan, main, release, developer-package, candidate-app or artifact.",
    );
  }
  if (options.forLane && options.lane !== "plan") {
    throw new Error("--for is only supported for the plan gate.");
  }
  if (options.forLane && !/^(?:edit|task|draft)$/u.test(options.forLane)) {
    throw new Error("--for must be edit, task or draft.");
  }
  for (const runtime of options.runtimes) {
    if (!/^(?:node|browser|electron|ai)$/u.test(runtime)) {
      throw new Error("--runtime values must be node, browser, electron or ai.");
    }
  }
  if (options.resume && options.lane !== "task") {
    throw new Error("--resume is only supported for the task gate.");
  }
  if (options.plannedSelection && options.lane !== "draft") {
    throw new Error("--planned-selection is only supported for the draft gate.");
  }
  const contextQuery = options.contextDomains.length > 0 || options.contextFiles.length > 0;
  if (contextQuery && options.lane !== "plan") {
    throw new Error(
      "--context-domain and --context-file are only supported for gate:plan. "
      + "They never change test selection or the task:finish origin/main base.",
    );
  }
  if (options.arch !== "arm64") throw new Error("--arch must be arm64.");
  if (options.realHtmlPath) {
    const resolved = path.resolve(options.realHtmlPath);
    if (!path.isAbsolute(options.realHtmlPath) || path.extname(resolved).toLowerCase() !== ".html") {
      throw new Error("--real-html must be an absolute .html path.");
    }
    options.realHtmlPath = resolved;
  }
  return options;
}

async function runCapture(command, args, { allowFailure = false } = {}) {
  const child = spawn(command, args, {
    cwd: productRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  const errors = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${Buffer.concat(errors).toString("utf8").trim()}`);
  }
  return {
    code,
    stdout: Buffer.concat(chunks),
    stderr: Buffer.concat(errors),
  };
}

function nullSeparated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map(normalizeRepositoryPath);
}

async function changedFiles(base) {
  const commands = [
    ["git", ["diff", "--name-only", "-z"]],
    ["git", ["diff", "--cached", "--name-only", "-z"]],
    ["git", ["ls-files", "--others", "--exclude-standard", "-z"]],
  ];
  if (base) commands.unshift(["git", ["diff", "--name-only", "-z", `${base}...HEAD`]]);
  const output = await Promise.all(commands.map(([command, args]) => runCapture(command, args)));
  return [...new Set(output.flatMap((entry) => nullSeparated(entry.stdout)))].sort();
}

async function repositoryEvidence(files) {
  const head = (await runCapture("git", ["rev-parse", "HEAD"])).stdout.toString("utf8").trim();
  const tree = (await runCapture("git", ["rev-parse", "HEAD^{tree}"])).stdout.toString("utf8").trim();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    const absolute = path.resolve(productRoot, file);
    if (!absolute.startsWith(`${productRoot}${path.sep}`)) continue;
    const info = await stat(absolute).catch(() => null);
    if (info?.isFile()) hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return {
    head,
    tree,
    dirty: files.length > 0,
    changeSetSha256: `sha256:${hash.digest("hex")}`,
  };
}

function packageCommand(script) {
  return { command: "npm", args: ["run", script] };
}

function shellDisplay(command, args) {
  return [command, ...args].map((part) => (/^[a-z0-9_./:@=-]+$/iu.test(part)
    ? part
    : JSON.stringify(part))).join(" ");
}

export function coalesceRuntimeSuites(suites, plan, reportDirectory) {
  const execution = [];
  const byRuntime = new Map();
  for (const suite of suites) {
    if (!isRuntimeCanarySuite(suite.id)) {
      execution.push(suite);
      continue;
    }
    const runtime = runtimeOfSuite(suite.id);
    let batch = byRuntime.get(runtime);
    if (!batch) {
      const id = `${runtime}-selected-tests`;
      batch = {
        id,
        description: `Deduplicated ${runtime} Playwright selection.`,
        reasons: [],
        origins: [],
        sourceSuites: [],
        runtimeSelection: {
          runtime,
          config: RUNTIME_SELECTION_CONFIGS[runtime],
          tags: [],
          files: [],
          testList: path.join(reportDirectory, `${id}.txt`),
          reconciliation: path.join(reportDirectory, `${id}-reconciliation.json`),
          report: path.join(productRoot, "output/playwright", id, "results.json"),
        },
      };
      byRuntime.set(runtime, batch);
      execution.push(batch);
    }
    batch.sourceSuites.push(suite.id);
    batch.reasons.push(...(suite.reasons || []));
    batch.origins.push(...(suite.origins || []));
    const tag = CAPABILITY_SMOKE_SUITES[suite.id]?.tag;
    if (tag && !batch.runtimeSelection.tags.includes(tag)) batch.runtimeSelection.tags.push(tag);
    for (const file of plan.selectedChangedSpecs?.[suite.id] || []) {
      if (!batch.runtimeSelection.files.includes(file)) batch.runtimeSelection.files.push(file);
    }
  }
  for (const batch of byRuntime.values()) {
    batch.sourceSuites = [...new Set(batch.sourceSuites)];
    batch.reasons = [...new Set(batch.reasons)];
    batch.origins = batch.origins.filter((origin, index, entries) => (
      entries.findIndex((entry) => entry.file === origin.file && entry.owner === origin.owner) === index
    ));
    batch.runtimeSelection.tags.sort();
    batch.runtimeSelection.files.sort();
  }
  return execution;
}

function commandForSuite(suite, context) {
  const suiteId = typeof suite === "string" ? suite : suite.id;
  if (typeof suite !== "string" && suite.runtimeSelection) {
    const selection = suite.runtimeSelection;
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/run-playwright-selection.mjs"),
        "--config",
        selection.config,
        "--test-list",
        selection.testList,
        "--reconciliation",
        selection.reconciliation,
        "--report",
        selection.report,
        ...selection.tags.flatMap((tag) => ["--tag", tag]),
        ...selection.files.flatMap((file) => ["--file", file]),
      ],
    };
  }
  const smoke = CAPABILITY_SMOKE_SUITES[suiteId];
  if (smoke) {
    return {
      command: "npx",
      args: ["playwright", "test", "--config", smoke.config, "--grep", smoke.tag],
    };
  }
  const changedSpec = CHANGED_SPEC_SUITES[suiteId];
  if (changedSpec) {
    const files = context.plan.selectedChangedSpecs?.[suiteId] || [];
    if (files.length === 0) {
      throw new Error(`Suite ${suiteId} was selected without changed Playwright spec files.`);
    }
    return {
      command: "npx",
      args: ["playwright", "test", "--config", changedSpec.config, ...files],
    };
  }
  const simple = {
    "build-web": packageCommand("build"),
    "build-desktop": packageCommand("desktop:renderer"),
    typecheck: packageCommand("typecheck"),
    lint: packageCommand("lint"),
    "dependency-audit": packageCommand("audit:dependencies"),
    "node-core": { command: process.execPath, args: [path.join(productRoot, "scripts/test-node-group.mjs"), "core"] },
    "node-contract": { command: process.execPath, args: [path.join(productRoot, "scripts/test-node-group.mjs"), "contract"] },
    "node-integration": { command: process.execPath, args: [path.join(productRoot, "scripts/test-node-group.mjs"), "integration"] },
    "node-package": packageCommand("test:package"),
    "node-smoke": { command: process.execPath, args: [path.join(productRoot, "scripts/test-node-group.mjs"), "smoke"] },
    "node-full": { command: process.execPath, args: [path.join(productRoot, "scripts/test-node-group.mjs"), "full"] },
    "browser-full": {
      command: "npx",
      args: ["playwright", "test", "--config", "tests/e2e/browser/playwright.config.mjs"],
    },
    "dom-editing-compatibility": {
      command: "npx",
      args: ["playwright", "test", "--config", "tests/e2e/browser/playwright.real-html.config.mjs"],
    },
    "electron-full": {
      command: "npx",
      args: ["playwright", "test", "--config", "tests/e2e/electron/playwright.config.mjs"],
    },
    "ai-closed-loop": {
      command: "npx",
      args: ["playwright", "test", "--config", "tests/e2e/electron/playwright.ai-closed-loop.config.mjs"],
    },
  };
  if (simple[suiteId]) return simple[suiteId];
  if (suiteId === "node-targeted") {
    return { command: process.execPath, args: ["--test", ...context.plan.selectedNodeTests.map((file) => path.join(productRoot, file))] };
  }
  if (suiteId === "package-build") {
    return {
      command: process.execPath,
      args: [path.join(productRoot, "scripts/build-package.mjs"), "--arch", context.options.arch],
    };
  }
  if (suiteId === "developer-package-build") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/build-package.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "developer",
      ],
    };
  }
  if (suiteId === "candidate-app-build") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/build-package.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "candidate-app",
      ],
    };
  }
  if (suiteId === "packaged-runtime") {
    return packageCommand("test:packaged-runtime");
  }
  if (suiteId === "developer-packaged-startup") {
    return packageCommand("test:packaged-startup");
  }
  if (suiteId === "developer-package-report") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/package-delivery-report.mjs"),
        "--kind",
        "developer-preview",
        "--artifact",
        context.artifact.dmgPath,
        "--version",
        context.artifact.version,
        "--architecture",
        context.options.arch,
        "--base-tag",
        context.developerPreviewIdentity.stableTag,
        "--output",
        path.join(productRoot, "output/developer-preview"),
      ],
    };
  }
  if (suiteId === "candidate-app-runtime") {
    return packageCommand("test:packaged-runtime");
  }
  if (suiteId === "packaged-verify") {
    return {
      command: process.execPath,
      args: [path.join(productRoot, "scripts/verify-packaged-artifact.mjs"), "--arch", context.options.arch],
    };
  }
  if (suiteId === "developer-packaged-verify") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/verify-packaged-artifact.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "developer",
      ],
    };
  }
  if (suiteId === "candidate-app-verify") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/verify-packaged-artifact.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "candidate-app",
      ],
    };
  }
  if (suiteId === "package-delivery-report") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/package-delivery-report.mjs"),
        "--kind",
        "formal",
        "--artifact",
        context.artifact.dmgPath,
        "--version",
        context.artifact.version,
        "--architecture",
        context.options.arch,
        "--output",
        path.join(productRoot, "output/package-delivery"),
      ],
    };
  }
  throw new Error(`No command is defined for suite ${suiteId}.`);
}

async function runInherited(command, args, env) {
  const child = spawn(command, args, {
    cwd: productRoot,
    env,
    stdio: "inherit",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ended by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertReleaseRepositoryStable(repository) {
  const files = await changedFiles(null);
  const current = await repositoryEvidence(files);
  if (files.length > 0 || current.head !== repository.head || current.tree !== repository.tree) {
    throw new Error(
      "Clean source changed while the gate was running. Commit the final source and rerun the gate.",
    );
  }
}

async function inventoryFiles() {
  const tracked = nullSeparated((await runCapture("git", ["ls-files", "-z"])).stdout);
  const untracked = nullSeparated(
    (await runCapture("git", ["ls-files", "-z", "--others", "--exclude-standard"])).stdout,
  );
  return [...new Set([...tracked, ...untracked])];
}

function smokeRuntimeDirectory(runtime) {
  return runtime === "browser" ? "tests/e2e/browser/" : "tests/e2e/electron/";
}

function smokeSpecMatchesRuntime(file, runtime) {
  if (!file.startsWith(smokeRuntimeDirectory(runtime))) return false;
  const isAiSpec = /\/ai-[\w.-]+\.spec\.mjs$/u.test(file);
  if (runtime === "ai") return isAiSpec;
  if (runtime === "electron") return !isAiSpec;
  return true;
}

async function smokeTagCounts(files) {
  const counts = {};
  const specFiles = files.filter((file) => /^tests\/e2e\/.*\.spec\.mjs$/u.test(file));
  const sources = new Map();
  for (const smoke of Object.values(CAPABILITY_SMOKE_SUITES)) {
    const key = `${smoke.runtime}:${smoke.tag}`;
    if (counts[key] != null) continue;
    let total = 0;
    for (const file of specFiles) {
      if (!smokeSpecMatchesRuntime(file, smoke.runtime)) continue;
      const absolute = path.join(productRoot, file);
      if (!existsSync(absolute)) continue;
      if (!sources.has(file)) {
        sources.set(file, await readFile(absolute, "utf8"));
      }
      total += countTagOccurrences(sources.get(file), smoke.tag);
    }
    counts[key] = total;
  }
  return counts;
}

async function loadPreviousRun(runId) {
  const reportDirectory = path.join(productRoot, "output/test-runs", runId);
  const selectionPath = path.join(reportDirectory, "selection.json");
  const resultsPath = path.join(reportDirectory, "results.json");
  const fingerprintPath = path.join(reportDirectory, "fingerprint.json");
  if (!existsSync(selectionPath) || !existsSync(resultsPath) || !existsSync(fingerprintPath)) {
    throw new Error(`Cannot resume: evidence for ${runId} is incomplete.`);
  }
  const selection = JSON.parse(await readFile(selectionPath, "utf8"));
  const summary = JSON.parse(await readFile(resultsPath, "utf8"));
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));
  const results = Array.isArray(summary.results) ? summary.results : [];
  return { reportDirectory, selection, results, fingerprint };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const map = validateImpactMap(JSON.parse(await readFile(mapPath, "utf8")));
  const files = await changedFiles(options.base);
  const planningLane = options.lane === "plan";
  const selectionLane = planningLane ? (options.forLane || "task") : options.lane;
  const contextQuery = options.contextDomains.length > 0 || options.contextFiles.length > 0;
  if ((selectionLane === "edit" || selectionLane === "task" || selectionLane === "draft") && files.length === 0 && !contextQuery) {
    throw new Error(
      `No changed files were found for the ${options.lane} gate. `
      + "Pass --base <git-ref> for a committed task, or use the release gate for complete coverage.",
    );
  }
  const cleanSourceLane = [
    "main",
    "release",
    "developer-package",
    "candidate-app",
    "artifact",
  ].includes(options.lane);
  if (cleanSourceLane && files.length > 0) {
    throw new Error(
      `${options.lane} gates require a clean Git worktree. Commit every source change first.`,
    );
  }
  const repository = await repositoryEvidence(files);
  let plan;
  if (options.plannedSelection) {
    let envelope;
    try {
      envelope = JSON.parse(Buffer.from(options.plannedSelection, "base64").toString("utf8"));
    } catch {
      throw new Error("--planned-selection is not valid base64-encoded JSON.");
    }
    if (envelope.schemaVersion !== 1 || !envelope.plan) {
      throw new Error("--planned-selection has an unsupported schema.");
    }
    if (envelope.head !== repository.head || envelope.base !== options.base) {
      throw new Error("--planned-selection does not match the current head and base.");
    }
    if (JSON.stringify(envelope.plan.changedFiles) !== JSON.stringify(files)) {
      throw new Error("--planned-selection changed files do not match the current checkout.");
    }
    if (envelope.plan.lane !== selectionLane) {
      throw new Error("--planned-selection was created for a different gate lane.");
    }
    for (const suite of envelope.plan.suites || []) {
      if (!map.suites[suite.id]) throw new Error(`--planned-selection references unknown suite ${suite.id}.`);
    }
    plan = assertFullyAutomatedPlan(envelope.plan);
  } else {
    const inventory = await inventoryFiles();
    const tagCounts = await smokeTagCounts(inventory);
    const assembled = assembleGateCapabilityPlan({
      changedFiles: files,
      contextDomains: options.contextDomains,
      contextFiles: options.contextFiles,
      impactMap: map,
      capabilityMap: loadCapabilityContextMap(),
      productRoot,
      lane: selectionLane,
    });
    plan = {
      ...annotateGatePlan(
        omitMissingNodeTests(
          assertFullyAutomatedPlan(assembled.testPlan),
          (file) => {
            const absolute = path.resolve(productRoot, file);
            return absolute.startsWith(`${productRoot}${path.sep}`) && existsSync(absolute);
          },
        ),
        { map, inventoryFiles: inventory, tagCounts },
      ),
      capabilityContext: assembled.capabilityContext,
    };
  }
  assertGateWidthPolicy(plan);
  if (options.githubOutput) {
    await appendFile(
      options.githubOutput,
      Object.entries(draftCiOutputs(plan, { head: repository.head, base: options.base })).flatMap(([key, value]) => (
        String(value).includes("\n")
          ? [`${key}<<EOF`, value, "EOF"]
          : [`${key}=${value}`]
      )).join("\n") + "\n",
    );
  }
  if (options.runtimes.length > 0) {
    plan = filterPlanByRuntimes(plan, options.runtimes);
  }
  if (contextQuery) {
    plan.warnings = [
      ...(plan.warnings || []),
      {
        code: "context-query-does-not-select-tests",
        message: "Capability-context queries choose reading sets only. Test selection still uses the real Git diff, and task:finish stays fixed to origin/main.",
      },
    ];
  }
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const developerPreviewIdentity = options.lane === "developer-package"
    ? resolveDeveloperPreviewIdentity({ productRoot, packageJson })
    : null;
  const packagedPackageJson = developerPreviewIdentity
    ? developerPreviewPackageJson(packageJson, developerPreviewIdentity)
    : packageJson;
  if (options.lane === "candidate-app") {
    if (process.env.PAGEROOT_SOURCE_GATE_TRUSTED !== "true") {
      throw new Error(`${options.lane} requires a trusted source-gate decision from CI.`);
    }
    if (
      process.env.PAGEROOT_SOURCE_GATE_TREE !== repository.tree
      || process.env.PAGEROOT_SOURCE_GATE_VERSION !== packageJson.version
    ) {
      throw new Error(
        `${options.lane} source-gate tree or version does not match the clean checkout.`,
      );
    }
  }
  let artifact = {};
  if (!planningLane) {
    const { expectedArtifactLayout } = await import("./verify-packaged-artifact.mjs");
    const releaseDirectory = options.lane === "developer-package"
      ? developerPreviewReleaseDirectory(productRoot)
      : options.lane === "candidate-app"
        ? (await import("./release-app-stage.mjs")).candidateAppReleaseDirectory(productRoot)
        : undefined;
    artifact = expectedArtifactLayout({
      productRoot,
      packageJson: packagedPackageJson,
      arch: options.arch,
      releaseDirectory,
      artifactName: options.lane === "developer-package"
        ? DEVELOPER_PREVIEW_ARTIFACT_PATTERN
        : undefined,
    });
  }
  const startedAt = new Date();
  const previousRun = options.resume ? await loadPreviousRun(options.resume) : null;
  const runId = previousRun?.selection.runId || `${startedAt.toISOString().replace(/[:.]/gu, "-")}-${options.lane}`;
  const reportDirectory = previousRun?.reportDirectory
    || path.join(productRoot, "output/test-runs", runId);
  await mkdir(reportDirectory, { recursive: true });
  const context = {
    options,
    plan,
    artifact,
    developerPreviewIdentity,
  };
  const selectedSuites = coalesceRuntimeSuites(plan.suites, plan, reportDirectory).map((suite) => {
    const command = commandForSuite(suite, context);
    return { ...suite, command: shellDisplay(command.command, command.args) };
  });
  const selection = {
    schemaVersion: 1,
    runId,
    lane: options.lane,
    dryRun: options.dryRun || planningLane,
    startedAt: previousRun?.selection.startedAt || startedAt.toISOString(),
    resumedAt: previousRun ? startedAt.toISOString() : null,
    repository,
    changedFiles: files,
    matchedOwners: plan.matchedOwners,
    fileMatches: plan.fileMatches,
    nodeTestOrigins: plan.nodeTestOrigins,
    ruleStats: plan.ruleStats,
    warnings: plan.warnings,
    estimatedFanout: plan.estimatedFanout,
    runtimeCanaries: plan.runtimeCanaries,
    selectedNodeTests: plan.selectedNodeTests,
    logicalSuites: plan.suites,
    suites: selectedSuites,
    compact: compactGatePlan(plan),
    options: {
      arch: options.arch,
      base: options.base,
      realHtmlPath: options.realHtmlPath,
      resume: options.resume,
      plannedSelection: Boolean(options.plannedSelection),
    },
  };
  await writeJson(path.join(reportDirectory, "selection.json"), selection);
  if (planningLane) {
    console.log(JSON.stringify(compactGatePlan(plan), null, 2));
    return;
  }
  const fingerprint = buildGateFingerprint({
    tree: repository.tree,
    changeSetSha256: repository.changeSetSha256,
    baseRef: options.base,
    packageLockSha256: await hashFile(path.join(productRoot, "package-lock.json")),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    suiteCommands: selectedSuites.map((suite) => ({ id: suite.id, command: suite.command })),
    envSubset: resumeEnvSubset(),
    artifactHashes: await collectBuildArtifactHashes(
      productRoot,
      selectedSuites.map((suite) => suite.id),
    ),
  });
  if (previousRun) {
    assertResumeCompatible(previousRun.fingerprint, fingerprint);
  }
  await writeJson(path.join(reportDirectory, "fingerprint.json"), fingerprint);

  console.log(`Automated ${options.lane} gate: ${selectedSuites.length} step(s)`);
  console.log(`Evidence: ${reportDirectory}`);
  if (plan.warnings.length > 0) {
    console.log(`Width warnings: ${plan.warnings.length}`);
    for (const warning of plan.warnings) console.log(`- ${warning.code}: ${warning.message}`);
  }
  for (const suite of selectedSuites) console.log(`- ${suite.id}: ${suite.command}`);

  const suitePlan = previousRun
    ? suitesForResume(selectedSuites, previousRun.results)
    : selectedSuites.map((suite) => ({ ...suite, resume: "run", previous: null }));
  if (previousRun) await assertReusableBuildArtifacts(productRoot, suitePlan);

  const results = previousRun
    ? previousRun.results
      .filter((result) => (
        suitePlan.some((suite) => suite.id === result.id && suite.resume === "reuse")
      ))
      .map((result) => ({ ...result, reused: true }))
    : [];
  if (!options.dryRun) {
    for (const suite of suitePlan) {
      if (suite.resume === "reuse") {
        console.log(`\n[${suite.id}] reused previous pass`);
        continue;
      }
      if (cleanSourceLane) {
        await assertReleaseRepositoryStable(repository);
      }
      const command = commandForSuite(suite, context);
      const suiteStartedAt = new Date();
      console.log(`\n[${suite.id}] ${shellDisplay(command.command, command.args)}`);
      const env = {
        ...process.env,
        ...(suite.runtimeSelection ? { PAGEROOT_SMOKE_SUITE: suite.id } : {}),
        ...(options.realHtmlPath && suite.id === "dom-editing-compatibility"
          ? { PAGEROOT_REAL_HTML_PATH: options.realHtmlPath }
          : {}),
        ...((suite.id === "packaged-runtime"
          || suite.id === "developer-packaged-startup"
          || suite.id === "candidate-app-runtime")
          ? {
            PAGEROOT_PACKAGED_APP_PATH: artifact.appPath,
            PAGEROOT_EXPECTED_APP_VERSION: artifact.version,
            PAGEROOT_EXPECTED_PRODUCT_NAME: artifact.productName,
            PAGEROOT_EXPECTED_BUNDLE_ID: packagedPackageJson.build.appId,
            PAGEROOT_TEST_ARCH: options.arch,
          }
          : {}),
      };
      let exitCode = 1;
      let failure = null;
      try {
        exitCode = await runInherited(command.command, command.args, env);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const suiteCompletedAt = new Date();
      const outputRelative = BUILD_OUTPUTS[suite.id];
      results.push({
        id: suite.id,
        status: exitCode === 0 && !failure ? "passed" : "failed",
        exitCode,
        failure,
        startedAt: suiteStartedAt.toISOString(),
        completedAt: suiteCompletedAt.toISOString(),
        durationMs: suiteCompletedAt.getTime() - suiteStartedAt.getTime(),
        command: shellDisplay(command.command, command.args),
        sourceSuites: suite.sourceSuites || null,
        outputHash: outputRelative
          ? (await collectBuildArtifactHashes(productRoot, [suite.id]))[outputRelative]
          : null,
      });
      await writeJson(path.join(reportDirectory, "results.json"), { results });
      if (exitCode !== 0 || failure) break;
    }
    if (!results.some((result) => result.status === "failed")
      && cleanSourceLane) {
      await assertReleaseRepositoryStable(repository);
    }
  }

  const failed = results.find((result) => result.status === "failed");
  let developerPreviewAttestation = null;
  if (
    !options.dryRun
    && !failed
    && options.lane === "developer-package"
  ) {
    const record = await writeDeveloperPreviewAttestation({
      productRoot,
      artifact,
      identity: developerPreviewIdentity,
      repository,
      architecture: options.arch,
      results,
    });
    developerPreviewAttestation = path.relative(productRoot, record.destination);
    console.log(`Developer preview attestation: ${record.destination}`);
  }
  const completedAt = new Date();
  const summary = {
    schemaVersion: 1,
    runId,
    lane: options.lane,
    status: options.dryRun ? "dry-run" : failed ? "failed" : "passed",
    startedAt: selection.startedAt,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - new Date(selection.startedAt).getTime(),
    selectedCount: selectedSuites.length,
    executedCount: results.filter((result) => !result.reused).length,
    passedCount: results.filter((result) => result.status === "passed").length,
    reusedCount: suitePlan.filter((suite) => suite.resume === "reuse").length,
    failedSuite: failed?.id || null,
    developerPreviewAttestation,
    packageDeliveryReport: !options.dryRun
      && !failed
      && options.lane === "developer-package"
      ? "output/developer-preview/package-delivery-report.md"
      : !options.dryRun
        && !failed
        && options.lane === "artifact"
        ? "output/package-delivery/package-delivery-report.md"
        : null,
    results,
  };
  await writeJson(path.join(reportDirectory, "results.json"), summary);
  console.log(`\nGate ${summary.status}. Report: ${path.join(reportDirectory, "results.json")}`);
  if (failed) process.exitCode = failed.exitCode || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
