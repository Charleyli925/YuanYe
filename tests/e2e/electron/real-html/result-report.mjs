import {
  createResultModel,
  finalizeResultModel,
  recordBlocker,
  recordFailure,
  recordNotApplicable,
  recordResult,
  RESULT_REASON_CODES,
} from "./result-model.mjs";
import { createRealHtmlPlan } from "./plan.mjs";

export class RealHtmlResultReport {
  constructor(files, metadata = {}) {
    this.plan = createRealHtmlPlan(files, metadata);
    this.model = createResultModel(this.plan, {
      metadata: { reportKind: "private-real-html-electron" },
    });
  }

  operation(fileId, stageId, operationId, outcome) {
    this.model = recordResult(
      this.model,
      { level: "operation", fileId, stageId, operationId },
      outcome,
    );
    return this.model;
  }

  passOperation(fileId, stageId, operationId, details = null) {
    return this.operation(fileId, stageId, operationId, { state: "PASS", details });
  }

  failOperation(fileId, stageId, operationId, details = null) {
    this.model = recordFailure(
      this.model,
      { level: "operation", fileId, stageId, operationId },
      RESULT_REASON_CODES.OPERATION_FAILED,
      details,
    );
    return this.model;
  }

  blockOperation(fileId, stageId, operationId, reasonCode, details = null) {
    this.model = recordBlocker(
      this.model,
      { level: "operation", fileId, stageId, operationId },
      reasonCode,
      details,
    );
    return this.model;
  }

  notApplicableOperation(fileId, stageId, operationId, details = null) {
    this.model = recordNotApplicable(
      this.model,
      { level: "operation", fileId, stageId, operationId },
      RESULT_REASON_CODES.OPERATION_NOT_APPLICABLE,
      details,
    );
    return this.model;
  }

  passStage(fileId, stageId, details = null) {
    this.model = recordResult(
      this.model,
      { level: "stage", fileId, stageId },
      { state: "PASS", details },
    );
    return this.model;
  }

  failStage(fileId, stageId, details = null) {
    this.model = recordFailure(
      this.model,
      { level: "stage", fileId, stageId },
      RESULT_REASON_CODES.STAGE_FAILED,
      details,
    );
    return this.model;
  }

  notApplicableStage(fileId, stageId, details = null) {
    this.model = recordNotApplicable(
      this.model,
      { level: "stage", fileId, stageId },
      RESULT_REASON_CODES.STAGE_NOT_APPLICABLE,
      details,
    );
    return this.model;
  }

  passFile(fileId, details = null) {
    this.model = recordResult(
      this.model,
      { level: "file", fileId },
      { state: "PASS", details },
    );
    return this.model;
  }

  failFile(fileId, details = null) {
    this.model = recordFailure(
      this.model,
      { level: "file", fileId },
      RESULT_REASON_CODES.FILE_FAILED,
      details,
    );
    return this.model;
  }

  blockFile(fileId, reasonCode, details = null) {
    this.model = recordBlocker(
      this.model,
      { level: "file", fileId },
      reasonCode,
      details,
    );
    return this.model;
  }

  finalize() {
    this.model = finalizeResultModel(this.model);
    return this.model;
  }

  rowsForFile(fileId) {
    return this.model.rows.filter((row) => row.fileId === fileId);
  }
}
