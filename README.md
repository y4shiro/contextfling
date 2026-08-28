# ContextFling

> Working Name（仮称）: ContextFling

ContextFling は、X で選択した文章を新しい ChatGPT Web の会話へ渡し、解説を依頼する Chrome 拡張機能 OSS です。

## 現在の状態

v0.1.1 の失敗経路を 88 tests で検証しています。PR #13 の 2026-08-26 修正前 build では foreground / background とも prompt 挿入後の自動送信と clipboard fallback が失敗しました。PR #13 の修正コミット `5cf1416` を Chrome 実機で再確認した結果、foreground は送信成功、background は hidden document の React / ProseMirror state readiness を保証できず fail-closed しました。ADR 0003 採択前の background 実験では clipboard DOM copy 自体は `copied` まで成功しましたが、自動送信は成立していません。修正前後とも自動 retry と二重送信は発生していません。この結果を受け、[ADR 0003](docs/adr/0003-background-chatgpt-handoff-withdrawal.md) で background 自動送信を撤回し、foreground-only（option 2）を Accepted としました。現行の hidden 経路は clipboard を操作せず、固定 feedback と cleanup へ終端します。2026-08-27 の Chrome `151.0.7922.140` (arm64) では、foreground-only の target 前面表示、旧保存値無視、logged-out clipboard fallback、target close 後の no-retry を追加確認しました。安全に実行できない状態は option 5（no-op + 明示的 feedback）で終端化します。option 3（background paste-only）は次点の将来 Issue 候補です。ChatGPT Web の DOM に依存する Experimental 機能であり、Chrome Web Store にはまだ公開していません。v0.1.0 は `about:blank` 完了イベントの既知 race を含むため非推奨です。

現行の主な挙動は次のとおりです。

- X / Twitter の選択範囲を右クリックし、`ChatGPTで解説する` を選びます。
- 選択文は前後の空白と改行を正規化し、8,000 UTF-16 code units を上限にします。選択位置に近い status URL を優先し、取得できない場合は許可された X / Twitter ページ URL を query/hash なしで使います。
- 初回は、実際に送る prompt、URL、選択文、宛先、DOM 自動操作と clipboard fallback のリスクをプレビューします。明示的に同意した場合だけ権限を要求します。
- 同意後は毎回新しい `https://chatgpt.com/` タブを前面に開きます。バックグラウンド表示の設定はありません。旧バージョンの `openInBackground` 保存値が残っていても無視します。
- ChatGPT Web への DOM 入力・送信は一度だけ試行します。安全に保証できる bounded failure だけで clipboard fallback を一度実行し、ChatGPT タブ内の固定 banner で案内します。hidden など追加操作を安全に保証できない状態では clipboard を操作せず、自動再送もしません。
- action は設定画面を開きます。送信履歴、選択文の履歴、URL 履歴は拡張機能内に保存しません。

ChatGPT Web には公式の拡張機能連携 API を使っていません。ログイン状態、Cookie、token、既存会話は読み取りません。選択文と sanitized URL は、ユーザーの同意後に第三者である ChatGPT Web へ渡ります。詳細は [PRIVACY.md](PRIVACY.md) を確認してください。

## 計画中の機能

X / Twitter の単体ポストページ（`/<user>/status/<numeric-id>`）で、本文を選択せず通常のページ右クリックから `このポストをChatGPTで解説する` を起動する仕様を承認済みです。既存の選択範囲用 context menu、初回 exact preview、明示同意、optional permission、毎回新しい ChatGPT 会話、一回だけの送信、clipboard fallback、retry なし、pending cleanup は維持します。

本文なし、非 status URL、selector mismatch / DOM 変更、8,000 UTF-16 code units 超は送信せず、X のページ上に明確な feedback を表示します。X / Twitter の恒久 host permission、常駐 content script、action icon からの即時実行、X 内の常設ボタンはこの仕様の対象外です。詳細は [単体ポスト右クリック実行 設計書](docs/architecture/single-post-context-menu.md)、[ADR 0002](docs/adr/0002-single-post-context-menu.md)、[実装 Issue #12](https://github.com/y4shiro/contextfling/issues/12) を参照してください。

この機能は仕様承認済み・実装 pending であり、現行リリースの挙動にはまだ含まれません。

## 開発

Node.js 24 以上と npm を使用します。実行時の外部ライブラリ依存はありません。

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run check:secrets
```

`npm run build` は Service Worker、設定ページ、offscreen clipboard ページを bundle し、静的 HTML/CSS と Manifest を `dist/` へ配置します。`dist/` は生成物であり、Git 管理対象外です。

### タスク管理

タスク、bug、Release Gate は [GitHub Issues](https://github.com/y4shiro/contextfling/issues)、リリースや目標単位は [Milestone](https://github.com/y4shiro/contextfling/milestone/1) で管理します。開発手順とPRのルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

### GitHub Releases の Experimental prerelease

v0.1.1 は [GitHub Releases の一覧](https://github.com/y4shiro/contextfling/releases) から、`Prerelease` と表示された Experimental prerelease の ZIP を手動配布します。配布 ZIP は `dist/` の内容をアーカイブ直下に置きます。つまり、解凍後に選択するフォルダの直下に `manifest.json` があり、`dist/` が一段入れ子にならない構成です。これは Chrome Web Store への公開とは別の配布です。v0.1.0 の ZIP は既知の race のため非推奨です。

ダウンロードして手動で読み込む手順:

1. GitHub Releases の一覧から `Prerelease` と表示された v0.1.1 の ZIP をダウンロードします。
2. ZIP を解凍し、直下に `manifest.json` があるフォルダを確認します。
3. Chrome で `chrome://extensions` を開き、Developer mode を有効にします。
4. `Load unpacked` を押し、解凍したフォルダを選択します（ZIP ファイルや、その親フォルダではありません）。
5. X / Twitter 上の文章を選択し、右クリックの `ChatGPTで解説する` を実行します。

GitHub Release の ZIP 配布は CWS 未公開の Experimental 配布です。CWS への提出・公開は、別の Release Gate を満たし、リリース単位でユーザーが明示承認した後に手動で行います。CI、Actions、agent、スクリプトから CWS の submit / publish は行いません。

### ローカル unpacked extension の確認

1. `npm run build` を実行します。
2. Chrome で `chrome://extensions` を開き、Developer mode を有効にします。
3. `Load unpacked` からリポジトリの `dist/` を選びます。
4. X / Twitter 上の文章を選択し、右クリックの `ChatGPTで解説する` を実行します。
5. 初回 preview で送信内容と宛先を確認し、同意するか拒否します。

v0.1.1 では、実アカウントの機密情報を選択せずに実機 smoke を行っています。修正前 build では foreground / background とも prompt の視覚的挿入後に自動送信されず、clipboard fallback も `write-failed` で失敗しました。段落 plain-text 復元と offscreen 単回 DOM copy を実装した PR #13 の修正コミット `5cf1416` の re-smoke では、foreground が `status=sent` / `phase=send` / `attempted=true` / `failureReason=none`、`visibilityState=visible`、composer / send 候補各 1、全 attachment `attached` となり、メッセージ送信、入力欄の空、banner なしを確認しました。background は hidden sample が `status=selector-mismatch` / `phase=composer` / `attempted=false` / `failureReason=composer-write-unconfirmed`、composer 候補 1・composer `attached`、container / send は `unknown`・0 で、メッセージ未送信、入力欄への prompt 残留、banner 表示となりました。同じ ADR 0003 採択前の background 実験では clipboard fallback が `status=copied`、`failureCategory=none`、`cleanupFailureCategory=none`、`lifecycleCategory=none`、`bannerShown=true` でした。Console に残った visible `sent` は直前の foreground ログであり、background 成功の証拠にはしません。これを根拠に background 自動送信の撤回と foreground-only を採択し、現行の hidden 経路では clipboard fallback を行いません。2026-08-27 の [Issue #6 smoke](docs/testing/chrome-116-smoke.md) では、foreground target、旧保存値無視、F1–F3 の単回送信・composer cleanup、F4 の target close 後の no-retry、F5 の logged-out clipboard success banner を確認しました。F4 の送信成否は確認せず、pending cleanup は自動テストで補完しています。DOM 変更、timeout、`send-unknown`、clipboard failure / offscreen edge も安全な手動再現を避け、88 tests で補完しています。安全に実行できない予期しない状態は option 5 の no-op + 明示的 feedback へ終端化し、option 3 の background paste-only は将来 Issue 候補として分離します。

## 設計と制約

- 必須権限は `activeTab`、`contextMenus`、`scripting`、`storage` です。
- `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` は preview 後の同意ボタンから要求する optional permission です。
- X / Twitter の恒久 host permission、`tabs`、`cookies`、`history`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>`、backend、analytics、telemetry、OpenAI API、remote code は使用しません。
- pending payload は `storage.session` に一時保存し、`expiresAt` により 10 分で論理失効させます。終端イベントでは削除しますが、`alarms` を使わないため、期限到達だけで物理削除されるとは限りません。物理削除は次の Service Worker 起床・関連イベント、または browser restart などで行われます。設定と consent version だけを `storage.local` に保存します。
- ChatGPT Web の DOM 構造変更、React / ProseMirror state readiness、未ログイン、送信結果不明、Chrome / Web Store の審査・利用条件が既知の制限です。foreground-only でも非公開 DOM 依存は残り、安全に確認できない場合は fail-closed します。実装は Experimental のままです。

詳細な責務、権限、状態遷移、受入状況は [v0.1 設計書](docs/architecture/v0.1-design.md)、実装履歴は [CHANGELOG.md](CHANGELOG.md)、公開前の確認事項は [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) に記録しています。継続ルールは [AGENTS.md](AGENTS.md) を参照してください。

## 公開状態

ソースリポジトリは [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling) です。ソース公開と拡張機能の公開リリースは別であり、Chrome Web Store への提出は、Security / Privacy review、正式名称、掲載素材、Privacy Policy の公開 URL、サポート窓口を確認してから行います。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
