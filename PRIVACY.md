# ContextFling Privacy Policy

> Working Name（仮称）: ContextFling
>
> 最終更新: 2026-08-26

## 状態と適用範囲

ContextFling v0.1.1 は実装済みの Experimental Chrome 拡張機能 OSS です。Chrome 実機では foreground 自動送信に成功し、background hidden document は送信前に fail-closed、clipboard DOM copy は成功しました。この結果を受け、background 自動送信を撤回し、foreground-only を採択しています。Chrome Web Store には公開していません。この文書は、採択したデータフローと privacy 境界を説明します。正式名称、公開 URL、連絡先は CWS 提出前に確定します。

## データフロー

ContextFling は、ユーザーが X / Twitter 上で文章を選択し、右クリックの `ChatGPTで解説する` を選んだときだけ、次の処理を行います。

1. 選択文を前後の空白除去と改行の LF 化で正規化します。8,000 UTF-16 code units を超える選択文、空の選択文は処理しません。
2. 選択位置に近い X / Twitter status URL を調べます。HTTPS の許可 host と status path だけを通し、credentials、query、hash、status id より後ろの suffix を除去します。status link が得られない場合は、許可された current page URL を同じ境界で sanitize します。
3. sanitized URL と選択文だけを固定 prompt に埋め込みます。選択文は untrusted data として扱い、選択文内の命令やコードを ContextFling 自身が実行することはありません。
4. 初回は設定ページに、実際に送る prompt、sanitized URL、選択文、宛先 `https://chatgpt.com/`、非公式 DOM automation と clipboard fallback のリスクを表示します。
5. ユーザーが明示的に同意した後、毎回新しい ChatGPT Web の foreground tab を開き、ChatGPT Web の入力欄への DOM 入力と送信を一度だけ試行します。adapter 実行時に document が hidden なら、prompt の書き込みと送信前に停止します。選択文と prompt は第三者である ChatGPT Web に渡ります。

ContextFling の開発者や独自 backend が、選択文、URL、prompt、ChatGPT の応答を受け取ることはありません。X API、OpenAI API、analytics、telemetry、広告、remote config も使用しません。ただし、ChatGPT Web は本拡張機能の管理外の第三者サービスです。送信後の保存、利用、学習、削除は ChatGPT / OpenAI のサービス条件と Privacy Policy の対象になります。

## 保存と削除

### `storage.session` の pending payload

同意 preview と handoff の間だけ、Chrome `storage.session` に次の一時データを保存します。

- sanitized X / Twitter URL
- 正規化済み選択文
- 固定 prompt
- request ID、`awaitingConsent` / `queued` / `injecting` state、作成時刻、期限
- consent tab、claim、target tab、adapter attempt の制御情報

TTL は 10 分です。`expiresAt` 到達後は論理的に失効し、処理対象外になります。成功、拒否、permission 不足、DOM failure、timeout、送信結果不明、clipboard failure、consent / target tab close などの終端イベントでは pending を削除します。一方、`alarms` を使わないため、期限到達だけで `storage.session` から物理削除されるとは限りません。物理削除は次の Service Worker 起床・関連イベント、または browser restart などで行われます。送信履歴、選択文履歴、URL 履歴、ChatGPT 応答は保存しません。

### `storage.local` の設定

`storage.local` に保存するのは次の同意状態だけです。

- `consentVersion`: 同意済みの Experimental handoff version、または `null`

旧バージョンの `openInBackground` が保存されていても読み取り・使用せず、foreground 動作へ移行します。新しい保存や migration write は行いません。

同意を撤回すると、pending を削除し、optional permission を削除し、consent version を `null` に戻します。optional permission の削除後は host、`offscreen`、`clipboardWrite` を個別に再確認し、残存または確認失敗を成功扱いにしません。その場合も consent version と pending は安全側で削除し、設定画面で Chrome の拡張機能設定を確認するよう案内します。Chrome は以前に許可した permission を削除後に再要求すると、確認 prompt なしで再付与する場合がありますが、ContextFling は撤回後の新しい exact preview と明示同意を必須とし、以前の同意状態を再利用しません。設定画面で選択文や URL を保存することはありません。

## Clipboard fallback

ChatGPT Web の入力欄が見つからない、未ログイン、DOM が変更された、timeout、送信結果が不明などの場合、自動再送は行いません。安全に保証できる bounded failure では、同意済みの prompt を同梱 offscreen document から clipboard へ一度だけ書き、ChatGPT tab 内の固定 banner で手動貼り付けを案内します。送信・clipboard の追加操作を安全に保証できない状態では、option 5 の no-op + 明示的 feedback へ終端化します。

ContextFling は clipboard を読みません。ユーザーが上書きするまで、OS や他のアプリが clipboard 内容を保持する可能性があります。clipboard fallback を望まない場合は、権限を許可せず preview を拒否してください。

## 失敗診断

adapter / clipboard failure を切り分けるため、Service Worker のローカル開発者 console にだけ非機密 category を出力します。対象は adapter status / phase / typed failure reason、`document.visibilityState`、composer / send 候補数、DOM attachment、clipboard failure / lifecycle category、banner 表示成否です。

selection、sanitized URL、prompt、clipboard 内容、Cookie、token、認証情報、ChatGPT account 情報、request ID、tab ID、例外本文は診断へ含めません。診断は `storage` に保存せず、開発者 backend、analytics、telemetry、外部サービスへ送信しません。

## 取得しないデータ・使わない機能

ContextFling は次の情報を取得、保存、開発者へ送信しません。

- Cookie、token、ChatGPT の auth state、API key、パスワード
- X / Twitter のログイン情報、投稿者以外のページ全文、閲覧履歴、既存 ChatGPT 会話、ChatGPT 応答
- clipboard の既存内容
- analytics、telemetry、広告識別子、利用状況の測定

`tabs`、X / Twitter の恒久 host permission、`cookies`、`history`、`bookmarks`、`webRequest`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>` は使用しません。

## ユーザーへの注意

選択文は ChatGPT Web という第三者サービスへ渡るため、秘密情報、個人情報、認証情報、勤務先・顧客情報、契約上の非公開情報を選択しないでください。X / Twitter と ChatGPT / OpenAI の利用規約・Privacy Policy を確認し、送信内容と third-party processing を自分で判断してください。

## 連絡先と削除依頼

公開サポート窓口は未確定です。CWS 提出前は GitHub Issues を一般的な質問の窓口として整備し、個人情報や秘密を含む削除相談は公開 Issue に投稿しない方法を用意します。拡張機能内の pending と設定を削除するには、処理を終える、preview を拒否する、または設定画面で同意を撤回してください。ChatGPT Web に渡ったデータの削除は、ChatGPT / OpenAI の提供する手順に従ってください。

## 脆弱性の報告

セキュリティ問題は GitHub Private vulnerability reporting を優先してください。token、Cookie、個人情報、未修正の再現情報を公開 Issue や Pull Request に記載しないでください。詳細は [SECURITY.md](SECURITY.md) を参照してください。
