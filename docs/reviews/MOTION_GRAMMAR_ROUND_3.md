# ROUND 3 — V4最終レッドチーム、新たな制作知識化機構、停止判定

2026-10-13 / [V4](../proposals/MOTION_ATLAS_ARCHITECTURE_V4.md) を既定の勝者とみなさず再反証。**最終推奨: 限定MVPのみCONDITIONAL GO、規模拡大はNO-GO（再判定条件付）、汎用Part GrammarはNO-GO。**

## 0. Round 2と違う反証方法

Round 2は個別作品の「画面は整っているが壊れている」を攻撃した。Round 3は**分布変化・権利不確実性・知識成長の因果検証**へ焦点を移す。未知題材・未知文面・大量参考作品追加・近似レシピ衝突に対して、V4が品質を保持できるかを見る。静的コードと実ファイルから**新規に確認した**以下を使う。

- [source-candidates-2026.json](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/data/motion-recipes/source-candidates-2026.json)は**34候補、`licenseStatus` verified=10 / restricted=10 / unknown=14**。例として `rive-interactive-hero` / `rive-ui-showcase` はRive Marketplace由来・CC BY 4.0記録・`allowedUses`に`attributed-adaptation`とあるが、著作物記載とフォント/画像/コード等の内包権利・自動学習許可は別確認。**これは台帳記録の確認であり、外部サイトの現在の権利を第三者的に再認証したわけではない**。
- [writer L779–797](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L779-L797)は`font.subset !== false`なら**現在のTextRun文字列からglyph subset**を構成する。新規失敗仮説: SOLSTICEで`REDEFINED.`のような文字列のみ入れた出力へ、後からruntime VMで未収録日本語を流せば必要glyphを収めない可能性がある。R1/R2の「長いテキストがclipする」に加え、**差替文字のglyph非存在**は独立の破綻。フォント自体の字形・fallbackの可用性も確認が必要。この場で日本語差替描画したのではない。
- [retrieval evaluator L7](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/evaluate-motion-retrieval.mjs#L7)の現在のCI閾値はforbiddenTop3Rate **0.26**（26%）を許す。実ログではTop-3 forbidden 16.0%でも`GATE PASSED`（[job 115044019711](https://github.com/ODU33104/rive-mcp/actions/runs/38319528081/job/115044019711)）。**"CI Green"とユーザーの「no-confettiを守る」は異なる評価軸**。
- [benchmark L21–57](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/evaluate-motion-retrieval.mjs#L21-L57)は`acceptableTopIds`の選択を測る。出力をrenderしたときに実際のmeaning/美観が成立するかは採点しない。独立holdoutに加え**作品の実生成成否**が必要。

## 1. V4への新しい攻撃

| ID | V4の破綻条件 | 実験・反証方法（R2と異なる） | 対応 |
|---|---|---|---|
| R3-F1 / P0 | 美的relationの監査を正確にしても、未知題材に必要な意匠を作れる材料がない | **leave-one-subject-family-out**: watchで関係学習、earbud/instrumentで凍結して評価。beauty差がA/Cに優れないならrelationは"審査"しか担わない | style ledgerを制作エンジンと呼ばない |
| R3-F2 / P0 | referenceを1000件保存しても制作可能なmotion/partが0件増加 | 権利別にsourceをquarantineし、source数と独立2題材での再現合格率の相関を測定。単なる情報量は不採択 | R3-I6で参考→制作知識の因果変換を試す |
| R3-F3 / P0 | 同一作品のfont subsetで静的テストが通るが、新規ユーザーcopyがmissing glyph | 既存Inter+glyph subsetの日本語/非収録文字を動的差替、`subset:false`/適切glyph集合とのcapture差を同font policyで確認 | embedded font rights & glyph coverage gate |
| R3-F4 / P0 | V4のI5 semantic prohibition classifierが`UNKNOWN`を大量に返す | **metamorphic prompts**: `動かすな`↔`秒針だけ`↔`背景だけは固定`等、同一絵を複数禁止指示に変形。labelled contradictionとaccept/unknown/reject分布を記録 | 正確さだけでなくcoverage/abstain率を可視化 |
| R3-F5 / P1 | 既存Top1が上がっても追加レシピが新意図を解決しない | 60→仮80件の追加で`specific-new-recipe(+10)`が発動（[recipe L293–303](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L293-L303)）。新規holdoutでtop1/禁則/OOS + **実Rive出力**を対に比較 | production promotionは"作れる"で判定 |
| R3-F6 / P1 | 公式RML側でできた仕様が既存writerルートでは落ちる | 同一意図を両backendで作り、schema coverage、nested/text/state pathsとrender evidenceを比較。RML/公式CLIそのものを改変せず差分を監査 | compiler parityを推測せず個別合否を保持 |

前回のrelational auditは重要だが、本検証は**作品を集めた分だけ一発制作能力が増すという経済的因果**を狙っており、閾値調整ではない。**本審査では変異ビルド/2週間試験は未実施**。これらは静的コードと台帳から導出した検証可能な失敗仮説である。

## 2. 新機構 R3-I6 — **Causal Motif Distillation / 参照作品の運動因果蒸留**

**解決する残存欠陥:** reference-onlyを増やしても制作に使えるprimitiveは増えず、V2のTwo-Lane Growthは単に隔離棚を作っただけ。V4-I4は制作済sceneの整合性**検査**であり、参考を別題材で生成可能な**設計原因**へ変換しない。

**内部機構（具体的でR1/R2と非重複）:**

1. 出典・作者・原物URL・取得時点・権利状態・許可操作を固定。unknown/restrictedは**文章メモ・引用範囲内での人間観察**以外の複製、素材抽出、学習、改変/再配布へ昇格させない。サイトの取得規約を遵守し、無権利画像を機械学習datasetとして扱わない。
2. 権利クリア済または**独自に一から作り直した**試験用シーンについて「動きの原因」を`trigger → controlled object → local pivot/attachment → spatial intention → easing/settle → dependent shadow/glint/text → prohibited transfer domains`として**causal scene note**にする。単なるrole/tagと違い、介入できるcontrol variableを必須にする。
3. 自作シーンで**同一作品から局所要素を1個だけ外す**(ablation): 例 光沢timingを除去、影を固定、針回転pivotをずらす。生成の前後でblind人間が美観・意味・視線誘導を比較し、何が寄与しているかに`effectEstimate`と`confidence`を付す。公式CLI/RMLを実行backendに使う。
4. **少なくとも2つの独立した題材**で同じ原因を新規に実装する反例移植: 例 「主役出現→材質の短い反射→copy」は時計/イヤホンで成立するか、「60目盛り回転」は計器だけで成立するか。固有形状を持ち出さずに、**入力・関係・期待可視効果**の小プログラムを新たに記述。転用で失敗なら`domainExclusion`を記録し、知識は広めず狭める。
5. 審査済の`causalMotif`だけをcandidate laneへ昇格。登録の単位はURLでもassetでも「美しいmotion」というタグでもなく、**介入の有無が作品品質に与える再現可能な効果**。原作画像・ロゴ/フォント等を持ち込まない。

**契約イメージ（提案、現行JSONと互換ではない）:**

```json
{
  "schema": "causal-motif/v0",
  "id": "hero-material-reveal",
  "provenance": {"kind": "independent-recreation", "referenceUrl": "reference-only://id", "assetHashes": [], "rightsEvidence": "self-authored-test-only"},
  "cause": {
    "event": "hero-became-legible",
    "manipulable": "glintStartMs",
    "relation": "highlight-after-hero-before-copy",
    "targets": ["self-authored-hero-surface"],
    "attach": "surface-local-coordinate",
    "forbidDomains": ["flat-notification-panel"]
  },
  "ablations": [{"remove": "glint", "blindEffect": "NOT_MEASURED"}],
  "transferWitnesses": [{"domain": "watch", "state": "PENDING"}, {"domain": "earbuds", "state": "PENDING"}],
  "promotion": "discovery-only"
}
```

**フック:** 新規`scripts/distill-causal-motif.mjs`、`data/motion-motifs/discovery/*.json`、`data/motion-motifs/verified/*.json`、`scripts/evaluate-motif-ablation.mjs`（すべて**今は未作成**）。既存[builder](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs)のglint/shadowと[storyboard](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs)のtime cueをself-authored実験に使う。

**成立条件:** ablationで盲検差を検出できる、単一他題材だけへの偶然の当てはまりを避ける、作品毎の運動/法務/資産の来歴を明確にする。**副作用:** 手動注釈と複数生成のコストが高い; 作品の芸術性を一原因へ偽還元しがち; blind ratersに差がない可能性。**単純な対抗:** 完成sceneを直接編集して再利用する。**最小反証テスト（1週間）:** self-authored SOLSTICEの`bezelGlint`あり/なしとcaption reveal timingを2×2 ablate、watch + 抽象計器へ原画持込なしで再設計、各3人blindで好み・題材理解を評価。因果効果が安定せず/転用0/2ならproduction昇格を停止。**採否:** 研究laneに条件付き採用、本番自動生成へは未採用。

## 3. 最終候補の七軸比較

**表内はエビデンスではなく審査の仮説的な相対評価。** High/Medium/Lowは本番性能を保証しない。「Quality」は手描き原版が適合する条件下の上限。順位が同点であり得る。

| 候補 | 初回見た目 | 題材多様性 | 再構成安全性 | 原価 | 追加recipeの効果 | License | 公式backend活用 |
|---|---|---|---|---|---|---|---|
| A: Finished-scene edit | High/適合時 | Low | High/変更局所時 | Low–Med | 限定 | 元sceneとembedded権利が条件 | High |
| B: Direct RML+CLI | 未知/高い潜在 | High | Medium/現物試験次第 | Med–High | recipe非依存 | 自作資産で制御可 | **High** |
| C: one typed slot | High/同domain | Low–Med | Medium/rig条件必須 | Med | 承認slotだけ増える | anchor元の権利が条件 | High |
| D: V4 relation+behavior検証A/B | 主体A/Bと**同点も可** | 主体次第 | Highになる可能性 | baselineより高 | 直結しない | 知的権利問題は解消しない | **High** |
| E: general Part Grammar | 未検証 | 理論上High | Low（現時点） | Very High | 量が品質にならない | 統合素材で複雑 | High |
| F: Shot-Graph (I1) | 未検証 | Medium–High | Low–Medium | High | shot programには寄与 | 自作素材なら管理容易 | High |
| G: causal motifs (I6) | 単体で画を作らない | 時間的に広がり得る | 2題材成功時のみ上がる | High/登録件 | **検証済だけ** | 操作単位gateと自作再構成が必要 | High |

**比較の要点:** 関係台帳を付けるDがA/Bの初回美観を実際に上げるとはまだ言えない。高コストで同点なら**単純なA/Bが勝者**。追加作品収集は品質に作用する因果モチーフが発見できる時だけ投資価値がある。公式backendの使い方はすでに全方式で高水準なので**これ自体は差別化しない**。

## 4. 10営業日/約80hで閉じる実験（全て今後、合格報告なし）

| 実験 | 割当 | 対照 / 試行 | 出力・別指標 | 予め置く中止条件 |
|---|---:|---|---|---|
| E1 **SOLSTICE意味分解→復元** | 20h | Case/Dial/Hands/Glint/Shadow/Textを手動識別、元builderを再実行するだけでなく**別manifestから組み直す**。30時間点以上、同viewport/fps/font/runtimeと親子/clip/SMの構造差 | ピクセル:同renderer同fontでSSIM≥0.995、平均RGB差≤2/255（提案閾値）＋critical欠落0。**美観は別途blind**、frame一致で美しいとは言わない | 1重要要素欠落、支点の偽PASS、glyph欠落でCの一般化を停止 |
| E2 **題材入替** | 16h | watch→earbuds、watch→抽象計器、それぞれ2 prompt、A vs C vs fresh B。ロゴ/画像を転用しない | pivot/local/world、影、clip、text、意味/機能、editing成功。適用不能も分母へ | critical semantic/pivot errorが1件でも起きればそのtransfer domainを禁止 |
| E3 **scene edit / direct RML / hybrid 実描画の同budget対照** | 24h | 未見8 prompts×2 seeds。A/B/D、1回修正、同モデル/権利済アセット/レンダリング環境とトークン・壁時計上限。独立5人blind。公式CLI verify/screenshot/inspect、input driving | **美観:** scene-wide選好、style-cohesion、意味/可編集性。**非美観:** compile可否、時間、tokens、critical違反。ピクセル一致は**別生成経路どうしには用いない** | Hybridがbaseline多数決選好で勝てない/原価>2倍/critical失敗があればD撤退 |
| E4 **追加20レシピ→独立holdoutと実出力** | 12h | 凍結80問：旧意図40/新意図20/否定・OOS20。旧60対仮80、独立二重labels。実Riveサンプル生成・禁則変形を付す | Top1/Top3/abstain/forbidden+新意図**制作成功**、collision・権利gate | Top1劣化>2pt、Top3 forbidden>10%、OOS abstain<90%、critical error、制作成功の純増ゼロ |
| 判定/最小再現/ドキュメント化 | 8h | failure corpus/署名済評点/本番昇格可否の監査 | route別母数、効果・原価、B/Cの不適用率 | 証拠不足なら昇格せず研究laneに留める |

**美観の盲検評価者の確保、法務審査と新規アート制作は上記80hの外部依存**。人員を確保できない場合は美的優位を`NOT_EVALUATED`として、GOに繰り上げない。サンプルは母集団への一般化に不十分で、事前にbaselineと閾値を固定する。

## 5. 条件付き最終判定

| 対象 | 判定 | 意思決定根拠と解除条件 |
|---|---|---|
| **限定MVP（比較＋独立証拠 + 1slot）** | **CONDITIONAL GO** | テスト設計・小規模プロトタイプに限る。E1/E3のpivot・rights・editable・blind品質を満たすまでは本番一発生成を約束しない |
| **次の規模拡大（20→150等）** | **NO-GO、再評価待ち** | E4で**新意図の実制作成功**の純増と禁則率悪化なし、I6移植2題材成功、登録1件当たりcostの採算が示されるまで停止 |
| **汎用Part Atlas / Motion Grammar** | **NO-GO** | 現在に支持する再構成・意味転用・品質の証拠なし。E1–E4全通過でも限定scene family以上の承認とはならない |

## 6. V2からどう離れたか / 最大未解決リスク

V2は品質済アンカーとcapsuleに賭け、能力gate・fallbackで不成立を回避した。V5では**A/Bを本当のbaselineにして生成経路に忠誠を持たず、V4のrelation/behavior/witnessを独立監視器として扱い、I6によってreferences→causal effect→cross-domain transfer証拠を得られたものだけ小さく増量**する。それでも美観の客観的proxyはない。

**最重大の未解決リスク:** 「自動的に作る作品の美しさと題材適合」を再現可能・blind評価可能な実証データが存在しない。CIが成功しても、追加機構で品質が上がるかは不明。増量やアーキテクチャ名の刷新でこの欠落は埋まらない。詳細最終仕様は[ V5 ](../proposals/MOTION_ATLAS_FINAL_RECOMMENDATION_V5.md)。
