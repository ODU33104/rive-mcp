import type { NumericBoundaryHint } from "./boundaries.js";

type InspectObject = Record<string, unknown>;

const NUMBER_PROPERTY_KEY = "636";

const OPERATOR_BY_NAME: Record<string, NumericBoundaryHint["operator"]> = {
  equal: "==",
  notEqual: "!=",
  lessThanOrEqual: "<=",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  greaterThan: ">",
};

const REVERSED_OPERATOR: Record<NumericBoundaryHint["operator"], NumericBoundaryHint["operator"]> = {
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

function isRecord(value: unknown): value is InspectObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(value: unknown, visit: (node: InspectObject) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
    return;
  }
  if (!isRecord(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

interface InspectNamedNode {
  id: string;
  type: string;
  name?: string;
}

function inspectIdIndex(inspect: unknown): Map<string, InspectNamedNode | null> {
  const index = new Map<string, InspectNamedNode | null>();
  walk(inspect, (node) => {
    if (typeof node.id !== "string" || typeof node.type !== "string") return;
    const entry: InspectNamedNode = {
      id: node.id,
      type: node.type,
      name: typeof node.name === "string" ? node.name : undefined,
    };
    const existing = index.get(entry.id);
    if (existing === undefined) {
      index.set(entry.id, entry);
      return;
    }
    if (existing === null || existing.type !== entry.type || existing.name !== entry.name) index.set(entry.id, null);
  });
  return index;
}

function resolveNumberPath(sourcePathIds: string, index: Map<string, InspectNamedNode | null>): string | undefined {
  const ids = sourcePathIds.split("-").map((part) => part.trim()).filter(Boolean);
  if (ids.length < 2) return undefined;

  const root = index.get(ids[0]);
  if (!root || root.type !== "ViewModel") return undefined;

  const names: string[] = [];
  for (let i = 1; i < ids.length; i++) {
    const node = index.get(ids[i]);
    if (!node || !node.type.startsWith("ViewModelProperty") || !node.name) return undefined;
    if (i === ids.length - 1 && node.type !== "ViewModelPropertyNumber") return undefined;
    names.push(node.name);
  }
  return names.length ? names.join("/") : undefined;
}

function attributes(tagAttributes: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attr = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
  for (const match of tagAttributes.matchAll(attr)) out[match[1]] = match[2];
  return out;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function oneMatch(text: string, expression: RegExp): RegExpMatchArray | undefined {
  const matches = [...text.matchAll(expression)];
  return matches.length === 1 ? matches[0] : undefined;
}

export interface RiveRmlBoundaryOptions {
  source?: string;
  epsilon?: number;
}

/**
 * Extract numeric transition boundaries only when RML structure and rive inspect
 * jointly prove the ViewModel number property, comparator value, and operation.
 *
 * This intentionally does not treat arbitrary numeric fields (for example a
 * ScrollConstraint threshold) as state-machine boundaries.
 */
export function extractRiveRmlNumericBoundaryHints(
  rml: string,
  inspect: unknown,
  options: RiveRmlBoundaryOptions = {}
): NumericBoundaryHint[] {
  const idIndex = inspectIdIndex(inspect);
  const hints: NumericBoundaryHint[] = [];
  const seen = new Set<string>();
  const source = options.source ?? "scene.rml";
  const epsilon = options.epsilon ?? 0.001;

  const condition = /<TransitionViewModelCondition\b([^>]*)>([\s\S]*?)<\/TransitionViewModelCondition>/g;
  for (const match of rml.matchAll(condition)) {
    const attrs = attributes(match[1]);
    const operator = attrs.opValue === undefined ? "==" : OPERATOR_BY_NAME[attrs.opValue];
    if (!operator) continue; // Numeric enum values are rejected rather than guessed.

    const body = match[2];
    const property = oneMatch(
      body,
      /<TransitionPropertyViewModelComparator\b[^>]*>([\s\S]*?)<\/TransitionPropertyViewModelComparator>/g
    );
    const value = oneMatch(body, /<TransitionValueNumberComparator\b([^>]*)\/?\s*>/g);
    if (!property || !value) continue;

    const bindable = oneMatch(
      property[1],
      /<BindablePropertyNumber\b[^>]*>([\s\S]*?)<\/BindablePropertyNumber>/g
    );
    if (!bindable) continue;
    const dataBind = oneMatch(bindable[1], /<DataBindContext\b([^>]*)\/?\s*>/g);
    if (!dataBind) continue;

    const dataAttrs = attributes(dataBind[1]);
    // CLI 1.3 schema: BindablePropertyNumber.propertyValue has property key 636.
    if (dataAttrs.propertyKey !== NUMBER_PROPERTY_KEY || !dataAttrs.sourcePathIds) continue;
    const path = resolveNumberPath(dataAttrs.sourcePathIds, idIndex);
    if (!path) continue;

    const valueAttrs = attributes(value[1]);
    if (valueAttrs.value === undefined || valueAttrs.value.trim() === "") continue;
    const threshold = Number(valueAttrs.value);
    if (!Number.isFinite(threshold)) continue;

    const propertyIndex = body.indexOf(property[0]);
    const valueIndex = body.indexOf(value[0]);
    if (propertyIndex < 0 || valueIndex < 0 || propertyIndex === valueIndex) continue;
    const normalizedOperator = propertyIndex < valueIndex ? operator : REVERSED_OPERATOR[operator];

    const line = lineAt(rml, match.index ?? 0);
    const key = JSON.stringify([path, normalizedOperator, threshold]);
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      path,
      operator: normalizedOperator,
      threshold,
      epsilon,
      source: `rive-rml:${source}:${line};sourcePathIds=${dataAttrs.sourcePathIds}`,
    });
  }

  return hints;
}
