# ROUND 2 — V3の敵対的再審査と、別発明2件

2026-10-13 / [対象V3](../proposals/MOTION_ATLAS_ARCHITECTURE_V3.md) / 先行結論への義務なし。**判定: V3の視覚target先行を既定の選定器にする案はNO-GO。絵のまとまりと動作禁止条件を独立した観測機構へ分離したV4のみ条件付き試験可。**

## 0. 新しい勝者仮説

Round 1では「画像目標への逆探索 + transform witness」がA/Cを助けると仮定した。ここでは逆に「低周波画像への適合は見た目を**悪化**させる」という仮説を優先する。観察可能なアートディレクションの**関係**と、明示された禁止条件の**時系列意味**がなければ最適化は危険。R1で自分が推したI2も棄却可能な被験者に下げる。

## 1. V3を破壊する独立反例：6件

| ID / 重み | V3がPASSしかねない構成 | 実害・失敗の検出器 | 具体的根拠 |
|---|---|---|---|
| F2-1 **P0** | 黒背景+大きな金色円をhero区域に置き、白見出しをcopy区域に置く。領域・重心・明暗はTargetMap一致、全unit testとCLI verifyはPASS | 時計らしい精密部品、ガラスの層、材質感がなく「高級感」を失う。匿名5人の優先選好＋物体識別評価が必要 | [SOLSTICEの実shape階層](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L101-L165)に比較してtarget mapは幾何総量を無視 |
| F2-2 **P0** | `hourHand`を`watch`直下の見かけだけ一致する別原点groupへ移し、移動前後t=0のみ軸点一致。t=101以降は実際の時計中心がずれる | 回転・非等方scale・親の位置trackが合成しない。witnessは時間/transform順序/参照点の確定が必要。基準点を間違えた証明器は危険 | [builder L45–53](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L53)、[L196–207](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196-L207)、[writer GroupSpec](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L154-L166) |
| F2-3 **P0** | 未見の「高級ワイヤレスイヤホン」に時計の構図・時系列をそのまま使い、stemをwatchHand相当とし回転させる。hero領域も余白も合う | 目標画像評価の高scoreなのに主役の物体論が壊れる。時計中心pivot≠耳穴/ケースの接触と重心、影もroot別 | [builder L45–49, L150–165](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L53) |
| F2-4 **P0** | 「no-bounce/no-confetti/only-second-hand」がpromptにあるのにwatch entry `ease-out-back`、hour/minute rotateを保持。confetti-like particlesが別IDで追加される | 現行recipe rankerのnegationは硬い制約ではない。V3の`hardNegative:string[]`は検査可能な意味に落ちていない。運動・class・許容対象を**全ノード全時刻**に結びつける必要 | [builder L196, L206–207](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196-L207)、[recipe L240–303](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-recipe.mjs#L240-L303) |
| F2-5 **P1** | マスクで隠れたテキストを「copy regionに存在」と合格、長い日本語を差込むと桁がwrap/overflow。画面の粗い色密度はほぼ同じ | 欠けたコピーがユーザーの完成要求を破る。shape treeだけでなく**glyph outlinesの可視領域**, line wrapping, language/fallback-font, z/clip chainを描画で検査 | [writer TextSpec/clipBy L209–290](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L209-L290)、[公式ネストclip制約の事例](https://rive.app/community/forums/support/fsnLLkXUaA62/clipping-with-nested-artboard/ft47bYuV1ZMH) |
| F2-6 **P1** | watchが移動する中でrootの`watchShadow`はfixedなのに、keyframe 0/270の位置だけ画面に違和感がない。中間で光源と影が逸脱 | witnessの`shadow follows`は、root別の射影モデルと中間時刻の距離・方向・softnessを必要とする。単一frameでのPASSは不十分 | [builder L45–49](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L45-L49)、[L196–203](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/build-motion-atlas-gold.mjs#L196-L203) |

**事実の限界:** 上表は静的コードから構成した敵対的ケースであり、審査者が実際に変異sceneをビルドして画面で再現した結果ではない。F2-1の「全unit PASS」は仮定としての反例であってCIがそのsceneにPASSしたと主張しない。maskの実可視差も検査前。

## 2. 同条件で比較する経路（比較設計、結果ではない）

凍結する条件: 8未見prompt（時計×2/イヤホン×2/抽象計器×2/通知×1/日本語タイポ×1）×2 seeds、同一LLM/フォント/権利済asset/720×460/候補2/総推論予算/修正1回/生成時間上限/匿名ブラインド評者5人。レンダリングは同じ公式CLIまたは同じversion固定Rive runtimeで30時点＋interaction scenarioを出す。**未実験なので順位は予測だけ。**

| 比較候補 | 可能な品質上の利点（仮説） | 題材多様性 | 予期される限界 | 公平に数える失敗 |
|---|---|---|---|---|
| **A: 完成sceneの編集** | 全体の構図/光/文字組が元から一体 | 低〜中 | scene外題材、権利、文字差込幅 | 応用不能も分母へ |
| **B: 公式RML直接生成** | 未見の物体を初めから造形 | 中〜高 | 原画・美観・tool latency | compile失敗も分母へ |
| **C: 最小typed slot/scene-family** | 既存造形の限定機能変更に強い | 低〜中 | 秒針rigなし、親子/slot切断 | slot不足をfallback成功にしない |
| **D: V3独自のTargetMap+Witness制御A/B/C** | render誤差診断とpivot検査 | 経路依存 | F2-1のreward hacking、negative取りこぼし | feedback追加コストを全加算 |
| **E: 一般Part Grammar** | もし実現すれば高い再利用 | 理論上高 | 部材生成、権利、paint/constraintsの爆発 | 破綻や不成立も分母へ |

**判定指標:** (i) hard semantic/rights/behavior/geometry violationsは0容認、(ii)5人多数決に基づく盲検のart direction選好、(iii)題材適合・可編集性のパス率、(iv)end-to-end wall time/token/修正回数、(v)路線の棄却率。A対CやB対Dの採択率は比較であり「美的に上回る」主張には署名付きblind票が要る。**現時点で勝者は未判定。**

## 3. ROUND 1と重複しない新機構

### R2-I4 — **Relational Art-Direction Ledger / 見た目の関係台帳**

**解決する欠陥:** R1-I2のabsolute TargetMapは高級時計を「金色円の数理的置換」で高scoreにできる。**内部機構:** scene内の「主役と背景」「文字見出しと注釈」「highlightと実材質」「接地と影」「入場前景と余韻」の関係を**画像上の観測値対**として抽出。例えば [hero contrast>background], [caption文字サイズ<見出し], [光沢の位相がcase curvatureと整合], [copy visible-glyph-bboxが安全枠内], [shadow centroidは物体重心に従い、光方向に相対位置を取る] を関係グラフで保持し、フレーム間の相関を検査。参考作品の画像を無許諾で学習/配布せず、自作や明示許諾済sceneから測る。**R1との差:** I2が絶対領域/色分布を追うのに対しI4は部位**間の比較・一貫性**を診断し、原版がない新題材には先に人手で関係を設計する。R1-I3はTRS座標の証明で、光源/フォント/素材の因果評価ではない。**出力:** `relations.json`、関係別score、違反frame+region crop、修正提案（automatic scoreは人間評点の代用不可）。**実装フック:** 新規`scripts/style-relation-ledger.mjs`、`data/motion-eval/style-relations/*.json`、現行[Gold render CI](https://github.com/ODU33104/rive-mcp/actions/runs/38319528119)のフレームをinputにする。**成立条件:** 同一font/runtime、部位annotation、既知光方向。**副作用:** 高級材質の創意を硬い規格に潰す; crop調整でscoreを騙せる。**より簡単な対抗:** 自作完了sceneの構図/スタイルを固定するA。**1週間反証:** 「金色円の偽物」 vs SOLSTICE類似の丁寧な造形6対を人工作成し（提案）、人間選好との順序整合≥5/6かつテキスト欠落の全検出ができなければ採択しない。**採否:** V4の診断にのみ暫定導入、生成の唯一のobjectiveにはしない。

### R2-I5 — **Behavioral Prohibition Automata / 否定指示を運動監視機にコンパイル**

**解決する欠陥:** `hardNegative:string[]`に値があっても、動くべきでない部品が静止した保証はない。**内部機構:** promptで抽出した禁止/onlyを**対象node集合・時間窓・入力系列上のmonitor**へコンパイル。例 `only-second-hand` → 初期watch-entry期間を例外として許すか否かを明示し、許可集合以外の可視nodeのworld transform/opacity/形状変化がepsilon未満。`no-bounce` → 主役motionの目標周りの速度符号の余計な反転/終値超過を禁止。`no-confetti` →粒子形状/多数の独立飛散objectのsemantic分類と時間軌跡を人手fixture付き検査。SM経路/hover/click/data状態ごとに再生し、`PASS/FAIL/UNKNOWN`と反例入力traceを保存。**R1との差:** transform witnessが「動いた物体の支点が幾何的に正しいか」を見るのに対して、monitorは「何がいつ動くのを許されたか」という時系列論理を扱う。**出力:** `behavior-trace.jsonl`、最小違反時間窓とnodeパス。**フック:** 新規`scripts/behavior-contract-monitor.mjs`、`test/fixtures/behavior-negatives`、現行[storyboard L60–95](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/scripts/motion-storyboard.mjs#L60-L95)・[writer SM L349–404](https://github.com/ODU33104/rive-mcp/blob/3db224bbbfc29d7676165e077b169be4b84aa9f5/src/rivWriter.ts#L349-L404)と公式CLIの`--pointer/--data/--advance/--data-dump`を用いる。**成立条件:** nodeのmotion観測、分類の精度、時刻窓・例外の事前凍結。**副作用:** 知覚上の微小揺れも過敏検出する可能性; confetti類の意味判定はfalse negativeリスク。**簡単な対抗:** 作者が禁止のある既存トラックを丸ごと削除する。**1週間反証:** SOLSTICE由来の3禁則×正誤fixtureを生成し、意図的違反9件全て検出・正常3件を誤FAILしなければ継続。**採否:** V4でcritical gateとして試験、未検証状態では未知扱い。

## 4. 差分行列表（R1→R2の自己修正）

| 項目 | 削除したもの | 残すもの | 新規に作るもの |
|---|---|---|---|
| Quality objective | I2 low-frequency target一致を勝利条件にすること | 候補render、blind人間評価 | I4 relational ledgerを**診断に限定**、絶対targetは参考値 |
| Safety | タグを持てばhard negativeを満たすという暗黙前提 | I3 transform witness、rights gate | I5 temporal prohibition monitor |
| Scene family | Bを失敗後もA/Cで救えば勝利とすること | 1-spot slot feasibility | B routeの適用率/失敗率/救済を分母別管理 |
| Search | 新recipeを自動本番投入 | discovery/referenceを無制限に近く保持 | 独立holdoutに通したrecipeだけproduction候補 |
| Rendering | CLIの作者側PASSを美観のPASSと呼ぶこと | 公式CLI/既存runtimeの検証 | 同一条件の対作品blindと偽物/欠損のnegative control |
| Rights | 公開URLを再利用権と見ること | 参照/利用の区別 | 操作別、asset hash別の拒否記録 |
| Transfer | 時計の見た目を未知題材へ横滑り | Bは同種domainに限定 | 失敗を明示するrouting ledger（仕様の追加であって再命名ではない） |

**次設計:** [V4](../proposals/MOTION_ATLAS_ARCHITECTURE_V4.md)。R2でI4・I5の実装/テストは実施していない。勝者確定を意図的に保留する。
