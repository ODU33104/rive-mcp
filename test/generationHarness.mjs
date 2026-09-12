// MCP経由の実生成ハーネス: create -> render -> lint -> critique を一連で実行し、
// 実際の .riv / PNG / JSON レポートを test/tmp/generation-harness に残す。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "test", "tmp", "generation-harness");
mkdirSync(outDir, { recursive: true });

const rivPath = join(outDir, "generated.riv");
const pngPath = join(outDir, "generated.png");
const reportPath = join(outDir, "report.json");
const editedRivPath = join(outDir, "edited.riv");
const editedPngPath = join(outDir, "edited.png");
const finalRivPath = join(outDir, "final.riv");
const importedSpecPath = join(outDir, "fixture.scene.json");

const child = spawn(process.execPath, [join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, RIVE_MCP_REVISION_STORE: join(outDir, "revision-store") },
});

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout: " + method));
      }
    }, 120_000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.isError) throw new Error(name + " failed: " + textOf(res));
  return res;
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

function imageOf(res) {
  return (res.content || []).find((c) => c.type === "image");
}

function requireFile(path, minBytes = 64) {
  if (!existsSync(path)) throw new Error("missing output: " + path);
  const size = statSync(path).size;
  if (size < minBytes) throw new Error("output too small: " + path + " (" + size + " bytes)");
  return size;
}

let exitCode = 0;
try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "generation-harness", version: "0.1.0" },
  });
  if (init.serverInfo?.name !== "rive-mcp") throw new Error("unexpected MCP server: " + init.serverInfo?.name);
  notify("notifications/initialized", {});

  const imported = await callTool("riv_import_svg", {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="16" fill="#ffffff"/></svg>`,
    outSpec: importedSpecPath,
    idPrefix: "fixture_",
    license: "CC0-1.0",
    attribution: "generation harness fixture",
  });
  if (!textOf(imported).includes("Imported")) throw new Error("SVG fixture import failed");

  const scene = {    artboard: { name: "Harness", width: 480, height: 320 },
    backgroundColor: "#101827",
    shapes: [
      { id: "panel", type: "rect", x: 240, y: 160, width: 280, height: 160, cornerRadius: 24,
        fill: { gradient: { type: "linear", stops: [{ color: "#335cff" }, { color: "#7c3aed" }] } } },
      { id: "dot1", type: "ellipse", x: 190, y: 160, width: 34, height: 34, fill: { color: "#ffffff" } },
      { id: "dot2", type: "ellipse", x: 240, y: 160, width: 34, height: 34, fill: { color: "#dbeafe" } },
      { id: "dot3", type: "ellipse", x: 290, y: 160, width: 34, height: 34, fill: { color: "#bfdbfe" } },
    ],
    imports: [{ spec: importedSpecPath, x: 24, y: 24, scale: 0.5 }],
    animations: [{
      name: "intro", duration: 90, fps: 60, loop: "oneShot", tracks: [], presets: [
        { preset: "pop-in", target: "panel" },
        { preset: "rise-in", targets: ["dot1", "dot2", "dot3"], at: 18, stagger: 4 },
      ],
    }],
  };

  const create = await callTool("riv_create", { outPath: rivPath, scene, previewTime: 0.6 });
  const createText = textOf(create);
  const revisionMatch = createText.match(/Revision:\s*(\{[^\n]+\})/);
  if (!revisionMatch) throw new Error("riv_create did not return revision metadata: " + createText);
  const revision = JSON.parse(revisionMatch[1]);
  if (!/^r_[0-9a-f]{32}$/.test(revision.assetRef)) throw new Error("invalid assetRef: " + revision.assetRef);
  if (!revision.provenance?.some((p) => p.kind === "svg" && p.license === "CC0-1.0" && p.attribution === "generation harness fixture")) {
    throw new Error("create revision lost imported SVG provenance: " + JSON.stringify(revision.provenance));
  }
  const rivBytes = requireFile(rivPath, 256);
  const baseBytes = readFileSync(rivPath);
  if (baseBytes.subarray(0, 4).toString("latin1") !== "RIVE") throw new Error("generated file has no RIVE fingerprint");

  const render = await callTool("riv_render_frame", { path: rivPath, animation: "intro", time: 0.7, width: 480, outPath: pngPath });
  const image = imageOf(render);
  if (!image || image.data.length < 1000) throw new Error("render did not return a usable image");
  const pngBytes = requireFile(pngPath, 1000);

  // Revision-aware edit: use the actual binary object index rather than assuming SceneSpec ids
  // survive as editable .riv names. The immutable parent must stay byte-identical.
  const dump = await callTool("riv_dump", { path: rivPath, full: true });
  const dumpJson = JSON.parse(textOf(dump));
  const panelObject = dumpJson.objects.find((o) => o.typeName === "Rectangle");
  if (!panelObject) throw new Error("generated file has no Rectangle object to edit");
  const edit = await callTool("riv_edit", {
    assetRef: revision.assetRef,
    outPath: editedRivPath,
    edits: [{ op: "set", index: panelObject.index, set: { width: 320 } }],
  });
  const editText = textOf(edit);
  const editRevisionMatch = editText.match(/Revision:\s*(\{[^\n]+\})/);
  if (!editRevisionMatch) throw new Error("riv_edit did not return revision metadata: " + editText);
  const editedRevision = JSON.parse(editRevisionMatch[1]);
  if (editedRevision.parentRef !== revision.assetRef) {
    throw new Error("edited revision parent mismatch: " + JSON.stringify(editedRevision));
  }
  if (editedRevision.assetRef === revision.assetRef) throw new Error("edit reused the parent assetRef");
  if (JSON.stringify(editedRevision.provenance) !== JSON.stringify(revision.provenance)) {
    throw new Error("edit did not preserve provenance");
  }
  if (!baseBytes.equals(readFileSync(rivPath))) throw new Error("assetRef edit mutated the original .riv path");
  requireFile(editedRivPath, 256);

  const editedRender = await callTool("riv_render_frame", {
    path: editedRivPath, animation: "intro", time: 0.7, width: 480, outPath: editedPngPath,
  });
  if (!imageOf(editedRender)) throw new Error("edited revision did not render");
  requireFile(editedPngPath, 1000);

  // Parent reviews must not authorize the child revision.
  const blockedFinalize = await rpc("tools/call", {
    name: "riv_finalize",
    arguments: { assetRef: editedRevision.assetRef, outPath: finalRivPath },
  });
  if (!blockedFinalize.isError || !textOf(blockedFinalize).includes("Finalize blocked")) {
    throw new Error("unreviewed child revision was incorrectly finalized");
  }
  if (existsSync(finalRivPath)) throw new Error("blocked finalize wrote an output file");

  const lint = await callTool("riv_lint", { assetRef: revision.assetRef });
  const lintJson = JSON.parse(textOf(lint));
  if (lintJson.errorCount !== 0) throw new Error("lint errors: " + JSON.stringify(lintJson.findings));
  if (!lintJson.review || lintJson.review.assetRef !== revision.assetRef || lintJson.review.rivHash !== revision.rivHash) {
    throw new Error("lint review receipt is not bound to the parent revision: " + JSON.stringify(lintJson.review));
  }
  if (!/^rv_[0-9a-f]{32}$/.test(lintJson.review.reviewRef)) throw new Error("invalid lint reviewRef");

  const critique = await callTool("riv_critique", { assetRef: revision.assetRef, animation: "intro", frames: 6, width: 180 });
  const critiqueText = textOf(critique);
  const critiqueReviewMatch = critiqueText.match(/ReviewReceipt:\s*(\{[^\n]+\})/);
  if (!critiqueReviewMatch) throw new Error("critique did not return a review receipt: " + critiqueText);
  const critiqueReview = JSON.parse(critiqueReviewMatch[1]);
  if (critiqueReview.assetRef !== revision.assetRef || critiqueReview.rivHash !== revision.rivHash) {
    throw new Error("critique review receipt is not bound to the parent revision: " + JSON.stringify(critiqueReview));
  }
  if (critiqueReview.assetRef === editedRevision.assetRef) throw new Error("parent critique receipt leaked to child revision");
  const critiqueImages = (critique.content || []).filter((c) => c.type === "image");
  if (critiqueImages.length < 2) throw new Error("critique did not return filmstrip + onion skin");
  writeFileSync(join(outDir, "critique-filmstrip.png"), Buffer.from(critiqueImages[0].data, "base64"));
  writeFileSync(join(outDir, "critique-onion.png"), Buffer.from(critiqueImages[1].data, "base64"));
  requireFile(join(outDir, "critique-filmstrip.png"), 1000);
  requireFile(join(outDir, "critique-onion.png"), 1000);

  const childLint = await callTool("riv_lint", { assetRef: editedRevision.assetRef });
  const childLintJson = JSON.parse(textOf(childLint));
  if (childLintJson.errorCount !== 0 || childLintJson.review?.assetRef !== editedRevision.assetRef) {
    throw new Error("child lint review invalid: " + textOf(childLint));
  }
  const childCritique = await callTool("riv_critique", {
    assetRef: editedRevision.assetRef, animation: "intro", frames: 6, width: 180,
  });
  const childCritiqueMatch = textOf(childCritique).match(/ReviewReceipt:\s*(\{[^\n]+\})/);
  if (!childCritiqueMatch) throw new Error("child critique review missing");
  const childCritiqueReview = JSON.parse(childCritiqueMatch[1]);
  if (childCritiqueReview.assetRef !== editedRevision.assetRef) throw new Error("child critique bound to wrong revision");

  const finalized = await callTool("riv_finalize", {
    assetRef: editedRevision.assetRef,
    outPath: finalRivPath,
  });
  const finalizeJson = JSON.parse(textOf(finalized));
  if (!finalizeJson.finalized || finalizeJson.assetRef !== editedRevision.assetRef) {
    throw new Error("finalize returned wrong revision: " + textOf(finalized));
  }
  if (!/^fin_[0-9a-f]{32}$/.test(finalizeJson.finalizeRef)) throw new Error("invalid finalizeRef");
  if (JSON.stringify(finalizeJson.provenance) !== JSON.stringify(editedRevision.provenance)) {
    throw new Error("finalize did not report reviewed revision provenance");
  }
  requireFile(finalRivPath, 256);
  if (!readFileSync(finalRivPath).equals(readFileSync(editedRivPath))) {
    throw new Error("finalized bytes differ from reviewed child revision");
  }

  const report = {
    ok: true,
    revision,
    editedRevision,
    outputs: { rivPath, rivBytes, pngPath, pngBytes, editedRivPath, editedPngPath, finalRivPath },
    create: createText,
    lint: lintJson,
    critiqueReview,
    childLint: childLintJson.review,
    childCritiqueReview,
    finalize: finalizeJson,
    critique: critiqueText,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, assetRef: revision.assetRef, rivBytes, pngBytes, reportPath }, null, 2));
} catch (e) {
  exitCode = 1;
  const report = { ok: false, error: e instanceof Error ? e.message : String(e) };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(report.error);
} finally {
  child.kill();
}

process.exit(exitCode);
