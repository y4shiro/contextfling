# プロジェクトコンテキストレビュー

> レビュー日: 2026-08-24
>
> Working Name（仮称）: ContextFling

この文書は、立ち上げ時の要求と Accepted Experimental design を分類し、実装前の境界を監査可能にするための記録です。詳細な責務、state machine、permission matrix、受入条件は [v0.1 設計書](v0.1-design.md)、判断の根拠と撤回条件は [ADR 0001](../adr/0001-experimental-chatgpt-web-handoff.md) を参照します。

## 確定要求・設計

- 対象ブラウザは Google Chrome、拡張機能形式は Manifest V3 とする。
- v0.1 の Source は X 上の選択文章、Destination は ChatGPT Web の新規会話に限定する。
- 入口は右クリックの `ChatGPTで解説する` 1 項目。action click は設定画面を開き、foreground を既定値、background を設定値とする。
- 選択文章は `selectionText`、動的 URL は sanitized X/Twitter status/current URL とし、prompt の動的値は URL と選択文章だけにする。
- 固定 prompt は未信頼データの境界と、データ内の命令・コードを実行しない旨を含む。ファクトチェック要求と回答言語指定は含めない。
- X URL は選択位置に近い `article` 内の HTTPS status link を優先し、query/hash を除去する。失敗時は許可 origin の sanitized current page URL を使い、それも不正なら送信しない。
- 初回に送信内容、宛先、DOM automation と clipboard fallback のリスクを正確に preview し、明示同意後だけ有効化する。
- required permission candidate は `activeTab`、`contextMenus`、`scripting`、`storage`。optional candidate は `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` で、同意ボタンの直接 gesture から要求する。
- pending payload は `storage.session`、settings/consent version だけは `storage.local` に置き、履歴を残さず終端で削除する。
- ChatGPT Web の入力・自動送信は公式連携ではない Experimental adapter。selector 隔離、bounded observer/timeout、retry 禁止、offscreen clipboard fallback、ChatGPT tab banner を必須とする。
- 現行スキャフォールドの Manifest は空であり、本体機能・権限・データ処理は未実装である。

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
- Chrome 116 minimum candidate の採用、offscreen lifecycle の older Chrome fallback、実際の permission warning。
- X/Twitter の DOM 変更、status link が複数ある場合の距離判定、current URL fallback の実機挙動。
- ChatGPT/OpenAI の利用条件、Web Store 審査、ユーザーが送信する個人情報・機密情報への注意表示。
- v0.1 以外の Source/Destination、keyboard shortcut、複数 preset、paste-only を既定にするか。

## 再検証済みの公式仕様

- `activeTab` は action、context menu、commands などの user gesture で一時的 access を与え、発動中の URL 取得と `scripting` 注入が可能。
- `scripting` は permission と、`activeTab` または host permission の組み合わせが必要。
- `contextMenus` API には `contextMenus` permission が必要。
- `storage.session` は Chrome 102+ MV3 のメモリ領域で、Chrome 116 は `runtime.getContexts()` を使った offscreen lifecycle の候補である。
- offscreen は Chrome 109+、`offscreen` permission、同梱 static document が必要で、extension API は `runtime` に制限される。
- optional permission/host は manifest の optional 宣言と、user gesture 内の `chrome.permissions.request()` が必要。
- `clipboardWrite` は Clipboard API で clipboard を変更する permission。初回同意の optional candidate とする。

根拠と URL は [chrome-api-verification.md](chrome-api-verification.md) に集約しています。

## 潜在矛盾と解消

| 矛盾 | 解消 |
| --- | --- |
| 旧方針の「ChatGPT DOM automation 禁止」と v0.1 設計 | 原則禁止は維持し、ADR 0001 の限定された Experimental scope だけを例外として Accepted。scope 外は禁止、撤回条件あり。 |
| 現行 Manifest の permission baseline 空と v0.1 permission matrix | 設計を先に Accepted としただけで、現行コードへ追加していない。実装 PR、permission test、CWS/Privacy 更新を同時に要求する。 |
| `storage.session` は pending を置くが「履歴を残さない」 | session は送信中の一時 payload のみ。成功・拒否・失敗・timeout・tab close・expiry で削除し、local/sync に本文・URL・prompt を置かない。 |
| ChatGPT に送る利便性と第三者サービスへのデータ送信 | preview で宛先と送信内容を明示し、同意後だけ送信。Cookie/auth/backend/telemetry は使わず、利用条件と Privacy を公開前に再確認する。 |
| optional host pattern と origin access | `https://chatgpt.com/*` は提出文言と実装の両方で path pattern の意味を説明し、実機で permission prompt を確認する。 |

## 不足論点

- 正式なデータ分類、ユーザーの個人情報・機密情報を選択した場合の注意文、保持/削除の検証。
- ChatGPT/OpenAI の利用条件、CWS 審査で Experimental DOM automation を扱う根拠。
- selector fixture と実機回帰、送信結果不明時の安全な判断、clipboard 失敗時のユーザー導線。
- action 設定画面の UI、同意 version の更新・撤回、permission deny 後の再操作。
- Chrome 116 以外での offscreen lifecycle、アクセシビリティ、公開者情報、スクリーンショット。

## 次の判断経路

1. [v0.1 実装計画](v0.1-implementation-plan.md) の小ステップごとに設計 review を行う。
2. Step ごとに permission、Privacy、Security、test fixture、acceptance criteria を同期する。
3. DOM fixture/unit、Service Worker state、permission denial、clipboard failure、manual unpacked smoke を実施する。
4. 撤回条件に該当する場合は DOM automation を paste-only/no-op へ戻し、ADR を更新する。
