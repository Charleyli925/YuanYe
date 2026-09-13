import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WorkbenchNavigationSession } from "../app/application/workbench-navigation-session.js";
import {
  WorkbenchNavigationWorkflow,
  workbenchStartupPriority,
} from "../app/application/workbench-navigation-workflow.js";
import { WorkbenchTabsSession } from "../app/application/workbench-tabs-session.js";

const A = { projectId: "project_alpha", documentId: "doc_alpha", name: "Alpha" };
const B = { projectId: "project_beta", documentId: "doc_beta", name: "Beta" };
const C = { projectId: "project_gamma", documentId: "doc_gamma", name: "Gamma" };
const D = { projectId: "project_delta", documentId: "doc_delta", name: "Delta" };

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("Start recovery export protects the journal source path", async () => {
  const source = await readFile(new URL(
    "../app/workbench/workbench-sidebar-container.tsx",
    import.meta.url,
  ), "utf8");
  assert.match(
    source,
    /exportHtmlCopy\?\.\(\{\s*html:\s*recovered\.html,\s*sourcePath:\s*journal\.sourcePath,/u,
  );
});

function assertAlignedNavigation(harness, expectedProject) {
  const snapshot = harness.tabs.snapshot;
  const active = snapshot.tabs.find((tab) => tab.tabId === snapshot.activeTabId);
  assert.ok(active);
  if (active.kind === "start" || active.kind === "settings" || active.kind === "project-rules") {
    assert.equal(snapshot.mountedDocumentTabId, null);
    if (snapshot.runtimeOwnerTabId) {
      assert.equal(snapshot.tabs.some((tab) => (
        tab.kind === "document" && tab.tabId === snapshot.runtimeOwnerTabId
      )), true);
    }
    return;
  }
  assert.equal(snapshot.activeTabId, snapshot.mountedDocumentTabId);
  assert.equal(active.projectId, expectedProject.projectId);
  assert.equal(active.documentId, expectedProject.documentId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, expectedProject.projectId);
  assert.equal(harness.controller.getSnapshot().projectSession.documentId, expectedProject.documentId);
}

test("cold-start priority is external FIFO, persisted active tab, activePath compatibility, then Start", () => {
  assert.equal(workbenchStartupPriority({
    externalRequestCount: 1,
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
  }), "external");
  assert.equal(workbenchStartupPriority({
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
  }), "persisted-active-tab");
  assert.equal(workbenchStartupPriority({
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
    restoreTabsOnLaunch: false,
  }), "start");
  assert.equal(workbenchStartupPriority({
    externalRequestCount: 1,
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
    restoreTabsOnLaunch: false,
  }), "external");
  assert.equal(workbenchStartupPriority({ persistedStatePresent: false }), "active-path-compatibility");
  assert.equal(workbenchStartupPriority({ persistedStatePresent: true }), "start");
});

function projectSnapshot(project, epoch, options = {}) {
  return {
    projectSession: {
      projectId: project.projectId,
      documentId: project.documentId,
      epoch,
      sourcePath: `/managed/${project.projectId}.html`,
    },
    project: {
      hydration: {
        phase: options.hydration || "idle",
        epoch,
        error: options.error || null,
      },
      projectApplication: {
        status: options.application || "idle",
        activeApplicationId: options.activeApplicationId || null,
        queuedApplicationId: null,
      },
    },
    document: {
      canvasAuthority: {
        status: options.canvas || "verified",
        error: options.canvasError || null,
      },
    },
  };
}

function fixture({
  open,
  confirm,
  cancel,
  acceptExternal,
  tabsPersistence = null,
  surfaceCache = null,
  clock = { now: () => 1_000 },
  setTimer,
  clearTimer,
} = {}) {
  const tabs = new WorkbenchTabsSession();
  tabs.bindDocument({ ...A, title: A.name });
  const navigation = new WorkbenchNavigationSession();
  const phases = [];
  navigation.subscribe((snapshot) => phases.push({
    phase: snapshot.phase,
    transactionId: snapshot.transactionId,
    ordinal: snapshot.admissionOrdinal,
  }));
  let snapshot = projectSnapshot(A, 1);
  const listeners = new Set();
  const calls = [];
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    openProjectRules({ context }) {
      calls.push(`rules:${context.projectId}`);
      return Promise.resolve({ status: "succeeded", value: { opened: true } });
    },
  };
  const publish = (next) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  let workflow;
  let applicationSequence = 0;
  const apply = (active, project, options = {}) => {
    applicationSequence += 1;
    const applicationId = options.applicationId || `application-${applicationSequence}`;
    const epoch = options.epoch || Number(snapshot.projectSession?.epoch || 0) + 1;
    publish(projectSnapshot(project, epoch, {
      hydration: options.hydration || "idle",
      error: options.error,
      canvas: options.canvas || "verified",
      application: options.application || "idle",
      activeApplicationId: options.activeApplicationId,
    }));
    const receipt = workflow.applyProject({
      transactionId: active.transactionId,
      applicationId,
      project,
      epoch,
      activeLocked: options.activeLocked === true,
    });
    return { applicationId, receipt, epoch };
  };
  const projectWorkflow = {
    confirmation: null,
    getSnapshot() {
      return { openConfirmation: this.confirmation };
    },
    async prepareSwitch() {
      calls.push("prepare");
      return { status: "succeeded", value: {} };
    },
    async openProject(input) {
      calls.push(`open:${input.kind}:${input.projectId || input.sourcePath || ""}`);
      if (open) return open({ input, calls, apply: (project, options) => apply(input, project, options), publish, workflow, projectWorkflow: this });
      const project = input.projectId === A.projectId ? A : B;
      const applied = apply(input, project);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
    acceptProject(project, input) {
      calls.push(`accept:${input.kind}:${project.projectId}`);
      const applied = apply(input, project);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
    acceptExternalProject(input) {
      calls.push(`external:${input.requestId}`);
      if (acceptExternal) return acceptExternal({ input, apply: (project, options) => apply(input, project, options), publish, workflow });
      queueMicrotask(() => apply(input, B));
      return { status: "succeeded", value: { requestId: input.requestId } };
    },
    cancelProjectApplication(applicationId) {
      calls.push(`cancel-application:${applicationId}`);
      return true;
    },
    async confirmExternalOpen(input) {
      calls.push(`confirm:${input.requestId}`);
      if (confirm) return confirm({ input, apply: (project, options) => apply(input, project, options), publish, workflow });
      apply(input, B, { applicationId: `prepared-${input.requestId}` });
      return { status: "succeeded", value: { opened: true } };
    },
    async cancelExternalOpen(input) {
      calls.push(`cancel:${input.requestId}`);
      return cancel ? cancel({ input, publish }) : { status: "succeeded", value: { canceled: true } };
    },
  };
  workflow = new WorkbenchNavigationWorkflow({
    session: navigation,
    tabs,
    surfaceCache,
    projectWorkflow,
    controller,
    tabsPersistence,
    clock,
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
  });
  return { tabs, navigation, phases, calls, controller, projectWorkflow, workflow, publish, apply };
}

test("ACK-only retry completes without reapplying a project or requiring a new receipt", async () => {
  const harness = fixture({ confirm: async ({ input }) => ({
    status: "succeeded", value: { requestId: input.requestId, opened: true, acknowledged: true },
  }) });
  harness.projectWorkflow.confirmation = {
    requestId: "already_committed",
    classification: "new-external",
    deleteOriginal: false,
  };
  const result = await harness.workflow.retryOpen({ requestId: "already_committed" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.value.acknowledged, true);
  assert.equal(harness.navigation.snapshot.phase, "idle");
  assertAlignedNavigation(harness, A);
  assert.deepEqual(harness.calls, ["confirm:already_committed"]);
  harness.workflow.dispose();
});

for (const retryOutcome of [
  { status: "stale", identity: { requestId: "expired_prepared" } },
  {
    status: "rejected",
    code: "INVALID_PREPARED_OPEN_REQUEST",
    reason: "prepared request is malformed",
  },
]) {
  test(`Prepared retry falls back to the ordinary picker after ${retryOutcome.status}`, async () => {
    const harness = fixture({
      confirm: async () => retryOutcome,
      open: async () => ({ status: "succeeded", value: { opened: false } }),
    });
    harness.projectWorkflow.confirmation = null;

    const result = await harness.workflow.retryOpen({ requestId: "expired_prepared" });

    assert.equal(result.status, "succeeded");
    assert.equal(result.value.opened, false);
    assert.deepEqual(harness.calls, [
      "confirm:expired_prepared",
      "open:local:",
    ]);
    harness.workflow.dispose();
  });
}

test("ordinary Prepared local open waits for final settlement before releasing queued navigation", async () => {
  let release;
  const harness = fixture({ open: async ({ input, apply, workflow }) => {
    if (input.kind === "registered") {
      const applied = apply(C);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    }
    workflow.onPreparedOpenStarted({ ...input, requestId: "prepared_local" });
    apply(B);
    await new Promise((resolve) => { release = resolve; });
    return { status: "succeeded", value: { opened: true } };
  } });
  const first = harness.workflow.openProject({ kind: "local" });
  await nextTurn();
  const queued = harness.workflow.openProject({ kind: "registered", projectId: C.projectId });
  await nextTurn();
  assert.equal(harness.navigation.snapshot.phase, "applied");
  assert.equal(harness.calls.some((call) => call.includes(C.projectId)), false);
  assertAlignedNavigation(harness, B);
  release();
  assert.equal((await first).status, "succeeded");
  assert.equal((await queued).status, "succeeded");
  assertAlignedNavigation(harness, C);
  harness.workflow.dispose();
});

for (const failure of [false, true]) {
  test(`external Prepared settlement holds admission and retains its applied receipt: failure=${failure}`, async () => {
    let settle;
    let transactionId;
    const harness = fixture({ acceptExternal: ({ input, apply, workflow }) => {
      transactionId = input.transactionId;
      queueMicrotask(() => {
        workflow.onPreparedOpenStarted(input);
        apply(B);
        settle = () => workflow.onPreparedOpenSettled({
          ...input,
          outcome: failure
            ? { status: "rejected", code: "EXTERNAL_OPEN_ACK_REJECTED", reason: "ACK pending" }
            : { status: "succeeded", value: { opened: true } },
        });
      });
      return { status: "succeeded", value: { requestId: input.requestId } };
    } });
    await harness.workflow.acceptExternalProject({ requestId: "prepared_external" });
    await nextTurn();
    let idle = false;
    const closing = harness.workflow.prepareClose({ deadlineAt: 2_000 }).then((value) => { idle = value; });
    await nextTurn();
    assert.equal(idle, false);
    assert.notEqual(harness.navigation.snapshot.phase, "idle");
    assert.equal(harness.workflow.onPreparedOpenSettled({ transactionId: "stale", requestId: "prepared_external" }), false);
    assertAlignedNavigation(harness, B);
    assert.equal(settle(), true);
    await closing;
    assert.equal(idle, true);
    const terminal = await harness.workflow.waitForTerminal(transactionId);
    assert.equal(terminal.outcome.status, failure ? "rejected" : "succeeded");
    assert.equal(terminal.receipt.projectId, B.projectId);
    if (failure) assert.equal(terminal.outcome.committed, true);
    assertAlignedNavigation(harness, B);
    harness.workflow.dispose();
  });
}

test("tab activation touches the target cache and captures only the prior document projection", async () => {
  const cacheCalls = [];
  const surfaceCache = {
    touch(tabId) { cacheCalls.push(["touch", tabId]); },
    capture(input) { cacheCalls.push(["capture", input.tab.tabId]); },
    remove(tabId) { cacheCalls.push(["remove", tabId]); },
  };
  const harness = fixture({ surfaceCache });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
  const outcome = await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`);
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(cacheCalls.slice(0, 2), [
    ["touch", `document:${B.projectId}:${B.documentId}`],
    ["capture", `document:${A.projectId}:${A.documentId}`],
  ]);
});

for (const intent of ["startup", "local", "recent", "registered"]) {
  test(`${intent} uses one correlated transaction receipt and terminal identity`, async () => {
    const harness = fixture();
    if (intent === "registered") {
      harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
    }
    const outcome = intent === "registered"
      ? await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`)
      : await harness.workflow.openProject({ kind: intent, sourcePath: intent === "recent" ? "/B.html" : null });
    assert.equal(outcome.status, "succeeded");
    const receipt = harness.navigation.snapshot.lastReceipt;
    assert.equal(receipt.projectId, B.projectId);
    assert.equal(receipt.documentId, B.documentId);
    assert.equal(receipt.transactionId.startsWith("workbench-navigation-"), true);
    assert.equal(harness.tabs.snapshot.activeTabId, receipt.tabId);
    assert.equal(harness.tabs.snapshot.mountedDocumentTabId, receipt.tabId);
    assert.equal(harness.navigation.snapshot.phase, "idle");
    assert.deepEqual(
      harness.phases.filter((phase) => phase.transactionId === receipt.transactionId).map((phase) => phase.phase),
      ["admitted", "preparing", "opening", "applied", "display-ready", "committed"],
    );
  });
}

const SUCCESS_INGRESS_CASES = [
  {
    name: "startup restore compatibility",
    prepare: () => fixture(),
    run: (harness) => harness.workflow.openProject({ kind: "startup" }),
  },
  {
    name: "local Finder",
    prepare: () => fixture(),
    run: (harness) => harness.workflow.openProject({ kind: "local" }),
  },
  {
    name: "recent file",
    prepare: () => fixture(),
    run: (harness) => harness.workflow.openProject({ kind: "recent", sourcePath: "/B.html" }),
  },
  {
    name: "registered sidebar",
    prepare: () => fixture(),
    run: (harness) => harness.workflow.openRegisteredProject({ ...B, title: B.name }),
  },
  {
    name: "registered tab activation",
    prepare: () => {
      const harness = fixture();
      harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
      return harness;
    },
    run: (harness) => harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`),
  },
  {
    name: "OS external",
    prepare: () => fixture(),
    run: async (harness) => {
      const outcome = await harness.workflow.acceptExternalProject({ requestId: "external-matrix-B" });
      await nextTurn();
      return outcome;
    },
  },
];

for (const ingress of SUCCESS_INGRESS_CASES) {
  test(`navigation ingress matrix keeps one aligned identity: ${ingress.name}`, async () => {
    const harness = ingress.prepare();
    const outcome = await ingress.run(harness);
    assert.equal(outcome.status, "succeeded");
    assertAlignedNavigation(harness, B);
    assert.equal(harness.navigation.snapshot.phase, "idle");
  });
}

const DIRECT_FAILURE_CASES = [
  {
    name: "startup",
    action: (harness) => harness.workflow.openProject({ kind: "startup" }),
  },
  {
    name: "local Finder",
    action: (harness) => harness.workflow.openProject({ kind: "local" }),
  },
  {
    name: "recent",
    action: (harness) => harness.workflow.openProject({ kind: "recent", sourcePath: "/B.html" }),
  },
  {
    name: "registered sidebar",
    action: (harness) => harness.workflow.openRegisteredProject({ ...B, title: B.name }),
  },
  {
    name: "tab activation",
    setup(harness) { harness.tabs.bindDocument({ ...B, title: B.name, focus: false }); },
    action: (harness) => harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`),
  },
];

for (const ingress of DIRECT_FAILURE_CASES) {
  test(`pre-apply failure matrix preserves A: ${ingress.name}`, async () => {
    const harness = fixture({
      open: async () => ({ status: "rejected", code: "OPEN_FAILED", reason: "pre-apply" }),
    });
    ingress.setup?.(harness);
    const outcome = await ingress.action(harness);
    assert.equal(outcome.status, "rejected");
    assertAlignedNavigation(harness, A);
  });

  test(`post-display readiness failure keeps aligned B visible: ${ingress.name}`, async () => {
    const harness = fixture({
      open: async ({ apply }) => {
        const applied = apply(B, { hydration: "failed", error: "post-apply" });
        return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
      },
    });
    ingress.setup?.(harness);
    const outcome = await ingress.action(harness);
    assert.equal(outcome.status, "succeeded");
    await nextTurn();
    assertAlignedNavigation(harness, B);
    assert.equal(
      harness.tabs.snapshot.tabs.find((tab) => tab.projectId === B.projectId)?.status,
      "error",
    );
  });
}

test("active document close protects and removes the current tab before opening its successor", async () => {
  const order = [];
  const harness = fixture({
    open: ({ input, apply }) => {
      order.push("open-successor");
      assert.equal(input.switchPrepared, true);
      const applied = apply(B);
      return {
        status: "succeeded",
        value: { opened: true, applicationId: applied.applicationId },
      };
    },
  });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
  harness.projectWorkflow.prepareSwitch = async () => {
    order.push("protect-current");
    return { status: "succeeded", value: {} };
  };
  const close = harness.tabs.close.bind(harness.tabs);
  harness.tabs.close = (tabId) => {
    order.push("close-current");
    return close(tabId);
  };

  const outcome = await harness.workflow.closeTab(`document:${A.projectId}:${A.documentId}`);

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(order, ["protect-current", "close-current", "open-successor"]);
  assert.equal(
    harness.tabs.snapshot.tabs.some((tab) => tab.projectId === A.projectId),
    false,
  );
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${B.projectId}:${B.documentId}`);
});

test("active document close falls back to Start without resurrecting a failed successor", async () => {
  const harness = fixture({
    open: () => ({
      status: "rejected",
      code: "SUCCESSOR_UNAVAILABLE",
      reason: "successor unavailable",
    }),
  });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });

  const outcome = await harness.workflow.closeTab(`document:${A.projectId}:${A.documentId}`);

  assert.equal(outcome.status, "rejected");
  assert.equal(
    harness.tabs.snapshot.tabs.some((tab) => tab.projectId === A.projectId),
    false,
  );
  assert.equal(
    harness.tabs.snapshot.tabs.find((tab) => tab.tabId === harness.tabs.snapshot.activeTabId)?.kind,
    "start",
  );
});

test("external pre-apply and post-apply failures preserve the phase contract", async () => {
  const pre = fixture({
    acceptExternal: () => ({ status: "rejected", code: "EXTERNAL_READ", reason: "pre" }),
  });
  const preOutcome = await pre.workflow.acceptExternalProject({ requestId: "external-pre" });
  assert.equal(preOutcome.status, "rejected");
  assertAlignedNavigation(pre, A);

  const post = fixture({
    acceptExternal: ({ input, apply }) => {
      queueMicrotask(() => apply(B, { hydration: "failed", error: "external hydrate" }));
      return { status: "succeeded", value: { requestId: input.requestId } };
    },
  });
  const accepted = await post.workflow.acceptExternalProject({ requestId: "external-post" });
  assert.equal(accepted.status, "succeeded");
  await nextTurn();
  const terminal = await post.workflow.waitForTerminal(post.navigation.snapshot.lastReceipt.transactionId);
  assert.equal(terminal.outcome.status, "succeeded");
  assertAlignedNavigation(post, B);
});

for (const failurePhase of ["pre-apply", "post-apply"]) {
  test(`confirmation ${failurePhase} failure keeps tab and Controller paired`, async () => {
    const harness = fixture({
      open: async ({ input, workflow, projectWorkflow }) => {
        projectWorkflow.confirmation = { requestId: `confirm-${failurePhase}`, classification: "new-external" };
        workflow.onConfirmationPresented({
          transactionId: input.transactionId,
          requestId: `confirm-${failurePhase}`,
        });
        return { status: "succeeded", value: { awaitingConfirmation: true, opened: false } };
      },
      confirm: async ({ input, apply }) => {
        if (failurePhase === "post-apply") apply(B, { applicationId: `prepared-${input.requestId}` });
        return { status: "rejected", code: "CONFIRM_FAILED", reason: failurePhase };
      },
    });
    await harness.workflow.openProject({ kind: "local" });
    const outcome = await harness.workflow.confirmOpen({
      requestId: `confirm-${failurePhase}`,
      action: "import-new",
    });
    assert.equal(outcome.status, "rejected");
    if (failurePhase === "post-apply") {
      assert.equal(outcome.committed, true);
      assertAlignedNavigation(harness, B);
    } else {
      assert.equal(outcome.committed, undefined);
      assertAlignedNavigation(harness, A);
    }
  });
}

test("Start activation and active-tab close keep mounted/runtime ownership invariant", async () => {
  const harness = fixture();
  const created = await harness.workflow.createStart();
  assert.equal(created.status, "succeeded");
  const startReceipt = harness.navigation.snapshot.lastReceipt;
  assert.equal(startReceipt.kind, "start");
  assert.equal(harness.tabs.snapshot.activeTabId, startReceipt.tabId);
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, `document:${A.projectId}:${A.documentId}`);

  const returned = await harness.workflow.activateTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(returned.status, "succeeded");
  const closed = await harness.workflow.closeTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(closed.status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.some((tab) => tab.kind === "document"), false);
  assert.equal(harness.tabs.snapshot.tabs.find(
    (tab) => tab.tabId === harness.tabs.snapshot.activeTabId,
  ).kind, "start");
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, null);
});

test("same-tick new Start tabs focus the last admitted tab without a second document drain", async () => {
  const harness = fixture();
  const first = harness.workflow.createStart();
  const second = harness.workflow.createStart();
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.length, 3);
  assert.equal(harness.tabs.snapshot.activeTabId, "start:2");
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, `document:${A.projectId}:${A.documentId}`);
  assert.deepEqual(harness.calls.filter((call) => call === "prepare"), ["prepare"]);
});

test("settings opens once, returns to the retained document without reopening ProjectWorkflow", async () => {
  const harness = fixture();
  const opened = await harness.workflow.createSettings();
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.tabId, "settings:1");
  assert.equal(harness.navigation.snapshot.lastReceipt.kind, "settings");
  assert.equal(harness.tabs.snapshot.activeTabId, "settings:1");
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, `document:${A.projectId}:${A.documentId}`);

  const reopened = await harness.workflow.createSettings();
  assert.equal(reopened.status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.filter((tab) => tab.kind === "settings").length, 1);

  const returned = await harness.workflow.activateTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(returned.status, "succeeded");
  assert.equal(harness.navigation.snapshot.lastReceipt.kind, "document");
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${A.projectId}:${A.documentId}`);
  assert.equal(harness.calls.some((call) => call === `open:registered:${A.projectId}`), false);

  const settingsTab = harness.tabs.snapshot.tabs.find((tab) => tab.kind === "settings");
  assert.ok(settingsTab);
  await harness.workflow.activateTab(settingsTab.tabId);
  const closed = await harness.workflow.closeTab(settingsTab.tabId);
  assert.equal(closed.status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.some((tab) => tab.kind === "settings"), false);
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${A.projectId}:${A.documentId}`);
  assert.equal(harness.calls.some((call) => call === `open:registered:${A.projectId}`), false);
});

test("长期规则只打开一个标签，并在返回 HTML 时复用 runtime owner", async () => {
  const harness = fixture();
  const first = await harness.workflow.createProjectRules();
  assert.equal(first.status, "succeeded");
  assert.equal(first.value.tabId, "project-rules:1");
  assert.equal(harness.navigation.snapshot.lastReceipt.kind, "project-rules");
  assert.equal(harness.tabs.snapshot.activeTabId, "project-rules:1");
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, "document:project_alpha:doc_alpha");
  assert.deepEqual(harness.calls.filter((call) => call === `rules:${A.projectId}`), [`rules:${A.projectId}`]);

  const second = await harness.workflow.createProjectRules();
  assert.equal(second.status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.filter((tab) => tab.kind === "project-rules").length, 1);
  assert.deepEqual(harness.calls.filter((call) => call === `rules:${A.projectId}`), [`rules:${A.projectId}`]);

  const returned = await harness.workflow.activateTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(returned.status, "succeeded");
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${A.projectId}:${A.documentId}`);
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, `document:${A.projectId}:${A.documentId}`);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, `document:${A.projectId}:${A.documentId}`);
  assert.deepEqual(harness.calls.filter((call) => call === "prepare"), ["prepare"]);
});

test("external admission completes only after the correlated application and terminal settlement", async () => {
  const harness = fixture();
  const accepted = await harness.workflow.acceptExternalProject({ requestId: "external-B" });
  assert.equal(accepted.status, "succeeded");
  assert.notEqual(harness.navigation.snapshot.phase, "idle");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.navigation.snapshot.phase, "idle");
  assert.equal(harness.navigation.snapshot.lastReceipt.projectId, B.projectId);
});

test("pre-apply failure restores the exact prior tab and controller alignment", async () => {
  const harness = fixture({
    open: async () => ({ status: "rejected", code: "OPEN_FAILED", reason: "failed before apply" }),
  });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
  const before = harness.tabs.snapshot;
  const outcome = await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`);
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.tabs.snapshot.activeTabId, before.activeTabId);
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, before.mountedDocumentTabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, A.projectId);
});

test("post-display failure keeps the visible receipt identity and marks the tab", async () => {
  const harness = fixture({
    open: async ({ apply }) => {
      const applied = apply(B, { hydration: "failed", error: "hydrate failed" });
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
  });
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "succeeded");
  await nextTurn();
  assert.equal(harness.tabs.snapshot.activeTabId, outcome.value.receipt.tabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, B.projectId);
  assert.equal(
    harness.tabs.snapshot.tabs.find((tab) => tab.tabId === outcome.value.receipt.tabId).status,
    "error",
  );
});

test("same-tick A then B is admitted in ordinal order without busy rejection", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const harness = fixture({
    open: async ({ input, apply }) => {
      if (input.sourcePath === "/B.html") await firstGate;
      const project = input.sourcePath === "/B.html" ? B : C;
      const applied = apply(project);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
  });
  const first = harness.workflow.openProject({ kind: "recent", sourcePath: "/B.html" });
  const second = harness.workflow.openProject({ kind: "recent", sourcePath: "/C.html" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.calls, ["open:recent:/B.html"]);
  releaseFirst();
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).status, "succeeded");
  assert.deepEqual(harness.calls, ["open:recent:/B.html", "open:recent:/C.html"]);
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${C.projectId}:${C.documentId}`);
  assert.equal(harness.navigation.snapshot.admissionOrdinal, 2);
});

test("display-ready releases the next tab admission while prior hydration is still pending", async () => {
  const harness = fixture({
    open: async ({ input, apply }) => {
      const project = input.projectId === B.projectId ? B : C;
      const applied = apply(project, {
        hydration: project === B ? "hydrating" : "idle",
        canvas: project === B ? "pending" : "verified",
      });
      return {
        status: "succeeded",
        value: { opened: true, applicationId: applied.applicationId },
      };
    },
  });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
  harness.tabs.bindDocument({ ...C, title: C.name, focus: false });

  const first = await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`);
  assert.equal(first.status, "succeeded");
  assert.equal(harness.controller.getSnapshot().project.hydration.phase, "hydrating");

  const second = await harness.workflow.activateTab(`document:${C.projectId}:${C.documentId}`);
  assert.equal(second.status, "succeeded");
  assertAlignedNavigation(harness, C);
  assert.deepEqual(harness.calls, [
    `open:registered:${B.projectId}`,
    `open:registered:${C.projectId}`,
  ]);
});

test("background readiness success does not erase an active processing tab status", async () => {
  const harness = fixture({
    open: async ({ apply }) => {
      const applied = apply(B, { activeLocked: true });
      return {
        status: "succeeded",
        value: { opened: true, applicationId: applied.applicationId },
      };
    },
  });
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "succeeded");
  await nextTurn();
  assert.equal(
    harness.tabs.snapshot.tabs.find((tab) => tab.projectId === B.projectId)?.status,
    "processing",
  );
});

const INTERLEAVING_CASES = [
  { name: "restore B + startup external C", intentKind: "startup-restore", second: "external", expected: C },
  { name: "activate B + external C", intentKind: "tab-activation", second: "external", expected: C },
  { name: "activate B + local D", intentKind: "tab-activation", second: "local", expected: D },
  { name: "activate B + recent D", intentKind: "tab-activation", second: "recent", expected: D },
];

for (const scenario of INTERLEAVING_CASES) {
  test(`navigation admission interleaving is FIFO: ${scenario.name}`, async () => {
    let releaseB;
    const gateB = new Promise((resolve) => { releaseB = resolve; });
    const harness = fixture({
      open: async ({ input, apply }) => {
        if (input.projectId === B.projectId) {
          await gateB;
          const applied = apply(B);
          return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
        }
        const applied = apply(D);
        return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
      },
      acceptExternal: ({ input, apply }) => {
        queueMicrotask(() => apply(C));
        return { status: "succeeded", value: { requestId: input.requestId } };
      },
    });
    harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
    const first = harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`, {
      intentKind: scenario.intentKind,
    });
    const second = scenario.second === "external"
      ? harness.workflow.acceptExternalProject({ requestId: `external-${scenario.intentKind}` })
      : harness.workflow.openProject({
        kind: scenario.second,
        sourcePath: scenario.second === "recent" ? "/D.html" : null,
      });
    await nextTurn();
    assert.deepEqual(harness.calls, [`open:registered:${B.projectId}`]);
    releaseB();
    assert.equal((await first).status, "succeeded");
    assert.equal((await second).status, "succeeded");
    await nextTurn();
    assertAlignedNavigation(harness, scenario.expected);
    assert.equal(harness.navigation.snapshot.admissionOrdinal, 2);
  });
}

test("confirmation failure after apply rolls tabs back with the controller receipt", async () => {
  const harness = fixture({
    open: async ({ input, workflow, projectWorkflow }) => {
      projectWorkflow.confirmation = { requestId: "confirm-B", classification: "new-external" };
      workflow.onConfirmationPresented({
        transactionId: input.transactionId,
        requestId: "confirm-B",
      });
      return { status: "succeeded", value: { awaitingConfirmation: true, opened: false } };
    },
    confirm: async ({ input, apply, publish }) => {
      apply(B, { applicationId: `prepared-${input.requestId}` });
      publish(projectSnapshot(A, 3));
      return { status: "rejected", code: "CANVAS_FAILED", reason: "rolled back" };
    },
  });
  const before = harness.tabs.snapshot;
  await harness.workflow.openProject({ kind: "local" });
  const outcome = await harness.workflow.confirmOpen({
    requestId: "confirm-B",
    action: "import-new",
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.committed, undefined);
  assert.equal(harness.tabs.snapshot.activeTabId, before.activeTabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, A.projectId);
});

test("close waits for a committing confirmation instead of canceling it", async () => {
  let releaseCommit;
  const commitGate = new Promise((resolve) => { releaseCommit = resolve; });
  const harness = fixture({
    open: async ({ input, workflow, projectWorkflow }) => {
      projectWorkflow.confirmation = { requestId: "confirm-B", classification: "new-external" };
      workflow.onConfirmationPresented({ transactionId: input.transactionId, requestId: "confirm-B" });
      return { status: "succeeded", value: { awaitingConfirmation: true, opened: false } };
    },
    confirm: async ({ input, apply }) => {
      await commitGate;
      apply(B, { applicationId: `prepared-${input.requestId}` });
      return { status: "succeeded", value: { opened: true } };
    },
  });
  await harness.workflow.openProject({ kind: "local" });
  const commit = harness.workflow.confirmOpen({ requestId: "confirm-B", action: "import-new" });
  await new Promise((resolve) => setImmediate(resolve));
  let closeSettled = false;
  const close = harness.workflow.prepareClose({ deadlineAt: 6_000 })
    .then((value) => { closeSettled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeSettled, false);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("cancel:")), []);
  releaseCommit();
  assert.equal((await commit).status, "succeeded");
  assert.equal(await close, true);
});

test("disposal rolls back an awaiting transaction and rejects later admissions", async () => {
  const harness = fixture({
    open: async () => ({ status: "succeeded", value: { awaitingFile: true } }),
  });
  await harness.workflow.openProject({ kind: "local" });
  harness.workflow.dispose();
  assert.equal(harness.navigation.snapshot.phase, "idle");
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${A.projectId}:${A.documentId}`);
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.code, "WORKBENCH_NAVIGATION_DISPOSED");
});

test("presentation listener failure cannot interrupt navigation or tab authority", async () => {
  const harness = fixture();
  harness.navigation.subscribe(() => { throw new Error("navigation presentation failed"); });
  harness.tabs.subscribe(() => { throw new Error("tabs presentation failed"); });
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "succeeded");
  assertAlignedNavigation(harness, B);
  assert.equal(harness.navigation.snapshot.phase, "idle");
});

test("receipt deadline expires application authority before a deferred external apply resumes", async () => {
  const timers = [];
  const harness = fixture({
    acceptExternal: () => ({ status: "succeeded", value: { requestId: "external-late" } }),
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs, canceled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.canceled = true;
    },
  });
  const accepted = await harness.workflow.acceptExternalProject({ requestId: "external-late" });
  assert.equal(accepted.status, "succeeded");
  const transactionId = harness.navigation.snapshot.transactionId;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 15_000);
  timers[0].callback();
  await nextTurn();
  const terminal = await harness.workflow.waitForTerminal(transactionId);
  assert.equal(terminal.outcome.status, "rejected");
  assert.equal(terminal.outcome.code, "WORKBENCH_NAVIGATION_APPLY_TIMEOUT");
  assert.deepEqual(harness.workflow.authorizeProjectApplication({
    transactionId,
    applicationId: "application-late",
  }), { accepted: false, kind: "stale" });
  const lateReceipt = harness.workflow.applyProject({
    transactionId,
    applicationId: "application-late",
    project: B,
    epoch: 2,
    activeLocked: false,
  });
  assert.equal(lateReceipt.kind, "stale");
  assertAlignedNavigation(harness, A);
  assert.equal(harness.navigation.snapshot.phase, "idle");
});

test("null transaction remains a legal authority refresh while non-null stale identity is rejected", () => {
  const harness = fixture();
  harness.publish(projectSnapshot(B, 2));
  assert.deepEqual(harness.workflow.authorizeProjectApplication({
    transactionId: null,
    applicationId: "authority-refresh",
  }), { accepted: true, kind: "authority-refresh" });
  const refreshed = harness.workflow.applyProject({
    transactionId: null,
    applicationId: "authority-refresh",
    project: B,
    epoch: 2,
    activeLocked: false,
  });
  assert.equal(refreshed.kind, "authority-refresh");
  assertAlignedNavigation(harness, B);
  assert.deepEqual(harness.workflow.authorizeProjectApplication({
    transactionId: "navigation-stale",
    applicationId: "application-stale",
  }), { accepted: false, kind: "stale" });
});

test("receipt deadline cancels a known deferred application generation", async () => {
  const timers = [];
  const harness = fixture({
    open: async () => ({
      status: "succeeded",
      value: { opened: true, applicationId: "application-deferred" },
    }),
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs, canceled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.canceled = true;
    },
  });
  const opening = harness.workflow.openProject({ kind: "local" });
  await nextTurn();
  assert.equal(timers.length, 1);
  timers[0].callback();
  const outcome = await opening;
  assert.equal(outcome.code, "WORKBENCH_NAVIGATION_APPLY_TIMEOUT");
  assert.equal(harness.calls.includes("cancel-application:application-deferred"), true);
  assertAlignedNavigation(harness, A);
});

test("close freeze rejects every same-tick ingress and abort or final-exit retry reopens admission", async () => {
  const persisted = [];
  const harness = fixture({
    tabsPersistence: { commit: (state) => persisted.push(state) },
  });
  assert.equal(harness.workflow.beginClose({ requestId: "close-one" }), true);
  const outcomes = await Promise.all([
    harness.workflow.openProject({ kind: "local" }),
    harness.workflow.activateTab(`document:${A.projectId}:${A.documentId}`),
    harness.workflow.openRegisteredProject({ ...B, title: B.name }),
    harness.workflow.createStart(),
    harness.workflow.closeTab(`document:${A.projectId}:${A.documentId}`),
    harness.workflow.acceptExternalProject({ requestId: "external-frozen" }),
    harness.workflow.confirmOpen({ requestId: "confirmation-frozen" }),
  ]);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.code),
    Array(outcomes.length).fill("WORKBENCH_NAVIGATION_CLOSE_FROZEN"),
  );
  assert.equal(persisted.length, 0);
  assertAlignedNavigation(harness, A);

  assert.equal(harness.workflow.abortClose({ requestId: "close-one" }), true);
  assert.equal((await harness.workflow.openProject({ kind: "local" })).status, "succeeded");
  assertAlignedNavigation(harness, B);
  assert.equal(persisted.length, 1);

  assert.equal(harness.workflow.beginClose({ requestId: "close-two" }), true);
  assert.equal(harness.workflow.commitClose({ requestId: "close-two" }), true);
  assert.equal(
    (await harness.workflow.createStart()).code,
    "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
  );
  assert.equal(harness.workflow.abortClose({ requestId: "close-two" }), true);
  assert.equal((await harness.workflow.createStart()).status, "succeeded");
});
