# ADR 0003: background ChatGPT handoff の撤回

- Status: Accepted
- Scope: v0.1.x hardening
- Date: 2026-08-24
- Last updated: 2026-08-27
- Related: GitHub Issue #3 / Issue #4 / Issue #6

## Context

2026-08-26 の PR #13 修正前 build を、機密情報を含まないテスト入力で Chrome 実機 smoke した。foreground / background ともに composer への prompt の視覚的な挿入までは確認できたが、自動送信されず入力欄に残り、固定 banner が表示された。send 操作、clipboard write とも二重実行や自動 retry は発生しなかった。

非機密の typed diagnostics では、両経路とも `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed` だった。foreground の visible sample は composer 候補 1、composer / container とも attached、send 候補 1。background の hidden sample は composer attached だが container が unknown、send 候補 0 だった。これは send control の操作前に fail-closed したことを示し、送信済みか不明な状態で再送していない。

追加の非機密 DOM 確認では、ChatGPT Web の composer は contenteditable の ProseMirror `div` で、複数の直下 `p` 要素へ内容を正規化していた。修正前 adapter の `textContent` による prompt 完全一致 gate は、段落改行を保持できず、複数行 prompt で `composer-write-unconfirmed` を誤って発生させることが最有力であり、現時点で実質的に特定された原因である。fail-closed の性質と標準 `textContent` 書き込みを維持し、直後の text node または厳密な直下 `p` 構造から plain text を復元して比較する最小修正を実装した。予期しない構造は一致扱いにしない。これは既存の書き込み確認を誤判定しないための adapter 内に限定した読み戻しである。

clipboard diagnostics は両経路とも `status=clipboard-failed`、`failureCategory=write-failed`、`lifecycleCategory=none`、`cleanupFailureCategory=none` だった。したがって今回の clipboard failure は offscreen document の作成競合・未作成・close failure ではなく、clipboard write operation の rejection と切り分けられる。focus できない offscreen document で reject した `navigator.clipboard.writeText()` を、Chrome 公式の Service Worker 移行例に沿う一時 `textarea` の単回 DOM copy へ置換した。copy の false / throw は `write-failed` とし、一時要素は値を消去して必ず除去する。prompt、selection、clipboard 内容、アカウント情報は診断にも本 ADR にも記載しない。

PR #13 の修正コミット `5cf1416` を、機密情報を含まないテスト入力で Chrome 実機 re-smoke した。foreground は `status=sent`、`phase=send`、`attempted=true`、`failureReason=none`、`visibilityState=visible`、composer / send 候補各 1、全 attachment `attached` となり、メッセージ送信、入力欄の空、banner なしを確認した。background は hidden sample で `status=selector-mismatch`、`phase=composer`、`attempted=false`、`failureReason=composer-write-unconfirmed`、composer 候補 1・composer `attached`、container / send は `unknown`・0 となり、メッセージ未送信、prompt 残留、banner 表示だった。同じ ADR 0003 採択前の background 実験では clipboard fallback が `status=copied`、`failureCategory=none`、`cleanupFailureCategory=none`、`lifecycleCategory=none`、`bannerShown=true` であり、DOM copy の実機成功を確認した。foreground の visible `sent` ログが background のログ出力に残っていたが、これは直前の foreground 実行の記録であり、background 成功の証拠にはしない。現行の hidden 経路は clipboard fallback を行わず、いずれの検証でも自動 retry・二重送信はなかった。

ChatGPT Web の hydration、controlled input、event handler readiness は非公開・非保証の実装詳細であり、ContextFling が安全に確認できる公式な readiness signal はない。background throttling の影響も Chrome と ChatGPT Web の変更に依存する。今回、段落 plain-text 復元により foreground の送信と clipboard DOM copy は実機で成功した一方、background hidden document では React / ProseMirror state readiness を保証できず、自動送信が失敗し続けた。このため background 自動送信を撤回し、foreground-only（option 2）を採択する。

## Required invariants

- send control の操作は一回以下とし、自動 retry を追加しない。
- 送信結果不明時に再送信しない。
- clipboard write は一回以下とし、成否にかかわらず pending payload を終端 cleanup する。
- 既存会話、Cookie、token、auth state、API key を使わない。
- selection、prompt、clipboard 内容、アカウント情報を診断、ログ、banner に含めない。
- 新しい permission、backend、telemetry、remote code、追加の非公開 ChatGPT internals 依存を導入しない。
- target ChatGPT tab は常に foreground で作成する。adapter 実行時に document が hidden なら、prompt の書き込みと send control の操作前に fail-closed する。
- `openInBackground` の設定 UI と保存を廃止する。既存の保存値が残っていても読み取り・使用せず、foreground 動作へ移行する。

## Options

| Option | Security | Privacy | UX | Maintenance |
| --- | --- | --- | --- | --- |
| 1. background 自動送信を維持 | readiness を安全に確認できない間は、handler 未準備の click と結果誤判定が残る | 送信済みか不明な状態で clipboard を上書きし得る | 成功時は最短だが、現状は prompt 残留と fallback 失敗を確認済み | 非公開 hydration / DOM / throttling への追従が最も重い |
| 2. background 設定を廃止して foreground のみに限定 | background hidden document の readiness 不確実性を除き、送信前提を明確にできる | 現行の preview、permission、データ境界を維持できる | foreground の実機送信成功を利用できるが、tab は前面へ移る | 設定を単純化できる。composer / clipboard failure の gate は維持する |
| 3. background 時だけ paste-only | 自動送信を避けられる。clipboard DOM copy は実機で成功した | clipboard を一回上書きするため、手動貼り付け前提と成否の独立表示が必要 | X tab を維持できるが、ChatGPT tab へ移って手動貼り付けが必要 | foreground / background 分岐と clipboard lifecycle を維持するため次点 |
| 4. ChatGPT Web automation 全体を paste-only に縮小 | 非公開 send DOM と誤送信リスクを最大限縮小する | clipboard 利用は残るが ChatGPT への自動送信はなくなる | 既存の自動送信 UX を失い、手動貼り付けが必要 | DOM send adapter を撤去でき、最も保守しやすい |
| 5. 安全に実行できない場合は no-op + 明示的 feedback | 送信も clipboard 変更もしないため最も保守的 | ユーザーデータを追加処理しない | 手動作業が増えるが状態は明確 | failure gate と固定 feedback だけでよい |

## Decision

option 2 の「background 設定を廃止し foreground のみに限定」を採択する。target ChatGPT tab は常に前面で開く。読み込み完了前の tab 切り替え等で adapter 実行時に document が hidden なら、prompt の書き込みと自動送信を行わず fail-closed する。設定画面から background 選択肢を削除し、`storage.local` の `openInBackground` 保存を廃止する。旧バージョンが残した値は読み取り・使用せず、移行のために再保存もしない。

foreground-only は ChatGPT Web の DOM 依存を解消するものではない。foreground でも React / ProseMirror の state readiness、selector の安定性、synthetic click の送信結果を公式に保証できないため、既存の uniqueness gate、attachment / value readback、send 最大一回、retry 禁止、送信結果不明時の再送禁止、単回 clipboard fallback、terminal cleanup を維持する。

option 3 の background paste-only は clipboard DOM copy が実機で `copied` となったため技術的には実現可能である。ただし、clipboard の上書き、ユーザーによる手動貼り付け、foreground / background 分岐と lifecycle の保守が増えるため次点の将来 Issue 候補とし、現行仕様には追加しない。

option 5 は、foreground-only の対象外状態、または adapter / fallback の安全境界を確立できず追加操作が必要になる状態での最終終端とする。この場合は send control と clipboard を追加操作せず、ユーザー向けの固定 feedback を表示し、pending payload を cleanup する。安全に保証できる既存の bounded adapter failure では単回 clipboard fallback を使える。`send-unknown` でも自動再送はせず、単回 fallback 後は画面を確認して未送信の場合だけ手動貼り付けするよう固定 banner で案内し、それ以上の操作を行わない。fallback 自体の成否が不明な場合や追加操作が必要になる場合は option 5 に進む。

background 設定の削除、旧保存値の無視、foreground-only の tab 作成はコード / tests と同じ変更で反映する。設定 UI・schema・Privacy・CWS 文書は本 ADR と同期し、paste-only への全面移行や DOM adapter の撤去は別の将来 Issue として扱う。

## Evidence and remaining release gate

- 原因修正後の foreground / background それぞれの adapter `status`、`phase`、typed failure reason、`document.visibilityState`、send control 候補数、attachment 状態。PR #13 の修正コミット `5cf1416` では foreground が `sent`、background hidden が `selector-mismatch` / `composer-write-unconfirmed` となった。
- controlled input の DOM 値と framework state が一致しない synthetic case、handler 未準備の synthetic click、delayed hydration、composer / form replacement、detached DOM の安全な終端。
- adapter 実行時に document が hidden なら `document-not-visible` / `attempted=false` とし、composer 書き込み、send click、clipboard fallback を行わず固定 feedback と cleanup へ終端すること。
- contenteditable ProseMirror の段落を plain text に復元する書き込み確認と、完全一致できない場合の fail-closed。clipboard unavailable、write rejection、response failure、offscreen creation race の typed category。
- duplicate `tabs.onUpdated`、target close、Service Worker restart 相当で send / clipboard write が二回実行されず、pending が終端 cleanup されること。
- 2026-08-27 の Issue #6 実機 smoke は、Chrome `151.0.7922.140` (arm64) / Extension `0.1.1` の再読み込み後に完了した。[Chrome 116+ smoke 詳細](../testing/chrome-116-smoke.md) に手順と非機密の証跡を記録する。X / Twitter の selection menu・近傍 status URL・article 外の page URL fallback、foreground target、旧 `openInBackground: true` 保存値無視、logged-in の単回送信・composer cleanup・banner なし・retry / 二重送信 / 追加 target なし、target close 後の再生成・retry なしを確認した。別 profile の logged-out 経路は送信せず clipboard コピー成功 banner へ終端し、5秒後の再表示・追加動作なしを確認した。
- Issue #3 / #4 の foreground 成功、visibility race、permission consent cleanup の完了証跡とも整合する。DOM 変更、timeout、`send-unknown`、clipboard failure / offscreen edge は通常の実 UI で決定論的に再現できないため、本番用 test hook、非公開 DOM 改変、retry の追加は行わず、84 tests で typed failure / cleanup / no-retry を補完した。
- foreground-only 化後の実機再確認は完了したが、Security / Privacy review と正式名称・素材・Privacy URL 等の CWS Release Gate は未完了のため、Release Gate は閉じない。

## Consequences

- `openInBackground` 設定と設定 UI を削除し、旧保存値を無視する。target を foreground に固定するコードと tests を同じ変更で更新する。
- ADR 0001、`CONTEXT.md`、README、Security、Privacy、Chrome Web Store 文書、version history を同期する。
- optional permission matrix は変更しない。Chrome Web Store への submit / publish は行わない。
