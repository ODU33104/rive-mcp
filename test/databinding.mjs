// dataBinding.ts のユニットテスト: rivWriter.ts の低レベル writeRiv() で手組みした
// ViewModel/ViewModelInstance/DataEnum/DataConverter/DataBindContext オブジェクト列を、
// readRiv() + decodeDataBinding() で往復デコードして検証する。
//
// 外部fixtureに依存しない自己完結テスト（rive-runtime の実 .riv テスト資産で
// 個別に動作確認済みだが、ライセンス上リポジトリにはコミットしていない — 詳細は報告参照）。
//
// 触ってよいファイル制約により rivWriter.ts 本体は変更していない。writeRiv() を
// そのまま呼び出すだけ（低レベルAPI: { type: defs型名, props: {プロパティ名: 値} }）。
import { writeRiv } from "../dist/rivWriter.js";
import { readRiv } from "../dist/rivBinary.js";
import { decodeDataBinding } from "../dist/dataBinding.js";

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
}

// List<Id> の中身は「生バイト列に varuint(LEB128) を詰めただけ」（CoreBytesType, rivBinary.ts参照）
function packVaruints(values) {
  const bytes = [];
  for (let v of values) {
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      bytes.push(b);
    } while (v);
  }
  return new Uint8Array(bytes);
}

// ---- 手組みオブジェクト列 --------------------------------------------------
// VM0 "Config": score(number,local0) / mode(enumCustom,local1) / items(list,local2) / child(viewModel,local3)
// VM1 "Item": label(string,local0)
// enum0 "Mode": on/off
// instances: Item1(VM1#0)="Apple", Item2(VM1#1)="Banana", Default(VM0#0){score:42, mode->off, items:[Item1,Item2], child->Item2}
// DataBindContext: Node "target1" の x を conv1(DataConverterToNumber) 経由でバインド、sourcePathIds=[0]
const objects = [
  { type: "ViewModel", props: { name: "Config" } },
  { type: "ViewModelPropertyNumber", props: { name: "score" } },
  { type: "ViewModelPropertyEnumCustom", props: { name: "mode", enumId: 0 } },
  { type: "ViewModelPropertyList", props: { name: "items" } },
  { type: "ViewModelPropertyViewModel", props: { name: "child", viewModelReferenceId: 1 } },

  { type: "ViewModel", props: { name: "Item" } },
  { type: "ViewModelPropertyString", props: { name: "label" } },

  { type: "DataEnumCustom", props: { name: "Mode" } },
  { type: "DataEnumValue", props: { key: "on", value: "1" } },
  { type: "DataEnumValue", props: { key: "off", value: "0" } },

  { type: "ViewModelInstance", props: { name: "Item1", viewModelId: 1 } },
  { type: "ViewModelInstanceString", props: { viewModelPropertyId: 0, propertyValue: "Apple" } },

  { type: "ViewModelInstance", props: { name: "Item2", viewModelId: 1 } },
  { type: "ViewModelInstanceString", props: { viewModelPropertyId: 0, propertyValue: "Banana" } },

  { type: "ViewModelInstance", props: { name: "Default", viewModelId: 0 } },
  { type: "ViewModelInstanceNumber", props: { viewModelPropertyId: 0, propertyValue: 42 } },
  { type: "ViewModelInstanceEnum", props: { viewModelPropertyId: 1, propertyValue: 1 } }, // -> "off"
  { type: "ViewModelInstanceList", props: { viewModelPropertyId: 2 } },
  { type: "ViewModelInstanceListItem", props: { viewModelId: 1, viewModelInstanceId: 0 } }, // -> Item1
  { type: "ViewModelInstanceListItem", props: { viewModelId: 1, viewModelInstanceId: 1 } }, // -> Item2
  { type: "ViewModelInstanceViewModel", props: { viewModelPropertyId: 3, propertyValue: 1 } }, // -> Item2

  { type: "DataConverterToNumber", props: { name: "conv1" } },
  { type: "Node", props: { name: "target1" } },
  {
    type: "DataBindContext",
    props: { propertyKey: 13 /* Node.x */, flags: 0, converterId: 0, sourcePathIds: packVaruints([0]) },
  },
];

const bytes = writeRiv(objects);
const dump = readRiv(bytes, { tolerant: true });
check("readRiv: no parse error", dump.error == null, dump.error ?? "");
check("readRiv: object count matches", dump.objects.length === objects.length, `${dump.objects.length}`);

const db = decodeDataBinding(dump);
check("decodeDataBinding: non-null", db !== null);

if (db) {
  // ViewModel構造
  check("2 ViewModels", db.viewModels.length === 2, `${db.viewModels.length}`);
  const vmConfig = db.viewModels.find((v) => v.name === "Config");
  check("Config has 4 properties", vmConfig?.properties.length === 4, JSON.stringify(vmConfig?.properties.map((p) => p.name)));
  check(
    "Config properties in order: score/mode/items/child",
    JSON.stringify(vmConfig?.properties.map((p) => p.name)) === JSON.stringify(["score", "mode", "items", "child"])
  );
  check("mode property kind=enumCustom, enumIndex=0", vmConfig?.properties[1].kind === "enumCustom" && vmConfig?.properties[1].enumIndex === 0);
  check(
    "child property kind=viewModel, viewModelReferenceIndex=1",
    vmConfig?.properties[3].kind === "viewModel" && vmConfig?.properties[3].viewModelReferenceIndex === 1
  );

  const vmItem = db.viewModels.find((v) => v.name === "Item");
  check("Item has instanceCount=2", vmItem?.instanceCount === 2, `${vmItem?.instanceCount}`);
  check("Config has instanceCount=1", vmConfig?.instanceCount === 1, `${vmConfig?.instanceCount}`);

  // enum
  check("1 enum decoded", db.enums.length === 1, `${db.enums.length}`);
  check(
    "Mode enum values in order",
    JSON.stringify(db.enums[0].values) === JSON.stringify([{ key: "on", value: "1" }, { key: "off", value: "0" }]),
    JSON.stringify(db.enums[0].values)
  );

  // instances
  const def = db.viewModelInstances.find((i) => i.name === "Default");
  check("Default.localIndex === 0", def?.localIndex === 0);
  const scoreVal = def?.values.find((v) => v.propertyName === "score");
  check("Default.score === 42", scoreVal?.value === 42, `${scoreVal?.value}`);

  const modeVal = def?.values.find((v) => v.propertyName === "mode");
  check(
    "Default.mode resolves to enum value 'off' (raw index 1)",
    modeVal?.enum?.key === "off",
    JSON.stringify(modeVal?.enum)
  );

  const childVal = def?.values.find((v) => v.propertyName === "child");
  check(
    "Default.child resolves to Item2 (VM1 local index 1)",
    childVal?.referenceInstance?.name === "Item2" && childVal?.referenceInstance?.viewModelIndex === 1,
    JSON.stringify(childVal?.referenceInstance)
  );

  const itemsVal = def?.values.find((v) => v.propertyName === "items");
  check(
    "Default.items list has 2 items resolving to Item1/Item2",
    itemsVal?.listItems?.map((li) => li.instanceName).join(",") === "Item1,Item2",
    JSON.stringify(itemsVal?.listItems)
  );

  const item1 = db.viewModelInstances.find((i) => i.name === "Item1");
  check("Item1.localIndex === 0", item1?.localIndex === 0);
  check("Item1.label === 'Apple'", item1?.values[0]?.value === "Apple", `${item1?.values[0]?.value}`);
  const item2 = db.viewModelInstances.find((i) => i.name === "Item2");
  check("Item2.localIndex === 1", item2?.localIndex === 1);

  // converters
  check("1 converter decoded", db.converters.length === 1, `${db.converters.length}`);
  check("converter name === 'conv1'", db.converters[0].name === "conv1");

  // dataBind
  check("1 dataBind decoded", db.dataBinds.length === 1, `${db.dataBinds.length}`);
  const bind = db.dataBinds[0];
  check(
    "dataBind targets the Node named target1 (stream-position based, not targetId)",
    bind?.target?.typeName === "Node" && bind?.target?.name === "target1",
    JSON.stringify(bind?.target)
  );
  check("dataBind.propertyName resolves to 'x'", bind?.propertyName === "x", `${bind?.propertyName}`);
  check("dataBind.converterName resolves to 'conv1'", bind?.converterName === "conv1", `${bind?.converterName}`);
  check(
    "dataBind.sourcePathIds decodes packed varuints back to [0]",
    JSON.stringify(bind?.sourcePathIds) === "[0]",
    JSON.stringify(bind?.sourcePathIds)
  );
}

// ---- 空ファイル: dataBinding が無いオブジェクト列では null を返す ----
const plainObjects = [{ type: "Node", props: { name: "solo" } }];
const plainDump = readRiv(writeRiv(plainObjects), { tolerant: true });
check("decodeDataBinding returns null when no ViewModel/DataBind present", decodeDataBinding(plainDump) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
