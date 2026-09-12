import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(root, "dist", "index.js")], { stdio: ["pipe", "pipe", "inherit"] });
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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout: " + method));
      }
    }, 120000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
try {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "tool-surface-budget", version: "0.1.0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  const res = await rpc("tools/list", {});
  const rows = res.tools.map((t) => ({
    name: t.name,
    descriptionChars: (t.description ?? "").length,
    schemaChars: JSON.stringify(t.inputSchema ?? {}).length,
  })).sort((a,b)=>b.descriptionChars-a.descriptionChars);
  const totalDescriptionChars = rows.reduce((n,r)=>n+r.descriptionChars,0);
  const totalSchemaChars = rows.reduce((n,r)=>n+r.schemaChars,0);
  const createRow = rows.find((r) => r.name === "riv_create");
  if (rows.length !== 33) throw new Error("unexpected tool count: " + rows.length);
  if (!createRow || createRow.descriptionChars > 900) {
    throw new Error("riv_create description budget exceeded: " + (createRow?.descriptionChars ?? "missing"));
  }
  if (totalDescriptionChars > 16000) {
    throw new Error("total tool description budget exceeded: " + totalDescriptionChars);
  }
  console.log(JSON.stringify({ toolCount: rows.length, totalDescriptionChars, totalSchemaChars, rows }, null, 2));
} finally {
  child.kill();
}
