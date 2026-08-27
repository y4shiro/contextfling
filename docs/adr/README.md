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
- [0003: background ChatGPT handoff の撤回](0003-background-chatgpt-handoff-withdrawal.md) — foreground の実機成功と background hidden の fail-closed を根拠に background 自動送信を撤回し、foreground-only と hidden 時の書き込み前 fail-closed を採択。2026-08-27 の Chrome 151 smoke で foreground-only、旧保存値無視、logged-out clipboard fallback、no-retry を再確認した。background paste-only は将来 Issue 候補とする。

### Accepted（実装前）

- [0002: X 単体ポストのページ右クリック実行](0002-single-post-context-menu.md) — 単体ポスト URL の通常ページ右クリック、status ID と一致する主投稿本文の抽出、既存 handoff の再利用を採用。新規 permission、X / Twitter の恒久 host permission、常駐 content script、action icon 即時実行、X 内常設 button は対象外。Accepted は仕様選定を示し、実装完了・自動検証・実機確認・公開承認を意味しない。

v0.1.1 の本体機能は実装済みですが、ADR 0001 / 0003 は Experimental です。foreground 自動送信と clipboard DOM copy は実機成功、background hidden は送信前に fail-closed したため foreground-only を採択しました。2026-08-27 の Chrome `151.0.7922.140` (arm64) / Extension `0.1.1` smoke で、foreground-only 化後の target 前面表示、旧保存値無視、単回送信・cleanup、logged-out clipboard success banner、retry / 二重送信なしを再確認しました。DOM 変更・timeout・`send-unknown`・clipboard failure / offscreen edge は 84 tests で補完しています。Chrome Web Store には未公開で、正式名称・素材・Privacy URL 等の Release Gate は保留です。次の判断は、未検討の事項を勝手に `Accepted` にせず、`Proposed` または `Draft` として根拠・代替案・影響を記録します。
