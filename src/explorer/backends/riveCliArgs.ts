import type { Action, JsonValue } from "../types.js";

function scalarDataValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Rive CLI data writes require finite numbers");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error("Rive CLI data writes currently support only string, number, and boolean values");
}

function finiteCoordinate(value: number, name: string): string {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return String(value);
}

export function actionToRiveCliArgs(action: Action): string[] {
  switch (action.kind) {
    case "data-write":
      return [`--data=${action.path}=${scalarDataValue(action.value)}`];
    case "pointer": {
      if (action.pointerId !== undefined) throw new Error("Rive CLI pointer actions do not expose pointerId");
      const x = finiteCoordinate(action.x, "pointer x");
      const y = finiteCoordinate(action.y, "pointer y");
      if (action.phase === "drag") {
        if (action.toX === undefined || action.toY === undefined) throw new Error("Rive CLI drag actions require toX and toY");
        const toX = finiteCoordinate(action.toX, "pointer toX");
        const toY = finiteCoordinate(action.toY, "pointer toY");
        if (action.steps !== undefined && (!Number.isInteger(action.steps) || action.steps < 1)) {
          throw new Error("Rive CLI drag steps must be a positive integer");
        }
        const suffix = action.steps === undefined ? "" : `:${action.steps}`;
        return [`--pointer=drag@${x},${y}>${toX},${toY}${suffix}`];
      }
      return [`--pointer=${action.phase}@${x},${y}`];
    }
    case "key": {
      const phase = action.phase && action.phase !== "press" ? `:${action.phase}` : "";
      const modifiers = action.modifiers?.length ? `+${action.modifiers.join("+")}` : "";
      return [`--key=${action.key}${phase}${modifiers}`];
    }
    case "advance-time":
      if (!Number.isFinite(action.seconds) || action.seconds < 0) throw new Error("Rive CLI advance-time requires a finite non-negative duration");
      return [`--advance=${action.seconds}s`];
    case "runtime":
      throw new Error(`Rive CLI adapter does not support runtime surface ${action.surface}/${action.operation}`);
  }
}
