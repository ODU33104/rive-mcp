# Motion Grammar Innovation Matrix — three-round non-duplicate mechanisms

**2026-10-13 / R1–R3の合計6件**。すべて**提案であって実装済み、実測済みではない**。詳細は[ROUND 1](MOTION_GRAMMAR_ROUND_1.md)、[ROUND 2](MOTION_GRAMMAR_ROUND_2.md)、[ROUND 3](MOTION_GRAMMAR_ROUND_3.md)と[Final V5](../proposals/MOTION_ATLAS_FINAL_RECOMMENDATION_V5.md)。R1≥3、R2≥2、R3≥1。各行は命名でなく**介入可能な動作と生成物**で定義した。

| ID | Round | 新規機構の要約 | V2/過去ラウンドとの**非同一性** | 変える実装ファイル/契約 | 生む出力 | 失敗モード | 最小反証テスト | 採否 |
|---|---|---|---|---|---|---|---|---|
| **R1-I1** | R1 | **Shot-Graph Program Synthesis**: shotと時間・領域制約からscene programを合成する | V2は完成scene/slot/capsuleを前提。I1は**anchorなし**に`shotGraph → artboard generation program`。単なるmotif tag追加でない **wildcard** | 新規提案`scripts/shot-graph-probe.mjs`; `Shot{role,occupancy,entry,exit,assets,transition}`; official RML/CLI + [gold builder](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs)の対照 | 別題材でのRML/SceneSpec、shot trace、見た目の比較 | 自作原画負担、場面の一貫性低下、時間/コスト過多 | 同資産/候補予算で時計・イヤホン×3shot×2 seeds。完成scene-editにblindで劣後/時間2倍超→棄却 | **研究のみ**、A/Cに勝つまでは不採択 |
| **R1-I2** | R1 | **Perceptual Target Backsolving**: 独立に作った領域・明暗・salience目標へ候補renderを突き合わせ、どこを改訂すべきか示す | V2の固定`Scene Family DNA`にない**実画面feedback loop**。I1は造形生成で、I2は造形後の誤差による候補診断 | 新規`scripts/visual-target-probe.mjs`; `VisualTarget{regions,keyTimes,contrast,occupancy}` | 目標とrender差分の領域診断、次修正仮説 | 数値が一致する「金色円の凡作」、同質な構図、reward hacking | 凍結6 prompt・3人blind、target ON/OFF。ONが4/6未満→廃止 | **診断のみ**。R2で美的最適化から降格 |
| **R1-I3** | R1 | **Temporal Transform Witness**: nodeと参照点のworld空間残差を時刻ごとに数値証明 | V2の`pivot`や`capabilities`文字列による**宣言**ではなく、local/world行列+反例frameを生成。I2のpixel目標とも別 | 新規`scripts/transform-witness.mjs`, `test/fixtures/transform-witness`; [writer GroupSpec](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166) | `witness.jsonl` + 関節/軸ズレの最小node/frame | 行列合成順誤り、IKやmaskを計測できない、偽PASS | SOLSTICE正常rigと8px意図的pivotずれ、非一様scale、5+時間点。runtime差不一致で棄却 | **限定MVP候補**（実試験未実施） |
| **R2-I4** | R2 | **Relational Art-Direction Ledger**: 主役・copy・影・glint・素材感の**相対関係**を時系列renderで評価 | R1-I2は画面絶対値、I3はTRS位置。I4は光源→陰影、タイポ階層、視線誘導の**複数要素間依存**。V2の`styles`宣言より観測可能 | 新規`scripts/style-relation-ledger.mjs`, `data/motion-eval/style-relations/*`; `Relation{from,to,kind,frame,evidence}` | 関係ごとの可視crop、違反時刻とcaption/影/光源の診断 | 物体識別誤り、照明モデル不在、独創性の抑圧、未測定の審美相関 | 精密作品/単なる金色円6対で5/6以上の人間順位整合 + text欠損全検出 | **診断のみ/条件付き** |
| **R2-I5** | R2 | **Behavioral Prohibition Automata**: `no-bounce`, `no-confetti`, `only-X`を入力系列と時間領域の動きへコンパイル | V2には否定語gate、R1-I3には位置の正確さ。I5は**どのnodeがいつ動いてよいか**の時相・集合・SM検査。単なる禁則タグ増量ではない | 新規`scripts/behavior-contract-monitor.mjs`, `test/fixtures/behavior-negatives/*`; `Monitor{allowNodes,scope,signal,predicate,inputs}` | 許可/違反/不明 + trace、最小違反入力 | semantic confetti分類失敗、速度閾値過敏、状態網羅不足 | 現行時計の禁止運動を含め9違反+3正常fixture。全検出/誤拒否なしでのみ続行 | **hard-gateの候補**（実試験未実施） |
| **R3-I6** | R3 | **Causal Motif Distillation**: 参考の動作因果を自作再実装→1要素除去→blind差→他題材へ移植し、証拠ある知識だけ昇格 | V2のTwo-Laneは保存・隔離、R2-I4は出来た画の診断。I6は**新しい制作可能プログラムと効果証拠を生産する**因果介入。素材のコピーとは異なる | 新規`scripts/distill-causal-motif.mjs`, `scripts/evaluate-motif-ablation.mjs`, `data/motion-motifs/{discovery,verified}/*`; `CausalMotif{cause,ablation,transferWitness,rights}` | 候補となる編集可能motif program + ablation票 + 2題材の移植証跡 | 因果誤認、手動審査コスト、権利の誤許諾、他題材で効果消失 | 自作SOLSTICE glint/コピーの2×2除去試験をwatch+計器へ移植、3人blind、転用0/2なら停止 | **discovery researchのみ**、本番昇格保留 |

## 2. 主観採点（0～5、測定値ではない）

**採点意味:** `Novelty`=V2からの非連続性、`Aesthetic leverage`=ユーザーに見える画質を改善し得る直接性、`Feasibility`=1人の限定MVPでの成立可能性、`Rive compatibility`=公式CLI/現行writerへ自然に組み込める程度、`Transfer safety`=未知題材への誤適用を抑える能力、`Scale`=件数増大時の審査・保守効率。**主観的設計スコア**で、2026年の実製品性能や得点差の統計的有意性ではない。

| ID | Novelty | Actual user-visible aesthetic leverage | Feasibility | Rive compatibility | Transfer safety | Scale | コメント |
|---|---:|---:|---:|---:|---:|---:|---|
| R1-I1 | 5 | 4 | 2 | 4 | 2 | 3 | 新しい原画を作れる潜在力が高い一方、アート制作コストも高い |
| R1-I2 | 4 | 3 | 3 | 5 | 3 | 3 | visual target一致が美しさの証拠にはならない |
| R1-I3 | 4 | 2 | 4 | 4 | 5 | 4 | 破綻予防が主で、新しい魅力的な原画を自動創作しない |
| R2-I4 | 4 | 4 | 3 | 5 | 3 | 3 | 表面品質の整合を評価するが、審美を完全に数式化できない |
| R2-I5 | 4 | 3 | 4 | 5 | 5 | 4 | よく動くか/禁則を守るかを検出する; 品質の直接創造ではない |
| R3-I6 | 5 | 4 | 2 | 5 | 4 | 2 | 参照数を制作知識へ変える本命だが手動試験・権利費用が重い |

### なぜ6件を別発明と数えるか

- **独立した状態変数:** I1はshot graph、I2はframe target、I3はworld transforms、I4はcross-object visual relations、I5はallowed temporal behaviors、I6はcausal intervention outcome。何か1つを削って他の名前へ移しても同じ出力を再現できない。
- **役割が異なる:** I1はgenerate、I2はrender feedback、I3/I5は異なる不変量の証明、I4は見た目の一貫性検査、I6はreferenceからproduction知識を追加する実験。I3とI5の差は**動作が正しく実現したか**対**その動作をしてよいか**。
- **独自の美観レバー:** I1はshot順序を合成、I2は領域・salienceを再改訂、I4は文字組・影・光の関係を監査、I6はglint等の何が効いたかを除去比較して新題材へ伝える。単純な独立verificationだけで「美が上がる」と言い張っていない。
- **wildcard棄却理由:** I1はV2/アンカーから最も離れるが、毎回原画制作に近づき、比較前に採用すると局所的な完成scene編集より高くつくおそれがある。A/Bと**同budget**で4/6以上のblind優位・cost≤2倍を示せなければ継続しない。

## 3. 根拠/未確認の監査

- **事実:** 現行catalogのrecipeはrole→6 property tracksで、[compiler L338–355](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L338-L355)の座標`base`欠落時は0/1仮定。CLIの公式機能は[commands](https://github.com/rive-app/rive-docs/blob/main/cli/reference/commands.mdx)。本proposalのsidecar contractは公式APIに存在しない。
- **CIで確認できること:** [検索106問Top1 92.5%/禁則Top3 16%](https://github.com/ODU33104/rive-mcp/actions/runs/38319528081)、[109 shapes/30 tracks runtime render](https://github.com/ODU33104/rive-mcp/actions/runs/38319528119)、[82frames/GIF](https://github.com/ODU33104/rive-mcp/actions/runs/38319528078)は実行成功。ただし美的優位も因果効果も未評価。
- **rights:** [source candidate台帳](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/source-candidates-2026.json)では34候補/verified10/restricted10/unknown14。`allowedUses`や公開URLは埋込素材の再配布・学習許諾ではない。
- **未実施:** 全R1–I1〜R3–I6の新規CLI試験、生成、ブラインド美的評価、rightsの法的確認、E1 roundtrip、E2転用、E3三経路同予算比較、E4独立holdout。**未実施をPASSとしない**。比較閾値と投資判断は[Round 3](MOTION_GRAMMAR_ROUND_3.md)および[V5](../proposals/MOTION_ATLAS_FINAL_RECOMMENDATION_V5.md)を参照。

**結論:** 新機構6件のうち本番に自動投入を承認されたものは0。限定MVPとしての比較/検証試験のみ**CONDITIONAL GO**。最も致命的な未解決課題は独立ブラインドで確認された「一度の指示→驚くほど優れた編集可能作品」の実証不在。
