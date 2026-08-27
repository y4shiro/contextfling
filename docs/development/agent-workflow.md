# Agent 支援開発ワークフロー

この文書は、ContextFling における Agent 支援開発ワークフローの詳細な正本です。プロセスの詳細をこの文書に集約し、常時適用する短い強制ルールは [AGENTS.md](../../AGENTS.md)、人間向けの入口は [CONTRIBUTING.md](../../CONTRIBUTING.md) に置きます。

## Purpose

標準フローは **Issue-driven planning / Issue-linked branching / PR-driven execution** です。GitHub を Agent 間の共有状態と引き継ぎポイントとして使い、特定の Agent やセッションに開発状態を閉じ込めないことを目的とします。

このワークフローは次を可能にします。

- Issue、working branch、Pull Request の対応関係を追跡可能にする
- Agent 間の責務を分離し、Implementation Agent と親 Codex Sol の Review Agent を独立させる
- Issue の要件と実装・レビューのログを混在させない
- Agent セッションが終了しても、Issue と PR から状態、blocker、未完了事項を復元できるようにする
- 別の Agent が Issue と PR だけを手掛かりに作業を再開できるようにする
- 親 Codex Sol がレビュー対象の implementation diff を明確に特定できるようにする

基本ライフサイクルは次のとおりです。

```text
Issue
  ↓
Issue に紐づく working branch
  ↓
first meaningful commit
  ↓
Draft PR
  ↓
Implementation
  ↓
Validation
  ↓
Independent Review
  ↓
Review fixes
  ↓
Re-review
  ↓
Ready for review
  ↓
Human merge
  ↓
Issue close
```

## Core model

| GitHub の場所 | 責務 |
| --- | --- |
| Issue | Why / What / Requirements / Acceptance Criteria |
| Working branch | Issue を実装するための変更系列 |
| Pull Request | How / implementation state / validation state |
| PR Review | Current PR で修正すべき問題 |
| New Issue | Follow-up / out-of-scope work |
| ADR | Architecture decision |

Issue は active task、bug、Release Gate の状態、担当、優先度、blocker の正本です。Milestone はリリースまたは目標単位のまとまりに使い、active backlog を別の文書へ複製しません。

Issue 本文へ、原則として次の情報を継続的に追記しません。

- 実装ログ、commit 履歴、Agent の scratchpad
- PR review comment のコピー、個々の修正履歴
- 今回の PR と独立した追加改善

レビューや実装中の調査で Requirement、Acceptance Criteria、Scope、Non-goals 自体が変わった場合は、変更理由が追跡できるよう Issue を更新して構いません。実装の進捗、検証結果、レビュー指摘と修正、残存リスクは PR に記録します。

## 標準ワークフロー

### 1. Issue 作成・要件確定

Implementation Agent は Issue の Background / Problem、Goal、Requirements、Constraints、Non-goals、Acceptance Criteria、関連する architecture / ADR、Security / Privacy considerations を確認します。受入条件が曖昧なまま実装で補完せず、必要な要件判断は Human maintainer に戻します。

### 2. 関連文書の確認

Issue の内容に加え、変更に関係する [CONTEXT.md](../../CONTEXT.md)、[AGENTS.md](../../AGENTS.md)、architecture 文書、ADR、[SECURITY.md](../../SECURITY.md)、[PRIVACY.md](../../PRIVACY.md)、[CHROMEWEBSTORE.md](../../CHROMEWEBSTORE.md) を読みます。既存の制約や未完了の Release Gate を確認し、Issue の範囲外の整理を作業へ持ち込みません。

### 3. Issue に紐づく working branch の作成

通常の実装タスクでは、Issue ごとに対応する working branch を作成します。GitHub の Issue / Development / linked branch の機能を利用できる場合は優先します。branch を作るだけで実装を開始せず、先に Issue と Acceptance Criteria を確認します。

branch 名は可能な限り Issue 番号を含め、次の形を基本とします。

```text
<type>/<issue-number>-<short-description>
```

例:

```text
feat/42-context-menu-handoff
fix/57-selection-extraction
docs/61-agent-workflow
refactor/73-destination-adapter
```

Issue 番号を含めることで、人間と Agent が branch から Issue を逆引きしやすくなり、GitHub 検索とセッションをまたぐ復元が容易になります。ただし、branch 名だけを正式な Issue 関連付けとはみなしません。

### 4. first meaningful commit と Draft PR

空の PR は作りません。最初の意味のある commit を作成して push した後、substantial implementation を長く続ける前を Draft PR 作成の目安とします。

Draft PR 作成後は、原則として同じ branch / PR 上で実装、検証、レビュー、修正、再レビューを継続します。未完了の Draft PR には、現在の状態、未完了事項、blocker、次の作業を本文またはコメントで残し、別 Agent が復元できるようにします。

### 5. Implementation と Validation

Implementation Agent は Issue の範囲内で実装し、変更に応じた lint、typecheck、test、build、secret check、必要な実機確認を行います。結果、未実行の検証と理由、残存リスクを PR へ記録します。

### 6. 独立 Review（既定: 親 Codex Sol）

親 Codex Sol は Issue、Acceptance Criteria、PR diff、関連コード、validation 結果と文書を直接・独立して確認し、final review を行います。Implementation Agent の説明だけを根拠にせず、今回の PR で修正すべき問題と scope 外の follow-up を分けて PR に残します。ChatGPT Web 上の Sol / computer use は既定経路にせず、Human maintainer の明示依頼がある場合だけ使用します。同一 diff に対する Codex Sol と ChatGPT Web Sol の二重 review は既定にしません。明示された security 専門 workflow（security scan など）は別途実行でき、この既定経路を妨げません。

### 7. Review fixes と再レビュー

Implementation Agent は Review finding を受け取ったら、Issue、Requirements、Acceptance Criteria、実装と関連コードを確認して妥当性を判断します。妥当な指摘だけを同じ PR で修正し、修正後に再検証します。親 Codex Sol は修正後の diff、関連コード、validation を再レビュー（re-review）します。

### 8. Ready for review、Human merge、Issue close

必要な validation と review findings の対応が終わったら、PR を Ready for review にします。親 Codex Sol の `mergeable` 評価は参考情報であり、最終的な scope、Merge、Release Gate の判断は Human maintainer が行います。closing keyword がある PR がデフォルト branch へ Merge された後に GitHub が Issue を close します。

## Issue / branch / PR の関連付け

可能な限り、次の 3 段階で追跡可能な状態を作ります。

```text
GitHub Development link
        +
branch name に Issue number
        +
PR body から Issue reference
```

例:

```text
Issue #42

Development
└ Draft PR #43

branch:
feat/42-context-menu-handoff

PR body:
Closes #42
```

GitHub の linked branch を利用できない環境では、branch 名の Issue 番号と PR 本文の Issue 参照を最低限の fallback とします。特定の GitHub CLI コマンドや UI 操作を恒久的な要件にはせず、GitHub 上で対応関係を追跡できることを要件とします。

### Closing keyword の使い分け

- PR が Issue 全体の Acceptance Criteria を満たす場合は `Closes #42` または `Fixes #42` を使う
- PR が Issue の一部だけを実装する場合、または単に関連する場合は `Refs #42` などの非 closing reference を使う
- Draft PR でも、最終的に Issue 全体を完了させる予定なら closing keyword を記載してよい
- 大きな Issue を複数 PR に分割する場合、各 PR の関係を明記し、途中の PR で不用意に Issue を close しない

### 1 Issue / 1 PR

原則は `1 Issue → 1 primary working branch → 1 primary PR` です。ただし絶対ルールではありません。大規模変更の安全な分割、UI / core / test の独立した Merge、migration や段階的移行、レビューサイズの管理が必要な場合は複数 PR を許可します。その場合も各 PR と Issue の関係、順序、完了条件を明記します。

## Issue rules

Issue には次を記載します。

- Background / Problem
- Goal
- Requirements
- Non-goals
- Acceptance Criteria
- Constraints
- 関連する architecture / ADR
- 必要に応じた Security / Privacy considerations

Issue は実装ログ、レビュー記録、scratchpad、scope 外の追加改善の一覧として使いません。今回の PR で修正すべき問題は PR review / comment に残し、独立して実施できる改善は New Issue に分離します。

## Pull Request rules

PR は Implementation Agent と Review Agent の共有作業場所です。最低限、次を記録します。

- Related Issue と closing / non-closing reference
- Purpose と Scope
- Acceptance Criteria への対応
- Implementation summary と必要な Design decisions
- Validation の実行結果、未実行項目と理由
- Remaining risks
- Follow-up Issues
- Draft の未完了項目、blocker、次の作業

Draft 段階では、例えば次の状態を PR 本文で更新します。

```markdown
## Status

- [x] Initial implementation
- [x] Unit tests
- [ ] Browser verification
- [ ] Review findings addressed
- [ ] Parent Codex Sol direct review
```

Issue を実装作業ログとして更新し続けず、Implementation、Validation、CI、Review、Review findings、Fixes、Re-review、Remaining risks、Follow-ups は PR に集約します。

## Agent の役割

### Implementation Agent

- Issue、Acceptance Criteria、関連文書を読む
- Issue に紐づく working branch と Draft PR を用意・更新する
- 実装し、必要なローカル検証を行う
- PR に変更、状態、検証結果、未実行項目、残存リスクを記録する
- Review Agent の指摘を Requirements と実装に照らして検証する
- 妥当な指摘を修正し、修正後に再検証する

### Review Agent（既定: 親 Codex Sol）

- Issue、Acceptance Criteria、PR diff、関連コード、validation 結果と文書を直接確認する
- Implementation Agent とは独立した観点で correctness、regression、maintainability、error handling、test coverage を確認する
- architecture consistency、security、privacy、Chrome extension permissions、Manifest V3、untrusted input 境界、DOM / selector の脆弱性、文書整合性を確認する
- 今回修正すべき問題は PR に残し、scope 外の問題は Follow-up Issue に分離する
- 修正後に再レビューする
- Merge 可能性を評価できるが、自動 Merge や最終 Merge 判断は行わない

指摘は必要に応じて `Critical`、`High`、`Medium`、`Low`、`Nit` に分類できます。ただし severity の分類自体を目的にせず、再現条件と根拠のある指摘だけを残します。

### Human maintainer

- 最終的な scope と重要な Requirement 変更を判断・承認する
- Agent 間で判断が割れた場合に裁定する
- 最終 Merge 判断と Release Gate を担う
- Chrome Web Store 公開を判断し、必要な場合は手動操作する

### Current default assignment

現在の参考割り当ては次のとおりです。これは恒久的な技術要件ではなく、役割の定義から独立した現在の default assignment です。

```text
Implementation Agent:
- OpenCode

Review Agent（既定）:
- 親 Codex Sol（Issue / PR diff / 関連コード / validation の直接 review と re-review）

ChatGPT Web Sol / computer use:
- 既定経路では使用しない。Human maintainer の明示依頼時のみ使用する

Final merge authority:
- Human maintainer
```

Agent、モデル、GitHub 操作手段が変わっても、Issue / branch / PR の責務と引き継ぎ条件は変えません。

## Review finding の扱い

Review finding は次の順で扱います。

```text
Review finding
  ↓
Issue / Requirements / Acceptance Criteria を確認
  ↓
実装・関連コード・既存設計を確認
  ↓
指摘の妥当性を判断
  ↓
必要なら same PR で修正
  ↓
Validation と Re-review
```

誤認、scope 外、Requirement との矛盾、既存設計上意図された挙動に該当する場合は、盲目的に修正せず理由を PR 上で説明します。

### Fix in current PR

次は原則として同じ PR で修正します。

- bug、regression、Acceptance Criteria 未達
- Security / Privacy issue
- error handling の不足、必須 test の不足
- 今回の変更によって生じた current scope 内の correctness / design issue

### Follow-up Issue

次は新しい GitHub Issue として分離します。

- 大規模 refactor、新機能、技術的負債
- scope 外の UX 改善や architecture 改善
- current PR と独立して実施できる改善

元 Issue に無秩序に追記せず、PR から Follow-up Issue を参照します。

## Validation gate

変更内容に応じて、Ready for review / Merge 前に次を実行します。

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
```

PR には各結果、未実行の項目と理由を記録します。Chrome 実機確認などが必要な変更では、実行結果、未確認項目、残存リスクも記録します。ドキュメントだけの変更でプロダクト検証が不要な場合も、その判断を PR に明記します。

## CI と Draft PR

早い段階で Draft PR を作ることで、CI とレビュー可能な差分を早期に利用できます。ただし、CI のために意味のない push を増やすことは要求しません。現時点の CI 構成は変更せず、将来コストや実行時間が問題になった場合は、次のような運用へ変更できる余地を残します。

```text
Draft PR
→ lightweight validation

Ready for review
→ full validation
```

## Merge、Release、既存の安全境界

このワークフローは既存の製品・セキュリティ・公開ルールを緩和しません。

- Agent はユーザーの明示指示なしに Merge しない
- 親 Codex Sol は自動 Merge しない。CI 成功だけを理由に Merge しない
- Chrome Web Store 公開は Merge とは別の Release Gate とする
- CWS の submit / publish は CI、Actions、Agent、スクリプトから自動化せず、ユーザーが手動操作する

Manifest V3、最小権限、Security / Privacy、untrusted input、外部通信、ChatGPT Web DOM automation、GLM 利用、認証情報、破壊的操作の詳細は [AGENTS.md](../../AGENTS.md)、[CONTEXT.md](../../CONTEXT.md)、[ADR 0001](../adr/0001-experimental-chatgpt-web-handoff.md) などの既存の正本に従います。このワークフローはそれらの制約を緩和しません。

権限、Security、Privacy、外部通信、branding、公開範囲に影響する変更では、コードと同じ PR で関連文書を更新し、必要性・代替案・影響を記録します。Architecture の選択は ADR の基準に従い、未検討の事項を Accepted として固定しません。

## Trivial changes の例外

すべての変更に Issue 作成を強制しません。次のような trivial change は、`working branch → PR` の流れを許可します。

- typo、軽微な README の修正、明白な文言修正
- 小規模な test 修正、ごく小さい maintenance

ただし、新機能、bug fix、Manifest / permission / content script の変更、Security / Privacy、architecture、外部通信、データ処理、大規模 refactor は原則 Issue 起点とします。trivial に見えても scope、権限、公開、破壊的操作に影響する場合は Issue を作成し、必要な承認を得ます。

## セッション終了時の引き継ぎ

Agent が作業を終える、または交代する場合、PR から次を復元できる状態にします。

- 対象 Issue と branch、Draft / Ready の状態
- 実装済み範囲と Acceptance Criteria の対応状況
- 実行済み・未実行の validation とその理由
- 未解決の Review finding、blocker、次の作業
- 残存リスク、実機確認の有無、Follow-up Issue

Issue、branch、PR のいずれか一つだけに状態を閉じ込めず、GitHub 上のリンクと PR の現在状態を更新してから引き継ぎます。
