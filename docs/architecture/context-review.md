# プロジェクトコンテキストレビュー

> レビュー日: 2026-08-24
>
> Working Name（仮称）: ContextFling

この文書は、立ち上げ時の要求を分類し、確定していない事項を実装で固定しないための記録です。分類は現時点のレビュー結果であり、後続の grill、公式仕様確認、ADR で更新します。

## 確定要求

- 対象ブラウザは Google Chrome、拡張機能形式は Manifest V3 とする。
- v0.1 の初期 Source は X、初期 Destination は ChatGPT Web とする。ただし抽出対象と handoff 方式は未確定とする。
- 開発中の表示名は `ContextFling`。ただし正式名称ではなく、公開前に変更される可能性がある。
- 中核の目的は、現在閲覧中のコンテンツを少ない操作でチャット型 AI へ渡すこと。
- まず設計・文書・公式仕様確認を行い、本体機能をいきなり大量実装しない。
- 初期ドキュメントは日本語で作成する。
- 初期スキャフォールドは本体機能、Popup、Options、preset、handoff、selector extraction を含めない。
- 現行 Manifest の permission baseline は空とし、不要な権限や `<all_urls>` を追加しない。
- 現行の優先順位は Security、Privacy、Least privilege、Auditability、Simplicity、Reliability、Convenience の順とする。

## 強い default

- TypeScript、Manifest V3、Vanilla HTML/CSS を第一候補とし、UI の必要性が明確になるまでフレームワークを導入しない。
- npm、esbuild、TypeScript、Biome を開発ツールの第一候補とし、runtime dependency は原則 0 を目標とする。
- ユーザー操作時に表示中のページから必要情報を扱い、X API や独自バックエンドに依存しない。
- Source と Destination を分離し、Service/adapter 固有の依存を局所化する。
- 外部通信、analytics、telemetry、広告、remote code、API key、ChatGPT DOM automation は初期方針として避ける。
- ページ由来の値は untrusted input として扱い、selector は集約し、失敗時は graceful degradation を検討する。

## 未確定

- 正式名称、商標、branding、アイコン、LICENSE、公開範囲と公開時期。
- action click の動作（即時実行または Popup）、commands のキー、context menu の項目・プリセット。
- X 投稿の識別方法、取得フィールド、DOM extraction の fallback 順序。
- ChatGPT Web など Destination への handoff 方式と、他の AI への拡張時期。
- 最終 permissions と `activeTab` / `scripting` / `contextMenus` の組み合わせ。
- `tabs`、`storage`、host permissions が必要となる具体的な後続操作。
- テスト fixture、最低 Chrome バージョン、CWS の掲載情報、Privacy Policy URL、連絡先。

## 再検証する事項

- `activeTab` が action、contextMenus、commands のユーザー操作で発動する条件。
- 発動中に `tab.url` などのタブ情報を取得する条件。Skill と Chrome 公式の差異は公式を優先する。
- `scripting` と一時的な `activeTab`、host permissions の組み合わせ。
- `contextMenus` の permission 要件と、メニュー選択からの権限発動。
- Popup や side panel の後続ボタン操作で `activeTab` が継続するか。
- `storage` を使う必要性、ローカル保存のライフサイクル、CWS の開示要否。

## 潜在矛盾

- 立ち上げ要求の permission 候補には `storage` が含まれる一方、現行の最小スキャフォールドでは保存処理がなく、permission baseline は空である。
- Skill は `tab.url` に `tabs` permission が必要と記載する一方、確認した Chrome 公式の `activeTab` 説明は、一時的な host permission 発動中に機微なタブ情報へアクセスできると説明する。詳細は [chrome-api-verification.md](chrome-api-verification.md) に記録し、公式を優先する。
- OSS-ready 方針と初期 GitHub リポジトリの Private 方針は両立するが、公開は Release Gate 完了後に行う必要がある。ユーザーの将来の公開許可はあるが、現時点で公開操作は行わない。
- ChatGPT Web への利便性と、非公開 DOM automation を避ける Security/Maintenance 方針は衝突し得る。handoff 方式を先に確定しない。

## 不足論点

- 正式なデータ分類、保持期間、削除・エクスポート、Privacy Policy の連絡先。
- OSS ライセンス、Contributing、Security、Changelog、Issue/サポート運用。
- 対応 Chrome バージョン、アクセシビリティ、国・地域、CWS 素材、公開者情報。
- X の DOM 変更に対する fixture と回帰テスト、ユーザーへの失敗通知。
- URL 検証、悪意あるページ内容、prompt injection、リンク自動アクセスの境界。
- 設計を固定する前に必要な grill、ADR の採否、Release Gate の受入条件。

## 次の判断経路

1. Chrome 公式 API の確認結果をレビューする。
2. grill で action、permissions、extraction、handoff の未決定事項を絞る。
3. 変更コストの高い判断だけを `docs/adr/` に `Proposed` として記録する。
4. acceptance criteria と実装計画を確定してから本体機能へ進む。
