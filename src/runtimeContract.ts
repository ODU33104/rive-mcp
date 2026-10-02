import { decodeDataBinding, type DataBindingResult } from "./dataBinding.js";
import { loadDefs, readRiv, type RivDump, type RivObject } from "./rivBinary.js";
import type { InspectResult } from "./riveHost.js";

export type ContractSeverity = "breaking" | "behavior" | "nonBreaking";

export interface RuntimeContractInput {
  name: string;
  type: string;
  defaultValue: boolean | number | null;
}

export interface RuntimeContractStateMachine {
  name: string;
  inputs: RuntimeContractInput[];
}

export interface RuntimeContractAnimation {
  name: string;
  durationFrames: number;
  fps: number;
  speed: number;
  loop: string;
}

export interface RuntimeContractEvent {
  name: string;
  kind: string;
}

export interface RuntimeContractArtboard {
  name: string;
  width: number;
  height: number;
  animations: RuntimeContractAnimation[];
  stateMachines: RuntimeContractStateMachine[];
  events: RuntimeContractEvent[];
}

export interface RuntimeContractEnumValue {
  key: string;
  value: string;
}

export interface RuntimeContractViewModelProperty {
  name: string;
  kind: string;
  typeName: string;
  enumValues?: RuntimeContractEnumValue[];
  referencedViewModel?: string;
}

export interface RuntimeContractInstanceValue {
  name: string;
  kind: string;
  value: unknown;
}

export interface RuntimeContractViewModelInstance {
  name: string;
  values: RuntimeContractInstanceValue[];
}

export interface RuntimeContractViewModel {
  name: string;
  viewModelType?: number;
  properties: RuntimeContractViewModelProperty[];
  instances: RuntimeContractViewModelInstance[];
}

export interface RuntimeContractBinding {
  name: string;
  targetType: string;
  targetName: string;
  targetProperty?: string;
  direction: "toSource" | "toTarget";
  twoWay: boolean;
  once: boolean;
  sourceToTargetRunsFirst: boolean;
  nameBased: boolean;
  converterName?: string;
  converterType?: string;
  sourcePathIds?: number[];
}

export interface RuntimeContract {
  schemaVersion: 1;
  artboards: RuntimeContractArtboard[];
  viewModels: RuntimeContractViewModel[];
  bindings: RuntimeContractBinding[];
  warnings: string[];
}

export type ContractChangeKind =
  | "added"
  | "removed"
  | "typeChanged"
  | "defaultChanged"
  | "dimensionChanged"
  | "animationChanged"
  | "eventKindChanged"
  | "viewModelTypeChanged"
  | "referenceChanged"
  | "enumValueAdded"
  | "enumValueRemoved"
  | "enumValueChanged"
  | "instanceDefaultChanged"
  | "bindingAdded"
  | "bindingRemoved"
  | "bindingChanged";

export interface RuntimeContractChange {
  severity: ContractSeverity;
  kind: ContractChangeKind;
  path: string;
  message: string;
  before?: unknown;
  after?: unknown;
}

export interface RuntimeContractDiff {
  breaking: RuntimeContractChange[];
  behavior: RuntimeContractChange[];
  nonBreaking: RuntimeContractChange[];
  changes: RuntimeContractChange[];
  summary: {
    breaking: number;
    behavior: number;
    nonBreaking: number;
    total: number;
  };
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name) || JSON.stringify(a).localeCompare(JSON.stringify(b));

const escapePath = (value: string): string => value.replace(/~/g, "~0").replace(/\//g, "~1");

function warnDuplicateNames<T extends { name: string }>(
  scope: string,
  values: T[],
  warnings: string[]
): void {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value.name, (counts.get(value.name) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (count > 1) warnings.push(`${scope}: duplicate public name "${name}" appears ${count} times`);
  }
}

function derivesFrom(typeName: string, baseName: string): boolean {
  if (typeName === baseName) return true;
  const defs = loadDefs();
  if (!defs) return false;

  const fileToName = new Map<string, string>();
  for (const [name, def] of Object.entries(defs.types)) fileToName.set(def.file, name);

  let current = typeName;
  for (let guard = 0; guard < 20; guard++) {
    const parentFile = defs.types[current]?.extends;
    if (!parentFile) return false;
    const parentName = fileToName.get(parentFile);
    if (!parentName) return false;
    if (parentName === baseName) return true;
    current = parentName;
  }
  return false;
}

function publicEventsByArtboard(dump: RivDump, warnings: string[]): RuntimeContractEvent[][] {
  const starts: number[] = [];
  dump.objects.forEach((obj, index) => {
    if (obj.typeName === "Artboard") starts.push(index);
  });

  return starts.map((start, artboardIndex) => {
    const end = starts[artboardIndex + 1] ?? dump.objects.length;
    const events: RuntimeContractEvent[] = [];
    for (let i = start + 1; i < end; i++) {
      const obj: RivObject = dump.objects[i];
      if (!derivesFrom(obj.typeName, "Event")) continue;
      const name = typeof obj.properties.name === "string" ? obj.properties.name : "";
      if (!name) {
        warnings.push(`artboard[${artboardIndex}]: unnamed ${obj.typeName} omitted from public contract`);
        continue;
      }
      events.push({ name, kind: obj.typeName });
    }
    warnDuplicateNames(`artboard[${artboardIndex}].events`, events, warnings);
    return events.sort(byName);
  });
}

function normalizeInstanceValue(
  dataBinding: DataBindingResult,
  value: DataBindingResult["viewModelInstances"][number]["values"][number]
): unknown {
  if (value.enum) {
    return { enumKey: value.enum.key, enumValue: value.enum.value };
  }
  if (value.referenceInstance) {
    return {
      viewModel:
        dataBinding.viewModels[value.referenceInstance.viewModelIndex]?.name ??
        `<missing-view-model:${value.referenceInstance.viewModelIndex}>`,
      instance: value.referenceInstance.name,
    };
  }
  if (value.listItems) {
    return value.listItems.map((item) => ({
      name: item.name,
      viewModel:
        dataBinding.viewModels[item.viewModelIndex]?.name ??
        `<missing-view-model:${item.viewModelIndex}>`,
      instance: item.instanceName ?? `<missing-instance:${item.localInstanceIndex}>`,
    }));
  }
  return value.value ?? null;
}

export function buildRuntimeContract(
  inspect: InspectResult,
  dump: RivDump,
  dataBinding: DataBindingResult | null = decodeDataBinding(dump)
): RuntimeContract {
  const warnings: string[] = [];
  const eventsByArtboard = publicEventsByArtboard(dump, warnings);

  const artboards: RuntimeContractArtboard[] = inspect.artboards.map((artboard, index) => {
    const animations = artboard.animations
      .map((animation) => ({
        name: animation.name,
        durationFrames: animation.durationFrames,
        fps: animation.fps,
        speed: animation.speed,
        loop: animation.loop,
      }))
      .sort(byName);

    const stateMachines = artboard.stateMachines
      .map((machine) => ({
        name: machine.name,
        inputs: machine.inputs
          .map((input) => ({
            name: input.name,
            type: input.type,
            defaultValue: input.value,
          }))
          .sort(byName),
      }))
      .sort(byName);

    warnDuplicateNames(`artboard/${artboard.name}.animations`, animations, warnings);
    warnDuplicateNames(`artboard/${artboard.name}.stateMachines`, stateMachines, warnings);
    for (const machine of stateMachines) {
      warnDuplicateNames(
        `artboard/${artboard.name}/stateMachine/${machine.name}.inputs`,
        machine.inputs,
        warnings
      );
    }

    return {
      name: artboard.name,
      width: artboard.width,
      height: artboard.height,
      animations,
      stateMachines,
      events: eventsByArtboard[index] ?? [],
    };
  });

  warnDuplicateNames("artboards", artboards, warnings);

  const viewModels: RuntimeContractViewModel[] = (dataBinding?.viewModels ?? [])
    .map((viewModel) => {
      const instances: RuntimeContractViewModelInstance[] = (dataBinding?.viewModelInstances ?? [])
        .filter((instance) => instance.viewModelIndex === viewModel.index && Boolean(instance.name))
        .map((instance) => ({
          name: instance.name,
          values: instance.values
            .filter((value) => Boolean(value.propertyName))
            .map((value) => ({
              name: value.propertyName!,
              kind: value.kind,
              value: dataBinding ? normalizeInstanceValue(dataBinding, value) : value.value ?? null,
            }))
            .sort(byName),
        }))
        .sort(byName);

      for (const instance of instances) {
        warnDuplicateNames(
          `viewModel/${viewModel.name}/instance/${instance.name}.values`,
          instance.values,
          warnings
        );
      }

      const properties: RuntimeContractViewModelProperty[] = viewModel.properties
        .map((property) => {
          const result: RuntimeContractViewModelProperty = {
            name: property.name,
            kind: property.kind,
            typeName: property.typeName,
          };

          if (
            property.enumIndex != null &&
            property.typeName === "ViewModelPropertyEnumCustom"
          ) {
            const enumeration = dataBinding?.enums[property.enumIndex];
            if (enumeration) {
              result.enumValues = enumeration.values
                .map((value) => ({ key: value.key, value: value.value }))
                .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));
            }
          }

          if (property.viewModelReferenceIndex != null) {
            result.referencedViewModel =
              dataBinding?.viewModels[property.viewModelReferenceIndex]?.name ??
              `<missing-view-model:${property.viewModelReferenceIndex}>`;
          }

          return result;
        })
        .sort(byName);

      warnDuplicateNames(`viewModel/${viewModel.name}.properties`, properties, warnings);
      warnDuplicateNames(`viewModel/${viewModel.name}.instances`, instances, warnings);

      return {
        name: viewModel.name,
        viewModelType: viewModel.viewModelType,
        properties,
        instances,
      };
    })
    .sort(byName);

  warnDuplicateNames("viewModels", viewModels, warnings);

  const bindings: RuntimeContractBinding[] = [];
  for (const binding of dataBinding?.dataBinds ?? []) {
    const targetName = binding.target?.name;
    const targetType = binding.target?.typeName;
    if (!targetName || !targetType) {
      warnings.push(
        `dataBind@${binding.objectIndex}: unnamed or missing target omitted from normalized contract`
      );
      continue;
    }

    const converter =
      binding.converterIndex != null ? dataBinding?.converters[binding.converterIndex] : undefined;
    bindings.push({
      name: `${targetType}:${targetName}:${binding.propertyName ?? `property#${binding.propertyKey ?? "unknown"}`}`,
      targetType,
      targetName,
      targetProperty: binding.propertyName,
      direction: binding.flags.direction,
      twoWay: binding.flags.twoWay,
      once: binding.flags.once,
      sourceToTargetRunsFirst: binding.flags.sourceToTargetRunsFirst,
      nameBased: binding.flags.nameBased,
      converterName: binding.converterName,
      converterType: converter?.typeName,
      sourcePathIds: binding.sourcePathIds ? [...binding.sourcePathIds] : undefined,
    });
  }
  bindings.sort(byName);
  warnDuplicateNames("bindings", bindings, warnings);

  return {
    schemaVersion: 1,
    artboards: artboards.sort(byName),
    viewModels,
    bindings,
    warnings: [...new Set(warnings)].sort(),
  };
}

export function runtimeContractFromRiv(bytes: Uint8Array, inspect: InspectResult): RuntimeContract {
  const dump = readRiv(bytes, { tolerant: true });
  const contract = buildRuntimeContract(inspect, dump);
  if (dump.error) contract.warnings.push(`binary parse warning: ${dump.error}`);
  contract.warnings = [...new Set(contract.warnings)].sort();
  return contract;
}

function groupByName<T extends { name: string }>(values: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const group = result.get(value.name) ?? [];
    group.push(value);
    result.set(value.name, group);
  }
  for (const group of result.values()) group.sort(byName);
  return result;
}

function pairNamed<T extends { name: string }>(
  before: T[],
  after: T[],
  root: string,
  onRemoved: (value: T, path: string) => void,
  onAdded: (value: T, path: string) => void,
  onPair: (beforeValue: T, afterValue: T, path: string) => void
): void {
  const left = groupByName(before);
  const right = groupByName(after);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();

  for (const name of names) {
    const leftGroup = left.get(name) ?? [];
    const rightGroup = right.get(name) ?? [];
    const count = Math.max(leftGroup.length, rightGroup.length);
    for (let index = 0; index < count; index++) {
      const suffix = count > 1 ? `[${index}]` : "";
      const path = `${root}/${escapePath(name)}${suffix}`;
      const l = leftGroup[index];
      const r = rightGroup[index];
      if (l && r) onPair(l, r, path);
      else if (l) onRemoved(l, path);
      else if (r) onAdded(r, path);
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffRuntimeContracts(
  before: RuntimeContract,
  after: RuntimeContract
): RuntimeContractDiff {
  const changes: RuntimeContractChange[] = [];
  const add = (
    severity: ContractSeverity,
    kind: ContractChangeKind,
    path: string,
    message: string,
    previous?: unknown,
    next?: unknown
  ) => changes.push({ severity, kind, path, message, before: previous, after: next });

  pairNamed(
    before.artboards,
    after.artboards,
    "/artboards",
    (artboard, path) =>
      add("breaking", "removed", path, `Artboard "${artboard.name}" was removed`, artboard),
    (artboard, path) =>
      add("nonBreaking", "added", path, `Artboard "${artboard.name}" was added`, undefined, artboard),
    (leftArtboard, rightArtboard, artboardPath) => {
      if (leftArtboard.width !== rightArtboard.width || leftArtboard.height !== rightArtboard.height) {
        add(
          "behavior",
          "dimensionChanged",
          artboardPath,
          `Artboard dimensions changed from ${leftArtboard.width}x${leftArtboard.height} to ${rightArtboard.width}x${rightArtboard.height}`,
          { width: leftArtboard.width, height: leftArtboard.height },
          { width: rightArtboard.width, height: rightArtboard.height }
        );
      }

      pairNamed(
        leftArtboard.animations,
        rightArtboard.animations,
        `${artboardPath}/animations`,
        (animation, path) =>
          add("breaking", "removed", path, `Animation "${animation.name}" was removed`, animation),
        (animation, path) =>
          add("nonBreaking", "added", path, `Animation "${animation.name}" was added`, undefined, animation),
        (leftAnimation, rightAnimation, path) => {
          const leftBehavior = {
            durationFrames: leftAnimation.durationFrames,
            fps: leftAnimation.fps,
            speed: leftAnimation.speed,
            loop: leftAnimation.loop,
          };
          const rightBehavior = {
            durationFrames: rightAnimation.durationFrames,
            fps: rightAnimation.fps,
            speed: rightAnimation.speed,
            loop: rightAnimation.loop,
          };
          if (!sameValue(leftBehavior, rightBehavior)) {
            add(
              "behavior",
              "animationChanged",
              path,
              `Animation "${leftAnimation.name}" timing/playback changed`,
              leftBehavior,
              rightBehavior
            );
          }
        }
      );

      pairNamed(
        leftArtboard.events,
        rightArtboard.events,
        `${artboardPath}/events`,
        (event, path) =>
          add("breaking", "removed", path, `Event "${event.name}" was removed`, event),
        (event, path) =>
          add("nonBreaking", "added", path, `Event "${event.name}" was added`, undefined, event),
        (leftEvent, rightEvent, path) => {
          if (leftEvent.kind !== rightEvent.kind) {
            add(
              "breaking",
              "eventKindChanged",
              path,
              `Event "${leftEvent.name}" changed kind from ${leftEvent.kind} to ${rightEvent.kind}`,
              leftEvent.kind,
              rightEvent.kind
            );
          }
        }
      );

      pairNamed(
        leftArtboard.stateMachines,
        rightArtboard.stateMachines,
        `${artboardPath}/stateMachines`,
        (machine, path) =>
          add("breaking", "removed", path, `State Machine "${machine.name}" was removed`, machine),
        (machine, path) =>
          add("nonBreaking", "added", path, `State Machine "${machine.name}" was added`, undefined, machine),
        (leftMachine, rightMachine, machinePath) => {
          pairNamed(
            leftMachine.inputs,
            rightMachine.inputs,
            `${machinePath}/inputs`,
            (input, path) =>
              add("breaking", "removed", path, `State Machine input "${input.name}" was removed`, input),
            (input, path) =>
              add("nonBreaking", "added", path, `State Machine input "${input.name}" was added`, undefined, input),
            (leftInput, rightInput, path) => {
              if (leftInput.type !== rightInput.type) {
                add(
                  "breaking",
                  "typeChanged",
                  path,
                  `State Machine input "${leftInput.name}" changed type from ${leftInput.type} to ${rightInput.type}`,
                  leftInput.type,
                  rightInput.type
                );
              }
              if (!sameValue(leftInput.defaultValue, rightInput.defaultValue)) {
                add(
                  "behavior",
                  "defaultChanged",
                  path,
                  `State Machine input "${leftInput.name}" changed authored/default value`,
                  leftInput.defaultValue,
                  rightInput.defaultValue
                );
              }
            }
          );
        }
      );
    }
  );

  pairNamed(
    before.viewModels,
    after.viewModels,
    "/viewModels",
    (viewModel, path) =>
      add("breaking", "removed", path, `View Model "${viewModel.name}" was removed`, viewModel),
    (viewModel, path) =>
      add("nonBreaking", "added", path, `View Model "${viewModel.name}" was added`, undefined, viewModel),
    (leftViewModel, rightViewModel, viewModelPath) => {
      if (leftViewModel.viewModelType !== rightViewModel.viewModelType) {
        add(
          "breaking",
          "viewModelTypeChanged",
          viewModelPath,
          `View Model "${leftViewModel.name}" changed type`,
          leftViewModel.viewModelType,
          rightViewModel.viewModelType
        );
      }

      pairNamed(
        leftViewModel.properties,
        rightViewModel.properties,
        `${viewModelPath}/properties`,
        (property, path) =>
          add("breaking", "removed", path, `View Model property "${property.name}" was removed`, property),
        (property, path) =>
          add("nonBreaking", "added", path, `View Model property "${property.name}" was added`, undefined, property),
        (leftProperty, rightProperty, propertyPath) => {
          if (
            leftProperty.kind !== rightProperty.kind ||
            leftProperty.typeName !== rightProperty.typeName
          ) {
            add(
              "breaking",
              "typeChanged",
              propertyPath,
              `View Model property "${leftProperty.name}" changed type`,
              { kind: leftProperty.kind, typeName: leftProperty.typeName },
              { kind: rightProperty.kind, typeName: rightProperty.typeName }
            );
          }

          if (leftProperty.referencedViewModel !== rightProperty.referencedViewModel) {
            add(
              "breaking",
              "referenceChanged",
              propertyPath,
              `View Model property "${leftProperty.name}" changed referenced View Model`,
              leftProperty.referencedViewModel,
              rightProperty.referencedViewModel
            );
          }

          const leftEnums = new Map((leftProperty.enumValues ?? []).map((value) => [value.key, value.value]));
          const rightEnums = new Map((rightProperty.enumValues ?? []).map((value) => [value.key, value.value]));
          const enumKeys = [...new Set([...leftEnums.keys(), ...rightEnums.keys()])].sort();
          for (const key of enumKeys) {
            const oldValue = leftEnums.get(key);
            const newValue = rightEnums.get(key);
            const enumPath = `${propertyPath}/enum/${escapePath(key)}`;
            if (oldValue !== undefined && newValue === undefined) {
              add(
                "breaking",
                "enumValueRemoved",
                enumPath,
                `Enum value "${key}" was removed from property "${leftProperty.name}"`,
                oldValue
              );
            } else if (oldValue === undefined && newValue !== undefined) {
              add(
                "nonBreaking",
                "enumValueAdded",
                enumPath,
                `Enum value "${key}" was added to property "${leftProperty.name}"`,
                undefined,
                newValue
              );
            } else if (oldValue !== newValue) {
              add(
                "breaking",
                "enumValueChanged",
                enumPath,
                `Enum value "${key}" changed wire/value representation`,
                oldValue,
                newValue
              );
            }
          }
        }
      );

      pairNamed(
        leftViewModel.instances,
        rightViewModel.instances,
        `${viewModelPath}/instances`,
        (instance, path) =>
          add("breaking", "removed", path, `Named View Model instance "${instance.name}" was removed`, instance),
        (instance, path) =>
          add("nonBreaking", "added", path, `Named View Model instance "${instance.name}" was added`, undefined, instance),
        (leftInstance, rightInstance, instancePath) => {
          pairNamed(
            leftInstance.values,
            rightInstance.values,
            `${instancePath}/defaults`,
            (value, path) =>
              add(
                "behavior",
                "instanceDefaultChanged",
                path,
                `Authored default "${value.name}" was removed from instance "${leftInstance.name}"`,
                value
              ),
            (value, path) =>
              add(
                "behavior",
                "instanceDefaultChanged",
                path,
                `Authored default "${value.name}" was added to instance "${rightInstance.name}"`,
                undefined,
                value
              ),
            (leftValue, rightValue, path) => {
              if (leftValue.kind !== rightValue.kind || !sameValue(leftValue.value, rightValue.value)) {
                add(
                  "behavior",
                  "instanceDefaultChanged",
                  path,
                  `Authored default "${leftValue.name}" changed in instance "${leftInstance.name}"`,
                  { kind: leftValue.kind, value: leftValue.value },
                  { kind: rightValue.kind, value: rightValue.value }
                );
              }
            }
          );
        }
      );
    }
  );

  pairNamed(
    before.bindings,
    after.bindings,
    "/bindings",
    (binding, path) =>
      add(
        "behavior",
        "bindingRemoved",
        path,
        `Data Binding for ${binding.targetType} "${binding.targetName}" property "${binding.targetProperty ?? "unknown"}" was removed`,
        binding
      ),
    (binding, path) =>
      add(
        "behavior",
        "bindingAdded",
        path,
        `Data Binding for ${binding.targetType} "${binding.targetName}" property "${binding.targetProperty ?? "unknown"}" was added`,
        undefined,
        binding
      ),
    (leftBinding, rightBinding, path) => {
      if (!sameValue(leftBinding, rightBinding)) {
        add(
          "behavior",
          "bindingChanged",
          path,
          `Data Binding configuration changed for ${leftBinding.targetType} "${leftBinding.targetName}" property "${leftBinding.targetProperty ?? "unknown"}"`,
          leftBinding,
          rightBinding
        );
      }
    }
  );

  changes.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.severity.localeCompare(b.severity) ||
      a.kind.localeCompare(b.kind)
  );

  const breaking = changes.filter((change) => change.severity === "breaking");
  const behavior = changes.filter((change) => change.severity === "behavior");
  const nonBreaking = changes.filter((change) => change.severity === "nonBreaking");

  return {
    breaking,
    behavior,
    nonBreaking,
    changes,
    summary: {
      breaking: breaking.length,
      behavior: behavior.length,
      nonBreaking: nonBreaking.length,
      total: changes.length,
    },
  };
}
