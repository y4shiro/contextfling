# ContextFling Contribution Guide

> Working Name（仮称）: ContextFling

ContextFling v0.1.1 は実装済みの Experimental Chrome 拡張機能 OSS です。2026-08-27 の Chrome 151 で X→ChatGPT の foreground-only smoke を完了していますが、Chrome Web Store は未公開です。実装済みの Source、Destination、権限、handoff 方式を変更する場合は、設計文書・ADR・受入条件を確認してください。

## 配布と公開

- v0.1.0 は GitHub Releases の Experimental prerelease として、`dist/` の内容をアーカイブ直下にした ZIP で手動配布します。GitHub Release の ZIP 配布と Chrome Web Store 公開は別です。
- Chrome Web Store への提出・公開は自動化しません。CI、Actions、agent、スクリプトに CWS の submit / publish を追加・実行せず、将来もリリース単位のユーザーの明示承認後に、ユーザーが手動操作します。

## 変更前に確認すること

- [CONTEXT.md](CONTEXT.md)、[AGENTS.md](AGENTS.md)、関連する architecture 文書を読む。
- Manifest の権限、外部通信、データ処理、DOM 依存、branding に関わる変更は、必要性と代替案を明記する。
- 実装済みの挙動と `README.md`、[PRIVACY.md](PRIVACY.md)、[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) の記述を同期させる。
- 未確定の大きな設計判断は、勝手に確定せず `docs/adr/` の基準に従って提案する。

## タスクと文書の正本

- active な task、bug、Release Gate の状態、担当、優先度、blocker は [GitHub Issues](https://github.com/y4shiro/contextfling/issues) を正本とします。Issue の状態と担当を変更したときは、別の一覧を同期するのではなく Issue を更新してください。
- [Milestone](https://github.com/y4shiro/contextfling/milestone/1) はリリースまたは目標単位のまとまりに使います。
- ADR と architecture 文書は設計判断、制約、受入条件、検証証跡を記録します。`README.md` は公開概要、[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) は Chrome Web Store の metadata と開示内容の正本です。これらに active backlog を複製しません。
- Issue の起票には [task template](.github/ISSUE_TEMPLATE/task.md) を使い、target milestone と完了条件を明記します。機密性のある security 報告は公開 Issue に書かず、[SECURITY.md](SECURITY.md) の手順へ誘導してください。

## Agent-assisted development

通常の変更は次の流れで進めます。

```text
Issue
↓
Issue-linked branch
↓
Draft PR
↓
Implementation / Review / Fix
↓
Human Merge
```

Issue は要件と受入条件、PR は実装・検証・レビューの状態を扱います。詳細な関連付け、引き継ぎ、validation、レビュー、Merge のルールは [Agent 支援開発ワークフロー](docs/development/agent-workflow.md) を参照してください。

## 開発環境

Node.js 24 を第一候補、npm をパッケージマネージャーとします。

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
```

フォーマットを適用する場合は `npm run format` を使います。生成物 `dist/` と依存ディレクトリ `node_modules/` はコミットしません。

## コードとセキュリティの方針

- Manifest V3 と最小権限を維持し、`<all_urls>` や不要な `tabs`、`storage`、host permissions を追加しない。
- 外部通信、analytics、telemetry、remote code、API key、認証情報を機能コードへ追加しない。
- ページ本文、選択テキスト、URL、DOM 属性、AI 由来の値は untrusted input として扱い、無検証で HTML やコードへ渡さない。
- ChatGPT の非公開 DOM automation、入力欄の直接操作、送信ボタンの自動クリックは、ADR 0001 の v0.1 Experimental scope 内に限って扱う。scope 外、対象 host 外、同意を省略した操作、retry は禁止し、変更時は明示的なユーザー同意、失敗時の安全な fallback、fixture / 回帰テストを更新する。実機回帰テスト未完了の状態で scope を拡張しない。
- selector は責務ごとに集約し、DOM extraction を変更した場合は fixture と回帰テストを確認する。
- 秘密情報をリポジトリへ追加しない。`.gitignore` の対象を確認し、コミット前に `npm run check:secrets` を実行する。`.env.example` には値ではなく安全な説明用プレースホルダーだけを置く。

## Pull Request

PR は [Pull Request template](.github/PULL_REQUEST_TEMPLATE.md) を使い、対象 Issue を `Fixes #123`、`Closes #123`、または `Refs #123` などで参照してください。目的、変更範囲、完了条件への対応、必要な設計上の判断、検証結果、未実行の検証、残存リスクを記載します。権限・Privacy・Security・公開範囲に影響する変更は、関連文書と ADR の要否も明記します。詳細は [Agent 支援開発ワークフロー](docs/development/agent-workflow.md) に集約しています。

公開、Chrome Web Store への提出、外部サービスへの接続、データ削除やその他の破壊的操作は、Public Release Gate とリリース単位のユーザー明示承認なしに行いません。CWS の提出・公開は常にユーザーの手動操作です。
