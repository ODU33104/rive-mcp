# 引き継ぎ書 — rive-mcp / V5 real GLB → Rive GPU Canvas
更新: 2026-10-15 (Asia/Tokyo)

## 目的・品質基準
ユーザーの目的は「自然言語から、見る人を驚かせるほど美しく、高度で、意味的に正しく、編集可能な Rive (.riv) を生成できるシステム」。**CI成功や作品・素材件数の増加を完成と誤認しない**。元素材の権利と実フレーム、Rive編集性、見た目の優劣を別々に検証すること。制作、エフェクト収集・移植、意味的リグ、自然言語組立、品質評価は並列で継続する。mainには勝手にマージしない。

## 正確なGitHubの場所
- repository: https://github.com/ODU33104/rive-mcp
- parent feature PR #53: https://github.com/ODU33104/rive-mcp/pull/53 ; branch `feat/motion-recipe-atlas`（2026-10-15確認時点 open）
- 現行V5実装PR #89: https://github.com/ODU33104/rive-mcp/pull/89 ; branch `feat/v5-cc0-glb-rive-gpu-studio`、base `feat/motion-recipe-atlas`、**open / draft / 未マージ**、確認したhead `b6ad65c0de84caa0d01eda1bc9060eb7c86fac75`
- 既存の公式経路は親branchに実装・統合済み：PR #86（CLI/RML）、#87（WebGL2描画）、#88（Rive CLI実WGSL/Luau）、関連広範調査 #85。
- 既存フラッグシップ再制作のドラフトPR #84、V3並列制作PR #79–83などは、作品としての品質合格やmain統合を意味しない。

## 実証済みの現段階
1. 独自ライターとは独立に **Rive CLI 1.5.1** の RML → native `.riv` → PNG を確認済み。WebGL2 `@rive-app/webgl2` 2.44.2 は `enableGPUCanvas:true`、`useOffscreenRenderer:false` で既存ファイルをレンダリング可能。WGSL + Luau + GPUCanvas の実コードも公式CLIでコンパイル・描画成功。ただし、**スクリプト入りRiveのweb配信はアカウントによる `--publish` 署名が必要で、未検証**。
2. V5はKhronosの実モデル WaterBottle の `.glb` を、コミット `edc7c9e67c639d230715049ee31f9a96a6babbbe` に固定して取得。対象ファイルと権利は `Models/WaterBottle/README.md`、`LICENSE.md`、`metadata.json` を参照。**GLB等のモデルデータはCC0-1.0**、文書等の権利は別管理。出典 https://github.com/KhronosGroup/glTF-Sample-Assets/tree/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/WaterBottle
3. `scripts/v5-real-glb-mesh.mjs` が実GLBヘッダ、シーングラフ、ノード変換、アクセサ、インデックス、`POSITION`・`NORMAL`、材質係数を検証・抽出。**4,510 source triangles** をRive `GPUBuffer` 用データへ。バイトハッシュと権利証拠を保存。サンプルGLBの固定SHA256は従来記録 `b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b`。
4. `scripts/v5-rive-real-model-scene.mjs` が元GLB頂点・法線と baseColor/metallic/roughness係数に基づくWGSL、Luau `GPUCanvas` / `GPUPipeline` / depth32float、元のInterフォントを使うテキスト付き作品を作成。3つのlook `midnight` / `glacier` / `museum`。ネイティブ `.riv` と各31枚の**公式RiveレンダリングPNG**およびGIFまで実証した。
5. 最新確認済みV5公式CI: https://github.com/ODU33104/rive-mcp/actions/runs/38552351085 は**3/3成功**。これはレンダリング/コード通過の証拠であって、高品質作品や編集可能なGLBメッシュをRive Editorで直接頂点編集できることの証明ではない。
6. 品質は**未達**。実3Dの陰影/輪郭は改善したが、薄い背景表現、テクスチャ不在、類似構図、未成熟なアートディレクションが残る。ユーザーが求める水準に達したと言わない。

## 今から実装すべき内容（最優先）
現在のV5で欠ける **本物のGLBテクスチャ/UV/材質の復元**。コードを読んだうえで次を専用ブランチで進める。
1. 元GLBの `TEXCOORD_0`、`images` / `textures` / `samplers`、`pbrMetallicRoughness.baseColorTexture`、`metallicRoughnessTexture`、`normalTexture`、必要な色空間・UV transformを取得。元テクスチャが存在しない場合は**存在する別の権利クリアGLB**を調達。存在しない情報を捏造しない。
2. 実`GPUTexture`・`GPUSampler`・bind groupをRiveの**公式CLI/Luau/WGSL API**に合わせて組み込み、材質シェーダーで元ベースカラー、金属/粗さ、法線が適切に使われるようにする。まず小さな最小プロトタイプでRive CLI build / real screenshotを通し、既存3D版へ横展開。
3. HDRI/環境照明、透明/ガラス表現、接地影は別のライセンス・描画条件を要する。権利確認後、材質・構図・モーションの差として視認できることを実フレームで示す。Poly HavenのCC0環境素材等は取得時にAPI規約とアセットライセンスを別々に確認。
4. 一作品につき少なくとも3つの**スタイルフレームを静止画で選抜 → 動かす**。構図の重複、テキスト重なり、見えないFX、平面的反射を実画像で拒否。前後比較は同じ題材・時間・カメラ/表示領域で、**画素差分を美的評価と取り違えない**。人によるブラインド審査がなければ NOT_EVALUATED。
5. 本番web向けスクリプト署名はユーザーの正規アカウント認可が必要。無署名ローカルCLI実験を公開web対応と書かない。Rive Editorでの実際の編集/再保存と元GLB/コードの編集性も区別する。

## コード・検証ポイント
- `scripts/v5-real-glb-mesh.mjs`: 実GLBローダー/材質抽出
- `scripts/v5-rive-real-model-scene.mjs`: Luau/WGSL scene builder
- `scripts/v5-real-gpu-audit.mjs`: GLBソース/画素監査
- `scripts/v5-real-gpu-sequence.mjs`: 実Rive 31 PNG時間フレーム
- `test/v5RealModel.mjs`: グラマー・source/rights/実データのテスト
- `.github/workflows/v5-real-glb-gpu.yml`: 3並列実Rive CLI test
- `docs/V5_REAL_3D_MODEL_STUDIO.md`: 出典/制限/再現方法
- 参考公式docs: https://github.com/rive-app/rive-docs/tree/main/scripting/api-reference/gpu , https://github.com/rive-app/rive-docs/blob/main/scripting/wgsl-shaders.mdx

## 次のセッションでの実施指示
`ODU33104/rive-mcp` の `feat/v5-cc0-glb-rive-gpu-studio` を起点に、新しい非競合ブランチでV6テクスチャ/PBR試験を実装する。現行PR #89と親PR #53の状態、公式CLI/APIと権利を再確認し、GitHubへpush、ドラフトPR、実際の公式Riveネイティブ画像/GIFとコードをCIで検証すること。失敗や不足は隠さず実コード・ログで示す。mainは変更しない。既存の2D製作・自動組立・部品の再利用と品質評価は捨てず、V6を独立した技術経路にする。

この引き継ぎ書は**現在までに確認済みの状態**を記録したものであり、V6の開発を実行したと主張しない。
