import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Synthetic persisted shape from the v4 no-change writer at 861d0fbc.
// Seed old terminal records directly: calling today's completeRequest would
// exercise the new Candidate path and would not prove historical compatibility.
export async function writeLegacyNoChangeOutcome({ projectRoot, requestId }) {
  const controlRoot = path.join(projectRoot, ".pageroot");
  const requestRoot = path.join(controlRoot, "requests", requestId);
  const requestPath = path.join(requestRoot, "request.json");
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  request.status = "no-change";
  request.completedAt = "2026-09-08T00:00:00.000Z";
  const operationId = request.request?.submissionOperationId;
  const event = {
    eventId: `event_${request.requestId}_${request.attemptId}_no_change`,
    kind: "no-change",
    timestamp: request.completedAt,
  };
  if (operationId) request.conversationEvents = [event];
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.activeRequest = null;
  runtime.activeCandidateId = null;
  runtime.lastAiTask = {
    requestId: request.requestId,
    attemptId: request.attemptId,
    candidateId: request.candidateId,
    projectId: request.projectId,
    documentId: request.documentId,
    sourceWorkingCopyId: request.sourceWorkingCopyId,
    expectedSourceSha256: request.expectedSourceSha256,
    inputManifestSha256: request.inputManifestSha256,
    status: request.status,
    completedAt: request.completedAt,
  };
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
  const files = [requestPath];
  const completionPath = path.join(requestRoot, "attempts", request.attemptId, "completion.json");
  const completionBytes = await readFile(completionPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (completionBytes) {
    const completion = JSON.parse(completionBytes);
    completion.status = "no-change";
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
    files.push(completionPath);
  }
  if (operationId) {
    const receiptPath = path.join(controlRoot, "submissions", `${operationId}.json`);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.events = [...(receipt.events || []), event];
    receipt.eventsTruncated = false;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    files.push(receiptPath);
  }
  return {
    request,
    runtime,
    files,
    bytes: await Promise.all(files.map((file) => readFile(file, "utf8"))),
  };
}
