# ContextFling プロジェクトコンテキスト

> Working Name（仮称）: ContextFling

この文書は、プロジェクトの目的・用語・境界・制約を短く共有するためのものです。v0.1 の設計結論は [ADR 0001](docs/adr/0001-experimental-chatgpt-web-handoff.md) と [v0.1 設計書](docs/architecture/v0.1-design.md) にあり、ここでは実装前の境界と注意点を保ちます。

## 目的

Chrome で閲覧中のコンテンツを、コピーや画面遷移を何度も行わず、ユーザー操作を起点にチャット型 AI へ渡せるようにすることを目指します。v0.1 は X 上の選択文章を、右クリックの `ChatGPTで解説する` 1 項目から ChatGPT Web の新規会話へ渡す設計を Accepted Experimental としました。現行コードはまだ最小スキャフォールドで、本体機能は実装していません。

## 用語

| 用語 | 意味 |
| --- | --- |
| Working Name | 開発中の仮称。現在は `ContextFling`。正式名称・商標は未確定。 |
| Source | 閲覧中の投稿やページなど、コンテキストを取得する情報源。v0.1 は X。 |
| Normalized Context | Source 固有の形式から切り離した、v0.1 では sanitized URL と選択文章からなる送信候補。 |
| Destination | コンテキストを渡す先。v0.1 は `https://chatgpt.com/` の毎回新規会話に限定する。 |
| User Gesture | action、context menu、commands、同意ボタンなど、ユーザーが明示的に開始する操作。 |
| Untrusted Content | ページ本文、選択文字列、URL、DOM 属性、AI 由来の値など、信頼できない入力。 |
| Experimental handoff | 公式連携ではない ChatGPT Web DOM adapter による一度だけの入力・送信。初回同意と安全な fallback を必須とする。 |
| Pending Payload | `storage.session` に一時保存する URL、選択文章、固定 prompt、状態、期限の組。履歴ではない。 |

## 境界

### v0.1 で設計する範囲

- Google Chrome の Manifest V3 拡張機能。
- v0.1 の Source は X 上の選択文章、Destination は ChatGPT Web の新規会話に限定する。
- 操作入口は context menu の `ChatGPTで解説する` 1 項目。action は設定画面を開き、foreground default / background 設定を持つ。
- 固定 prompt の動的値は sanitized URL と selection text のみ。ファクトチェック要求と回答言語指定を含めない。
- X URL は selection 近傍 article 内の HTTPS status link を優先し、失敗時は許可 origin の sanitized current URL を使う。
- ChatGPT Web DOM automation は ADR 0001 の実験境界に限定し、初回 preview/明示同意、optional host/offscreen/clipboardWrite、retry 禁止、banner/fallback を必須とする。
- Source と Destination を分離し、特定サービスへの依存を adapter 内へ閉じ込める。

### 現行コードにない範囲

- 現行スキャフォールドには context menu、設定画面、handoff、DOM extraction、ChatGPT adapter はまだ実装していない。
- X API、OpenAI API、独自バックエンド、データベース。
- ADR 0001 の境界外の ChatGPT 非公開 DOM automation、任意サイトの自動操作、既存会話利用。
- keyboard shortcut、複数 preset、Popup の即時実行、side panel。
- analytics、telemetry、広告、remote config、remote code。
- `<all_urls>`、cookies、history、bookmarks、webRequest などの広い権限。

## 制約と方針

- Manifest V3 を使用し、Service Worker は ephemeral であることを前提にする。
- 現行 Manifest の permission baseline は空。v0.1 の required candidate は `activeTab`、`contextMenus`、`scripting`、`storage`、optional candidate は `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` とするが、実装とテストの同時更新なしに追加しない。
- optional permission は初回に送信内容・宛先・リスクを正確に preview し、同意画面のボタン操作からだけ要求する。
- ページ由来の値は untrusted input として検証・境界付けし、HTML として無検証で挿入しない。固定 prompt では内部命令を実行しない旨を明示する。
- X/Twitter への恒久 host permission、ChatGPT の Cookie/token/auth state、API key、OpenAI API、backend、analytics、telemetry を使わない。
- ChatGPT DOM adapter は selector を隔離し、bounded MutationObserver、timeout、retry 禁止、offscreen clipboard fallback、小さな banner を持つ実験機能とする。
- pending payload は `storage.session`、settings と consent version だけは `storage.local` に置き、成功・拒否・失敗・timeout・tab close・期限切れで削除する。履歴は残さない。
- 実行時に外部スクリプトを読み込まず、remote code や `eval` / `new Function` に依存しない。
- Runtime dependency は原則 0。開発ツールは bundle して配布物に不要な依存を持ち込まない。
- 製品名をドメインモデル、永続データ形式、公開プロトコルへ不要に埋め込まない。
- 重要な設計判断は `docs/adr/` に記録し、セキュリティ・プライバシーに関わる変更では関連文書も更新する。

## 未決定事項

- 正式名称、商標、branding、CWS 掲載文言、Privacy Policy の公開 URL、正式な公開リリース時期。
- ChatGPT Web DOM adapter の selector、Chrome の実機挙動、最終 timeout/selection 上限、利用条件・審査結果。
- v0.1 以外の Source/Destination、keyboard shortcut、複数 preset、paste-only を既定にするか。
- Chrome 116 minimum candidate を採用するか、offscreen lifecycle の旧バージョン fallback を支えるか。
- 実装後の実機 smoke、Security/Privacy review、撤回条件の判定。

未決定事項を埋めるための追加実装を先行させず、[v0.1 実装計画](docs/architecture/v0.1-implementation-plan.md) の小ステップ、レビュー、テスト、Release Gate の順に進めます。
