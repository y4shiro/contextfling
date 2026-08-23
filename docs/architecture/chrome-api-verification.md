# Chrome API 公式仕様確認

> 確認日: 2026-08-24
>
> Working Name（仮称）: ContextFling

## 参照した Chrome 公式ページ

- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [chrome.contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 確認結果

### `activeTab`

`activeTab` は、拡張機能 action のクリック、context menu 項目の選択、commands の keyboard shortcut など、ユーザーが明示的に開始する操作を契機に、現在の tab に一時的な host access を与える候補です。ページを常時監視する権限ではありません。

Chrome 公式の `activeTab` 説明では、この一時的な access により、対象ページへの script/style injection と、機微な tab 情報へのアクセスが可能になるとされています。本プロジェクトでは、この公式説明を根拠に、発動中は `tab.url` を取得できるものとして扱います。ただし、具体的な API 呼び出しと後続 UI の経路は実装時に再検証します。

### `scripting`

`chrome.scripting` を使ってページへ script を注入するには `scripting` permission が必要です。対象ページへの access は、`activeTab` の一時許可または適切な `host_permissions` と組み合わせます。現行スキャフォールドには script 注入処理がないため、permission は追加していません。

### `contextMenus`

Context menu を作成・管理するには `contextMenus` permission が必要です。context menu のユーザー選択は `activeTab` の発動契機になり得ますが、メニューを実際に追加する設計と対象 context は未確定です。

### `commands`

Keyboard shortcut は Manifest の `commands` キーで宣言します。候補のショートカットは未確定で、現行 Manifest には `commands` を入れていません。commands によるユーザー操作も `activeTab` の発動契機として扱えるため、実装時は公式仕様と実機で再確認します。

### `tabs`

現行スキャフォールドは tab 情報を読んでいないため `tabs` permission は不要です。`activeTab` 発動中の `tab.url` と、Popup/side panel など後続の UI から取得する tab 情報は同じ条件とは限らないため、後続操作を設計する時点で `tabs` と host permissions の必要性を再評価します。

### `storage`

現行コードは `chrome.storage` を使っていないため `storage` permission は不要です。設定、presets、handoff 履歴などを保存する機能を追加する場合に限り、保存先、データ分類、削除、CWS 開示と併せて検討します。

### `host_permissions`

常時または特定 origin に対する access が必要な場合の候補ですが、初期方針はユーザー操作と `activeTab` で代替することです。`<all_urls>` は使用しません。特定 host が必要になった場合も、対象を限定し、公式仕様・CWS 審査影響・Privacy Impact を記録します。

## 現時点の最小候補

本体機能を設計する時の Proposed な最小候補は、次の 3 つです。

```text
activeTab + scripting + contextMenus
```

これは確定 Manifest ではありません。action、commands、Popup、side panel の最終操作経路、対象ページの取得方法が決まった後に、必要性を permission 単位で確認します。`tabs`、`storage`、`host_permissions` は現時点では不要候補です。

## Skill との相違点

project-local の `chrome-extensions` Skill は `tab.url` の取得に `tabs` permission が必要と記載しています。一方、上記の Chrome 公式 `activeTab` 説明は、ユーザー操作による一時的な access で機微な tab 情報へアクセスできるとしています。この点は公式を優先します。

ただし、access の発動契機、Popup/side panel 内の後続ボタン、対象 tab の種類、Chrome バージョンによる差異は実装時に再確認します。`tabs` を追加して解決するのではなく、先に最小の再現テストと公式仕様を確認します。
