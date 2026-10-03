function clone(value) { return structuredClone(value); }

function stateOf(observation) { return observation.activeStates?.[0]; }

function matchRule(rule, action, observation) {
  const m = rule.match;
  if (m.kind !== action.kind) return false;
  if (m.path !== undefined && m.path !== action.path) return false;
  if (m.phase !== undefined && m.phase !== action.phase) return false;
  if (m.state !== undefined && m.state !== stateOf(observation)) return false;
  if (m.valueOp) {
    if (typeof action.value !== "number") return false;
    const t = m.threshold;
    if (m.valueOp === "lt" && !(action.value < t)) return false;
    if (m.valueOp === "eq" && !(action.value === t)) return false;
    if (m.valueOp === "gt" && !(action.value > t)) return false;
  }
  return true;
}

function materialize(value, action) {
  if (value === "$action.value") return action.value;
  if (Array.isArray(value)) return value.map((v) => materialize(v, action));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, materialize(v, action)]));
  return value;
}

export class FixtureBackend {
  name = "explorer-fixture";
  constructor(fixture) { this.fixture = fixture; }
  async execute(sequence) {
    let observation = clone(this.fixture.initial);
    const steps = [];
    for (const action of sequence) {
      const before = observation;
      observation = clone(observation);
      const rule = this.fixture.rules.find((r) => matchRule(r, action, before));
      if (rule) {
        const patch = materialize(rule.patch, action);
        if (patch.activeStates) observation.activeStates = patch.activeStates;
        if (patch.viewModel) observation.viewModel = { ...(observation.viewModel ?? {}), ...patch.viewModel };
      }
      steps.push({ action: clone(action), observation: clone(observation), cost: 1 });
    }
    return { initial: clone(this.fixture.initial), steps, backend: { name: this.name, version: "1" }, cost: sequence.length };
  }
}
