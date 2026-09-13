import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  analyzeEditRuntimeDocument,
  authoredDocumentBase,
  collectEditRuntimeScripts,
  editRuntimeProgramIdentity,
  editRuntimeProtocolUrl,
  editRuntimeRegistrationProperty,
  isEditRuntimeExecutionId,
  isEditRuntimeDocumentBasePath,
  isEditRuntimeFrameToken,
  isEditRuntimeProtocolUrl,
  isEditRuntimeRequestId,
  isEditRuntimeSessionId,
  isEditRuntimeSourceSha256,
  unsupportedEditRuntimeProgramReason,
} from "../app/domain/edit-runtime-contract.js";

test("one exact Runtime document analysis owns scripts, base and program identity", () => {
  const source = [
    '<noscript><base href="ignored/"><script>ignored()</script></noscript>',
    '<base href="assets/">',
    '<script defer src="chart.js"></script>',
    '<script type="application/json">{"kind":"data"}</script>',
  ].join("\n");
  const analysis = analyzeEditRuntimeDocument(source);

  assert.equal(analysis.source, source);
  assert.deepEqual(analysis.documentBase, {
    href: "assets/",
    openingTag: '<base href="assets/">',
  });
  assert.deepEqual(
    analysis.executableScripts.map((script) => script.src),
    ["chart.js"],
  );
  assert.equal(analysis.programIdentity, editRuntimeProgramIdentity(source));
  assert.deepEqual(authoredDocumentBase(source), analysis.documentBase);
  assert.deepEqual(
    collectEditRuntimeScripts(source).executableScripts,
    analysis.executableScripts,
  );
});

test("direct Edit runtime extracts ordered deterministic classic scripts", () => {
  const contract = collectEditRuntimeScripts([
    "<!-- <script>ignored()</script> -->",
    '<script src="./vendor/echarts.js"></script>',
    '<script type="text/javascript">echarts.init(document.querySelector("#chart"))</script>',
    '<script type="application/json">{"not":"a program"}</script>',
  ].join("\n"));

  assert.equal(contract.unsupportedReason, null);
  assert.deepEqual(
    contract.executableScripts.map((script) => ({
      index: script.index,
      src: script.src,
      inline: script.inline.trim(),
    })),
    [
      { index: 0, src: "./vendor/echarts.js", inline: "" },
      { index: 1, src: null, inline: 'echarts.init(document.querySelector("#chart"))' },
    ],
  );
  assert.equal(contract.scripts.at(-1)?.executable, false);
});

test("only live parsed Script elements enter Runtime execution identity", () => {
  const contract = collectEditRuntimeScripts([
    "<template><script type=\"module\">import('./inert-template.js')</script></template>",
    "<textarea><script>import('./raw-text.js')</script></textarea>",
    "<script>window.live = true</script>",
  ].join("\n"));
  assert.equal(contract.unsupportedReason, null);
  assert.deepEqual(contract.executableScripts.map((script) => script.inline.trim()), [
    "window.live = true",
  ]);
  assert.notEqual(
    editRuntimeProgramIdentity(
      "<template><script>inertA()</script></template><script>live()</script>",
    ),
    null,
  );
  assert.equal(
    editRuntimeProgramIdentity(
      "<template><script>inertA()</script></template><script>live()</script>",
    ),
    editRuntimeProgramIdentity(
      "<template><script>inertB()</script></template><script>live()</script>",
    ),
  );
});

test("disposable Edit runtime preserves native script scheduling attributes", () => {
  for (const html of [
    '<script type="module">window.ready = true</script>',
    '<script async src="chart.js"></script>',
    '<script defer src="chart.js"></script>',
    '<script nomodule src="chart.js"></script>',
  ]) assert.equal(collectEditRuntimeScripts(html).unsupportedReason, null);
  assert.equal(
    unsupportedEditRuntimeProgramReason('import("./chart.js")'),
    "dynamic-or-module-import",
  );
  assert.equal(
    unsupportedEditRuntimeProgramReason('fetch("/data.json"); new Worker("x.js");'),
    null,
    "CSP, not a string predictor, owns network and worker containment",
  );
});

test("import detection ignores authored prose and JavaScript literal content", () => {
  for (const program of [
    'const heading = "How to import data";',
    "const heading = 'import( is documentation';",
    "// import('./commented.js')\nwindow.ready = true;",
    "/* import value from './commented.js' */\nwindow.ready = true;",
    "<!-- import('./legacy-open-comment.js')\nwindow.ready = true;",
    "let ready = true; <!-- import('./legacy-inline-comment.js')\nwindow.ready = ready;",
    "   --> import('./legacy-close-comment.js')\nwindow.ready = true;",
    "const matcher = /import\\s*\\(/u;",
    "const marker = /<!--/; window.ready = true;",
    "/<!--/.test(source); window.ready = true;",
    "if (ready) {} /import\\s*\\(/u.test(source);",
    "if (ready) /import\\s*\\(/u.test(source);",
    "for (; ready;) /import\\s*\\(/u.test(source);",
    "async function inspect(rows) { for await (const row of rows) /import\\s*\\(/u.test(row); }",
    "class Loader {} /import\\s*\\(/u.test(source);",
    "const prose = `How to import data`;",
    "viewer.import('./method.js');",
    "viewer?.import('./optional-method.js');",
    "const options = { import: 'data' };",
    "const options = { import() { return 'data'; } };",
    "class Loader { import() {} }",
    "class Loader { static import() {} }",
    "class Loader { import = () => 'data'; }",
    "class Loader { #import = () => 'data'; }",
    "const options = { *import() { yield 'data'; } };",
    "const options = { get import() { return 'data'; } };",
    "const options = { set import(value) { this.value = value; } };",
    "const options = { async import() { return 'data'; } };",
    "const url = import.meta.url;",
    "using resource = { [Symbol.dispose]() {} }; window.ready = true;",
    "await using resource = await open(); window.ready = true;",
  ]) assert.equal(unsupportedEditRuntimeProgramReason(program), null, program);

  for (const program of [
    "import value from './module.js';",
    "import './side-effect.js';",
    "const module = import('./dynamic.js');",
    "await import('./top-level-await-dynamic.js');",
    "for await (const row of rows) { import('./top-level-for-await-dynamic.js'); }",
    "using resource = { [Symbol.dispose]() {} }; import('./using-dynamic.js');",
    "await using resource = await open(); import('./await-using-dynamic.js');",
    "const template = `value: ${import('./nested.js')}`;",
    "const module = import /* webpackIgnore: true */ ('./comment-gap.js');",
    "const modules = { ...import('./spread-dynamic.js') };",
    "const marker = /<!--/; import('./after-regexp.js');",
    "/<!--/.test(source); import('./after-regexp-expression.js');",
    "{ import('./block-dynamic.js'); }",
    "label: { import('./label-block-dynamic.js'); }",
    "foo ?? bar; label: { import('./nullish-label-dynamic.js'); }",
    "foo ??= bar; label: { import('./nullish-assignment-label-dynamic.js'); }",
    "export { value } from './re-export.js';",
    "export * from './export-all.js';",
  ]) {
    assert.equal(
      unsupportedEditRuntimeProgramReason(program),
      "dynamic-or-module-import",
      program,
    );
  }
});

test("program identity changes only when authored script markup changes", () => {
  const first = '<main>A</main><script defer>window.ready = true</script>';
  const semanticEdit = '<main>B</main><script defer>window.ready = true</script>';
  const scriptEdit = '<main>B</main><script defer>window.ready = false</script>';
  const baseEdit = '<base href="assets/"><main>B</main><script defer>window.ready = true</script>';
  assert.equal(editRuntimeProgramIdentity(first), editRuntimeProgramIdentity(semanticEdit));
  assert.notEqual(editRuntimeProgramIdentity(first), editRuntimeProgramIdentity(scriptEdit));
  assert.notEqual(editRuntimeProgramIdentity(first), editRuntimeProgramIdentity(baseEdit));
});

test("program identity follows only the effective live document base", () => {
  const scripts = '<script defer src="chart.js"></script>';
  const assetsA = '<base target="_blank"><base href="assets-a/">' + scripts;
  const assetsB = '<base target="_blank"><base href="assets-b/">' + scripts;
  const inertA = '<template><base href="assets-a/"></template>' + scripts;
  const inertB = '<template><base href="assets-b/"></template>' + scripts;
  const foreignA = '<svg><base href="assets-a/"></base></svg>' + scripts;
  const foreignB = '<svg><base href="assets-b/"></base></svg>' + scripts;

  assert.deepEqual(authoredDocumentBase(assetsA), {
    href: "assets-a/",
    openingTag: '<base href="assets-a/">',
  });
  assert.notEqual(editRuntimeProgramIdentity(assetsA), editRuntimeProgramIdentity(assetsB));
  assert.equal(editRuntimeProgramIdentity(inertA), editRuntimeProgramIdentity(inertB));
  assert.equal(editRuntimeProgramIdentity(foreignA), editRuntimeProgramIdentity(foreignB));
});

test("direct Edit runtime grants use one session and one execution identity", () => {
  const sessionId = "0123456789abcdef0123456789abcdef";
  const executionId = "abcdefabcdefabcdefabcdef";
  const sourceSha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const url = editRuntimeProtocolUrl(
    sessionId,
    "/.pageroot/bootstrap/" + executionId + ".js",
  );

  assert.equal(EDIT_RUNTIME_PROTOCOL_SCHEME, "pageroot-edit-runtime");
  assert.equal(isEditRuntimeSessionId(sessionId), true);
  assert.equal(isEditRuntimeExecutionId(executionId), true);
  assert.equal(isEditRuntimeRequestId("edit-runtime-12345678"), true);
  assert.equal(isEditRuntimeSourceSha256(sourceSha), true);
  assert.equal(isEditRuntimeFrameToken("edit-runtime-frame-" + executionId), true);
  assert.equal(isEditRuntimeDocumentBasePath("/assets/"), true);
  assert.equal(isEditRuntimeDocumentBasePath("/../outside/"), false);
  assert.equal(isEditRuntimeProtocolUrl(url, sessionId), true);
  assert.equal(
    editRuntimeRegistrationProperty(executionId),
    "__pageroot_edit_register_" + executionId,
  );
  assert.equal(editRuntimeProtocolUrl(sessionId, "relative.js"), null);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetCount, 64);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetReferenceCount, 128);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes, 2 * 1024 * 1024);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs, 60_000);
  assert.equal(
    EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
    EDIT_AUTHOR_RUNTIME_BUDGET.remoteLibraryDeadlineMs
      + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
      + EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs
      + 1_000,
    "canvas acknowledgement permits exact remote acquisition, activation, and surface readiness",
  );
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.orphanSessionTtlMs, 60_000);
  assert.equal("cacheEntries" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("cacheTtlMs" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("runtimeQuietFrames" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("hostCount" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
});

test("formal architecture keeps the source-edit experience contract and runtime non-goals", async () => {
  const [adr, architecture, interaction] = await Promise.all([
    readFile(new URL("../docs/decisions/0065-disposable-edit-runtime.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ARCHITECTURE_CONTRACT.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/INTERACTION_FLOW.md", import.meta.url), "utf8"),
  ]);
  assert.match(adr, /completed operation materializes complete next HTML/u);
  assert.match(adr, /must not replace the iframe for every keystroke/u);
  assert.match(adr, /parent-realm `WeakSet`/u);
  assert.match(adr, /public source identity revokes/u);
  assert.match(adr, /Every source mutation[\s\S]*registered stable ID/u);
  assert.match(adr, /bounded[\s\S]*request-ID replay window/u);
  assert.match(adr, /cannot exhaust[\s\S]*application-lifetime/u);
  assert.match(adr, /first live-document `base\[href\]`[\s\S]*inert `<template>`/u);
  assert.match(adr, /Workers stay[\s\S]*CSP-disabled/u);
  assert.match(adr, /Stable ID and Runtime edit authority are separate contracts/u);
  assert.match(adr, /authority set is sealed[\s\S]*cannot add a trusted source object/u);
  assert.match(adr, /does not promise exact parser-time Script scheduling/u);
  assert.match(architecture, /close\/reopen must reproduce source edits/u);
  assert.match(architecture, /no Runtime DOM persistence/u);
  assert.match(architecture, /private parent-realm `WeakSet`/u);
  assert.match(architecture, /public source identity revokes/u);
  assert.match(architecture, /cached selection state is never mutation authority/u);
  assert.match(architecture, /bounded recent request-ID replay[\s\S]*never exhausts/u);
  assert.match(architecture, /persistent source identity, not Runtime edit authority/u);
  assert.match(architecture, /established exactly once[\s\S]*is then sealed/u);
  assert.match(architecture, /Exact parser-time execution order is not an Edit Runtime[\s\S]*contract/u);
  assert.match(architecture, /parser-blocking[\s\S]*DOMContentLoaded[\s\S]*contained relative `<base href>`/u);
  assert.match(architecture, /same first live-document `base\[href\]`[\s\S]*inert[\s\S]*`<template>`/u);
  assert.match(architecture, /static-degraded state[\s\S]*rather than partially or silently execute/u);
  assert.match(architecture, /location\.assign\(\)[\s\S]*location\.replace\(\)[\s\S]*frame navigation boundary/u);
  assert.match(interaction, /用户对源码内容完成的编辑必须写入完整 HTML/u);
  assert.match(interaction, /不得每输入一个字符就重建 iframe/u);
  assert.match(interaction, /父编辑器私有 `WeakSet`/u);
  assert.match(interaction, /公开源码 ID 被改写时立即/u);
  assert.match(interaction, /不把缓存 selection 当作修改权限/u);
  assert.match(interaction, /静态降级提示/u);
  assert.match(interaction, /连续使用不会累计到必须重启应用/u);
  for (const document of [adr, architecture, interaction]) {
    assert.match(document, /Runtime DOM/u);
    assert.match(document, /timer\/rAF\/Observer\/listener/u);
    assert.match(document, /Canvas\/SVG/u);
    assert.match(document, /dual-iframe|双 iframe/u);
  }
});
