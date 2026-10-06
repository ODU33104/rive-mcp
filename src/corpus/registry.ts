import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { corpusHash, shortCorpusId, stableCorpusJson } from "./identity.js";
import { mergeCorpusOrigin } from "./origin.js";
import {
  CORPUS_CASE_SCHEMA,
  CORPUS_EVIDENCE_SCHEMA,
  CORPUS_HISTORY_SCHEMA,
  CORPUS_LINK_SCHEMA,
  CORPUS_REGISTRY_SCHEMA,
  type CorpusCaseRecordV1,
  type CorpusEvidenceInput,
  type CorpusEvidenceRecordV1,
  type CorpusExecutionParticipant,
  type CorpusHistoryEntryV1,
  type CorpusLinkRecordV1,
  type CorpusRegistration,
  type CorpusRegistrationResult,
  type CorpusRegistryMetaV1,
  type CorpusRegistryMetrics,
} from "./types.js";

function compareIso(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a.localeCompare(b);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizedParticipants(
  participants: readonly CorpusExecutionParticipant[] = []
): CorpusExecutionParticipant[] {
  return participants
    .map((participant) => ({ ...participant }))
    .sort((a, b) =>
      stableCorpusJson(a).localeCompare(stableCorpusJson(b))
    );
}

function ensureIso(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-like parseable timestamp.`);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(temp, path);
}

function jsonFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(path, name));
}

function casePrefix(kind: CorpusCaseRecordV1["caseKind"]): string {
  switch (kind) {
    case "failure": return "case_fail";
    case "differential": return "case_diff";
    case "contract-observation": return "case_contract";
    case "causal-observation": return "case_causal";
  }
}

export function corpusCaseIdFor(
  kind: CorpusCaseRecordV1["caseKind"],
  logicalIdentity: Record<string, unknown>
): string {
  return shortCorpusId(casePrefix(kind), { kind, logicalIdentity });
}

export function corpusEvidenceIdFor(input: CorpusEvidenceInput): string {
  return shortCorpusId("evidence", {
    sourceKind: input.sourceKind,
    sourceSchemaVersion: input.sourceSchemaVersion,
    reproducibilityKey: input.reproducibilityKey,
    contentHash: input.contentHash,
    upstreamEvidenceId: input.upstreamEvidenceId,
  });
}

function historyIdFor(
  caseId: string,
  input: CorpusRegistration["history"],
  evidenceIds: string[]
): string {
  return shortCorpusId("history", {
    caseId,
    status: input.status,
    participants: normalizedParticipants(input.participants),
    evidenceIds: uniqueSorted(evidenceIds),
    scenarioHash: input.scenarioHash,
    executionArtifactHash: input.executionArtifactHash,
    fixedVersion: input.fixedVersion,
  });
}

export class JsonCorpusRegistry {
  readonly root: string;
  private readonly casesDir: string;
  private readonly evidenceDir: string;
  private readonly historyDir: string;
  private readonly linksDir: string;
  private readonly metaPath: string;

  constructor(root: string, createdAt = new Date().toISOString()) {
    this.root = resolve(root);
    this.casesDir = join(this.root, "cases");
    this.evidenceDir = join(this.root, "evidence");
    this.historyDir = join(this.root, "history");
    this.linksDir = join(this.root, "links");
    this.metaPath = join(this.root, "registry.json");
    this.ensureMeta(createdAt);
  }

  register(input: CorpusRegistration): CorpusRegistrationResult {
    ensureIso(input.history.observedAt, "history.observedAt");

    const caseId = corpusCaseIdFor(input.caseKind, input.logicalIdentity);
    const logicalIdentityHash = corpusHash(input.logicalIdentity);
    const evidenceResults = input.evidence.map((item) =>
      this.putEvidence(item, input.history.observedAt)
    );
    const evidenceIds = evidenceResults.map((item) => item.id);
    const historyId = historyIdFor(caseId, input.history, evidenceIds);
    const casePath = join(this.casesDir, `${caseId}.json`);
    const historyPath = join(this.historyDir, `${historyId}.json`);

    let record: CorpusCaseRecordV1;
    let caseCreated = false;
    if (existsSync(casePath)) {
      record = readJson<CorpusCaseRecordV1>(casePath);
      this.assertCaseVersion(record);
      if (
        record.caseKind !== input.caseKind ||
        record.logicalIdentityHash !== logicalIdentityHash ||
        stableCorpusJson(record.logicalIdentity) !== stableCorpusJson(input.logicalIdentity)
      ) {
        throw new Error(`Logical case collision for ${caseId}.`);
      }
      record.origin = mergeCorpusOrigin(record.origin, input.origin);
      record.upstreamCaseIds = uniqueSorted([
        ...record.upstreamCaseIds,
        ...(input.upstreamCaseIds ?? []),
      ]);
      record.evidenceIds = uniqueSorted([...record.evidenceIds, ...evidenceIds]);
      if (compareIso(input.history.observedAt, record.firstSeen) < 0) {
        record.firstSeen = input.history.observedAt;
      }
    } else {
      caseCreated = true;
      record = {
        schemaVersion: CORPUS_CASE_SCHEMA,
        caseId,
        caseKind: input.caseKind,
        logicalIdentityHash,
        logicalIdentity: input.logicalIdentity,
        subject: { ...input.subject },
        origin: input.origin,
        upstreamCaseIds: uniqueSorted(input.upstreamCaseIds ?? []),
        evidenceIds: uniqueSorted(evidenceIds),
        historyIds: [],
        relatedCaseIds: [],
        firstSeen: input.history.observedAt,
      };
    }

    const historyCreated = !existsSync(historyPath);
    if (historyCreated) {
      const history: CorpusHistoryEntryV1 = {
        schemaVersion: CORPUS_HISTORY_SCHEMA,
        historyId,
        caseId,
        observedAt: input.history.observedAt,
        status: input.history.status,
        participants: normalizedParticipants(input.history.participants),
        evidenceIds: uniqueSorted(evidenceIds),
        scenarioHash: input.history.scenarioHash,
        executionArtifactHash: input.history.executionArtifactHash,
        fixedVersion: input.history.fixedVersion,
        note: input.history.note,
      };
      writeJsonAtomic(historyPath, history);
    }

    if (!record.historyIds.includes(historyId)) {
      record.historyIds.push(historyId);
    }

    if (input.history.status === "reproduced") {
      if (
        record.lastReproduced === undefined ||
        compareIso(record.lastReproduced, input.history.observedAt) < 0
      ) {
        record.lastReproduced = input.history.observedAt;
      }
    }

    if (input.history.fixedVersion !== undefined) {
      if (
        record.fixedVersion !== undefined &&
        record.fixedVersion !== input.history.fixedVersion
      ) {
        throw new Error(
          `Conflicting fixed versions for ${caseId}: ${record.fixedVersion} vs ${input.history.fixedVersion}.`
        );
      }
      record.fixedVersion = input.history.fixedVersion;
    }

    writeJsonAtomic(casePath, record);

    return {
      caseId,
      evidenceIds,
      historyId,
      caseCreated,
      evidenceCreated: evidenceResults.filter((item) => item.created).length,
      historyCreated,
    };
  }

  putEvidence(
    input: CorpusEvidenceInput,
    registeredAt = new Date().toISOString()
  ): { id: string; created: boolean } {
    ensureIso(registeredAt, "registeredAt");
    const evidenceId = corpusEvidenceIdFor(input);
    const path = join(this.evidenceDir, `${evidenceId}.json`);
    const expectedCore = {
      sourceKind: input.sourceKind,
      sourceSchemaVersion: input.sourceSchemaVersion,
      reproducibilityKey: input.reproducibilityKey,
      contentHash: input.contentHash,
      upstreamEvidenceId: input.upstreamEvidenceId,
    };

    if (existsSync(path)) {
      const existing = readJson<CorpusEvidenceRecordV1>(path);
      this.assertEvidenceVersion(existing);
      const existingCore = {
        sourceKind: existing.sourceKind,
        sourceSchemaVersion: existing.sourceSchemaVersion,
        reproducibilityKey: existing.reproducibilityKey,
        contentHash: existing.contentHash,
        upstreamEvidenceId: existing.upstreamEvidenceId,
      };
      if (stableCorpusJson(existingCore) !== stableCorpusJson(expectedCore)) {
        throw new Error(`Evidence collision for ${evidenceId}.`);
      }
      return { id: evidenceId, created: false };
    }

    const record: CorpusEvidenceRecordV1 = {
      schemaVersion: CORPUS_EVIDENCE_SCHEMA,
      evidenceId,
      ...expectedCore,
      locator: input.locator,
      registeredAt,
    };
    writeJsonAtomic(path, record);
    return { id: evidenceId, created: true };
  }

  linkCases(
    caseA: string,
    caseB: string,
    relation: string,
    createdAt = new Date().toISOString()
  ): CorpusLinkRecordV1 {
    if (!relation.trim()) throw new Error("relation must not be empty.");
    ensureIso(createdAt, "createdAt");
    if (caseA === caseB) throw new Error("A case cannot be related to itself.");

    const caseIds = [caseA, caseB].sort() as [string, string];
    const linkId = shortCorpusId("link", { relation, caseIds });
    const path = join(this.linksDir, `${linkId}.json`);
    const link: CorpusLinkRecordV1 = {
      schemaVersion: CORPUS_LINK_SCHEMA,
      linkId,
      relation,
      caseIds,
      createdAt,
    };
    if (!existsSync(path)) writeJsonAtomic(path, link);

    for (const [current, related] of [
      [caseA, caseB],
      [caseB, caseA],
    ] as const) {
      const casePath = join(this.casesDir, `${current}.json`);
      if (!existsSync(casePath)) continue;
      const record = readJson<CorpusCaseRecordV1>(casePath);
      this.assertCaseVersion(record);
      record.relatedCaseIds = uniqueSorted([...record.relatedCaseIds, related]);
      writeJsonAtomic(casePath, record);
    }

    return link;
  }

  getCase(caseId: string): CorpusCaseRecordV1 | undefined {
    const path = join(this.casesDir, `${caseId}.json`);
    if (!existsSync(path)) return undefined;
    const record = readJson<CorpusCaseRecordV1>(path);
    this.assertCaseVersion(record);
    return record;
  }

  getHistory(caseId: string): CorpusHistoryEntryV1[] {
    return jsonFiles(this.historyDir)
      .map((path) => readJson<CorpusHistoryEntryV1>(path))
      .filter((item) => item.caseId === caseId)
      .sort(
        (a, b) =>
          a.observedAt.localeCompare(b.observedAt) ||
          a.historyId.localeCompare(b.historyId)
      );
  }

  metrics(): CorpusRegistryMetrics {
    const cases = jsonFiles(this.casesDir).map((path) =>
      readJson<CorpusCaseRecordV1>(path)
    );
    const evidence = jsonFiles(this.evidenceDir).map((path) =>
      readJson<CorpusEvidenceRecordV1>(path)
    );
    const history = jsonFiles(this.historyDir).map((path) =>
      readJson<CorpusHistoryEntryV1>(path)
    );
    const links = jsonFiles(this.linksDir).map((path) =>
      readJson<CorpusLinkRecordV1>(path)
    );

    const logicalHashes = new Map<string, number>();
    for (const item of cases) {
      const key = `${item.caseKind}\0${item.logicalIdentityHash}`;
      logicalHashes.set(key, (logicalHashes.get(key) ?? 0) + 1);
    }

    const caseIds = new Set(cases.map((item) => item.caseId));
    const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
    let unresolvedReferences = 0;
    for (const item of cases) {
      for (const relatedCaseId of item.relatedCaseIds) {
        if (!caseIds.has(relatedCaseId)) unresolvedReferences++;
      }
    }
    for (const item of history) {
      if (!caseIds.has(item.caseId)) unresolvedReferences++;
      for (const evidenceId of item.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) unresolvedReferences++;
      }
    }
    for (const link of links) {
      for (const caseId of link.caseIds) {
        if (!caseIds.has(caseId)) unresolvedReferences++;
      }
    }

    return {
      logicalCases: cases.length,
      physicalEvidenceRecords: evidence.length,
      duplicateLogicalCases: [...logicalHashes.values()].reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0
      ),
      historyEntries: history.length,
      ambiguousOrigins: cases.filter((item) => item.origin.kind === "unknown").length,
      unresolvedReferences,
    };
  }

  private ensureMeta(createdAt: string): void {
    ensureIso(createdAt, "createdAt");
    mkdirSync(this.root, { recursive: true });
    if (existsSync(this.metaPath)) {
      const meta = readJson<CorpusRegistryMetaV1>(this.metaPath);
      if (meta.schemaVersion !== CORPUS_REGISTRY_SCHEMA) {
        throw new Error(
          `Unsupported corpus registry schema ${String(meta.schemaVersion)}; expected ${CORPUS_REGISTRY_SCHEMA}.`
        );
      }
      return;
    }
    writeJsonAtomic(this.metaPath, {
      schemaVersion: CORPUS_REGISTRY_SCHEMA,
      createdAt,
    } satisfies CorpusRegistryMetaV1);
  }

  private assertCaseVersion(record: CorpusCaseRecordV1): void {
    if (record.schemaVersion !== CORPUS_CASE_SCHEMA) {
      throw new Error(`Unsupported case schema: ${String(record.schemaVersion)}.`);
    }
  }

  private assertEvidenceVersion(record: CorpusEvidenceRecordV1): void {
    if (record.schemaVersion !== CORPUS_EVIDENCE_SCHEMA) {
      throw new Error(`Unsupported evidence schema: ${String(record.schemaVersion)}.`);
    }
  }
}
