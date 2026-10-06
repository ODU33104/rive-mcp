import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRiveRmlNumericBoundaryHints } from "../../dist/fuzz/riveRmlBoundaries.js";
import { actionsForNumericBoundaries } from "../../dist/fuzz/boundaries.js";

const here = dirname(fileURLToPath(import.meta.url));
const inspect = JSON.parse(
  readFileSync(join(here, "../fixtures/explorer/rive-inspect-number-condition.json"), "utf8")
);
const rml = readFileSync(join(here, "../fixtures/explorer/rive-number-conditions.rml"), "utf8");

const hints = extractRiveRmlNumericBoundaryHints(rml, inspect, { source: "fixture.rml" });
assert.deepEqual(
  hints.map(({ path, operator, threshold }) => ({ path, operator, threshold })),
  [
    { path: "score", operator: ">", threshold: 50 },
    { path: "settings/speed", operator: "<=", threshold: 10 },
    { path: "score", operator: ">", threshold: 5 },
    { path: "score", operator: "==", threshold: 7 },
  ]
);
assert.ok(hints.every((hint) => hint.source.startsWith("rive-rml:fixture.rml:")));
assert.equal(
  hints.some((hint) => hint.threshold === 2),
  false,
  "unrelated ScrollConstraint.threshold must not become a state-machine boundary"
);
assert.equal(
  hints.some((hint) => hint.threshold === 100 || hint.threshold === 200 || hint.threshold === 300),
  false,
  "unresolved paths, wrong property keys, and numeric op enums must fail closed"
);

const actions = actionsForNumericBoundaries(hints);
assert.ok(actions.some((action) => action.kind === "data-write" && action.path === "score" && action.value === 50));
assert.ok(actions.some((action) => action.kind === "data-write" && action.path === "settings/speed" && action.value === 10));

const ambiguousInspect = {
  roots: [
    ...inspect.roots,
    { type: "ViewModelPropertyNumber", id: "0:41", name: "differentScore" },
  ],
};
assert.equal(
  extractRiveRmlNumericBoundaryHints(rml, ambiguousInspect).some((hint) => hint.path === "score"),
  false,
  "ambiguous inspect IDs must fail closed"
);

console.log(JSON.stringify({ hints, boundaryActions: actions.length }, null, 2));
