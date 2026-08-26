# プロジェクトコンテキストレビュー

> レビュー日: 2026-08-26
>
> Working Name（仮称）: ContextFling

> 現状更新: v0.1.1 実装済み。PR #13 の修正前 build では foreground / background とも自動送信と clipboard fallback が失敗した。HEAD `5cf1416` の re-smoke では foreground の送信成功、background hidden の fail-closed、clipboard DOM copy の成功を確認した。ADR 0003 で background 自動送信の撤回と foreground-only を Accepted。Chrome Web Store 未公開。

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
- 現行 Manifest は v0.1.1 の permission matrix を実装済みで、context menu、設定 / preview、X URL 抽出、ChatGPT adapter、clipboard fallback、pending cleanup も実装済みである。PR #13 の修正前 foreground / background smoke はともに prompt の視覚的挿入後に自動送信されず、clipboard fallback も失敗した。HEAD `5cf1416` の re-smoke では foreground の送信成功、background hidden の composer write gate failure、background clipboard DOM copy の成功を確認した。これを根拠に background 自動送信を撤回し foreground-only とする option 2 を Accepted とした。安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化する。

### 修正前 build の実機 smoke（履歴）

- foreground / background とも `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`。固定 banner は表示され、send 操作・clipboard write の retry / 二重実行はなかった。
- foreground の visible sample は composer 候補 1、composer / container attached、send 候補 1。background の hidden sample は composer attached、container unknown、send 候補 0。いずれも send control の操作前に終端化した。
- 両経路の clipboard diagnostics は `status=clipboard-failed`、`failureCategory=write-failed`、`lifecycleCategory=none`、`cleanupFailureCategory=none`。offscreen lifecycle failure ではなく clipboard write operation rejection と切り分けられた。
- ChatGPT composer は contenteditable の ProseMirror `div` で複数の直下 `p` 要素へ正規化される。`textContent` 完全一致 gate が段落改行を保持できず、複数行 prompt の書き込み確認を誤って拒否する原因を特定し、段落 plain-text 復元と単回 offscreen DOM copy を実装した。prompt・selection・clipboard 内容は記録しない。

### HEAD `5cf1416` の修正後 re-smoke

- foreground は `status=sent`、`phase=send`、`attempted=true`、`failureReason=none`、`visibilityState=visible`、composer / send 候補各 1、全 attachment `attached`。メッセージ送信成功、入力欄は空、banner なし。
- background hidden sample は `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`、composer 候補 1・composer `attached`、container / send は `unknown`・0。メッセージ未送信、入力欄に prompt が残り、banner が表示された。hidden document で React / ProseMirror state readiness を保証できないことが最有力の残存原因である。
- background の clipboard fallback は `status=copied`、`failureCategory=none`、`cleanupFailureCategory=none`、`lifecycleCategory=none`、`bannerShown=true`。clipboard DOM copy の実機成功を確認した。Console に残った visible `sent` は直前の foreground ログであり、background 成功の証拠にはしない。retry / 二重送信は発生していない。

## 強い default

- Security、Privacy、Least privilege、Auditability、Simplicity、Reliability、Convenience の順を維持する。
- TypeScript、Manifest V3、Vanilla HTML/CSS、npm、esbuild、Biome を使い、runtime dependency は原則 0 とする。
- Source と Destination を分離し、ChatGPT DOM/selector 依存は adapter 内に閉じ込める。
- ページ本文、選択テキスト、URL、DOM 属性、AI 由来の値は untrusted input として扱い、無検証の HTML/コード実行/任意 URL 遷移を許可しない。
- 外部 backend、X API、OpenAI API、API key、Cookie/auth、analytics、telemetry、広告、remote config、remote code は使用しない。
- X/Twitter の恒久 host permission、`tabs`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>` は使用しない。

## 未確定・実装前に再確認する事項

- 正式名称、商標、branding、CWS 掲載文言、Privacy Policy 公開 URL、正式な公開時期。
- foreground ChatGPT Web DOM adapter の実 selector、timeout、selection 上限、未ログイン判定、banner の実機動作。
- Chrome 116 minimum の実機挙動、hidden document の React / ProseMirror state readiness、logged-out、DOM 変更、実際の permission warning。
- X/Twitter の DOM 変更、status link が複数ある場合の距離判定、current URL fallback の実機挙動。
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
| optional host pattern と origin access | `https://chatgpt.com/*` は提出文言と実装の両方で path pattern の意味を説明し、実機で permission prompt を確認する。 |

## 不足論点

- PR #13 の修正前 build では foreground / background とも prompt 挿入後に自動送信されず、clipboard fallback も `write-failed` で失敗した。段落 plain-text 復元と単回 offscreen DOM copy を実装し、72 tests で検証済み。HEAD `5cf1416` の re-smoke では foreground の送信成功、background hidden の composer write gate failure、clipboard DOM copy の成功を確認した。background hidden の React / ProseMirror readiness は保証できないため、option 2 の foreground-only を Accepted とし、option 3 の background paste-only は将来 Issue 候補とする。安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化する。logged-out、selector 変更、tab close、同意撤回、旧 `openInBackground` 保存値無視、追加 Security / Privacy review は未完了。
- ChatGPT/OpenAI の利用条件と CWS 審査で Experimental DOM automation を扱う根拠。
- 正式なデータ分類、ユーザーの個人情報・機密情報を選択しない注意、保持 / 削除の実機検証。
- 公開者情報、Privacy Policy 公開 URL、正式名称、アクセシビリティ、スクリーンショット。

## 次の判断経路

1. composer の段落 plain-text 復元と単回 offscreen DOM copy の最小修正、および 72 tests の結果を維持する。
2. [v0.1 実装計画](v0.1-implementation-plan.md) の Step 8 として実施した re-smoke の結果を、foreground success / background hidden fail-closed / clipboard copied として記録する。
3. Accepted とした ADR 0003 に従い、`openInBackground` 設定 UI / 保存を削除し、旧保存値を無視して target を foreground に固定する。permission、外部通信、データ境界は変更しない。
4. Smoke 結果と permission、Privacy、Security、test fixture、acceptance criteria を同期し、Release Gate として foreground-only の前面表示、logged-out、DOM 変更、tab close、同意撤回、正式名称、CWS listing、Privacy URL、サポート窓口を確定する。
5. background paste-only は将来 Issue 候補として別管理する。安全に実行できない状態は option 5 の no-op + 明示的 feedback へ終端化し、追加 retry / clipboard 操作を行わない。
