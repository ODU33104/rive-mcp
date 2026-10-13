# Motion Atlas Architecture V2 — 反証可能な再構成案

**日付** 2026-10-13 / **位置づけ** 意思決定前の設計仮説（実装済の主張ではない）  
**対象** `ODU33104/rive-mcp` feature branch `feat/motion-recipe-atlas`、親PR #53。  
**前提反証** 独立Red-Team PR #58 の **NO-GO** を受け入れ、以前提案した「Intent → Blueprint → Part Atlas → Motion Atlas → Assembly Grammar」の全面構築をいったん撤回する。

## 1. 目標・制約・既存事実

**唯一のプロダクト目標:** 一度の自然言語指示から、題材・意図・美的制約に合った**驚くほど良質で編集可能なRive作品**を出す。内部で複数候補・反復・ランタイム確認を実施するのは許容する。「レシピ件数」「成功CI数」それ自体を品質指標にしない。

実際の既存成果: 元のカタログ60件は **role→x/y/rotation/scale/opacity keyframe** のレシピであり、60の完成シーンではない。腕時計SOLSTICEは720×460・109 shapes・30 tracksの**題材専用JS builder**で生成し、公式Rive runtimeで描画できる。しかし部品交換や高品質の自動生成の一般性は未証明。以前の106開発問のTop-1は18件時94.6%から60件時92.5%へ悪化した。外部候補34作品に対して権利の区分があるが、参照許可と素材の再配布許可は異なる。

一次資料: [Red-Team review](https://github.com/ODU33104/rive-mcp/blob/review/motion-grammar-redteam-20261013/docs/reviews/MOTION_GRAMMAR_REDTEAM_20261013.md)、[PR #53](https://github.com/ODU33104/rive-mcp/pull/53)、`src/rivWriter.ts`、`scripts/motion-recipe.mjs`、`scripts/motion-storyboard.mjs`、`scripts/build-motion-atlas-gold.mjs`。

**技術上の危険:** `compileRecipe` はbindingsの`base`が無ければ座標をゼロとして仮定するため、実シーンを安全に結合できない。writerにはGroup/Shape/Bone/Constraint/Track/SM/VM等が既にあり、能力不足とデータ契約不足を混同してはいけない。時計の短針/長針の回転中心は親groupの原点で成立しているが、現在の小秒針は独立回転リグではない。

## 2. V2の主張：「完成した良い作品」をアンカーにして、意味のある一部分だけ交換する

汎用のPart Atlasを一気に作らず、次を**競合する実装経路**として保持する。

- **Baseline A / Scene Edit:** 品質が確認された完成シーンを探して、文字・色・形・速度を限定的に置換する（構図とアートディレクションを守りやすい）。
- **Candidate B / Typed Scene Family:** 完成シーンをScene Familyとして管理し、明示された`typed slot`・`motif capsule`だけ交換／再配置する。本V2の主要仮説。
- **Baseline C / RML-direct:** LLMが公式RMLを直接作り、公式CLIでビルド・プレビュー・修正する（新題材への自由度が高い）。
- **Challenger D / General Part Grammar:** 汎用の部品を意味とジオメトリから合成する。検証実験以外で全面構築しない。

品質実験の結果、AまたはCがBより優れていれば、**Bを棄却**する。V2が既定の勝者という扱いにしない。

## 3. 新しい設計概念（単なるタグ増量ではない）

### P1. Scene Family DNA（全体の芸術的統一性の契約）

個別の部品では消えるアートディレクションを最上位に持たせる。
`composition`（視線誘導と負空間）、
`typography`（フォント/最大幅/行高/折り返し/内容変更限界）、
`materials`（金属/ガラス/紙等の色・光・影の一貫性）、
`timingRhythm`（主役→説明→光沢の時間軸）、
`accentBudget`（過剰な装飾を抑える上限）、
`semanticDomain`（時計専用/イヤホン対応/計器対応等、許容域）を保持する。

**仮説:** 各部品が整合しても全体のアートディレクションが壊れる問題を防ぐ。**未検証**なので全体の品質比較で証明する。

### P2. Motif Capsule（部品より少し大きな、関係性ごと再利用する単位）

孤立した円や針だけではなく、例えば
`watch-face` = {dial, case, indices, hand pivots, pin, trims, glint, local animation, intrinsic bounds}、
`product-shadow` = {silhouette, projected falloff, z, attachment, follow relation}、
`editorial-copy` = {headline, caption, accent rule, line breaks, reveal order}
のように、**形状・依存関係・時間演出・美的規則をまとめた小さなまとまり**として保存する。

Capsuleはnested artboardや既存writer scene fragmentで表現可能な範囲に限定。Rive公式のEditor/CLI/RMLを再実装しない。

**重要:** `watch-face` をイヤホンへ適用するのは不正。Capsuleには`semanticDomain`と必要な`capabilities`、禁止される置換が必要。

### P3. Counterfactual Transfer Gate（意味的な誤適用を弾く）

AIが新しい題材に置換するとき、候補部品が
1. 意味（時計針の回転はイヤホンstemでない）
2. 幾何（重心・支点・attach points）
3. 画面（画面領域・読字・影・光源）
4. 時間（主役より前に飾りを出さない）
5. 権利（素材・フォント・埋込画像ごとの権利）
を満たすか先にチェックする。**確実な不適合は候補を棄却し、より安全なScene Edit/RML-directへfallback。**

### P4. Two-Lane Growth（大量収集と実行可能なカタログを切り離す）

大量の参考作品・アイデア収集には価値がある。だが検索候補に全件を混ぜない。

- `discovery/reference`: リンク、著作者、観察メモ、権利状態、動きの分解仮説。件数上限は設けないが、自動収集はサイト規約/権利を遵守。
- `candidate`: 独自記述または許諾済の部品/モーション定義。まだrender実証なし。ユーザー生成へ自動適用不可。
- `rendered`: 実物PNG/GIF/.riv、ビルド再現、構造検査済。
- `reusable`: 別シーンでのattach／破綻しない再レンダリング済。
- `quality-rated`: 複数盲検比較で効果を確認済。ここまでのものを優先検索。

**新しい学習ループ:** rendered failure → 原因（geometry/semantic/styling/timing） → 修正可能なmotif contract → 再試験 → versioned evidence。レシピを増やすのと同時に、役に立つ理由まで学習資産にする。

### P5. Budgeted Candidate Search（AIは一案だけでなく、限られた候補を比較）

ユーザー入力は1回。その内部で、A/B/Cから同じ計算・アセット予算で最大N案を出し、公式Riveでinspect/PNG/GIFを得て、hard constraintsを満たす候補だけをスタイル適合・構図・読みやすさ・独創性で比較して選ぶ。

**検証レイヤーの独自性:** adversarial prompt / taboo motion / failure corpus / minimal repro、runtime pixel diffとvisual QA基準。公式CLIの単純な再実装は不要。

## 4. 最小データ契約（提案であり既存APIではない）

```json
{
  "schema": "scene-family/v0-experiment",
  "id": "solstice/watch-launch",
  "source": {"builder": "scripts/build-motion-atlas-gold.mjs", "sha256": "<immutable-content-hash>"},
  "rights": {"source": "self-authored", "embeddedAssetsReviewed": false, "allowed": ["inspect", "render"]},
  "dna": {
    "subjectDomains": ["watch", "precision-instrument"],
    "layout": {"viewport": [720, 460], "heroRegion": [370, 85, 320, 310], "copyRegion": [50, 95, 315, 270]},
    "styles": {"palette": ["#07121B", "#DBB77B"], "maxAccentGroups": 3, "motionEnergy": "low"},
    "sequence": ["atmosphere", "hero", "copy", "fine-details", "rest"]
  },
  "slots": [{
    "id": "watch.hourHand",
    "semanticType": "clock-hand",
    "nodeIds": ["hourHand", "hourNeedle", "hourNeedleFacet"],
    "localFrame": {"units": "px", "xRight": true, "yDown": true, "angleUnit": "degree", "origin": [0,0]},
    "parentId": "watch",
    "ports": {"pivot": [0,0]},
    "capabilities": ["rotate-about-parent-origin"],
    "validDomains": ["watch", "analog-instrument"],
    "requires": ["dial", "centerPin", "faceContrast"],
    "limits": {"rotationDegrees": [-360, 360]},
    "allowOperations": ["rotation-reprogram", "style-token-change"]
  }],
  "motifs": [{
    "id": "precision-dial",
    "nodeIds": ["watch", "indices", "hourHand", "minuteHand", "centerPin"],
    "dependencies": ["font:inter", "dial-contrast", "local-pivots"],
    "temporalRules": ["watch-entry-before-indices", "dial-ready-before-hand-motion"]
  }]
}
```

`nodeIds`・`parentId`はwriter上の実在IDとの対応を検証する必要がある。現在のSceneSpecに自由に混ぜて動くわけではない。`embeddedAssetsReviewed`がfalseの間はredistribute不可。内部の秒針独立回転は現実のSOLSTICEにないので、このmanifestに**存在すると偽記しない**。

**最初の最小実装ターゲットは1つのslotだけ**。ソース内で`hourHand`のローカル座標と既存tracksを読んで、`rotation-reprogram`を適用したシーンを再構築できること。今のwriterが回転中心を外部pivot fieldとして公開していない点に注意する。部品を親付け変更するときはローカル→世界行列を保持し、フレーム差分と親子関係を両方検査する。全パーツ一般化の先行実装は行わない。

## 5. 優先パイプライン

```text
User one prompt
  -> Parse Intent & nonnegotiable negatives / delivery constraints
  -> Candidate routes A (scene edit), B (typed scene family), C (RML direct)
  -> Per-route asset rights + semantic-domain + capability gate
  -> Proposal scene/source with explicit node mapping and timed motion
  -> Official Rive CLI / existing rivWriter build
  -> Actual runtime render with tests of geometry, constraints, readability, loop/state
  -> Bounded candidate selection + correction; archive failure corpus
  -> Editable .riv + user-visible GIF/PNG + explanations
```

**フォールバック規則:** 設計契約を満たさないPart転用を黙って実施するより、完成シーン編集または公式RML生成へ切り替える。全モーションを1つのキーフレーム列で実装しない。interactive/data/state-machineは`BehaviorContract`として別扱い。

## 6. 初回の反証実験と中止判断

| ID | 対象 | 比較/検査 | 成功なら何が言えるか | 失敗したら |
|---|---|---|---|---|
| E1 | SOLSTICE 1 slot | 元→slot変更→同条件の公式Rive描画、階層、支点と運動を検査 | 小さなtyped slotの有効性 | slot構造の一般化を止める |
| E2 | 元シーン可逆再建 | 部品manifest経由でdecompose→rebuild、最低30frame render差分 | 当該sceneでの再構成可能性 | full Part Atlasを止める |
| E3 | 6件程度の未知prompt | A Scene Edit / B Scene Family / C RML direct、同一asset/model/budgetの匿名比較 | Bに品質の優位性があるか | A/Cを主経路として選ぶ |
| E4 | 時計→イヤホン・計器など | 成功/失敗と意味/装飾/影/支点の評価 | 転用できるmotifの限定範囲 | 過剰な意味転用を禁止 |
| E5 | レシピ追加 | 凍結した新規holdout、ライセンスgate、追加カテゴリcoverage測定 | 品質を落とさず拡張できるか | 実行検索側への昇格を止め、discoveryには残す |

**事前停止条件案:** critical semantic/capability violationゼロ、未見promptでBがA/Cと同等以上の美的品質、入力を再依頼せず完成可能、他ジャンル転用時に無理なPart流用をしない。実験が小さいため、勝敗は普遍的な優越性ではなく対象範囲の探索的判断。閾値は実験前にレビューで凍結する。

## 7. 提案者が認める弱点・未確定事項

1. `Scene Family DNA`を言語メタデータとして書いても、実際の美的整合性が上がるかは未証明。文字組・空白・光源などを検査可能な拘束に落とせないなら空疎なスローガンになる。
2. `Motif Capsule`を小さすぎれば一貫性が失われ、大きすぎれば新題材へ移植できない。最適粒度は実験依存。
3. 権利確認・埋込フォント許諾には追加の実務と人手がいる。参照先の高品質見本は自由に再配布できるわけではない。
4. 真に高品質なアート素材の生成・採用判断は現在不足。たくさんのrole definitionsを追加しても解決しない。
5. 低コストのRML-directが最も良いなら独自Grammarは価値を失う。正面から比較する。
6. 大量にレシピを収集する探索レーンの運用コストを計測していない。権利・重複・審査の維持管理負担を見積もる必要がある。
7. 差分検査は同一バージョンのrenderer・font・画面サイズ・fpsで行う。ピクセル一致と美的品質を混同しない。

## 8. ここからのレビューに期待する新提案

Red-TeamにはこのV2を否定する権限とともに、**少なくとも3つの本質的に別の新提案**を要求する。例えば、全体をScene Familyに寄せる必要すらない（探索的プログラム合成、motion-field制御、制約充足型の生成、部分画像を軸にした視覚逆解析、interactive state prioritizationなど）。名称変更は禁止。新しい設計は「新しい機構、既存コードのどこを変えるか、どう試して棄却するか」まで具体化する。

**V2は承認待ちの設計書であり、実装開始の許可ではない。**
