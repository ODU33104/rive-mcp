# Rive Intelligence Roadmap

このロードマップは日付ではなく **milestone / acceptance criteria** で管理する。

理由: 公式Riveの進化速度が速く、カレンダー固定の計画は陳腐化しやすい。各milestone終了時に公式状況を再評価し、次milestoneのscopeを調整する。

---

## M0 — Foundation / Projectization

### Goal
複数セッション・複数PRで迷走しない開発基盤を作る。

### Deliverables

- [ ] `RiveIR v1` design
- [ ] stable `semanticId` prototype
- [ ] `SemanticPatch` schema
- [ ] backend capability interface design
- [ ] architecture boundaries for debugger / engineering / autopilot / studio
- [ ] benchmark fixture list
- [ ] session handoff protocol
- [ ] official-Rive capability watch checklist

### Acceptance

- existing tests unchanged/pass
- no mass rewrite
- one real `.riv` can be projected to RiveIR and back-referenced to raw objects
- same file produces deterministic semantic IDs
- unrelated object insertion does not invalidate most existing semantic IDs

### Explicitly NOT in M0

- Studio redesign
- Autopilot
- official MCP adapter implementation

---

## M1 — v0.7 State Intelligence

### Goal
RiveのState Machineを「人間が触って確認するもの」から「機械が探索・証明できるもの」に変える。

### Deliverables

- [ ] `riv_sm_explore`
- [ ] state/transition coverage model
- [ ] unreachable/dead-end/cycle analysis
- [ ] minimal reproduction sequence
- [ ] representative frame capture at states/transitions
- [ ] exploration JSON export
- [ ] Studio state coverage overlay

### Test strategy

- handcrafted synthetic SMs
- existing real fixtures
- nested / multiple layers
- Bool / Trigger / Number
- threshold boundary tests
- intentional unreachable state
- intentional infinite/suspicious cycle

### Acceptance

- deterministic exploration for identical input/budget
- every discovered state has a reproducible input sequence
- coverage reports unsupported semantics explicitly
- no LLM required

---

## M2 — v0.7 Trace & Provenance

### Goal
「何が起きたか」だけでなく「なぜ起きたか」を説明可能にする。

### Deliverables

- [ ] `RiveTrace` format
- [ ] `riv_trace_record`
- [ ] `riv_trace_replay`
- [ ] `riv_trace_inspect`
- [ ] static Property Provenance graph
- [ ] Studio trace timeline
- [ ] Studio `Why this value?`

### Acceptance

- replay reproduces observable SM state sequence
- binding source/target paths can be reported
- animation track → target property can be traced
- unsupported causal edges are marked unknown, never fabricated

---

## M3 — v0.8 Semantic Engineering

### Goal
`.riv` をbinary assetではなくreview可能なsoftware artifactとして扱う。

### Deliverables

- [ ] semantic diff engine
- [ ] breaking-change classifier
- [ ] `riv_contract`
- [ ] `riv_contract_diff`
- [ ] typed bindings generation
- [ ] Markdown review report
- [ ] Studio Changes panel

### Acceptance

- binary index changesだけではsemantic diffが汚れない
- rename候補を別entityのdelete/addと区別できるケースを持つ
- state/input/event/ViewModel breaking changesをCIでfail可能
- before/after visual linksをreportに付加可能

---

## M4 — v0.8 Scenario / Matrix Testing

### Goal
手動確認では発見できない組合せバグを自動検出する。

### Deliverables

- [ ] scenario spec
- [ ] `riv_scenario_run`
- [ ] `riv_matrix_test`
- [ ] long/empty/extreme text generators
- [ ] state/input matrix
- [ ] viewport matrix
- [ ] theme/locale hooks where technically observable
- [ ] visual regression integration
- [ ] Studio Matrix viewer

### Acceptance

- matrix case is reproducible by seed/id
- failures provide minimal case data
- render/cache reuse works
- local execution; LLM unnecessary

---

## M5 — v0.9 Autopilot Foundations

### Goal
高価なモデル依存なしに、AIが安全に変更案を作れるprimitiveを完成させる。

### Deliverables

- [ ] `QualityContract`
- [ ] `ContextCompiler`
- [ ] semantic high-level operation registry
- [ ] patch validator
- [ ] local parameter optimizer
- [ ] execution budget model
- [ ] benchmark harness

### High-level ops initial set

- [ ] `motion.applyPreset`
- [ ] `motion.retime`
- [ ] `motion.stagger`
- [ ] `motion.fitSpring`
- [ ] `state.addGuard`
- [ ] `state.repairUnreachable`
- [ ] `binding.rewire`
- [ ] `theme.applyToken`
- [ ] `layout.fitText`
- [ ] `asset.replace`

### Acceptance

- at least half of benchmark tasks can execute with no LLM after goal is normalized
- relevant context slice is substantially smaller than full decompile/dump
- every operation returns previewable semantic patch
- executor stops on budget and returns unresolved constraints

---

## M6 — v0.9 Autopilot

### Goal
GoalからVerified Change Setまでを自動化する。

### Pipeline

```text
Goal
 → normalize
 → QualityContract
 → context slice
 → plan
 → semantic patches
 → validate
 → render/test
 → local optimize
 → failure-directed repair
 → verified change set
```

### Deliverables

- [ ] `riv_autopilot_plan`
- [ ] `riv_autopilot_run`
- [ ] Change Set bundle
- [ ] failure-directed replan
- [ ] Level 0/1/2 execution modes
- [ ] Studio Agent proposal UI

### Acceptance

- no hidden infinite AI loop
- fixed budget benchmark reproducible
- small-model mode is first-class
- deterministic checks decide pass/fail
- high-end model is optional, not required for structural tasks

---

## M7 — v1.0 Studio Visual Engineering Workbench

### Goal
StudioのidentityをEditor cloneからRive engineering workbenchへ完成させる。

### Modes

- [ ] Design
- [ ] Animate
- [ ] Behavior
- [ ] Debug
- [ ] Test
- [ ] Changes

### Deliverables

- [ ] modularized Studio source boundaries
- [ ] state coverage graph
- [ ] trace/replay
- [ ] provenance view
- [ ] scenario matrix
- [ ] Change Set accept/reject
- [ ] Motion Capture prototype

### Acceptance

Studio固有機能の主要ロジックはHTTP/APIまたはcore moduleでtest可能で、DOMだけに埋め込まれていない。

---

## M8 — v1.x Ecosystem / Official MCP Adapter

### Trigger
公式MCP/APIの実仕様が公開された時点でscopeを確定する。

### Candidate deliverables

- [ ] `OfficialMcpBackend`
- [ ] capability negotiation
- [ ] local vs official differential tests
- [ ] fallback routing
- [ ] hybrid edit/verify workflow
- [ ] plugin internal API
- [ ] external plugin SDK after internal validation

### Rule
公式MCPのCRUD command名をコピーするだけのadapterは作らない。

上位機能がbackend-neutralに動くことを目的とする。

---

# Priority order

優先度は以下で固定する。

```text
Correctness infrastructure
    > State Intelligence
    > Debugging
    > Semantic Engineering
    > Scenario Testing
    > Token-efficient primitives
    > Autopilot
    > Studio polish
    > Ecosystem
```

Autopilotを前倒ししない。

検証基盤のないAutopilotは「大量トークンを使ってもっともらしいものを作る機能」に退化するため。

---

# Parallel workstreams

依存関係を壊さない範囲で並行できる。

## Track A — Core Intelligence
RiveIR → Explorer → Trace → Provenance

## Track B — Engineering
Semantic Diff → Contract → Scenario → CI

## Track C — Studio
source split → Debug UI → Test UI → Changes UI

## Track D — Autopilot efficiency
benchmark → ContextCompiler → high-level ops → local optimizer → executor

Track DのAutopilot本体はA/Bのprimitiveが揃うまでmergeしない。

---

# Official Rive Watch Gate

各milestone開始時に以下だけ確認する。

1. official MCP / external agent API
2. AI Agentの編集可能範囲
3. Scripting protocols追加
4. testing/debugging機能
5. versioning/diff/library変更
6. runtime/API format changes

確認後、機能を次の3分類にする。

- **DROP** — 公式と同じ価値しかない
- **ADAPT** — 公式をbackendとして利用
- **OUTRUN** — 公式の上にverification/automationを積む

公式の機能追加を見てロードマップを慌ててコピー変更しない。価値レイヤーで判断する。

---

# Risk register

## R1. Studioが再びmonolith化
Mitigation: 新機能はcore APIを先に作り、UIはconsumerにする。

## R2. IR設計が大きすぎて止まる
Mitigation: v1はread-only projection。SceneSpec置換をしない。

## R3. Autopilotがtoken eaterになる
Mitigation: ContextCompiler / BudgetContract / local optimizerを本体より先に実装。

## R4. 小型モデルでは美的品質が不足
Mitigation: asset reuse、design grammar、semantic presets、candidate rankingをserver側へ移す。曖昧な美的判断のみLevel 2へ昇格。

## R5. 公式機能に追いつかれる
Mitigation: editor CRUDではなくbackend-neutral verification層を積む。

## R6. 利用者が少なく実利用feedbackが不足
Mitigation: syntheticだけでなく公開可能なreal fixture corpusと外部format corpusを増やし、release gateをデータ化する。

---

# Success metrics

機能数やMCP tool数はKPIにしない。

見る指標:

- real fixture regression count
- semantic diff signal/noise
- SM transition/state coverage
- reproduced bug rate
- scenario failure minimalization率
- Autopilot constraint pass rate
- context bytes / LLM turns / tool calls per task
- small-model vs large-model quality gap
- deterministic stage比率
- change set rollback/replay成功率

最重要指標は **「モデルを賢くしなくてもserver側改善で成功率が上がったか」**。
