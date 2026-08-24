# Third-party と開発支援資料

## Runtime dependency

ContextFling の配布物に runtime library dependency はありません。`npm` の dev dependency（TypeScript、esbuild、Biome、型定義）は開発・bundle・検証にだけ使い、`dist/` の実行時に外部から読み込みません。remote code、CDN、外部 module import、remote config は使用しません。

`dist/` は `scripts/build.mjs` が生成する成果物であり、第三者ライブラリを動的に取得しません。生成物へ意図しない依存や source map を含めないことを build test で検査します。

## ユーザー操作時の第三者境界

X / Twitter と ChatGPT Web は、ContextFling に組み込まれたライブラリではなく、ユーザーが操作する第三者 Web サービスです。

- X / Twitter: ユーザーが選択した文章と、許可済み host に正規化した URL を読み取る入力境界です。X API や恒久 host permission は使用しません。
- ChatGPT Web: 初回 preview と明示同意後に、新しい `https://chatgpt.com/` tab へ prompt を渡す destination です。公式拡張機能 API ではなく、DOM adapter による Experimental handoff です。
- Clipboard: DOM handoff 失敗時に、同意済み prompt を一度だけ書き込む OS / ブラウザ境界です。既存 clipboard は読みません。

これらの第三者サービスに送られたデータの保存、利用、学習、削除、規約、Privacy Policy は ContextFling の管理外です。ユーザーは機密情報や個人情報を選択せず、X / Twitter と ChatGPT / OpenAI の最新の規約・Privacy Policy を確認してください。詳細は [PRIVACY.md](PRIVACY.md) を参照してください。

## GoogleChrome / modern-web-guidance

- 対象: `GoogleChrome/modern-web-guidance` の `chrome-extensions` Skill
- ライセンス: Apache-2.0
- 取得コミット: `9e70fa4c808b52364eb85c645e261523231176f6`
- 取得日: 2026-08-24
- 配置: project-local の `.codex/skills/chrome-extensions/`
- ライセンス原文: `.codex/skills/chrome-extensions/LICENSE`
- 取得目的: Manifest V3、Chrome API、Web Store 掲載準備に関する開発時のガイダンス

この Skill は開発者向けの project-local 資料であり、Extension の runtime dependency、配布物、`dist/` の生成物ではありません。実行時に Skill、リモート URL、CDN、外部スクリプトを読み込みません。

Skill の記述と Chrome 公式仕様が食い違う場合は、確認日と根拠を [Chrome API verification](docs/architecture/chrome-api-verification.md) に記録し、公式仕様を優先します。

## 監査済み・未導入の Skills

`mattpocock/skills` の `grill-me`、`grilling`、`grill-with-docs`、`domain-modeling` は 2026-08-24 に監査しましたが、現時点では導入していません。

- upstream は Matt Pocock 管理、MIT License、活発に保守されています。
- 現行 `grilling` は複数の質問を一つの round にまとめるため、このプロジェクトの「原則一問ずつ」と衝突します。
- `grilling` の sub-agent dispatch 指示は、このリポジトリのエージェント運用ルールと衝突します。
- 推奨インストーラーには匿名 telemetry があるため、no telemetry 方針では明示的な無効化と追加監査が必要です。

## 更新時のルール

Skill、開発依存、外部サービス境界を更新する場合は、コミット、取得日、ライセンス、取得元、差分の影響をこの文書へ追記します。変更後も runtime dependency、remote code、ユーザーコンテンツの外部送信が意図せず増えていないことを確認します。
