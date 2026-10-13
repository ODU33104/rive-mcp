# 実行指示：構想改善→敵対的審査を**合計3ラウンド**繰り返し、新しい発明的提案を必ず出す

**これは独立レビューと改善設計の依頼です。既存の構想を追認してはいけません。** 依頼者にはコピペや説明の追加を求めず、本ファイルとGitHubの一次資料だけで完結させてください。

## 0. 目的と固定前提

対象リポジトリ：`ODU33104/rive-mcp`

- **最初に読む（必須）:** `docs/proposals/MOTION_ATLAS_ARCHITECTURE_V2_20261013.md` on `coord/motion-grammar-3rounds-20261013`。これは先行NO-GOを受けた再提案であり、**正解とは限らない**。
- **先行独立審査:** `docs/reviews/MOTION_GRAMMAR_REDTEAM_20261013.md` on `review/motion-grammar-redteam-20261013`、[PR #58](https://github.com/ODU33104/rive-mcp/pull/58)。前回判定：汎用Part Atlas全面構築はNO-GO、限定実験だけGO。
- **現行実装:** `feat/motion-recipe-atlas`、[PR #53](https://github.com/ODU33104/rive-mcp/pull/53)。`main`は未統合の可能性があるので**勝手にmainの古い実装だけで判断しない**。
- 必読実装：`src/rivWriter.ts`, `scripts/motion-recipe.mjs`, `scripts/motion-storyboard.mjs`, `scripts/build-motion-atlas-gold.mjs`, `samples/motion-atlas-gold/scene.json`, `data/motion-recipes/catalog.v1.json`、既存CIのレンダリングと検索評価ログ。
- **ユーザーの真の望み:** たった1度の自然言語の指示で、驚くほど見た目が優れ、実際に動作し編集できるRive作品が欲しい。ユーザーの追加入力なしで内部候補生成・比較・改訂は認める。既存公式Rive CLI/RML/MCP/Editorの実行能力をコピーして差別化しない。
- ユーザーは、レシピ・世界の参考演出の**可能な限りの拡充**と、各作品を部品・動き・見た目・相互依存へ分解して組み直す知識の増加を重視。ただし数の最大化が品質を落とす危険は真剣に検討する。
- 作者の「使って良い」発言や公開URLはライセンスを保証しない。公開参照、改変、素材取り込み、再配布、学習を個別の権利根拠で区別する。

## 1. 必須モード：「3ターンの改善→反証」、1ターンで打ち切らない

**同じ一つの別セッションで完遂できるように依頼するが、これは第三者3人による独立審査と同一ではない。** 自己評価バイアスを抑えるため、ラウンドごとに異なる勝者仮説・失敗試験・評価を要求し、直前の案への忠誠は認めない。可能な範囲で外部一次資料や既存実装の客観的証拠で評価せよ。

### ROUND 1 — V2を厳格に壊し、さらに良いV3を発明

1. [V2提案](../proposals/MOTION_ATLAS_ARCHITECTURE_V2_20261013.md) の問題を **P0/P1/P2** に格付けし、現行実装のパス/行、CIまたは公式Riveドキュメントで裏付ける。
2. V2が「アンカーシーン偏重」「capsule粒度」「失敗へのfallback依存」「制作美観への低い寄与」「権利管理のスケーラビリティ」「レシピ検索の激しい衝突」「生成コスト」などにどう失敗するか具体的反例を挙げる。
3. **新提案を最低3つ**出すこと。単なる名称変更・タグの追加・既存案の言い換えは **0件扱い**。例えば procedural scene programs、visual target-first synthesis、typed visual slots with constraint solving、multi-resolution semantic motifs、library distillation + failure-driven retrieval、motion energy scoring など、V2の外へ発想してよい。例示以外の独創案も歓迎。
4. 各新提案に、解決する欠陥／内部機構／既存ファイルへの実装フック／成立条件／副作用／より単純な対抗方式／1週間以内の反証実験を記す。
5. 勝者を1つ選ぶか合理的にhybridizeし、**V3**文書を提案。V2の主張で捨てたものを明示する。

**保存する：**
- `docs/reviews/MOTION_GRAMMAR_ROUND_1.md`（独立批判＋最低3つの新しい仕組み）
- `docs/proposals/MOTION_ATLAS_ARCHITECTURE_V3.md`（第1回ブラッシュアップ設計）

### ROUND 2 — V3を敵対的に再チェックし、V4へ再設計

1. V3を新しい仮説として扱い、前回書いたからという理由で守らない。
2. 「見た目が悪いがすべてのunit testは通る例」「本当の時計の支点が壊れる例」「未見の題材にコピーした瞬間破綻する例」「no-bounce/no-confetti/only-second-handを破る例」「クリッピングとテキストの問題」を、**最低5つの反例**で突く。
3. V3と、少なくとも **(A)完成scene編集、(B)RML直接生成、(C)最小typed slot/scene-family、(D)提案者の新設計** を同条件で比較する。
4. **ROUND 1では挙げていない新しい実装提案を最低2つ**作る。既存案を小さくして言い換えるだけでは不可。新たなデータ源、視覚フィードバック機構、制約表現、スタイル一貫性の測定、部品機能の新たな表現など実質的な差分が必要。
5. 各変更について「何を削ったか・何を残したか・何が新規か」をdiff形式の表で説明し、**V4**を作る。

**保存する：**
- `docs/reviews/MOTION_GRAMMAR_ROUND_2.md`
- `docs/proposals/MOTION_ATLAS_ARCHITECTURE_V4.md`

### ROUND 3 — V4を最終レッドチーム。さらに提案を出し、条件付きの最終決定

1. V4を先入観なく再評価し、前回と異なる反証方法を工夫する。かならず新しい情報を探すか、既存コード上で新しい具体的失敗例を提示する。
2. **ROUND 1/2になかった、新しい機構を最低1つ**追加する（世界的な作品収集の知識を制作可能な部品/動きへ変換する工夫が望ましいが限定しない）。「まだ残っている穴」を埋める設計の実体・安く試す方法を明記。
3. 最終の候補を、品質、題材多様性、再構成の安全性、コスト、追加レシピの効果、ライセンス、公式実行backend活用度で比較する。**同点はあり得る**。ユーザーが望む広範な拡張を実現できる経路も示す。
4. 最終判定は `GO` / `CONDITIONAL GO` / `NO-GO`。判定対象を「限定MVP」「その次の規模拡大」「汎用化」の3つに分けて評価し、三者を一括でGOにしない。
5. 2週間程度で判断できる実験を最低3つ設計：SOLSTICEの意味的分解・復元、題材入替（時計→イヤホン/抽象計器等）、scene edit vs direct RML vs hybridの実レンダリング・同budget比較、新レシピ検索/生成の独立holdout。ピクセル一致と美的評価は別に測る。
6. **Final V5または中止設計**として、具体的schema/protocol例、使う既存Rive機能、追加実装ファイル、責務、先行作業の優先順位、権利gate、失敗時fallbackを示す。初期V2とどう違うか明示する。

**保存する：**
- `docs/reviews/MOTION_GRAMMAR_ROUND_3.md`
- `docs/proposals/MOTION_ATLAS_FINAL_RECOMMENDATION_V5.md`

## 2. 「本当に新しい提案」を強制する合否条件

**必須累積:** R1≥3、R2≥2、R3≥1、合計**6以上の互いに非重複な新機構**を提出。単に4つのレイヤーへ別名を付ける、GitHub issue名を付ける、スコアの係数だけ変える、`Part Atlas`を`Capsule Atlas`と改名するのは不合格。

全新提案を次の表形式で `docs/reviews/MOTION_GRAMMAR_INNOVATION_MATRIX.md` にまとめる：

| ID | Round | 新規機構の要約 | V2/過去ラウンドとの**非同一性** | 変える実装ファイル/契約 | 生む出力 | 失敗モード | 最小反証テスト | 採否 |
|---|---|---|---|---|---|---|---|---|

具体性の採点：**Novelty / Actual user-visible aesthetic leverage / Feasibility / Rive compatibility / Transfer safety / Scale** を各0–5で採点（主観スコアとして明記）。一つも視覚品質へつながる機構がない場合は不合格。既存の公式CLI機能を再実装するだけは差別化として不合格。

**創造的な異議を求める:** こちらのV2より優れた設計を発見したなら、遠慮なくV2全体を廃棄せよ。少なくとも1つは著者の方向性から明確に外れた **wildcard案** を出し、比較試験と棄却理由まで述べる（採用しなくてもよい）。「すべて賛成」は不合格。

**外部知見:** 2026時点の公式Riveと、実際に存在する技術・作品例をソース付きで調査し、必要なときに参照する。存在しない仕様、URL、利用権、先行AIモデルの性能を捏造しない。論拠と推測を混同しない。

**工学的精度:** 座標のlocal/world、グループ原点/pivot、親子、影、mask/clip、style cohesion、motion curves、state-machine/loop、asset-rightsを曖昧なタグで片付けない。現行SceneSpecや公式Riveができることと、未実装のレイヤーを峻別する。

## 3. GitHub納品・編集範囲

- この調整ブランチ `coord/motion-grammar-3rounds-20261013` をベースに、**新規ブランチ** `review/motion-grammar-three-rounds-20261013`（既存なら識別可能な末尾を追加）を作る。
- 既存コードや仕様・レシピ・テストを**変更しない**。編集許可は以下の7文書のみ：
  - `docs/reviews/MOTION_GRAMMAR_ROUND_1.md`
  - `docs/proposals/MOTION_ATLAS_ARCHITECTURE_V3.md`
  - `docs/reviews/MOTION_GRAMMAR_ROUND_2.md`
  - `docs/proposals/MOTION_ATLAS_ARCHITECTURE_V4.md`
  - `docs/reviews/MOTION_GRAMMAR_ROUND_3.md`
  - `docs/proposals/MOTION_ATLAS_FINAL_RECOMMENDATION_V5.md`
  - `docs/reviews/MOTION_GRAMMAR_INNOVATION_MATRIX.md`
- 各Roundの文書を**順にGitHubへコミット**すること（R1結果→V3→R2結果→V4→R3結果→最終案）。「検討したつもり」で全部を同じ短い最終まとめに圧縮しない。前ラウンドの本文を上書きして隠さない。
- 最終PRのベースは `coord/motion-grammar-3rounds-20261013`。PRタイトルは `review: three-round architecture innovation and adversarial redesign`。PRを勝手にマージしない。
- レビュアーの環境でアクセスできないファイルは「未確認」と明記。実装・生成・CIは依頼していない。実行していないテストを成功と書かない。
- **最後の返答に含めるもの:** 各ラウンドの結論の遷移、**新機構6個以上の名前と1行の効果**、V5の判定、最も重大な未解決リスク、PRのURL。
- ユーザーの追加説明・会話履歴の貼り付け・確認を求めず完遂。GitHub権限がない場合だけ、全7文書の完成内容を返答して障害を明記。

## 4. レビュー合格の定義

✅ 3回の**批判→独自提案→設計改訂**が別文書・別コミットで明確に残る  
✅ 既存V2にない新機構が合計6以上、具体的な実装契約と棄却試験を持つ  
✅ 完成scene編集・公式RML直接生成・scene family・一般grammarの優劣を公平に比較  
✅ 公式Riveと既存コードを根拠に「できる／できない」を分ける  
✅ レシピの大量拡張を可能にする発見レーンと、品質優先の実行レーンの両立を議論する  
✅ 盲目的なGOでなく、停止可能な実験とNO-GO条件がある

ユーザーの希望は「何度も自分で長文をコピーすること」ではない。本ファイルを読んだ一度の委任で、提案・検査の3サイクルを完了せよ。
