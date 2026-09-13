import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { nodeTestGroups } from "./test-node-group.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

export const PLAYWRIGHT_EXECUTION_LANES = Object.freeze([
  { id: "browser-full", config: "tests/e2e/browser/playwright.config.mjs", stage: "ready-full" },
  { id: "browser-dom-editing-compatibility", config: "tests/e2e/browser/playwright.real-html.config.mjs", stage: "ready-full" },
  { id: "electron-native", config: "tests/e2e/electron/playwright.config.mjs", stage: "ready-full" },
  { id: "electron-ai", config: "tests/e2e/electron/playwright.ai-closed-loop.config.mjs", stage: "ready-full" },
  { id: "electron-ci-preflight", config: "tests/e2e/electron/playwright.ci-preflight.config.mjs", stage: "ready-full" },
  { id: "electron-review-annotation", config: "tests/e2e/electron/playwright.review-annotation.config.mjs", stage: "on-demand" },
  { id: "electron-packaged", config: "tests/e2e/electron/playwright.packaged.config.mjs", stage: "release" },
  { id: "electron-packaged-startup", config: "tests/e2e/electron/playwright.packaged-startup.config.mjs", stage: "release" },
  { id: "browser-smoke", config: "tests/e2e/browser/playwright.smoke.config.mjs", stage: "draft-canary" },
  { id: "electron-smoke", config: "tests/e2e/electron/playwright.smoke.config.mjs", stage: "draft-canary" },
  { id: "ai-smoke", config: "tests/e2e/electron/playwright.ai-smoke.config.mjs", stage: "draft-canary" },
]);

async function walk(directory, matches = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, matches);
    else if (entry.isFile() && (entry.name.endsWith(".spec.mjs") || entry.name.endsWith(".gate.mjs"))) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function parseSpecTests(source, file) {
  const tests = [];
  const pattern = /^test(?:\.(?:skip|only|fixme))?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gmu;
  let match;
  while ((match = pattern.exec(source))) {
    const title = match[2].replaceAll("\\n", " ").replaceAll("\\'", "'");
    const after = source.slice(match.index, match.index + 400);
    const tags = [...after.matchAll(/"(@[a-z0-9-]+)"/gu)].map((item) => item[1]);
    tests.push({
      title,
      tags: [...new Set(tags.filter((tag) => tag.startsWith("@smoke-") || tag === "@gate-smoke" || tag === "@infra-sensitive"))],
    });
  }
  return tests.map((test) => ({ file, ...test }));
}

function matchesTestMatch(fileName, testMatch) {
  const patterns = Array.isArray(testMatch) ? testMatch : [testMatch];
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(fileName);
    if (typeof pattern === "string") return fileName.includes(pattern) || fileName === pattern;
    return false;
  });
}

async function filesForLane(root, lane) {
  const configModule = await import(pathToFileURL(path.join(root, lane.config)).href);
  const config = configModule.default;
  const testDir = config.testDir || path.dirname(path.join(root, lane.config));
  const testMatch = config.testMatch;
  const files = (await walk(testDir))
    .filter((file) => matchesTestMatch(path.basename(file), testMatch))
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .sort();
  return { ...lane, files };
}

export async function collectExecutionPlan(root = productRoot) {
  const lanes = [];
  for (const lane of PLAYWRIGHT_EXECUTION_LANES) {
    lanes.push(await filesForLane(root, lane));
  }
  const filesByStage = {};
  for (const lane of lanes) {
    const bucket = filesByStage[lane.stage] || new Set();
    for (const file of lane.files) bucket.add(file);
    filesByStage[lane.stage] = bucket;
  }
  return {
    lanes,
    filesByStage: Object.fromEntries(
      Object.entries(filesByStage).map(([stage, files]) => [stage, [...files].sort()]),
    ),
  };
}

export async function collectTestInventory(root = productRoot) {
  const discovered = (await walk(path.join(root, "tests/e2e")))
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .sort();
  const specFiles = discovered.filter((file) => file.endsWith(".spec.mjs"));
  const gateFiles = discovered.filter((file) => file.endsWith(".gate.mjs"));
  const playwright = [];
  for (const file of specFiles) {
    const source = await readFile(path.join(root, file), "utf8");
    playwright.push(...parseSpecTests(source, file));
  }
  const groups = await nodeTestGroups(path.join(root, "tests"));
  const node = Object.fromEntries(
    Object.entries(groups).map(([group, files]) => [
      group,
      files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort(),
    ]),
  );
  const execution = await collectExecutionPlan(root);
  return {
    generatedBy: "scripts/generate-test-inventory.mjs",
    specFiles,
    gateFiles,
    playwright,
    node,
    execution,
  };
}

function missingReadmeSpecs(readme, specFiles) {
  const mentioned = [...readme.matchAll(/`([a-z0-9.-]+\.spec\.mjs)`/gu)].map((item) => item[1]);
  return mentioned.filter((name) => !specFiles.some((file) => file.endsWith(`/${name}`) || file.endsWith(name)));
}

export async function assertTestInventory(root = productRoot) {
  const inventory = await collectTestInventory(root);
  const readme = await readFile(path.join(root, "tests/e2e/README.md"), "utf8");
  const missing = missingReadmeSpecs(readme, inventory.specFiles);
  if (missing.length > 0) {
    throw new Error(`E2E README lists specs that are not in the repository: ${missing.join(", ")}`);
  }
  if (inventory.playwright.length < 1) {
    throw new Error("Playwright inventory is empty.");
  }
  const compatibility = inventory.execution.lanes.find(
    (lane) => lane.id === "browser-dom-editing-compatibility",
  );
  if (!compatibility?.files.includes("tests/e2e/browser/real-complex-html.gate.mjs")) {
    throw new Error("DOM editing compatibility lane does not include real-complex-html.gate.mjs.");
  }
  const review = inventory.execution.lanes.find((lane) => lane.id === "electron-review-annotation");
  if (!review?.files.includes("tests/e2e/electron/review-annotation-clarity.spec.mjs")) {
    throw new Error("On-demand review annotation execution does not include review-annotation-clarity.spec.mjs.");
  }
  return inventory;
}

async function run() {
  const inventory = await assertTestInventory();
  const outputPath = path.join(productRoot, "tests/TEST_INVENTORY.json");
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(
    `${inventory.specFiles.length} spec files, ${inventory.playwright.length} Playwright tests, `
    + `${inventory.execution.lanes.length} execution lanes, ${inventory.node.full.length} Node tests\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
