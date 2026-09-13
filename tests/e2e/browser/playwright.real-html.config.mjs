import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import browserConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...browserConfig,
  testMatch: /real-complex-html\.gate\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/dom-editing-compatibility/results"),
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/dom-editing-compatibility/report"),
    }],
  ],
});
