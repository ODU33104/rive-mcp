import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const FIXTURE = {
  id: "official-flutter-rapid-pointer",
  url: "https://media.githubusercontent.com/media/rive-app/rive-flutter/58fcac2171f655757907356a4bead2ebd008e4f7/test/assets/rapid_pointer_events.riv",
  repository: "rive-app/rive-flutter",
  retrievalRef: "58fcac2171f655757907356a4bead2ebd008e4f7",
  path: "test/assets/rapid_pointer_events.riv",
  sha256: "e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079",
  bytes: 528,
};

const outDir = resolve("test/tmp/raw-riv-cli-capability");
const artifactDir = join(outDir, "artifacts");
await mkdir(artifactDir, { recursive: true });

const response = await fetch(FIXTURE.url, {
  redirect: "follow",
  headers: { "user-agent": "rive-mcp-raw-riv-capability/1" },
});
if (!response.ok) throw new Error(`fixture fetch failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== FIXTURE.sha256 || bytes.length !== FIXTURE.bytes) {
  throw new Error(`fixture identity mismatch: sha=${sha256} bytes=${bytes.length}`);
}
const rivPath = join(outDir, "rapid_pointer_events.riv");
await writeFile(rivPath, bytes);

const binary = process.env.RIVE_CLI_BIN ?? "rive";
function run(name, args, timeoutMs = 60_000) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({
        name, args, exitCode: -1, timedOut: false,
        stdout, stderr: stderr + String(error), elapsedMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({
        name, args, exitCode: timedOut ? 124 : (code ?? 1), timedOut,
        stdout, stderr, elapsedMs: Date.now() - started,
      });
    });
  });
}

const version = await run("version", ["--version"], 15_000);
const help = await run("help", ["--help"], 15_000);
const inspectHelp = await run("inspect-help", ["inspect", "--help"], 15_000);
const inspectRaw = await run("inspect-raw-riv", ["inspect", rivPath, "--json"]);

const probes = [];
const addProbe = async (name, args, outputs = []) => {
  const result = await run(name, args);
  const materialized = [];
  for (const output of outputs) {
    try {
      const data = await readFile(output.path);
      materialized.push({
        kind: output.kind,
        path: output.path,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        text: output.kind === "data" ? data.toString("utf8") : undefined,
      });
    } catch {}
  }
  probes.push({ ...result, outputs: materialized });
};

await addProbe(
  "raw-advance",
  [rivPath, `--screenshot=${join(artifactDir, "advance.png")}`, "--advance=16ms"],
  [{ kind: "screenshot", path: join(artifactDir, "advance.png") }]
);
await addProbe(
  "raw-pointer-down-up",
  [
    rivPath,
    `--screenshot=${join(artifactDir, "pointer.png")}`,
    `--data-dump=${join(artifactDir, "pointer.data.json")}`,
    "--pointer=down@250,250",
    "--pointer=up@250,250",
    "--advance=16ms",
  ],
  [
    { kind: "screenshot", path: join(artifactDir, "pointer.png") },
    { kind: "data", path: join(artifactDir, "pointer.data.json") },
  ]
);
await addProbe(
  "raw-data",
  [
    rivPath,
    `--screenshot=${join(artifactDir, "data.png")}`,
    `--data-dump=${join(artifactDir, "data.data.json")}`,
    "--data=hasReached=false",
    "--advance=0ms",
  ],
  [
    { kind: "screenshot", path: join(artifactDir, "data.png") },
    { kind: "data", path: join(artifactDir, "data.data.json") },
  ]
);
await addProbe(
  "raw-key",
  [rivPath, `--screenshot=${join(artifactDir, "key.png")}`, "--key=tab", "--advance=0ms"],
  [{ kind: "screenshot", path: join(artifactDir, "key.png") }]
);

const helpText = help.stdout + "\n" + help.stderr;
const result = {
  schemaVersion: "rive-mcp.raw-riv-cli-capability/v1",
  fixture: {
    ...FIXTURE,
    acquiredSha256: sha256,
    acquiredBytes: bytes.length,
    exactPinnedBytes: sha256 === FIXTURE.sha256 && bytes.length === FIXTURE.bytes,
  },
  cli: {
    version,
    helpMentionsRiv: /\.riv\b/i.test(helpText),
    helpMentionsPointer: /--pointer\b/.test(helpText),
    helpMentionsData: /--data\b/.test(helpText),
    helpMentionsKey: /--key\b/.test(helpText),
    helpMentionsAdvance: /--advance\b/.test(helpText),
    help,
    inspectHelp,
    inspectRaw,
  },
  probes,
  interpretationRule: {
    directRawExecutionSupportedOnlyIf:
      "the CLI consumes the exact pinned .riv path and produces the requested execution observation without converting/rebuilding the artifact",
    conversionDoesNotCount:
      ".riv -> RML/project -> .riv is a distinct projection unless equivalence is separately proven",
  },
};
await writeFile(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  fixtureSha256: sha256,
  cliVersionOutput: (version.stdout || version.stderr).trim(),
  inspectRawExitCode: inspectRaw.exitCode,
  probes: probes.map((p) => ({
    name: p.name,
    exitCode: p.exitCode,
    outputs: p.outputs.map((o) => ({ kind: o.kind, bytes: o.bytes, sha256: o.sha256 })),
    errorTail: (p.stderr || p.stdout).trim().slice(-500),
  })),
}, null, 2));
