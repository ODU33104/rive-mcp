import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "rive-mcp-clean-room-"));
const revisionStore = join(workspace, ".rive-mcp", "revisions");
const authoredPath = join(workspace, "authored.riv");
const refinedPath = join(workspace, "refined.riv");
const finalAuthoredPath = join(workspace, "authored.final.riv");
const finalRefinedPath = join(workspace, "refined.final.riv");
const svgSpecPath = join(workspace, "asset.scene.json");
const artifactDir = join(repoRoot, "test", "tmp", "clean-room");
mkdirSync(artifactDir, { recursive: true });

const child = spawn(process.execPath, [join(repoRoot, "dist", "index.js")], {
  cwd: workspace,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, RIVE_MCP_REVISION_STORE: revisionStore },
});

let buffer = "";
let nextId = 1;
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout: " + method));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.isError) throw new Error(name + " failed: " + textOf(res));
  return res;
}

function requireFile(path, minBytes = 64) {
  if (!existsSync(path)) throw new Error("missing file: " + path);
  if (statSync(path).size < minBytes) throw new Error("file too small: " + path);
}

function parseRevision(text) {
  const m = text.match(/Revision:\s*(\{[^\n]+\})/);
  if (!m) throw new Error("missing revision metadata: " + text);
  return JSON.parse(m[1]);
}

function parseCritiqueReview(text) {
  const m = text.match(/ReviewReceipt:\s*(\{[^\n]+\})/);
  if (!m) throw new Error("missing critique review receipt");
  return JSON.parse(m[1]);
}

let exitCode = 0;
try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "clean-room-release-gate", version: "0.1.0" },
  });
  if (init.serverInfo?.name !== "rive-mcp") throw new Error("unexpected server identity");
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  if (tools.tools.length !== 33) throw new Error("unexpected tool count: " + tools.tools.length);
  for (const tool of tools.tools) {
    const schemaText = JSON.stringify(tool.inputSchema ?? {});
    if (schemaText.includes("\"$ref\"")) throw new Error("strict-client incompatible $ref in " + tool.name);
    const parsed = tool.inputSchema ?? {};
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.items)) throw new Error("tuple items array in " + tool.name);
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }

  const setup = await callTool("riv_setup", { scope: "project", projectDir: workspace });
  if (!textOf(setup).includes("Installed")) throw new Error("riv_setup did not install skills");
  for (const skill of ["rive-author","rive-refine","rive-qa","rive-setup","rive-design-guidelines"]) {
    if (!existsSync(join(workspace, ".claude", "skills", skill, "SKILL.md"))) throw new Error("missing installed skill: " + skill);
  }

  const tokens = await callTool("riv_design_tokens", { mood: "tech", scheme: "dark" });
  const tokenJson = JSON.parse(textOf(tokens));
  if (!tokenJson.palette) throw new Error("design tokens missing palette");

  const imported = await callTool("riv_import_svg", {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="8" y="8" width="48" height="48" rx="12" fill="#ffffff"/></svg>`,
    outSpec: svgSpecPath,
    idPrefix: "clean_",
    license: "CC0-1.0",
    attribution: "clean-room fixture",
  });
  if (!textOf(imported).includes("Imported")) throw new Error("SVG import failed");

  const scene = {
    artboard: { name: "CleanRoom", width: 420, height: 280 },
    backgroundColor: tokenJson.palette?.background ?? "#111827",
    imports: [{ spec: svgSpecPath, x: 210, y: 140, scale: 1.8 }],
    shapes: [
      { id: "panel", type: "rect", x: 210, y: 140, width: 260, height: 150, cornerRadius: 28, fill: { gradient: { type: "linear", stops: [
        { color: tokenJson.palette?.primary ?? "#3b82f6" },
        { color: tokenJson.palette?.secondary ?? "#8b5cf6" },
      ] } } },
    ],
    animations: [{ name: "intro", duration: 90, fps: 60, loop: "oneShot", tracks: [], presets: [
      { preset: "pop-in", target: "panel" },
    ] }],
  };

  const created = await callTool("riv_create", { outPath: authoredPath, scene, previewTime: 0.5 });
  const authoredRevision = parseRevision(textOf(created));
  requireFile(authoredPath, 256);
  if (!authoredRevision.provenance?.some((p) => p.license === "CC0-1.0")) throw new Error("authored revision missing provenance");

  const authoredLint = JSON.parse(textOf(await callTool("riv_lint", { assetRef: authoredRevision.assetRef })));
  if (authoredLint.errorCount !== 0) throw new Error("authored lint errors");
  const authoredCritique = parseCritiqueReview(textOf(await callTool("riv_critique", { assetRef: authoredRevision.assetRef, animation: "intro", frames: 5, width: 160 })));
  if (authoredCritique.assetRef !== authoredRevision.assetRef) throw new Error("authored critique bound to wrong revision");
  const finalizedAuthored = JSON.parse(textOf(await callTool("riv_finalize", { assetRef: authoredRevision.assetRef, outPath: finalAuthoredPath })));
  if (!finalizedAuthored.finalized) throw new Error("authored finalize failed");
  requireFile(finalAuthoredPath, 256);

  const dump = JSON.parse(textOf(await callTool("riv_dump", { path: finalAuthoredPath, full: true })));
  const rect = dump.objects.find((o) => o.typeName === "Rectangle");
  if (!rect) throw new Error("no editable Rectangle found");
  const refined = await callTool("riv_edit", {
    assetRef: authoredRevision.assetRef,
    outPath: refinedPath,
    edits: [{ op: "set", index: rect.index, set: { width: 300 } }],
  });
  const refinedRevision = parseRevision(textOf(refined));
  if (refinedRevision.parentRef !== authoredRevision.assetRef) throw new Error("refine lineage broken");

  const blocked = await rpc("tools/call", { name: "riv_finalize", arguments: { assetRef: refinedRevision.assetRef, outPath: finalRefinedPath } });
  if (!blocked.isError || !textOf(blocked).includes("Finalize blocked")) throw new Error("stale parent reviews authorized child");

  const refinedLint = JSON.parse(textOf(await callTool("riv_lint", { assetRef: refinedRevision.assetRef })));
  if (refinedLint.errorCount !== 0) throw new Error("refined lint errors");
  const refinedCritique = parseCritiqueReview(textOf(await callTool("riv_critique", { assetRef: refinedRevision.assetRef, animation: "intro", frames: 5, width: 160 })));
  if (refinedCritique.assetRef !== refinedRevision.assetRef) throw new Error("refined critique bound to wrong revision");
  const finalizedRefined = JSON.parse(textOf(await callTool("riv_finalize", { assetRef: refinedRevision.assetRef, outPath: finalRefinedPath })));
  if (!finalizedRefined.finalized) throw new Error("refined finalize failed");
  requireFile(finalRefinedPath, 256);
  if (!readFileSync(finalRefinedPath).equals(readFileSync(refinedPath))) throw new Error("finalized refined bytes differ from reviewed revision");

  const report = {
    ok: true,
    workspace,
    toolCount: tools.tools.length,
    authoredRevision,
    refinedRevision,
    authoredFinalize: finalizedAuthored,
    refinedFinalize: finalizedRefined,
  };
  const reportText = JSON.stringify(report, null, 2);
  writeFileSync(join(workspace, "clean-room-report.json"), reportText);
  writeFileSync(join(artifactDir, "report.json"), reportText);
  copyFileSync(finalAuthoredPath, join(artifactDir, "authored.final.riv"));
  copyFileSync(finalRefinedPath, join(artifactDir, "refined.final.riv"));
  copyFileSync(svgSpecPath, join(artifactDir, "asset.scene.json"));
  console.log(reportText);
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  child.kill();
}

process.exit(exitCode);
