# ADR 0004: contenteditable composer への単回ブラウザー編集

- Status: Draft
- Date: 2026-10-29
- Scope: Issue #24 / PR #25、foreground の新規 ChatGPT 会話
- Nature: Experimental / reversible、限定した実機成功は確認済み。公式連携・公開承認は未確認

## Context

Chrome `156.0.8078.48`、source `a69b9e1` の独立した単回 smoke で、Human が Service Worker の `failureReason=composer-presend-text-mismatch` を確認しました。これは入力直後には送信予定の全文と一致し、送信直前には一致しなかったことを示します。ツールによる本文領域の観察は user message 0件、composer 非空、clipboard-copied banner、新規 target 一つでした。追加の入力・送信・再実行は行っていません。

従来の contenteditable 経路は synthetic focus event、`textContent` 代入、synthetic input/change event を使っています。focus event の dispatch は実際のフォーカス操作とは異なり、DOM の直接変更が editor 内部の編集状態へ反映される保証もありません。editor による内容の復元が有力な説明ですが、私的なページ内部 state は取得せず、内部原因の確定とは扱いません。ADR 0003 の `textContent` 維持と過去の成功は、その時点の経緯として残します。

## 修正候補

contenteditable の書き込みを、実際の `focus()` と composer 内に閉じた Range/Selection、固定コマンド `document.execCommand("insertText", false, prompt)` の最大一回の呼び出しに置き換えます。prompt は plain text の引数で、HTML として解釈するコマンドは使いません。textarea/input の既存 value setter 経路は変更しません。

- 書き込み前の composer が既知の構造で空であることを確認し、既存の入力を置換しません。
- focus/selection 操作で画面が変わる場合も、現在の可視性、一意性、attachment、active element と selection の範囲を確認し、対象外へ入力しません。
- API 不在、false、例外、不正な対象、全文不一致では送信せず、既存 fallback と terminal cleanup へ進みます。
- 直接 DOM 書き込みを二つ目の入力方法として併用せず、編集コマンドも送信 click も再試行しません。
- 直後と送信直前の厳密な全文一致、既知の段落と generated autolink の読み戻し、form 所属、一意で enabled な送信 control、可視性の gate は維持します。

### 編集後の整形を待つ候補

単回ブラウザー編集 build `02701d7` でも、Human が `composer-input-structure-unsupported` を確認しました。その後の同じ composer は、操作を追加せずに観察した時点で既存の厳密な構造条件に一致しました。編集直後の正規化タイミングが一つの原因候補です。

書き込みは一回のまま、contenteditable だけで入力後の厳密な全文一致を最大 `min(timeoutMs, 1,000ms)` 観察します。一致すれば進み、期限まで不一致／未知構造なら既存診断と fallback へ終端します。観察中の hidden、対象の detach／置換、一意性喪失では停止し、observer・visibility listener・timer を終端時に解除します。送信直前の全文一致と可視性・一意性・form 所属の確認も残します。待機中の再入力や追加 click は行いません。

## 公式サポートと検証条件

`execCommand()` は deprecated / non-standard です。MDN は、現在 active な editable element と selection に作用し、input/beforeinput の発火がブラウザーに依存すると説明しています。W3C の編集コマンド文書も Draft で、実装の不一致を明記しています。これは ChatGPT の公式 API や、editor 内部の状態同期を保証する手段ではありません。

非機密のローカル fixture を隔離した Chromium context で開き、実際の focus と一回の insertText により trusted input event が発生することを確認しました。複数行は p と空の p/br に分かれました。ChatGPT 側の整形を保証する結果ではなく、未知構造を通すために読み戻しを広げる根拠にもしません。JSDOM の編集コマンド mock は呼び出し数・境界・失敗時の停止だけを検証します。

候補の採否には、親の直接レビュー、自動検証、現行 ChatGPT Web の前面の新規会話への非機密・独立単回 smoke が必要です。完了条件は user message 1件、composer 空、追加 target／retry／二重送信なしです。送信結果不明なら再実行しません。成功しても本 ADR を自動で Accepted にせず、公開済み ZIP や CWS の状態は変更しません。

### 実機確認（2026-10-29）

source `7e37e6a6fd14c3709634e0f3ec205e0252459415`、Chrome `156.0.8078.48`、version `0.1.1` の独立した単回 smoke は PASS でした。Human が自動送信を確認し、親のツールも今回の新規 target 一つ、可視 user message bubble 一つ、composer 空、banner なしを確認しました。5秒以上経過後も追加 target／二重送信は観察されず、追加の入力・送信・再実行は行っていません。本文・会話URLは取得していません。

102 tests と静的検証、build、secret scan、CI も PASS です。これは限定した一環境の成功であり、非標準 API や将来の DOM 変更のリスクは残ります。本 ADR は Draft のまま、最終採否と Merge／Release Gate は Human maintainer に残します。

## Alternatives

- `textContent` と synthetic events を維持する: 最小ですが、今回の入力保持失敗を説明・解消できていません。
- 読み戻しを緩める、待機後に再入力する: 誤送信と二重入力の危険があり採りません。
- 私的な editor API/React state へアクセスする: 非公開内部依存と取得範囲を広げるため採りません。
- clipboard fallback を続ける: 安全な既存の終端経路です。候補でも自動入力が成立しなければ復旧済みと扱いません。

## Security / Privacy / Maintenance Impact

新規 permission、host、外部通信、runtime dependency、remote code、clipboard 読み取り、認証情報や既存会話の取得は追加しません。exact preview、明示同意、foreground-only、新規会話限定と既存のデータ保持期間は変わりません。診断には固定 enum と既存の非機密項目だけを使います。

選択範囲に作用する API のため、focus/selection の対象確認が新たな保守点です。非標準 API と editor の複数行整形に依存し、ブラウザーやサイト更新で失敗し得ます。false/throw/不一致では安全に停止し、依存を Destination adapter 内へ閉じ込めます。

## References（2026-10-29 確認）

- [MDN: Document.execCommand](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)
- [W3C editing commands Draft](https://w3c.github.io/editing/docs/execCommand/)
- [Issue #24](https://github.com/y4shiro/contextfling/issues/24) / [PR #25](https://github.com/y4shiro/contextfling/pull/25)
- [ADR 0003](0003-background-chatgpt-handoff-withdrawal.md)
