# Security Policy

## 現在のサポート状況

ContextFling v0.1.1 は ChatGPT Web DOM automation を含む Experimental build です。Chrome 実機で foreground 自動送信に成功し、background hidden document は送信前に fail-closed しました。ADR 0003 採択前の別実験では clipboard DOM copy に成功しています。この結果から background 自動送信を撤回して foreground-only を採択し、現行の hidden 経路は clipboard を操作しません。Chrome 151 の Issue #6 smoke では target 前面表示、旧保存値無視、logged-out fallback、target close 後の no-retry を確認しています。Chrome Web Store には未公開です。未リリースのコードについてもセキュリティ問題を受け付けます。

## System and Scope

現行コードは Manifest V3 の X selection handoff です。`activeTab`、`contextMenus`、`scripting`、`storage` を使い、同意後に optional `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` を使います。独自 backend、データベース、analytics、telemetry、広告、X API、OpenAI API はありません。

ユーザーが X / Twitter で選択した文章と sanitized URL は、初回 preview と明示同意の後、毎回新しい ChatGPT Web 会話へ渡ります。ChatGPT Web、X / Twitter、Chrome は本リポジトリの管理外の第三者境界です。

## Threat Model and Trust Boundaries

- X / Twitter の URL、DOM、選択文字列、ChatGPT Web の DOM、入力欄、送信ボタンは untrusted input / boundary として扱います。
- 選択文には個人情報、機密情報、prompt injection 風の命令が含まれる可能性があります。固定 prompt は動的値を untrusted data として区切り、ContextFling 自身はその命令を実行しません。
- ChatGPT Web への DOM handoff は公式の拡張機能 API ではありません。第三者サービスの保存・処理・規約は ContextFling の管理外です。
- optional permission は正確な preview 後、設定ページの approve button の同期 click handler からだけ要求し、要求結果の後に Service Worker が bundle 一式を再確認します。
- 外部 GLM worker を使う場合も、公開済み clean repository の限定的な低リスク作業に限り、認証情報・個人情報・非公開データを渡しません。

## Security Invariants

- ChatGPT への送信は context menu と初回同意を起点にし、同意前の optional host / clipboard permission 要求と送信を行いません。
- 送信先は `https://chatgpt.com/` の新規 tab だけです。既存会話、Cookie、token、auth state、API key、ChatGPT 履歴を読みません。
- X / Twitter の URL は HTTPS、許可 host、status path または許可 origin の page fallback に正規化し、credentials、query、hash、status suffix を除去します。
- selection は前後空白と改行を正規化し、8,000 UTF-16 code units を超える値を拒否します。URL、selection、prompt は `storage.session` の pending にのみ一時保存します。`expiresAt` の10分到達で論理失効し、終端イベントでは削除します。`alarms` を使わないため、期限到達だけで物理削除されるとは限らず、次の Service Worker 起床・関連イベント、または browser restart などで物理削除されます。
- `storage.local` には `consentVersion` だけを保存し、送信履歴を作りません。旧 `openInBackground` 値は読み取り・使用しません。
- request ID ごとの operation を Service Worker 内で直列化し、`queued` → `injecting` の claim を保存します。`adapterAttemptedAt` を保存した payload は再実行しません。
- consent / target tab は `about:blank` で作成し、tab ID と state を `storage.session` へ保存してから extension page / ChatGPT URL へ遷移します。保存前の tab を処理対象にしません。
- adapter の送信結果が不明、DOM が変更、未ログイン、timeout になっても自動 retry しません。clipboard fallback は一度だけ書き、固定 banner で結果を伝えます。
- `<all_urls>`、`tabs`、X / Twitter の恒久 host permission、`cookies`、`history`、`bookmarks`、`webRequest`、`notifications`、`alarms`、`clipboardRead` は使用しません。
- page 由来の値を無検証で HTML、属性、コード、任意の URL 遷移へ渡しません。remote code、`eval`、`new Function`、inline script、実行時の外部 module import は使用しません。
- API key、token、Cookie、秘密鍵、認証情報、個人データをコード、Manifest、fixture、ログ、Issue、Pull Request へ保存しません。

## 実装上の確認点

- `src/sources/x/` に selector を集約し、URL の許可・正規化は `src/core/url.ts`、選択文上限は `src/core/selection.ts`、固定 prompt は `src/core/prompt.ts` で検証します。
- ChatGPT selector と DOM 操作は `src/destinations/chatgpt/` に閉じ込め、isolated world の bounded MutationObserver と timeout を使います。
- 設定ページは preview の URL、選択文、prompt を text content として表示し、request ID や payload を DOM attribute へ入れません。Service Worker は settings page sender を検証して message を受けます。
- offscreen clipboard page は static bundle で、runtime message 以外の拡張機能 API を扱いません。clipboard を読み取らず、request ID の重複書き込みを拒否します。
- 同意撤回では optional bundle の削除後に host、`offscreen`、`clipboardWrite` を個別確認し、残存または確認失敗を成功扱いにしません。consent version と pending は安全側で削除し、再利用時は新しい preview と明示同意を要求します。Chrome が以前の許可履歴に基づいて permission を prompt なしで再付与する場合も、この拡張機能独自の同意境界は省略しません。
- 失敗経路の diagnostics は Service Worker のローカル開発者 console にだけ、有限の status / phase / failure category、visibility、DOM attachment、候補数として出力します。selection、URL、prompt、clipboard 内容、account 情報、request / tab ID、例外本文は出力しません。telemetry や外部送信はありません。
- `npm run check:secrets` は高確度パターンを検査し、`.gitignore`、GitHub secret scanning、push protection と併用します。

## Known Limitations and Compensating Controls

- ChatGPT Web の DOM は公式・安定した連携仕様ではありません。selector、ログイン画面、入力欄、送信結果が変わると自動入力に失敗する可能性があります。adapter を分離し、retry 禁止、clipboard fallback、固定 banner で影響を限定します。
- Chrome 151 の実機では foreground 成功、background hidden の送信前 fail-closed、foreground-only target、旧保存値無視、logged-out clipboard success banner、target close 後の no-retry、同意撤回を確認しました。clipboard DOM copy の background 成功は ADR 0003 採択前の別実験であり、現行の hidden 経路では clipboard を操作しません。DOM failure、timeout、`send-unknown`、clipboard failure / offscreen edge は安全な手動再現を避け、84 tests の fail-closed、cleanup、no-retry で補完しています。
- `chrome.storage` は compare-and-swap を提供しないため、state read/write だけでは排他を保証できません。request ID ごとの直列化、claim ID、adapter attempt marker、期限検査を併用します。10分の TTL は論理失効であり、`alarms` を使わないため物理削除は次の Service Worker 起床・関連イベント、または browser restart などになり得ます。Service Worker 再起動後の stale `injecting` は自動再試行しません。
- `npm run check:secrets` は未知・難読化された secret を完全には検出しません。変更差分と公開履歴をレビューし、secret が見つかった場合は無効化・履歴対応を優先します。
- 第三者 ChatGPT Web が受け取ったデータの保持・利用・削除は本拡張機能から制御できません。ユーザーは秘密情報や個人情報を選択しないでください。

## Reportable Findings and Severity Context

次の問題は報告対象です。

- 同意を回避した外部送信、任意 host への送信、既存会話・別アカウントへの誤送信
- selection の範囲を越えたページ内容、Cookie、token、auth state、clipboard の読み取り
- 二重送信、自動 retry、結果の誤表示、pending の削除漏れ、権限の意図しない拡大
- XSS、remote code、任意コード実行、prompt injection から browser 操作へ至る経路
- secret、credential、個人データのリポジトリ、生成物、Issue、ログへの漏えい

認証情報の漏えい、同意なしの外部送信、任意コード実行、広範なブラウザデータアクセスは、到達可能性と影響に応じて重大度を高く扱います。

## Out of Scope

- ContextFling を経由せず、X、ChatGPT、Chrome 自体だけで成立する脆弱性
- 第三者サービスの一般的な停止や性能低下
- データ漏えい、誤送信、権限拡大を伴わない selector 変更による単純な機能停止

ただし、第三者サービスの変更によって ContextFling が誤送信、安全でない fallback、意図しないデータアクセスを起こす場合は報告対象です。

## 脆弱性の報告

Public repository の機密性のある報告は GitHub Private vulnerability reporting を優先してください。公開 Issue は一般的な質問や再現に秘密を含まない報告だけに使います。token、Cookie、個人情報、再現用 secret、未修正の詳細を公開しないでください。
