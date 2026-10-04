import {
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { revisionHash, sha256Bytes, stableJson } from "./hash.js";
import type {
  BackendIdentity,
  Diagnostic,
  ExecutionResult,
  InspectResult,
  ProjectRef,
  Scenario,
  VerifyResult,
} from "../execution/types.js";

export interface EvidenceAssertion {
  name: string;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
  details?: string;
}

export interface EvidenceSubject {
  kind: "riv-file" | "project-tree";
  artifactHash: string;
  bytes?: number;
  fileCount?: number;
  sourcePath: string;
  excluded?: string[];
}

export interface EvidenceManifestV1 {
  schemaVersion: "rive-mcp.evidence/v1";
  manifestHash: string;
  reproducibilityKey: string;
  subject: EvidenceSubject;
  backend: BackendIdentity;
  toolVersion: string;
  scenario: {
    definition: Scenario;
    hash: string;
  };
  verification: {
    ok: boolean;
    diagnostics: Diagnostic[];
  };
  inspect: {
    ok: boolean;
    summary: InspectResult["summary"];
    diagnostics: Diagnostic[];
  };
  inputSequence: ExecutionResult["eventSequence"];
  artifacts: ExecutionResult["artifacts"];
  dataSnapshots: ExecutionResult["dataSnapshots"];
  diagnostics: Diagnostic[];
  performance: {
    verifyMs: number;
    inspectMs: number;
    executeMs: number;
    backendReported?: Record<string, number>;
  };
  assertions: EvidenceAssertion[];
  result: {
    pass: boolean;
    reasons: string[];
  };
  createdAt: string;
}

export interface CreateEvidenceInput {
  project: ProjectRef;
  backend: BackendIdentity;
  scenario: Scenario;
  verify: VerifyResult;
  inspect: InspectResult;
  execution: ExecutionResult;
  assertions?: EvidenceAssertion[];
  createdAt?: string;
}

const PROJECT_EXCLUDES = new Set([".git", "build", "node_modules", ".rive-mcp"]);

function toolVersion(): string {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function projectEntries(root: string): Array<{ path: string; kind: "file" | "symlink"; sha256: string; bytes: number }> {
  const entries: Array<{ path: string; kind: "file" | "symlink"; sha256: string; bytes: number }> = [];
  const visit = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (PROJECT_EXCLUDES.has(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        visit(full);
      } else if (item.isFile()) {
        const bytes = readFileSync(full);
        entries.push({
          path: relative(root, full).replaceAll("\\", "/"),
          kind: "file",
          sha256: sha256Bytes(bytes),
          bytes: bytes.length,
        });
      } else if (item.isSymbolicLink()) {
        const target = readlinkSync(full);
        entries.push({
          path: relative(root, full).replaceAll("\\", "/"),
          kind: "symlink",
          sha256: sha256Bytes(`symlink:${target}`),
          bytes: Buffer.byteLength(target),
        });
      }
    }
  };
  visit(root);
  return entries;
}

export function identifyEvidenceSubject(project: ProjectRef): EvidenceSubject {
  const sourcePath = resolve(project.path);
  if (project.kind === "riv") {
    const bytes = readFileSync(sourcePath);
    return {
      kind: "riv-file",
      artifactHash: sha256Bytes(bytes),
      bytes: bytes.length,
      sourcePath,
    };
  }
  const stats = statSync(sourcePath);
  if (!stats.isDirectory()) throw new Error(`Project path is not a directory: ${sourcePath}`);
  const entries = projectEntries(sourcePath);
  return {
    kind: "project-tree",
    artifactHash: revisionHash(entries),
    fileCount: entries.length,
    sourcePath,
    excluded: [...PROJECT_EXCLUDES].sort(),
  };
}

function normalizedBackend(identity: BackendIdentity) {
  return {
    id: identity.id,
    version: identity.version,
    runtimeVersion: identity.runtimeVersion,
  };
}

function normalizedDiagnostics(diagnostics: Diagnostic[]) {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    source: diagnostic.source,
  }));
}

function normalizedArtifacts(artifacts: ExecutionResult["artifacts"]) {
  return artifacts.map((item) => ({
    kind: item.kind,
    sha256: item.sha256,
    bytes: item.bytes,
    mediaType: item.mediaType,
  }));
}

export function createEvidenceManifest(input: CreateEvidenceInput): EvidenceManifestV1 {
  const subject = identifyEvidenceSubject(input.project);
  const scenarioHash = revisionHash(input.scenario);
  const assertions = input.assertions ?? [];
  const diagnostics = [
    ...input.verify.diagnostics,
    ...input.inspect.diagnostics,
    ...input.execution.diagnostics,
  ];
  const reasons: string[] = [];
  if (!input.verify.ok) reasons.push("verification failed");
  if (!input.inspect.ok) reasons.push("inspection failed");
  if (!input.execution.ok) reasons.push("scenario execution failed");
  for (const assertion of assertions) {
    if (!assertion.pass) reasons.push(`assertion failed: ${assertion.name}`);
  }
  const pass = reasons.length === 0;

  const reproducibilityKey = revisionHash({
    subject: {
      kind: subject.kind,
      artifactHash: subject.artifactHash,
    },
    backend: normalizedBackend(input.backend),
    scenarioHash,
    verification: {
      ok: input.verify.ok,
      diagnostics: normalizedDiagnostics(input.verify.diagnostics),
    },
    inspect: {
      ok: input.inspect.ok,
      summary: input.inspect.summary,
      diagnostics: normalizedDiagnostics(input.inspect.diagnostics),
    },
    inputSequence: input.execution.eventSequence,
    artifacts: normalizedArtifacts(input.execution.artifacts),
    dataSnapshots: input.execution.dataSnapshots.map((item) => ({ sha256: item.sha256 })),
    diagnostics: normalizedDiagnostics(input.execution.diagnostics),
    assertions,
    pass,
  });

  const withoutHash: Omit<EvidenceManifestV1, "manifestHash"> = {
    schemaVersion: "rive-mcp.evidence/v1",
    reproducibilityKey,
    subject,
    backend: input.backend,
    toolVersion: toolVersion(),
    scenario: {
      definition: input.scenario,
      hash: scenarioHash,
    },
    verification: {
      ok: input.verify.ok,
      diagnostics: input.verify.diagnostics,
    },
    inspect: {
      ok: input.inspect.ok,
      summary: input.inspect.summary,
      diagnostics: input.inspect.diagnostics,
    },
    inputSequence: input.execution.eventSequence,
    artifacts: input.execution.artifacts,
    dataSnapshots: input.execution.dataSnapshots,
    diagnostics,
    performance: {
      verifyMs: input.verify.elapsedMs,
      inspectMs: input.inspect.elapsedMs,
      executeMs: input.execution.performance.elapsedMs,
      backendReported: input.execution.performance.backendReported,
    },
    assertions,
    result: { pass, reasons },
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return {
    ...withoutHash,
    manifestHash: sha256Bytes(stableJson(withoutHash)),
  };
}
