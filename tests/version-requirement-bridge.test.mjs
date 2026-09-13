import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";
import {
  finalizeProjectFileAttempt,
} from "../bridge/project-file-finalizer.mjs";

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

// A v4 version entry keeps no comments and no summary of its own, so the only
// record of what the user asked for that round lives in the round's frozen
// request. The workspace payload has to carry it, or the version tree has
// nothing to name a version with.
async function registeredProject(t, prefix) {
  const environment = await createBridgeTestEnvironment(t, { prefix });
  const sourcePath = await environment.createSource("requirement.html", html("V1"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await bridge.postJson("/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  return { bridge, ensured, environment };
}

// Runs one real round end to end and adopts it, so the assertions below read a
// genuinely promoted version rather than a hand-written manifest entry.
async function adoptSecondVersion(bridge, ensured, summary) {
  const request = await bridge.postJson("/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary,
    comments: [{
      commentId: "comment_version_requirement",
      text: summary,
      target: { targetId: "target_version_requirement" },
      attachments: [],
    }],
    targets: [{ targetId: "target_version_requirement" }],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  const currentHtml = await readFile(ensured.body.sourcePath, "utf8");
  await writeFile(
    join(
      ensured.body.projectRoot,
      ".pageroot",
      ...request.body.outputRelativePath.split("/"),
    ),
    currentHtml.replaceAll("V1", "Candidate V2"),
    "utf8",
  );
  const finalized = await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });
  assert.equal(finalized.status, "completed");
  // Observing the attempt seals the candidate as ready to open; adoption is
  // rejected until then.
  const ready = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`
    + `&requestId=${encodeURIComponent(request.body.requestId)}`
    + `&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(ready.response.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.status, "ready-to-open");
  const adopted = await bridge.postJson("/ready-version/activate", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    candidateId: ready.body.candidateId,
    decisionOperationId: `promote_${ready.body.candidateId}`,
    versionId: "ver_0002",
  });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.body));
  return { requestId: request.body.requestId, sourcePath: adopted.body.sourcePath };
}

function workspace(bridge, sourcePath) {
  return bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
}

function versionRow(body, versionId) {
  return body.versions.find((version) => version.versionId === versionId);
}

test("the imported version exposes no requirement", async (t) => {
  const { bridge, ensured } = await registeredProject(
    t,
    "pageroot-version-requirement-initial-",
  );
  const state = await workspace(bridge, ensured.body.sourcePath);
  assert.equal(state.response.status, 200);
  const first = versionRow(state.body, "ver_0001");
  assert.equal(first.ordinal, 1);
  // The key is always present so the renderer never has to guess.
  assert.equal(first.requirement, null);
});

test("an adopted version carries the requirement its round froze", async (t) => {
  const { bridge, ensured } = await registeredProject(
    t,
    "pageroot-version-requirement-round-",
  );
  const adopted = await adoptSecondVersion(
    bridge,
    ensured,
    "价格表：三档太多，改成两档",
  );
  const state = await workspace(bridge, adopted.sourcePath);
  assert.equal(state.response.status, 200, JSON.stringify(state.body));
  assert.equal(
    versionRow(state.body, "ver_0002").requirement,
    "价格表：三档太多，改成两档",
  );
  // The import still has none, so the two cases stay distinguishable.
  assert.equal(versionRow(state.body, "ver_0001").requirement, null);
});

test("a multi-line requirement is condensed to a single line", async (t) => {
  const { bridge, ensured } = await registeredProject(
    t,
    "pageroot-version-requirement-condense-",
  );
  const adopted = await adoptSecondVersion(
    bridge,
    ensured,
    "  价格表：改成两档\n\n  页脚：标题再短一点  ",
  );
  const state = await workspace(bridge, adopted.sourcePath);
  assert.equal(
    versionRow(state.body, "ver_0002").requirement,
    "价格表：改成两档 页脚：标题再短一点",
  );
});

test("an over-long requirement is truncated so the payload stays small", async (t) => {
  const { bridge, ensured } = await registeredProject(
    t,
    "pageroot-version-requirement-long-",
  );
  const adopted = await adoptSecondVersion(bridge, ensured, "改".repeat(400));
  const state = await workspace(bridge, adopted.sourcePath);
  const requirement = versionRow(state.body, "ver_0002").requirement;
  assert.ok(requirement.length <= 121, String(requirement.length));
  assert.ok(requirement.endsWith("…"));
});

test("a round whose record is unreadable leaves the version usable", async (t) => {
  const { bridge, ensured, environment } = await registeredProject(
    t,
    "pageroot-version-requirement-missing-",
  );
  const adopted = await adoptSecondVersion(bridge, ensured, "会被清理的要求");
  // Restart so the read is not answered from the in-process cache, then retire
  // the round's record: this is the old-project case, which must degrade to no
  // requirement instead of failing the workspace read.
  await bridge.stop();
  await writeFile(
    join(
      ensured.body.projectRoot,
      ".pageroot",
      "requests",
      adopted.requestId,
      "change-request.json",
    ),
    "not json",
    "utf8",
  );
  const restarted = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const state = await workspace(restarted, adopted.sourcePath);
  assert.equal(state.response.status, 200, JSON.stringify(state.body));
  assert.equal(versionRow(state.body, "ver_0002").requirement, null);
  // The rest of the version row is untouched, so the tree still renders.
  assert.equal(versionRow(state.body, "ver_0002").ordinal, 2);
  assert.equal(versionRow(state.body, "ver_0002").basedOnVersionId, "ver_0001");
});

test("a repeated read is served without touching the round again", async (t) => {
  const { bridge, ensured } = await registeredProject(
    t,
    "pageroot-version-requirement-cache-",
  );
  const adopted = await adoptSecondVersion(bridge, ensured, "价格表：改成两档");
  const first = await workspace(bridge, adopted.sourcePath);
  assert.equal(
    versionRow(first.body, "ver_0002").requirement,
    "价格表：改成两档",
  );
  // Corrupting the record after it has been read must not change the answer:
  // a promoted round is immutable, so the cached text stands for the session.
  await writeFile(
    join(
      ensured.body.projectRoot,
      ".pageroot",
      "requests",
      adopted.requestId,
      "change-request.json",
    ),
    "not json",
    "utf8",
  );
  const second = await workspace(bridge, adopted.sourcePath);
  assert.equal(
    versionRow(second.body, "ver_0002").requirement,
    "价格表：改成两档",
  );
});
