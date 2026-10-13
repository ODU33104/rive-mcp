# Motion Atlas Architecture V4 — 関係的アートディレクションと時系列禁則の分離

2026-10-13 / **設計案、未実装** / 根拠: [ROUND 2](../reviews/MOTION_GRAMMAR_ROUND_2.md)。V3の可視target駆動に固執しない。主役は**完成scene編集A vs 公式RML直接生成B**の公平な競争であり、`rive-mcp`の差別化対象は「独立の敵対的検査と品質エビデンス」。

## 1. 変更の中心

| V3 | V4への変更 | 削った点 / 残した点 / 追加した点 |
|---|---|---|
| I2 Perceptual Target Backsolvingを主要探索の案内に | coarse targetは補助の**診断オプション**へ格下げ | **削る:** 数値一致最大化を品質proxyにすること。**残す:** 画面取得、領域可視化。**追加:** I4の関係グラフ + blind順位 |
| I3 Transform Witnessで幾何を証明 | node/world geometryの限定チェック | **削る:** これだけでshadow/text/clipも安全と言うこと。**残す:** 数値残差と時刻付きtrace。**追加:** 未対応物理/renderer差はUNKNOWN |
| `hardNegative:string[]` | parse結果を**対象/条件/時間窓/操作別のmonitor**へ変換 | **削る:** 入力文字列の存在をPASSと扱うこと。**残す:** 否定の優先度。**追加:** I5 automata、入力系列別禁止検査 |
| Scene Family / Capsule | 保守的な局所1slotに限定 | **削る:** 汎用部品登録・B自動経路選択。**残す:** 手動確認された同種familyでのみslot。**追加:** 不適用は試験分母に記録 |
| 候補生成Nとfallback | A/Bの通った作品だけ人間blind比較 | **削る:** fallbackを元経路の成功に算入。**残す:** 一度のpromptで内部反復。**追加:** ルート別成功/修正/遅延原価 |
| 作品収集 | reference-only quarantine | **削る:** reference sourceをそのままproduction candidateに変換。**残す:** 大量発見のレーン。**追加:** promotion前の可視relation/interaction試験 |

## 2. 順序と責務

```text
user prompt (once)
  ├─ IntentNorm: allowed motions, forbidden motions, subject functionality, output edits
  ├─ RightsDecision: per-source/per-embedded-asset/per-operation
  └─ routes:
      A scene-edit            [always baseline if usable]
      B official RML-direct    [always baseline if constructible]
      C single typed slot     [experimental, no silent cross-domain promotion]
      D shot-graph            [wildcard, budgeted challenger only]
   -> Authoring uses official RML/CLI or existing SceneSpec/rivWriter
   -> Official CLI verify/inspect/screenshot/test/bench [backend]
   -> Independent checks:
      TransformWitness(I3): geometry/pivot; UNKNOWN for unsupported constraints
      RelationLedger(I4): light/contrast/text/shadow/space/time consistency
      BehaviorAutomata(I5): no-bounce/no-confetti/only-X + SM/data/loop traces
   -> hard fail gate, editable check, multi-frame blind score
   -> select permitted quality winner OR decline (not fabricated proof)
   -> source+riv+png/gif+violations+minimal repro+cost ledger
```

### Authoring backend boundary

既存writerは [`Shape/Group/Bone/Constraint/Track/SM/ViewModel`](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L147-L464)をサポートし、`TrackSpec`は`trimStart/End/Offset`, `width`, `fillColor`, `followDistance`などに対応する。現行[recipe compiler L306–374](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L306-L374)の6 propertyおよび`base`暗黙0/1はそれより狭い。V4のsidecarは`SceneSpec`を拡張済みと主張しない。RMLもofficial [CLI commands](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)がcompile/verify/capture/state-drivingを担当し、自作CLIは置かない。Editorの`.rev`と`.riv`の編集形態は異なるため、編集できる証拠（編集後のソースが反映されること、node別テキスト/shape/timeline）を成果物ごとに測る。CLI独自改造はしない。

## 3. Contract v4サンプル（提案スキーマであり公式APIではない）

```yaml
schema: rive-independent-evidence/v4-experimental
source:
  route: A
  entry: scripts/build-motion-atlas-gold.mjs
  commit: 3db224bbbfc29d7676165e077b169be4b84aa9f5
  hash: COMPUTE_AT_TEST_TIME
  artboard: SolsticeChronograph
environment:
  renderer: PIN_VERSION_AT_TEST
  cli: PIN_VERSION_AT_TEST
  viewport: [720, 460]
  fps: 60
rights:
  grant:
    inspect: self-authored-evidence
    adapt: requires-asset-review
    embed: requires-font-review
    redistribute: pending
    train: denied-unless-explicit
  embedded:
    - id: inter
      hash: COMPUTE_AT_TEST_TIME
      clearance: unknown
witness:
  - id: hand-center
    child: watch/hourHand
    pointLocal: [0, 0]
    reference: watch
    referenceLocal: [0, 0]
    worldTolerancePx: 0.5
    frames: [0, 30, 101, 194, 269]
  - id: shadow-follow
    subject: watch
    shadow: watchShadow
    relation: projected-offset
    lightVectorArtboard: unknown
    resultIfUnknown: UNKNOWN
behavior:
  - id: only-seconds
    quantifier: all-visible-nodes
    allowNodePaths: [watch/secondsRig]
    propertyGroup: [world-transform,opacity,geometry]
    timeMs: [0, 4500]
    allowedDelta: {positionPx: 0.25, rotationDegrees: 0.25, opacity: 0.003}
    exceptions: []  # 意図的に登場演出も不許可
  - id: no-bounce
    targets: [watch]
    signal: world-hero-displacement-toward-final-position
    timeMs: [0, 4500]
    forbidden: [overshoot, extra-velocity-sign-reversal]
    tolerancePx: 0.5
  - id: no-confetti
    semanticObjectClass: independently-scattering-particles
    requireSemanticAudit: true
    onUnknown: BLOCK
artRelations:
  - id: readable-copy
    from: masthead
    to: headlineA
    kind: relative-font-hierarchy-and-visible-bounds
    viewportMarginPx: 12
  - id: shadow-hue
    from: watchShadow
    to: watch
    kind: projected-light-consistency
    onUnmodeled: UNKNOWN
decision:
  hardUnknownPolicy: block
  evaluateAt: [initial, intermediate, final, post-pointer, post-data]
```

**このfixtureは現在のSOLSTICEでPASSしないのが正しい。** [builder L150–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L150-L165)に独立`secondsRig`がなく、[builder L196–207](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196-L207)はwatchとhour/minuteが動く。実際の`watchShadow`はrootに独立し、その追従は本sidecarに自動解決できない。静的shape存在判定で秒針の独立motion成功と誤記しない。

## 4. RelationLedger (I4) の最小観測契約

全sceneの美学を機械採点できると考えない。画面を領域分割して`(fromNode,toNode,relation,frame,observed,evidenceCrop)`として記録する。

- **文字:** 見出し/captionのrelative size, contrast, clipping, visible bounding box, line count, 多言語glyph availability。実renderで範囲を測り、字形同定が無い場合は**manual audit**。画像に文字があるというだけで文面正しさPASSにしない。
- **素材感:** glintの進行方向/位相と時計caseの曲面、陰影方向と`watchShadow`のoffset相関。照明法線や材質が未定義ならscoreではなくUNKNOWN。
- **構図:** hero-copyの侵入面積、余白、視線誘導をフレーム連続観測。静止画1枚だけから時間の美しさを判定しない。
- **成功の条件:** R1-I2の区域スコアよりblind選好に一致し、欠損文字などを検知できること。違反を見逃せばscoreの係数調整に逃げず、機構を撤去する。

## 5. Behavioral Automata (I5) の最小観測契約

現行の[recipe selection](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L240-L303)は正規表現の否定加減点でしかない。否定/onlyは候補生成後に意味付きtraceで確認し、重要nodeが観測不可ならUNKNOWNでブロック。

`no-bounce`: "easing名を文字検索する" のではなく、実world-space対象の目標値を越える/目標方向の速度が余分に反転することを評価。easing名が`ease-out-back`でなくともbounceを検出できる仕様にする。ループ境界とintentional reversing gesturesは別の事前許可契約が必要。

`no-confetti`: 雲や雪、きらめきから禁止粒子を分類する際、node名による単純検出は不十分。複数の独立軌跡・広がり・寿命・方向・見た目の人手ラベルを合わせる。semantic classifierの未評価結果はPASS不可。

`only-second-hand`: 独立rig追加後も、外側watch/shadow/glint/copyのopacity/trim/width/positionを許可外の変化として検出する。watchに固定される他nodeはworld座標の運動を許さないという条件なら、parent animationも失格。clip、SM transition、ViewModel更新やpointer後に動く場合も検査対象。

## 6. 比較予算と停止条件

試験期間は**2週間・最大80hの技術検証枠**（法務、外部blind reviewer、新規アート制作は別見積り）。同一LLM、同じ権利済素材、同じrenderer/font/viewport、2候補、1修正、最大トークン/生成時間を固定する。A/B/C/Dの`not applicable`とfallbackを**分母へ**。8未見prompt×2 seedの16評価対で、複数判定者の画面盲検によりquality/distinctiveness/subject fitを評価する。

| 反証ゲート（すべて提案） | 続行 | 停止 |
|---|---|---|
| I4 | 6個の良/悪設計対でblind人間順位との整合≥5、欠損文字の全検出 | 4以下・見逃し発生→I4を除去 |
| I5 | 全9件の意図的motion禁則を検出、正常3件を誤FAILなし | 漏れ/誤拒否→critical gateとして未採用 |
| I3 | 親子rigの意図的+8px支点ズレ・非一様scale等を検出、runtime結果と一致 | false PASS→再構成拡大停止 |
| Route | 16同条件対でA/B baselineに対して有意義なブラインド選好増、hard failゼロ、追加原価≤2倍 | 追加層が優越性を示さなければA/B経路のみ |
| 新レシピ | 開発106件とは別に凍結80件、Top-1低下≤2pt、forbidden Top3≤10%、OOS abstain≥90%、新意図coverage増 | いずれかFAIL→本番昇格NO-GO |

少数サンプルで統計的な母集団優位を主張しない。閾値は試験前固定。**I4/I5の検証自体もまだ未着手で成功とは言えない。**

## 7. 意図的に残した大穴（R3の審査対象）

1. 参考作品を何千件集めても、関係台帳へ映像から**どの運動が価値を作ったか**を還元できなければ知識が増えない。
2. reference-onlyの大量発見レーンからproductionへ昇格できる証拠がなく、外部権利の調達がボトルネックになる。
3. semantic判定のfalse negative、styleの主観性、fresh domainの評価不能、公式CLIと既存writerの構造差が残る。
4. 監視機能を足すほど総コストが上がり、一度で素晴らしい作品を作る速度を失う。**薄い検証も元baselineより品質を下げ得る**。

**Round 3はこの設計の失敗例を収集・rights quarantineの実データから再点検し、成長経路の新機構を提出すること。**
