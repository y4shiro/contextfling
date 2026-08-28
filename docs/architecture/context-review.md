# プロジェクトコンテキストレビュー

> レビュー日: 2026-08-27
>
> Working Name（仮称）: ContextFling

> 現状更新: v0.1.1 実装済み。ADR 0003 で background 自動送信を撤回し foreground-only を Accepted。2026-08-27 の Chrome `151.0.7922.140` (arm64) / Extension `0.1.1` で Issue #6 の実機 smoke を完了し、selection/status URL、page URL fallback、foreground target、旧保存値無視、logged-out clipboard fallback、target close 後の no-retry を確認した。安全に手動再現できない DOM 変更・timeout・`send-unknown`・clipboard failure / offscreen edge は 84 tests で補完した。Chrome Web Store 未公開。

この文書は、立ち上げ時の要求と Accepted Experimental design を分類し、実装前の境界を監査可能にするための記録です。詳細な責務、state machine、permission matrix、受入条件は [v0.1 設計書](v0.1-design.md)、判断の根拠と撤回条件は [ADR 0001](../adr/0001-experimental-chatgpt-web-handoff.md) を参照します。

## 確定要求・設計

- 対象ブラウザは Google Chrome、拡張機能形式は Manifest V3 とする。
- v0.1 の Source は X 上の選択文章、Destination は ChatGPT Web の新規会話に限定する。
- 入口は右クリックの `ChatGPTで解説する` 1 項目。action click は設定画面を開き、ChatGPT target は常に foreground とする。background 設定は設けない。
- 選択文章は `selectionText`、動的 URL は sanitized X/Twitter status/current URL とし、prompt の動的値は URL と選択文章だけにする。
- 固定 prompt は未信頼データの境界と、データ内の命令・コードを実行しない旨を含む。ファクトチェック要求と回答言語指定は含めない。
- X URL は選択位置に近い `article` 内の HTTPS status link を優先し、query/hash を除去する。失敗時は許可 origin の sanitized current page URL を使い、それも不正なら送信しない。
- 初回に送信内容、宛先、DOM automation と clipboard fallback のリスクを正確に preview し、明示同意後だけ有効化する。
- required permission は `activeTab`、`contextMenus`、`scripting`、`storage`。optional permission/host は `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` で、preview 後の設定ページ approve button の同期 click handler が `chrome.permissions.request()` を直接呼ぶ。promise 解決後に approve runtime message を送り、Service Worker が `chrome.permissions.contains()` で bundle 一式を最終確認する。storage 操作は Service Worker 経由とする。
- pending payload は `storage.session`、consent version だけは `storage.local` に置き、履歴を残さず終端で削除する。旧 `openInBackground` 保存値は読み取り・使用しない。
- ChatGPT Web の入力・自動送信は公式連携ではない Experimental adapter。selector 隔離、bounded observer/timeout、retry 禁止、offscreen clipboard fallback、ChatGPT tab banner を必須とする。
- 現行 Manifest は v0.1.1 の permission matrix を実装済みで、context menu、設定 / preview、X URL 抽出、ChatGPT adapter、clipboard fallback、pending cleanup も実装済みである。PR #13 の修正前 foreground / background smoke はともに prompt の視覚的挿入後に自動送信されず、clipboard fallback も失敗した。PR #13 の修正コミット `5cf1416` の re-smoke では foreground の送信成功、background hidden の composer write gate failure、ADR 0003 採択前の background clipboard DOM copy の成功を確認した。これを根拠に background 自動送信を撤回し foreground-only とする option 2 を Accepted とした。現行の hidden 経路は clipboard を操作せず、安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化する。

### 修正前 build の実機 smoke（履歴）

- foreground / background とも `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`。固定 banner は表示され、send 操作・clipboard write の retry / 二重実行はなかった。
- foreground の visible sample は composer 候補 1、composer / container attached、send 候補 1。background の hidden sample は composer attached、container unknown、send 候補 0。いずれも send control の操作前に終端化した。
- 両経路の clipboard diagnostics は `status=clipboard-failed`、`failureCategory=write-failed`、`lifecycleCategory=none`、`cleanupFailureCategory=none`。offscreen lifecycle failure ではなく clipboard write operation rejection と切り分けられた。
- ChatGPT composer は contenteditable の ProseMirror `div` で複数の直下 `p` 要素へ正規化される。`textContent` 完全一致 gate が段落改行を保持できず、複数行 prompt の書き込み確認を誤って拒否する原因を特定し、段落 plain-text 復元と単回 offscreen DOM copy を実装した。prompt・selection・clipboard 内容は記録しない。

### PR #13 の修正コミット `5cf1416` における re-smoke

- foreground は `status=sent`、`phase=send`、`attempted=true`、`failureReason=none`、`visibilityState=visible`、composer / send 候補各 1、全 attachment `attached`。メッセージ送信成功、入力欄は空、banner なし。
- background hidden sample は `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`、composer 候補 1・composer `attached`、container / send は `unknown`・0。メッセージ未送信、入力欄に prompt が残り、banner が表示された。hidden document で React / ProseMirror state readiness を保証できないことが最有力の残存原因である。
- 同じ ADR 0003 採択前の別 background 実験では clipboard fallback が `status=copied`、`failureCategory=none`、`cleanupFailureCategory=none`、`lifecycleCategory=none`、`bannerShown=true` となり、clipboard DOM copy の実機成功を確認した。現行の hidden 経路は clipboard fallback を行わない。Console に残った visible `sent` は直前の foreground ログであり、background 成功の証拠にはしない。retry / 二重送信は発生していない。

## 強い default

- Security、Privacy、Least privilege、Auditability、Simplicity、Reliability、Convenience の順を維持する。
- TypeScript、Manifest V3、Vanilla HTML/CSS、npm、esbuild、Biome を使い、runtime dependency は原則 0 とする。
- Source と Destination を分離し、ChatGPT DOM/selector 依存は adapter 内に閉じ込める。
- ページ本文、選択テキスト、URL、DOM 属性、AI 由来の値は untrusted input として扱い、無検証の HTML/コード実行/任意 URL 遷移を許可しない。
- 外部 backend、X API、OpenAI API、API key、Cookie/auth、analytics、telemetry、広告、remote config、remote code は使用しない。
- X/Twitter の恒久 host permission、`tabs`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>` は使用しない。

## 未確定・公開前に再確認する事項

- 正式名称、商標、branding、CWS 掲載文言、Privacy Policy 公開 URL、正式な公開時期。
- foreground ChatGPT Web DOM adapter の非公開 selector、React / ProseMirror state readiness、将来の DOM 変更と timeout の継続リスク。
- Chrome 151 の代表 smoke を Chrome 116 以上の全バージョンへ一般化しないこと。permission warning と permission / consent 境界は Chrome 151 で確認済み。
- X/Twitter の将来の DOM 変更。status link と current page URL fallback は fixture と Chrome 151 の実機で確認済み。
- ChatGPT/OpenAI の利用条件、Web Store 審査、ユーザーが送信する個人情報・機密情報への注意表示。
- v0.1 以外の Source/Destination、keyboard shortcut、複数 preset、background paste-only を導入するか。

## 再検証済みの公式仕様

- `activeTab` は action、context menu、commands などの user gesture で一時的 access を与え、発動中の URL 取得と `scripting` 注入が可能。
- `scripting` は permission と、`activeTab` または host permission の組み合わせが必要。
- `contextMenus` API には `contextMenus` permission が必要。
- `storage.session` は Chrome 102+ MV3 のメモリ領域で、現行 Manifest は Chrome 116 を minimum とし `runtime.getContexts()` を offscreen lifecycle に使用する。
- offscreen は Chrome 109+、`offscreen` permission、同梱 static document が必要で、extension API は `runtime` に制限される。
- optional permission/host は manifest の optional 宣言と、user gesture 内の `chrome.permissions.request()` が必要。
- `clipboardWrite` は Clipboard API で clipboard を変更する permission。現行実装では preview 後の同意で要求する optional permission とする。

根拠と URL は [chrome-api-verification.md](chrome-api-verification.md) に集約しています。

## 潜在矛盾と解消

| 矛盾 | 解消 |
| --- | --- |
| 旧方針の「ChatGPT DOM automation 禁止」と v0.1 設計 | 原則禁止は維持し、ADR 0001 の限定された Experimental scope だけを例外として Accepted。scope 外は禁止、撤回条件あり。 |
| 旧レビュー時の空の permission baseline と v0.1 permission matrix | v0.1.0 実装で matrix を Manifest、permission test、CWS、Privacy へ反映済み。今後の permission 追加は同じ文書同期とレビューを要求する。 |
| `storage.session` は pending を置くが「履歴を残さない」 | session は送信中の一時 payload のみ。成功・拒否・失敗・timeout・tab close・expiry で削除し、local/sync に本文・URL・prompt を置かない。 |
| ChatGPT に送る利便性と第三者サービスへのデータ送信 | preview で宛先と送信内容を明示し、同意後だけ送信。Cookie/auth/backend/telemetry は使わず、利用条件と Privacy を公開前に再確認する。 |
| optional host pattern と origin access | `https://chatgpt.com/*` は提出文言と実装の両方で path pattern の意味を説明する。permission warning は許可履歴のない実機環境で確認する。撤回後の再要求は Chrome 仕様により prompt なしで再付与される場合があるため、拡張機能独自の exact preview と明示同意を再要求する。 |

## 不足論点

- PR #13 の修正前 build で判明した composer write gate failure と clipboard write rejection は、段落 plain-text 復元と単回 offscreen DOM copy で修正し、foreground-only を Accepted とした。Issue #3 / #4 と [Issue #6 の Chrome smoke](../testing/chrome-116-smoke.md) で foreground、visibility race、permission / consent、logged-out、旧 `openInBackground` 保存値無視、target close を確認した。DOM 変更・timeout・`send-unknown`・clipboard failure / offscreen edge は安全な手動再現を避け、84 tests で補完した。追加 Security / Privacy review は未完了。
- ChatGPT/OpenAI の利用条件と CWS 審査で Experimental DOM automation を扱う根拠。
- 正式なデータ分類、ユーザーの個人情報・機密情報を選択しない注意、保持 / 削除の実機検証。
- 公開者情報、Privacy Policy 公開 URL、正式名称、アクセシビリティ、スクリーンショット。

## 継続判断経路

1. composer の段落 plain-text 復元、単回 offscreen DOM copy、84 tests を検証済み baseline として維持する。
2. [v0.1 実装計画](v0.1-implementation-plan.md) の Step 8、Issue #3 / #4、Issue #6 の smoke 結果を回帰確認の baseline として維持する。
3. Accepted の ADR 0003 に従い、foreground target、旧 `openInBackground` 保存値無視、hidden 時 fail-closed を維持する。permission、外部通信、データ境界は変更しない。
4. Issue #6 の smoke 結果と permission、Privacy、Security、test fixture、acceptance criteria の整合を維持し、残る Release Gate として Security / Privacy review、正式名称、CWS listing、Privacy URL、サポート窓口を確定する。
5. background paste-only は将来 Issue 候補として別管理する。安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化し、追加 retry / clipboard 操作を行わない。
