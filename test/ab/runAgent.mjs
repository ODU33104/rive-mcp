import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const briefsDoc = JSON.parse(readFileSync(join(repoRoot, "test", "ab", "briefs.json"), "utf8"));

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((v) => v.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const version = arg("version");
const targetRepo = resolve(arg("repo", repoRoot));
const briefId = arg("brief");
const runIndex = Number(arg("run", "1"));
const model = arg("model", process.env.AB_MODEL || "gpt-5.6-luna");
const outputRoot = resolve(arg("out", join(repoRoot, "test", "tmp", "creative-ab")));
const maxTurns = Number(arg("max-turns", "24"));
const apiKey = process.env.OPENAI_API_KEY;

if (!["baseline", "current"].includes(version)) throw new Error("--version=baseline|current is required");
if (!briefId) throw new Error("--brief=<id> is required");
if (!apiKey) throw new Error("OPENAI_API_KEY is required for live creative A/B runs");

const brief = briefsDoc.briefs.find((b) => b.id === briefId);
if (!brief) throw new Error("Unknown brief: " + briefId);

const runDir = join(outputRoot, brief.id, version, "run-" + runIndex);
mkdirSync(runDir, { recursive: true });
const workspace = join(runDir, "workspace");
mkdirSync(workspace, { recursive: true });
const finalPath = join(workspace, "final.riv");
const tracePath = join(runDir, "trace.jsonl");
const resultPath = join(runDir, "result.json");
const previewPath = join(runDir, "preview.png");
const filmstripPath = join(runDir, "filmstrip.png");

function appendTrace(value) {
  writeFileSync(tracePath, JSON.stringify(value) + "\n", { flag: "a" });
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

function skillText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function buildInstructions() {
  const blocks = [
    "You are performing a controlled Rive authoring benchmark.",
    "Complete the user's brief using only the provided rive-mcp tools.",
    "You must produce the final deliverable at this exact path: " + finalPath,
    "Do not merely describe what should be made. Use tools until a real .riv exists.",
    "Inspect visual critique images when tools return them and revise material defects.",
    "Keep work inside the benchmark workspace. Do not ask the user questions.",
  ];

  if (brief.kind === "refine") {
    blocks.push("The starter file is at: " + join(workspace, "starter.riv"));
    blocks.push("This is a refinement task: preserve unrelated structure.");
  }

  if (version === "baseline") {
    const craft = skillText(join(targetRepo, "skills", "rive-design-guidelines", "SKILL.md"));
    if (craft) blocks.push("\n# Bundled workflow/craft guidance\n" + craft);
  } else {
    const route = brief.kind === "refine" ? "rive-refine" : "rive-author";
    for (const name of [route, "rive-qa", "rive-design-guidelines"]) {
      const body = skillText(join(targetRepo, "skills", name, "SKILL.md"));
      if (body) blocks.push("\n# Skill: " + name + "\n" + body);
    }
  }
  return blocks.join("\n\n");
}

function startMcp() {
  const child = spawn(process.execPath, [join(targetRepo, "dist", "index.js")], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      RIVE_MCP_REVISION_STORE: join(workspace, ".rive-mcp", "revisions"),
    },
  });
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    let idx;
    while ((idx = stdout.indexOf("\n")) >= 0) {
      const line = stdout.slice(0, idx).trim();
      stdout = stdout.slice(idx + 1);
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
        reject(new Error("MCP timeout " + method + "\n" + stderr));
      }, 120000);
      pending.set(id, { resolve: resolvePromise, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  return { child, rpc, notify };
}

async function openaiResponse(body) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("OpenAI API " + response.status + ": " + raw);
  const json = JSON.parse(raw);
  appendTrace({
    type: "model_response",
    responseId: json.id,
    elapsedMs: Date.now() - started,
    usage: json.usage ?? null,
    outputTypes: (json.output || []).map((o) => o.type),
  });
  return json;
}

function functionTools(mcpTools) {
  return mcpTools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description || t.name,
    parameters: t.inputSchema || { type: "object", properties: {} },
    strict: false,
  }));
}

function summarizeToolResult(res) {
  const text = textOf(res);
  return text.length > 50000 ? text.slice(0, 50000) + "\n[truncated]" : text || "(tool returned no text)";
}

function imageInputsFromTool(name, res, turn) {
  const images = (res.content || []).filter((c) => c.type === "image" && c.data && c.mimeType);
  return images.map((img, i) => ({
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: `Visual output from ${name} (turn ${turn}, image ${i + 1}). Inspect it as evidence for the current task.` },
      { type: "input_image", image_url: `data:${img.mimeType};base64,${img.data}`, detail: "auto" },
    ],
  }));
}

function usageAccumulator() {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
  };
  return {
    add(usage) {
      if (!usage) return;
      totals.input_tokens += usage.input_tokens || 0;
      totals.output_tokens += usage.output_tokens || 0;
      totals.total_tokens += usage.total_tokens || 0;
      totals.cached_tokens += usage.input_tokens_details?.cached_tokens || 0;
      totals.reasoning_tokens += usage.output_tokens_details?.reasoning_tokens || 0;
    },
    value() { return { ...totals }; },
  };
}

async function setupStarter(mcp) {
  if (brief.kind !== "refine") return null;
  const starter = {
    artboard: { name: "Starter", width: 420, height: 280 },
    backgroundColor: "#111827",
    shapes: [
      { id: "card", type: "rect", x: 210, y: 140, width: 280, height: 160, cornerRadius: 18, fill: { color: "#334155" } },
      { id: "accent", type: "ellipse", x: 140, y: 140, width: 46, height: 46, fill: { color: "#60a5fa" } },
      { id: "status", type: "rect", x: 245, y: 140, width: 110, height: 18, cornerRadius: 9, fill: { color: "#94a3b8" } },
    ],
    animations: [{
      name: "intro",
      duration: 90,
      fps: 60,
      loop: "oneShot",
      tracks: [
        { target: "card", property: "x", keys: [{ frame: 0, value: 160, easing: "linear" }, { frame: 30, value: 210, easing: "linear" }] },
        { target: "accent", property: "opacity", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }] },
        { target: "status", property: "opacity", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }] },
      ],
    }],
  };
  const res = await mcp.rpc("tools/call", {
    name: "riv_create",
    arguments: { outPath: join(workspace, "starter.riv"), scene: starter, previewTime: 0.5 },
  });
  if (res.isError) throw new Error("starter generation failed: " + textOf(res));
  return join(workspace, "starter.riv");
}

async function postprocess(mcp) {
  if (!existsSync(finalPath)) return { deliverable: false };
  let inspect = null;
  let animation = undefined;
  try {
    const ir = await mcp.rpc("tools/call", { name: "riv_inspect", arguments: { path: finalPath } });
    if (!ir.isError) {
      inspect = JSON.parse(textOf(ir));
      animation = inspect.artboards?.flatMap((a) => a.animations || [])[0]?.name;
    }
  } catch {}

  try {
    const rr = await mcp.rpc("tools/call", {
      name: "riv_render_frame",
      arguments: { path: finalPath, ...(animation ? { animation } : {}), time: 0.6, width: 480, outPath: previewPath },
    });
    if (rr.isError) appendTrace({ type: "postprocess_error", tool: "riv_render_frame", text: textOf(rr) });
  } catch (e) {
    appendTrace({ type: "postprocess_error", tool: "riv_render_frame", error: String(e) });
  }

  try {
    const cr = await mcp.rpc("tools/call", {
      name: "riv_critique",
      arguments: { path: finalPath, ...(animation ? { animation } : {}), frames: 6, width: 180 },
    });
    if (!cr.isError) {
      const image = (cr.content || []).find((x) => x.type === "image" && x.data);
      if (image) writeFileSync(filmstripPath, Buffer.from(image.data, "base64"));
    }
  } catch {}

  let lint = null;
  try {
    const lr = await mcp.rpc("tools/call", { name: "riv_lint", arguments: { path: finalPath } });
    if (!lr.isError) lint = JSON.parse(textOf(lr));
  } catch {}

  return {
    deliverable: true,
    finalBytes: statSync(finalPath).size,
    preview: existsSync(previewPath),
    filmstrip: existsSync(filmstripPath),
    inspect,
    lint,
  };
}

const mcp = startMcp();
const usage = usageAccumulator();
const startedAt = Date.now();
let toolCalls = 0;
let toolErrors = 0;
let turns = 0;
let finalAssistantText = "";
let failure = null;

try {
  const init = await mcp.rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "creative-quality-ab", version: "0.1.0" },
  });
  mcp.notify("notifications/initialized", {});
  const listed = await mcp.rpc("tools/list", {});
  const mcpTools = listed.tools || [];
  const tools = functionTools(mcpTools);
  await setupStarter(mcp);

  const instructions = buildInstructions();
  appendTrace({
    type: "run_start",
    version,
    briefId,
    runIndex,
    model,
    toolCount: mcpTools.length,
    instructionChars: instructions.length,
    brief: brief.brief,
  });

  let response = await openaiResponse({
    model,
    reasoning: { effort: process.env.AB_REASONING_EFFORT || "medium" },
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: brief.brief }] }],
    tools,
    tool_choice: "auto",
  });
  usage.add(response.usage);

  while (turns < maxTurns) {
    turns++;
    const calls = (response.output || []).filter((o) => o.type === "function_call");
    if (!calls.length) {
      finalAssistantText = response.output_text || "";
      break;
    }

    const nextInput = [];
    for (const call of calls) {
      toolCalls++;
      let args;
      try { args = JSON.parse(call.arguments || "{}"); }
      catch {
        args = {};
        toolErrors++;
      }
      appendTrace({ type: "tool_call", turn: turns, name: call.name, callId: call.call_id, args });
      let result;
      const toolStarted = Date.now();
      try {
        result = await mcp.rpc("tools/call", { name: call.name, arguments: args });
      } catch (e) {
        toolErrors++;
        result = { isError: true, content: [{ type: "text", text: String(e) }] };
      }
      if (result.isError) toolErrors++;
      appendTrace({
        type: "tool_result",
        turn: turns,
        name: call.name,
        callId: call.call_id,
        elapsedMs: Date.now() - toolStarted,
        isError: Boolean(result.isError),
        text: summarizeToolResult(result).slice(0, 10000),
        imageCount: (result.content || []).filter((x) => x.type === "image").length,
      });
      nextInput.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: summarizeToolResult(result),
      });
      nextInput.push(...imageInputsFromTool(call.name, result, turns));
    }

    response = await openaiResponse({
      model,
      reasoning: { effort: process.env.AB_REASONING_EFFORT || "medium" },
      instructions,
      previous_response_id: response.id,
      input: nextInput,
      tools,
      tool_choice: "auto",
    });
    usage.add(response.usage);
  }

  if (turns >= maxTurns && !finalAssistantText) {
    failure = "max_turns_exceeded";
  }
} catch (e) {
  failure = e instanceof Error ? (e.stack || e.message) : String(e);
} finally {
  const post = await postprocess(mcp).catch((e) => ({ deliverable: false, postprocessError: String(e) }));
  mcp.child.kill();

  const result = {
    version,
    briefId,
    kind: brief.kind,
    runIndex,
    model,
    reasoningEffort: process.env.AB_REASONING_EFFORT || "medium",
    elapsedMs: Date.now() - startedAt,
    turns,
    toolCalls,
    toolErrors,
    usage: usage.value(),
    finalAssistantText,
    failure,
    post,
    finalPath,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failure || !post.deliverable) process.exitCode = 1;
}
