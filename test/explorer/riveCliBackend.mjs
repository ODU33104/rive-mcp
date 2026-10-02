import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { actionToRiveCliArgs, RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = mkdtempSync(join(tmpdir(), "rive-cli-backend-test-"));
writeFileSync(join(projectDir, "rive.yaml"), "name: fake\n");
const command = { executable: process.execPath, argsPrefix: [join(here, "fakeRiveCli.mjs")] };

try {
  assert.deepEqual(actionToRiveCliArgs({ kind: "data-write", path: "score", value: 50 }), ["--data=score=50"]);
  assert.deepEqual(actionToRiveCliArgs({ kind: "key", key: "a", phase: "down", modifiers: ["shift"] }), ["--key=a:down+shift"]);
  assert.deepEqual(
    actionToRiveCliArgs({ kind: "pointer", phase: "drag", x: 1, y: 2, toX: 3, toY: 4, steps: 6 }),
    ["--pointer=drag@1,2>3,4:6"]
  );
  assert.deepEqual(actionToRiveCliArgs({ kind: "advance-time", seconds: 0.25 }), ["--advance=0.25s"]);
  assert.throws(
    () => actionToRiveCliArgs({ kind: "runtime", surface: "gamepad", operation: "axis", payload: 1 }),
    /does not support runtime surface/
  );

  const sequence = [
    { kind: "data-write", path: "score", value: 50 },
    { kind: "pointer", phase: "click", x: 10, y: 20 },
    { kind: "advance-time", seconds: 0.1 },
    { kind: "key", key: "right", phase: "down", modifiers: ["shift"] },
  ];
  const backend = new RiveCliBackend({ projectDir, command, viewport: { width: 320, height: 240 } });
  const trace = await backend.execute(sequence);
  assert.equal(trace.backend?.version, "rive 9.9.9-test");
  assert.equal(trace.steps.length, sequence.length);
  assert.equal(trace.cost, 5, "one initial CLI observation plus one per prefix");
  assert.equal(trace.initial.viewModel.score, 0);
  assert.equal(trace.steps[0].observation.viewModel.score, 50);
  assert.equal(trace.steps[1].observation.viewModel.clicked, true);
  assert.equal(trace.steps[2].observation.viewModel.elapsed, 0.1);
  assert.equal(trace.steps[3].observation.viewModel.lastKey, "right:down+shift");
  assert.ok(trace.steps.every((step) => step.diagnostics.includes("fake build log")));
  assert.notEqual(trace.initial.dataHash, trace.steps[0].observation.dataHash);
  assert.notEqual(trace.initial.frameHash, trace.steps[0].observation.frameHash);

  const determinism = await checkSequenceDeterminism(
    () => new RiveCliBackend({ projectDir, command, viewport: { width: 320, height: 240 } }),
    sequence,
    3
  );
  assert.equal(determinism.deterministic, true);
  assert.equal(determinism.uniqueTraceSignatures.length, 1);
  console.log(JSON.stringify({ ok: true, cost: trace.cost, determinism }, null, 2));
} finally {
  rmSync(projectDir, { recursive: true, force: true });
}
