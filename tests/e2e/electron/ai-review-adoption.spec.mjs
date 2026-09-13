import { expect, test } from "@playwright/test";
import {
  preserveCandidateSourceIdsForFixture,
} from "../../helpers/preserve-candidate-source-ids.mjs";
import {
  inspectSourceElementIdentity,
} from "../../../bridge/project-file-repository/working-copy.mjs";
import {
  LINE_SCOPE_AFTER,
  LINE_SCOPE_BEFORE,
  ORIGINAL_TEXT,
  OUTSIDE_MAIN_AFTER,
  OUTSIDE_MAIN_BEFORE,
  PICKER_TEXT,
  READABLE_REWRITE_AFTER,
  READABLE_REWRITE_BEFORE,
  REVIEW_MASK_UNION_BEFORE,
  REVIEW_METRIC_AFTER_CSS,
  REVIEW_METRIC_BEFORE_CSS,
  REVIEW_PROJECTION_CASES,
  SCOPE_PROMOTION_BEFORE,
  SECOND_UPDATED_TEXT,
  UPDATED_TEXT,
  addCommentAndSubmit,
  adoptReadyResult,
  assertActiveFocusPaintBudget,
  assertProjectionGeometryCase,
  assertReviewAcceptPersistence,
  assertReviewFocusPaint,
  assertReviewControlDefaults,
  assertReviewHasNoRuntimeVisualSupplement,
  caseSelector,
  candidateHtmlFiles,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  focusChangeById,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedProjectRootForId,
  mkdirSync,
  removeAiLoopUserData,
  removeSourceFixture,
  path,
  productRoot,
  readFileSync,
  realpathSync,
  rmSync,
  runOfficialFinalizer,
  sha256,
  stopPageRoot,
  workingHtmlFiles,
  writeAiOutput,
  writeFileSync,
} from "./ai-closed-loop-helpers.mjs";

async function activateReviewMarkerGroup(frame, marker) {
  const focusGroupId = await marker.evaluate((element) => {
    const changeId = element.getAttribute("data-pageroot-review-marker") || "";
    const facts = JSON.parse(
      element.getAttribute("data-pageroot-review-projection-facts") || "[]",
    );
    const fact = facts[0];
    const displayGroupId = fact?.displayGroupId || `display-fact-${fact?.id || ""}`;
    return fact?.structureChange === "style"
      ? `focus-${displayGroupId}`
      : `focus-${changeId}-${displayGroupId}`;
  });
  expect(focusGroupId).toBeTruthy();
  if (await frame.locator("html").getAttribute("data-pageroot-review-focus-group") === focusGroupId) {
    return focusGroupId;
  }
  await frame.locator(
    `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${focusGroupId}"]`,
  ).first().evaluate((bar) => bar.click());
  await expect(frame.locator("html"))
    .toHaveAttribute("data-pageroot-review-focus-group", focusGroupId);
  return focusGroupId;
}

test("a verified AI result stays pending through desktop review until the user accepts it", {
  tag: ["@gate-smoke","@smoke-review", "@smoke-version-display"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("generated-ai-loop.html", (source) => source.replace(
    "  </main>",
    `    <style data-review-metric-theme>${REVIEW_METRIC_BEFORE_CSS}    </style>
    <section data-review-regression>
      <h2>核心结论</h2>
      <div data-review-regression-summary>在守住 EBITA 率底线的基础上，锁单确收实现 +8.52% 增长；21 天日均增量 +4.12 万，累计增量 +86.6 万。</div>
      <div data-review-semantic-copy>而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。</div>
      <div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_BEFORE}</div>
      <p data-review-line-scope style="width: 360px; white-space: nowrap; line-height: 1.7">${LINE_SCOPE_BEFORE}</p>
      <p data-review-scope-promotion style="width: 360px; line-height: 1.7">${SCOPE_PROMOTION_BEFORE}</p>
      <p data-review-layout-only style="width: 240px; padding: 4px; border: 1px solid #c9ceda">同一段文字保持不变<br>只是换行位置调整。</p>
      <p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，稳定后缀。</p>
      <p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。</p>
      <style data-review-marker-style>[data-review-injection-stability] span { display:block !important; padding:9px !important; }</style>
      <style data-review-projection-style>div, svg { outline:7px solid rgb(255 0 153) !important; }</style>
      <p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>旧词</strong><em data-review-stable-right>稳定右侧</em></p>
      <p class="review-comment-ordinary-target">普通段落评论定位保持独立。</p>
      <script>
        const ordinaryCommentTarget = document.querySelector(".review-comment-ordinary-target");
        const ordinaryCommentSibling = document.createElement("p");
        ordinaryCommentSibling.className = ordinaryCommentTarget.className;
        ordinaryCommentSibling.textContent = "运行时插入的同类段落";
        ordinaryCommentTarget.before(ordinaryCommentSibling);
      </script>
      <div data-review-metrics>
        <article data-review-metric="lock"><strong>+8.52%</strong><span>锁单确收增幅（显著 p&lt;0.01）</span><small>日均 52.5 万 vs 48.4 万</small></article>
        <article data-review-metric="ipv"><strong>+4.49%</strong><span>IPV 增幅（显著 p&lt;0.01）</span><small>日均 63.4 万 vs 60.7 万</small></article>
        <article data-review-metric="cvr"><strong>+6.85%</strong><span>CVR 增幅（显著 p&lt;0.01）</span><small>0.217% vs 0.203%</small></article>
      </div>
      <div data-review-inherited-copy style="width: 420px; padding: 24px; border: 2px solid #b8b8c7">内容级视觉调整</div>
      <div data-review-logical-card style="padding: 12px; border: 2px solid #b8b8c7">逻辑尺寸视觉调整</div>
${REVIEW_MASK_UNION_BEFORE}
      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <img data-review-atomic-removed alt="旧品牌图示" src="data:image/svg+xml,%3Csvg/%3E" width="28" height="20">
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#8aa4c8"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:1px solid #9aa4b2">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>
      <div data-review-mixed-copy>
        <p data-review-reference>参考：示例日均确收约207万，增量4.12万/天约占2.0%。</p>
        <p data-review-delete-only>实验结果稳定。换言之，策略有效。</p>
        <p data-review-warning>⚠️ 近6天(7/23-<span><strong>7/28)增幅收窄至负值区间，需</strong></span>持续关注。</p>
      </div>
      <div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。</div>
      <ol data-review-list-items>
        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li>
      </ol>
      <table data-review-brand-table style="table-layout:fixed;width:210px;word-break:break-all">
        <thead><tr><th style="width:42px">品牌</th><th>类目</th><th>对照组</th></tr></thead>
        <tbody>
          <tr data-review-brand-row="alpha"><td>品牌甲</td><td>类目一</td><td>3.7万</td></tr>
          <tr data-review-brand-row="beta"><td>品牌乙</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>
          <tr data-review-brand-row="delta"><td>品牌丁</td><td>类目二</td><td>3.7万</td></tr>
        </tbody>
      </table>
      <div data-review-break-layout><span>日均63<br><br>.4万<br>60.7万</span></div>
      <div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>待删除第一行<br>待删除第二行<br>待删除第三行<br>AI托管的核心价值保持不变。</div>
    </section>
    <section data-review-ebita-section>
      <h2>3EBITA分析</h2>
      <div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围<br>内（0.06~0.13pt），AI托管未恶化盈利能力。</div>
    </section>
    <section data-review-anchor-only-section>
      <h2>删除锚点导航</h2>
      <div style="height:280px" aria-hidden="true"></div>
      <p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>只删除这句定位文字。稳定结尾。</p>
      <div style="height:360px" aria-hidden="true"></div>
    </section>
    <div class="tabs" role="tablist" aria-label="Review interaction fixture">
      <button type="button" data-review-tab-button data-p="review-p1">审阅标签一</button>
      <button type="button" data-review-tab-button data-p="review-p2">审阅标签二</button>
    </div>
    <div data-review-priority><strong>优先顺序：</strong>先处理稳定性，再补齐体验细节。</div>
    <button type="button" id="review-counter" data-review-counter>交互计数 <span>0</span></button>
    <input id="review-sync-input" aria-label="审阅同步输入" value="">
    <div class="panel" id="review-p1" data-review-tab-panel="one">
      <article id="review-tab-one-overview"><h2>标签一概览</h2><p>第一块完整内容</p></article>
      <article id="review-tab-one-detail"><h2>标签一详情</h2><p>第二块完整内容</p></article>
    </div>
    <div class="panel" id="review-p2" data-review-tab-panel="two" hidden>
      <article><h2>标签二概览</h2><p>第三块完整内容</p></article>
      <article><h2>标签二详情</h2><p>第四块完整内容</p></article>
    </div>
    <div class="panels" data-review-anonymous-panels>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="one">匿名面板甲内容</p></article><article><p>匿名面板稳定说明</p></article></div>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="two">匿名面板乙内容</p></article><article><p>匿名面板稳定说明</p></article></div>
    </div>
    <div class="indexed-review-tabs">
      <button type="button" class="indexed-review-tab active" onclick="switchIndexedReviewTab(0)">分行业表现</button>
      <button type="button" class="indexed-review-tab" onclick="switchIndexedReviewTab(1)">抖音搜盘表现</button>
    </div>
    <div class="indexed-review-panels">
      <section id="indexed-review-panel-one" class="indexed-review-panel active" style="display: block; min-height: 240px">
        <h2>分行业表现</h2><p>索引式页签第一页</p>
      </section>
      <section id="indexed-review-panel-two" class="indexed-review-panel" style="display: none; min-height: 960px">
        <h2>抖音搜盘表现</h2><p>索引式页签第二页</p>
      </section>
    </div>
    <script>
      document.querySelectorAll("[data-review-tab-button]").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelectorAll("[data-review-tab-panel]").forEach((panel) => {
            panel.hidden = panel.id !== button.dataset.p;
          });
        });
      });
      document.querySelector("[data-review-counter]").addEventListener("click", (event) => {
        const button = event.currentTarget;
        const nextCount = Number(button.dataset.count || 0) + 1;
        button.dataset.count = String(nextCount);
        button.querySelector("span").textContent = String(nextCount);
      });
      function switchIndexedReviewTab(activeIndex) {
        document.querySelectorAll(".indexed-review-tab").forEach((tab, index) => {
          tab.classList.toggle("active", index === activeIndex);
        });
        document.querySelectorAll(".indexed-review-panel").forEach((panel, index) => {
          panel.classList.toggle("active", index === activeIndex);
          panel.style.display = index === activeIndex ? "block" : "none";
        });
      }
      document.documentElement.dataset.reviewFixtureReady = "true";
    </script>
  </main>`,
  ));
  const pickerSourcePath = path.join(fixture.sourceDirectory, "picker-target.html");
  writeFileSync(
    pickerSourcePath,
    fixtureBuffer("complex-layout.html")
      .toString("utf8")
      .replace(ORIGINAL_TEXT, PICKER_TEXT),
    "utf8",
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const ordinaryReviewCommentText = "这个普通段落也请保留。";
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
      UPDATED_TEXT,
      [{
        text: ordinaryReviewCommentText,
        targetSelector: ".review-comment-ordinary-target[data-pageroot-id]",
      }],
    );
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    writeFileSync(path.join(attemptRoot, ".DS_Store"), "Finder metadata");
    writeFileSync(
      path.join(attemptRoot, "output", ".DS_Store"),
      "Finder metadata",
    );
    await launched.page.waitForTimeout(3_500);
    // The stages are narrated in the conversation now; the process panel is out of the
    // user flow, so its board no longer exists to assert against.
    const runProgress = launched.page.getByTestId("ai-conversation-run-progress");
    await expect(runProgress).toContainText("等待你的 AI 完成修改");
    await expect(runProgress.locator("li")).toHaveCount(0);
    writeAiOutput(request.requestRoot, (base) => {
      expect(base.match(new RegExp(ORIGINAL_TEXT, "gu"))).toHaveLength(1);
      const anonymousPanelOne = base.match(
        /      <div class="panel" role="tabpanel"[^>]*><article[^>]*><p data-review-anonymous-panel-copy="one"[^>]*>[\s\S]*?<\/div>/u,
      )?.[0];
      const anonymousPanelTwo = base.match(
        /      <div class="panel" role="tabpanel"[^>]*><article[^>]*><p data-review-anonymous-panel-copy="two"[^>]*>[\s\S]*?<\/div>/u,
      )?.[0];
      const layoutOnly = base.match(/<p data-review-layout-only[\s\S]*?<\/p>/u)?.[0];
      const atomicMedia = base.match(/      <div data-review-atomic-media[\s\S]*?\n      <\/div>/u)?.[0];
      const warning = base.match(/<p data-review-warning[\s\S]*?<\/p>/u)?.[0];
      const breakLayout = base.match(/<div data-review-break-layout[\s\S]*?<\/div>/u)?.[0];
      const deletedCopy = base.match(/<div data-review-deleted-copy[\s\S]*?<\/div>/u)?.[0];
      const ebitaCopy = base.match(/<div data-review-ebita-copy[\s\S]*?<\/div>/u)?.[0];
      const anchorOnly = base.match(/<p data-review-anchor-only[\s\S]*?<\/p>/u)?.[0];
      const tabOneOverview = base.match(/<article id="review-tab-one-overview"[\s\S]*?<\/article>/u)?.[0];
      const tabOneDetail = base.match(/<article id="review-tab-one-detail"[\s\S]*?<\/article>/u)?.[0];
      const tabTwoDetail = base.match(/<article[^>]*><h2[^>]*>标签二详情<\/h2>[\s\S]*?<\/article>/u)?.[0];
      expect(anonymousPanelOne).toBeTruthy();
      expect(anonymousPanelTwo).toBeTruthy();
      expect(layoutOnly).toBeTruthy();
      expect(atomicMedia).toBeTruthy();
      expect(warning).toBeTruthy();
      expect(breakLayout).toBeTruthy();
      expect(deletedCopy).toBeTruthy();
      expect(ebitaCopy).toBeTruthy();
      expect(anchorOnly).toBeTruthy();
      expect(tabOneOverview).toBeTruthy();
      expect(tabOneDetail).toBeTruthy();
      expect(tabTwoDetail).toBeTruthy();
      const changedLayoutOnly = layoutOnly
        .replace(
          'style="width: 240px; padding: 4px; border: 1px solid #c9ceda"',
          'style="width: 240px; padding: 14px; border: 3px solid #6d5ce7"',
        )
        .replace(/<br data-pageroot-id="pr1_[a-f0-9]{32}">/u, "")
        .replace("只是换行位置调整。", "只是<br>换行位置调整。");
      const changedAtomicMedia = atomicMedia
        .replace(/\s*<img data-review-atomic-removed[^>]*>/u, "")
        .replace(
          /(<span data-review-atomic-stable-before[^>]*>稳定媒体前文。<\/span>)/u,
          '$1\n        <canvas data-review-atomic-added aria-label="新增画布图" width="28" height="20"></canvas>',
        )
        .replace('fill="#8aa4c8"', 'fill="#d26a81"')
        .replace(
          'style="width:60px;border:1px solid #9aa4b2"',
          'style="width:60px;border:3px solid #6d5ce7"',
        );
      const changedWarning = warning.replace(
        />[\s\S]*<\/p>/u,
        '>⚠️ 近6天（7/23—<strong>7/28）增幅收窄至负值区间，需</strong>持续关注定价调整和转化波动。</p>',
      );
      const changedBreakLayout = breakLayout.replace(
        />[\s\S]*<\/div>/u,
        ">日均63.4万 vs 60.7万</div>",
      );
      const changedDeletedCopy = deletedCopy.replace(
        />[\s\S]*<\/div>/u,
        "><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>AI托管的核心价值保持不变，并应继续关注留存质量。</div>",
      );
      const changedEbitaCopy = ebitaCopy.replace(
        />[\s\S]*<\/div>/u,
        "><strong>结论：</strong>EBITA差异均在波动范围内（0.06~0.13pt），AI托管未恶化盈利能力，建议继续保留实验策略。</div>",
      );
      const changedAnchorOnly = anchorOnly.replace(
        /(<br data-pageroot-id="pr1_[a-f0-9]{32}">)只删除这句定位文字。/u,
        "$1",
      );
      const changedTabTwoDetail = tabTwoDetail.replace(
        "<article ",
        '<article style="padding: 24px; border-radius: 16px" ',
      );
      let candidate = base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(REVIEW_METRIC_BEFORE_CSS, REVIEW_METRIC_AFTER_CSS)
        .replace("border:2px solid #4a1111", "border:6px solid #6d5ce7")
        .replace("border:2px solid #114a11", "border:6px solid #d26a81")
        .replace(
          "      <div data-review-regression-summary",
          `      <div data-review-added-chart>
        <strong>实验效果概览</strong>
        <div><span>锁单确收</span><progress max="100" value="82"></progress></div>
        <div><span>CVR</span><progress max="100" value="69"></progress></div>
        <p>读图：规模增长由转化效率提升与动销覆盖扩大共同驱动。</p>
      </div>
      <div data-review-regression-summary`,
        )
        .replace(
          /    <div data-review-priority[^>]*>[\s\S]*?<\/div>\n/u,
          "",
        )
        .replace("增量4.12万/天约占2.0%", "本实验增量4.12万/天约占2.0%")
        .replace("实验结果稳定。换言之，策略有效。", "实验结果稳定。策略有效。")
        .replace("③ 经营解读：效率保持稳定。", "③ 经营解读：效率保持稳定。<br>④ 后续重点：继续观察新增商品。")
        .replace("经营效率稳定</li>", "经营效率稳定</li><li data-review-added-list-item>后续观察新增商品</li>")
        .replace(
          '          <tr data-review-brand-row="gamma"',
          `          <tr data-review-brand-row="added"><td>品牌新增</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"`,
        )
        .replace("品均基本持平", "单品效率整体稳定，增幅仅+0.10%")
        .replace(READABLE_REWRITE_BEFORE, READABLE_REWRITE_AFTER)
        .replace(LINE_SCOPE_BEFORE, LINE_SCOPE_AFTER)
        .replace(layoutOnly, changedLayoutOnly)
        .replace("稳定前缀，稳定后缀。", "稳定前缀，新增说明需要跨越多个实际文字行并合并为一个框，稳定后缀。")
        .replace("旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。", "新方案改写全部口径、执行路径、验证方式，并补充另一组较长说明。")
        .replace("旧词", "新词")
        .replace(atomicMedia, changedAtomicMedia)
        .replace(warning, changedWarning)
        .replace(breakLayout, changedBreakLayout)
        .replace(deletedCopy, changedDeletedCopy)
        .replace(ebitaCopy, changedEbitaCopy)
        .replace(anchorOnly, changedAnchorOnly)
        .replace(
          `${tabOneOverview}\n      ${tabOneDetail}`,
          `${tabOneDetail}\n      ${tabOneOverview}`,
        )
        .replace(tabTwoDetail, changedTabTwoDetail)
        .replace(
          `${anonymousPanelOne}\n${anonymousPanelTwo}`,
          `${anonymousPanelTwo}\n${anonymousPanelOne}`,
        );
      for (const [beforeText, afterText] of [
        ["甲旧", "甲新"], ["乙旧", "乙新"], ["丙旧", "丙新"],
        ["丁旧", "丁新"], ["戊旧", "戊新"], ["己旧", "己新"],
        ["庚旧", "庚新"], ["辛旧", "辛新"], ["壬旧", "壬新"],
      ]) candidate = candidate.replace(beforeText, afterText);
      return preserveCandidateSourceIdsForFixture(base, candidate);
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    // The result is reported in the conversation; the process panel is out of the flow.
    const readyDecision = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(readyDecision).toBeVisible({ timeout: 30_000 });
    await expect(readyDecision).toContainText("修改已准备好，尚未采用");
    await expect(runProgress).toHaveCount(0);
    const candidateRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "candidate.json"),
      "utf8",
    ));
    const normalizedCandidateHtml = readFileSync(
      path.join(request.requestRoot, "candidate.html"),
      "utf8",
    );
    expect(candidateRecord.identityReport.status).toBe("verified");
    expect(candidateRecord.identityReport.retainedElementCount).toBeGreaterThan(0);
    expect(candidateRecord.identityReport.deletedElementCount).toBeGreaterThan(0);
    expect(candidateRecord.identityReport.assignedElementCount).toBeGreaterThan(0);
    expect(candidateRecord.submittedOutputSha256)
      .toBe(candidateRecord.identityReport.submittedOutputSha256);
    expect(candidateRecord.outputSha256).toBe(candidateRecord.identityReport.outputSha256);
    expect(candidateRecord.outputSha256).not.toBe(candidateRecord.submittedOutputSha256);
    expect(inspectSourceElementIdentity(normalizedCandidateHtml).complete).toBe(true);
    const pending = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(pending.sourcePath).toBe(realpathSync(
      workingHtmlFiles(launched.workspace, request.changeRequest.projectId)[0],
    ));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    const reviewWorkspace = launched.page.getByTestId("ai-review-workspace");
    await expect(reviewWorkspace).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByRole("group", { name: "工作模式", exact: true }))
      .toHaveAttribute("data-view-label", "审阅");
    await expect(launched.page.getByRole("tab", { selected: true })).toContainText("审阅");
    await expect(launched.page.getByRole("group", { name: "工作模式", exact: true })
      .getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
    const beforeReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改前"]',
    );
    const afterReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改后"]',
    );
    // Fresh Review performs one successful reading-position guide without
    // turning it into an explicit visual focus or outline.
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect.poll(async () => frame.locator("html").getAttribute(
        "data-pageroot-review-focus",
      ), { timeout: 30_000 }).toMatch(/^change-[a-z0-9-]+$/u);
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-focus-group", "");
      await expect(frame.locator("[data-pageroot-review-overlay-box]"))
        .toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-hole]"))
        .toHaveCount(0);
    }
    const initialNavigationTarget = await beforeReviewFrame.locator("html")
      .getAttribute("data-pageroot-review-focus");
    expect(initialNavigationTarget).toMatch(/^change-[a-z0-9-]+$/u);
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-focus", initialNavigationTarget);
    const reviewReloadRevision = Number(
      await reviewWorkspace.getAttribute("data-reload-revision"),
    );
    const reviewRefreshButton = launched.page.getByRole("button", { name: "刷新本页面" });
    await expect(reviewRefreshButton).toBeEnabled();
    await reviewRefreshButton.click();
    await expect(reviewWorkspace).toHaveAttribute(
      "data-reload-revision",
      String(reviewReloadRevision + 1),
    );
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    const diskReloadItem = launched.page.getByRole("menuitem", {
      name: /从磁盘重新载入 HTML/u,
    });
    await expect(diskReloadItem).toBeDisabled();
    await expect(diskReloadItem).toContainText(
      "请先采用或不用这次 AI 修改，再从磁盘重新载入",
    );
    await launched.page.keyboard.press("Escape");
    const reviewSidebar = reviewWorkspace.getByTestId("ai-conversation-sidebar");
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeVisible();
    const reviewAiEntry = launched.page.getByRole("button", { name: "AI 助手" });
    await expect(reviewAiEntry).toHaveAttribute("aria-expanded", "true");
    await expect(launched.page.getByTestId("review-show-conversation")).toHaveCount(0);
    await expect(reviewAiEntry).toHaveCount(1);
    await expect(reviewSidebar).toBeVisible();
    await expect(reviewAiEntry).toHaveAttribute("aria-expanded", "true");
    await expect(launched.page.locator(".toast")).toHaveCount(0);
    // 审阅工具固定复用工作台顶栏，不再在画布内提供第二套浮动条或收起把手。
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "显示并固定审阅工具" }))
      .toHaveCount(0);
    const sharedHeader = launched.page.locator("header.workbench-header");
    const liveReviewTools = sharedHeader.getByLabel("审阅工具", { exact: true });
    await expect(liveReviewTools).toBeVisible();
    const beforePaneHeader = launched.page.locator(
      'section[data-side="before"] > header',
    );
    await expect.poll(async () => {
      const [sharedHeaderBox, beforePaneHeaderBox] = await Promise.all([
        sharedHeader.boundingBox(),
        beforePaneHeader.boundingBox(),
      ]);
      if (!sharedHeaderBox || !beforePaneHeaderBox) return -1;
      return beforePaneHeaderBox.y - (sharedHeaderBox.y + sharedHeaderBox.height);
    }).toBeGreaterThanOrEqual(0);
    await assertReviewControlDefaults(
      launched.page,
      beforeReviewFrame,
      initialNavigationTarget,
    );
    const reviewDirectorySummary = reviewWorkspace.locator(
      'summary[aria-label^="变化目录，共"]',
    );
    const reviewDirectoryMenu = launched.page.getByLabel("变化目录", { exact: true });
    await reviewDirectorySummary.click();
    await expect(reviewDirectoryMenu).toBeVisible();
    await launched.page.keyboard.press("Escape");
    await expect(reviewDirectoryMenu).toBeHidden();
    await expect(reviewDirectorySummary).toBeFocused();
    await reviewDirectorySummary.click();
    const firstDirectoryTarget = reviewDirectoryMenu.getByRole("button").first();
    await firstDirectoryTarget.click();
    await expect(reviewDirectoryMenu).toBeHidden();
    await expect(reviewDirectorySummary).toBeFocused();
    // The second Escape leaves the explicit Review focus, after the directory
    // itself has already consumed the first one.
    await launched.page.keyboard.press("Escape");
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-author-script-ran", "true");
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await assertReviewHasNoRuntimeVisualSupplement(
      launched.page,
      beforeReviewFrame,
      afterReviewFrame,
    );
    await afterReviewFrame.locator("html").evaluate(() => {
      document.documentElement.dataset.reviewPostLoadNavigationAttempted = "true";
      location.replace(
        "data:text/html,<html data-review-post-load-replacement=true></html>",
      );
    });
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-post-load-navigation-attempted", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-review-post-load-replacement", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-pageroot-preview-navigation-fallback", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-filter", "all");
    await expect.poll(async () => afterReviewFrame.locator(
      "[data-review-anonymous-panel-copy]",
    ).evaluateAll((elements) => elements.map((element) => ({
      copy: element.getAttribute("data-review-anonymous-panel-copy"),
      changeId: element.closest("[data-pageroot-review-id]")
        ?.getAttribute("data-pageroot-review-id") || "",
      panelKey: element.closest('[data-pageroot-review-panel-container="true"]')
        ?.getAttribute("data-pageroot-review-panel-key") || "",
    })))).toEqual([
      expect.objectContaining({ copy: "two", changeId: expect.any(String) }),
      expect.objectContaining({ copy: "one", changeId: expect.any(String) }),
    ]);
    const anonymousPanelKeys = await afterReviewFrame.locator(
      "[data-review-anonymous-panel-copy]",
    ).evaluateAll((elements) => elements.map((element) => (
      element.closest('[data-pageroot-review-panel-container="true"]')
        ?.getAttribute("data-pageroot-review-panel-key") || ""
    )));
    expect(new Set(anonymousPanelKeys).size).toBe(2);
    await expect(beforeReviewFrame.locator('meta[http-equiv="refresh"]'))
      .toHaveCount(0);
    const reviewCommentMarkers = launched.page.locator(
      'section[data-side="before"] [data-testid="review-comment-marker"]',
    );
    await expect(reviewCommentMarkers).toHaveCount(2);
    const frozenReviewComment = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
    const reviewCommentMarker = reviewCommentMarkers.filter({
      hasText: frozenReviewComment,
    });
    await expect(reviewCommentMarker).toHaveCount(1);
    const ordinaryReviewCommentMarker = reviewCommentMarkers.filter({
      hasText: ordinaryReviewCommentText,
    });
    await expect(ordinaryReviewCommentMarker).toHaveCount(1);
    // 只读评论标记与 AI 预览共用同一个组件。它是可聚焦控件而不是静态说明，
    // 因为气泡是读到评论正文的唯一入口，键盘用户必须够得到。
    await expect(reviewCommentMarker).toHaveJSProperty("tagName", "BUTTON");
    await expect(reviewCommentMarker).toHaveAttribute(
      "data-comment-count",
      "1",
    );
    await expect(reviewCommentMarker).toHaveCSS("width", "30px");
    await expect(reviewCommentMarker).toHaveCSS("height", "30px");
    await expect(reviewCommentMarker).toHaveCSS("font-size", "15px");
    await expect(reviewCommentMarker).toHaveCSS("background-color", "rgb(98, 88, 214)");
    await expect(reviewCommentMarker).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(launched.page.locator(
      'section[data-side="after"] [data-testid="review-comment-marker"]',
    )).toHaveCount(0);
    await expect.poll(() => beforeReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    const beforeReviewViewport = launched.page.locator(
      'section[data-side="before"] [aria-label="修改前画布滚动区"]',
    );
    const reviewMarkerRailGeometry = async () => {
      const [markerBox, viewportBox] = await Promise.all([
        reviewCommentMarker.boundingBox(),
        beforeReviewViewport.boundingBox(),
      ]);
      if (!markerBox || !viewportBox) return null;
      return {
        markerRight: markerBox.x + markerBox.width,
        viewportRight: viewportBox.x + viewportBox.width,
      };
    };
    const railBeforeHorizontalScroll = await reviewMarkerRailGeometry();
    expect(railBeforeHorizontalScroll).not.toBeNull();
    expect(Math.abs(
      railBeforeHorizontalScroll.viewportRight - railBeforeHorizontalScroll.markerRight,
    )).toBeLessThanOrEqual(4);
    await beforeReviewViewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
    await expect.poll(async () => {
      const current = await reviewMarkerRailGeometry();
      return current && railBeforeHorizontalScroll
        ? Math.abs(current.markerRight - railBeforeHorizontalScroll.markerRight)
        : Infinity;
    }).toBeLessThanOrEqual(1);
    await beforeReviewFrame.locator(caseSelector("list-item"))
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect.poll(async () => {
      const [markerBox, viewportBox] = await Promise.all([
        reviewCommentMarker.boundingBox(),
        beforeReviewViewport.boundingBox(),
      ]);
      const scrollY = await launched.page.locator('section[data-side="before"]')
        .evaluate((element) => getComputedStyle(element).getPropertyValue(
          "--review-comment-scroll-y",
        ));
      return {
        inside: Boolean(markerBox && viewportBox
          && markerBox.y >= viewportBox.y
          && markerBox.y + markerBox.height <= viewportBox.y + viewportBox.height),
        markerBox,
        viewportBox,
        scrollY,
      };
    }).toMatchObject({ inside: true });
    await reviewCommentMarker.hover();
    const reviewCommentBubble = reviewCommentMarker.getByTestId("review-comment-bubble");
    await expect(reviewCommentBubble).toContainText(frozenReviewComment);
    await expect(reviewCommentBubble).toBeVisible();
    await expect(beforeReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(1);
    await expect(afterReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(1);
    await expect.poll(async () => {
      const [bubbleBox, viewportBox] = await Promise.all([
        reviewCommentBubble.boundingBox(),
        beforeReviewViewport.boundingBox(),
      ]);
      if (!bubbleBox || !viewportBox) return false;
      return bubbleBox.x >= viewportBox.x + 4
        && bubbleBox.x + bubbleBox.width <= viewportBox.x + viewportBox.width - 4;
    }).toBe(true);
    await reviewCommentBubble.hover();
    await expect(reviewCommentBubble).toBeVisible();
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-comment.png"),
        animations: "disabled",
      });
    }
    if (process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP) {
      const visibleToast = launched.page.locator(".toast.show");
      await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      if (await visibleToast.isVisible().catch(() => false)) {
        await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
        await expect(visibleToast).toBeHidden();
      }
      const captureDirectory = path.resolve(
        productRoot,
        process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP_DIR
          || path.join("output", "design-qa", "toolbar-cleanup"),
      );
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "05-review-toolbar.png"),
        animations: "disabled",
      });
    }
    await reviewCommentMarker.click();
    await expect(reviewCommentBubble).toBeHidden();
    await expect(beforeReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(0);
    await expect(afterReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(0);
    await launched.page.locator('section[data-side="before"] > header').hover();
    await reviewCommentMarker.hover();
    await expect(reviewCommentBubble).toBeVisible();
    await launched.page.locator('section[data-side="before"] > header').hover();
    await expect(reviewCommentBubble).toBeHidden();

    // 键盘聚焦打开同一个气泡；焦点离开前不消失。气泡绑的是
    // :focus-visible 而不是 :focus，所以先按一次 Tab 把输入模态切回键盘，
    // 否则前一步 hover 留下的指针模态会让焦点不可见。
    await launched.page.keyboard.press("Tab");
    await reviewCommentMarker.focus();
    await expect(reviewCommentBubble).toBeVisible();
    await expect(reviewCommentBubble).toContainText(frozenReviewComment);
    // 只读标记不响应 Enter/Space，不进入编辑、不打开编辑工具栏。
    await launched.page.keyboard.press("Enter");
    await launched.page.keyboard.press("Space");
    await expect(reviewCommentBubble).toBeVisible();
    const focusGroupsBeforeCommentEscape = await Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => (
        frame.locator("html").getAttribute("data-pageroot-review-focus-group")
      )),
    );
    await launched.page.keyboard.press("Escape");
    await expect(reviewCommentBubble).toBeHidden();
    await expect.poll(() => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => (
        frame.locator("html").getAttribute("data-pageroot-review-focus-group")
      )),
    )).toEqual(focusGroupsBeforeCommentEscape);
    await reviewCommentMarker.blur();
    await launched.page.keyboard.press("Tab");
    await reviewCommentMarker.focus();
    await expect(reviewCommentBubble).toBeVisible();
    await ordinaryReviewCommentMarker.hover();
    await expect.poll(() => beforeReviewFrame.locator(
      "[data-pageroot-review-comment-highlight]",
    ).count()).toBeGreaterThan(0);
    await launched.page.locator('section[data-side="before"] > header').hover();
    // Leaving the second marker must not clear the first marker that still owns
    // keyboard focus. The parent active-key set owns the combined highlight.
    await expect(beforeReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(1);
    await expect(launched.page.locator(
      'section[data-side="before"] [data-testid="review-comment-marker"]',
    )).toHaveCount(2);
    await reviewCommentMarker.blur();
    await expect(reviewCommentBubble).toBeHidden();
    await expect(beforeReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(0);
    await expect(afterReviewFrame.locator("[data-pageroot-review-comment-highlight]"))
      .toHaveCount(0);
    // 接下来继续操作始终固定在工作台顶栏中的审阅控件。
    await expect(liveReviewTools).toBeVisible();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeHidden();
    await beforeReviewFrame.getByRole("button", { name: "审阅标签二" })
      .evaluate((button) => button.click());
    await expect.poll(async () => beforeReviewFrame.locator("html").evaluate(() => {
      const transitioning = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      );
      return !transitioning || (
        document.querySelectorAll("[data-pageroot-review-transition-mask]").length === 1
        && document.querySelectorAll("[data-pageroot-review-projection-layer]").length === 0
      );
    })).toBe(true);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => (
        !document.documentElement.hasAttribute("data-pageroot-review-transitioning")
      ))),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const filter = document.documentElement.dataset.pagerootReviewFilter || "all";
        return [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
          .filter((box) => !String(
            box.getAttribute("data-pageroot-review-fact") || "",
          ).startsWith("style:runtime-projection-"))
          .every((box) => {
            const changeId = box.getAttribute("data-pageroot-review-overlay-box");
            return [...document.querySelectorAll(
              '[data-pageroot-review-marker="' + changeId + '"]',
            )].some((marker) => {
              const markerTypes = String(
                marker.getAttribute("data-pageroot-review-marker-types") || "",
              ).split(/\s+/u);
              const matchesFilter = filter === "all" || markerTypes.includes(filter);
              if (!matchesFilter) return false;
              if (markerTypes.includes("text")) {
                const range = document.createRange();
                range.selectNodeContents(marker);
                const visible = [...range.getClientRects()]
                  .some((rect) => rect.width > 1 && rect.height > 1);
                range.detach();
                return visible;
              }
              return [...marker.getClientRects()]
                .some((rect) => rect.width > 1 && rect.height > 1);
            });
          });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await beforeReviewFrame.getByRole("button", { name: "审阅标签一" })
      .evaluate((button) => button.click());
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => (
        !document.documentElement.hasAttribute("data-pageroot-review-transitioning")
      ))),
    ).then((states) => states.every(Boolean))).toBe(true);
    await assertReviewHasNoRuntimeVisualSupplement(
      launched.page,
      beforeReviewFrame,
      afterReviewFrame,
    );
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await afterReviewFrame.getByRole("button", { name: "抖音搜盘表现" })
      .evaluate((button) => button.click());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );
      const layer = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      )
        ? document.querySelector("[data-pageroot-review-transition-mask]")
        : document.querySelector("[data-pageroot-review-projection-layer]");
      return Boolean(layer && layer.getBoundingClientRect().height >= documentHeight - 1);
    })).toBe(true);
    await expect(afterReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
    const beforeCounter = beforeReviewFrame.locator("[data-review-counter]");
    const afterCounter = afterReviewFrame.locator("[data-review-counter]");
    await beforeCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "1");
    await expect(afterCounter).toHaveAttribute("data-count", "1");
    await beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("双页动作同步");
    await expect(afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("双页动作同步");
    await launched.page.getByRole("button", { name: "独立滚动" }).click();
    await afterCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "2");
    await expect(afterCounter).toHaveAttribute("data-count", "2");
    await afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("反向动作同步");
    await expect(beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("反向动作同步");
    await launched.page.getByRole("button", { name: "同步滚动" }).click();
    await afterReviewFrame.locator("[data-pageroot-review-region-bar]").first().click();
    await assertReviewFocusPaint(beforeReviewFrame, afterReviewFrame);
    await expect.poll(() => afterReviewFrame.locator(
      "[data-pageroot-review-mask-hole]",
    ).count()).toBe(1);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-pageroot-review-overlay-box]",
      ).evaluateAll((boxes) => {
        const validLabel = (label) => {
          const text = label?.textContent?.trim() || "";
          return text.length >= 2 && text.length <= 40 && !text.includes("×");
        };
        return boxes.length <= 1 && boxes.every((box) => {
          const labels = box.querySelectorAll("[data-pageroot-review-overlay-label]");
          return labels.length <= 1 && (labels.length === 0 || validLabel(labels[0]));
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    const nestedOverlayPairs = await afterReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).evaluateAll((boxes) => boxes.flatMap((outer, outerIndex) => {
      const outerRect = outer.getBoundingClientRect();
      return boxes.flatMap((inner, innerIndex) => {
        if (outerIndex === innerIndex) return [];
        const innerRect = inner.getBoundingClientRect();
        const sameOwner = outer.getAttribute("data-pageroot-review-semantic-owner")
          === inner.getAttribute("data-pageroot-review-semantic-owner");
        const sameFact = outer.getAttribute("data-pageroot-review-fact")
          === inner.getAttribute("data-pageroot-review-fact");
        const nested = outer.getAttribute("data-pageroot-review-overlay-box")
          === inner.getAttribute("data-pageroot-review-overlay-box")
          && sameOwner
          && sameFact
          && innerRect.width * innerRect.height < outerRect.width * outerRect.height * .86
          && innerRect.left >= outerRect.left - 2
          && innerRect.top >= outerRect.top - 2
          && innerRect.right <= outerRect.right + 2
          && innerRect.bottom <= outerRect.bottom + 2;
        return nested ? [{
          changeId: outer.getAttribute("data-pageroot-review-overlay-box"),
          outer: {
            summary: outer.textContent,
            tone: outer.getAttribute("data-tone"),
            rect: [outerRect.x, outerRect.y, outerRect.width, outerRect.height],
          },
          inner: {
            summary: inner.textContent,
            tone: inner.getAttribute("data-tone"),
            rect: [innerRect.x, innerRect.y, innerRect.width, innerRect.height],
          },
        }] : [];
      });
    }));
    expect(nestedOverlayPairs).toEqual([]);
    const addedRowSemanticOwner = await assertProjectionGeometryCase(
      afterReviewFrame,
      REVIEW_PROJECTION_CASES[0],
    );
    const removedAtomicOwner = await beforeReviewFrame.locator(
      "[data-review-atomic-removed]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    const addedAtomicOwner = await afterReviewFrame.locator(
      "[data-review-atomic-added]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    expect(removedAtomicOwner).toBeTruthy();
    expect(addedAtomicOwner).toBeTruthy();
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-removed][data-pageroot-review-structure="removed"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-added][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect.poll(async () => beforeReviewFrame.locator(
      "[data-pageroot-review-id]",
    ).first().evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-all-changes.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).not.toBe("all");
    // Switching the filter must select the first matching marker instead of
    // leaving an unmatched target with an empty viewport.
    const filteredFocusChangeId = await beforeReviewFrame.locator("html")
      .getAttribute("data-pageroot-review-focus");
    expect(filteredFocusChangeId).toBeTruthy();
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text="removed"]',
    ).filter({ hasText: ORIGINAL_TEXT })).toBeVisible();
    const filteredFocusBar = beforeReviewFrame.locator(
      `[data-pageroot-review-region-bar="${filteredFocusChangeId}"]`,
    ).first();
    await expect(filteredFocusBar).toBeVisible();
    await filteredFocusBar.evaluate((bar) => bar.click());
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${filteredFocusChangeId}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${filteredFocusChangeId}"]`,
    )).toHaveCount(1);
    // Re-selecting the same filter keeps the user's position; page markers
    // remain the explicit way to move to another change.
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html")
      .getAttribute("data-pageroot-review-focus")).toBe(filteredFocusChangeId);
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text="removed"]',
    ).filter({ hasText: ORIGINAL_TEXT })).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT })).toBeVisible();
    const deletedPriority = beforeReviewFrame.locator(
      '[data-review-priority][data-pageroot-review-structure="removed"]',
    );
    await expect(deletedPriority).toHaveCount(1);
    await expect(deletedPriority.locator("[data-pageroot-review-text]")).toHaveCount(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-text-mark="removed"]',
    ).count()).toBeGreaterThan(0);
    const addedText = afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT });
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    )).toBe("none");
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textEmphasisStyle,
    )).toBe("none");
    expect(await addedText.evaluate((element) => getComputedStyle(element).color))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).color));
    expect(await addedText.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).fontSize));
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-text-mark="added"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-review-injection-stability]",
      ).evaluate((target) => {
        const marker = target.querySelector("[data-pageroot-review-text]");
        const left = target.querySelector("[data-review-stable-left]");
        const right = target.querySelector("[data-review-stable-right]");
        if (!marker || !left || !right) return false;
        const range = document.createRange();
        range.selectNodeContents(marker);
        const rangeRects = [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1).length;
        range.detach();
        const snapshot = () => [left, right].map((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.left, rect.top, rect.right, rect.bottom];
        });
        const wrapped = snapshot();
        const placeholder = document.createComment("review-marker-position");
        const text = document.createTextNode(marker.textContent || "");
        marker.before(placeholder);
        marker.replaceWith(text);
        const unwrapped = snapshot();
        text.replaceWith(marker);
        placeholder.remove();
        const maximumDelta = Math.max(...wrapped.flatMap((rect, index) => (
          rect.map((value, coordinate) => Math.abs(value - unwrapped[index][coordinate]))
        )));
        return rangeRects > 0
          && marker.getClientRects().length === 0
          && getComputedStyle(marker).display === "contents"
          && maximumDelta < .25;
      })),
    ).then((results) => results.every(Boolean))).toBe(true);
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator(
        '[data-pageroot-review-overlay-box][data-tone^="text-"]',
      )).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(1);
    }
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect.poll(() => frame.locator("[data-pageroot-review-text-mark]").count())
        .toBeGreaterThan(0);
    }
    const beforeRewriteMarker = beforeReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="removed"]',
    ).first();
    const afterRewriteMarker = afterReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="added"]',
    ).first();
    await expect(beforeRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "文本调整",
    );
    await expect(afterRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "文本调整",
    );
    const beforeRewriteGroup = await beforeRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    const afterRewriteGroup = await afterRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(beforeRewriteGroup).toBeTruthy();
    expect(afterRewriteGroup).toBeTruthy();
    await activateReviewMarkerGroup(beforeReviewFrame, beforeRewriteMarker);
    const beforeRewriteHole = beforeReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${beforeRewriteGroup}"]`,
    );
    const afterRewriteHole = afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${afterRewriteGroup}"]`,
    );
    await expect(beforeRewriteHole).toHaveCount(1);
    await expect(afterRewriteHole).toHaveCount(1);
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator('[data-pageroot-review-overlay-box][data-tone^="text-"]'))
        .toHaveCount(0);
    }
    for (const [frame, tone, evidenceCharacter] of [
      [beforeReviewFrame, "removed", "旧"],
      [afterReviewFrame, "added", "新"],
    ]) {
      const lineOwner = frame.locator("[data-review-line-scope]");
      const lineMarkers = lineOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      );
      await expect(lineMarkers).toHaveCount(2);
      expect(await lineMarkers.allTextContents()).toEqual([
        evidenceCharacter,
        evidenceCharacter,
      ]);
      const semanticOwnerId = await lineMarkers.first().getAttribute(
        "data-pageroot-review-semantic-owner",
      );
      expect(semanticOwnerId).toBeTruthy();
      const lineGroups = await lineMarkers.evaluateAll((markers) => (
        [...new Set(markers.map((marker) => (
          marker.getAttribute("data-pageroot-review-text-group") || ""
        )).filter(Boolean))]
      ));
      expect(lineGroups).toHaveLength(2);
      await activateReviewMarkerGroup(frame, lineMarkers.first());
      const lineFrame = frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="text-${tone}"]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      const lineHole = frame.locator(
        `[data-pageroot-review-mask-hole]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      await expect(lineFrame).toHaveCount(0);
      await expect(lineHole).toHaveCount(1);
    }
    for (const [frame, tone, evidenceCharacter] of [
      [beforeReviewFrame, "removed", "旧"],
      [afterReviewFrame, "added", "新"],
    ]) {
      const promotionOwner = frame.locator("[data-review-scope-promotion]");
      const promotionMarkers = promotionOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      );
      await expect(promotionMarkers).toHaveCount(9);
      expect(await promotionMarkers.allTextContents()).toEqual(
        Array.from({ length: 9 }, () => evidenceCharacter),
      );
      await expect(promotionOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      ).filter({ hasText: "稳定开场" })).toHaveCount(0);
      const semanticOwnerId = await promotionMarkers.first().getAttribute(
        "data-pageroot-review-semantic-owner",
      );
      expect(semanticOwnerId).toBeTruthy();
      const promotionGroups = await promotionMarkers.evaluateAll((markers) => (
        [...new Set(markers.map((marker) => (
          marker.getAttribute("data-pageroot-review-text-group") || ""
        )).filter(Boolean))]
      ));
      expect(promotionGroups).toHaveLength(9);
      await activateReviewMarkerGroup(frame, promotionMarkers.first());
      const promotionFrame = frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="text-${tone}"]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      const promotionHole = frame.locator(
        `[data-pageroot-review-mask-hole]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      await expect(promotionFrame).toHaveCount(0);
      await expect(promotionHole).toHaveCount(1);
    }
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      for (const frame of [beforeReviewFrame, afterReviewFrame]) {
        await frame.locator("[data-review-scope-promotion]").evaluate((element) => {
          element.scrollIntoView({ block: "center", inline: "nearest" });
        });
      }
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-scope-promotion.png"),
        animations: "disabled",
      });
    }
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      "[data-review-reference]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "本实验" })).toHaveAttribute(
      "data-pageroot-review-summary",
      "新增内容",
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    )).toHaveAttribute("data-pageroot-review-text-operation", "insert");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("换言之，");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveAttribute("data-pageroot-review-summary", "删除内容");
    await expect(afterReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text-context="added"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      "[data-review-delete-only]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(beforeReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("只删除这句定位文字。");
    await expect(afterReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text]',
    )).toHaveCount(0);
    const anchorOnlySectionChangeId = await afterReviewFrame.locator(
      "[data-review-anchor-only-section]",
    ).getAttribute("data-pageroot-review-id");
    expect(anchorOnlySectionChangeId).toBeTruthy();
    await expect(afterReviewFrame.locator(
      "[data-review-anchor-only]",
    )).toHaveAttribute("data-pageroot-review-anchor-change", anchorOnlySectionChangeId);
    const anchorOnlyChangeId = await beforeReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text="removed"]',
    ).getAttribute("data-pageroot-review-marker");
    expect(anchorOnlyChangeId).toBeTruthy();
    await expect(beforeReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text="removed"]',
    )).toHaveAttribute("data-pageroot-review-confirmed", "true");
    const anchorOffsets = await afterReviewFrame.locator(
      "[data-review-anchor-only]",
    ).evaluate((anchor) => String(
      anchor.getAttribute("data-pageroot-review-text-anchors") || "",
    ).split(/\s+/).filter(Boolean).map((encoded) => (
      Number(encoded.slice(encoded.lastIndexOf("@") + 1))
    )));
    expect(anchorOffsets).toContain("稳定开头。稳定中段。".length);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveText("④ 后续重点：继续观察新增商品。");
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveCount(1);
    const numberedLineMarker = afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    );
    const numberedLineGroup = await numberedLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(numberedLineGroup).toBeTruthy();
    await activateReviewMarkerGroup(afterReviewFrame, numberedLineMarker);
    const numberedLineFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${numberedLineGroup}"]`,
    );
    await expect(numberedLineFrame).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(1);
    await expect.poll(async () => {
      const holeBox = await afterReviewFrame.locator(
        `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
      ).boundingBox();
      const ownerBox = await afterReviewFrame.locator(
        "[data-review-numbered-lines]",
      ).boundingBox();
      return Boolean(holeBox && ownerBox && holeBox.height < ownerBox.height * 0.55);
    }).toBe(true);
    await expect(beforeReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-added-list-item][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-brand-table] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row="added"][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row]:not([data-review-brand-row="added"]) [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    const crossLineMarker = afterReviewFrame.locator(
      '[data-review-cross-line] [data-pageroot-review-text="added"]',
    );
    await expect(crossLineMarker).toHaveAttribute(
      "data-pageroot-review-text-operation",
      "insert",
    );
    const crossLineGroup = await crossLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(crossLineGroup).toBeTruthy();
    await activateReviewMarkerGroup(afterReviewFrame, crossLineMarker);
    const crossLineRectCount = await crossLineMarker.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const count = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1).length;
      range.detach();
      return count;
    });
    expect(crossLineRectCount).toBeGreaterThan(1);
    const crossLineFrames = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${crossLineGroup}"]`,
    );
    const crossLineHole = afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${crossLineGroup}"]`,
    );
    await expect(crossLineFrames).toHaveCount(0);
    await expect(crossLineHole).toHaveCount(1);
    for (const [frame, tone] of [
      [beforeReviewFrame, "removed"],
      [afterReviewFrame, "added"],
    ]) {
      await activateReviewMarkerGroup(frame, frame.locator(
        `[data-review-stable-sentence-rewrite] [data-pageroot-review-text="${tone}"]`,
      ).first());
      const owner = frame.locator("[data-review-stable-sentence-rewrite]");
      const semanticOwnerId = await owner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      ).first().getAttribute("data-pageroot-review-semantic-owner");
      expect(semanticOwnerId).toBeTruthy();
      await expect(frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      )).toHaveCount(0);
      await expect(frame.locator(
        `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      )).toHaveCount(1);
      await expect(owner.locator("[data-pageroot-review-text]").filter({
        hasText: /稳定(?:前|后)句/u,
      })).toHaveCount(0);
    }
    const warningRemovedText = await beforeReviewFrame.locator(
      '[data-review-warning] [data-pageroot-review-text="removed"]',
    ).allTextContents();
    expect(warningRemovedText.join(""))
      .not.toContain("7/28)增幅收窄至负值区间，需");
    await expect(beforeReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="removed"]',
    )).toHaveText("品均基本持平");
    await expect(afterReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="added"]',
    )).toHaveText("单品效率整体稳定，增幅仅+0.10%");
    await expect(beforeReviewFrame.locator(
      '[data-review-deleted-copy] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: /^待删除第/u })).toHaveCount(3);
    await expect(beforeReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "vs" })).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "建议继续保留实验策略" })).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-review-regression-summary] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-text-changes.png"),
        animations: "disabled",
      });
    }
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    const textMask = afterReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    );
    await expect(textMask).toBeAttached();
    await expect.poll(() => textMask.getAttribute("fill-opacity"))
      .toBe("0.75");
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-mask-layer]',
    ).evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      borderWidth: getComputedStyle(element).borderTopWidth,
    }))).toEqual({ background: "rgba(0, 0, 0, 0)", borderWidth: "0px" });
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-projection-layer], [data-pageroot-review-mask-layer], [data-pageroot-review-overlay-box], [data-pageroot-review-overlay-shape-svg]',
    ).evaluateAll((elements) => elements.length > 0 && elements.every((element) => (
      getComputedStyle(element).outlineStyle === "none"
    )))).toBe(true);
    await expect.poll(async () => {
      const boxes = await afterReviewFrame.locator(
        '[data-pageroot-review-overlay-box]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
        path: element.getAttribute("data-path"),
      })));
      const holes = await afterReviewFrame.locator(
        '[data-pageroot-review-mask-hole]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number(element.getAttribute("data-left")),
        top: Number(element.getAttribute("data-top")),
        width: Number(element.getAttribute("data-width")),
        height: Number(element.getAttribute("data-height")),
        path: element.getAttribute("d"),
      })));
      return boxes.length === 0
        && holes.length === 1
        && holes.every((hole) => (
          Number.isFinite(hole.left)
          && Number.isFinite(hole.top)
          && hole.width > 0
          && hole.height > 0
          && Boolean(hole.path)
        ));
    }).toBe(true);
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    const ebitaMarker = afterReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "建议继续保留实验策略" });
    const ebitaChangeId = await ebitaMarker.getAttribute("data-pageroot-review-marker");
    expect(ebitaChangeId).toBeTruthy();
    await activateReviewMarkerGroup(afterReviewFrame, ebitaMarker);
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).toBe(ebitaChangeId);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${ebitaChangeId}"]`,
    )).toHaveCount(1);
    await beforeCounter.evaluate((button) => button.click());
    await expect(afterCounter).toHaveAttribute("data-count", "3");
    // The authored counter is unrelated to the review sequence controls and
    // remains a separate page interaction synchronized across both frames.
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    })).toHaveCount(0);
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "元素变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    await activateReviewMarkerGroup(afterReviewFrame, afterReviewFrame.locator(
      '[data-review-brand-row="added"]',
    ));
    await expect(beforeReviewFrame.locator("[data-pageroot-review-structure]").first())
      .toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first()).toBeAttached();
    // The active structure group uses the single violet focus outline.
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toMatch(/^(?:rgba\(0, 0, 0, 0\)|rgb\(109, 92, 231\))$/u);
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure]',
    )).toHaveCount(1);
    const structureAddedRowFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="structure"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    );
    await expect(structureAddedRowFrame).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    )).toHaveCount(0);
    await expect.poll(() => structureAddedRowFrame.evaluate((frame) => {
      const row = document.querySelector('[data-review-brand-row="added"]');
      if (!row) return false;
      const frameRect = frame.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return Math.abs(frameRect.left - (rowRect.left - 3)) < .75
        && Math.abs(frameRect.top - (rowRect.top - 3)) < .75
        && Math.abs(frameRect.width - (rowRect.width + 6)) < .75
        && Math.abs(frameRect.height - (rowRect.height + 6)) < .75;
    })).toBe(true);
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      const metricStructureFacts = await frame.locator(
        '[data-review-metrics] [data-pageroot-review-structure]',
      ).evaluateAll((elements) => elements.map((element) => ({
        tag: element.tagName,
        marker: element.getAttribute("data-pageroot-review-structure"),
      })));
      expect(metricStructureFacts).toHaveLength(3);
      expect(metricStructureFacts.every((fact) => (
        fact.tag === "ARTICLE" && fact.marker === "style"
      ))).toBe(true);
    }
    const sourceRewriteSelector = [
      "[data-review-mixed-copy] [data-pageroot-review-structure]",
      "[data-review-break-layout] [data-pageroot-review-structure]",
      "[data-review-ebita-copy] [data-pageroot-review-structure]",
    ].join(", ");
    const structureChanges = async (frame) => frame.locator(sourceRewriteSelector)
      .evaluateAll((elements) => elements.flatMap((element) => {
        const facts = JSON.parse(
          element.getAttribute("data-pageroot-review-projection-facts") || "[]",
        );
        return facts.filter((fact) => fact.type === "structure")
          .map((fact) => fact.structureChange);
      }));
    const beforeSourceRewriteChanges = await structureChanges(beforeReviewFrame);
    expect(beforeSourceRewriteChanges.length).toBeGreaterThan(0);
    expect(beforeSourceRewriteChanges.every((change) => (
      change === "removed" || change === "moved"
    ))).toBe(true);
    const afterSourceRewriteChanges = await structureChanges(afterReviewFrame);
    expect(afterSourceRewriteChanges.every((change) => change === "moved")).toBe(true);
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("[data-pageroot-review-style]")).toHaveCount(0);
      await expect(frame.locator("[data-review-layout-only]"))
        .toHaveAttribute("data-pageroot-review-structure", "style");
      await expect(frame.locator("[data-review-layout-only]"))
        .toHaveAttribute("data-pageroot-review-projection-facts", /"structureChange":"style"/u);
      await expect(frame.locator("html"))
        .not.toHaveAttribute("data-pageroot-review-confirmed", /.+/u);
      await expect(frame.locator("html"))
        .not.toHaveAttribute("data-pageroot-review-projection-facts", /css-source|script-source/u);
      await expect(frame.locator(
        '[data-review-mask-stage] [data-pageroot-review-structure="style"]',
      )).toHaveCount(2);
    }
    await launched.page.getByRole("button", {
      name: "只看修改前",
    }).click();
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="after"]')).toHaveAttribute("hidden", "");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    // Switching to a single page must widen it to the space available, never leave it at
    // the split width. Alignment of the right edges was the old way to say that, but it
    // silently assumed the scroll area is wider than the page: at 100% zoom a page wider
    // than its area legitimately overflows, and the conversation docked beside the review
    // makes that area narrower. The invariant is that the page is never the narrower one.
    await expect.poll(async () => {
      const viewport = await launched.page.locator('[aria-label="修改前画布滚动区"]').boundingBox();
      const frame = await launched.page.locator('iframe[title^="修改前"]').boundingBox();
      if (!viewport || !frame) return -100;
      return (frame.x + frame.width) - (viewport.x + viewport.width);
    }).toBeGreaterThanOrEqual(-2);
    await launched.page.getByRole("button", {
      name: "双页对比",
    }).click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    const wholePageButton = launched.page.getByRole("button", {
      name: "双页对比",
    });
    await wholePageButton.focus();
    await wholePageButton.press("ArrowRight");
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    const leftPageButton = launched.page.getByRole("button", {
      name: "只看修改前",
    });
    await expect(leftPageButton).toBeFocused();
    await leftPageButton.press("ArrowLeft");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(wholePageButton).toBeFocused();
    await launched.page.getByRole("button", {
      name: "只看修改后",
    }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="before"]')).toHaveAttribute("hidden", "");
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await wholePageButton.click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => {
      const grid = await launched.page.locator('[data-view="split"]').boundingBox();
      const beforePane = await launched.page.locator('section[data-side="before"]').boundingBox();
      const afterPane = await launched.page.locator('section[data-side="after"]').boundingBox();
      if (!grid || !beforePane || !afterPane) return false;
      return beforePane.x - grid.x <= 4
        && grid.x + grid.width - (afterPane.x + afterPane.width) <= 4
        && afterPane.x - (beforePane.x + beforePane.width) <= 4;
    }).toBe(true);
    await activateReviewMarkerGroup(afterReviewFrame, crossLineMarker);
    const activeFocusPresentationState = async () => {
      const sides = await Promise.all([beforeReviewFrame, afterReviewFrame].map((frame) => (
        frame.locator("html").evaluate(() => {
          const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")];
          const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")];
          const labels = [...document.querySelectorAll("[data-pageroot-review-overlay-label]")];
          return {
            focusGroup: document.documentElement.dataset.pagerootReviewFocusGroup || "",
            boxCount: boxes.length,
            holeCount: holes.length,
            labelCount: labels.length,
            noCountLabel: labels.every((label) => !(label.textContent || "").includes("×")),
            noPhraseOrLine: boxes.every((box) => ![
              "text-phrase",
              "text-line",
            ].includes(box.getAttribute("data-scope") || "")),
            outlinedPathsMatch: boxes.every((box) => holes.some((hole) => (
              box.getAttribute("data-path") === hole.getAttribute("d")
            ))),
          };
        })
      )));
      return {
        matches: Boolean(sides[0].focusGroup)
          && sides[0].focusGroup === sides[1].focusGroup
          && sides.some((side) => side.holeCount > 0)
          && sides.every((side) => (
            side.holeCount <= 1
            && side.boxCount <= 1
            && side.labelCount <= 1
            && side.noCountLabel
            && side.noPhraseOrLine
            && side.outlinedPathsMatch
          )),
        sides,
      };
    };
    await launched.page.getByRole("button", { name: "适应画布", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "适应画布", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(activeFocusPresentationState).toMatchObject({ matches: true });
    await expect.poll(() => assertActiveFocusPaintBudget(afterReviewFrame)).toBe(true);
    await launched.page.getByRole("button", { name: "原始大小", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "原始大小", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(activeFocusPresentationState).toMatchObject({ matches: true });
    const originalWindowBounds = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ));
      return window?.getBounds() || null;
    });
    expect(originalWindowBounds).toBeTruthy();
    const originalViewportWidth = await launched.page.evaluate(() => innerWidth);
    const resizedBounds = { ...originalWindowBounds, width: originalWindowBounds.width + 180 };
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, resizedBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => innerWidth - original >= 120,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(activeFocusPresentationState).toMatchObject({ matches: true });
    await expect.poll(() => assertActiveFocusPaintBudget(afterReviewFrame)).toBe(true);
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, originalWindowBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => Math.abs(innerWidth - original) <= 2,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(activeFocusPresentationState).toMatchObject({ matches: true });
    const beforeViewport = launched.page.locator('[aria-label="修改前画布滚动区"]');
    const afterViewport = launched.page.locator('[aria-label="修改后画布滚动区"]');
    await launched.page.waitForTimeout(450);
    const sourceLeft = await beforeViewport.evaluate((element) => {
      element.scrollLeft = Math.max(1, Math.round(
        (element.scrollWidth - element.clientWidth) * .35,
      ));
      element.dispatchEvent(new Event("scroll"));
      return element.scrollLeft;
    });
    expect(sourceLeft).toBeGreaterThan(0);
    await expect.poll(() => afterViewport.evaluate((element) => element.scrollLeft))
      .toBe(sourceLeft);

    // A trackpad swipe lands inside the frame, where the vertically scrollable
    // document keeps the horizontal component of the gesture and drops it. The
    // pane has to take that remainder, exactly once, or the first horizontal
    // swipe is lost and the second one moves both pages twice as far.
    const frameHorizontalCapacity = await beforeReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollWidth - innerWidth)
    ));
    expect(frameHorizontalCapacity).toBeLessThanOrEqual(1);
    const paneMaximum = await beforeViewport.evaluate((element) => (
      element.scrollWidth - element.clientWidth
    ));
    const swipedLeft = Math.min(paneMaximum, sourceLeft + 90);
    expect(swipedLeft).toBeGreaterThan(sourceLeft);
    const paneBox = await beforeViewport.boundingBox();
    await launched.page.mouse.move(
      paneBox.x + paneBox.width / 2,
      paneBox.y + paneBox.height / 2,
    );
    await launched.page.mouse.wheel(90, 24);
    await expect.poll(() => beforeViewport.evaluate((element) => element.scrollLeft))
      .toBe(swipedLeft);
    await expect.poll(() => afterViewport.evaluate((element) => element.scrollLeft))
      .toBe(swipedLeft);

    // At the page end the browser stops on the real scroll maximum, which a
    // scrollbar-shortened measurement underreports. A synchronizer that trusts
    // the short value drags the other page backwards while the user is still
    // scrolling forwards.
    const hoverPane = async (viewport) => {
      const paneBounds = await viewport.boundingBox();
      await launched.page.mouse.move(
        paneBounds.x + paneBounds.width / 2,
        paneBounds.y + paneBounds.height / 2,
      );
    };
    const frameScrollState = (frame) => frame.locator("html").evaluate(() => ({
      top: Math.round(scrollY),
      remaining: Math.round(Math.max(
        0,
        document.documentElement.scrollHeight
        - document.documentElement.clientHeight
        - scrollY,
      )),
    }));
    // The page-end check only means something when both pages start from the
    // same place: an earlier harness-driven scrollIntoView can leave the two
    // documents at different offsets, and the next gesture would carry that
    // gap to the page end as a fixed takeover offset.
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await frame.locator("html").evaluate(() => window.scrollTo(0, 0));
    }
    await expect.poll(async () => (await Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => (
        frame.locator("html").evaluate(() => Math.round(scrollY))
      )),
    )).reduce((total, top) => total + top, 0)).toBe(0);
    await launched.page.waitForTimeout(240);
    await hoverPane(beforeViewport);
    for (let index = 0; index < 9; index += 1) {
      await launched.page.mouse.wheel(0, 900);
      await launched.page.waitForTimeout(120);
    }
    await expect.poll(async () => (await frameScrollState(beforeReviewFrame)).remaining)
      .toBeLessThanOrEqual(1);
    const leaderAtPageEnd = await frameScrollState(beforeReviewFrame);
    await hoverPane(afterViewport);
    await launched.page.mouse.wheel(0, 150);
    await launched.page.waitForTimeout(240);
    expect((await frameScrollState(afterReviewFrame)).remaining).toBeLessThanOrEqual(1);
    // Scaled iframes may expose the same page-end lock on adjacent rounded
    // CSS pixels; this remains the existing one-pixel synchronization budget.
    expect(Math.abs(
      (await frameScrollState(beforeReviewFrame)).top - leaderAtPageEnd.top,
    )).toBeLessThanOrEqual(1);
    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => Math.abs(scrollY)))
      .toBeLessThanOrEqual(1);

    const originalAfterMaximum = await afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ));
    await afterReviewFrame.locator("html").evaluate(() => {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-review-sync-height-probe", "true");
      spacer.style.height = "1600px";
      spacer.style.pointerEvents = "none";
      document.body.append(spacer);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBeGreaterThan(originalAfterMaximum + 1_400);
    await launched.page.waitForTimeout(180);
    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeGreaterThan(1);
    const unequalHeightFollowerSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      unequalHeightFollowerSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    const settledUnequalHeightFollowerSamples = unequalHeightFollowerSamples.slice(-5);
    expect(
      Math.max(...settledUnequalHeightFollowerSamples)
        - Math.min(...settledUnequalHeightFollowerSamples),
    ).toBeLessThanOrEqual(1);
    const unequalHeightFollower = await afterReviewFrame.locator("html").evaluate(() => ({
      top: scrollY,
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    }));
    expect(unequalHeightFollower.maximum - unequalHeightFollower.top).toBeGreaterThan(1_000);
    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_200 }));
    });
    await launched.page.waitForTimeout(160);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeCloseTo(unequalHeightFollower.top, 0);
    await afterReviewFrame.locator('[data-review-sync-height-probe="true"]')
      .evaluate((spacer) => spacer.remove());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBe(originalAfterMaximum);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await launched.page.waitForTimeout(180);
    const sourceScrollResult = await beforeReviewFrame.locator("html").evaluate(() => {
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const target = outlines[Math.floor(outlines.length / 2)];
      if (!target) return { maximum: 0, target: 0, actual: scrollY, count: 0 };
      const rect = target.getBoundingClientRect();
      const nextTop = scrollY + rect.top + rect.height / 2 - innerHeight / 3;
      dispatchEvent(new WheelEvent("wheel", { deltaY: 900 }));
      window.scrollTo(0, nextTop);
      return {
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        target: nextTop,
        actual: scrollY,
        count: outlines.length,
      };
    });
    const followerScrollMetrics = await afterReviewFrame.locator("html").evaluate(() => ({
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      actual: scrollY,
    }));
    expect(sourceScrollResult.actual).toBeGreaterThan(1);
    expect(followerScrollMetrics.maximum).toBeGreaterThan(1);
    const followerScrollSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      followerScrollSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    expect(followerScrollSamples.at(-1)).toBeGreaterThan(1);
    const settledFollowerSamples = followerScrollSamples.slice(-5);
    expect(Math.max(...settledFollowerSamples) - Math.min(...settledFollowerSamples))
      .toBeLessThanOrEqual(1);
    const referenceOutlineAnchor = (frame) => frame.locator("html").evaluate(() => {
      const referenceLine = innerHeight / 3;
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const anchor = outlines.find((element) => element.getBoundingClientRect().bottom > referenceLine)
        || outlines.at(-1);
      if (!anchor) return { outlineId: "", ratio: 0 };
      const rect = anchor.getBoundingClientRect();
      return {
        outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
        ratio: Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height))),
      };
    });
    const beforeOutlineAnchor = await referenceOutlineAnchor(beforeReviewFrame);
    expect(beforeOutlineAnchor.outlineId).not.toBe("");
    const afterOutlineProgress = () => afterReviewFrame.locator(
      `[data-pageroot-outline-id="${beforeOutlineAnchor.outlineId}"]`,
    ).evaluate((element) => {
      const referenceLine = innerHeight / 3;
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height)));
    });
    await expect.poll(afterOutlineProgress).toBeCloseTo(beforeOutlineAnchor.ratio, 1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum * .82);
      window.scrollTo(0, maximum * .26);
    });
    const reversalSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      reversalSamples.push(await afterReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledReversalSamples = reversalSamples.slice(-4);
    expect(Math.max(...settledReversalSamples) - Math.min(...settledReversalSamples))
      .toBeLessThanOrEqual(1);

    await afterReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -900 }));
      window.scrollTo(0, maximum * .18);
    });
    const sideSwitchSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      sideSwitchSamples.push(await beforeReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledSideSwitchSamples = sideSwitchSamples.slice(-4);
    expect(Math.max(...settledSideSwitchSamples) - Math.min(...settledSideSwitchSamples))
      .toBeLessThanOrEqual(1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -1_200 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await beforeReviewFrame.locator("html").evaluate(() => {
      window.scrollTo(0, 0);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    });
    await launched.page.waitForTimeout(120);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY)).toBe(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await wholePageButton.click();
      await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
        "data-pageroot-review-filter",
      )).toBe("all");
      await Promise.all([
        beforeViewport.evaluate((element) => { element.scrollLeft = 0; }),
        afterViewport.evaluate((element) => { element.scrollLeft = 0; }),
        beforeReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
        afterReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
      ]);
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-final.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", { name: "收起会话面板" }).click();
    const pendingDecisionEntry = launched.page.getByRole("button", {
      name: "待决定",
      exact: true,
    });
    await expect(pendingDecisionEntry).toHaveAttribute("aria-expanded", "false");
    await expect(sharedHeader.getByRole("button", { name: "采纳修改", exact: true }))
      .toHaveCount(0);
    await expect(sharedHeader.getByRole("button", { name: "返回修改前", exact: true }))
      .toHaveCount(0);
    await pendingDecisionEntry.click();
    await expect(reviewSidebar).toBeVisible();
    await launched.page.getByRole("button", {
      name: "采用修改",
    }).click();
    await expect(launched.page.getByRole("dialog", {
      name: /采纳 AI 修改后（.+）？/u,
    })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "继续审阅" }))
      .toBeFocused();
    await launched.page.evaluate(() => {
      window.__pagerootSawHandoffFlash = false;
      window.__pagerootHandoffFlashEvents = [];
      // Accepting promotes the Working Copy to a new source path while the
      // review overlay is still visible. The overlay must keep its prepared
      // session identity: a review iframe remounting mid-accept is the
      // user-visible double-jump regression.
      window.__pagerootReviewAcceptFrames = Array.from(document.querySelectorAll(
        '[data-testid="ai-review-workspace"] iframe',
      ));
      window.__pagerootHandoffObserver = new MutationObserver(() => {
        const review = document.querySelector('[data-testid="ai-review-workspace"]');
        const reviewCoversWindow = Boolean(
          review
          && review.getClientRects().length > 0
          && getComputedStyle(review).position === "fixed",
        );
        const disconnectedFrames = reviewCoversWindow
          ? window.__pagerootReviewAcceptFrames.filter((frame) => !frame.isConnected)
          : [];
        if (disconnectedFrames.length > 0) {
          window.__pagerootReviewAcceptFrames = window.__pagerootReviewAcceptFrames
            .filter((frame) => frame.isConnected);
          window.__pagerootHandoffFlashEvents.push({
            reviewFramesRemounted: disconnectedFrames.length,
            sourceTitle: document.querySelector('.workbench-tab[data-selected="true"] button[role="tab"] > span:last-child')?.textContent || "",
          });
        }
      });
      window.__pagerootHandoffObserver.observe(document.body, { childList: true, subtree: true });
    });
    expect(await launched.page.evaluate(
      () => window.__pagerootReviewAcceptFrames.length,
    )).toBe(2);
    await launched.page.getByRole("button", { name: "确认并采纳" }).click();
    const opened = await assertReviewAcceptPersistence({
      page: launched.page,
      sourcePath: fixture.sourcePath,
      original: fixture.original,
      expectedText: UPDATED_TEXT,
      versionPathPattern: /\/generated-ai-loop-V2(?:-V2)*\.html$/u,
    });
    expect(await launched.page.evaluate(() => {
      window.__pagerootHandoffObserver?.disconnect();
      return window.__pagerootHandoffFlashEvents;
    })).toEqual([]);
    await expect(launched.page.locator(".side-drawer")).toHaveCount(0);
    const openedFrame = await loadedDiskFrame(launched.page, opened.sourcePath);
    await expect(openedFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT);

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    const previewFrame = launched.page.frameLocator(
      'iframe[title="HTML 交互预览"]',
    );
    await expect(previewFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT, { timeout: 30_000 });
    await expect(launched.page.locator(".save-status")).toHaveCount(0);
    await launched.page.getByRole("button", { name: "编辑", exact: true }).click();

    await launched.electronApp.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [sourcePath],
      });
    }, pickerSourcePath);
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await sidebar.getByRole("button", { name: "新建项目", exact: true }).click();
    const pickerFrame = await loadedDiskFrame(
      launched.page,
      pickerSourcePath,
    );
    await expect(pickerFrame.locator(caseSelector("list-item")))
      .toHaveText(PICKER_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("two AI versions activate in order and survive relaunch without identity drift", async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("sequential-ai-loop.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let activeApp = launched.electronApp;
  let activeAppClosed = false;
  try {
    const firstRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      firstRequest.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(firstRequest.requestRoot, firstRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V2\.html$/u),
    });
    const firstActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect((await loadedDiskFrame(
      launched.page,
      firstActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(UPDATED_TEXT);

    const secondRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      firstActive.sourcePath,
      SECOND_UPDATED_TEXT,
    );
    writeAiOutput(
      secondRequest.requestRoot,
      (base) => base.replace(UPDATED_TEXT, SECOND_UPDATED_TEXT),
    );
    runOfficialFinalizer(secondRequest.requestRoot, secondRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V3\.html$/u),
    });
    const secondActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(readFileSync(firstActive.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    expect(readFileSync(firstActive.sourcePath, "utf8"))
      .not.toContain(SECOND_UPDATED_TEXT);
    expect(readFileSync(secondActive.sourcePath, "utf8"))
      .toContain(SECOND_UPDATED_TEXT);
    await expect((await loadedDiskFrame(
      launched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);

    const projectRoot = managedProjectRootForId(
      launched.workspace,
      secondRequest.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.projectId).toBe(secondRequest.changeRequest.projectId);
    expect(manifest.latestOfficialVersionId).toBe("ver_0003");
    expect(manifest.versions.map((version) => version.versionId))
      .toEqual(["ver_0001", "ver_0002", "ver_0003"]);

    await closePageRootGracefully(launched.electronApp, launched.page);
    activeAppClosed = true;
    const relaunched = await launchPageRoot({
      isolatedUserData: launched.isolatedUserData,
    });
    activeApp = relaunched.electronApp;
    activeAppClosed = false;
    await expect.poll(async () => (
      relaunched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: secondActive.sourcePath,
    });
    await expect((await loadedDiskFrame(
      relaunched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);
  } finally {
    if (activeAppClosed) {
      removeAiLoopUserData(launched.isolatedUserData);
    } else {
      await stopPageRoot(activeApp, launched.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("returning from review restores the editable pre-AI version and preserves the candidate", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("return-before-ai.html");
  const commentText = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    const candidateFiles = candidateHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(candidateFiles).toHaveLength(1);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "收起会话面板" }).click();
    const pendingDecisionEntry = launched.page.getByRole("button", {
      name: "待决定",
      exact: true,
    });
    await expect(pendingDecisionEntry).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "返回修改前" }))
      .toHaveCount(0);
    await pendingDecisionEntry.click();
    await launched.page.getByRole("button", { name: "不用这次", exact: true }).click();
    const dialog = launched.page.getByRole("dialog", {
      name: /返回 AI 修改前（版本 \d+）？/u,
    });
    await expect(dialog).toBeVisible();
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-return-confirmation.png"),
        animations: "disabled",
      });
    }
    await expect(dialog.getByText(/确认后不会采用这次 AI 返回的 版本 \d+。/u))
      .toBeVisible();
    await expect(dialog.getByText(/将继续使用 版本 \d+（AI 修改前）为基线重新修改。/u))
      .toBeVisible();
    const projectRoot = managedProjectRootForId(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const aiTasksRoot = path.join(projectRoot, "AI任务");
    rmSync(aiTasksRoot, { recursive: true, force: true });
    const revealCandidateTask = dialog.getByRole("button", {
      name: "AI 返回的 HTML 已自动保留，点击在文件夹中打开。",
    });
    await expect(revealCandidateTask).toBeVisible();
    await revealCandidateTask.click();
    await expect.poll(() => existsSync(aiTasksRoot), { timeout: 30_000 }).toBe(true);
    const [returnBackground, continueBackground] = await Promise.all([
      dialog.getByRole("button", { name: "返回修改前版本" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      dialog.getByRole("button", { name: "继续审阅" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expect(returnBackground).not.toBe(continueBackground);
    await dialog.getByRole("button", { name: "返回修改前版本" }).click();

    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    const [workingCopyPath] = workingHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    await loadedDiskFrame(launched.page, workingCopyPath);
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toHaveCount(0);
    await expect(launched.page.locator(".comment-card").filter({ hasText: commentText }))
      .toHaveCount(1);
    const restored = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(restored.sourcePath).toBe(realpathSync(workingCopyPath));
    const runtime = JSON.parse(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      "runtime-state.json",
    ), "utf8"));
    expect(runtime.schemaVersion).toBe("4.0.0");
    expect(runtime.activeRequest).toBeNull();
    expect(runtime.activeCandidateId).toBeNull();
    const candidate = JSON.parse(readFileSync(
      path.join(request.requestRoot, "candidate.json"),
      "utf8",
    ));
    const requestRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "request.json"),
      "utf8",
    ));
    expect(candidate.status).toBe("rejected");
    expect(requestRecord.status).toBe("rejected");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(existsSync(candidateFiles[0])).toBe(true);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a broad but related AI return is accepted without a target-scope error", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  const fixture = createSourceFixture();
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
        "<title>PageRoot native DOM editing matrix</title>",
        "<title>unauthorized title mutation</title>",
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    await expect(launched.page.getByText("已记录评论范围外的额外变化", { exact: true }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用这些额外变化" }))
      .toHaveCount(0);
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(active.sourcePath).toBe(realpathSync(
      workingHtmlFiles(launched.workspace, request.changeRequest.projectId)[0],
    ));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a committed version that the desktop cannot activate stays visibly blocked", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE: "1" },
  });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect(launched.page.getByText(/新版本文件暂时无法打开|最新版暂时无法打开/u)
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(request.sourcePath));
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(2);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("stable-ID Review keeps movement, reorder, attributes and styles position-bound", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  const fixture = createSourceFixture("stable-id-review.html", (source) => source.replace(
    "  </main>",
    `    <style data-stable-review-css>.stable-review-card { color: rgb(30 40 50); }</style>
    <section data-stable-review-root>
      <div data-stable-review-column="a">
        <article data-stable-review-card data-review-status="before" style="padding: 8px">
          <h2>稳定卡片</h2><p>移动前文字</p>
        </article>
        <article data-stable-review-static data-review-static="before" style="margin: 4px">
          <h2>原位卡片</h2><p>原位修改前文字</p>
        </article>
        <article data-stable-review-unchanged-move><p>跨区移动但文字不变</p></article>
        <article data-stable-review-id-deleted><h2>相同身份标题</h2><p>删除 ID 但内容不变</p></article>
        <article data-stable-review-id-replaced><h2>相同身份标题</h2><p>替换 ID 但标记不变</p></article>
        <article data-stable-review-composite-move>
          <p data-stable-review-transfer-from>待转移文字</p>
          <p data-stable-review-transfer-to>稳定乙</p>
          <aside data-stable-review-removed-module>移动时删除的模块</aside>
        </article>
        <p data-stable-review-order="a">稳定顺序甲</p>
        <p data-stable-review-order="b">稳定顺序乙</p>
      </div>
      <div data-stable-review-column="b"></div>
      <article data-stable-review-exact="a">精确重排甲</article>
      <article data-stable-review-exact="b">精确重排乙</article>
    </section>
    <script type="application/json" data-stable-review-script>{"state":"before"}</script>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      const card = base.match(/<article data-stable-review-card[\s\S]*?<\/article>/u)?.[0];
      const staticCard = base.match(/<article data-stable-review-static[\s\S]*?<\/article>/u)?.[0];
      const unchangedMove = base.match(/<article data-stable-review-unchanged-move[\s\S]*?<\/article>/u)?.[0];
      const compositeMove = base.match(/<article data-stable-review-composite-move[\s\S]*?<\/article>/u)?.[0];
      const orderA = base.match(/<p data-stable-review-order="a"[^>]*>稳定顺序甲<\/p>/u)?.[0];
      const orderB = base.match(/<p data-stable-review-order="b"[^>]*>稳定顺序乙<\/p>/u)?.[0];
      const exactA = base.match(/<article data-stable-review-exact="a"[^>]*>精确重排甲<\/article>/u)?.[0];
      const exactB = base.match(/<article data-stable-review-exact="b"[^>]*>精确重排乙<\/article>/u)?.[0];
      expect(card).toBeTruthy();
      expect(staticCard).toBeTruthy();
      expect(unchangedMove).toBeTruthy();
      expect(compositeMove).toBeTruthy();
      expect(orderA).toBeTruthy();
      expect(orderB).toBeTruthy();
      expect(exactA).toBeTruthy();
      expect(exactB).toBeTruthy();
      const movedCard = card
        .replace('data-review-status="before"', 'data-review-status="after"')
        .replace('style="padding: 8px"', 'style="padding: 18px; border: 2px solid #6d5ce7"')
        .replace("移动前文字", "移动后文字");
      const changedStaticCard = staticCard
        .replace('data-review-static="before"', 'data-review-static="after"')
        .replace('style="margin: 4px"', 'style="margin: 14px; color: rgb(90 40 150)"')
        .replace("原位修改前文字", "原位修改后文字");
      const changedCompositeMove = compositeMove
        .replace("待转移文字", "稳定甲")
        .replace("稳定乙", "待转移文字")
        .replace(/\s*<aside data-stable-review-removed-module[\s\S]*?<\/aside>/u, "")
        .replace(
          "</article>",
          '<img data-stable-review-added-image alt="移动时新增的图片" src="data:image/svg+xml,%3Csvg/%3E"></article>',
        );
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(
          "</head>",
          '<style data-stable-review-added-css>.added-source { font-weight: 600; }</style></head>',
        )
        .replace(
          "</body>",
          '<script type="application/json" data-stable-review-added-script>{"added":true}</script></body>',
        )
        .replace(card, "")
        .replace(compositeMove, "")
        .replace(staticCard, changedStaticCard)
        .replace(unchangedMove, "")
        .replace(`${orderA}\n        ${orderB}`, `${orderB}\n        ${orderA}`)
        .replace(`${exactA}\n      ${exactB}`, `${exactB}\n      ${exactA}`)
        .replace(
          /(<div data-stable-review-column="b"[^>]*>)/u,
          `$1\n        ${movedCard}\n        ${unchangedMove}\n        ${changedCompositeMove}`,
        );
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-review-filter",
        "all",
        { timeout: 30_000 },
      );
    }

    const structureKinds = async (locator) => JSON.parse(
      await locator.getAttribute("data-pageroot-review-projection-facts") || "[]",
    ).filter((fact) => fact.type === "structure")
      .map((fact) => fact.structureChange);
    for (const frame of [beforeFrame, afterFrame]) {
      const card = frame.locator("[data-stable-review-card]");
      await expect(card).toHaveAttribute("data-pageroot-review-marker", /change-/u);
      await expect.poll(() => structureKinds(card)).toEqual(expect.arrayContaining([
        "moved",
        "attribute",
        "style",
      ]));
      await expect.poll(() => structureKinds(frame.locator("html"))).toEqual([]);
      const falsePresenceFacts = await card.evaluate((element) => (
        JSON.parse(element.getAttribute("data-pageroot-review-projection-facts") || "[]")
          .filter((fact) => fact.structureChange === "added" || fact.structureChange === "removed")
      ));
      expect(falsePresenceFacts).toEqual([]);
    }
    for (const frame of [beforeFrame, afterFrame]) {
      const compositeMove = frame.locator("[data-stable-review-composite-move]");
      await expect.poll(() => structureKinds(compositeMove)).toEqual(
        expect.arrayContaining(["moved"]),
      );
      await expect(compositeMove).toHaveAttribute(
        "data-pageroot-review-marker",
        /change-/u,
      );
    }
    await expect(beforeFrame.locator(
      '[data-stable-review-transfer-from] [data-pageroot-review-text="removed"], [data-stable-review-transfer-from][data-pageroot-review-text="removed"]',
    ).first()).toContainText("待转移文字");
    await expect(afterFrame.locator(
      '[data-stable-review-transfer-to] [data-pageroot-review-text="added"], [data-stable-review-transfer-to][data-pageroot-review-text="added"]',
    ).first()).toContainText("待转移文字");
    const movedTextOwners = await beforeFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="removed"], [data-stable-review-transfer-from] [data-pageroot-review-text="removed"]',
    ).evaluateAll((elements) => elements.map((element) => (
      element.getAttribute("data-pageroot-review-semantic-owner") || ""
    )).filter(Boolean));
    expect(movedTextOwners).toHaveLength(2);
    expect(new Set(movedTextOwners).size).toBe(2);
    await expect.poll(() => structureKinds(afterFrame.locator(
      "[data-stable-review-added-image]",
    ))).toEqual(expect.arrayContaining(["added"]));
    await expect.poll(() => structureKinds(beforeFrame.locator(
      "[data-stable-review-removed-module]",
    ))).toEqual(expect.arrayContaining(["removed"]));
    const addedCss = afterFrame.locator("[data-stable-review-added-css]");
    const addedScript = afterFrame.locator("[data-stable-review-added-script]");
    await expect(addedCss).toHaveAttribute("data-pageroot-id", /^pr1_[a-f0-9]{32}$/u);
    await expect(addedScript).toHaveAttribute("data-pageroot-id", /^pr1_[a-f0-9]{32}$/u);
    expect(await addedCss.getAttribute("data-pageroot-id"))
      .not.toBe(await addedScript.getAttribute("data-pageroot-id"));
    for (const sourceElement of [addedCss, addedScript]) {
      await expect(sourceElement).not.toHaveAttribute("data-pageroot-review-marker", /change-/u);
    }
    await expect(beforeFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="removed"], [data-stable-review-card][data-pageroot-review-text="removed"]',
    ).first()).toBeAttached();
    await expect(afterFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="added"], [data-stable-review-card][data-pageroot-review-text="added"]',
    ).first()).toBeAttached();
    for (const frame of [beforeFrame, afterFrame]) {
      const unchangedMove = frame.locator("[data-stable-review-unchanged-move]");
      await expect.poll(() => structureKinds(unchangedMove)).toEqual(
        expect.arrayContaining(["moved"]),
      );
      await expect(unchangedMove.locator("[data-pageroot-review-text]")).toHaveCount(0);
      await expect.poll(async () => (
        JSON.parse(await unchangedMove.getAttribute("data-pageroot-review-projection-facts") || "[]")
          .filter((fact) => fact.type === "text")
      )).toEqual([]);
    }
    for (const [frame, tone] of [[beforeFrame, "removed"], [afterFrame, "added"]]) {
      const staticCard = frame.locator("[data-stable-review-static]");
      await expect.poll(() => structureKinds(staticCard)).toEqual(expect.arrayContaining([
        "attribute",
        "style",
      ]));
      await expect(frame.locator(
        `[data-stable-review-static] [data-pageroot-review-text="${tone}"], [data-stable-review-static][data-pageroot-review-text="${tone}"]`,
      ).first()).toBeAttached();
    }
    for (const frame of [beforeFrame, afterFrame]) {
      await expect.poll(() => structureKinds(frame.locator('[data-stable-review-column="a"]')))
        .toEqual(expect.arrayContaining(["reordered"]));
      await expect.poll(() => structureKinds(frame.locator("[data-stable-review-root]")))
        .toEqual(expect.arrayContaining(["reordered"]));
      await expect(frame.locator(
        '[data-stable-review-order="a"] [data-pageroot-review-text], '
        + '[data-stable-review-order="b"] [data-pageroot-review-text], '
        + '[data-stable-review-exact="a"] [data-pageroot-review-text], '
        + '[data-stable-review-exact="b"] [data-pageroot-review-text]',
      )).toHaveCount(0);
    }
    await launched.page.getByRole("button", { name: "元素变化" }).click();
    await expect(afterFrame.locator("html")).toHaveAttribute("data-pageroot-review-filter", "structure");
    // Filter state publishes before its scheduled overlay render. Do not click
    // a bar retained from the previous text-inclusive frame.
    await afterFrame.locator("html").evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    // Several source-backed structure regions may overlap and their DOM order
    // is not a focus contract. Resolve the card's analyzer-owned focus group,
    // then activate the exact bar for that group.
    await activateReviewMarkerGroup(
      afterFrame,
      afterFrame.locator("[data-stable-review-card]"),
    );
    await expect.poll(() => afterFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).count()).toBeGreaterThan(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a rewrite outside <main> is still reviewed", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  // A single-file page has no site chrome to skip: the reader can comment on a
  // footer note, the AI can rewrite it, and the review must show that change
  // instead of reporting the page as unchanged there.
  const fixture = createSourceFixture(
    "outside-main-review.html",
    (source) => source.replace(
      "</body>",
      `  <footer data-review-outside-main>
    <p>${OUTSIDE_MAIN_BEFORE}</p>
  </footer>
</body>`,
    ),
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      expect(base).toContain(OUTSIDE_MAIN_BEFORE);
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(OUTSIDE_MAIN_BEFORE, OUTSIDE_MAIN_AFTER);
    });
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
        "data-pageroot-review-filter",
        "all",
        { timeout: 30_000 },
      );
    }
    // The footer is a body-level sibling of <main>, so it must become its own
    // change region carrying text evidence on both sides.
    await expect(beforeReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u, { timeout: 30_000 });
    await expect(afterReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u);
    await expect(beforeReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: "不同" }).first()).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "一致" }).first()).toBeVisible();
    // 品牌与 About 入口由全局侧边栏统一承担，审阅页不复制同形顶栏图标。
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await sidebar.getByRole("button", { name: "源页", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "关闭关于源页" }))
      .toBeVisible({ timeout: 15_000 });
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Review keeps Candidate scope diagnostics out of the comparison canvas", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-impact-review.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
      UPDATED_TEXT,
    );
    writeAiOutput(request.requestRoot, (base) => {
      const changedTitle = base.replace(
        /(<title[^>]*>)[\s\S]*?(<\/title>)/u,
        "$1AI 任务标题$2",
      );
      return changedTitle.replace(ORIGINAL_TEXT, UPDATED_TEXT);
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByTestId("review-impact-summary")).toHaveCount(0);
    await expect(launched.page.getByTestId("review-visual-status")).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用修改" }))
      .toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

async function installReviewObservationProbe(page, { dropObservations = false } = {}) {
  await page.evaluate(({ dropObservations }) => {
    const probe = { projections: [], observations: [], deadlines: 0 };
    window.__reviewObservationProbe = probe;
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      if (message?.type === "verdicts") probe.projections.push(message.side);
      if (message?.type === "observe") {
        probe.observations.push({ side: message.side, generation: message.generation, candidates: message.candidates });
        if (dropObservations) return;
      }
      return Reflect.apply(post, this, [message, ...rest]);
    };
    const schedule = window.setTimeout;
    window.setTimeout = function(callback, delay, ...args) {
      // Observe the real optional-outline deadline without changing its duration.
      if (delay === 4_000 && typeof callback === "function") {
        return schedule(() => { probe.deadlines += 1; callback(...args); }, delay);
      }
      return schedule(callback, delay, ...args);
    };
  }, { dropObservations });
}

async function expectReviewProjectionWithoutObservations(page) {
  await expect.poll(() => page.evaluate(() => [...new Set(window.__reviewObservationProbe.projections)].sort()))
    .toEqual(["after", "before"]);
  expect(await page.evaluate(() => window.__reviewObservationProbe.observations)).toEqual([]);
}

async function readSharedToolbarLayout(page) {
  return page.evaluate(() => {
    const readRect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const root = document.querySelector(".workbench-header");
    const modeSwitch = root?.querySelector(".canvas-mode-switch") || null;
    const aiEntry = root?.querySelector(".workbench-toolbar-actions > .header-send-button") || null;
    return {
      header: readRect(root),
      stage: readRect(document.querySelector(".review-scroll-stage")),
      primary: readRect(root?.querySelector(".workbench-toolbar-primary") || null),
      center: readRect(root?.querySelector(".workbench-toolbar-center") || null),
      actions: readRect(root?.querySelector(".workbench-toolbar-actions") || null),
      modeSwitch: readRect(modeSwitch),
      aiEntry: readRect(aiEntry),
      modeButtons: [...(modeSwitch?.querySelectorAll("button") || [])].map((button) => ({
        rect: readRect(button),
        label: button.textContent?.trim() || "",
        disabled: button.disabled,
        pressed: button.getAttribute("aria-pressed"),
      })),
      innerWidth: window.innerWidth,
      documentWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth || 0,
      ),
    };
  });
}

function expectRectNear(actual, expected, label, keys = ["x", "y", "width", "height"]) {
  expect(actual, `${label} should exist`).not.toBeNull();
  expect(expected, `${label} baseline should exist`).not.toBeNull();
  for (const key of keys) {
    expect(Math.abs(actual[key] - expected[key]), `${label}.${key}`).toBeLessThanOrEqual(0.5);
  }
}

function expectSharedToolbarLayout(layout) {
  expect(layout.header).not.toBeNull();
  expect(layout.stage).not.toBeNull();
  expect(layout.primary).not.toBeNull();
  expect(layout.center).not.toBeNull();
  expect(layout.actions).not.toBeNull();
  expect(layout.modeSwitch).not.toBeNull();
  expect(layout.aiEntry).not.toBeNull();
  expect(layout.modeSwitch.width).toBe(180);
  expect(layout.modeSwitch.height).toBe(34);
  expect(layout.modeButtons).toHaveLength(3);
  for (const button of layout.modeButtons) expect(button.rect.height).toBe(28);
  expect(layout.primary.right).toBeLessThanOrEqual(layout.center.x + 0.5);
  expect(layout.center.right).toBeLessThanOrEqual(layout.actions.x + 0.5);
  expect(layout.documentWidth - layout.innerWidth).toBeLessThanOrEqual(1);
}

function expectStableSharedToolbar(current, baseline, { includeActions = true } = {}) {
  for (const key of ["header", "stage", "primary", "modeSwitch"]) {
    expectRectNear(current[key], baseline[key], key);
  }
  // Review legitimately gives the previously empty center slot intrinsic
  // height. Its horizontal allocation is the cross-mode layout invariant.
  expectRectNear(current.center, baseline.center, "center", ["x", "width"]);
  if (includeActions) {
    expectRectNear(current.actions, baseline.actions, "actions");
    expectRectNear(current.aiEntry, baseline.aiEntry, "aiEntry");
  }
  expectSharedToolbarLayout(current);
}

function emptyReviewScenario(scenario) {
  return async ({}, testInfo) => {
    test.setTimeout(120_000);
    const fixture = createSourceFixture(
      scenario.longFileName
        ? "2026-年度核心经营指标与跨区域增长归因分析完整终稿-source-only-diagnostics.html"
        : "source-only-diagnostics.html",
      scenario.darkSource
        ? (source) => source.replace(
            "    :root {",
            "    body { background: rgb(8, 10, 14); color: rgb(238, 240, 245); }\n    :root {",
          )
        : undefined,
    );
    const original = readFileSync(fixture.sourcePath);
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    try {
      if (scenario.narrow) {
        await launched.electronApp.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find((candidate) => (
            candidate.webContents.getURL().includes("/dist-desktop/renderer/")
            || candidate.getTitle() === "源页"
          ));
          const bounds = window?.getBounds();
          if (window && bounds) window.setBounds({ ...bounds, width: 1024, height: 768 }, false);
        });
        await expect.poll(() => launched.page.evaluate(() => window.innerWidth))
          .toBeLessThanOrEqual(1120);
      }
      const header = launched.page.locator(".workbench-header");
      await expect(header).toBeVisible();
      const modeSwitch = launched.page.getByRole("group", { name: "工作模式", exact: true });
      const editButton = modeSwitch.getByRole("button", { name: "编辑", exact: true });
      const previewButton = modeSwitch.getByRole("button", { name: "预览", exact: true });
      const reviewButton = modeSwitch.getByRole("button", { name: "审阅", exact: true });
      const initialLayout = await readSharedToolbarLayout(launched.page);
      expectSharedToolbarLayout(initialLayout);
      await expect(reviewButton).toBeDisabled();
      await expect(reviewButton).toHaveCSS("opacity", "0.38");
      await expect(editButton).toHaveAttribute("aria-pressed", "true");
      const previewRect = await previewButton.boundingBox();
      await previewButton.hover();
      expectRectNear(await previewButton.boundingBox(), previewRect, "preview hover");
      await expect(previewButton).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await previewButton.focus();
      await expect(previewButton).toBeFocused();
      await expect(previewButton).toHaveCSS("outline-width", "2px");
      expectRectNear(await previewButton.boundingBox(), previewRect, "preview focus");
      if (scenario.visualMatrix) {
        await launched.page.emulateMedia({ reducedMotion: "reduce" });
        await expect(previewButton).toHaveCSS("transition-duration", "0s");
        await expect(previewButton.locator("svg")).toHaveCSS("transition-duration", "0s");
        await launched.page.screenshot({
          path: testInfo.outputPath("narrow-long-dark-edit-hover-focus-reduced-motion.png"),
          animations: "disabled",
        });
      }
      await modeSwitch.getByRole("button", { name: "预览", exact: true }).click();
      await expect(modeSwitch.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(launched.page.getByRole("group", { name: "页面预览", exact: true })).toHaveCount(0);
      expectStableSharedToolbar(await readSharedToolbarLayout(launched.page), initialLayout);
      await modeSwitch.getByRole("button", { name: "编辑", exact: true }).click();
      await expect(modeSwitch.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute("aria-pressed", "true");
      expectStableSharedToolbar(await readSharedToolbarLayout(launched.page), initialLayout);
      await launched.page.screenshot({ path: testInfo.outputPath("edit-toolbar.png"), animations: "disabled" });
      await installReviewObservationProbe(launched.page);
      const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
      writeAiOutput(request.requestRoot, (base) => scenario.script
        ? base.replace('document.documentElement.dataset.authorScriptRan = "true";',
          'document.documentElement.dataset.authorScriptRan = "true"; document.addEventListener("DOMContentLoaded", () => { document.body.style.backgroundColor = "rgb(210, 230, 250)"; });')
        : base.replace("    :root {", "    /* source-only QA */\n    :root {")
          .replace('document.documentElement.dataset.authorScriptRan = "true";',
            '/* source-only QA */ document.documentElement.dataset.authorScriptRan = "true";'));
      runOfficialFinalizer(request.requestRoot, request.changeRequest);
      await expect(launched.page.getByTestId("ai-conversation-action-bar"))
        .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
      const readyLayout = await readSharedToolbarLayout(launched.page);
      expectSharedToolbarLayout(readyLayout);
      await launched.page.getByRole("button", { name: "查看修改" }).click();
      await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible({ timeout: 30_000 });
      await expect(launched.page.getByTestId("review-empty-changes"))
        .toHaveText("未定位到可标注的变化，可直接查看前后页面。");
      await expect(launched.page.getByRole("group", { name: "变化审阅", exact: true })).toHaveCount(0);
      expectStableSharedToolbar(await readSharedToolbarLayout(launched.page), readyLayout);
      await expect(launched.page.getByRole("group", { name: "页面预览", exact: true })).toBeVisible();
      await expect(launched.page.getByRole("group", { name: "滚动方式", exact: true })).toBeVisible();
      await expect(launched.page.getByRole("group", { name: "画布缩放", exact: true })).toBeVisible();
      const before = launched.page.frameLocator('iframe[title^="修改前"]');
      const after = launched.page.frameLocator('iframe[title^="修改后"]');
      for (const frame of [before, after]) {
        await expect(frame.locator("body")).toBeVisible();
        await expect(frame.locator("[data-pageroot-review-marker]")).toHaveCount(0);
      }
      if (scenario.darkSource) {
        await expect(before.locator("body")).toHaveCSS("background-color", "rgb(8, 10, 14)");
        await expect(header).not.toHaveCSS("background-color", "rgb(8, 10, 14)");
      }
      await expectReviewProjectionWithoutObservations(launched.page);
      if (scenario.script) await expect(after.locator("body")).toHaveCSS("background-color", "rgb(210, 230, 250)");
      for (const frame of [before, after]) {
        await expect(frame.locator("html")).toHaveAttribute("data-pageroot-review-focus", "all");
        await expect(frame.locator("html")).toHaveAttribute("data-pageroot-review-focus-group", "");
        await expect(frame.locator("[data-pageroot-review-overlay-box], [data-pageroot-review-mask-hole], [data-pageroot-review-region-bar]"))
          .toHaveCount(0);
      }
      await launched.page.screenshot({ path: testInfo.outputPath("empty-review-overview.png"), animations: "disabled" });
      await launched.page.getByRole("button", { name: "只看修改前", exact: true }).click();
      await launched.page.getByRole("button", { name: "双页对比", exact: true }).click();
      await launched.page.screenshot({ path: testInfo.outputPath("empty-review-returned-to-split.png"), animations: "disabled" });
      // Closing/reopening the existing decision owner preserves the empty Review.
      const closeConversation = launched.page.getByRole("button", { name: "收起会话面板" });
      if (scenario.narrow) {
        const hitTest = await closeConversation.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const target = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          const conversation = button.closest('[data-testid="ai-conversation-sidebar"]');
          const reviewSidebar = conversation?.parentElement || null;
          const rect = (element) => {
            if (!element) return null;
            const value = element.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height };
          };
          return {
            clickable: target === button || button.contains(target),
            target: target?.tagName || null,
            targetClass: target?.getAttribute("class") || null,
            button: rect(button),
            sidebar: rect(reviewSidebar),
          };
        });
        expect(hitTest.clickable, JSON.stringify(hitTest)).toBe(true);
      }
      await closeConversation.click();
      await launched.page.getByRole("button", { name: "待决定", exact: true }).click();
      await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toBeVisible();
      if (scenario.adopt) {
        await adoptReadyResult(launched.page);
        await assertReviewAcceptPersistence({ page: launched.page, sourcePath: fixture.sourcePath,
          original, expectedText: "source-only QA", versionPathPattern: /\.html$/u });
      } else {
        await launched.page.getByRole("button", { name: "不用这次", exact: true }).click();
        await launched.page.getByRole("dialog", { name: /返回 AI 修改前（版本 \d+）？/u })
          .getByRole("button", { name: "返回修改前版本" }).click();
        await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
        expect(readFileSync(fixture.sourcePath).equals(original)).toBe(true);
        const project = await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject());
        expect(readFileSync(project.sourcePath, "utf8")).not.toContain('document.body.style.backgroundColor');
        await expect(launched.page.locator(".comment-card")).not.toHaveCount(0);
      }
    } finally {
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  };
}

test("CSS and Script comment-only changes open Review without position markers", {
  tag: ["@gate-smoke", "@smoke-review"],
}, emptyReviewScenario({ script: false, adopt: true }));

test("Script-only visual changes open Review without position markers", {
  tag: ["@gate-smoke", "@smoke-review"],
}, emptyReviewScenario({
  script: true,
  adopt: false,
  darkSource: true,
  longFileName: true,
  narrow: true,
  visualMatrix: true,
}));

test("a safe simple CSS selector creates one position-bound element change", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("mapped-css-review.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      "  </style>",
      '    [data-native-case="vertical-copy"] { color: rgb(180, 20, 30); }\n  </style>',
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator('[data-native-case="vertical-copy"]'))
        .toHaveAttribute("data-pageroot-review-structure", "style");
      await expect(frame.locator('[data-native-case="vertical-copy"]'))
        .toHaveAttribute("data-pageroot-review-confirmed", "true");
    }
    await expect(afterFrame.locator('[data-pageroot-review-structure="style"]'))
      .toHaveCount(1);
    const filters = launched.page.getByRole("group", { name: "变化审阅", exact: true });
    await filters.getByRole("button", { name: "文字变化", exact: true }).click();
    await expect(launched.page.getByTestId("review-empty-changes")).toBeVisible();
    await expect(filters).toBeVisible();
    await filters.getByRole("button", { name: "全部变化", exact: true }).click();
    await expect(launched.page.getByTestId("review-empty-changes")).toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

for (const scenario of ["confirmed", "mixed", "unverified"]) {
  test(`Review observes only optional inline-style outlines: ${scenario}`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const fixture = createSourceFixture("optional-style-review.html", (source) => source.replace(
      "  </main>",
      '    <div data-review-observe-style style="color: rgb(20, 40, 60)">可选样式观察</div>\n  </main>',
    ));
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    try {
      await installReviewObservationProbe(launched.page, { dropObservations: scenario === "unverified" });
      const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
      writeAiOutput(request.requestRoot, (base) => {
        const styled = base.replace('style="color: rgb(20, 40, 60)"', 'style="color: rgb(180, 20, 30)"');
        expect(styled).not.toBe(base);
        return scenario === "mixed" ? styled.replace("可选样式观察", "文字与样式同时修改") : styled;
      });
      runOfficialFinalizer(request.requestRoot, request.changeRequest);
      await expect(launched.page.getByTestId("ai-conversation-action-bar"))
        .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
      await launched.page.getByRole("button", { name: "查看修改" }).click();
      await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible({ timeout: 30_000 });
      const before = launched.page.frameLocator('iframe[title^="修改前"]');
      const after = launched.page.frameLocator('iframe[title^="修改后"]');
      const host = after.locator("[data-review-observe-style]");
      await expect(host).toHaveAttribute("data-pageroot-review-structure", "style");
      const stableId = await host.getAttribute("data-pageroot-id");
      if (scenario === "mixed") {
        await expectReviewProjectionWithoutObservations(launched.page);
      } else {
        await expect.poll(() => launched.page.evaluate(() => (
          [...new Set(window.__reviewObservationProbe.observations.map((item) => item.side))].sort()
        ))).toEqual(["after", "before"]);
        const observations = await launched.page.evaluate(() => window.__reviewObservationProbe.observations);
        for (const observation of observations) {
          expect(observation.candidates).toEqual([{ stableId, positionSensitive: false, present: true }]);
        }
      }
      if (scenario === "unverified") {
        await expect.poll(() => launched.page.evaluate(() => window.__reviewObservationProbe.deadlines), { timeout: 8_000 })
          .toBeGreaterThan(0);
      }
      const styleGroup = await host.evaluate((element) => {
        const facts = JSON.parse(element.getAttribute("data-pageroot-review-projection-facts") || "[]");
        const style = facts.find((fact) => fact.structureChange === "style");
        return style ? `focus-${style.displayGroupId || `display-fact-${style.id}`}` : "";
      });
      expect(styleGroup).toBeTruthy();
      await after.locator(`[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${styleGroup}"]`)
        .first().evaluate((bar) => bar.click());
      for (const frame of [before, after]) {
        await expect(frame.locator("html")).toHaveAttribute("data-pageroot-review-focus-group", styleGroup);
        await expect(frame.locator("[data-pageroot-review-overlay-box]"))
          .toHaveCount(scenario === "confirmed" ? 1 : 0);
      }
      await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toBeEnabled();
      await expect(launched.page.getByRole("button", { name: "不用这次", exact: true })).toBeEnabled();
      await launched.page.screenshot({ path: testInfo.outputPath(`style-${scenario}-focus.png`), animations: "disabled" });
    } finally {
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}

test("source Review preserves multi-host text evidence and hidden changes without visual confirmation", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({}, testInfo) => {
  test.setTimeout(120_000);
  const SECTION_ID = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const FIRST_ID = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const SECOND_ID = "pr1_cccccccccccc4ccc8ccccccccccccccc";
  const HIDDEN_ID = "pr1_dddddddddddd4ddd8ddddddddddddddd";
  const fixture = createSourceFixture("multi-host-hidden-review.html", (source) => source.replace(
    "  </main>",
    `    <p data-review-multi-host data-pageroot-id="${SECTION_ID}">
      <span data-pageroot-id="${FIRST_ID}">第一段旧文字</span>
      <span data-pageroot-id="${SECOND_ID}">第二段旧文字</span>
    </p>
    <div style="display:none!important;visibility:hidden;opacity:0" data-review-hidden-source data-pageroot-id="${HIDDEN_ID}">隐藏旧文字</div>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await installReviewObservationProbe(launched.page);
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace("第一段旧文字", "第一段新文字")
      .replace("第二段旧文字", "第二段新文字")
      .replace("隐藏旧文字", "隐藏新文字"));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });

    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    const addedMarkers = afterFrame.locator(
      '[data-review-multi-host] [data-pageroot-review-text="added"]',
    );
    await expect(addedMarkers.filter({ hasText: "新" })).toHaveCount(2);
    const changeIds = await addedMarkers.filter({ hasText: "新" }).evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-pageroot-review-marker"))
    ));
    expect(new Set(changeIds).size).toBe(1);
    await expect(beforeFrame.locator(
      '[data-review-multi-host] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: "旧" })).toHaveCount(2);

    const hiddenAfter = afterFrame.locator("[data-review-hidden-source]");
    await expect(hiddenAfter).toBeAttached();
    await expect(hiddenAfter.locator('[data-pageroot-review-text="added"]'))
      .toBeAttached();
    await expect(hiddenAfter.locator('[data-pageroot-review-text="added"]'))
      .toHaveAttribute("data-pageroot-review-confirmed", "true");
    await expect(launched.page.getByTestId("review-visual-status")).toHaveCount(0);
    await expectReviewProjectionWithoutObservations(launched.page);
    await launched.page.screenshot({ path: testInfo.outputPath("text-review-overview.png"), animations: "disabled" });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

const STATIC_ACCEPT_UNLOCK_MS = 3_000;
const ACCEPT_SCROLL_ANCHOR = "accept-scroll-anchor";

async function holdEditRuntimePrepare(electronApp) {
  const available = await electronApp.evaluate(
    () => typeof globalThis.__pagerootE2eHoldEditRuntimePrepare,
  );
  expect(available).toBe("function");
  await electronApp.evaluate(() => {
    globalThis.__pagerootE2eHoldEditRuntimePrepare();
  });
}

async function releaseEditRuntimePrepare(electronApp) {
  await electronApp.evaluate(() => {
    globalThis.__pagerootE2eReleaseEditRuntimePrepare();
  });
}

async function readActiveAcceptSnapshot(page) {
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  const chrome = await page.evaluate(() => {
    const workbench = document.querySelector("main.workbench");
    const visibleEditor = [...document.querySelectorAll('[data-testid="html-canvas-editor"]')]
      .find((node) => node.getClientRects().length > 0) || null;
    const surface = visibleEditor?.closest(".canvas-edit-surface") || null;
    const commentButton = document.querySelector(
      'aside[aria-label="本轮评论"] button[aria-label="全局评论"]',
    );
    return {
      projectState: workbench?.getAttribute("data-project-state") || "",
      renderedSha256: workbench?.getAttribute("data-rendered-sha256") || "",
      runtimePhase: surface?.getAttribute("data-edit-runtime-phase") || "",
      runtimeHandoff: visibleEditor?.getAttribute("data-runtime-handoff") || "",
      runtimeCandidateId: visibleEditor?.getAttribute("data-runtime-candidate-id") || "",
      renderVerified: visibleEditor?.getAttribute("data-render-verified") || "",
      editorLocked: visibleEditor?.getAttribute("data-locked") === "true",
      commentEnabled: Boolean(commentButton) && !commentButton.disabled,
      reviewVisible: Boolean(document.querySelector('[data-testid="ai-review-workspace"]')),
      accepting: Boolean(
        [...document.querySelectorAll("button")].some((button) => (
          /正在采纳/.test(button.textContent || "")
          || /正在采纳/.test(button.getAttribute("aria-label") || "")
        )),
      ),
      unlockCount: Number(window.__pagerootCommentUnlockCount || 0),
    };
  });
  const project = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
  const frameFacts = {
    listItemText: "",
    scrollY: 0,
    outerScrollTop: 0,
    showingDocumentTop: true,
    anchorInViewport: false,
    anchorScreenTop: 0,
    clipTop: 0,
    clipBottom: 0,
    iframeHeight: 0,
  };
  try {
    if (await editor.count()) {
      const frame = page.frameLocator(
        '[data-testid="html-canvas-editor"]:visible iframe[data-runtime-slot-role="active"]',
      );
      frameFacts.listItemText = (
        await frame.locator(caseSelector("list-item")).textContent({ timeout: 500 }).catch(() => "")
      ) || "";
      const inner = await frame.locator(caseSelector(ACCEPT_SCROLL_ANCHOR)).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const view = node.ownerDocument.defaultView;
        return {
          top: rect.top,
          bottom: rect.bottom,
          scrollY: Number(view?.scrollY || 0),
        };
      }).catch(() => null);
      const chromeGeometry = await page.evaluate(() => {
        const stage = document.querySelector(".review-scroll-stage");
        const iframe = [...document.querySelectorAll(
          '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
        )].find((node) => node.getClientRects().length > 0) || null;
        const stageRect = stage?.getBoundingClientRect();
        const iframeRect = iframe?.getBoundingClientRect();
        return {
          outerScrollTop: Number(stage?.scrollTop || 0),
          stageTop: stageRect?.top ?? 0,
          stageBottom: stageRect?.bottom ?? 0,
          iframeTop: iframeRect?.top ?? 0,
          iframeBottom: iframeRect?.bottom ?? 0,
          iframeHeight: iframeRect?.height ?? 0,
        };
      });
      frameFacts.scrollY = inner?.scrollY || 0;
      frameFacts.outerScrollTop = chromeGeometry.outerScrollTop;
      if (inner) {
        const screenTop = chromeGeometry.iframeTop + inner.top;
        const screenBottom = chromeGeometry.iframeTop + inner.bottom;
        const clipTop = Math.max(chromeGeometry.stageTop, chromeGeometry.iframeTop);
        const clipBottom = Math.min(chromeGeometry.stageBottom, chromeGeometry.iframeBottom);
        frameFacts.anchorInViewport = screenBottom > clipTop + 8
          && screenTop < clipBottom - 8;
        frameFacts.showingDocumentTop = chromeGeometry.outerScrollTop < 80
          && frameFacts.scrollY < 80
          && inner.top < 80;
        frameFacts.anchorScreenTop = screenTop;
        frameFacts.clipTop = clipTop;
        frameFacts.clipBottom = clipBottom;
        frameFacts.iframeHeight = chromeGeometry.iframeHeight;
      }
    }
  } catch {
    // Active iframe may detach for one frame during the static rewrite.
  }
  return {
    ...chrome,
    ...frameFacts,
    sourcePath: project?.sourcePath || "",
    workingSha256: project?.sha256 || project?.sourceSha256 || "",
  };
}

test("accepting a Version shows static Active and unlocks editing before Runtime is granted", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("accept-static-first.html", (source) => source.replace(
    "  </main>",
    `    <div data-scroll-pad="before" style="height:1800px" aria-hidden="true"></div>
    <p data-native-case="${ACCEPT_SCROLL_ANCHOR}">滚动锚点保持可见</p>
    <div data-scroll-pad="after" style="height:1800px" aria-hidden="true"></div>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const openedFrame = await loadedDiskFrame(launched.page, fixture.sourcePath);
    const scrollAnchor = openedFrame.locator(caseSelector(ACCEPT_SCROLL_ANCHOR));
    await expect(scrollAnchor).toBeVisible();
    const anchorDocumentTop = await scrollAnchor.evaluate((element) => (
      element.getBoundingClientRect().top
      + Number(element.ownerDocument.defaultView?.scrollY || 0)
    ));
    await launched.page.locator(".review-scroll-stage").evaluate((stage, documentTop) => {
      const iframe = [...stage.querySelectorAll(
        '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
      )].find((node) => node.getClientRects().length > 0);
      if (!iframe) return;
      const iframeOffset = iframe.getBoundingClientRect().top
        - stage.getBoundingClientRect().top
        + stage.scrollTop;
      stage.scrollTop = Math.max(0, iframeOffset + documentTop - stage.clientHeight / 2);
    }, anchorDocumentTop);
    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      return snapshot.outerScrollTop > 400 && snapshot.anchorInViewport && !snapshot.showingDocumentTop
        ? snapshot
        : false;
    }).toBeTruthy();

    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => preserveCandidateSourceIdsForFixture(
      base,
      base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });

    await launched.page.evaluate(() => {
      const button = document.querySelector(
        'aside[aria-label="本轮评论"] button[aria-label="全局评论"]',
      );
      window.__pagerootCommentUnlockCount = 0;
      window.__pagerootCommentWasDisabled = Boolean(button?.disabled);
      window.__pagerootCommentUnlockObserver?.disconnect();
      window.__pagerootCommentUnlockObserver = new MutationObserver(() => {
        const locked = Boolean(button?.disabled);
        if (window.__pagerootCommentWasDisabled && !locked) {
          window.__pagerootCommentUnlockCount += 1;
        }
        window.__pagerootCommentWasDisabled = locked;
      });
      if (button) {
        window.__pagerootCommentUnlockObserver.observe(button, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
      }
    });
    await holdEditRuntimePrepare(launched.electronApp);
    await adoptReadyResult(launched.page);
    // Adoption returns to Edit automatically. The Document keeps its AI
    // history, while the visible inspector goes back to editing comments.
    await expect(launched.page.getByRole("button", { name: "AI 助手", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toHaveCount(0);

    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      const runtimeStillIdle = snapshot.runtimeHandoff !== "active"
        && !snapshot.runtimeCandidateId;
      const ready = !snapshot.reviewVisible
        && !snapshot.accepting
        && runtimeStillIdle
        && snapshot.renderVerified === "true"
        && snapshot.listItemText === UPDATED_TEXT
        && snapshot.commentEnabled
        && !snapshot.editorLocked
        && !snapshot.showingDocumentTop
        && snapshot.anchorInViewport;
      return {
        ...snapshot,
        ready,
        runtimeStillIdle,
        geometry: ready
          ? undefined
          : `${snapshot.outerScrollTop}|${snapshot.iframeHeight}|${snapshot.anchorScreenTop}|${snapshot.clipTop}|${snapshot.clipBottom}|${snapshot.scrollY}`,
      };
    }, { timeout: STATIC_ACCEPT_UNLOCK_MS }).toMatchObject({
      ready: true,
      runtimeStillIdle: true,
      reviewVisible: false,
      accepting: false,
      renderVerified: "true",
      listItemText: UPDATED_TEXT,
      commentEnabled: true,
      editorLocked: false,
      showingDocumentTop: false,
      anchorInViewport: true,
      projectState: "ready",
      runtimeCandidateId: "",
      geometry: undefined,
    });
    const unlocked = await readActiveAcceptSnapshot(launched.page);
    expect(["preparing", "static"]).toContain(unlocked.runtimePhase);
    expect(unlocked.sourcePath).toMatch(/\/accept-static-first-V2\.html$/u);
    const expectedSha256 = sha256(readFileSync(unlocked.sourcePath));
    expect(unlocked.workingSha256).toBe(expectedSha256);
    const unlocksAtStatic = unlocked.unlockCount;

    await releaseEditRuntimePrepare(launched.electronApp);
    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      return snapshot.runtimePhase === "settled"
        || snapshot.runtimeHandoff === "active"
        || snapshot.runtimeCandidateId
        ? snapshot
        : false;
    }, { timeout: 20_000 }).toBeTruthy();
    const promoted = await readActiveAcceptSnapshot(launched.page);
    expect(promoted.listItemText).toBe(UPDATED_TEXT);
    expect(promoted.sourcePath).toBe(unlocked.sourcePath);
    expect(promoted.workingSha256).toBe(expectedSha256);
    expect(promoted.commentEnabled).toBe(true);
    expect(promoted.unlockCount).toBe(unlocksAtStatic);
    expect(promoted.showingDocumentTop).toBe(false);
    expect(promoted.anchorInViewport).toBe(true);
    expect(promoted.listItemText).not.toBe(ORIGINAL_TEXT);
  } finally {
    await releaseEditRuntimePrepare(launched.electronApp).catch(() => {});
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("two lost committed adoption replies stay pending and recover one decision through restart", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  const fixture = createSourceFixture("adoption-unknown-recovery.html");
  let launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let releaseFirst;
  const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
  let backendCommitted;
  const committed = new Promise((resolve) => { backendCommitted = resolve; });
  let allowRecovery = false;
  let result;
  const decisions = [];
  const captures = path.join(productRoot, "output/design-qa/ai-assistant-redesign");
  mkdirSync(captures, { recursive: true });
  try {
    const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
    writeAiOutput(request.requestRoot, (base) => preserveCandidateSourceIdsForFixture(base, base.replace(ORIGINAL_TEXT, UPDATED_TEXT)));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await launched.page.getByRole("button", { name: "查看修改", exact: true }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
    await launched.page.route("**/ready-version/activate", async (route) => {
      decisions.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      result = await response.json();
      if (decisions.length === 1) { backendCommitted(); await firstHeld; }
      if (!allowRecovery) await route.abort("timedout");
      else await route.fulfill({ response });
    });
    await launched.page.getByRole("button", { name: "采用修改", exact: true }).click();
    await launched.page.getByRole("button", { name: "确认并采纳" }).click();
    await committed;
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("正在采用");
    await expect(launched.page.getByRole("button", { name: "正在采纳…", exact: true })).toHaveCount(0);
    await launched.page.screenshot({ path: path.join(captures, "trusted-loop-adopting.png"), animations: "disabled" });
    releaseFirst();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("采用结果待确认");
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    await expect(sidebar).not.toContainText("尚未采用");
    await expect(launched.page.getByRole("button", { name: "正在采纳…", exact: true })).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-action-bar").getByRole("button")).toHaveCount(0);
    await launched.page.screenshot({ path: path.join(captures, "trusted-loop-adoption-unknown.png"), animations: "disabled" });
    allowRecovery = true;
    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0, { timeout: 30_000 });
    expect(decisions.every((decision) => JSON.stringify(decision) === JSON.stringify(decisions[0]))).toBe(true);
    expect(decisions[0].decisionOperationId).toBeTruthy();
    expect(readFileSync(result.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    await expect(sidebar).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "AI 助手", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await launched.page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(sidebar.getByText("已采用本次修改。", { exact: true })).toHaveCount(1);
    const isolatedUserData = launched.isolatedUserData;
    await closePageRootGracefully(launched.electronApp, launched.page);
    launched = await launchPageRoot({ isolatedUserData, activeSourcePath: result.sourcePath });
    await loadedDiskFrame(launched.page, result.sourcePath);
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await expect(launched.page.getByTestId("ai-conversation-sidebar").getByText("已采用本次修改。", { exact: true })).toHaveCount(1);
    await launched.page.screenshot({ path: path.join(captures, "trusted-loop-adopted-restarted.png"), animations: "disabled" });
  } finally {
    releaseFirst();
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});


for (const adopt of [true, false]) {
  test(`annotation capacity fallback keeps formal Review and ${adopt ? "adoption" : "discard"}`, {
    tag: ["@gate-smoke", "@smoke-review"],
  }, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const fixture = createSourceFixture("annotation-capacity-fallback.html");
    const original = readFileSync(fixture.sourcePath);
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    try {
      await installReviewObservationProbe(launched.page);
      const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
      writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
      runOfficialFinalizer(request.requestRoot, request.changeRequest);
      await expect(launched.page.getByTestId("ai-conversation-action-bar"))
        .toContainText("修改已准备好，尚未采用", { timeout: 30_000 });
      await launched.page.evaluate(() => {
        // Supply 24 valid facts at the parser's next append. The production
        // accumulator itself throws the real overflow class on its 25th fact.
        // This is a controlled capacity fault, not a forged Error or Candidate.
        const get = Element.prototype.getAttribute;
        window.__annotationCapacityFault = 0;
        Element.prototype.getAttribute = function(name) {
          if (name === "data-pageroot-review-projection-facts" && this.ownerDocument !== document
            && window.__annotationCapacityFault === 0) {
            window.__annotationCapacityFault += 1;
            Element.prototype.getAttribute = get;
            return JSON.stringify(Array.from({ length: 24 }, (_, index) => ({
              id: `capacity-${index}`, type: "structure", semanticOwnerId: `owner-${index}`,
              geometryOwnerId: `geometry-${index}`, scope: "element", operation: "insert", tone: "added",
            })));
          }
          return Reflect.apply(get, this, [name]);
        };
      });
      await launched.page.getByRole("button", { name: "查看修改" }).click();
      await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible({ timeout: 30_000 });
      await expect(launched.page.getByTestId("review-empty-changes"))
        .toHaveText("变化标注暂不可用，可直接查看前后页面。");
      expect(await launched.page.evaluate(() => window.__annotationCapacityFault)).toBe(1);
      const before = launched.page.frameLocator('iframe[title^="修改前"]');
      const after = launched.page.frameLocator('iframe[title^="修改后"]');
      await expect(before.locator("body")).toContainText(ORIGINAL_TEXT);
      await expect(after.locator("body")).toContainText(UPDATED_TEXT);
      for (const frame of [before, after]) {
        await expect(frame.locator("[data-pageroot-review-marker], span[data-pageroot-review-text]"))
          .toHaveCount(0);
        await expect(frame.locator("html")).toHaveAttribute("data-pageroot-review-focus", "all");
      }
      await expectReviewProjectionWithoutObservations(launched.page);
      await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toBeEnabled();
      await launched.page.screenshot({ path: testInfo.outputPath("annotation-fallback.png"), animations: "disabled" });
      if (adopt) {
        await adoptReadyResult(launched.page);
        await assertReviewAcceptPersistence({ page: launched.page, sourcePath: fixture.sourcePath,
          original, expectedText: UPDATED_TEXT, versionPathPattern: /\.html$/u });
      } else {
        await launched.page.getByRole("button", { name: "不用这次", exact: true }).click();
        await launched.page.getByRole("dialog", { name: /返回 AI 修改前（版本 \d+）？/u })
          .getByRole("button", { name: "返回修改前版本" }).click();
        await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
        expect(readFileSync(fixture.sourcePath).equals(original)).toBe(true);
        const project = await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject());
        expect(readFileSync(project.sourcePath, "utf8")).not.toContain(UPDATED_TEXT);
        await expect(launched.page.locator(".comment-card")).not.toHaveCount(0);
      }
    } finally {
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}
