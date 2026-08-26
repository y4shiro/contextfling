# プロジェクトコンテキストレビュー

> レビュー日: 2026-08-26
>
> Working Name（仮称）: ContextFling

> 現状更新: v0.1.1 実装済み。PR #13 の 2026-08-26 修正前 build の実機 smoke では foreground / background とも自動送信と clipboard fallback が失敗。原因修正を実装し、Chrome re-smoke は未完了。Chrome Web Store 未公開。

この文書は、立ち上げ時の要求と Accepted Experimental design を分類し、実装前の境界を監査可能にするための記録です。詳細な責務、state machine、permission matrix、受入条件は [v0.1 設計書](v0.1-design.md)、判断の根拠と撤回条件は [ADR 0001](../adr/0001-experimental-chatgpt-web-handoff.md) を参照します。

## 確定要求・設計

- 対象ブラウザは Google Chrome、拡張機能形式は Manifest V3 とする。
- v0.1 の Source は X 上の選択文章、Destination は ChatGPT Web の新規会話に限定する。
- 入口は右クリックの `ChatGPTで解説する` 1 項目。action click は設定画面を開き、foreground を既定値、background を設定値とする。
- 選択文章は `selectionText`、動的 URL は sanitized X/Twitter status/current URL とし、prompt の動的値は URL と選択文章だけにする。
- 固定 prompt は未信頼データの境界と、データ内の命令・コードを実行しない旨を含む。ファクトチェック要求と回答言語指定は含めない。
- X URL は選択位置に近い `article` 内の HTTPS status link を優先し、query/hash を除去する。失敗時は許可 origin の sanitized current page URL を使い、それも不正なら送信しない。
- 初回に送信内容、宛先、DOM automation と clipboard fallback のリスクを正確に preview し、明示同意後だけ有効化する。
- required permission は `activeTab`、`contextMenus`、`scripting`、`storage`。optional permission/host は `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` で、preview 後の設定ページ approve button の同期 click handler が `chrome.permissions.request()` を直接呼ぶ。promise 解決後に approve runtime message を送り、Service Worker が `chrome.permissions.contains()` で bundle 一式を最終確認する。storage 操作は Service Worker 経由とする。
- pending payload は `storage.session`、settings/consent version だけは `storage.local` に置き、履歴を残さず終端で削除する。
- ChatGPT Web の入力・自動送信は公式連携ではない Experimental adapter。selector 隔離、bounded observer/timeout、retry 禁止、offscreen clipboard fallback、ChatGPT tab banner を必須とする。
- 現行 Manifest は v0.1.1 の permission matrix を実装済みで、context menu、設定 / preview、X URL 抽出、ChatGPT adapter、clipboard fallback、pending cleanup も実装済みである。PR #13 の修正前 foreground / background smoke はともに prompt の視覚的挿入後に自動送信されず、clipboard fallback も失敗した。原因修正後の Chrome re-smoke は CWS 公開前の blocker であり、foreground-only への縮小だけでは修正前の共通 failure を解消しない。

### 最新実機 smoke の非機密証拠

- foreground / background とも `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`。固定 banner は表示され、send 操作・clipboard write の retry / 二重実行はなかった。
- foreground の visible sample は composer 候補 1、composer / container attached、send 候補 1。background の hidden sample は composer attached、container unknown、send 候補 0。いずれも send control の操作前に終端化した。
- 両経路の clipboard diagnostics は `status=clipboard-failed`、`failureCategory=write-failed`、`lifecycleCategory=none`、`cleanupFailureCategory=none`。offscreen lifecycle failure ではなく clipboard write operation rejection と切り分けられる。
- ChatGPT composer は contenteditable の ProseMirror `div` で複数の直下 `p` 要素へ正規化される。現行の `textContent` 完全一致 gate が段落改行を保持できず、複数行 prompt の書き込み確認を誤って拒否することが最有力・実質特定された。段落 plain-text 復元と単回 offscreen DOM copy の最小修正後に Chrome re-smoke を行う。prompt・selection・clipboard 内容は記録しない。

## 強い default

- Security、Privacy、Least privilege、Auditability、Simplicity、Reliability、Convenience の順を維持する。
- TypeScript、Manifest V3、Vanilla HTML/CSS、npm、esbuild、Biome を使い、runtime dependency は原則 0 とする。
- Source と Destination を分離し、ChatGPT DOM/selector 依存は adapter 内に閉じ込める。
- ページ本文、選択テキスト、URL、DOM 属性、AI 由来の値は untrusted input として扱い、無検証の HTML/コード実行/任意 URL 遷移を許可しない。
- 外部 backend、X API、OpenAI API、API key、Cookie/auth、analytics、telemetry、広告、remote config、remote code は使用しない。
- X/Twitter の恒久 host permission、`tabs`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>` は使用しない。

## 未確定・実装前に再確認する事項

- 正式名称、商標、branding、CWS 掲載文言、Privacy Policy 公開 URL、正式な公開時期。
- ChatGPT Web DOM adapter の実 selector、timeout、selection 上限、未ログイン判定、banner の実機動作。
- Chrome 116 minimum の実機挙動、offscreen lifecycle、clipboard write rejection の条件、実際の permission warning。
- X/Twitter の DOM 変更、status link が複数ある場合の距離判定、current URL fallback の実機挙動。
- ChatGPT/OpenAI の利用条件、Web Store 審査、ユーザーが送信する個人情報・機密情報への注意表示。
- v0.1 以外の Source/Destination、keyboard shortcut、複数 preset、paste-only を既定にするか。

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

- PR #13 の修正前 build の Chrome 実機では foreground / background とも prompt 挿入後に自動送信されず、clipboard fallback も `write-failed` で失敗、固定 banner、retry / 二重送信なしを確認済み。typed diagnostics により composer write gate failure と clipboard write rejection まで切り分けた。段落 plain-text 復元と単回 offscreen DOM copy を実装し、68 tests で検証済み。修正後の re-smoke、logged-out、selector 変更、clipboard success / failure、tab close、同意撤回は未完了。
- ChatGPT/OpenAI の利用条件と CWS 審査で Experimental DOM automation を扱う根拠。
- 正式なデータ分類、ユーザーの個人情報・機密情報を選択しない注意、保持 / 削除の実機検証。
- 公開者情報、Privacy Policy 公開 URL、正式名称、アクセシビリティ、スクリーンショット。

## 次の判断経路

1. composer の段落 plain-text 復元と単回 offscreen DOM copy の最小修正を synthetic test で検証する。
2. [v0.1 実装計画](v0.1-implementation-plan.md) の Step 8 として Chrome re-smoke を行い、foreground / background の書き込み確認・送信結果・clipboard success / failure を確認する。
3. re-smoke 完了までは option 5 の no-op + 明示的 feedback を安全側候補として扱い、自動送信を成功扱いに戻さない。clipboard success が確認できた場合だけ paste-only を再検討する。
4. Smoke 結果と permission、Privacy、Security、test fixture、acceptance criteria を同期し、Release Gate として正式名称、CWS listing、Privacy URL、サポート窓口を確定する。
5. 撤回条件に該当する場合は DOM automation を paste-only/no-op へ戻し、ADR を更新する。
