# ADR 0002: X 単体ポストのページ右クリック実行

- Status: Accepted（実装前）
- Scope: 追加機能の仕様選定
- Date: 2026-08-24
- Nature: Experimental / reversible
- Tracking: [GitHub Issue #12](https://github.com/y4shiro/contextfling/issues/12)

> この ADR の Accepted は、実装する方式と境界を合意したことを示す。実装完了、自動検証、Chrome 実機確認、Chrome Web Store の承認・公開を意味しない。詳細な実装前仕様は [単体ポスト右クリック実行 設計書](../architecture/single-post-context-menu.md) に記録する。

## Context

現在は X / Twitter のポスト本文を選択してから context menu を実行する。本文を選択しなくても、単体ポストページを開いていることを起点に同じ ChatGPT Web handoff を使えるようにする。ただし、X / Twitter の恒久 host permission や常駐 content script は現行の最小権限・Experimental scope と衝突し、action icon は現在の設定導線と競合する。

## Options

| 方式 | 概要 | 主な利点 | 主な影響 / リスク |
| --- | --- | --- | --- |
| Page context menu | 単体ポスト URL の通常ページ右クリックから起動し、`activeTab` と一時 `scripting` で status ID に一致する `article` の主本文を抽出する | 既存の明示 user gesture、`contextMenus`、`activeTab`、`scripting`、preview / handoff を再利用できる。新規 permission、X host permission、常駐処理が不要 | X の DOM / selector 変更に影響される。単体 status URL 以外、本文なし、引用・返信の混在は明確に拒否する必要がある |
| Action icon | 拡張機能の action icon クリックで現在 tab の単体ポスト本文を取得する | action click も user gesture で、ツールバーから起動できる | 現行 action は設定画面を開くため導線が競合する。設定を開く動作を変えるか、モード分岐を追加する必要があり、今回の範囲を広げる |
| X 内常設 button | X の各ポストへ拡張機能のボタンを挿入し、ボタンから起動する | ポストごとの操作対象が見えやすい | 常駐 content script または恒久 X host access、SPA 再描画・重複挿入・引用/返信誤挿入への対応が必要。権限、Privacy、保守・破壊リスクが増える |

## Decision

Page context menu 方式を採用する。

- menu label は `このポストをChatGPTで解説する` とし、既存の選択範囲用 menu は維持する。
- 対象は `/<user>/status/<numeric-id>` の X / Twitter 単体ポスト URL に限定する。current URL の status ID と一致する `article` だけを選び、主投稿本文以外（返信、引用、著者名、時刻、操作 UI、画像 alt）は取得しない。
- 空本文、非 status URL、selector mismatch / DOM 変更、8,000 UTF-16 code units 超は送信せず、source page に固定の明確な feedback を表示する。
- current URL、DOM、抽出本文は untrusted input として Service Worker 側で URL / ID / text を再検証する。検証済みの本文だけを既存の prompt / exact preview / consent / handoff 経路へ渡す。
- required permission は `activeTab`、`contextMenus`、`scripting`、`storage` の現行値を再利用し、X / Twitter の恒久 host permission、常駐 content script、新規 permission は追加しない。
- 同意済みなら既存の即時 handoff、未同意なら初回 exact preview と明示同意、optional ChatGPT permission bundle、new conversation、一回送信、retry なし、clipboard fallback、pending cleanup を維持する。

Action icon の即時実行と X 内常設 button は今回の MVP scope 外とする。将来再検討する場合は、現行設定導線、権限境界、selector 維持コスト、Privacy / CWS 開示を別途評価する。

## Consequences

### Benefits

- 本文選択を要求せず、単体ポストページの明示的な右クリックから起動できる。
- 既存の permission と user gesture を再利用し、X / Twitter への常時 access を増やさずに提供できる。
- selection と single-post の両方を共通の preview、同意、new conversation、fallback、cleanup へ接続できる。

### Costs and risks

- X の非公開・非保証 DOM に依存するため、selector mismatch や表示変更時の no-send と feedback を維持する必要がある。
- 返信・引用・主投稿の識別を誤ると意図しない本文を送るため、status ID 一致と本文 selector の検証を省略できない。
- action icon と X 内常設 button を使えず、対象 URL と本文テキストが存在するケースに限定される。
- user-facing feature が増えるため、実装時に README、Privacy、CWS listing / data use、CHANGELOG、fixture / smoke 記録を同期する必要がある。

## Rollback

次のいずれかが確認された場合は、single-post の page context menu route と X 本文 extractor を無効化または削除し、既存の selection menu と設定 action を残します。

- status ID 一致や主本文の境界を安全に判定できない。
- DOM 変更時に誤った post、引用、返信、アカウントへ送信する可能性を抑えられない。
- source page feedback、preview、明示同意、no-retry、pending cleanup を保証できない。
- X / Twitter の恒久 host permission、常駐処理、外部通信が必要になる。

この機能は新しい永続履歴を作らないため、rollback にデータ移行は不要です。実装後に single-post 用の pending payload 識別子を追加していた場合は、更新時にその payload を terminal cleanup し、自動 retry はしません。rollback の実施時は本 ADR の Status、設計書、README、Privacy、CWS、CHANGELOG、テスト記録を同じ変更で更新します。

## Verification references

- [Chrome `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome `contextMenus`](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [Chrome `scripting`](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome `permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions)
