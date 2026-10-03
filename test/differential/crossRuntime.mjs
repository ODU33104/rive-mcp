import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeBackend } from "../../dist/backends/nativeBackend.js";
import { RiveCliBackend } from "../../dist/backends/riveCliBackend.js";
import { identifyEvidenceSubject } from "../../dist/evidence/manifest.js";
import { runDifferentialPair } from "../../dist/differential/lab.js";
import { sha256Bytes } from "../../dist/revisions/hash.js";

function run(binary, args) {
  return new Promise((resolve, reject) => {
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
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureRoot = join(root, "test", "fixtures", "differential-basic");
const workspace = mkdtempSync(join(tmpdir(), "rive-cross-runtime-"));
const corpusDir = join(root, "test", "tmp", "cross-runtime-differential");
rmSync(corpusDir, { recursive: true, force: true });
mkdirSync(corpusDir, { recursive: true });
const cliArtifactDir = join(corpusDir, "artifacts", "cli");
const nativeArtifactDir = join(corpusDir, "artifacts", "native");
const projectDir = join(workspace, "differential-basic");
cpSync(fixtureRoot, projectDir, { recursive: true });

const binary = process.env.RIVE_CLI_BIN ?? "rive";
const build = await run(binary, [projectDir, "--once", "--quiet"]);
assert.equal(build.code, 0, build.stderr || build.stdout);

const compiledRiv = join(projectDir, "build", "differential-basic.riv");
const sourceSubject = identifyEvidenceSubject({ kind: "directory", path: projectDir });
const compiledSubject = identifyEvidenceSubject({ kind: "riv", path: compiledRiv });
const scenario = JSON.parse(readFileSync(join(projectDir, "scenario.json"), "utf8"));

const cli = new RiveCliBackend({
  binary,
  outputDir: cliArtifactDir,
});
const native = new NativeBackend({
  outputDir: nativeArtifactDir,
});

try {
  const runPair = () => runDifferentialPair({
    artifactHash: sourceSubject.artifactHash,
    scenario,
    left: {
      backend: cli,
      project: { kind: "directory", path: projectDir },
      executionArtifactHash: compiledSubject.artifactHash,
    },
    right: {
      backend: native,
      project: { kind: "riv", path: compiledRiv },
      executionArtifactHash: compiledSubject.artifactHash,
    },
  });

  const first = await runPair();
  const compiledAfterFirst = identifyEvidenceSubject({ kind: "riv", path: compiledRiv });
  assert.equal(
    compiledAfterFirst.artifactHash,
    compiledSubject.artifactHash,
    "CLI execution must not silently change the compiled artifact projection"
  );

  const second = await runPair();
  assert.equal(
    first.result.deterministicKey,
    second.result.deterministicKey,
    "unchanged artifact/scenario/runtime pair must yield a deterministic differential result"
  );
  assert.equal(first.left.artifactHash, first.right.artifactHash);
  assert.equal(first.left.scenarioHash, first.right.scenarioHash);
  assert.equal(first.left.executionArtifactHash, first.right.executionArtifactHash);
  assert.ok(first.left.backend.backendVersion);
  assert.ok(first.right.backend.runtimeVersion);

  const evidenceFiles = (dir) => readdirSync(dir)
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const bytes = readFileSync(path);
      return {
        path: relative(corpusDir, path).replaceAll("\\", "/"),
        sha256: sha256Bytes(bytes),
        bytes: bytes.length,
      };
    });
  const leftEvidence = evidenceFiles(cliArtifactDir);
  const rightEvidence = evidenceFiles(nativeArtifactDir);
  assert.ok(leftEvidence.length > 0, "CLI differential evidence PNG must be retained");
  assert.ok(rightEvidence.length > 0, "native differential evidence PNG must be retained");

  const record = {
    schemaVersion: "rive-mcp.differential-corpus/v1",
    observedAt: new Date().toISOString(),
    sourceArtifactHash: sourceSubject.artifactHash,
    compiledArtifactHash: compiledSubject.artifactHash,
    scenarioHash: first.result.scenarioHash,
    observations: {
      left: first.left,
      right: first.right,
    },
    evidenceFiles: {
      left: leftEvidence,
      right: rightEvidence,
    },
    result: first.result,
  };
  writeFileSync(join(corpusDir, "differential-basic.json"), JSON.stringify(record, null, 2));

  console.log(JSON.stringify({
    ok: true,
    sourceArtifactHash: sourceSubject.artifactHash,
    compiledArtifactHash: compiledSubject.artifactHash,
    scenarioHash: first.result.scenarioHash,
    cli: first.left.backend,
    native: first.right.backend,
    classification: first.result.classification,
    firstDivergentCheckpoint: first.result.firstDivergentCheckpoint ?? null,
    differentialKey: first.result.deterministicKey,
  }, null, 2));
} finally {
  await native.close();
}
