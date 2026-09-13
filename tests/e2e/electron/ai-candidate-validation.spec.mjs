import { expect, test } from "@playwright/test";
import {
  ORIGINAL_TEXT,
  UPDATED_TEXT,
  addCommentAndSubmit,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  launchPageRoot,
  path,
  readFileSync,
  removeSourceFixture,
  runOfficialFinalizer,
  stopPageRoot,
  workingHtmlFiles,
  writeAiOutput,
} from "./ai-closed-loop-helpers.mjs";

test("a pre-load review navigation falls back without trusting the replacement page", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("review-navigation-fallback.html", (source) => source.replace(
    "  </main>",
    `    <section data-review-navigation-fallback>
      <h2>运行态导航安全回归</h2>
      <div id="review-navigation-chart"></div>
      <script>
        const reviewNavigationVariant = "before";
        document.querySelector("#review-navigation-chart").textContent = reviewNavigationVariant;
        const reviewReplacementHtml = '<!doctype html>'
          + '<html data-review-navigation-replacement="true"><body></body></html>';
        if (document.documentElement.dataset.pagerootReviewSide) {
          location.replace(
            "data:text/html;charset=utf-8," + encodeURIComponent(reviewReplacementHtml),
          );
        }
      </script>
    </section>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace(ORIGINAL_TEXT, UPDATED_TEXT)
      .replace(
        'const reviewNavigationVariant = "before";',
        'const reviewNavigationVariant = "after";',
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeReviewFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterReviewFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-preview-navigation-fallback",
        "true",
        { timeout: 30_000 },
      );
      await expect(frame.locator("html"))
        .not.toHaveAttribute("data-review-navigation-replacement", "true");
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-filter", "all");
    }
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-marker-types~="text"]',
    ).filter({ hasText: UPDATED_TEXT }).first()).toBeVisible();
    await expect(beforeReviewFrame.locator(
      "#review-navigation-chart",
    )).toBeEmpty();
    await expect(afterReviewFrame.locator(
      "#review-navigation-chart",
    )).toBeEmpty();
    await expect(afterReviewFrame.locator(
      '#review-navigation-chart[data-pageroot-review-confirmed="true"]',
    )).toHaveCount(0);
    await expect(launched.page.getByText("Script 源码调整", { exact: true }))
      .toHaveCount(0);
    await expect(launched.page.getByText(
      "审阅画布未能安全载入，可返回 AI 修改前后重试。",
      { exact: true },
    )).toHaveCount(0);
    await expect(launched.page.locator("header.workbench-header")
      .getByLabel("审阅工具", { exact: true })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toHaveCount(0);
    await afterReviewFrame.locator("html").evaluate(() => {
      location.replace("about:blank");
    });
    await expect(launched.page.getByTestId("review-visual-status")).toHaveCount(0);
    await launched.page.getByRole("button", { name: "收起会话面板" }).click();
    const pendingDecisionEntry = launched.page.getByRole("button", {
      name: "待决定",
      exact: true,
    });
    await expect(pendingDecisionEntry).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "采纳修改" }))
      .toHaveCount(0);
    await pendingDecisionEntry.click();
    await launched.page.getByRole("button", { name: "采用修改", exact: true }).click();
    await expect(launched.page.getByRole("dialog"))
      .not.toContainText("无法视觉验证");
    await launched.page.getByRole("button", { name: "继续审阅" }).click();
    await expect(beforeReviewFrame.locator("[data-pageroot-review-confirmed=\"true\"]"))
      .not.toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

for (const adopt of [true, false]) {
  test(`identical HTML survives restart in Review and explicit ${adopt ? "adoption" : "rejection"}`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const fixture = createSourceFixture(`identical-${adopt ? "adopt" : "reject"}.html`);
    let launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    try {
      const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
      const frozenInput = readFileSync(path.join(request.requestRoot, "input", "base", "index.html"));
      const controlRoot = path.dirname(path.dirname(request.requestRoot));
      const manifestPath = path.join(controlRoot, "manifest.json");
      writeAiOutput(request.requestRoot, (base) => base);
      runOfficialFinalizer(request.requestRoot, request.changeRequest);
      await expect(launched.page.getByRole("button", { name: "查看修改", exact: true }))
        .toBeVisible({ timeout: 30_000 });
      const candidateBytes = readFileSync(path.join(request.requestRoot, "candidate.json"));
      expect(readFileSync(path.join(request.requestRoot, "candidate.html")).equals(frozenInput)).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).versions).toHaveLength(1);

      await closePageRootGracefully(launched.electronApp, launched.page);
      launched = await launchPageRoot({ activeSourcePath: request.sourcePath,
        isolatedUserData: launched.isolatedUserData });
      const reviewEntry = launched.page.getByRole("button", { name: "审阅，有 AI 修改待查看", exact: true });
      await expect(reviewEntry).toBeEnabled({ timeout: 30_000 });
      await reviewEntry.click();
      await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
      await expect(launched.page.getByTestId("review-empty-changes"))
        .toHaveText("前后 HTML 内容相同。");
      for (const title of ["修改前", "修改后"]) {
        const frame = launched.page.frameLocator(`iframe[title^="${title}"]`);
        await expect(frame.locator("body")).toBeVisible();
        await expect(frame.locator("[data-pageroot-review-marker], [data-pageroot-review-overlay-box], [data-pageroot-review-mask-hole]"))
          .toHaveCount(0);
      }
      expect(readFileSync(path.join(request.requestRoot, "candidate.json")).equals(candidateBytes)).toBe(true);
      await launched.page.screenshot({ path: testInfo.outputPath("identical-review.png"), animations: "disabled" });
      await launched.page.getByRole("button", { name: "采用修改", exact: true }).click();
      const confirmation = launched.page.getByRole("dialog", { name: /采纳 AI 修改后/u });
      await expect(confirmation).toContainText("HTML 内容相同，采纳后仍会创建正式版本，并归档本轮已提交且未再修改的要求。");
      await launched.page.screenshot({ path: testInfo.outputPath("identical-adoption-confirmation.png"), animations: "disabled" });
      if (adopt) {
        await confirmation.getByRole("button", { name: "确认并采纳" }).click();
      } else {
        await confirmation.getByRole("button", { name: "继续审阅" }).click();
        await launched.page.getByRole("button", { name: "不用这次", exact: true }).click();
        await launched.page.getByRole("dialog", { name: /返回 AI 修改前/u })
          .getByRole("button", { name: "返回修改前版本" }).click();
      }
      await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
      await expect.poll(() => JSON.parse(readFileSync(manifestPath, "utf8")).versions.length)
        .toBe(adopt ? 2 : 1);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.workingCopies).toHaveLength(adopt ? 2 : 1);
      expect(readFileSync(request.sourcePath).equals(frozenInput)).toBe(true);
      expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
      await expect.poll(() => launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject()))
        .toMatchObject({ sourcePath: adopt ? expect.stringMatching(/-V2\.html$/u) : request.sourcePath });
      const active = await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject());
      expect(readFileSync(active.sourcePath).equals(frozenInput)).toBe(true);
      if (adopt) await expect(launched.page.locator(".comment-card")).toHaveCount(0);
      else await expect(launched.page.locator(".comment-card")).not.toHaveCount(0);
    } finally {
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}

test("output without the mandatory finalizer never creates or opens a version", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible();
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a malformed AI HTML return is rejected before completion or opening", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      () => `<html><body><p>${UPDATED_TEXT}</p>`,
    );
    expect(() => runOfficialFinalizer(request.requestRoot, request.changeRequest))
      .toThrow(/INVALID_HTML_DOCUMENT|complete HTML document/u);
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    expect(existsSync(path.join(attemptRoot, "completion.json"))).toBe(false);
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible();
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an AI return cannot drop a retained source identity", { tag: ["@smoke-review"] }, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-identity-loss.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      /\sdata-pageroot-id="pr1_[a-f0-9]{32}"/u,
      "",
    ));
    expect(() => runOfficialFinalizer(request.requestRoot, request.changeRequest))
      .toThrow(/CANDIDATE_SOURCE_IDENTITY_LOST/u);
    expect(existsSync(path.join(request.requestRoot, "attempts", "attempt_001", "completion.json"))).toBe(false);
    const requestRecord = JSON.parse(readFileSync(path.join(request.requestRoot, "request.json"), "utf8"));
    expect(requestRecord.status).not.toBe("error");
    expect(existsSync(path.join(request.requestRoot, "candidate.json"))).toBe(false);
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    // The same copied task can be corrected without exposing a terminal ID error.
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an AI return cannot replace a retained source identity with a forged ID", { tag: ["@smoke-review"] }, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-identity-forgery.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      /data-pageroot-id="pr1_[a-f0-9]{32}"/u,
      'data-pageroot-id="pr1_ffffffffffff4fff8fffffffffffffff"',
    ));
    expect(() => runOfficialFinalizer(request.requestRoot, request.changeRequest))
      .toThrow(/CANDIDATE_SOURCE_IDENTITY_FORGED/u);
    expect(existsSync(path.join(request.requestRoot, "attempts", "attempt_001", "completion.json"))).toBe(false);
    const requestRecord = JSON.parse(readFileSync(path.join(request.requestRoot, "request.json"), "utf8"));
    expect(requestRecord.status).not.toBe("error");
    expect(existsSync(path.join(request.requestRoot, "candidate.json"))).toBe(false);
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    // The same copied task can be corrected without exposing a terminal ID error.
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
