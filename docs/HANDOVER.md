# 引き継ぎ書 — プロ品質生成パイプライン開発 (PR #1 マージ時点)

ローカルで開発を継続するための引き継ぎ資料。2026-07-20、PR #1（20→27ツール化）がmainへマージされた時点の状態を記す。

## 1. 何を作ったか（全体像）

出発点の課題は「riv_createで0から指示しても小学生レベルの出力しか出ない」。対策の設計原則は次の2つで、以降の全実装がこれに従っている:

1. **品質は散文ガイドではなくサーバー構造に焼き込む** — プリセット展開・リント・critique・忠実度検証はすべてサーバー側の決定論的なコードであり、クライアントLLMの賢さに依存しない
2. **イラスト的な要素はAIがフリーハンドで描かず、プロ製アセットを取り込む** — SVG/Lottie/.rivの3経路のインポータが本体

### 追加ツール（20→27）とファイル対応

| ツール | 実装 | 役割 |
|---|---|---|
| `riv_design_tokens` | `src/designTokens.ts` | OKLCH調和パレット(WCAG検証)・M3モーショントークン。決定論的 |
| (riv_create拡張) presets | `src/motionPresets.ts` | セマンティックプリセット21種を`expandHlapi`でキーフレーム展開 |
| (riv_lint拡張) motion-* | `src/rivLint.ts` | robotic/teleport/no-stagger/lopsided-scale。誤検知除外あり(§3) |
| `riv_critique` | `src/critique.ts` | フィルムストリップ+オニオンスキン+モーションレポート+7軸チェックリスト(§4) |
| `riv_import_svg` | `src/svgImport.ts` | SVG→ベジェシーン断片。依存ゼロ |
| `riv_asset_search` | `src/index.ts`内 | Iconify検索+インポート（要ネットワーク） |
| `riv_lottie_import` | `src/lottieImport.ts` | Lottie→シーン断片。振付・イージングごと変換(§5) |
| `riv_decompile` | `src/rivDecompile.ts` | .riv→シーン仕様。エディタ製ファイルを画素等価で復元(§2) |
| (フォント) subset | `src/fontSubset.ts` | TrueTypeサブセッター。Inter 806KB→31KB。既定ON |
| `riv_setup` | `src/index.ts`内 | 同梱スキルを`.claude/skills/`へコピーする初回セットアップ |

ワークフロー台本は `skills/rive-design-guidelines/SKILL.md`（= MCP prompt `rive-design-guidelines` と同内容）。**トークン→プロ素材取り込み→プリセット→critique 2周以上**が必須フロー。用途別アセットソース対応表・アイコンアニメのレシピ・素材の向き/パース宣言ルールもここにある。

### ショーケース（それぞれ実証内容が違う）

- `samples/cosmic-journey/` — 全アートワークがプロ製（Twemoji、npm経由）: SVG経路の実証
- `samples/night-delivery/` — Rive公式トラックのdecompileリミックス（プロのアニメトラックごと流用）: .riv経路の実証
- `samples/launch-success/` — トークン+プリセット+TrimPath+SMの複合
- 各`build-scene.mjs`はリポジトリルートから `node samples/<名前>/build-scene.mjs` で再現可能

## 2. .rivフォーマットの重要知見（ハマりどころ）

`docs/riv-format.md` の補足。**エディタ製ファイルを扱うとき必須の知識**:

- **塗りは末尾に後置される**: Riveエディタは Fill/Stroke をストリーム末尾へまとめて書き、SolidColor/グラデが parentId で「未来の」paintを参照する。「直前のShapeに付ける」隣接ヒューリスティックは全滅する。**必ずparentIdベースで解決**（rivDecompile実装済み）
- **パス自体がtransformを持つ**: PointsPath/Ellipse/Rectangle は Shape 内で独自の x/y/rotation/scale を持つ。無視すると部品が剥がれて浮く（バンパー事件）。PointsPathは頂点へ焼き込み、パラメトリックパスは `ShapeSpec.pathX/pathY` で保持
- **Shape自体もscaleX/scaleYを持つ**（車体パネルは1.067×1.102だった）。落とすと形が縮む
- **CubicEaseInterpolatorのプロパティ省略時の既定は (0.42, 0, 0.58, 1)** = ease-in-out。(0,0,1,1)扱いにするとイージングが全部リニアに化ける
- **描画順**: ストリームで先に書かれたdrawableが前面。decompileでは `z = 100000 - localIndex` で保存。DrawRules（描画順の上書き）は未対応→§6
- **キーフレームのイージングは出発側に格納**: ライターは「到達easing」を受け取り、departing keyframe の interpolationType/interpolatorId に書く。リントもこの前提で読む
- **グラデーションはopacityプロパティを持つ**（stopのアルファに焼き込んで復元）。ブレンドモードは `blendModeValue`（Skia準拠: multiply=24等、`BLEND_MODE_VALUE`参照）
- 往復忠実度の回帰ゲート: phase2で vehicles.riv Truck を decompile→recompile し**画素差<0.5%**（現状0.05%）を要求。デコンパイラ/ライターを触ったら必ずここを見る

## 3. リントの設計判断

`motion-robotic`（全区間linear警告）には**正当なlinearの除外**が入っている。プロ実ファイルからの学び:
- 10フレーム未満の高頻度ジッター（Rive公式トラックの車体振動は3フレーム刻みlinear）
- ループアニメ内の単調なx/y/rotation（スクロール・スピンは等速が正解）

## 4. critique = 「目をつぶってアニメを作らない」ための装置

静止画しか見られないVLMに動きを見せる3点セット（`src/critique.ts`）:
- **フィルムストリップ**: フレームを左→右に1枚連結
- **オニオンスキン**: 全フレーム重ね焼き＝軌跡が残像になる
- **モーションレポート**: ファイルデータから各オブジェクトの正味移動ベクトル/回転をテキスト抽出（レンダ不要）

チェックリスト第7軸「空間・方向整合」が最重要の追加: **移動体は絵の『前』へ進むか。シーンの視点（真横/アイソメ）は1つか**。トラックが横に走って見えた事故の再発防止策であり、素材の向き・パースを宣言してから動きを設計するルールとセット。依存ゼロのRGBA→PNGエンコーダ（`encodePng`）も同ファイル。

## 5. Lottieインポータの状態

対応: shape/null/solid/precompレイヤー（6階層+循環ガード）、レイヤー親子（前方参照はトポロジカルソートで解決）、アンカーポイント（内側補正グループ方式）、キーフレームtransform全種、**i/oタンジェント→正確なカスタムcubic**（`KeyframeSpec.easing`が`[x1,y1,x2,y2]`配列を受ける拡張をライターに追加済み）、hold、分離x/y、el/rc/sr/sh、グラデ、トリムパス、出現/消滅窓、負フレームのクランプ。

未対応（coverage.skippedに計上・警告される）: テキストレイヤー、マスク/マット、リピーター、マージパス、**パスモーフィング（最初の形で固定）**、エクスプレッション（ripple.jsonが該当）、グラデストローク（単色近似）、空間タンジェントti/to（直線近似）。

検証用の実Lottieは `npm pack lottie-web` → `package/test/animations/*.json`（test/lottie.mjsが自動でやる）。

## 6. 未完・次にやる候補（優先度順の私見）

1. **パスモーフィング対応** — Lottieの表現力の核。ライターに頂点キーフレーム(KeyFrameDouble on vertex)を足せば対応可能（メッシュ頂点アニメは既にあるので参考になる）
2. **Claude Codeプラグイン化** — MCPサーバー+スキル+`rive-designer`エージェント定義を1インストールに。汎用MCP+`riv_setup`は本線として維持
3. **DrawRules/DrawTarget** — decompileの描画順完全化（現状は車輪の重なり等が僅かに違う）
4. **ボーン/スキンのdecompile** — 現状スキップ（トラックの煙が消える）
5. **グラデーションストローク**のライター対応
6. **CFF(.otf)フォントのサブセット**（現状は警告付きフル埋め込みフォールバック）
7. **コーパス統計学習** — CC BYの.riv/Lottieを大量に集めtiming/振付の統計をプリセットへ還元（本環境はネットワーク制限で未着手。ローカルなら可能）
8. Zenn記事の更新（リポジトリ外。原稿未着手）

## 7. 開発の流儀・環境

- **依存ゼロ主義**: 新npm依存は追加しない（PNG/GIF/APNG/フォント/SVG/Lottie全て自前実装）。コメントは日本語
- **未対応を隠さない**: skip/warningでカウント報告する（decompile/lottieの流儀）
- **テスト**: `npm run build` 後に `test/phase1.mjs` `test/phase2.mjs` `test/lottie.mjs` `test/e2e.mjs`。**ヘッドレス環境では `RIVE_MCP_CHROME=<chromiumパス>` が必須**（本開発環境では`/opt/pw-browsers/chromium`だった。ローカルでは自動検出が効くことが多い）
- e2eはツール総数をアサートしている（現在27）。ツールを増減したら `test/e2e.mjs` の数字と README×2 のツール表を更新
- **コミット名義**: このリポジトリのコミットは `ODU33104 <64585127+ODU33104@users.noreply.github.com>` 名義で行う（オーナーの明示指示。Claude共著トレーラーは付けない）
- ライセンス注意: 同梱Twemoji SVGはCC-BY 4.0（README末尾にクレジットあり）。vehicles.rivはRive公式サンプル。lottie-webのデモJSONは**リポジトリに同梱しない**（テストが都度npmから取得する）

## 8. この開発で確立した教訓（同じ穴に落ちないために)

1. **「テストが通る」と「実物で動く」は別物** — decompilerはラウンドトリップテストが通っていたのに、実エディタ製ファイルでは真っ白だった。実物（vehicles.riv、npmの実Lottie）を回帰テストに入れて初めて信用できる
2. **動きの品質は静止フレームのレビューでは担保できない** — 進行方向・パース整合はフィルムストリップ/オニオンスキン/モーションレポートで見る（critique§4を必ず通す）
3. **素材を使う前に「向き・パース」を宣言する** — アイソメの車は横スクロールに使えない。用途に合う素材選択自体が設計の一部
4. **大きめの実装はSonnet級への委任が効く** — Lottieインポータは詳細仕様書を渡してSonnet 5に実装させ、レビューで3件の実バグ（precomp深度・前方参照・負フレーム）を潰す分業が成功した。仕様とレビューを厚く、実装は委任
