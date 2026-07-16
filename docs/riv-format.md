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
| `stateToId` (StateTransition) | レイヤー内 state の出現順（書いた順。Entry/Any/Exit含む） |
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

## 画像・メッシュ（実装済み・検証済み）

- アセットは **Backboard の直後・Artboard の前**に `ImageAsset`（name/width/height）+
  `FileAssetContents`（bytes=PNG生バイト）のペアで書く。**ローカルindexを消費しない**
- `Image` drawable の `assetId` = ファイル内アセットの出現順 (0-based)
- `Mesh` は Image の子（parentId）。`triangleIndexBytes` は **uint16 LE** の頂点index三つ組
- `MeshVertex` は Mesh の子。x/y は画像中心原点の natural pixel 空間、u/v は 0-1
- MeshVertex の x/y は keyable。ただし propertyKey は **Vertex.x(24)/y(25)**（Node.x(13)/y(14) と別物）
- StateTransition の exit time: `flags=4` + `exitTime`（ms）で「遷移元アニメを指定時間再生後に遷移」

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
