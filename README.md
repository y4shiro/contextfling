# ContextFling

> Working Name（仮称）: ContextFling

ContextFling は、現在表示しているコンテンツを少ない操作でチャット型 AI へ渡すことを目指す Chrome 拡張機能 OSS の準備リポジトリです。正式名称、公開範囲、機能仕様はまだ確定していません。

## 現在の状態

現在は Manifest V3 の監査可能な最小スキャフォールドのみを管理しています。現行コードはページ本文、選択テキスト、URL、認証情報などのデータを処理、保存、送信しません。v0.1 の初期 Source を X、初期 Destination を ChatGPT Web とする案は将来計画であり、確定実装や公開版の挙動を意味しません。本体機能、Popup、Options、プリセット、コンテキスト抽出、AI への handoff はまだ実装していません。

現行 Manifest の権限ベースラインは空です。`activeTab`、`scripting`、`contextMenus` は候補として検討中ですが、設計・公式仕様の再確認・ADR・テスト更新なしに追加しません。`<all_urls>`、外部バックエンド、analytics、telemetry、remote code、X API、OpenAI API は使用しません。ChatGPT Web の DOM automation は、明示的な初回同意、対象 host の限定、自動再試行の禁止、クリップボードへの fallback を前提とする実験機能として設計中であり、現行コードには含まれません。

## 開発

Node.js 24 を第一候補、パッケージマネージャーを npm としています。依存関係は開発時だけに限定し、Extension の runtime dependency は原則 0 を目標にします。

```sh
npm install
npm run lint
npm run format
npm run typecheck
npm test
npm run build
npm run check:secrets
```

`npm run build` は `src/service-worker.ts` を bundle して `dist/service-worker.js` を作成し、`src/manifest.json` を `dist/manifest.json` としてコピーします。`dist/` は生成物のため Git 管理対象外です。

## 構成

```text
src/manifest.json                 Manifest V3 の最小定義
src/service-worker.ts             現時点では処理を持たない module Service Worker
scripts/build.mjs                 esbuild による生成
tests/manifest.test.ts            Manifest の権限・CSP ベースライン検証
tests/secret-scan.test.mjs        Secret scan の高確度検出・除外検証
scripts/check-secrets.mjs         追跡対象・ステージ内容の secret scan
docs/architecture/                要件レビューと公式仕様確認
docs/adr/                         設計判断の記録
```

詳細な境界・用語・未決定事項は [CONTEXT.md](CONTEXT.md)、継続的な実装ルールは [AGENTS.md](AGENTS.md) を参照してください。Chrome Web Store の提出情報は [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) に集約します。

## 公開状態

ソースリポジトリは、設計と開発過程を監査可能にするためOSSとして公開します。これは拡張機能の公開リリースや、Chrome Web Store での提供開始を意味しません。

Chrome Web Store へ提出する前に、正式名称・branding・CHANGELOG、確定したデータ利用説明、権限、サポート窓口、スクリーンショット、実機確認、Security/Privacy review を含む Public Release Gate を完了します。`LICENSE`（MIT）、`CONTRIBUTING.md`、`SECURITY.md`、`PRIVACY.md` は作成済みです。

現在は設計・実験段階であり、Chrome Web Store には未公開です。将来計画を変更した場合は、実装済みのコード、テスト、README、Privacy Policy、Web Store 開示を同じ変更で更新します。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
