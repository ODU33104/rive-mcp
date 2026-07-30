// Rive データバインディング（ViewModel）デコーダ — 読み取り専用の列挙
//
// .riv のオブジェクトストリームはフラットな列（rivBinary.ts の readRiv() 参照）で、
// ViewModel / ViewModelInstance / DataEnum / DataConverter とその子要素の所属は
// 「ストリーム上の直前の親候補オブジェクトに帰属する」という rive-runtime の ImportStack
// 方式で決まる（docs/riv-format.md の既存の「参照 semantics」表と同じ考え方。KeyedProperty が
// 直前の LinearAnimation に帰属するのと同型のパターン）。
//
// この帰属規則・各Idフィールドの意味は rive-runtime ソース（file.cpp / importers/*.cpp /
// viewmodel/*.cpp / data_bind/*.cpp、および dev/defs/**/*.json の "runtime"/"typeRuntime" フラグ）
// を実際に読んで検証済み。defs.json と食い違う場合は defs.json を正とする方針だが、
// 「どのフィールドが実際にバイナリに書かれるか」（runtime: false は書かれない）と
// 「Idフィールドが何を指すか」は defs.json だけでは分からないため、ここに要点を残す:
//
//   - ViewModel: グローバル通し番号（ファイル中の出現順）。ViewModelInstance.viewModelId /
//     ViewModelPropertyViewModel.viewModelReferenceId / ViewModelInstanceListItem.viewModelId は
//     すべてこのグローバル番号を指す
//   - ViewModelProperty(系): 直前の ViewModel にストリーム位置で帰属（子要素の並び順 = その
//     ViewModel内でのローカルindex）
//   - ViewModelInstance: viewModelId が指す ViewModel の「そのViewModelId を持つ
//     ViewModelInstanceの出現順」がローカルindex（＝ ViewModel::instance(index) の index）
//   - ViewModelInstanceValue(系): 直前の ViewModelInstance にストリーム位置で帰属。
//     viewModelPropertyId は「所属ViewModelのproperties配列内でのローカルindex」
//     （viewModelInstanceId フィールドは runtime:false = ファイルには存在しない。所属は
//     ストリーム位置のみで決まる）
//   - ViewModelInstanceViewModel.propertyValue: 参照先ViewModelの instance() ローカルindex
//   - DataEnumCustom: グローバル通し番号（DataEnumValueのenumId解決に使われる列。
//     file.cppのswitchはDataEnum/DataEnumCustomのみをこの列に積み、DataEnumSystemは含まれない）
//   - DataEnumValue: 直前の DataEnumCustom にストリーム位置で帰属（enumIdフィールドは
//     runtime:false）
//   - DataConverter系（DataConverterGroupItem・FormulaToken系を除く）: グローバル通し番号。
//     DataBind.converterId / DataConverterGroupItem.converterId/groupId が指す
//   - DataBind/DataBindContext: target は「ストリーム上でこのDataBindの直前にある
//     DataBindではないオブジェクト」（targetId フィールドは runtime:false = ファイルには
//     存在せず、ランタイムも使わない。StateTransitionの「直前に書いたstateに帰属」と同型）

import { propInfo, type RivDump, type RivObject } from "./rivBinary.js";

// ---- 型名カテゴリ（vendor/rive-defs/defs.json の viewmodel/*・data_bind/* から抽出） ----

const VM_PROPERTY_TYPES = new Set([
  "ViewModelPropertyArtboard",
  "ViewModelPropertyAsset",
  "ViewModelPropertyAssetFont",
  "ViewModelPropertyAssetImage",
  "ViewModelPropertyBoolean",
  "ViewModelPropertyColor",
  "ViewModelPropertyEnum",
  "ViewModelPropertyEnumCustom",
  "ViewModelPropertyEnumSystem",
  "ViewModelPropertyList",
  "ViewModelPropertyNumber",
  "ViewModelPropertyString",
  "ViewModelPropertySymbol",
  "ViewModelPropertySymbolListIndex",
  "ViewModelPropertyTrigger",
  "ViewModelPropertyViewModel",
]);

const VM_INSTANCE_VALUE_TYPES = new Set([
  "ViewModelInstanceArtboard",
  "ViewModelInstanceAsset",
  "ViewModelInstanceAssetFont",
  "ViewModelInstanceAssetImage",
  "ViewModelInstanceBoolean",
  "ViewModelInstanceColor",
  "ViewModelInstanceEnum",
  "ViewModelInstanceList",
  "ViewModelInstanceNumber",
  "ViewModelInstanceString",
  "ViewModelInstanceSymbol",
  "ViewModelInstanceSymbolListIndex",
  "ViewModelInstanceTrigger",
  "ViewModelInstanceViewModel",
]);

// file.cpp: case DataEnum::typeKey: case DataEnumCustom::typeKey: しか m_Enums に積まない
const DATA_ENUM_GLOBAL_TYPES = new Set(["DataEnum", "DataEnumCustom"]);

// object->is<DataConverter>() 相当（DataConverterGroupItem と FormulaToken系は対象外）
const DATA_CONVERTER_TYPES = new Set([
  "DataConverter",
  "DataConverterBooleanNegate",
  "DataConverterFormula",
  "DataConverterGroup",
  "DataConverterInterpolator",
  "DataConverterListToLength",
  "DataConverterNumberToList",
  "DataConverterOperation",
  "DataConverterOperationValue",
  "DataConverterOperationViewModel",
  "DataConverterRangeMapper",
  "DataConverterRounder",
  "DataConverterStringPad",
  "DataConverterStringRemoveZeros",
  "DataConverterStringTrim",
  "DataConverterSystemDegsToRads",
  "DataConverterSystemNormalizer",
  "DataConverterToNumber",
  "DataConverterToString",
  "DataConverterTrigger",
  "ScriptedDataConverter",
]);

const FORMULA_TOKEN_TYPES = new Set([
  "FormulaToken",
  "FormulaTokenArgumentSeparator",
  "FormulaTokenFunction",
  "FormulaTokenInput",
  "FormulaTokenOperation",
  "FormulaTokenParenthesis",
  "FormulaTokenParenthesisClose",
  "FormulaTokenParenthesisOpen",
  "FormulaTokenValue",
]);

const DATA_BIND_TYPES = new Set(["DataBind", "DataBindContext"]);

// 型名の接頭辞を剥がして「値の種類」に正規化（表示用）
function kindOf(typeNamePrefixStripped: string, prefix: string): string {
  const rest = typeNamePrefixStripped.slice(prefix.length);
  return rest ? rest.charAt(0).toLowerCase() + rest.slice(1) : rest;
}

// ---- DataBindFlags（include/rive/data_bind_flags.hpp 由来） ----
function decodeDataBindFlags(flags: number | undefined) {
  const f = flags ?? 0;
  return {
    raw: f,
    direction: (f & 0b1) !== 0 ? "toSource" : "toTarget",
    twoWay: (f & 0b10) !== 0,
    once: (f & 0b100) !== 0,
    sourceToTargetRunsFirst: (f & 0b1000) !== 0,
    nameBased: (f & 0b10000) !== 0,
  };
}

// ---- 出力型 ----
export interface VmPropertyOut {
  localIndex: number;
  objectIndex: number;
  name: string;
  kind: string;
  typeName: string;
  displayName?: string;
  enumIndex?: number; // ViewModelPropertyEnumCustom.enumId (グローバル)
  viewModelReferenceIndex?: number; // ViewModelPropertyViewModel.viewModelReferenceId (グローバル)
}

export interface VmOut {
  index: number;
  objectIndex: number;
  name: string;
  viewModelType?: number;
  properties: VmPropertyOut[];
  instanceCount: number;
}

export interface VmInstanceValueOut {
  localPropertyIndex: number; // viewModelPropertyId (所属ViewModel内ローカルindex)
  propertyName?: string;
  kind: string;
  typeName: string;
  objectIndex: number;
  value?: unknown;
  // ViewModelInstanceEnum の解決結果
  enum?: { key: string; value: string } | null;
  // ViewModelInstanceViewModel の解決結果
  referenceInstance?: { viewModelIndex: number; localIndex: number; name: string } | null;
  // ViewModelInstanceList の要素
  listItems?: Array<{
    name?: string;
    viewModelIndex: number;
    localInstanceIndex: number;
    instanceName?: string;
  }>;
}

export interface VmInstanceOut {
  index: number; // グローバル通し番号（全ViewModelInstance中の出現順）
  objectIndex: number;
  localIndex: number; // 所属ViewModel内でのローカルindex（ViewModel::instance(index)）
  name: string;
  viewModelIndex: number;
  viewModelName: string;
  values: VmInstanceValueOut[];
}

export interface DataEnumOut {
  index: number; // グローバル通し番号（EnumCustom/DataEnumのみ。DataEnumSystemは含まない）
  objectIndex: number;
  name: string;
  values: Array<{ key: string; value: string }>;
}

export interface DataEnumSystemOut {
  objectIndex: number;
  enumType: number;
}

export interface ConverterOut {
  index: number;
  objectIndex: number;
  name: string;
  kind: string;
  typeName: string;
  properties: Record<string, unknown>;
  formulaTokens?: Array<{ objectIndex: number; typeName: string; properties: Record<string, unknown> }>;
}

export interface ConverterGroupItemOut {
  objectIndex: number;
  converterIndex?: number;
  converterName?: string;
  groupIndex?: number;
  groupName?: string;
}

export interface DataBindOut {
  objectIndex: number;
  typeName: string;
  target: { objectIndex: number; typeName: string; name?: string } | null;
  propertyKey?: number;
  propertyName?: string;
  flags: ReturnType<typeof decodeDataBindFlags>;
  converterIndex?: number;
  converterName?: string;
  sourcePathIds?: number[];
}

export interface DataBindPathOut {
  objectIndex: number;
  path: number[];
  isRelative: boolean;
}

export interface DataBindingResult {
  viewModels: VmOut[];
  viewModelInstances: VmInstanceOut[];
  enums: DataEnumOut[];
  systemEnums: DataEnumSystemOut[];
  converters: ConverterOut[];
  converterGroupItems: ConverterGroupItemOut[];
  dataBinds: DataBindOut[];
  dataBindPaths: DataBindPathOut[];
}

function isEmpty(r: DataBindingResult): boolean {
  return (
    r.viewModels.length === 0 &&
    r.viewModelInstances.length === 0 &&
    r.enums.length === 0 &&
    r.systemEnums.length === 0 &&
    r.converters.length === 0 &&
    r.dataBinds.length === 0 &&
    r.dataBindPaths.length === 0
  );
}

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const asNumber = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** .riv のフラットなオブジェクト列から ViewModel / データバインディング関連オブジェクトを列挙する（読み取り専用）。*/
export function decodeDataBinding(dump: RivDump): DataBindingResult | null {
  const viewModels: VmOut[] = [];
  // localIndex はポストパスで確定するまで -1 のプレースホルダ
  const viewModelInstancesRaw: VmInstanceOut[] = [];
  const enums: DataEnumOut[] = [];
  const systemEnums: DataEnumSystemOut[] = [];
  const converters: ConverterOut[] = [];
  const converterGroupItemsRaw: Array<{ objectIndex: number; converterId?: number; groupId?: number }> = [];
  const dataBinds: DataBindOut[] = [];
  const dataBindPaths: DataBindPathOut[] = [];

  let currentVm: VmOut | null = null;
  let currentVmInstance: VmInstanceOut | null = null;
  let currentVmInstanceList: VmInstanceValueOut | null = null;
  let currentEnum: DataEnumOut | null = null;
  let currentConverter: ConverterOut | null = null;
  let lastNonDataBind: RivObject | null = null;

  // ViewModelInstanceListItem は直前の ViewModelInstanceList に帰属するが、その解決には
  // 全ViewModelInstanceが出揃うまで待つ必要があるので、まず生データとして集める
  const pendingListItems: Array<{
    owner: VmInstanceValueOut;
    name?: string;
    viewModelId?: number;
    viewModelInstanceId?: number;
  }> = [];

  for (const obj of dump.objects) {
    const t = obj.typeName;

    if (t === "ViewModel") {
      const vm: VmOut = {
        index: viewModels.length,
        objectIndex: obj.index,
        name: asString(obj.properties.name),
        viewModelType: asNumber(obj.properties.viewModelType),
        properties: [],
        instanceCount: 0,
      };
      viewModels.push(vm);
      currentVm = vm;
    } else if (VM_PROPERTY_TYPES.has(t) && currentVm) {
      const kind = kindOf(t, "ViewModelProperty");
      const prop: VmPropertyOut = {
        localIndex: currentVm.properties.length,
        objectIndex: obj.index,
        name: asString(obj.properties.name),
        kind,
        typeName: t,
        displayName: typeof obj.properties.displayName === "string" ? obj.properties.displayName : undefined,
      };
      if (t === "ViewModelPropertyEnumCustom" || t === "ViewModelPropertyEnumSystem") {
        prop.enumIndex = asNumber(obj.properties.enumId);
      }
      if (t === "ViewModelPropertyViewModel") {
        prop.viewModelReferenceIndex = asNumber(obj.properties.viewModelReferenceId);
      }
      currentVm.properties.push(prop);
    } else if (t === "ViewModelInstance") {
      const inst: VmInstanceOut = {
        index: viewModelInstancesRaw.length,
        objectIndex: obj.index,
        localIndex: -1, // ポストパスで確定
        name: asString(obj.properties.name),
        viewModelIndex: asNumber(obj.properties.viewModelId) ?? -1,
        viewModelName: "",
        values: [],
      };
      viewModelInstancesRaw.push(inst);
      currentVmInstance = inst;
      currentVmInstanceList = null;
    } else if (VM_INSTANCE_VALUE_TYPES.has(t) && currentVmInstance) {
      const kind = kindOf(t, "ViewModelInstance");
      const val: VmInstanceValueOut = {
        localPropertyIndex: asNumber(obj.properties.viewModelPropertyId) ?? -1,
        kind,
        typeName: t,
        objectIndex: obj.index,
        value: obj.properties.propertyValue,
      };
      currentVmInstance.values.push(val);
      currentVmInstanceList = t === "ViewModelInstanceList" ? val : null;
    } else if (t === "ViewModelInstanceListItem" && currentVmInstanceList) {
      pendingListItems.push({
        owner: currentVmInstanceList,
        name: typeof obj.properties.name === "string" ? obj.properties.name : undefined,
        viewModelId: asNumber(obj.properties.viewModelId),
        viewModelInstanceId: asNumber(obj.properties.viewModelInstanceId),
      });
    } else if (DATA_ENUM_GLOBAL_TYPES.has(t)) {
      const de: DataEnumOut = {
        index: enums.length,
        objectIndex: obj.index,
        name: asString(obj.properties.name),
        values: [],
      };
      enums.push(de);
      currentEnum = de;
    } else if (t === "DataEnumSystem") {
      systemEnums.push({ objectIndex: obj.index, enumType: asNumber(obj.properties.enumType) ?? -1 });
      currentEnum = null; // EnumImporterはDataEnumCustomにしか積まれない
    } else if (t === "DataEnumValue" && currentEnum) {
      currentEnum.values.push({ key: asString(obj.properties.key), value: asString(obj.properties.value) });
    } else if (DATA_CONVERTER_TYPES.has(t)) {
      const { name, ...rest } = obj.properties as Record<string, unknown>;
      const conv: ConverterOut = {
        index: converters.length,
        objectIndex: obj.index,
        name: asString(name),
        kind: kindOf(t, "DataConverter") || "base",
        typeName: t,
        properties: rest,
      };
      converters.push(conv);
      currentConverter = conv;
    } else if (t === "DataConverterGroupItem") {
      converterGroupItemsRaw.push({
        objectIndex: obj.index,
        converterId: asNumber(obj.properties.converterId),
        groupId: asNumber(obj.properties.groupId),
      });
    } else if (FORMULA_TOKEN_TYPES.has(t) && currentConverter?.typeName === "DataConverterFormula") {
      (currentConverter.formulaTokens ??= []).push({
        objectIndex: obj.index,
        typeName: t,
        properties: obj.properties,
      });
    } else if (t === "DataBindPath") {
      dataBindPaths.push({
        objectIndex: obj.index,
        path: Array.isArray(obj.properties.path) ? (obj.properties.path as number[]) : [],
        isRelative: obj.properties.isRelative === true,
      });
    }

    if (DATA_BIND_TYPES.has(t)) {
      const propertyKey = asNumber(obj.properties.propertyKey);
      dataBinds.push({
        objectIndex: obj.index,
        typeName: t,
        target: lastNonDataBind
          ? {
              objectIndex: lastNonDataBind.index,
              typeName: lastNonDataBind.typeName,
              name: typeof lastNonDataBind.properties.name === "string" ? lastNonDataBind.properties.name : undefined,
            }
          : null,
        propertyKey,
        propertyName: propertyKey != null ? propInfo(propertyKey)?.name : undefined,
        flags: decodeDataBindFlags(asNumber(obj.properties.flags)),
        converterIndex: asNumber(obj.properties.converterId),
        sourcePathIds: Array.isArray(obj.properties.sourcePathIds) ? (obj.properties.sourcePathIds as number[]) : undefined,
      });
    } else {
      // DataBind::target() は「直前の非DataBindオブジェクト」（file.cpp の lastBindableObject）
      lastNonDataBind = obj;
    }
  }

  // ---- ポストパス解決 ----

  // 1) ViewModel.instanceCount + 各インスタンスのローカルindex（同じviewModelIdを持つ
  //    ViewModelInstanceの出現順 = BackboardImporter::addViewModelInstance と同じ規則）
  const localIndexByVm = new Map<number, number>();
  for (const inst of viewModelInstancesRaw) {
    const vmIdx = inst.viewModelIndex;
    const local = localIndexByVm.get(vmIdx) ?? 0;
    localIndexByVm.set(vmIdx, local + 1);
    inst.localIndex = local;
    const vm = viewModels[vmIdx];
    if (vm) {
      vm.instanceCount++;
      inst.viewModelName = vm.name;
    }
  }
  const viewModelInstances: VmInstanceOut[] = viewModelInstancesRaw;

  // 所属ViewModelごとの「ローカルindex → インスタンス」引き当てテーブル
  const instancesByVm = new Map<number, VmInstanceOut[]>();
  for (const inst of viewModelInstances) {
    const list = instancesByVm.get(inst.viewModelIndex) ?? [];
    list[inst.localIndex] = inst;
    instancesByVm.set(inst.viewModelIndex, list);
  }

  // 2) ViewModelInstanceListItem を対応する ViewModelInstanceList に解決して差し込む
  for (const item of pendingListItems) {
    const vmIdx = item.viewModelId ?? -1;
    const localInst = item.viewModelInstanceId ?? -1;
    const target = instancesByVm.get(vmIdx)?.[localInst];
    (item.owner.listItems ??= []).push({
      name: item.name,
      viewModelIndex: vmIdx,
      localInstanceIndex: localInst,
      instanceName: target?.name,
    });
  }

  // 3) 各 ViewModelInstanceValue を「所属ViewModelのproperty定義」に照らして解決
  //    (プロパティ名 / Enum値 / ViewModel参照インスタンス)
  for (const inst of viewModelInstances) {
    const vm = viewModels[inst.viewModelIndex];
    for (const val of inst.values) {
      const prop = vm?.properties[val.localPropertyIndex];
      val.propertyName = prop?.name;
      if (val.kind === "enum" && prop?.enumIndex != null) {
        const de = enums[prop.enumIndex];
        const idx = typeof val.value === "number" ? val.value : undefined;
        val.enum = de && idx != null ? de.values[idx] ?? null : null;
      }
      if (val.kind === "viewModel" && prop?.viewModelReferenceIndex != null) {
        const refVmIdx = prop.viewModelReferenceIndex;
        const localIdx = typeof val.value === "number" ? val.value : undefined;
        const refInst = localIdx != null ? instancesByVm.get(refVmIdx)?.[localIdx] : undefined;
        val.referenceInstance = refInst
          ? { viewModelIndex: refVmIdx, localIndex: localIdx!, name: refInst.name }
          : { viewModelIndex: refVmIdx, localIndex: localIdx ?? -1, name: "" };
      }
    }
  }

  // 4) DataBind.converterId → converters[] 解決（Idの「未設定」は -1 相当のuint、範囲外扱いでnone）
  for (const db of dataBinds) {
    if (db.converterIndex != null && db.converterIndex >= 0 && db.converterIndex < converters.length) {
      db.converterName = converters[db.converterIndex].name;
    } else {
      db.converterIndex = undefined;
    }
  }

  // 5) DataConverterGroupItem → converters[] 解決
  const converterGroupItems: ConverterGroupItemOut[] = converterGroupItemsRaw.map((item) => {
    const out: ConverterGroupItemOut = { objectIndex: item.objectIndex };
    if (item.converterId != null && item.converterId < converters.length) {
      out.converterIndex = item.converterId;
      out.converterName = converters[item.converterId].name;
    }
    if (item.groupId != null && item.groupId < converters.length) {
      out.groupIndex = item.groupId;
      out.groupName = converters[item.groupId].name;
    }
    return out;
  });

  const result: DataBindingResult = {
    viewModels,
    viewModelInstances,
    enums,
    systemEnums,
    converters,
    converterGroupItems,
    dataBinds,
    dataBindPaths,
  };
  return isEmpty(result) ? null : result;
}
