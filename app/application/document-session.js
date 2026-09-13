const PERSIST_STATES = new Set([
  "idle",
  "preview-dirty",
  "queued",
  "writing",
  "failed",
  "conflict",
]);

function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

function persistState(value) {
  return PERSIST_STATES.has(value) ? value : "idle";
}

const CANVAS_AUTHORITY_STATES = new Set([
  "idle",
  "pending",
  "verified",
  "failed",
]);

const SOURCE_RECEIPT_ORIGINS = new Set([
  "local-edit",
  "history",
  "authority",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

// A sequence is scoped to one DocumentSession.  Keep the session incarnation
// in a module-wide monotonic domain so a rebuilt controller cannot accidentally
// reuse a lower sequence in the same renderer process.
let sourceSessionIncarnationSequence = 0;

function nextSourceSessionIncarnation() {
  sourceSessionIncarnationSequence += 1;
  if (!Number.isSafeInteger(sourceSessionIncarnationSequence)) {
    sourceSessionIncarnationSequence = 1;
  }
  return sourceSessionIncarnationSequence;
}

function sourceReceiptContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const epoch = Number(context.epoch);
  const projectId = String(context.projectId || "");
  const documentId = String(context.documentId || "");
  const sourcePath = String(context.sourcePath || "");
  if (!Number.isSafeInteger(epoch) || !projectId || !documentId || !sourcePath) return null;
  const hasTarget = [
    "projectRootPath",
    "targetKind",
    "workingCopyId",
    "versionId",
    "exactSourcePath",
    "sourceSha256",
    "sessionEpoch",
  ].some((key) => Object.hasOwn(context, key));
  if (!hasTarget) {
    return Object.freeze({
      epoch,
      projectId,
      documentId,
      sourcePath,
    });
  }
  const requiredTargetFields = [
    "projectRootPath",
    "targetKind",
    "workingCopyId",
    "versionId",
    "exactSourcePath",
    "sourceSha256",
    "sessionEpoch",
  ];
  if (!requiredTargetFields.every((key) => Object.hasOwn(context, key))) return null;
  const targetKind = String(context.targetKind || "");
  if (targetKind !== "working-copy" && targetKind !== "version") return null;
  const projectRootPath = String(context.projectRootPath || "");
  const exactSourcePath = String(context.exactSourcePath || "");
  const sourceSha256 = String(context.sourceSha256 || "");
  const sessionEpoch = Number(context.sessionEpoch);
  if (
    !projectRootPath
    || !exactSourcePath
    || !/^sha256:[a-f0-9]{64}$/u.test(sourceSha256)
    || !Number.isSafeInteger(sessionEpoch)
    || (targetKind === "working-copy" && !String(context.workingCopyId || ""))
    || (targetKind === "version" && !String(context.versionId || ""))
  ) return null;
  return Object.freeze({
    epoch,
    projectId,
    documentId,
    sourcePath,
    projectRootPath,
    targetKind,
    workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
    versionId: context.versionId ? String(context.versionId) : null,
    exactSourcePath,
    sourceSha256,
    sessionEpoch,
  });
}

function sourceReceipt({
  sessionIncarnation,
  sequence,
  origin,
  operationId,
  editRevision,
  canvasGeneration,
  sourceSha256,
  context,
} = {}) {
  const normalizedSequence = revision(sequence);
  const normalizedOrigin = SOURCE_RECEIPT_ORIGINS.has(origin) ? origin : "authority";
  const normalizedContext = sourceReceiptContext(context);
  return Object.freeze({
    sessionIncarnation: revision(sessionIncarnation),
    sequence: normalizedSequence,
    origin: normalizedOrigin,
    operationId: String(operationId || `${normalizedOrigin}-${normalizedSequence}`),
    editRevision: revision(editRevision),
    canvasGeneration: revision(canvasGeneration),
    sourceSha256: String(sourceSha256 || ""),
    context: normalizedContext,
    epoch: normalizedContext?.epoch ?? null,
    projectId: normalizedContext?.projectId || null,
    documentId: normalizedContext?.documentId || null,
    sourcePath: normalizedContext?.sourcePath || null,
    sessionEpoch: normalizedContext?.sessionEpoch ?? null,
  });
}

export function isSourceReceipt(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isSafeInteger(Number(value.sessionIncarnation))
    && Number(value.sessionIncarnation) > 0
    && Number.isSafeInteger(Number(value.sequence))
    && Number(value.sequence) > 0
    && SOURCE_RECEIPT_ORIGINS.has(value.origin)
    && String(value.operationId || "")
    && Number.isSafeInteger(Number(value.editRevision))
    && Number.isSafeInteger(Number(value.canvasGeneration))
    && (value.context == null || sourceReceiptContext(value.context))
    && (value.sourceSha256 === "" || /^sha256:[a-f0-9]{64}$/u.test(String(value.sourceSha256)))
  );
}

export function sameSourceReceiptContext(left, right) {
  if (left?.context == null && right?.context == null) return true;
  const a = sourceReceiptContext(left?.context || left);
  const b = sourceReceiptContext(right?.context || right);
  if (!a || !b) return false;
  return (
    a.epoch === b.epoch
    && a.projectId === b.projectId
    && a.documentId === b.documentId
    && a.sourcePath === b.sourcePath
    && String(a.projectRootPath || "") === String(b.projectRootPath || "")
    && String(a.targetKind || "") === String(b.targetKind || "")
    && String(a.workingCopyId || "") === String(b.workingCopyId || "")
    && String(a.versionId || "") === String(b.versionId || "")
    && a.exactSourcePath === b.exactSourcePath
    && a.sessionEpoch === b.sessionEpoch
    && String(a.sourceSha256 || "") === String(b.sourceSha256 || "")
  );
}

export function sameSourceReceipt(left, right) {
  return Boolean(
    isSourceReceipt(left)
    && isSourceReceipt(right)
    && left.sessionIncarnation === right.sessionIncarnation
    && left.sequence === right.sequence
    && left.origin === right.origin
    && left.operationId === right.operationId
    && left.editRevision === right.editRevision
    && left.canvasGeneration === right.canvasGeneration
    && left.sourceSha256 === right.sourceSha256
    && sameSourceReceiptContext(left, right)
  );
}

function canvasAuthority({
  status = "idle",
  generation = 0,
  renderedSha256 = null,
  error = null,
} = {}) {
  return Object.freeze({
    status: CANVAS_AUTHORITY_STATES.has(status) ? status : "idle",
    generation: revision(generation),
    renderedSha256: renderedSha256 ? String(renderedSha256) : null,
    error: error ? String(error) : null,
  });
}

function pendingCanvasAuthority(generation) {
  return canvasAuthority({
    status: "pending",
    generation,
  });
}

function boundaryBlock(code, reason, confirmed = false) {
  return Object.freeze({
    ready: false,
    code,
    reason,
    confirmed,
  });
}

function initialSnapshot({
  html = "",
  persistedSourceSha256 = null,
  workingHtmlSha256 = persistedSourceSha256,
} = {}) {
  const persistedHash = persistedSourceSha256 ? String(persistedSourceSha256) : null;
  return Object.freeze({
    html: String(html),
    persistedSourceSha256: persistedHash,
    workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
    canvasGeneration: 0,
    sourceReceipt: null,
    editRevision: 0,
    lastPersistedRevision: 0,
    persistState: "idle",
    persistError: "",
    hasPendingWrite: false,
    isFlushing: false,
    canvasAuthority: canvasAuthority({ generation: 0 }),
  });
}

export class DocumentSession {
  #observer = null;

  #snapshot;

  #pendingWrite = null;

  #flushPromise = null;

  #receiptSequence = 0;

  #confirmedReceiptSequence = null;

  #sessionIncarnation;

  constructor(options = {}) {
    this.#sessionIncarnation = nextSourceSessionIncarnation();
    this.#snapshot = initialSnapshot(options);
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      sourceReceipt: this.#nextReceipt({
        origin: "authority",
        operationId: options.operationId || "document-session-initial-authority",
        editRevision: this.#snapshot.editRevision,
        canvasGeneration: this.#snapshot.canvasGeneration,
        sourceSha256: this.#snapshot.workingHtmlSha256
          || this.#snapshot.persistedSourceSha256,
        context: options.context || null,
      }),
    });
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    const persistedSourceSha256 = next.persistedSourceSha256
      ? String(next.persistedSourceSha256)
      : null;
    this.#snapshot = Object.freeze({
      ...next,
      persistedSourceSha256,
      hasPendingWrite: Boolean(this.#pendingWrite),
      isFlushing: Boolean(this.#flushPromise),
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change source authority.
    }
  }

  update({
    html,
    persistedSourceSha256,
    workingHtmlSha256,
    editRevision,
    lastPersistedRevision,
    persistState: nextPersistState,
    persistError,
    pendingWrite,
  }) {
    const next = { ...this.#snapshot };
    if (html !== undefined) {
      const nextHtml = String(html);
      if (nextHtml !== next.html && workingHtmlSha256 === undefined) {
        next.workingHtmlSha256 = null;
      }
      next.html = nextHtml;
    }
    if (persistedSourceSha256 !== undefined) {
      next.persistedSourceSha256 = persistedSourceSha256
        ? String(persistedSourceSha256)
        : null;
    }
    if (workingHtmlSha256 !== undefined) {
      next.workingHtmlSha256 = workingHtmlSha256
        ? String(workingHtmlSha256)
        : null;
    }
    if (editRevision !== undefined) {
      next.editRevision = revision(editRevision);
    }
    if (lastPersistedRevision !== undefined) {
      next.lastPersistedRevision = revision(lastPersistedRevision);
    }
    if (nextPersistState !== undefined) {
      next.persistState = persistState(nextPersistState);
    }
    if (persistError !== undefined) {
      next.persistError = String(persistError || "");
    }
    if (pendingWrite !== undefined) {
      this.#pendingWrite = pendingWrite || null;
    }
    this.#emit(next);
    return this.#snapshot;
  }

  reset({
    html,
    persistedSourceSha256 = null,
    workingHtmlSha256 = persistedSourceSha256,
    editRevision = 0,
    lastPersistedRevision = 0,
    context = null,
    operationId = "",
  }) {
    this.#pendingWrite = null;
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision,
      canvasGeneration,
      sourceSha256: workingHtmlSha256 || persistedSourceSha256,
      context,
    });
    this.#emit({
      html: String(html || ""),
      persistedSourceSha256: persistedSourceSha256
        ? String(persistedSourceSha256)
        : null,
      workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
      canvasGeneration,
      sourceReceipt: receipt,
      editRevision: revision(editRevision),
      lastPersistedRevision: revision(lastPersistedRevision),
      persistState: "idle",
      persistError: "",
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  publishAuthority({
    html,
    persistedSourceSha256 = null,
    workingHtmlSha256 = persistedSourceSha256,
    sourceSha256,
    editRevision,
    lastPersistedRevision,
    persistState: nextPersistState,
    persistError,
    pendingWrite,
    context = null,
    operationId = "",
  }) {
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision: editRevision ?? this.#snapshot.editRevision,
      canvasGeneration,
      sourceSha256: sourceSha256 === undefined
        ? workingHtmlSha256 || persistedSourceSha256
        : sourceSha256,
      context,
    });
    const next = {
      ...this.#snapshot,
      html: String(html),
      persistedSourceSha256: persistedSourceSha256
        ? String(persistedSourceSha256)
        : null,
      workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
      canvasGeneration,
      sourceReceipt: receipt,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    };
    if (editRevision !== undefined) {
      next.editRevision = revision(editRevision);
    }
    if (lastPersistedRevision !== undefined) {
      next.lastPersistedRevision = revision(lastPersistedRevision);
    }
    if (nextPersistState !== undefined) {
      next.persistState = persistState(nextPersistState);
    }
    if (persistError !== undefined) {
      next.persistError = String(persistError || "");
    }
    if (pendingWrite !== undefined) {
      this.#pendingWrite = pendingWrite || null;
    }
    this.#emit(next);
    return this.#snapshot;
  }

  reloadCanvas({ context = null, operationId = "" } = {}) {
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision: this.#snapshot.editRevision,
      canvasGeneration,
      sourceSha256: this.#snapshot.workingHtmlSha256
        || this.#snapshot.persistedSourceSha256,
      context,
    });
    this.#emit({
      ...this.#snapshot,
      canvasGeneration,
      sourceReceipt: receipt,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  confirmWorkingHtml({ revision: expectedRevision, htmlSha256 } = {}) {
    const receivedRevision = revision(expectedRevision);
    const receivedHash = htmlSha256 ? String(htmlSha256) : "";
    if (
      receivedRevision !== this.#snapshot.editRevision
      || !/^sha256:[a-f0-9]{64}$/u.test(receivedHash)
    ) return false;
    this.#emit({
      ...this.#snapshot,
      workingHtmlSha256: receivedHash,
    });
    return true;
  }

  confirmCanvas({
    generation,
    renderedSha256,
    workingHtmlSha256,
    renderedHtml,
    receipt,
  } = {}) {
    const expectedGeneration = revision(generation);
    const renderedHash = renderedSha256 ? String(renderedSha256) : "";
    const workingHash = String(this.#snapshot.workingHtmlSha256 || "");
    const reportedWorkingHash = workingHtmlSha256
      ? String(workingHtmlSha256)
      : workingHash;
    const currentReceipt = this.#snapshot.sourceReceipt;
    const receivedReceipt = receipt && typeof receipt === "object"
      ? receipt
      : currentReceipt?.context == null
        ? currentReceipt
        : null;
    if (
      expectedGeneration !== this.#snapshot.canvasGeneration
      || !SHA256.test(renderedHash)
      || !SHA256.test(workingHash)
      || !isSourceReceipt(receivedReceipt)
      || !SHA256.test(String(receivedReceipt.sourceSha256 || ""))
      || receivedReceipt.sourceSha256 !== renderedHash
      || reportedWorkingHash !== workingHash
      || renderedHash !== workingHash
      || !isSourceReceipt(currentReceipt)
      || !sameSourceReceipt(receivedReceipt, currentReceipt)
      || receivedReceipt.canvasGeneration !== expectedGeneration
      || (currentReceipt.context != null && typeof renderedHtml !== "string")
      || (renderedHtml !== undefined && String(renderedHtml) !== this.#snapshot.html)
      || this.#snapshot.canvasAuthority.status === "failed"
      || this.#snapshot.canvasAuthority.status === "verified"
      || this.#confirmedReceiptSequence === receivedReceipt.sequence
    ) {
      return false;
    }
    this.#confirmedReceiptSequence = receivedReceipt.sequence;
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "verified",
        generation: expectedGeneration,
        renderedSha256: renderedHash,
      }),
    });
    return true;
  }

  failCanvas({ generation, error, receipt } = {}) {
    const expectedGeneration = revision(generation);
    const currentReceipt = this.#snapshot.sourceReceipt;
    const receivedReceipt = receipt && typeof receipt === "object"
      ? receipt
      : currentReceipt?.context == null
        ? currentReceipt
        : null;
    if (
      expectedGeneration !== this.#snapshot.canvasGeneration
      || !isSourceReceipt(receivedReceipt)
      || !isSourceReceipt(currentReceipt)
      || !sameSourceReceipt(receivedReceipt, currentReceipt)
      || receivedReceipt.canvasGeneration !== expectedGeneration
      || this.#snapshot.canvasAuthority.status === "failed"
      || this.#snapshot.canvasAuthority.status === "verified"
      || this.#confirmedReceiptSequence === receivedReceipt.sequence
    ) return false;
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "failed",
        generation: expectedGeneration,
        error: error || "画布没有在时限内确认载入目标 HTML。",
      }),
    });
    return true;
  }

  beginEdit(html, {
    origin = "local-edit",
    operationId = "",
    sourceSha256 = "",
    context = null,
  } = {}) {
    if (this.#snapshot.persistState === "conflict") {
      return this.#snapshot.editRevision;
    }
    this.#confirmedReceiptSequence = null;
    const nextRevision = this.#snapshot.editRevision + 1;
    const nextWorkingHash = SHA256.test(String(sourceSha256 || ""))
      ? String(sourceSha256)
      : null;
    const receipt = this.#nextReceipt({
      origin,
      operationId,
      editRevision: nextRevision,
      canvasGeneration: this.#snapshot.canvasGeneration,
      sourceSha256: nextWorkingHash || "",
      context,
    });
    this.#emit({
      ...this.#snapshot,
      html: String(html),
      editRevision: nextRevision,
      sourceReceipt: receipt,
      persistError: "",
      workingHtmlSha256: nextWorkingHash,
      canvasAuthority: pendingCanvasAuthority(this.#snapshot.canvasGeneration),
    });
    return nextRevision;
  }

  setHtml(html) {
    const nextHtml = String(html);
    this.#emit({
      ...this.#snapshot,
      html: nextHtml,
      workingHtmlSha256: nextHtml === this.#snapshot.html
        ? this.#snapshot.workingHtmlSha256
        : null,
    });
  }

  setPersistedSourceSha256(persistedSourceSha256) {
    this.#emit({
      ...this.#snapshot,
      persistedSourceSha256: persistedSourceSha256
        ? String(persistedSourceSha256)
        : null,
    });
  }

  setEditRevision(value) {
    this.#emit({ ...this.#snapshot, editRevision: revision(value) });
  }

  setLastPersistedRevision(value) {
    this.#emit({
      ...this.#snapshot,
      lastPersistedRevision: revision(value),
    });
  }

  setPersistence({
    state = this.#snapshot.persistState,
    error = this.#snapshot.persistError,
  } = {}) {
    this.#emit({
      ...this.#snapshot,
      persistState: persistState(state),
      persistError: String(error || ""),
    });
  }

  setPersistState(state) {
    this.setPersistence({ state });
  }

  setPersistError(error) {
    this.setPersistence({ error });
  }

  setPendingWrite(write) {
    this.#pendingWrite = write || null;
    return this.#pendingWrite;
  }

  takePendingWrite() {
    const write = this.#pendingWrite;
    this.#pendingWrite = null;
    return write;
  }

  setFlushPromise(promise) {
    if (promise !== null && typeof promise?.then !== "function") {
      throw new TypeError("Document flush authority must be a Promise.");
    }
    this.#flushPromise = promise;
    this.#emit(this.#snapshot);
    return promise;
  }

  clearFlushPromise(promise) {
    if (this.#flushPromise !== promise) return false;
    this.#flushPromise = null;
    this.#emit(this.#snapshot);
    return true;
  }

  async reconcilePersistedBoundary({
    frozenHtml,
    reportedSourceSha256 = null,
    cutoffRevision,
    hashHtml,
    readSource,
    isCurrent,
    acceptsSource,
  }) {
    if (
      typeof hashHtml !== "function"
      || typeof readSource !== "function"
      || typeof isCurrent !== "function"
      || typeof acceptsSource !== "function"
    ) {
      throw new TypeError("Document boundary reconciliation is not configured.");
    }

    const html = String(frozenHtml);
    const cutoff = revision(cutoffRevision);
    const stillCurrent = () => Boolean(
      isCurrent()
      && this.#snapshot.editRevision === cutoff
      && this.#snapshot.html === html
      && !this.#pendingWrite
      && !this.#flushPromise
    );

    let frozenSha256;
    try {
      frozenSha256 = String(await hashHtml(html));
    } catch {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(frozenSha256)) {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "关闭核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const metadataRepaired = Boolean(
      reportedSourceSha256
      && String(reportedSourceSha256) !== frozenSha256
    );
    if (
      this.#snapshot.persistState === "idle"
      && this.#snapshot.persistedSourceSha256 === frozenSha256
      && this.#snapshot.workingHtmlSha256 === frozenSha256
      && this.#snapshot.lastPersistedRevision >= cutoff
    ) {
      return Object.freeze({
        ready: true,
        repaired: metadataRepaired,
        sourceSha256: frozenSha256,
        lastModifiedAt: "",
      });
    }

    let source;
    try {
      source = await readSource();
    } catch {
      return boundaryBlock(
        "source-unavailable",
        "源文件暂时无法完成最终核对，当前页面仍保留；再次关闭时会自动继续。",
      );
    }
    let sourceAccepted = false;
    try {
      sourceAccepted = Boolean(
        source
        && typeof source === "object"
        && !Array.isArray(source)
        && acceptsSource(source)
      );
    } catch {
      sourceAccepted = false;
    }
    if (!stillCurrent() || !sourceAccepted) {
      return boundaryBlock(
        "source-identity-changed",
        "核对期间当前文件身份发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const content = typeof source?.content === "string" ? source.content : null;
    const declaredSha256 = String(source?.sha256 || "");
    let actualSha256 = "";
    if (content !== null) {
      try {
        actualSha256 = String(await hashHtml(content));
      } catch {
        actualSha256 = "";
      }
    }
    if (
      content === null
      || !/^sha256:[a-f0-9]{64}$/u.test(declaredSha256)
      || actualSha256 !== declaredSha256
    ) {
      return boundaryBlock(
        "source-integrity-failed",
        "源文件的内容校验没有通过。当前页面没有覆盖文件；请先导出当前 HTML，再重新读取源文件。",
        true,
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (content !== html || declaredSha256 !== frozenSha256) {
      const reason = "磁盘中的 HTML 已被其他操作修改。当前页面没有覆盖任何一份；请先导出当前 HTML，或重新载入磁盘文件。";
      this.setPersistence({ state: "conflict", error: reason });
      return boundaryBlock("source-diverged", reason, true);
    }

    this.update({
      persistedSourceSha256: frozenSha256,
      workingHtmlSha256: frozenSha256,
      lastPersistedRevision: Math.max(
        this.#snapshot.lastPersistedRevision,
        cutoff,
      ),
      persistState: "idle",
      persistError: "",
    });
    return Object.freeze({
      ready: true,
      repaired: true,
      sourceSha256: frozenSha256,
      lastModifiedAt: String(source?.lastModifiedAt || ""),
    });
  }

  get html() {
    return this.#snapshot.html;
  }

  #nextReceipt(input) {
    this.#receiptSequence += 1;
    return sourceReceipt({
      ...input,
      sequence: this.#receiptSequence,
      sessionIncarnation: this.#sessionIncarnation,
    });
  }

  get sourceReceipt() {
    return this.#snapshot.sourceReceipt;
  }

  get persistedSourceSha256() {
    return this.#snapshot.persistedSourceSha256;
  }

  get workingHtmlSha256() {
    return this.#snapshot.workingHtmlSha256;
  }

  get canvasGeneration() {
    return this.#snapshot.canvasGeneration;
  }

  get canvasAuthority() {
    return this.#snapshot.canvasAuthority;
  }

  get editRevision() {
    return this.#snapshot.editRevision;
  }

  get lastPersistedRevision() {
    return this.#snapshot.lastPersistedRevision;
  }

  get persistState() {
    return this.#snapshot.persistState;
  }

  get persistError() {
    return this.#snapshot.persistError;
  }

  get pendingWrite() {
    return this.#pendingWrite;
  }

  get flushPromise() {
    return this.#flushPromise;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
