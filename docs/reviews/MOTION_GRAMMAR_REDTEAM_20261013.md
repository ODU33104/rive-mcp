# Motion Grammar / Part Atlas / 自動組み立て構想：独立Red-Teamレビュー

**審査日:** 2026-10-13（JST）  
**対象コード:** `ODU33104/rive-mcp` の未統合PR [#53](https://github.com/ODU33104/rive-mcp/pull/53)、`feat/motion-recipe-atlas`、審査時head `3db224bbbfc29d7676165e077b169be4b84aa9f5`。読書用coord branchは実装審査の基準にはしていない。  
**方法:** feature branchのファイル本文、PR #54–57、当該headのGitHub Actionsジョブログ、Rive公式ドキュメントの一次資料を実際に照合した。ローカルclone/独立CLI実行/ブラインド美的評価は**未実施**。CIログの実行成功と審査者による実行を混同しない。  
**証拠リンク:** 以下のrepository file URLはいずれも固定headの行番号を指す。表内の閾値・工数は実測値でなく明記した提案。

## 1. 総合判定

**NO-GO：提案の5層を所与として全面実装し、Part Atlasを増殖させ、汎用の一発高品質生成を製品として約束することには反対。**

**10営業日の反証実験だけはGO。** 実験はアーキテクチャ承認ではない。勝者がより単純な「完成sceneの検索・編集」ならPart Grammarへの投資は取りやめる。

- **確認済事実:** catalogは60の汎用的な動きのレシピ、18外部source pointer、322個のtrack segment。使うpropertyは`opacity`140、`scaleX`60、`scaleY`45、`y`41、`x`24、`rotation`12の6種類に限られる。role名は125種あるがgeometry/asset/pivot/attachment/parent constraintを持つ部品としては定義されていない。[catalog実データ](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/catalog.v1.json#L135-L202)、[recipe validator/compiler](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L306-L374)。
- **確認済事実:** SOLSTICEは特定の時計シーンをJSで直接作画したもの。`scene.json`は720×460、palette、copy、duration等の設定であり、それ単独で部品とanimationが復元できるScene Blueprintではない。[gold builder L39–59](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L39-L59)、[scene.json L1–38](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/samples/motion-atlas-gold/scene.json#L1-L38)。
- **確認済事実:** 固定headの[検索CI](https://github.com/ODU33104/rive-mcp/actions/runs/38319528081)のジョブログは、106開発用プロンプト（93回答可能・13abstain）で**Top-1 86/93=92.5%**、**Top-3 90/93=96.8%**、正しいabstain **11/13=84.6%**、禁則Top-1 **3/106=2.8%**、禁則Top-3 **17/106=16.0%** と報告。分母・計算式は[evaluator L21–62](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/evaluate-motion-retrieval.mjs#L21-L62)と[106問のラベル](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/query-benchmark.v1.json)で確認した。18件時のTop-1 **88/93=94.6%** から60件時は**2問悪化**。106問は作者が作り、調整したセットで外部holdoutではない。[PR #56](https://github.com/ODU33104/rive-mcp/pull/56)、[評価文書](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RETRIEVAL_EVAL.md#L24-L48)。
- **確認済事実:** [60件/GIF CI](https://github.com/ODU33104/rive-mcp/actions/runs/38319528078)の同headログは60件検証、拡張42件の固有語smoke 42/42 Top-1、42件コンパイル、Storyboard、82枚/18fpsの実Rive runtime frame render、GIF生成に成功。[Gold Runtime CI](https://github.com/ODU33104/rive-mcp/actions/runs/38319528119)は45,426-byteのRIVE file、109 shapes、30 tracks、inspect・PNG render成功を示す。これは**実行可能性**の根拠であり、美的評価・自動部品結合・可逆性の証明ではない。
- **推論:** 現行の作画品質を支えるのは腕時計専用に手書きされた階層、配色、文字組、光と影の一貫性であって、60 role recipesの増量ではない。
- **未検証仮説:** 汎用分解＋再合成は、同一アセットと予算で完成scene編集や公式RML直接生成を上回る。現状、比較する独立ブラインド評価がない。

## 2. 致命的な欠陥 Top 5

### P0-1. 再利用性を「見た目の良さ」の代理にしている

**事実:** レシピはlayout、artwork、rig、asset選択を作らないことを開発文書自体が認める。[MOTION_RECIPE_ATLAS L31–38](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RECIPE_ATLAS.md#L31-L38)、[MOTION_RECIPE_EXPANSION L15–22](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RECIPE_EXPANSION.md#L15-L22)。

**推論:** 分解でグローバルな空白・フォーカス・素材感・フォントメトリクス・光源/陰影・一体化された時間演出が失われる。局所的に良い部品は全体として平凡または雑然となり得る。

**倒す条件:** 同一LLM/アセット/生成予算で完成scene編集baselineに初回作品のブラインド評価で勝てないなら、汎用Grammarへの投資を止める。

### P0-2. 「partの同一性」と可逆的組立の契約がない

**事実:** catalogにrole、relative property tracksはあるが、形状参照、local frame、pivot、attach port、scale許容範囲、mask依存、asset hashを保証するpart schemaはない。既存`GroupSpec` は`id/x/y/parent/rotation/scale/clipBy`を持つが独立pivot fieldを持たない。[writer L154–166](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166)。

**推論:** world/local行列、親回転とnonuniform scale、degree/radian、z、clip、text metrics、subpath/easing、SM/data/eventを保持しなければ元sceneを復元できない。単なる「名前とタグ」の部品が増えるだけなら虚構の成長。

**倒す条件:** SOLSTICE一件の真のdecompose→新しいmanifest経由rebuildですら実ランタイムの階層とフレームの一致が取れない。

### P0-3. role→track bindingの暗黙baseは配置破壊を招く

**事実:** `compileRecipe` は`binding.base`がなければ`x/y/rotation=0`、`scaleX/Y/opacity=1`を仮定する。targetから実際のlocal transformを取得せず、x/y/rotationには`base+offset`を出力する。[recipe L338–355](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L338-L355)。

**反例（静的計算で確認、現行デモ実行の主張ではない）:** SOLSTICEの`watch` groupは`(522,233)`。[gold L45–53](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L53)。catalog`ambient-float`の`y 0→-11`をこのwatchへ`{target:"watch"}`だけでbindすると、absolute yは`0→-11`となり、必要な`233→222`ではない。[catalog L1671付近](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/catalog.v1.json#L1671-L1746)。未来の自動bindingにはscene introspectionとlocal/world単位ゲートが不可欠。

### P0-4. 動的状態を単なるキーフレーム文法で代用する

**事実:** recipe validationは6種以外のpropertyを拒否。[recipe L313–320](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L313-L320)。一方、SOLSTICE自身は`trimEnd`、`trimOffset`、`width`を使い、writer`TrackSpec`も対応している。[gold L194–219](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L194-L219)、[writer L328–345](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L328-L345)。Storyboardは同一lane重複を拒否、別loopをoneShotと同じAnimationSpec内で合成できない。[storyboard L60–89](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs#L60-L89)、[MOTION_STORYBOARD L51–73](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_STORYBOARD.md#L51-L73)。

**推論:** hover/click、view model data、transitions、parallel loops、interrupt policy、reduced-motionは別のBehaviorContractを要する。静的SceneGraph・時間clip・振舞いSMを1つの「primitive」へ押し込むべきでない。

### P0-5. 無制限な増量は権利・検索・品質の負債を蓄積する

**事実:** 18→60で同じ106問におけるTop-1が88→86。拡張42件のspecific-cue smokeは未知プロンプト試験ではない。rankerは`expansionVersion=v2`を、具体語一致なら+10、なければ-9とする。[recipe L293–303](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L293-L303)。外部作品34件の個別権利台帳は**CC BY表示確認10 / restricted10 / unknown14**。link許可34、attributed-adaptation候補10。埋込アセットまでは自動で許諾されない。[source-candidates-2026.json](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/source-candidates-2026.json)、[PR #54](https://github.com/ODU33104/rive-mcp/pull/54)。

**推論:** title/タグ増量は新規ユーザー意図のcoverageを保証せず、長尾品質・誤検索・権利リスク・レシピ間競合が増える。数をKPIにしない。

## 3. 前提の誤り・証拠不足

| 前提 | 一次資料で確認できること | 判定 |
| --- | --- | --- |
| 分解可能＝再合成可能 | SOLSTICEにはvector/node hierarchyがあるだけで、lossless semantic extraction・rebuild fixtureなし | **未証明** |
| 再合成可能＝初回作品が高品質 | .rivとPNG/GIFは生成成功。人間による比較評価なし | **未証明**。審美はレンダリングの動作確認で代替できない |
| 60件＝60完成作品 | 60件は`roles/steps`。完成作画は元の小デモ3種と別途手書きSOLSTICE等 | **誤り** |
| 否定文・程度・制約を理解する | 近傍regexとlexicon、加減点。[recipe L230–303](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L230-L303) | **部分対応**。「背景は動かすな」「秒針だけ」等のhard contractはない |
| 106問Top-1が一般化の証明 | 正解は`acceptableTopIds`複数を許す開発set、禁止IDあり、実際の生成結果を評価しない | **誤り**。holdout、capability/制約、作品品質が未計測 |
| 既存writerが静的図形程度しか表現できない | `Shape/Group/Bone/Constraint/Nested/Track/SM/ViewModel` が存在。[writer interfaces](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L147-L464) | **誤り**。不足は意味/結合契約と品質選択でありwriter機能の多くは既にある |

**確認済の文書ドリフト:** [MOTION_RETRIEVAL_EVAL L5](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RETRIEVAL_EVAL.md#L1-L5)はまだ18件と記載し、[MOTION_GOLD_SCENE L102–109](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_GOLD_SCENE.md#L102-L109)は作成当初のプレビュー未実施を記す。しかし固定headのCIでGold runtime成功は確認済み。古い文書の文言を現状の失敗と誤読しない。

**未検証仮説:** 少数の優秀なsceneをasset/slot化して派生させる方が、一般primitiveから組むより一貫したart directionを維持できる。以後の比較で反証する。

## 4. 代替アーキテクチャ比較

同一LLM・同一元アセット・同一viewport・同一推論budget・同一審査で比較。工数は1人の開発者が既存資産を利用する**仮推定**であり法務/新規アート作画は含まない。

| 候補 | 品質についての推測（未検証） | 代表的な限界 | MVP差分工数 | 採否 |
| --- | --- | --- | --- | --- |
| **A：権利クリア済完成scene検索＋部分編集** | 既存の構図、色、光、文字組を保持でき、初回品質で強い可能性 | 全く異なる題材への自由度が低い | 2–4人日 | **第一ベースライン/先行** |
| **B：手続き的template＋局所拘束solver** | 時計/計器/UIなど規則的題材に強い可能性 | テンプレート外の表現で弱い | 3–6人日/1ジャンル | **限定採用候補** |
| **C：LLMが公式RMLを都度生成→CLI previewで選抜** | 新規題材と自由度に強い可能性 | 反復コスト/画力/構造安定性 | 1–3人日で比較用harness | **必須ベースライン** |
| **D：汎用Part Atlas＋Motion Grammar＋Constructor** | 真のcross-scene再利用が成立すれば強い可能性 | asset resolver、座標、意味、style、権利、状態、lossless rebuildの全課題を新たに負う | 汎用版は2週間では実現不可 | **全面NO-GO、1scene検証のみ** |
| **E：独自Editor/RML/CLIを再実装** | 公式以上の品質となる根拠がない | 競合/保守コストが大きい | 大・未計測 | **Reject** |

**推論/提案:** A＋Cを主経路に、Bから必要最小限のtyped slotsだけを共有する。Dはブラインド勝利を証明した部品領域のみ追加する。「Intent→Blueprint→Part→Motion→Grammar」を固定の五層DBとして先に実装しない。Scene Constructorは候補選択・生成・検証を司る**オーケストレータ**でよい。

## 5. 修正版の具体アーキテクチャ

**最小構成案（未実装）:** `Prompt/Hard Constraints → Anchor Scene/Template Retrieval → Typed Slots＋Style Tokens＋Rights Gate → Optional MotionClip / BehaviorContract → 公式RML/CLI Build → Runtime Checks＋Blind Candidate Selection → Editable deliverable`。外部アセットの取得はpermission gate通過後だけ。公式がすでに持つauthoring/renderingを複製しない。

### 5.1 宣言的契約の最低限

```yaml
IntentContract:
  subject: wristwatch
  purpose: premium-launch
  hardNegatives: [no-bounce, only-second-hand-moving]
  preferences: { style: quiet, quality: premium }
  output: { editable: true, viewport: [720, 460] }
SceneAnchor:
  id: solstice/v1
  sourceUri: source://scene.rml  # 提案形式。現行SOLSTICEの実ソースはJS builder
  sourceHash: required
  assetRefs: [asset-hash-with-font-license]
  styleTokens: { palette: required, typography: required, focalRegion: required }
Slot:
  id: watch.dial.seconds
  semanticType: rotating-indicator
  sourceNode: smallSeconds
  localFrame: { units: px, axis: y-down, angleUnit: degree, origin: [0, 45] }
  ports: { pivot: [0, 0], parentAnchor: dial.secondsCenter }
  constraints: { coincident: dial.secondsCenter, z: above-dial }
  requiresCapabilities: [pivot-rig, rotation]
  exposes: [angle, angularVelocity]
  visualDependencies: [centerPin, dialContrast]
MotionClip:
  targetPort: watch.dial.seconds.angle
  unit: degree
  durationMs: 1000
  loop: true
  interruptPolicy: preserve-phase
BehaviorContract:
  kind: timeline | state-machine | data-driven
  inputs: []
  reducedMotionPolicy: explicit
RightsManifest:
  sourceUrl: required
  licenseEvidenceUrl: required
  assetHashes: required
  permittedOperations: [inspect, adapt, redistribute]  # 別々に許諾確認
  embeddedAssetClearance: required
```

**推論:** `localFrame/ports/capabilities/constraints`を持つslotでなければ適用前に意味・幾何の適合が検証できない。時計針とイヤホンstemが同じ細長いpolygonであることは互換性の根拠ではない。

### 5.2 実装/Rive capability対応と責務

| 契約 | 既存Rive writer側 | 可能なこと | 追加検証/不足 |
| --- | --- | --- | --- |
| transform、親子、pivot | `GroupSpec/ShapeSpec`、[writer L949–1007](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L949-L1007) | group原点をpivotとして親子TRS合成、度→ラジアン | 座標系の正規化、再親付け、attachment一致検査 |
| appearance | `ShapeSpec` path/subpaths/gradient/clipBy/blend/z、`TextSpec`。[writer L209–290](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L209-L290) | vectorと描画階層 | グローバルstyle、フォント/改行/字間、光・影/maskの移植契約 |
| rig/constraint | `BoneSpec`、IK/followPath `ConstraintSpec`。[writer L172–194](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L172-L194) | 一部rig、path追従 | asset type別の必要capabilityと拘束の検査 |
| animation | `TrackSpec/AnimationSpec`。[writer L312–348](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L312-L348) | trims/colors/path vertices/widthなどを含む多くのtrack | atlasの6property制限とstate/time relations |
| input/event/state/data | `StateMachineSpec`、listeners、`viewModel`。[writer L349–404](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L349-L404) | inputs、transitions、VM、nested | recipeとは別のBehaviorContract、runtimeでのイベントテスト |
| nested modularity | `ArtboardSpec.nested`とNestedStateMachine。[writer L1393–1412](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L1393-L1412) | nested artboards | exposed data/slot compatibility |

**公式の一次資料確認済:** [Rive CLI overview](https://github.com/rive-app/rive-docs/blob/main/cli/overview.mdx)、[Commands](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx#L47-L104)、[AI Agents/AGENTS.md](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx)、[.rev→RML/push/pull](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx)。CLIはRML作成、`--verify`、`inspect`、`--screenshot`、`--test`、`--bench`、`--data`/`--pointer`/`--key`/`--advance`/`--data-dump`、push/pullを提供する。公式の任意ファイルについて完全無損失roundtripを保証する資料は**未確認**であり、審査側で保証を推測しない。

**各層のゲート（提案）:** (1) 著作権・asset hash・操作別permission、(2) hard negativesと能力照合、(3) attach point、world/local matrix、bbox、z/clip、text overflow、(4) transition/loop/input/reduced motion、(5) 公式CLI build/inspect/実描画/疑似入力検査、(6) 人間ブラインド比較。公式の実行機能を自前で量産せず、独自のadversarial test case生成、差分比較、失敗最小再現、証跡保存に集中する。

## 6. SOLSTICEの具体的分解と再合成の問題点

次は**既存コードに根拠を持つ少なくとも3段階の意味的再編**。`[実]`はコード内の実在group/shape、`[案]`は新規semantic assemblyであり、今そのgroupが実装済みとは主張しない。

```text
Scene SolsticeChronograph [実 artboard]
├─ Environment [案]
│  ├─ atmosphere [実 group]
│  │  ├─ atmosphericBloom / ambientGlass [実 gradient ellipses]
│  │  └─ architecturalRule0..4 [実 stroke paths]
│  ├─ orbit [実 group]
│  │  └─ orbitHalo / orbitTrace / orbitSatellite [実]
│  └─ watchShadow [実 group, watchの子ではない]
│     └─ groundShadow / groundPenumbra [実 ellipses]
├─ Watch-object [案; 実nodeはwatch]
│  ├─ Strap [案] -> strapUpper/Lower + 4 seams [実 primitive paths]
│  ├─ Case [案] -> caseDepth/Metal/Chamfer/Gasket + crown* [実 primitives]
│  ├─ Dial [案]
│  │  ├─ dialPlate/InnerRing/subDial/subDialRim [実 shapes]
│  │  ├─ indices [実 group] -> index0..59 [実 paths]
│  │  ├─ hourHand [実 group] -> hourNeedle/Facet [実 paths]
│  │  ├─ minuteHand [実 group] -> minuteNeedle/Spine [実 paths]
│  │  └─ smallSeconds/Pin + centerPin* [実、秒針groupなし]
│  └─ Finish [案] -> bezelGlint + dialSignature/Label/Footer [実]
└─ Editorial-copy [案]
   ├─ masthead [実 group] -> brand/edition [実 text]
   ├─ headlineA/B [実] -> heroLine1/2 [実 text]
   └─ caption/footer [実] -> subheading/features/footerLeft/Right [実]
```

**事実:** 現行の13groupは[gold builder L45–59](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L59)、時計は[L101–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L101-L165)、時間演出30 tracksと単一Showcase stateは[L187–227](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L187-L227)。`watch`のgroup原点(0,0)が時計中心で、`hourHand/minuteHand`を同じlocal(0,0)に置くから回転支点が成立。`smallSeconds`は`watch`直下の固定strokeであり、独立rotation groupもtrackもない。**「秒針だけ生きている」は現行sceneのrole bindでは作れない。** ただしwriter自体なら専用group追加で実装できる。[gold L150–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L150-L165)。

**因果依存:** 針のpivotは`dial.center`と一致、subdial秒針の軸は局所(0,45)。watchShadowは`watch`から独立したroot group、初期位置watch=(522,233)、影=(521,414)で、影にはopacity/scaleX trackはあるが、watch移動への自動追従拘束はない。bezelGlintはwatchのtrimmed ringであり、対象曲面・光源・clip/mask・zを移植可能な仕様として記録していない。完成sceneの印象は、右側時計と左側文字組のグローバルな空白・色・コントラスト・フォントまで依存。[gold doc L24–49](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_GOLD_SCENE.md#L24-L49)。

| 置換する3種以上のpart | 別題材 | 足りない契約と具体的反例 |
| --- | --- | --- |
| hour/minute/seconds hand | 高級イヤホンのstem/nozzle | 時計中心の周期回転には耳・caseに対する意味がない。左右ペア、stem方向、重心/接触/充電ケースとの関係が必要。**針のスイープをイヤホンに流用するのは誤演出** |
| dial/case/bezel | イヤホンshell | 同心円、60目盛り、crownは捨てる。shell曲率、局所軸、mask/法線に沿うハイライト、shadowが必要 |
| watchShadow/optical glint | イヤホン/抽象計器UI | 光源、曲率、投影、親への追従、clip、z-orderが未定義。計器には軌道が合っても「静かな高級イヤホン」では過剰になる |
| editorial-copy | 通知UI | 文字の読上げ順、狭いviewport、文言/data更新、state transition、字間/改行が異なる |

**Roundtripに保存必須（提案）:** source/asset hash、font/license、viewport、geometry/subpaths/cubic、paint/gradient/blend/clip/z、ローカルTRSと合成順・pivot frame・角度単位、SM layers/inputs/transitions、VM/data/listener/event、timelines/FPS/easing/loops、text shaping/改行、nested refs、元nodeと新slotの可逆mapping、CLI/runtime version。`scene.json`だけでは腕時計の形もanimationも復元できずJS専用builderが必須。新しいmanifestでdecompose→rebuildを実行する器は**未実装**。元JSをそのまま二度ビルドしたbyte決定性はこの実験の代わりにならない。

## 7. 拡大の中止基準

| 指標（全て提案閾値） | Gate / 中止条件 |
| --- | --- |
| 外部freezeした80問のTop-1 | 新規追加後に**2ポイント超**悪化したら投入停止 |
| 禁則違反 | forbidden Top-1 **≤5%**、Top-3 **≤10%**。critical capability misapplicationは**0件**。現行開発セットでTop-3は16.0% |
| OOS abstain | 非対応/関係ない独立20問で **≥90%**。未対応3D/cloth/ネットワークを近いroleへ誤割当しない |
| 新意図coverage | 追加20件で以前不可能な新意図の実装成功が**+10ポイント以上**、単なるタイトル語一致は不合格 |
| reusable part | 実shape/assetが別sceneでattach、render、constraint PASSして初めて実働1件。単なる役割名、タグ、source linkは**0件扱い** |
| ライセンス | 作品・埋込画像・字体・コードごとのlicense evidence、permitted operation、SHA、取得日、reviewer必須。unknown/restrictedはquarantine・link-only |
| 美的品質 | 同一budgetの完成scene改変にブラインド**8/12 cases以上**で勝てないならGrammar拡張は中止 |

**推論:** 60→150→300→1000への拡大では、sourceごとの監査/描画確認コストは少なくとも件数に比例し、意味が近い候補間の組合せ衝突はcluster内で急増する。たとえば**仮に**1レシピの執筆＋権利/描画レビューが2–5hなら300件追加で600–1500人時。これは実測コストでなく拡大を正当化する前に計るべき原価の目安。1000件をマイルストーンにしない。

**データ責務（提案）:** raw reference ledger（linkと著作者）→rights-cleared asset registry（content hash）→semantics別clusterとgeometry/motion dedup→maturity gate（reference-only / structurally mapped / compile-ready / rendered / cross-scene reused / blind-rated）→段階検索。公開リンク/ライブラリMITは具体的作品・埋込画像・フォントの再配布許諾を意味しない。公開例を「参照」「改変」「コード同梱」「自動大量取得」に分け、禁じられた操作はしない。

**他形式のloss（推論、率は未測定）:** SVGは静的pathには役立つがstate/dataやtimingはない。Lottieはkeyframes/mask/pathを一部表現できてもRiveのVM/SM/eventsへ無損失とは言えない。CSSはcascade・DOM bounds、GSAP/ReactはJSの時点イベント・layout・network状態に依存する。これらをRiveへ移すには形状と振舞いの両方の差分テストが必要。変換loss率や万能asset抽出の実証なしに大量自動取り込みを始めない。

## 8. 2週間以内で結論が出るMVP実験計画

**前提:** 1人×10営業日≈80開発時間、既存SOLSTICEと権利確認済資産を再利用。新規アート作画・法務・外部評価者の工数は別。以下の閾値は事前に凍結する**探索的go/no-go基準**であり、小標本で統計的な一般化保証を主張しない。

### E1：初回出力のブラインド比較（Day 1–5）

- **最小サンプル:** 未見6 prompts（静かな時計、成功、イヤホンlaunch、抽象計器、通知、タイポグラフィ）×A=現行60 recipe、B=完成anchor scene編集、C=part/grammar試作×2 seeds＝**36出力**。全方式で同じLLM・同じ権利済アセット/フォント・viewport・candidate count・推論時間予算を指定。
- **計測:** 5人のblind ratersによる美観/題材適合/一貫性、編集可能性（形状・text・motionの改変可能項目）、否定条件違反、実生成wall-time・token・修正回数。CとBを12 prompt×seed対で比較。
- **続行:** CがBに多数決で**8/12以上**勝ち、hard constraint違反**0**、Bの2倍以内の時間・コスト、scene生成不能≤1/12。
- **中止:** 上のいずれか未達。Bが勝ったらD案は中止し完成scene編集を採用。
- **成果物:** frozen prompt/asset/seed manifest、36scene・runtime PNG/GIF、匿名採点CSV、cost/failure ledger。Aへの不利な追加アセット差をつくらない。

### E2：SOLSTICE分解→実再構成（Day 2–6）

- **最小サンプル:** SOLSTICE **1scene**。Case/Dial/Hands/Glint/Shadow/Typographyのsemantic groupingをmanifest化し、**新しいslot接続経由**で同じ720×460・60fps・4.5秒を再構成。元JSをそのまま再実行するのは不合格。
- **baseline:** 同一headのオリジナル、同一font/renderer/runtime、0, 0.7, 1.5, 2.3, 3.3, 4.4秒および中間を含む**30フレーム以上**。
- **計測:** CLI inspectでparent path、object identity、pivot matrix、SM、keyframe/trim、assetsを比較。全比較フレームで**SSIM≥0.995かつRGB平均絶対差≤2/255**を提案閾値とし、文字/マスク/重要パーツ欠落は単独fail。ピクセル閾値は同renderer/同描画条件でのみ有効。
- **中止:** 1重要assemblyでも復元できない、または画素/構造gate fail。再合成不能なら汎用転用の主張を棄却。
- **成果物:** manifest、可逆node map、元/復元RML/.riv、runtime inspect/diff heatmap、loss list。

### E3：異題材への転用を敵対的に比較（Day 5–8）

- **最小サンプル:** 時計→イヤホン、時計→抽象計器、成功→通知UIの**3方向×2 prompts=6 cases**。B=完成scene直接改変とC=Part/Grammarで、同じ素材・時間・LLMを使用。
- **計測:** 3人blind judgesの意味的自然さ、attach point・shadow・clip・viewport、禁止演出の有無、手直し時間、新規描画必要率。
- **続行:** C優位**≥4/6**、物理・意味のcritical誤用ゼロ、大量の手描き補正不要。
- **中止:** イヤホンstemに時計針回転を誤適用、case/影/glintの分離破綻、2/6以上でBより修正コスト増。
- **成果物:** before/after Rive sourceと動画、評価CSV、最小失敗再現。

### E4：60→仮80の検索/権利gate（Day 6–9）

- **最小サンプル:** 本番DBを変更せず20の新規candidateを仮追加し、既存106問とは別の**凍結80問**（既存意図40、新意図20、否定/OOS20）で現60対仮80を比較。labelsは独立作成・二重レビュー。
- **計測:** Top-1/3、禁則Top-1/3、OOS abstain、coverage、cluster collision、権利と各candidateの実行可能性。
- **続行:** Top-1の低下≤2pt、禁則Top-1≤5%/Top-3≤10%、OOS abstain≥90%、新意図coverage +10pt、critical capability errorゼロ。
- **中止:** いずれか未達。既存106問と新20件の固有語smokeは回帰診断に限定。
- **成果物:** 凍結benchmark、score traces、confusion/abstain matrix、rights manifest、失敗類型。

**Day 9–10 判定:** E1で完成scene Bに勝たないか、E2/E3/E4のhard gateを通らなければ**汎用Part GrammarはNO-GOのまま**。全通過しても「対象題材に限るtyped slot template」の段階導入だけ承認し、150/300/1000件への自動拡大を承認しない。

## 9. 優先順位

| 判定 | アクション | 粗い工数推定と根拠 |
| --- | --- | --- |
| **Build now** | official CLI+既存writerを使う同条件の3手法比較harness、凍結prompts/metrics | 12–20h。既存binary generatorとRive render CIを再利用 |
| **Build now** | SOLSTICE 1件限定のsourceHash/localFrame/pivot/attachment/rights manifestとroundtrip | 16–24h。既存の13 groups/109 shapes/30 tracksをfixtureにする |
| **Build now** | 独立80問＋否定/能力gate＋異題材試験 | 12–20h。既存eval harnessを再利用 |
| **Build now** | 作品/埋込素材の許諾状態のgate適用 | 4–8h（法律審査/新規権利取得は別） |
| **Defer** | embedding index、全形式importer、汎用layout solver、多ジャンルrig inference | E1–E4で品質改善が測れるまで設計費をかけない |
| **Defer** | 150→300→1000 recipe件数拡大 | quantity KPIを停止。maturity/holdoutを先に導入 |
| **Reject** | Editor clone、独自RML代替、公式verify/inspect/benchの単純な再実装 | 公式CLIと重複し、競争上の差がない |
| **Reject** | GIF存在、roleタグ数、CI greenを美的品質の証拠とする | 別の測定軸を混同 |
| **Reject** | 権利不明公開例の自動大量取得、派生物の再配布 | 公開URLは操作許諾ではない |

上記は共有基盤を用いて10営業日/約80hに制限し、余剰を未見不具合の調査に配分する。高品質の新規アート3–5作品をこの工数内に納品できると想定しない。

## 10. 独立審査の最終提言

**判定はNO-GO。** 今の60 recipesが実行できることは認める。しかしユーザーの真の目的は「一度の自然言語指示で、予想以上の美的完成度を持つ編集可能Rive作品」である。局所モーションの数・semantic tags・GIFの成否はそのKPIではない。SOLSTICEの魅力があるとすれば、それは専用に手書きしたアートディレクション・形状・文字組・時系列の一体性が作っているのであって、Part Atlasの自動組立が成功したわけではない。

**最重要反証点は3つ:** (1) 完成sceneの編集baselineに同条件の美的評価で勝てるか、(2) SOLSTICEを本当にdecompose/rebuildして元に戻せるか、(3) 時計→イヤホンへの置換で意味・物理・視覚の破綻を回避できるか。負けたら一般Part Atlasを諦め、完成sceneとtyped slotを公式RML/CLIへ接続する。

**残すべき独自性:** 公式Rive CLI/RML/MCPは作成・compile・inspect・render・testを担当する。`rive-mcp`の戦場は**adversarial state/constraint exploration、roundtrip/visual diffの独立証明、failure corpus/minimal reproduction、権利・能力に基づく安全な候補選択**。公式と作者の自己評価を越えた**第三者的な検証**に集中する。

### 調査対象・一次資料・限界（追跡表）

- **確認済:** [PR #53](https://github.com/ODU33104/rive-mcp/pull/53)はhead `3db224b`時点でopen/main未統合。[PR #54 権利](https://github.com/ODU33104/rive-mcp/pull/54)、[#55 SOLSTICE](https://github.com/ODU33104/rive-mcp/pull/55)、[#56 検索](https://github.com/ODU33104/rive-mcp/pull/56)、[#57 60件](https://github.com/ODU33104/rive-mcp/pull/57)はいずれもfeature branchにmerge済。
- **確認済実ファイル:** [catalog](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/catalog.v1.json)、[motion-recipe](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs)、[motion-storyboard](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs)、[gold builder](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs)、[scene.json](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/samples/motion-atlas-gold/scene.json)、[rivWriter.ts](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts)、[MOTION_RECIPE_ATLAS](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RECIPE_ATLAS.md)、[MOTION_STORYBOARD](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_STORYBOARD.md)、[MOTION_RECIPE_EXPANSION](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RECIPE_EXPANSION.md)、[query benchmark](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/query-benchmark.v1.json)、[retrieval evaluation](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/docs/MOTION_RETRIEVAL_EVAL.md)。
- **確認済CI:** [retrieval](https://github.com/ODU33104/rive-mcp/actions/runs/38319528081)、[60 recipes/GIF](https://github.com/ODU33104/rive-mcp/actions/runs/38319528078)、[gold runtime](https://github.com/ODU33104/rive-mcp/actions/runs/38319528119)の実ジョブログ。
- **確認済の公式一次資料:** [Rive CLI overview](https://github.com/rive-app/rive-docs/blob/main/cli/overview.mdx)、[Commands](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)、[AI Agents](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx)、[CLI Getting Started](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx)、[Data Binding](https://rive.app/blog/getting-started-with-data-binding)。
- **未確認:** 審査者の環境でのCLIコマンド再実行、GIF/PNGの主観的な美的採点、公式CLIの完全lossless roundtrip、実ユーザーの要求分布、外部例の全埋込アセット許諾、各形式変換のloss rate。CIログの合格をこれらの代用にしない。