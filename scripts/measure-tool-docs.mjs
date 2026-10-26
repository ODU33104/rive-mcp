#!/usr/bin/env node
// Measures the MCP tool documentation the server exposes to clients:
// per-tool description length (characters), and how many input arguments lack a description.
// Starts dist/index.js over stdio and reads tools/list, so it measures what a client actually receives.
// Usage: npm run build && node scripts/measure-tool-docs.mjs [--json] [--long=500]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const longArg = args.find((a) => a.startsWith("--long="));
const longThreshold = longArg ? Number(longArg.slice("--long=".length)) : 500;

// Collect property schemas (top level and nested) that have no description.
// Nested = properties inside items / object members of a property, which a client also sees.
function missingDescriptions(schema) {
  const top = [];
  const nested = [];
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  for (const [name, prop] of Object.entries(props)) {
    if (!prop.description) top.push({ name, required: required.has(name) });
    walkNested(prop, name, nested);
  }
  return { top, nested };
}

function walkNested(node, path, out) {
  if (!node || typeof node !== "object") return;
  const children = [];
  if (node.items) children.push(["items", node.items]);
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) children.push([k, v]);
  }
  for (const [k, child] of children) {
    const childPath = `${path}.${k}`;
    if (child && typeof child === "object" && !child.description && k !== "items") {
      // A leaf without description (skip the bare "items" wrapper itself)
      if (!child.properties && !child.items) out.push(childPath);
    }
    walkNested(child, childPath, out);
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  stderr: "ignore",
});
const client = new Client({ name: "measure-tool-docs", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const rows = tools.map((t) => {
  const desc = t.description ?? "";
  const miss = missingDescriptions(t.inputSchema);
  return {
    name: t.name,
    descChars: [...desc].length,
    argCount: Object.keys(t.inputSchema?.properties ?? {}).length,
    missingTop: miss.top.map((m) => m.name),
    missingNested: miss.nested,
  };
});

const totals = {
  tools: rows.length,
  descChars: rows.reduce((s, r) => s + r.descChars, 0),
  descOver: rows.filter((r) => r.descChars > longThreshold).length,
  argsTotal: rows.reduce((s, r) => s + r.argCount, 0),
  missingTop: rows.reduce((s, r) => s + r.missingTop.length, 0),
  missingNested: rows.reduce((s, r) => s + r.missingNested.length, 0),
  longThreshold,
};

if (asJson) {
  process.stdout.write(JSON.stringify({ totals, rows }, null, 2) + "\n");
} else {
  const pad = (s, n) => String(s).padEnd(n);
  process.stdout.write(`${pad("tool", 26)}${pad("desc", 8)}${pad("args", 6)}missing(top)\n`);
  for (const r of [...rows].sort((a, b) => b.descChars - a.descChars)) {
    process.stdout.write(
      `${pad(r.name, 26)}${pad(r.descChars, 8)}${pad(r.argCount, 6)}${r.missingTop.join(",") || "-"}\n`,
    );
  }
  process.stdout.write(
    `\ntools=${totals.tools} descChars(total)=${totals.descChars} descOver${longThreshold}=${totals.descOver} ` +
      `args=${totals.argsTotal} missingDescribe(top)=${totals.missingTop} missingDescribe(nested)=${totals.missingNested}\n`,
  );
}
