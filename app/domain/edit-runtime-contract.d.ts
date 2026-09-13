export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION: 2;

export const EDIT_AUTHOR_RUNTIME_BUDGET: Readonly<{
  htmlBytes: number;
  scriptCount: number;
  scriptBytes: number;
  aggregateScriptBytes: number;
  declaredAssetCount: number;
  declaredAssetReferenceCount: number;
  declaredAssetBytes: number;
  remoteLibraryDeadlineMs: number;
  runtimeDeadlineMs: number;
  runtimeSurfaceDeadlineMs: number;
  orphanSessionTtlMs: number;
}>;

export const EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS: number;

export const EDIT_RUNTIME_PROTOCOL_SCHEME: "pageroot-edit-runtime";
export const EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE: string;
export const EDIT_RUNTIME_OWNED_ATTRIBUTE: string;
export const EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE: string;
export const EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE: string;

export type EditRuntimeGrant = Readonly<{
  contractVersion: number;
  sessionId: string;
  executionId: string;
  sourceSha256: string;
  resourceSha256: string;
  documentBasePath: string;
  libraryOrigins?: readonly (
    | "bundled"
    | "disk-cache"
    | "network"
    | "local"
    | "inline"
  )[];
  runtimeLibraries?: readonly "echarts"[];
  resourceMode?: "exact";
  scriptCount: number;
  byteLength: number;
  canvasGeneration: number;
  programIdentity: string;
}>;

export type EditRuntimePrepareRequest = Readonly<{
  contractVersion: number;
  requestId: string;
  sourceSha256: string;
  html: string;
  programIdentity: string;
  canvasGeneration: number;
}>;

export type EditRuntimePort = Readonly<{
  prepare(request: EditRuntimePrepareRequest): Promise<EditRuntimeGrant | null>;
  revoke(sessionId: string): Promise<unknown>;
}>;

export type EditRuntimeScript = Readonly<{
  startOffset: number;
  endOffset: number;
  openingTag: string;
  attributes: readonly Readonly<{ name: string; value: string | null }>[];
  type: string;
  src: string | null;
  inline: string;
  executable: boolean;
  index: number | null;
  reason: string | null;
}>;

export type EditRuntimeDocumentAnalysis = Readonly<{
  source: string;
  scripts: readonly EditRuntimeScript[];
  executableScripts: readonly EditRuntimeScript[];
  unsupportedReason: string | null;
  documentBase: Readonly<{
    href: string;
    openingTag: string;
  }> | null;
  programIdentity: string | null;
}>;

export function analyzeEditRuntimeDocument(html: string): EditRuntimeDocumentAnalysis;

export function collectEditRuntimeScripts(html: string): Readonly<{
  scripts: readonly EditRuntimeScript[];
  executableScripts: readonly EditRuntimeScript[];
  unsupportedReason: string | null;
}>;
export function authoredDocumentBase(html: string): Readonly<{
  href: string;
  openingTag: string;
}> | null;
export function editRuntimeProgramIdentity(html: string): string | null;
export function unsupportedEditRuntimeProgramReason(source: string): string | null;
export function editRuntimeSourceMarker(path: readonly number[]): string | null;
export function isEditRuntimeSessionId(value: unknown): boolean;
export function isEditRuntimeExecutionId(value: unknown): boolean;
export function isEditRuntimeRequestId(value: unknown): boolean;
export function isEditRuntimeSourceSha256(value: unknown): boolean;
export function isEditRuntimeFrameToken(value: unknown): boolean;
export function isEditRuntimeDocumentBasePath(value: unknown): boolean;
export function editRuntimeRegistrationProperty(executionId: unknown): string | null;
export function editRuntimeProtocolUrl(sessionId: string, path: string): string | null;
export function isEditRuntimeProtocolUrl(value: unknown, sessionId?: string | null): boolean;
