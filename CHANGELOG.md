# Changelog

このファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) の形式に沿って更新します。

## 0.1.0 - 2026-08-24（Unreleased）

> Chrome Web Store 未公開。ChatGPT Web の実機 X→ChatGPT smoke test pending。Experimental build。

### Added

- X / Twitter の選択文から `ChatGPTで解説する` を実行する context menu。
- 選択位置に近い status URL の抽出、HTTPS / host / status path の正規化、current page URL fallback。
- 選択文の LF / trim 正規化と 8,000 UTF-16 code units 上限。
- 固定 prompt、初回 exact preview、明示同意、同意撤回、前面 / 背景表示設定。
- 新しい ChatGPT Web tab への Experimental DOM handoff。
- DOM / login / timeout / send-unknown 時の一度だけの clipboard fallback と固定 banner。
- `storage.session` pending lifecycle と `storage.local` settings / consent version。
- Manifest V3 の最小権限、設定ページ、offscreen clipboard document、fixture / unit / integration tests。

### Security

- `activeTab`、`contextMenus`、`scripting`、`storage` を required に限定。
- ChatGPT host、`offscreen`、`clipboardWrite` は preview 後の同意から要求する optional permission として限定。
- X / Twitter の恒久 host permission、`tabs`、Cookie、history、clipboardRead、backend、analytics、telemetry、API key、remote code を使用しない。
- pending payload は 10 分で論理失効し、terminal event または次の Service Worker 起床・関連イベントなどで物理削除し、selection / URL / prompt の履歴を保存しない。
- DOM adapter の claim、attempt marker、request ID 直列化により自動 retry と二重送信を抑止。
- secret scan、CSP、安全な text content 表示、untrusted input 境界を追加。

### Known limitations

- ChatGPT Web は公式の拡張機能連携 API ではなく、DOM 変更で adapter が壊れる可能性があります。
- ChatGPT 実機の logged-in / logged-out、foreground / background、DOM failure、clipboard fallback、tab close の smoke test は未完了です。
- Chrome Web Store 公開、正式名称、branding、Privacy Policy 公開 URL、サポート窓口、掲載素材は未確定です。

## 0.0.0 - 2026-08-24

### Added

- Manifest V3 の初期スキャフォールド、公開 OSS 向けドキュメント、secret scan の基盤。
