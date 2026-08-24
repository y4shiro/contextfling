# ADR 0003: background ChatGPT handoff の撤回候補

- Status: Proposed
- Scope: v0.1.x hardening
- Date: 2026-08-24
- Related: GitHub Issue #3 / Issue #6

## Context

Chrome 151.0.7922.170 と ContextFling 0.1.1 の実機 smoke では、foreground の新規 ChatGPT 会話への自動送信は一度だけ成功した。一方、background target tab では prompt の入力欄への挿入までは成功したが、自動送信されず prompt が残り、clipboard fallback も失敗した。固定 banner は表示され、自動 retry と二重送信は発生しなかった。

確認時点の send control は一個で、`data-testid="send-button"`、`aria-disabled=false` だった。ただし adapter 実行時点の status / phase / DOM attachment / visibility と clipboard failure category は記録されておらず、selector mismatch、controlled input の state 未反映、hydration 前の synthetic click、送信後確認の timeout のどれかは確定していない。

ChatGPT Web の hydration、controlled input、event handler readiness は非公開・非保証の実装詳細であり、ContextFling が安全に確認できる公式な readiness signal はない。background throttling の影響も Chrome と ChatGPT Web の変更に依存する。原因未確定のまま待機、selector、event 操作、retry を増やすと、誤送信・二重送信と保守負担を増やす。

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
| 2. background 設定を廃止して foreground のみに限定 | 実機成功済みの経路へ範囲を縮小し、background 固有の不確実性を除く | 現行の preview、permission、データ境界を維持できる | tab が前面へ移るが、送信状態をユーザーが直接確認できる | 最も単純で、追加の DOM 依存がない |
| 3. background 時だけ paste-only | 自動送信を避けられる | clipboard へ prompt を一回書くため、clipboard 成否の独立保証が必要 | X tab を維持できるが、ChatGPT tab へ移って手動貼り付けが必要 | foreground / background の分岐と clipboard lifecycle を維持する |
| 4. ChatGPT Web automation 全体を paste-only に縮小 | 非公開 send DOM と誤送信リスクを最大限縮小する | clipboard 利用は残るが ChatGPT への自動送信はなくなる | foreground の既存成功 UX も失う | DOM send adapter を撤去でき、最も保守しやすい |
| 5. 安全に実行できない場合は no-op + 明示的 feedback | 送信も clipboard 変更もしないため最も保守的 | ユーザーデータを追加処理しない | 手動作業が増えるが状態は明確 | failure gate と固定 feedback だけでよい |

## Proposed decision

現時点では option 2 の「background 設定を廃止し foreground のみに限定」を推奨する。foreground 成功経路を維持しながら、保証できない background hydration / event readiness / throttling への依存を追加せずに済むためである。

ただし本 ADR は `Proposed` であり、この PR では設定廃止を実装しない。まず非機密の typed diagnostics と synthetic test で adapter failure と clipboard failure を分離し、Chrome 実機で再確認する。clipboard fallback が foreground を含めて安定しない場合は、option 4 または 5 へさらに縮小する。background 利用を残す明示要件がある場合だけ option 3 を再検討し、clipboard success / failure の実機 gate を必須とする。

## Evidence required before acceptance

- foreground / background それぞれの adapter `status`、`phase`、typed failure reason、`document.visibilityState`、send control 候補数、attachment 状態。
- controlled input の DOM 値と framework state が一致しない synthetic case、handler 未準備の synthetic click、delayed hydration、composer / form replacement、detached DOM の安全な終端。
- clipboard unavailable、write rejection、response failure、offscreen creation race の typed category。
- duplicate `tabs.onUpdated`、target close、Service Worker restart 相当で send / clipboard write が二回実行されず、pending が終端 cleanup されること。
- 非機密 fixture を使った Chrome 実機での foreground / background / clipboard success / failure 再確認。

## Consequences if accepted

- `openInBackground` 設定、設定 UI、local storage schema の扱いを決め、コードと tests を同じ変更で更新する。
- ADR 0001、`CONTEXT.md`、README、Security、Privacy、Chrome Web Store 文書、version history を同期する。
- optional permission matrix は変更しない。Chrome Web Store への submit / publish は行わない。
