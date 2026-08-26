# ContextFling

> Working Name（仮称）: ContextFling

ContextFling は、X で選択した文章を新しい ChatGPT Web の会話へ渡し、解説を依頼する Chrome 拡張機能 OSS です。

## 現在の状態

v0.1.1 の失敗経路を 68 tests で検証しています。PR #13 の 2026-08-26 修正前 build の Chrome 実機 smoke では foreground / background とも prompt 挿入後の自動送信と clipboard fallback が失敗し、固定 banner が表示されました。いずれも send 前に fail-closed し、自動 retry と二重送信は発生していません。原因修正後の re-smoke まで保証済みではなく、安全側の no-op + 明示的 feedback、clipboard 成功時だけの paste-only、DOM 自動送信の維持・撤回を [ADR 0003](docs/adr/0003-background-chatgpt-handoff-withdrawal.md) で検討中です。ChatGPT Web の DOM に依存する Experimental 機能であり、Chrome Web Store にはまだ公開していません。v0.1.0 は `about:blank` 完了イベントの既知 race を含むため非推奨です。

現行の主な挙動は次のとおりです。

- X / Twitter の選択範囲を右クリックし、`ChatGPTで解説する` を選びます。
- 選択文は前後の空白と改行を正規化し、8,000 UTF-16 code units を上限にします。選択位置に近い status URL を優先し、取得できない場合は許可された X / Twitter ページ URL を query/hash なしで使います。
- 初回は、実際に送る prompt、URL、選択文、宛先、DOM 自動操作と clipboard fallback のリスクをプレビューします。明示的に同意した場合だけ権限を要求します。
- 同意後は毎回新しい `https://chatgpt.com/` タブを開きます。ChatGPT タブは前面表示が既定で、設定からバックグラウンド表示へ変更できます。
- ChatGPT Web への DOM 入力・送信は一度だけ試行します。失敗時は自動再送せず、clipboard fallback と ChatGPT タブ内の banner で案内します。
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

v0.1.1 では、実アカウントの機密情報を選択せずに実機 smoke を行っています。PR #13 の 2026-08-26 修正前 build では foreground / background とも prompt の視覚的挿入後に自動送信されず、clipboard fallback も `write-failed` で失敗しました。adapter diagnostics は両経路とも `selector-mismatch` / `phase=composer` / `attempted=false` / `composer-write-unconfirmed`、foreground の visible sample は composer 1・container attached・send 候補 1、background の hidden sample は composer attached・container unknown・send 候補 0 でした。固定 banner、retry なし、二重送信なしを確認しています。非機密 DOM 確認では contenteditable ProseMirror composer の直下 `p` 要素への段落正規化により、現行 `textContent` 完全一致 gate が複数行 prompt を誤って拒否することが最有力・実質特定されています。段落 plain-text 復元と offscreen 単回 DOM copy を実装し、68 tests で fail-closed と単回操作を検証しました。次に Chrome re-smoke を行います。re-smoke までは自動送信を成功扱いに戻さず、no-op + 明示的 feedback を安全側候補とし、clipboard success が確認できた場合だけ paste-only を再検討します。追加確認では、非機密 diagnostics だけを使い、ChatGPT のログイン済み・未ログイン、DOM 変更、clipboard success / failure、同意撤回を確認してください。

## 設計と制約

- 必須権限は `activeTab`、`contextMenus`、`scripting`、`storage` です。
- `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` は preview 後の同意ボタンから要求する optional permission です。
- X / Twitter の恒久 host permission、`tabs`、`cookies`、`history`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>`、backend、analytics、telemetry、OpenAI API、remote code は使用しません。
- pending payload は `storage.session` に一時保存し、`expiresAt` により 10 分で論理失効させます。終端イベントでは削除しますが、`alarms` を使わないため、期限到達だけで物理削除されるとは限りません。物理削除は次の Service Worker 起床・関連イベント、または browser restart などで行われます。設定と consent version だけを `storage.local` に保存します。
- ChatGPT Web の DOM 構造変更、未ログイン、送信結果不明、Chrome / Web Store の審査・利用条件が既知の制限です。実装は Experimental のままです。

詳細な責務、権限、状態遷移、受入状況は [v0.1 設計書](docs/architecture/v0.1-design.md)、実装履歴は [CHANGELOG.md](CHANGELOG.md)、公開前の確認事項は [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) に記録しています。継続ルールは [AGENTS.md](AGENTS.md) を参照してください。

## 公開状態

ソースリポジトリは [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling) です。ソース公開と拡張機能の公開リリースは別であり、Chrome Web Store への提出は、実機 smoke、Security / Privacy review、正式名称、掲載素材、Privacy Policy の公開 URL、サポート窓口を確認してから行います。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
