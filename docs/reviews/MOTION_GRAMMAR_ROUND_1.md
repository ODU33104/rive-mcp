# ROUND 1 — V2への独立反証とV3の発明

2026-10-13 / 審査対象: [V2](../proposals/MOTION_ATLAS_ARCHITECTURE_V2_20261013.md) / 判定: **V2のScene Familyを既定の製品中核とする案はNO-GO。描画先行の候補実験に限定してGO。**

## 0. 証拠の境界

- コードは未統合の [PR #53](https://github.com/ODU33104/rive-mcp/pull/53) の `feat/motion-recipe-atlas` head `3db224bbbfc29d7676165e077b169be4b84aa9f5` を参照した。coord側のmain相当コードに置き換えていない。[前回Red-Team](https://github.com/ODU33104/rive-mcp/blob/review/motion-grammar-redteam-20261013/docs/reviews/MOTION_GRAMMAR_REDTEAM_20261013.md) と [PR #58](https://github.com/ODU33104/rive-mcp/pull/58) も読んだ。
- [実CI検索](https://github.com/ODU33104/rive-mcp/actions/runs/38319528081/job/115044019711): 106開発問、top1 92.5%、top3 96.8%、forbidden top3 16.0%、60 recipesのaudit成功。[実CI描画](https://github.com/ODU33104/rive-mcp/actions/runs/38319528119/job/115044019677): 45,426 bytes、109 shapes、30 tracks、runtime inspect/PNG成功。[82-frame/GIF CI](https://github.com/ODU33104/rive-mcp/actions/runs/38319528078/job/115044019654) も成功。**いずれも美的品質/再構成の実証ではない**。CIのチェックアウトはPR merge refであり、静的なコード根拠は上記feature headを使う。
- 公式一次資料 [CLI overview](https://github.com/rive-app/rive-docs/blob/main/cli/overview.mdx)、[command reference](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)、[Agents](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx): `--verify`, `inspect`, `--screenshot`, `--test`, `--bench`, `--pointer`, `--data`, `--key`, `--advance`, `--data-dump`, RML、push/pull、AGENTS.mdは公式側の担当。完全losslessな任意rev→RML→rivを保証する記述は**未確認**。
- 本審査者はCLIや新規生成、主観ブラインド採点を**実行していない**。以下のスコア・期限・閾値は提案で、実測ではない。

## 1. V2を壊す優先度別の反例

| 深刻度 | 反証 | 根拠 / 具体的な破綻 | 中止すべき主張 |
|---|---|---|---|
| **P0** | 1. アンカー品質が未証明 | SOLSTICEは[gold builder L39–59](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L39-L59)の題材専用JSでsceneを描く。[`scene.json` L1–38](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/samples/motion-atlas-gold/scene.json#L1-L38)はpalette/copy/durationで、生成可能な形状Blueprintではない。綺麗な時計→綺麗なイヤホン、は推論の飛躍 | 家族化が一発生成の美観を上げる |
| **P0** | 2. 支点とモーションの契約がない | `GroupSpec` は親子/回転/clipを持つが独立pivot fieldはない（[writer L154–166](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166)）。時計の`hourHand/minuteHand`は時計中心(0,0)の子groupで成立。[builder L45–53, L150–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L53)。秒針`smallSeconds`は専用回転group/trackを持たない | `only-second-hand`を既存slot変更だけで満たせる |
| **P0** | 3. fallbackは成功でない | `Counterfactual Transfer Gate`が多数の題材をA/Cに送り直せばBは安全に「不採用」であり、品質優位の証明ではない。未見題材の適用率・棄却率を併記せねば、通った少数だけを選ぶ生存者バイアスになる | fallback成功率をBの成功率に算入 |
| **P0** | 4. ライセンスは推論不可 | catalogのsourceは原則`reference-only`（[recipe L306–313](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L306-L313)）。前回審査の34候補ではCC BY表示確認10、restricted10、unknown14。ただし参照/改変/素材組込/再配布/訓練を一括許諾とは扱えない | 作品リンクから合法に部品を自動抽出できる |
| **P1** | 5. 粒度の最適点がない | watch-face capsuleが大きければ時計に閉じ、小さければ影、裏蓋、ガラスの反射、タイミングが剥がれる。時計の影は`watch`と別root group（[builder L45–49](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L49)）。cue衝突時は[storyboard L60–95](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs#L60-L95)のtrack合成が失敗/bridge要求 | capsule単位が再利用の自然単位 |
| **P1** | 6. 検索の衝突 | 18→60で開発セットTop-1 94.6%→92.5%、禁則Top-3 16%。`selectRecipes`は近傍否定regexと重み付き語一致であり、hard negativesの検証器ではない（[recipe L240–303](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L240-L303)） | カタログを増やせば一発品質も上昇 |
| **P1** | 7. 美的品質に作用しないDNA | `accentBudget:3`は余白、反射位置、読みやすさ、材料の照明連鎖を保証しない。`progress-fill`は左端原点を必要とするが、レシピはrole→scaleだけ（[catalog](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/catalog.v1.json)）。 | metadataだけでart directionが復元 |
| **P2** | 8. 候補探索の負担が未見積り | N候補×多時点×入力系列×viewportで描画が増える。60→1000件は権利確認・重複審査も線形以上に増えるおそれ。生成時間/トークン/棄却理由をledger化しない限りbudgetedとは呼べない | bounded=Nなら安価で運用できる |
| **P2** | 9. 編集可能性を過大評価 | writerはShape/Bone/Constraint/Nested/SM/VMを持つ（[writer L172–464](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L172-L464)）。ただし出力が単に画素画像ならRive内でshape/text/SMを編集できない。SVG/png変換成功も独立した操作の証明でない | 画像として見えればdeliverable |

**具体的敵対入力**: (a) 「上品な静止画、バウンス無し」に`watch`の`ease-out-back`（[builder L196](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196)）が残る。(b) 「秒針のみ」に既存`hourHand/minuteHand`の回転tracks（L206–207）が残る。(c) 「イヤホンのstem」に時計針の360度回転を移すと意味/支点が破綻。(d) テキストを日本語の長文に変えると原版の固定720×460の左カラムを越え得る。(e) nested artboardをclip sourceとして使う設計は公式forumの[制約事例](https://rive.app/community/forums/support/fsnLLkXUaA62/clipping-with-nested-artboard/ft47bYuV1ZMH)に反する可能性があり、バージョン固定実験が必要。

## 2. 新機構（V2にない動作を伴う3件）

### R1-I1 — **Shot-Graph Program Synthesis / 時間ショット図からのシーンプログラム生成** 【wildcard】

**解決:** アンカー時計の構図を新題材に無理に転用する問題。**動作:** ユーザー意図→意味ショット(`establish/hero/detail/copy/rest`)→各shotの対象・視線・占有領域・入出時間を変数とした小さな制約付きscene programを生成。部品ではなく「ショット列とカメラに相当する舞台構成」を第一単位にし、同じshot graphから時計/イヤホン/通知で別の原画を作る。生成物は編集可能なRML/SceneSpec（許諾済原画のみ）。**V2との差:** 既存アンカーもcapsuleも探索開始条件にしない; 生成programとshot transitionが検索対象。**実装フック:** 新規提案`scripts/shot-graph-probe.mjs`→`scripts/build-motion-atlas-gold.mjs`の手書きbeatを比較用に写像、出力を公式RML/CLIと`src/rivWriter.ts`の二経路で試す。**成立条件:** 別題材にscene authoringできる、文字・陰影・asset rightsを管理できる。**副作用:** アート生成負担と探索空間が増大、テンプレより崩れる。**簡単な対抗:** 完成sceneをまるごと編集。**1週間反証:** 2題材×3shot×2 seedsで同予算A/Cと比較。美的評価でA以下か、描画予算2倍超なら棄却。**採否:** wildcardとして実験のみ、主経路不採用。

### R1-I2 — **Perceptual Target Backsolving / 制作前の視覚目標から逆探索**

**解決:** DNAの形容詞が実際の画面バランスへ作用しない。**動作:** 外部著作物を模写するのではなく、入力意図から自作の粗い**領域マップ**（主役重心、negative space、copy矩形、明暗/色温度、開始・中盤・終盤のsalience）を作り、実レンダリング候補をmulti-resolutionで比較。低周波の構図差→領域readability→輪郭干渉→時間の視線誘導の順に診断を返し、候補間で改訂箇所を特定する。pixel一致を目的にしない。**V2との差:** static `dna`ではなく比較可能な画面目標を合成し、render差から操作提案を返すclosed loop。**実装フック:** 新規`scripts/visual-target-probe.mjs`と`data/motion-eval/targets/*.json`、CIのruntime PNG/GIF生成に接続（変更は本レビューではしない）。**成立条件:** target map自体が美しい方向を示すこと; 目標と評価データを分離。**副作用:** 目標の偏りとreward hacking、狭い構図への収束。**簡単な対抗:** Aの既存構図を固定してタイポと色のみ編集。**1週間反証:** 6独立プロンプト・blind 3人、map誘導 vs 無誘導、hard gate同等条件。多数決4/6以上の品質改善がなければ停止。**採否:** V3の限定challenger。

### R1-I3 — **Temporal Transform Witness / 支点・親子関係の時刻付き証明**

**解決:** semantic tagと`ports.pivot`だけでは回転支点/影/clipが正しい保証がない。**動作:** nodeごとに`T_world(t)=T_parent(t)·T_local(t)`（TRS順・角度はwriterの実行モデルに合わせる）を定義し、所有者が明示するanchor local座標を変換。世界空間の「針軸→dial中心一致」「影の投影追従」「mask可視矩形」といった不変条件に残差/時刻/ノード経路を付けて出力。単純なbboxより強い**再現可能な証跡**を持ち、非一様scale/負scale/回転時に多点サンプリング。**V2との差:** capability文字列ではなく、数値化した時系列構造不変量を検証・反例を保存する検証器。**実装フック:** 新規`scripts/transform-witness.mjs`（`src/rivWriter.ts`の`GroupSpec`参照、実出力は公式inspectとの一致を別途検証）、`test/fixtures/transform-witness`。**成立条件:** RML/SceneSpec内のnode IDとrenderer objectの安定対応、完全な行列合成仕様。**副作用:** 解析側のモデル間違いで偽PASS、描画効果/フォントは対象外。**簡単な対抗:** 完成sceneから親子を変更しない。**1週間反証:** SOLSTICE hour/minuteのlocal(0,0)はPASS、意図的+8px reparent/非一様scaleでFAIL、同一フレームPNG座標と一致しなければ棄却。**採否:** V3の安全性試験、ただし推測したpivotを証拠に昇格させない。

## 3. 勝者仮説の選択と捨てるもの

**勝者はA（完成scene編集）またはC（公式RML直接生成）のいずれかである可能性を開いたまま、R1-I2+I3を両者にプラグインする**。B（小さなtyped scene-family）は実験被験者であって、V3の土台ではない。I1は未知題材への大胆な対抗仮説として残すがデフォルト生成には用いない。

**V2から捨てる:** ①anchorに適応可能であることを前提とするScene Family DNA、②capsuleをコンテンツ増強の基本単位とすること、③fallbackを品質成功に数えること、④recipe件数を製作能力の代理とすること、⑤条件通過後の勝者B固定。**残す:** 権利の操作別ゲート、公式backend、複数経路の公平比較、独立holdout、編集可能性、探索レーンと本番レーンの分離。詳細改訂は[ V3 ](../proposals/MOTION_ATLAS_ARCHITECTURE_V3.md)。

## 4. 次ラウンドの異なる反証の予約

V3自体を壊すべく、(i)視覚targetが人間に不快だが評価score満点、(ii)秒針を動かすのに実体がない、(iii)題材外の転用、(iv)no-bounce/no-confetti/only-second-handの厳密違反、(v)text/clipの実画面差、を個別の失敗fixtureとして要求する。これはRound 2の判定を先取りしない。
