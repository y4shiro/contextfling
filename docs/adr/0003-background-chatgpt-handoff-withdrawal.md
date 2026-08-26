# ADR 0003: background ChatGPT handoff の撤回候補

- Status: Proposed
- Scope: v0.1.x hardening
- Date: 2026-08-24
- Last updated: 2026-08-26
- Related: GitHub Issue #3 / Issue #6

## Context

2026-08-26 の PR #13 修正前 build を、機密情報を含まないテスト入力で Chrome 実機 smoke した。foreground / background ともに composer への prompt の視覚的な挿入までは確認できたが、自動送信されず入力欄に残り、固定 banner が表示された。send 操作、clipboard write とも二重実行や自動 retry は発生しなかった。

非機密の typed diagnostics では、両経路とも `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed` だった。foreground の visible sample は composer 候補 1、composer / container とも attached、send 候補 1。background の hidden sample は composer attached だが container が unknown、send 候補 0 だった。これは send control の操作前に fail-closed したことを示し、送信済みか不明な状態で再送していない。

追加の非機密 DOM 確認では、ChatGPT Web の composer は contenteditable の ProseMirror `div` で、複数の直下 `p` 要素へ内容を正規化していた。修正前 adapter の `textContent` による prompt 完全一致 gate は、段落改行を保持できず、複数行 prompt で `composer-write-unconfirmed` を誤って発生させることが最有力であり、現時点で実質的に特定された原因である。fail-closed の性質と標準 `textContent` 書き込みを維持し、直後の text node または厳密な直下 `p` 構造から plain text を復元して比較する最小修正を実装した。予期しない構造は一致扱いにしない。これは既存の書き込み確認を誤判定しないための adapter 内に限定した読み戻しである。

clipboard diagnostics は両経路とも `status=clipboard-failed`、`failureCategory=write-failed`、`lifecycleCategory=none`、`cleanupFailureCategory=none` だった。したがって今回の clipboard failure は offscreen document の作成競合・未作成・close failure ではなく、clipboard write operation の rejection と切り分けられる。focus できない offscreen document で reject した `navigator.clipboard.writeText()` を、Chrome 公式の Service Worker 移行例に沿う一時 `textarea` の単回 DOM copy へ置換した。copy の false / throw は `write-failed` とし、一時要素は値を消去して必ず除去する。prompt、selection、clipboard 内容、アカウント情報は診断にも本 ADR にも記載しない。

修正後の HEAD `5cf1416` を、機密情報を含まないテスト入力で Chrome 実機 re-smoke した。foreground は `status=sent`、`phase=send`、`attempted=true`、`failureReason=none`、`visibilityState=visible`、composer / send 候補各 1、全 attachment `attached` となり、メッセージ送信、入力欄の空、banner なしを確認した。background は hidden sample で `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`、composer 候補 1・composer `attached`、container / send は `unknown`・0 となり、メッセージ未送信、prompt 残留、banner 表示だった。background の clipboard fallback は `status=copied`、`failureCategory=none`、`cleanupFailureCategory=none`、`lifecycleCategory=none`、`bannerShown=true` であり、DOM copy の実機成功を確認した。foreground の visible `sent` ログが background のログ出力に残っていたが、これは直前の foreground 実行の記録であり、background 成功の証拠にはしない。いずれも自動 retry・二重送信はなかった。

ChatGPT Web の hydration、controlled input、event handler readiness は非公開・非保証の実装詳細であり、ContextFling が安全に確認できる公式な readiness signal はない。background throttling の影響も Chrome と ChatGPT Web の変更に依存する。今回、段落 plain-text 復元により foreground の送信と clipboard DOM copy は実機で成功した一方、background hidden document では React / ProseMirror state readiness を保証できず、自動送信が失敗し続けた。このため background 自動送信は撤回候補とし、foreground-only（option 2）を推奨候補にする。

## Required invariants

- send control の操作は一回以下とし、自動 retry を追加しない。
- 送信結果不明時に再送信しない。
- clipboard write は一回以下とし、成否にかかわらず pending payload を終端 cleanup する。
- 既存会話、Cookie、token、auth state、API key を使わない。
- selection、prompt、clipboard 内容、アカウント情報を診断、ログ、banner に含めない。
- 新しい permission、backend、telemetry、remote code、追加の非公開 ChatGPT internals 依存を導入しない。

## Options

| Option | Security | Privacy | UX | Maintenance |
| --- | --- | --- | --- | --- |
| 1. background 自動送信を維持 | readiness を安全に確認できない間は、handler 未準備の click と結果誤判定が残る | 送信済みか不明な状態で clipboard を上書きし得る | 成功時は最短だが、現状は prompt 残留と fallback 失敗を確認済み | 非公開 hydration / DOM / throttling への追従が最も重い |
| 2. background 設定を廃止して foreground のみに限定 | background hidden document の readiness 不確実性を除き、送信前提を明確にできる | 現行の preview、permission、データ境界を維持できる | foreground の実機送信成功を利用できるが、tab は前面へ移る | 設定を単純化できる。composer / clipboard failure の gate は維持する |
| 3. background 時だけ paste-only | 自動送信を避けられる。clipboard DOM copy は実機で成功した | clipboard を一回上書きするため、手動貼り付け前提と成否の独立表示が必要 | X tab を維持できるが、ChatGPT tab へ移って手動貼り付けが必要 | foreground / background 分岐と clipboard lifecycle を維持するため次点 |
| 4. ChatGPT Web automation 全体を paste-only に縮小 | 非公開 send DOM と誤送信リスクを最大限縮小する | clipboard 利用は残るが ChatGPT への自動送信はなくなる | 既存の自動送信 UX を失い、手動貼り付けが必要 | DOM send adapter を撤去でき、最も保守しやすい |
| 5. 安全に実行できない場合は no-op + 明示的 feedback | 送信も clipboard 変更もしないため最も保守的 | ユーザーデータを追加処理しない | 手動作業が増えるが状態は明確 | failure gate と固定 feedback だけでよい |

## Proposed decision

本 ADR は引き続き `Proposed` とする。HEAD `5cf1416` の re-smoke で foreground の自動送信成功と background hidden document の fail-closed を確認したため、現時点の推奨候補を option 2 の「background 設定を廃止し foreground のみに限定」へ更新する。これは background 自動送信を撤回する提案であり、設定 UI・schema・受入条件を含む仕様変更はまだ実装せず、人手の採択を待つ。foreground の送信成功は確認済みだが、ChatGPT Web の非公開 DOM 依存は残るため、既存の fail-closed gate と単回操作を維持する。

option 3 の background paste-only は clipboard DOM copy が実機で `copied` となったため技術的には実現可能である。ただし、clipboard の上書き、ユーザーによる手動貼り付け、foreground / background 分岐と lifecycle の保守が増えるため次点とする。option 2 または option 3 の採択前に、安全に実行できない予期しないケースは option 5 の「no-op + 明示的 feedback」として扱う。送信結果を保証できない場合は send control と clipboard の追加操作を行わず、固定 banner だけで手動操作を案内する。

コード修正と synthetic test はこの判断材料を増やすための最小変更に限る。background 設定の廃止、paste-only への全面移行、DOM adapter の撤去は本 ADR の最終判断後に別の仕様変更として行い、設定 UI / schema / tests / Privacy 文書を同じ変更で同期する。

## Evidence required before acceptance

- 原因修正後の foreground / background それぞれの adapter `status`、`phase`、typed failure reason、`document.visibilityState`、send control 候補数、attachment 状態。HEAD `5cf1416` では foreground が `sent`、background hidden が `selector-mismatch` / `composer-write-unconfirmed` となった。
- controlled input の DOM 値と framework state が一致しない synthetic case、handler 未準備の synthetic click、delayed hydration、composer / form replacement、detached DOM の安全な終端。
- contenteditable ProseMirror の段落を plain text に復元する書き込み確認と、完全一致できない場合の fail-closed。clipboard unavailable、write rejection、response failure、offscreen creation race の typed category。
- duplicate `tabs.onUpdated`、target close、Service Worker restart 相当で send / clipboard write が二回実行されず、pending が終端 cleanup されること。
- 非機密 fixture を使った Chrome re-smoke は実施済みで、foreground の送信成功、background hidden の fail-closed、clipboard DOM copy の成功を確認した。Release Gate は background 撤回の人手判断、追加シナリオ、Security / Privacy review が残るため閉じない。

## Consequences if accepted

- `openInBackground` 設定、設定 UI、local storage schema の扱いを決め、コードと tests を同じ変更で更新する。
- ADR 0001、`CONTEXT.md`、README、Security、Privacy、Chrome Web Store 文書、version history を同期する。
- optional permission matrix は変更しない。Chrome Web Store への submit / publish は行わない。
