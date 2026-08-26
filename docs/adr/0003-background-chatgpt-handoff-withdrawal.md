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

ChatGPT Web の hydration、controlled input、event handler readiness は非公開・非保証の実装詳細であり、ContextFling が安全に確認できる公式な readiness signal はない。background throttling の影響も Chrome と ChatGPT Web の変更に依存する。foreground も同じ composer gate で失敗したため、foreground-only への縮小だけでは今回の共通 failure を解決しない。原因修正後の Chrome re-smoke が完了するまでは、自動送信を成功扱いに戻さない。

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
| 2. background 設定を廃止して foreground のみに限定 | background 固有の不確実性は減るが、今回の foreground / background 共通 failure は残る | 現行の preview、permission、データ境界を維持できる | tab が前面へ移るが、送信状態をユーザーが直接確認できる | 設定は単純になるが、composer / clipboard failure の修正は別途必要 |
| 3. background 時だけ paste-only | 自動送信を避けられる | clipboard へ prompt を一回書くため、clipboard 成否の独立保証が必要 | X tab を維持できるが、ChatGPT tab へ移って手動貼り付けが必要 | foreground / background の分岐と clipboard lifecycle を維持する |
| 4. ChatGPT Web automation 全体を paste-only に縮小 | 非公開 send DOM と誤送信リスクを最大限縮小する | clipboard 利用は残るが ChatGPT への自動送信はなくなる | 既存の自動送信 UX を失い、手動貼り付けが必要 | DOM send adapter を撤去でき、最も保守しやすい |
| 5. 安全に実行できない場合は no-op + 明示的 feedback | 送信も clipboard 変更もしないため最も保守的 | ユーザーデータを追加処理しない | 手動作業が増えるが状態は明確 | failure gate と固定 feedback だけでよい |

## Proposed decision

本 ADR は引き続き `Proposed` とする。foreground / background の共通 failure が実機で確認されたため、現時点で option 2 の「background 設定を廃止し foreground のみに限定」を採択・推奨する根拠はない。設定を foreground-only にしても、現行の composer 完全一致 gate と clipboard write rejection は残る。

原因修正後の re-smoke が完了するまでの安全側候補は、option 5 の「安全に実行できないケースでは no-op + 明示的 feedback」である。送信結果を保証できない場合は send control と clipboard のいずれも追加操作せず、固定 banner だけで手動操作を案内する。clipboard write が実機で成功することを別途確認できた場合に限り、まず option 3 または option 4 の paste-only を候補にする。DOM 自動送信の維持・撤回は、foreground / background の re-smoke で、prompt 書き込み確認、send handler、送信結果確認、二重送信なしを再確認してから判断する。

コード修正と synthetic test はこの判断材料を増やすための最小変更に限る。background 設定の廃止、paste-only への全面移行、DOM adapter の撤去は本 ADR の最終判断後に別の仕様変更として行い、設定 UI / schema / tests / Privacy 文書を同じ変更で同期する。

## Evidence required before acceptance

- 原因修正後の foreground / background それぞれの adapter `status`、`phase`、typed failure reason、`document.visibilityState`、send control 候補数、attachment 状態。今回の観測は selector mismatch / composer write unconfirmed として記録済み。
- controlled input の DOM 値と framework state が一致しない synthetic case、handler 未準備の synthetic click、delayed hydration、composer / form replacement、detached DOM の安全な終端。
- contenteditable ProseMirror の段落を plain text に復元する書き込み確認と、完全一致できない場合の fail-closed。clipboard unavailable、write rejection、response failure、offscreen creation race の typed category。
- duplicate `tabs.onUpdated`、target close、Service Worker restart 相当で send / clipboard write が二回実行されず、pending が終端 cleanup されること。
- 非機密 fixture を使った Chrome re-smoke での foreground / background / clipboard success / failure 再確認。re-smoke 完了までは Release Gate を閉じない。

## Consequences if accepted

- `openInBackground` 設定、設定 UI、local storage schema の扱いを決め、コードと tests を同じ変更で更新する。
- ADR 0001、`CONTEXT.md`、README、Security、Privacy、Chrome Web Store 文書、version history を同期する。
- optional permission matrix は変更しない。Chrome Web Store への submit / publish は行わない。
