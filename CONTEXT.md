# ContextFling プロジェクトコンテキスト

> Working Name（仮称）: ContextFling

この文書は、プロジェクトの目的・用語・境界・制約を短く共有するためのものです。詳細な実装仕様や未決定事項の結論は、必要に応じて Architecture 文書または ADR に分離します。

## 目的

Chrome で閲覧中のコンテンツを、コピーや画面遷移を何度も行わず、ユーザー操作を起点にチャット型 AI へ渡せるようにすることを目指します。v0.1 の初期 Source は X の投稿、初期 Destination は ChatGPT Web です。取得フィールド、対象投稿の識別、handoff 方式、操作 UI はまだ確定していません。

## 用語

| 用語 | 意味 |
| --- | --- |
| Working Name | 開発中の仮称。現在は `ContextFling`。正式名称・商標は未確定。 |
| Source | 閲覧中の投稿やページなど、コンテキストを取得する情報源。 |
| Normalized Context | Source 固有の形式から切り離した、送信候補の共通データ。構造は未確定。 |
| Destination | コンテキストを渡す先。ChatGPT Web などを候補とするが、方式は未確定。 |
| User Gesture | action、context menu、commands など、ユーザーが明示的に開始する操作。 |
| Untrusted Content | ページ本文、選択文字列、URL、DOM 属性、AI 由来の値など、信頼できない入力。 |

## 境界

### 初期に検討する範囲

- Google Chrome の Manifest V3 拡張機能。
- v0.1 の Source は X、Destination は ChatGPT Web に限定すること。
- ユーザー操作を起点に、現在のページまたは投稿の情報を扱うこと。
- Source と Destination を分離し、特定サービスへの依存を局所化すること。
- 必要最小限の権限、外部通信なし、telemetry なしを優先すること。

### 現時点で実装しない範囲

- Popup、Options、side panel、プリセット、handoff、DOM extraction。
- X API、OpenAI API、独自バックエンド、データベース。
- ChatGPT の非公開 DOM への content script 注入、入力欄操作、送信ボタンの自動クリック。
- analytics、telemetry、広告、remote config、remote code。
- `<all_urls>`、cookies、history、bookmarks、webRequest などの広い権限。

## 制約と方針

- Manifest V3 を使用し、Service Worker は ephemeral であることを前提にする。
- 権限はコードとドキュメントの両方で理由を説明し、勝手に追加しない。
- ページ由来の値は untrusted input として検証・境界付けし、HTML として無検証で挿入しない。
- 実行時に外部スクリプトを読み込まず、remote code や `eval` / `new Function` に依存しない。
- Runtime dependency は原則 0。開発ツールは bundle して配布物に不要な依存を持ち込まない。
- 製品名をドメインモデル、永続データ形式、公開プロトコルへ不要に埋め込まない。
- 重要な設計判断は `docs/adr/` に記録し、セキュリティ・プライバシーに関わる変更では関連文書も更新する。

## 未決定事項

- 正式名称、branding、リポジトリの公開時期、ライセンス。
- action click を即時実行にするか Popup を開くか。
- keyboard shortcut、context menu の項目とプリセット。
- Source から取得するフィールド、対象投稿の識別、失敗時の fallback。
- Destination への handoff 方式と、ChatGPT Web 以外の adapter。
- 最終的な permissions、`activeTab` / `scripting` / `contextMenus` の組み合わせ。
- TypeScript、esbuild、Biome、テスト実行方式の最終バージョン。

未決定事項を埋めるための実装を先行させず、公式仕様の確認、grill、ADR、実装計画の順に判断します。
