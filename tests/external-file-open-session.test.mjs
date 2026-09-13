import assert from "node:assert/strict";
import test from "node:test";

import { ExternalFileOpenSession } from "../app/application/external-file-open-session.js";

function request(id) {
  return {
    requestId: `external_${id}`,
    sourcePath: `/Users/demo/${id}.html`,
  };
}

function snapshot(overrides = {}) {
  return {
    status: "idle",
    activeRequestId: null,
    queuedRequestId: null,
    queuedRequestIds: [],
    deferredRequestId: null,
    deferredSequence: 0,
    confirmation: null,
    attention: null,
    ...overrides,
  };
}

for (const finish of ["cancelConfirmation", "completeConfirmation"]) {
  test(`late awaiting result cannot resurrect a head after ${finish}`, async () => {
    const session = new ExternalFileOpenSession();
    const order = [];
    let release;
    const execute = async (value) => {
      order.push(value.requestId);
      session.presentConfirmation(value.requestId, { requestId: value.requestId, classification: "new-external" });
      if (value.requestId === "external_first") {
        await new Promise((resolve) => { release = resolve; });
      }
      return "awaiting-confirmation";
    };
    session.enqueue(request("first"), execute);
    session.enqueue(request("second"), execute);
    assert.equal(session[finish]("external_first"), true);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["external_first", "external_second"]);
    assert.equal(session.snapshot.activeRequestId, "external_second");
    assert.equal(session.snapshot.status, "awaiting-confirmation");
    assert.equal(session[finish]("external_second"), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.snapshot.status, "idle");
    session.dispose();
  });
}

test("external file session preserves every queued request in FIFO order", async () => {
  const session = new ExternalFileOpenSession();
  let releaseFirst;
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  let markLatestFinished;
  const latestFinished = new Promise((resolve) => {
    markLatestFinished = resolve;
  });
  const order = [];
  const execute = async (value, { isSuperseded }) => {
    order.push(`start:${value.requestId}`);
    if (value.requestId === "external_first") {
      markFirstStarted();
      await firstReleased;
      assert.equal(isSuperseded(), false);
    }
    order.push(`finish:${value.requestId}`);
    if (value.requestId === "external_latest") markLatestFinished();
    return "complete";
  };

  assert.equal(session.enqueue(request("first"), execute), true);
  await firstStarted;
  assert.equal(session.enqueue(request("second"), execute), true);
  assert.equal(session.enqueue(request("latest"), execute), true);
  assert.deepEqual(session.snapshot, snapshot({
    status: "opening",
    activeRequestId: "external_first",
    queuedRequestId: "external_second",
    queuedRequestIds: ["external_second", "external_latest"],
  }));

  releaseFirst();
  await latestFinished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, [
    "start:external_first",
    "finish:external_first",
    "start:external_second",
    "finish:external_second",
    "start:external_latest",
    "finish:external_latest",
  ]);
  assert.deepEqual(session.snapshot, snapshot());
});

test("external file session deduplicates opaque deliveries and retains one deferred request", async () => {
  const session = new ExternalFileOpenSession();
  const calls = [];
  let completeRetry;
  const retryFinished = new Promise((resolve) => {
    completeRetry = resolve;
  });
  const execute = async (value) => {
    calls.push(value.requestId);
    if (calls.length === 1) return "deferred";
    completeRetry();
    return "complete";
  };

  assert.equal(session.enqueue(request("deferred"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(session.snapshot, snapshot({
    status: "deferred",
    deferredRequestId: "external_deferred",
    deferredSequence: 1,
  }));
  assert.equal(session.enqueue(request("deferred"), execute), false);
  assert.equal(session.resume(execute), true);
  await retryFinished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["external_deferred", "external_deferred"]);
  assert.equal(session.snapshot.status, "idle");
});

test("external file session notifies the renderer when a request becomes deferred", async () => {
  const session = new ExternalFileOpenSession();
  const snapshots = [];
  session.setObserver((snapshot) => snapshots.push(snapshot));

  assert.equal(session.enqueue(request("retry"), async () => "deferred"), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(snapshots.at(-1), snapshot({
    status: "deferred",
    deferredRequestId: "external_retry",
    deferredSequence: 1,
  }));
});

test("external file session gives every deferred transition a new sequence", async () => {
  const session = new ExternalFileOpenSession();
  const calls = [];
  const execute = async (value) => {
    calls.push(value.requestId);
    return "deferred";
  };

  assert.equal(session.enqueue(request("retry-sequence"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.deferredSequence, 1);

  assert.equal(session.resume(execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.deferredSequence, 2);
  assert.deepEqual(calls, ["external_retry-sequence", "external_retry-sequence"]);
});

test("external file session resumes immediately when the switch drain is already clear", async () => {
  const session = new ExternalFileOpenSession();
  const calls = [];
  const execute = async (value) => {
    calls.push(value.requestId);
    return calls.length === 1 ? "deferred" : "complete";
  };

  assert.equal(session.enqueue(request("clear"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["external_clear", "external_clear"]);
  assert.equal(session.snapshot.status, "idle");
});

test("external file session resumes only after an observed switch blocker clears", async () => {
  const session = new ExternalFileOpenSession();
  const calls = [];
  const execute = async (value) => {
    calls.push(value.requestId);
    return calls.length === 1 ? "deferred" : "complete";
  };

  assert.equal(session.enqueue(request("blocker"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.deepEqual(calls, ["external_blocker"]);

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["external_blocker", "external_blocker"]);
  assert.equal(session.snapshot.status, "idle");
});

test("external file session does not loop a second unblocked defer of the same request", async () => {
  const session = new ExternalFileOpenSession();
  const execute = async () => "deferred";

  assert.equal(session.enqueue(request("loop"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "deferred");
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "idle",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
});

test("a newer external request waits behind a deferred request", async () => {
  const session = new ExternalFileOpenSession();
  const calls = [];
  let finishSecond;
  const secondFinished = new Promise((resolve) => {
    finishSecond = resolve;
  });
  let firstAttempts = 0;
  const execute = async (value) => {
    calls.push(value.requestId);
    if (value.requestId === "external_first") {
      firstAttempts += 1;
      return firstAttempts === 1 ? "deferred" : "complete";
    }
    finishSecond();
    return "complete";
  };

  assert.equal(session.enqueue(request("first"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "deferred");
  assert.equal(session.enqueue(request("second"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["external_first"]);
  assert.equal(session.snapshot.deferredRequestId, "external_first");
  assert.equal(session.snapshot.queuedRequestId, "external_second");
  assert.equal(session.resume(execute), true);
  await secondFinished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["external_first", "external_first", "external_second"]);
  assert.equal(session.snapshot.status, "idle");
});

test("a successful active request remains publishable when its queued successor fails", async () => {
  const session = new ExternalFileOpenSession();
  const visibleProjects = [];
  let releaseFirst;
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const execute = async (value, { isSuperseded }) => {
    if (value.requestId === "external_first") {
      markFirstStarted();
      await firstReleased;
      assert.equal(isSuperseded(), false);
      // The Workbench may publish this already-accepted project even though a
      // newer request is queued. That successor can fail without making the
      // renderer diverge from the main-process active/recent source.
      visibleProjects.push(value.sourcePath);
      return "complete";
    }
    throw new Error("second source is unreadable");
  };

  assert.equal(session.enqueue(request("first"), execute), true);
  await firstStarted;
  assert.equal(session.enqueue(request("second"), execute), true);
  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(visibleProjects, ["/Users/demo/first.html"]);
  assert.equal(session.snapshot.status, "idle");
});

test("a newer OS request waits behind an unanswered confirmation", async () => {
  const session = new ExternalFileOpenSession();
  const first = {
    requestId: "external_first",
    classification: "new-external",
    sourceFileName: "first.html",
    visibleV1FileName: "first-V1.html",
    projectsRootLabel: "文稿 › PageRoot › 项目",
  };
  const second = {
    requestId: "external_second",
    classification: "known-external",
    sourceFileName: "second.html",
    projectName: "second",
    currentBasedOnOrdinal: 2,
    latestOfficialOrdinal: 6,
    currentDiffersFromBase: true,
    sourceRelation: "changed",
  };
  const execute = async (value) => {
    session.presentConfirmation(value.requestId, value.confirmation);
    return "awaiting-confirmation";
  };

  assert.equal(session.enqueue(first, execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "awaiting-confirmation");
  assert.equal(session.snapshot.confirmation.sourceFileName, "first.html");

  assert.equal(session.enqueue(second, execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "awaiting-confirmation");
  assert.equal(session.snapshot.activeRequestId, "external_first");
  assert.equal(session.snapshot.queuedRequestId, "external_second");
  assert.equal(session.snapshot.confirmation.sourceFileName, "first.html");
  assert.equal(session.cancelConfirmation("external_first"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.activeRequestId, "external_second");
  assert.equal(session.snapshot.confirmation.classification, "known-external");
  assert.equal(session.snapshot.confirmation.sourceFileName, "second.html");
  assert.equal(session.cancelConfirmation("external_second"), true);
});
