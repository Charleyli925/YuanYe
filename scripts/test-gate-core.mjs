import path from "node:path";

import {
  CAPABILITY_SMOKE_SUITES,
  GATE_WIDTH_LIMITS,
  classifyPlaywrightSpec,
  isRuntimeCanarySuite,
  runtimeOfSuite,
} from "./gate-smoke-suites.mjs";

const CODE_PATH = /\.(?:cjs|mjs|js|jsx|ts|tsx|json)$/iu;
const NODE_TEST_PATH = /^tests\/[^/]+\.test\.mjs$/u;
const PRODUCTION_MODULE_PATH = /^(?:app|bridge|desktop|scripts|shared)\//u;

export { GATE_WIDTH_LIMITS };

export function normalizeRepositoryPath(value) {
  return String(value).replaceAll(path.sep, "/").replace(/^\.\//u, "");
}

export function validateImpactMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new TypeError("Test impact map must be an object.");
  }
  if (map.schemaVersion !== 1) throw new Error("Unsupported test impact map schemaVersion.");
  const suiteIds = new Set(Object.keys(map.suites || {}));
  if (suiteIds.size === 0) throw new Error("Test impact map has no suites.");
  for (const [suiteId, suite] of Object.entries(map.suites)) {
    for (const prerequisite of suite.prerequisites || []) {
      if (!suiteIds.has(prerequisite)) {
        throw new Error(`Suite ${suiteId} has unknown prerequisite ${prerequisite}.`);
      }
    }
  }
  for (const [laneId, lane] of Object.entries(map.lanes || {})) {
    for (const suiteId of [
      ...(lane.allowedSuites || []),
      ...(lane.alwaysForCode || []),
      ...(lane.fullSuites || []),
    ]) {
      if (!suiteIds.has(suiteId)) throw new Error(`Lane ${laneId} references unknown suite ${suiteId}.`);
    }
  }
  const ruleIds = new Set((map.rules || []).map((rule) => rule.id));
  for (const rule of map.rules || []) {
    if (!rule.id || !Array.isArray(rule.patterns)) throw new Error("Every impact rule needs an id and patterns.");
    for (const pattern of rule.patterns) new RegExp(pattern, "u");
    for (const suiteId of rule.suites || []) {
      if (!suiteIds.has(suiteId)) throw new Error(`Rule ${rule.id} references unknown suite ${suiteId}.`);
    }
  }
  for (const exception of map.widthExceptions || []) {
    if (!exception.id || !exception.expiresOn) {
      throw new Error("Every width exception needs an id and expiresOn date.");
    }
    if (!ruleIds.has(exception.id)) {
      throw new Error(`Width exception ${exception.id} does not match a rule.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresOn)) {
      throw new Error(`Width exception ${exception.id} expiresOn must be YYYY-MM-DD.`);
    }
  }
  return map;
}

function addReason(reasons, suiteId, reason) {
  const entries = reasons.get(suiteId) || [];
  if (!entries.includes(reason)) entries.push(reason);
  reasons.set(suiteId, entries);
}

function expandPrerequisites(map, requestedSuiteIds, reasons) {
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (suiteId) => {
    if (visited.has(suiteId)) return;
    if (visiting.has(suiteId)) throw new Error(`Cyclic test prerequisite at ${suiteId}.`);
    visiting.add(suiteId);
    for (const prerequisite of map.suites[suiteId].prerequisites || []) {
      addReason(reasons, prerequisite, `required by ${suiteId}`);
      visit(prerequisite);
    }
    visiting.delete(suiteId);
    visited.add(suiteId);
    ordered.push(suiteId);
  };
  requestedSuiteIds.forEach(visit);
  return ordered;
}

function orderForFastFailure(suiteIds, selectedNodeTests) {
  const webBackedNode = suiteIds.includes("node-full")
    || suiteIds.includes("node-integration")
    || selectedNodeTests.includes("tests/rendered-html.test.mjs");
  const phase = (suiteId) => {
    if (suiteId === "typecheck") return 10;
    if (suiteId === "lint") return 20;
    if (suiteId === "dependency-audit") return 25;
    if (suiteId.startsWith("node-")) return webBackedNode ? 40 : 30;
    if (suiteId === "build-web") return webBackedNode ? 30 : 40;
    if (suiteId.startsWith("browser-")) return 50;
    if (suiteId === "dom-editing-compatibility") return 55;
    if (suiteId === "build-desktop") return 60;
    if (suiteId.startsWith("electron-")) return 70;
    if (suiteId.startsWith("ai-")) return 80;
    if (suiteId === "developer-package-build") return 90;
    if (suiteId === "developer-packaged-verify") return 95;
    if (suiteId === "developer-packaged-startup") return 100;
    if (suiteId === "developer-package-report") return 120;
    if (suiteId === "candidate-app-build") return 90;
    if (suiteId === "candidate-app-verify") return 95;
    if (suiteId === "candidate-app-runtime") return 100;
    if (suiteId === "package-build") return 90;
    if (suiteId === "packaged-runtime") return 100;
    if (suiteId === "packaged-verify") return 110;
    if (suiteId === "package-delivery-report") return 120;
    return 45;
  };
  return suiteIds
    .map((id, index) => ({ id, index }))
    .sort((left, right) => phase(left.id) - phase(right.id) || left.index - right.index)
    .map(({ id }) => id);
}

export function selectGatePlan({ map, lane, changedFiles = [] }) {
  validateImpactMap(map);
  const laneConfig = map.lanes?.[lane];
  if (!laneConfig) throw new Error(`Unknown test lane ${JSON.stringify(lane)}.`);
  const normalizedFiles = [...new Set(changedFiles.map(normalizeRepositoryPath))].sort();
  const reasons = new Map();
  const requested = [];
  const requestedSet = new Set();
  const selectedNodeTests = new Set();
  const selectedChangedSpecs = new Map();
  const fallbackReasons = [];
  const matchedOwners = [];
  const matchedOwnerSet = new Set();
  const fileMatches = [];
  const nodeTestOrigins = new Map();
  const addOrigin = (collection, key, origin) => {
    const entries = collection.get(key) || [];
    if (!entries.some((entry) => entry.file === origin.file && entry.owner === origin.owner)) {
      entries.push(origin);
    }
    collection.set(key, entries);
  };
  const addSuite = (suiteId, reason, origin = null) => {
    if (!map.suites[suiteId]) throw new Error(`Unknown selected suite ${suiteId}.`);
    addReason(reasons, suiteId, reason);
    if (!requestedSet.has(suiteId)) {
      requestedSet.add(suiteId);
      requested.push(suiteId);
    }
    if (origin) addOrigin(nodeTestOrigins, `suite:${suiteId}`, origin);
  };

  if (Array.isArray(laneConfig.fullSuites)) {
    laneConfig.fullSuites.forEach((suiteId) => addSuite(suiteId, `${lane} lane`));
  } else {
    const allowed = new Set(laneConfig.allowedSuites || []);
    const isCodeChange = normalizedFiles.some((file) => CODE_PATH.test(file));
    if (isCodeChange) {
      for (const suiteId of laneConfig.alwaysForCode || []) addSuite(suiteId, "code changed");
    }

    for (const file of normalizedFiles) {
      const isTopLevelNodeTest = NODE_TEST_PATH.test(file);
      const changedSpec = classifyPlaywrightSpec(file);
      const matchedRules = [];
      if (isTopLevelNodeTest) {
        selectedNodeTests.add(file);
        addOrigin(nodeTestOrigins, file, { file, owner: "self" });
        if (allowed.has("node-targeted")) addSuite("node-targeted", `${file} changed`, { file, owner: "self" });
      }
      if (changedSpec && allowed.has(changedSpec.suiteId)) {
        const filesForSuite = selectedChangedSpecs.get(changedSpec.suiteId) || [];
        if (!filesForSuite.includes(changedSpec.file)) filesForSuite.push(changedSpec.file);
        selectedChangedSpecs.set(changedSpec.suiteId, filesForSuite);
        addSuite(changedSpec.suiteId, `${file} changed`, { file, owner: "changed-spec" });
      }
      let matched = isTopLevelNodeTest || Boolean(changedSpec);
      for (const rule of map.rules || []) {
        if (!rule.patterns.some((pattern) => new RegExp(pattern, "u").test(file))) continue;
        matched = true;
        matchedRules.push(rule.id);
        if (!matchedOwnerSet.has(rule.id)) {
          matchedOwnerSet.add(rule.id);
          matchedOwners.push(rule.id);
        }
        for (const nodeTest of rule.nodeTests || []) {
          selectedNodeTests.add(nodeTest);
          addOrigin(nodeTestOrigins, nodeTest, { file, owner: rule.id });
        }
        for (const suiteId of rule.suites || []) {
          if (allowed.has(suiteId)) {
            addSuite(suiteId, `${rule.id}: ${file}`, { file, owner: rule.id });
          }
        }
      }
      fileMatches.push({ file, rules: matchedRules });
      if (matched && selectedNodeTests.size > 0 && allowed.has("node-targeted")) {
        addSuite("node-targeted", `impact-mapped Node tests for ${file}`);
      }
      const fallbackPattern = new RegExp(map.fallback?.codePattern || CODE_PATH.source, "u");
      if (!matched && fallbackPattern.test(file)) {
        fallbackReasons.push(`unmapped code fallback: ${file}`);
      }
    }
    if (fallbackReasons.length > 0) {
      for (const suiteId of map.fallback?.suites || []) {
        if (!allowed.has(suiteId)) continue;
        for (const reason of fallbackReasons) addSuite(suiteId, reason);
      }
    }
    if (selectedNodeTests.has("tests/rendered-html.test.mjs")) {
      addSuite("build-web", "tests/rendered-html.test.mjs imports the production server build");
      const buildIndex = requested.indexOf("build-web");
      const targetedIndex = requested.indexOf("node-targeted");
      if (buildIndex > targetedIndex && targetedIndex >= 0) {
        requested.splice(buildIndex, 1);
        requested.splice(targetedIndex, 0, "build-web");
      }
    }
  }

  if (selectedNodeTests.size === 0 && requestedSet.has("node-targeted")) {
    requestedSet.delete("node-targeted");
    const index = requested.indexOf("node-targeted");
    if (index >= 0) requested.splice(index, 1);
    reasons.delete("node-targeted");
  }

  const suiteIds = orderForFastFailure(
    expandPrerequisites(map, requested, reasons),
    [...selectedNodeTests],
  );
  const suites = suiteIds.map((id) => ({
    id,
    description: map.suites[id].description,
    reasons: reasons.get(id) || [],
    origins: nodeTestOrigins.get(`suite:${id}`) || [],
  }));
  return {
    lane,
    changedFiles: normalizedFiles,
    matchedOwners,
    fileMatches,
    nodeTestOrigins: Object.fromEntries(
      [...nodeTestOrigins.entries()]
        .filter(([key]) => !key.startsWith("suite:"))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    selectedNodeTests: [...selectedNodeTests].sort(),
    selectedChangedSpecs: Object.fromEntries(
      [...selectedChangedSpecs.entries()].map(([suiteId, specFiles]) => [suiteId, specFiles.sort()]),
    ),
    suites,
  };
}

export function isProductionModule(file) {
  return PRODUCTION_MODULE_PATH.test(normalizeRepositoryPath(file));
}

export function collectRuleCoverage(map, inventoryFiles = []) {
  const files = inventoryFiles.map(normalizeRepositoryPath);
  return (map.rules || []).map((rule) => {
    const matchedFiles = files.filter((file) => (
      rule.patterns.some((pattern) => new RegExp(pattern, "u").test(file))
    ));
    return {
      id: rule.id,
      matchedFiles,
      productionModuleCount: matchedFiles.filter(isProductionModule).length,
      nodeTestCount: (rule.nodeTests || []).length,
      suites: [...(rule.suites || [])],
    };
  });
}

function leafNodeFanout(plan, file) {
  const tests = new Set();
  const match = plan.fileMatches.find((entry) => entry.file === file);
  if (!match) return 0;
  for (const [testFile, origins] of Object.entries(plan.nodeTestOrigins)) {
    if (origins.some((origin) => origin.file === file)) tests.add(testFile);
  }
  return tests.size;
}

function exceptionById(map) {
  return new Map((map.widthExceptions || []).map((exception) => [exception.id, exception]));
}

function exceptionIsActive(exception, now) {
  if (!exception?.expiresOn) return false;
  return new Date(`${exception.expiresOn}T23:59:59.000Z`) >= now;
}

export function buildGateWarnings(plan, { map, inventoryFiles = [], now = new Date() } = {}) {
  const warnings = [];
  const exceptions = exceptionById(map || {});
  for (const file of plan.changedFiles) {
    const count = leafNodeFanout(plan, file);
    if (count > GATE_WIDTH_LIMITS.leafFileNodeTests) {
      const match = plan.fileMatches.find((entry) => entry.file === file);
      const owners = match?.rules || [];
      const blocking = owners.every((owner) => !exceptionIsActive(exceptions.get(owner), now));
      warnings.push({
        code: "leaf-file-node-fanout",
        message: `${file} selected ${count} Node files`,
        file,
        count,
        limit: GATE_WIDTH_LIMITS.leafFileNodeTests,
        blocking,
      });
    }
  }
  if (inventoryFiles.length > 0) {
    for (const rule of collectRuleCoverage(map, inventoryFiles)) {
      const overProduction = rule.productionModuleCount > GATE_WIDTH_LIMITS.ruleProductionModules;
      const overNodeTests = rule.nodeTestCount > GATE_WIDTH_LIMITS.leafFileNodeTests;
      if (!overProduction && !overNodeTests) continue;
      const exception = exceptions.get(rule.id);
      const active = exceptionIsActive(exception, now);
      if (overProduction) {
        warnings.push({
          code: "rule-production-width",
          message: `${rule.id} matches ${rule.productionModuleCount} production modules`,
          owner: rule.id,
          count: rule.productionModuleCount,
          limit: GATE_WIDTH_LIMITS.ruleProductionModules,
          blocking: !active,
        });
      }
      if (overNodeTests) {
        warnings.push({
          code: "rule-node-test-width",
          message: `${rule.id} selects ${rule.nodeTestCount} Node files`,
          owner: rule.id,
          count: rule.nodeTestCount,
          limit: GATE_WIDTH_LIMITS.leafFileNodeTests,
          blocking: !active,
        });
      }
    }
  }
  const runtimes = new Set(
    plan.suites.map((suite) => runtimeOfSuite(suite.id)).filter(Boolean),
  );
  if (runtimes.has("browser") && runtimes.has("electron") && runtimes.has("ai")) {
    warnings.push({
      code: "task-heavy-lane-union",
      message: `${plan.lane || "task"} selected Browser, Electron and AI runtime canaries together`,
      suites: plan.suites.map((suite) => suite.id).filter(isRuntimeCanarySuite),
      blocking: false,
    });
  }
  return warnings;
}

export function assertGateWidthPolicy(plan) {
  const blocking = (plan.warnings || []).filter((warning) => warning.blocking);
  if (blocking.length === 0) return plan;
  throw new Error(
    `Impact map width budget exceeded:\n${blocking.map((warning) => `- ${warning.code}: ${warning.message}`).join("\n")}`,
  );
}

export function draftCiOutputs(plan, metadata = {}) {
  const suiteIds = (plan.suites || []).map((suite) => suite.id);
  const browserSuites = suiteIds.filter(
    (id) => runtimeOfSuite(id) === "browser" || id === "dom-editing-compatibility",
  );
  const desktopSuites = suiteIds.filter((id) => runtimeOfSuite(id) === "electron" || runtimeOfSuite(id) === "ai");
  return {
    has_browser: browserSuites.length > 0 ? "true" : "false",
    has_desktop: desktopSuites.length > 0 ? "true" : "false",
    browser_canaries: browserSuites.join("\n"),
    desktop_canaries: desktopSuites.join("\n"),
    planned_selection: Buffer.from(JSON.stringify({
      schemaVersion: 1,
      head: metadata.head || null,
      base: metadata.base || null,
      plan,
    })).toString("base64"),
  };
}

export function filterPlanByRuntimes(plan, runtimes) {
  const allowed = new Set(runtimes);
  if (allowed.size === 0) return plan;
  const keep = (suiteId) => {
    if (suiteId === "typecheck" || suiteId === "lint" || suiteId === "dependency-audit") {
      return allowed.has("node");
    }
    if (suiteId.startsWith("node-")) return allowed.has("node");
    if (suiteId === "build-web") return allowed.has("node") || allowed.has("browser");
    if (
      suiteId === "dom-editing-compatibility"
      || suiteId.startsWith("browser-")
    ) return allowed.has("browser");
    if (suiteId === "build-desktop") return allowed.has("electron") || allowed.has("ai");
    if (suiteId.startsWith("electron-")) return allowed.has("electron");
    if (suiteId.startsWith("ai-")) return allowed.has("ai");
    return true;
  };
  const suites = plan.suites.filter((suite) => keep(suite.id));
  const selectedNodeTests = allowed.has("node") ? plan.selectedNodeTests : [];
  return {
    ...plan,
    selectedNodeTests,
    suites,
    runtimeCanaries: suites.map((suite) => suite.id).filter(isRuntimeCanarySuite),
  };
}

export function estimateRuntimeFanout(plan, tagCounts = {}) {
  const fanout = { nodeFiles: plan.selectedNodeTests.length, browserTests: 0, electronTests: 0, aiTests: 0 };
  for (const suite of plan.suites) {
    const runtime = runtimeOfSuite(suite.id);
    const tag = CAPABILITY_SMOKE_SUITES[suite.id]?.tag;
    if (!runtime || !tag) continue;
    const count = tagCounts[`${runtime}:${tag}`] || 0;
    if (runtime === "browser") fanout.browserTests += count;
    else if (runtime === "electron") fanout.electronTests += count;
    else if (runtime === "ai") fanout.aiTests += count;
  }
  return fanout;
}

export function annotateGatePlan(plan, { map, inventoryFiles = [], tagCounts = {}, now = new Date() } = {}) {
  const warnings = buildGateWarnings(plan, { map, inventoryFiles, now });
  const ruleStats = inventoryFiles.length > 0
    ? collectRuleCoverage(map, inventoryFiles).filter((rule) => plan.matchedOwners.includes(rule.id))
      .map((rule) => ({
        id: rule.id,
        productionModules: rule.productionModuleCount,
        matchedFiles: rule.matchedFiles.length,
        nodeTests: rule.nodeTestCount,
        suites: rule.suites,
      }))
    : [];
  return {
    ...plan,
    warnings,
    ruleStats,
    runtimeCanaries: plan.suites.map((suite) => suite.id).filter(isRuntimeCanarySuite),
    estimatedFanout: estimateRuntimeFanout(plan, tagCounts),
  };
}

function compactReadingSet(value) {
  return {
    files: value?.files || [],
    estimatedBytes: Number(value?.estimatedBytes) || 0,
  };
}

export function compactGatePlan(plan) {
  const capabilityContext = plan.capabilityContext || {
    domains: [],
    defaultLevel: "contract",
    owners: [],
    contract: { files: [], estimatedBytes: 0 },
    implementationFiles: { files: [], estimatedBytes: 0 },
    focusedTests: { files: [], estimatedBytes: 0 },
    requiredDocs: { files: [], estimatedBytes: 0, sections: [] },
    implementation: { files: [], estimatedBytes: 0 },
    unmatchedFiles: [],
    unmatchedDomains: [],
    missingFiles: [],
  };
  return {
    changedFiles: plan.changedFiles,
    matchedOwners: plan.matchedOwners || [],
    nodeTests: plan.selectedNodeTests,
    changedSpecs: plan.selectedChangedSpecs || {},
    runtimeCanaries: plan.runtimeCanaries || [],
    estimatedFanout: plan.estimatedFanout || {
      nodeFiles: plan.selectedNodeTests.length,
      browserTests: 0,
      electronTests: 0,
    },
    warnings: (plan.warnings || []).map((warning) => ({
      code: warning.code,
      message: warning.message,
      blocking: Boolean(warning.blocking),
    })),
    capabilityContext: {
      domains: capabilityContext.domains || [],
      defaultLevel: capabilityContext.defaultLevel || "contract",
      owners: capabilityContext.owners || [],
      contract: compactReadingSet(capabilityContext.contract),
      implementationFiles: compactReadingSet(capabilityContext.implementationFiles),
      focusedTests: compactReadingSet(capabilityContext.focusedTests),
      requiredDocs: {
        ...compactReadingSet(capabilityContext.requiredDocs),
        sections: Array.isArray(capabilityContext.requiredDocs?.sections)
          ? capabilityContext.requiredDocs.sections
          : [],
      },
      implementation: compactReadingSet(capabilityContext.implementation),
      unmatchedFiles: capabilityContext.unmatchedFiles || [],
      unmatchedDomains: capabilityContext.unmatchedDomains || [],
      missingFiles: capabilityContext.missingFiles || [],
    },
  };
}

export function omitMissingNodeTests(plan, exists) {
  const selectedNodeTests = plan.selectedNodeTests.filter((file) => exists(file));
  if (selectedNodeTests.length === plan.selectedNodeTests.length) return plan;
  const suites = selectedNodeTests.length === 0
    ? plan.suites.filter((suite) => suite.id !== "node-targeted")
    : plan.suites;
  return { ...plan, selectedNodeTests, suites };
}

export function assertFullyAutomatedPlan(plan) {
  const prohibited = /(?:manual|human|人工|真人|手工|checklist)/iu;
  for (const suite of plan.suites) {
    if (prohibited.test(`${suite.id} ${suite.description}`)) {
      throw new Error(`Interactive test suite is prohibited: ${suite.id}`);
    }
  }
  return plan;
}
