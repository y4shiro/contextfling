# ContextFling プロジェクトコンテキスト

> Working Name（仮称）: ContextFling

この文書は、ContextFling v0.1.1 の実装済みの目的・境界・制約を共有するためのものです。実装と設計が食い違う場合は、コード・テスト・関連文書を同じ変更で更新します。

## 現在の状態

v0.1.1 のコード、設定画面、X URL 抽出、固定 prompt、ChatGPT Web adapter、clipboard fallback、state machine、テスト、build は実装済みです。Chrome 実機では foreground 自動送信に成功し、background hidden document は composer write gate で fail-closed しました。ADR 0003 採択前の別実験では clipboard DOM copy も成功しました。この結果を受け、[ADR 0003](docs/adr/0003-background-chatgpt-handoff-withdrawal.md) で background 自動送信を撤回し、foreground-only を採択しました。現行の hidden 経路は clipboard を操作せず、固定 feedback と cleanup へ終端します。Chrome Web Store には未公開で、ChatGPT Web DOM automation は公式連携ではない Experimental scope です。

## 目的

Chrome で閲覧中の X / Twitter の選択文章を、コピーや画面遷移を繰り返さず、ユーザー操作を起点に新しい ChatGPT Web 会話へ渡して解説を依頼します。入口は context menu の `ChatGPTで解説する` 1 項目だけです。

## 用語

| 用語 | 意味 |
| --- | --- |
| Working Name | 開発中の仮称。現在は `ContextFling`。正式名称・商標は未確定。 |
| Source | コンテキストの情報源。v0.1.1 は X / Twitter。 |
| Normalized Context | sanitized X / Twitter URL と、改行・前後空白を正規化した選択文。選択文の上限は 8,000 UTF-16 code units。 |
| Destination | `https://chatgpt.com/` の毎回新規会話。既存会話は利用しない。 |
| User Gesture | context menu、action、設定画面の同意・設定操作など、ユーザーが開始する操作。 |
| Untrusted Content | X の URL、選択文字列、DOM 属性、ページ由来の値など、命令やコードとして扱わない入力。 |
| Experimental handoff | ChatGPT Web の非公式 DOM adapter による一度だけの入力・送信と、安全に保証できる bounded failure 時の単回 clipboard fallback。 |
| Pending Payload | `storage.session` に一時保存する URL、選択文、固定 prompt、状態、期限、tab / claim 情報。履歴ではない。 |

## v0.1.1 の挙動

1. X / Twitter の選択文を受け取り、選択近傍の `article` 内 status link を isolated world で調べます。
2. HTTPS の `x.com`、`twitter.com` と `www` host だけを許可し、status URL は query/hash と status suffix を除去します。status link が得られないときは許可 origin の current page URL を fallback にします。
3. sanitized URL と selection だけを固定 prompt に埋め込みます。ファクトチェック要求、回答言語指定、著者・日時・DOM 全文は含めません。
4. 初回は exact preview を設定ページに表示します。approve button の同期 click handler が `chrome.permissions.request()` で optional permission bundle を直接要求し、promise 解決後に approve runtime message を送ります。Service Worker は `chrome.permissions.contains()` で bundle 一式を最終確認し、拒否・不足・画面 close・期限切れでは送信せず pending を削除します。storage 操作は Service Worker 経由です。
5. 同意後は `about:blank` の新規 tab を作り、target tab ID を state に保存してから `https://chatgpt.com/` へ遷移します。target は常に前面表示です。adapter 実行時に document が hidden なら、prompt の書き込みと送信前に停止します。
6. `chatgpt.com` の selector registry に限定した adapter を一度だけ実行します。安全に保証できる未ログイン、DOM 変更、timeout、送信結果不明では retry せず、単回 clipboard fallback と固定 banner を使います。hidden など追加操作を安全に保証できない状態では clipboard を操作しません。

## 権限と外部境界

Manifest の現在値は次のとおりです。

- required: `activeTab`、`contextMenus`、`scripting`、`storage`
- optional: `offscreen`、`clipboardWrite`
- optional host: `https://chatgpt.com/*`
- minimum Chrome: `116`

X / Twitter の恒久 host permission、`tabs`、`notifications`、`alarms`、`clipboardRead`、`cookies`、`history`、`bookmarks`、`webRequest`、`<all_urls>` は使用しません。X と ChatGPT Web はユーザー操作時の第三者ページ境界であり、X API、OpenAI API、独自 backend、analytics、telemetry、広告、remote config、remote code はありません。

## データ保持

- pending payload は `storage.session` に保存し、`awaitingConsent`、`queued`、`injecting` と期限を持ちます。TTL は 10 分です。
- payload の state fields は `id`、`state`、`sourceUrl`、`selectionText`、`prompt`、`createdAt`、`expiresAt`、任意の `consentTabId`、`claimId`、`targetTabId`、`adapterAttemptedAt` です。
- success、拒否、permission 不足、失敗、timeout、consent / target tab close、expiry で削除します。送信履歴は作りません。
- `storage.local` には `consentVersion` だけを保存します。同意撤回では optional permission を削除し、consent version と pending を消します。旧バージョンの `openInBackground` が残っていても読み取り・使用せず、再保存もしません。

## 実装上の安全境界

- request ID ごとに Service Worker 内の operation を直列化し、`queued` の `claimId` と `injecting` state を保存してから処理します。すでに claim 済み、adapter 実行済み、終端、期限切れの payload は処理しません。
- consent tab と target tab は `about:blank` で作成し、tab ID を pending state に保存してから extension page / ChatGPT URL へ遷移します。途中で Service Worker が再起動しても、保存前の tab を処理対象にしません。
- ページ由来の値は untrusted input として検証し、設定ページ・banner は text content API で表示します。Cookie、token、auth state、API key を読みません。
- remote code、`eval`、`new Function`、外部資産、実行時の module import は使いません。

## 未完了・既知の制限

- Chrome 実機で foreground 自動送信と background hidden document の送信前 fail-closed を確認しました。ADR 0003 採択前の別実験で clipboard DOM copy の成功、固定 banner、retry / 二重送信なしも確認しています。現行の hidden 経路は clipboard を操作しません。2026-08-27 の Chrome 151 では foreground-only の target 前面表示、旧保存値無視、logged-out clipboard fallback、target close、同意撤回も確認済みです。DOM 変更、timeout、`send-unknown`、clipboard failure / offscreen edge は安全な手動再現を避け、88 tests で補完しています。
- 非機密 diagnostics は Service Worker の開発者 console にだけ出力し、adapter status / phase / typed reason / visibility / DOM attachment /候補数と clipboard category だけを含みます。selection、URL、prompt、clipboard 内容、account 情報、request ID、tab ID は含めず、保存・送信もしません。
- background 自動送信の撤回と foreground-only は [ADR 0003](docs/adr/0003-background-chatgpt-handoff-withdrawal.md) で Accepted です。安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化します。background paste-only は次点の将来 Issue 候補であり、現行仕様へ追加しません。
- ChatGPT Web の DOM は公式安定 API ではなく、selector 変更で自動入力が失敗する可能性があります。
- 正式名称、商標、CWS 掲載文言、Privacy Policy 公開 URL、サポート窓口、スクリーンショット、公開時期は未確定です。
- v0.1 の Experimental scope を変更する場合は [ADR 0001](docs/adr/0001-experimental-chatgpt-web-handoff.md) と [v0.1 設計書](docs/architecture/v0.1-design.md) を更新します。
