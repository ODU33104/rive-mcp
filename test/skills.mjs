import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillNames = ["rive-author","rive-refine","rive-qa","rive-setup","rive-design-guidelines"];
for (const name of skillNames) {
  const p = join(root, "skills", name, "SKILL.md");
  assert.ok(existsSync(p), "missing skill: " + name);
  const body = readFileSync(p, "utf8");
  assert.match(body, new RegExp(`^---[\\s\\S]*name: ${name}[\\s\\S]*---`, "m"), "bad frontmatter: " + name);
}

const author = readFileSync(join(root,"skills","rive-author","SKILL.md"),"utf8");
assert.match(author,/riv_finalize/);
assert.match(author,/rive-design-guidelines/);

const refine = readFileSync(join(root,"skills","rive-refine","SKILL.md"),"utf8");
assert.match(refine,/smallest viable|smallest affected/i);
assert.match(refine,/Parent review receipts do not authorize child revisions/);

const qa = readFileSync(join(root,"skills","rive-qa","SKILL.md"),"utf8");
assert.match(qa,/assetRef\/rivHash/);
assert.match(qa,/riv_finalize/);

const agent = readFileSync(join(root,"plugin","agents","rive-designer.md"),"utf8");
for (const name of ["rive-author","rive-refine","rive-qa","rive-setup","rive-design-guidelines"]) {
  assert.ok(agent.includes("`"+name+"`"), "agent does not route/reference " + name);
}

const index = readFileSync(join(root,"src","index.ts"),"utf8");
assert.ok(index.includes("copies all bundled Rive skills"), "riv_setup description is not skill-suite aware");

console.log("skill workflow tests passed");
