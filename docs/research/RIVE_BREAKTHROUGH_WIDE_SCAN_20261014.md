# Rive / Motion Design 突破口調査 — 2026-10-14

> 種別: **外部調査・仮説メモ**。本書に登場する外部コード・3D素材は現時点でこのリポジトリへ一切組み込んでいない。ライセンスラベルは実取得後の組込許諾を保証しない。ユーザーが指摘した「作品が平面的・類型的・驚かない」課題に対して、制作方法を変えうる根拠を整理する。調査で言及するSNSは制作者投稿とコミュニティの意見であり、公式な性能保証とは区別する。

## Executive finding

**結論: 今の独自 `JSON SceneSpec → custom .riv binary → @rive-app/canvas-advanced` 一本足を正規の唯一ルートとみなすべきではない。**

2026年9月11日にRive公式は **Rive CLI + RML** の技術プレビューを発表した。公式CLIは `scene.rml`・`.luau`・`.wgsl` をテキストで扱い、ビルド、検証、inspect、スクリーンショット、ライブプレビューを提供する。必要に応じて `.rev` をRMLプロジェクトへ取り込める。これこそ既存ライブラリ／既存作品の改変・AI生成と検査の有力な入口。UIや状態機械、既存部品の設計情報を独自バイナリ変換で再解釈しなくてよい可能性がある。参照: [Rive CLI発表](https://community.rive.app/c/announcements/introducing-the-rive-cli-and-rml) / [公式Overview](https://github.com/rive-app/rive-docs/blob/main/cli/overview.mdx) / [公式セットアップ](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx) / [公式Agents](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx)。

**第二の突破口は GPU Canvas。** 2026年9月3日に本番Editorへ提供されたとRive側が告知。GPU CanvasはWGSLで3Dモデル、ライト、PBRや質感、画像ポストエフェクトを実装し、2Dの編集可能なRiveアートボード／テキストを3Dサーフェスにする手段を提供する。Web等のランタイムでは対応状況が異なり、特にWebではWebGL2ランタイムの `enableGPUCanvas` が必要となる。現在のプロジェクトは `@rive-app/canvas` / `@rive-app/canvas-advanced` へ依存するため、旧プレビューで「無表示＝成功」と判定できない。参照: [Rive GPU Canvas発表](https://www.reddit.com/r/Rive_app/comments/1w6jrjt/rives_gpu_canvas_is_now_live_for_everyone/) / [現行機能互換](https://github.com/rive-app/rive-docs/blob/main/feature-support.mdx) / [WebGL2リリース記録](https://github.com/rive-app/rive-wasm/releases)。

**第三の突破口は制作工程そのもの:** 構図／アイデア／素材設計 → 3種のstyleframes → 静止画で選抜 → storyboards/animatic → 本番のRML+GPU制作。旧方式の「とにかくアートボードに図形を追加して動かす」を見直す。見栄えの悪い静止画に動きを付けても高品質にはならない。参照: [School of Motion制作工程](https://schoolofmotion.com/blog/guide-completing-motion-design-project) / [Styleframesとデザインの重要性](https://schoolofmotion.com/blog/is-design-important-motion-designers) / [Appleのモーションガイド](https://developer.apple.com/jp/design/human-interface-guidelines/motion)。

## 証拠と制作への影響 — 6発見

### F1: 公式CLI/RMLは独自バイナリwriterの全機能再実装を避ける候補 [高確度: Rive公式]

- RMLをAIが執筆し、CLIがビルド・inspect・preview・screenshot。生成物はGit差分可能。Editorの `.rev` を `rive create ... --from-rev=...` でソース化できると公式は記載。
- 公式の `AGENTS.md` に沿って `rive docs`, `rive schema`, `rive --verify`, `rive inspect --summary`, `rive --screenshot` を用いる。自然言語指示だけでなく実画像で反復する。
- 注意: 正式発表は「technical preview」。Web向けスクリプトを含むファイルは `--publish` による署名が必要で、公開時のアカウント/プラン/透かし条件もある。個人の開発用ローカル生成と商用配信は分ける。2026-10-14時点で本リポジトリへのCLI導入は**未実証**。
- 研究課題: 既存 `.riv` のみを元の編集可能な `.rev` と同義扱いしない。公式に明示された `--from-rev` と自分のアカウントの遠隔ファイルに優先度を付ける。出典: [CLI docs](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx)。

### F2: GPU Canvas / シェーダー・3Dを **Riveの内部で** 演出できる [高確度: 公式機能 + 制作者実例]

- 複数のRive公式・制作者投稿で、WGSLシェーダー、インタラクティブな3Dと2Dレイヤー、材質のsheen、PBR/HDR、画面合成、液体歪み、ポインタ対応、GPU上のマスクやテクスチャを確認。
- 9/17の「The Division」ゲームUI再構築投稿は、生成AIが最初に作った単純な3Dモデルを後でより質の高いモデルに**差し替えた**例。作者の投稿によれば、見栄えを上げる具体的な指示は影、法線、PBR、HDR、カーブした2D UI、sheen、演出テンポや二次動作等。単一プロンプトから一発で完璧にできた事例ではない。
- 9/18のGPUシェーダー実演は、WGSL + Node/Layout scriptでaurora、Live scene distortion、強度/速度ViewModel、再利用可能な複数インスタンスを公開。これが本来のエフェクトライブラリ化の具体像。
- 対照事例: 制作者の車コンフィギュレータは GLB + 可変色シェーダー + 本物の形状から生成した接地影である。**実際の3D物体・影形状・ライティング**を用いる方が従来の平たいグラデーション円より物理的な表現へ近い。作者はEditorの安定性問題も記録。
- 制限: Web側は `@rive-app/webgl2` のGPU Canvas対応を用いること。2026-10-01のRive runtime更新にもShader/Depth/GL不具合修正があるためAPI固定・ランタイムバージョン比較が必要。画面だけ美しいGPU Canvasがプロジェクトのベクター全要素に分解編集可能であるとは限らない。
- 出典: [GPU Canvas一般公開](https://www.reddit.com/r/Rive_app/comments/1w6jrjt/rives_gpu_canvas_is_now_live_for_everyone/) / [Shader活用](https://www.reddit.com/r/Rive_app/comments/1wjx9kp/using_gpu_shaders_in_rive/) / [CLI 3D実践](https://www.reddit.com/r/Rive_app/comments/1wikpyc/this_is_100_rive_i_used_the_new_rive_cli_with/) / [車の事例](https://www.reddit.com/r/Rive_app/comments/1up3t8y/i_built_a_fully_interactive_3d_car_configurator/) / [Runtime update](https://community.rive.app/c/announcements/rive-runtime-updates-october-1-2026) / [WebGL2 release](https://github.com/rive-app/rive-wasm/releases)。

### F3: 既存の本物の3Dモデル・PBR/HDRI・FX部品を法的に再利用できる [高確度: 公式ライセンス + 採用時検査必須]

- [Poly Haven](https://polyhaven.com/) は3Dモデル、HDRI、フォトスキャンPBR素材をCC0で配布し、[ライセンス](https://polyhaven.com/license)に商用・修正・再配布可と記載。APIは無料だが、ライブ利用時は[API規約](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)に出典表示やUser-Agent/Refererなど別義務あり。**アセットの権利とAPI規約は別々**。
- [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)には PBR/transmission/clearcoat の参考実物、GLB、モデル単位の明確なライセンス・出典がある。ただしCC0/CC BY/テスト専用/商標除外など**作品ごとに異なる**。例えばブランドロゴの混ざるWatchモデルはそのまま流用不可の場合がある。
- [Rive Marketplaceの3D scripts](https://rive.app/marketplace/28220-53314-early-access-3d-scripts/) は既存のGLTF importer/camera/PBR/UV等を提供する例だが、旧Early Access版の説明が残る。**現行GPU APIで実動作した部品**としては未証明。取得済み＝利用可能とは言わない。
- [Rive Marketplace Interactive Aquarium](https://rive.app/marketplace/28158-53168-interactive-aquarium/) は魚の生体挙動、ボーン、IK、動的背景とスクリプトをまとめる「高次のシーン/行動単位」の参考。キャラ/自然現象なども低レベルの幾何形状からすべて描き直す必要はない。
- 外部の完成作品を直接丸ごと取り込むのではなく、実装パターン・source + 入出力/依存・ライセンスを単位に区別して管理する。CC BYページのラベルだけで埋込アセットの所有権まで証明されない。
- 出典: [Poly Haven license](https://polyhaven.com/license), [Poly Haven API](https://polyhaven.com/our-api), [Khronos model inventory](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Models.md), [licensing example](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Sponza/LICENSE.md)。

### F4: エフェクトは再利用可能なGPU「演算・プログラム」へ [中〜高確度]

- 古いプリズムの線8本や星5個を移植しても画面変化が小さい原因は、効果が環境・入力・材質に接続されていないため、という仮説。
- 公開GPUシェーダー実演の「同じAuroraの強度/速度をViewModelで制御し、calm/storm複数個をインスタンス化」「描画済み2D作品自体へ歪みを適用」などを、形だけではなく**処理+調整+連携の単位**として収集する。
- 収集対象は次の5カテゴリに増やす: optical/PBR material, spatial lighting/shadows, post-processing/refraction, procedural particles/path effects, motion-reactive interactivity。Rive脚本・GPU Renderer版・ライセンスを分ける。パーティクルの件数勝負に戻らない。
- 注目作品: [Path Effect Script](https://rive.app/marketplace/26273-49129-path-effect-script/), [Procedural fake 3D Cards](https://rive.app/marketplace/22198-41596-fake-3d-cards/), [3D scripts](https://rive.app/marketplace/28220-53314-early-access-3d-scripts/), [Interactive Aquarium](https://rive.app/marketplace/28158-53168-interactive-aquarium/), [Shader活用実演](https://www.reddit.com/r/Rive_app/comments/1wjx9kp/using_gpu_shaders_in_rive/)。
- 「新規エフェクト候補数」「権利クリアのコード」「実際に2シーンで作動したコード」「既存作品と異なる美的価値の実証」を**別のカウンタ**にする。

### F5: 制作前にstyleframesとstoryboardを導入せよ [高確度: モーション制作の実践知]

- [School of Motion](https://schoolofmotion.com/blog/guide-completing-motion-design-project) はアイデア→ムードボード→storyboard→styleframes→animatic→アニメーションを推奨する。デザインの品質は静止画だけでも評価できる状態へ。3案以上で構図を比べ、そこで負ける作品はRive実装に進ませない。
- [School of Motion: Is Design Important?](https://schoolofmotion.com/blog/is-design-important-motion-designers) は「動けば良くなる」アプローチを批判し、カットの静止画自体に力があることを求める。
- [reddit 2026-08-30作品批評](https://www.reddit.com/r/MotionDesign/comments/1w2cnau/motion_concept_need_feedback_on_what_i_can_improve/) では、速すぎる/文字が読めない/スタイルが混在する/物語がないとのコメント。これは一般的傾向の参考であり統計ではないが、今のStudio作品の欠点と一致する。
- [reddit 2026-06-23具体的批評](https://www.reddit.com/r/MotionDesign/comments/1ud9sis/how_can_i_improve_my_designs/) では不必要なバウンスや長すぎるスキャンが疑問視。単純なUI的効果は製品映像の質を保証しない。
- [Appleデザインガイド](https://developer.apple.com/jp/design/human-interface-guidelines/motion) も「意味のない動きを避け、情報や操作の説明を優先」を推奨。
- 作品の評価項目: 冒頭の一枚で物の意味が伝わるか／3種類以上の構図案に差があるか／素材が本物らしい光を持つか／フレーム1枚でも印象が強いか／余計な効果を減らすと良くなるか／リズム/視線誘導が合っているか。

### F6: SNSの「AI一発完成」宣伝は見かけに反して反復制作 [中確度: 制作者の自己申告]

- [Rive共同創業者の3D+RML再構築の詳細](https://www.reddit.com/r/Rive_app/comments/1wikpyc/this_is_100_rive_i_used_the_new_rive_cli_with/) では、AIに具体的なRive機能を指定し、画角、影、ライト、sheen、素材、UI分割、キャラモデル、PBR、HDRを反復指示。本人も「初回案は簡素で質の低いモデルだったので差し替えた」「仕上げはEditor/本物の素材へ」と説明。**発想が優れているのはツールの自動化というより、アートディレクションをコードへ反映できるループ**である。
- [reddit 2026-09-28](https://www.reddit.com/r/MotionDesign/comments/1wsbbic/how_do_i_deal_with_like_senior_designers_drooling/) は「速いAI出力と熟練の品質が混同される」という現場の不満を紹介する。回答者の個人的見解であり調査統計とは見なさない。
- [reddit 2026-08-11](https://www.reddit.com/r/MotionDesign/comments/1vlgo43/i_am_so_sick_of_everyone_shoving_ai_video_editing/) はAI動画のタイミングとカメラ動作の不自然さを批評。**時間短縮≠美的品質**を前提に厳しい対面比較が必要。
- [Blender Studio Geometry Nodes](https://studio.blender.org/blog/impulse-purchase-production-file/) は複雑な映像制作のプロシージャル化と、素材、カメラ、リグをセットで扱う実務例。Riveを捨てるべきという話ではなく、3Dの素材/カメラ/材質生成工程をRive GPU Canvasへ接続しうる。

## 推奨開発仮説（優先順位と停止基準）

| Rank | 実験 | 必要なアウトプット | 成功と失敗の判定 |
|---|---|---|---|
| P0 | 公式Rive CLIを使い RML→.riv→screenshot を検証 | 最小動作するRMLプロジェクト、公式ログ、ネイティブRive、PNG、ライセンス/CLI版数 | 自動生成と実描画が両方成功。失敗なら該当API/環境を明示 |
| P0 | 従来Canvas対WebGL2+GPU Canvasを同じ題材/素材でA/B | shader付き/無しの原生2D+3D、同条件PNG/GIF、起動時間/サイズ/対応環境 | マスク付きGPU表示と3D、意味を持つ質感差。旧Canvasで描画不能でも嘘の代替不可 |
| P1 | CC0 3Dモデル/PBR/HDRIの**合法な実取得** | 1–3モデルの許諾/ハッシュ/構造、GLBロード、奥行き影/照明 | 2作品で原著パーツを使い意味のある演出が成立。不明な権利は中止 |
| P1 | スタイルフレーム先行制作 | 同一ブリーフの異なる3案×3シーン、構図の比較、選考理由 | 実際に選ばれた案だけアニメーション化。静止画時点で弱ければ棄却 |
| P1 | GPU FX（コード/入力/マテリアル/振る舞い）再利用 | 3系統の出典明確なshader+Luau/Component、ViewModel入力で複数用途、各2ホスト | 輝きが増した数値でなく、対応レンダラーで視認可能か・他ホストに適合するか |
| P2 | same-budget blind benchmark | MORROW/時計/高機能GUI× (現行writer,公式RML 2D, RML+GPU) 比較、同予算・同素材 | 同一条件で複数人の主観評価。自動スコアは人の驚きを代替しない |

### 推奨する最初の三題材

1. **MORROW香水ボトル**: 現状のRive2D vs CC0または権利クリアGLB+PBR/HDRI vs native vector+shader版。反射/透明/曲面で改変前との差が目に見えるはずだが、未検証。
2. **SOLSTICE腕時計**: リューズ、ケース、時分秒針、光の当たり方が意味的に合い、親子支点を失わない。既存高品質の合法3D素材と公式RMLで物理構造を出す。
3. **空間型のデータ/ゲームUI**: 2Dアートボードのレスポンシブ表示を3D空間へ投影、視点パララックスと状態機械。公式デモに近いが、独自の利用目的とオリジナル素材で実証する。

## 誤認しやすい境界

- **RML/CLIがある = 初回プロンプトから高品質保証**ではない。制作者実例は人の反復ディレクションである。
- **Rive GPU Canvasに3Dがある = あらゆるMesh頂点がEditorの通常ベクターとして編集できる**ではない。WGSL/GLBソース・入力などの編集性を分けて証明。
- **MarketplaceにCC BY = 埋込フォント/写真/モデルの著作権もすべて許諾済み**ではない。ソースを実取得した上でファイル単位審査。
- **.rivのコンパイル成功 = 本番Webでシェーダーも表示**ではない。WebGL2 `enableGPUCanvas` やpublish署名/プラン/透かしが必要な場合あり。
- **画素差分が大きい = 美しい**ではない。構図・物語・タイポグラフィ・照明/材質の一貫性が優先。

## 調査未完了と残る問い

- 公式CLIをこのリポジトリのLinux CIへ入れ、使用規約/アカウント/ローカルウォーターマークを調べる実機検証はまだ。
- WebGL2・GPU Canvasで実際にShaderの複数Riveランタイム相互互換を計測していない。
- Marketplaceの外部sourceを3件以上取得したことはない。多くは公開URLとCC BYラベルの確認だけ。
- Poly Havenからのアセット取得・調整/圧縮も未実装。
- styleframes・blind panel・外部デザイナー評価も今回の調査だけでは実施していない。

**勧告:** レシピ数・ギミック数ではなく、制作経路の多様化（公式RML+GPU）とアートディレクション上流への投資を次の実装の中心にする。独自バイナリwriterは比較対象/軽量2D fallbackとして残し、捨てない。2026-10-14現在は検証前の研究仮説であり、導入実績ではない。

## 主な参考資料（リンク一覧）

- [Rive CLI発表 2026-09-11](https://community.rive.app/c/announcements/introducing-the-rive-cli-and-rml)
- [Rive CLI Docs](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx)
- [Rive CLI AI Agent Docs](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx)
- [Rive Feature Support](https://github.com/rive-app/rive-docs/blob/main/feature-support.mdx)
- [Rive GPU Canvas 一般公開投稿 2026-09-03](https://www.reddit.com/r/Rive_app/comments/1w6jrjt/rives_gpu_canvas_is_now_live_for_everyone/)
- [Rive GPU Shaders 実践 2026-09-18](https://www.reddit.com/r/Rive_app/comments/1wjx9kp/using_gpu_shaders_in_rive/)
- [Rive CLI+3D UI デモ／制作過程 2026-09-17](https://www.reddit.com/r/Rive_app/comments/1wikpyc/this_is_100_rive_i_used_the_new_rive_cli_with/)
- [Rive GPU 3D car / model-based shadow事例](https://www.reddit.com/r/Rive_app/comments/1up3t8y/i_built_a_fully_interactive_3d_car_configurator/)
- [Rive October runtime updates](https://community.rive.app/c/announcements/rive-runtime-updates-october-1-2026)
- [Rive 3D scripts Marketplace](https://rive.app/marketplace/28220-53314-early-access-3d-scripts/)
- [Rive shader/path-effect Marketplace](https://rive.app/marketplace/26273-49129-path-effect-script/)
- [Rive Fake3D data-bound cards](https://rive.app/marketplace/22198-41596-fake-3d-cards/)
- [Rive procedural aquarium](https://rive.app/marketplace/28158-53168-interactive-aquarium/)
- [Poly Haven CC0 license](https://polyhaven.com/license)
- [Poly Haven API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)
- [Khronos glTF sample models/licensing](https://github.com/KhronosGroup/glTF-Sample-Assets)
- [School of Motion Moodboards/Storyboards/Styleframes](https://schoolofmotion.com/blog/guide-completing-motion-design-project)
- [School of Motion Why design matters](https://schoolofmotion.com/blog/is-design-important-motion-designers)
- [School of Motion design-first/storyboard composition](https://schoolofmotion.com/blog/better-moodboards-storyboards)
- [MotionDesign Reddit feedback](https://www.reddit.com/r/MotionDesign/comments/1w2cnau/motion_concept_need_feedback_on_what_i_can_improve/)
- [MotionDesign AI quality concerns](https://www.reddit.com/r/MotionDesign/comments/1wsbbic/how_do_i_deal_with_like_senior_designers_drooling/)
- [Blender Studio procedural production example](https://studio.blender.org/blog/impulse-purchase-production-file/)
- [Apple motion guidelines](https://developer.apple.com/jp/design/human-interface-guidelines/motion)
