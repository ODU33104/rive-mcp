# Rive Intelligence Project — 実装計画書

> Status: Planning
> Baseline: rive-mcp v0.6.1 / main @ d44adbbe
> Strategic assumption: Rive公式が将来MCPまたは同等の外部Agent APIを提供することを前提に設計する。

## 0. この計画の目的

rive-mcpを「RiveをMCPから操作できるツール」から、**Rive制作物を解析・検証・デバッグ・最適化・自律改善する Visual Engineering Platform** へ進化させる。

公式がMCPに対応した時点で、単なるCRUD・Editor操作・生成命令は優位性にならない。公式は内部API、Editor状態、クラウド、共同編集、最新フォーマットへの最短アクセスを持つため、その領域で正面競争すれば不利になる。

本プロジェクトは逆に、公式が構造上やりにくい領域を取る。

- headless / local-first / CLI / CI
- Git-nativeなsemantic diff・review・merge
- State MachineやData Bindingの自動探索・debugging
- cross-runtime / cross-versionの検証
- fuzz / scenario matrix / visual regression
- model-agnosticなAI orchestration
- 低トークン・決定論的なAutopilot
- 外部形式・外部ツールとの相互運用
- 実験的機能を素早く投入できるplugin architecture

最終的な位置づけは次の通り。

**Rive公式 = Authoring + Runtime**

**rive-mcp = Intelligence + Verification + Automation + Engineering**

公式MCPが登場した場合は競合APIとしてではなく、必要に応じて **privileged backend / actuator** として利用できる構造にする。

---

## 1. 戦略原則

### P1. 「公式より多機能なEditor」を目標にしない

公式Editorのshape tool、layout、timeline、scripting、library等を完全再実装する競争には入らない。Studioに追加するUIは、原則として以下のどれかに該当するものに限定する。

1. Debugging
2. Verification
3. Semantic change review
4. AI-assisted engineering
5. Batch / CI workflow
6. 公式Editorでは扱いにくい実験機能

### P2. 公式MCP対応を脅威ではなくbackend化する

将来の内部構造は `RiveBackend` 抽象を持つ。

```text
RiveBackend
  ├─ LocalBinaryBackend        # 現在の read/write/runtime 系
  ├─ OfficialMcpBackend        # 将来。公式MCPが提供された場合
  ├─ OfficialRuntimeBackend    # canvas/canvas-advanced
  └─ HybridBackend             # officialで編集、localで検証等
```

上位のDebugger、Scenario Runner、Semantic Diff、Autopilotはbackendに依存しない。

公式が強くなるほど、rive-mcpの検証・自動化レイヤーが利用できる能力も増える構造を目指す。

### P3. 身軽さは「何でも入れること」ではない

利用者が少ないことは互換性負債が小さいという強みだが、無秩序に機能を追加するとすぐに失われる。

身軽さを維持するため、以下を守る。

- experimental APIは明示的に分離
- binary format固有処理をUIから切り離す
- Studio内部APIはsemantic operationを基本単位にする
- 大規模rewriteは避け、adapterで段階移行
- feature追加時にrelease gateを同時追加
- 使われない機能は保守コストを計測し削除可能にする

### P4. AIに品質保証をさせない

LLMは曖昧な意図の解釈と候補生成に使う。

以下は原則サーバー側の決定論コードで行う。

- format validation
- constraints
- state reachability
- rendering
- visual diff
- geometry checks
- performance budget
- API compatibility
- semantic diff
- animation metrics
- candidate rankingのうち計測可能な部分

設計思想は **AI proposes, rive-mcp proves**。

### P5. 小さいモデルでも品質を出せる構造を優先する

Autopilotの品質をモデルサイズに依存させない。

Fable/Astro級や最上位モデルを常時要求する設計は禁止する。高性能モデルは「曖昧な美的判断を必要とする局面」でのみoptionとし、通常処理は小型モデルまたはLLMなしでも成立させる。

---

## 2. 現状資産と再利用方針

既存資産は捨てない。特に次を新基盤のprimitiveとして利用する。

- `rivBinary` / `rivDecompile`: 構造解析
- `rivWriter` / `rivEdit`: 生成・無損失編集
- `rivLint`: 静的検査
- `critique`: motion / visual review bundle
- `riv_visual_diff` / `riv_ab_compare`: visual comparison
- `rivOptimize`: 最適化
- `dataBinding`: ViewModel / binding解析
- `riveHost`: 公式runtimeでの実行
- `studio`: visual workbench
- `uiDetect` / `uiPrototype`: screenshot/SVG/Figma → prototype
- design tokens / motion presets / SVG / Lottie import
- real `.riv` fixture + phase1/phase2/e2e release gates

ただし `src/studio.ts`、`src/index.ts`、`src/pageScript.ts` の巨大化は今後の速度低下要因なので、機能追加前に全面rewriteするのではなく、**触る領域から段階的にmoduleへ切り出す**。

---

## 3. コア基盤: Canonical Rive IR

### 3.1 目的

binary object indexやEditor内部順序ではなく、rive-mcp上で安定して扱える意味論モデルを作る。

ただし現在の `SceneSpec` を即時置換しない。最初はread-only projectionとして追加する。

### 3.2 RiveIR v1

最低限以下を表現する。

```text
RiveIRDocument
  fileMetadata
  artboards[]
    nodes[]
    animations[]
      tracks[]
      keyframes[]
    stateMachines[]
      layers[]
      states[]
      transitions[]
      inputs[]
      listeners[]
    viewModels[]
    bindings[]
    assets[]
    scripts[]   # format/runtimeで取得可能になった時点で対応
```

各entityは以下を持つ。

- `semanticId`: index変更に耐えるstable identity
- `sourceRef`: 元binary object / local index / artboard等
- `path`: 人間可読なsemantic path
- `capabilities`: read/edit/render可否
- `provenance`: 値の由来を記録するためのslot

### 3.3 semanticId

初期案:

```text
<kind>:<artboard>/<parent-path>/<name>#<structural-disambiguator>
```

名前だけには依存しない。rename後のtrackingが必要なため、構造fingerprintも保持する。

Acceptance:

- serialize → deserializeで安定
- 無関係なobject追加で既存IDが極力変化しない
- rename候補をsimilarityで追跡可能
- semantic diffの基礎として使える

### 3.4 Semantic Patch

AIやStudioは可能な限りraw property mutationではなくPatchを生成する。

例:

```json
{
  "op": "animation.keyframe.update",
  "target": "animation:Main/Button/Hover.opacity@12",
  "value": 0.8
}
```

Patchは以下を満たす。

- preview可能
- validate可能
- apply可能
- revert可能
- diff表示可能
- Agent Change Setにまとめられる

---

## 4. v0.7 の主役: Rive Debugger / Intelligence

v0.7ではAutopilotを完成させない。まず「自動で正しさを調べられる基盤」を作る。

### 4.1 `riv_sm_explore`

State Machineを自動探索する。

入力:

- artboard
- stateMachine
- exploration budget
- number input ranges / interesting values
- reset strategy
- maxDepth

出力:

- reachable states
- unreachable states
- transition coverage
- minimal input sequence per state
- loops / suspicious cycles
- dead ends
- render checkpoints
- exploration graph

探索はBFS/優先探索を基本とし、LLMは不要。

Number inputは全実数を探索できないため以下のinteresting valuesを利用する。

- initial
- transition threshold付近
- min/max指定
- 0 / 1 / -1
- user-supplied values

### 4.2 Trace Recorder / Replay

新内部形式 `RiveTrace` を定義する。

```text
TraceEvent
  timestamp
  kind
  source
  target
  oldValue
  newValue
  causalParent?
  frame?
```

対象:

- input set/fire
- state enter/exit
- transition
- ViewModel mutation
- binding propagation
- event/listener
- pointer event
- animation start/stop

最初から完全な因果関係を要求しない。観測可能なevent streamから開始する。

MCP候補:

- `riv_trace_record`
- `riv_trace_replay`
- `riv_trace_inspect`

### 4.3 Property Provenance

最終目標:

```text
Button.opacity = 0.4
 <- animation Disabled
 <- state Disabled
 <- transition enabled == false
 <- converter CanSubmit
 <- ViewModel.formValid
```

v0.7ではまずstatic provenanceを実装する。

- binding target → source ViewModel
- animation track → target property
- SM state → animation
- transition → input/condition

runtime traceと組み合わせてdynamic provenanceへ拡張する。

### 4.4 Studio Debug mode

Studioに以下を追加する。

- State coverage heatmap
- Trace timeline
- selected event details
- "Why this value?" panel
- replay cursor
- failing transition / unreachable state navigation

Design機能を増やすのではなく、**Rive DevTools**として差別化する。

---

## 5. v0.8: Rive Engineering / CI

### 5.1 Semantic Diff

既存 `riv_diff` をRiveIRベースへ拡張。

表示例:

```diff
Animation/Hover
- duration: 180ms
+ duration: 140ms

StateMachine/Button
+ Idle -> Disabled when enabled == false

ViewModel/Button
+ disabled: boolean
```

分類:

- visual-only
- behavior change
- runtime contract change
- potentially breaking
- asset-only
- metadata-only

### 5.2 Runtime Contract

`.riv` の外部公開面をmanifest化する。

```text
artboards
state machines
inputs
triggers
events
view models
properties
enums
```

MCP候補:

- `riv_contract`
- `riv_contract_diff`
- `riv_generate_types`

生成ターゲット候補:

- TypeScript
- Dart
- Swift
- Kotlin
- C#

### 5.3 Scenario Matrix

組合せ実行基盤。

軸例:

- state/input values
- ViewModel data
- locale
- long/empty text
- light/dark theme
- viewport size
- reduced motion
- runtime version

検出:

- render failure
- blank frame
- clipping
- overflow
- overlap
- text truncation
- contrast violation
- runtime exception
- unexpected state
- visual regression

MCP候補:

- `riv_scenario_run`
- `riv_matrix_test`

### 5.4 CI Report

JSON + Markdownを生成。

必須項目:

- pass/fail
- semantic changes
- visual diffs
- state coverage
- runtime contract breaks
- file size delta
- performance budget

---

## 6. v0.9: Token-Efficient Autopilot

### 6.1 Autopilotの責務

Autopilotは万能Agentではない。

ユーザーのGoalをmachine-checkableな `QualityContract` に変換し、既存のdeterministic toolsを組み合わせて条件を満たすChange Setを作る。

```text
Goal
  ↓
Goal Compiler
  ↓
QualityContract
  ↓
Context Compiler
  ↓
Planner
  ↓
Semantic Patch candidates
  ↓
Local validate / render / test
  ↓
Failure-directed repair
  ↓
Verified Change Set
```

### 6.2 QualityContract

例:

```yaml
visual:
  maxOverflow: 0
motion:
  responseMs: <= 120
  reducedMotion: true
stateMachine:
  transitionCoverage: 100%
runtime:
  target: [web, flutter]
size:
  maxBytes: 150000
compatibility:
  noBreakingContract: true
```

LLMをjudgeにしない。可能な限り数値化する。

### 6.3 Context Compiler

最大のtoken削減ポイント。

LLMへ `.riv` dump全体や巨大Scene JSONを渡さない。

Goalに関係するsemantic sliceだけを作る。

例: Button hover修正なら、

- Button subtree
- Buttonに作用するanimations
- Buttonに作用するSM transitions
- relevant ViewModel bindings
- lint failures
- representative frame metrics

だけを渡す。

Context sliceはhash化してcacheする。

### 6.4 High-Level Operation Library

AIに100個のraw propertyを書くよう要求しない。

例:

```text
motion.applyPreset
motion.retime
motion.stagger
state.addGuard
binding.rewire
theme.applyToken
layout.fitText
animation.normalizeOvershoot
```

AIは「何をするか」を出し、serverが具体的patchへ展開する。

既存motion presets/design tokensの思想を全領域へ広げる。

### 6.5 Local Search / Optimizer

数値調整をLLM loopで行わない。

対象:

- duration
- easing control points
- spring parameters
- stagger
- spacing
- scale overshoot
- threshold

AIが方針を決め、候補値探索はlocalで行う。

### 6.6 Failure-Directed Repair

再prompt時に全情報を再送しない。

入力は原則:

- previous patch summary
- failing constraints only
- minimal relevant context

### 6.7 Budget Contract

Autopilot自体にbudgetを持たせる。

```text
maxLlmTurns
maxRepairRounds
maxContextBytes
maxCandidates
maxRenders
maxToolCalls
maxWallTimeMs
```

Budget超過時は「さらに賢いことをする」のではなく、partial result + unresolved constraintsを返す。

### 6.8 3段階実行モード

**Level 0 — Deterministic**
LLMなし。lint fix、optimize、preset、contract、state exploration等。

**Level 1 — Compact Agent**
小型モデル向け。Goal→QualityContract、high-level op選択のみ。

**Level 2 — Creative Agent**
美的方向性、コンセプト、複数案生成など、曖昧性が大きい時のみ高性能モデルを利用。

デフォルトはLevel 1以下。

---

## 7. v1.0: Visual Engineering Workbench

Studioを以下のmodeへ整理する。

```text
Design | Animate | Behavior | Debug | Test | Changes
```

### Design
既存編集機能。公式Editorの完全代替は狙わない。

### Animate
Timeline / curve / onion skin / motion capture。

### Behavior
SM graph / ViewModel / Binding / provenance。

### Debug
Trace / replay / state coverage / Why this value。

### Test
Scenario Matrix / visual regression / runtime matrix。

### Changes
Semantic Change Set / before-after / accept-reject。

Agentの変更は直接書込みよりChange Setを基本にする。

---

## 8. Motion Capture / Direct Manipulation

StudioでRecord中にユーザーが対象をdrag/rotate/scaleしたsampleを収集し、

1. sampling
2. noise reduction
3. Douglas-Peucker等でkeyframe削減
4. velocity segmentation
5. easing fitting
6. optional spring fitting

を行いanimationへ変換する。

LLM不要。

「自然な動きを文章で説明する」より「人間が動かして見せる」方が低コストで高品質な場合が多い。

---

## 9. Performance / Runtime Lab

将来追加。

計測候補:

- frame time
- draw calls相当のruntime observable
- memory
- asset decode cost
- file size
- object count
- path complexity
- mesh complexity
- animation track count

環境差を考慮し absolute benchmark と regression benchmarkを分ける。

---

## 10. Plugin Architecture

v1.xで検討。

extension point候補:

- importer
- exporter
- lint rule
- critique metric
- scenario generator
- optimizer
- Studio panel
- asset provider
- backend

初期段階で公開APIを固定しすぎない。内部plugin boundaryを作り、2〜3個のbuilt-in implementationで設計を検証してからpublic SDKにする。

---

## 11. 公式MCPへの対抗シナリオ

### ケースA: 公式がEditor CRUD MCPを提供

競わない。

`OfficialMcpBackend` として接続し、rive-mcpはdebug/test/diff/CIを提供する。

### ケースB: 公式がAgent生成を提供

生成能力では競わない。

公式Agentの成果物を `riv_contract` / `riv_sm_explore` / matrix / visual regressionで検証する。

### ケースC: 公式がTestingを強化

単体testではなく、state-space exploration / fuzz / cross-runtime differential testingへ進む。

### ケースD: 公式がsemantic diffやversioningを提供

GitHub/CI integration、runtime API breaking detection、external asset/source diff、multi-file projectへ広げる。

### ケースE: 公式が上記すべてを提供

rive-mcpの価値は **vendor-neutral orchestration** と **local reproducibility** に残る。

Riveだけで閉じず、Figma/SVG/Lottie/app code/runtime/CIを同じ検証graphで扱う。

---

## 12. 競争上のMoat候補

機能数ではなく次を積み上げる。

1. **RiveIR + semantic history corpus**
2. **real-world regression corpus**
3. **state exploration / scenario generation algorithms**
4. **high-level semantic operation library**
5. **quality metrics / release gates**
6. **cross-format interoperability**
7. **Git / CI workflow integration**
8. **small-model benchmark dataset**

特に4と8はAutopilotのtoken効率に直結する。

---

## 13. Autopilot Benchmark

Autopilot実装前からbenchmarkを作る。

タスクカテゴリ:

- property edit
- motion retiming
- state transition repair
- accessibility / contrast repair
- long text repair
- file size reduction
- interaction addition
- screenshot/Figma prototype refinement

記録:

- success/fail
- constraint pass rate
- LLM turns
- prompt/context bytes
- response bytes
- tool calls
- local render count
- elapsed time
- semantic patch count

目標は「最高モデルで最高品質」ではなく、**小型モデルで再現可能な成功率を上げること**。

品質改善をモデル更新ではなくserver-side primitive追加で達成できたかを追跡する。

---

## 14. 非目標

少なくともv1.0まで以下は主目的にしない。

- Rive公式Editorの全機能clone
- cloud collaboration service
- proprietary modelの内蔵
- 生成画像/動画モデルそのものの開発
- 独自Rive runtimeのfork
- ユーザー数を増やすためだけの機能追加

---

## 15. Architecture migration方針

巨大ファイル問題は認識するが、先に全面分割しない。

機能追加のたびに関連領域を切り出す strangler pattern を使う。

予定:

```text
src/
  ir/
    model.ts
    project.ts
    semanticId.ts
    patch.ts
  debugger/
    explorer.ts
    trace.ts
    provenance.ts
  engineering/
    contract.ts
    semanticDiff.ts
    scenario.ts
  autopilot/
    contract.ts
    contextCompiler.ts
    planner.ts
    executor.ts
    budget.ts
  studio/
    server.ts
    api/
    model/
    client/
```

`src/studio.ts` はfeature追加時に部分的に移動する。

---

## 16. Definition of Done

新機能は以下を満たして完了とする。

- real `.riv` fixtureで検証
- synthetic testだけで完了扱いにしない
- unsupported / unknownを隠さない
- deterministic output where applicable
- old file roundtripを壊さない
- README / docs更新
- Studio対応機能ならHTTP/API側のtestを先に持つ
- semantic operationならapply/revertまたはbefore/after verificationを持つ
- Autopilot関連はtoken/turn/tool-call benchmarkを記録

---

## 17. 重要な判断

### 「スターが少ないから何でもできる」について

半分正しい。

小規模だからbreaking changeや大胆な設計変更を早く行える。しかし「何でも入れられる」を強みにすると、半年後には公式より先に自分たちが重くなる。

本当の強みは **意思決定距離が短いこと**。

したがって、

- 実験は速く
- coreは小さく
- measurementを先に
- 不要なら捨てる

を維持する。

このプロジェクトでは速度そのものではなく、**学習サイクルの短さ**を競争優位とする。
