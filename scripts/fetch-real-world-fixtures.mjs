import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const manifestPath = resolve(valueAfter(
  "--manifest",
  "test/fixtures/real-world/manifest.json"
));
const outDir = resolve(valueAfter(
  "--out",
  "test/tmp/real-world-corpus/assets"
));

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(outDir, { recursive: true });

const records = [];
for (const fixture of manifest.fixtures) {
  const response = await fetch(fixture.source.acquisitionUrl, {
    redirect: "follow",
    headers: { "user-agent": "rive-mcp-real-world-corpus/1" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${fixture.id}: HTTP ${response.status} ${response.statusText}`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== fixture.artifact.sha256) {
    throw new Error(
      `${fixture.id}: SHA-256 mismatch: expected ${fixture.artifact.sha256}, got ${sha256}`
    );
  }
  if (bytes.length !== fixture.artifact.bytes) {
    throw new Error(
      `${fixture.id}: byte-size mismatch: expected ${fixture.artifact.bytes}, got ${bytes.length}`
    );
  }

  const path = resolve(outDir, `${fixture.id}.riv`);
  await writeFile(path, bytes);
  records.push({
    id: fixture.id,
    repository: fixture.source.repository,
    retrievalRef: fixture.source.retrievalRef,
    sourcePath: fixture.source.path,
    sha256,
    bytes: bytes.length,
    localFile: `${fixture.id}.riv`,
  });
}

const acquisitionPath = resolve(dirname(outDir), "acquisition.json");
await writeFile(
  acquisitionPath,
  JSON.stringify(
    {
      schemaVersion: "rive-mcp.real-world-corpus-acquisition/v1",
      manifest: manifestPath.replace(root + "/", ""),
      fixtures: records,
    },
    null,
    2
  ) + "\n"
);

console.log(JSON.stringify({ ok: true, count: records.length, acquisitionPath }, null, 2));
