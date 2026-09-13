import { projectAppliedEventToWorkbenchTabs } from "./workbench-tabs-session.js";

const PREPARED_RETRY_PICKER_CODES = new Set([
  "EXTERNAL_IMPORT_FAILED",
  "EXTERNAL_OPEN_ACTION_INVALID",
  "EXTERNAL_OPEN_ACTION_MISMATCH",
  "EXTERNAL_OPEN_COMMIT_INVALID",
  "EXTERNAL_OPEN_REQUEST_EXPIRED",
  "EXTERNAL_OPEN_TARGET_MISSING",
  "INVALID_PREPARED_OPEN_REQUEST",
  "OPEN_INTENT_SOURCE_CHANGED",
]);

function rejected(code, reason, details = {}) {
  return Object.freeze({ status: "rejected", code, reason, ...details });
}

function succeeded(value = {}) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
}

function outcomeError(outcome, fallbackCode, fallbackReason) {
  return Object.freeze({
    code: String(outcome?.code || fallbackCode),
    reason: String(outcome?.reason || fallbackReason),
  });
}

function transactionId(ordinal, now) {
  return `workbench-navigation-${Math.max(0, Number(now) || 0).toString(36)}-${ordinal.toString(36)}`;
}

export function workbenchStartupPriority({
  externalRequestCount = 0,
  persistedStatePresent = false,
  persistedActiveTabId = null,
  restoreTabsOnLaunch = true,
} = {}) {
  if (Number(externalRequestCount) > 0) return "external";
  if (restoreTabsOnLaunch === false) return "start";
  if (persistedStatePresent && persistedActiveTabId) return "persisted-active-tab";
  if (!persistedStatePresent) return "active-path-compatibility";
  return "start";
}

export function workbenchNavigationOutcomeHasCommittedDocument(outcome) {
  return Boolean(
    outcome
    && outcome.status === "rejected"
    && outcome.committed === true
    && typeof outcome.tabId === "string"
    && outcome.tabId,
  );
}

export class WorkbenchNavigationWorkflow {
  #session;
  #tabs;
  #surfaceCache;
  #projectWorkflow;
  #controller;
  #tabsPersistence;
  #clock;
  #setTimer;
  #clearTimer;
  #admissionTail = Promise.resolve();
  #busy = false;
  #active = null;
  #ordinal = 0;
  #disposed = false;
  #terminalReceipts = new Map();
  #idleWaiters = new Set();
  #closeFreeze = null;

  constructor({
    session,
    tabs,
    surfaceCache = null,
    projectWorkflow,
    controller,
    tabsPersistence = null,
    clock = { now: Date.now },
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    if (!session || !tabs || !projectWorkflow || !controller) {
      throw new TypeError("navigation workflow requires session, tabs, project workflow and controller");
    }
    this.#session = session;
    this.#tabs = tabs;
    this.#surfaceCache = surfaceCache;
    this.#projectWorkflow = projectWorkflow;
    this.#controller = controller;
    this.#tabsPersistence = tabsPersistence;
    this.#clock = clock;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  openProject(input = {}) {
    const kind = String(input.kind || "local");
    return this.#admit({ kind, sourcePath: input.sourcePath || null }, (active) => (
      this.#openProject(active, input)
    ));
  }

  activateTab(tabId, input = {}) {
    return this.#admit({
      kind: input.intentKind || "tab-activation",
      tabId: String(tabId || ""),
    }, (active) => this.#activateTab(active, tabId, input));
  }

  openRegisteredProject(input) {
    return this.#admit({
      kind: "registered-sidebar",
      projectId: String(input?.projectId || ""),
      documentId: String(input?.documentId || ""),
    }, async (active) => {
      const tab = this.#tabs.stageDocument(input);
      if (!tab) {
        return { outcome: rejected(
          "WORKBENCH_TAB_SWITCH_BUSY",
          "另一个开始标签正在打开 HTML，请稍后重试。",
        ) };
      }
      return this.#activateTab(active, tab.tabId, input);
    });
  }

  createStart() {
    return this.#admit({ kind: "create-start" }, async (active) => {
      const before = new Set(this.#tabs.snapshot.tabs.map((tab) => tab.tabId));
      this.#tabs.createStart({ focus: false });
      const created = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId));
      return created
        ? this.#activateTab(active, created.tabId, {})
        : { outcome: rejected("WORKBENCH_START_CREATE_FAILED", "无法创建新标签页。") };
    });
  }

  createSettings() {
    return this.#admit({ kind: "create-settings" }, async (active) => {
      const before = new Set(this.#tabs.snapshot.tabs.map((tab) => tab.tabId));
      this.#tabs.createSettings({ focus: false });
      const created = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId))
        || this.#tabs.snapshot.tabs.find((tab) => tab.kind === "settings");
      return created
        ? this.#activateTab(active, created.tabId, {})
        : { outcome: rejected("WORKBENCH_SETTINGS_CREATE_FAILED", "无法打开设置。") };
    });
  }

  createProjectRules() {
    return this.#admit({ kind: "create-project-rules" }, async (active) => {
      const project = this.#controller.getSnapshot()?.projectSession;
      if (!project?.projectId || !project.documentId || !project.sourcePath) {
        return { outcome: rejected(
          "PROJECT_RULES_CONTEXT_REQUIRED",
          "当前项目尚未完成初始化，暂时不能打开长期规则。",
        ) };
      }
      const before = new Set(this.#tabs.snapshot.tabs.map((tab) => tab.tabId));
      this.#tabs.createProjectRules({ focus: false });
      const created = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId))
        || this.#tabs.snapshot.tabs.find((tab) => tab.kind === "project-rules");
      return created
        ? this.#activateTab(active, created.tabId, {})
        : { outcome: rejected(
          "PROJECT_RULES_CREATE_FAILED",
          "无法打开长期规则。",
        ) };
    });
  }

  closeTab(tabId) {
    return this.#admit({ kind: "close-tab", tabId: String(tabId || "") }, async (active) => {
      const snapshot = this.#tabs.snapshot;
      const index = snapshot.tabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) return { outcome: succeeded({ unchanged: true }) };
      const closing = snapshot.tabs[index];
      if (snapshot.activeTabId !== tabId) {
        this.#tabs.close(tabId);
        this.#surfaceCache?.remove(tabId);
        return { outcome: succeeded({ tabId }) };
      }
      let next = snapshot.tabs[index + 1] || snapshot.tabs[index - 1] || null;
      if (!next) {
        const before = new Set(snapshot.tabs.map((tab) => tab.tabId));
        this.#tabs.createStart({ focus: false });
        next = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId)) || null;
      }
      if (!next) return { outcome: rejected("WORKBENCH_TAB_CLOSE_FAILED", "无法安全关闭这个标签页。") };
      if (closing.kind === "document") {
        const prepared = await this.#projectWorkflow.prepareSwitch();
        if (prepared?.status !== "succeeded") {
          return { outcome: rejected(
            prepared?.code || "WORKBENCH_TAB_CLOSE_BLOCKED",
            String(prepared?.reason || "当前 HTML 尚未安全收口。"),
          ) };
        }
        this.#captureCurrentSurface(closing);
      }
      this.#tabs.close(tabId);
      this.#surfaceCache?.remove(tabId);
      // Protection is settled before the tab authority is removed. From this
      // point rollback may preserve the successor, but must not resurrect the
      // document the user already closed.
      active.priorTabs = this.#tabs.captureAuthority();
      const activated = await this.#activateTab(active, next.tabId, {
        force: true,
        skipPrepare: true,
        skipCapture: true,
        switchPrepared: closing.kind === "document",
        currentOverride: closing,
      });
      if (activated.outcome.status !== "succeeded") {
        const before = new Set(this.#tabs.snapshot.tabs.map((tab) => tab.tabId));
        this.#tabs.createStart({ focus: false });
        const fallback = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId))
          || this.#tabs.snapshot.tabs.find((tab) => tab.kind === "start");
        if (!fallback) return activated;
        this.#tabs.beginSwitch(fallback.tabId, { force: true });
        this.#tabs.commitStart(fallback.tabId);
        active.priorTabs = this.#tabs.captureAuthority();
        const receipt = Object.freeze({
          transactionId: active.transactionId,
          applicationId: null,
          projectId: null,
          documentId: null,
          epoch: Number(this.#controller.getSnapshot()?.projectSession?.epoch) || 0,
          tabId: fallback.tabId,
          kind: "start",
        });
        return {
          outcome: rejected(
            activated.outcome.code || "WORKBENCH_TAB_SUCCESSOR_FAILED",
            activated.outcome.reason || "标签页已关闭，但后继 HTML 暂时无法打开。",
          ),
          receipt,
        };
      }
      return {
        ...activated,
        outcome: succeeded({ tabId, activeTabId: next.tabId }),
      };
    });
  }

  acceptExternalProject(input) {
    return this.#admit({
      kind: "external",
      requestId: String(input?.requestId || ""),
    }, async (active) => {
      active.requestId = String(input?.requestId || "");
      this.#session.transition(active.transactionId, "opening");
      const outcome = this.#projectWorkflow.acceptExternalProject({
        ...input,
        transactionId: active.transactionId,
      });
      if (outcome?.status !== "succeeded") return { outcome };
      active.continuation = "external-terminal";
      active.externalAuto = true;
      void this.#finishExternalWhenApplied(active);
      return { suspended: true, outcome };
    });
  }

  confirmOpen(input = {}) {
    const requestedId = String(input.requestId || "");
    const active = this.#active;
    if (active && active.requestId === requestedId && active.continuation) {
      return this.#continue(active, () => this.#confirm(active, input));
    }
    return this.#admit({ kind: "confirmation", requestId: requestedId }, (next) => {
      next.requestId = requestedId;
      return this.#confirm(next, input);
    });
  }

  cancelOpen(input = {}) {
    const requestedId = String(input.requestId || "");
    const active = this.#active;
    if (active && active.requestId === requestedId && active.continuation) {
      return this.#continue(active, async () => {
        const outcome = await this.#projectWorkflow.cancelExternalOpen(input);
        if (outcome?.status === "succeeded") this.#tabs.restoreAuthority(active.priorTabs);
        return { outcome };
      });
    }
    return this.#admit({ kind: "confirmation-cancel", requestId: requestedId }, async () => ({
      outcome: await this.#projectWorkflow.cancelExternalOpen(input),
    }));
  }

  async retryOpen(input = {}) {
    const confirmation = this.#projectWorkflow.getSnapshot().openConfirmation;
    const outcome = await this.confirmOpen({
      ...input,
      action: confirmation?.classification === "new-external"
        ? "import-new"
        : "continue-current",
      deleteOriginal: confirmation?.deleteOriginal === true,
    });
    if (
      outcome?.status !== "stale"
      && !(
        outcome?.status === "rejected"
        && PREPARED_RETRY_PICKER_CODES.has(String(outcome.code || ""))
      )
    ) return outcome;
    return this.openProject({ kind: "local" });
  }

  resumeDeferredProjectApplication() {
    if (this.#closeFreeze) return rejected(
      "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
      "窗口正在完成关闭核对，暂不继续 HTML 切换。",
    );
    return this.#projectWorkflow.resumeDeferredProjectApplication();
  }

  resumeDeferredExternalProject() {
    if (this.#closeFreeze) return rejected(
      "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
      "窗口正在完成关闭核对，暂不继续外部 HTML 打开。",
    );
    return this.#projectWorkflow.resumeDeferredExternalProject();
  }

  beginClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!id || this.#disposed) return false;
    if (this.#closeFreeze) return false;
    this.#closeFreeze = Object.freeze({ requestId: id, phase: "preparing" });
    return true;
  }

  commitClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!this.#closeFreeze || this.#closeFreeze.requestId !== id) return false;
    this.#closeFreeze = Object.freeze({ requestId: id, phase: "ready" });
    return true;
  }

  abortClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!this.#closeFreeze || this.#closeFreeze.requestId !== id) return false;
    this.#closeFreeze = null;
    return true;
  }

  authorizeProjectApplication({ transactionId: receivedTransactionId, applicationId } = {}) {
    const received = String(receivedTransactionId || "");
    const receivedApplication = String(applicationId || "");
    if (!received) {
      return Object.freeze({ accepted: true, kind: "authority-refresh" });
    }
    const active = this.#active;
    if (
      !active
      || active.transactionId !== received
      || active.applicationAuthorityOpen !== true
      || this.#terminalReceipts.has(received)
      || !receivedApplication
      || (active.applicationId && active.applicationId !== receivedApplication)
    ) {
      return Object.freeze({ accepted: false, kind: "stale" });
    }
    active.applicationId = receivedApplication;
    return Object.freeze({ accepted: true, kind: "transaction" });
  }

  applyProject({ transactionId: receivedTransactionId, applicationId, project, epoch, activeLocked }) {
    const active = this.#active;
    const received = String(receivedTransactionId || "");
    if (!received) {
      const snapshot = projectAppliedEventToWorkbenchTabs({
        session: this.#tabs,
        event: { type: "project-applied", project, activeLocked },
        title: project?.name,
      });
      const activeTab = snapshot?.tabs.find((tab) => tab.tabId === snapshot.activeTabId) || null;
      return Object.freeze({
        transactionId: "uncorrelated",
        applicationId: applicationId ? String(applicationId) : null,
        projectId: String(project?.projectId || "") || null,
        documentId: String(project?.documentId || "") || null,
        epoch: Number(epoch) || 0,
        tabId: activeTab?.kind === "document" ? activeTab.tabId : null,
        kind: "authority-refresh",
      });
    }
    const receivedApplication = String(applicationId || "");
    if (
      !active
      || active.transactionId !== received
      || active.applicationAuthorityOpen !== true
      || this.#terminalReceipts.has(received)
      || !receivedApplication
      || (active.applicationId && active.applicationId !== receivedApplication)
    ) {
      return Object.freeze({
        transactionId: received,
        applicationId: receivedApplication || null,
        projectId: String(project?.projectId || "") || null,
        documentId: String(project?.documentId || "") || null,
        epoch: Number(epoch) || 0,
        tabId: null,
        kind: "stale",
      });
    }
    active.applicationId = receivedApplication;

    const projectId = String(project?.projectId || "");
    const documentId = String(project?.documentId || "");
    const title = String(project?.name || "HTML");
    let tabId = active.expectedTabId;
    if (tabId) {
      this.#tabs.bindDocument({
        projectId,
        documentId,
        title,
        status: activeLocked === true ? "processing" : "normal",
        focus: false,
      });
      const committed = this.#tabs.commitDocument({ tabId, projectId, documentId, title });
      if (!committed) tabId = null;
    }
    if (!tabId) {
      const snapshot = this.#tabs.bindDocument({
        projectId,
        documentId,
        title,
        status: activeLocked === true ? "processing" : "normal",
        focus: true,
      });
      tabId = snapshot?.activeTabId || null;
    }
    const receipt = Object.freeze({
      transactionId: active.transactionId,
      applicationId: applicationId ? String(applicationId) : null,
      projectId: projectId || null,
      documentId: documentId || null,
      epoch: Number(epoch) || 0,
      tabId,
      kind: String(active.intent.kind || "project"),
    });
    active.receipt = receipt;
    active.applicationAuthorityOpen = false;
    this.#session.applied(active.transactionId, receipt);
    active.resolveReceipt?.(receipt);
    return receipt;
  }

  onConfirmationPresented({ transactionId: receivedTransactionId, requestId }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")) return false;
    active.requestId = String(requestId || "");
    active.continuation = "confirmation";
    active.externalAuto = false;
    this.#session.transition(active.transactionId, "awaiting-user");
    return true;
  }

  onPreparedOpenStarted({ transactionId: receivedTransactionId, requestId }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")) return false;
    active.requestId = String(requestId || "");
    active.preparedOpen = true;
    active.continuation = null;
    active.externalAuto = false;
    this.#session.transition(active.transactionId, "opening");
    return true;
  }

  onPreparedOpenSettled({ transactionId: receivedTransactionId, requestId, outcome }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")
      || active.requestId !== String(requestId || "") || !active.preparedOpen
      || active.intent.kind !== "external") return false;
    // OS delivery is asynchronous. Its receipt must not release admission while
    // this same Prepared Intent is still verifying Canvas, finalizing or ACKing.
    this.#complete(active, this.#finishConfirmation(active, outcome));
    return true;
  }

  onTerminalFailure({ transactionId: receivedTransactionId, reason }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")) return false;
    this.#complete(active, { outcome: rejected(
      "WORKBENCH_NAVIGATION_EXTERNAL_FAILED",
      String(reason || "外部 HTML 没有完成打开。"),
    ) });
    return true;
  }

  async prepareClose({ deadlineAt }) {
    const active = this.#active;
    if (!active) return true;
    if (this.#session.snapshot.phase === "awaiting-user") {
      this.#rollbackAndRelease(active, null);
      return true;
    }
    return this.waitForIdle({ deadlineAt });
  }

  waitForIdle({ deadlineAt }) {
    if (!this.#active) return Promise.resolve(true);
    const remaining = Math.max(0, Number(deadlineAt) - Number(this.#clock.now()));
    if (remaining <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = { timer: null, unsubscribe: () => {}, resolve: null };
      const settle = (value) => {
        if (!this.#idleWaiters.delete(waiter)) return;
        if (waiter.timer !== null) this.#clearTimer(waiter.timer);
        waiter.unsubscribe();
        resolve(value);
      };
      waiter.resolve = settle;
      const unsubscribe = this.#session.subscribe((snapshot) => {
        if (snapshot.phase !== "idle") return;
        settle(true);
      });
      waiter.unsubscribe = unsubscribe;
      waiter.timer = this.#setTimer(() => settle(false), remaining);
      this.#idleWaiters.add(waiter);
    });
  }

  waitForTerminal(transactionId) {
    const id = String(transactionId || "");
    if (!id) return Promise.resolve(null);
    if (this.#terminalReceipts.has(id)) {
      return Promise.resolve(this.#terminalReceipts.get(id));
    }
    if (this.#active?.transactionId === id) return this.#active.terminalPromise;
    return Promise.resolve(null);
  }

  dispose() {
    this.#disposed = true;
    this.#closeFreeze = null;
    if (this.#active) this.#rollbackAndRelease(this.#active, {
      code: "WORKBENCH_NAVIGATION_DISPOSED",
      reason: "导航已停止。",
    });
    for (const waiter of [...this.#idleWaiters]) waiter.resolve(false);
    this.#session.dispose();
  }

  async #openProject(active, input) {
    this.#session.transition(active.transactionId, "preparing");
    this.#session.transition(active.transactionId, "opening");
    const outcome = await this.#projectWorkflow.openProject({
      ...input,
      transactionId: active.transactionId,
    });
    if (active.preparedOpen) return this.#finishConfirmation(active, outcome);
    if (outcome?.status !== "succeeded") {
      return this.#finishOpened(active, outcome, { deadlineMs: 15_000 });
    }
    if (outcome.value?.awaitingConfirmation) {
      const confirmation = this.#projectWorkflow.getSnapshot().openConfirmation;
      active.requestId = String(confirmation?.requestId || "");
      active.continuation = "confirmation";
      this.#session.transition(active.transactionId, "awaiting-user");
      return { suspended: true, outcome };
    }
    if (!outcome.value?.opened) return { outcome };
    return this.#finishOpened(active, outcome, { deadlineMs: 15_000 });
  }

  async #activateTab(active, tabId, {
    deadlineMs = 15_000,
    force = false,
    skipPrepare = false,
    skipCapture = false,
    switchPrepared = false,
    currentOverride = null,
  } = {}) {
    const target = this.#tabs.resolveTab(tabId);
    if (!target) return { outcome: rejected("WORKBENCH_TAB_NOT_FOUND", "这个标签页已经关闭。") };
    if (target.tabId === this.#tabs.snapshot.activeTabId && !force) {
      return { outcome: succeeded({ unchanged: true }) };
    }
    const current = currentOverride
      || this.#tabs.resolveTab(this.#tabs.snapshot.activeTabId);
    this.#surfaceCache?.touch(target.tabId);
    active.expectedTabId = target.tabId;
    this.#tabs.beginSwitch(target.tabId, { force });
    this.#session.transition(active.transactionId, "preparing");
    if (target.kind === "start" || target.kind === "settings") {
      // Start -> Start changes presentation focus only. The retained document
      // controller was already fenced and unmounted by the first Start
      // activation, so a second drain would incorrectly let a transient React
      // view transition reject a valid queued new-tab command.
      const prepared = skipPrepare || current?.kind === "start" || current?.kind === "settings"
        ? succeeded()
        : await this.#projectWorkflow.prepareSwitch();
      if (prepared?.status !== "succeeded") {
        return { outcome: rejected(
          prepared?.code || "WORKBENCH_TAB_SWITCH_BLOCKED",
          String(prepared?.reason || "当前 HTML 尚未安全收口。"),
        ) };
      }
      if (!skipCapture && current?.kind === "document") this.#captureCurrentSurface(current);
      const committed = target.kind === "start"
        ? this.#tabs.commitStart(target.tabId)
        : this.#tabs.commitSettings(target.tabId);
      if (!committed) return { outcome: rejected(
        "WORKBENCH_TAB_COMMIT_REJECTED",
        "标签页状态已变化，没有离开当前 HTML。",
      ) };
      const receipt = Object.freeze({
        transactionId: active.transactionId,
        applicationId: null,
        projectId: null,
        documentId: null,
        epoch: Number(this.#controller.getSnapshot()?.projectSession?.epoch) || 0,
        tabId: target.tabId,
        kind: target.kind,
      });
      this.#session.transition(active.transactionId, "canvas-verified", { receipt });
      return { outcome: succeeded({ tabId: target.tabId }), receipt };
    }
    if (target.kind === "project-rules") {
      const prepared = skipPrepare || current?.kind === "start" || current?.kind === "settings"
        ? succeeded()
        : await this.#projectWorkflow.prepareSwitch();
      if (prepared?.status !== "succeeded") {
        return { outcome: rejected(
          prepared?.code || "PROJECT_RULES_SWITCH_BLOCKED",
          String(prepared?.reason || "当前页面尚未安全收口。"),
        ) };
      }
      if (!skipCapture && current?.kind === "document") this.#captureCurrentSurface(current);
      const project = this.#controller.getSnapshot()?.projectSession;
      const context = project && project.projectId && project.documentId && project.sourcePath
        ? {
          epoch: Number(project.epoch) || 0,
          projectId: String(project.projectId),
          documentId: String(project.documentId),
          sourcePath: String(project.sourcePath),
        }
        : null;
      if (!context) {
        return { outcome: rejected(
          "PROJECT_RULES_CONTEXT_REQUIRED",
          "当前项目尚未完成初始化，暂时不能打开长期规则。",
        ) };
      }
      const opened = await this.#controller.openProjectRules({ context });
      if (opened?.status !== "succeeded") {
        return { outcome: rejected(
          opened?.code || "PROJECT_RULES_READ_FAILED",
          String(opened?.reason || "项目规则暂时无法读取。"),
        ) };
      }
      const committed = this.#tabs.commitProjectRules(target.tabId);
      if (!committed) return { outcome: rejected(
        "WORKBENCH_TAB_COMMIT_REJECTED",
        "标签页状态已变化，没有打开长期规则。",
      ) };
      const receipt = Object.freeze({
        transactionId: active.transactionId,
        applicationId: null,
        projectId: context.projectId,
        documentId: context.documentId,
        epoch: context.epoch,
        tabId: target.tabId,
        kind: "project-rules",
      });
      this.#session.transition(active.transactionId, "canvas-verified", { receipt });
      return { outcome: succeeded({ tabId: target.tabId }), receipt };
    }
    if (!skipCapture && current?.kind === "document") this.#captureCurrentSurface(current);
    if (
      (current?.kind === "settings" || current?.kind === "project-rules")
      && this.#tabs.snapshot.runtimeOwnerTabId === target.tabId
    ) {
      const currentProject = this.#controller.getSnapshot()?.projectSession;
      if (
        currentProject?.projectId === target.projectId
        && currentProject.documentId === target.documentId
      ) {
        const committed = this.#tabs.commitDocument({
          tabId: target.tabId,
          projectId: target.projectId,
          documentId: target.documentId,
          title: target.title,
        });
        if (!committed) return { outcome: rejected(
          "WORKBENCH_TAB_COMMIT_REJECTED",
          "标签页状态已变化，没有离开当前页面。",
        ) };
        const receipt = Object.freeze({
          transactionId: active.transactionId,
          applicationId: null,
          projectId: target.projectId,
          documentId: target.documentId,
          epoch: Number(currentProject.epoch) || 0,
          tabId: target.tabId,
          kind: "document",
        });
        this.#session.transition(active.transactionId, "canvas-verified", { receipt });
        return { outcome: succeeded({ tabId: target.tabId }), receipt };
      }
    }
    this.#session.transition(active.transactionId, "opening");
    const outcome = await this.#projectWorkflow.openProject({
      kind: "registered",
      projectId: target.projectId,
      transactionId: active.transactionId,
      switchPrepared,
    });
    return this.#finishOpened(active, outcome, { deadlineMs });
  }

  #captureCurrentSurface(tab) {
    const snapshot = this.#controller.getSnapshot();
    return this.#surfaceCache?.capture({
      tab,
      project: snapshot?.projectSession,
      document: snapshot?.document,
    }) || null;
  }

  async #confirm(active, input) {
    active.continuation = null;
    active.externalAuto = false;
    this.#session.transition(active.transactionId, "opening");
    const outcome = await this.#projectWorkflow.confirmExternalOpen({
      ...input,
      transactionId: active.transactionId,
    });
    return this.#finishConfirmation(active, outcome);
  }

  #finishConfirmation(active, outcome) {
    if (outcome?.status !== "succeeded") {
      if (active.receipt && this.#controllerMatchesPrior(active.priorController)) {
        this.#tabs.restoreAuthority(active.priorTabs);
        active.receipt = null;
      }
      return {
        outcome: active.receipt
          ? rejected(
            outcome?.code || "WORKBENCH_NAVIGATION_COMMITTED_ERROR",
            outcome?.reason || "HTML 已切换，但最终收口失败。",
            { committed: true, tabId: active.receipt.tabId },
          )
          : outcome,
        receipt: active.receipt,
      };
    }
    if (!active.receipt) {
      // Retrying an acknowledged commit only releases the external mailbox;
      // it does not apply the project a second time or produce a new receipt.
      if (
        outcome.value?.acknowledged === true
        || outcome.value?.alreadyApplied === true
      ) return { outcome };
      return { outcome: rejected(
        "WORKBENCH_NAVIGATION_RECEIPT_MISSING",
        "HTML 打开成功，但缺少应用回执。",
      ) };
    }
    this.#session.transition(active.transactionId, "display-ready", { receipt: active.receipt });
    void this.#monitorSettlement(active.receipt, 15_000);
    return { outcome, receipt: active.receipt };
  }

  async #finishOpened(active, outcome, { deadlineMs }) {
    if (outcome?.status !== "succeeded") {
      const project = this.#projectWorkflow.getSnapshot();
      if (
        project?.open?.phase === "deferred"
        || project?.projectApplication?.status === "deferred"
      ) {
        active.continuation = "deferred-project";
        void this.#finishDeferredWhenApplied(active, deadlineMs);
        return { suspended: true, outcome };
      }
      return { outcome };
    }
    if (outcome.value?.opened === false) return { outcome };
    const expectedApplicationId = outcome.value?.applicationId || null;
    const receipt = await this.#waitForReceipt(active, deadlineMs, expectedApplicationId);
    if (!receipt) {
      return { outcome: rejected(
        "WORKBENCH_NAVIGATION_APPLY_TIMEOUT",
        "HTML 已接收打开请求，但应用回执未在时限内到达。",
      ) };
    }
    // The correlated application receipt means the exact HTML bytes are now
    // published. Release the user-facing admission here; hydration and Canvas
    // verification continue as independently fenced readiness work.
    this.#session.transition(active.transactionId, "display-ready", { receipt });
    void this.#monitorSettlement(receipt, deadlineMs);
    return { outcome: succeeded({ ...outcome.value, receipt }), receipt };
  }

  async #monitorSettlement(receipt, deadlineMs) {
    const settled = await this.#waitForSettlement(null, receipt, deadlineMs);
    if (settled.stale) return;
    if (!settled.ok && receipt.projectId && receipt.documentId) {
      this.#tabs.updateStatus(receipt.projectId, receipt.documentId, "error");
    }
  }

  async #finishExternalWhenApplied(active) {
    const receipt = await this.#waitForReceipt(active, 15_000, null);
    if (this.#active !== active || active.externalAuto !== true) return;
    if (!receipt) {
      this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_APPLY_TIMEOUT",
        "外部 HTML 已接收，但应用回执未在时限内到达。",
      ) });
      return;
    }
    const result = await this.#finishOpened(active, succeeded({
      opened: true,
      applicationId: receipt.applicationId,
    }), { deadlineMs: 15_000 });
    this.#complete(active, result);
  }

  async #finishDeferredWhenApplied(active, deadlineMs) {
    const receipt = await this.#waitForReceipt(active, deadlineMs, null);
    if (!receipt || this.#active !== active) {
      if (this.#active === active) this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_DEFERRED_TIMEOUT",
        "已保留导航请求，但未在时限内获得应用回执。",
      ) });
      return;
    }
    active.continuation = null;
    const result = await this.#finishOpened(active, succeeded({
      opened: true,
      applicationId: receipt.applicationId,
    }), { deadlineMs });
    this.#complete(active, result);
  }

  #waitForReceipt(active, deadlineMs, expectedApplicationId) {
    if (
      active.receipt
      && (!expectedApplicationId || active.receipt.applicationId === expectedApplicationId)
    ) return Promise.resolve(active.receipt);
    return new Promise((resolve) => {
      let timer = null;
      let settled = false;
      const settle = (receipt) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        active.resolveReceipt = null;
        active.cancelReceiptWait = null;
        resolve(receipt);
      };
      active.resolveReceipt = (receipt) => {
        if (expectedApplicationId && receipt.applicationId !== expectedApplicationId) return;
        settle(receipt);
      };
      active.cancelReceiptWait = () => settle(null);
      timer = this.#setTimer(() => {
        this.#expireApplicationAuthority(active);
        if (expectedApplicationId) {
          this.#projectWorkflow.cancelProjectApplication?.(expectedApplicationId);
        }
        settle(null);
      }, deadlineMs);
    });
  }

  #waitForSettlement(active, receipt, deadlineMs) {
    let timer = null;
    let unsubscribe = () => {};
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        unsubscribe();
        if (active) active.cancelSettlementWait = null;
        resolve(value);
      };
      const inspect = (snapshot) => {
        const project = snapshot?.projectSession;
        const sessionAligned = Boolean(
          project?.projectId
          && project.projectId === receipt.projectId
          && project.documentId === receipt.documentId
          && Number(project.epoch) === receipt.epoch,
        );
        if (!sessionAligned) {
          if (Number(project?.epoch) > receipt.epoch) settle({ ok: false, stale: true });
          return;
        }
        const hydration = snapshot?.project?.hydration;
        if (hydration?.phase === "failed" && Number(hydration.epoch) === receipt.epoch) {
          settle({
            ok: false,
            code: "WORKBENCH_NAVIGATION_HYDRATION_FAILED",
            reason: hydration.error || "HTML 权威读取失败。",
          });
          return;
        }
        if (hydration?.phase !== "idle") return;
        const application = snapshot?.project?.projectApplication;
        if (
          receipt.applicationId
          && [application?.activeApplicationId, application?.queuedApplicationId]
            .includes(receipt.applicationId)
        ) return;
        settle({ ok: true });
      };
      unsubscribe = this.#controller.subscribe(inspect);
      if (active) {
        active.cancelSettlementWait = () => settle({
          ok: false,
          code: "WORKBENCH_NAVIGATION_DISPOSED",
          reason: "导航已停止。",
        });
      }
      inspect(this.#controller.getSnapshot());
      if (!settled) timer = this.#setTimer(() => {
        settle({
          ok: false,
          code: "WORKBENCH_NAVIGATION_SETTLE_TIMEOUT",
          reason: "HTML 已进入当前标签，但权威读取未在时限内完成。",
        });
      }, deadlineMs);
    });
  }

  #admit(intent, execute) {
    const predecessor = this.#admissionTail.catch(() => {});
    let release;
    const completion = new Promise((resolve) => { release = resolve; });
    this.#admissionTail = predecessor.then(() => completion);
    if (!this.#busy) {
      return this.#beginAdmission(intent, execute, release);
    }
    return predecessor.then(() => this.#beginAdmission(intent, execute, release));
  }

  #beginAdmission(intent, execute, release) {
    if (this.#disposed) {
      release();
      return rejected("WORKBENCH_NAVIGATION_DISPOSED", "导航已停止。");
    }
    if (this.#closeFreeze) {
      release();
      return rejected(
        "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
        "窗口正在完成关闭核对，暂不接收新的 HTML 导航。",
      );
    }
    this.#busy = true;
    this.#ordinal += 1;
    const id = transactionId(this.#ordinal, this.#clock.now());
    const active = {
      transactionId: id,
      intent: Object.freeze({ ...intent }),
      priorTabs: this.#tabs.captureAuthority(),
      priorController: this.#controller.getSnapshot()?.projectSession || null,
      receipt: null,
      expectedTabId: null,
      requestId: null,
      continuation: null,
      applicationId: null,
      applicationAuthorityOpen: true,
      cancelReceiptWait: null,
      cancelSettlementWait: null,
      release: () => {
        this.#busy = false;
        release();
      },
    };
    active.terminalPromise = new Promise((resolve) => {
      active.resolveTerminal = resolve;
    });
    this.#active = active;
    this.#session.admit({
      transactionId: id,
      intent: active.intent,
      admissionOrdinal: this.#ordinal,
    });
    try {
      return Promise.resolve(execute(active)).then(
        (result) => (result?.suspended ? result.outcome : this.#complete(active, result)),
        (cause) => this.#complete(active, {
          outcome: rejected(
            "WORKBENCH_NAVIGATION_REJECTED",
            String(cause?.message || cause || "导航失败。"),
          ),
        }),
      );
    } catch (cause) {
      return this.#complete(active, {
        outcome: rejected(
          "WORKBENCH_NAVIGATION_REJECTED",
          String(cause?.message || cause || "导航失败。"),
        ),
      });
    }
  }

  #continue(active, execute) {
    if (this.#active !== active) {
      return Promise.resolve(rejected("WORKBENCH_NAVIGATION_STALE", "这次导航已经结束。"));
    }
    if (this.#closeFreeze) {
      return Promise.resolve(rejected(
        "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
        "窗口正在完成关闭核对，暂不继续这次 HTML 导航。",
      ));
    }
    return Promise.resolve().then(execute).then(
      (result) => result?.suspended ? result.outcome : this.#complete(active, result),
      (cause) => this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_REJECTED",
        String(cause?.message || cause || "导航失败。"),
      ) }),
    );
  }

  #complete(active, result = {}) {
    if (this.#active !== active) return result.outcome || rejected(
      "WORKBENCH_NAVIGATION_STALE",
      "这次导航已经结束。",
    );
    const outcome = result.outcome || succeeded();
    this.#expireApplicationAuthority(active);
    const error = outcome.status === "succeeded"
      ? null
      : outcomeError(outcome, "WORKBENCH_NAVIGATION_REJECTED", "导航失败。");
    if (outcome.status !== "succeeded" && !result.receipt) {
      this.#tabs.restoreAuthority(active.priorTabs);
    }
    this.#session.finish(active.transactionId, {
      receipt: result.receipt || null,
      error,
    });
    const terminal = Object.freeze({
      transactionId: active.transactionId,
      outcome,
      receipt: result.receipt || null,
    });
    this.#terminalReceipts.set(active.transactionId, terminal);
    if (this.#terminalReceipts.size > 256) {
      this.#terminalReceipts.delete(this.#terminalReceipts.keys().next().value);
    }
    this.#tabsPersistence?.commit(this.#tabs.serialize());
    this.#cancelActiveWaits(active);
    active.resolveTerminal?.(terminal);
    this.#active = null;
    active.release?.();
    return outcome;
  }

  #rollbackAndRelease(active, error) {
    if (this.#active !== active) return;
    this.#expireApplicationAuthority(active);
    this.#tabs.restoreAuthority(active.priorTabs);
    this.#session.finish(active.transactionId, { error });
    const terminal = Object.freeze({
      transactionId: active.transactionId,
      outcome: error ? rejected(error.code, error.reason) : succeeded({ canceled: true }),
      receipt: null,
    });
    this.#terminalReceipts.set(active.transactionId, terminal);
    if (this.#terminalReceipts.size > 256) {
      this.#terminalReceipts.delete(this.#terminalReceipts.keys().next().value);
    }
    this.#tabsPersistence?.commit(this.#tabs.serialize());
    this.#cancelActiveWaits(active);
    active.resolveTerminal?.(terminal);
    this.#active = null;
    active.release?.();
  }

  #cancelActiveWaits(active) {
    active.cancelReceiptWait?.();
    active.cancelSettlementWait?.();
    active.cancelReceiptWait = null;
    active.cancelSettlementWait = null;
    active.resolveReceipt = null;
  }

  #expireApplicationAuthority(active) {
    if (!active) return;
    active.applicationAuthorityOpen = false;
  }

  #controllerMatchesPrior(prior) {
    const current = this.#controller.getSnapshot()?.projectSession;
    return Boolean(
      prior
      && current
      && prior.projectId === current.projectId
      && prior.documentId === current.documentId
      && Number(prior.epoch) <= Number(current.epoch),
    );
  }
}
