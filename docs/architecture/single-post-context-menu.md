# X 単体ポストの右クリック実行 設計書

> status: Accepted（実装前）
>
> implementation: pending（仕様の承認であり、実装完了を意味しない）
>
> tracking: [GitHub Issue #12](https://github.com/y4shiro/contextfling/issues/12)
>
> 設計日・最終更新: 2026-08-24

この文書は [ADR 0002](../adr/0002-single-post-context-menu.md) で選定した、X / Twitter の単体ポストを右クリックから扱う機能の仕様を定義します。既存の選択範囲用 context menu と [v0.1 の ChatGPT Web handoff](v0.1-design.md) は維持し、この機能の実装前に受入条件と検証方法を固定します。

## 目的

X / Twitter の単体ポストページを開いているとき、テキストを選択しなくても、通常のページ右クリックから `このポストをChatGPTで解説する` を起動できるようにします。ポスト本文を一度だけ取得し、既存の exact preview、明示同意、optional permission、毎回新しい ChatGPT 会話、失敗時の clipboard fallback と cleanup へ接続します。

## Scope

### 対象

- HTTPS の X / Twitter 単体ポスト URL（`/<user>/status/<numeric-id>`）での通常のページ右クリック。
- 現在 URL から得た status ID と一致する `article` を特定し、そのポストの主本文だけを取得する処理。
- 既存の選択範囲用 `ChatGPTで解説する` context menu。単体ポスト用の追加後も挙動を変更しない。
- 既存の prompt、preview、同意、permission、handoff、fallback、pending cleanup の共通経路。
- 本文取得に失敗したときの、X の source page 上での固定メッセージによる feedback。

### 対象外

- X / Twitter のページ内へ常設するボタン、投稿ごとの追加ボタン、MutationObserver による常駐処理。
- 拡張機能 action icon からの即時実行。action は現行の設定導線と競合するため、今回の対象外とする。
- X API、OpenAI API、独自 backend、remote code、analytics、telemetry、広告。
- 返信、引用ポスト、著者名、時刻、操作 UI、画像 alt、ページ全文、複数ポストの一括取得。
- 非 status URL、status ID と一致しない `article`、本文が空のポスト、DOM / selector mismatch を推測で補完する処理。
- 8,000 UTF-16 code units を超える本文の送信や、送信結果不明時の retry。

## UX と処理フロー

1. ユーザーが X / Twitter の単体ポストページで、本文を選択せず通常のページ右クリックを行い、`このポストをChatGPTで解説する` を選びます。
2. context menu の user gesture を起点に、Service Worker が current tab の URL を検証し、`activeTab` の一時 access と `scripting` を使って本文を取得します。既存の selection menu は別項目として残します。
3. URL、status ID、抽出本文の返値を Service Worker 側で再検証します。検証に失敗した場合は送信せず、X の source page に固定の失敗メッセージを表示します。
4. 本文が有効なら、既存の source URL / text 正規化と固定 prompt の共通経路へ渡します。初回、同意撤回後、または optional permission が不足している場合は、実際に送る内容、宛先、リスクの exact preview を表示します。
5. ユーザーが明示的に同意し、permission bundle が揃った場合だけ既存の handoff を実行します。同意済みで必要な permission が揃っている場合は、既存仕様どおり即時 handoff とします。
6. handoff は毎回新しい ChatGPT Web 会話に一度だけ送信します。DOM 操作が失敗した場合は、既存の clipboard fallback と banner を一度だけ使い、retry せず pending を cleanup します。

本文や URL の値を source page feedback に再掲しないため、feedback は固定文面だけで構成します。

## URL と本文の抽出規約

### URL と status ID

- current tab URL はページ由来の untrusted input として扱い、Service Worker 側で HTTPS、許可済み X / Twitter host、path pattern を検証します。
- 許可する形は `https://x.com/<user>/status/<numeric-id>`、`https://twitter.com/<user>/status/<numeric-id>` とその `www` host 相当です。`<user>` は1つの path segment、status ID は数字だけとします。
- credentials、unexpected port、別 host、追加の path segment は許可しません。query と hash は status identity の照合から除外しますが、送信 URL は既存 URL normalizer の規約で sanitized します。
- current URL から得た numeric status ID を extractor に渡し、DOM から返る status link も同じ normalizer に通して ID が一致する `article` だけを候補にします。ID が一致しない候補へ fallback しません。
- 主投稿 `article` を一意に判定できない、selector が見つからない、DOM が想定と異なる場合は送信せず、selector mismatch / DOM 変更として扱います。

### 主本文

- 一致した `article` の主投稿本文 selector に限定してテキストを取得します。`article.innerText` やページ全文をそのまま送信しません。
- nested article、引用ポスト、返信、著者名、時刻、操作 UI、画像 alt は本文の取得対象から除外します。画像・動画だけで本文 text がない場合も送信しません。
- 抽出値は改行を LF に統一し、既存の text normalizer と同じ規約で前後の空白を除去します。空になった場合は送信しません。
- 正規化後の本文が 8,000 UTF-16 code units を超える場合は送信しません。文字数判定は JavaScript の UTF-16 code unit 数で行います。
- extractor の返値は、本文・status ID・source URL を含む untrusted data として Service Worker 側で URL、ID、text、上限を再検証します。検証済みの値だけを prompt builder と handoff coordinator に渡します。
- selector は X source adapter の registry に閉じ込め、DOM の変更時に無関係な component が selector を直接参照しないようにします。

## 権限と実装境界

### 権限

現行 Manifest の required permission を再利用し、新規 permission は追加しません。

| 権限 / access | この機能での用途 | 追加・変更 |
| --- | --- | --- |
| `activeTab` | context menu の直接 user gesture による current X tab への一時 access | 変更なし |
| `contextMenus` | ページ用 menu item の登録。既存 selection menu も維持 | 変更なし |
| `scripting` | 一時的な本文抽出と source page feedback | 変更なし |
| `storage` | 既存の `storage.session` pending と `storage.local` 設定 / consent | 変更なし |
| `https://chatgpt.com/*` | preview 後、同意済みの既存 ChatGPT handoff | 既存 optional host を再利用 |
| `offscreen` / `clipboardWrite` | 既存 handoff failure 時の clipboard fallback | 既存 optional bundle を再利用 |

X / Twitter の恒久 host permission、常駐 content script、`tabs`、`cookies`、`history`、`notifications`、`alarms`、`clipboardRead` は追加しません。optional ChatGPT bundle は、既存どおり exact preview 後の同期 approve click handler からだけ要求し、要求後に Service Worker が `chrome.permissions.contains()` で一式を確認します。

### 実装境界

- Context-menu router は page context の新項目と既存 selection context の項目を分け、クリックされた項目に応じて適切な入力を作ります。
- X source adapter / extractor は current URL の expected status ID と DOM selector registry を使い、本文と一致確認に必要な最小情報だけを返します。ページへ常駐しません。
- URL normalizer、text normalizer、prompt builder、preview / consent、handoff coordinator、ChatGPT adapter、clipboard fallback、pending cleanup は既存の共通責務を再利用します。
- source page feedback presenter は固定メッセージを `textContent` 等の安全な方式で表示し、本文・URL・DOM 属性を HTML や URL 遷移へ渡しません。
- Service Worker は extractor の返値を信頼せず、送信直前まで URL / status ID / text を再検証します。ChatGPT adapter に X DOM の値を直接渡しません。
- 新しい source type や pending payload の識別子を追加する場合も、既存の state machine の `awaitingConsent`、`queued`、`injecting` と terminal cleanup、claim、attempt marker、TTL、no-retry を壊さない範囲に限定します。

## 失敗時の source-page feedback

次の条件では payload を ChatGPT handoff へ進めず、元の X page に固定メッセージを表示します。source page へ feedback を表示できない場合も送信せず、本文や URL を再送・再試行せず、処理を終端にします。

| 条件 | 表示する趣旨 | 送信 |
| --- | --- | --- |
| current URL が非 status URL、許可 host 外、または status ID を取得できない | 「単体ポストページで実行してください」 | しない |
| status ID と一致する `article` がない | 「このポストを特定できませんでした。ページを確認してください」 | しない |
| selector mismatch / DOM 変更 | 「ポスト本文を取得できませんでした。X の表示変更の可能性があります」 | しない |
| 主本文が空、または画像・動画だけ | 「解説できる本文テキストがありません」 | しない |
| 本文が 8,000 UTF-16 code units 超 | 「本文が長すぎるため送信できません（上限 8,000 UTF-16 code units）」 | しない |
| URL / text の Service Worker 側再検証に失敗 | 「ポスト情報を安全に確認できないため送信しません」 | しない |

メッセージは固定の安全な文面とし、抽出した本文、URL、status ID、selector の詳細、prompt を表示しません。preview 後の permission 拒否、ChatGPT DOM failure、timeout、send-unknown、clipboard failure は既存の設定 page / ChatGPT tab banner / clipboard fallback の規約に従います。

## Security / Privacy

- context menu invocation は明示 user gesture と `activeTab` の一時 access に限定します。X / Twitter の恒久 host permission、常駐 content script、外部通信は追加しません。
- current URL、DOM 属性、status link、本文はすべて untrusted input として扱います。`innerHTML`、任意 URL navigation、script 実行、`eval`、`new Function` へ渡しません。
- prompt に含める動的値は既存 handoff と同様に sanitized source URL と正規化本文だけです。本文中の命令、コード、prompt は untrusted data として区切り、ContextFling 自身の指示として実行しません。
- 本文に Cookie、token、auth state、API key、ChatGPT の既存会話、開発者管理 backend の情報を追加取得しません。著者名・時刻・操作 UI・画像 alt・ページ全文も送信しません。
- preview は実際の prompt、source URL、本文、宛先、DOM handoff / clipboard fallback のリスク、一回だけの送信と retry なしを正確に示します。初回 exact preview と明示同意なしに ChatGPT へ送信しません。
- `storage.session` の pending は既存 TTL と terminal cleanup に従い、送信履歴・本文履歴・URL 履歴を追加保存しません。失敗時も pending を残して retry しません。
- source page feedback は本文を再掲せず、画像 alt やページ外の情報を読みません。Chrome restricted page などで表示できない場合も、送信を試みるための権限拡張や恒久 access 追加を行いません。

## 受入条件

実装完了を宣言するには、次をすべて満たす必要があります。

1. `/<user>/status/<numeric-id>` の単体ポストページで、選択なしの通常右クリックに `このポストをChatGPTで解説する` が表示され、クリックから既存 handoff へ進む。
2. 既存の選択範囲用 context menu とその URL / text 抽出・preview・handoff 挙動が変わらない。
3. current URL の status ID と一致する `article` の主投稿本文だけを取得し、返信・引用・著者名・時刻・操作 UI・画像 alt を prompt に含めない。
4. 非 status URL、許可外 URL、ID不一致、selector mismatch / DOM変更、本文なし、8,000 UTF-16 code units 超では ChatGPT へ送信せず、source page に条件に応じた明確な固定 feedback を表示する。
5. extractor の本文・URL・IDを Service Worker 側で再検証し、検証に失敗した untrusted input は prompt、HTML、URL遷移、コード実行へ渡さない。
6. required / optional permission、X/Twitter host access、常駐 content script を変更せず、context menu user gesture、`activeTab`、`scripting` を再利用する。
7. 初回 exact preview、明示同意、optional ChatGPT bundle の許可確認、新規 conversation、一回だけの送信、retry なし、clipboard fallback、pending cleanup が既存仕様どおりである。
8. 自動テストと実機 smoke の対象を下表で確認し、失敗時の no-send と feedback、同意済みの即時 handoff の両方を検証する。
9. 実装と同じ変更で、本書、ADR、README、Privacy、CWS、CHANGELOG、必要な設計・テスト文書を同期する。

## 検証マトリクス

### 自動検証

| 対象 | 必須ケース | 検証方法 |
| --- | --- | --- |
| URL / ID | X・Twitter の許可 host、`www`、query/hash、非 status、別 host、非 numeric ID、追加 path | URL unit test |
| article 特定 | 一致する主投稿、返信・引用の混在、ID不一致、複数候補、selector mismatch | X DOM fixture / extractor test |
| 本文抽出 | 主本文のみ、著者・時刻・操作 UI・画像 alt の除外、改行・trim | X DOM fixture / extractor test |
| 入力境界 | 空本文、画像・動画のみ、8,000ちょうど、8,001 UTF-16 code units、untrusted text | text / prompt / extractor test |
| menu routing | page context の新項目、既存 selection context、current tab URL、user gesture route | Service Worker integration test |
| feedback | 各 no-send 条件の固定文面、本文・URLの再掲なし、feedback failure 時の no-retry | source-page feedback test |
| permission | Manifest 差分なし、optional bundle の再利用、permission 不足時 no-send / cleanup | manifest / settings / integration test |
| handoff state | preview、同意済み即時 handoff、新規 tab、一回送信、DOM failure、clipboard fallback、terminal cleanup | state / integration test |
| 静的検査 | MV3、禁止権限・恒久 X host・remote code・危険な HTML API の不使用 | lint / typecheck / build / secret scan |

### Chrome 実機 smoke

| シナリオ | 合格条件 |
| --- | --- |
| X の単体ポストで本文未選択の右クリック | 新しい menu が表示され、preview 後に一度だけ ChatGPT handoff する |
| 初回 preview の拒否、optional permission 拒否、同意撤回 | ChatGPT へ送信せず、pending が cleanup される |
| 同意済み・permission 付与済み | preview を再表示せず、既存仕様の即時 handoff を一度だけ行う |
| 返信・引用が表示された単体ポスト | URL ID に一致する主投稿本文だけが対象になる |
| 空本文、画像・動画だけ、長文本文 | 送信せず、元の X page に条件に合う feedback を表示する |
| X の DOM / selector を変更した状態または取得失敗 | 送信せず、retry せず、明確な feedback と cleanup を確認する |
| 既存の選択範囲右クリック | 従来経路が同じ prompt / preview / handoff で動く |
| action icon と任意の X ページ | action は設定導線を維持し、対象外ページから本文取得を開始しない |
| Chrome 拡張の再読込、tab close、Service Worker 再起動 | pending の expiry / terminal cleanup、二重送信なしを確認する |

## 実装時の同期条件

実装を完了扱いにする変更では、機能コードだけでなく、次の文書・検証記録を同じ変更で更新します。権限やデータフローに差分が生じた場合は、差分を明記して承認を取り直します。

- [README.md](../../README.md): 現在の機能説明、unpacked smoke 手順、計画中表示を実装済みの案内へ更新。
- [PRIVACY.md](../../PRIVACY.md): 単体ポスト本文の取得、送信、保存・削除、第三者 ChatGPT Web への開示を既存の選択文説明と整合させる。
- [CHROMEWEBSTORE.md](../../CHROMEWEBSTORE.md): listing、data use、permission justification、review notes、必要なスクリーンショットと version history を更新する。権限を追加しない場合も機能説明を更新する。
- [CHANGELOG.md](../../CHANGELOG.md): 実装版の Added / Security / Known limitations と検証結果を追記する。
- [docs/architecture/v0.1-design.md](v0.1-design.md)、[docs/architecture/chrome-api-verification.md](chrome-api-verification.md)、[CONTEXT.md](../../CONTEXT.md): 共通責務、permission matrix、設計状態・制約に差分があれば同期する。
- X selector fixture、unit / integration test、manifest test、Chrome 実機 smoke 記録: 本書の受入条件と検証マトリクスの根拠を残す。

## 公式仕様の参照

- [Chrome `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome `contextMenus`](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [Chrome `scripting`](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome `permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Manifest permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)
