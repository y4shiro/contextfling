# ContextFling

> Working Name（仮称）: ContextFling

ContextFling は、現在表示しているコンテンツを少ない操作でチャット型 AI へ渡すことを目指す Chrome 拡張機能 OSS の準備リポジトリです。正式名称、公開範囲、機能仕様はまだ確定していません。

## 現在の状態

現在は Manifest V3 の監査可能な最小スキャフォールドのみを管理しています。v0.1 の初期 Source は X、初期 Destination は ChatGPT Web です。本体機能、Popup、Options、プリセット、コンテキスト抽出、AI への handoff はまだ実装していません。

現行 Manifest の権限ベースラインは空です。`activeTab`、`scripting`、`contextMenus` は候補として検討中ですが、設計・公式仕様の再確認・ADR・テスト更新なしに追加しません。`<all_urls>`、外部バックエンド、analytics、telemetry、remote code、ChatGPT DOM automation、X API、OpenAI API は初期方針として扱いません。

## 開発

Node.js 24 を第一候補、パッケージマネージャーを npm としています。依存関係は開発時だけに限定し、Extension の runtime dependency は原則 0 を目標にします。

```sh
npm install
npm run lint
npm run format
npm run typecheck
npm test
npm run build
```

`npm run build` は `src/service-worker.ts` を bundle して `dist/service-worker.js` を作成し、`src/manifest.json` を `dist/manifest.json` としてコピーします。`dist/` は生成物のため Git 管理対象外です。

## 構成

```text
src/manifest.json                 Manifest V3 の最小定義
src/service-worker.ts             現時点では処理を持たない module Service Worker
scripts/build.mjs                 esbuild による生成
tests/manifest.test.ts            Manifest の権限・CSP ベースライン検証
docs/architecture/                要件レビューと公式仕様確認
docs/adr/                         設計判断の記録
```

詳細な境界・用語・未決定事項は [CONTEXT.md](CONTEXT.md)、継続的な実装ルールは [AGENTS.md](AGENTS.md) を参照してください。Chrome Web Store の提出情報は [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) に集約します。

## 公開前ゲート

OSS として公開する前に、正式名称・branding・LICENSE・CONTRIBUTING・SECURITY・PRIVACY・CHANGELOG、データ利用説明、権限、サポート窓口、スクリーンショットを確定します。これらのうち `CONTRIBUTING.md`、`SECURITY.md`、`PRIVACY.md`、`CHANGELOG.md`、`LICENSE` は現時点では未作成・未確定です。

ユーザーから将来の公開許可は得ていますが、Public Release Gate の完了まではリポジトリを Private のまま扱います。公開や Chrome Web Store への提出は、未決定事項とセキュリティ・プライバシー確認を終えてから行います。

## ライセンス

ライセンスは未確定です。確定前に `LICENSE` を作成しません。
