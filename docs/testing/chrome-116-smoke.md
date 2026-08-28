# Chrome 116+ 実機 smoke

> Status: Chrome manual smoke complete（実機再現不能項目は自動検証で補完） / Chrome Web Store Release Gate は保留
>
> Tracking: [GitHub Issue #6](https://github.com/y4shiro/contextfling/issues/6)

## 目的

Issue #6 の残りの Chrome 116 以上の実機 smoke を、現行の foreground-only 設計に合わせて確認します。旧 Issue に残る foreground / background 切り替え前提は、[ADR 0003](../adr/0003-background-chatgpt-handoff-withdrawal.md) に従い、次のとおり読み替えます。

- ChatGPT target は常に foreground で開く。
- `storage.local` に旧 `openInBackground` が残っていても読み取り・使用しない。
- adapter 実行時に document が hidden なら、composer への書き込みと送信を行わず fail-closed する。
- send、clipboard write とも一回以下とし、送信結果が不明でも retry・再送信しない。

## 参照した既存証跡

- [Issue #3](https://github.com/y4shiro/contextfling/issues/3)：foreground 送信成功、visibility race による hidden 時の fail-closed、retry / 二重送信なし。
- [Issue #4](https://github.com/y4shiro/contextfling/issues/4)：permission consent の許可・拒否・撤回、tab close、pending cleanup。
- [ADR 0003](../adr/0003-background-chatgpt-handoff-withdrawal.md)：background 自動送信を撤回し、foreground-only と hidden 時 fail-closed を採択した根拠。
- [v0.1 実装計画](../architecture/v0.1-implementation-plan.md)：Issue #6 の検証対象、typed diagnostics、自動検証の範囲。
- [Permission・consent 実機 smoke](permission-consent-smoke.md)：permission request、consent、Service Worker 復帰と cleanup の既存証跡。

## 安全条件

- X / Twitter と ChatGPT には公開・非機密 fixture だけを使用する。
- 選択本文、prompt、clipboard 内容、Cookie、token、認証情報、アカウント情報、Chrome profile 情報を記録しない。
- 実機検証のために permission、host permission、test hook、非公開 DOM 改変、外部通信、retry を追加しない。
- target の送信結果が不明な場合は確認のための再実行・再送信を行わない。
- clipboard fallback は既存 clipboard を読み取らず、成否にかかわらず pending payload を終端 cleanup する。

## 実行条件

- 確認日: 2026-08-27
- 起点: 既定ブランチ起点の branch、HEAD `a4f59ac`
- Extension: 0.1.1
- Chrome: 151.0.7922.140（公式ビルド、arm64）
- 対象: Chrome 116 以上の unpacked extension（実機代表確認は Chrome 151）
- build 後の `dist/` を Chrome に読み込み、拡張機能を再読み込みしてから Issue #6 の追加 smoke を実行した。

## 完了済み項目と Issue #6 の追加項目

### 既存証跡で完了している項目

foreground の composer 書き込み・送信成功、visibility race または hidden document 時の送信前 fail-closed、permission / consent の拒否・許可・撤回、pending / target / consent tab の cleanup は、Issue #3 / #4 と [Permission・consent 実機 smoke](permission-consent-smoke.md) に記録済みです。これらを Issue #6 の追加実機確認と重複して扱わず、現行設計の前提証跡として参照します。

### Issue #6 で追加確認した実機マトリクス

| ID | 経路 | 実機で確認した操作・状態 | 結果 | 残存確認 |
| --- | --- | --- | --- | --- |
| F1 | X selection menu + 近傍 status URL | 公開 X / Twitter の投稿内テキストを選択し、context menu の `ChatGPTで解説する` から handoff を開始した。近傍の status link が正規化され、新規 ChatGPT target が前面に開いた。 | PASS | user message は 1 件、composer は空、banner なし。5 秒後も retry・二重送信・追加 target なし。 |
| F2 | page URL fallback | article 外の固定見出しを選択して handoff を開始し、近傍 status link がない場合に page URL fallback が使われることを確認した。 | PASS | F1 と同じく user message は 1 件、composer cleanup 済み、banner なし。5 秒後も retry・二重送信・追加 target なし。 |
| F3 | 旧 `openInBackground` 保存値 | `chrome.storage.local` に旧 `openInBackground: true` と consent version を一時保存した状態で handoff を開始した。 | PASS | target は background ではなく foreground。user message は 1 件、composer cleanup 済み、retry・二重送信なし。確認後、設定値は consent version のみに復元した。 |
| F4 | target tab close | foreground target を開いた直後にその tab を閉じ、ContextFling を再実行せずに待機した。 | PASS | 5 秒後も target の再生成・retry なし。閉じるまでの送信成否は確認せず、結果不明時の再実行禁止を守った。pending の物理 cleanup は既存の target close 自動テストで補完した。 |
| F5 | logged-out + clipboard fallback | 別 Chrome profile に新しい unpacked extension を読み込み、ChatGPT logged-out 状態で公開 X fixture から handoff を開始した。 | PASS | 自動送信せず、clipboard コピー成功の固定 banner が表示された。5 秒後も banner の再表示・追加動作なし。clipboard 内容は確認・記録していない。 |

F1–F4 は最新 build を拡張機能へ再読み込みした後に実行しました。F5 は別 profile の logged-out 環境へ最新 `dist/` を新規 unpacked extension として読み込んで実行しました。いずれも実際の選択本文・prompt・clipboard 内容は証跡に含めません。

## 現行設計との照合

- **foreground-only**：F1–F4 の target はすべて前面に開き、旧設定値が残る F3 でも background target は作成されませんでした。
- **旧値無視**：F3 では旧 `openInBackground: true` を読み取り・使用せず、確認後に旧値を再保存しませんでした。
- **hidden 時 fail-closed**：visibility race / hidden document の送信前停止は Issue #3 と ADR 0003 の既存証跡を採用します。hidden 状態で送信や clipboard fallback を追加実行しない設計を維持します。
- **単回操作と終端 cleanup**：F1–F3 は送信一回、composer 空、retry・二重送信なし。F4 は送信成否を推測せず、target close 後の再生成・retry なしを確認し、pending cleanup を自動テストで補完しました。F5 は clipboard write 一回以下の fallback と固定 banner で終端し、追加動作はありませんでした。
- **permission / consent**：permission request、明示同意、拒否・撤回、pending cleanup は Issue #4 と [Permission・consent 実機 smoke](permission-consent-smoke.md) の証跡を採用します。

## 実機で再現できない項目と自動検証による補完

次の項目は、本番の利用者向け UI だけで安定して再現できないため `BLOCKED` とします。実機で無理に再現する test hook、非公開 ChatGPT DOM の改変、permission 操作の追加、retry は実装・検証へ追加していません。

| ID | シナリオ | 結果 | 実機で再現できない理由 | 自動検証で補完した内容 |
| --- | --- | --- | --- | --- |
| B1 | ChatGPT DOM 変更 / selector mismatch | BLOCKED | ChatGPT Web の非公開 DOM を実機用に改変できず、変更が起きるまでを外部から決められない。 | selector mismatch、複数候補、detached node、DOM replacement、visibility gate が fail-closed し、send が行われないことを確認。 |
| B2 | bounded timeout | BLOCKED | 本番 UI の hydration / readiness を壊さず、利用者向け操作だけで timeout を決定的に発生させる手順がない。 | bounded observer / timeout、timeout 後の固定 feedback、pending cleanup、retry なしを確認。 |
| B3 | `send-unknown` | BLOCKED | 実機で送信結果を不明にする操作は、誤送信または送信済みか不明な状態を作り得るため安全に再現しない。 | send click 最大一回、送信結果不明時の再送禁止、単回 fallback / 固定 banner、終端 cleanup を確認。 |
| B4 | clipboard failure / offscreen edge | BLOCKED | 実 profile の clipboard や offscreen lifecycle を意図的に壊す操作は既存 clipboard の上書き・状態不明を招くため行わない。 | clipboard write rejection、offscreen 作成競合・未作成・close failure、typed failure category、banner、値を残さない cleanup を確認。 |

`BLOCKED` は未検証のまま放置したという意味ではなく、上記の安全上の理由で Chrome manual による再現を行わず、再現可能な境界を自動テストで補完したことを示します。Chrome 151 の手動確認結果と自動補完の対象を分けて記録し、Chrome 116 から 151 以外の全バージョンへ実機結果を一般化しません。

## 自動検証（2026-08-27）

```text
npm test                 84 tests passed
npm run build            passed
npm run lint             passed
npm run typecheck        passed
npm run check:secrets    passed
diff check               passed
```

自動検証では、X の selection / status link / page URL fallback、foreground target、旧 `openInBackground` の無視、hidden 時 fail-closed、DOM failure、timeout、send-unknown、target close、clipboard failure / offscreen lifecycle、pending cleanup、retry・二重送信なしを確認しました。Manifest の permission matrix、外部通信なし、機密情報をログ・fixture に含めない境界も既存テストと差分確認で確認済みです。

## 残存リスクと Release Gate

- ChatGPT Web の非公開 DOM、React / ProseMirror state readiness、selector、synthetic click の送信結果は公式に保証されません。foreground-only 化後もこの Experimental 依存は残ります。
- 今回の手動代表環境は Chrome 151.0.7922.140 です。Chrome 116 以上の全バージョンで同一挙動を保証する実機証跡ではありません。
- logged-out では自動送信せず clipboard fallback の固定 banner へ終端します。clipboard の内容は読み取らず、ユーザーが必要に応じて手動操作します。
- Security / Privacy review、正式名称・listing・Privacy URL、Chrome Web Store の審査・公開判断は未完了です。CWS の submit / publish は行わず、Release Gate は保留のままです。

## 記録フォーマット

```text
Date:
Chrome:
Extension:
Scenario:
Result: PASS / FAIL / BLOCKED
Observed state:
- target: foreground / absent / unknown
- send attempts: 0 / 1 / unknown
- composer cleanup: yes / no / unknown
- retry or duplicate: none / observed / unknown
- banner: absent / clipboard-success / fixed-failure / unknown
Notes (non-sensitive only):
```

## 完了条件

- X selection menu、近傍 status URL、page URL fallback を実機で確認する。
- target が foreground に開き、旧 `openInBackground` 保存値を無視することを実機で確認する。
- logged-out、clipboard success banner、target close、composer cleanup、retry・二重送信なしを実機で確認する。
- DOM 変更、timeout、send-unknown、clipboard failure / offscreen edge は、安全な手動再現不能の理由と自動検証結果を記録する。
- Issue #3 / #4 の foreground success、visibility-race fail-closed、permission consent cleanup を既存証跡として参照する。
- 84 tests、build、lint、typecheck、secret scan、diff check を完了する。
- Chrome Web Store の submit / publish や Issue / PR への外部書き込みは、この記録の完了条件に含めない。
