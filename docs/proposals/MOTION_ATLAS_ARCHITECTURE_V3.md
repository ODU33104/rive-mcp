# Motion Atlas Architecture V3 — 視覚目標を中心に据えた競争型生成実験

**2026-10-13 / 設計状態: 未実装の仮説 / R1審査:** [ROUND 1](../reviews/MOTION_GRAMMAR_ROUND_1.md)。V2の単純改稿ではない。**「Scene Family DNAを前提にしない」**を第一の差分に置く。

## 1. 製品目標、非目標とベースライン

一度の自然言語から、意味的に正しく、驚くほど見栄えがよく、ユーザーがRiveで**部品・文字・運動・状態**を編集できる成果物を内部反復で作る。公式CLI/RML/MCP/EditorのCRUDやrender機能を再実装する製品は作らない。

| route | 初手 | 失敗域 | V3での立場 |
|---|---|---|---|
| A: finished scene edit | 権利と編集許容範囲が確認された完成sceneを保持し、コピー・色・限定的motionを変更 | 題材逸脱、作者権利、未知のviewport | **最優先baseline** |
| B: typed scene family | 厳格に識別されたslotのみ差替 | watch専用形状を他物体と誤同一視、pivot | 挑戦者。1 slotを超えない |
| C: direct RML | 公式の言語/CLIで新しく造形 | 芸術的一貫性・出力costが不安定 | **同格のbaseline** |
| D: general Part Grammar | 普遍部品DBから組み上げ | geometry/asset/style/SMの全危険を背負う | **NO-GO対照群**、工数の大量配分禁止 |
| E: Shot-Graph program (R1-I1) | 完成sceneに頼らずshot sequenceから構図/時間を組む | 描画新規性と制作予算 | wildcard。A/Cを上回るときのみ昇格 |

## 2. 旧設計からの不可逆な変更

- **廃止:** `Scene Family DNA`が表現美を保証するという未証明の前提。caption/光源/時系列をmetadataとして宣言するだけでは品質評価に算入しない。
- **廃止:** motif capsuleの種類数を主指標にすること。watch-face交換は魅力的でも、時計→イヤホンの機能的互換性はない。
- **廃止:** Bに不利な場合でもBへfallbackして成功と数える会計。**routing decision / original route failure / fallback output**を個別記録。
- **導入:** 生成前に自作のvisual target mapを構成し、候補の実レンダリングから誤差の原因を返すR1-I2。
- **導入:** scene変換に対し時刻付きworld/local transformの残差証拠を出すR1-I3。
- **留保:** 未見題材に強いかもしれないR1-I1を1週間だけ、A/C同budgetで走らせる。

## 3. 生成・検査フロー

```text
one prompt
  -> intent parser: object / delivery / negated behaviors / disallowed assets
  -> permission manifest: operations=inspect|adapt|embed|redistribute|train [別々]
  -> coarse visual target: spatial boxes + salience over time
  -> generate A / B(適用可能時のみ) / C / E(wildcard実験のみ)
  -> official RML+CLI OR existing SceneSpec/rivWriter (explicitly tagged)
  -> verify/inspect + actual temporal captures in one pinned renderer
  -> transform witness for attach/pivot (unknown implies inconclusive, NOT PASS)
  -> aesthetic screen-target diagnosis, typography/clip manual audit
  -> blinded preference + hard negatives + rights + editable-contract
  -> winner or abstain with cause; evidence bundle
```

**禁止:** visual scoreでhard negativeやrights failを相殺しない。自動fallbackは入力を聞き返さない内部経路変更だが、元経路の失敗は隠さない。必要な外部素材の許諾がなければ自作ベクターの新規生成または権利が確かな材料に制限し、品質未達なら「良作品完成」と表示しない。

## 4. 提案プロトコル（現行SceneSpecへ直挿し不可）

```json
{
  "schema": "visual-route-experiment/v0",
  "requestId": "trial/watch-01",
  "intent": {
    "subject": "watch",
    "purpose": "editorial-launch",
    "hardNegative": ["no-bounce", "no-confetti", "only-second-hand-motion"],
    "deliverable": {"riveEditable": ["shape", "text", "animation"], "viewport": [720,460]}
  },
  "rights": {
    "sourceType": "self-authored",
    "evidence": "source://rights.json",
    "sourceSha256": "REPLACE_WITH_COMPUTED_HASH",
    "embeddedAssets": [{"id":"inter","hash":"REPLACE_WITH_COMPUTED_HASH","fontEmbeddingReviewed":false}],
    "allowed": ["inspect","render"],
    "denied": ["redistribute","train"]
  },
  "visualTarget": {
    "coordinate": "artboard-px-y-down",
    "keyTimesMs": [0, 900, 2300, 4400],
    "regions": [
      {"id":"hero","rect":[366,78,324,312],"centroidWeight":0.62},
      {"id":"copy","rect":[48,90,300,285],"contrastFloor":4.5}
    ],
    "rule": {"maxHeroIntrusionIntoCopy":0.03,"importantTextRequiresMarginPx":12}
  },
  "witnesses": [{
    "id":"hour-hand-axis",
    "nodePath":["SolsticeChronograph","watch","hourHand"],
    "attachLocalPoint":[0,0],
    "referenceNodePath":["SolsticeChronograph","watch"],
    "referenceLocalPoint":[0,0],
    "toleranceWorldPx":0.5,
    "sampleFrames":[0,50,100,194,269]
  }],
  "route": {"kind":"A|B|C|E","generatedFrom":"source-identity","attemptIndex":0},
  "evidence": {"renderedFrames":[],"violations":[],"humanBlindScores":[],"fallbackFrom":null}
}
```

これは検査用**sidecar manifest**であり、Riveの公式schemaや現行`src/rivWriter.ts`の`SceneSpec`ではない。部分実装の段階で不明なnode/rightsがあれば`unknown`にする。上述のSOLSTICE例は意図的に衝突例であり、現状の`smallSeconds`固定shapeに`only-second-hand-motion`を要求すれば**B経路は失敗しなければならない**（[builder L150–165, L206–207](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L150-L165)）。

## 5. 既存実装へのフックと責務

| 候補ファイル（新規、まだ存在しない） | 入力→出力 | 使う既存機能と限界 |
|---|---|---|
| `scripts/visual-target-probe.mjs` | PromptIntent→TargetMap→region/time診断 | 実PNGは現在のrender CIか公式CLI screenshot。ML審美の万能さは仮定しない |
| `scripts/transform-witness.mjs` | scene mapping + keyTimes→node world pointsと不変量差分 | [writer GroupSpec](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166)のTRSと、実runtime画面から独立に整合確認 |
| `scripts/shot-graph-probe.mjs` | ShotGraph→RML or SceneSpec | [official CLI](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)はcompile/inspect/verificationを担当。shot generatorは独自 |
| `scripts/route-eval.mjs` | same prompt/seed/assets/limits→公平なroute別ledger | [gold builder](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs)、[recipe compiler](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs)、[storyboard](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs)を検査対象とする。1本のStoryboardには独立loopを混ぜられない |
| `data/motion-eval/targets/*.json` / `cases/*.json` | frozen prompts/maps/rights/motion paths | 検索開発106問の再使用は禁止、別holdout |

**world transform最小式:** `world(node,t)=world(parent,t) × translate(x,y) × rotate(theta) × scale(sx,sy)`を仮実装後に既存runtimeの実点と照合して確定する。writerがdegreeとruntimeのangle unitをどう扱うかをinspectと描画で一致検査する。複数親、IK、path constraints、nestedの全姿勢はMVP範囲外、未対応は`unknown`とする。**clip/mask/テキストをこの式でPASSさせない**。影のworld followは独立関係式として別テスト。

## 6. 公平な実験、判定の閉じ方

- 1週間内: SOLSTICE 1局所操作・1壊したpivot・2未知題材×3ショット・6独立prompt。A/B/C/Eに同一asset/font/canvas、同一候補数2、同一総推論トークンと壁時計上限（暫定各10分）、同じ修正機会1回。Aの既存美術効果もCの原画不足も両方報告し、Bの適用不能はattemptとして分母に残す。
- **hard gate:** ライセンスの許された操作、編集可能Rive構造、no-bounce等否定と許容動作、子部品のpivot/親子とmask、時間ループ/状態遷移。未対応は敗退。pixel一致は同renderer/version/fontで同一シーン復元時だけ使用。
- **美的判定:** 少なくとも3名の無記名比較 + scene-wideの構図/明暗/文字組/焦点を別採点。低周波TargetMap errorは診断であり、人間の嗜好より優先しない。
- **暫定継続閾値（凍結前提）:** I2 ONがOFFに少なくとも4/6でblind優位、I3が事前注入pivot欠陥を全件検出、hard violation 0件、コスト増≤2倍。未達ならI2/I3を独立に棄却; 両者とも失敗ならA/Cのみを製品経路として残す。
- **証跡:** `generationAttempt.json`, source + asset SHA, PINしたCLI/runtime/font、複数時刻の画像、構造差分、blind票、手動編集チェック、予算、拒否理由と最小repro。新CIの結果はまだ存在しない。

## 7. Two-lane growthの扱い

大量の公開作品収集は**discovery-only**のリンク/観察記録として維持する。しかし本番候補の検索空間へはrights→構造→別題材再現→blind有用性を通った候補だけを入れる。膨大なreferenceが存在することを制作可能モーション数と勘定しない。近いrecipeを足す前にcluster collisionと禁則検索率を凍結holdoutで測る。

**V3の未解決P0:** 目標マップを最適化するほど均質で凡庸な「スコアの良い駄作」が生まれる危険がある。これをRound 2で最優先に攻撃する。
