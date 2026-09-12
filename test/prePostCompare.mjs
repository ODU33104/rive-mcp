import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const baselineDir = resolve(process.argv[2]);
const currentDir = resolve(process.argv[3]);
const outDir = join(scriptRoot, "test", "tmp", "pre-post-comparison");
mkdirSync(outDir, { recursive: true });

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const pct = (oldValue, newValue) => oldValue === 0 ? null : ((newValue - oldValue) / oldValue) * 100;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function dirSize(root) {
  let total = 0;
  const walk = (p) => {
    for (const ent of readdirSync(p, { withFileTypes: true })) {
      const fp = join(p, ent.name);
      if (ent.isDirectory()) walk(fp);
      else total += statSync(fp).size;
    }
  };
  if (existsSync(root)) walk(root);
  return total;
}

function countSkills(repoDir) {
  const p = join(repoDir, "skills");
  if (!existsSync(p)) return 0;
  return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(p, e.name, "SKILL.md"))).length;
}

function findSchemaIssues(tools) {
  const issues = [];
  for (const tool of tools) {
    const stack = [tool.inputSchema ?? {}];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if ("$ref" in node) issues.push(tool.name + ":$ref");
      if (Array.isArray(node.items)) issues.push(tool.name + ":tuple-items");
      for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return issues;
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}
function imageOf(res) {
  return (res.content || []).find((c) => c.type === "image");
}
function parseRevision(text) {
  const m = text.match(/Revision:\s*(\{[^\n]+\})/);
  return m ? JSON.parse(m[1]) : null;
}
function parseCritiqueReview(text) {
  const m = text.match(/ReviewReceipt:\s*(\{[^\n]+\})/);
  return m ? JSON.parse(m[1]) : null;
}

async function runVersion(label, repoDir) {
  const workspace = mkdtempSync(join(tmpdir(), `rive-mcp-${label}-`));
  const revisionStore = join(workspace, ".rive-mcp", "revisions");
  const child = spawn(process.execPath, [join(repoDir, "dist", "index.js")], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RIVE_MCP_REVISION_STORE: revisionStore },
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
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
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
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
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${label} timeout: ${method}\n${stderr}`));
      }, 120000);
      pending.set(id, { resolve: resolvePromise, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async function call(name, args, allowError = false) {
    const start = process.hrtime.bigint();
    const res = await rpc("tools/call", { name, arguments: args });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (res.isError && !allowError) throw new Error(`${label} ${name}: ${textOf(res)}`);
    return { res, ms };
  }

  try {
    const initStart = process.hrtime.bigint();
    const init = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "pre-post-comparison", version: "0.1.0" },
    });
    const initializeMs = Number(process.hrtime.bigint() - initStart) / 1e6;
    notify("notifications/initialized", {});

    const listed = await rpc("tools/list", {});
    const tools = listed.tools ?? [];
    const names = new Set(tools.map((t) => t.name));
    const descriptionChars = tools.reduce((n, t) => n + (t.description ?? "").length, 0);
    const schemaChars = tools.reduce((n, t) => n + JSON.stringify(t.inputSchema ?? {}).length, 0);
    const maxDescription = tools.reduce((best, t) => {
      const chars = (t.description ?? "").length;
      return chars > best.chars ? { name: t.name, chars } : best;
    }, { name: "", chars: 0 });
    const schemaIssues = findSchemaIssues(tools);

    const scene = {
      artboard: { name: "Compare", width: 420, height: 280 },
      backgroundColor: "#101827",
      shapes: [
        { id: "panel", type: "rect", x: 210, y: 140, width: 260, height: 150, cornerRadius: 28,
          fill: { gradient: { type: "linear", stops: [{ color: "#335cff" }, { color: "#7c3aed" }] } } },
        { id: "dot", type: "ellipse", x: 210, y: 140, width: 40, height: 40, fill: { color: "#ffffff" } },
      ],
      animations: [{
        name: "intro", duration: 90, fps: 60, loop: "oneShot", tracks: [], presets: [
          { preset: "pop-in", target: "panel" },
          { preset: "rise-in", target: "dot", at: 18 },
        ],
      }],
    };

    const createTimes = [];
    let createText = "";
    let rivPath = "";
    for (let i = 0; i < 3; i++) {
      const p = join(workspace, `common-${i}.riv`);
      const { res, ms } = await call("riv_create", { outPath: p, scene, previewTime: 0.5 });
      createTimes.push(ms);
      if (i === 0) {
        createText = textOf(res);
        rivPath = p;
      }
    }
    const revision = parseRevision(createText);
    const rivBytes = statSync(rivPath).size;

    const renderTimes = [];
    const lintTimes = [];
    const critiqueTimes = [];
    let pngBytes = 0;
    let lintSummary = null;
    let critiqueImages = 0;
    for (let i = 0; i < 3; i++) {
      const png = join(workspace, `common-${i}.png`);
      const rr = await call("riv_render_frame", { path: rivPath, animation: "intro", time: 0.6, width: 420, outPath: png });
      renderTimes.push(rr.ms);
      if (i === 0) pngBytes = statSync(png).size;

      const lr = await call("riv_lint", { path: rivPath });
      lintTimes.push(lr.ms);
      if (i === 0) {
        try { lintSummary = JSON.parse(textOf(lr.res)); } catch {}
      }

      const cr = await call("riv_critique", { path: rivPath, animation: "intro", frames: 5, width: 160 });
      critiqueTimes.push(cr.ms);
      if (i === 0) critiqueImages = (cr.res.content || []).filter((x) => x.type === "image").length;
    }

    const capabilities = {
      immutableAssetRef: Boolean(revision?.assetRef),
      finalizeTool: names.has("riv_finalize"),
      toolRegistrySource: existsSync(join(repoDir, "src", "tools", "registry.ts")),
      provenanceSchema: false,
      workflowSkills: countSkills(repoDir),
      cleanRoomGateScript: existsSync(join(repoDir, "test", "cleanRoom.mjs")),
    };
    const createTool = tools.find((t) => t.name === "riv_create");
    capabilities.provenanceSchema = Boolean(createTool?.inputSchema?.properties?.provenance);

    const safety = {
      revisionLineage: "unsupported",
      staleReviewRejected: "unsupported",
      exactRevisionFinalize: "unsupported",
      provenanceSurvivesEdit: "unsupported",
    };

    if (revision?.assetRef && names.has("riv_finalize")) {
      const dump = await call("riv_dump", { path: rivPath, full: true });
      const dumpJson = JSON.parse(textOf(dump.res));
      const rect = dumpJson.objects.find((o) => o.typeName === "Rectangle");
      if (!rect) throw new Error(label + " no Rectangle for safety probe");

      const parentLint = await call("riv_lint", { assetRef: revision.assetRef });
      const parentLintJson = JSON.parse(textOf(parentLint.res));
      const parentCrit = await call("riv_critique", { assetRef: revision.assetRef, animation: "intro", frames: 5, width: 160 });
      if (parentLintJson.errorCount !== 0 || !parseCritiqueReview(textOf(parentCrit.res))) {
        throw new Error(label + " parent review probe failed");
      }

      const editedPath = join(workspace, "child.riv");
      const edit = await call("riv_edit", {
        assetRef: revision.assetRef,
        outPath: editedPath,
        edits: [{ op: "set", index: rect.index, set: { width: 300 } }],
      });
      const childRevision = parseRevision(textOf(edit.res));
      safety.revisionLineage = childRevision?.parentRef === revision.assetRef ? "pass" : "fail";

      const blocked = await call("riv_finalize", { assetRef: childRevision.assetRef, outPath: join(workspace, "blocked.riv") }, true);
      safety.staleReviewRejected = blocked.res.isError && textOf(blocked.res).includes("Finalize blocked") ? "pass" : "fail";

      await call("riv_lint", { assetRef: childRevision.assetRef });
      await call("riv_critique", { assetRef: childRevision.assetRef, animation: "intro", frames: 5, width: 160 });
      const finalPath = join(workspace, "child.final.riv");
      const finalized = await call("riv_finalize", { assetRef: childRevision.assetRef, outPath: finalPath });
      const finalJson = JSON.parse(textOf(finalized.res));
      safety.exactRevisionFinalize =
        finalJson.finalized &&
        readFileSync(finalPath).equals(readFileSync(editedPath))
          ? "pass" : "fail";
      safety.provenanceSurvivesEdit =
        JSON.stringify(childRevision.provenance ?? []) === JSON.stringify(revision.provenance ?? [])
          ? "pass" : "fail";
    }

    let provenanceProbe = "unsupported";
    if (capabilities.provenanceSchema) {
      const specPath = join(workspace, "prov.scene.json");
      await call("riv_import_svg", {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="#fff"/></svg>',
        outSpec: specPath,
        license: "CC0-1.0",
        attribution: "comparison fixture",
      });
      const provScene = {
        artboard: { name: "Prov", width: 100, height: 100 },
        imports: [{ spec: specPath, x: 50, y: 50 }],
      };
      const prov = await call("riv_create", { outPath: join(workspace, "prov.riv"), scene: provScene });
      const provRevision = parseRevision(textOf(prov.res));
      provenanceProbe = provRevision?.provenance?.some((p) => p.license === "CC0-1.0" && p.attribution === "comparison fixture")
        ? "pass" : "fail";
    }

    return {
      label,
      commit: init.serverInfo?.version ?? null,
      toolSurface: {
        toolCount: tools.length,
        descriptionChars,
        schemaChars,
        maxDescription,
        strictSchemaIssueCount: schemaIssues.length,
        strictSchemaIssues: schemaIssues,
      },
      artifacts: {
        distBytes: dirSize(join(repoDir, "dist")),
        rivBytes,
        rivSha256: sha256File(rivPath),
        pngBytes,
        pngSha256: sha256File(join(workspace, "common-0.png")),
      },
      latencyMsMedian: {
        initialize: initializeMs,
        create: median(createTimes),
        renderFrame: median(renderTimes),
        lint: median(lintTimes),
        critique: median(critiqueTimes),
      },
      qualitySignals: {
        lintErrors: lintSummary?.errorCount ?? null,
        lintWarnings: lintSummary?.warningCount ?? null,
        lintInfo: lintSummary?.infoCount ?? null,
        critiqueImages,
      },
      capabilities,
      safety,
      provenanceProbe,
      revisionSample: revision,
      workspace,
    };
  } finally {
    child.kill();
  }
}

function markdown(report) {
  const b = report.baseline;
  const c = report.current;
  const row = (name, before, after, delta = "") => `| ${name} | ${before} | ${after} | ${delta} |\n`;
  let md = "# Pre/Post implementation measurement\n\n";
  md += `Baseline: \`${report.refs.baseline}\`  \nCurrent: \`${report.refs.current}\`\n\n`;
  md += "## Quantitative deltas\n\n| Metric | Before | After | Delta |\n|---|---:|---:|---:|\n";
  md += row("Tool count", b.toolSurface.toolCount, c.toolSurface.toolCount, c.toolSurface.toolCount - b.toolSurface.toolCount);
  md += row("Tool description chars", b.toolSurface.descriptionChars, c.toolSurface.descriptionChars, `${pct(b.toolSurface.descriptionChars,c.toolSurface.descriptionChars).toFixed(1)}%`);
  md += row("Input-schema chars", b.toolSurface.schemaChars, c.toolSurface.schemaChars, `${pct(b.toolSurface.schemaChars,c.toolSurface.schemaChars).toFixed(1)}%`);
  md += row("Largest tool description", b.toolSurface.maxDescription.chars, c.toolSurface.maxDescription.chars, `${pct(b.toolSurface.maxDescription.chars,c.toolSurface.maxDescription.chars).toFixed(1)}%`);
  md += row("Strict schema issues", b.toolSurface.strictSchemaIssueCount, c.toolSurface.strictSchemaIssueCount, c.toolSurface.strictSchemaIssueCount - b.toolSurface.strictSchemaIssueCount);
  md += row("dist bytes", b.artifacts.distBytes, c.artifacts.distBytes, `${pct(b.artifacts.distBytes,c.artifacts.distBytes).toFixed(1)}%`);
  md += row("Generated .riv bytes", b.artifacts.rivBytes, c.artifacts.rivBytes, `${pct(b.artifacts.rivBytes,c.artifacts.rivBytes).toFixed(1)}%`);
  md += row("Rendered PNG bytes", b.artifacts.pngBytes, c.artifacts.pngBytes, `${pct(b.artifacts.pngBytes,c.artifacts.pngBytes).toFixed(1)}%`);
  md += row("Generated .riv SHA-256 equal", b.artifacts.rivSha256.slice(0,12), c.artifacts.rivSha256.slice(0,12), b.artifacts.rivSha256 === c.artifacts.rivSha256 ? "YES" : "NO");
  md += row("Rendered PNG SHA-256 equal", b.artifacts.pngSha256.slice(0,12), c.artifacts.pngSha256.slice(0,12), b.artifacts.pngSha256 === c.artifacts.pngSha256 ? "YES" : "NO");
  for (const k of ["create","renderFrame","lint","critique"]) {
    md += row(`${k} median ms`, b.latencyMsMedian[k].toFixed(1), c.latencyMsMedian[k].toFixed(1), `${pct(b.latencyMsMedian[k],c.latencyMsMedian[k]).toFixed(1)}%`);
  }
  md += "\n## Capability / safety deltas\n\n| Check | Before | After |\n|---|---|---|\n";
  const capChecks = [
    ["Immutable assetRef", b.capabilities.immutableAssetRef, c.capabilities.immutableAssetRef],
    ["riv_finalize", b.capabilities.finalizeTool, c.capabilities.finalizeTool],
    ["Workflow skill count", b.capabilities.workflowSkills, c.capabilities.workflowSkills],
    ["Provenance input schema", b.capabilities.provenanceSchema, c.capabilities.provenanceSchema],
    ["Clean-room release gate", b.capabilities.cleanRoomGateScript, c.capabilities.cleanRoomGateScript],
    ["Revision lineage", b.safety.revisionLineage, c.safety.revisionLineage],
    ["Stale review rejected", b.safety.staleReviewRejected, c.safety.staleReviewRejected],
    ["Exact reviewed bytes finalized", b.safety.exactRevisionFinalize, c.safety.exactRevisionFinalize],
    ["Provenance survives edit", b.safety.provenanceSurvivesEdit, c.safety.provenanceSurvivesEdit],
    ["Explicit provenance probe", b.provenanceProbe, c.provenanceProbe],
  ];
  for (const [name,bv,cv] of capChecks) md += `| ${name} | ${bv} | ${cv} |\n`;
  md += "\n## Common quality signals\n\n";
  md += `Both versions generated and rendered the same comparison scene. Before lint errors=${b.qualitySignals.lintErrors}, after lint errors=${c.qualitySignals.lintErrors}; critique images before=${b.qualitySignals.critiqueImages}, after=${c.qualitySignals.critiqueImages}.\n`;
  return md;
}

const refs = {
  baseline: process.env.BASELINE_SHA || "d44adbbe224e38aacf2caad43c32dc482fc23bf8",
  current: process.env.CURRENT_SHA || "dec889c9df42009930da9c6cadd6bbfe525caea2",
};

const baseline = await runVersion("baseline", baselineDir);
const current = await runVersion("current", currentDir);
const report = { generatedAt: new Date().toISOString(), refs, baseline, current };
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "report.md"), markdown(report));
console.log(markdown(report));
