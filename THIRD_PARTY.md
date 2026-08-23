# Third-party と開発支援資料

## GoogleChrome / modern-web-guidance

- 対象: `GoogleChrome/modern-web-guidance` の `chrome-extensions` Skill
- ライセンス: Apache-2.0
- 取得コミット: `9e70fa4c808b52364eb85c645e261523231176f6`
- 取得日: 2026-08-24
- 配置: project-local の `.codex/skills/chrome-extensions/`
- ライセンス原文: `.codex/skills/chrome-extensions/LICENSE`
- 取得目的: Manifest V3、Chrome API、Web Store 掲載準備に関する開発時のガイダンス

この Skill は開発者向けの project-local 資料であり、Extension の runtime dependency、配布物、`dist/` の生成物ではありません。実行時に Skill、リモート URL、CDN、外部スクリプトを読み込みません。

ネットワークアクセスは Skill を導入・更新するときだけに限定します。実装、build、テスト、利用時に、ユーザーのコンテンツや利用状況を外部へ送信する通信は追加しません。

Skill の記述と Chrome 公式仕様が食い違う場合は、確認日と根拠を `docs/architecture/chrome-api-verification.md` に記録し、公式仕様を優先します。

## 監査済み・未導入の Skills

`mattpocock/skills` の `grill-me`、`grilling`、`grill-with-docs`、`domain-modeling` は 2026-08-24 に監査しましたが、現時点では導入していません。

- upstream は Matt Pocock 管理、MIT License、活発に保守されています。
- 現行 `grilling` は複数の質問を一つの round にまとめるため、このプロジェクトの「原則一問ずつ」と衝突します。
- `grilling` の sub-agent dispatch 指示は、このリポジトリのエージェント運用ルールと衝突します。
- 推奨インストーラーには匿名 telemetry があるため、no telemetry 方針では明示的な無効化と追加監査が必要です。
- 導入する場合はレビュー済み revision を固定し、4 Skills の相互依存、MIT 表示、project-local 配置、質問形式の上書きを確認します。

## 更新時のルール

Skill を更新・差し替えする場合は、コミット、取得日、ライセンス、取得元、差分の影響をこの文書に追記します。変更後も remote code、runtime dependency、外部通信を導入しないことを確認します。
