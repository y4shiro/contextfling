# Permission・consent 実機 smoke

> Status: Draft
>
> Tracking: [GitHub Issue #4](https://github.com/y4shiro/contextfling/issues/4)

## 目的

optional permission と明示同意の境界が、許可・拒否・撤回の各経路で維持されることを Chrome 116 以上の unpacked extension で確認します。Chrome Web Store の submit / publish は行いません。

## 安全条件

- 実アカウントの投稿、選択文、prompt、clipboard 内容、Cookie、token、認証情報を記録しない。
- X / Twitter と ChatGPT には非機密の fixture だけを使用する。
- permission、host permission、外部通信、retry を検証のために追加しない。
- 実行結果には Chrome version、拡張機能 version、確認日、合否、非機密の failure category だけを記録する。
- 送信済みか不明な場合は再実行せず、pending cleanup と固定 feedback を確認して終了する。

## 事前条件

- `npm run build` 済みの `dist/` を unpacked extension として読み込む。
- Manifest の required permission が `activeTab`、`contextMenus`、`scripting`、`storage` であることを確認する。
- optional bundle が `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` だけであることを確認する。
- 初期状態では optional bundle と consent version を持たず、`storage.session` に pending がないことを確認する。

## 検証マトリクス

| ID | 経路 | 操作 | 期待結果 |
| --- | --- | --- | --- |
| P1 | 明示拒否 | exact preview で「送信しない」を選ぶ | permission request を開始せず、ChatGPT target を作らず、pending を削除する |
| P2 | permission 拒否 | approve 操作から permission prompt を開き、拒否する | consent を保存せず、ChatGPT へ送信せず、pending を削除する |
| P3 | permission 不足 | optional bundle の一部が不足した状態を再現する | Service Worker の bundle `contains` が失敗し、consent を保存せず、送信せず、pending を削除する |
| P4 | permission 許可 | exact preview 後の approve 操作から bundle 一式を許可する | Service Worker が bundle 一式を再確認し、consent を保存して一度だけ handoff を開始する |
| P5 | 同意撤回 | 設定画面で同意を撤回する | optional bundle、consent version、全 pending を削除し、関連 consent / target tab を閉じる |
| P6 | 撤回後の再利用 | P5 後に新しい handoff を開始する | exact preview と新しい明示同意を再度要求し、以前の同意を再利用しない |
| P7 | consent tab close | preview 中に consent tab を閉じる | ChatGPT target を作らず、対応する pending を削除する |
| P8 | Service Worker 再起動 | preview、approve、revoke の各境界で Service Worker を再読み込みする | permission / consent / pending の正本を storage と `contains` から復元し、二重送信しない |

## 記録フォーマット

```text
Date:
Chrome:
Extension:
Scenario:
Result: PASS / FAIL / BLOCKED
Observed state:
- optional bundle: present / absent / partial / unknown
- consent version: present / absent / unknown
- pending count: 0 / 1 / unknown
- target created: yes / no / unknown
- send attempts: 0 / 1 / unknown
Notes (non-sensitive only):
```

## 完了条件

- P1–P8 の結果または再現不能な理由を PR に記録する。
- permission request が exact preview 後の approve 操作からだけ開始されることを確認する。
- permission 拒否・不足・撤回の各終端で pending が物理削除されることを確認する。
- 撤回後に新しい明示同意を要求することを確認する。
- Manifest に新しい permission が追加されていないことを確認する。
- lint、typecheck、test、build、secret scan を再実行する。
