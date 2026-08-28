# Chrome API 公式仕様確認

> 確認日: 2026-08-24 / 2026-08-27
>
> Working Name（仮称）: ContextFling
>
> 現状: `src/manifest.json` は v0.1.1 の permission matrix を実装済み。2026-08-27 の Chrome 151 で permission / consent と Issue #6 の X→ChatGPT smoke を完了。CWS 公開は未完了。

## 参照した Chrome 公式ページ

- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [chrome.contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Permissions list (`clipboardWrite`)](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Manifest file format (`minimum_chrome_version`, host permissions)](https://developer.chrome.com/docs/extensions/reference/manifest)

## 確認結果

### `activeTab`

Chrome 公式では、`activeTab` は action、context menu item、commands の keyboard shortcut、omnibox suggestion などの明示的な user gesture で現在 tab に一時的な host access を与える。発動中は対象 tab の URL、title、favicon を取得でき、`scripting` と併用すれば script/style injection が可能である。ページ遷移または tab close で access は失効する。

v0.1 は X 上の context menu を起点にするため、X/Twitter の恒久 host permission を設けず `activeTab` を使う設計とする。発動条件、restricted page、実際の tab 情報は unpacked smoke で確認する。

### `scripting`

`chrome.scripting` には `scripting` permission と、対象ページの host access が必要である。host access は `activeTab` の一時 grant または host permission で満たせる。v0.1 では X extractor を activeTab の範囲で、ChatGPT adapter/banner を同意済み optional host の範囲で実行する。remote script、runtime import、任意 URL への注入は行わない。

### `contextMenus`

`chrome.contextMenus` の create/update には `contextMenus` permission が必要である。v0.1.0 では `selection` context に `ChatGPTで解説する` 1 項目だけを登録し、menu invocation が `activeTab` の user gesture になることを利用する。現行 Manifest に実装済みである。

### `storage` / `storage.session`

`chrome.storage` を使うには `storage` permission が必要である。`storage.session` は Chrome 102+ MV3 の in-memory storage で、ディスクへ永続化されず、extension が disable/reload/update されたときや browser restart でクリアされる。v0.1 は pending payload だけを session に置き、settings と consent version だけを local に置く。selection、URL、prompt の履歴は保存しない。

### `offscreen`

Offscreen API は Chrome 109+ MV3 で、`offscreen` permission と同梱 static HTML document が必要である。offscreen document で利用できる extension API は `chrome.runtime` に制限されるため、clipboard 処理は offscreen 側、permission/state/結果の調整は Service Worker 側で messaging する。インストール済み extension では通常 profile ごとに一つの offscreen document しか開けない。

`runtime.getContexts()` は Chrome 116+ で offscreen document の存在確認に使える。older Chrome には `clients.matchAll()` fallback が公式ページに記載されている。v0.1.0 の `minimum_chrome_version` は `116` であり、実機 lifecycle と permission prompt は smoke test で検証する。

### Optional permissions / host permissions

`chrome.permissions.request()` は manifest の `optional_permissions` または `optional_host_permissions` に宣言した権限を、user gesture 内で runtime request する API である。v0.1 は初回 preview を表示し、設定ページの approve button の同期 click handler から optional `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` を直接要求する。request の前に await や別の非同期処理を入れず、promise 解決後に approve runtime message を送る。Service Worker は message 後に `chrome.permissions.contains()` で bundle 一式を最終確認し、拒否・不足なら送信せず pending を削除する。storage 操作は Service Worker 経由とする。

2026-08-27 に Chrome 公式 `permissions` API を再確認した。`remove()` は削除成否の boolean を返し、問題があれば promise を reject する。v0.1 は同意撤回時に bundle の `remove()` を呼んだ後、optional host、`offscreen`、`clipboardWrite` を個別の `contains()` で再確認する。残存または確認例外は撤回成功扱いにせず、consent version と pending を削除したうえでユーザーに Chrome の拡張機能設定確認を案内する。

同じ公式ページは、permission warning がユーザーの未承認内容を増やす場合に prompt を表示し、permission を削除した後の `permissions.request()` は通常 prompt なしで permission を再追加すると明記している。2026-08-27 の実機 smoke でも、撤回後に拡張機能独自の exact preview は再表示された一方、approve 後の Chrome prompt は表示されず bundle が再付与された。したがって、同意撤回後の安全境界は「Chrome prompt の再表示」ではなく、「新しい exact preview と明示同意」「Service Worker の bundle 再確認」とする。permission 拒否の実機 smoke は optional bundle の許可履歴がない Chrome profile または別 extension ID で行う。

Chrome の permission request では origin の path は無視されるため、`https://chatgpt.com/*` は CWS と UI で ChatGPT origin に限定した host access として説明する。permission warning の実機確認は許可履歴のない環境で行う。X/Twitter の恒久 host permission は宣言しない。

### `clipboardWrite`

公式 permissions list では `clipboardWrite` は Web Platform Clipboard API による cut/copy を許可し、ユーザーへの warning は clipboard を変更する旨である。v0.1 では DOM handoff が失敗したときだけ、同意済み permission で固定 prompt を一度だけ clipboard へ書く。clipboardRead は要求しない。書き込みに失敗した場合は ChatGPT tab の小さな banner で失敗を明示し、pending payload を削除する。

### `tabs`、`notifications`、`alarms`

v0.1 は `tabs` permission、X/Twitter の恒久 host permission、`notifications`、`alarms` を使わない。`tabs.create`、context menu callback の tab 情報、activeTab の一時 access、bounded operation timeout、tab close listener、`expiresAt` の検査で設計する。実装で追加の tab metadata が必要になった場合は、先に permission matrix と ADR を更新する。

### action / settings

Action API は Manifest の `action` key を必要とするが、action 自体は permission ではない。v0.1 の action click は即時 handoff や Popup ではなく、拡張機能内の設定・同意画面を開く。初回 preview と permission request はその画面の明示ボタンから行う。approve button の同期 click handler が permission request を直接呼び、要求後に runtime message を送る。Service Worker は permission の最終確認と storage を担う。

## v0.1 permission matrix（現行 Manifest）

```text
Required:
  activeTab + contextMenus + scripting + storage

Optional requested only after consent:
  optional_host_permissions: https://chatgpt.com/*
  optional_permissions: offscreen, clipboardWrite

Not used:
  tabs, X/Twitter host_permissions, notifications, alarms, clipboardRead,
  cookies, history, webRequest, identity, <all_urls>
```

## Skill との相違点

project-local の `chrome-extensions` Skill は `tab.url` に `tabs` permission が必要と記載する。一方、Chrome 公式の `activeTab` ページは、一時 host access 中に URL/title/favicon を取得できると明記する。この点は公式仕様を優先し、`tabs` を追加して解決しない。

なお、`activeTab` は X の current tab には適するが、後から開いた ChatGPT tab の DOM access を与えない。そのため ChatGPT Web には、preview/明示同意後の optional host permission が別に必要である。Popup/side panel の後続操作、restricted page、Chrome version 差異は実装時の smoke test で再確認する。

## 設計への適用

この確認結果を反映した設計は [v0.1 design](v0.1-design.md)、判断と撤回条件は [ADR 0001](../adr/0001-experimental-chatgpt-web-handoff.md)、実装順序と検証状況は [v0.1 implementation plan](v0.1-implementation-plan.md) にある。現行コードには permission、settings、X extractor、ChatGPT DOM adapter、clipboard fallback が実装済みである。Chrome 151 の permission / consent と Issue #6 の実機 smoke は完了済みで、Security / Privacy review、正式名称・掲載素材・Privacy Policy 公開 URL、CWS 公開は残存 gate である。
