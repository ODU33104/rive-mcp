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

## Data Binding / ViewModel（読み取り・書き込みとも実装済み）

実装: `src/dataBinding.ts`（デコーダ、`riv_inspect` の `dataBinding` フィールドとして合流）。
書き込み（create側）: `src/rivWriter.ts` の `viewModels`/`viewModelInstances`/`dataEnums`/
`ArtboardSpec.viewModel`/`ArtboardSpec.viewModelInstance`/各スペックの `bind`/`binds`。
2026-09-15 時点のステータスは本節末尾「create側の既知の状況」参照。
出典: rive-runtime `src/file.cpp` / `src/importers/*.cpp` / `src/viewmodel/*.cpp` /
`src/data_bind/*.cpp` と `dev/defs/**/*.json` の `"runtime"`/`"typeRuntime"` フラグを実際に読んで検証
（defs.json 自体にはこの帰属規則までは書かれていない）。

### sourcePathIds の意味（DataBindContext.sourcePathIds、List<Id>）

rive-runtime `src/data_bind/data_context.cpp` の `DataContext::tryGetViewModelProperty(instance, path)`
を実際に読んで検証（2026-09-15）:

```cpp
ViewModelInstanceValue* DataContext::tryGetViewModelProperty(
    rcp<ViewModelInstance> instance, const std::vector<uint32_t>& path) const
{
    if (instance == nullptr || instance->viewModelId() != path[0]) return nullptr;
    if (path.size() == 1) return nullptr;
    rcp<ViewModelInstance> current = instance;
    for (auto it = path.begin() + 1; it != path.end() - 1; it++) {
        auto v = current->propertyValue(*it);
        if (v != nullptr && v->is<ViewModelInstanceViewModel>()) {
            current = v->as<ViewModelInstanceViewModel>()->referenceViewModelInstance();
            if (current == nullptr) return nullptr;
        } else return nullptr;
    }
    return current->propertyValue(path.back());
}
```

- `path[0]`: バインド先インスタンスが属する ViewModel の**グローバル通し番号**（instance側の
  `viewModelId()` と一致しないと即 `nullptr`。ガード用で「辿る」対象ではない）
- 中間要素（あれば）: 現在の ViewModel インスタンス内の**ローカルpropertyIndex**を1段ずつ辿り、
  その値が `ViewModelInstanceViewModel`（ネストしたViewModel参照）ならその参照先インスタンスへ降りる
- 最後の要素: 最終的な ViewModel インスタンス内での**leafプロパティのローカルindex**
- **非ネスト・直接バインドなら `[vmGlobalIndex, propLocalIndex]` の2要素で足りる**
  （中間ループが0回実行され、ガード通過後すぐ最後の要素で引く）

### Artboardの既定ViewModelバインドはファイルの記述だけでは自動適用されない

`Artboard.viewModelId`/`viewModelInstanceId`（ファイルに書く値）は「どれを使うつもりか」という
データに過ぎない。低レベル `@rive-app/canvas-advanced` の WASM API はこれを自動では適用しない
（`autoBind: true` は上位ラッパー `@rive-app/canvas` 側の機能）。このプロジェクトのプレビュー
（`src/pageScript.ts`）では明示的に `file.defaultArtboardViewModel(artboard).instanceByIndex(0)` →
`stateMachineInstance.bindViewModelInstance(vmi)` を呼んで対応している
（`Artboard.bindViewModelInstance()` もあるが、`sm.advanceAndApply()` 経由の描画には
`StateMachineInstance` 側へのbindが要る）。**複数インスタンスを持つViewModelでは常にindex 0を
プレビューする既知の制限**（ファイルの `viewModelInstanceId` を低レベルAPIから読む手段が無いため）。
ViewModelを持つArtboardは `stateMachineCount()` が1になる（"Auto Generated State Machine" という
ランタイム合成のSMが常に見える）。

### create側の既知の状況（2026-09-15時点、数値バインド・ネストVM・リスト・コンバータ・bool可視化すべて解決済み）

実測（`riv_create` で生成→公式ランタイムで描画して確認）:

| ターゲットのフィールド型 | 例 | 結果 |
|---|---|---|
| `Color`（`SolidColor.colorValue`） | fill色バインド | ✅ 正常に反映される |
| `String`（`TextValueRun.text`） | テキストバインド | ✅ `string`型プロパティなら正常に反映される（ただしフォントsubsetは`run.text`の文字だけを見て作られるため、バインド先の実際の文字列に無い文字はtofuになる — `run.name`の既存の注意点と同じ。`subset:false`か想定文字を明示すること）。**`enum`型プロパティのバインドは動作しない**（実測で確認・2026-09-15訂正: 一度「動く」と誤報告したが、実際に描画画像を目視したら配線元の値ではなく静的な初期テキストのままだった。ピクセル数だけを見て「何か描画されている」を「バインドが効いている」と誤認したのが原因。`propertyKey`・`sourcePathIds`は他の型と同じ経路で正しく解決されているが、ランタイム側で`ViewModelInstanceEnum`（Id型）から`String`ターゲットへの暗黙変換は行われないらしい。`DataConverterStringFormat`のような文字列化コンバータもこのdefs.jsonには存在せず、v1では未対応として諦めた） |
| `double`（`WorldTransformComponent.opacity`） | 不透明度バインド | ✅ 正常に反映される |
| `double`（`ParametricPath.width`） | 幅バインド | ✅ 正常に反映される（color+width+opacityの複合バインドを1ファイルで同時に動作確認済み） |
| `bool`（`ShapePaint.isVisible`） | Fill/Strokeの表示/非表示バインド（`fill.visibleBind` / `stroke.visibleBind`） | ✅ 正常に反映される（true→塗りが見える、false→消える、を中心ピクセルの実測で確認済み）。Rive公式ランタイム(このバージョン)にはComponent/Node単位の汎用可視性プロパティが無く、bindable boolなフィールドは`ShapePaint.isVisible`が実質唯一なため、これがv1のboolean配線先 |
| ネストしたViewModel参照（`ViewModelPropertyViewModel`/`ViewModelInstanceViewModel`） | `source: "profile.col"` のような `.` 区切りパス | ✅ 正常に反映される（2階層のVM参照を辿って葉プロパティにバインドできることを実測確認） |
| `DataConverterRangeMapper`（`DataBindSpec.converter`） | health 0-100 を width 0-160 にマップ | ✅ 正常に反映される（コンバータ無しの直接バインドと同一の描画結果になることをピクセル単位で実測確認）。**コンバータオブジェクトはconverterIdを参照するDataBindより前、かつ配線対象オブジェクトより前（target-adjacency解決を壊さないため）に書く必要がある**（詳細は実装コード内コメント参照） |
| `ViewModelInstanceList` | 複数の`ViewModelInstanceSpec`を配列で束ねる | ✅ 書き込み・`riv_inspect`での読み取りとも正常（`riv_lint`も0件）。**ただし視覚的な消費経路（繰り返し表示・nested artboardのリストバインド等）は本プロジェクトに無いため、現状は「定義してインスタンスを持たせられる」だけの書き込み専用機能**（将来nested artboardのリストバインドを実装する時の土台） |

### コンバータのconverterIdが「参照する側より前に必ず出す」必要がある理由

`ViewModel`/`ViewModelInstance`と同じ「ファイル全体でのその型の出現順」というグローバル通し番号方式
（`docs/riv-format.md`の他の節参照）は、**その番号を持つオブジェクトが実際にその時点までにストリーム上へ
出現していて初めて意味を持つ**（indexは「今まで何個出たか」のカウンタであり、後方に置いても解決してくれる
仕組みは無い——parentId等のローカルindexと同じ構造上の制約）。そのため `emitConverterIfNeeded()` は
配線対象オブジェクト（Fill/SolidColor/Shape/Rectangle等）を push する前に呼ぶ設計にしてある。また
コンバータをDataBindContextの直前（対象オブジェクトとDataBindContextの間）に置くと、target-adjacency解決
（「直前の非DataBindオブジェクト」）がコンバータ自身を誤ってtargetと解釈してしまうため、必ず対象オブジェクト
より**前**（対象オブジェクトとDataBindContextの間ではない位置）に置く。

**調査の過程で分かったこと**（再調査時に同じ道を辿らないためのメモ。真因は末尾参照）:
- DataBindContextオブジェクトのストリーム上の位置（targetの直後）は自前デコーダで実際に確認済み。
  target・propertyKey・sourcePathIdsはopacity/width双方とも正しく解決されている（Shape/Rectangleを
  正しくtargetとして指している）。「書き込み位置がズレている」という仮説は**否定済み**
- `ViewModelInstanceNumber.playbackValue`（`propertyValue`と並ぶもう1つのフィールド）を
  `propertyValue`と同じ値で明示的に書いても症状は変わらない（**試したが直らなかった**。ただし
  安全な変更なのでコードには残してある）
- `sm.advanceAndApply()`に加えて`ab.advance()`も明示的に呼んでも症状は変わらない（**試したが
  直らなかった**、この変更はrevert済み）
- サブエージェントによるrive-runtimeソース調査（`DataBind::update()`→`ContextValueNumber::apply()`→
  `CoreRegistry::setDouble()`）では、target型の検証が一切無くpropertyKeyだけで分岐することを確認。
  ただしこの経路はkeyframeアニメーション（既存機能、動作確認済み）とも共有されているはずの汎用
  double書き込み経路であり、「この経路自体が壊れている」という説明は既存機能との整合性が取れない。
  真因は依然として未特定（source値解決の別経路の疑いが強いが未確認）
- 次に調べるなら: rive-runtimeの `Artboard::advance()`/`Component::advanceComponents()` が
  DataBindオブジェクトをdirty-graphにどう組み込むか（`DataBind::initialize()`の「collapsable」
  登録の仕組み）。ここがopacity(Shape直下)とcolor(Fill/SolidColor)で扱いが違う可能性がある
- ランタイムのバージョンアップ（2.38.5→2.42.1）で古いバージョンでの`function signature mismatch`
  クラッシュは解消したが、これは副次的な効果で根本原因ではなかった（後述）
- コンバータ（`DataConverterRangeMapper`の恒等変換）を明示的に付けると旧ランタイムでのクラッシュが
  避けられることがあったが、これも副次的な効果（オブジェクトの並び・サイズが変わって偶然壊れた
  メモリ領域を踏まなくなっただけ）で、根本原因ではなかった

**真因（2026-09-15判明・修正済み）**: 数値バインドだけ「値が反映されない/クラッシュする」ように
見えていたのは、Rive公式ランタイム側の不具合ではなく、**`src/rivWriter.ts`側のバグ**だった。
`DataBind`/`DataBindContext` は `Component` を継承しない（`vendor/rive-defs/defs.json`:
`DataBind.extends = null`）ため、rive-runtime の `ArtboardImporter::addDataBind()` は
`addComponent()`（=アートボード内ローカルIDを消費する経路）を通らない。ところが `emitArtboard()`
内の `push()` は、DataBindContextを書いた場合も無条件に `localIndex` を進めてしまっていたため、
**DataBindContextより後に出力した全オブジェクトの`parentId`が実際のランタイム側ローカルindexと
1つズレる**という副作用が起きていた。

- color/stringバインドが「動いて見えた」のは、その配線先（SolidColor/TextValueRun）がいつも
  そのシェイプの最後尾に出力されていたため、後続オブジェクトのparentIdがズレる被害が無かっただけ
- width（Rectangle直後にDataBindContextを書く）のケースでは、後続の Fill / SolidColor の
  parentId が +1 ズレ、**SolidColorが自分自身をparentにする不正な状態**になり、塗りが一切付かず
  何も描画されなくなっていた（「値が反映されない」のではなく「オブジェクトが描画されない」が実体）
- 旧ランタイム(2.38.5)で発生していた `function signature mismatch` クラッシュも、ズレたparentIdが
  型の異なる親オブジェクトに接続された結果と説明が付く

**修正**: `emitArtboard()` に `pushNoId()`（`objects.push()`のみでlocalIndexを進めない版）を追加し、
`emitDataBind()` はこちらを使うよう変更（`src/rivWriter.ts`）。`push()`は`LinearAnimation`/
`KeyedObject`/`StateMachine`等、他の非Componentオブジェクトにも使われている（現状は全Component出力
後に配置されるため実害無し）が、同じ地雷なので新しい書き込みパスを追加するときは要注意。

この調査の過程で「Rive公式ランタイム側の不具合」と誤認し `github.com/rive-app/rive-wasm` に
issue #426 を立ててしまったが、原因判明後に事情を説明してclose済み。**教訓**: fill色（常に
配線先がシェイプの最後尾に来る）だけで検証して「動く」と判断し、他のケース（配線先の後に
別オブジェクトが続く場合）を検証しないまま「ランタイムの型別の不具合」と早合点した。
**新しい書き込みパスを検証するときは、「配線先が常に同じ相対位置に来る」ケースだけでなく、
「配線先の後にさらに他のオブジェクトが続く」ケースも必ず含めること**（このプロジェクトの他の
stream-adjacency系コード全般に言える教訓）。

### 副産物: アニメーショントラックの width/height が Shape 相手だと無効だったバグ（修正済み）

この調査中に発見。`riv_create` の `animations[].tracks[]` で `property: "width"/"height"` を
rect/ellipse/triangle の Shape に対して指定すると、**Shape自身の `LayoutComponent.width/height`
（key=7/8）に書き込んでいたが、実際に描画サイズを決めるのは実体（Rectangle/Ellipse/Triangle が
継承する `ParametricPath.width/height`、key=20/21）で、両者は無関係の別プロパティ**だったため、
アニメーションが見た目に一切反映されていなかった（image/text/nested相手のwidth/heightアニメは
LayoutComponentが正しいターゲットなので影響なし）。`src/rivWriter.ts` の `pathIds` マップで
rect/ellipse/triangle相手のときだけ `ParametricPath` へリダイレクトするよう修正済み（実描画で
確認済み）。polygonはwidth/heightの概念が無いため対象外。

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
4. 生成（create）側は実装済み。「create側の既知の状況」節参照
