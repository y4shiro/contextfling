# Changelog

このファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) の形式に沿って更新します。

## Unreleased

### Changed

- ChatGPT adapter の非機密 typed diagnostics、prompt 書き込み前の composer 一意性確認、click 直前の attached DOM 再検証、background throttling を考慮した post-submit 最終確認を追加しました。曖昧な composer には prompt を書き込まず、send control の操作は最大一回で、retry は追加していません。
- Clipboard fallback の offscreen lifecycle、write、response、cleanup failure を typed category で分離しました。clipboard write は最大一回で、prompt / clipboard 内容を診断へ含めません。
- ADR 0003 で background 自動送信を撤回し foreground-only を Accepted としました。background 設定 UI / 保存を削除し、旧 `openInBackground` 保存値を無視します。
- 同意撤回後に optional host、`offscreen`、`clipboardWrite` の残存を個別確認し、権限の残存または確認失敗を成功表示しないようにしました。consent version と pending は安全側で削除します。

### Verified

- jsdom fixture で foreground、hidden document、delayed hydration、controlled input 未反映、DOM replacement / detached、send control 不在 / disabled / duplicate、synthetic click no-op、send-unknown を検証しました。
- offscreen 未作成 / create race / create 後 unavailable、clipboard unavailable / write rejection、response failure、close failure、同時 fallback、Service Worker restart 相当の cleanup を検証しました。
- Chrome 151.0.7922.140（arm64）で permission 拒否・許可・撤回・再同意、consent tab close、idle Service Worker 復帰を確認しました。部分 permission の timing window は利用者向け UI で再現できないため、自動テストで補完しました。
- 同じ Chrome 151 で Issue #6 の selection/status URL、page URL fallback、foreground target、旧保存値無視、target close 後の no-retry、別 profile の logged-out clipboard success banner を確認しました。DOM 変更・timeout・`send-unknown`・clipboard failure / offscreen edge は安全な手動再現を避け、88 tests で補完しました。
- Issue #11 の synthetic Chrome API 回帰テストで、`about:blank` 完了の保留から目的 URL 完了への遷移、重複 `onUpdated`、保存済み restart marker、target / consent tab close、selector-mismatch・timeout・`send-unknown` 後の no-retry（adapter と clipboard write は各一回）を確認しました。
- `npm test`: 88 tests passed。

## 0.1.1 - 2026-08-24（GitHub Experimental prerelease）

> 最新の手動 ZIP 配布。Chrome 実機で foreground の X→ChatGPT 自動送信成功を確認済み。Chrome Web Store 未公開。

### Fixed

- `about:blank` の完了イベントが ChatGPT への遷移前に発火した際、state 保存前の pending payload を早期削除する race を修正しました。`about:blank` は pending として保留し、目的 URL の完了後だけ処理します。

### Verified

- Chrome 実機で foreground の X 選択文から ChatGPT Web への自動送信成功を確認しました。
- `npm test`: 42 tests passed。

## 0.1.0 - 2026-08-24（GitHub Experimental prerelease）

> 既知の `about:blank` 完了イベント race を含むため非推奨。利用する場合は v0.1.1 を選択してください。Chrome Web Store 未公開。

### Added

- X / Twitter の選択文から `ChatGPTで解説する` を実行する context menu。
- 選択位置に近い status URL の抽出、HTTPS / host / status path の正規化、current page URL fallback。
- 選択文の LF / trim 正規化と 8,000 UTF-16 code units 上限。
- 固定 prompt、初回 exact preview、明示同意、同意撤回、前面 / 背景表示設定。
- 新しい ChatGPT Web tab への Experimental DOM handoff。
- DOM / login / timeout / send-unknown 時の一度だけの clipboard fallback と固定 banner。
- `storage.session` pending lifecycle と `storage.local` settings / consent version。
- Manifest V3 の最小権限、設定ページ、offscreen clipboard document、fixture / unit / integration tests。
- `dist/` の内容をアーカイブ直下にした GitHub Releases 用 ZIP の手動配布。Chrome Web Store への提出・公開は行わない。

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
