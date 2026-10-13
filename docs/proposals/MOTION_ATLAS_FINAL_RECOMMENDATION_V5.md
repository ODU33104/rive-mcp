# Motion Atlas Final Recommendation V5 — Independent Evidence-Guided Rive Production

**2026-10-13 / 停止条件付き研究設計。限定MVP: CONDITIONAL GO、次段拡大: NO-GO (再評価待ち)、汎用Part Atlas: NO-GO。**

履歴: [V2](MOTION_ATLAS_ARCHITECTURE_V2_20261013.md) → [R1](../reviews/MOTION_GRAMMAR_ROUND_1.md) / [V3](MOTION_ATLAS_ARCHITECTURE_V3.md) → [R2](../reviews/MOTION_GRAMMAR_ROUND_2.md) / [V4](MOTION_ATLAS_ARCHITECTURE_V4.md) → [R3](../reviews/MOTION_GRAMMAR_ROUND_3.md) → 本V5。発明の一覧と主観スコアは[Innovation Matrix](../reviews/MOTION_GRAMMAR_INNOVATION_MATRIX.md)。

## 1. 製品目的と意思決定

一度の自然言語指示で、驚くほど美しく、意味・動作が正しく、ユーザーがRive内で文字・ベクター・motion/stateを編集できる作品を作る。レシピ件数、CLIのGreen、PNGが描けた事実を作品品質とは呼ばない。制作backendは公式RML/CLI（必要に応じ現行rivWriter）。独立した検証と反証・候補比較・失敗最小再現で差別化する。

**主要候補A/B:** (A) 権利済の完成scene編集、(B) 公式RMLで新規制作。**実験C:** 同じdomainの厳格な1 typed slot。**研究D:** wildcard shot-graph program。A/Bを基準として、C/Dが勝った範囲しか導入しない。fallback先A/Bの成功は元のC/Dの成功とカウントしない。未知題材に適した既存sceneが無い場合はRMLを検討するが、すべての候補がfailなら偽の良作品を納品せず不成立を報告する。

```text
one prompt
  -> intent + forbidden object/motion + deliverable
  -> per-source/per-asset/per-operation rights decision
  -> A finished-scene edit / B direct RML / C one-slot trial
  -> official CLI or existing rivWriter/SceneSpec
  -> official verify + inspect + screenshots + controlled inputs
  -> INDEPENDENT gates:
       I3 world/local pivot/parent/time witness
       I5 temporal negative and state/loop monitors
       I4 visible text/clip/material-shadow relation ledger
       license, editability, renderer reproducibility
  -> fail or unknown: reject candidate and archive min repro
  -> blind human preference across hard-pass works + actual cost
  -> editable Rive source & .riv & captures & evidence OR abstain

references (reference-only, many)
  -> independent causal reconstruction (I6)
  -> ablation and two-domain transfer
  -> only permitted & independently useful motifs enter small production set
```

## 2. 互いに重複しない新機構6件とV5での採否

| ID | 発明 | 生み出す新しい出力 | V5の採否 |
|---|---|---|---|
| R1-I1 | **Shot-Graph Program Synthesis** | scene anchorに依存しない時間ショット制約→編集可能なscene program | wildcard、試験のみ |
| R1-I2 | **Perceptual Target Backsolving** | 粗いvisual targetと候補renderの差による改訂指示 | 美的scoreではなく診断へ降格 |
| R1-I3 | **Temporal Transform Witness** | pivot/local-world/親子の時刻別数値証跡・違反frame | 限定MVPで優先検証 |
| R2-I4 | **Relational Art-Direction Ledger** | 光沢・影・文字組・余白の相対関係と実画面診断 | 診断に限定、blind評価で有効性が必要 |
| R2-I5 | **Behavioral Prohibition Automata** | no-bounce/no-confetti/only-Xの時相monitorと反例trace | hard gate候補、偽PASS時は撤去 |
| R3-I6 | **Causal Motif Distillation** | 参考作品の因果関係を自作で再実装・除去実験・異題材で評価した実働motif | discovery research laneのみから開始 |

I1はシーン生成方法、I2は絶対的視覚目標の逆探索、I3は座標証明、I4は美術要素**間**の関係、I5は許可運動の時相意味、I6は**参考から新しい制作知識を生産する介入実験**。V2のmetadata名付け直しではない。

## 3. Sidecar契約 v5（提案・未実装・公式RML schemaではない）

```json
{
  "schema": "rive-evidence-task/v5",
  "taskId": "holdout/quiet-watch-01",
  "intent": {
    "subject": "watch",
    "hard": [
      {"kind":"only-motion","allow":["watch/secondsRig"],"timeMs":[0,4500]},
      {"kind":"no-bounce","targets":["watch"],"timeMs":[0,4500]},
      {"kind":"no-confetti","semanticClass":"scattering-particles"}
    ],
    "delivery":{"editable":["shapes","text","animation"],"viewport":[720,460]}
  },
  "rights":{
    "source":"self-authored-solstice",
    "commit":"3db224bbbfc29d7676165e077b169be4b84aa9f5",
    "sourceHash":"COMPUTE_AT_EXECUTION",
    "embeddedAssets":[{"id":"inter","hash":"COMPUTE_AT_EXECUTION","fontClearance":"PENDING"}],
    "operations":{"inspect":"allow","render":"allow","adapt":"review","embed":"review","redistribute":"deny-until-reviewed","train":"deny-until-explicit"}
  },
  "attempt":{
    "route":"A","sourceFormat":"SceneSpec","backend":"rivWriter",
    "model":"PIN_AT_EXECUTION","candidates":2,"repairs":1,
    "fallbackFrom":null
  },
  "witnesses":[{
    "id":"hand-axis","nodePath":"watch/hourHand","localPoint":[0,0],
    "referencePath":"watch","referenceLocalPoint":[0,0],
    "frames":[0,101,194,269],"worldTolerancePx":0.5
  }],
  "behavior":{
    "sampleFrames":[0,1,30,60,101,194,269],"adaptiveExtrema":true,
    "probeInputSequences":true,"motionEpsilonPx":0.25,
    "opacityEpsilon":0.003,"unknownDisposition":"reject"
  },
  "relations":[
    {"kind":"visible-text-bounds","node":"headlineA","marginPx":12},
    {"kind":"shadow-projection","subject":"watch","shadow":"watchShadow",
      "lightVector":"UNKNOWN","onUnknown":"reject"}
  ],
  "results":{
    "build":"NOT_RUN","geometry":"NOT_RUN","negatives":"NOT_RUN",
    "rights":"REVIEW_REQUIRED","editable":"NOT_RUN",
    "blindAesthetic":"NOT_EVALUATED","evidence":[]
  }
}
```

**上記は現行SOLSTICEならfailすべき意図的fixture。** [builder L150–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L150-L165)に独立`secondsRig`はなく、[L196–207](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196-L207)では時計と短針・長針が実際にanimateされる。新しい秒針rigを別routeで造って初めて再試験する。sidecarを現行`SceneSpec`へ無検証で混入してはならない。

### 3.1 必須の厳密性

- **支点/親子:** `W_child(t)=W_parent(t) × T_child_local(t)`で、子anchor点と参照点を同じworld座標で比較。TRSの合成順・角度単位・parent nonuniform scaleとrotationは[writer GroupSpec](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166)とrendererで照合する。逆行列計算とreparent後の原点補償の誤差を実フレームで検証。IK、followPath、nested等未対応はUNKNOWN。world矩形の一致をsemantic互換の証明にはしない。
- **影・mask:** `watchShadow`は`watch`と別root（[builder L45–49](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L49)）。光源方向と投影追従、遮蔽/clip/visible pixelを検査する。nested artboardはすべてのclip sourceになれると仮定しない（[公式forum事例](https://rive.app/community/forums/support/fsnLLkXUaA62/clipping-with-nested-artboard/ft47bYuV1ZMH)）。
- **文字:** 実フォントのglyph範囲、wrap、visible box、letter spacing、行高をRive renderで確認。現行writerは[font subset L779–797](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L779-L797)で現在の文字列に絞るため、後から日本語等に差替える予定なら許諾済fontのglyph許容集合を広げるかsubsetをoffにして差替えrenderを再確認する。
- **運動:** easing名やrole名を禁止条件のPASS判定に用いない。実時系列の終点越え・速度符号反転・world位置・opacity/geometry・意図されないobject class・SM/VM入力後のtraceを用いる。独立loopは現行[storyboard](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs#L60-L95)の単一AnimationSpecでは合成できないので複数animation/SM layers等を検証する。

### 3.2 公式backendへ委譲する実行protocol

`propose`：A/B/Cのsource hash、asset permissions、同budget seed/候補数2/改訂1回を凍結。
`build`：RML projectは公式`rive <project> --verify`→`rive inspect`→`rive <project> --screenshot=... --advance=...`など。現行writerの`.riv`も公式runtimeで描画/inspectする。両backendが完全に同一仕様を実現すると**推測せず**実験で比較。
`drive`：公式CLI `--data/--pointer/--key/--advance/--data-dump`で入力と状態を追跡。`--bench`は`--screenshot`と併用しない。CLIフラグ・順序・fallback規則は[公式Command Reference](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)に従う。
`observe`：source+asset hash、CLI/runtime/font version、frame time、world path、可視mask/文字、入力trace、rendered PNGを保存。
`adversarial_verify`：I3/I4/I5、rights、編集可能性をPASS/FAIL/UNKNOWNの3値で評価。UNKNOWNを安全と置換しない。
`compare`：hard-passの作品だけ、同じ匿名blind評者で造形/タイポ/動作/意味/編集を相対比較。画面画像は美的優位の**素材**であり自動判定ではない。
`deliver_or_abstain`：編集可能な実ファイル、改変ソース、キャプチャと根拠を区別。綺麗なbitmapだけをeditable作品と言わない。適格作品ゼロなら不成立。

**Failure corpus**に`requestHash/route/backend+renderer+font versions/rights/sourceHashes/failingInputTrace/firstFailTimeMs/violatedNodePath/expected/observed/reproSequence/rating/cost`を保存。入力列をdelta debuggingで短縮し、最低限の公式CLI操作で同じ失敗を再生できる形にする。source/permissionが隠れた失敗は本番データとして再利用しない。

## 4. 権利gate（独立5種類）

| 作業 | 必要根拠 | 不明な場合 |
|---|---|---|
| URLリンク/観察 | 作品URL・作者・サイト規約、引用範囲 | 無許諾bulk captureしない |
| 改変/adapt | work単位の許可、帰属・派生物条件 | self-authoredの独立制作に切替 |
| アセットembed | 作品内画像/フォント/音声/ロゴ/コードごとの権利とhash | 該当asset利用を拒否 |
| 配布/公開 | 派生物・全embedded assetsの配布条件と帰属 | 公開用成果物に入れない |
| train/data learning | 明示的根拠、契約・サイト規約 | 学習データへ入れない |

現行[source candidates](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/source-candidates-2026.json)に34件（verified10/restricted10/unknown14）があるが、CC BYのwork-level表示は内包されたフォント等の許諾やtrainを確約しない。著作権法上の解釈やライセンスの現時点確認は専門家/原権利者の確認を要する。外部参照の数を`production-ready`にカウントしない。

## 5. 発見の拡大と制作の品質維持

```text
DISCOVERY (大量)
 link + metadata + observation + rights-per-operation [quarantine]
     │ I6: self-authored reconstruction of mechanism
     ├─ control variables / attachments / temporal relation
     ├─ ablation: remove glint/shadow/timing, measure difference blind
     ├─ two independent domains with no copied artwork
     └─ transfer safety + editability + source and asset rights
         ↓ only if evidence is positive
VERIFIED MOTIF (少数)
     ↓ frozen-holdout production success / no regression
PRODUCTION SEARCH
```

**新motif例:** `hero-visible → surface-glint delayed 140–300ms → copy reveal`はglintを取り除くと視線誘導が弱まるかを自作作品で盲検比較し、時計とイヤホンで異なるsurface geometryへ付け直せた場合だけ抽象motion関係として昇格。`60 indices spinning`は時計と計器で試してもイヤホンには禁止する。これは意味と依存を持たせた介入可能な再利用ルールであり、元作品のshapeを盗用しない。**介入の美的効果は未測定で仮説。**

## 6. 先行実装ファイル案・優先順位（このレビューPRでコードは変更しない）

| 優先 | 新設予定 | 責務 / 根拠 |
|---|---|---|
| P0 / Day1–2 | `scripts/route-eval.mjs` + `data/motion-eval/frozen-prompts.json` | A vs B vs Cの同予算manifest、route別分母とcost。既存[gold builder](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs)、[recipe compiler](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs)は観測対象 |
| P0 / Day2–4 | `scripts/transform-witness.mjs`, `test/fixtures/transform-witness/*` | pivot/parent反例を見つける。元builderの決定的再実行は新manifest分解復元の代替ではない |
| P0 / Day3–6 | `scripts/behavior-contract-monitor.mjs`, `test/fixtures/behavior-negatives/*` | no-bounce/no-confetti/only-X、state/loopの意味違反と最小入力trace |
| P1 / Day4–8 | `scripts/style-relation-ledger.mjs`, `data/motion-eval/style-relations/*` | relationごとの可視証拠、text/mask/shadow/style診断 |
| P1 / after blind gate | `scripts/visual-target-probe.mjs`, `data/motion-eval/targets/*` | I2 target-mapは診断だけに制限、blindで相関せねば廃止 |
| P2 / after E1–E4 | `scripts/distill-causal-motif.mjs`, `scripts/evaluate-motif-ablation.mjs`, `data/motion-motifs/{discovery,verified}/*` | rights-safe参考の因果蒸留、cross-domain再現に成功したものだけ承認 |
| Defer/Reject | `scripts/shot-graph-probe.mjs` はwildcardのみ、汎用grammar/独自CLI/editor/importerは実装しない | 公式backendとの差別化と負担を優先 |

## 7. 2週間で結論を出す実験と停止基準

総枠は提案上**10営業日80h**（外部blind reviewerの採点工数、法務と新規高品質アート作成は別枠）。

| 実験 | 工数 | 計測 | 採択/棄却 |
|---|---:|---|---|
| E1 SOLSTICE意味分解・復元 | 20h | Case/Dial/Hands/Glint/Shadow/Copyを別manifest経由でrebuild、同環境30+フレーム、parent/pivot/SM/clip。元JSを2回ビルドするだけは不可 | pixel SSIM≥0.995・mean RGB diff≤2/255かつcritical欠落ゼロ（提案）。**このpixel gateは美観には使わない** |
| E2 watch→イヤホン/抽象計器 | 16h | 各2 prompt、A/C/B、rig/光源/clip/タイポ/意味/編集可能性と棄却率 | critical意味/幾何違反があればそのtransfer domainはNO-GO |
| E3 actual-render A vs direct RML vs hybrid | 24h | 8未見prompt×2 seeds、同LLM/素材/候補数/修正/生成上限、5人blind評価、CLI inspect/多frame/入力trace、トークン/時間 | hybridがbaselineに多数決選好で勝てず、または追加原価>2倍/critical failならhybrid撤退。**別生成作品間でpixel一致を比較しない** |
| E4 仮+20recipe、凍結holdout | 12h | 旧意図40/新20/否定・OOS20の独立80問。Top1/3、禁則/OOS、実作品成功、rights、cluster collision | Top1低下>2pt、forbiddenTop3>10%、OOS abstain<90%、critical error、実作品の成功純増0で拡大停止 |
| 結論・failure corpus | 8h | route/rights/constraintとblind/修正コストの全失敗を可視化 | 予め定めた閾値未達またはblind未実施なら採用承認しない |

**ピクセル一致と美観は別軸**。同renderer/font/sourceのE1復元でpixelを使う。異題材やA/B/Cの美観は人間の匿名blind票/編集確認で判断し、非対称の初期アート費用はcost ledgerに計上。事前の閾値は探索用、小標本では普遍的勝利を主張しない。

## 8. 最終三分割

| 対象 | 判定 | 解除条件 |
|---|---|---|
| 限定MVP / A-B同条件比較 + 1slot + 独立検証 | **CONDITIONAL GO** | E1/E3の構造・品質・コスト、rights/editability/critical violationsを通過した対象範囲のみ |
| 次段規模拡大 / 20→150+知識候補 | **NO-GO (再評価待ち)** | E4の実生成coverage純増と悪化なし、I6の異題材2環境で効果の再現、権利と登録原価が妥当 |
| 汎用Part Atlas / Motion Grammar自動組立 | **NO-GO** | 現在は画力/普遍意味/可逆性の証拠なし。限定実験が成功しても一括GOにしない |

## 9. V2と最も違うこと、残る最大の穴

V2は高品質アンカー＋capsule/fallbackを伸ばす戦略だった。V5では**生成経路を決め打ちしない**。公式制作backendの上で、A/Bを勝者候補として対等に置き、I3–I5の独立反証で「見た目はあるが違反している」作品を拒否する。大量参照はI6の介入・異題材実証を通るまで制作知識に数えない。

**最大リスク:** 自動で生み出す作品の美観・意味適合を人間が優位と判断した独立holdoutが存在しない。確認済CIはファイル/PNG/GIF/検索ルールの動作成功を示すが「一度の指示で驚くほど良い作品が得られる」を証明しない。本V5はテスト成功の報告でなく、証拠によって投資を続けるか停止するための契約である。
