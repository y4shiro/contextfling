# ADR

Architecture Decision Record（ADR）は、変更コストが高く、複数の妥当な選択肢があり、将来「なぜこうしたのか」を説明する必要がある設計判断を記録します。

## 基準

- 判断の背景、選択肢、採用理由、Security/Privacy/Maintenance Impact を記載する。
- 未検討の事項を `Accepted` にしない。検討中は `Proposed` または `Draft` とする。Accepted でも Experimental と明記された ADR は、実装成功や公開承認を意味しない。
- Manifest 権限、外部通信、認証・認可、データ保持、handoff、DOM 依存、公開方針など、後戻りコストが高い事項は ADR 候補とする。
- 関連するコード、テスト、`CONTEXT.md`、`CHROMEWEBSTORE.md` と内容を同期する。
- ADR の status を変更したときは、実装状態と受入条件を同じ変更で更新する。

## 状態

### Accepted（Experimental）

- [0001: 実験的 ChatGPT Web handoff](0001-experimental-chatgpt-web-handoff.md) — v0.1 の限定 scope、初回 preview/明示同意、optional host/offscreen/clipboardWrite、毎回新規会話、retry 禁止、session cleanup を採用。実装成功・公式連携・Web Store 公開を意味しない。

### Accepted（実装前）

- [0002: X 単体ポストのページ右クリック実行](0002-single-post-context-menu.md) — 単体ポスト URL の通常ページ右クリック、status ID と一致する主投稿本文の抽出、既存 handoff の再利用を採用。新規 permission、X / Twitter の恒久 host permission、常駐 content script、action icon 即時実行、X 内常設 button は対象外。Accepted は仕様選定を示し、実装完了・自動検証・実機確認・公開承認を意味しない。

### Proposed

- [0003: background ChatGPT handoff の撤回候補](0003-background-chatgpt-handoff-withdrawal.md) — Issue #6 の background 部分失敗を受け、background 自動送信維持、foreground 限定、background paste-only、全面 paste-only、no-op を比較する。現時点の推奨は foreground 限定だが、Human maintainer の判断前に実装へ固定しない。

v0.1.1 の本体機能は実装済みですが、ADR 0001 は Experimental です。foreground 自動送信は実機成功、background の自動送信 / clipboard fallback は実機失敗で、Chrome Web Store には未公開です。次の判断は、未検討の事項を勝手に `Accepted` にせず、`Proposed` または `Draft` として根拠・代替案・影響を記録します。
