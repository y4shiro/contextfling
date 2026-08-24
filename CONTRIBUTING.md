# ContextFling Contribution Guide

> Working Name（仮称）: ContextFling

ContextFling は設計・実験段階の Chrome 拡張機能 OSS です。現時点では Chrome Web Store に未公開であり、将来計画を実装済みの機能として扱いません。Source、Destination、権限、handoff 方式などの未決定事項は、実装前に設計文書・ADR・受入条件を確認してください。

## 変更前に確認すること

- [CONTEXT.md](CONTEXT.md)、[AGENTS.md](AGENTS.md)、関連する architecture 文書を読む。
- Manifest の権限、外部通信、データ処理、DOM 依存、branding に関わる変更は、必要性と代替案を明記する。
- 実装済みの挙動と `README.md`、[PRIVACY.md](PRIVACY.md)、[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) の記述を同期させる。
- 未確定の大きな設計判断は、勝手に確定せず `docs/adr/` の基準に従って提案する。

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
- ChatGPT の非公開 DOM automation、入力欄の直接操作、送信ボタンの自動クリックは、Accepted ADR、明示的なユーザー同意、対象 host の限定、失敗時の安全な fallback、実機回帰テストが揃うまで実装しない。
- selector は責務ごとに集約し、DOM extraction を変更した場合は fixture と回帰テストを確認する。
- 秘密情報をリポジトリへ追加しない。`.gitignore` の対象を確認し、コミット前に `npm run check:secrets` を実行する。`.env.example` には値ではなく安全な説明用プレースホルダーだけを置く。

## Pull Request

PR には目的、変更範囲、設計上の判断、テスト結果、未実行の検証、残存リスクを記載してください。権限・Privacy・Security・公開範囲に影響する変更は、関連文書と ADR の要否も明記します。

少なくとも次の検証を通してください。

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
```

公開、Chrome Web Store への提出、外部サービスへの接続、データ削除やその他の破壊的操作は、Public Release Gate と明示的な承認なしに行いません。
