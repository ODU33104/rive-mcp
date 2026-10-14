# 2026-10-15 並列作業指令 / 司令塔・品質管理（V6–V8）
更新日: 2026-10-15 Asia/Tokyo  
対象: `ODU33104/rive-mcp`  
この文書は **別セッションに配布する実行指示書**。実装・美的合格・マージ済みという宣言ではない。

## 0. 北極星・出荷判定

到達目標: 自然言語から、観客が見て驚く水準の**美しく、意味的に正しく、動き、再編集できる native Rive `.riv`** を生成すること。技術デモの成功をユーザー価値と混同しない。

**司令塔（このチャット）の仕事**: 作業分割、基準固定、PRの差分/証拠/権利/実フレームの審査、ブロッカーと依存関係の整理、合否判定。実装は別セッション。**mainへのマージ権限を委譲しない**。

別々に合否をつける五つの軸:
1. **RIGHTS/SOURCE**: アセット単位で出典・作者・ライセンス原文・固定版・SHA256・権利範囲。GLBデータCC0とメタ文書/商標を混同しない。
2. **NATIVE/RUNTIME**: 公式 Rive CLI による実 `.riv` / verify / 実描画 / 時間差のあるPNG。自作レンダラ・合成モックだけではNG。
3. **MATERIAL/SEMANTICS**: 元glTF UV/PBR材質の意味、リグ/操作に対する意味的応答。ピクセル差分だけでは正確なPBRや意味を証明しない。
4. **EDITABILITY/DISTRIBUTION**: ソースGLB/WGSL/Luau/RML編集性、Rive Editorでの実編集・再保存、署名済web配信を**別の欄**で判定。未試験は `NOT_TESTED`、認証が必要なら `BLOCKED_AUTH`。
5. **VISUAL/ART**: 同条件比較の実画像、文字・余白・輪郭・照明・材質・構図・独創性・動きの合目的性。人のブラインド審査がなければ `NOT_EVALUATED`。CIの緑色を美的PASSに変換しない。

総合 `SHIP_READY` は全必須項目の独立PASSが揃った場合のみ。技術PASS/ビジュアル未評価は **RESEARCH_ONLY**。

## 1. 現在のGit構造と重複作業禁止

2026-10-15確認時点（セッション開始時に必ず再確認）:
- 親PR **#53** / `feat/motion-recipe-atlas`: open。既存2Dモーション・組立系。
- V5 PR **#89** / `feat/v5-cc0-glb-rive-gpu-studio` → base `feat/motion-recipe-atlas`: open / draft。実CC0 WaterBottle GLB頂点・法線・係数、公式Rive native GPUCanvas実フレームの基線。
- **V6はすでに実装PR #90 が存在**: `feat/v6-glb-true-pbr-textures` → base **V5**、open / draft。元glTFの4画像・UV・接線/法線・ORM等をGPUTextureで使うコード/対照実験が提出済み。**V6の再実装をゼロから重複発注しない**。
- **V7も実装PR #91 が存在**: `feat/v7-polyhaven-real-studio-ibl` → base **V6**、open / draft。Poly Haven実HDRを用いた環境反射・アブレーション実験が提出済み。**完了/合格という意味ではない**。
- 文書起点: [V5 handoff](../handoff/HANDOFF_2026-10-15_V5_RIVE_GPU_PBR.md)、[V5 restrictions](../V5_REAL_3D_MODEL_STUDIO.md)。
- PR: https://github.com/ODU33104/rive-mcp/pull/53 /pull/89 /pull/90 /pull/91

**ルール**: 各セッションは指定branchを**読むが直接pushしない**。自分専用の新branchを作り、差分は自分の担当ディレクトリ/接頭辞に限定。専用draft PRを指定base宛に作る。PRの土台をmainにしない。競合を見つけたら他セッションのファイルを強引に上書きせず、証拠と統合提案をPRに書く。force push、既存PRの無断更新、mainへのマージ禁止。作業前後で参照head SHAを記録。

### 全セッション共通の開始手順

1. この指令書・V5 handoff・自分の参照PRのhead/base・差分・CI・ライセンスを読む。**現在の状態を再確認**し、推測で「既に動く」と断言しない。
2. 自分用branchを作る。既に同名branchがあれば接尾辞を変える。コード/テスト/再現コマンド/作業後の既知制限をcommitする。生成物が重い場合はGitHub Actions artifactに原寸PNG/GIF/ログを残し、PRから辿れるようにする。
3. `npm ci && npm run build` を基本に、公式Rive CLI版を実ログに記録。`rive <project> --verify`、ビルドと `--screenshot=... --viewport=960x600 --advance=0.6s` / `2.8s` を成功実行した証拠を要求。実行不可なら未検証として明記。外部ライセンス/ハッシュ検証はCIでも行う。
4. **PR本文の必須欄**: `BASE_SHA`, `HEAD_SHA`, `SCOPE`, `REAL_SOURCE_AND_LICENSE`, `TEST_COMMANDS`, `CI_RUN_URL`, `RIVE_VERSION`, `ORIGINAL_RIV_OUTPUT`, `FIRST_PARTY_FRAME_URLS`, `MATCHED_A_B`, `RIGHTS`, `EDITOR_EDIT_AND_RESAVE`, `SIGNED_WEB`, `HUMAN_BLIND_REVIEW`, `KNOWN_LIMITATIONS`, `VERDICT: PASS/FAIL/BLOCKED/NOT_EVALUATED`。
5. セッション終了時は**PR URLを1本と、失敗時だけ短いブロッカー**を報告。緑CI/数値指標を理由に見た目が優れていると宣言しない。

## 2. 並列セッション別の指令

各作業者に**このファイルのURL＋「担当 S1」等の1行**を渡す。S1–S6は同時に開始してよい。S1/S2の成果は独立してレビューし、後から依存順に統合する。

### S1 [P0] V6 glTF真性PBRの**独立フォレンジック・欠陥修正**

- 起点/PR base: `feat/v6-glb-true-pbr-textures`、新branch `qa/v6-pbr-forensic-20261015`。**PR #90を書き換えない**。
- 参照: `scripts/v5-real-glb-mesh.mjs`, `scripts/v5-rive-real-model-scene.mjs`, PR #90 の `scripts/v6-*`, `test/v6OriginalPBR.mjs`, V6 workflow。
- 独立検査: 実GLBのimages/textures/samplers・各UVセット・bufferView/stride/境界・画素の出典ハッシュ、sRGB→linear、metallicRoughnessTexture の **G=roughness/B=metallic**、occlusionのR、normal mapの接線空間/手系/強度、emissive、glTF係数・alpha/mask・UV transform対応範囲。必要な未対応ケースは「拒否」か「未実装」を明示。元のWaterBottleが実際に持つデータと混同しない。
- A/B: native `.riv` の同一ジオメトリ/同一時刻/同一カメラ/同一ライティング/同一shaderで、元画像対neutral画像だけを比較。色マップ以外の変数を固定し、channel-wise ablationを可能な範囲で実施。画素差に加え参照glTF意味との整合を検証。
- 成果: 具体的なバグ再現テストと**最小修正**、元ソース/ネイティブフレームへのリンク、見落とした対応範囲の表。修正不要ならその証拠と `NO_CHANGES_REQUIRED` を記録（空のPRは不要）。
- 編集範囲: `scripts/v6-*`, `test/v6*`, `docs/qa/V6_*`。他ラインには触らない。

### S2 [P0] V7実HDR/IBLの**独立照明・物理妥当性レビュー**

- 起点/PR base: `feat/v7-polyhaven-real-studio-ibl`、新branch `qa/v7-ibl-forensic-20261015`。PR #91を書き換えない。
- 参照: PR #91、`scripts/v7-*`, `test/v7PolyHavenStudio.mjs`, V7 workflow。V6との依存を記録。
- 検査: Poly Haven正規API・license・作者/識別子/固定ダウンロードハッシュ、RGBE→float16の**輝度レンジの保持**、緯度経度UV/左右反転/座標系、roughnessで反射が変化するか、金属と誘電体の見え方、トーンマッピング/露出の固定、neutral環境とのアブレーション。同じモデル・カメラ・時刻で比較。
- **現行はfull IBLではない**（prefilter / BRDF LUT等が未実装ならそう記載）。HDRの存在、強い輝度差、画素差分だけで正しい反射と誤認しない。V6の欠陥をV7照明の効果として見せない。
- 成果: ゼロ/有限/高輝度/NaN処理のテスト、nativeフレーム、過露出/平面鏡面等の明瞭な拒否基準、必要最小の修正。
- 編集範囲: `scripts/v7-*`, `test/v7*`, `docs/qa/V7_*`。V6の変更はS1へ報告して分離。

### S3 [P0] 美的水準の突破: **3つ以上の独立スタイルフレーム → 選抜 → 実モーション**

- 起点/PR base: `feat/v5-cc0-glb-rive-gpu-studio`、新branch `feat/v8-art-direction-20261015`。
- **コーディング前に少なくとも3つの静止スタイルフレーム**を実フレームで提示。違いは色名の変更ではなく、構図、オブジェクトの意味、階層、カメラ/光、余白、タイポ、マテリアル、動きの理由。V5 midnight/glacier/museumを「3ジャンルの合格品」と数えない。
- WaterBottle GLBの権利上のロゴ/商標処理に留意。出典のない素材や生成した偽GLBで置換しない。写真風・UI風・エディトリアル等、目的の違う3案を描き、各案の静止→動作後の関係を説明。単なるFX増量やテキストの上置きを避ける。
- 選抜前に無理に31枚アニメ化しない。選抜後、native `.riv` / 原寸 PNG / 31 real frames / GIFを作成し、タイトル重なり、背景の薄さ、浮遊感、切れ・露出破綻を画像で判定。
- 選抜に実際の人間が参加していなければ **`HUMAN_BLIND_REVIEW=NOT_EVALUATED`**。生成担当自身の評価はブラインド審査と呼ばない。
- 編集範囲: 新規 `scripts/v8-art-*`, `test/v8Art*`, `docs/art-direction/V8_*`, 独立 workflow。既存v5/v6/v7ファイルは変更しない。V6/V7に依存する効果は別途統合候補として報告。

### S4 [P0] 独立QC: **実画像・実ソース・リグ意味・視覚比較ゲート**

- 起点/PR base: `feat/v5-cc0-glb-rive-gpu-studio`、新branch `qa/visual-regression-independent-20261015`。
- 既存 `scripts/v5-real-gpu-audit.mjs` が測る「可視メッシュ」「時間差」は**最低限の存在確認**であって美しさの保証ではない。対照画像を固定条件で並べるコンタクトシート/記録JSON/CI artifact/人間審査票を新規実装。
- 自動ゲート例: 寸法、alpha、真のRIVEバイナリ、ソースHASH/権利、キャプチャ再現性、全黒/静止/クリッピング・UI文字の境界/オブジェクトの切れ（検出不能項目は人間審査へ）。**各チェックの偽陽性/偽陰性を明記**。
- 自動採点不可: 「驚き」「高級感」「自然な反射」「構図の良さ」「ブランド一貫性」。人のブラインド比較: 被験者/条件/基準/票/不合格理由を記録、未実施は `NOT_EVALUATED`、全候補PASSにしない。
- 成果: V5・V6・V7・S3の成果をあとから同じルールで評価できる**データ契約と実行スクリプト**、少なくともV5の実画像でスモークテスト、レビュー票。初期はV5のみで動作し、他ラインのPRは変更しない。
- 編集範囲: `scripts/qa-*`, `test/qa*`, `docs/qa/REVIEW_*`, 独立workflow。

### S5 [P1] 自然言語→**意味的に編集可能なRive**の最短縦切り

- 起点/PR base: `feat/motion-recipe-atlas`、新branch `feat/v8-semantic-assembly-20261015`。2D/レシピ路線を捨てない。GPU側PRと統合しないまま独立実証。
- 目的: 単なる見た目のクリップ生成ではなく、入力意図（例: ボタンのhover/click、UI開閉、製品の特徴強調）を**名前付きstate/input/再利用可能な部品/明示的タイミング**へ変換する薄い縦切り。固定作品1つだけをLLM生成システムと呼ばない。
- 3つ以上の異なる自然言語入力→解釈中間表現→生成物→期待挙動テストを提示。曖昧入力は勝手に意味を足さず曖昧さを出力。入力変更に対する**実動作差**と、source editでの再生成を検証。
- 最終 `.riv` は公式CLIで実build/PNG。普通のRive Editorで動くstate-machineとLua内生成テキストの違いを説明。「native GPUCanvas頂点がRive Editorで通常のベクターポイントとして直接編集できる」と主張しない。
- 既存パッケージ構成を読んで重複実装を避ける。編集範囲: 新規 `src/semantic-assembly/**`（既存なら競合しないサブディレクトリ）、`test/semanticAssembly*`, `docs/semantic-assembly/**`、独立workflow。別ブランチのコードを上書きしない。

### S6 [P1] Editor・Web配信の**真の互換性境界**を監査

- 起点/PR base: `feat/v5-cc0-glb-rive-gpu-studio`、新branch `qa/rive-editor-web-contract-20261015`。
- 調査/検証: 公式Rive CLI native script build、Editorでのimport/編集/再保存、`rive --publish` の署名要件、`@rive-app/webgl2` での可視化（可能な権限・公開手段に限定）。**ユーザーの秘密情報、Riveトークン、資格情報を要求・保存・迂回しない**。
- 無署名ローカルCLI `.riv` がブラウザで再生不可なら `BLOCKED_AUTH` / `NOT_VERIFIED`。手元の静止画像やWebGLの別実装でweb署名済みと称さない。
- 成果: `LOCAL_CLI`, `WEB_SIGNED`, `EDITOR_OPEN`, `EDITOR_EDIT_RESAVE`, `SOURCE_REGENERATE` の**別々の証拠URL付きマトリクス**。自動検査できるものだけコード化。ログインできないものは正直に未検証と書く。
- 編集範囲: `docs/compatibility/**`, `test/compatibility*`, 任意の `scripts/compat-*`。production成果物に手を触れない。

## 3. QC審査票（各PRをこの順で査定）

| Gate | 必須の証拠 | FAIL / 未評価例 |
|---|---|---|
| G0 汚染防止 | 規定PR base、元branch SHA、限定差分 | main直push、他担当ファイルの上書き |
| G1 出典と権利 | 原URL、固定版、作品単位license、SHA、スコープ | 「GitHubだから自由」「CC0だからロゴも自由」 |
| G2 実装の真正性 | ソース処理コード、blob/テクスチャ/頂点の監査 | ダミーデータ、見た目だけの差替え |
| G3 公式Rive実行 | CLI版、verify/build、native `.riv`、全サイズPNG、ログ | 画像生成の見本をRive実描画と偽る |
| G4 統制された比較 | baselineと変更版のtime/camera/viewport/geometry固定 | 露出も角度も違う画像を優劣比較 |
| G5 技術の意味 | GLBの正しいchannel・UV・入力state/応答、拒否テスト | 差分はあるが意味が間違っている |
| G6 美術品質 | 3以上の選抜静止案、欠点リスト、実際の人の盲検票 | CIやピクセル差で「高品質PASS」 |
| G7 編集/公開 | ソース編集、Editor edit/resave、Web署名を区別 | 未署名をweb-readyと称する |
| G8 再現性 | CI/artifact URL、手順、失敗ログ、既知限界 | ローカル口頭報告のみ |

**判定語彙を固定**: `PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED` / `NOT_EVALUATED`。いずれのPRでも表中に証拠URLがなければ原則 `NOT_TESTED`。品質の主張に対し検証可能性がない場合は **Reject**。

## 4. 統合順・優先順位・停止条件

- **まずS1 / S2 / S3 / S4を並列実施**。S5 / S6は独立並走可。S1/S2は既存#90/#91の品質審査であり、同じV6/V7を改めて「完成させる」仕事ではない。
- S1の修正をV6に採用するかは司令塔の審査後に判断。**V7はV6をbaseとするため、採用後はV7を更新/再検証**。枝間で競合/比較条件が変わった場合は過去のCI結果を流用しない。
- S3はS4の基準で評価。S3がどれほど美しくても、S1/S2のテクスチャ・IBL真正性を自動的に保証しない。
- S5は別経路。自然言語→meaning/state→Riveの契約が通ったときだけ3Dとの統合設計を始める。
- 署名・Editor認証がない作業はそこで停止し、代替証拠の範囲を明記。鍵の回避策を試さない。
- **P0出荷停止**: 無出典アセット、無権限配信、Rive以外の擬似成果、実フレームに顕著な視覚欠陥、初期意図に反するstate、実際は未検証の編集性、比較条件が不一致、人の評価がないのに美的合格と記載。
- PR #53/#89/#90/#91 およびS1–S6を**勝手にmainへマージしない**。司令塔は各PRの `G0–G8` を表形式で判定し、FAIL/NOT_EVALUATEDは改善依頼。統合する場合も個別PR・実画像再レビュー・ユーザー承認を経る。

## 5. 次回この司令塔チャットへの戻し方

ユーザーは各作業セッションが返した**PR URLのみ**をこのチャットへ貼る。司令塔は該当PRのhead/base、テスト・Rive nativeフレーム・権利・映像品質・他PRとの重複/依存を検証し、**承認 / 差し戻し / 次の具体指示**をGitHub上の新しい監査文書に残して、返答はそのURLのみとする。合格の証拠がない部分を推定補完しない。
