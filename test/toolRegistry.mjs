import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolRegistry } from "../dist/tools/registry.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexSource = readFileSync(join(root, "src", "index.ts"), "utf8");
assert.equal((indexSource.match(/server\.registerTool\(/g) ?? []).length, 0, "tools must not bypass ToolRegistry");
assert.equal((indexSource.match(/toolRegistry\.register\(/g) ?? []).length, 33, "all 33 tools must use ToolRegistry");

const calls = [];
const fakeServer = {
  registerTool(...args) { calls.push(args); return { ok: true }; },
};
const registry = new ToolRegistry(fakeServer);
const handler = async () => ({ content: [] });
registry.register("riv_list", { title: "List", description: "x", inputSchema: {} }, handler);
assert.equal(registry.count(), 1);
assert.deepEqual(registry.manifest()[0], {
  name: "riv_list", title: "List", description: "x", category: "inspect", stability: "stable",
});
assert.throws(() => registry.register("riv_list", { title: "again" }, handler), /Duplicate tool registration/);
assert.throws(() => registry.register("riv_unknown", { title: "unknown" }, handler), /category missing/);
assert.equal(calls.length, 1, "rejected registrations must not reach McpServer");

console.log("tool registry tests passed");
