# .riv バイナリフォーマット（実装知見の正本）

出典: rive.app/docs/runtimes/advanced-topic/format + rive-runtime ソース + vehicles.riv 実バイナリでの検証。
実装: `src/rivBinary.ts`（リーダー）/ `src/rivWriter.ts`（ライター）。

## レイアウト

```
"RIVE" (4B) | varuint major(7) | varuint minor | varuint fileId
ToC: varuint propertyKey... 0終端
ビットマップ: uint32 1つにつき4プロパティ（2bitずつLSBから。上位24bitは未使用）
             0=uint/bool 1=string 2=double(float32) 3=color(uint32 ARGB LE)
オブジェクト列: varuint typeKey → (varuint propKey, 値)... → 0終端 の繰り返し
```

- varuint = LEB128。double は **float32 LE**。string は varuint長+UTF-8。color は ARGB uint32 LE
- typeKey / propertyKey の正本は `vendor/rive-defs/defs.json`（`scripts/merge-defs.mjs` で再生成。
  旧フォーマット互換キーは `alternates` 由来で `x@xArtboard` のような名前で登録）
- defs の型名 `String` は大文字 — フィールドタイプ判定は小文字正規化必須

## 参照 semantics（vehicles.riv で実証）

| 参照 | 意味 |
|---|---|
| `parentId` / `objectId` / `interpolatorId` | アートボード内ローカルindex（artboard自身=0、以降ストリーム順） |
| `animationId` (AnimationState) | アートボード内 LinearAnimation の出現順 (0-based) |
| `stateToId` (StateTransition) | レイヤー内 state の出現順（書いた順。**Entry/Any/Exit も同じ列に含まれ、先頭に来るとは限らない**） |
| KeyedObject/KeyedProperty/KeyFrame | 直前の LinearAnimation に位置で帰属（parentId無し） |
| StateTransition | **直前に書いた state** に帰属 |
| TransitionXxxCondition | 直前の StateTransition に帰属 |

## 実装上の要注意点

1. **描画順: 先に書いた drawable が前面**。背景は最後に書く
2. KeyFrame `interpolationType`: 0=hold, 1=linear, 2=cubic（2のとき `interpolatorId` 必須。
   CubicEaseInterpolator はコンポーネント領域に置く）
3. `LinearAnimation.duration` はフレーム数。`fps` 省略時 60
4. TransitionConditionOp: equal=0, notEqual=1, lessThanOrEqual=2, greaterThanOrEqual=3, lessThan=4, greaterThan=5
   （出典: include/rive/animation/transition_condition_op.hpp。**推測禁止・要ソース確認**だった箇所）
5. bool条件は「equal=入力がtrue」「notEqual=入力がfalse」。value プロパティは持たない
6. state変化イベントの名前は AnimationState の場合**アニメーション名**が返る
7. 生成物の検証は必ず公式ランタイム（riveHost.inspect + renderFrames）で行う。
   自己リード(readRiv)だけでは「ランタイムが受理するか」は保証されない
8. **`stateToId` の解決に Entry=0 / Any=1 / Exit=2 を決め打ちしてはいけない**。
   実ファイルではレイヤーごとに順序が違う（公式エディタ製のファイルで Entry が index 0/1/2/4 と
   バラバラだった実例あり）。LayerState を継承する全型を**出現順に**数えること
   （`isLayerStateType()` を使う）。決め打ちすると遷移先が全部ずれ、実在する state を
   「到達不能」と誤検出する。**例外は飛ばず、それらしい結果のまま静かに壊れる**タイプのバグ

## 画像・メッシュ（実装済み・検証済み）

- アセットは **Backboard の直後・Artboard の前**に `ImageAsset`（name/width/height）+
  `FileAssetContents`（bytes=PNG生バイト）のペアで書く。**ローカルindexを消費しない**
- `Image` drawable の `assetId` = ファイル内アセットの出現順 (0-based)
- `Mesh` は Image の子（parentId）。`triangleIndexBytes` は **uint16 LE** の頂点index三つ組
- `MeshVertex` は Mesh の子。x/y は画像中心原点の natural pixel 空間、u/v は 0-1
- MeshVertex の x/y は keyable。ただし propertyKey は **Vertex.x(24)/y(25)**（Node.x(13)/y(14) と別物）
- StateTransition の exit time: `flags=4` + `exitTime`（ms）で「遷移元アニメを指定時間再生後に遷移」

## Audio（実装済み・検証済み）

- アセットは画像と同じ規則: **Backboard の直後・Artboard の前**に `AudioAsset`（typeKey 406）+
  `FileAssetContents`（bytes=WAV/MP3/FLAC生バイト）のペアで書く。**ローカルindexを消費しない**
  （ファイル内アセット出現順のグローバルカウンタを Font/Image と共有する）
- `AudioAsset` は `DrawableAsset` ではなく `ExportAudio`（`Asset`直系）を継承するため width/height は無い。
  name は Asset 基底の propertyKey **203**（ImageAsset/FontAsset と共通。Component.name(4) とは別物）。
  sampleRate(473)/channels(474)/durationSeconds(475, WAVのfmt/dataチャンクから算出)/formatValue(476) は
  再生に必須ではない付随メタデータ（デコードは実際のバイト列をランタイム側の音声デコーダが解析する）。
  非WAV（mp3/ogg/flac等）はこのメタデータを省略しても問題ない
- `AudioEvent`（typeKey 407）は `Event`（custom_property_group.json 系 = Component 系。
  name propertyKey は **4**、ImageAsset等の 203 とは別物）を継承するイベントで、
  `assetId`（propertyKey 408, Id型）に埋め込んだ AudioAsset のグローバル出現順indexを持つ。
  `OpenUrlEvent` と同じ並びで Artboard内 events に置く（parentId=0固定）
- **アニメーション中の指定フレームでの発火**: `Event` 基底が持つ `trigger` プロパティ
  （propertyKey **395**, 型は `callback` — 値を持たない）を `KeyedObject`(objectId=AudioEventのローカルindex)
  + `KeyedProperty`(propertyKey=395) + `KeyFrameCallback`（1個/発火フレーム）でキーフレーム化する。
  `KeyFrameCallback`（typeKey 171）は `animation/keyframe.json` 直系で `InterpolatingKeyFrame` を経由しない
  ため、他の KeyFrame* と異なり **interpolationType/interpolatorId を持たない**（frameのみ）。
  KeyedObject/KeyedProperty/KeyFrame の帰属規則は他プロパティと同じくストリーム位置依存
  （直前の LinearAnimation に帰属。「参照 semantics」表を参照）
- ステートマシンから発火する場合は既存の `StateMachineFireEvent`（state進入時にeventIdを発火）がそのまま使える。
  AudioEvent もただの Event 派生なので eventId として渡せる
- **プレビュー非対応**: このサーバーの Canvas2D ベースのプレビューランタイムは音声を再生しない
  （落とし穴8の Feather と同じ「書き込みは正しいが preview 非対応」パターン）。
  AudioAsset/AudioEvent の直列化・公式ランタイムでのロード可否は検証済みだが、実際の再生確認は
  GPU版 Rive Renderer（WebGL/Skia、例: rive.app や本番プレイヤー）でのみ可能

## ボーン・スキニング（実装済み・検証済み）

- チェーン先頭は `RootBone`（x/y/rotation/length、親は Node）、以降は `Bone`（rotation/length のみ。
  **子ボーンの原点は親の x=length 位置に自動配置**、x プロパティは持たない）
- `Skin` は Mesh（または PointsPath）の子。xx..ty = スキン対象のバインド時ワールド行列
- `Tendon` は Skin の子。boneId（ローカルindex）+ ボーンのバインド時ワールド行列。
  ランタイムは逆行列にして `boneWorld × inverseBind` で変形（skin.cpp/tendon.cpp）
- **行列プロパティの命名は列ベクトル: xx,xy=第1列(x軸) / yx,yy=第2列**。
  「行優先」と誤解して xy/yx を入れ替えるとレスト姿勢が崩壊する（実際にやらかした）
- `Weight` は各頂点の子。values/indices は **byte×4スロットのuint32パック（LSBから）**、
  重み合計=255、**indices は 1-based**（0 = 影響なし、boneTransforms[0]=単位行列）
- 変形式: `Σ(w/255 × boneWorld × invTendonBind) × skinBind × 頂点ローカル座標`
- 自動ウェイトは点-線分距離の 1/(d+1)^4。減衰が緩いとボーン影響が薄まり曲げが弱くなる
- C2Dレンダラ（プレビュー）はメッシュ描画にシームが出る。**本番プレイヤー（WebGL/Skia）では出ない**

## Data Binding / ViewModel（読み取り実装済み・書き込みは未実装）

実装: `src/dataBinding.ts`（デコーダ、`riv_inspect` の `dataBinding` フィールドとして合流）。
出典: rive-runtime `src/file.cpp` / `src/importers/*.cpp` / `src/viewmodel/*.cpp` /
`src/data_bind/*.cpp` と `dev/defs/**/*.json` の `"runtime"`/`"typeRuntime"` フラグを実際に読んで検証
（defs.json 自体にはこの帰属規則までは書かれていない）。

### 重大な既知の罠: `List<Id>` フィールドの直列化

`sourcePathIds`（DataBindContext）や `path`（DataBindPath）等 `type: "List<Id>"` のプロパティは、
`typeRuntime: "Bytes"` で `CoreBytesType`（id=1、**FIELD_STRING と同一の wire type**）直列化される
（varuint長 + 生バイト列。中身は varuint(LEB128) を詰めただけの数値配列）。
`rivBinary.ts` の `fieldTypeOf()` は元々これを未知の default 扱いで `"uint"`（単一varuint）と誤判定しており、
**DataBindContext を含む .riv を読むとその1プロパティで即座にバイトずれが起き、以降のオブジェクトストリーム
全体が破壊される**バグだった（`riv_dump`/`riv_inspect` 双方に影響。このタスクで修正済み: `List<`
で始まる型は `"string"`（＝FIELD_STRING）として読み、`decodeVaruintList()` で中身をさらに `number[]` に
デコードする。生バイトは roundtrip 用に `raw` にも保持）。

### オブジェクトの所属規則（フラットなストリーム上の ImportStack 方式）

ViewModel系オブジェクトの親子関係は `parentId` ではなく、他の箇所（KeyedProperty→LinearAnimation、
StateTransition→直前のstate）と同じ「ストリーム上で直前に出現した該当オブジェクトに帰属する」規則で決まる
（rive-runtime の `ImportStack::latest<T>()` に相当）:

| 子 | 帰属先 | 備考 |
|---|---|---|
| `ViewModelProperty*` | 直前の `ViewModel` | 子の出現順 = その ViewModel 内でのローカルindex |
| `ViewModelInstanceValue*` | 直前の `ViewModelInstance` | `viewModelInstanceId` は **runtime:false（ファイルに存在しない）**。所属はストリーム位置のみ |
| `ViewModelInstanceListItem` | 直前の `ViewModelInstanceList` | `instanceListId` も runtime:false |
| `DataEnumValue` | 直前の `DataEnumCustom` | `enumId` も runtime:false。**`DataEnumSystem` には帰属しない**（rive-runtimeのEnumImporterはDataEnumCustomにしか積まれない） |
| `FormulaToken*` | 直前の `DataConverterFormula` | `formulaId` も runtime:false |
| `DataBind`/`DataBindContext` の target | **ファイル全体でこのオブジェクトの直前にある「DataBindではない」オブジェクト** | `targetId` は **runtime:false（ファイルに存在せず、ランタイムも使わない）**。StateTransitionの「直前に書いたstateに帰属」と同型だが、こちらは（Artboard境界を跨いだ）ファイル全体でのグローバルな直前オブジェクト |

### Idフィールドの意味（グローバル通し番号 or ローカルindexか）

| フィールド | 意味 |
|---|---|
| `ViewModelInstance.viewModelId` / `ViewModelPropertyViewModel.viewModelReferenceId` / `ViewModelInstanceListItem.viewModelId` | **ファイル全体でのViewModelの出現順**（グローバル通し番号） |
| `ViewModelInstanceValue.viewModelPropertyId` | **所属ViewModelのproperties配列内でのローカルindex**（"normalized relative to the ViewModel itself" — dev/defsの説明そのまま） |
| `ViewModelInstanceViewModel.propertyValue` / `ViewModelInstanceListItem.viewModelInstanceId` | 参照先ViewModelの `instance()` ローカルindex（＝そのViewModelIdを持つViewModelInstanceの出現順） |
| `ViewModelPropertyEnumCustom.enumId` | **DataEnum/DataEnumCustumのみを積んだグローバル列**でのindex（`DataEnumSystem`は含まれない） |
| `DataBind.converterId` / `DataConverterGroupItem.converterId`/`groupId` | `object->is<DataConverter>()` なオブジェクト（`DataConverterGroupItem`・`FormulaToken*`系を除く）のグローバル出現順index |
| `DataBind.propertyKey` | 通常のpropertyKeyと同じ意味（targetオブジェクト上のどのプロパティにバインドするか） |
| `DataBind.flags` | `DataBindFlags`（`include/rive/data_bind_flags.hpp`）: bit0=Direction(0=toTarget/1=toSource), bit1=TwoWay, bit2=Once, bit3=SourceToTargetRunsFirst, bit4=NameBased |

### 実装上の要注意点

1. `ViewModel`/`ViewModelInstance` は Backboard直後・Artboard前に置かれることが多いが、
   フラットなストリームを1パスで舐めるだけの実装で正しく解釈できる（Artboard境界を意識する必要はない）
2. `ViewModel.viewModelOrder`/`defaultInstanceId`/`editingInstanceId`、`ViewModelInstance.x/y/onStage/order/export/isOverride`、
   各種 `order`（FractionalIndex型）はすべて **runtime:false = 実ファイルには一切書かれない**エディタ専用メタデータ。
   defs.json には載っているが、実データで出現することはない
3. `DataEnumSystem`（組み込み enum。`enumType` で種別を識別）は `DataEnumValue` を持たない。
   値は defs.json だけからは分からないランタイム内蔵テーブル由来なので、バイナリ解析だけでは列挙できない
   （`src/dataBinding.ts` は `systemEnums` として `enumType` のみ返す）
4. 生成（create）側は未実装。読み取り専用（`riv_inspect` の `dataBinding` フィールド）
