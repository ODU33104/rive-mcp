# Multi-Session Development Protocol

この文書は、rive-mcpを複数のChatGPT/Claude/Codex等のセッションで継続開発する際の引き継ぎ規約。

目的は「毎回リポジトリを読み直して設計思想を再発明する」コストと、セッションごとの方針ドリフトを防ぐこと。

---

## 1. Source of truth

開始時に最低限読む順序:

1. `docs/PROJECT_RIVE_INTELLIGENCE.md`
2. `docs/ROADMAP_RIVE_INTELLIGENCE.md`
3. `docs/HANDOVER.md`
4. 対象featureのissue / PR
5. 関連source/testのみ

README全体や`src/index.ts`全体を毎回コンテキストへ入れる必要はない。

---

## 2. 1セッション = 1明確な成果物

推奨粒度:

- 1 schema
- 1 algorithm
- 1 MCP tool
- 1 Studio panel/API slice
- 1 test corpus extension
- 1 refactor boundary

「M1を全部実装」のような巨大scopeを1セッションで扱わない。

---

## 3. Session start template

作業開始時、issueまたは作業メモで以下を確定する。

```text
Milestone:
Task:
Why now:
Inputs/dependencies:
Non-goals:
Acceptance criteria:
Relevant tests:
Files expected to change:
```

不明点はコードを読んで解消し、設計判断が必要なものだけをADR候補にする。

---

## 4. Session end template

終了時にPR/issueへ以下を残す。

```text
Completed:
Changed files:
Tests run:
Known limitations:
New findings:
Design decisions:
Next recommended task:
Blocked by:
```

「何をしたか」だけではなく、**何をしなかったか / 何が未検証か** を必ず書く。

---

## 5. Decision discipline

以下は文書化する。

- public schema変更
- semanticId規則変更
- RiveIR構造変更
- backend abstraction変更
- unsupported semanticsの扱い
- compatibilityを壊す変更
- Autopilot budget policy
- quality metric / release gate変更

軽微な実装詳細はADR化しない。

将来 `docs/adr/NNNN-title.md` を導入してよいが、ADR自体が負債になるほど増やさない。

---

## 6. Branch / PR policy

- `main` へ直接巨大変更を入れない
- 1 feature / fix = 1 branch
- refactorとbehavior changeを可能な限り分離
- PR本文にacceptance criteriaを書く
- generated media/baseline更新理由を書く
- experimental機能は明記する

推奨branch:

```text
feat/ir-semantic-id
feat/sm-explorer
feat/trace-format
feat/semantic-diff
feat/scenario-matrix
feat/autopilot-context-compiler
refactor/studio-api-split
```

---

## 7. Test order

変更範囲に応じて最小セットから走らせ、merge前に必要なfull gateを通す。

基本:

```text
npm run build
node test/phase1.mjs
node test/phase2.mjs
node test/e2e.mjs
```

対象機能に応じて:

```text
node test/studio-features.mjs
node test/uiPrototype.mjs
node test/uiDetect.mjs
node test/vectorScene.mjs
node test/lottie.mjs
```

新しいIntelligence系は個別testを追加し、最終的にrelease gateへ統合する。

---

## 8. Context budget policy

複数セッション運用そのものもtoken-efficientにする。

### 読まない

- 巨大source全文を目的なく読む
- 生成済みmedia
- 無関係なfixture全文
- READMEの全言語版を同時に読む

### 読む

- 対象function周辺
- interface/schema
- failing test周辺
-最新HANDOVER/issue

### 重要

コード検索 → 必要範囲fetch の順にし、巨大ファイル丸読みを避ける。

これは将来のAutopilot ContextCompilerと同じ思想。

---

## 9. Autopilot development rule

Autopilot関連taskでは、必ず以下を記録する。

```text
LLM required: yes/no
LLM turns:
Context bytes:
Output bytes:
Tool calls:
Local renders:
Pass/fail constraints:
```

高性能モデルで成功したことだけでは完了扱いにしない。

可能なら同じtaskをcompact model相当の制約で評価する。

---

## 10. Official Rive change handling

公式に新機能が出た場合、その日のうちに追従実装を始めない。

まず以下を判断する。

```text
Does it erase our user value?
Does it provide a better backend primitive?
Can we validate/orchestrate it instead?
Does copying it create maintenance burden?
```

分類:

- DROP
- ADAPT
- OUTRUN

「公式にあるからこちらにも作る」は禁止。

---

## 11. Handoff quality gate

次のセッションが以下を5分以内に答えられる状態を目標にする。

1. 今どのmilestoneか
2. 直前に何が完成したか
3. 何が壊れているか
4. 次に何をするか
5. 何をしてはいけないか

答えられない場合、handoff情報不足。

---

## 12. Current starting point

Planning phase。

次の推奨task:

**M0-1: RiveIR v1 read-only projection + semanticId specification**

実装順:

1. existing binary/decompile structuresのmapping調査
2. minimal interfaces作成
3. semanticId prototype
4. real fixture snapshot test
5. diff用途に十分なidentity stabilityを評価

この段階ではwriter/editor/StudioをRiveIRへ移行しない。
