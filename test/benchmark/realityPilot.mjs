import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";
import { RiveCliBackend } from "../../dist/backends/riveCliBackend.js";
import { createEvidenceManifest } from "../../dist/evidence/manifest.js";
import { EvidenceStore } from "../../dist/evidence/store.js";

const binary = process.env.RIVE_CLI_BIN ?? "rive";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputRoot = join(repoRoot, "test", "tmp", "reality-pilot");
mkdirSync(outputRoot, { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), "rive-reality-pilot-"));
const projectDir = join(workspace, "visual-card");
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, "rive.yaml"), "name: reality-pilot\n");

const scenePath = join(projectDir, "scene.rml");
const initialScene = `<Rive version="1" kind="fragment">
  <Artboard width="320" height="180" name="Artboard" id="0:2">
    <Shape x="160" y="90" name="Card">
      <Triangle originX="0.5" originY="0.5" width="140" height="110" name="Path"/>
      <Fill name="Fill">
        <SolidColor colorValue="FF57A5E0" name="Color"/>
      </Fill>
    </Shape>
  </Artboard>
</Rive>
`;
writeFileSync(scenePath, initialScene);

function run(args) {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({
      code: code ?? 1,
      stdout,
      stderr,
      elapsedMs: Date.now() - started,
    }));
  });
}

const backend = new RiveCliBackend({
  binary,
  outputDir: join(outputRoot, "artifacts"),
});
const identity = await backend.identify();
const project = { kind: "directory", path: projectDir };
const store = new EvidenceStore(join(outputRoot, "evidence"));

const visualScenario = {
  name: "visual-authoring",
  viewport: { width: 320, height: 180 },
  steps: [{ type: "advance", ms: 100 }],
  capture: { screenshot: true },
};
const visualStarted = Date.now();
const verifyVisual = await backend.verify(project);
const inspectVisual = await backend.inspect(project);
assert.equal(verifyVisual.ok, true, JSON.stringify(verifyVisual.diagnostics));
assert.equal(inspectVisual.ok, true, JSON.stringify(inspectVisual.diagnostics));
const visualA = await backend.execute(project, visualScenario);
const visualB = await backend.execute(project, visualScenario);
assert.equal(visualA.ok, true, JSON.stringify(visualA.diagnostics));
assert.equal(visualB.ok, true, JSON.stringify(visualB.diagnostics));
const visualManifestA = createEvidenceManifest({
  project,
  backend: identity,
  scenario: visualScenario,
  verify: verifyVisual,
  inspect: inspectVisual,
  execution: visualA,
  assertions: [{
    name: "repeat screenshot hash is stable",
    pass: visualA.artifacts[0]?.sha256 === visualB.artifacts[0]?.sha256,
    expected: visualA.artifacts[0]?.sha256,
    actual: visualB.artifacts[0]?.sha256,
  }],
});
const visualManifestB = createEvidenceManifest({
  project,
  backend: identity,
  scenario: visualScenario,
  verify: verifyVisual,
  inspect: inspectVisual,
  execution: visualB,
  assertions: [{
    name: "repeat screenshot hash is stable",
    pass: visualA.artifacts[0]?.sha256 === visualB.artifacts[0]?.sha256,
  }],
});
const visualEvidence = store.put(visualManifestA);
store.put(visualManifestB);

const badDataScenario = {
  name: "data-binding-silent-drop-detection",
  viewport: { width: 320, height: 180 },
  steps: [{ type: "data", path: "__rive_mcp_missing_property__", value: 42 }],
  capture: { screenshot: true },
};
const rawBadPath = join(outputRoot, "raw-bad-data.png");
const rawBad = await run([
  projectDir,
  `--screenshot=${rawBadPath}`,
  "--data=__rive_mcp_missing_property__=42",
]);
const behaviorStarted = Date.now();
const behavior = await backend.execute(project, badDataScenario);
const rawReportedDrop = /^data:\s+no\b/im.test(rawBad.stderr)
  || /data: no property at/i.test(rawBad.stderr);
const adapterDetectedDrop = !behavior.ok
  && behavior.diagnostics.some((d) => d.code === "CLI_DATA_NOT_APPLIED");
const behaviorElapsedMs = Date.now() - behaviorStarted;\nconst behaviorDecision = rawBad.code === 0 && rawReportedDrop && adapterDetectedDrop
  ? "KEEP"
  : rawBad.code !== 0
    ? "INCONCLUSIVE"
    : "REVERT";

const beforeRefineManifest = visualManifestA;
writeFileSync(scenePath, initialScene.replace("FF57A5E0", "FFFF5A3C"));
const refineScenario = {
  name: "existing-file-refinement",
  viewport: { width: 320, height: 180 },
  steps: [{ type: "advance", ms: 100 }],
  capture: { screenshot: true },
};
const refineStarted = Date.now();
const verifyRefined = await backend.verify(project);
const inspectRefined = await backend.inspect(project);
assert.equal(verifyRefined.ok, true, JSON.stringify(verifyRefined.diagnostics));
assert.equal(inspectRefined.ok, true, JSON.stringify(inspectRefined.diagnostics));
const refinedExecution = await backend.execute(project, refineScenario);
assert.equal(refinedExecution.ok, true, JSON.stringify(refinedExecution.diagnostics));
const refinedManifest = createEvidenceManifest({
  project,
  backend: identity,
  scenario: refineScenario,
  verify: verifyRefined,
  inspect: inspectRefined,
  execution: refinedExecution,
  assertions: [
    {
      name: "refinement changes exact source artifact",
      pass: beforeRefineManifest.subject.artifactHash !== createEvidenceManifest({
        project,
        backend: identity,
        scenario: refineScenario,
        verify: verifyRefined,
        inspect: inspectRefined,
        execution: refinedExecution,
      }).subject.artifactHash,
    },
    {
      name: "refinement changes rendered evidence",
      pass: beforeRefineManifest.artifacts[0]?.sha256 !== refinedExecution.artifacts[0]?.sha256,
      expected: "different screenshot hash",
      actual: refinedExecution.artifacts[0]?.sha256,
    },
  ],
});
const refinedEvidence = store.put(refinedManifest);\nconst refineElapsedMs = Date.now() - refineStarted;

const report = {
  schemaVersion: "rive-mcp.reality-pilot/v1",
  measuredAt: new Date().toISOString(),
  cli: identity,
  modelBenchmark: {
    status: "not-run",
    reason: "This deterministic pilot does not fabricate model token or creative-quality measurements.",
    actualModelTokens: "unavailable",
    qualityPer1kTokens: null,
  },
  cases: [
    {
      id: "visual-authoring",
      completion: visualManifestA.result.pass,
      actualModelTokens: "unavailable",
      toolCalls: 4,
      failuresRetries: 0,
      elapsedMs: visualElapsedMs,
      visualQualityEvidence: {
        firstScreenshotHash: visualA.artifacts[0]?.sha256,
        repeatScreenshotHash: visualB.artifacts[0]?.sha256,
      },
      behaviorCorrectness: null,
      compileInspectErrors: [
        ...verifyVisual.diagnostics,
        ...inspectVisual.diagnostics,
      ].filter((d) => d.severity === "error"),
      defectsFoundAfterAuthoring: 0,
      humanCorrectionRequired: false,
      qualityPer1kTokens: null,
      reproducibility: {
        screenshotHashStable: visualA.artifacts[0]?.sha256 === visualB.artifacts[0]?.sha256,
        evidenceKeyStable: visualManifestA.reproducibilityKey === visualManifestB.reproducibilityKey,
      },
      evidenceRef: visualEvidence.evidenceRef,
    },
    {
      id: "state-machine-data-binding-behavior",
      scope: "negative data-binding defect detection; positive state-machine behavior is not claimed",
      completion: adapterDetectedDrop,
      actualModelTokens: "unavailable",
      toolCalls: 2,
      failuresRetries: 0,
      elapsedMs: behaviorElapsedMs,
      rawCli: {
        exitCode: rawBad.code,
        reportedDrop: rawReportedDrop,
        stderr: rawBad.stderr.trim(),
      },
      behaviorCorrectness: adapterDetectedDrop,
      compileInspectErrors: [],
      defectsFoundAfterAuthoring: adapterDetectedDrop ? 1 : 0,
      humanCorrectionRequired: false,
      qualityPer1kTokens: null,
    },
    {
      id: "existing-file-refinement",
      completion: refinedManifest.result.pass,
      actualModelTokens: "unavailable",
      toolCalls: 3,
      failuresRetries: 0,
      elapsedMs: refineElapsedMs,
      visualQualityEvidence: {
        beforeScreenshotHash: beforeRefineManifest.artifacts[0]?.sha256,
        afterScreenshotHash: refinedExecution.artifacts[0]?.sha256,
      },
      behaviorCorrectness: null,
      compileInspectErrors: [
        ...verifyRefined.diagnostics,
        ...inspectRefined.diagnostics,
      ].filter((d) => d.severity === "error"),
      defectsFoundAfterAuthoring: 0,
      humanCorrectionRequired: false,
      qualityPer1kTokens: null,
      exactArtifactChanged: beforeRefineManifest.subject.artifactHash !== refinedManifest.subject.artifactHash,
      evidenceRef: refinedEvidence.evidenceRef,
    },
  ],
  iterations: [
    {
      hypothesis: "Official CLI may report success when a --data path is not applied; evidence should fail closed on that diagnostic.",
      baseline: {
        rawCliExitCode: rawBad.code,
        rawCliReportedDrop: rawReportedDrop,
      },
      change: "Promote CLI data-not-applied diagnostics to a failed backend execution result.",
      measurement: {
        adapterOk: behavior.ok,
        diagnosticCodes: behavior.diagnostics.map((d) => d.code),
      },
      result: adapterDetectedDrop
        ? "The adapter turned a successful CLI process with an unapplied input into failed evidence."
        : "The expected silent-drop weakness was not reproduced with this CLI build.",
      decision: behaviorDecision,
      nextHypothesis: "Evidence repeated on an unchanged project/scenario should produce the same reproducibility key.",
    },
    {
      hypothesis: "Reproducibility identity must exclude volatile timestamp, elapsed time, and output paths.",
      baseline: "No exact-artifact reproducibility key existed before this change.",
      change: "Derive reproducibilityKey from source hash, backend/version, scenario hash, deterministic results, output hashes, diagnostics and assertions only.",
      measurement: {
        firstKey: visualManifestA.reproducibilityKey,
        secondKey: visualManifestB.reproducibilityKey,
        equal: visualManifestA.reproducibilityKey === visualManifestB.reproducibilityKey,
      },
      result: visualManifestA.reproducibilityKey === visualManifestB.reproducibilityKey
        ? "Repeated execution produced the same evidence identity."
        : "Repeated execution did not reproduce.",
      decision: visualManifestA.reproducibilityKey === visualManifestB.reproducibilityKey ? "KEEP" : "REVERT",
      nextHypothesis: "Next work should add a real positive State Machine/Data Binding fixture before expanding the Scenario model.",
    },
  ],
  knownLimitations: [
    "The pilot does not measure model creative quality or model tokens.",
    "The behavior case proves detection of an unapplied data input; it does not yet prove a positive State Machine transition or bound-data mutation.",
    "Official MCP is not part of this pilot because the documented MCP requires the desktop Editor.",
  ],
};
writeFileSync(join(outputRoot, "result.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

if (!report.cases.every((item) => item.completion)) process.exitCode = 1;
if (report.iterations.some((item) => item.decision === "REVERT")) process.exitCode = 1;
